const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// =============================
// GLOBAL STATE
// =============================
let STATE = {
  mode: "SIM",
  balance: 5,
  milestoneLevel: 1,
  riskPerTrade: 0.10,
  latestScout: null,
  latestExecutor: null,
  trades: []
};

// =============================
// MILESTONE ENGINE
// =============================
function getMilestone(balance) {
  if (balance < 10) return { level: 1, risk: 0.10 };
  if (balance < 20) return { level: 2, risk: 0.20 };
  if (balance < 40) return { level: 3, risk: 0.30 };
  if (balance < 70) return { level: 4, risk: 0.50 };
  return { level: 5, risk: 0.75 };
}

// =============================
// SCOUT (BRC DETECTOR)
// =============================
function runScout(price) {
  // 🔥 placeholder logic (replace later with full EMA/BRC logic)
  const pattern_valid = price > 50000;

  if (!pattern_valid) {
    return { pattern_valid: false };
  }

  return {
    pattern_valid: true,
    direction: "BUY",
    entry_level: price,
    stop_level: price - 100,
    structure_level: price - 50
  };
}

// =============================
// EXECUTOR
// =============================
function runExecutor(signal) {
  if (!signal || signal.pattern_valid !== true) {
    return { accepted: false, reason: "INVALID_SIGNAL" };
  }

  const { entry_level, stop_level, direction } = signal;

  const stop_distance = Math.abs(entry_level - stop_level);

  if (stop_distance <= 0) {
    return { accepted: false, reason: "INVALID_STOP_DISTANCE" };
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

// =============================
// SIMULATE TRADE
// =============================
function simulateTrade(exec) {
  const win = Math.random() > 0.5;
  const pnl = win ? exec.risk_per_trade : -exec.risk_per_trade;

  STATE.balance += pnl;

  const milestone = getMilestone(STATE.balance);
  STATE.milestoneLevel = milestone.level;
  STATE.riskPerTrade = milestone.risk;

  const trade = {
    time: new Date().toISOString(),
    result: win ? "WIN" : "LOSS",
    pnl,
    balance: STATE.balance,
    ...exec
  };

  STATE.trades.unshift(trade);

  return trade;
}

// =============================
// GET PRICE (KRAKEN)
// =============================
async function getPrice(pair = "XXBTZUSD") {
  const r = await fetch(
    `https://api.kraken.com/0/public/Ticker?pair=${pair}`
  );
  const j = await r.json();
  const key = Object.keys(j.result)[0];
  return Number(j.result[key].c[0]);
}

// =============================
// ENGINE RUN
// =============================
async function runEngine() {
  const price = await getPrice();

  // SCOUT
  const scout = runScout(price);
  STATE.latestScout = scout;

  if (!scout.pattern_valid) {
    STATE.latestExecutor = null;
    return {
      scout,
      executor: null,
      message: "NO VALID PATTERN"
    };
  }

  // EXECUTOR
  const executor = runExecutor(scout);
  STATE.latestExecutor = executor;

  if (!executor.accepted) {
    return {
      scout,
      executor,
      message: "EXECUTION BLOCKED"
    };
  }

  // SIM MODE
  let trade = null;

  if (STATE.mode === "SIM") {
    trade = simulateTrade(executor);
  }

  return {
    scout,
    executor,
    trade,
    balance: STATE.balance,
    milestoneLevel: STATE.milestoneLevel
  };
}

// =============================
// ROUTES
// =============================

// HEALTH
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    mode: STATE.mode,
    balance: STATE.balance,
    milestone: STATE.milestoneLevel
  });
});

// EXECUTE ENGINE
app.post("/api/engine/execute", async (req, res) => {
  const result = await runEngine();
  res.json(result);
});

// MODE SWITCH
app.post("/api/mode", (req, res) => {
  STATE.mode = req.body.mode || "SIM";
  res.json({ mode: STATE.mode });
});

// DASHBOARD
app.get("/api/dashboard", (req, res) => {
  res.json({
    balance: STATE.balance,
    milestone: STATE.milestoneLevel,
    risk: STATE.riskPerTrade,
    latestScout: STATE.latestScout,
    latestExecutor: STATE.latestExecutor,
    trades: STATE.trades.slice(0, 20)
  });
});

// RESET
app.post("/api/reset", (req, res) => {
  STATE = {
    mode: "SIM",
    balance: 5,
    milestoneLevel: 1,
    riskPerTrade: 0.10,
    latestScout: null,
    latestExecutor: null,
    trades: []
  };
  res.json({ success: true });
});

// =============================
app.listen(PORT, () => {
  console.log("🚀 BRC ENGINE LIVE:", PORT);
});
