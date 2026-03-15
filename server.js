const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "global-plug-backend" });
});

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

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("Global Plug backend running on port " + port);
});
