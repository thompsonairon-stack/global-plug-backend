const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fetch = require("node-fetch");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

/* HEALTH CHECK */
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "global-plug-backend"
  });
});

/* KRAKEN CONNECTION TEST */
app.get("/api/kraken/test", async (_req, res) => {
  try {

    const response = await fetch("https://api.kraken.com/0/public/Time");
    const data = await response.json();

    res.json({
      success: true,
      exchange: "kraken",
      message: "Kraken API connection working",
      serverTime: data.result.unixtime
    });

  } catch (error) {

    res.json({
      success: false,
      error: error.message
    });

  }
});

/* KRAKEN BALANCE */
app.get("/api/kraken/balance", async (_req, res) => {
  try {

    const response = await fetch("https://api.kraken.com/0/private/Balance", {
      method: "POST",
      headers: {
        "API-Key": process.env.KRAKEN_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const data = await response.json();

    if (data.error && data.error.length > 0) {
      return res.json({
        success: false,
        error: data.error
      });
    }

    res.json({
      success: true,
      balance: data.result
    });

  } catch (error) {

    res.json({
      success: false,
      error: error.message
    });

  }
});

/* ENGINE EXECUTION PLACEHOLDER */
app.post("/api/engine/execute", (_req, res) => {

  const result = {
    minimax: {
      decision: "BLOCK",
      reason: "placeholder engine"
    },
    flash: {
      decision: "BLOCK",
      reason: "placeholder engine"
    }
  };

  res.json({
    success: true,
    engine: "global-plug",
    result
  });

});

/* SERVER START */
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("Global Plug backend running on port", port);
});
