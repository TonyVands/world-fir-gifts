from app.services.matching import verify_deep_text_safety, verify_voxel_topology_safety
from app.services.seeder import VOXEL_BLUEPRINTS, build_seed_voxels


def test_text_safety_allows_clean_wish():
    ok, reason = verify_deep_text_safety("С Новым годом! Пусть дома ждёт уют и чай.")
    assert ok and reason is None


def test_text_safety_blocks_obscenity():
    for text in ("иди нахуй", "пиздатый шар", "блядский цирк", "продажа сука"):
        ok, reason = verify_deep_text_safety(text)
        assert not ok, text
        assert "18+" in reason


def test_text_safety_blocks_links():
    for text in ("заходи на https://example.com", "пиши t.me/spam_bot", "оплати перевод"):
        ok, reason = verify_deep_text_safety(text)
        assert not ok, text
        assert reason


def test_voxel_topology_requires_min_blocks():
    # Паритет с фронтендом: меньше 4 кубиков — это не постройка.
    ok, reason = verify_voxel_topology_safety(
        [{"x": 0, "y": 0, "z": 0}, {"x": 1, "y": 1, "z": 0}, {"x": 2, "y": 2, "z": 1}]
    )
    assert not ok and "4" in reason


def test_voxel_topology_allows_compact_figure():
    voxels = [{"x": x, "y": y, "z": 3} for x in range(3, 5) for y in range(0, 2)]
    ok, reason = verify_voxel_topology_safety(voxels)
    assert ok and reason is None


def test_voxel_topology_blocks_banned_symbol():
    tpl = [
        [1, 0, 1, 1, 1],
        [1, 0, 1, 0, 0],
        [1, 1, 1, 1, 1],
        [0, 0, 1, 0, 1],
        [1, 1, 1, 0, 1],
    ]
    voxels = [{"x": c + 1, "y": r + 1, "z": 2} for r in range(5) for c in range(5) if tpl[r][c]]
    ok, reason = verify_voxel_topology_safety(voxels)
    assert not ok and "символик" in reason


def test_voxel_topology_blocks_phallic_silhouette():
    voxels = [
        {"x": 2, "y": 0, "z": 3},
        {"x": 3, "y": 0, "z": 3},
        {"x": 4, "y": 0, "z": 3},
        {"x": 5, "y": 0, "z": 3},
        {"x": 3, "y": 1, "z": 3},
        {"x": 3, "y": 2, "z": 3},
        {"x": 3, "y": 3, "z": 3},
        {"x": 3, "y": 4, "z": 3},
        {"x": 3, "y": 5, "z": 3},
    ]
    ok, reason = verify_voxel_topology_safety(voxels)
    assert not ok
    assert "18+" in reason


def test_voxel_topology_allows_narrow_tower():
    voxels = [
        {"x": 3, "y": 0, "z": 3},
        {"x": 4, "y": 0, "z": 3},
        {"x": 3, "y": 0, "z": 4},
        {"x": 4, "y": 0, "z": 4},
        {"x": 3, "y": 1, "z": 3},
        {"x": 3, "y": 2, "z": 3},
        {"x": 3, "y": 3, "z": 3},
        {"x": 3, "y": 4, "z": 3},
        {"x": 3, "y": 5, "z": 3},
    ]
    ok, reason = verify_voxel_topology_safety(voxels)
    assert ok and reason is None


def test_seed_presets_pass_own_moderation():
    for preset_id in VOXEL_BLUEPRINTS:
        ok, reason = verify_voxel_topology_safety(build_seed_voxels(preset_id))
        assert ok, f"пресет {preset_id} должен проходить собственный фильтр: {reason}"
