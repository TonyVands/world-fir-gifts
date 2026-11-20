// ============================================================================
// Поляна нового облика: заснеженная равнина, лес из настоящих елей на фоне,
// викторианские фонари и мягкие сугробы. Использует ту же хвою, что и главная ель.
// ============================================================================
import * as THREE from "three";
import { SNOW_Y, layBranch, mulberry32 } from "./realisticFir.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Облегчённая ель для фона: меньше веток, крупные лапы (вдали детали не видны).
function growBackgroundFir({ origin, height, rnd, push }) {
  const baseSize = 2.4 + height / 14;
  // Верхние ярусы мельче и чаще: у настоящей ели макушка — узкий острый конус
  const whorls = Math.round(7 + height / 5.5);
  for (let w = 0; w < whorls; w++) {
    const tl = w / whorls; // 0 — верх
    const t = Math.pow(tl, 1.12);
    const yl = height * (1 - t) - 0.9;
    const R = height * 0.33 * Math.pow(t, 0.92) + 0.45;
    const count = Math.max(4, Math.round(2.5 + R * 0.42));
    // размер «карточки» хвои соразмерен длине лапы — иначе макушка тонет в
    // нескольких огромных пятнах и силуэт выглядит срезанным
    const sizeMul = baseSize * (0.38 + 0.62 * Math.min(1, t * 2.6));
    for (let i = 0; i < count; i++) {
      const a = w * 2.39996 + (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
      const L = R * (0.85 + rnd() * 0.2);
      const droop = L * (0.15 + 0.25 * t);
      const base = new THREE.Vector3(origin.x + Math.cos(a) * 0.2, origin.y + yl, origin.z + Math.sin(a) * 0.2);
      const tip = new THREE.Vector3(
        origin.x + Math.cos(a) * L,
        Math.max(SNOW_Y + 0.2, origin.y + yl - droop),
        origin.z + Math.sin(a) * L
      );
      layBranch({
        base, tip, rnd, density: t < 0.2 ? 0.45 : 0.3, sizeMul, sOffset: t < 0.2 ? 0.15 : 0.4,
        push: (p, d, s, b) => push(p, d, s, b, t),
      });
    }
  }
  // Верхушка-«лидер»: несколько побегов вверх вдоль ствола до самой вершины
  const leaderN = 4;
  for (let k = 0; k < leaderN; k++) {
    const f = k / (leaderN - 1);
    const p = new THREE.Vector3(
      origin.x + (rnd() - 0.5) * 0.15,
      origin.y + height * (0.9 + 0.08 * f) - 1.2,
      origin.z + (rnd() - 0.5) * 0.15
    );
    const d = new THREE.Vector3((rnd() - 0.5) * 0.25, 1, (rnd() - 0.5) * 0.25).normalize();
    push(p, d, baseSize * (0.55 - 0.18 * f), 1, 0);
  }
}

// ---------------------------------------------------------------------------
// Пиксельная площадь: всё собрано из кубиков в стиле жителей (voxel-art).
// Каждый предмет — одна сетка с цветами вершин (1 draw call) + светящаяся часть.
// ---------------------------------------------------------------------------
const PX = 0.11; // «пиксель» площади ≈ воксель жителей
const _c = new THREE.Color();

// boxes: [w, h, d, x, y, z, color] — размеры и позиции в метрах сцены
function voxMesh(boxes, { mat } = {}) {
  const geos = boxes.map(([w, h, d, x, y, z, col]) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    _c.set(col);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const nrm = g.attributes.normal.array;
    for (let i = 0; i < n; i++) {
      // «пиксельный» свет: верх светлее, низ темнее, грани чуть разные
      const ny = nrm[i * 3 + 1];
      const nx = nrm[i * 3];
      const k = ny > 0.5 ? 1.12 : ny < -0.5 ? 0.6 : nx !== 0 ? 0.86 : 0.95;
      arr[i * 3] = Math.min(1, _c.r * k);
      arr[i * 3 + 1] = Math.min(1, _c.g * k);
      arr[i * 3 + 2] = Math.min(1, _c.b * k);
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  });
  const geo = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return new THREE.Mesh(geo, mat || VOX_MAT);
}

const VOX_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });

function buildLantern({ withLight = true } = {}) {
  const g = new THREE.Group();
  const IRON = "#2a2f3a";
  const IRON_HI = "#454c5c";
  const SNOW = "#eef3ff";
  const body = voxMesh([
    [1.1, 0.44, 1.1, 0, 0.22, 0, IRON],
    [0.77, 0.44, 0.77, 0, 0.66, 0, IRON_HI],
    [0.33, 5.0, 0.33, 0, 3.38, 0, IRON],
    [0.55, 0.22, 0.55, 0, 2.2, 0, IRON_HI],
    [0.55, 0.22, 0.55, 0, 5.8, 0, IRON_HI],
    // голова фонаря: рамка, крыша ступеньками, снег, шпиль
    [0.88, 0.11, 0.88, 0, 5.95, 0, IRON],
    [0.11, 0.99, 0.11, -0.39, 6.45, -0.39, IRON],
    [0.11, 0.99, 0.11, 0.39, 6.45, -0.39, IRON],
    [0.11, 0.99, 0.11, -0.39, 6.45, 0.39, IRON],
    [0.11, 0.99, 0.11, 0.39, 6.45, 0.39, IRON],
    [1.1, 0.22, 1.1, 0, 7.0, 0, IRON],
    [0.77, 0.22, 0.77, 0, 7.22, 0, IRON_HI],
    [0.88, 0.11, 0.88, 0, 7.16, 0, SNOW],
    [0.44, 0.22, 0.44, 0, 7.44, 0, IRON],
    [0.44, 0.11, 0.44, 0, 7.56, 0, SNOW],
    [0.11, 0.33, 0.11, 0, 7.72, 0, IRON_HI],
  ]);
  const glassMat = new THREE.MeshStandardMaterial({
    color: "#ffe2b0",
    emissive: "#ffb85c",
    emissiveIntensity: 2.2,
    roughness: 1,
    flatShading: true,
  });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.88, 0.66), glassMat);
  glass.position.y = 6.45;
  g.add(body, glass);

  const light = withLight ? new THREE.PointLight("#ffb35c", 30, 26, 2) : null;
  if (light) {
    light.position.y = 6.45;
    g.add(light);
  }

  return {
    group: g,
    setGlow(k) {
      glassMat.emissiveIntensity = 0.15 + 2.1 * k;
      if (light) {
        light.intensity = 30 * k;
        light.visible = k > 0.02;
      }
    },
  };
}

const PLAZA_R = 54;

// Пиксельная брусчатка: маленький холст, квадратные камни с фаской в 1 пиксель,
// снег в швах. NearestFilter — пиксели остаются чёткими, как у жителей.
function makeCobbleTexture() {
  const N = 48;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  g.fillStyle = "#2c2b31";
  g.fillRect(0, 0, N, N);
  const rnd = mulberry32(77);
  const S = 8; // камень 8×8 пикселей вместе со швом
  for (let r = 0; r < N / S; r++) {
    const shift = r % 2 ? S / 2 : 0;
    for (let col = -1; col < N / S; col++) {
      const x0 = col * S + shift;
      const y0 = r * S;
      const tone = 104 + Math.floor(rnd() * 5) * 9;
      const warm = Math.floor(rnd() * 3) * 5;
      const base = [tone + warm, tone + (warm >> 1), tone - 6];
      const paint = (x, y, w, h, k) => {
        g.fillStyle = `rgb(${Math.min(255, base[0] * k) | 0},${Math.min(255, base[1] * k) | 0},${Math.min(255, base[2] * k) | 0})`;
        for (const dx of [0, N, -N]) g.fillRect(x + dx, y, w, h);
      };
      paint(x0 + 1, y0 + 1, S - 1, S - 1, 1); // камень
      paint(x0 + 1, y0 + 1, S - 1, 1, 1.25); // светлая фаска сверху
      paint(x0 + 1, y0 + 1, 1, S - 1, 1.15); // и слева
      paint(x0 + 1, y0 + S - 1, S - 1, 1, 0.72); // тень снизу
      paint(x0 + S - 1, y0 + 1, 1, S - 1, 0.8); // и справа
      // иней: 2–3 пикселя
      if (rnd() < 0.4) {
        g.fillStyle = "rgba(236,242,252,0.85)";
        const fx = x0 + 2 + Math.floor(rnd() * 4);
        const fy = y0 + 2 + Math.floor(rnd() * 3);
        for (const dx of [0, N, -N]) {
          g.fillRect(fx + dx, fy, 2, 1);
          if (rnd() < 0.5) g.fillRect(fx + dx + 1, fy + 1, 1, 1);
        }
      }
    }
  }
  // снег в швах — отдельные пиксели
  g.fillStyle = "rgba(230,236,248,0.7)";
  for (let i = 0; i < 70; i++) {
    const y = Math.floor(rnd() * (N / S)) * S;
    g.fillRect(Math.floor(rnd() * N), y, 1 + Math.floor(rnd() * 2), 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  // один пиксель текстуры ≈ PX метров
  const rep = (PLAZA_R * 2) / (N * PX);
  t.repeat.set(rep, rep);
  t.anisotropy = 8;
  return t;
}

// Ярмарочный домик из кубиков: сруб, ступенчатая крыша, окно со светом
function buildStall(rnd) {
  const g = new THREE.Group();
  const WOOD = "#7a4a26";
  const WOOD_D = "#4f2e17";
  const roofCol = ["#c0262b", "#1d7a3e", "#2445a3", "#a3510f"][Math.floor(rnd() * 4)];
  const roofHi = "#f4efe6";
  const SNOW = "#f1f5fb";
  const boxes = [
    [5.06, 3.08, 3.08, 0, 1.54, 0, WOOD],
    // брёвна-полосы
    [5.17, 0.22, 3.19, 0, 0.55, 0, WOOD_D],
    [5.17, 0.22, 3.19, 0, 2.75, 0, WOOD_D],
    [5.39, 0.22, 0.99, 0, 1.32, 1.98, WOOD_D],
    [0.22, 3.52, 0.22, -2.42, 1.76, 1.65, WOOD_D],
    [0.22, 3.52, 0.22, 2.42, 1.76, 1.65, WOOD_D],
  ];
  // крыша ступеньками (полосатая), сверху снег
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const depth = 3.96 - i * 0.77;
    const col = i % 2 ? roofHi : roofCol;
    boxes.push([5.72, 0.33, depth, 0, 3.24 + i * 0.33, 0, col]);
  }
  boxes.push([5.83, 0.22, 0.88, 0, 3.24 + steps * 0.33, 0, SNOW]);
  boxes.push([5.72, 0.11, 0.66, 0, 3.24 + 0.33 * 2 + 0.2, 1.25, SNOW]);
  const body = voxMesh(boxes);
  const glow = new THREE.MeshStandardMaterial({ color: "#ffd59a", emissive: "#ffae4d", emissiveIntensity: 1.6, flatShading: true });
  const window_ = new THREE.Mesh(new THREE.BoxGeometry(3.96, 1.43, 0.11), glow);
  window_.position.set(0, 2.15, 1.56);
  g.add(body, window_);
  return { group: g, glowMat: glow };
}

// Скамейка из кубиков: три доски, спинка, чугунные ножки, снег
function buildBench() {
  const WOOD = "#8a5a32";
  const WOOD_D = "#6b4224";
  const IRON = "#262b33";
  const boxes = [];
  for (let i = 0; i < 3; i++) boxes.push([3.3, 0.11, 0.22, 0, 0.88, -0.25 + i * 0.25, i % 2 ? WOOD_D : WOOD]);
  for (let i = 0; i < 2; i++) boxes.push([3.3, 0.22, 0.11, 0, 1.32 + i * 0.33, -0.44, i % 2 ? WOOD_D : WOOD]);
  for (const x of [-1.43, 1.43]) {
    boxes.push([0.11, 0.88, 0.11, x, 0.44, 0.22, IRON]);
    boxes.push([0.11, 1.76, 0.11, x, 0.88, -0.44, IRON]);
    boxes.push([0.11, 0.11, 0.77, x, 0.77, -0.11, IRON]);
  }
  boxes.push([3.08, 0.11, 0.55, 0, 0.99, 0, "#f1f5fb"]);
  const g = new THREE.Group();
  g.add(voxMesh(boxes));
  return g;
}

export function createClearing({ foliage, isMobile = false }) {
  const group = new THREE.Group();
  group.name = "clearing-new";
  const rnd = mulberry32(1225);

  // Бескрайняя снежная равнина: горизонт растворяется в тумане
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(260, 64),
    new THREE.MeshStandardMaterial({ color: "#e9eef8", roughness: 0.92, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = SNOW_Y;
  ground.receiveShadow = true;
  group.add(ground);

  // Фоновый лес из настоящих елей (одна общая сетка хвои — дёшево для GPU)
  const forestSprays = [];
  const treeCount = isMobile ? 16 : 26;
  for (let i = 0; i < treeCount; i++) {
    const a = (i / treeCount) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
    const dist = 78 + rnd() * 70;
    const height = 18 + rnd() * 26;
    const origin = new THREE.Vector3(Math.cos(a) * dist, SNOW_Y, Math.sin(a) * dist);
    growBackgroundFir({
      origin,
      height,
      rnd,
      push: (p, d, s, b, t) => forestSprays.push({ p: p.clone(), d: d.clone(), s, b: b * (0.7 + 0.3 * (1 - t)) }),
    });
    // ствол
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.5, height * 0.35, 6),
      new THREE.MeshStandardMaterial({ color: "#2b1b10", roughness: 1 })
    );
    trunk.position.set(origin.x, SNOW_Y + height * 0.17, origin.z);
    group.add(trunk);
  }
  const tmp = new THREE.Object3D();
  const color = new THREE.Color();
  const forestMesh = new THREE.InstancedMesh(foliage.cardGeo, foliage.sprayMat, forestSprays.length);
  forestSprays.forEach((f, i) => {
    tmp.position.copy(f.p);
    tmp.lookAt(f.p.x + f.d.x, f.p.y + f.d.y, f.p.z + f.d.z);
    tmp.rotateZ((rnd() - 0.5) * 0.5);
    tmp.scale.setScalar(f.s);
    tmp.updateMatrix();
    forestMesh.setMatrixAt(i, tmp.matrix);
    foliage.foliageTint(Math.min(1, f.b), rnd, color);
    forestMesh.setColorAt(i, color);
  });
  forestMesh.instanceMatrix.needsUpdate = true;
  if (forestMesh.instanceColor) forestMesh.instanceColor.needsUpdate = true;
  forestMesh.frustumCulled = false;
  group.add(forestMesh);

  // Площадь Ёлки мира: брусчатка с инеем, гранитный бордюр, скамейки,
  // фонари по кругу и ярмарочные домики. Всё в меру — главное здесь ёлка.
  const cobbleTex = makeCobbleTexture();
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(PLAZA_R, 96),
    new THREE.MeshStandardMaterial({ map: cobbleTex, roughness: 0.95, metalness: 0, color: "#d9d4cf" })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = SNOW_Y + 0.03;
  plaza.receiveShadow = true;
  group.add(plaza);
  // бордюр — кольцо гранитных кубиков, цвета чуть разные
  const curbCount = 150;
  const curbLen = ((PLAZA_R + 0.3) * Math.PI * 2) / curbCount;
  const curb = new THREE.InstancedMesh(
    new THREE.BoxGeometry(curbLen - PX, PX * 3, PX * 6),
    new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true }),
    curbCount
  );
  const curbTmp = new THREE.Object3D();
  for (let i = 0; i < curbCount; i++) {
    const a = (i / curbCount) * Math.PI * 2;
    curbTmp.position.set(Math.cos(a) * (PLAZA_R + 0.3), SNOW_Y + PX * 1.5, Math.sin(a) * (PLAZA_R + 0.3));
    curbTmp.rotation.set(0, -a + Math.PI / 2, 0);
    curbTmp.updateMatrix();
    curb.setMatrixAt(i, curbTmp.matrix);
    const tone = 0.5 + ((i * 7919) % 5) * 0.035;
    curb.setColorAt(i, _c.setRGB(tone, tone * 1.02, tone * 1.08));
  }
  curb.instanceMatrix.needsUpdate = true;
  group.add(curb);

  const outerLanterns = [];
  // препятствия для жителей площади: фонари, скамейки, домики
  const obstacles = [];
  const outerLanternCount = isMobile ? 8 : 12;
  for (let i = 0; i < outerLanternCount; i++) {
    const a = (i / outerLanternCount) * Math.PI * 2 + 0.13;
    const l = buildLantern({ withLight: false });
    l.group.position.set(Math.cos(a) * (PLAZA_R - 2.5), SNOW_Y, Math.sin(a) * (PLAZA_R - 2.5));
    obstacles.push({ x: l.group.position.x, z: l.group.position.z, r: 0.8 });
    l.group.rotation.y = -a;
    group.add(l.group);
    outerLanterns.push(l);
  }

  const benchCount = isMobile ? 6 : 8;
  for (let i = 0; i < benchCount; i++) {
    const a = (i / benchCount) * Math.PI * 2 + Math.PI / benchCount;
    const b = buildBench();
    const r = 31;
    b.position.set(Math.cos(a) * r, SNOW_Y, Math.sin(a) * r);
    obstacles.push({ x: b.position.x, z: b.position.z, r: 1.9 });
    b.lookAt(0, SNOW_Y, 0);
    b.rotateY(Math.PI);
    group.add(b);
  }

  const stalls = [];
  const stallCount = isMobile ? 4 : 6;
  for (let i = 0; i < stallCount; i++) {
    const a = (i / stallCount) * Math.PI * 2 + 0.5;
    const st = buildStall(rnd);
    const r = PLAZA_R + 5;
    st.group.position.set(Math.cos(a) * r, SNOW_Y, Math.sin(a) * r);
    st.group.lookAt(0, SNOW_Y, 0);
    group.add(st.group);
    stalls.push(st);
  }

  // Фонари вокруг ели (дальше, чем нижние лапы)
  const lanterns = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const r = 27.5;
    const l = buildLantern();
    l.group.position.set(Math.cos(a) * r, SNOW_Y, Math.sin(a) * r);
    l.group.rotation.y = -a;
    group.add(l.group);
    lanterns.push(l);
    obstacles.push({ x: l.group.position.x, z: l.group.position.z, r: 1.6 });
  }

  // Мягкие сугробы: у подножия ели, вокруг фонарей и по поляне
  // сугроб-«ступенька» из трёх слоёв кубиков, как в пиксельных играх
  const moundGeo = mergeGeometries(
    [
      [2, 0.34, 2, 0.17],
      [1.5, 0.33, 1.4, 0.5],
      [0.9, 0.33, 0.8, 0.83],
    ].map(([w, h, d, y]) => new THREE.BoxGeometry(w, h, d).translate(0, y, 0)),
    false
  );
  const moundCount = isMobile ? 60 : 110;
  const mounds = new THREE.InstancedMesh(
    moundGeo,
    new THREE.MeshStandardMaterial({ color: "#eef2fb", roughness: 1, flatShading: true }),
    moundCount
  );
  for (let i = 0; i < moundCount; i++) {
    let x;
    let z;
    let sc;
    if (i < 24) {
      const a = (i / 24) * Math.PI * 2 + rnd() * 0.2;
      const r = 17 + rnd() * 6;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      sc = 1.6 + rnd() * 2.2;
    } else if (i < 40) {
      const li = i % 4;
      const a = (li * Math.PI) / 2 + Math.PI / 4 + (rnd() - 0.5) * 0.15;
      const r = 27.5 + (rnd() - 0.5) * 2.5;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      sc = 0.7 + rnd() * 0.9;
    } else {
      const a = rnd() * Math.PI * 2;
      const r = PLAZA_R + 8 + rnd() * 50;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      sc = 1.5 + rnd() * 4;
    }
    tmp.position.set(x, SNOW_Y - 0.05, z);
    tmp.rotation.set(0, Math.atan2(x, z) + Math.floor(rnd() * 4) * (Math.PI / 2), 0);
    const ss = sc * 0.75;
    tmp.scale.set(ss * (1 + rnd() * 0.3), ss * (0.5 + rnd() * 0.25), ss);
    tmp.updateMatrix();
    mounds.setMatrixAt(i, tmp.matrix);
  }
  mounds.instanceMatrix.needsUpdate = true;
  mounds.receiveShadow = true;
  group.add(mounds);

  // дальние фонари и окна ярмарки горят вместе с ближними фонарями
  const glowAll = [
    ...outerLanterns,
    ...stalls.map((st) => ({ setGlow: (k) => (st.glowMat.emissiveIntensity = 0.2 + 1.6 * k) })),
  ];
  return {
    group,
    lanterns: [...lanterns, ...glowAll],
    plazaRadius: PLAZA_R,
    obstacles,
    stats: { forestSprays: forestSprays.length, trees: treeCount },
    dispose() {
      cobbleTex.dispose();
      group.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material && o.material !== foliage.sprayMat) [].concat(o.material).forEach((m) => m.dispose());
      });
    },
  };
}
