const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const KRAKEN = "https://api.kraken.com";
const DEFAULT_PAIR = "XXBTZUSD";
const DEFAULT_INTERVAL = 15;

// ========================================
// GLOBAL STATE
// ========================================
let STATE = {
  mode: "SIM", // SIM | LIVE
  balance: 5,
  milestoneLevel: 1,
  riskPerTrade: 0.1,
  latestScout: null,
  latestExecutor: null,
  trades: []
};

// ========================================
// HELPERS
// ========================================
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function getMilestone(balance) {
  if (balance < 10) return { level: 1, risk: 0.1 };
  if (balance < 20) return { level: 2, risk: 0.2 };
  if (balance < 40) return { level: 3, risk: 0.3 };
  if (balance < 70) return { level: 4, risk: 0.5 };
  return { level: 5, risk: 0.75 };
}

function calculatePnL(entry, exit, direction, size) {
  if (direction === "BUY") return (exit - entry) * size;
  if (direction === "SELL") return (entry - exit) * size;
  return 0;
}

function bodySize(c) {
  return Math.abs(c.close - c.open);
}

function candleRange(c) {
  return c.high - c.low;
}

function lowerWick(c) {
  return Math.min(c.open, c.close) - c.low;
}

function upperWick(c) {
  return c.high - Math.max(c.open, c.close);
}

function isBullish(c) {
  return c.close > c.open;
}

function isBearish(c) {
  return c.close < c.open;
}

function slope(values) {
  if (values.length < 2) return 0;
  return values[values.length - 1] - values[0];
}

function ema(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = mean(values.slice(0, period));
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }
  return mean(trs.slice(-period));
}

// ========================================
// KRAKEN
// ========================================
async function getOHLC(pair = DEFAULT_PAIR, interval = DEFAULT_INTERVAL) {
  const r = await fetch(
    `${KRAKEN}/0/public/OHLC?pair=${pair}&interval=${interval}`
  );
  const j = await r.json();

  if (j.error && j.error.length) {
    throw new Error(j.error.join(", "));
  }

  const key = Object.keys(j.result).find((k) => k !== "last");
  const rows = j.result[key] || [];

  return rows.map((row) => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    vwap: Number(row[5]),
    volume: Number(row[6]),
    count: Number(row[7])
  }));
}

function getKrakenSignature(path, request, secret, nonce) {
  const hash = crypto
    .createHash("sha256")
    .update(nonce + request)
    .digest();

  return crypto
    .createHmac("sha512", Buffer.from(secret, "base64"))
    .update(path + hash)
    .digest("base64");
}

async function placeOrder({ pair, side, volume }) {
  const path = "/0/private/AddOrder";
  const nonce = Date.now().toString();

  const params = new URLSearchParams({
    nonce,
    pair,
    type: side.toLowerCase(),
    ordertype: "market",
    volume: String(volume)
  });

  const signature = getKrakenSignature(
    path,
    params.toString(),
    process.env.KRAKEN_API_SECRET,
    nonce
  );

  const res = await fetch(KRAKEN + path, {
    method: "POST",
    headers: {
      "API-Key": process.env.KRAKEN_API_KEY,
      "API-Sign": signature,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  return await res.json();
}

// ========================================
// SCOUT — REALER BRC LOGIC
// ========================================
function runScout(candles) {
  if (!candles || candles.length < 60) {
    return {
      pattern_valid: false,
      reason: "NOT_ENOUGH_CANDLES"
    };
  }

  const closes = candles.map((c) => c.close);
  const ema50Series = ema(closes, 50);
  if (ema50Series.length < 2) {
    return {
      pattern_valid: false,
      reason: "EMA_UNAVAILABLE"
    };
  }

  const emaSlope = slope(ema50Series.slice(-3));
  let trend = null;

  if (emaSlope > 0) trend = "BUY";
  else if (emaSlope < 0) trend = "SELL";
  else {
    return {
      pattern_valid: false,
      reason: "FLAT_EMA"
    };
  }

  const recent = candles.slice(-6);
  const breakCandle = recent[1];
  const retestCandle = recent[2];
  const rejectionCandle = recent[3];
  const continuationCandle = recent[4];

  const lookbackStructure = candles.slice(-25, -5);
  const keyHigh = Math.max(...lookbackStructure.map((c) => c.high));
  const keyLow = Math.min(...lookbackStructure.map((c) => c.low));
  const keyLevel = trend === "BUY" ? keyHigh : keyLow;

  const avgBody = mean(lookbackStructure.map(bodySize));
  const minBreakBody = avgBody * 1.1;

  // 1. BREAK
  let breakValid = false;
  if (trend === "BUY") {
    breakValid =
      breakCandle.close > keyLevel && bodySize(breakCandle) > minBreakBody;
  } else {
    breakValid =
      breakCandle.close < keyLevel && bodySize(breakCandle) > minBreakBody;
  }

  if (!breakValid) {
    return {
      pattern_valid: false,
      reason: "WEAK_BREAK",
      trend,
      structure_level: keyLevel
    };
  }

  // 2. RETEST
  const retestTouches =
    retestCandle.low <= keyLevel && retestCandle.high >= keyLevel;

  if (!retestTouches) {
    return {
      pattern_valid: false,
      reason: "NO_RETEST",
      trend,
      structure_level: keyLevel
    };
  }

  // 3. REJECTION
  let rejectionValid = false;
  let stopLevel = null;

  if (trend === "BUY") {
    const wickTouch = rejectionCandle.low <= keyLevel;
    const closeAbove = rejectionCandle.close > keyLevel;
    const bullish = isBullish(rejectionCandle);
    const wickDominant =
      lowerWick(rejectionCandle) > bodySize(rejectionCandle) * 0.7;

    rejectionValid = wickTouch && closeAbove && bullish && wickDominant;
    stopLevel = rejectionCandle.low;
  } else {
    const wickTouch = rejectionCandle.high >= keyLevel;
    const closeBelow = rejectionCandle.close < keyLevel;
    const bearish = isBearish(rejectionCandle);
    const wickDominant =
      upperWick(rejectionCandle) > bodySize(rejectionCandle) * 0.7;

    rejectionValid = wickTouch && closeBelow && bearish && wickDominant;
    stopLevel = rejectionCandle.high;
  }

  if (!rejectionValid) {
    return {
      pattern_valid: false,
      reason: "WEAK_REJECTION",
      trend,
      structure_level: keyLevel
    };
  }

  // 4. CONTINUATION
  let continuationValid = false;
  let entryLevel = null;

  if (trend === "BUY") {
    continuationValid =
      isBullish(continuationCandle) &&
      continuationCandle.close > rejectionCandle.high &&
      bodySize(continuationCandle) >= avgBody * 0.8;
    entryLevel = continuationCandle.high;
  } else {
    continuationValid =
      isBearish(continuationCandle) &&
      continuationCandle.close < rejectionCandle.low &&
      bodySize(continuationCandle) >= avgBody * 0.8;
    entryLevel = continuationCandle.low;
  }

  if (!continuationValid) {
    return {
      pattern_valid: false,
      reason: "NO_CONTINUATION",
      trend,
      structure_level: keyLevel
    };
  }

  // 5. ATR sanity
  const currentAtr = atr(candles, 14);
  const lastPrice = candles[candles.length - 1].close;
  const volatility = currentAtr / lastPrice;

  if (volatility <= 0) {
    return {
      pattern_valid: false,
      reason: "VOLATILITY_INVALID",
      trend,
      structure_level: keyLevel
    };
  }

  return {
    pattern_valid: true,
    direction: trend,
    entry_level: entryLevel,
    stop_level: stopLevel,
    structure_level: keyLevel,
    meta: {
      emaSlope,
      avgBody,
      volatility,
      breakCandleTime: breakCandle.time,
      rejectionCandleTime: rejectionCandle.time,
      continuationCandleTime: continuationCandle.time
    }
  };
}

// ========================================
// EXECUTOR
// ========================================
function runExecutor(signal) {
  if (!signal || signal.pattern_valid !== true) {
    return {
      accepted: false,
      reason: "INVALID_SIGNAL"
    };
  }

  const { entry_level, stop_level, direction } = signal;
  const stop_distance = Math.abs(entry_level - stop_level);

  if (stop_distance <= 0) {
    return {
      accepted: false,
      reason: "INVALID_STOP_DISTANCE"
    };
  }

  const milestone = getMilestone(STATE.balance);
  const position_size = milestone.risk / stop_distance;
  const take_profit =
    direction === "BUY"
      ? entry_level + stop_distance
      : entry_level - stop_distance;

  return {
    accepted: true,
    milestoneLevel: milestone.level,
    risk_per_trade: milestone.risk,
    stop_distance,
    position_size,
    entry: entry_level,
    stop_loss: stop_level,
    take_profit,
    direction,
    status: STATE.mode === "SIM" ? "SIMULATED" : "LIVE_READY"
  };
}

// ========================================
// TRADE SIMULATION
// ========================================
function simulateTrade(exec, scout) {
  const win = Math.random() > 0.5;
  const exit = win ? exec.take_profit : exec.stop_loss;
  const pnl = calculatePnL(
    exec.entry,
    exit,
    exec.direction,
    exec.position_size
  );

  STATE.balance += pnl;

  const milestone = getMilestone(STATE.balance);
  STATE.milestoneLevel = milestone.level;
  STATE.riskPerTrade = milestone.risk;

  const trade = {
    id: String(Date.now()),
    timestamp: new Date().toISOString(),
    direction: exec.direction,
    entry: exec.entry,
    stop: exec.stop_loss,
    tp: exec.take_profit,
    result: win ? "WIN" : "LOSS",
    rMultiple: win ? 1 : -1,
    pnl,
    balance_after: STATE.balance,
    milestone_after: milestone.level,
    scoutSignal: scout
  };

  STATE.trades.unshift(trade);
  return trade;
}

// ========================================
// ENGINE
// ========================================
async function runEngine(pair = DEFAULT_PAIR, interval = DEFAULT_INTERVAL) {
  const candles = await getOHLC(pair, interval);
  const lastPrice = candles[candles.length - 1]?.close || null;

  const scout = runScout(candles);
  STATE.latestScout = scout;

  if (!scout.pattern_valid) {
    STATE.latestExecutor = null;
    return {
      engine: "BRC_TWO_AGENT",
      pair,
      price: lastPrice,
      scout,
      executor: null,
      runtime: {
        balance: STATE.balance,
        milestoneLevel: STATE.milestoneLevel,
        mode: STATE.mode
      },
      message: "NO VALID PATTERN"
    };
  }

  const executor = runExecutor(scout);
  STATE.latestExecutor = executor;

  if (!executor.accepted) {
    return {
      engine: "BRC_TWO_AGENT",
      pair,
      price: lastPrice,
      scout,
      executor,
      runtime: {
        balance: STATE.balance,
        milestoneLevel: STATE.milestoneLevel,
        mode: STATE.mode
      },
      message: "EXECUTION BLOCKED"
    };
  }

  let trade = null;

  if (STATE.mode === "SIM") {
    trade = simulateTrade(executor, scout);
  }

  if (STATE.mode === "LIVE") {
    const side = executor.direction === "BUY" ? "buy" : "sell";
    const liveOrder = await placeOrder({
      pair,
      side,
      volume: executor.position_size
    });

    trade = {
      id: String(Date.now()),
      timestamp: new Date().toISOString(),
      direction: executor.direction,
      entry: executor.entry,
      stop: executor.stop_loss,
      tp: executor.take_profit,
      result: "LIVE_SUBMITTED",
      rMultiple: 0,
      pnl: 0,
      balance_after: STATE.balance,
      milestone_after: STATE.milestoneLevel,
      txid: liveOrder?.result?.txid || null,
      rawOrder: liveOrder
    };

    STATE.trades.unshift(trade);
  }

  return {
    engine: "BRC_TWO_AGENT",
    pair,
    price: lastPrice,
    scout,
    executor,
    trade,
    runtime: {
      balance: STATE.balance,
      milestoneLevel: STATE.milestoneLevel,
      mode: STATE.mode
    }
  };
}

// ========================================
// ROUTES
// ========================================
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    mode: STATE.mode,
    engineStatus: "idle",
    balance: STATE.balance,
    milestoneLevel: STATE.milestoneLevel
  });
});

app.get("/api/kraken/test", async (req, res) => {
  try {
    const r = await fetch(`${KRAKEN}/0/public/Time`);
    const j = await r.json();
    res.json({
      success: true,
      serverTime: j.result.unixtime
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

app.get("/api/kraken/balance", (req, res) => {
  res.json({
    success: true,
    balances: {
      USD: Number(STATE.balance.toFixed(2))
    },
    mode: STATE.mode
  });
});

app.get("/api/dashboard", (req, res) => {
  res.json({
    balance: Number(STATE.balance.toFixed(2)),
    milestoneLevel: STATE.milestoneLevel,
    riskPerTrade: STATE.riskPerTrade,
    latestScout: STATE.latestScout,
    latestExecutor: STATE.latestExecutor,
    recentTrades: STATE.trades.slice(0, 20)
  });
});

app.post("/api/mode", (req, res) => {
  const mode = req.body.mode || "SIM";
  if (!["SIM", "LIVE"].includes(mode)) {
    return res.status(400).json({ success: false, error: "INVALID_MODE" });
  }
  STATE.mode = mode;
  res.json({ success: true, mode: STATE.mode });
});

app.post("/api/engine/execute", async (req, res) => {
  try {
    const pair = req.body.pair || DEFAULT_PAIR;
    const interval = Number(req.body.interval || DEFAULT_INTERVAL);
    const result = await runEngine(pair, interval);
    res.json(result);
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
});

app.post("/api/reset", (req, res) => {
  STATE = {
    mode: "SIM",
    balance: 5,
    milestoneLevel: 1,
    riskPerTrade: 0.1,
    latestScout: null,
    latestExecutor: null,
    trades: []
  };
  res.json({ success: true });
});

// ========================================
app.listen(PORT, () => {
  console.log(`🚀 BRC ENGINE LIVE ON ${PORT}`);
});
