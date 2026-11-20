// ============================================================================
// Реалистичная процедурная ель (look=new)
// ----------------------------------------------------------------------------
// Как в играх: скелет дерева строится алгоритмом (ствол → мутовки → ветки),
// а хвоя — сотни «карточек» с прорисованной еловой лапой (альфа-текстура).
// Тени внутри кроны «запечены» в цвет инстансов: у ствола темно, к кончикам светло.
// Всё генерируется в браузере — никаких внешних файлов и лицензий.
// ============================================================================
import * as THREE from "three";
import { createOrnaments } from "./ornaments.js";

const TREE_TOP_Y = 59.0;
const GROUND_Y = -4.0;
// Верх снежного поля (цилиндр поляны: центр -4, высота 2.6)
export const SNOW_Y = -2.7;

export function envelopeRadius(yH) {
  const y = Math.max(0, yH);
  return 1.85 + y * 0.24 + 0.35 * Math.sqrt(y);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Текстуры: еловая лапа и снежная шапка (рисуются на canvas)
// ---------------------------------------------------------------------------
function makeSprayTexture() {
  const W = 128;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  const rnd = mulberry32(7);
  g.lineCap = "round";

  const stemX = (t) => W / 2 + Math.sin(t * 2.2) * 4;
  const stemY = (t) => H - 6 - t * (H - 14);

  const drawNeedles = (fromT, toT, side, lenMul, light) => {
    for (let t = fromT; t <= toT; t += 0.011) {
      const x = stemX(t);
      const y = stemY(t);
      const len = (12 + 26 * Math.sin(Math.PI * Math.min(1, 0.15 + t))) * lenMul * (0.85 + rnd() * 0.3);
      const ang = (side * (48 + rnd() * 14) * Math.PI) / 180;
      // хвоинка «смотрит» вперёд (вверх по текстуре) и в сторону
      const ex = x + Math.sin(ang) * len;
      const ey = y - Math.cos(ang) * len * 0.82;
      const shade = light ? 0.75 + rnd() * 0.25 : 0.45 + rnd() * 0.2;
      const r = Math.round(30 * shade + t * 18);
      const gg = Math.round(78 * shade + t * 34);
      const b = Math.round(46 * shade + t * 6);
      g.strokeStyle = `rgb(${r},${gg},${b})`;
      g.lineWidth = 2.4 - t * 0.9;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo((x + ex) / 2, (y + ey) / 2 - 2, ex, ey);
      g.stroke();
    }
  };

  // «Плотное ядро» лапы: копьевидный силуэт с полной непрозрачностью. Благодаря ему
  // на дальних мип-уровнях лапа сохраняет форму, а не превращается в прямоугольник.
  g.fillStyle = "rgb(26,62,36)";
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const half = Math.sin(Math.PI * Math.min(1, t * 1.08)) * 17 * (1 - t * 0.35);
    const x = stemX(t) - half;
    const y = stemY(t);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  for (let i = 40; i >= 0; i--) {
    const t = i / 40;
    const half = Math.sin(Math.PI * Math.min(1, t * 1.08)) * 17 * (1 - t * 0.35);
    g.lineTo(stemX(t) + half, stemY(t));
  }
  g.closePath();
  g.fill();

  // нижний слой хвои (темнее), затем верхний (светлее) — даёт объём
  drawNeedles(0.02, 0.97, -1, 1.0, false);
  drawNeedles(0.02, 0.97, 1, 1.0, false);
  drawNeedles(0.05, 0.98, -1, 0.78, true);
  drawNeedles(0.05, 0.98, 1, 0.78, true);

  // веточка
  g.strokeStyle = "rgb(72,52,32)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(stemX(0), stemY(0));
  for (let t = 0; t <= 1; t += 0.05) g.lineTo(stemX(t), stemY(t));
  g.stroke();

  // светлый молодой прирост на кончике
  g.fillStyle = "rgba(150,190,110,0.85)";
  for (let i = 0; i < 26; i++) {
    const t = 0.88 + rnd() * 0.12;
    g.beginPath();
    g.ellipse(stemX(t) + (rnd() - 0.5) * 22, stemY(t) + (rnd() - 0.5) * 10, 1.4, 4, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeSnowTexture() {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S * 2;
  const g = c.getContext("2d");
  const rnd = mulberry32(31);
  for (let i = 0; i < 70; i++) {
    const t = rnd();
    const x = S / 2 + (rnd() - 0.5) * (40 - t * 16);
    const y = S * 2 - 20 - t * (S * 2 - 40);
    const r = 5 + rnd() * 9 * (1 - t * 0.5);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.7, "rgba(235,242,255,0.95)");
    grd.addColorStop(1, "rgba(220,230,250,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Альфа-тест с «заострением»: хвоя не тает вдали (аналог alpha-to-coverage)
// и мягкое покачивание на ветру (сильнее к кончику лапы).
function patchFoliageMaterial(material, uniforms, swayAmount) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].y * 0.21 + instanceMatrix[3].z * 0.29;
        #else
          float ph = 0.0;
        #endif
        float tipW = clamp(position.z, 0.0, 1.0);
        transformed.x += sin(uTime * 1.3 + ph) * ${swayAmount.toFixed(3)} * uWind * tipW;
        transformed.y += sin(uTime * 1.7 + ph * 1.3) * ${(swayAmount * 0.6).toFixed(3)} * uWind * tipW;`
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphatest_fragment>",
      `float aW = max(fwidth(diffuseColor.a), 0.0001);
       diffuseColor.a = (diffuseColor.a - 0.5) / aW + 0.5;
       if (diffuseColor.a < 0.5) discard;
       diffuseColor.a = 1.0;`
    );
  };
  material.customProgramCacheKey = () => `fir-foliage-${swayAmount}`;
}

// ---------------------------------------------------------------------------
// Генерация веток
// ---------------------------------------------------------------------------
function bezier(p0, p1, p2, t, out) {
  const u = 1 - t;
  out.set(
    u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z
  );
  return out;
}

/**
 * Раскладывает «лапы» вдоль одной ветки.
 * push(position, direction, scale, brightness, isTip)
 */
export function layBranch({ base, tip, rnd, density, push, sOffset = 0.18, sizeMul = 1 }) {
  const len = base.distanceTo(tip);
  const mid = new THREE.Vector3().lerpVectors(base, tip, 0.5);
  mid.y += len * 0.03; // ветка почти горизонтальна у ствола и плавно опускается
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const step = (0.95 / density) * sizeMul;
  const n = Math.max(2, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) {
    const s = sOffset + (1 - sOffset) * (i / n);
    bezier(base, mid, tip, s, p);
    // касательная по отрезку [t0, t0+0.02] внутри кривой: на самом кончике (s=1)
    // прямая разность давала нулевой вектор → лапа вставала вертикально
    const t0 = Math.min(s, 0.98);
    bezier(base, mid, tip, t0, dir);
    bezier(base, mid, tip, t0 + 0.02, q);
    dir.subVectors(q, dir).normalize();
    // кончик лапы чуть задран вверх — характерный силуэт ели
    if (s > 0.85) dir.y += (s - 0.85) * 0.6;
    // Лапы никогда не «растут» вверх: у ели они горизонтальны или поникают
    dir.y = Math.min(dir.y, 0.12);
    dir.normalize();
    const bright = 0.28 + 0.72 * Math.pow(s, 0.85);
    const sc = (0.9 + s * 1.25) * (0.85 + rnd() * 0.3) * sizeMul;
    push(p, dir, sc, bright, s > 0.9);
    // боковые веточки второго порядка
    side.crossVectors(dir, up).normalize();
    for (const sgn of [-1, 1]) {
      if (s < 0.4 || rnd() < 0.35) continue;
      const sd = new THREE.Vector3()
        .copy(dir)
        .multiplyScalar(0.55)
        .addScaledVector(side, sgn * 0.85)
        .addScaledVector(up, -0.22 - rnd() * 0.15)
        .normalize();
      push(p, sd, sc * (0.72 + rnd() * 0.2), bright * (0.9 + rnd() * 0.1), false);
    }
  }
}

export function mergeCards(a, b) {
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const A = a.getAttribute(name);
    const B = b.getAttribute(name);
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array, 0);
    arr.set(B.array, A.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const ia = a.getIndex().array;
  const ib = b.getIndex().array;
  const offset = a.getAttribute("position").count;
  const idx = new Uint32Array(ia.length + ib.length);
  idx.set(ia, 0);
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + offset;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ---------------------------------------------------------------------------
// Основная функция
// ---------------------------------------------------------------------------
export function createRealisticFir({ isMobile = false } = {}) {
  const group = new THREE.Group();
  group.name = "realistic-fir";
  const rnd = mulberry32(2026);
  const density = isMobile ? 0.62 : 0.85;
  const uniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

  const sprayTex = makeSprayTexture();
  const snowTex = makeSnowTexture();

  // Карточка лапы: основание в (0,0,0), кончик вдоль +Z. Две пластины крестом
  // (горизонтальная и наклонная), чтобы лапа была объёмной с любого ракурса.
  const flatCard = new THREE.PlaneGeometry(0.95, 1.3);
  flatCard.translate(0, 0.65, 0);
  flatCard.rotateX(Math.PI / 2);
  // V-образное сечение: две половинки лапы опущены «крыльями» вниз, как у живой ели
  const wingL = flatCard.clone();
  wingL.rotateZ(0.5);
  const wingR = flatCard.clone();
  wingR.rotateZ(-0.5);
  const cardGeo = mergeCards(wingL, wingR);
  const snowCardGeo = flatCard;

  const sprayMat = new THREE.MeshStandardMaterial({
    map: sprayTex,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.82,
    metalness: 0,
  });
  patchFoliageMaterial(sprayMat, uniforms, 0.05);

  const snowMat = new THREE.MeshStandardMaterial({
    map: snowTex,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.55,
    color: new THREE.Color("#eef3ff"),
  });
  patchFoliageMaterial(snowMat, uniforms, 0.05);

  const sprays = [];
  const snows = [];
  const twigs = [];
  const tipPoints = [];

  const pushSpray = (pos, dir, scale, bright, isTip, yH) => {
    sprays.push({ pos: pos.clone(), dir: dir.clone(), scale, bright, yH, roll: (rnd() - 0.5) * 0.55 });
    // снег ложится на верхние, наружные лапы
    if (bright > 0.7 && dir.y < 0.3 && rnd() < 0.16) {
      snows.push({ pos: pos.clone().add(new THREE.Vector3(0, 0.06, 0)), dir: dir.clone(), scale: scale * 0.82 });
    }
    if (isTip) tipPoints.push(pos.clone());
  };

  // --- мутовки ---
  const whorlStep = isMobile ? 1.75 : 1.45;
  let whorlIdx = 0;
  const addWhorl = (y, { extraDroop = 0, lenMul = 1, countMul = 1 } = {}) => {
    const yH = 60 - y;
    const R = (envelopeRadius(yH) + 1.25) * lenMul;
    // число веток растёт с окружностью кроны — внизу нет «проплешин»
    // у верхушки ветки короткие — делаем мутовки гуще, чтобы не просвечивал ствол
    const topBoost = yH < 18 ? 1.6 : yH < 30 ? 1.25 : 1;
    const count = Math.max(5, Math.round((4 + R * 0.62) * countMul * topBoost * (isMobile ? 0.8 : 1)));
    // нижние лапы крупнее: та же густота меньшим числом карточек
    const sizeMul = 1 + Math.min(0.55, yH / 110);
    const offset = whorlIdx * 2.39996; // золотой угол между мутовками
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
      const L = R * (0.88 + rnd() * 0.16);
      const droop = L * (0.1 + 0.26 * Math.min(1, yH / 60)) + rnd() * 0.4 + extraDroop;
      const base = new THREE.Vector3(Math.cos(a) * 0.4, y, Math.sin(a) * 0.4);
      const tip = new THREE.Vector3(Math.cos(a) * L, Math.max(SNOW_Y + 0.25, y - droop), Math.sin(a) * L);
      layBranch({
        base,
        tip,
        rnd,
        density,
        sizeMul,
        push: (p, d, s, b, isTip) => pushSpray(p, d, s, b, isTip, yH),
      });
      twigs.push({ base, tip, thick: 0.05 + Math.min(0.2, yH / 300) });
      // промежуточная короткая ветка — заполняет «просветы» между мутовками
      if ((!isMobile && (yH < 30 || i % 2 === 0)) || (isMobile && i % 2 === 0)) {
        const a2 = a + Math.PI / count;
        const y2 = y - whorlStep * 0.5;
        const L2 = L * (0.55 + rnd() * 0.25);
        layBranch({
          base: new THREE.Vector3(Math.cos(a2) * 0.4, y2, Math.sin(a2) * 0.4),
          tip: new THREE.Vector3(Math.cos(a2) * L2, Math.max(SNOW_Y + 0.25, y2 - droop * 0.5), Math.sin(a2) * L2),
          rnd,
          density: density * 0.8,
          sizeMul,
          push: (p, d, s, b) => pushSpray(p, d, s, b * 0.9, false, yH),
        });
      }
    }
    whorlIdx++;
  };
  for (let y = TREE_TOP_Y - 1.2; y > SNOW_Y + 3.2; y -= whorlStep * (0.85 + rnd() * 0.3)) {
    addWhorl(y);
  }
  // «Юбка»: густые поникшие лапы у самого снега закрывают ствол и низ кроны
  for (const y of [SNOW_Y + 2.7, SNOW_Y + 1.8, SNOW_Y + 1.0]) {
    addWhorl(y, { extraDroop: 0.8, lenMul: 1.04, countMul: 1.15 });
  }
  // верхушка-«лидер»
  // (побеги вдоль верхних ~2.5 единиц ствола, чтобы он не торчал голым под звездой)
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    pushSpray(
      new THREE.Vector3(0, TREE_TOP_Y - 2.4 + t * 2.4, 0),
      new THREE.Vector3((rnd() - 0.5) * 0.7, 1, (rnd() - 0.5) * 0.7).normalize(),
      1.25 - t * 0.6,
      0.85,
      false,
      0
    );
  }

  // Перемешиваем лапы: тогда при снижении качества (mesh.count) пропадает
  // равномерная доля по всей ели, а не нижние ярусы целиком.
  for (let i = sprays.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [sprays[i], sprays[j]] = [sprays[j], sprays[i]];
  }

  // --- инстансы хвои ---
  const tmp = new THREE.Object3D();
  const color = new THREE.Color();
  // Множитель к зелёной текстуре: у ствола ~0.35 (тень кроны), на кончиках ~1.7.
  // Лёгкий сдвиг оттенка: глубина — холоднее, молодые кончики — теплее и желтее.
  // Тёплый облик: хвоя сочнее и светлее, кончики — с золотистым отливом гирлянды
  const foliageTint = (b, r, out) => {
    const k = 0.4 + 1.55 * Math.pow(b, 1.1);
    const warm = 0.08 + Math.max(0, b - 0.6) * 0.75;
    out.setRGB(k * (0.84 + warm), k * 1.04, k * (0.74 - warm * 0.35));
    out.multiplyScalar(0.92 + r() * 0.16);
    return out;
  };

  const sprayMesh = new THREE.InstancedMesh(cardGeo, sprayMat, sprays.length);
  sprays.forEach((s, i) => {
    tmp.position.copy(s.pos);
    tmp.lookAt(s.pos.x + s.dir.x, s.pos.y + s.dir.y, s.pos.z + s.dir.z);
    tmp.rotateZ(s.roll);
    tmp.scale.setScalar(s.scale);
    tmp.updateMatrix();
    sprayMesh.setMatrixAt(i, tmp.matrix);
    // «Запечённая» тень кроны: глубина ветки + чуть светлее к верхушке
    const topLight = 1 - Math.min(1, s.yH / 70) * 0.2;
    foliageTint(Math.min(1, s.bright * topLight), rnd, color);
    sprayMesh.setColorAt(i, color);
  });
  sprayMesh.instanceMatrix.needsUpdate = true;
  sprayMesh.instanceColor.needsUpdate = true;
  sprayMesh.frustumCulled = false;
  group.add(sprayMesh);

  const snowMesh = new THREE.InstancedMesh(snowCardGeo, snowMat, Math.max(1, snows.length));
  snows.forEach((s, i) => {
    tmp.position.copy(s.pos);
    const flat = new THREE.Vector3(s.dir.x, Math.min(0.05, s.dir.y), s.dir.z).normalize();
    tmp.lookAt(s.pos.x + flat.x, s.pos.y + flat.y, s.pos.z + flat.z);
    tmp.scale.setScalar(s.scale);
    tmp.updateMatrix();
    snowMesh.setMatrixAt(i, tmp.matrix);
  });
  snowMesh.count = snows.length;
  snowMesh.instanceMatrix.needsUpdate = true;
  snowMesh.frustumCulled = false;
  group.add(snowMesh);

  // --- ствол, тёмная сердцевина и ветки-«кости» ---
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 1.35, TREE_TOP_Y - GROUND_Y + 2, 14),
    new THREE.MeshStandardMaterial({ color: "#3a2416", roughness: 0.95 })
  );
  trunk.position.y = (TREE_TOP_Y + GROUND_Y) / 2 - 1;
  group.add(trunk);

  // Тёмный внутренний объём: сквозь хвою не просвечивает небо, крона глубже
  const coreGeo = new THREE.ConeGeometry(envelopeRadius(64) * 0.62, TREE_TOP_Y - GROUND_Y - 2, 24, 1, true);
  const core = new THREE.Mesh(
    coreGeo,
    new THREE.MeshStandardMaterial({ color: "#12301c", roughness: 1, side: THREE.DoubleSide })
  );
  core.position.y = (TREE_TOP_Y + GROUND_Y) / 2 - 1;
  group.add(core);

  const twigGeo = new THREE.CylinderGeometry(0.5, 1, 1, 5, 1, true);
  twigGeo.translate(0, 0.5, 0);
  const twigMesh = new THREE.InstancedMesh(
    twigGeo,
    new THREE.MeshStandardMaterial({ color: "#2e1f14", roughness: 1 }),
    twigs.length
  );
  const yAxis = new THREE.Vector3(0, 1, 0);
  const tdir = new THREE.Vector3();
  twigs.forEach((t, i) => {
    tdir.subVectors(t.tip, t.base);
    const len = tdir.length() * 0.85;
    tdir.normalize();
    tmp.position.copy(t.base);
    tmp.quaternion.setFromUnitVectors(yAxis, tdir);
    tmp.scale.set(t.thick, len, t.thick);
    tmp.updateMatrix();
    twigMesh.setMatrixAt(i, tmp.matrix);
  });
  twigMesh.instanceMatrix.needsUpdate = true;
  group.add(twigMesh);

  // --- тёплая гирлянда: спираль по кончикам лап, мягкое мерцание ---
  const bulbCount = isMobile ? 320 : 520;
  const bulbGeo = new THREE.SphereGeometry(0.11, 8, 6);
  const phases = new Float32Array(bulbCount);
  const bulbColors = new Float32Array(bulbCount * 3);
  const warmA = new THREE.Color("#ffc86e");
  const warmB = new THREE.Color("#fff0cf");
  for (let i = 0; i < bulbCount; i++) {
    phases[i] = rnd() * Math.PI * 2;
    const c = rnd() < 0.75 ? warmA : warmB;
    bulbColors.set([c.r, c.g, c.b], i * 3);
  }
  bulbGeo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
  bulbGeo.setAttribute("aColor", new THREE.InstancedBufferAttribute(bulbColors, 3));
  const glowUniform = { value: 1 };
  const bulbMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uGlow: glowUniform },
    vertexShader: `
      attribute float aPhase;
      attribute vec3 aColor;
      uniform float uTime;
      uniform float uGlow;
      varying vec3 vColor;
      void main() {
        float tw = 0.72 + 0.28 * sin(uTime * 1.6 + aPhase) * sin(uTime * 0.7 + aPhase * 2.0);
        vColor = aColor * tw * mix(0.9, 2.6, uGlow);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbCount);
  const turns = 7.5;
  for (let i = 0; i < bulbCount; i++) {
    const t = i / bulbCount;
    const y = TREE_TOP_Y - 3 - t * (TREE_TOP_Y - GROUND_Y - 6);
    const yH = 60 - y;
    const a = t * turns * Math.PI * 2;
    // гирлянда «провисает» между ветками
    const r = (envelopeRadius(yH) + 0.6) * (0.96 + 0.04 * Math.sin(t * 900));
    tmp.position.set(Math.cos(a) * r, y - Math.abs(Math.sin(t * turns * 6 * Math.PI)) * 0.35, Math.sin(a) * r);
    tmp.quaternion.identity();
    tmp.scale.setScalar(1);
    tmp.updateMatrix();
    bulbs.setMatrixAt(i, tmp.matrix);
  }
  bulbs.instanceMatrix.needsUpdate = true;
  bulbs.frustumCulled = false;
  group.add(bulbs);

  // Мягкие ореолы вокруг каждой лампочки: «киношные» круги света, как на
  // фото ёлки в полумраке. Точки-спрайты с аддитивным смешиванием — дёшево.
  const glowTex = makeGlowTexture();
  const pointScale = { value: 700 };
  const haloPos = new Float32Array(bulbCount * 3);
  const haloSize = new Float32Array(bulbCount);
  const bm = new THREE.Matrix4();
  const bp = new THREE.Vector3();
  for (let i = 0; i < bulbCount; i++) {
    bulbs.getMatrixAt(i, bm);
    bp.setFromMatrixPosition(bm);
    haloPos.set([bp.x, bp.y, bp.z], i * 3);
    haloSize[i] = 1.0 + rnd() * 0.7;
  }
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute("position", new THREE.BufferAttribute(haloPos, 3));
  haloGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  haloGeo.setAttribute("aColor", new THREE.BufferAttribute(bulbColors, 3));
  haloGeo.setAttribute("aSize", new THREE.BufferAttribute(haloSize, 1));
  const halos = new THREE.Points(haloGeo, makeGlowPointsMaterial(glowTex, uniforms.uTime, glowUniform, pointScale, 0.75));
  halos.frustumCulled = false;
  group.add(halos);

  // --- вторая гирлянда: разноцветные «ретро»-лампочки, бегущие огни ---
  // Идёт встречной спиралью, лампы крупнее и вытянутые, как у советских гирлянд.
  const retroCount = isMobile ? 160 : 260;
  const retroGeo = new THREE.SphereGeometry(0.19, 10, 8);
  retroGeo.scale(1, 1.45, 1);
  const retroIdx = new Float32Array(retroCount);
  const retroColors = new Float32Array(retroCount * 3);
  // тёплая гамма, как у старинных гирлянд: алый, янтарь, золото, коралл, тёплый белый
  const retroPalette = ["#ff3a2a", "#ffa63d", "#ffd65c", "#ff6f5a", "#ffe9c4"].map((h) => new THREE.Color(h));
  for (let i = 0; i < retroCount; i++) {
    retroIdx[i] = i;
    const c = retroPalette[i % retroPalette.length];
    retroColors.set([c.r, c.g, c.b], i * 3);
  }
  retroGeo.setAttribute("aIndex", new THREE.InstancedBufferAttribute(retroIdx, 1));
  const retroColorAttr = new THREE.InstancedBufferAttribute(retroColors, 3);
  retroGeo.setAttribute("aColor", retroColorAttr);
  // «Ледяная» раскраска той же гирлянды (окошко адвент-календаря)
  const iceColors = new Float32Array(retroCount * 3);
  const icePalette = ["#bfe9ff", "#7cc8ff", "#ffffff", "#9fb8ff"].map((h) => new THREE.Color(h));
  for (let i = 0; i < retroCount; i++) {
    const c = icePalette[i % icePalette.length];
    iceColors.set([c.r, c.g, c.b], i * 3);
  }
  const multiColors = retroColors.slice();
  const retroMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uGlow: glowUniform },
    vertexShader: `
      attribute float aIndex;
      attribute vec3 aColor;
      uniform float uTime;
      uniform float uGlow;
      varying vec3 vColor;
      void main() {
        // «бегущий огонь»: волна яркости пробегает по гирлянде сверху вниз
        float chase = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.4 - aIndex * 0.55), 3.0);
        vColor = aColor * chase * mix(0.8, 2.4, uGlow);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const retro = new THREE.InstancedMesh(retroGeo, retroMat, retroCount);
  const retroTurns = 5.5;
  const hang = new THREE.Vector3(0, -1, 0);
  for (let i = 0; i < retroCount; i++) {
    const t = i / retroCount;
    const y = TREE_TOP_Y - 5 - t * (TREE_TOP_Y - GROUND_Y - 9);
    const yH = 60 - y;
    const a = -t * retroTurns * Math.PI * 2 + 1.3; // встречная спираль
    const r = envelopeRadius(yH) + 1.55;
    const sag = Math.abs(Math.sin(t * retroTurns * 5 * Math.PI)) * 0.55;
    tmp.position.set(Math.cos(a) * r, y - sag, Math.sin(a) * r);
    tmp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hang.set((rnd() - 0.5) * 0.3, 1, (rnd() - 0.5) * 0.3).normalize());
    tmp.scale.setScalar(1);
    tmp.updateMatrix();
    retro.setMatrixAt(i, tmp.matrix);
  }
  retro.instanceMatrix.needsUpdate = true;
  retro.frustumCulled = false;
  group.add(retro);

  // Несколько тёплых источников света вдоль гирлянды — хвоя рядом подсвечивается
  const garlandLights = [];
  const lightCount = isMobile ? 3 : 5;
  for (let i = 0; i < lightCount; i++) {
    const t = (i + 0.5) / lightCount;
    const y = TREE_TOP_Y - 4 - t * (TREE_TOP_Y - GROUND_Y - 8);
    const a = i * 2.2;
    const r = envelopeRadius(60 - y) * 0.9;
    const pl = new THREE.PointLight("#ffb057", 32, 24, 2);
    pl.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    group.add(pl);
    garlandLights.push(pl);
  }

  // ---------------------------------------------------------------------
  // Классические ёлочные шары: глянцевые красные, золотые, шампанское,
  // серебро. Украшение между шарами-подарками, бликуют от HDR-окружения.
  // ---------------------------------------------------------------------
  const decorCount = isMobile ? 54 : 84;
  const decorPalette = [
    ["#b3121f", 4], // красный
    ["#d9a13a", 4], // золото
    ["#e9d3a6", 2], // шампанское
    ["#7a0c16", 2], // бордо
    ["#c9ced8", 1], // серебро
  ];
  const decorBag = decorPalette.flatMap(([c, w]) => Array(w).fill(c));
  const decorBalls = [];
  for (let i = 0; i < decorCount; i++) {
    // равномерно по площади конуса: внизу шаров больше, чем у макушки
    const t = (i + 0.5) / decorCount;
    const yH = 7 + 50 * Math.sqrt(t);
    const y = 60 - yH - (rnd() - 0.5) * 1.2;
    const a = i * 2.39996 + (rnd() - 0.5) * 0.5;
    const rad = 0.55 + rnd() * 0.22 + Math.min(0.15, yH / 350);
    const r = envelopeRadius(60 - y) + 0.95;
    decorBalls.push({
      pos: new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
      rad,
      color: new THREE.Color(decorBag[Math.floor(rnd() * decorBag.length)]),
    });
  }
  const decorMat = new THREE.MeshPhysicalMaterial({
    metalness: 0.78,
    roughness: 0.17,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.5,
  });
  const decorMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), decorMat, decorCount);
  const capMat = new THREE.MeshStandardMaterial({ color: "#d6a64a", metalness: 0.9, roughness: 0.25 });
  const decorCaps = new THREE.InstancedMesh(createCapLoopGeometry(), capMat, decorCount);
  const placeDecor = (gifts) => {
    decorBalls.forEach((b, i) => {
      // шар-украшение уступает место подарку рядом
      const blocked = gifts?.some((g) => (g.x - b.pos.x) ** 2 + (g.z - b.pos.z) ** 2 + (g.topY - 1.4 - b.pos.y) ** 2 < 4.8);
      const k = blocked ? 0.0001 : 1;
      tmp.position.copy(b.pos);
      tmp.quaternion.identity();
      tmp.scale.setScalar(b.rad * k);
      tmp.updateMatrix();
      decorMesh.setMatrixAt(i, tmp.matrix);
      tmp.position.y += b.rad * k * 0.97;
      tmp.scale.setScalar(b.rad * 1.35 * k);
      tmp.updateMatrix();
      decorCaps.setMatrixAt(i, tmp.matrix);
      decorMesh.setColorAt(i, b.color);
    });
    decorMesh.instanceMatrix.needsUpdate = true;
    decorCaps.instanceMatrix.needsUpdate = true;
    if (decorMesh.instanceColor) decorMesh.instanceColor.needsUpdate = true;
  };
  placeDecor([]);
  // Объёмные игрушки: классика и «ручная работа» (шишки, пряники, вязаные варежки…)
  const ornaments = createOrnaments({ rnd: mulberry32(31), envelopeRadius, isMobile });
  group.add(ornaments.group);
  decorMesh.frustumCulled = false;
  decorCaps.frustumCulled = false;
  group.add(decorMesh, decorCaps);

  // Размытые огни за ёлкой (боке): тёплые круги далёких фонарей и окон.
  // Лес их частично закрывает — получается глубина, как в кадре с малой ГРИП.
  const bokehCount = isMobile ? 46 : 70;
  const bokehPos = new Float32Array(bokehCount * 3);
  const bokehCol = new Float32Array(bokehCount * 3);
  const bokehSize = new Float32Array(bokehCount);
  const bokehPhase = new Float32Array(bokehCount);
  const bokehPalette = ["#ffb44d", "#ffcf7a", "#ff8a3d", "#ffe3a8", "#ff5a4a"].map((h) => new THREE.Color(h));
  for (let i = 0; i < bokehCount; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 85 + rnd() * 70;
    bokehPos.set([Math.cos(a) * r, -1 + rnd() * 22, Math.sin(a) * r], i * 3);
    const c = bokehPalette[Math.floor(rnd() * bokehPalette.length)];
    bokehCol.set([c.r, c.g, c.b], i * 3);
    bokehSize[i] = 3 + rnd() * 4.5;
    bokehPhase[i] = rnd() * Math.PI * 2;
  }
  const bokehGeo = new THREE.BufferGeometry();
  bokehGeo.setAttribute("position", new THREE.BufferAttribute(bokehPos, 3));
  bokehGeo.setAttribute("aPhase", new THREE.BufferAttribute(bokehPhase, 1));
  bokehGeo.setAttribute("aColor", new THREE.BufferAttribute(bokehCol, 3));
  bokehGeo.setAttribute("aSize", new THREE.BufferAttribute(bokehSize, 1));
  const bokehTex = makeBokehTexture();
  const bokeh = new THREE.Points(bokehGeo, makeGlowPointsMaterial(bokehTex, uniforms.uTime, glowUniform, pointScale, 0.2, 0.25));
  bokeh.frustumCulled = false;
  bokeh.renderOrder = -1;
  group.add(bokeh);

  // ---------------------------------------------------------------------
  // Ветки к подаркам: шар висит на нити у кончика настоящей лапы
  // ---------------------------------------------------------------------
  const giftGroup = new THREE.Group();
  group.add(giftGroup);

  function setGiftHangers(hangers) {
    giftGroup.children.forEach((c) => {
      c.geometry?.dispose();
    });
    giftGroup.clear();
    placeDecor(hangers || []);
    ornaments.place(hangers || []);
    if (!hangers || hangers.length === 0) return;

    const hRnd = mulberry32(hangers.length * 7919);
    const gSprays = [];
    const threadPts = [];
    hangers.forEach((h) => {
      const a = Math.atan2(h.z, h.x);
      const rr = Math.hypot(h.x, h.z);
      // Подвес выходит ИЗ кроны на высоте шара: основание не выше верхних
      // мутовок, кончик чуть над колпачком — ветка не висит в воздухе.
      const tipY = h.topY + 0.75;
      const tip = new THREE.Vector3(Math.cos(a) * (rr + 0.05), tipY, Math.sin(a) * (rr + 0.05));
      const baseR = Math.max(0.5, rr * 0.4);
      const baseY = Math.min(tipY + rr * 0.08, TREE_TOP_Y - 2.0);
      const base = new THREE.Vector3(Math.cos(a) * baseR, baseY, Math.sin(a) * baseR);
      layBranch({
        base,
        tip,
        rnd: hRnd,
        density: density * 0.9,
        sOffset: 0.35,
        push: (p, d, s, b) => gSprays.push({ pos: p.clone(), dir: d.clone(), scale: s, bright: b }),
      });
      threadPts.push(tip.x, tip.y - 0.05, tip.z, h.x, h.topY, h.z);
    });

    const m = new THREE.InstancedMesh(cardGeo, sprayMat, gSprays.length);
    gSprays.forEach((s, i) => {
      tmp.position.copy(s.pos);
      tmp.lookAt(s.pos.x + s.dir.x, s.pos.y + s.dir.y, s.pos.z + s.dir.z);
      tmp.rotateZ((hRnd() - 0.5) * 0.8);
      tmp.scale.setScalar(s.scale);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      foliageTint(Math.min(1, s.bright), hRnd, color);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = false;
    giftGroup.add(m);

    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.Float32BufferAttribute(threadPts, 3));
    const threads = new THREE.LineSegments(
      tg,
      new THREE.LineBasicMaterial({ color: "#d8c79f", transparent: true, opacity: 0.75 })
    );
    giftGroup.add(threads);
  }

  return {
    group,
    uniforms,
    setGiftHangers,
    stats: { sprays: sprays.length, snow: snows.length, branches: twigs.length, ornaments: ornaments.stats },
    /** 0.4..1 — доля отрисовываемой хвои и снега (адаптивное качество). */
    setQuality(q) {
      const k = Math.max(0.4, Math.min(1, q));
      sprayMesh.count = Math.floor(sprays.length * k);
      snowMesh.count = Math.floor(snows.length * k);
    },
    foliage: { sprayMat, snowMat, cardGeo, snowCardGeo, foliageTint },
    /** "warm" | "retro" | "both" — какие гирлянды горят. */
    setGarlandMode(mode) {
      bulbs.visible = mode !== "retro" && mode !== "ice";
      retro.visible = mode !== "warm";
      retroColorAttr.array.set(mode === "ice" ? iceColors : multiColors);
      retroColorAttr.needsUpdate = true;
    },
    setGarlandGlow(k) {
      glowUniform.value = k;
    },
    /** Пиксели на единицу размера на расстоянии 1 — для ореолов (зависит от высоты окна и угла камеры). */
    setPointScale(px) {
      pointScale.value = px;
    },
    update(elapsed) {
      uniforms.uTime.value = elapsed;
      const g = glowUniform.value;
      for (let i = 0; i < garlandLights.length; i++) {
        garlandLights[i].intensity = (30 + Math.sin(elapsed * 1.3 + i * 1.7) * 5) * g;
      }
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) [].concat(o.material).forEach((mm) => mm.dispose());
      });
      sprayTex.dispose();
      snowTex.dispose();
      glowTex.dispose();
      ornaments.dispose();
      bokehTex.dispose();
    },
  };
}

// Мягкое пятно света: яркий центр, плавный спад
function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.18, "rgba(255,255,255,0.55)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.14)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Диск боке: ровный круг с чуть более ярким краем, как у настоящего объектива
function makeBokehTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, "rgba(255,255,255,0.55)");
  grd.addColorStop(0.78, "rgba(255,255,255,0.62)");
  grd.addColorStop(0.9, "rgba(255,255,255,0.85)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Точки-спрайты с размером в мировых единицах и мерцанием
function makeGlowPointsMaterial(map, uTime, uGlow, uScale, opacity, twinkleSpeed = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uTime, uGlow, uScale, uOpacity: { value: opacity }, uSpeed: { value: twinkleSpeed } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aPhase;
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uTime, uGlow, uScale, uSpeed;
      varying vec3 vColor;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = 0.72 + 0.28 * sin(uTime * 1.6 * uSpeed + aPhase) * sin(uTime * 0.7 * uSpeed + aPhase * 2.0);
        vColor = aColor * tw * clamp(uGlow, 0.0, 1.6);
        gl_PointSize = min(160.0, aSize * uScale / max(0.5, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform float uOpacity;
      varying vec3 vColor;
      void main() {
        vec4 t = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor * t.rgb * t.a * uOpacity, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------------------
// Ночная HDR-среда: процедурная панорама (небо, луна, тёплые огни деревни)
// превращается в карту освещения через PMREM — как HDRI, но без загрузки файла.
// ---------------------------------------------------------------------------
export function createNightEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 zenith = vec3(0.012, 0.028, 0.075);
        vec3 horizon = vec3(0.10, 0.13, 0.24);
        vec3 warmGlow = vec3(0.45, 0.25, 0.12);
        vec3 ground = vec3(0.16, 0.19, 0.27);   // снег, подсвеченный небом
        vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.65, h));
        col += warmGlow * exp(-abs(h) * 14.0) * 0.55;   // тёплое зарево у горизонта
        if (h < 0.0) col = mix(horizon * 0.9, ground, smoothstep(0.0, -0.4, h));
        gl_FragColor = vec4(col * 1.6, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), skyMat));

  // Луна — холодный ключевой свет
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 10, 12) })
  );
  moon.position.set(-24, 30, -22);
  envScene.add(moon);

  // Тёплые окна далёких домов — мягкие золотые блики на стекле шаров
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.6, 1.6), side: THREE.DoubleSide })
    );
    win.position.set(Math.cos(a) * 45, 1.5 + (i % 3), Math.sin(a) * 45);
    win.lookAt(0, 2, 0);
    envScene.add(win);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  envScene.traverse((o) => {
    o.geometry?.dispose?.();
    o.material?.dispose?.();
  });
  return rt;
}

// Классический колпачок ёлочного шара с петелькой (для подарочных шаров).
// Начало координат — верх стеклянной сферы; петелька наверху.
export function createCapLoopGeometry() {
  const cap = new THREE.CylinderGeometry(0.15, 0.17, 0.16, 18, 1);
  cap.translate(0, 0.05, 0);
  const rim = new THREE.CylinderGeometry(0.18, 0.18, 0.035, 18, 1);
  rim.translate(0, -0.02, 0);
  const loop = new THREE.TorusGeometry(0.075, 0.017, 8, 20);
  loop.translate(0, 0.205, 0);
  return mergeCards(mergeCards(cap, rim), loop);
}
