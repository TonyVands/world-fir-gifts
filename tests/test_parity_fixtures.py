import json
import pathlib

from app.services.matching import (
    build_genome_canonical,
    calculate_gift_quality_score,
    compute_artifact_genome_hash,
    compute_fibonacci_spiral_slot,
)

FIXTURE_PATH = pathlib.Path(__file__).parent / "fixtures" / "parity_golden.json"
GOLDEN = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_fixture_not_empty():
    assert GOLDEN["spiral_slots"]
    assert GOLDEN["quality_scores"]
    assert GOLDEN["genome_hashes"]


def test_parity_spiral_slots():
    for expected in GOLDEN["spiral_slots"]:
        actual = compute_fibonacci_spiral_slot(expected["sequence_number"]).model_dump()
        assert actual == expected


def test_parity_quality_scores():
    for case in GOLDEN["quality_scores"]:
        actual = calculate_gift_quality_score(case["payload"], case["candles_count"])
        assert actual == case["score"], case["id"]


def test_parity_genome_canonical_and_hash():
    for case in GOLDEN["genome_hashes"]:
        assert build_genome_canonical(case["snowglobe"], case["melody"]) == case["canonical"], case["id"]
        assert compute_artifact_genome_hash(case["snowglobe"], case["melody"]) == case["hash"], case["id"]
