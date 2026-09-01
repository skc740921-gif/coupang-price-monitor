
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;
const FILE = path.join(__dirname, "data.json");
const KEY = process.env.API_KEY || "change-me";

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET;
const KAKAO_REDIRECT_URI =
  process.env.KAKAO_REDIRECT_URI ||
  "https://coupang-price-monitor.onrender.com/kakao/callback";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function rd() {
  try {
    return fs.existsSync(FILE)
      ? JSON.parse(fs.readFileSync(FILE, "utf8"))
      : { items: [] };
  } catch {
    return { items: [] };
  }
}

function wr(d) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
  } catch {}
}

function auth(req, res, next) {
  if ((req.header("x-api-key") || req.query.key) !== KEY) {
    return res.status(401).json({ ok: false, error: "invalid api key" });
  }
  next();
}

/* 카카오 로그인 */
app.get("/kakao/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");

  const url =
    "https://kauth.kakao.com/oauth/authorize" +
    "?response_type=code" +
    "&client_id=" + encodeURIComponent(KAKAO_REST_API_KEY) +
    "&redirect_uri=" + encodeURIComponent(KAKAO_REDIRECT_URI) +
    "&scope=talk_message" +
    "&state=" + encodeURIComponent(state);

  res.redirect(url);
});

/* 카카오 로그인 콜백 */
app.get("/kakao/callback", async (req, res) => {
  try {
    if (!req.query.code) {
      return res.status(400).send("카카오 인증 코드가 없습니다.");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: KAKAO_REST_API_KEY,
      redirect_uri: KAKAO_REDIRECT_URI,
      code: req.query.code,
      client_secret: KAKAO_CLIENT_SECRET
    });

    const response = await fetch(
      "https://kauth.kakao.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=utf-8"
        },
        body
      }
    );

    const token = await response.json();

    if (!response.ok) {
      return res.status(400).send(
        "카카오 연결 실패: " +
        JSON.stringify(token)
      );
    }

    const d = rd();
    d.kakao = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
      refresh_token_expires_in:
        token.refresh_token_expires_in,
      savedAt: new Date().toISOString()
    };
    wr(d);

    res.send(`
      <h2>카카오톡 연결 완료</h2>
      <p>가격 변동 알림을 받을 준비가 되었습니다.</p>
      <p>이 창을 닫아도 됩니다.</p>
    `);
  } catch (e) {
    res.status(500).send(
      "카카오 연결 오류: " + e.message
    );
  }
});

app.get("/api/items", auth, (req, res) => {
  res.json({ ok: true, items: rd().items || [] });
});

app.post("/api/update", auth, (req, res) => {
  const b = req.body || {};
  const d = rd();

  const old =
    (d.items || []).find(x => x.url === b.url) || {};

  const oldOpts = old.options || [];
  const now = new Date().toISOString();

  const options = (b.options || []).map(o => {
    const prev =
      oldOpts.find(x => x.name === o.name) || {};

    const p = Number(o.price);

    return {
      name: o.name,
      price: p,
      previous: prev.price ?? null,
      lowest: prev.lowest
        ? Math.min(prev.lowest, p)
        : p,
      highest: prev.highest
        ? Math.max(prev.highest, p)
        : p
    };
  });

  const cp = Number.isFinite(Number(b.price))
    ? Number(b.price)
    : (options.find(o => o.selected)?.price ??
       options[0]?.price ??
       null);

  const item = {
    id: old.id || crypto.randomUUID(),
    url: b.url,
    name: b.name || "쿠팡 상품",
    price: cp,
    previous: old.price ?? null,
    lowest:
      cp == null
        ? old.lowest
        : old.lowest
          ? Math.min(old.lowest, cp)
          : cp,
    highest:
      cp == null
        ? old.highest
        : old.highest
          ? Math.max(old.highest, cp)
          : cp,
    options,
    updatedAt: now
  };

  d.items = [
    item,
    ...(d.items || []).filter(x => x.url !== b.url)
  ];

  wr(d);
  res.json({ ok: true, item });
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(PORT, () =>
  console.log("listening", PORT)
);
