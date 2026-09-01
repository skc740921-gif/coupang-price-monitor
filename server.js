
const express=require("express"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const app=express(),PORT=process.env.PORT||10000,FILE=path.join(__dirname,"data.json"),KEY=process.env.API_KEY||"change-me";
app.use(express.json({limit:"2mb"}));app.use(express.static(path.join(__dirname,"public")));
function rd(){try{return fs.existsSync(FILE)?JSON.parse(fs.readFileSync(FILE,"utf8")):{items:[]}}catch{return{items:[]}}}
function wr(d){try{fs.writeFileSync(FILE,JSON.stringify(d,null,2))}catch{}}
function auth(req,res,next){if((req.header("x-api-key")||req.query.key)!==KEY)return res.status(401).json({ok:false,error:"invalid api key"});next()}
app.get("/api/items",auth,(req,res)=>res.json({ok:true,items:rd().items||[]}));
app.post("/api/update",auth,(req,res)=>{
 const b=req.body||{},d=rd(),old=(d.items||[]).find(x=>x.url===b.url),oldOpts=old?.options||[],now=b.time||new Date().toISOString();
 const options=(b.options||[]).map(o=>{const prev=oldOpts.find(x=>x.name===o.name),p=Number(o.price);return{name:o.name,price:p,previous:prev?.price??null,lowest:prev?.lowest?Math.min(prev.lowest,p):p,highest:prev?.highest?Math.max(prev.highest,p):p,selected:!!o.selected}}).filter(o=>Number.isFinite(o.price));
 const cp=Number.isFinite(Number(b.price))?Number(b.price):(options.find(o=>o.selected)?.price??options[0]?.price??null);
 const item={id:old?.id||crypto.randomUUID(),url:b.url,name:b.name||"쿠팡 상품",price:cp,previous:old?.price??null,lowest:cp!=null?(old?.lowest?Math.min(old.lowest,cp):cp):null,highest:cp!=null?(old?.highest?Math.max(old.highest,cp):cp):null,options,time:now};
 d.items=[item,...(d.items||[]).filter(x=>x.url!==b.url)];wr(d);res.json({ok:true,item});
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("listening",PORT));
