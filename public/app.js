
const K=document.getElementById("k"),S=document.getElementById("s"),L=document.getElementById("l");K.value=localStorage.apiKey||"";
const w=n=>n==null?"-":Number(n).toLocaleString("ko-KR")+"원",e=s=>String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const d=(p,q)=>q==null?"첫 등록":p<q?`<span class=down>▼ ${w(q-p)} 인하</span>`:p>q?`<span class=up>▲ ${w(p-q)} 인상</span>`:"변동 없음";
async function load(){if(!localStorage.apiKey){S.textContent="API 키 입력";return}let r=await fetch("/api/items",{headers:{"x-api-key":localStorage.apiKey}}),j=await r.json();if(!r.ok){S.textContent="오류: "+j.error;return}
L.innerHTML=(j.items||[]).map(x=>`<div class=c><div class=n>${e(x.name)}</div>${(x.options||[]).length?(x.options||[]).map(o=>`<div class=o><b>${e(o.name)}</b>${o.selected?" · 현재선택":""}<div class=p>${w(o.price)}</div><div class=m>${d(o.price,o.previous)} · 최저 ${w(o.lowest)} · 최고 ${w(o.highest)}</div></div>`).join(""):`<div class=p>${w(x.price)}</div>`}<div class=m>${new Date(x.time).toLocaleString("ko-KR")}</div><button onclick='del(${JSON.stringify(x.url)})'>삭제</button></div>`).join("")||"<div class=c>등록 상품 없음</div>";S.textContent="최신 정보"}
document.getElementById("b").onclick=()=>{localStorage.apiKey=K.value.trim();load()};load();
async function del(url){
  if(!confirm("이 상품을 삭제할까요?"))return;
  const r=await fetch("/api/delete",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "x-api-key":localStorage.apiKey
    },
    body:JSON.stringify({url})
  });
  if(!r.ok){alert("삭제 실패");return}
  await load();
}
