"""Превью для мессенджеров: картинки Open Graph и мета-теги для ссылок на шар."""

from __future__ import annotations

import asyncio
import html
import re

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from app.core import config
from app.database import AsyncSessionLocal
from app.models import Gift
from app.services.share_card import render_gift_card, render_site_card

router = APIRouter(prefix="/api/share", tags=["share"])

_ID_RE = re.compile(r"^[0-9a-fA-F-]{8,40}$")
_render_lock = asyncio.Semaphore(2)  # рендер не должен съесть единственный воркер


def public_base_url(request: Request) -> str:
    if config.PUBLIC_URL:
        return config.PUBLIC_URL.rstrip("/")
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    if proto == "http" and not host.startswith(("localhost", "127.")):
        proto = "https"  # Amvera терминирует TLS на прокси
    return f"{proto}://{host}"


async def load_public_gift(gift_id: str) -> Gift | None:
    if not _ID_RE.match(gift_id or ""):
        return None
    async with AsyncSessionLocal() as session:
        gift = await session.get(Gift, gift_id)
        if gift is None or gift.is_quarantined:
            return None
        return gift


@router.get("/gift/{gift_id}.png")
async def gift_card_png(gift_id: str):
    gift = await load_public_gift(gift_id)
    if gift is None:
        raise HTTPException(status_code=404, detail="Подарок не найден.")
    data = {
        "id": gift.id,
        "snowglobe": gift.snowglobe or {},
        "card_preview": gift.card_preview or {},
        "candles_count": gift.candles_count,
    }
    key = f"{gift.id}:{gift.genome_hash}:{gift.candles_count}:{(gift.card_preview or {}).get('teaser_tag', '')}"
    async with _render_lock:
        png = await run_in_threadpool(render_gift_card, data, key)
    return Response(png, media_type="image/png", headers={"Cache-Control": "public, max-age=600"})


@router.get("/site.png")
async def site_card_png():
    async with _render_lock:
        png = await run_in_threadpool(render_site_card)
    return Response(png, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


SITE_TITLE = "Всемирная ёлка подарков"
SITE_DESC = "Соберите шар ручной работы, сочините мелодию и повесьте его на общую ёлку. В новогоднюю полночь — обмен подарками с мастером из другого города."


def meta_tags(base: str, url: str, title: str, desc: str, image: str) -> str:
    e = lambda s: html.escape(s, quote=True)  # noqa: E731
    return (
        f'<meta property="og:type" content="website" />'
        f'<meta property="og:site_name" content="{e(SITE_TITLE)}" />'
        f'<meta property="og:title" content="{e(title)}" />'
        f'<meta property="og:description" content="{e(desc)}" />'
        f'<meta property="og:url" content="{e(url)}" />'
        f'<meta property="og:image" content="{e(image)}" />'
        f'<meta property="og:image:width" content="1200" />'
        f'<meta property="og:image:height" content="630" />'
        f'<meta property="og:locale" content="ru_RU" />'
        f'<meta name="twitter:card" content="summary_large_image" />'
        f'<meta name="twitter:title" content="{e(title)}" />'
        f'<meta name="twitter:description" content="{e(desc)}" />'
        f'<meta name="twitter:image" content="{e(image)}" />'
        f'<meta name="description" content="{e(desc)}" />'
    )


async def page_meta(request: Request, gift_id: str | None) -> tuple[str, str | None]:
    """Возвращает (мета-теги, заголовок страницы) для index.html."""
    base = public_base_url(request)
    if gift_id:
        gift = await load_public_gift(gift_id)
        if gift is not None:
            card = gift.card_preview or {}
            tag = str(card.get("teaser_tag") or "Хрустальный шар")
            who = ", ".join(p for p in (str(card.get("author_display_name") or ""), str(card.get("city") or "")) if p)
            title = f"«{tag}» — шар на Всемирной ёлке"
            desc = f"Я повесил шар на Всемирную ёлку — зажги свечу 🕯 {who}".strip()
            image = f"{base}/api/share/gift/{gift.id}.png?v={gift.candles_count}"
            return meta_tags(base, f"{base}/g/{gift.id}", title, desc, image), title
    return meta_tags(base, base + "/", SITE_TITLE, SITE_DESC, f"{base}/api/share/site.png"), None
