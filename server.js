const express = require("express")
const cors = require("cors")
const fetch = require("node-fetch")
const crypto = require("crypto")

const app = express()

/* =========================
   RAILWAY SAFE SETTINGS
========================= */

app.set("trust proxy",1)

app.use(cors({
 origin:"*",
 methods:["GET","POST"]
}))

app.use(express.json({
 limit:"2mb"
}))

app.use(express.urlencoded({
 extended:true
}))

/* =========================
   GLOBAL STATE
========================= */

let MODE = "SIM"
let ACTIVE_SYSTEM = "SYSTEM_ONE"

/* =========================
   ENV
========================= */

const API_KEY = process.env.KRAKEN_API_KEY
const API_SECRET = process.env.KRAKEN_API_SECRET
const API_URL = "https://api.kraken.com"

/* =========================
   HEALTH
========================= */

app.get("/health",(req,res)=>{
 res.json({
  status:"online",
  mode:MODE,
  system:ACTIVE_SYSTEM
 })
})

/* =========================
   KRAKEN TEST
========================= */

app.get("/api/kraken/test",async(req,res)=>{

 try{

  const r = await fetch(`${API_URL}/0/public/Time`)
  const j = await r.json()

  res.json({
   success:true,
   exchange:"kraken",
   serverTime:j.result.unixtime
  })

 }catch(e){

  res.json({
   success:false,
   error:e.message
  })

 }

})

/* =========================
   SIGNATURE
========================= */

function signKraken(path,body){

 const nonce = body.nonce
 const postData = new URLSearchParams(body).toString()

 const sha256 = crypto
  .createHash("sha256")
  .update(nonce + postData)
  .digest()

 const hmac = crypto
  .createHmac("sha512",Buffer.from(API_SECRET,"base64"))
  .update(path + sha256)
  .digest("base64")

 return hmac
}

/* =========================
   PRIVATE REQUEST
========================= */

async function krakenPrivate(path,params={}){

 const nonce = Date.now().toString()

 const body = {
  nonce,
  ...params
 }

 const postData = new URLSearchParams(body).toString()

 const signature = signKraken(path,body)

 const r = await fetch(`${API_URL}${path}`,{
  method:"POST",
  headers:{
   "API-Key":API_KEY,
   "API-Sign":signature,
   "Content-Type":"application/x-www-form-urlencoded"
  },
  body:postData
 })

 const j = await r.json()

 if(j.error && j.error.length){
  throw new Error(j.error.join(","))
 }

 return j.result
}

/* =========================
   BALANCE
========================= */

app.get("/api/kraken/balance",async(req,res)=>{

 try{

  if(MODE === "SIM"){

   return res.json({
    mode:"SIM",
    balances:{
     USD:10000,
     BTC:0.25
    }
   })

  }

  const result = await krakenPrivate("/0/private/Balance")

  res.json({
   mode:"LIVE",
   balance:result
  })

 }catch(e){

  res.json({
   success:false,
   error:e.message
  })

 }

})

/* =========================
   MODE SWITCH
========================= */

app.post("/api/mode",(req,res)=>{

 const {mode} = req.body

 if(!mode){
  return res.json({
   success:false,
   error:"mode required"
  })
 }

 MODE = mode

 res.json({
  success:true,
  mode:MODE
 })

})

/* =========================
   SYSTEM SWITCH
========================= */

app.post("/api/system",(req,res)=>{

 const {system} = req.body

 if(!system){
  return res.json({
   success:false,
   error:"system required"
  })
 }

 ACTIVE_SYSTEM = system

 res.json({
  success:true,
  system:ACTIVE_SYSTEM
 })

})

/* =========================
   ORDER EXECUTION
========================= */

async function placeOrder(pair,side,size){

 const params = {
  pair,
  type:side,
  ordertype:"market",
  volume:size
 }

 return krakenPrivate("/0/private/AddOrder",params)

}

/* =========================
   ENGINE EXECUTION
========================= */

app.post("/api/engine/execute",async(req,res)=>{

 try{

  const {pair="XXBTZUSD",agents=[]} = req.body

  const tickerRes = await fetch(`${API_URL}/0/public/Ticker?pair=${pair}`)
  const tickerJson = await tickerRes.json()

  const ticker = Number(Object.values(tickerJson.result)[0].c[0])

  const results = []

  for(const agent of agents){

   const name = agent.name || "AGENT"
   const decision = agent.decision || "NO_TRADE"
   const side = agent.side
   const size = agent.size || 0

   if(MODE === "SIM"){

    results.push({
     agent:name,
     decision,
     simulated:true
    })

   }

   else if(MODE === "LIVE"){

    if(decision === "BUY" || decision === "SELL"){

     const order = await placeOrder(pair,side,size)

     results.push({
      agent:name,
      executed:true,
      order
     })

    }

    else{

     results.push({
      agent:name,
      executed:false
     })

    }

   }

  }

  res.json({
   success:true,
   mode:MODE,
   system:ACTIVE_SYSTEM,
   market:{
    pair,
    price:ticker
   },
   agents:results
  })

 }catch(e){

  res.status(500).json({
   success:false,
   error:e.message
  })

 }

})

/* =========================
   HEARTBEAT
========================= */

setInterval(()=>{
 console.log("GLOBAL PLUG BACKEND ALIVE")
},30000)

/* =========================
   SERVER START
========================= */

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
 console.log("GLOBAL PLUG BACKEND RUNNING ON",PORT)
})
