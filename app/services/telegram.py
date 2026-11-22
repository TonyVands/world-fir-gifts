"""Уведомления мастерам в Telegram.

Привязка: сайт выдаёт одноразовый код → ссылка t.me/<бот>?start=<код> →
бот получает «/start <код>» и запоминает chat_id мастера. Бот работает
long polling'ом (getUpdates) — публичный вебхук не нужен, хватает одного
воркера. События: свечи-рубежи, «Шар дня», «до Кольца Чудес час», полночь.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import delete, func, select

from app.core import config
from app.core.unlock import get_unlock_timestamp
import html
import json

from app.models import AppFlag, CandleLight, Gift, MaxLink, TelegramLink, User
from app.services import max_bot

logger = logging.getLogger("uvicorn.error")

API = "https://api.telegram.org/bot{token}/{method}"
CANDLE_MILESTONES = {1, 5, 10, 25, 50, 100, 200, 500}
CODE_TTL_S = 15 * 60

_codes: dict[str, tuple[str, float]] = {}  # код → (user_id, истекает)
_bot_username: str = config.TELEGRAM_BOT_USERNAME
_session_factory = None
_site_url = config.PUBLIC_URL.rstrip("/") if config.PUBLIC_URL else ""


def enabled() -> bool:
    return bool(config.TELEGRAM_BOT_TOKEN)


def bot_username() -> str:
    return _bot_username


def issue_code(user_id: str) -> str:
    now = time.monotonic()
    for k, (_, exp) in list(_codes.items()):
        if exp < now:
            _codes.pop(k, None)
    code = secrets.token_urlsafe(12).replace("-", "a").replace("_", "b")
    _codes[code] = (user_id, now + CODE_TTL_S)
    return code


def consume_code(code: str) -> str | None:
    item = _codes.pop(code, None)
    if not item or item[1] < time.monotonic():
        return None
    return item[0]


async def _call(method: str, payload: dict, timeout: float = 15.0) -> dict | None:
    if not enabled():
        return None
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(API.format(token=config.TELEGRAM_BOT_TOKEN, method=method), json=payload)
            return res.json()
    except Exception as exc:  # сеть, таймаут
        logger.warning("[Telegram] %s не удался: %s", method, exc)
        return None


async def send_message(chat_id: str, text: str) -> bool:
    data = await _call(
        "sendMessage",
        {"chat_id": chat_id, "text": text, "disable_web_page_preview": False, "parse_mode": "HTML"},
    )
    if data and not data.get("ok") and data.get("error_code") == 403:
        # бот заблокирован — отвязываем, чтобы не стучаться впустую
        if _session_factory is not None:
            async with _session_factory() as session:
                await session.execute(delete(TelegramLink).where(TelegramLink.chat_id == str(chat_id)))
                await session.commit()
    return bool(data and data.get("ok"))


def _esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def gift_link(gift_id: str) -> str:
    return f"{_site_url}/g/{gift_id}" if _site_url else ""


async def notify_user(session, user_id: str, text: str) -> None:
    """Сообщение мастеру во все подключённые мессенджеры (Telegram, MAX)."""
    link = await session.get(TelegramLink, user_id)
    if link is not None:
        await send_message(link.chat_id, text)
    if max_bot.enabled():
        await max_bot.notify_user(session, user_id, html.unescape(text))


def any_enabled() -> bool:
    return enabled() or max_bot.enabled()


def schedule(coro) -> None:
    """Отправка в фоне: запрос пользователя не ждёт мессенджеры."""
    if not any_enabled():
        coro.close()
        return
    try:
        asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        coro.close()


async def notify_candle(gift_id: str) -> None:
    """Вызывается после свечи: сообщаем автору о круглых числах."""
    if _session_factory is None:
        return
    async with _session_factory() as session:
        gift = await session.get(Gift, gift_id)
        if gift is None:
            return
        received = max(0, (gift.candles_count or 1) - 1)
        if received not in CANDLE_MILESTONES:
            return
        tag = _esc((gift.card_preview or {}).get("teaser_tag", "ваш шар"))
        if received == 1:
            text = f"🕯 Кто-то зажёг первую свечу у шара «{tag}»!"
        else:
            text = f"🕯 Шар «{tag}» зажгли уже {received} раз!"
        link = gift_link(gift.id)
        if link:
            text += f"\n{link}"
        await notify_user(session, gift.author_id, text)


# ---------------------------------------------------------------------------
# Входящие сообщения бота
# ---------------------------------------------------------------------------
async def send_memorial_for_review(memorial_id: str) -> bool:
    """Модератору: портрет памяти с кнопками «Показать» / «Отклонить»."""
    if not (enabled() and config.TELEGRAM_ADMIN_CHAT_ID and _session_factory is not None):
        return False
    from app.models import Memorial
    from app.services import memorial as memsvc

    async with _session_factory() as session:
        m = await session.get(Memorial, memorial_id)
        if m is None:
            return False
        try:
            png = memsvc.portrait_png(m.portrait, scale=8)
        except ValueError:
            png = b""
        years = f"{m.birth_date[:4] + ' – ' if m.birth_date else ''}{m.death_date}"
        caption = (
            f"🕊 Новая память на проверку\n<b>{_esc(m.full_name)}</b>, {_esc(years)}\n"
            f"Кем приходится: {_esc(m.relation or '—')}\n«{_esc(m.epitaph or '')}»"
        )[:1000]
    markup = {
        "inline_keyboard": [[
            {"text": "✅ Показать", "callback_data": f"mem:ok:{memorial_id}"},
            {"text": "❌ Отклонить", "callback_data": f"mem:no:{memorial_id}"},
        ]]
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(
                API.format(token=config.TELEGRAM_BOT_TOKEN, method="sendPhoto"),
                data={
                    "chat_id": config.TELEGRAM_ADMIN_CHAT_ID,
                    "caption": caption,
                    "parse_mode": "HTML",
                    "reply_markup": json.dumps(markup),
                },
                files={"photo": ("portrait.png", png, "image/png")},
            )
            return bool(res.json().get("ok"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Telegram] не удалось отправить память на проверку: %s", exc)
        return False


async def _handle_callback(session, cq: dict) -> str | None:
    data = cq.get("data") or ""
    chat_id = str(((cq.get("message") or {}).get("chat") or {}).get("id") or "")
    if not data.startswith("mem:") or not config.TELEGRAM_ADMIN_CHAT_ID or chat_id != config.TELEGRAM_ADMIN_CHAT_ID:
        await _call("answerCallbackQuery", {"callback_query_id": cq.get("id", ""), "text": "Нет доступа"})
        return None
    from app.models import Memorial
    from app.services import memorial as memsvc

    _, action, mid = (data.split(":", 2) + ["", ""])[:3]
    m = await session.get(Memorial, mid)
    if m is None:
        answer = "Память уже удалена"
    else:
        await memsvc.decide(session, m, approve=(action == "ok"))
        answer = "Показана на Ёлке 🕊" if action == "ok" else "Отклонена"
        msg = cq.get("message") or {}
        await _call(
            "editMessageCaption",
            {
                "chat_id": chat_id,
                "message_id": msg.get("message_id"),
                "caption": ((msg.get("caption") or "") + f"\n\n→ {answer}")[:1000],
            },
        )
    await _call("answerCallbackQuery", {"callback_query_id": cq.get("id", ""), "text": answer})
    return answer


async def handle_update(session, update: dict) -> str | None:
    """Обрабатывает одно обновление; возвращает текст ответа (для тестов)."""
    if update.get("callback_query"):
        return await _handle_callback(session, update["callback_query"])
    msg = update.get("message") or {}
    chat_id = str((msg.get("chat") or {}).get("id") or "")
    text = (msg.get("text") or "").strip()
    if not chat_id or not text:
        return None
    reply: str
    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        code = parts[1].strip() if len(parts) > 1 else ""
        user_id = consume_code(code) if code else None
        if user_id:
            existing = await session.get(TelegramLink, user_id)
            if existing is None:
                session.add(TelegramLink(user_id=user_id, chat_id=chat_id))
            else:
                existing.chat_id = chat_id
            await session.commit()
            reply = (
                "🎄 Готово! Я буду сообщать, когда ваш шар зажигают, когда он станет «Шаром дня» "
                "и когда сомкнётся Кольцо Чудес.\nОтключить — команда /stop."
            )
        elif code:
            reply = "Ссылка устарела. Откройте Ёлку → Меню → «Уведомления» и нажмите кнопку ещё раз."
        else:
            reply = "Привет! Я бот Всемирной ёлки подарков 🎄 Подключите уведомления на сайте: Меню → «Уведомления»."
            if _site_url:
                reply += f"\n{_site_url}"
    elif text.startswith("/myid"):
        reply = f"id этого чата: {chat_id}\nЧтобы получать сюда памяти на проверку, укажите его в TELEGRAM_ADMIN_CHAT_ID."
    elif text.startswith("/stop"):
        await session.execute(delete(TelegramLink).where(TelegramLink.chat_id == chat_id))
        await session.commit()
        reply = "Уведомления отключены. Возвращайтесь на Ёлку! 🎄"
    else:
        reply = "Я умею только присылать новости Ёлки 🙂 Команды: /stop — отключить уведомления."
    await send_message(chat_id, reply)
    return reply


async def _poll_loop() -> None:
    global _bot_username
    me = await _call("getMe", {})
    if me and me.get("ok"):
        _bot_username = _bot_username or me["result"].get("username", "")
        logger.info("[Telegram] Бот @%s на связи.", _bot_username)
    await _call("deleteWebhook", {"drop_pending_updates": False})
    offset = 0
    while True:
        data = await _call("getUpdates", {"timeout": 25, "offset": offset, "allowed_updates": ["message", "callback_query"]}, timeout=35)
        if not data or not data.get("ok"):
            await asyncio.sleep(5)
            continue
        for upd in data.get("result", []):
            offset = max(offset, int(upd.get("update_id", 0)) + 1)
            try:
                async with _session_factory() as session:
                    await handle_update(session, upd)
            except Exception:
                logger.exception("[Telegram] ошибка обработки сообщения")


# ---------------------------------------------------------------------------
# Плановые рассылки
# ---------------------------------------------------------------------------
async def _flag_done(session, key: str) -> bool:
    return (await session.get(AppFlag, key)) is not None


async def _set_flag(session, key: str, value: str = "1") -> None:
    session.add(AppFlag(key=key, value=value))
    await session.commit()


async def _broadcast(session, text: str) -> int:
    rows = (
        await session.execute(
            select(TelegramLink.chat_id).join(Gift, Gift.author_id == TelegramLink.user_id).distinct()
        )
    ).all()
    sent = 0
    for (chat_id,) in rows:
        if await send_message(chat_id, text):
            sent += 1
        await asyncio.sleep(0.05)  # ≤ 20 сообщений в секунду
    if max_bot.enabled():
        max_rows = (
            await session.execute(select(MaxLink.max_user_id).join(Gift, Gift.author_id == MaxLink.user_id).distinct())
        ).all()
        plain = html.unescape(text)
        for (uid,) in max_rows:
            if await max_bot.send_message(uid, plain):
                sent += 1
            await asyncio.sleep(0.05)
    return sent


async def run_daily_and_ring_jobs(session, now: datetime | None = None) -> list[str]:
    """Один проход планировщика; возвращает список выполненных задач (для тестов)."""
    now = now or datetime.now(timezone.utc)
    done: list[str] = []
    # «Шар дня» за вчера — один раз в сутки
    yesterday = config.candle_day(now - timedelta(days=1))
    key = f"ball_of_day:{yesterday}"
    if not await _flag_done(session, key):
        cnt = func.count(CandleLight.id)
        top = (
            await session.execute(
                select(CandleLight.gift_id, cnt)
                .where(CandleLight.day == yesterday)
                .group_by(CandleLight.gift_id)
                .order_by(cnt.desc(), func.min(CandleLight.created_at).asc())
                .limit(1)
            )
        ).first()
        if top:
            gift = await session.get(Gift, top[0])
            if gift is not None and not gift.is_quarantined:
                tag = _esc((gift.card_preview or {}).get("teaser_tag", "ваш шар"))
                text = f"👑 Ваш шар «{tag}» стал Шаром дня — {top[1]} свечей за сутки!"
                link = gift_link(gift.id)
                await notify_user(session, gift.author_id, text + (f"\n{link}" if link else ""))
        await _set_flag(session, key, top[0] if top else "")
        done.append(key)
    # Кольцо Чудес: за час и в полночь
    unlock = get_unlock_timestamp()
    if unlock.tzinfo is None:
        unlock = unlock.replace(tzinfo=timezone.utc)
    for tag, at, text in (
        ("ring_1h", unlock - timedelta(hours=1), "⏳ До Кольца Чудес остался час! Загляните на Ёлку — успейте зажечь свечи любимым шарам."),
        ("ring_open", unlock, "🎆 С Новым годом! Кольцо Чудес сомкнулось — откройте Ёлку и узнайте, чей шар достался вам."),
    ):
        k = f"{tag}:{unlock.isoformat()}"
        if at <= now < at + timedelta(hours=2) and not await _flag_done(session, k):
            await _set_flag(session, k)
            suffix = f"\n{_site_url}" if _site_url else ""
            await _broadcast(session, text + suffix)
            done.append(k)
    return done


async def _schedule_loop() -> None:
    while True:
        try:
            async with _session_factory() as session:
                await run_daily_and_ring_jobs(session)
        except Exception:
            logger.exception("[Telegram] ошибка плановой рассылки")
        await asyncio.sleep(60)


def start(session_factory) -> list[asyncio.Task]:
    global _session_factory
    _session_factory = session_factory
    tasks = max_bot.start(session_factory)
    if enabled():
        tasks.append(asyncio.create_task(_poll_loop()))
    else:
        logger.info("[Telegram] TELEGRAM_BOT_TOKEN не задан — бот Telegram выключен.")
    if tasks:
        tasks.append(asyncio.create_task(_schedule_loop()))
    return tasks


def bind_session_factory(session_factory) -> None:
    global _session_factory
    _session_factory = session_factory
    max_bot.bind_session_factory(session_factory)
