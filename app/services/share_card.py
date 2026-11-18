"""Картинка-превью шара для мессенджеров (Open Graph, 1200×630).

Рисуем изометрию фигурки из вокселей внутри «стеклянного» шара, рядом —
приглашение «Я повесил шар на Всемирную ёлку — зажги свечу». Всё на Pillow,
без браузера и внешних сервисов, поэтому быстро и дёшево.
"""

from __future__ import annotations

import io
import math
import random
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

_cache: "OrderedDict[str, bytes]" = OrderedDict()
_CACHE_MAX = 256


@lru_cache(maxsize=16)
def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / name), size)


def _hex(color: str, fallback=(251, 191, 36)) -> tuple[int, int, int]:
    c = (color or "").lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    try:
        return tuple(int(c[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return fallback


def _shade(rgb, k: float):
    return tuple(max(0, min(255, int(v * k))) for v in rgb)


def _background(seed: int, W: int = W, H: int = H) -> Image.Image:  # noqa: N803
    img = Image.new("RGB", (W, H), (6, 10, 24))
    px = ImageDraw.Draw(img)
    # вертикальный градиент ночного неба
    for y in range(H):
        t = y / H
        px.line([(0, y), (W, y)], fill=(int(6 + 16 * t), int(10 + 14 * t), int(24 + 34 * t)))
    rnd = random.Random(seed)
    for _ in range(int(170 * (W * H) / (1200 * 630))):
        x, y = rnd.randrange(W), rnd.randrange(int(H * 0.8))
        b = rnd.randrange(120, 255)
        r = 1 if rnd.random() < 0.85 else 2
        px.ellipse([x - r, y - r, x + r, y + r], fill=(b, b, min(255, b + 20)))
    # тёплые огоньки гирлянды (боке)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    palette = [(255, 196, 110), (255, 90, 90), (90, 220, 140), (110, 160, 255), (255, 120, 220)]
    for _ in range(int(26 * max(1.0, (W * H) / (1200 * 630)) ** 0.7)):
        x, y = rnd.randrange(W), rnd.randrange(int(H * 0.55), H)
        r = rnd.randrange(10, 34)
        c = palette[rnd.randrange(len(palette))]
        g.ellipse([x - r, y - r, x + r, y + r], fill=(*c, rnd.randrange(40, 90)))
    glow = glow.filter(ImageFilter.GaussianBlur(10))
    img.paste(glow, (0, 0), glow)
    return img


def _draw_globe(img: Image.Image, voxels: list[dict], base_rgb, glitter_rgb, cx: int = 330, cy: int = 300, R: int = 230) -> None:
    W, H = img.size  # noqa: N806
    k = R / 230  # все размеры — от радиуса шара
    q = lambda v: int(round(v * k))  # noqa: E731
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # стеклянная сфера: мягкое свечение и блик
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(halo).ellipse([cx - R - q(30), cy - R - q(30), cx + R + q(30), cy + R + q(30)], fill=(255, 210, 140, 55))
    halo = halo.filter(ImageFilter.GaussianBlur(q(30)))
    img.paste(halo, (0, 0), halo)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(190, 220, 255, 34), outline=(220, 235, 255, 120), width=max(2, q(3)))

    # подставка
    by = cy + R - q(40)
    bw = q(175)
    d.ellipse([cx - bw, by - q(30), cx + bw, by + q(34)], fill=(*_shade(base_rgb, 0.7), 255))
    d.rectangle([cx - bw, by, cx + bw, by + q(60)], fill=(*_shade(base_rgb, 0.55), 255))
    d.ellipse([cx - bw, by + q(30), cx + bw, by + q(92)], fill=(*_shade(base_rgb, 0.45), 255))
    d.ellipse([cx - bw, by - q(30), cx + bw, by + q(34)], fill=(*_shade(base_rgb, 0.8), 255), outline=(240, 190, 90, 255), width=max(2, q(4)))

    # изометрия вокселей
    vs = [v for v in voxels if isinstance(v, dict)][:520]
    s = 21 * k  # половина ширины ромба
    hcube = 24 * k
    ox, oy = cx, by + q(16)

    def proj(x, y, z):
        return ox + (x - z) * s, oy + (x + z) * s * 0.5 - y * hcube - 8 * s * 0.5

    # дальние — первыми
    for v in sorted(vs, key=lambda v: (v.get("x", 0) + v.get("z", 0), v.get("y", 0))):
        x, y, z = v.get("x", 0) - 3.5, v.get("y", 0), v.get("z", 0) - 3.5
        rgb = _hex(str(v.get("color", "#fbbf24")))
        top = [proj(x, y + 1, z), proj(x + 1, y + 1, z), proj(x + 1, y + 1, z + 1), proj(x, y + 1, z + 1)]
        left = [proj(x, y + 1, z + 1), proj(x + 1, y + 1, z + 1), proj(x + 1, y, z + 1), proj(x, y, z + 1)]
        right = [proj(x + 1, y + 1, z), proj(x + 1, y + 1, z + 1), proj(x + 1, y, z + 1), proj(x + 1, y, z)]
        d.polygon(top, fill=(*_shade(rgb, 1.08), 255))
        d.polygon(left, fill=(*_shade(rgb, 0.72), 255))
        d.polygon(right, fill=(*_shade(rgb, 0.88), 255))
    # блёстки
    rnd = random.Random(len(vs))
    gr = max(2, q(2))
    for _ in range(40):
        a = rnd.random() * math.tau
        r = rnd.random() * (R - q(30))
        x, y = cx + math.cos(a) * r, cy - q(40) + math.sin(a) * r * 0.8
        d.ellipse([x - gr, y - gr, x + gr, y + gr], fill=(*glitter_rgb, 220))
    # блик на стекле
    shine = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shine).ellipse([cx - R + q(40), cy - R + q(30), cx - R + q(120), cy - R + q(150)], fill=(255, 255, 255, 60))
    shine = shine.filter(ImageFilter.GaussianBlur(q(12)))
    layer.paste(shine, (0, 0), shine)
    img.paste(layer, (0, 0), layer)


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_w: int, max_lines: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if draw.textlength(trial, font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
        if len(lines) == max_lines:
            break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    if len(lines) == max_lines and " ".join(lines) != text.strip():
        last = lines[-1]
        while last and draw.textlength(last + "…", font=font) > max_w:
            last = last[:-1]
        lines[-1] = last.rstrip() + "…"
    return lines


def _base_rgb(snow: dict):
    return {"mahogany": (110, 44, 20), "brass": (176, 128, 52), "obsidian": (40, 44, 58), "birch": (214, 196, 160)}.get(
        snow.get("base_material"), (110, 44, 20)
    )


def _remember(cache_key: str | None, data: bytes) -> bytes:
    if cache_key:
        _cache[cache_key] = data
        if len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return data


def render_gift_card(gift: dict, cache_key: str | None = None) -> bytes:
    if cache_key and cache_key in _cache:
        _cache.move_to_end(cache_key)
        return _cache[cache_key]
    snow = gift.get("snowglobe") or {}
    card = gift.get("card_preview") or {}
    base_rgb = _base_rgb(snow)
    img = _background(abs(hash(gift.get("id", ""))) % 10_000)
    _draw_globe(img, snow.get("voxels") or [], base_rgb, _hex(snow.get("glitter_color", "#fde047")))

    d = ImageDraw.Draw(img)
    x0, maxw = 630, 530
    d.text((x0, 92), "Я повесил шар на Всемирную ёлку", font=_font("DejaVuSans.ttf", 28), fill=(203, 213, 225))
    title = str(card.get("teaser_tag") or "Хрустальный шар")
    tfont = _font("DejaVuSerif-Bold.ttf", 52)
    y = 140
    for line in _wrap(d, f"«{title}»", tfont, maxw, 3):
        d.text((x0, y), line, font=tfont, fill=(254, 243, 199))
        y += 64
    who = " · ".join(p for p in (str(card.get("author_display_name") or ""), str(card.get("city") or "")) if p)
    if who:
        for line in _wrap(d, who, _font("DejaVuSans.ttf", 28), maxw, 1):
            d.text((x0, y + 12), line, font=_font("DejaVuSans.ttf", 28), fill=(148, 163, 184))
        y += 52
    candles = int(gift.get("candles_count") or 0)
    if candles > 1:
        d.text((x0, y + 18), f"Уже горит свечей: {candles}", font=_font("DejaVuSans.ttf", 26), fill=(253, 224, 71))
    # кнопка-призыв
    by = 470
    d.rounded_rectangle([x0, by, x0 + 420, by + 76], radius=38, fill=(252, 211, 77))
    d.text((x0 + 210, by + 38), "Зажги свечу", font=_font("DejaVuSans-Bold.ttf", 32), fill=(15, 23, 42), anchor="mm")
    d.text((x0, 572), "Всемирная ёлка подарков", font=_font("DejaVuSans-Bold.ttf", 22), fill=(251, 191, 36))

    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return _remember(cache_key, buf.getvalue())


@lru_cache(maxsize=1)
def render_site_card() -> bytes:
    """Общая картинка сайта: для ссылок без конкретного шара."""
    img = _background(2026)
    d = ImageDraw.Draw(img)
    # стилизованная ель из ярусов-треугольников
    cx = 330
    for i, (w, y) in enumerate([(120, 120), (170, 200), (220, 280), (270, 360), (320, 440)]):
        d.polygon([(cx, y - 70), (cx - w, y + 60), (cx + w, y + 60)], fill=(20 + i * 4, 92 + i * 6, 58 + i * 3))
    d.rectangle([cx - 22, 500, cx + 22, 560], fill=(70, 40, 20))
    star = [(cx + 34 * math.cos(math.pi / 2 + k * math.pi / 5) * (1 if k % 2 == 0 else 0.45),
             50 - 34 * math.sin(math.pi / 2 + k * math.pi / 5) * (1 if k % 2 == 0 else 0.45)) for k in range(10)]
    d.polygon(star, fill=(253, 224, 71))
    rnd = random.Random(7)
    for _ in range(60):
        t = rnd.random()
        y = 90 + t * 450
        w = 40 + t * 300
        x = cx + (rnd.random() * 2 - 1) * w * 0.8
        c = [(255, 196, 110), (255, 90, 90), (90, 220, 140), (110, 160, 255)][rnd.randrange(4)]
        d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=c)
    x0 = 640
    d.text((x0, 150), "Всемирная", font=_font("DejaVuSerif-Bold.ttf", 58), fill=(254, 243, 199))
    d.text((x0, 225), "ёлка подарков", font=_font("DejaVuSerif-Bold.ttf", 58), fill=(254, 243, 199))
    for i, line in enumerate(["Соберите шар ручной работы,", "сочините мелодию и повесьте его", "на общую ёлку. В полночь —", "обмен подарками с другим городом."]):
        d.text((x0, 330 + i * 38), line, font=_font("DejaVuSans.ttf", 28), fill=(203, 213, 225))
    d.rounded_rectangle([x0, 500, x0 + 360, 570], radius=35, fill=(252, 211, 77))
    d.text((x0 + 180, 535), "Повесить свой шар", font=_font("DejaVuSans-Bold.ttf", 28), fill=(15, 23, 42), anchor="mm")
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


SW, SH = 1080, 1920  # сторис 9:16


def render_gift_story(gift: dict, site_host: str = "", cache_key: str | None = None, own: bool = True) -> bytes:
    """Вертикальная картинка для сторис (Instagram, ВКонтакте, Telegram, MAX).

    Сверху — приглашение, в центре — шар, снизу — свободное место под
    стикер-ссылку и короткий адрес, чтобы его можно было набрать вручную.
    """
    if cache_key and cache_key in _cache:
        _cache.move_to_end(cache_key)
        return _cache[cache_key]
    snow = gift.get("snowglobe") or {}
    card = gift.get("card_preview") or {}
    img = _background(abs(hash(gift.get("id", ""))) % 10_000, SW, SH)
    d = ImageDraw.Draw(img)
    cx = SW // 2

    d.text((cx, 170), "ВСЕМИРНАЯ ЁЛКА ПОДАРКОВ", font=_font("DejaVuSans-Bold.ttf", 34), fill=(251, 191, 36), anchor="mm")
    head = _font("DejaVuSerif-Bold.ttf", 78)
    y = 270
    for line in (["Я повесил шар", "на Всемирную ёлку"] if own else ["Смотрите, какой шар", "на Всемирной ёлке"]):
        d.text((cx, y), line, font=head, fill=(254, 243, 199), anchor="mm")
        y += 96

    _draw_globe(img, snow.get("voxels") or [], _base_rgb(snow), _hex(snow.get("glitter_color", "#fde047")), cx=cx, cy=900, R=400)
    d = ImageDraw.Draw(img)

    title = str(card.get("teaser_tag") or "Хрустальный шар")
    tfont = _font("DejaVuSerif-Bold.ttf", 64)
    y = 1420
    for line in _wrap(d, f"«{title}»", tfont, SW - 160, 2):
        d.text((cx, y), line, font=tfont, fill=(254, 243, 199), anchor="mm")
        y += 80
    who = " · ".join(p for p in (str(card.get("author_display_name") or ""), str(card.get("city") or "")) if p)
    if who:
        f = _font("DejaVuSans.ttf", 38)
        for line in _wrap(d, who, f, SW - 160, 1):
            d.text((cx, y + 4), line, font=f, fill=(148, 163, 184), anchor="mm")
        y += 64
    candles = int(gift.get("candles_count") or 0)
    if candles > 1:
        d.text((cx, y + 10), f"Уже горит свечей: {candles}", font=_font("DejaVuSans.ttf", 36), fill=(253, 224, 71), anchor="mm")

    # призыв + адрес; выше нижних ~250 px, которые закрывают кнопки сторис
    by = 1640
    d.rounded_rectangle([cx - 390, by, cx + 390, by + 108], radius=54, fill=(252, 211, 77))
    d.text((cx, by + 54), "Зажги свечу моему шару" if own else "Зажги свечу этому шару", font=_font("DejaVuSans-Bold.ttf", 42), fill=(15, 23, 42), anchor="mm")
    if site_host:
        d.text((cx, by + 160), site_host, font=_font("DejaVuSans.ttf", 30), fill=(203, 213, 225), anchor="mm")

    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return _remember(cache_key, buf.getvalue())
