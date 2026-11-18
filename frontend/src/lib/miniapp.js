// Запуск внутри мессенджера как мини-приложение (Telegram Mini App).
// Сайт тот же самый: если его открыли из меню бота, подключаем SDK Telegram,
// разворачиваем окно на весь экран и открываем шар из start_param (g_<id>).
// Обычных посетителей это не касается — скрипт грузится только в Telegram.

const TG_SDK = "https://telegram.org/js/telegram-web-app.js";

export function insideTelegram() {
  if (typeof window === "undefined") return false;
  const h = window.location.hash || "";
  const q = window.location.search || "";
  return h.includes("tgWebAppData") || q.includes("tgWebAppStartParam");
}

function applyStartParam(param) {
  const m = /^g_([0-9a-fA-F-]{8,40})$/.exec(param || "");
  if (m && !window.location.pathname.startsWith("/g/")) {
    window.history.replaceState(null, "", `/g/${m[1]}`);
  }
}

export function bootMiniApp() {
  if (!insideTelegram()) return Promise.resolve(null);
  // start_param может прийти и в адресе — применяем до запуска приложения
  const qp = new URLSearchParams(window.location.search).get("tgWebAppStartParam");
  if (qp) applyStartParam(qp);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = TG_SDK;
    s.async = true;
    const done = () => {
      const wa = window.Telegram?.WebApp;
      try {
        wa?.ready();
        wa?.expand();
        wa?.setHeaderColor?.("#060a18");
        wa?.setBackgroundColor?.("#060a18");
        applyStartParam(wa?.initDataUnsafe?.start_param);
      } catch {
        /* старый клиент Telegram */
      }
      resolve(wa || null);
    };
    s.onload = done;
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
    window.setTimeout(() => resolve(null), 2500); // не держим запуск, если сеть медленная
  });
}
