"""Уведомления мастерам в мессенджере MAX.

Устроено как бот Telegram: сайт выдаёт одноразовый код → ссылка
max.ru/<бот>?start=<код> → бот получает событие bot_started с этим кодом
и запоминает user_id мастера. Обновления — long polling (GET /updates),
токен — в заголовке Authorization. Тексты уходят без разметки.
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from sqlalchemy import delete

from app.core import config
from app.models import MaxLink

logger = logging.getLogger("uvicorn.error")

_bot_username: str = config.MAX_BOT_USERNAME
_session_factory = None


def enabled() -> bool:
    return bool(config.MAX_BOT_TOKEN)


def bot_username() -> str:
    return _bot_username


def deep_link(code: str) -> str:
    return f"https://max.ru/{_bot_username}?start={code}"


async def _request(method: str, path: str, *, params: dict | None = None, json: dict | None = None, timeout: float = 15.0):
    if not enabled():
        return None, None
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.request(
                method,
                f"{config.MAX_API_BASE}{path}",
                params=params,
                json=json,
                headers={"Authorization": config.MAX_BOT_TOKEN},
            )
            try:
                body = res.json()
            except ValueError:
                body = None
            return res.status_code, body
    except Exception as exc:  # сеть, таймаут, сертификат
        logger.warning("[MAX] %s %s не удался: %s", method, path, exc)
        return None, None


async def send_message(max_user_id: str, text: str) -> bool:
    status, _ = await _request("POST", "/messages", params={"user_id": max_user_id}, json={"text": text[:4000]})
    if status in (403, 404) and _session_factory is not None:
        # бот заблокирован или чат удалён — отвязываем
        async with _session_factory() as session:
            await session.execute(delete(MaxLink).where(MaxLink.max_user_id == str(max_user_id)))
            await session.commit()
    return status == 200


async def notify_user(session, user_id: str, text: str) -> None:
    link = await session.get(MaxLink, user_id)
    if link is not None:
        await send_message(link.max_user_id, text)


def _sender_and_text(update: dict) -> tuple[str, str]:
    kind = update.get("update_type")
    if kind == "bot_started":
        uid = str((update.get("user") or {}).get("user_id") or "")
        payload = (update.get("payload") or "").strip()
        return uid, f"/start {payload}".strip()
    if kind == "message_created":
        msg = update.get("message") or {}
        uid = str((msg.get("sender") or {}).get("user_id") or "")
        text = ((msg.get("body") or {}).get("text") or "").strip()
        return uid, text
    return "", ""


async def handle_update(session, update: dict) -> str | None:
    """Обрабатывает одно обновление MAX; возвращает текст ответа (для тестов)."""
    from app.services import telegram  # коды привязки общие с Telegram

    uid, text = _sender_and_text(update)
    if not uid or not text:
        return None
    site = telegram._site_url
    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        code = parts[1].strip() if len(parts) > 1 else ""
        user_id = telegram.consume_code(code) if code else None
        if user_id:
            existing = await session.get(MaxLink, user_id)
            if existing is None:
                session.add(MaxLink(user_id=user_id, max_user_id=uid))
            else:
                existing.max_user_id = uid
            await session.commit()
            reply = (
                "🎄 Готово! Я буду сообщать, когда ваш шар зажигают, когда он станет «Шаром дня» "
                "и когда сомкнётся Кольцо Чудес.\nОтключить — команда /stop."
            )
        elif code:
            reply = "Ссылка устарела. Откройте Ёлку → Меню → «Уведомления» и нажмите кнопку ещё раз."
        else:
            reply = "Привет! Я бот Всемирной ёлки подарков 🎄 Подключите уведомления на сайте: Меню → «Уведомления»."
            if site:
                reply += f"\n{site}"
    elif text.startswith("/stop"):
        await session.execute(delete(MaxLink).where(MaxLink.max_user_id == uid))
        await session.commit()
        reply = "Уведомления отключены. Возвращайтесь на Ёлку! 🎄"
    else:
        reply = "Я умею только присылать новости Ёлки 🙂 Команды: /stop — отключить уведомления."
        if site:
            reply += f"\n{site}"
    await send_message(uid, reply)
    return reply


async def _poll_loop() -> None:
    global _bot_username
    status, me = await _request("GET", "/me")
    if status == 200 and isinstance(me, dict):
        _bot_username = _bot_username or str(me.get("username") or "")
        logger.info("[MAX] Бот %s на связи.", _bot_username or me.get("name"))
    else:
        logger.warning("[MAX] /me ответил %s — проверьте MAX_BOT_TOKEN.", status)
    marker = None
    while True:
        params = {"timeout": 25, "types": "bot_started,message_created"}
        if marker is not None:
            params["marker"] = marker
        status, data = await _request("GET", "/updates", params=params, timeout=40)
        if status != 200 or not isinstance(data, dict):
            await asyncio.sleep(5)
            continue
        marker = data.get("marker", marker)
        for upd in data.get("updates", []) or []:
            try:
                async with _session_factory() as session:
                    await handle_update(session, upd)
            except Exception:
                logger.exception("[MAX] ошибка обработки сообщения")


def start(session_factory) -> list[asyncio.Task]:
    global _session_factory
    _session_factory = session_factory
    if not enabled():
        logger.info("[MAX] MAX_BOT_TOKEN не задан — бот MAX выключен.")
        return []
    return [asyncio.create_task(_poll_loop())]


def bind_session_factory(session_factory) -> None:
    global _session_factory
    _session_factory = session_factory
