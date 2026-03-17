/* =========================
   BACKEND — server.js
   ========================= */

const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const API_BASE = "https://api.kraken.com";

// ===== ENV =====
const API_KEY = process.env.KRAKEN_API_KEY || "";
const API_SECRET = process.env.KRAKEN_API_SECRET || "";

// ===== STATE =====
let MODE = "SIM"; // SIM or LIVE
let AGENTS = [
  { name: "Agent1", role: "executor" },
  { name: "Agent2", role: "executor" }
];

// ===== HELPERS =====
function sign(path, request, secret) {
  const nonce = request.nonce;
  const postData = new URLSearchParams(request).toString();

  const hash = crypto
    .createHash("sha256")
    .update(nonce + postData)
    .digest();

  const hmac = crypto
    .createHmac("sha512", Buffer.from(secret, "base64"))
    .update(path + hash)
    .digest("base64");

  return hmac;
}

async function krakenPrivate(path, params = {}) {
  const body = {
    nonce: Date.now().toString(),
    ...params
  };

  const headers = {
    "API-Key": API_KEY,
    "API-Sign": sign(path, body, API_SECRET),
    "Content-Type": "application/x-www-form-urlencoded"
  };

  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers,
    body: new URLSearchParams(body)
  });

  const json = await res.json();
  if (json.error?.length) throw new Error(json.error.join(","));
  return json.result;
}

// ===== ROUTES =====
app.get("/health", (req, res) => {
  res.json({ ok: true, mode: MODE });
});

app.get("/api/kraken/test", async (req, res) => {
  try {
    const r = await fetch(API_BASE + "/0/public/Time");
    const j = await r.json();
    res.json({ success: true, time: j.result.unixtime });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/kraken/balance", async (req, res) => {
  try {
    if (!API_KEY) return res.json({ USD: 10000, BTC: 0, mode: "SIM" });
    const b = await krakenPrivate("/0/private/Balance");
    res.json(b);
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.post("/api/mode", (req, res) => {
  MODE = req.body.mode || "SIM";
  res.json({ mode: MODE });
});

app.post("/api/system", (req, res) => {
  AGENTS = req.body.agents || AGENTS;
  res.json({ agents: AGENTS });
});

app.post("/api/engine/execute", async (req, res) => {
  try {
    const pair = req.body?.pair || "XXBTZUSD";

    const r = await fetch(`${API_BASE}/0/public/Ticker?pair=${pair}`);
    const j = await r.json();
    const last = Number(Object.values(j.result)[0].c[0]);

    const results = AGENTS.map((a) => {
      const decision = last % 2 === 0 ? "buy" : "sell";
      return {
        agent: a.name,
        decision,
        size: 0.01
      };
    });

    if (MODE === "LIVE" && API_KEY) {
      for (let r of results) {
        await krakenPrivate("/0/private/AddOrder", {
          pair,
          type: r.decision,
          ordertype: "market",
          volume: r.size
        });
      }
    }

    res.json({
      success: true,
      pair,
      price: last,
      results
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Backend running")
);


/* =========================
   FRONTEND — App.jsx
   ========================= */

import React, { useState, useEffect } from "react";

const BASE = "https://global-plug-backend-production.up.railway.app";

const api = {
  health: () => fetch(BASE + "/health").then(r => r.json()),
  balance: () => fetch(BASE + "/api/kraken/balance").then(r => r.json()),
  execute: (pair) =>
    fetch(BASE + "/api/engine/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair })
    }).then(r => r.json())
};

export default function App() {
  const [tab, setTab] = useState("Dashboard");
  const [data, setData] = useState({});
  const [pair, setPair] = useState("XXBTZUSD");
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    api.health().then(h => setData(d => ({ ...d, health: h })));
    api.balance().then(b => setData(d => ({ ...d, balance: b })));
  }, []);

  const run = async () => {
    const r = await api.execute(pair);
    setLogs([r, ...logs]);
  };

  const tabs = [
    "Dashboard",
    "Agents",
    "Trades",
    "Logs",
    "Patterns",
    "Capital",
    "Vault",
    "Systems",
    "Brain",
    "Settings",
    "Mode"
  ];

  return (
    <div style={{ background: "#0b0f14", color: "#fff", minHeight: "100vh" }}>
      
      {/* STATUS */}
      <div style={{ padding: 10, borderBottom: "1px solid #222" }}>
        Backend: {data.health?.ok ? "🟢" : "🔴"} | Mode: {data.health?.mode}
      </div>

      {/* TABS */}
      <div style={{ display: "flex", overflowX: "auto" }}>
        {tabs.map(t => (
          <div key={t}
            onClick={() => setTab(t)}
            style={{
              padding: 15,
              cursor: "pointer",
              color: tab === t ? "#00f0ff" : "#555"
            }}>
            {t}
          </div>
        ))}
      </div>

      {/* DASHBOARD */}
      {tab === "Dashboard" && (
        <div style={{ padding: 20 }}>
          <h2>Dashboard</h2>
          <input value={pair} onChange={e => setPair(e.target.value)} />
          <button onClick={run}>RUN</button>
          <pre>{JSON.stringify(data.balance, null, 2)}</pre>
        </div>
      )}

      {/* TRADES */}
      {tab === "Trades" && (
        <div style={{ padding: 20 }}>
          {logs.map((l, i) => (
            <div key={i}>{JSON.stringify(l)}</div>
          ))}
        </div>
      )}

      {/* GENERIC SCREENS */}
      {["Agents","Logs","Patterns","Capital","Vault","Systems","Brain","Settings","Mode"].includes(tab) && (
        <div style={{ padding: 40, color: "#666" }}>
          <h2>{tab}</h2>
          <p>Module Ready</p>
        </div>
      )}

    </div>
  );
}
