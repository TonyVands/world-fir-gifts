"""«Ярус памяти»: проверка портрета, картинка, запись и отпечаток OpenTimestamps.

Отпечаток: SHA-256 от точных байтов record_json (имя, даты, эпитафия, хеш
портрета, случайная «соль»). Хеш отправляется в публичные календари
OpenTimestamps, которые раз в несколько часов записывают общий корень в Bitcoin.
Получается файл .ots — его вместе с record.json можно проверить на
opentimestamps.org. Соль нужна, чтобы по хешу нельзя было подобрать имя: после
удаления памяти в цепочке остаётся только ничего не значащее число.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import secrets
from datetime import date, datetime

import httpx
from PIL import Image

from app.core import config

logger = logging.getLogger("worldfir.memorial")

EMPTY = 255
MIN_SIDE, MAX_SIDE = 16, 80

# Должны совпадать с frontend/src/lib/memorialMelodies.js
ENERGIES = ("light", "warm", "love", "wisdom", "nature", "strength", "sea")
MELODIES = (
    "moonlight", "chopin_prelude", "bach_air", "brahms_lullaby",
    "quiet_candle", "warm_light", "snow_city", "way_home",
)
MAX_PALETTE = 32

OTS_MAGIC = b"\x00OpenTimestamps\x00\x00Proof\x00\xbf\x89\xe2\xe8\x84\xe8\x92\x94"
OTS_OP_SHA256 = b"\x08"


class PortraitError(ValueError):
    pass


def _hex(c: str) -> tuple[int, int, int]:
    c = (c or "").strip().lstrip("#")
    if len(c) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in c):
        raise PortraitError("Неверный цвет в палитре портрета.")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def decode_portrait(p: dict) -> tuple[int, int, list[tuple[int, int, int]], bytes, bytes]:
    """Проверяет данные портрета и возвращает (w, h, палитра, пиксели, глубина)."""
    if not isinstance(p, dict):
        raise PortraitError("Нет портрета.")
    try:
        w, h = int(p.get("w", 0)), int(p.get("h", 0))
    except (TypeError, ValueError) as exc:
        raise PortraitError("Неверный размер портрета.") from exc
    if not (MIN_SIDE <= w <= MAX_SIDE and MIN_SIDE <= h <= MAX_SIDE):
        raise PortraitError("Размер портрета — от 16 до 80 кубиков по стороне.")
    palette_raw = p.get("palette") or []
    if not isinstance(palette_raw, list) or not (1 <= len(palette_raw) <= MAX_PALETTE):
        raise PortraitError("В портрете от 1 до 32 цветов.")
    palette = [_hex(c) for c in palette_raw]
    try:
        px = base64.b64decode(str(p.get("px", "")), validate=True)
        depth = base64.b64decode(str(p.get("depth", "")), validate=True)
    except (ValueError, TypeError) as exc:
        raise PortraitError("Повреждённые данные портрета.") from exc
    n = w * h
    if len(px) != n or len(depth) != n:
        raise PortraitError("Размер данных портрета не совпадает.")
    filled = 0
    for i in range(n):
        v = px[i]
        if v == EMPTY:
            continue
        if v >= len(palette) or depth[i] > 15:
            raise PortraitError("Повреждённые данные портрета.")
        filled += 1
    if filled < n * 0.25:
        raise PortraitError("Портрет почти пустой — выберите фото крупнее.")
    return w, h, palette, px, depth


def normalize_portrait(p: dict) -> dict:
    w, h, palette, px, depth = decode_portrait(p)
    return {
        "w": w,
        "h": h,
        "palette": ["#%02x%02x%02x" % c for c in palette],
        "px": base64.b64encode(px).decode(),
        "depth": base64.b64encode(depth).decode(),
    }


def portrait_png(p: dict, scale: int = 8, frame: bool = True) -> bytes:
    w, h, palette, px, depth = decode_portrait(p)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    data = []
    for i in range(w * h):
        v = px[i]
        if v == EMPTY:
            data.append((22, 26, 44, 255) if frame else (0, 0, 0, 0))
        else:
            r, g, b = palette[v]
            k = 0.82 + depth[i] / 15 * 0.28  # выпуклые места чуть светлее
            data.append((min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), 255))
    img.putdata(data)
    img = img.resize((w * scale, h * scale), Image.NEAREST)
    if frame:
        pad = scale * 2
        out = Image.new("RGBA", (img.width + pad * 2, img.height + pad * 2), (201, 168, 96, 255))
        inner = Image.new("RGBA", (img.width + scale * 2, img.height + scale * 2), (60, 44, 22, 255))
        out.paste(inner, (pad - scale, pad - scale))
        out.paste(img, (pad, pad), img)
        img = out
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def validate_dates(birth: str, death: str) -> None:
    def parse(s: str, field: str) -> date:
        s = (s or "").strip()
        try:
            if len(s) == 4:
                return date(int(s), 1, 1)
            return date.fromisoformat(s)
        except ValueError as exc:
            raise PortraitError(f"Неверная дата: {field}.") from exc

    d = parse(death, "дата ухода")
    if len(death.strip()) != 10:
        raise PortraitError("Укажите полную дату ухода (день, месяц, год).")
    if d > date.today() or d.year < 1800:
        raise PortraitError("Дата ухода должна быть в прошлом.")
    if birth:
        b = parse(birth, "дата рождения")
        if b > d or b.year < 1800:
            raise PortraitError("Дата рождения должна быть раньше даты ухода.")


def build_record(m_id: str, full_name: str, birth: str, death: str, epitaph: str, portrait: dict, created: datetime) -> tuple[str, str]:
    """Возвращает (record_json, sha256-hex). Байты record_json фиксируются навсегда."""
    portrait_hash = hashlib.sha256(json.dumps(portrait, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    record = {
        "type": "elka-mira-memory",
        "v": 1,
        "id": m_id,
        "name": full_name,
        "birth": birth or None,
        "death": death,
        "epitaph": epitaph or None,
        "portrait_sha256": portrait_hash,
        "created_at": created.replace(microsecond=0).isoformat(),
        "salt": secrets.token_hex(16),
    }
    text = json.dumps(record, ensure_ascii=False, sort_keys=True, indent=1) + "\n"
    return text, hashlib.sha256(text.encode("utf-8")).hexdigest()


def _merge_calendar_replies(replies: list[bytes]) -> bytes:
    """Объединяет ответы нескольких календарей в одно дерево (формат OTS).

    Ответ календаря — сериализованная ветка от нашего хеша. Ветки с одним
    корневым действием можно склеить: 0xff перед всеми, кроме последней.
    """
    simple = [r for r in replies if r and r[0] not in (0x00, 0xFF)]
    if not simple:
        return replies[0]
    out = b""
    for r in simple[:-1]:
        out += b"\xff" + r
    return out + simple[-1]


async def stamp(record_hash_hex: str) -> bytes | None:
    """Отправляет хеш в календари OpenTimestamps, возвращает файл .ots (или None)."""
    if not config.OTS_ENABLED:
        return None
    digest = bytes.fromhex(record_hash_hex)
    replies: list[bytes] = []
    async with httpx.AsyncClient(timeout=12.0) as client:
        for cal in config.OTS_CALENDARS:
            try:
                res = await client.post(
                    cal.rstrip("/") + "/digest",
                    content=digest,
                    headers={"Accept": "application/vnd.opentimestamps.v1", "User-Agent": "elka-mira"},
                )
                if res.status_code == 200 and res.content and len(res.content) < 10000:
                    replies.append(res.content)
            except Exception as exc:  # noqa: BLE001 — сеть, таймаут
                logger.warning("[OTS] календарь %s недоступен: %s", cal, exc)
    if not replies:
        return None
    return OTS_MAGIC + b"\x01" + OTS_OP_SHA256 + digest + _merge_calendar_replies(replies)


async def decide(session, memorial, approve: bool) -> None:
    """Решение модератора. При одобрении — отпечаток в OpenTimestamps."""
    from datetime import timezone

    if approve:
        memorial.status = "approved"
        memorial.approved_at = datetime.now(timezone.utc)
        if memorial.ots_status != "submitted" and memorial.record_hash:
            proof = await stamp(memorial.record_hash)
            memorial.ots_proof = proof
            memorial.ots_status = "submitted" if proof else "failed"
    else:
        memorial.status = "rejected"
    await session.commit()


async def retry_failed_stamps(session) -> int:
    """Повторяет отпечатки, которые не удались (календари были недоступны)."""
    from sqlalchemy import select

    from app.models import Memorial

    rows = (
        await session.execute(
            select(Memorial).where(Memorial.status == "approved", Memorial.ots_status == "failed").limit(20)
        )
    ).scalars().all()
    done = 0
    for m in rows:
        proof = await stamp(m.record_hash)
        if proof:
            m.ots_proof, m.ots_status = proof, "submitted"
            done += 1
    if rows:
        await session.commit()
    return done
