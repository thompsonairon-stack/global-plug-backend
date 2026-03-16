const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fetch = require("node-fetch");
const crypto = require("crypto");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

/*
==================================
GLOBAL SETTINGS
- ONLY TWO MODES:
  SIM
  LIVE
- SWITCH MODE INCLUDED
- NO GOVERNOR
- NO RESTRICTIONS
==================================
*/

let MODE = "SIM";
let ACTIVE_SYSTEM = "SYSTEM_ONE";

/*
==================================
KRAKEN HELPERS
==================================
*/

const API_BASE = "https://api.kraken.com";

function getKrakenEnv() {
  const apiKey = process.env.KRAKEN_API_KEY || "";
  const apiSecret = process.env.KRAKEN_API_SECRET || "";

  if (!apiKey || !apiSecret) {
    throw new Error("Missing Kraken API keys");
  }

  return { apiKey, apiSecret };
}

function buildSignature(path, body, secret) {
  const nonce = String(body.nonce);
  const postData = new URLSearchParams(body).toString();

  const sha256 = crypto
    .createHash("sha256")
    .update(Buffer.concat([Buffer.from(nonce), Buffer.from(postData)]))
    .digest();

  return crypto
    .createHmac("sha512", Buffer.from(secret, "base64"))
    .update(Buffer.concat([Buffer.from(path), sha256]))
    .digest("base64");
}

async function privateKraken(method, params = {}) {
  const { apiKey, apiSecret } = getKrakenEnv();

  const path = `/0/private/${method}`;
  const body = {
    nonce: Date.now().toString(),
    ...params
  };

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "API-Key": apiKey,
      "API-Sign": buildSignature(path, body, apiSecret),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body).toString()
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(`Kraken HTTP ${response.status}`);
  }

  if (json.error && json.error.length) {
    throw new Error(json.error.join(", "));
  }

  return json.result;
}

async function publicKraken(path, query = {}) {
  const url = new URL(`${API_BASE}${path}`);

  Object.entries(query).forEach(([k, v]) => {
    url.searchParams.set(k, String(v));
  });

  const response = await fetch(url.toString());
  const json = await response.json();

  if (!response.ok) {
    throw new Error(`Kraken HTTP ${response.status}`);
  }

  if (json.error && json.error.length) {
    throw new Error(json.error.join(", "));
  }

  return json.result;
}

async function getTicker(pair = "XXBTZUSD") {
  const result = await publicKraken("/0/public/Ticker", { pair });
  const key = Object.keys(result)[0];

  return {
    pair,
    last: Number(result[key].c[0]),
    ask: Number(result[key].a[0]),
    bid: Number(result[key].b[0])
  };
}

async function getBalance() {
  return privateKraken("Balance");
}

async function placeOrder(pair, side, size) {
  if (!pair) throw new Error("Missing pair");
  if (!side) throw new Error("Missing side");
  if (!size || Number(size) <= 0) throw new Error("Invalid size");

  return privateKraken("AddOrder", {
    pair,
    type: side,
    ordertype: "market",
    volume: String(size)
  });
}

/*
==================================
SYSTEMS
MINIMAX + FLASH STAY INDEPENDENT
==================================
*/

function systemOne(market) {
  return {
    milestone: market.ticker?.last > 50000 ? "RUNNING" : "WAITING",

    minimax: {
      decision: "EXECUTE_A",
      side: "buy",
      size: 0.001,
      reason: "System One MINIMAX signal"
    },

    flash: {
      decision: "NO_TRADE",
      side: null,
      size: 0,
      reason: "System One FLASH no-trade"
    }
  };
}

function systemTwo(market) {
  return {
    milestone: "ACTIVE",

    minimax: {
      decision: "NO_TRADE",
      side: null,
      size: 0,
      reason: "System Two MINIMAX no-trade"
    },

    flash: {
      decision: "EXECUTE_B",
      side: "sell",
      size: 0.001,
      reason: "System Two FLASH signal"
    }
  };
}

/*
==================================
EXECUTION HELPERS
==================================
*/

function shouldExecute(agent) {
  return agent && ["EXECUTE_A", "EXECUTE_B", "BUY", "SELL"].includes(agent.decision);
}

async function executeAgent(agentName, pair, agent) {
  if (!shouldExecute(agent) || !agent.side || !agent.size) {
    return {
      success: true,
      agent: agentName,
      executed: false,
      simulated: MODE === "SIM",
      decision: agent?.decision || "NO_TRADE",
      side: agent?.side || null,
      size: agent?.size || 0,
      reason: agent?.reason || "No trade"
    };
  }

  if (MODE === "SIM") {
    return {
      success: true,
      agent: agentName,
      executed: false,
      simulated: true,
      decision: agent.decision,
      side: agent.side,
      size: agent.size,
      reason: "Simulated only"
    };
  }

  const order = await placeOrder(pair, agent.side, agent.size);

  return {
    success: true,
    agent: agentName,
    executed: true,
    simulated: false,
    decision: agent.decision,
    side: agent.side,
    size: agent.size,
    txid: order.txid || [],
    raw: order
  };
}

/*
==================================
ROUTES
KEEP THESE WORKING
==================================
*/

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "online",
    mode: MODE,
    system: ACTIVE_SYSTEM,
    service: "global-plug-backend"
  });
});

app.get("/api/kraken/test", async (req, res) => {
  try {
    const publicTime = await publicKraken("/0/public/Time");

    let keysPresent = !!process.env.KRAKEN_API_KEY && !!process.env.KRAKEN_API_SECRET;
    let privateReady = false;

    if (keysPresent && MODE === "LIVE") {
      await getBalance();
      privateReady = true;
    }

    res.json({
      success: true,
      exchange: "kraken",
      mode: MODE,
      keysPresent,
      privateReady,
      serverTime: publicTime.unixtime,
      message: "Kraken API connection working"
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      exchange: "kraken",
      mode: MODE,
      error: e.message
    });
  }
});

app.get("/api/kraken/balance", async (req, res) => {
  try {
    if (MODE === "SIM") {
      return res.json({
        success: true,
        mode: "SIM",
        balances: {
          USD: 10000,
          BTC: 0.25
        }
      });
    }

    const balances = await getBalance();

    res.json({
      success: true,
      mode: "LIVE",
      balances
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      mode: MODE,
      error: e.message
    });
  }
});

app.post("/api/engine/execute", async (req, res) => {
  try {
    const pair = req.body?.pair || "XXBTZUSD";
    const ticker = await getTicker(pair);

    const logic =
      ACTIVE_SYSTEM === "SYSTEM_ONE"
        ? systemOne({ ticker })
        : systemTwo({ ticker });

    const minimaxResult = await executeAgent("MINIMAX", pair, logic.minimax);
    const flashResult = await executeAgent("FLASH", pair, logic.flash);

    res.json({
      success: true,
      mode: MODE,
      system: ACTIVE_SYSTEM,
      pair,
      market: ticker,
      milestone: logic.milestone,
      minimax: logic.minimax,
      flash: logic.flash,
      executions: {
        minimax: minimaxResult,
        flash: flashResult
      }
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      mode: MODE,
      error: e.message
    });
  }
});

/*
==================================
SWITCH MODE ROUTE
PUTS MODE ON SERVER
POST /api/mode
BODY:
{ "mode": "SIM" }
or
{ "mode": "LIVE" }
==================================
*/

app.post("/api/mode", (req, res) => {
  const mode = String(req.body?.mode || "").toUpperCase();

  if (mode === "SIM" || mode === "LIVE") {
    MODE = mode;
  }

  res.json({
    success: true,
    mode: MODE
  });
});

/*
==================================
OPTIONAL SYSTEM SWITCH
POST /api/system
BODY:
{ "system": "SYSTEM_ONE" }
or
{ "system": "SYSTEM_TWO" }
==================================
*/

app.post("/api/system", (req, res) => {
  const system = String(req.body?.system || "").toUpperCase();

  if (system === "SYSTEM_ONE" || system === "SYSTEM_TWO") {
    ACTIVE_SYSTEM = system;
  }

  res.json({
    success: true,
    system: ACTIVE_SYSTEM
  });
});

/*
==================================
SERVER START
==================================
*/

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`GLOBAL PLUG BACKEND RUNNING ON ${PORT}`);
});
