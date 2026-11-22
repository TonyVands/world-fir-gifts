// Пиксельный барельеф из фотографии — целиком в браузере, фото никуда не уходит.
// Результат: { w, h, palette: ["#rrggbb"...], px: base64(индексы, 255 — пусто), depth: base64(0..15) }

export const EMPTY = 255;
export const PORTRAIT_W = 40;
export const PORTRAIT_H = 48;

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось открыть фото"));
    };
    img.src = url;
  });
}

const b64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (str) => {
  const s = atob(str || "");
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

// Кадрирование: прямоугольник с пропорцией портрета вокруг лица (по умолчанию чуть выше центра)
function cropRect(img, w, h, zoom, offX, offY) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const aspect = w / h;
  let cw = iw;
  let ch = cw / aspect;
  if (ch > ih) {
    ch = ih;
    cw = ch * aspect;
  }
  cw /= zoom;
  ch /= zoom;
  const cx = iw * (0.5 + offX * 0.5);
  const cy = ih * (0.42 + offY * 0.5);
  const x = Math.max(0, Math.min(iw - cw, cx - cw / 2));
  const y = Math.max(0, Math.min(ih - ch, cy - ch / 2));
  return [x, y, cw, ch];
}

function kmeans(points, k, iters = 10) {
  // старт: квантили по яркости — устойчиво и без случайности
  const sorted = points.slice().sort((a, b) => a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11 - (b[0] * 0.3 + b[1] * 0.59 + b[2] * 0.11));
  const centers = [];
  for (let i = 0; i < k; i++) centers.push(sorted[Math.min(sorted.length - 1, Math.floor(((i + 0.5) / k) * sorted.length))].slice());
  const assign = new Uint8Array(points.length);
  for (let it = 0; it < iters; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const q = centers[c];
        const d = (p[0] - q[0]) ** 2 * 0.9 + (p[1] - q[1]) ** 2 * 1.2 + (p[2] - q[2]) ** 2 * 0.7;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      assign[i] = best;
      const s = sums[best];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    }
    for (let c = 0; c < centers.length; c++) {
      const s = sums[c];
      if (s[3]) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    }
  }
  return { centers, assign };
}

export function pixelize(img, { w = PORTRAIT_W, h = PORTRAIT_H, zoom = 1, offX = 0, offY = 0, colors = 16, removeBg = true } = {}) {
  const [sx, sy, sw, sh] = cropRect(img, w, h, zoom, offX, offY);
  // двухшаговое уменьшение — мягкое усреднение, без «шума» мелких деталей
  const mid = document.createElement("canvas");
  mid.width = w * 4;
  mid.height = h * 4;
  const mctx = mid.getContext("2d");
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(img, sx, sy, sw, sh, 0, 0, mid.width, mid.height);
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(mid, 0, 0, w, h);
  const data = sctx.getImageData(0, 0, w, h).data;

  const n = w * h;
  const rgb = new Array(n);
  for (let i = 0; i < n; i++) {
    let r = data[i * 4];
    let g = data[i * 4 + 1];
    let b = data[i * 4 + 2];
    // лёгкий «пиксель-арт»: больше контраста и цвета
    const l = r * 0.3 + g * 0.59 + b * 0.11;
    r = l + (r - l) * 1.18;
    g = l + (g - l) * 1.18;
    b = l + (b - l) * 1.18;
    r = (r - 128) * 1.1 + 132;
    g = (g - 128) * 1.1 + 130;
    b = (b - 128) * 1.1 + 128;
    rgb[i] = [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
  }

  // Фон: заливка от краёв по похожим цветам (если фон однородный)
  const empty = new Uint8Array(n);
  if (removeBg) {
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const stack = [];
    for (let x = 0; x < w; x++) stack.push([x, 0, rgb[x], rgb[x]]);
    for (let y = 0; y < h; y++) {
      stack.push([0, y, rgb[y * w], rgb[y * w]]);
      stack.push([w - 1, y, rgb[y * w + w - 1], rgb[y * w + w - 1]]);
    }
    let removed = 0;
    while (stack.length) {
      const [x, y, ref, seed] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (empty[i] || dist(rgb[i], ref) > 30 || dist(rgb[i], seed) > 60) continue;
      // нижние ряды не трогаем — там плечи и одежда
      if (y > h * 0.82) continue;
      empty[i] = 1;
      removed++;
      stack.push([x + 1, y, rgb[i], seed], [x - 1, y, rgb[i], seed], [x, y + 1, rgb[i], seed], [x, y - 1, rgb[i], seed]);
    }
    if (removed > n * 0.62) empty.fill(0); // фон не однородный — оставляем фото целиком
  }

  const pts = [];
  const idx = [];
  for (let i = 0; i < n; i++)
    if (!empty[i]) {
      pts.push(rgb[i]);
      idx.push(i);
    }
  const k = Math.max(2, Math.min(colors, pts.length));
  const { centers, assign } = kmeans(pts, k);
  const px = new Uint8Array(n).fill(EMPTY);
  idx.forEach((i, j) => {
    px[i] = assign[j];
  });

  // Глубина: «выпуклость» овала лица + немного по яркости
  const depth = new Uint8Array(n);
  const cx = (w - 1) / 2;
  const cy = h * 0.4;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (px[i] === EMPTY) continue;
      const dx = (x - cx) / (w * 0.4);
      const dy = (y - cy) / (h * 0.42);
      const bulge = Math.max(0, 1 - (dx * dx + dy * dy));
      const c = centers[px[i]];
      const lum = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;
      depth[i] = Math.max(1, Math.min(15, Math.round(2 + bulge * 10 + lum * 3)));
    }

  return {
    w,
    h,
    palette: centers.map((c) => hex(c[0], c[1], c[2])),
    px: b64(px),
    depth: b64(depth),
  };
}

export function decodePortrait(p) {
  if (!p || !p.w || !p.h) return null;
  const pal = (p.palette || []).map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
  return { w: p.w, h: p.h, pal, px: unb64(p.px), depth: unb64(p.depth) };
}

// Плоская картинка портрета (для превью, текстуры на Ёлке)
export function portraitToCanvas(p, { scale = 4, bg = null, canvas = null } = {}) {
  const d = decodePortrait(p);
  const c = canvas || document.createElement("canvas");
  if (!d) return c;
  c.width = d.w * scale;
  c.height = d.h * scale;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
  } else ctx.clearRect(0, 0, c.width, c.height);
  for (let y = 0; y < d.h; y++)
    for (let x = 0; x < d.w; x++) {
      const i = y * d.w + x;
      const v = d.px[i];
      if (v === EMPTY || !d.pal[v]) continue;
      const k = 0.82 + (d.depth[i] / 15) * 0.28;
      const [r, g, b] = d.pal[v];
      ctx.fillStyle = `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  return c;
}
