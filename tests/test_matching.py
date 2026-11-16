import math

import pytest

from app.services.matching import (
    calculate_gift_quality_score,
    compute_artifact_genome_hash,
    compute_fibonacci_spiral_slot,
)
from app.schemas import quality_tier_badge


def test_spiral_slot_first_positions():
    slot0 = compute_fibonacci_spiral_slot(0)
    assert slot0.sequence_number == 0
    assert slot0.tier_index == 0
    assert slot0.branch_angle_rad == 0.0
    assert slot0.y_height == 0.0
    assert slot0.radius_offset == pytest.approx(5.5188, abs=1e-9)

    assert compute_fibonacci_spiral_slot(12).tier_index == 1
    assert compute_fibonacci_spiral_slot(11).tier_index == 0


def test_spiral_slot_invariants():
    prev_y = -1.0
    for seq in range(0, 240):
        slot = compute_fibonacci_spiral_slot(seq)
        assert 0.0 <= slot.branch_angle_rad < 2.0 * math.pi
        assert slot.tier_index == seq // 12
        assert slot.y_height == pytest.approx(seq * 0.42, abs=1e-3)
        assert slot.y_height >= prev_y
        assert slot.radius_offset > 0
        prev_y = slot.y_height


def _payload(wish: str, *, voxels: int = 24, engraving: str = "Ручная работа", dense: bool = True):
    melody = {
        "tempo_bpm": 104,
        "celesta_track": [7, 9, 10, 13] + [0] * 12 if dense else [0] * 16,
        "harp_track": [1, 4, 5, 7] + [0] * 12 if dense else [0] * 16,
        "cello_track": [1] + [0] * 15 if dense else [0] * 16,
        "flute_track": [0, 10, 0, 13] + [0] * 12 if dense else [0] * 16,
        "drum_track": [1, 4, 5, 4] + [0] * 12 if dense else [0] * 16,
    }
    return {
        "snowglobe": {"engraving_text": engraving, "voxels": [{"x": 0, "y": 0, "z": 0, "color": "#fff"}] * voxels},
        "melody": melody,
        "card": {"secret_wish": wish},
    }


def test_quality_score_deterministic():
    payload = _payload("С Новым годом, дорогой друг! Пусть дома ждёт уют и чай.")
    assert calculate_gift_quality_score(payload, candles_count=3) == calculate_gift_quality_score(
        payload, candles_count=3
    )


def test_quality_score_candles_increase():
    payload = _payload("С Новым годом, дорогой друг! Пусть дома ждёт уют и чай.")
    low = calculate_gift_quality_score(payload, candles_count=0)
    high = calculate_gift_quality_score(payload, candles_count=8)
    assert high > low


def test_quality_score_caps_at_100():
    rich = _payload(
        "Дорогой друг! " + "Пусть свет звёзд хранит тепло, уют и радость в каждом дне. " * 8,
        voxels=400,
        engraving="Свет сквозь снега 2026 — хрустальный шар ручной работы",
    )
    score = calculate_gift_quality_score(rich, candles_count=12)
    assert score <= 100.0
    assert score >= 75.0
    assert quality_tier_badge(score) == "Золотой Мастер"


def test_quality_score_empty_artifact():
    score = calculate_gift_quality_score(
        {"snowglobe": {"engraving_text": "", "voxels": []}, "melody": {}, "card": {"secret_wish": ""}},
        candles_count=0,
    )
    # Фолбэк-ветка формулы (как и на фронте) даёт базовые 8 условных слов * 0.8 = 6.4
    assert score == 6.4
    assert quality_tier_badge(score) == "Хрустальный"


def test_quality_score_fallback_by_char_count():
    base = _payload("", dense=False)
    base["card"]["secret_wish"] = ""
    with_count = dict(base)
    with_count["wish_char_count"] = 180
    assert calculate_gift_quality_score(with_count, candles_count=2) > calculate_gift_quality_score(
        base, candles_count=2
    )


def test_quality_tier_badges():
    assert quality_tier_badge(82.5) == "Золотой Мастер"
    assert quality_tier_badge(45.0) == "Серебряный"
    assert quality_tier_badge(44.9) == "Хрустальный"


def test_genome_hash_shape_and_stability():
    snowglobe = {
        "base_material": "birch",
        "engraving_text": "Свет сквозь снега",
        "voxels": [{"x": 1, "y": 2, "z": 3, "color": "#fff"}],
    }
    melody = {"tempo_bpm": 104, "celesta_track": [7, 9], "harp_track": [], "cello_track": [], "flute_track": [], "drum_track": []}
    first = compute_artifact_genome_hash(snowglobe, melody)
    second = compute_artifact_genome_hash(snowglobe, melody)
    assert first == second
    assert first.startswith("0x") and len(first) == 18


def test_genome_hash_voxel_order_independent():
    melody = {"tempo_bpm": 108, "celesta_track": [7], "harp_track": [], "cello_track": [], "flute_track": [], "drum_track": []}
    a = {"voxels": [{"x": 1, "y": 0, "z": 0, "color": "#a"}, {"x": 0, "y": 1, "z": 0, "color": "#b"}]}
    b = {"voxels": [{"x": 0, "y": 1, "z": 0, "color": "#b"}, {"x": 1, "y": 0, "z": 0, "color": "#a"}]}
    assert compute_artifact_genome_hash(a, melody) == compute_artifact_genome_hash(b, melody)


def test_genome_hash_changes_with_content():
    melody = {"tempo_bpm": 104, "celesta_track": [7], "harp_track": [], "cello_track": [], "flute_track": [], "drum_track": []}
    a = {"engraving_text": "абв", "voxels": []}
    b = {"engraving_text": "абг", "voxels": []}
    assert compute_artifact_genome_hash(a, melody) != compute_artifact_genome_hash(b, melody)
