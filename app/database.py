import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

RAW_DB_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./world_fir.db")

if RAW_DB_URL.startswith("postgres://"):
    DATABASE_URL = RAW_DB_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif RAW_DB_URL.startswith("postgresql://") and "+asyncpg" not in RAW_DB_URL:
    DATABASE_URL = RAW_DB_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
else:
    DATABASE_URL = RAW_DB_URL

_engine_kwargs: dict = {"echo": False, "future": True}
if not DATABASE_URL.startswith("sqlite"):
    # Пул под пиковую нагрузку новогодней ночи; pre_ping лечит «протухшие» соединения.
    _engine_kwargs.update(
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
        pool_timeout=float(os.getenv("DB_POOL_TIMEOUT", "10")),
        pool_pre_ping=True,
        pool_recycle=1800,
    )

engine = create_async_engine(DATABASE_URL, **_engine_kwargs)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session