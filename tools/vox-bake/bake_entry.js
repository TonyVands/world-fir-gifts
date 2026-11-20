// Запекание жителей в кубики (стиль «Пиксели»), размер кубика 1/36 роста взрослого.
// Сборка: npx esbuild bake_entry.js --bundle --format=iife --outfile=/tmp/bake/bake.js,
// рядом положить models/residents/*.glb (исходные модели Grab3D, CC0), затем python3 bake.py.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
var CELL_M = 1.8 / 36;
var WALK_FRAMES = 8;
function texSampler(map) {
  if (!map || !map.image) return null;
  const img = map.image;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  return (u, v) => {
    u -= Math.floor(u);
    v -= Math.floor(v);
    const x = Math.min(c.width - 1, Math.floor(u * c.width));
    const y = Math.min(c.height - 1, Math.floor(v * c.height));
    const i = (y * c.width + x) * 4;
    return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
  };
}
var samplers = /* @__PURE__ */ new Map();
function samplerFor(mat) {
  if (!samplers.has(mat)) samplers.set(mat, texSampler(mat.map));
  return samplers.get(mat);
}
function voxelize(root, origin, cell) {
  root.updateMatrixWorld(true);
  const grid = /* @__PURE__ */ new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), p = new THREE.Vector3();
  root.traverse((m) => {
    if (!m.isMesh) return;
    const geo = m.geometry, idx = geo.index, uv = geo.attributes.uv;
    const samp = samplerFor(m.material);
    const base = m.material.color || new THREE.Color(1, 1, 1);
    const tri = idx ? idx.count / 3 : geo.attributes.position.count / 3;
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      m.getVertexPosition(i0, a).applyMatrix4(m.matrixWorld);
      m.getVertexPosition(i1, b).applyMatrix4(m.matrixWorld);
      m.getVertexPosition(i2, c).applyMatrix4(m.matrixWorld);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      const area = p.copy(ab).cross(ac).length() / 2;
      const n = Math.max(2, Math.ceil(area / (cell * cell) * 8));
      for (let k = 0; k < n; k++) {
        let r1 = Math.random(), r2 = Math.random();
        if (r1 + r2 > 1) {
          r1 = 1 - r1;
          r2 = 1 - r2;
        }
        p.copy(a).addScaledVector(ab, r1).addScaledVector(ac, r2);
        const gx = Math.floor((p.x - origin.x) / cell), gy = Math.floor((p.y - origin.y) / cell), gz = Math.floor((p.z - origin.z) / cell);
        if (gx < 0 || gy < 0 || gz < 0 || gx > 250 || gy > 250 || gz > 250) continue;
        let col = [base.r, base.g, base.b];
        if (samp && uv) {
          const w0 = 1 - r1 - r2;
          const u = uv.getX(i0) * w0 + uv.getX(i1) * r1 + uv.getX(i2) * r2;
          const v = uv.getY(i0) * w0 + uv.getY(i1) * r1 + uv.getY(i2) * r2;
          const s = samp(u, v);
          col = [s[0] * base.r, s[1] * base.g, s[2] * base.b];
        }
        const key = gx | gy << 8 | gz << 16;
        const e = grid.get(key);
        if (e) {
          e[3] += col[0];
          e[4] += col[1];
          e[5] += col[2];
          e[6]++;
        } else grid.set(key, [gx, gy, gz, col[0], col[1], col[2], 1]);
      }
    }
  });
  return [...grid.values()].map(([x, y, z, r, g, bb, n]) => [x, y, z, r / n, g / n, bb / n]);
}
var hex = (h) => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};
var lum = (v) => 0.3 * v[3] + 0.59 * v[4] + 0.11 * v[5];
var mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function bounds(list, pred = () => true) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0;
  for (const v of list) {
    if (!pred(v)) continue;
    n++;
    x0 = Math.min(x0, v[0]);
    x1 = Math.max(x1, v[0]);
    y0 = Math.min(y0, v[1]);
    y1 = Math.max(y1, v[1]);
    z0 = Math.min(z0, v[2]);
    z1 = Math.max(z1, v[2]);
  }
  return { x0, x1, y0, y1, z0, z1, n, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}
function addSkirt(list, yFrom, yTo, colorAt, flare = 0.5) {
  const set = new Set(list.map((v) => v[0] | v[1] << 8 | v[2] << 16));
  const top = bounds(list, (v) => v[1] >= yTo - 1 && v[1] <= yTo + 1);
  if (!top.n) return;
  const rx0 = (top.x1 - top.x0) / 2 + 0.6;
  const rz0 = (top.z1 - top.z0) / 2 + 0.6;
  for (let y = yFrom; y <= yTo; y++) {
    const t = (yTo - y) / Math.max(1, yTo - yFrom);
    const rx = rx0 * (1 + flare * t), rz = rz0 * (1 + flare * t * 0.8);
    for (let x = Math.floor(top.cx - rx - 1); x <= Math.ceil(top.cx + rx + 1); x++) {
      for (let z = Math.floor(top.cz - rz - 1); z <= Math.ceil(top.cz + rz + 1); z++) {
        const e = ((x - top.cx) / rx) ** 2 + ((z - top.cz) / rz) ** 2;
        if (e > 1 || e < 0.55) continue;
        const key = x | y << 8 | z << 16;
        if (set.has(key)) continue;
        set.add(key);
        list.push([x, y, z, ...colorAt(x, y, z, t, top)]);
      }
    }
  }
}
function dressSnegurochka(list) {
  const B = bounds(list);
  const H = B.y1 - B.y0 + 1;
  const yN = (v) => (v[1] - B.y0) / H;
  const iceDeep = hex("#2f6fd0"), iceLight = hex("#d6ecff"), fur = hex("#fbfdff"), silver = hex("#e8eef8");
  const head = bounds(list, (v) => yN(v) > 0.86);
  const front = bounds(list, (v) => yN(v) > 0.45 && yN(v) < 0.8);
  for (const v of list) {
    const y = yN(v);
    if (y >= 0.06 && y < 0.84) {
      const c = mix(iceDeep, iceLight, Math.min(1, lum(v) * 1.1));
      v[3] = c[0];
      v[4] = c[1];
      v[5] = c[2];
      const centerFront = Math.abs(v[0] - front.cx) <= 0.6 && v[2] >= front.z1 - 1;
      if (y >= 0.8 && y < 0.84 || centerFront) {
        v[3] = fur[0];
        v[4] = fur[1];
        v[5] = fur[2];
      }
    } else if (y < 0.06) {
      v[3] = silver[0];
      v[4] = silver[1];
      v[5] = silver[2];
    }
  }
  const y0 = B.y0 + Math.round(H * 0.06), y1 = B.y0 + Math.round(H * 0.5);
  addSkirt(list, y0, y1, (x, y, z, t) => {
    if (y <= y0 + 1) return fur;
    if ((x * 7 + y * 13 + z * 5) % 23 === 0) return hex("#ffffff");
    return mix(hex("#3d7fe0"), hex("#9fcbff"), 0.35 + 0.45 * (1 - t));
  }, 0.55);
  const top = head.y1;
  const hw = (head.x1 - head.x0) / 2 + 1.5;
  const zk = Math.round(head.cz + (head.z1 - head.cz) * 0.35);
  for (let x = Math.floor(head.cx - hw); x <= Math.ceil(head.cx + hw); x++) {
    for (let y = top - 2; y <= top + 7; y++) {
      const e = ((x - head.cx) / hw) ** 2 + ((y - (top - 2)) / 7.5) ** 2;
      if (e > 1 || y < top - 2) continue;
      const rim = e > 0.72;
      const gem = !rim && Math.abs(x - head.cx) < 1.2 && y > top + 1 && y < top + 4;
      const pearl = rim && (x + y) % 2 === 0;
      const col = gem ? hex("#38bdf8") : pearl ? hex("#fff7e6") : rim ? silver : hex("#cfe3ff");
      for (const dz of [0, 1]) list.push([x, y, zk + dz, ...col]);
    }
  }
  const braidTop = B.y0 + Math.round(H * 0.9), braidEnd = B.y0 + Math.round(H * 0.42);
  for (let y = braidTop; y >= braidEnd; y--) {
    const k = braidTop - y;
    const x = Math.round(head.cx + Math.sin(k * 0.9) * 0.6);
    const z = head.z0 - 1 - (y < B.y0 + H * 0.8 ? 1 : 0);
    const col = y <= braidEnd + 1 ? hex("#38bdf8") : k % 2 ? hex("#f2d58a") : hex("#d9b25c");
    list.push([x, y, z, ...col], [x + 1, y, z, ...col]);
  }
  // лицо андроида: светящиеся голубые глаза, румянец и губы
  const faceY = (k) => head.y0 + Math.round((head.y1 - head.y0) * k);
  const paint = (x, y, col) => {
    let best = null;
    for (const v of list) if (v[0] === x && v[1] === y && (!best || v[2] > best[2])) best = v;
    if (best) { best[3] = col[0]; best[4] = col[1]; best[5] = col[2]; }
  };
  const ex = Math.round(head.cx);
  for (const dx of [-1, 1]) {
    const x = ex + dx * 1;
    paint(x + (dx > 0 ? 0 : -1), faceY(0.5), hex("#22d3ee"));
    paint(x + (dx > 0 ? 1 : -2), faceY(0.36), hex("#f9a8d4"));
  }
  paint(ex, faceY(0.26), hex("#e11d48"));
  paint(ex - 1, faceY(0.26), hex("#e11d48"));
  return list;
}
function dressDedMoroz(list) {
  const B = bounds(list);
  const H = B.y1 - B.y0 + 1;
  const red = hex("#b0101c"), redL = hex("#e2283a"), fur = hex("#fbfdff");
  const front = bounds(list, (v) => v[1] > B.y0 + H * 0.4 && v[1] < B.y0 + H * 0.7);
  const y0 = B.y0 + Math.round(H * 0.04), y1 = B.y0 + Math.round(H * 0.48);
  addSkirt(list, y0, y1, (x, y, z) => {
    if (y <= y0 + 1) return fur;
    if (Math.abs(x - front.cx) <= 0.6 && z >= front.z1 - 1) return fur;
    return mix(red, redL, (x + z) % 3 / 6);
  }, 0.45);
  const hand = bounds(list, (v) => v[1] > B.y0 + H * 0.42 && v[1] < B.y0 + H * 0.62);
  const sx = hand.x1 + 1, sz = Math.round(front.cz + 1);
  for (let y = B.y0; y <= B.y0 + Math.round(H * 1.08); y++) {
    const col = y % 3 === 0 ? hex("#7cc4ff") : hex("#dfe7f2");
    list.push([sx, y, sz, ...col]);
  }
  const ty = B.y0 + Math.round(H * 1.08) + 2;
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -1; dz <= 1; dz++) {
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
    list.push([sx + dx, ty + dy, sz + dz, ...hex("#ffd84d")]);
  }
  return list;
}
function pack(frames, standIndex) {
  const all = frames.flat();
  const B = bounds(all);
  const S = bounds(frames[standIndex]);
  const ox = Math.round(S.cx), oz = Math.round(S.cz), oy = B.y0;
  let size = 16;
  for (const f of frames) size += 2 + f.length * 6;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  "VOX1".split("").forEach((ch, i) => dv.setUint8(i, ch.charCodeAt(0)));
  dv.setFloat32(4, CELL_M, true);
  dv.setUint8(8, frames.length);
  dv.setUint8(9, standIndex);
  let o = 16;
  for (const f of frames) {
    dv.setUint16(o, f.length, true);
    o += 2;
    for (const v of f) {
      dv.setInt8(o, v[0] - ox);
      dv.setUint8(o + 1, v[1] - oy);
      dv.setInt8(o + 2, v[2] - oz);
      dv.setUint8(o + 3, Math.round(Math.min(1, v[3]) * 255));
      dv.setUint8(o + 4, Math.round(Math.min(1, v[4]) * 255));
      dv.setUint8(o + 5, Math.round(Math.min(1, v[5]) * 255));
      o += 6;
    }
  }
  return new Uint8Array(buf);
}
var b64 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
  return btoa(s);
};
var JOBS = [
  // имя файла, модель, рост (м), анимация шага?, наряд
  ["dedmoroz", "santa-claus", 1.88, false, dressDedMoroz],
  ["snegurochka", "android", 1.72, false, dressSnegurochka],
  ["man", "man", 1.82, true],
  ["woman", "woman", 1.7, true],
  ["elderly-man", "elderly-man", 1.72, true],
  ["elderly-woman", "elderly-woman", 1.6, true],
  ["child", "child", 1.25, true],
  ["hoodie-teen", "hoodie-teen", 1.74, true],
  ["android", "android", 1.82, true],
  ["reindeer", "reindeer", 1.75, false],
  ["polar-bear", "polar-bear", 1.45, false],
  ["penguin", "penguin", 1.05, false],
  ["dog", "dog", 0.72, false],
  ["puppy", "puppy", 0.45, false],
  ["fox", "fox", 0.6, false],
  ["rabbit", "rabbit", 0.38, false],
  ["owl", "owl", 0.45, false]
];
var loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
window.__out = {};
window.__log = [];
(async () => {
  for (const [file, model, hMeters, walking, dress] of JOBS) {
    const g = await loader.loadAsync("models/residents/" + model + ".glb");
    const root = g.scene;
    const clip = g.animations.find((a) => /walk/i.test(a.name));
    const mixer = clip ? new THREE.AnimationMixer(root) : null;
    if (mixer) mixer.clipAction(clip).play();
    const setT = (t) => {
      if (mixer) {
        mixer.setTime(t);
        root.updateMatrixWorld(true);
      }
    };
    const probes = [];
    const union = new THREE.Box3();
    const N = clip ? 16 : 1;
    for (let i = 0; i < N; i++) {
      const t = clip ? i / N * clip.duration : 0;
      setT(t);
      const bx = new THREE.Box3().setFromObject(root);
      union.union(bx);
      probes.push({ t, depth: bx.max.z - bx.min.z });
    }
    const hModel = union.max.y - union.min.y;
    const cell = hModel / hMeters * CELL_M;
    const origin = union.min.clone().subScalar(cell * 4);
    const stand = probes.reduce((a, b) => b.depth < a.depth ? b : a);
    let frames = [];
    if (walking && clip) {
      for (let i = 0; i < WALK_FRAMES; i++) {
        setT(i / WALK_FRAMES * clip.duration);
        frames.push(voxelize(root, origin, cell));
      }
    }
    setT(stand.t);
    frames.push(voxelize(root, origin, cell));
    const standIndex = frames.length - 1;
    if (dress) frames = frames.map((f) => dress(f));
    const u8 = pack(frames, standIndex);
    window.__out[file] = b64(u8);
    window.__log.push(`${file}: ${frames.length} \u043A\u0430\u0434\u0440\u043E\u0432, \u043A\u0443\u0431\u0438\u043A\u043E\u0432 ${frames.map((f) => f.length).join("/")}, ${u8.length} \u0431\u0430\u0439\u0442, cx-\u0434\u0440\u0435\u0439\u0444 ${(bounds(frames[0]).cx - bounds(frames[standIndex]).cx).toFixed(1)}`);
  }
  window.__done = true;
})();
