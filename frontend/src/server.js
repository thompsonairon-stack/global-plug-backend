// ================================
// GLOBAL PLUG 3.0 — CLEAN SERVER
// ================================

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ================================
// CONFIG
// ================================

const PORT = process.env.PORT || 3001;
const KRAKEN_BASE = "https://api.kraken.com";

// ================================
// STATE
// ================================

let MODE = "SIM"; // SIM or LIVE
let SYSTEM = {
  name: "GLOBAL_PLUG",
  version: "3.0",
};

// ================================
// HEALTH
// ================================

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    mode: MODE,
    system: SYSTEM,
  });
});

// ================================
// KRAKEN TEST
// ================================

app.get("/api/kraken/test", async (req, res) => {
  try {
    const r = await fetch(`${KRAKEN_BASE}/0/public/Time`);
    const j = await r.json();

    res.json({
      success: true,
      serverTime: j.result.unixtime,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ================================
// KRAKEN BALANCE (SIM FOR NOW)
// ================================

app.get("/api/kraken/balance", (req, res) => {
  res.json({
    success: true,
    balances: {
      USD: 1000,
      BTC: 0.05,
      ETH: 1.2,
    },
    mode: MODE,
  });
});

// ================================
// ENGINE (ANY AGENTS)
// ================================

app.post("/api/engine/execute", async (req, res) => {
  try {
    const { pair = "XXBTZUSD", agents = [] } = req.body;

    // =========================
    // GET MARKET DATA
    // =========================
    const r = await fetch(
      `${KRAKEN_BASE}/0/public/Ticker?pair=${pair}`
    );
    const j = await r.json();

    const key = Object.keys(j.result)[0];
    const price = Number(j.result[key].c[0]);

    // =========================
    // PROCESS AGENTS
    // =========================
    let decisions = [];
    let executions = [];

    for (let agent of agents) {
      const decision = {
        name: agent.name || "agent",
        decision: agent.decision || "NO_TRADE",
        side: agent.side || null,
        size: agent.size || 0,
      };

      decisions.push(decision);

      // EXECUTION LOGIC
      if (decision.decision === "EXECUTE") {
        executions.push({
          agent: decision.name,
          pair,
          side: decision.side,
          size: decision.size,
          price,
          status: MODE === "LIVE" ? "LIVE_ORDER" : "SIM_ORDER",
        });
      }
    }

    res.json({
      success: true,
      pair,
      price,
      mode: MODE,
      decisions,
      executions,
      totalAgents: agents.length,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ================================
// MODE SWITCH
// ================================

app.post("/api/mode", (req, res) => {
  const { mode } = req.body;

  if (!mode) {
    return res.status(400).json({
      success: false,
      error: "MODE_REQUIRED",
    });
  }

  MODE = mode;

  res.json({
    success: true,
    mode: MODE,
  });
});

// ================================
// SYSTEM UPDATE
// ================================

app.post("/api/system", (req, res) => {
  SYSTEM = { ...SYSTEM, ...req.body };

  res.json({
    success: true,
    system: SYSTEM,
  });
});

// ================================
// START SERVER
// ================================

app.listen(PORT, () => {
  console.log(`🚀 GLOBAL PLUG RUNNING ON PORT ${PORT}`);
});
