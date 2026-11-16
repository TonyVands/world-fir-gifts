import re
import unicodedata
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from app.core.unlock import UNLOCK_TIMESTAMP  # noqa: F401  (реэкспорт для роутеров)

QUALITY_TIER_BADGES = ("Хрустальный", "Серебряный", "Золотой Мастер")

HEX_COLOR_PATTERN = r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
NOTE_MAX = 18  # индексы NOTE_FREQUENCIES на фронтенде: 0..18 (ударные 0..6)
TRACK_STEPS = 16


def _clean_text(value: str, *, multiline: bool = False) -> str:
    """Убирает управляющие и bidi-символы (подмена направления текста, невидимки)."""
    out = []
    for ch in value:
        if multiline and ch == "\n":
            out.append(ch)
            continue
        if unicodedata.category(ch) in ("Cc", "Cf", "Co", "Cs"):
            continue
        out.append(ch)
    cleaned = "".join(out).strip()
    if multiline:
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    else:
        cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def _single_line(value):
    return _clean_text(value) if isinstance(value, str) else value


def _multi_line(value):
    return _clean_text(value, multiline=True) if isinstance(value, str) else value


# BeforeValidator: чистим ДО проверки длины, чтобы «   » не проходил min_length.
SingleLine = Annotated[str, BeforeValidator(_single_line)]
MultiLine = Annotated[str, BeforeValidator(_multi_line)]
HexColor = Annotated[str, Field(pattern=HEX_COLOR_PATTERN)]
Note = Annotated[int, Field(ge=0, le=NOTE_MAX)]
Track = Annotated[list[Note], Field(min_length=TRACK_STEPS, max_length=TRACK_STEPS)]

_TG_LINK = re.compile(r"^(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me)/@?([A-Za-z0-9_]{4,32})/?$", re.IGNORECASE)
_TG_HANDLE = re.compile(r"^@?([A-Za-z][A-Za-z0-9_]{3,31})$")
_PHONE = re.compile(r"^\+?[0-9][0-9 ()\-]{6,18}[0-9]$")
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$")


def normalize_contact(raw: str) -> tuple[str, str]:
    """Возвращает (тип, нормализованный контакт). Ссылку t.me приводим к @нику."""
    value = _clean_text(raw)
    m = _TG_LINK.match(value)
    if m:
        return "telegram", "@" + m.group(1)
    m = _TG_HANDLE.match(value)
    if m:
        return "telegram", "@" + m.group(1)
    if _PHONE.match(value):
        return "phone", value
    if _EMAIL.match(value):
        return "email", value
    return "other", value


class VoxelBlockSchema(BaseModel):
    x: int = Field(ge=0, le=7)
    y: int = Field(ge=0, le=7)
    z: int = Field(ge=0, le=7)
    color: str = Field(default="#fbbf24")


class SnowglobeSchema(BaseModel):
    sculpture_id: str = "cottage"
    base_material: str = "mahogany"
    glitter_color: str = "#fde047"
    custom_craft_title: str | None = None
    engraving_text: str = Field(default="Свет сквозь снега", max_length=60)
    voxels: list[VoxelBlockSchema] = Field(default_factory=list)


class PackagingSchema(BaseModel):
    box_shape: str = "cube"
    paper_pattern: str = "nordic_knit"
    ribbon_color: str = "#fbbf24"
    wax_seal_stamp: str = "owl"


class MelodySchema(BaseModel):
    tempo_bpm: int = Field(default=104, ge=60, le=180)
    celesta_track: list[int] = Field(default_factory=lambda: [0] * 16)
    harp_track: list[int] = Field(default_factory=lambda: [0] * 16)
    cello_track: list[int] = Field(default_factory=lambda: [0] * 16)
    flute_track: list[int] = Field(default_factory=lambda: [0] * 16)
    drum_track: list[int] = Field(default_factory=lambda: [0] * 16)


class PublicCardPreviewSchema(BaseModel):
    teaser_tag: str = Field(max_length=120)
    author_display_name: str = Field(max_length=60)
    city: str = Field(max_length=60)
    totem_pet: str = Field(default="Полярная сова", max_length=60)


# --- Строгие схемы ВХОДА (выдача остаётся мягкой: в БД могут лежать старые записи) ---

BaseMaterial = Literal["mahogany", "brass", "obsidian", "birch"]
BoxShape = Literal["cube", "cylinder", "hex_prism", "pyramid_box"]
PaperPattern = Literal["nordic_knit", "gold_stars", "velvet_red", "kraft_vintage", "emerald_frost"]
WaxSeal = Literal["owl", "snowflake", "crown", "star", "compass"]


class VoxelBlockInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    x: int = Field(ge=0, le=7)
    y: int = Field(ge=0, le=7)
    z: int = Field(ge=0, le=7)
    color: HexColor = "#fbbf24"


class SnowglobeInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sculpture_id: str = Field(default="cottage", pattern=r"^[a-z0-9_]{1,32}$")
    base_material: BaseMaterial = "mahogany"
    glitter_color: HexColor = "#fde047"
    custom_craft_title: Annotated[SingleLine, Field(max_length=120)] | None = None
    engraving_text: Annotated[SingleLine, Field(max_length=60)] = "Свет сквозь снега"
    voxels: list[VoxelBlockInput] = Field(default_factory=list, max_length=512)


class PackagingInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    box_shape: BoxShape = "cube"
    paper_pattern: PaperPattern = "nordic_knit"
    ribbon_color: HexColor = "#fbbf24"
    wax_seal_stamp: WaxSeal = "owl"


class MelodyInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tempo_bpm: int = Field(default=104, ge=60, le=180)
    celesta_track: Track = Field(default_factory=lambda: [0] * TRACK_STEPS)
    harp_track: Track = Field(default_factory=lambda: [0] * TRACK_STEPS)
    cello_track: Track = Field(default_factory=lambda: [0] * TRACK_STEPS)
    flute_track: Track = Field(default_factory=lambda: [0] * TRACK_STEPS)
    drum_track: Track = Field(default_factory=lambda: [0] * TRACK_STEPS)


class GiftCardCreateSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")

    teaser_tag: Annotated[SingleLine, Field(min_length=1, max_length=120)]
    author_display_name: Annotated[SingleLine, Field(min_length=1, max_length=60)]
    city: Annotated[SingleLine, Field(min_length=1, max_length=60)]
    totem_pet: Annotated[SingleLine, Field(min_length=1, max_length=60)] = "Полярная сова"
    secret_wish: Annotated[MultiLine, Field(min_length=10, max_length=2500)]
    contact_handle: Annotated[SingleLine, Field(min_length=3, max_length=120)]


class GiftCreateRequest(BaseModel):
    # author_id больше не используется: автор определяется по X-Session-Token.
    model_config = ConfigDict(extra="ignore")

    snowglobe: SnowglobeInput
    packaging: PackagingInput
    melody: MelodyInput
    card: GiftCardCreateSchema


class SpiralSlotCoordinates(BaseModel):
    sequence_number: int
    tier_index: int
    branch_angle_rad: float
    radius_offset: float
    y_height: float


class PublicShowcaseGiftDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_order: int
    coordinates: SpiralSlotCoordinates
    snowglobe: SnowglobeSchema
    packaging: PackagingSchema
    melody: MelodySchema
    card_preview: PublicCardPreviewSchema
    wish_char_count: int
    quality_score: float
    quality_tier_badge: Literal["Хрустальный", "Серебряный", "Золотой Мастер"]
    candles_count: int
    genome_hash: str
    created_at: datetime


class CreatedGiftDTO(PublicShowcaseGiftDTO):
    """Ответ автору на создание шара: только ему сообщаем его user_id."""

    my_user_id: str


class CandleStatusDTO(BaseModel):
    day: str
    daily_limit: int
    remaining_today: int
    lit_today: list[str] = Field(default_factory=list)
    resets_at: datetime


class LeaderEntryDTO(BaseModel):
    gift_id: str
    candles: int
    teaser_tag: str
    author_display_name: str
    city: str


class LeaderboardDTO(BaseModel):
    day: str
    today: list[LeaderEntryDTO] = Field(default_factory=list)
    yesterday_winner: LeaderEntryDTO | None = None
    resets_at: datetime


class UserProfileDTO(BaseModel):
    user_id: str | None
    display_name: str | None = None
    city: str | None = None
    totem_pet: str | None = None
    gift_ids: list[str] = Field(default_factory=list)
    max_gifts: int = 3


class UnlockedGiftDTO(BaseModel):
    gift_id: str
    teaser_tag: str
    snowglobe: SnowglobeSchema
    packaging: PackagingSchema
    melody: MelodySchema
    secret_wish: str
    wish_char_count: int
    quality_score: float
    quality_tier_badge: Literal["Хрустальный", "Серебряный", "Золотой Мастер"]
    candles_count: int
    genome_hash: str

    @classmethod
    def from_orm_gift(cls, gift) -> "UnlockedGiftDTO":
        wish = gift.secret_wish or ""
        return cls(
            gift_id=gift.id,
            teaser_tag=(gift.card_preview or {}).get("teaser_tag", "Дар Севера"),
            snowglobe=gift.snowglobe,
            packaging=gift.packaging,
            melody=gift.melody,
            secret_wish=wish,
            wish_char_count=len(wish),
            quality_score=gift.quality_score,
            quality_tier_badge=quality_tier_badge(gift.quality_score),
            candles_count=gift.candles_count,
            genome_hash=gift.genome_hash,
        )


class HandshakePartnerCardDTO(BaseModel):
    handshake_id: str
    role: Literal["MY_RECIPIENT", "MY_SECRET_SANTA"]
    partner_display_name: str
    partner_city: str
    partner_totem_pet: str
    my_consent: bool
    partner_consent: bool
    mutual_unlocked: bool
    partner_contact_type: str | None = None
    partner_decrypted_contact: str | None = None
    gift_details: UnlockedGiftDTO


class RingMatchResultDTO(BaseModel):
    cycle_year: int
    created: int
    participants: int


class RingStatusDTO(BaseModel):
    cycle_year: int
    participants: int
    handshakes: int
    unlocked: bool
    unlock_at: datetime
    formed: bool = False
    match_at: datetime | None = None
    server_time: datetime


class GiftReportRequest(BaseModel):
    reason: Literal["nsfw", "obscene", "scam", "spam", "other"] = "other"


class GiftReportResultDTO(BaseModel):
    gift_id: str
    accepted: bool
    quarantined: bool


def quality_tier_badge(score: float) -> str:
    if score >= 75:
        return "Золотой Мастер"
    if score >= 45:
        return "Серебряный"
    return "Хрустальный"
