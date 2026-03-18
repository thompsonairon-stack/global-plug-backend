require("dotenv").config();
const express = require("express");
const cors = require("cors");

const kraken = require("./krakenClient");

const app = express();

app.use(cors());
app.use(express.json());

/*
------------------------
ROOT
------------------------
*/
app.get("/", (req, res) => {
  res.send("Global Plug Backend LIVE");
});

/*
------------------------
HEALTH
------------------------
*/
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/*
------------------------
KRAKEN TEST
------------------------
*/
app.get("/api/kraken/test", async (req, res) => {
  try {
    const data = await kraken.getBalance();

    res.json({
      success: true,
      message: "Kraken connected",
      data
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/*
------------------------
BALANCE
------------------------
*/
app.get("/api/kraken/balance", async (req, res) => {
  try {
    const data = await kraken.getBalance();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
------------------------
ENGINE (YOUR SYSTEM CONTROLS)
------------------------
*/
app.post("/api/engine/execute", async (req, res) => {
  try {
    const { pair = "XXBTZUSD", action, volume } = req.body;

    // get market data
    const ticker = await kraken.getTicker(pair);

    // your system should decide this
    // for now we pass action manually

    let orderResult = null;

    if (action === "buy" || action === "sell") {
      orderResult = await kraken.placeOrder({
        pair,
        side: action,
        volume
      });
    }

    res.json({
      success: true,
      pair,
      action,
      volume,
      ticker,
      orderResult
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/*
------------------------
SERVER
------------------------
*/
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Running on port ${PORT}`);
});
