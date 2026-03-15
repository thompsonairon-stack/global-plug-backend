const express = require("express");
const { getBalance } = require("../config/krakenClient");

const router = express.Router();

router.get("/test", async (_req, res) => {
  try {
    const balance = await getBalance();

    res.json({
      success: true,
      message: "Kraken connection OK",
      assets: balance
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
