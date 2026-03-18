require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Global Plug Backend Live");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const {
  KRAKEN_API_KEY,
  KRAKEN_API_SECRET,
  OPENROUTER_API_KEY,
  MODE = "SIM"
} = process.env;

app.get("/market", async (req, res) => {
  try {
    const pair = "XXBTZUSD";
    const response = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${pair}`
    );
    const data = await response.json();

    if (!data.result || !data.result[pair]) {
      return res.status(500).json({ error: "Invalid market response" });
    }

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

app.get("/balance", async (req, res) => {
  try {
    if (MODE === "SIM") {
      return res.json({
        USD: 10000,
        BTC: 0,
        total: 10000,
        mode: "SIM"
      });
    }

    return res.json({
      message: "Live balance not wired yet",
      mode: "LIVE",
      krakenKeyLoaded: !!KRAKEN_API_KEY,
      krakenSecretLoaded: !!KRAKEN_API_SECRET
    });
  } catch (err) {
    res.status(500).json({ error: "Balance fetch failed" });
  }
});

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

app.post("/trade", async (req, res) => {
  try {
    const { side, amount } = req.body;

    if (MODE === "SIM") {
      return res.json({
        status: "SIM_TRADE",
        side,
        amount,
        message: "Simulated trade executed"
      });
    }

    return res.json({
      message: "Live trading not wired yet",
      side,
      amount,
      mode: "LIVE"
    });
  } catch (err) {
    res.status(500).json({ error: "Trade failed" });
  }
});

app.post("/api/reset", (req, res) => {
  res.json({ success: true });
});

const PORT = process.env.PORT;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Running on port ${PORT}`);
});
