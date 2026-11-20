// ============================================================================
// Объёмные игрушки на Ёлке мира: классика и «ручная работа».
// Шишки, сосульки, колокольчики, леденцы, пряничные человечки, вязаные
// сердечки и варежки, деревянные лошадки, бумажные снежинки, банты и бусы.
// Каждый вид — одна InstancedMesh (один вызов отрисовки на вид).
// Начало координат каждой игрушки — точка подвеса (верх), игрушка висит вниз.
// ============================================================================
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const TAU = Math.PI * 2;

function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// UV плоской фигуры = её координаты; растягиваем текстуру на рамку [-s..s]
function fitShapeUV(geo, s) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / (2 * s) + 0.5, uv.getY(i) / (2 * s) + 0.5);
  }
  uv.needsUpdate = true;
}

function extrudeFlat(shape, depth, s) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.35,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 10,
  });
  fitShapeUV(g, s);
  g.translate(0, 0, -depth / 2);
  return g;
}

// --- геометрии ---------------------------------------------------------------

function pineConeGeo() {
  // чешуйки: ярусы маленьких «лепестков» по спирали вокруг яйцевидного тела
  const parts = [];
  const body = new THREE.SphereGeometry(0.16, 10, 8);
  body.scale(1, 1.7, 1);
  body.translate(0, -0.34, 0);
  parts.push(body);
  const scale = new THREE.SphereGeometry(0.075, 6, 4);
  scale.scale(1.25, 0.55, 1);
  for (let row = 0; row < 7; row++) {
    const t = row / 6;
    const y = -0.08 - t * 0.55;
    const r = 0.11 + Math.sin(t * Math.PI) * 0.1;
    const n = 6 + Math.round(Math.sin(t * Math.PI) * 4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + row * 0.5;
      const sc = scale.clone();
      sc.rotateZ(-0.6);
      sc.rotateY(-a);
      sc.translate(Math.cos(a) * r, y, Math.sin(a) * r);
      parts.push(sc);
    }
  }
  const stem = new THREE.CylinderGeometry(0.02, 0.025, 0.08, 5);
  stem.translate(0, -0.03, 0);
  parts.push(stem);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

function icicleGeo() {
  const g = new THREE.ConeGeometry(0.09, 1.0, 7, 4);
  // лёгкая неровность, как у настоящего льда
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const w = 1 + Math.sin(y * 18 + i) * 0.12;
    p.setX(i, p.getX(i) * w);
    p.setZ(i, p.getZ(i) * w);
  }
  g.rotateX(Math.PI);
  g.translate(0, -0.5, 0);
  g.computeVertexNormals();
  return g;
}

function bellGeo() {
  const pts = [];
  const prof = [
    [0.0, 0.0], [0.05, 0.0], [0.07, -0.04], [0.09, -0.12], [0.12, -0.24],
    [0.17, -0.34], [0.22, -0.4], [0.235, -0.43], [0.2, -0.43], [0.0, -0.4],
  ];
  prof.forEach(([x, y]) => pts.push(new THREE.Vector2(x, y)));
  const bell = new THREE.LatheGeometry(pts, 20);
  const clapper = new THREE.SphereGeometry(0.05, 8, 6);
  clapper.translate(0, -0.44, 0);
  const loop = new THREE.TorusGeometry(0.04, 0.012, 6, 12);
  loop.translate(0, 0.03, 0);
  return mergeGeometries([bell.toNonIndexed(), clapper.toNonIndexed(), loop.toNonIndexed()]);
}

function candyCaneGeo() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.18, -0.12, 0),
    new THREE.Vector3(0.16, 0.0, 0),
    new THREE.Vector3(0.08, 0.06, 0),
    new THREE.Vector3(0.0, 0.0, 0),
    new THREE.Vector3(0.0, -0.3, 0),
    new THREE.Vector3(0.0, -0.75, 0),
  ]);
  const g = new THREE.TubeGeometry(curve, 48, 0.045, 8, false);
  return g;
}

function gingerbreadShape() {
  const s = new THREE.Shape();
  // голова
  s.absarc(0, 0.27, 0.13, -Math.PI * 0.32, Math.PI * 1.32, false);
  // руки и туловище
  s.lineTo(-0.3, 0.12);
  s.quadraticCurveTo(-0.36, 0.06, -0.3, 0.0);
  s.lineTo(-0.12, 0.02);
  s.lineTo(-0.2, -0.3);
  s.quadraticCurveTo(-0.18, -0.38, -0.1, -0.34);
  s.lineTo(0, -0.18);
  s.lineTo(0.1, -0.34);
  s.quadraticCurveTo(0.18, -0.38, 0.2, -0.3);
  s.lineTo(0.12, 0.02);
  s.lineTo(0.3, 0.0);
  s.quadraticCurveTo(0.36, 0.06, 0.3, 0.12);
  s.lineTo(0.08, 0.15);
  return s;
}

function heartShape() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.3);
  s.bezierCurveTo(-0.08, -0.2, -0.32, -0.06, -0.32, 0.1);
  s.bezierCurveTo(-0.32, 0.26, -0.12, 0.32, 0, 0.18);
  s.bezierCurveTo(0.12, 0.32, 0.32, 0.26, 0.32, 0.1);
  s.bezierCurveTo(0.32, -0.06, 0.08, -0.2, 0, -0.3);
  return s;
}

function mittenShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.16, -0.36);
  s.lineTo(0.16, -0.36);
  s.lineTo(0.17, 0.08);
  s.quadraticCurveTo(0.2, 0.36, 0.0, 0.36);
  s.quadraticCurveTo(-0.17, 0.36, -0.17, 0.12);
  s.lineTo(-0.2, 0.06);
  s.quadraticCurveTo(-0.34, 0.06, -0.31, -0.06);
  s.quadraticCurveTo(-0.28, -0.12, -0.16, -0.1);
  s.lineTo(-0.16, -0.36);
  return s;
}

function horseShape() {
  // скандинавская деревянная лошадка: силуэт в профиль
  const s = new THREE.Shape();
  s.moveTo(-0.3, -0.3);
  s.lineTo(-0.22, -0.3);
  s.lineTo(-0.2, -0.08);
  s.lineTo(0.12, -0.08);
  s.lineTo(0.14, -0.3);
  s.lineTo(0.22, -0.3);
  s.lineTo(0.22, 0.02);
  s.lineTo(0.26, 0.2);
  s.lineTo(0.36, 0.14);
  s.lineTo(0.4, 0.2);
  s.lineTo(0.3, 0.34);
  s.lineTo(0.2, 0.34);
  s.lineTo(0.12, 0.08);
  s.lineTo(-0.24, 0.08);
  s.lineTo(-0.34, 0.14);
  s.lineTo(-0.32, 0.02);
  s.lineTo(-0.3, -0.3);
  return s;
}

function snowflakeGeo() {
  const parts = [];
  for (let k = 0; k < 6; k++) {
    const arm = new THREE.BoxGeometry(0.04, 0.34, 0.02);
    arm.translate(0, 0.17, 0);
    arm.rotateZ((k * TAU) / 6);
    parts.push(arm);
    for (const [d, len] of [[0.13, 0.1], [0.23, 0.07]]) {
      for (const sgn of [-1, 1]) {
        const b = new THREE.BoxGeometry(0.03, len, 0.02);
        b.translate(0, len / 2, 0);
        b.rotateZ(sgn * 0.8);
        b.translate(0, d, 0);
        b.rotateZ((k * TAU) / 6);
        parts.push(b);
      }
    }
  }
  const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.025, 6);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  g.translate(0, -0.36, 0);
  return g;
}

function bowGeo() {
  const parts = [];
  for (const sgn of [-1, 1]) {
    const loop = new THREE.TorusGeometry(0.11, 0.035, 6, 14);
    loop.scale(1, 0.6, 0.5);
    loop.translate(sgn * 0.11, 0, 0);
    loop.rotateZ(sgn * 0.25);
    parts.push(loop);
    const tail = new THREE.BoxGeometry(0.06, 0.26, 0.02);
    tail.translate(0, -0.13, 0);
    tail.rotateZ(sgn * 0.35);
    parts.push(tail);
  }
  const knot = new THREE.SphereGeometry(0.05, 8, 6);
  knot.scale(1, 1, 0.7);
  parts.push(knot);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

// --- текстуры «ручной работы» --------------------------------------------------

function gingerTex() {
  return canvasTex(128, 128, (g, w) => {
    g.fillStyle = "#b5713a";
    g.fillRect(0, 0, w, w);
    // зернистость теста
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(90,45,15,${Math.random() * 0.25})`;
      g.fillRect(Math.random() * w, Math.random() * w, 2, 2);
    }
    g.strokeStyle = "#fffaf0";
    g.lineWidth = 3;
    g.lineCap = "round";
    const P = (x, y) => [((x + 0.4) / 0.8) * w, (1 - (y + 0.4) / 0.8) * w];
    // глазурь: глаза, улыбка, пуговки, зигзаги на руках и ногах
    g.fillStyle = "#fffaf0";
    for (const [x, y] of [[-0.045, 0.3], [0.045, 0.3]]) {
      const [a, b] = P(x, y);
      g.beginPath();
      g.arc(a, b, 3, 0, TAU);
      g.fill();
    }
    let [a, b] = P(0, 0.25);
    g.beginPath();
    g.arc(a, b - 2, 9, 0.2 * Math.PI, 0.8 * Math.PI);
    g.stroke();
    g.fillStyle = "#e11d48";
    for (const y of [0.08, -0.02, -0.12]) {
      [a, b] = P(0, y);
      g.beginPath();
      g.arc(a, b, 3.4, 0, TAU);
      g.fill();
    }
    for (const [x0, y0, x1, y1] of [[-0.3, 0.06, -0.2, 0.06], [0.2, 0.06, 0.3, 0.06], [-0.19, -0.27, -0.12, -0.27], [0.12, -0.27, 0.19, -0.27]]) {
      g.beginPath();
      const steps = 4;
      for (let i = 0; i <= steps; i++) {
        const [px, py] = P(x0 + ((x1 - x0) * i) / steps, y0 + (i % 2 ? 0.025 : -0.025));
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
  });
}

function knitTex(base, accent) {
  return canvasTex(128, 128, (g, w) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, w);
    // петли вязки: ряды «ёлочкой»
    const cell = 8;
    for (let y = 0; y < w; y += cell) {
      for (let x = 0; x < w; x += cell) {
        g.strokeStyle = "rgba(0,0,0,0.22)";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + cell / 2, y + cell);
        g.lineTo(x + cell, y);
        g.stroke();
      }
    }
    // норвежский узор: полоса со снежинками и зубчиками
    g.fillStyle = accent;
    for (let x = 0; x < w; x += cell) {
      g.fillRect(x + 2, 52, 4, 4);
      if ((x / cell) % 2 === 0) g.fillRect(x + 2, 60, 4, 4);
      g.fillRect(x + 2, 72, 4, 4);
    }
    for (let x = 4; x < w; x += 32) {
      for (const [dx, dy] of [[0, -8], [0, 8], [-8, 0], [8, 0], [0, 0], [-4, -4], [4, 4], [-4, 4], [4, -4]]) {
        g.fillRect(x + 12 + dx, 28 + dy, 4, 4);
        g.fillRect(x + 12 + dx, 100 + dy, 4, 4);
      }
    }
  });
}

function dalaTex() {
  return canvasTex(128, 128, (g, w) => {
    g.fillStyle = "#c81e1e";
    g.fillRect(0, 0, w, w);
    // роспись: «седло» и завитки
    g.strokeStyle = "#fde68a";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(56, 58, 16, Math.PI, TAU);
    g.stroke();
    g.fillStyle = "#1d4ed8";
    g.fillRect(40, 58, 32, 6);
    g.fillStyle = "#16a34a";
    for (const x of [34, 50, 66]) {
      g.beginPath();
      g.ellipse(x, 74, 4, 7, 0.3, 0, TAU);
      g.fill();
    }
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(98, 34, 3, 0, TAU);
    g.fill();
  });
}

function stripeTex() {
  const t = canvasTex(256, 32, (g, w, h) => {
    g.fillStyle = "#fff8f0";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#d61f2c";
    for (let x = -h; x < w; x += 32) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 12, h);
      g.lineTo(x + 12 + h, 0);
      g.lineTo(x + h, 0);
      g.closePath();
      g.fill();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

// --- сборка --------------------------------------------------------------------

export function createOrnaments({ rnd, envelopeRadius, isMobile = false }) {
  const group = new THREE.Group();
  group.name = "ornaments";
  const textures = [];
  const T = (t) => (textures.push(t), t);
  const m = isMobile ? 0.65 : 1;

  const kinds = [
    {
      id: "cone",
      count: 30,
      geo: pineConeGeo(),
      mat: new THREE.MeshStandardMaterial({ color: "#7a4a24", roughness: 0.75, metalness: 0.15 }),
      tint: ["#7a4a24", "#8b5a2b", "#c9a24a"], // натуральные и «позолоченные»
      size: [1.99, 2.62],
      thread: 0.35,
    },
    {
      id: "icicle",
      count: 44,
      geo: icicleGeo(),
      mat: new THREE.MeshPhysicalMaterial({
        color: "#dff4ff",
        roughness: 0.04,
        metalness: 0,
        clearcoat: 1,
        transparent: true,
        opacity: 0.72,
        envMapIntensity: 2,
      }),
      size: [1.68, 3.15],
      thread: 0,
      depth: 0.4,
    },
    {
      id: "bell",
      count: 22,
      geo: bellGeo(),
      mat: new THREE.MeshStandardMaterial({ color: "#d8a838", metalness: 0.92, roughness: 0.22 }),
      tint: ["#d8a838", "#d8a838", "#c0c6cf"],
      size: [2.31, 3.15],
      thread: 0.3,
    },
    {
      id: "cane",
      count: 20,
      geo: candyCaneGeo(),
      mat: new THREE.MeshStandardMaterial({ map: T(stripeTex()), roughness: 0.3, metalness: 0.05 }),
      size: [2.31, 2.94],
      thread: 0,
    },
    {
      id: "ginger",
      count: 18,
      geo: extrudeFlat(gingerbreadShape(), 0.07, 0.4),
      mat: new THREE.MeshStandardMaterial({ map: T(gingerTex()), roughness: 0.85 }),
      size: [2.52, 3.15],
      thread: 0.3,
      offsetY: -0.42,
    },
    {
      id: "heart",
      count: 18,
      geo: extrudeFlat(heartShape(), 0.1, 0.34),
      mat: new THREE.MeshStandardMaterial({ map: T(knitTex("#c0262d", "#fff7ed")), roughness: 0.95 }),
      size: [2.31, 2.94],
      thread: 0.3,
      offsetY: -0.22,
    },
    {
      id: "mitten",
      count: 14,
      geo: extrudeFlat(mittenShape(), 0.1, 0.38),
      mat: new THREE.MeshStandardMaterial({ map: T(knitTex("#f2efe6", "#b91c1c")), roughness: 0.95 }),
      size: [2.31, 2.94],
      thread: 0.3,
      offsetY: -0.38,
    },
    {
      id: "horse",
      count: 14,
      geo: extrudeFlat(horseShape(), 0.12, 0.42),
      mat: new THREE.MeshStandardMaterial({ map: T(dalaTex()), roughness: 0.55, metalness: 0.05 }),
      size: [2.31, 2.94],
      thread: 0.3,
      offsetY: -0.36,
    },
    {
      id: "flake",
      count: 26,
      geo: snowflakeGeo(),
      mat: new THREE.MeshStandardMaterial({ color: "#fbfbf7", roughness: 0.9 }),
      size: [2.73, 3.78],
      thread: 0.25,
    },
    {
      id: "bow",
      count: 22,
      geo: bowGeo(),
      mat: new THREE.MeshStandardMaterial({ color: "#a3121c", roughness: 0.6, metalness: 0.05 }),
      size: [3.36, 4.2],
      thread: 0,
      depth: 0.15,
    },
  ];

  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  const threadPts = [];
  const items = [];
  let kindIdx = 0;
  for (const k of kinds) {
    k.count = Math.max(4, Math.round(k.count * m));
    if (k.offsetY) k.geo.translate(0, k.offsetY, 0); // точка подвеса — верх фигурки
    if (k.tint) k.mat.color.set("#ffffff"); // цвет задаёт каждая игрушка
    k.mesh = new THREE.InstancedMesh(k.geo, k.mat, k.count);
    k.mesh.frustumCulled = false;
    k.items = [];
    for (let i = 0; i < k.count; i++) {
      // по площади конуса: внизу игрушек больше; у каждого вида свой сдвиг угла
      const t = (i + rnd()) / k.count;
      const yH = 6 + 52 * Math.sqrt(t);
      const y = 60 - yH;
      const a = i * 2.39996 + kindIdx * 0.83 + (rnd() - 0.5) * 0.6;
      const r = envelopeRadius(yH) + 1.25 - (k.depth ?? 0) * 2 + rnd() * 0.35;
      const it = {
        kind: k,
        i,
        pos: new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r),
        // плоские игрушки развёрнуты к зрителю снаружи ёлки
        yaw: -a + Math.PI / 2 + (rnd() - 0.5) * 0.7,
        tilt: (rnd() - 0.5) * 0.2,
        size: k.size[0] + rnd() * (k.size[1] - k.size[0]),
        color: k.tint ? k.tint[Math.floor(rnd() * k.tint.length)] : null,
        phase: rnd() * TAU,
      };
      k.items.push(it);
      items.push(it);
    }
    group.add(k.mesh);
    kindIdx++;
  }

  const threadGeo = new THREE.BufferGeometry();
  const threads = new THREE.LineSegments(
    threadGeo,
    new THREE.LineBasicMaterial({ color: "#e8d6a8", transparent: true, opacity: 0.7 })
  );
  threads.frustumCulled = false;
  group.add(threads);

  // Бусы: золотые и жемчужные нити, провисающие «гирляндами» между лапами
  const swagCount = Math.round((isMobile ? 18 : 30));
  const beadsPerSwag = 22;
  const beads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.13, 8, 6),
    new THREE.MeshStandardMaterial({ metalness: 0.85, roughness: 0.18 }),
    swagCount * beadsPerSwag
  );
  beads.frustumCulled = false;
  let bi = 0;
  const beadColors = [new THREE.Color("#e2b04a"), new THREE.Color("#f3ead8")];
  for (let s = 0; s < swagCount; s++) {
    const t = (s + 0.5) / swagCount;
    const yH = 9 + 46 * Math.sqrt(t);
    const y = 60 - yH;
    const a0 = s * 2.39996 * 1.7;
    const span = 2.6 / Math.max(1, envelopeRadius(yH) / 6);
    const c = beadColors[s % 2];
    for (let j = 0; j < beadsPerSwag; j++) {
      const u = j / (beadsPerSwag - 1);
      const a = a0 + (u - 0.5) * span;
      const r = envelopeRadius(yH) + 1.2;
      const sag = Math.sin(u * Math.PI) * (1.4 + yH / 40);
      tmp.position.set(Math.cos(a) * r, y - sag, Math.sin(a) * r);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      beads.setMatrixAt(bi, tmp.matrix);
      beads.setColorAt(bi, c);
      bi++;
    }
  }
  beads.instanceMatrix.needsUpdate = true;
  group.add(beads);

  function place(gifts) {
    threadPts.length = 0;
    for (const it of items) {
      const k = it.kind;
      const blocked = gifts?.some((g) => (g.x - it.pos.x) ** 2 + (g.z - it.pos.z) ** 2 + (g.topY - 1.4 - it.pos.y) ** 2 < 7);
      const s = blocked ? 0.0001 : it.size;
      tmp.position.copy(it.pos);
      tmp.rotation.set(it.tilt, it.yaw, 0);
      tmp.scale.setScalar(s);
      tmp.updateMatrix();
      k.mesh.setMatrixAt(it.i, tmp.matrix);
      if (it.color) k.mesh.setColorAt(it.i, col.set(it.color));
      if (!blocked && k.thread) {
        threadPts.push(it.pos.x, it.pos.y + k.thread * s, it.pos.z, it.pos.x, it.pos.y, it.pos.z);
      }
    }
    for (const k of kinds) {
      k.mesh.instanceMatrix.needsUpdate = true;
      if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
    }
    threadGeo.setAttribute("position", new THREE.Float32BufferAttribute(threadPts, 3));
    threadGeo.computeBoundingSphere();
  }
  place([]);

  return {
    group,
    place,
    stats: Object.fromEntries(kinds.map((k) => [k.id, k.count])),
    dispose() {
      textures.forEach((t) => t.dispose());
    },
  };
}
