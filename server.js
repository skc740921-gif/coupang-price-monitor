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

const NTFY_TOPIC =
  process.env.NTFY_TOPIC || "withjuni-price-740921";

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
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
}

function auth(req, res, next) {
  if ((req.header("x-api-key") || req.query.key) !== KEY) {
    return res.status(401).json({
      ok: false,
      error: "invalid api key"
    });
  }
  next();
}

function formFetch(url, params) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":
        "application/x-www-form-urlencoded;charset=utf-8"
    },
    body: new URLSearchParams(params)
  });
}

function won(v) {
  return Number(v || 0).toLocaleString("ko-KR") + "원";
}

function makeChangeMessage(name, changes) {
  const lines = (changes || []).map(c => {
    const previous = Number(c.previous);
    const price = Number(c.price);
    const diff =
      c.diff != null
        ? Number(c.diff)
        : price - previous;

    const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "―";

    return (
      (c.name || "가격") +
      ": " +
      won(previous) +
      " → " +
      won(price) +
      " " +
      arrow +
      won(Math.abs(diff))
    );
  });

  return (
    "쿠팡 가격 변동\n" +
    (name || "쿠팡 상품") +
    "\n" +
    lines.join("\n")
  );
}

// =====================
// ntfy
// =====================

async function sendNtfy(text) {
  const response = await fetch("https://ntfy.sh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      topic: NTFY_TOPIC,
      title: "쿠팡 가격 변동",
      message: text,
      priority: 5,
      tags: ["warning"]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error("ntfy HTTP " + response.status + " " + body);
  }

  return true;
}

// =====================
// Kakao
// =====================

async function kakaoAccessToken() {
  const d = rd();
  const k = d.kakao || {};

  if (!k.refresh_token && !k.access_token) {
    throw new Error("카카오 로그인이 필요합니다.");
  }

  if (
    k.access_token &&
    k.accessExpiresAt &&
    Date.now() < k.accessExpiresAt - 60000
  ) {
    return k.access_token;
  }

  if (!k.refresh_token) {
    return k.access_token;
  }

  const params = {
    grant_type: "refresh_token",
    client_id: KAKAO_REST_API_KEY,
    refresh_token: k.refresh_token
  };

  if (KAKAO_CLIENT_SECRET) {
    params.client_secret = KAKAO_CLIENT_SECRET;
  }

  const response = await formFetch(
    "https://kauth.kakao.com/oauth/token",
    params
  );

  const token = await response.json();

  if (!response.ok) {
    throw new Error(
      "카카오 토큰 갱신 실패: " + JSON.stringify(token)
    );
  }

  k.access_token = token.access_token;
  k.accessExpiresAt =
    Date.now() +
    Number(token.expires_in || 21600) * 1000;

  if (token.refresh_token) {
    k.refresh_token = token.refresh_token;
  }

  if (token.refresh_token_expires_in) {
    k.refreshExpiresAt =
      Date.now() +
      Number(token.refresh_token_expires_in) * 1000;
  }

  d.kakao = k;
  wr(d);

  return k.access_token;
}

async function sendKakao(text) {
  const token = await kakaoAccessToken();

  const template = {
    object_type: "text",
    text,
    link: {
      web_url:
        "https://coupang-price-monitor.onrender.com",
      mobile_web_url:
        "https://coupang-price-monitor.onrender.com"
    },
    button_title: "가격 모니터 열기"
  };

  const response = await fetch(
    "https://kapi.kakao.com/v2/api/talk/memo/default/send",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type":
          "application/x-www-form-urlencoded;charset=utf-8"
      },
      body: new URLSearchParams({
        template_object: JSON.stringify(template)
      })
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      "카카오 메시지 실패: " + JSON.stringify(result)
    );
  }

  return result;
}

// =====================
// Kakao login
// =====================

app.get("/kakao/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");

  const d = rd();
  d.kakaoState = state;
  wr(d);

  const url =
    new URL("https://kauth.kakao.com/oauth/authorize");

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", KAKAO_REST_API_KEY);
  url.searchParams.set("redirect_uri", KAKAO_REDIRECT_URI);
  url.searchParams.set("scope", "talk_message");
  url.searchParams.set("state", state);

  res.redirect(url.toString());
});

app.get("/kakao/callback", async (req, res) => {
  try {
    const d = rd();

    if (!req.query.code) {
      return res.status(400).send(
        "카카오 인증 코드가 없습니다."
      );
    }

    if (
      d.kakaoState &&
      req.query.state !== d.kakaoState
    ) {
      return res.status(400).send(
        "카카오 인증 state가 일치하지 않습니다."
      );
    }

    const params = {
      grant_type: "authorization_code",
      client_id: KAKAO_REST_API_KEY,
      redirect_uri: KAKAO_REDIRECT_URI,
      code: req.query.code
    };

    if (KAKAO_CLIENT_SECRET) {
      params.client_secret = KAKAO_CLIENT_SECRET;
    }

    const response = await formFetch(
      "https://kauth.kakao.com/oauth/token",
      params
    );

    const token = await response.json();

    if (!response.ok) {
      return res.status(400).send(
        "카카오 연결 실패: " + JSON.stringify(token)
      );
    }

    d.kakao = {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      accessExpiresAt:
        Date.now() +
        Number(token.expires_in || 21600) * 1000,
      refreshExpiresAt:
        Date.now() +
        Number(
          token.refresh_token_expires_in || 0
        ) * 1000,
      savedAt: new Date().toISOString()
    };

    delete d.kakaoState;
    wr(d);

    res.send(
      "<h2>카카오톡 연결 완료</h2>" +
      "<p>가격 변동 알림을 받을 준비가 되었습니다.</p>"
    );
  } catch (e) {
    res.status(500).send(
      "카카오 연결 오류: " + e.message
    );
  }
});

// =====================
// Items
// =====================

app.get("/api/items", auth, (req, res) => {
  res.json({
    ok: true,
    items: rd().items || []
  });
});

// =====================
// Test
// =====================

app.post("/api/notify-test", auth, async (req, res) => {
  const result = {
    ok: true,
    kakao: false,
    ntfy: false
  };

  try {
    await sendNtfy(
      "쿠팡 가격 모니터 휴대폰 알림 테스트입니다."
    );
    result.ntfy = true;
  } catch (e) {
    result.ntfyError = e.message;
  }

  try {
    await sendKakao(
      "쿠팡 가격 모니터 테스트\n카카오톡 알림 연결이 정상입니다."
    );
    result.kakao = true;
  } catch (e) {
    result.kakaoError = e.message;
  }

  res.json(result);
});

// =====================
// Extension change notify
// =====================

app.post("/api/notify-change", auth, async (req, res) => {
  const b = req.body || {};

  let message = "";

  if (Array.isArray(b.changes) && b.changes.length) {
    message = makeChangeMessage(
      b.name || b.productName,
      b.changes
    );
  } else if (b.text || b.message) {
    message = b.text || b.message;
  } else {
    message = "쿠팡 상품 가격이 변경되었습니다.";
  }

  const result = {
    ok: true,
    kakao: false,
    ntfy: false,
    message
  };

  try {
    await sendNtfy(message);
    result.ntfy = true;
  } catch (e) {
    result.ntfyError = e.message;
  }

  try {
    await sendKakao(message);
    result.kakao = true;
  } catch (e) {
    result.kakaoError = e.message;
  }

  res.json(result);
});

// =====================
// Price update
// =====================

app.post("/api/update", auth, async (req, res) => {
  const b = req.body || {};
  const d = rd();

  const old =
    (d.items || []).find(x => x.url === b.url) || {};

  const oldOptions = old.options || [];
  const changes = [];

  const options = (b.options || []).map(o => {
    const prev =
      oldOptions.find(x => x.name === o.name) || {};

    const price = Number(o.price);

    if (
      prev.price != null &&
      Number(prev.price) !== price
    ) {
      changes.push({
        name: o.name,
        previous: Number(prev.price),
        price,
        diff: price - Number(prev.price)
      });
    }

    return {
      name: o.name,
      price,
      selected: !!o.selected,
      previous: prev.price ?? null,
      lowest:
        prev.lowest != null
          ? Math.min(Number(prev.lowest), price)
          : price,
      highest:
        prev.highest != null
          ? Math.max(Number(prev.highest), price)
          : price
    };
  });

  const currentPrice =
    Number.isFinite(Number(b.price))
      ? Number(b.price)
      : options.find(o => o.selected)?.price ??
        options[0]?.price ??
        null;

  if (
    !changes.length &&
    !options.length &&
    old.price != null &&
    currentPrice != null &&
    Number(old.price) !== currentPrice
  ) {
    changes.push({
      name: "대표가격",
      previous: Number(old.price),
      price: currentPrice,
      diff: currentPrice - Number(old.price)
    });
  }

  const item = {
    id: old.id || crypto.randomUUID(),
    url: b.url,
    name: b.name || "쿠팡 상품",
    price: currentPrice,
    previous: old.price ?? null,
    lowest:
      currentPrice == null
        ? old.lowest
        : old.lowest != null
        ? Math.min(Number(old.lowest), currentPrice)
        : currentPrice,
    highest:
      currentPrice == null
        ? old.highest
        : old.highest != null
        ? Math.max(Number(old.highest), currentPrice)
        : currentPrice,
    options,
    updatedAt: new Date().toISOString()
  };

  d.items = [
    item,
    ...(d.items || []).filter(x => x.url !== b.url)
  ];

  wr(d);

  const notify = {
    kakao: false,
    ntfy: false
  };

  if (changes.length) {
    const message =
      makeChangeMessage(item.name, changes);

    try {
      await sendNtfy(message);
      notify.ntfy = true;
    } catch (e) {
      notify.ntfyError = e.message;
    }

    try {
      await sendKakao(message);
      notify.kakao = true;
    } catch (e) {
      notify.kakaoError = e.message;
    }
  }

  res.json({
    ok: true,
    item,
    changes,
    notify
  });
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(PORT, () => {
  console.log("listening", PORT);
});
