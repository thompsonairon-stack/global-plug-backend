const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

// ==============================
// GLOBAL STATE
// ==============================

let MODE = "SIM"; // SIM or LIVE

let activeSystem = "SYSTEM_1";

let state = {
  profit: 0,
  tradeSize: 2,
  drawdown: 0,
  milestone: 0
};

// YOU CONTROL AGENTS HERE (ANY MODEL)
let agents = [
  { id: "agent_1", model: "openai/gpt-4o" },
  { id: "agent_2", model: "google/gemini-1.5-flash" }
];

// ==============================
// SYSTEM SWITCH LOGIC
// ==============================

function checkMilestoneAndSwitch() {
  if (activeSystem === "SYSTEM_1" && state.profit >= 300) {
    activeSystem = "SYSTEM_2";
    console.log("➡️ SWITCHED TO SYSTEM 2");
  }

  else if (activeSystem === "SYSTEM_2" && state.profit >= 1000) {
    activeSystem = "SYSTEM_1";
    state.profit = 0; // reset cycle
    console.log("🔁 RESET BACK TO SYSTEM 1");
  }
}

// ==============================
// SYSTEM 1 (v2.1.1 SIMPLIFIED CORE)
// ==============================

function system1Logic(price) {
  let decision = price > 50000 ? "EXECUTE_A" : "BLOCK_C";

  return {
    minimax: { decision, size: state.tradeSize },
    flash: { decision, size: state.tradeSize }
  };
}

// ==============================
// SYSTEM 2 (v4.1 LADDER CORE)
// ==============================

function system2Logic(price) {

  // ladder sizing
  let p = state.profit;

  if (p < 200) state.tradeSize = 10;
  else if (p < 400) state.tradeSize = 15;
  else if (p < 600) state.tradeSize = 20;
  else if (p < 1000) state.tradeSize = 40;
  else state.tradeSize = 100;

  let decision = price > 50000 ? "EXECUTE_A" : "BLOCK_REGIME";

  return {
    minimax: { decision, size: state.tradeSize },
    flash: { decision, size: state.tradeSize }
  };
}

// ==============================
// ENGINE RUN
// ==============================

async function runEngine() {
  const r = await fetch("https://api.kraken.com/0/public/Ticker?pair=XXBTZUSD");
  const j = await r.json();

  const price = Number(Object.values(j.result)[0].c[0]);

  let result;

  if (activeSystem === "SYSTEM_1") {
    result = system1Logic(price);
  } else {
    result = system2Logic(price);
  }

  // simulate profit
  if (result.minimax.decision.startsWith("EXECUTE")) {
    state.profit += 10;
  }

  if (result.flash.decision.startsWith("EXECUTE")) {
    state.profit += 10;
  }

  checkMilestoneAndSwitch();

  return {
    system: activeSystem,
    price,
    profit: state.profit,
    tradeSize: state.tradeSize,
    agents: result
  };
}

// ==============================
// ROUTES
// ==============================

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    system: activeSystem,
    mode: MODE
  });
});

app.get("/api/kraken/test", async (req, res) => {
  try {
    const r = await fetch("https://api.kraken.com/0/public/Time");
    const j = await r.json();
    res.json({ success: true, time: j.result.unixtime });
  } catch {
    res.json({ success: false });
  }
});

app.get("/api/kraken/balance", (req, res) => {
  res.json({
    USD: 10000,
    BTC: 0.1,
    mode: MODE
  });
});

app.post("/api/engine/execute", async (req, res) => {
  const data = await runEngine();
  res.json(data);
});

// ==============================
// MODE SWITCH
// ==============================

app.post("/api/mode", (req, res) => {
  MODE = req.body.mode || "SIM";
  res.json({ mode: MODE });
});

// ==============================
// AGENT SWITCH (ANY MODEL)
// ==============================

app.post("/api/agents", (req, res) => {
  agents = req.body.agents || agents;
  res.json({ agents });
});

// ==============================
// START SERVER
// ==============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 GLOBAL PLUG LIVE ON", PORT);
});
