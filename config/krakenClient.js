const crypto = require("crypto");
const fetch = require("node-fetch");

const API_BASE = "https://api.kraken.com";

function getKrakenEnv() {
  const apiKey = process.env.KRAKEN_API_KEY || "";
  const apiSecret = process.env.KRAKEN_API_SECRET || "";

  if (!apiKey || !apiSecret) {
    throw new Error("Missing KRAKEN_API_KEY or KRAKEN_API_SECRET");
  }

  return { apiKey, apiSecret };
}

function buildKrakenSignature(path, body, apiSecret) {
  const nonce = String(body.nonce);
  const postData = new URLSearchParams(body).toString();

  const sha256 = crypto
    .createHash("sha256")
    .update(Buffer.concat([Buffer.from(nonce), Buffer.from(postData)]))
    .digest();

  const hmac = crypto
    .createHmac("sha512", Buffer.from(apiSecret, "base64"))
    .update(Buffer.concat([Buffer.from(path), sha256]))
    .digest("base64");

  return hmac;
}

async function privateRequest(path, params = {}) {
  const { apiKey, apiSecret } = getKrakenEnv();

  const body = {
    nonce: Date.now().toString(),
    ...params
  };

  const postData = new URLSearchParams(body).toString();
  const apiSign = buildKrakenSignature(path, body, apiSecret);

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "API-Key": apiKey,
      "API-Sign": apiSign,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: postData
  });

  const json = await response.json();

  if (json.error && json.error.length) {
    throw new Error(json.error.join(", "));
  }

  return json.result;
}

async function getBalance() {
  return privateRequest("/0/private/Balance");
}

module.exports = {
  getBalance
};
