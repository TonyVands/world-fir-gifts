"""Модерация текста и 3D-построек.

Алгоритм бит-в-бит повторяет frontend/src/lib/moderation.js — оба читают
одинаковый moderation_rules.json и проверяются общими тест-векторами
tests/fixtures/moderation_cases.json. Клиентская проверка — для удобства,
серверная — для защиты (клиент можно обойти).
"""

import json
import math
import re
from pathlib import Path

RULES = json.loads((Path(__file__).resolve().parent.parent / "core" / "moderation_rules.json").read_text("utf-8"))

_HOMOGLYPHS: dict[str, str] = RULES["homoglyphs"]
_ALLOW_WORDS = set(RULES["allow_words"])
_ALLOW_PREFIXES = tuple(RULES["allow_prefixes"])
_RAW_PATTERNS = [re.compile(p, re.IGNORECASE) for p in RULES["raw_patterns"]]
_CATEGORIES = [
    (c["title"], tuple(c["substrings"]), tuple(c["prefixes"]), set(c["words"])) for c in RULES["categories"]
]

_ZERO_WIDTH = re.compile("[​-‍﻿­]")
_SPLIT = re.compile(r"[^0-9a-zа-я@$]+")
_CYRILLIC = re.compile("[а-я]")
_RUN3 = re.compile(r"(.)\1{2,}")
_RUN2 = re.compile(r"(.)\1+")


def _prepare(raw: str) -> str:
    return _ZERO_WIDTH.sub("", str(raw or "")).lower().replace("ё", "е")


def _map_homoglyphs(token: str) -> str:
    return "".join(_HOMOGLYPHS.get(ch, ch) for ch in token)


def _tokens(prepared: str) -> list[str]:
    return [t for t in _SPLIT.split(prepared) if t]


def _variants(token: str) -> list[str]:
    bases = [token]
    if _CYRILLIC.search(token):
        bases.append(_map_homoglyphs(token))
    out: list[str] = []
    for b in bases:
        for v in (b, _RUN3.sub(r"\1", b), _RUN2.sub(r"\1", b)):
            if v not in out:
                out.append(v)
    return out


def _joined_runs(tokens: list[str]) -> list[str]:
    """Склеивает «р а з р я ж е н н ы е» слова: ≥2 подряд токенов из 1 символа
    или ≥3 подряд токенов длиной ≤2."""
    result: list[str] = []

    def flush(run: list[str]) -> None:
        if not run:
            return
        if (len(run) >= 2 and all(len(t) == 1 for t in run)) or len(run) >= 3:
            result.append("".join(run))

    run: list[str] = []
    for tok in tokens:
        if len(tok) <= 2:
            run.append(tok)
        else:
            flush(run)
            run = []
    flush(run)
    return result


def normalize_for_moderation(raw: str) -> str:
    """Нормализованное представление (для отладки и тестов)."""
    out = []
    for tok in _tokens(_prepare(raw)):
        t = _map_homoglyphs(tok) if _CYRILLIC.search(tok) else tok
        out.append(_RUN3.sub(r"\1", t))
    return " ".join(out)


def _match_token(variant: str) -> str | None:
    if variant in _ALLOW_WORDS or variant.startswith(_ALLOW_PREFIXES):
        return None
    for title, subs, prefixes, words in _CATEGORIES:
        if variant in words or variant.startswith(prefixes) or any(s in variant for s in subs):
            return title
    return None


def find_text_violation(raw: str) -> str | None:
    prepared = _prepare(raw)
    if not prepared:
        return None
    for pattern in _RAW_PATTERNS:
        if pattern.search(prepared):
            return RULES["raw_category"]
    tokens = _tokens(prepared)
    for tok in tokens + _joined_runs(tokens):
        for variant in _variants(tok):
            category = _match_token(variant)
            if category:
                return category
    return None


def inspect_content_safety(fields: dict[str, str]) -> dict:
    for field, value in fields.items():
        category = find_text_violation(value)
        if category:
            return {"is_safe": False, "field": field, "reason": category}
    return {"is_safe": True, "field": None, "reason": None}


# ---------------------------------------------------------------------------
# 3D-щит: порт inspectVoxelGeometrySafety из фронтенда (тот же порядок проверок)
# ---------------------------------------------------------------------------

_SWASTIKA_TEMPLATES = [
    [
        [1, 0, 1, 1, 1],
        [1, 0, 1, 0, 0],
        [1, 1, 1, 1, 1],
        [0, 0, 1, 0, 1],
        [1, 1, 1, 0, 1],
    ],
    [
        [1, 1, 1, 0, 1],
        [0, 0, 1, 0, 1],
        [1, 1, 1, 1, 1],
        [1, 0, 1, 0, 0],
        [1, 0, 1, 1, 1],
    ],
]


def _rotate(mat: list[list[int]]) -> list[list[int]]:
    res = [[0] * 8 for _ in range(8)]
    for r in range(8):
        for c in range(8):
            res[c][7 - r] = mat[r][c]
    return res


def _has_swastika(grid: list[list[int]]) -> bool:
    current = grid
    for _ in range(4):
        for r_off in range(4):
            for c_off in range(4):
                for tpl in _SWASTIKA_TEMPLATES:
                    ones = zeros = 0
                    for r in range(5):
                        for c in range(5):
                            val = current[r_off + r][c_off + c]
                            if tpl[r][c] == 1 and val == 1:
                                ones += 1
                            if tpl[r][c] == 0 and val == 0:
                                zeros += 1
                    if ones >= 15 and zeros >= 7:
                        return True
        current = _rotate(current)
    return False


def _clamp(v) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        n = 0
    return max(0, min(7, n))


def inspect_voxel_geometry_safety(voxels: list[dict] | None) -> dict:
    if not voxels or len(voxels) < 4:
        return {
            "is_safe": False,
            "code": "TOO_FEW_BLOCKS",
            "reason": "Постройте фигурку минимум из 4 воксельных кубиков внутри шара.",
        }

    unique: dict[str, dict] = {}
    for v in voxels:
        x, y, z = _clamp(v.get("x")), _clamp(v.get("y")), _clamp(v.get("z"))
        unique[f"{x},{y},{z}"] = {"x": x, "y": y, "z": z}
    pts = list(unique.values())
    total = len(pts)

    for sl in range(8):
        g_xy = [[0] * 8 for _ in range(8)]
        g_xz = [[0] * 8 for _ in range(8)]
        g_yz = [[0] * 8 for _ in range(8)]
        for p in pts:
            if p["z"] == sl:
                g_xy[p["y"]][p["x"]] = 1
            if p["y"] == sl:
                g_xz[p["z"]][p["x"]] = 1
            if p["x"] == sl:
                g_yz[p["y"]][p["z"]] = 1
        if _has_swastika(g_xy) or _has_swastika(g_xz) or _has_swastika(g_yz):
            return {
                "is_safe": False,
                "code": "BANNED_SYMBOL_3D",
                "reason": "3D-анализатор обнаружил запрещённую символику на одном из срезов модели.",
            }

    for main, u, w in (("y", "x", "z"), ("x", "y", "z"), ("z", "x", "y")):
        layers: list[list[dict]] = [[] for _ in range(8)]
        for p in pts:
            layers[p[main]].append(p)
        non_empty = [i for i in range(8) if layers[i]]
        if len(non_empty) < 5:
            continue
        stats = []
        for lvl in non_empty:
            arr = layers[lvl]
            u_vals = [p[u] for p in arr]
            v_vals = [p[w] for p in arr]
            span_u = max(u_vals) - min(u_vals) + 1
            span_v = max(v_vals) - min(v_vals) + 1
            stats.append(
                {
                    "count": len(arr),
                    "span_u": span_u,
                    "span_v": span_v,
                    "max_span": max(span_u, span_v),
                    "center_u": sum(u_vals) / len(u_vals),
                    "center_v": sum(v_vals) / len(v_vals),
                }
            )
        for ordered in (stats, list(reversed(stats))):
            base, upper = ordered[:2], ordered[2:]
            max_base_span = max(s["max_span"] for s in base)
            base_count = sum(s["count"] for s in base)
            shaft = [s for s in upper if s["span_u"] <= 2 and s["span_v"] <= 2 and s["count"] <= 4]
            wide_upper = [s for s in upper if s["max_span"] >= 3]
            if max_base_span >= 4 and 4 <= base_count <= 18 and len(shaft) >= 4 and not wide_upper:
                avg_u = sum(s["center_u"] for s in shaft) / len(shaft)
                avg_v = sum(s["center_v"] for s in shaft) / len(shaft)
                deviation = max(math.hypot(s["center_u"] - avg_u, s["center_v"] - avg_v) for s in shaft)
                if deviation <= 1.1:
                    return {
                        "is_safe": False,
                        "code": "NSFW_SILHOUETTE_18PLUS",
                        "reason": (
                            "3D-фильтр 18+ обнаружил недопустимый анатомический силуэт или жест "
                            "(узкий столб на широком основании). Добавьте боковые ветви, крышу или декор."
                        ),
                    }

    # Связность: доля крупнейшего кластера (соседство по 26 направлениям)
    keys = {(p["x"], p["y"], p["z"]) for p in pts}
    visited: set[tuple[int, int, int]] = set()
    largest = 0
    for start in keys:
        if start in visited:
            continue
        size = 0
        stack = [start]
        visited.add(start)
        while stack:
            cx, cy, cz = stack.pop()
            size += 1
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        nb = (cx + dx, cy + dy, cz + dz)
                        if nb in keys and nb not in visited:
                            visited.add(nb)
                            stack.append(nb)
        largest = max(largest, size)
    if total > 10 and largest / total < 0.45:
        return {
            "is_safe": False,
            "code": "FRAGMENTED_NOISE",
            "reason": "Воксели слишком разрознены в воздухе. Соедините блоки в цельную 3D-композицию.",
        }

    return {"is_safe": True, "code": "OK", "reason": None}
