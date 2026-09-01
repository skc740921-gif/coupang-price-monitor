const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const API_KEY = process.env.API_KEY || "change-me";

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname, "public")));

function readData(){
  try{
    if(!fs.existsSync(DATA_FILE)) return {items:[]};
    const raw = JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));
    return {items:Array.isArray(raw.items)?raw.items:[]};
  }catch(e){ return {items:[]}; }
}
function writeData(data){
  try{ fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2), "utf8"); }catch(e){}
}
function auth(req,res,next){
  const key = req.header("x-api-key") || req.query.key;
  if(key !== API_KEY) return res.status(401).json({ok:false,error:"invalid api key"});
  next();
}

app.get("/health",(req,res)=>res.json({ok:true,time:new Date().toISOString()}));

app.get("/api/items", auth, (req,res)=>{
  const data = readData();
  data.items.sort((a,b)=>String(b.time).localeCompare(String(a.time)));
  res.json({ok:true,items:data.items});
});

app.post("/api/update", auth, (req,res)=>{
  const {url,name,price,previous,lowest,highest,time} = req.body || {};
  if(!url || !Number.isFinite(Number(price))) return res.status(400).json({ok:false,error:"bad data"});
  const data = readData();
  const now = time || new Date().toISOString();
  const existing = data.items.find(x=>x.url===url);
  const current = Number(price);
  const item = {
    id: existing?.id || crypto.randomUUID(),
    url,
    name: String(name || existing?.name || "쿠팡 상품").slice(0,300),
    price: current,
    previous: previous ?? existing?.price ?? null,
    lowest: lowest ?? (existing?.lowest ? Math.min(existing.lowest,current) : current),
    highest: highest ?? (existing?.highest ? Math.max(existing.highest,current) : current),
    time: now,
    history: [...(existing?.history||[]).slice(-99), {time:now,price:current}]
  };
  data.items = [item, ...data.items.filter(x=>x.url!==url)];
  writeData(data);
  res.json({ok:true,item});
});

app.delete("/api/items/:id", auth, (req,res)=>{
  const data=readData();
  data.items=data.items.filter(x=>x.id!==req.params.id);
  writeData(data);
  res.json({ok:true});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT, ()=>console.log("listening on",PORT));
