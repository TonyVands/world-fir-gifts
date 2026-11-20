// ============================================================================
// Поляна нового облика: заснеженная равнина, лес из настоящих елей на фоне,
// викторианские фонари и мягкие сугробы. Использует ту же хвою, что и главная ель.
// ============================================================================
import * as THREE from "three";
import { SNOW_Y, layBranch, mulberry32 } from "./realisticFir.js";

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

function buildLantern({ withLight = true } = {}) {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: "#1a1d24", metalness: 0.75, roughness: 0.38 });
  const snow = new THREE.MeshStandardMaterial({ color: "#eef3ff", roughness: 0.6 });

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.55, 12), iron);
  plinth.position.y = 0.27;
  const plinth2 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 0.4, 12), iron);
  plinth2.position.y = 0.72;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 5.0, 10), iron);
  post.position.y = 3.4;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 16), iron);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 2.2;
  const collar2 = collar.clone();
  collar2.position.y = 5.75;
  g.add(plinth, plinth2, post, collar, collar2);

  // фонарь-«домик»: стекло, рамка, крыша, шпиль
  const head = new THREE.Group();
  head.position.y = 6.45;
  const glassMat = new THREE.MeshStandardMaterial({
    color: "#ffe2b0",
    emissive: "#ffb85c",
    emissiveIntensity: 2.2,
    roughness: 0.25,
    transparent: true,
    opacity: 0.92,
  });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.62), glassMat);
  head.add(glass);
  const barGeo = new THREE.BoxGeometry(0.06, 1.02, 0.06);
  for (const [x, z] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) {
    const bar = new THREE.Mesh(barGeo, iron);
    bar.position.set(x, 0, z);
    head.add(bar);
  }
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.78), iron);
  bottom.position.y = -0.52;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.5, 4, 1), iron);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 0.74;
  const roofSnow = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.18, 4, 1), snow);
  roofSnow.rotation.y = Math.PI / 4;
  roofSnow.position.y = 0.86;
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), iron);
  finial.position.y = 1.06;
  head.add(bottom, roof, roofSnow, finial);
  g.add(head);

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

// Брусчатка с инеем: неровные камни, тёмные швы, снег в щелях
function makeCobbleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#3b3a3f";
  g.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(77);
  const rows = 16;
  const h = 512 / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -h * 0.5 : 0;
    while (x < 512) {
      const w = h * (0.9 + rnd() * 0.7);
      const tone = 108 + Math.floor(rnd() * 46);
      const warm = Math.floor(rnd() * 12);
      g.fillStyle = `rgb(${tone + warm},${tone + Math.floor(warm / 2)},${tone - 4})`;
      g.beginPath();
      g.roundRect(x + 2, r * h + 2, w - 4, h - 4, 7);
      g.fill();
      // иней на камне
      if (rnd() < 0.35) {
        g.fillStyle = `rgba(240,244,252,${0.25 + rnd() * 0.4})`;
        g.beginPath();
        g.ellipse(x + w * (0.3 + rnd() * 0.4), r * h + h * 0.5, w * 0.35, h * 0.28, 0, 0, Math.PI * 2);
        g.fill();
      }
      x += w;
    }
  }
  // снег, наметённый в швы
  g.strokeStyle = "rgba(235,240,250,0.35)";
  g.lineWidth = 2;
  for (let r = 0; r <= rows; r++) {
    g.beginPath();
    g.moveTo(0, r * h);
    g.lineTo(512, r * h);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(22, 22);
  t.anisotropy = 8;
  return t;
}

// Ярмарочный домик: деревянный сруб, полосатая крыша, тёплый свет в окне
function buildStall(rnd) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: "#6b4426", roughness: 0.85 });
  const woodDark = new THREE.MeshStandardMaterial({ color: "#4a2d18", roughness: 0.9 });
  const roofCol = ["#b91c1c", "#166534", "#1e3a8a", "#92400e"][Math.floor(rnd() * 4)];
  const roof = new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.7 });
  const snow = new THREE.MeshStandardMaterial({ color: "#f1f5fb", roughness: 0.6 });
  const glow = new THREE.MeshStandardMaterial({ color: "#ffd59a", emissive: "#ffae4d", emissiveIntensity: 1.6 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 3.2), wood);
  base.position.y = 1.6;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.25, 1), woodDark);
  counter.position.set(0, 1.35, 1.9);
  const window_ = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), glow);
  window_.position.set(0, 2.2, 1.61);
  const roofL = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.18, 2.4), roof);
  roofL.position.set(0, 3.85, 0.85);
  roofL.rotation.x = -0.6;
  const roofR = roofL.clone();
  roofR.position.z = -0.85;
  roofR.rotation.x = 0.6;
  const ridgeSnow = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.12, 2.0), snow);
  ridgeSnow.position.set(0, 3.98, 0.75);
  ridgeSnow.rotation.x = -0.6;
  const ridgeSnow2 = ridgeSnow.clone();
  ridgeSnow2.position.z = -0.75;
  ridgeSnow2.rotation.x = 0.6;
  for (const x of [-2.4, 2.4]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.6, 0.22), woodDark);
    post.position.set(x, 1.8, 1.65);
    g.add(post);
  }
  g.add(base, counter, window_, roofL, roofR, ridgeSnow, ridgeSnow2);
  return { group: g, glowMat: glow };
}

// Скамейка: доски и чугунные ножки
function buildBench() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: "#7c4f2c", roughness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: "#1f2328", metalness: 0.7, roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.22), wood);
    seat.position.set(0, 0.9, -0.25 + i * 0.25);
    g.add(seat);
  }
  for (let i = 0; i < 2; i++) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 0.08), wood);
    back.position.set(0, 1.3 + i * 0.3, -0.42);
    back.rotation.x = -0.15;
    g.add(back);
  }
  for (const x of [-1.4, 1.4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.7), iron);
    leg.position.set(x, 0.45, -0.1);
    g.add(leg);
  }
  const snowCap = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, 0.06, 0.6),
    new THREE.MeshStandardMaterial({ color: "#f1f5fb", roughness: 0.6 })
  );
  snowCap.position.set(0, 0.98, 0);
  g.add(snowCap);
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
    new THREE.MeshStandardMaterial({ map: cobbleTex, roughness: 0.78, metalness: 0.05, color: "#d9d4cf" })
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = SNOW_Y + 0.03;
  plaza.receiveShadow = true;
  group.add(plaza);
  const curb = new THREE.Mesh(
    new THREE.TorusGeometry(PLAZA_R + 0.3, 0.45, 6, 160),
    new THREE.MeshStandardMaterial({ color: "#8b8f97", roughness: 0.7 })
  );
  curb.rotation.x = Math.PI / 2;
  curb.scale.z = 0.55;
  curb.position.y = SNOW_Y + 0.1;
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
  const moundGeo = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const moundCount = isMobile ? 60 : 110;
  const mounds = new THREE.InstancedMesh(
    moundGeo,
    new THREE.MeshStandardMaterial({ color: "#eef2fb", roughness: 0.9 }),
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
    tmp.rotation.set(0, rnd() * Math.PI, 0);
    tmp.scale.set(sc * (1 + rnd() * 0.8), sc * (0.18 + rnd() * 0.15), sc);
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
