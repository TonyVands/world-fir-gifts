"""Сессионная авторизация без регистрации.

Браузер один раз генерирует криптостойкий токен (crypto.getRandomValues),
хранит его в localStorage и шлёт в заголовке X-Session-Token. В БД лежит
только SHA-256 от токена, поэтому утечка базы не даёт войти от чужого имени,
а внутренний user.id больше не является «паролем».
"""

import hashlib
import hmac
import re

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config
from app.database import get_db
from app.models import User

SESSION_HEADER = "X-Session-Token"
HASH_PREFIX = "h1:"

# Новые токены: wfg2-<43 символа base64url>. Старые: wfg-<ts>-<8 симв.> — тоже принимаем,
# чтобы не потерять уже повешенные шары.
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_\-]{16,128}$")
_REJECTED_TOKENS = {"keeper-anonymous"}


def hash_session_token(token: str) -> str:
    return HASH_PREFIX + hashlib.sha256(token.encode("utf-8")).hexdigest()


def is_valid_token(token: str | None) -> bool:
    return bool(token) and token not in _REJECTED_TOKENS and bool(_TOKEN_RE.match(token))


async def optional_session_hash(
    x_session_token: str | None = Header(default=None, alias=SESSION_HEADER),
) -> str | None:
    token = (x_session_token or "").strip()
    return hash_session_token(token) if is_valid_token(token) else None


async def require_session_hash(session_hash: str | None = Depends(optional_session_hash)) -> str:
    if session_hash is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Нет сессии. Обновите страницу — браузер создаст её заново.",
        )
    return session_hash


async def find_user_by_hash(session: AsyncSession, session_hash: str) -> User | None:
    stmt = select(User).where(User.session_fingerprint == session_hash)
    return (await session.execute(stmt)).scalar_one_or_none()


async def require_user(
    session_hash: str = Depends(require_session_hash),
    session: AsyncSession = Depends(get_db),
) -> User:
    user = await find_user_by_hash(session, session_hash)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Сначала повесьте свой шар на Ёлку — так вы станете участником Кольца.",
        )
    return user


async def require_admin(x_admin_token: str | None = Header(default=None, alias="X-Admin-Token")) -> None:
    if not config.ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="Админ-доступ выключен: не задан ADMIN_TOKEN.")
    if not x_admin_token or not hmac.compare_digest(x_admin_token, config.ADMIN_TOKEN):
        raise HTTPException(status_code=403, detail="Неверный админ-токен.")
