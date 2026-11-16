from app.services.ring import build_exchange_ring_pairs


def test_ring_is_derangement_single_cycle():
    ids = [f"u{i}" for i in range(10)]
    pairs = build_exchange_ring_pairs(ids)

    assert len(pairs) == 10
    givers = [g for g, _ in pairs]
    receivers = [r for _, r in pairs]
    assert sorted(givers) == sorted(ids)
    assert sorted(receivers) == sorted(ids)
    assert all(giver != receiver for giver, receiver in pairs)

    next_map = dict(pairs)
    cursor = ids[0]
    visited = {cursor}
    for _ in range(len(ids) - 1):
        cursor = next_map[cursor]
        visited.add(cursor)
    assert visited == set(ids)
    assert next_map[cursor] == ids[0]


def test_ring_deterministic_and_order_independent():
    ids = ["u1", "u2", "u3", "u4", "u5"]
    first = build_exchange_ring_pairs(ids)
    assert first == build_exchange_ring_pairs(ids)
    assert first == build_exchange_ring_pairs(list(reversed(ids)))


def test_ring_small_inputs():
    assert build_exchange_ring_pairs([]) == []
    assert build_exchange_ring_pairs(["solo"]) == []
    assert sorted(build_exchange_ring_pairs(["a", "b"])) == [("a", "b"), ("b", "a")]


def test_ring_deduplicates_users():
    pairs = build_exchange_ring_pairs(["a", "b", "a", "c", "b"])
    assert len(pairs) == 3
    assert all(g != r for g, r in pairs)
