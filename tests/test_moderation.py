import json
import pathlib

from app.services.moderation import find_text_violation, inspect_content_safety, normalize_for_moderation

ROOT = pathlib.Path(__file__).resolve().parent.parent
CASES = json.loads((ROOT / "tests" / "fixtures" / "moderation_cases.json").read_text("utf-8"))


def test_shared_vectors_safe():
    for text in CASES["safe"]:
        assert find_text_violation(text) is None, text


def test_shared_vectors_unsafe():
    for text in CASES["unsafe"]:
        assert find_text_violation(text) is not None, text


def test_normalization_matches_frontend_contract():
    assert normalize_for_moderation("сукa") == "сука"
    assert normalize_for_moderation("ХУУУЙ") == "хуй"


def test_inspect_reports_field():
    result = inspect_content_safety({"Город": "Мирный", "Автор": "Казино Вулкан"})
    assert result == {"is_safe": False, "field": "Автор", "reason": "Финансовый скам и приманки"}


def test_rules_file_identical_on_frontend_and_backend():
    backend = (ROOT / "app" / "core" / "moderation_rules.json").read_bytes()
    frontend_path = ROOT / "frontend" / "src" / "lib" / "moderation_rules.json"
    if frontend_path.exists():  # в Docker-образе фронтенда нет — проверяем в репозитории
        assert frontend_path.read_bytes() == backend, "скопируйте moderation_rules.json во frontend/src/lib/"
