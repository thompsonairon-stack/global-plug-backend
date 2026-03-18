require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT;
const KRAKEN_BASE = "https://api.kraken.com";

const VALID_MODES = ["SIM", "LIVE"];
const VALID_SYSTEMS = ["SYSTEM_1", "SYSTEM_2"];
const VALID_DECISIONS = [
  "EXECUTE_A",
  "EXECUTE_B",
  "BLOCK_C",
  "BLOCK_SAFETY",
  "BLOCK_REGIME",
  "BLOCK_EXEC_QUALITY",
];

let MODE = "LIVE";

let AGENTS = [];

let LOOP_STATE = {
  activeSystem: "SYSTEM_1",
  cycleProfit: 0,
  system1CompleteAt: 300,
  system2CompleteAt: 1000,
  lastSwitchAt: null,
};

let STATS = {
  balance: 50.0,
  equity: 50.0,
  pnl: 0,
  wins: 0,
  losses: 0,
  totalTrades: 0,
};

let TRADE_HISTORY = [];
let LATEST_ENGINE = null;

const SYSTEM_1_PROMPT = `
You are running GLOBAL PLUG TRADE SYSTEM_1.
Rules:
- deterministic
- trend-only
- no counter-trend
- no C-tier trades
- smaller milestone system
- more conservative
Return ONLY one valid token from:
EXECUTE_A
EXECUTE_B
BLOCK_C
BLOCK_SAFETY
BLOCK_REGIME
BLOCK_EXEC_QUALITY
`;

const SYSTEM_2_PROMPT = `
You are running GLOBAL PLUG TRADE SYSTEM_2.
Rules:
- deterministic
- trend-only
- no counter-trend
- no C-tier trades
- larger milestone ladder system
- stricter at larger size
Return ONLY one valid token from:
EXECUTE_A
EXECUTE_B
BLOCK_C
BLOCK_SAFETY
BLOCK_REGIME
BLOCK_EXEC_QUALITY
`;

function nowISO() {
  return new Date().toISOString();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getCycleTarget(systemId) {
  return systemId === "SYSTEM_1"
    ? LOOP_STATE.system1CompleteAt
    : LOOP_STATE.system2CompleteAt;
}

function calculateDrawdown() {
  if (STATS.equity <= 0) return 0;
  return Math.max(0, (STATS.equity - STATS.balance) / STATS.equity);
}

function calculatePnL(entry, exit, side, size) {
  if (side === "buy") return (exit - entry) * size;
  if (side === "sell") return (entry - exit) * size;
  return 0;
}

function makeSimExit(price) {
  return price * (1 + (Math.random() * 0.01 - 0.005));
}

function switchSystemIfNeeded() {
  if (
    LOOP_STATE.activeSystem === "SYSTEM_1" &&
    LOOP_STATE.cycleProfit >= LOOP_STATE.system1CompleteAt
  ) {
    LOOP_STATE.activeSystem = "SYSTEM_2";
    LOOP_STATE.cycleProfit = 0;
    LOOP_STATE.lastSwitchAt = nowISO();
    return true;
  }

  if (
    LOOP_STATE.activeSystem === "SYSTEM_2" &&
    LOOP_STATE.cycleProfit >= LOOP_STATE.system2CompleteAt
  ) {
    LOOP_STATE.activeSystem = "SYSTEM_1";
    LOOP_STATE.cycleProfit = 0;
    LOOP_STATE.lastSwitchAt = nowISO();
    return true;
  }

  return false;
}

function getSystemTradeSize(systemId) {
  const dd = calculateDrawdown();

  if (systemId === "SYSTEM_1") {
    let size = 2;
    if (LOOP_STATE.cycleProfit >= 300) size = 6;
    else if (LOOP_STATE.cycleProfit >= 150) size = 4;

    if (dd > 0.06) {
      if (size === 2) size = 1;
      if (size === 4) size = 2;
      if (size === 6) size = 3;
    }

    return size;
  }

  let size = 10;
  const p = LOOP_STATE.cycleProfit;

  if (p < 200) size = 10;
  else if (p < 400) size = 15;
  else if (p < 600) size = 20;
  else if (p < 800) size = 30;
  else if (p < 1000) size = 40;
  else if (p < 1200) size = 50;
  else if (p < 1400) size = 60;
  else if (p < 1600) size = 70;
  else if (p < 1800) size = 80;
  else if (p < 2000) size = 90;
  else if (p < 2200) size = 100;
  else if (p < 2600) size = 150;
  else if (p < 3000) size = 200;
  else if (p < 3600) size = 300;
  else if (p < 4200) size = 400;
  else if (p < 4800) size = 500;
  else if (p < 5400) size = 600;
  else if (p < 6000) size = 700;
  else if (p < 6600) size = 800;
  else if (p < 7200) size = 900;
  else size = 1000;

  const maxSafe = Math.max(1, STATS.balance * 5);
  if (size > maxSafe) size = maxSafe;

  if (dd > 0.06) {
    size = Math.max(1, Math.floor(size / 4));
  }

  return size;
}

function getKrakenSignature(path, request, secret, nonce) {
  const hash = crypto.createHash("sha256").update(nonce + request).digest();
  return crypto
    .createHmac("sha512", Buffer.from(secret, "base64"))
    .update(path + hash)
    .digest("base64");
}

async function krakenPrivate(path, params = {}) {
  const nonce = Date.now().toString();

  const body = new URLSearchParams({
    nonce,
    ...params,
  });

  const signature = getKrakenSignature(
    path,
    body.toString(),
    process.env.KRAKEN_API_SECRET,
    nonce
  );

  const res = await fetch(KRAKEN_BASE + path, {
    method: "POST",
    headers: {
      "API-Key": process.env.KRAKEN_API_KEY || "",
      "API-Sign": signature,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  return await res.json();
}

async function placeOrder({ pair, side, volume }) {
  return await krakenPrivate("/0/private/AddOrder", {
    pair,
    type: side,
    ordertype: "market",
    volume: String(volume),
  });
}

async function getRealBalance() {
  const json = await krakenPrivate("/0/private/Balance");

  if (json.error && json.error.length) {
    throw new Error(json.error.join(", "));
  }

  return json.result || {};
}

async function getTicker(pair) {
  const res = await fetch(`${KRAKEN_BASE}/0/public/Ticker?pair=${pair}`);
  const json = await res.json();

  if (json.error && json.error.length) {
    throw new Error(json.error.join(", "));
  }

  const key = Object.keys(json.result)[0];
  const row = json.result[key];

  return {
    pair,
    price: num(row.c[0]),
    ask: num(row.a[0]),
    bid: num(row.b[0]),
    high: num(row.h[1]),
    low: num(row.l[1]),
    volume: num(row.v[1]),
  };
}

async function runAgent(model, pair, price, systemId, systemSize) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY_MISSING");
  }

  const systemPrompt =
    systemId === "SYSTEM_1" ? SYSTEM_1_PROMPT : SYSTEM_2_PROMPT;

  const prompt = `
${systemPrompt}

Context:
- pair: ${pair}
- price: ${price}
- activeSystem: ${systemId}
- systemTradeSize: ${systemSize}

Return ONLY one valid decision token.
`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content?.trim() || "BLOCK_SAFETY";

  return VALID_DECISIONS.includes(raw) ? raw : "BLOCK_SAFETY";
}

app.get("/", (req, res) => {
  res.send("Global Plug Backend Live");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    mode: MODE,
    activeSystem: LOOP_STATE.activeSystem,
    cycleProfit: LOOP_STATE.cycleProfit,
    cycleTarget: getCycleTarget(LOOP_STATE.activeSystem),
    lastSwitchAt: LOOP_STATE.lastSwitchAt,
    balance: STATS.balance,
  });
});

app.post("/api/mode", (req, res) => {
  const newMode = req.body.mode;

  if (!VALID_MODES.includes(newMode)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_MODE",
    });
  }

  if (
    newMode === "LIVE" &&
    (!process.env.KRAKEN_API_KEY ||
      !process.env.KRAKEN_API_SECRET ||
      !process.env.OPENROUTER_API_KEY)
  ) {
    return res.status(400).json({
      success: false,
      error: "LIVE_KEYS_MISSING",
    });
  }

  MODE = newMode;

  res.json({
    success: true,
    mode: MODE,
  });
});

app.post("/api/system", (req, res) => {
  const { system } = req.body;

  if (!VALID_SYSTEMS.includes(system)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_SYSTEM",
    });
  }

  LOOP_STATE.activeSystem = system;
  LOOP_STATE.cycleProfit = 0;
  LOOP_STATE.lastSwitchAt = nowISO();

  res.json({
    success: true,
    activeSystem: LOOP_STATE.activeSystem,
  });
});

app.post("/api/agents", (req, res) => {
  const { agents } = req.body;

  if (!Array.isArray(agents) || !agents.length) {
    return res.status(400).json({
      success: false,
      error: "INVALID_AGENTS",
    });
  }

  AGENTS = agents;

  res.json({
    success: true,
    agents: AGENTS,
  });
});

app.get("/api/kraken/test", async (req, res) => {
  try {
    const r = await fetch(`${KRAKEN_BASE}/0/public/Time`);
    const j = await r.json();

    res.json({
      success: true,
      serverTime: j.result.unixtime,
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

app.get("/api/kraken/price/:pair", async (req, res) => {
  try {
    const ticker = await getTicker(req.params.pair);
    res.json({
      success: true,
      ...ticker,
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

app.get("/api/kraken/balance", async (req, res) => {
  try {
    if (
      MODE === "SIM" ||
      !process.env.KRAKEN_API_KEY ||
      !process.env.KRAKEN_API_SECRET
    ) {
      return res.json({
        success: true,
        balances: {
          USD: Number(STATS.balance.toFixed(2)),
        },
        mode: "SIM",
      });
    }

    const balances = await getRealBalance();

    res.json({
      success: true,
      balances,
      mode: "LIVE",
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

app.get("/api/dashboard", (req, res) => {
  res.json({
    success: true,
    stats: STATS,
    loop: {
      activeSystem: LOOP_STATE.activeSystem,
      cycleProfit: LOOP_STATE.cycleProfit,
      cycleTarget: getCycleTarget(LOOP_STATE.activeSystem),
      lastSwitchAt: LOOP_STATE.lastSwitchAt,
    },
    latestEngine: LATEST_ENGINE,
    agents: AGENTS,
    recentTrades: TRADE_HISTORY.slice(0, 20),
  });
});

app.post("/api/engine/execute", async (req, res) => {
  try {
    const pair = req.body.pair;
    const agents =
      Array.isArray(req.body.agents) && req.body.agents.length
        ? req.body.agents
        : AGENTS;

    if (!pair) {
      return res.status(400).json({
        success: false,
        error: "PAIR_REQUIRED",
      });
    }

    if (!Array.isArray(agents) || !agents.length) {
      return res.status(400).json({
        success: false,
        error: "NO_AGENTS",
      });
    }

    const systemId = getActiveSystem();
    const systemSize = getSystemTradeSize(systemId);
    const ticker = await getTicker(pair);
    const price = ticker.price;

    const results = [];
    const executions = [];

    for (const agent of agents) {
      const agentName = agent.name || agent.id || "agent";
      const model = agent.model;
      const side = agent.side || "buy";
      const size = num(agent.size, 0.001);

      if (!model) {
        results.push({
          agent: agentName,
          model: null,
          system: systemId,
          decision: "BLOCK_SAFETY",
          error: "MODEL_REQUIRED",
        });
        continue;
      }

      const decision = await runAgent(model, pair, price, systemId, systemSize);

      results.push({
        agent: agentName,
        model,
        system: systemId,
        decision,
        systemSize,
      });

      if (decision === "EXECUTE_A" || decision === "EXECUTE_B") {
        if (MODE === "SIM") {
          const fakeExit = makeSimExit(price);
          const pnl = calculatePnL(price, fakeExit, side, size);

          STATS.pnl += pnl;
          STATS.equity += pnl;
          STATS.balance += pnl;
          STATS.totalTrades++;
          LOOP_STATE.cycleProfit += pnl;

          if (pnl > 0) STATS.wins++;
          else STATS.losses++;

          TRADE_HISTORY.unshift({
            agent: agentName,
            model,
            system: systemId,
            pair,
            side,
            size,
            systemSize,
            entry: price,
            exit: fakeExit,
            pnl,
            mode: "SIM",
            txid: null,
            rawOrder: null,
            time: nowISO(),
          });

          executions.push({
            agent: agentName,
            system: systemId,
            status: "SIMULATED",
            pnl,
          });
        }

        if (MODE === "LIVE") {
          const order = await placeOrder({
            pair,
            side,
            volume: size,
          });

          TRADE_HISTORY.unshift({
            agent: agentName,
            model,
            system: systemId,
            pair,
            side,
            size,
            systemSize,
            entry: price,
            exit: null,
            pnl: 0,
            mode: "LIVE",
            txid: order?.result?.txid || null,
            rawOrder: order,
            time: nowISO(),
          });

          STATS.totalTrades++;

          executions.push({
            agent: agentName,
            system: systemId,
            status: "LIVE_EXECUTED",
            txid: order?.result?.txid || null,
            order,
          });
        }
      }
    }

    const before = LOOP_STATE.activeSystem;
    const switched = switchSystemIfNeeded();
    const after = LOOP_STATE.activeSystem;

    LATEST_ENGINE = {
      time: nowISO(),
      pair,
      price,
      mode: MODE,
      activeSystem: before,
      switched,
      nextSystem: after,
      cycleProfit: LOOP_STATE.cycleProfit,
      cycleTarget: getCycleTarget(after),
      results,
      executions,
    };

    res.json({
      success: true,
      pair,
      price,
      mode: MODE,
      activeSystem: before,
      switched,
      nextSystem: after,
      cycleProfit: LOOP_STATE.cycleProfit,
      cycleTarget: getCycleTarget(after),
      results,
      executions,
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

app.post("/api/reset", (req, res) => {
  MODE = "LIVE";
  AGENTS = [];
  TRADE_HISTORY = [];
  LATEST_ENGINE = null;

  LOOP_STATE = {
    activeSystem: "SYSTEM_1",
    cycleProfit: 0,
    system1CompleteAt: 300,
    system2CompleteAt: 1000,
    lastSwitchAt: null,
  };

  STATS = {
    balance: 50.0,
    equity: 50.0,
    pnl: 0,
    wins: 0,
    losses: 0,
    totalTrades: 0,
  };

  res.json({
    success: true,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Running on port ${PORT}`);
});
