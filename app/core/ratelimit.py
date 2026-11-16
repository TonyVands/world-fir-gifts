"""Простой in-memory rate limit (скользящее окно).

Работает в пределах одного процесса — приложение запускается в одном
воркере uvicorn и одной реплике (см. DEPLOY.md). Лимиты по IP сделаны
щедрыми: в новогоднюю ночь много людей сидит за одним NAT мобильного
оператора, и честных пользователей резать нельзя.
"""

import os
import time
from collections import deque

from fastapi import HTTPException, Request

ENABLED = os.getenv("RATE_LIMIT_ENABLED", "1") != "0"
TRUST_PROXY = os.getenv("TRUST_PROXY", "1") != "0"

_buckets: dict[str, deque] = {}
_MAX_KEYS = 100_000


def client_ip(request: Request) -> str:
    if TRUST_PROXY:
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
        xff = request.headers.get("x-forwarded-for")
        if xff:
            # Правый адрес добавлен нашим входным прокси — его не подделать.
            return xff.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _purge(now: float) -> None:
    stale = [k for k, q in _buckets.items() if not q or q[-1] < now - 3600]
    for k in stale:
        _buckets.pop(k, None)


def hit(key: str, limit: int, window_s: int) -> bool:
    """Регистрирует попытку; False — лимит исчерпан."""
    if not ENABLED:
        return True
    now = time.monotonic()
    if len(_buckets) > _MAX_KEYS:
        _purge(now)
    q = _buckets.setdefault(key, deque())
    while q and q[0] <= now - window_s:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


def enforce(request: Request, scope: str, limit: int, window_s: int, extra_key: str | None = None) -> None:
    key = f"{scope}:{client_ip(request)}"
    if not hit(key, limit, window_s):
        raise HTTPException(
            status_code=429,
            detail="Слишком много действий подряд. Передохните минутку и попробуйте снова.",
            headers={"Retry-After": str(window_s)},
        )
    if extra_key and not hit(f"{scope}:s:{extra_key}", limit, window_s):
        raise HTTPException(
            status_code=429,
            detail="Слишком много действий подряд. Передохните минутку и попробуйте снова.",
            headers={"Retry-After": str(window_s)},
        )


def reset() -> None:
    _buckets.clear()
