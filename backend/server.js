require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();

/* =========================
   MIDDLEWARE (CLEAN)
========================= */
app.use(cors());
app.use(express.json());

/* =========================
   BASIC ROUTES (CRITICAL)
========================= */
app.get("/", (req, res) => {
  res.send("Global Plug Backend Live");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* =========================
   ENV VARIABLES
========================= */
const {
  KRAKEN_API_KEY,
  KRAKEN_API_SECRET,
  OPENROUTER_API_KEY,
  MODE = "SIM"
} = process.env;

/* =========================
   MARKET DATA
========================= */
app.get("/market", async (req, res) => {
  try {
    const pair = "XXBTZUSD";

    const response = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${pair}`
    );

    const data = await response.json();
    const ticker = data.result[pair];

    res.json({
      pair: "BTC/USD",
      price: ticker.c[0],
      ask: ticker.a[0],
      bid: ticker.b[0]
    });
  } catch (err) {
    res.status(500).json({ error: "Market fetch failed" });
  }
});

/* =========================
   BALANCE (SIM)
========================= */
app.get("/balance", async (req, res) => {
  try {
    if (MODE === "SIM") {
      return res.json({
        USD: 10000,
        BTC: 0,
        total: 10000
      });
    }

    res.json({ message: "Live balance not wired yet" });

  } catch (err) {
    res.status(500).json({ error: "Balance fetch failed" });
  }
});

/* =========================
   TRADE (SIM SAFE)
========================= */
app.post("/trade", async (req, res) => {
  try {
    const { side, amount } = req.body;

    if (MODE === "SIM") {
      return res.json({
        status: "SIM_TRADE",
        side,
        amount
      });
    }

    res.json({ message: "Live trading not wired yet" });

  } catch (err) {
    res.status(500).json({ error: "Trade failed" });
  }
});

/* =========================
   AI (OPENROUTER)
========================= */
app.post("/ai", async (req, res) => {
  try {
    if (!OPENROUTER_API_KEY) {
      return res.status(400).json({ error: "Missing OpenRouter key" });
    }

    const { prompt } = req.body;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [{ role: "user", content: prompt }]
        })
      }
    );

    const data = await response.json();

    res.json({
      reply: data.choices?.[0]?.message?.content || "No response"
    });

  } catch (err) {
    res.status(500).json({ error: "AI request failed" });
  }
});

/* =========================
   RESET SYSTEM
========================= */
app.post("/api/reset", (req, res) => {
  res.json({ success: true });
});

/* =========================
   START SERVER (RAILWAY FIX)
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Global Plug backend running on port ${PORT}`);
});
