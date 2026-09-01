const keyEl=document.getElementById("key"), statusEl=document.getElementById("status"), listEl=document.getElementById("list");
keyEl.value=localStorage.getItem("apiKey")||"";
const won=n=>n==null?"-":Number(n).toLocaleString("ko-KR")+"원";
const esc=s=>String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function render(items){
 listEl.innerHTML=items.length?items.map(x=>{
   let d="", cls="";
   if(x.previous!=null){
     const diff=x.price-x.previous;
     if(diff<0){d=`▼ ${Math.abs(diff).toLocaleString("ko-KR")}원 인하`;cls="down"}
     else if(diff>0){d=`▲ ${diff.toLocaleString("ko-KR")}원 인상`;cls="up"}
     else d="변동 없음";
   } else d="첫 등록";
   return `<div class="item"><div class="name">${esc(x.name)}</div><div class="price">${won(x.price)}</div><div class="diff ${cls}">${d}</div><div class="meta">직전 ${won(x.previous)} · 최저 ${won(x.lowest)} · 최고 ${won(x.highest)}<br>최근 확인 ${new Date(x.time).toLocaleString("ko-KR")}</div></div>`;
 }).join(""):'<div class="card muted">아직 등록된 상품이 없습니다.</div>';
}
async function load(){
 const key=localStorage.getItem("apiKey")||"";
 if(!key){statusEl.textContent="API 키를 입력하세요.";return}
 statusEl.textContent="불러오는 중...";
 try{
   const r=await fetch("/api/items",{headers:{"x-api-key":key}});
   const j=await r.json();
   if(!r.ok) throw new Error(j.error||"불러오기 실패");
   render(j.items||[]); statusEl.textContent="최신 정보";
 }catch(e){statusEl.textContent="오류: "+e.message}
}
document.getElementById("save").onclick=()=>{localStorage.setItem("apiKey",keyEl.value.trim());load()};
load();
setInterval(load,60000);
