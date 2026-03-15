const fetch = require("node-fetch");

async function executeTrade(pair, side, volume) {
  return {
    success: true,
    pair,
    side,
    volume,
    message: "Trade execution placeholder"
  };
}

module.exports = {
  executeTrade
};
