"""Карта мира шаров, «Шар дня» по городам и ачивки мастера."""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.core.auth import find_user_by_hash, optional_session_hash
from app.database import get_db
from app.models import CandleLight, Gift, GiftCandle, User
from app.services.geo import city_coords, city_key

router = APIRouter(prefix="/api/world", tags=["world"])

_map_cache: dict = {"at": 0.0, "data": None}


@router.get("/map")
async def world_map(response: Response, session: AsyncSession = Depends(get_db)):
    """Города, откуда повешены шары: координаты, число шаров и свечей."""
    response.headers["Cache-Control"] = "public, max-age=60"
    if _map_cache["data"] is not None and time.monotonic() - _map_cache["at"] < 60:
        return _map_cache["data"]
    rows = (
        await session.execute(
            select(Gift.card_preview, Gift.candles_count).where(Gift.is_quarantined.is_(False))
        )
    ).all()
    agg: dict[str, dict] = {}
    unknown = 0
    for card, candles in rows:
        name = str((card or {}).get("city") or "")
        coords = city_coords(name)
        if coords is None:
            unknown += 1
            continue
        key = city_key(name)
        item = agg.setdefault(key, {"city": key, "lat": coords[0], "lon": coords[1], "gifts": 0, "candles": 0})
        item["gifts"] += 1
        item["candles"] += int(candles or 0)
    cities = sorted(agg.values(), key=lambda c: (-c["gifts"], c["city"]))
    data = {
        "cities": cities,
        "total_gifts": len(rows),
        "total_cities": len(cities) + (1 if unknown else 0),
        "unplaced_gifts": unknown,
    }
    _map_cache.update(at=time.monotonic(), data=data)
    return data


async def _city_leaders_for_day(session: AsyncSession, day: str) -> dict[str, dict]:
    cnt = func.count(CandleLight.id)
    first_at = func.min(CandleLight.created_at)
    rows = (
        await session.execute(
            select(Gift.id, Gift.card_preview, Gift.author_id, cnt, first_at)
            .join(CandleLight, CandleLight.gift_id == Gift.id)
            .where(CandleLight.day == day, Gift.is_quarantined.is_(False))
            .group_by(Gift.id)
        )
    ).all()
    best: dict[str, dict] = {}
    for gid, card, author_id, n, first in rows:
        card = card or {}
        key = city_key(str(card.get("city") or ""))
        cur = best.get(key)
        cand = {
            "city": key,
            "gift_id": gid,
            "author_id": author_id,
            "candles": int(n),
            "first": first,
            "teaser_tag": str(card.get("teaser_tag", "")),
            "author_display_name": str(card.get("author_display_name", "")),
        }
        if cur is None or (cand["candles"], -(cand["first"].timestamp() if cand["first"] else 0)) > (
            cur["candles"],
            -(cur["first"].timestamp() if cur["first"] else 0),
        ):
            best[key] = cand
    return best


@router.get("/city-leaders")
async def city_leaders(
    response: Response,
    city: str | None = None,
    session: AsyncSession = Depends(get_db),
):
    """«Шар дня» в каждом городе: лидер по свечам за текущие сутки (МСК)."""
    response.headers["Cache-Control"] = "no-store"
    today = config.candle_day()
    yesterday = config.candle_day(datetime.now(timezone.utc) - timedelta(days=1))
    now_best = await _city_leaders_for_day(session, today)
    prev_best = await _city_leaders_for_day(session, yesterday)

    def pub(e: dict | None):
        if not e:
            return None
        return {k: e[k] for k in ("city", "gift_id", "candles", "teaser_tag", "author_display_name")}

    items = sorted(now_best.values(), key=lambda e: (-e["candles"], e["city"]))
    out = {
        "day": today,
        "cities": [pub(e) for e in items[:40]],
        "resets_at": config.candle_day_resets_at(),
    }
    if city:
        key = city_key(city)
        out["my_city"] = {"city": key, "today": pub(now_best.get(key)), "yesterday": pub(prev_best.get(key))}
    return out


# ---------------------------------------------------------------------------
# Ачивки
# ---------------------------------------------------------------------------
ACHIEVEMENTS = [
    ("first_gift", "🎄", "Мастер", "Повесить свой первый шар", 1),
    ("first_candle", "🕯", "Первая искра", "Ваш шар получил свечу от гостя", 1),
    ("ten_candles", "🔥", "Десять огней", "10 свечей от гостей вашим шарам", 10),
    ("fifty_candles", "🗼", "Маяк", "50 свечей от гостей вашим шарам", 50),
    ("ball_of_day", "👑", "Шар дня", "Ваш шар собрал больше всех свечей за сутки", 1),
    ("city_star", "🏙", "Звезда города", "Ваш шар стал лучшим в своём городе за сутки", 1),
    ("generous", "💛", "Щедрое сердце", "Зажечь 10 свечей чужим шарам", 10),
    ("regular", "📅", "Неделя у ёлки", "Зажигать свечи в 7 разных дней", 7),
    ("time_zones", "🌍", "Через часовые пояса", "Зажечь свечи шарам из 5 часовых поясов", 5),
    ("cities_fans", "🧭", "Гости со всей страны", "Свечи вашим шарам от мастеров из 5 городов", 5),
    ("orchestra", "🎼", "Полный оркестр", "Шар, в котором звучат все 5 дорожек", 1),
    ("sculptor", "🧊", "Скульптор", "Фигурка из 150 кубиков и больше", 150),
]


async def compute_achievements(session: AsyncSession, session_hash: str | None) -> list[dict]:
    progress: dict[str, int] = defaultdict(int)
    user = await find_user_by_hash(session, session_hash) if session_hash else None
    gifts: list[Gift] = []
    if user is not None:
        gifts = list((await session.execute(select(Gift).where(Gift.author_id == user.id))).scalars())
    gift_ids = [g.id for g in gifts]
    progress["first_gift"] = len(gifts)
    received = sum(max(0, (g.candles_count or 1) - 1) for g in gifts)
    progress["first_candle"] = progress["ten_candles"] = progress["fifty_candles"] = received
    for g in gifts:
        mel = g.melody or {}
        tracks = ("celesta_track", "harp_track", "cello_track", "flute_track", "drum_track")
        if all(any(n > 0 for n in (mel.get(t) or [])) for t in tracks):
            progress["orchestra"] = 1
        progress["sculptor"] = max(progress["sculptor"], len((g.snowglobe or {}).get("voxels") or []))

    if gift_ids:
        # Шар дня / звезда города: по дням, когда шары мастера получали свечи
        days = [
            d
            for (d,) in (
                await session.execute(select(CandleLight.day).where(CandleLight.gift_id.in_(gift_ids)).distinct())
            ).all()
        ]
        today = config.candle_day()
        mine = set(gift_ids)
        for day in sorted(days):
            if day == today:
                continue  # итоги дня — только после его окончания
            cnt = func.count(CandleLight.id)
            top = (
                await session.execute(
                    select(CandleLight.gift_id, cnt)
                    .where(CandleLight.day == day)
                    .group_by(CandleLight.gift_id)
                    .order_by(cnt.desc(), func.min(CandleLight.created_at).asc())
                    .limit(1)
                )
            ).first()
            if top and top[0] in mine:
                progress["ball_of_day"] = 1
            if not progress["city_star"]:
                best = await _city_leaders_for_day(session, day)
                if any(e["gift_id"] in mine for e in best.values()):
                    progress["city_star"] = 1
        # гости из разных городов
        voter_cities = (
            await session.execute(
                select(User.city)
                .join(CandleLight, CandleLight.voter_hash == User.session_fingerprint)
                .where(CandleLight.gift_id.in_(gift_ids))
                .distinct()
            )
        ).all()
        progress["cities_fans"] = len({city_key(c or "") for (c,) in voter_cities if c})

    if session_hash:
        lit = (
            await session.execute(
                select(CandleLight.day, Gift.card_preview)
                .join(Gift, Gift.id == CandleLight.gift_id)
                .where(CandleLight.voter_hash == session_hash)
            )
        ).all()
        progress["generous"] = len(lit)
        progress["regular"] = len({d for d, _ in lit})
        zones = set()
        for _, card in lit:
            coords = city_coords(str((card or {}).get("city") or ""))
            if coords:
                zones.add(coords[2])
        progress["time_zones"] = len(zones)

    out = []
    for aid, icon, title, desc, target in ACHIEVEMENTS:
        value = progress.get(aid, 0)
        out.append(
            {
                "id": aid,
                "icon": icon,
                "title": title,
                "description": desc,
                "target": target,
                "progress": min(value, target),
                "unlocked": value >= target,
            }
        )
    return out


@router.get("/achievements")
async def my_achievements(
    response: Response,
    session_hash: str | None = Depends(optional_session_hash),
    session: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    items = await compute_achievements(session, session_hash)
    return {"items": items, "unlocked": sum(1 for i in items if i["unlocked"]), "total": len(items)}


# ---------------------------------------------------------------------------
# Счётчик Ёлки: свечи и новые шары за сегодня, за 7 дней и за всё время.
# Демо-шары не считаем — только настоящие. Кеш на 30 секунд.
# ---------------------------------------------------------------------------
_stats_cache: dict = {"at": 0.0, "data": None}


@router.get("/stats")
async def world_stats(response: Response, session: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "public, max-age=30"
    now_mono = time.monotonic()
    if _stats_cache["data"] is not None and now_mono - _stats_cache["at"] < 30:
        return _stats_cache["data"]
    now = datetime.now(timezone.utc)
    today = config.candle_day(now)
    local_midnight = now.astimezone(config.CANDLE_DAY_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start_local = local_midnight - timedelta(days=6)
    week_days = [(local_midnight - timedelta(days=i)).date().isoformat() for i in range(7)]

    async def gifts_since(start: datetime | None) -> int:
        q = select(func.count(Gift.id)).join(User, User.id == Gift.author_id).where(User.is_demo.is_(False))
        if start is not None:
            q = q.where(Gift.created_at >= start.astimezone(timezone.utc))
        return int((await session.execute(q)).scalar_one() or 0)

    async def candles_on(days: list[str] | None) -> int:
        q = select(func.count(CandleLight.id))
        if days is not None:
            q = q.where(CandleLight.day.in_(days))
        return int((await session.execute(q)).scalar_one() or 0)

    legacy = int((await session.execute(select(func.count(GiftCandle.id)))).scalar_one() or 0)
    data = {
        "day": today,
        "today": {"candles": await candles_on([today]), "gifts": await gifts_since(local_midnight)},
        "week": {"candles": await candles_on(week_days), "gifts": await gifts_since(week_start_local)},
        "total": {"candles": await candles_on(None) + legacy, "gifts": await gifts_since(None)},
    }
    _stats_cache.update(at=now_mono, data=data)
    return data
