from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.core.auth import find_user_by_hash, optional_session_hash
from app.database import get_db
from app.models import Gift
from app.schemas import UserProfileDTO

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserProfileDTO)
async def get_my_profile(
    session_hash: str | None = Depends(optional_session_hash),
    session: AsyncSession = Depends(get_db),
):
    # Токен приходит в заголовке X-Session-Token, а не в URL — не оседает в логах прокси.
    user = await find_user_by_hash(session, session_hash) if session_hash else None
    if user is None:
        return UserProfileDTO(user_id=None, max_gifts=config.MAX_GIFTS_PER_USER)

    gift_ids = list(
        (
            await session.execute(
                select(Gift.id).where(Gift.author_id == user.id).order_by(Gift.sequence_number.asc())
            )
        ).scalars().all()
    )
    return UserProfileDTO(
        user_id=user.id,
        display_name=user.display_name,
        city=user.city,
        totem_pet=user.totem_pet,
        gift_ids=gift_ids,
        max_gifts=config.MAX_GIFTS_PER_USER,
    )
