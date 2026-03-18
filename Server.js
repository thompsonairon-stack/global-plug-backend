const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ==========================
// GLOBAL STATE
// ==========================
let STATE = {
  mode: "SIM", // SIM | LIVE
  systemIndex: 0,
  balance: 200,
  profit: 0,
  agents: [],
  trades: []
};

// ==========================
// SYSTEMS (YOUR REAL FLOW)
// ==========================
const SYSTEMS = [
  { id: "v2.1.1", target: 300 },
  { id: "v4.1", target: 1000 }
];

// ==========================
// SWITCH SYSTEM LOOP
// ==========================
function switchSystem() {
  STATE.systemIndex = (STATE.systemIndex + 1) % SYSTEMS.length;
  STATE.profit = 0;
}

// ==========================
// SIMPLE REAL DECISION (NO RANDOM)
// Replace later with your real logic
// ==========================
function getDecision(price) {
  if (!price) return "BLOCK";

  // simple trend logic placeholder
  return price % 2 === 0 ? "EXECUTE_A" : "BLOCK";
}

// ==========================
// KRAKEN SIGNING
// ==========================
function getSignature(path, request, secret, nonce) {
  const hash = crypto
    .createHash("sha256")
    .update(nonce + request)
    .digest();

  return crypto
    .createHmac("sha512", Buffer.from(secret, "base64"))
    .update(path + hash)
    .digest("base64");
}

// ==========================
// GET PRICE
// ==========================
async function getPrice(pair) {
  const r = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
  const j = await r.json();
  const key = Object.keys(j.result)[0];
  return Number(j.result[key].c[0]);
}

// ==========================
// EXECUTE TRADE (SIM + LIVE)
// ==========================
async function executeTrade({ pair, side, size }) {
  // SIM MODE
  if (STATE.mode === "SIM") {
    const win = Math.random() > 0.5;
    const pnl = win ? size : -size;

    STATE.balance += pnl;
    STATE.profit += pnl;

    return {
      type: "SIM",
      result: win ? "WIN" : "LOSS",
      pnl
    };
  }

  // LIVE MODE
  const path = "/0/private/AddOrder";
  const nonce = Date.now().toString();

  const params = new URLSearchParams({
    nonce,
    pair,
    type: side,
    ordertype: "market",
    volume: size.toString()
  });

  const signature = getSignature(
    path,
    params.toString(),
    process.env.KRAKEN_API_SECRET,
    nonce
  );

  const res = await fetch("https://api.kraken.com" + path, {
    method: "POST",
    headers: {
      "API-Key": process.env.KRAKEN_API_KEY,
      "API-Sign": signature,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const data = await res.json();

  return {
    type: "LIVE",
    kraken: data
  };
}

// ==========================
// ENGINE LOOP
// ==========================
async function runEngine(pair = "XXBTZUSD") {
  const price = await getPrice(pair);
  const system = SYSTEMS[STATE.systemIndex];

  const results = [];

  for (const agent of STATE.agents) {
    const decision = getDecision(price);

    if (decision === "EXECUTE_A") {
      const trade = await executeTrade({
        pair,
        side: "buy",
        size: 0.001
      });

      results.push({
        agent: agent.model,
        decision,
        trade
      });
    } else {
      results.push({
        agent: agent.model,
        decision: "BLOCK"
      });
    }
  }

  // CHECK SYSTEM COMPLETION
  if (STATE.profit >= system.target) {
    switchSystem();
  }

  return {
    system: system.id,
    mode: STATE.mode,
    price,
    results,
    balance: STATE.balance,
    profit: STATE.profit
  };
}

// ==========================
// ROUTES
// ==========================

// HEALTH
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    system: SYSTEMS[STATE.systemIndex].id,
    mode: STATE.mode,
    balance: STATE.balance
  });
});

// EXECUTE
app.post("/api/engine/execute", async (req, res) => {
  const result = await runEngine(req.body.pair);
  res.json(result);
});

// MODE
app.post("/api/mode", (req, res) => {
  STATE.mode = req.body.mode || "SIM";
  res.json({ mode: STATE.mode });
});

// SET AGENTS
app.post("/api/agents", (req, res) => {
  STATE.agents = req.body.agents;
  res.json({ agents: STATE.agents });
});

// DASHBOARD
app.get("/api/dashboard", (req, res) => {
  res.json({
    balance: STATE.balance,
    profit: STATE.profit,
    system: SYSTEMS[STATE.systemIndex].id,
    mode: STATE.mode
  });
});

// ==========================
app.listen(PORT, () => {
  console.log("🚀 GLOBAL PLUG LIVE ENGINE RUNNING");
});
