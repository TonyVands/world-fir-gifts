import logging
import random

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import hash_session_token
from app.core.security import crypto_service
from app.models import Gift, User
from app.services.matching import (
    calculate_gift_quality_score,
    compute_artifact_genome_hash,
)

logger = logging.getLogger("uvicorn.error")

SEED_CITIES = ["Мирный", "Архангельск", "Санкт-Петербург", "Ярославль", "Уфа", "Мурманск"]
SEED_AUTHORS = ["Северный Инженер", "Хранитель Маяка", "Странник Орбиты", "Ночной Радист"]
SEED_TOTEMS = ["Полярная сова", "Северный лис", "Таёжная рысь", "Белый медведь"]
BASE_MATERIALS = ["mahogany", "brass", "obsidian", "birch"]
BOX_SHAPES = ["cube", "cylinder", "hex_prism", "pyramid_box"]
PAPER_PATTERNS = ["nordic_knit", "gold_stars", "velvet_red", "kraft_vintage", "emerald_frost"]
WAX_SEALS = ["owl", "snowflake", "crown", "star", "compass"]
RIBBON_COLORS = ["#fbbf24", "#fef08a", "#38bdf8", "#f43f5e", "#34d399"]
GLITTER_COLORS = ["#fde047", "#38bdf8", "#f472b6", "#34d399"]

SEED_WISHES = [
    "С Новым годом! Пусть все замыслы исполняются с первой попытки, а дома ждёт уют и чай.",
    "Пусть в новом году свет далёкого маяка всегда указывает дорогу домой, а снег скрипит только от радости.",
    "Желаю тихих счастливых вечеров, тёплого хлеба и настоящих писем от тех, кто далеко, но очень любим.",
    "Пусть этот хрустальный шар хранит тепло моих рук и напоминает: чудеса делают люди, а не машины.",
]

MELODY_PRESETS = [
    {
        "tempo_bpm": 104,
        "celesta_track": [7, 9, 10, 13, 12, 10, 9, 7, 8, 10, 11, 14, 13, 10, 9, 7],
        "harp_track": [1, 4, 5, 7, 5, 4, 3, 1, 2, 4, 5, 8, 7, 5, 4, 1],
        "cello_track": [1, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 5, 0, 1, 0],
        "flute_track": [0, 10, 0, 13, 0, 12, 0, 9, 0, 11, 0, 14, 0, 13, 10, 0],
        "drum_track": [1, 4, 5, 4, 2, 4, 5, 4, 1, 4, 5, 4, 2, 4, 6, 4],
    },
    {
        "tempo_bpm": 118,
        "celesta_track": [13, 12, 13, 11, 10, 9, 8, 7, 10, 9, 10, 8, 7, 6, 7, 0],
        "harp_track": [1, 0, 4, 0, 5, 0, 4, 0, 3, 0, 5, 0, 4, 0, 1, 0],
        "cello_track": [1, 0, 0, 0, 5, 0, 0, 0, 3, 0, 0, 0, 4, 0, 1, 0],
        "flute_track": [0, 0, 13, 0, 0, 0, 10, 0, 0, 0, 11, 0, 9, 0, 7, 0],
        "drum_track": [1, 0, 3, 3, 2, 0, 4, 0, 1, 1, 3, 0, 2, 3, 6, 0],
    },
    {
        "tempo_bpm": 126,
        "celesta_track": [7, 7, 10, 7, 11, 10, 9, 7, 8, 8, 11, 8, 13, 11, 10, 7],
        "harp_track": [1, 4, 1, 4, 5, 7, 5, 4, 2, 5, 2, 5, 4, 7, 4, 1],
        "cello_track": [1, 0, 4, 0, 5, 0, 4, 0, 2, 0, 5, 0, 4, 0, 1, 0],
        "flute_track": [0, 9, 10, 0, 13, 4, 0, 10, 0, 0, 11, 13, 0, 14, 0, 13],
        "drum_track": [1, 5, 2, 5, 1, 1, 2, 4, 1, 5, 2, 5, 1, 3, 2, 6],
    },
    {
        "tempo_bpm": 84,
        "celesta_track": [5, 7, 8, 10, 8, 7, 5, 3, 7, 8, 10, 11, 10, 8, 7, 5],
        "harp_track": [1, 3, 5, 0, 4, 5, 7, 0, 3, 5, 7, 0, 2, 4, 1, 0],
        "cello_track": [1, 0, 0, 0, 4, 0, 0, 0, 3, 0, 0, 0, 4, 0, 1, 0],
        "flute_track": [0, 8, 0, 10, 0, 9, 0, 7, 0, 10, 0, 9, 7, 0, 0, 0],
        "drum_track": [1, 5, 4, 5, 2, 5, 1, 4, 1, 5, 4, 5, 2, 5, 3, 6],
    },
]

VOXEL_BLUEPRINTS = ["cottage", "pine_tree", "snowman", "train", "star_heart"]


def build_seed_voxels(preset_id: str) -> list[dict]:
    blocks: list[dict] = []

    def add(x: int, y: int, z: int, color: str) -> None:
        blocks.append({"x": x, "y": y, "z": z, "color": color})

    if preset_id == "pine_tree":
        for y in range(0, 2):
            add(3, y, 3, "#92400e")
            add(4, y, 3, "#92400e")
            add(3, y, 4, "#92400e")
            add(4, y, 4, "#92400e")
        for x in range(1, 7):
            for z in range(1, 7):
                add(x, 2, z, "#059669")
        for x in range(2, 6):
            for z in range(2, 6):
                add(x, 3, z, "#059669")
                add(x, 4, z, "#10b981")
        for x in range(3, 5):
            for z in range(3, 5):
                add(x, 5, z, "#10b981")
                add(x, 6, z, "#f8fafc")
        add(3, 7, 3, "#fbbf24")
        add(4, 7, 4, "#fbbf24")
        add(1, 2, 1, "#e11d48")
        add(6, 2, 6, "#fbbf24")
        add(2, 4, 5, "#38bdf8")
    elif preset_id == "snowman":
        for x in range(2, 6):
            for z in range(2, 6):
                add(x, 0, z, "#f8fafc")
                add(x, 1, z, "#f8fafc")
                add(x, 2, z, "#f8fafc")
        for x in range(2, 6):
            for z in range(2, 6):
                add(x, 3, z, "#e11d48")
        for x in range(3, 5):
            for z in range(3, 5):
                add(x, 4, z, "#f8fafc")
                add(x, 5, z, "#f8fafc")
        add(3, 4, 5, "#f97316")
        add(3, 5, 5, "#1e293b")
        add(4, 5, 5, "#1e293b")
        for x in range(2, 6):
            for z in range(2, 6):
                add(x, 6, z, "#1e293b")
        add(3, 7, 3, "#fbbf24")
        add(4, 7, 4, "#fbbf24")
    elif preset_id == "train":
        for z in range(1, 7):
            add(2, 0, z, "#1e293b")
            add(5, 0, z, "#1e293b")
            for x in range(2, 6):
                add(x, 1, z, "#e11d48")
        for x in range(2, 6):
            for y in range(2, 5):
                add(x, y, 1, "#fbbf24")
                add(x, y, 2, "#fbbf24")
        for x in range(3, 5):
            for z in range(3, 7):
                add(x, 2, z, "#1e293b")
                add(x, 3, z, "#1e293b")
        add(3, 4, 5, "#fbbf24")
        add(3, 5, 5, "#f8fafc")
        add(3, 6, 4, "#f8fafc")
        add(4, 7, 3, "#38bdf8")
    elif preset_id == "star_heart":
        coords = [
            (3, 1, 3), (4, 1, 3),
            (2, 2, 3), (3, 2, 3), (4, 2, 3), (5, 2, 3),
            (1, 3, 3), (2, 3, 3), (3, 3, 3), (4, 3, 3), (5, 3, 3), (6, 3, 3),
            (1, 4, 3), (2, 4, 3), (3, 4, 3), (4, 4, 3), (5, 4, 3), (6, 4, 3),
            (2, 5, 3), (3, 5, 3), (4, 5, 3), (5, 5, 3),
            (2, 6, 3), (5, 6, 3),
        ]
        for x, y, z in coords:
            add(x, y, z, "#e11d48")
            add(x, y, z + 1, "#fbbf24")
        add(3, 3, 2, "#38bdf8")
        add(4, 4, 5, "#38bdf8")
    else:
        for x in range(1, 7):
            for z in range(1, 7):
                add(x, 0, z, "#f8fafc")
        for y in range(1, 4):
            for x in range(2, 6):
                for z in range(2, 6):
                    is_window = y == 2 and (x == 2 or x == 5 or z == 2 or z == 5)
                    add(x, y, z, "#fbbf24" if is_window else "#92400e")
        for x in range(1, 7):
            for z in range(1, 7):
                add(x, 4, z, "#e11d48")
        for x in range(2, 6):
            for z in range(2, 6):
                add(x, 5, z, "#f8fafc")
        for x in range(3, 5):
            for z in range(3, 5):
                add(x, 6, z, "#f8fafc")
        add(5, 5, 5, "#92400e")
        add(5, 6, 5, "#92400e")
        add(5, 7, 5, "#38bdf8")
    return blocks


async def seed_initial_gifts(session: AsyncSession, target_count: int = 60) -> int:
    """Засевает пустую Ёлку демо-шарами.

    Демо-мастера помечены is_demo=True: они украшают Ёлку, но не попадают
    в Кольцо Чудес (их контакты фиктивные). Войти от их имени нельзя —
    в БД лежит хеш короткого служебного значения, которое не пройдёт
    проверку формата сессионного токена.
    """
    count = (await session.execute(select(func.count(Gift.id)))).scalar_one()
    if count > 0:
        return 0

    rng = random.Random(20261231)
    gifts: list[Gift] = []

    for seq in range(target_count):
        city = SEED_CITIES[seq % len(SEED_CITIES)]
        name = f"{SEED_AUTHORS[seq % len(SEED_AUTHORS)]} #{seq + 1}"
        totem = SEED_TOTEMS[seq % len(SEED_TOTEMS)]
        blueprint_id = VOXEL_BLUEPRINTS[seq % len(VOXEL_BLUEPRINTS)]
        voxels = build_seed_voxels(blueprint_id)

        user = User(
            session_fingerprint=hash_session_token(f"seed-user-{seq:04d}"),
            is_demo=True,
            display_name=name,
            city=city,
            totem_pet=totem,
            contact_type="telegram",
            encrypted_contact=crypto_service.encrypt_contact(f"@bot_contact_{seq + 1}"),
        )
        session.add(user)
        await session.flush()

        snowglobe = {
            "sculpture_id": blueprint_id,
            "base_material": BASE_MATERIALS[seq % len(BASE_MATERIALS)],
            "glitter_color": GLITTER_COLORS[seq % len(GLITTER_COLORS)],
            "custom_craft_title": "Зимняя диорама",
            "engraving_text": "Свет сквозь снега 2026",
            "voxels": voxels,
        }
        packaging = {
            "box_shape": BOX_SHAPES[seq % len(BOX_SHAPES)],
            "paper_pattern": PAPER_PATTERNS[seq % len(PAPER_PATTERNS)],
            "ribbon_color": RIBBON_COLORS[seq % len(RIBBON_COLORS)],
            "wax_seal_stamp": WAX_SEALS[seq % len(WAX_SEALS)],
        }
        melody = dict(MELODY_PRESETS[seq % len(MELODY_PRESETS)])
        secret_wish = SEED_WISHES[seq % len(SEED_WISHES)]

        candles = rng.randint(1, 8)
        score = calculate_gift_quality_score(
            {"snowglobe": snowglobe, "melody": melody, "card": {"secret_wish": secret_wish}},
            candles_count=candles,
        )

        gift = Gift(
            author_id=user.id,
            sequence_number=seq,
            snowglobe=snowglobe,
            packaging=packaging,
            melody=melody,
            card_preview={
                "teaser_tag": f"Тёплый маяк #{seq + 1}",
                "author_display_name": name,
                "city": city,
                "totem_pet": totem,
            },
            secret_wish=secret_wish,
            encrypted_contact=crypto_service.encrypt_contact(f"@bot_contact_{seq + 1}"),
            quality_score=score,
            candles_count=candles,
            genome_hash=compute_artifact_genome_hash(snowglobe, melody),
        )
        gifts.append(gift)

    session.add_all(gifts)
    await session.commit()
    logger.info("[Seeder] Создано %s демо-подарков (без участия в Кольце).", len(gifts))
    return len(gifts)
