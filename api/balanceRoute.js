const express = require("express");
const { getBalance } = require("../config/krakenClient");

const router = express.Router();

router.get("/balance", async (_req, res) => {
  try {
    const balance = await getBalance();

    res.json({
      success: true,
      balance
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
