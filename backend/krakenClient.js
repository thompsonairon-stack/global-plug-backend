const crypto = require("crypto");
const fetch = require("node-fetch");

const API_KEY = process.env.KRAKEN_API_KEY;
const API_SECRET = process.env.KRAKEN_API_SECRET;

const BASE_URL = "https://api.kraken.com";

function getSignature(path, request, secret, nonce) {
  const message = nonce + request;
  const secret_buffer = Buffer.from(secret, "base64");
  const hash = crypto.createHash("sha256").update(message).digest();
  const hmac = crypto.createHmac("sha512", secret_buffer);
  const signature = hmac.update(path + hash).digest("base64");
  return signature;
}

async function privateRequest(path, params = {}) {
  const nonce = Date.now().toString();

  const body = new URLSearchParams({
    nonce,
    ...params
  }).toString();

  const signature = getSignature(path, body, API_SECRET, nonce);

  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: {
      "API-Key": API_KEY,
      "API-Sign": signature,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  return res.json();
}

async function getBalance() {
  return privateRequest("/0/private/Balance");
}

async function getTicker(pair = "XXBTZUSD") {
  const res = await fetch(`${BASE_URL}/0/public/Ticker?pair=${pair}`);
  return res.json();
}

async function placeOrder({ pair, side, volume }) {
  return privateRequest("/0/private/AddOrder", {
    pair,
    type: side,
    ordertype: "market",
    volume
  });
}

module.exports = {
  getBalance,
  getTicker,
  placeOrder
};
