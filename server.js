
const express = require("express");
const puppeteer = require("puppeteer-core");

const app = express();
app.use(express.json({limit:"1mb"}));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

function cleanPrice(s=""){
  const m = String(s).replace(/\s+/g," ").match(/([0-9][0-9,]{2,})\s*원/);
  return m ? Number(m[1].replace(/,/g,"")) : 0;
}

app.get("/health", (req,res)=>res.json({ok:true, service:"coupang-price-monitor-v4"}));

app.post("/api/coupang-search", async (req,res)=>{
  const url = req.body?.url;
  if(!url || !/^https:\/\/(www\.)?coupang\.com\/np\/search/i.test(url)){
    return res.status(400).json({error:"쿠팡 검색결과 URL을 확인해주세요."});
  }

  let browser;
  try{
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_BIN || "/usr/bin/chromium",
      headless: true,
      args: [
        "--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage",
        "--disable-gpu","--no-zygote","--single-process"
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({width:1280,height:900});
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language":"ko-KR,ko;q=0.9,en;q=0.8"
    });

    const response = await page.goto(url,{waitUntil:"domcontentloaded",timeout:45000});
    const status = response ? response.status() : 0;

    await new Promise(r=>setTimeout(r,2500));

    const title = await page.title().catch(()=> "");
    const bodyText = await page.evaluate(()=>document.body?.innerText?.slice(0,4000)||"").catch(()=> "");

    const items = await page.evaluate(()=>{
      const out=[];
      const sels = [
        "li.search-product",
        "li[class*='search-product']",
        "[data-product-id]"
      ];
      const nodes = Array.from(document.querySelectorAll(sels.join(",")));
      const seen = new Set();

      for(const el of nodes){
        let name =
          el.querySelector(".name")?.textContent?.trim() ||
          el.querySelector("[class*='name']")?.textContent?.trim() || "";
        let priceText =
          el.querySelector(".price-value")?.textContent?.trim() ||
          el.querySelector("[class*='price-value']")?.textContent?.trim() || "";
        if(!priceText){
          const txt = el.textContent || "";
          const m = txt.match(/([0-9][0-9,]{2,})\s*원/);
          priceText = m ? m[1] : "";
        }
        const a = el.querySelector("a[href]");
        let href = a?.href || "";
        const pm = String(priceText).replace(/\s+/g," ").match(/([0-9][0-9,]{2,})/);
        const price = pm ? Number(pm[1].replace(/,/g,"")) : 0;

        if(name && price){
          const key = href || (name+"|"+price);
          if(!seen.has(key)){
            seen.add(key);
            out.push({name:name.slice(0,180),price,url:href});
          }
        }
        if(out.length>=80) break;
      }
      return out;
    });

    if(!items.length){
      const blocked = /Access Denied|접근이 제한|비정상적인 접근|captcha|robot/i.test(bodyText+title);
      return res.status(502).json({
        error: blocked
          ? "쿠팡이 서버의 자동 접속을 차단했습니다."
          : "쿠팡 페이지는 열렸지만 상품 가격을 찾지 못했습니다.",
        diagnostic:{status,title,blocked}
      });
    }

    return res.json({items, count:items.length, checkedAt:new Date().toISOString()});
  }catch(e){
    return res.status(500).json({error:"수집 서버 오류: "+e.message});
  }finally{
    if(browser) await browser.close().catch(()=>{});
  }
});

app.listen(PORT, ()=>console.log("Server running on", PORT));
