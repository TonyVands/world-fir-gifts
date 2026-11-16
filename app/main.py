import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from app.core import config
from app.core.security import crypto_service
from app.database import AsyncSessionLocal, Base, engine
from app.migrations import run_migrations
from app.models import User
from app.routers import gifts, handshakes, ring, users, ws
from app.services.ring import ring_auto_match_loop
from app.services.seeder import seed_initial_gifts

logger = logging.getLogger("uvicorn.error")

API_VERSION = "16.0.0"


async def _check_encryption_key() -> None:
    """Если ключ шифрования сменился/потерялся, контакты молча превратятся в
    «@keeper_protected» — громко предупреждаем об этом при старте."""
    async with AsyncSessionLocal() as session:
        sample = (
            await session.execute(select(User.encrypted_contact).where(User.is_demo.is_(False)).limit(1))
        ).scalar_one_or_none()
    if sample and crypto_service.decrypt_contact(sample) == "@keeper_protected":
        logger.critical(
            "[Security] Контакты в БД НЕ расшифровываются текущим ключом! "
            "Проверьте CONTACT_ENCRYPTION_SECRET / CONTACT_ENCRYPTION_SALT."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(run_migrations)

    if os.getenv("SEED_ON_START", "1") == "1":
        try:
            target_count = int(os.getenv("SEED_GIFT_COUNT", "60"))
        except ValueError:
            target_count = 60
        async with AsyncSessionLocal() as session:
            seeded = await seed_initial_gifts(session, target_count=target_count)
            if seeded:
                logger.info("[Lifespan] Демо-данные засеяны: %s подарков.", seeded)

    await _check_encryption_key()

    ring_task = None
    match_at = config.get_ring_match_at()
    if match_at is not None:
        ring_task = asyncio.create_task(ring_auto_match_loop(AsyncSessionLocal, match_at))
        logger.info("[Lifespan] Автоформирование Кольца Чудес запланировано на %s.", match_at.isoformat())

    yield

    if ring_task is not None:
        ring_task.cancel()
        with suppress(asyncio.CancelledError):
            await ring_task
    await engine.dispose()


app = FastAPI(
    title="Всемирная ёлка подарков • World Fir Gifts API",
    version=API_VERSION,
    lifespan=lifespan,
    docs_url="/api/docs" if config.DOCS_ENABLED else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if config.DOCS_ENABLED else None,
)

if config.ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.ALLOWED_ORIGINS,
        allow_credentials=False,  # авторизация — заголовком, cookies не используются
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Session-Token"],
    )

app.add_middleware(GZipMiddleware, minimum_size=1024)

_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        "connect-src 'self' ws: wss:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if config.SECURITY_CSP and not request.url.path.startswith("/api/docs"):
        h.setdefault("Content-Security-Policy", _CSP)
    if request.headers.get("x-forwarded-proto") == "https":
        h.setdefault("Strict-Transport-Security", "max-age=15552000")
    path = request.url.path
    if path.startswith("/api/"):
        h.setdefault("Cache-Control", "no-store")
    elif path.startswith("/assets/") and response.status_code == 200:
        # Имена файлов Vite содержат хеш — можно кешировать «навсегда».
        h["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


app.include_router(gifts.router)
app.include_router(users.router)
app.include_router(handshakes.router)
app.include_router(ring.router)
app.include_router(ws.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": API_VERSION}


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
async def api_not_found(rest: str):
    # Неизвестные /api-пути не должны отдавать index.html (путаница в клиенте и логах).
    raise HTTPException(status_code=404, detail="Не найдено.")


STATIC_DIR = Path(__file__).resolve().parent / "static"
if STATIC_DIR.is_dir():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    _INDEX = STATIC_DIR / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        if full_path:
            candidate = (STATIC_DIR / full_path).resolve()
            # Защита от path traversal: отдаём только файлы ВНУТРИ static/.
            if candidate.is_file() and candidate.is_relative_to(STATIC_DIR):
                return FileResponse(candidate)
        # index.html не кешируем: после деплоя браузер сразу получит новую сборку.
        return FileResponse(_INDEX, headers={"Cache-Control": "no-cache"})
