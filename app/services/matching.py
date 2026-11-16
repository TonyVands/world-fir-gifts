import hashlib
import json
import math
import re
from decimal import Decimal, ROUND_HALF_UP

from app.schemas import SpiralSlotCoordinates
from app.services.moderation import find_text_violation, inspect_voxel_geometry_safety

GOLDEN_ANGLE_RAD = math.pi * (3.0 - math.sqrt(5.0))
GIFTS_PER_TIER = 12
VERTICAL_STEP_PER_GIFT = 0.42

TEXT_REJECT_PREFIX = "Фильтр 18+ и анти-скам"


def verify_deep_text_safety(text: str) -> tuple[bool, str | None]:
    """Совместимая обёртка над общей модерацией (app/services/moderation.py)."""
    category = find_text_violation(text or "")
    if category:
        return False, f"{TEXT_REJECT_PREFIX}: {category}."
    return True, None


def verify_voxel_topology_safety(voxels: list[dict]) -> tuple[bool, str | None]:
    result = inspect_voxel_geometry_safety(voxels)
    if not result["is_safe"]:
        return False, f"3D-Топологический щит 18+: {result['reason']}"
    return True, None


def get_cone_envelope_radius(y_height: float) -> float:
    clamped = max(0.0, y_height)
    return 1.85 + clamped * 0.24 + 0.35 * math.sqrt(clamped)


def compute_fibonacci_spiral_slot(seq: int) -> SpiralSlotCoordinates:
    """Канонический слот Ёлки — формулы обязаны совпадать с frontend computeFibonacciSpiralSlot."""
    tier_index = seq // GIFTS_PER_TIER
    branch_angle_rad = (seq * GOLDEN_ANGLE_RAD) % (2.0 * math.pi)
    y_height = _round(seq * VERTICAL_STEP_PER_GIFT, 4)
    # Кромка листвы яруса и подвес подарочных шаров СНАРУЖИ — за кончиками лап
    foliage_edge = get_cone_envelope_radius(y_height + 1.2) * 0.88
    tier_wave = 0.24 * math.sin(seq * 0.7)
    radius_offset = _round(foliage_edge + 3.3 + tier_wave, 4)
    return SpiralSlotCoordinates(
        sequence_number=seq,
        tier_index=tier_index,
        branch_angle_rad=_round(branch_angle_rad, 6),
        radius_offset=radius_offset,
        y_height=y_height,
    )


def _round(value: float, digits: int) -> float:
    quant = Decimal(1).scaleb(-digits)
    return float(Decimal(value).quantize(quant, rounding=ROUND_HALF_UP))


def _round_1(value: float) -> float:
    return float(Decimal(value).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def calculate_gift_quality_score(payload: dict, candles_count: int = 0) -> float:
    """Индекс Тепла (LightScore) — порт формулы frontend computeAntiSybilScoreDetails."""
    card = payload.get("card") or {}
    wish_text = (card.get("secret_wish") or "").strip()

    if wish_text:
        effective_len = len(wish_text)
        effective_words = len({w.lower() for w in re.split(r"\s+", wish_text) if w})
    else:
        effective_len = int(payload.get("wish_char_count") or 0)
        effective_words = max(8, effective_len // 7)

    wish_score = min(effective_len / 12.0 + effective_words * 0.8, 45.0)

    melody = payload.get("melody") or {}
    all_notes: list[int] = []
    for track_name in ("celesta_track", "harp_track", "cello_track", "flute_track", "drum_track"):
        all_notes.extend(n for n in (melody.get(track_name) or []) if n > 0)
    active_notes = len(all_notes)
    unique_pitches = len(set(all_notes))
    melody_score = min(active_notes * 0.8 + unique_pitches * 1.8, 30.0)

    snowglobe = payload.get("snowglobe") or {}
    engraving = (snowglobe.get("engraving_text") or "").strip()
    voxels_count = int(payload.get("voxels_count") or len(snowglobe.get("voxels") or []))
    craft_score = min(len(engraving) * 0.2 + min(voxels_count * 0.15, 6.0), 10.0)

    candles_bonus = min(math.log2(max(0, candles_count) + 1) * 5.0, 15.0)

    return _round_1(wish_score + melody_score + craft_score + candles_bonus)


def build_genome_canonical(snowglobe: dict, melody: dict) -> str:
    """Каноническая строка «генома» артефакта — обязана совпадать с frontend buildGenomeCanonical."""
    voxels = snowglobe.get("voxels") or []
    sorted_voxels = sorted(voxels, key=lambda v: (v.get("x", 0), v.get("y", 0), v.get("z", 0)))
    vox_sig = "|".join(f"{v.get('x')},{v.get('y')},{v.get('z')}:{v.get('color')}" for v in sorted_voxels)

    def track_sig(name: str) -> str:
        return ",".join(str(n) for n in (melody.get(name) or []))

    mel_sig = ":".join(
        [
            str(melody.get("tempo_bpm") or 104),
            track_sig("celesta_track"),
            track_sig("harp_track"),
            track_sig("cello_track"),
            track_sig("flute_track"),
            track_sig("drum_track"),
        ]
    )
    base_material = snowglobe.get("base_material") or "mahogany"
    engraving = snowglobe.get("engraving_text") or ""
    return f"{vox_sig}__{mel_sig}__{base_material}__{engraving}"


def compute_artifact_genome_hash(snowglobe: dict, melody: dict) -> str:
    canonical = build_genome_canonical(snowglobe, melody)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
    return "0x" + digest


def build_gift_payload(snowglobe: dict, packaging: dict, melody: dict, secret_wish: str) -> dict:
    return {
        "snowglobe": snowglobe,
        "packaging": packaging,
        "melody": melody,
        "card": {"secret_wish": secret_wish},
    }


def gift_payload_from_model(gift) -> dict:
    return build_gift_payload(gift.snowglobe or {}, gift.packaging or {}, gift.melody or {}, gift.secret_wish or "")


def dumps_canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False)
