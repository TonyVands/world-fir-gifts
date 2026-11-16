from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import ratelimit
from app.core.auth import find_user_by_hash, optional_session_hash, require_user
from app.core.security import crypto_service
from app.core.unlock import get_unlock_timestamp, is_new_year_unlocked
from app.database import get_db
from app.models import ExchangeRingHandshake, User
from app.routers.ws import ws_manager
from app.schemas import HandshakePartnerCardDTO, UnlockedGiftDTO

router = APIRouter(prefix="/api/handshakes", tags=["Double Handshake"])

_UNLOCK_HINT = "Кольцо Чудес откроется в Новогоднюю полночь"


def _load_stmt():
    return select(ExchangeRingHandshake).options(
        selectinload(ExchangeRingHandshake.giver),
        selectinload(ExchangeRingHandshake.receiver),
        selectinload(ExchangeRingHandshake.gift),
    )


def _ensure_unlocked() -> None:
    if not is_new_year_unlocked():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{_UNLOCK_HINT} ({get_unlock_timestamp().isoformat()}).",
        )


def _build_partner_card(hs: ExchangeRingHandshake, current_user_id: str) -> HandshakePartnerCardDTO:
    is_user_giver = hs.giver_user_id == current_user_id
    role = "MY_RECIPIENT" if is_user_giver else "MY_SECRET_SANTA"
    partner = hs.receiver if is_user_giver else hs.giver

    my_consent = hs.giver_consent if is_user_giver else hs.receiver_consent
    partner_consent = hs.receiver_consent if is_user_giver else hs.giver_consent
    mutual_unlocked = bool(hs.giver_consent and hs.receiver_consent)

    decrypted_contact = crypto_service.decrypt_contact(partner.encrypted_contact) if mutual_unlocked else None
    contact_type = partner.contact_type if mutual_unlocked else None

    return HandshakePartnerCardDTO(
        handshake_id=hs.id,
        role=role,
        partner_display_name=partner.display_name,
        partner_city=partner.city,
        partner_totem_pet=partner.totem_pet,
        my_consent=my_consent,
        partner_consent=partner_consent,
        mutual_unlocked=mutual_unlocked,
        partner_contact_type=contact_type,
        partner_decrypted_contact=decrypted_contact,
        gift_details=UnlockedGiftDTO.from_orm_gift(hs.gift),
    )


@router.get("/my-ring", response_model=list[HandshakePartnerCardDTO])
async def get_my_miracle_ring_cards(
    request: Request,
    session_hash: str | None = Depends(optional_session_hash),
    session: AsyncSession = Depends(get_db),
):
    _ensure_unlocked()
    ratelimit.enforce(request, "my_ring", limit=120, window_s=60)
    user = await find_user_by_hash(session, session_hash) if session_hash else None
    if user is None:
        return []

    stmt = _load_stmt().where(
        (ExchangeRingHandshake.giver_user_id == user.id) | (ExchangeRingHandshake.receiver_user_id == user.id)
    )
    records = (await session.execute(stmt)).scalars().all()

    cards = []
    changed = False
    for hs in records:
        if hs.receiver_user_id == user.id and not hs.is_unpacked:
            hs.is_unpacked = True
            changed = True
        cards.append(_build_partner_card(hs, user.id))
    if changed:
        await session.commit()
    # Пустой список — штатная ситуация (мастер пришёл после формирования Кольца).
    return cards


@router.post("/{handshake_id}/consent", response_model=HandshakePartnerCardDTO)
async def give_handshake_consent(
    handshake_id: str,
    request: Request,
    user: User = Depends(require_user),
    session: AsyncSession = Depends(get_db),
):
    if not is_new_year_unlocked():
        raise HTTPException(status_code=403, detail="Знакомство доступно только после распаковки.")
    ratelimit.enforce(request, "consent", limit=30, window_s=60)

    stmt = _load_stmt().where(ExchangeRingHandshake.id == handshake_id).with_for_update(of=ExchangeRingHandshake)
    hs = (await session.execute(stmt)).scalar_one_or_none()
    if not hs:
        raise HTTPException(status_code=404, detail="Рукопожатие не найдено.")

    if user.id == hs.giver_user_id:
        hs.giver_consent = True
    elif user.id == hs.receiver_user_id:
        hs.receiver_consent = True
    else:
        raise HTTPException(status_code=403, detail="Вы не являетесь участником этой пары обмена.")

    just_unlocked = False
    if hs.giver_consent and hs.receiver_consent and hs.unlocked_contact_at is None:
        hs.unlocked_contact_at = datetime.now(timezone.utc)
        just_unlocked = True

    await session.commit()

    if just_unlocked:
        # Рассылка идёт в фоне: тысяча открытых вкладок не задерживает ответ.
        ws_manager.schedule_broadcast(
            "CELESTIAL_OWL_FLIGHT",
            {"handshake_id": str(hs.id), "from_city": hs.giver.city, "to_city": hs.receiver.city},
        )

    return _build_partner_card(hs, user.id)
