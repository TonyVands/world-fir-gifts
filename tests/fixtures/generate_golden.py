"""Регенерация «золотых» фикстур паритета бэкенд/фронтенд.

Запуск: .venv/bin/python tests/fixtures/generate_golden.py
Результат: tests/fixtures/parity_golden.json — сверяется и pytest-ом, и vitest-ом.
"""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from app.services.matching import (  # noqa: E402
    build_genome_canonical,
    calculate_gift_quality_score,
    compute_artifact_genome_hash,
    compute_fibonacci_spiral_slot,
)

OUT_PATH = pathlib.Path(__file__).parent / "parity_golden.json"

SPIRAL_SEQS = [0, 1, 2, 5, 11, 12, 33, 57, 143]

DENSE_MELODY = {
    "tempo_bpm": 118,
    "celesta_track": [13, 12, 13, 11, 10, 9, 8, 7, 10, 9, 10, 8, 7, 6, 7, 0],
    "harp_track": [1, 0, 4, 0, 5, 0, 4, 0, 3, 0, 5, 0, 4, 0, 1, 0],
    "cello_track": [1, 0, 0, 0, 5, 0, 0, 0, 3, 0, 0, 0, 4, 0, 1, 0],
    "flute_track": [0, 0, 13, 0, 0, 0, 10, 0, 0, 0, 11, 0, 9, 0, 7, 0],
    "drum_track": [1, 0, 3, 3, 2, 0, 4, 0, 1, 1, 3, 0, 2, 3, 6, 0],
}
EMPTY_MELODY = {
    "tempo_bpm": 104,
    "celesta_track": [0] * 16,
    "harp_track": [0] * 16,
    "cello_track": [0] * 16,
    "flute_track": [0] * 16,
    "drum_track": [0] * 16,
}


def make_voxels(count: int) -> list[dict]:
    voxels = []
    for i in range(count):
        voxels.append({"x": i % 8, "y": (i // 8) % 8, "z": (i // 16) % 8, "color": "#fbbf24"})
    return voxels


QUALITY_CASES = [
    {
        "id": "hearth",
        "candles_count": 3,
        "payload": {
            "snowglobe": {
                "engraving_text": "Ручная работа • 2026",
                "voxels": make_voxels(40),
            },
            "melody": DENSE_MELODY,
            "card": {
                "secret_wish": (
                    "С Новым годом! Пусть все замыслы исполняются с первой попытки, "
                    "а дома ждёт уют и чай."
                ),
            },
        },
    },
    {
        "id": "golden-master",
        "candles_count": 10,
        "payload": {
            "snowglobe": {
                "engraving_text": "Свет сквозь снега 2026 — хрустальный шар ручной работы",
                "voxels": make_voxels(200),
            },
            "melody": DENSE_MELODY,
            "card": {
                "secret_wish": (
                    "Дорогой друг, пусть этот хрустальный шар, собранный кубик за кубиком "
                    "и нота за нотой, хранит тепло моих рук. Желаю тебе северного сияния над "
                    "крышей, тёплого хлеба, добрых писем, смелых путешествий, ясных звёзд, "
                    "тихих вечеров и настоящих друзей рядом. С Новым годом и Рождеством!"
                ),
            },
        },
    },
    {
        "id": "minimal",
        "candles_count": 0,
        "payload": {
            "snowglobe": {"engraving_text": "", "voxels": []},
            "melody": EMPTY_MELODY,
            "card": {"secret_wish": "Привет, добрый человек!"},
        },
    },
    {
        "id": "no-wish-fallback",
        "candles_count": 2,
        "payload": {
            "snowglobe": {"engraving_text": "Ручная работа", "voxels": make_voxels(24)},
            "melody": DENSE_MELODY,
            "card": {"secret_wish": ""},
            "wish_char_count": 180,
        },
    },
]

GENOME_CASES = [
    {
        "id": "cyrillic-unsorted",
        "snowglobe": {
            "base_material": "birch",
            "engraving_text": "Свет сквозь снега",
            "voxels": [
                {"x": 5, "y": 2, "z": 1, "color": "#38bdf8"},
                {"x": 1, "y": 7, "z": 3, "color": "#fbbf24"},
                {"x": 1, "y": 2, "z": 6, "color": "#e11d48"},
                {"x": 5, "y": 0, "z": 1, "color": "#f8fafc"},
            ],
        },
        "melody": DENSE_MELODY,
    },
    {
        "id": "empty-defaults",
        "snowglobe": {"voxels": []},
        "melody": EMPTY_MELODY,
    },
    {
        "id": "tempo-zero-tracks",
        "snowglobe": {
            "base_material": "obsidian",
            "engraving_text": "абв 0x1234",
            "voxels": [{"x": 0, "y": 0, "z": 0, "color": "#000000"}],
        },
        "melody": {
            "tempo_bpm": 0,
            "celesta_track": [],
            "harp_track": [7, 9],
            "cello_track": [1],
            "flute_track": [],
            "drum_track": [1, 4, 5, 4],
        },
    },
]


def main() -> None:
    data = {
        "spiral_slots": [
            compute_fibonacci_spiral_slot(seq).model_dump() for seq in SPIRAL_SEQS
        ],
        "quality_scores": [
            {
                "id": case["id"],
                "candles_count": case["candles_count"],
                "payload": case["payload"],
                "score": calculate_gift_quality_score(case["payload"], case["candles_count"]),
            }
            for case in QUALITY_CASES
        ],
        "genome_hashes": [
            {
                "id": case["id"],
                "snowglobe": case["snowglobe"],
                "melody": case["melody"],
                "canonical": build_genome_canonical(case["snowglobe"], case["melody"]),
                "hash": compute_artifact_genome_hash(case["snowglobe"], case["melody"]),
            }
            for case in GENOME_CASES
        ],
    }
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Записано: {OUT_PATH}")


if __name__ == "__main__":
    main()
