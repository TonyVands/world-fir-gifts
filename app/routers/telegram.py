"""Подключение уведомлений Telegram с сайта."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import find_user_by_hash, optional_session_hash, require_session_hash
from app.database import get_db
from app.models import TelegramLink
from app.routers.share import public_base_url
from app.services import telegram

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


def _remember_site(request: Request) -> None:
    if not telegram._site_url:
        telegram._site_url = public_base_url(request)


@router.get("/status")
async def status(
    request: Request,
    response: Response,
    session_hash: str | None = Depends(optional_session_hash),
    session: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    _remember_site(request)
    linked = False
    if session_hash:
        user = await find_user_by_hash(session, session_hash)
        linked = user is not None and (await session.get(TelegramLink, user.id)) is not None
    return {"enabled": telegram.enabled(), "linked": linked, "bot": telegram.bot_username() or None}


@router.post("/link")
async def link(
    request: Request,
    session_hash: str = Depends(require_session_hash),
    session: AsyncSession = Depends(get_db),
):
    if not telegram.enabled():
        raise HTTPException(status_code=503, detail="Бот уведомлений пока не подключён.")
    user = await find_user_by_hash(session, session_hash)
    if user is None:
        raise HTTPException(status_code=409, detail="Сначала повесьте свой шар — уведомления приходят о нём.")
    _remember_site(request)
    code = telegram.issue_code(user.id)
    bot = telegram.bot_username()
    if not bot:
        raise HTTPException(status_code=503, detail="Бот ещё запускается — попробуйте через минуту.")
    return {"url": f"https://t.me/{bot}?start={code}", "bot": bot}


@router.delete("/link")
async def unlink(session_hash: str = Depends(require_session_hash), session: AsyncSession = Depends(get_db)):
    user = await find_user_by_hash(session, session_hash)
    if user is not None:
        await session.execute(delete(TelegramLink).where(TelegramLink.user_id == user.id))
        await session.commit()
    return {"linked": False}
