"""«Ярус памяти» — пиксельные портреты ушедших людей на нижнем ярусе Ёлки."""

from __future__ import annotations

import base64
import html
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config, ratelimit
from app.core.auth import optional_session_hash, require_admin, require_session_hash
from app.database import get_db
from app.models import Memorial, MemorialCandle, MemorialReport
from app.services import memorial as memsvc
from app.services import telegram as tg
from app.services.moderation import find_text_violation

router = APIRouter(prefix="/api/memorials", tags=["memorials"])
pages = APIRouter(tags=["memorials"])

MAX_LIST = 120


class MemorialCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=80)
    birth_date: str = Field(default="", max_length=10)
    death_date: str = Field(min_length=10, max_length=10)
    epitaph: str = Field(default="", max_length=240)
    relation: str = Field(default="", max_length=24)
    energy: str = Field(default="light", max_length=16)
    melody: str = Field(default="quiet_candle", max_length=24)
    portrait: dict
    heir_confirm: bool = False
    pd_consent: bool = False
    terms_accepted: bool = False


class MemorialReportIn(BaseModel):
    reason: str = Field(default="other", max_length=16)


def _clean(s: str) -> str:
    return " ".join((s or "").replace("\x00", "").split())


def _dto(m: Memorial, *, mine: bool = False, lit_today: bool = False, portrait: bool = True) -> dict:
    out = {
        "id": m.id,
        "full_name": m.full_name,
        "birth_date": m.birth_date or "",
        "death_date": m.death_date,
        "epitaph": m.epitaph or "",
        "candles": m.candles_count or 0,
        "energy": m.energy or "light",
        "melody": m.melody or "quiet_candle",
        "status": m.status,
        "mine": mine,
        "lit_today": lit_today,
        "record_hash": m.record_hash if m.status == "approved" else "",
        "stamped": m.ots_status == "submitted",
    }
    if portrait:
        out["portrait"] = m.portrait
    return out


async def _get_visible(session: AsyncSession, memorial_id: str, session_hash: str | None) -> Memorial:
    m = await session.get(Memorial, memorial_id)
    if m is None or (m.status != "approved" and m.creator_hash != session_hash):
        raise HTTPException(status_code=404, detail="Память не найдена.")
    return m


@router.get("")
async def list_memorials(
    session: AsyncSession = Depends(get_db),
    session_hash: str | None = Depends(optional_session_hash),
):
    rows = (
        await session.execute(
            select(Memorial)
            .where(Memorial.status == "approved")
            .order_by(Memorial.approved_at.desc())
            .limit(MAX_LIST)
        )
    ).scalars().all()
    mine_rows: list[Memorial] = []
    lit: set[str] = set()
    if session_hash:
        mine_rows = (
            await session.execute(
                select(Memorial).where(Memorial.creator_hash == session_hash).order_by(Memorial.created_at.desc())
            )
        ).scalars().all()
        lit = set(
            (
                await session.execute(
                    select(MemorialCandle.memorial_id).where(
                        MemorialCandle.voter_hash == session_hash, MemorialCandle.day == config.candle_day()
                    )
                )
            ).scalars().all()
        )
    return {
        "items": [_dto(m, mine=m.creator_hash == session_hash, lit_today=m.id in lit) for m in rows],
        "mine": [_dto(m, mine=True, lit_today=m.id in lit) for m in mine_rows],
    }


@router.post("", status_code=201)
async def create_memorial(
    body: MemorialCreate,
    request: Request,
    session: AsyncSession = Depends(get_db),
    session_hash: str = Depends(require_session_hash),
):
    ratelimit.enforce(request, "memorial_create", limit=6, window_s=3600, extra_key=session_hash)
    if not (body.heir_confirm and body.pd_consent and body.terms_accepted):
        raise HTTPException(
            status_code=422,
            detail="Создать память может только близкий родственник или наследник — подтвердите это и дайте согласия.",
        )
    count = (
        await session.execute(select(func.count()).select_from(Memorial).where(Memorial.creator_hash == session_hash))
    ).scalar_one()
    if count >= config.MEMORIALS_PER_SESSION:
        raise HTTPException(status_code=409, detail=f"С одного устройства можно создать до {config.MEMORIALS_PER_SESSION} памятей.")

    full_name, epitaph, relation = _clean(body.full_name), _clean(body.epitaph), _clean(body.relation)
    for field, value in (("Имя", full_name), ("Слова памяти", epitaph), ("Кем приходится", relation)):
        if value and find_text_violation(value):
            raise HTTPException(status_code=422, detail=f"«{field}»: текст не прошёл проверку.")
    try:
        memsvc.validate_dates(body.birth_date.strip(), body.death_date.strip())
        portrait = memsvc.normalize_portrait(body.portrait)
    except memsvc.PortraitError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    m = Memorial(
        creator_hash=session_hash,
        full_name=full_name,
        birth_date=body.birth_date.strip(),
        death_date=body.death_date.strip(),
        epitaph=epitaph,
        relation=relation,
        energy=body.energy if body.energy in memsvc.ENERGIES else "light",
        melody=body.melody if body.melody in memsvc.MELODIES else "quiet_candle",
        portrait=portrait,
        consent_version=config.LEGAL_VERSION,
        created_at=datetime.now(timezone.utc),
    )
    session.add(m)
    await session.flush()
    m.record_json, m.record_hash = memsvc.build_record(
        m.id, full_name, m.birth_date, m.death_date, epitaph, portrait, m.created_at
    )
    await session.commit()
    tg.schedule(tg.send_memorial_for_review(m.id))
    return _dto(m, mine=True)


@router.get("/admin/pending", dependencies=[Depends(require_admin)])
async def admin_pending(session: AsyncSession = Depends(get_db)):
    rows = (
        await session.execute(select(Memorial).where(Memorial.status == "pending").order_by(Memorial.created_at))
    ).scalars().all()
    return [{**_dto(m), "relation": m.relation} for m in rows]


@router.post("/{memorial_id}/moderate", dependencies=[Depends(require_admin)])
async def admin_moderate(memorial_id: str, approve: bool = True, session: AsyncSession = Depends(get_db)):
    m = await session.get(Memorial, memorial_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Память не найдена.")
    await memsvc.decide(session, m, approve)
    return _dto(m, portrait=False)


@router.get("/{memorial_id}")
async def get_memorial(
    memorial_id: str,
    session: AsyncSession = Depends(get_db),
    session_hash: str | None = Depends(optional_session_hash),
):
    m = await _get_visible(session, memorial_id, session_hash)
    lit = False
    if session_hash:
        lit = (
            await session.execute(
                select(MemorialCandle.id).where(
                    MemorialCandle.memorial_id == m.id,
                    MemorialCandle.voter_hash == session_hash,
                    MemorialCandle.day == config.candle_day(),
                )
            )
        ).first() is not None
    return _dto(m, mine=m.creator_hash == session_hash, lit_today=lit)


@router.post("/{memorial_id}/candle")
async def light_candle(
    memorial_id: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
    session_hash: str = Depends(require_session_hash),
):
    ratelimit.enforce(request, "memorial_candle", limit=60, window_s=600, extra_key=session_hash)
    m = await session.get(Memorial, memorial_id)
    if m is None or m.status != "approved":
        raise HTTPException(status_code=404, detail="Память не найдена.")
    session.add(MemorialCandle(memorial_id=m.id, voter_hash=session_hash, day=config.candle_day()))
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        m = await session.get(Memorial, memorial_id)
        return {"candles": m.candles_count, "lit_today": True, "already": True}
    m.candles_count = (m.candles_count or 0) + 1
    await session.commit()
    return {"candles": m.candles_count, "lit_today": True, "already": False}


@router.post("/{memorial_id}/report")
async def report_memorial(
    memorial_id: str,
    body: MemorialReportIn,
    request: Request,
    session: AsyncSession = Depends(get_db),
    session_hash: str = Depends(require_session_hash),
):
    ratelimit.enforce(request, "memorial_report", limit=20, window_s=600, extra_key=session_hash)
    m = await session.get(Memorial, memorial_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Память не найдена.")
    reason = body.reason if body.reason in ("alive", "not_relative", "other") else "other"
    session.add(MemorialReport(memorial_id=m.id, reporter_hash=session_hash, reason=reason))
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        return {"ok": True, "hidden": False}
    reports = (await session.execute(select(MemorialReport.reason).where(MemorialReport.memorial_id == m.id))).scalars().all()
    alive = sum(1 for r in reports if r in ("alive", "not_relative"))
    hidden = False
    # «Человек жив» — самая опасная ошибка: прячем уже после двух таких жалоб
    if m.status == "approved" and (alive >= 2 or len(reports) >= 3):
        m.status = "pending"
        hidden = True
    await session.commit()
    if hidden:
        tg.schedule(tg.send_memorial_for_review(m.id))
    return {"ok": True, "hidden": hidden}


@router.delete("/{memorial_id}")
async def delete_memorial(
    memorial_id: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
    session_hash: str = Depends(require_session_hash),
):
    ratelimit.enforce(request, "memorial_delete", limit=10, window_s=600, extra_key=session_hash)
    m = await session.get(Memorial, memorial_id)
    if m is None or m.creator_hash != session_hash:
        raise HTTPException(status_code=404, detail="Память не найдена.")
    await delete_memorials(session, [m.id])
    await session.commit()
    return {"ok": True}


async def delete_memorials(session: AsyncSession, ids: list[str]) -> None:
    if not ids:
        return
    await session.execute(delete(MemorialCandle).where(MemorialCandle.memorial_id.in_(ids)))
    await session.execute(delete(MemorialReport).where(MemorialReport.memorial_id.in_(ids)))
    await session.execute(delete(Memorial).where(Memorial.id.in_(ids)))


@router.get("/{memorial_id}/portrait.png")
async def portrait_png(
    memorial_id: str,
    session: AsyncSession = Depends(get_db),
    session_hash: str | None = Depends(optional_session_hash),
):
    m = await _get_visible(session, memorial_id, session_hash)
    return Response(memsvc.portrait_png(m.portrait), media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/{memorial_id}/record.json")
async def record_json(memorial_id: str, session: AsyncSession = Depends(get_db)):
    m = await session.get(Memorial, memorial_id)
    if m is None or m.status != "approved":
        raise HTTPException(status_code=404, detail="Память не найдена.")
    return Response(
        m.record_json.encode("utf-8"),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="memory-{m.id[:8]}.json"'},
    )


@router.get("/{memorial_id}/proof.ots")
async def proof_ots(memorial_id: str, session: AsyncSession = Depends(get_db)):
    m = await session.get(Memorial, memorial_id)
    if m is None or m.status != "approved" or not m.ots_proof:
        raise HTTPException(status_code=404, detail="Отпечаток ещё не готов.")
    return Response(
        bytes(m.ots_proof),
        media_type="application/vnd.opentimestamps.v1",
        headers={"Content-Disposition": f'attachment; filename="memory-{m.id[:8]}.json.ots"'},
    )


def _fmt_date(s: str) -> str:
    if len(s) == 10:
        months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
        try:
            y, mo, d = int(s[:4]), int(s[5:7]), int(s[8:10])
            return f"{d} {months[mo - 1]} {y}"
        except (ValueError, IndexError):
            return s
    return s


@pages.get("/memory/{memorial_id}/certificate", include_in_schema=False)
async def certificate(memorial_id: str, session: AsyncSession = Depends(get_db)):
    m = await session.get(Memorial, memorial_id)
    if m is None or m.status != "approved":
        raise HTTPException(status_code=404, detail="Память не найдена.")
    esc = html.escape
    img = base64.b64encode(memsvc.portrait_png(m.portrait, scale=10)).decode()
    years = (f"{_fmt_date(m.birth_date)} — " if m.birth_date else "") + _fmt_date(m.death_date)
    stamped_on = (m.approved_at or m.created_at).strftime("%d.%m.%Y")
    if m.ots_status == "submitted":
        proof = f"""<p>Отпечаток этой записи отправлен {stamped_on} в публичные календари
<b>OpenTimestamps</b>, которые записывают его в блокчейн Bitcoin. Подтверждение в блоке появляется
в течение нескольких часов и остаётся навсегда.</p>
<p class="files"><a href="/api/memorials/{m.id}/record.json">⬇ Запись памяти (.json)</a>
<a href="/api/memorials/{m.id}/proof.ots">⬇ Отпечаток (.ots)</a></p>
<p class="small">Проверить: откройте opentimestamps.org, перетащите оба файла — сайт покажет дату записи
в блокчейне. В блокчейн попадает только отпечаток, а не имя и портрет.</p>"""
    else:
        proof = "<p class=\"small\">Отпечаток в блокчейне готовится — загляните на эту страницу позже.</p>"
    doc = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Сертификат памяти — {esc(m.full_name)}</title>
<style>
 body {{ margin:0; background:#0b1022; color:#e7ecf6; font:16px/1.55 Georgia,"Times New Roman",serif; }}
 .card {{ max-width:640px; margin:24px auto; padding:32px 28px; background:linear-gradient(#141c38,#0e1430);
   border:2px solid #c9a860; border-radius:6px; text-align:center; box-shadow:0 0 0 6px #0b1022, 0 0 0 8px #3a3020; }}
 h1 {{ font-size:15px; letter-spacing:.18em; text-transform:uppercase; color:#c9a860; margin:0 0 18px; font-weight:normal; }}
 img {{ image-rendering:pixelated; width:240px; max-width:70%; }}
 .name {{ font-size:28px; color:#fef3c7; margin:16px 0 2px; }}
 .years {{ color:#cbd5e1; }} .epitaph {{ font-style:italic; color:#e2e8f0; margin:16px auto; max-width:440px; }}
 .hash {{ font:12px/1.4 ui-monospace,monospace; word-break:break-all; color:#94a3b8; background:#0b1022; padding:8px; border-radius:4px; }}
 .files a {{ display:inline-block; margin:4px 8px; color:#93c5fd; }}
 .small {{ font-size:13px; color:#94a3b8; }} a {{ color:#93c5fd; }}
 @media print {{ body {{ background:#fff; color:#111; }} .card {{ background:#fff; box-shadow:none; }} .name,.years,.epitaph {{ color:#111; }} .noprint {{ display:none; }} }}
</style></head><body><div class="card">
<h1>Сертификат памяти · Ёлка мира</h1>
<img src="data:image/png;base64,{img}" alt="Портрет">
<div class="name">{esc(m.full_name)}</div>
<div class="years">{esc(years)}</div>
{f'<div class="epitaph">«{esc(m.epitaph)}»</div>' if m.epitaph else ''}
<p class="small">Отпечаток записи (SHA-256):</p>
<div class="hash">{esc(m.record_hash)}</div>
{proof}
<p class="noprint small"><a href="/memory/{m.id}">Открыть на Ёлке</a></p>
</div></body></html>"""
    return Response(doc, media_type="text/html; charset=utf-8")
