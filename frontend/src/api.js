const API_BASE = "/api";
const SESSION_HEADER = "X-Session-Token";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Сессия без регистрации: криптостойкий токен в localStorage, на сервере — его хеш.
// ---------------------------------------------------------------------------
const TOKEN_KEY = "wfg_session_fingerprint"; // имя ключа сохранено ради старых сессий
let memoryToken = null;

function generateToken() {
  const bytes = new Uint8Array(32);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `wfg2-${b64}`;
}

export function getSessionToken() {
  try {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token || token === "keeper-anonymous" || token.length < 16) {
      token = generateToken();
      localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch {
    // Приватный режим/запрет хранилища: живём с токеном до перезагрузки вкладки.
    if (!memoryToken) memoryToken = generateToken();
    return memoryToken;
  }
}

/** @deprecated оставлено для совместимости импортов */
export const getSessionFingerprint = getSessionToken;

async function request(path, { method = "GET", body, timeoutMs = 8000, auth = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth) headers[SESSION_HEADER] = getSessionToken();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const payload = await res.json();
        if (payload && payload.detail) {
          detail = Array.isArray(payload.detail)
            ? "Проверьте заполнение полей: часть данных не прошла проверку."
            : String(payload.detail);
        }
      } catch {
        /* пустое тело ошибки */
      }
      throw new ApiError(detail, res.status);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Ошибка сети/таймаут (сервер не ответил) — в отличие от отказа сервера. */
export function isNetworkError(err) {
  return !(err instanceof ApiError);
}

export const fetchGifts = () => request("/gifts", { auth: false, timeoutMs: 15000 });

export const createGift = (payload) => request("/gifts", { method: "POST", body: payload });

export const fetchMyGift = (giftId) => request(`/gifts/${encodeURIComponent(giftId)}/mine`);
export const updateGift = (giftId, payload) =>
  request(`/gifts/${encodeURIComponent(giftId)}`, { method: "PUT", body: payload });

export const lightGiftCandle = (giftId) =>
  request(`/gifts/${encodeURIComponent(giftId)}/candle`, { method: "POST" });

// Свечи дня: суточный запас огоньков и лидеры по свечам за сутки.
export const fetchCandleStatus = () => request("/gifts/candles/status");
export const fetchCandleLeaders = () => request("/gifts/leaders", { auth: false });

export const fetchWorldMap = () => request("/world/map", { auth: false });
export const fetchCityLeaders = (city) =>
  request(`/world/city-leaders${city ? `?city=${encodeURIComponent(city)}` : ""}`, { auth: false });
export const fetchAchievements = () => request("/world/achievements");

export const fetchTelegramStatus = () => request("/telegram/status");
export const createTelegramLink = () => request("/telegram/link", { method: "POST" });
export const deleteTelegramLink = () => request("/telegram/link", { method: "DELETE" });
export const fetchMaxStatus = () => request("/max/status");
export const createMaxLink = () => request("/max/link", { method: "POST" });
export const deleteMaxLink = () => request("/max/link", { method: "DELETE" });

export const fetchMyCollection = async () => {
  // на телефоне с тяжёлой 3D-сценой первый ответ может прийти позже — даём время и одну повторную попытку
  try {
    return await request("/gifts/collection/me", { timeoutMs: 20000 });
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await new Promise((r) => setTimeout(r, 800));
    return request("/gifts/collection/me", { timeoutMs: 20000 });
  }
};

export const reportGift = (giftId, reason = "other") =>
  request(`/gifts/${encodeURIComponent(giftId)}/report`, { method: "POST", body: { reason } });

export const fetchMyProfile = () => request("/users/me");
export const deleteMyData = () => request("/users/me", { method: "DELETE" });
export const fetchWorldStats = () => request("/world/stats", { auth: false });

export const fetchRingStatus = () => request("/ring/status", { auth: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Пары Кольца. В полночь все жмут «открыть» одновременно — добавляем небольшой
 * случайный разброс и повторы при 429/503/сетевых сбоях, чтобы не устроить
 * серверу «новогодний DDoS» и не показывать людям ошибку.
 */
export async function fetchMyRing({ jitterMs = 0, retries = 3 } = {}) {
  if (jitterMs > 0) await sleep(Math.random() * jitterMs);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await request("/handshakes/my-ring");
    } catch (err) {
      lastErr = err;
      const retryable = isNetworkError(err) || err.status === 429 || err.status >= 500;
      if (!retryable || attempt === retries) break;
      await sleep(1000 * 2 ** attempt + Math.random() * 1000);
    }
  }
  throw lastErr;
}

export const giveHandshakeConsent = (handshakeId) =>
  request(`/handshakes/${encodeURIComponent(handshakeId)}/consent`, { method: "POST" });

export function connectTreeEvents(onEvent) {
  let socket = null;
  let pingTimer = null;
  let reconnectTimer = null;
  let stopped = false;
  let attempt = 0;

  const open = () => {
    try {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${proto}://${window.location.host}/ws/tree-events`);
    } catch {
      return;
    }
    socket.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg && msg.event && msg.event !== "PONG") onEvent(msg.event, msg.data || {});
      } catch {
        /* игнорируем не-JSON кадры */
      }
    };
    socket.onopen = () => {
      attempt = 0;
      pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, 25000);
    };
    socket.onclose = () => {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      if (stopped) return;
      // Переподключение с экспоненциальной задержкой и разбросом (рестарт/деплой сервера).
      const delay = Math.min(60000, 2000 * 2 ** attempt) + Math.random() * 3000;
      attempt += 1;
      reconnectTimer = setTimeout(open, delay);
    };
  };

  open();
  return () => {
    stopped = true;
    if (pingTimer) clearInterval(pingTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      socket?.close();
    } catch {
      /* уже закрыт */
    }
  };
}

export function giftNodeFromDTO(dto) {
  return {
    id: dto.id,
    author_id: null,
    created_order: dto.created_order,
    quality_score: dto.quality_score,
    quality_tier_badge: dto.quality_tier_badge,
    coordinates: dto.coordinates,
    snowglobe: dto.snowglobe,
    packaging: dto.packaging,
    melody: dto.melody,
    card_preview: dto.card_preview,
    wish_char_count: dto.wish_char_count,
    candles_count: dto.candles_count,
    genome_hash: dto.genome_hash,
    created_at: dto.created_at,
    offline: false,
  };
}

// Свечи, зажжённые в этом браузере СЕГОДНЯ (сутки по Москве). Источник
// истины — сервер (/gifts/candles/status); здесь лишь кеш на случай офлайна.
const LIT_KEY = "wfg_lit_candles_day";

export function candleDayMoscow(nowMs = Date.now()) {
  return new Date(nowMs + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function loadLitGiftIds() {
  try {
    const obj = JSON.parse(localStorage.getItem(LIT_KEY) || "null");
    if (!obj || obj.day !== candleDayMoscow() || !Array.isArray(obj.ids)) return new Set();
    return new Set(obj.ids.slice(-500));
  } catch {
    return new Set();
  }
}

export function saveLitGiftIds(set) {
  try {
    localStorage.setItem(LIT_KEY, JSON.stringify({ day: candleDayMoscow(), ids: [...set].slice(-500) }));
  } catch {
    /* хранилище недоступно */
  }
}

// «Ярус памяти»
export const fetchMemorials = () => request("/memorials");
export const fetchMemorial = (id, kin = "") =>
  request(`/memorials/${encodeURIComponent(id)}${kin ? `?kin=${encodeURIComponent(kin)}` : ""}`);
export const confirmMemorialKin = (id, body) =>
  request(`/memorials/${encodeURIComponent(id)}/kin`, { method: "POST", body });
export const createMemorial = (payload) => request("/memorials", { method: "POST", body: payload, timeoutMs: 15000 });
export const lightMemorialCandle = (id) => request(`/memorials/${encodeURIComponent(id)}/candle`, { method: "POST" });
export const reportMemorial = (id, reason) => request(`/memorials/${encodeURIComponent(id)}/report`, { method: "POST", body: { reason } });
export const deleteMemorial = (id) => request(`/memorials/${encodeURIComponent(id)}`, { method: "DELETE" });
