require("dotenv").config();

const express = require("express");
const cors = require("cors");

const krakenRoute = require("./api/krakenRoute");
const engineRoute = require("./api/engineRoute");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "HEALTHY",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.use("/api/kraken", krakenRoute);
app.use("/api/engine", engineRoute);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Global Plug backend running on port ${PORT}`);
});
