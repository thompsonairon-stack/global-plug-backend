const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const KRAKEN = "https://api.kraken.com";

// =======================
// MODE (DEFAULT SAFE)
// =======================
let MODE = "SIM";

// =======================
// MEMORY
// =======================
let TRADE_HISTORY = [];
let STATS = {
  balance: 10000,
  equity: 10000,
  pnl: 0,
  wins: 0,
  losses: 0,
  totalTrades: 0
};

// =======================
// HEALTH
// =======================
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    mode: MODE
  });
});

// =======================
// MODE SWITCH (FRONTEND)
// =======================
app.post("/api/mode", (req, res) => {
  const newMode = req.body.mode;

  if (!["SIM", "LIVE"].includes(newMode)) {
    return res.status(400).json({ error: "INVALID_MODE" });
  }

  MODE = newMode;

  res.json({
    success: true,
    mode: MODE
  });
});

// =======================
// KRAKEN TEST
// =======================
app.get("/api/kraken/test", async (req, res) => {
  try {
    const r = await fetch(`${KRAKEN}/0/public/Time`);
    const j = await r.json();
    res.json({ success: true, time: j.result.unixtime });
  } catch {
    res.status(500).json({ success: false });
  }
});

// =======================
// KRAKEN SIGNATURE
// =======================
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

// =======================
// PLACE ORDER (LIVE)
// =======================
async function placeOrder({ pair, side, volume }) {
  const path = "/0/private/AddOrder";
  const nonce = Date.now().toString();

  const params = new URLSearchParams({
    nonce,
    pair,
    type: side,
    ordertype: "market",
    volume: volume.toString()
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

// =======================
// GET PRICE
// =======================
async function getPrice(pair) {
  const r = await fetch(`${KRAKEN}/0/public/Ticker?pair=${pair}`);
  const j = await r.json();
  const key = Object.keys(j.result)[0];
  return Number(j.result[key].c[0]);
}

// =======================
// OPENROUTER AGENT
// =======================
async function runAgent(model, pair, price) {
  const prompt = `
You are a trading agent.

Pair: ${pair}
Price: ${price}

Return ONLY:
EXECUTE_A or EXECUTE_B or BLOCK
`;

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const j = await r.json();

  return j.choices?.[0]?.message?.content?.trim() || "BLOCK";
}

// =======================
// PNL
// =======================
function calculatePnL(entry, exit, side, size) {
  if (side === "buy") return (exit - entry) * size;
  if (side === "sell") return (entry - exit) * size;
  return 0;
}

// =======================
// ENGINE
// =======================
app.post("/api/engine/execute", async (req, res) => {
  try {
    const pair = req.body.pair || "XXBTZUSD";
    const agents = req.body.agents || [];

    if (!agents.length) {
      return res.status(400).json({ error: "NO_AGENTS" });
    }

    const price = await getPrice(pair);

    let results = [];
    let executions = [];

    for (let agent of agents) {
      const decision = await runAgent(agent.model, pair, price);

      results.push({
        agent: agent.name,
        model: agent.model,
        decision
      });

      if (decision === "EXECUTE_A" || decision === "EXECUTE_B") {
        const side = "buy";
        const size = 0.001;

        // =======================
        // SIM MODE
        // =======================
        if (MODE === "SIM") {
          const fakeExit = price * (1 + (Math.random() * 0.01 - 0.005));
          const pnl = calculatePnL(price, fakeExit, side, size);

          STATS.pnl += pnl;
          STATS.equity += pnl;
          STATS.totalTrades++;

          if (pnl > 0) STATS.wins++;
          else STATS.losses++;

          TRADE_HISTORY.unshift({
            agent: agent.name,
            pair,
            side,
            entry: price,
            exit: fakeExit,
            pnl,
            mode: "SIM",
            time: new Date().toISOString()
          });

          executions.push({
            agent: agent.name,
            status: "SIMULATED",
            pnl
          });
        }

        // =======================
        // LIVE MODE
        // =======================
        if (MODE === "LIVE") {
          const order = await placeOrder({
            pair,
            side,
            volume: size
          });

          TRADE_HISTORY.unshift({
            agent: agent.name,
            pair,
            side,
            entry: price,
            pnl: 0,
            mode: "LIVE",
            txid: order?.result?.txid || null,
            time: new Date().toISOString()
          });

          STATS.totalTrades++;

          executions.push({
            agent: agent.name,
            status: "LIVE_EXECUTED",
            order
          });
        }
      }
    }

    res.json({
      success: true,
      pair,
      price,
      mode: MODE,
      results,
      executions
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =======================
// DASHBOARD
// =======================
app.get("/api/dashboard", (req, res) => {
  res.json({
    stats: STATS,
    trades: TRADE_HISTORY.slice(0, 20)
  });
});

// =======================
// RESET
// =======================
app.post("/api/reset", (req, res) => {
  TRADE_HISTORY = [];
  STATS = {
    balance: 10000,
    equity: 10000,
    pnl: 0,
    wins: 0,
    losses: 0,
    totalTrades: 0
  };

  res.json({ success: true });
});

// =======================
app.listen(PORT, () => {
  console.log("🚀 GLOBAL PLUG LIVE:", PORT);
});
