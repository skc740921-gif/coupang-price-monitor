const express = require("express");
const path = require("path");
const puppeteer = require("puppeteer-core");

const app = express();
const PORT = process.env.PORT || 3000;
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

app.use(express.json({ limit: "300kb" }));
app.use(express.static(path.join(__dirname, "public")));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseCoupangUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("EMPTY_URL");

  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error("BAD_URL");
  }

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const isCoupang = host === "coupang.com" || host.endsWith(".coupang.com");
  if (!isCoupang) throw new Error("NOT_COUPANG");

  if (!["http:", "https:"].includes(u.protocol)) throw new Error("BAD_PROTOCOL");
  u.protocol = "https:";
  u.hash = "";
  return u.toString();
}

function priceNumber(v) {
  const digits = String(v ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function dedupeProducts(items) {
  const seen = new Set();
  const out = [];
  for (const x of items || []) {
    if (!x || !x.name || !x.price) continue;
    const price = priceNumber(x.price);
    if (!price || price < 100) continue;
    const key = `${String(x.url || "").split("?")[0]}|${String(x.name).trim()}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: String(x.name).trim().replace(/\s+/g, " ").slice(0, 240),
      price,
      url: String(x.url || "").trim()
    });
  }
  return out.slice(0, 40);
}

async function extract(page) {
  return await page.evaluate(() => {
    const results = [];

    const toPrice = (value) => {
      if (value === null || value === undefined) return null;
      const txt = String(value).replace(/\s+/g, " ");
      const comma = txt.match(/(?:^|[^\d])(\d{1,3}(?:,\d{3})+)\s*원?/);
      if (comma) return Number(comma[1].replace(/,/g, ""));
      const plain = txt.match(/(?:^|[^\d])(\d{3,8})\s*원/);
      return plain ? Number(plain[1]) : null;
    };

    const add = (name, price, url) => {
      const p = typeof price === "number" ? price : toPrice(price);
      const n = String(name || "").trim();
      if (!n || !p || p < 100) return;
      results.push({ name: n, price: p, url: url || location.href });
    };

    const pageTitle =
      document.querySelector('meta[property="og:title"]')?.content ||
      document.querySelector("h1")?.textContent ||
      document.title ||
      "쿠팡 상품";

    // 1) JSON-LD
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const root = JSON.parse(el.textContent || "null");
        const walk = (obj) => {
          if (!obj || typeof obj !== "object") return;
          if (obj["@type"] === "Product" || (Array.isArray(obj["@type"]) && obj["@type"].includes("Product"))) {
            const offersList = Array.isArray(obj.offers) ? obj.offers : [obj.offers];
            for (const offer of offersList.filter(Boolean)) {
              const p = offer.price ?? offer.lowPrice ?? offer.highPrice;
              if (p !== undefined) add(obj.name || pageTitle, p, location.href);
            }
          }
          for (const v of Object.values(obj)) {
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === "object") walk(v);
          }
        };
        walk(root);
      } catch {}
    }

    // 2) Product detail DOM
    const titleSelectors = [
      "h1",
      ".prod-buy-header__title",
      "[class*='prod-buy-header__title']",
      "[class*='product-title']",
      "[class*='ProductTitle']"
    ];
    let title = pageTitle;
    for (const s of titleSelectors) {
      const el = document.querySelector(s);
      if (el?.textContent?.trim()) {
        title = el.textContent.trim();
        break;
      }
    }

    const directPriceSelectors = [
      ".total-price strong",
      ".total-price",
      ".prod-sale-price .total-price",
      ".prod-sale-price",
      ".price-value",
      "[class*='final-price']",
      "[class*='sale-price']",
      "[class*='sales-price']",
      "[class*='total-price']",
      "[data-testid*='price']"
    ];

    for (const s of directPriceSelectors) {
      for (const el of document.querySelectorAll(s)) {
        const p = toPrice(el.textContent);
        if (p) add(title, p, location.href);
      }
    }

    // 3) Search/list cards
    const cardSelectors = [
      "li.search-product",
      "li[class*='search-product']",
      "[data-product-id]",
      "li[id^='product']",
      "[class*='SearchProduct']",
      "article"
    ];

    const cards = [];
    for (const s of cardSelectors) {
      for (const el of document.querySelectorAll(s)) {
        if (!cards.includes(el)) cards.push(el);
      }
    }

    for (const card of cards.slice(0, 100)) {
      const link =
        card.querySelector("a[href*='/vp/products/']") ||
        card.querySelector("a[href*='/products/']") ||
        card.querySelector("a[href]");
      const nameEl =
        card.querySelector(".name") ||
        card.querySelector("[class*='name']") ||
        card.querySelector("h2") ||
        card.querySelector("h3") ||
        link;
      const priceEl =
        card.querySelector(".price-value") ||
        card.querySelector("[class*='price-value']") ||
        card.querySelector("[class*='price']");

      const name = nameEl?.textContent?.trim() || "";
      const price = toPrice(priceEl?.textContent || card.textContent || "");
      if (name && price) add(name, price, link?.href || "");
    }

    // 4) Embedded script state fallback on product pages.
    // Only inspect explicit price-like keys to reduce false positives.
    const scriptText = [...document.scripts]
      .map(s => s.textContent || "")
      .filter(t => /salePrice|finalPrice|sellingPrice|discountPrice/i.test(t))
      .join("\n")
      .slice(0, 2000000);

    const keyPatterns = [
      /"(?:salePrice|finalPrice|sellingPrice|discountPrice)"\s*:\s*"?(\d{3,8})"?/ig,
      /'(?:salePrice|finalPrice|sellingPrice|discountPrice)'\s*:\s*'?(\d{3,8})'?/ig
    ];
    for (const rx of keyPatterns) {
      let m;
      let count = 0;
      while ((m = rx.exec(scriptText)) && count < 10) {
        add(title, Number(m[1]), location.href);
        count++;
      }
    }

    return results;
  });
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    version: "6.0.0",
    chrome: CHROME
  });
});

app.post("/api/check", async (req, res) => {
  let target;
  try {
    target = parseCoupangUrl(req.body?.url);
  } catch (e) {
    const code = String(e?.message || "");
    const msg =
      code === "EMPTY_URL" ? "쿠팡 URL을 입력해주세요." :
      code === "BAD_URL" ? "URL 형식이 올바르지 않습니다." :
      code === "NOT_COUPANG" ? "coupang.com 주소만 확인할 수 있습니다." :
      "올바른 쿠팡 URL을 입력해주세요.";
    return res.status(400).json({ ok: false, stage: "url", error: msg });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1440,1000",
        "--lang=ko-KR"
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Upgrade-Insecure-Requests": "1"
    });

    const response = await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 50000
    });

    const httpStatus = response?.status() || 0;
    const finalUrl = page.url();

    if ([401, 403, 429].includes(httpStatus)) {
      return res.status(502).json({
        ok: false,
        stage: "coupang",
        blocked: true,
        httpStatus,
        error: `쿠팡이 Render 서버 접속을 제한했습니다. (HTTP ${httpStatus})`
      });
    }

    // Wait for dynamic product/search content, but do not fail if selector never appears.
    try {
      await page.waitForFunction(() => {
        const t = document.body?.innerText || "";
        return /원/.test(t) || document.querySelector("li.search-product") || document.querySelector("h1");
      }, { timeout: 10000 });
    } catch {}

    await sleep(1800);

    const bodyText = await page.evaluate(() => (document.body?.innerText || "").slice(0, 12000));
    const blocked = /Access Denied|비정상적인 접근|접근이 제한|captcha|robot check|잠시 후 다시 시도/i.test(bodyText);
    if (blocked) {
      return res.status(502).json({
        ok: false,
        stage: "coupang",
        blocked: true,
        httpStatus,
        error: "쿠팡이 Render 서버에 제한 화면을 반환했습니다."
      });
    }

    const extracted = await extract(page);
    const products = dedupeProducts(extracted);

    if (!products.length) {
      return res.status(422).json({
        ok: false,
        stage: "extract",
        httpStatus,
        finalUrl,
        error: "쿠팡 페이지는 열렸지만 가격을 읽지 못했습니다.",
        hint: "이 경우 상품 페이지 구조 변경 또는 서버 접속 제한일 수 있습니다."
      });
    }

    res.json({
      ok: true,
      version: "6.0.0",
      checkedAt: new Date().toISOString(),
      httpStatus,
      finalUrl,
      count: products.length,
      products
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      stage: "server",
      error: "서버에서 가격 확인 중 오류가 발생했습니다.",
      detail: String(e?.message || e).slice(0, 300)
    });
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Coupang Price Monitor v6 listening on ${PORT}`);
});
