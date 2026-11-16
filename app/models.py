import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # SHA-256 от сессионного токена ("h1:<hex>"), сам токен на сервере не хранится.
    session_fingerprint: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(60))
    city: Mapped[str] = mapped_column(String(60))
    totem_pet: Mapped[str] = mapped_column(String(60), default="Полярная сова")
    contact_type: Mapped[str] = mapped_column(String(32), default="telegram")
    encrypted_contact: Mapped[str] = mapped_column(Text)
    # Демо-мастера из сидера: видны на Ёлке, но НЕ участвуют в Кольце Чудес.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Gift(Base):
    __tablename__ = "gifts"
    __table_args__ = (Index("uq_gifts_sequence_number", "sequence_number", unique=True),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    sequence_number: Mapped[int] = mapped_column(Integer, index=True)
    snowglobe: Mapped[dict] = mapped_column(JSON)
    packaging: Mapped[dict] = mapped_column(JSON)
    melody: Mapped[dict] = mapped_column(JSON)
    card_preview: Mapped[dict] = mapped_column(JSON)
    secret_wish: Mapped[str] = mapped_column(Text)
    encrypted_contact: Mapped[str] = mapped_column(Text)
    quality_score: Mapped[float] = mapped_column(Float, default=50.0, index=True)
    candles_count: Mapped[int] = mapped_column(Integer, default=1)
    reports_count: Mapped[int] = mapped_column(Integer, default=0)
    is_quarantined: Mapped[bool] = mapped_column(Boolean, default=False)
    is_matched: Mapped[bool] = mapped_column(Boolean, default=False)
    genome_hash: Mapped[str] = mapped_column(String(64), default="0x00000000")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # Последнее редактирование автором (раз в GIFT_EDIT_COOLDOWN_DAYS дней).
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)

    author: Mapped["User"] = relationship("User", lazy="selectin")


class GiftCandle(Base):
    """Одна свеча от одной сессии на один подарок."""

    __tablename__ = "gift_candles"
    __table_args__ = (UniqueConstraint("gift_id", "voter_hash", name="uq_gift_candles_gift_voter"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    gift_id: Mapped[str] = mapped_column(String(36), ForeignKey("gifts.id"), index=True)
    voter_hash: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CandleLight(Base):
    """Свеча дня: одна сессия — одна свеча на шар в сутки, DAILY_CANDLES в сутки.

    Старая таблица gift_candles («одна свеча навсегда») остаётся для истории.
    """

    __tablename__ = "candle_lights"
    __table_args__ = (
        UniqueConstraint("gift_id", "voter_hash", "day", name="uq_candle_lights_gift_voter_day"),
        Index("ix_candle_lights_voter_day", "voter_hash", "day"),
        Index("ix_candle_lights_day_gift", "day", "gift_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    gift_id: Mapped[str] = mapped_column(String(36), ForeignKey("gifts.id"))
    voter_hash: Mapped[str] = mapped_column(String(128))
    day: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class TelegramLink(Base):
    """Мастер подключил уведомления в Telegram-боте."""

    __tablename__ = "telegram_links"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    chat_id: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AppFlag(Base):
    """Маленькое хранилище «уже сделано» для фоновых задач (переживает рестарт)."""

    __tablename__ = "app_flags"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GiftReport(Base):
    """Жалоба на подарок. Одна сессия — одна жалоба на подарок."""

    __tablename__ = "gift_reports"
    __table_args__ = (UniqueConstraint("gift_id", "reporter_hash", name="uq_gift_reports_gift_reporter"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    gift_id: Mapped[str] = mapped_column(String(36), ForeignKey("gifts.id"), index=True)
    reporter_hash: Mapped[str] = mapped_column(String(128))
    reason: Mapped[str] = mapped_column(String(32), default="other")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ExchangeRingHandshake(Base):
    __tablename__ = "exchange_ring_handshakes"
    __table_args__ = (
        Index("uq_handshake_cycle_giver", "cycle_year", "giver_user_id", unique=True),
        Index("uq_handshake_cycle_receiver", "cycle_year", "receiver_user_id", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    cycle_year: Mapped[int] = mapped_column(Integer, default=2026, index=True)
    giver_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    receiver_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    gift_id: Mapped[str] = mapped_column(String(36), ForeignKey("gifts.id"))
    giver_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    receiver_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    is_unpacked: Mapped[bool] = mapped_column(Boolean, default=False)
    unlocked_contact_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    giver: Mapped["User"] = relationship("User", foreign_keys=[giver_user_id], lazy="selectin")
    receiver: Mapped["User"] = relationship("User", foreign_keys=[receiver_user_id], lazy="selectin")
    gift: Mapped["Gift"] = relationship("Gift", foreign_keys=[gift_id], lazy="selectin")
