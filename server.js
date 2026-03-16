const express = require("express")
const cors = require("cors")
const dotenv = require("dotenv")
const fetch = require("node-fetch")
const crypto = require("crypto")

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

/*
===============================
GLOBAL STATE
===============================
*/

let MODE = "SIM"
let ACTIVE_SYSTEM = "SYSTEM_ONE"

/*
===============================
KRAKEN API
===============================
*/

const API_BASE = "https://api.kraken.com"

function getKrakenEnv() {

  const apiKey = process.env.KRAKEN_API_KEY || ""
  const apiSecret = process.env.KRAKEN_API_SECRET || ""

  if (!apiKey || !apiSecret) {
    throw new Error("Kraken API keys missing")
  }

  return { apiKey, apiSecret }

}

function signKraken(path, body, secret) {

  const nonce = String(body.nonce)
  const postData = new URLSearchParams(body).toString()

  const sha256 = crypto
    .createHash("sha256")
    .update(Buffer.concat([Buffer.from(nonce), Buffer.from(postData)]))
    .digest()

  return crypto
    .createHmac("sha512", Buffer.from(secret, "base64"))
    .update(Buffer.concat([Buffer.from(path), sha256]))
    .digest("base64")

}

async function krakenPrivate(method, params = {}) {

  const { apiKey, apiSecret } = getKrakenEnv()

  const path = `/0/private/${method}`

  const body = {
    nonce: Date.now().toString(),
    ...params
  }

  const response = await fetch(`${API_BASE}${path}`, {

    method: "POST",

    headers: {
      "API-Key": apiKey,
      "API-Sign": signKraken(path, body, apiSecret),
      "Content-Type": "application/x-www-form-urlencoded"
    },

    body: new URLSearchParams(body).toString()

  })

  const json = await response.json()

  if (json.error && json.error.length) {
    throw new Error(json.error.join(", "))
  }

  return json.result

}

async function krakenPublic(path, query = {}) {

  const url = new URL(`${API_BASE}${path}`)

  Object.entries(query).forEach(([k,v]) => {
    url.searchParams.set(k,v)
  })

  const res = await fetch(url.toString())
  const json = await res.json()

  if (json.error && json.error.length) {
    throw new Error(json.error.join(", "))
  }

  return json.result

}

async function getTicker(pair="XXBTZUSD") {

  const r = await krakenPublic("/0/public/Ticker",{pair})
  const key = Object.keys(r)[0]

  return {

    pair,
    last: Number(r[key].c[0]),
    ask: Number(r[key].a[0]),
    bid: Number(r[key].b[0])

  }

}

async function getBalance() {
  return krakenPrivate("Balance")
}

async function placeOrder(pair,side,size){

  return krakenPrivate("AddOrder",{

    pair,
    type: side,
    ordertype: "market",
    volume: String(size)

  })

}

/*
===============================
AGENT EXECUTION
===============================
*/

async function runAgent(pair, agent){

  const { name, decision, side, size } = agent

  if(!decision || decision === "NO_TRADE"){

    return {
      agent:name,
      executed:false,
      simulated:MODE==="SIM",
      decision:"NO_TRADE"
    }

  }

  if(MODE==="SIM"){

    return {

      agent:name,
      executed:false,
      simulated:true,
      side,
      size

    }

  }

  const order = await placeOrder(pair,side,size)

  return {

    agent:name,
    executed:true,
    side,
    size,
    txid:order.txid

  }

}

/*
===============================
ROUTES
===============================
*/

app.get("/health",(req,res)=>{

  res.json({

    status:"online",
    mode:MODE,
    system:ACTIVE_SYSTEM

  })

})

/*
KRAKEN TEST
*/

app.get("/api/kraken/test", async(req,res)=>{

  try{

    const t = await krakenPublic("/0/public/Time")

    res.json({

      success:true,
      serverTime:t.unixtime

    })

  }catch(e){

    res.status(500).json({
      success:false,
      error:e.message
    })

  }

})

/*
BALANCE
*/

app.get("/api/kraken/balance", async(req,res)=>{

  try{

    if(MODE==="SIM"){

      return res.json({

        mode:"SIM",
        balances:{
          USD:10000,
          BTC:0.2
        }

      })

    }

    const balance = await getBalance()

    res.json({

      mode:"LIVE",
      balance

    })

  }catch(e){

    res.status(500).json({

      success:false,
      error:e.message

    })

  }

})

/*
ENGINE EXECUTION
NOW SUPPORTS ANY AGENTS
*/

app.post("/api/engine/execute", async(req,res)=>{

  try{

    const pair = req.body?.pair || "XXBTZUSD"

    const ticker = await getTicker(pair)

    const agents = req.body?.agents || []

    const results=[]

    for(const agent of agents){

      const r = await runAgent(pair,agent)

      results.push(r)

    }

    res.json({

      success:true,
      mode:MODE,
      system:ACTIVE_SYSTEM,
      market:ticker,
      agents:results

    })

  }catch(e){

    res.status(500).json({

      success:false,
      error:e.message

    })

  }

})

/*
MODE SWITCH
*/

app.post("/api/mode",(req,res)=>{

  const mode = String(req.body?.mode || "").toUpperCase()

  if(mode==="SIM"||mode==="LIVE"){
    MODE=mode
  }

  res.json({
    success:true,
    mode:MODE
  })

})

/*
SYSTEM SWITCH
*/

app.post("/api/system",(req,res)=>{

  const system = String(req.body?.system || "").toUpperCase()

  ACTIVE_SYSTEM = system

  res.json({

    success:true,
    system:ACTIVE_SYSTEM

  })

})

/*
SERVER START
*/

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{

  console.log(`GLOBAL PLUG BACKEND RUNNING ON ${PORT}`)

})
