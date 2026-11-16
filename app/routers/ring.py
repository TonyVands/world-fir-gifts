from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.config import get_ring_match_at
from app.core.unlock import get_unlock_timestamp, is_new_year_unlocked
from app.database import get_db
from app.models import ExchangeRingHandshake
from app.schemas import RingMatchResultDTO, RingStatusDTO
from app.services.ring import CYCLE_YEAR, RingAlreadyFormed, form_ring

router = APIRouter(prefix="/api/ring", tags=["Exchange Ring"])


@router.get("/status", response_model=RingStatusDTO)
async def ring_status(session: AsyncSession = Depends(get_db)):
    current = ExchangeRingHandshake.cycle_year == CYCLE_YEAR
    handshakes = (await session.execute(select(func.count(ExchangeRingHandshake.id)).where(current))).scalar_one()
    participants = (
        await session.execute(
            select(func.count(func.distinct(ExchangeRingHandshake.giver_user_id))).where(current)
        )
    ).scalar_one()
    return RingStatusDTO(
        cycle_year=CYCLE_YEAR,
        participants=participants,
        handshakes=handshakes,
        unlocked=is_new_year_unlocked(),
        unlock_at=get_unlock_timestamp(),
        formed=handshakes > 0,
        match_at=get_ring_match_at(),
        # Клиент сверяет свои часы с сервером — обратный отсчёт не врёт при сбитом времени.
        server_time=datetime.now(timezone.utc),
    )


@router.post("/match", response_model=RingMatchResultDTO, dependencies=[Depends(require_admin)])
async def match_ring(cycle_year: int = CYCLE_YEAR, session: AsyncSession = Depends(get_db)):
    try:
        created, participants = await form_ring(session, cycle_year)
    except RingAlreadyFormed:
        raise HTTPException(status_code=409, detail="Кольцо Чудес для этого цикла уже сформировано.")
    return RingMatchResultDTO(cycle_year=cycle_year, created=created, participants=participants)
