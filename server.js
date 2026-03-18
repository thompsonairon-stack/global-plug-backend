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

app.get("/market", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.kraken.com/0/public/Ticker?pair=XXBTZUSD"
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Market failed" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Running on port ${PORT}`);
});
