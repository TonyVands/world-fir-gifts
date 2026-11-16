import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import TypeAdapter
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config, ratelimit
from app.core.auth import find_user_by_hash, optional_session_hash, require_admin, require_session_hash
from app.core.security import encrypt_contact
from app.core.unlock import is_new_year_unlocked
from app.database import get_db
from app.models import CandleLight, Gift, GiftReport, User
from app.schemas import (
    CandleStatusDTO,
    CreatedGiftDTO,
    GiftCreateRequest,
    GiftReportRequest,
    GiftReportResultDTO,
    GiftUpdateRequest,
    LeaderboardDTO,
    LeaderEntryDTO,
    MyGiftDTO,
    PublicShowcaseGiftDTO,
    normalize_contact,
    quality_tier_badge,
)
from app.services.matching import (
    build_gift_payload,
    calculate_gift_quality_score,
    compute_artifact_genome_hash,
    compute_fibonacci_spiral_slot,
    gift_payload_from_model,
    verify_deep_text_safety,
    verify_voxel_topology_safety,
)
from app.services import telegram
from app.services.ring import is_ring_formed, join_ring_late

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/api/gifts", tags=["gifts"])

_LIST_ADAPTER = TypeAdapter(list[PublicShowcaseGiftDTO])


# ---------------------------------------------------------------------------
# Кеш витрины: в новогоднюю ночь все открывают Ёлку одновременно. Список
# сериализуется один раз на изменение, остальным уходит готовый JSON (+ETag/304).
# ---------------------------------------------------------------------------
class _ShowcaseCache:
    def __init__(self) -> None:
        self.version = 0
        self.built_version = -1
        self.body: bytes = b"[]"
        self.etag = '"empty"'
        self.lock = asyncio.Lock()

    def invalidate(self) -> None:
        self.version += 1


showcase_cache = _ShowcaseCache()


def invalidate_showcase() -> None:
    showcase_cache.invalidate()


def _to_dto_kwargs(g: Gift, rank: int) -> dict:
    return dict(
        id=g.id,
        created_order=g.sequence_number,
        coordinates=compute_fibonacci_spiral_slot(rank),
        snowglobe=g.snowglobe,
        packaging=g.packaging,
        melody=g.melody,
        card_preview=g.card_preview,
        wish_char_count=len(g.secret_wish or ""),
        quality_score=g.quality_score,
        quality_tier_badge=quality_tier_badge(g.quality_score),
        candles_count=g.candles_count,
        genome_hash=g.genome_hash,
        created_at=g.created_at,
    )


def _to_dto(g: Gift, rank: int) -> PublicShowcaseGiftDTO:
    return PublicShowcaseGiftDTO(**_to_dto_kwargs(g, rank))


async def _rank_of(session: AsyncSession, gift: Gift) -> int:
    stmt = select(func.count(Gift.id)).where(
        Gift.is_quarantined.is_(False),
        or_(
            Gift.quality_score > gift.quality_score,
            and_(Gift.quality_score == gift.quality_score, Gift.sequence_number < gift.sequence_number),
        ),
    )
    return (await session.execute(stmt)).scalar_one()


async def _get_visible_gift(session: AsyncSession, gift_id: str) -> Gift:
    gift = await session.get(Gift, gift_id)
    if gift is None or gift.is_quarantined:
        raise HTTPException(status_code=404, detail="Подарок не найден.")
    return gift


@router.get("", response_model=list[PublicShowcaseGiftDTO])
async def list_gifts(request: Request, session: AsyncSession = Depends(get_db)):
    cache = showcase_cache
    if cache.built_version != cache.version:
        async with cache.lock:
            if cache.built_version != cache.version:
                target_version = cache.version
                stmt = (
                    select(Gift)
                    .where(Gift.is_quarantined.is_(False))
                    .order_by(Gift.quality_score.desc(), Gift.sequence_number.asc())
                )
                rows = (await session.execute(stmt)).scalars().all()
                dtos = [_to_dto(g, rank) for rank, g in enumerate(rows)]
                cache.body = _LIST_ADAPTER.dump_json(dtos)
                cache.etag = '"' + hashlib.sha256(cache.body).hexdigest()[:24] + '"'
                cache.built_version = target_version

    headers = {"ETag": cache.etag, "Cache-Control": "no-cache"}
    if request.headers.get("if-none-match") == cache.etag:
        return Response(status_code=304, headers=headers)
    return Response(content=cache.body, media_type="application/json", headers=headers)


def _moderate_payload(payload) -> None:
    """Общая проверка публичных текстов и фигурки — для создания и правки."""
    card = payload.card
    for value in (
        card.secret_wish,
        card.teaser_tag,
        card.author_display_name,
        card.city,
        card.totem_pet,
        payload.snowglobe.engraving_text,
        payload.snowglobe.custom_craft_title or "",
    ):
        ok_text, reason_text = verify_deep_text_safety(value)
        if not ok_text:
            raise HTTPException(status_code=422, detail=reason_text)
    voxels_raw = [v.model_dump() for v in payload.snowglobe.voxels]
    ok_vox, reason_vox = verify_voxel_topology_safety(voxels_raw)
    if not ok_vox:
        raise HTTPException(status_code=422, detail=reason_vox)


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _next_edit_at(gift: Gift) -> datetime | None:
    last = _as_utc(gift.edited_at)
    if last is None or config.GIFT_EDIT_COOLDOWN_DAYS == 0:
        return None
    return last + timedelta(days=config.GIFT_EDIT_COOLDOWN_DAYS)


def _can_edit(gift: Gift) -> bool:
    if is_new_year_unlocked():
        return False
    nxt = _next_edit_at(gift)
    return nxt is None or datetime.now(timezone.utc) >= nxt


async def _get_own_gift(session: AsyncSession, gift_id: str, session_hash: str) -> Gift:
    gift = await session.get(Gift, gift_id)
    if gift is None:
        raise HTTPException(status_code=404, detail="Подарок не найден.")
    author = await session.get(User, gift.author_id)
    if author is None or author.session_fingerprint != session_hash:
        raise HTTPException(status_code=403, detail="Менять шар может только его мастер.")
    return gift


def _my_gift_dto(gift: Gift) -> MyGiftDTO:
    return MyGiftDTO(
        id=gift.id,
        snowglobe=gift.snowglobe or {},
        packaging=gift.packaging or {},
        melody=gift.melody or {},
        card_preview=gift.card_preview or {},
        secret_wish=gift.secret_wish or "",
        candles_count=gift.candles_count,
        edited_at=_as_utc(gift.edited_at),
        can_edit=_can_edit(gift) and not gift.is_quarantined,
        next_edit_at=_next_edit_at(gift),
        edit_cooldown_days=config.GIFT_EDIT_COOLDOWN_DAYS,
    )


@router.get("/{gift_id}/mine", response_model=MyGiftDTO)
async def get_my_gift(
    gift_id: str,
    response: Response,
    session_hash: str = Depends(require_session_hash),
    session: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    gift = await _get_own_gift(session, gift_id, session_hash)
    return _my_gift_dto(gift)


@router.put("/{gift_id}", response_model=PublicShowcaseGiftDTO)
async def update_gift(
    gift_id: str,
    payload: GiftUpdateRequest,
    request: Request,
    session_hash: str = Depends(require_session_hash),
    session: AsyncSession = Depends(get_db),
):
    """Мастер переделывает свой шар: раз в GIFT_EDIT_COOLDOWN_DAYS дней и до полуночи
    обмена. Свечи, место в очереди и участие в Кольце сохраняются."""
    ratelimit.enforce(request, "gift_edit", limit=10, window_s=600, extra_key=session_hash)
    gift = await _get_own_gift(session, gift_id, session_hash)
    if gift.is_quarantined:
        raise HTTPException(status_code=409, detail="Шар на проверке у модератора — править его пока нельзя.")
    if is_new_year_unlocked():
        raise HTTPException(status_code=409, detail="Обмен уже открыт — шары больше не меняются.")
    nxt = _next_edit_at(gift)
    if nxt is not None and datetime.now(timezone.utc) < nxt:
        raise HTTPException(
            status_code=429,
            detail=f"Шар можно переделывать раз в {config.GIFT_EDIT_COOLDOWN_DAYS} дн. "
            f"Следующая правка — {nxt.astimezone(config.CANDLE_DAY_TZ):%d.%m в %H:%M} МСК.",
        )

    _moderate_payload(payload)
    card = payload.card
    snow_dict = payload.snowglobe.model_dump()
    mel_dict = payload.melody.model_dump()
    pack_dict = payload.packaging.model_dump()

    gift.snowglobe = snow_dict
    gift.packaging = pack_dict
    gift.melody = mel_dict
    gift.card_preview = {
        "teaser_tag": card.teaser_tag,
        "author_display_name": card.author_display_name,
        "city": card.city,
        "totem_pet": card.totem_pet,
    }
    gift.secret_wish = card.secret_wish
    if card.contact_handle.strip():
        if len(card.contact_handle.strip()) < 3:
            raise HTTPException(status_code=422, detail="Контакт слишком короткий.")
        contact_type, contact_value = normalize_contact(card.contact_handle)
        gift.encrypted_contact = encrypt_contact(contact_value)
        # Кольцо Чудес берёт контакт мастера из профиля — обновляем и его.
        author = await session.get(User, gift.author_id)
        if author is not None:
            author.contact_type = contact_type
            author.encrypted_contact = encrypt_contact(contact_value)
    gift.genome_hash = compute_artifact_genome_hash(snow_dict, mel_dict)
    gift.quality_score = calculate_gift_quality_score(
        build_gift_payload(snow_dict, pack_dict, mel_dict, card.secret_wish), candles_count=gift.candles_count
    )
    gift.edited_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(gift)
    invalidate_showcase()
    rank = await _rank_of(session, gift)
    return _to_dto(gift, rank)


@router.post("", response_model=CreatedGiftDTO, status_code=status.HTTP_201_CREATED)
async def create_gift(
    payload: GiftCreateRequest,
    request: Request,
    session_hash: str = Depends(require_session_hash),
    session: AsyncSession = Depends(get_db),
):
    ratelimit.enforce(request, "gift_create", limit=20, window_s=600, extra_key=session_hash)

    card = payload.card
    _moderate_payload(payload)

    contact_type, contact_value = normalize_contact(card.contact_handle)
    snow_dict = payload.snowglobe.model_dump()
    mel_dict = payload.melody.model_dump()
    pack_dict = payload.packaging.model_dump()
    card_preview = {
        "teaser_tag": card.teaser_tag,
        "author_display_name": card.author_display_name,
        "city": card.city,
        "totem_pet": card.totem_pet,
    }
    quality = calculate_gift_quality_score(
        build_gift_payload(snow_dict, pack_dict, mel_dict, card.secret_wish), candles_count=1
    )
    genome = compute_artifact_genome_hash(snow_dict, mel_dict)

    # sequence_number защищён уникальным индексом; при гонке — повтор.
    for attempt in range(5):
        user = await find_user_by_hash(session, session_hash)
        if user is None:
            user = User(
                session_fingerprint=session_hash,
                display_name=card.author_display_name,
                city=card.city,
                totem_pet=card.totem_pet,
                contact_type=contact_type,
                encrypted_contact=encrypt_contact(contact_value),
                is_demo=False,
            )
            session.add(user)
            await session.flush()
        else:
            gifts_count = (
                await session.execute(select(func.count(Gift.id)).where(Gift.author_id == user.id))
            ).scalar_one()
            if gifts_count >= config.MAX_GIFTS_PER_USER:
                raise HTTPException(
                    status_code=409,
                    detail=f"На Ёлке уже {gifts_count} ваших шара — это максимум для одного мастера.",
                )

        max_seq = (await session.execute(select(func.max(Gift.sequence_number)))).scalar_one()
        gift = Gift(
            author_id=user.id,
            sequence_number=0 if max_seq is None else max_seq + 1,
            snowglobe=snow_dict,
            packaging=pack_dict,
            melody=mel_dict,
            card_preview=card_preview,
            secret_wish=card.secret_wish,
            encrypted_contact=encrypt_contact(contact_value),
            quality_score=quality,
            candles_count=1,
            genome_hash=genome,
        )
        session.add(gift)
        try:
            await session.flush()
            # Кольцо уже сформировано, но полночь не наступила — встраиваем опоздавшего.
            if not user.is_demo and not is_new_year_unlocked() and await is_ring_formed(session):
                await join_ring_late(session, user.id, gift.id)
            await session.commit()
            break
        except IntegrityError:
            await session.rollback()
            if attempt == 4:
                raise HTTPException(status_code=503, detail="Ёлка сейчас очень занята — попробуйте ещё раз.")
            await asyncio.sleep(0.05 * (attempt + 1))

    await session.refresh(gift)
    invalidate_showcase()
    rank = await _rank_of(session, gift)
    return CreatedGiftDTO(**_to_dto_kwargs(gift, rank), my_user_id=user.id)


async def _candle_status(session: AsyncSession, session_hash: str | None) -> CandleStatusDTO:
    day = config.candle_day()
    lit: list[str] = []
    if session_hash:
        rows = await session.execute(
            select(CandleLight.gift_id).where(CandleLight.voter_hash == session_hash, CandleLight.day == day)
        )
        lit = [r[0] for r in rows.all()]
    return CandleStatusDTO(
        day=day,
        daily_limit=config.DAILY_CANDLES,
        remaining_today=max(0, config.DAILY_CANDLES - len(lit)),
        lit_today=lit,
        resets_at=config.candle_day_resets_at(),
    )


@router.get("/candles/status", response_model=CandleStatusDTO)
async def candle_status(
    response: Response,
    session_hash: str | None = Depends(optional_session_hash),
    session: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    return await _candle_status(session, session_hash)


async def _day_leaders(session: AsyncSession, day: str, limit: int) -> list[LeaderEntryDTO]:
    cnt = func.count(CandleLight.id).label("cnt")
    first_at = func.min(CandleLight.created_at).label("first_at")
    stmt = (
        select(Gift, cnt)
        .join(CandleLight, CandleLight.gift_id == Gift.id)
        .where(CandleLight.day == day, Gift.is_quarantined.is_(False))
        .group_by(Gift.id)
        # при равенстве побеждает тот, кто раньше набрал первую свечу
        .order_by(cnt.desc(), first_at.asc())
        .limit(limit)
    )
    out = []
    for gift, n in (await session.execute(stmt)).all():
        card = gift.card_preview or {}
        out.append(
            LeaderEntryDTO(
                gift_id=gift.id,
                candles=int(n),
                teaser_tag=str(card.get("teaser_tag", "")),
                author_display_name=str(card.get("author_display_name", "")),
                city=str(card.get("city", "")),
            )
        )
    return out


@router.get("/leaders", response_model=LeaderboardDTO)
async def candle_leaders(response: Response, session: AsyncSession = Depends(get_db)):
    """Лидеры дня по свечам за текущие сутки и «Шар дня» — победитель вчерашних."""
    response.headers["Cache-Control"] = "no-store"
    today = config.candle_day()
    yesterday = config.candle_day(datetime.now(timezone.utc) - timedelta(days=1))
    top = await _day_leaders(session, today, 5)
    prev = await _day_leaders(session, yesterday, 1)
    return LeaderboardDTO(
        day=today,
        today=top,
        yesterday_winner=prev[0] if prev else None,
        resets_at=config.candle_day_resets_at(),
    )


@router.post("/{gift_id}/candle", response_model=PublicShowcaseGiftDTO)
async def light_gift_candle(
    gift_id: str,
    request: Request,
    response: Response,
    session_hash: str = Depends(require_session_hash),
    session: AsyncSession = Depends(get_db),
):
    ratelimit.enforce(request, "candle", limit=120, window_s=600, extra_key=session_hash)
    gift = await _get_visible_gift(session, gift_id)

    author = await session.get(User, gift.author_id)
    if author is not None and author.session_fingerprint == session_hash:
        raise HTTPException(status_code=403, detail="Свою свечу зажечь нельзя — пусть её зажгут другие.")

    day = config.candle_day()
    used = (
        await session.execute(
            select(func.count(CandleLight.id)).where(CandleLight.voter_hash == session_hash, CandleLight.day == day)
        )
    ).scalar_one()
    already = (
        await session.execute(
            select(CandleLight.id).where(
                CandleLight.voter_hash == session_hash, CandleLight.day == day, CandleLight.gift_id == gift.id
            )
        )
    ).first()
    if already is not None:
        raise HTTPException(status_code=409, detail="Сегодня вы уже зажгли свечу у этого шара. Завтра — снова можно.")
    if used >= config.DAILY_CANDLES:
        raise HTTPException(
            status_code=429,
            detail=f"Свечи на сегодня закончились ({config.DAILY_CANDLES} из {config.DAILY_CANDLES}). Новые — после полуночи по Москве.",
        )

    session.add(CandleLight(gift_id=gift.id, voter_hash=session_hash, day=day))
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Сегодня вы уже зажгли свечу у этого шара. Завтра — снова можно.")

    # Атомарный инкремент — без гонок при одновременных свечах.
    await session.execute(
        update(Gift).where(Gift.id == gift.id).values(candles_count=Gift.candles_count + 1)
    )
    await session.refresh(gift)
    gift.quality_score = calculate_gift_quality_score(gift_payload_from_model(gift), candles_count=gift.candles_count)
    await session.commit()
    await session.refresh(gift)
    invalidate_showcase()
    rank = await _rank_of(session, gift)
    response.headers["X-Candles-Remaining"] = str(max(0, config.DAILY_CANDLES - used - 1))
    telegram.schedule(telegram.notify_candle(gift.id))
    return _to_dto(gift, rank)


@router.post("/{gift_id}/report", response_model=GiftReportResultDTO)
async def report_gift(
    gift_id: str,
    request: Request,
    body: GiftReportRequest | None = None,
    session_hash: str = Depends(require_session_hash),
    session: AsyncSession = Depends(get_db),
):
    ratelimit.enforce(request, "report", limit=30, window_s=600, extra_key=session_hash)
    gift = await _get_visible_gift(session, gift_id)
    reason = body.reason if body else "other"

    session.add(GiftReport(gift_id=gift.id, reporter_hash=session_hash, reason=reason))
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        return GiftReportResultDTO(gift_id=gift_id, accepted=False, quarantined=False)

    await session.execute(update(Gift).where(Gift.id == gift.id).values(reports_count=Gift.reports_count + 1))
    await session.refresh(gift)
    quarantined = False
    if gift.reports_count >= config.REPORT_QUARANTINE_THRESHOLD and not gift.is_quarantined:
        gift.is_quarantined = True
        quarantined = True
        logger.warning("[Moderation] Шар %s скрыт по жалобам (%s).", gift.id, gift.reports_count)
    await session.commit()
    if quarantined:
        invalidate_showcase()
    return GiftReportResultDTO(gift_id=gift_id, accepted=True, quarantined=quarantined)


# --- Админ-модерация (заголовок X-Admin-Token) --------------------------------

@router.post("/{gift_id}/quarantine", dependencies=[Depends(require_admin)])
async def admin_quarantine(gift_id: str, hidden: bool = True, session: AsyncSession = Depends(get_db)):
    gift = await session.get(Gift, gift_id)
    if gift is None:
        raise HTTPException(status_code=404, detail="Подарок не найден.")
    gift.is_quarantined = hidden
    if not hidden:
        gift.reports_count = 0
    await session.commit()
    invalidate_showcase()
    return {"gift_id": gift_id, "is_quarantined": gift.is_quarantined}
