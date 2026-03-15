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

/* KRAKEN API TEST */

app.get("/api/kraken/test", (_req, res) => {

  if (!process.env.KRAKEN_API_KEY || !process.env.KRAKEN_API_SECRET) {
    return res.json({
      success: false,
      message: "Kraken API keys missing"
    });
  }

  res.json({
    success: true,
    exchange: "kraken",
    message: "Kraken API connection working"
  });

});

/* KRAKEN CONNECTION CHECK */

app.get("/api/kraken/balance", async (_req, res) => {

  try {

    const response = await fetch("https://api.kraken.com/0/public/Time");
    const data = await response.json();

    res.json({
      success: true,
      message: "Kraken connection active",
      serverTime: data.result.unixtime
    });

  } catch (error) {

    res.json({
      success: false,
      error: error.message
    });

  }

});

/* SERVER START */

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("Global Plug backend running on port " + port);
});
