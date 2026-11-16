"""Нормализация городов из карточек шаров и поиск координат."""

from __future__ import annotations

import re
from functools import lru_cache

from app.data.cities import ALIASES, CITIES

_PREFIX = re.compile(r"^(г\.?|город|пос\.?|посёлок|поселок|с\.|село|д\.|деревня)\s+", re.I)


def _key(name: str) -> str:
    s = (name or "").strip().lower().replace("ё", "е")
    s = _PREFIX.sub("", s)
    s = re.sub(r"[\s_\-]+", " ", s).strip(" .,")
    return s


@lru_cache(maxsize=1)
def _index() -> dict[str, str]:
    idx = {_key(n): n for n in CITIES}
    for alias, canon in ALIASES.items():
        idx[_key(alias)] = canon
    return idx


def canonical_city(name: str) -> str | None:
    """Каноническое имя известного города или None."""
    return _index().get(_key(name))


def city_key(name: str) -> str:
    """Ключ для группировки: известный город — каноническое имя, иначе аккуратно
    нормализованная строка (первая буква заглавная)."""
    canon = canonical_city(name)
    if canon:
        return canon
    k = _key(name)
    return k[:1].upper() + k[1:] if k else "Без города"


def city_coords(name: str) -> tuple[float, float, float] | None:
    canon = canonical_city(name)
    return CITIES.get(canon) if canon else None
