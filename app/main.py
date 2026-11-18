import asyncio
import html
import re
import logging
import os
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.core import config
from app.core.security import crypto_service
from app.database import AsyncSessionLocal, Base, engine
from app.migrations import run_migrations
from app.routers import gifts, handshakes, ring, share, telegram, users, world, ws
from app.services import telegram as telegram_service
from app.services.ring import ring_auto_match_loop
from app.services.seeder import seed_initial_gifts

logger = logging.getLogger("uvicorn.error")

API_VERSION = "17.2.0"


async def _rotate_and_check_contacts() -> None:
    """Перешифровывает контакты, зашифрованные прежним ключом, текущим ключом.

    Так смена CONTACT_ENCRYPTION_SECRET/SALT не ломает уже собранные контакты.
    Если какие-то записи не читаются НИ одним известным ключом — громко пишем в лог.
    """
    rotated = unreadable = 0
    async with AsyncSessionLocal() as session:
        for table in ("users", "gifts"):
            rows = (await session.execute(text(f"SELECT id, encrypted_contact FROM {table}"))).all()
            for row_id, token in rows:
                if not token or crypto_service.decrypts_with_primary(token):
                    continue
                new_token = crypto_service.rotate_token(token)
                if new_token is None:
                    unreadable += 1
                    continue
                await session.execute(
                    text(f"UPDATE {table} SET encrypted_contact = :t WHERE id = :id"),
                    {"t": new_token, "id": row_id},
                )
                rotated += 1
        await session.commit()
    if rotated:
        logger.info("[Security] Перешифровано контактов новым ключом: %s", rotated)
    if unreadable:
        logger.critical(
            "[Security] %s контактов не расшифровываются ни одним известным ключом! "
            "Верните прежний CONTACT_ENCRYPTION_SECRET/SALT или файл /data/.contact_secret.",
            unreadable,
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

    await _rotate_and_check_contacts()

    ring_task = None
    match_at = config.get_ring_match_at()
    if match_at is not None:
        ring_task = asyncio.create_task(ring_auto_match_loop(AsyncSessionLocal, match_at))
        logger.info("[Lifespan] Автоформирование Кольца Чудес запланировано на %s.", match_at.isoformat())

    tg_tasks = telegram_service.start(AsyncSessionLocal)

    yield

    for task in tg_tasks:
        task.cancel()
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
        allow_methods=["GET", "POST", "PUT", "DELETE"],
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
app.include_router(share.router)
app.include_router(world.router)
app.include_router(telegram.router)


def _db_mode() -> str:
    from app.database import DATABASE_URL

    if DATABASE_URL.startswith("sqlite"):
        return "sqlite"
    host = DATABASE_URL.split("@")[-1].split("/")[0].split(":")[0]
    return "postgresql-embedded" if host in ("127.0.0.1", "localhost") else "postgresql-external"


@app.get("/api/health")
async def health():
    """Живость + какая БД подключена (без адресов и паролей) и отвечает ли она."""
    from sqlalchemy import func, select, text

    from app.models import Gift

    db = {"mode": _db_mode(), "ok": False}
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
            db["gifts"] = (await session.execute(select(func.count(Gift.id)))).scalar_one()
            db["ok"] = True
    except Exception:
        logger.exception("[Health] БД не отвечает")
    return {"status": "ok" if db["ok"] else "degraded", "version": API_VERSION, "db": db}


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
    _INDEX_HTML = _INDEX.read_text(encoding="utf-8")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str, request: Request):
        if full_path:
            candidate = (STATIC_DIR / full_path).resolve()
            # Защита от path traversal: отдаём только файлы ВНУТРИ static/.
            if candidate.is_file() and candidate.is_relative_to(STATIC_DIR):
                return FileResponse(candidate)
        # Ссылка на шар (/g/<id> или /?gift=<id>) получает своё превью в мессенджерах.
        gift_id = request.query_params.get("gift")
        if full_path.startswith("g/"):
            gift_id = full_path[2:].strip("/") or gift_id
        try:
            tags, title = await share.page_meta(request, gift_id)
        except Exception:  # превью не должно ломать сайт
            logger.exception("[Share] не удалось собрать мета-теги")
            tags, title = "", None
        page = _INDEX_HTML.replace("</head>", tags + "</head>", 1)
        if title:
            page = re.sub(r"<title>.*?</title>", f"<title>{html.escape(title)}</title>", page, count=1, flags=re.S)
        # index.html не кешируем: после деплоя браузер сразу получит новую сборку.
        return HTMLResponse(page, headers={"Cache-Control": "no-cache"})
