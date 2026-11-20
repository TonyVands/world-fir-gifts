// ============================================================================
// Жители площади Ёлки мира — кубические («пиксельные») персонажи:
// люди, Дед Мороз и Снегурочка, дети, роботы, звери и птицы, а также пары-
// «симбиозы»: робот выгуливает собаку, ребёнок едет на олене, снегирь сидит
// на голове у робота. Всё в меру: 30–50 жителей, неспешное движение.
//
// Производительность: каждый тип персонажа — 2 InstancedMesh (корпус и
// конечности) с цветами в вершинах. 50 жителей ≈ 20 вызовов отрисовки и
// ~250 матриц за кадр — на порядок меньше, чем хвоя ёлки.
// ============================================================================
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const TAU = Math.PI * 2;
const U = 0.24; // размер «пикселя»-вокселя в мировых единицах

// Коробка в воксельных единицах: [x0, y0, z0, w, h, d, цвет]; x0,y0,z0 — угол
function boxesGeometry(boxes, pivot = [0, 0, 0]) {
  const parts = boxes.map(([x, y, z, w, h, d, c]) => {
    const g = new THREE.BoxGeometry(w * U, h * U, d * U).toNonIndexed();
    g.translate((x + w / 2 - pivot[0]) * U, (y + h / 2 - pivot[1]) * U, (z + d / 2 - pivot[2]) * U);
    const col = new THREE.Color(c);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    // лёгкое затенение граней снизу — объём без текстур
    const ny = g.attributes.normal;
    for (let i = 0; i < n; i++) {
      const k = ny.getY(i) < -0.5 ? 0.72 : ny.getY(i) > 0.5 ? 1.08 : 0.92;
      arr[i * 3] = col.r * k;
      arr[i * 3 + 1] = col.g * k;
      arr[i * 3 + 2] = col.b * k;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  });
  return mergeGeometries(parts);
}

// --- персонажи (вперёд = +Z, ноги от y=0) ---------------------------------------

function human({ coat, pants, skin = "#f1c7a3", hair = "#4a2f1d", hat, hatTrim, scarf, beard, long = false, pompom }) {
  const body = [
    [-2.5, 5, -1.5, 5, long ? 6 : 5, 3, coat], // туловище
    [-3.75, 6, -1, 1.25, long ? 4.5 : 4, 2, coat], // руки
    [2.5, 6, -1, 1.25, long ? 4.5 : 4, 2, coat],
    [-3.75, 5.2, -1, 1.25, 0.9, 2, skin], // кисти
    [2.5, 5.2, -1, 1.25, 0.9, 2, skin],
    [-2, long ? 11 : 10, -2, 4, 4, 4, skin], // голова
    [-1.3, long ? 13 : 12, 2, 0.8, 0.8, 0.1, "#1b1b1f"], // глаза
    [0.5, long ? 13 : 12, 2, 0.8, 0.8, 0.1, "#1b1b1f"],
  ];
  const top = long ? 15 : 14;
  if (hat) {
    body.push([-2.2, top - 0.6, -2.2, 4.4, 1.6, 4.4, hat]);
    body.push([-1.6, top + 1, -1.6, 3.2, 1.2, 3.2, hat]);
    if (hatTrim) body.push([-2.3, top - 0.9, -2.3, 4.6, 0.8, 4.6, hatTrim]);
    if (pompom) body.push([-0.7, top + 2.2, -0.7, 1.4, 1.4, 1.4, pompom]);
  } else {
    body.push([-2.1, top - 1, -2.1, 4.2, 1.2, 4.2, hair]);
    body.push([-2.1, top - 3, -2.1, 4.2, 2.2, 0.8, hair]);
  }
  if (scarf) body.push([-2.6, long ? 10.3 : 9.3, -1.6, 5.2, 1, 3.2, scarf], [1.2, long ? 8 : 7, 1.5, 1, 2.4, 0.4, scarf]);
  if (beard) body.push([-2.1, long ? 9.5 : 8.5, 1.4, 4.2, 3, 1, beard], [-1.6, long ? 8 : 7, 1.4, 3.2, 1.6, 0.9, beard]);
  const leg = [[-1, -5, -1, 2, 5, 2, pants], [-1.1, -5, -1.1, 2.2, 1, 2.6, "#2a2420"]];
  return {
    body: boxesGeometry(body),
    limb: boxesGeometry(leg),
    limbs: [[-1.2 * U, 5 * U, 0], [1.2 * U, 5 * U, 0]], // точки бёдер
    gait: "biped",
    height: (top + 2) * U,
  };
}

function robot({ shell = "#c7ccd6", trim = "#5b6474", visor = "#5ef2ff", lamp = "#ff4d4d" }) {
  const body = [
    [-3, 5, -2, 6, 6, 4, shell],
    [-2, 7, 2, 4, 3, 0.2, trim], // панель на груди
    [-1.6, 8.6, 2.1, 0.8, 0.8, 0.2, "#7cfc9a"],
    [0.6, 8.6, 2.1, 0.8, 0.8, 0.2, "#ffd84d"],
    [-4.2, 6.5, -1, 1.2, 4, 2, trim], // руки-манипуляторы
    [3, 6.5, -1, 1.2, 4, 2, trim],
    [-2.5, 11, -2, 5, 4, 4, shell], // голова
    [-2, 12.2, 2, 4, 1.4, 0.2, visor], // визор
    [-0.3, 15, -0.3, 0.6, 2, 0.6, trim], // антенна
    [-0.6, 17, -0.6, 1.2, 1.2, 1.2, lamp],
  ];
  const leg = [[-1, -5, -1, 2, 5, 2, trim], [-1.3, -5, -1.3, 2.6, 1, 2.8, "#3a404c"]];
  return { body: boxesGeometry(body), limb: boxesGeometry(leg), limbs: [[-1.4 * U, 5 * U, 0], [1.4 * U, 5 * U, 0]], gait: "robot", height: 18 * U };
}

function deliveryBot() {
  // шестиколёсный робот-доставщик с флажком; едет, а не идёт
  const body = [
    [-2.5, 1.5, -3.5, 5, 4, 7, "#f4f4f2"],
    [-2.5, 5.5, -3.5, 5, 0.6, 7, "#1f2937"],
    [-2, 3, 3.5, 4, 1, 0.2, "#22d3ee"],
    [1.8, 5.5, -3.2, 0.3, 6, 0.3, "#9ca3af"],
    [2.1, 9.6, -3.2, 2.2, 1.6, 0.2, "#f97316"],
  ];
  const wheel = [[-0.6, -0.8, -0.8, 1.2, 1.6, 1.6, "#111318"]];
  const limbs = [];
  for (const z of [-2.6, 0, 2.6]) for (const x of [-2.9, 2.9]) limbs.push([x * U, 0.8 * U, z * U]);
  return { body: boxesGeometry(body), limb: boxesGeometry(wheel), limbs, gait: "wheels", height: 11 * U };
}

function quadruped({ fur, belly, dark = "#2b2b2b", head, ears, tail, antlers, legLen = 3, size = [3, 3, 6] }) {
  const [w, h, d] = size;
  const y0 = legLen;
  const body = [
    [-w / 2, y0, -d / 2, w, h, d, fur],
    [-w / 2 + 0.3, y0 - 0.01, -d / 2 + 1, w - 0.6, 0.6, d - 2, belly || fur],
    // голова впереди и чуть выше
    [-head[0] / 2, y0 + h - 1, d / 2 - 0.5, head[0], head[1], head[2], fur],
    [-head[0] / 2 + 0.5, y0 + h - 0.6, d / 2 + head[2] - 0.5, head[0] - 1, 1.2, 1.2, belly || fur], // морда
    [-0.5, y0 + h + 0.2, d / 2 + head[2] + 0.6, 1, 0.8, 0.3, dark], // нос
    [-head[0] / 2 + 0.3, y0 + h + head[1] - 2.2, d / 2 + head[2] - 0.6, 0.6, 0.6, 0.2, dark], // глаза
    [head[0] / 2 - 0.9, y0 + h + head[1] - 2.2, d / 2 + head[2] - 0.6, 0.6, 0.6, 0.2, dark],
  ];
  if (ears) body.push(...ears.map(([x, c]) => [x, y0 + h + head[1] - 1, d / 2 + 0.2, 1, 1.6, 0.8, c]));
  if (tail) body.push(...tail.map((t) => [t[0], y0 + h - 1 + t[1], -d / 2 - t[2], t[3], t[4], t[5], t[6]]));
  if (antlers) {
    for (const s of [-1, 1]) {
      body.push([s * 1.2 - 0.25, y0 + h + head[1] - 1, d / 2 + 0.6, 0.5, 3, 0.5, antlers]);
      body.push([s * 1.2 - 0.25 + s * 0.8, y0 + h + head[1] + 1.2, d / 2 + 0.6, 1.4, 0.5, 0.5, antlers]);
      body.push([s * 2.2 - 0.25, y0 + h + head[1] + 1.2, d / 2 + 0.6, 0.5, 2, 0.5, antlers]);
    }
  }
  const leg = [[-0.6, -legLen, -0.6, 1.2, legLen, 1.2, fur], [-0.7, -legLen, -0.7, 1.4, 0.6, 1.4, dark]];
  const lx = w / 2 - 0.7;
  const lz = d / 2 - 1;
  return {
    body: boxesGeometry(body),
    limb: boxesGeometry(leg),
    limbs: [[-lx * U, y0 * U, lz * U], [lx * U, y0 * U, -lz * U], [lx * U, y0 * U, lz * U], [-lx * U, y0 * U, -lz * U]],
    gait: "quad",
    height: (y0 + h + head[1]) * U,
  };
}

function rabbit() {
  const body = [
    [-1.5, 0, -2, 3, 3, 4, "#f5f5f2"],
    [-1.2, 2, 1.5, 2.4, 2.4, 2.4, "#f5f5f2"],
    [-1, 4.4, 2, 0.8, 2.8, 0.6, "#f5f5f2"],
    [0.2, 4.4, 2, 0.8, 2.8, 0.6, "#f5f5f2"],
    [-1, 4.8, 2.6, 0.4, 2, 0.1, "#f9b4c4"],
    [0.6, 4.8, 2.6, 0.4, 2, 0.1, "#f9b4c4"],
    [-0.9, 3.4, 3.9, 0.5, 0.5, 0.1, "#1b1b1f"],
    [0.4, 3.4, 3.9, 0.5, 0.5, 0.1, "#1b1b1f"],
    [-0.6, 1.5, -2.8, 1.2, 1.2, 1, "#ffffff"],
  ];
  return { body: boxesGeometry(body), limb: null, limbs: [], gait: "hop", height: 7 * U };
}

function penguin() {
  const body = [
    [-1.8, 1, -1.5, 3.6, 6, 3, "#1c2230"],
    [-1.3, 1.3, 1.5, 2.6, 4.6, 0.3, "#f8fafc"],
    [-1.5, 7, -1.3, 3, 2.6, 2.6, "#1c2230"],
    [-0.5, 7.6, 1.3, 1, 0.6, 1.2, "#f59e0b"],
    [-1.1, 8.4, 1.3, 0.5, 0.5, 0.1, "#ffffff"],
    [0.6, 8.4, 1.3, 0.5, 0.5, 0.1, "#ffffff"],
    [-2.4, 3, -0.8, 0.6, 3.5, 1.6, "#1c2230"],
    [1.8, 3, -0.8, 0.6, 3.5, 1.6, "#1c2230"],
    [-1.6, 6.6, -1.6, 3.2, 0.8, 3.2, "#dc2626"], // шарфик
  ];
  const foot = [[-0.7, -1, -0.2, 1.4, 1, 2, "#f59e0b"]];
  return { body: boxesGeometry(body), limb: boxesGeometry(foot), limbs: [[-0.9 * U, 1 * U, 0], [0.9 * U, 1 * U, 0]], gait: "waddle", height: 10 * U };
}

function bird({ back = "#5b6b7a", breast = "#e2463c", cap = "#1c1f24" }) {
  const body = [
    [-1, 0, -1.5, 2, 2, 3, back],
    [-0.9, -0.1, 0.2, 1.8, 1.6, 1.4, breast],
    [-0.8, 1.6, 0.6, 1.6, 1.4, 1.4, cap],
    [-0.3, 1.9, 2, 0.6, 0.5, 0.6, "#2b2b2b"],
    [-0.5, 0.4, -2.6, 1, 0.4, 1.4, cap],
  ];
  const wing = [[0, -0.2, -1.2, 2.4, 0.3, 2.2, back]];
  return { body: boxesGeometry(body), limb: boxesGeometry(wing), limbs: [[0.9 * U, 1.2 * U, 0], [-0.9 * U, 1.2 * U, 0]], gait: "fly", height: 3 * U };
}

// --- сборка ------------------------------------------------------------------

export function createResidents({ rnd, groundY, innerR = 25, outerR = 48, isMobile = false }) {
  const group = new THREE.Group();
  group.name = "residents";
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 });
  const robotMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.55 });
  const m = isMobile ? 0.6 : 1;

  const types = {
    man: { def: human({ coat: "#334155", pants: "#1f2937", hat: "#7f1d1d", scarf: "#e5b23a" }), n: 4 },
    woman: { def: human({ coat: "#b91c1c", pants: "#3f3f46", hat: "#f5f5f4", hatTrim: "#e7e5e4", scarf: "#f5f5f4", long: true }), n: 4 },
    granny: { def: human({ coat: "#4d7c0f", pants: "#3f3f46", hair: "#d6d3d1", scarf: "#be185d", long: true }), n: 2 },
    child: { def: human({ coat: "#2563eb", pants: "#1e3a8a", hat: "#facc15", pompom: "#ef4444", scarf: "#ef4444" }), n: 4, scale: 0.68 },
    dedmoroz: { def: human({ coat: "#c1121f", pants: "#c1121f", hat: "#c1121f", hatTrim: "#ffffff", beard: "#f8fafc", long: true }), n: 1, scale: 1.12, slow: true },
    snegurochka: { def: human({ coat: "#60a5fa", pants: "#dbeafe", hat: "#93c5fd", hatTrim: "#ffffff", hair: "#d6b36a", long: true }), n: 1 },
    robot: { def: robot({}), n: 4, mat: robotMat },
    robotGold: { def: robot({ shell: "#d4a53c", trim: "#6b4f1d", visor: "#ff9de2", lamp: "#7cfc9a" }), n: 2, mat: robotMat },
    courier: { def: deliveryBot(), n: 3, mat: robotMat },
    dog: { def: quadruped({ fur: "#b7793f", belly: "#f1d3a8", head: [2.4, 2.4, 2.4], ears: [[-1.4, "#7a4a24"], [0.4, "#7a4a24"]], tail: [[-0.4, 0.6, 1.4, 0.8, 0.8, 1.6, "#b7793f"]], legLen: 2.4, size: [2.6, 2.6, 5] }), n: 3 },
    fox: { def: quadruped({ fur: "#ea6a1f", belly: "#fff7ed", head: [2.2, 2.2, 2.6], ears: [[-1.2, "#ea6a1f"], [0.2, "#ea6a1f"]], tail: [[-0.6, 0.2, 2.6, 1.2, 1.2, 2.8, "#ea6a1f"], [-0.5, 0.3, 3.6, 1, 1, 1, "#ffffff"]], legLen: 2, size: [2.2, 2.2, 5] }), n: 2 },
    deer: { def: quadruped({ fur: "#8b5a2b", belly: "#e8d2b0", head: [2.4, 2.6, 3], antlers: "#e7d8b8", tail: [[-0.4, 0.4, 0.6, 0.8, 0.8, 0.8, "#ffffff"]], legLen: 5, size: [3.4, 3.4, 7] }), n: 2, slow: true },
    rabbit: { def: rabbit(), n: 3 },
    penguin: { def: penguin(), n: 3 },
    bird: { def: bird({}), n: 14, flock: true },
    birdBlue: { def: bird({ back: "#3b82f6", breast: "#fde047", cap: "#1e3a8a" }), n: 8, flock: true },
  };

  // число жителей по типам (на телефоне меньше)
  for (const t of Object.values(types)) t.n = Math.max(1, Math.round(t.n * m));

  // агенты: где ходят и как
  const agents = [];
  const add = (type, extra = {}) => {
    const t = types[type];
    const a = {
      type,
      t,
      idx: t.count = (t.count ?? 0) + 1,
      angle: rnd() * TAU,
      r: innerR + rnd() * (outerR - innerR),
      dir: rnd() < 0.5 ? -1 : 1,
      speed: (t.slow ? 0.55 : 0.9) + rnd() * 0.6, // единиц в секунду
      phase: rnd() * TAU,
      pause: 0,
      walkFor: 6 + rnd() * 10,
      scale: (t.scale ?? 1) * (0.92 + rnd() * 0.16),
      ...extra,
    };
    a.idx -= 1;
    agents.push(a);
    return a;
  };
  for (const [id, t] of Object.entries(types)) {
    if (t.flock) continue;
    for (let i = 0; i < t.n; i++) add(id);
  }
  // Симбиозы: робот выгуливает собаку, ребёнок верхом на олене,
  // снегирь путешествует на голове робота, дети бегут за Дедом Морозом
  const pairs = [];
  const robots = agents.filter((a) => a.type === "robot");
  const dogs = agents.filter((a) => a.type === "dog");
  if (robots[0] && dogs[0]) {
    dogs[0].leader = robots[0];
    dogs[0].follow = 2.2;
    pairs.push([robots[0], dogs[0]]);
  }
  const deer = agents.find((a) => a.type === "deer");
  const kid = agents.filter((a) => a.type === "child");
  if (deer && kid[0]) kid[0].rider = deer;
  const dm = agents.find((a) => a.type === "dedmoroz");
  const sn = agents.find((a) => a.type === "snegurochka");
  if (dm && sn) {
    sn.leader = dm;
    sn.follow = -1.6;
    sn.side = 1.6;
  }
  if (dm && kid[1]) {
    kid[1].leader = dm;
    kid[1].follow = -3.2;
    kid[1].side = -1.2;
  }
  const perch = types.bird.n > 2 && robots[1] ? robots[1] : null;

  // стаи птиц кружат над площадью и облетают ёлку
  for (const id of ["bird", "birdBlue"]) {
    const t = types[id];
    const centerR = 30 + rnd() * 20;
    const h = 14 + rnd() * 18;
    for (let i = 0; i < t.n; i++) {
      add(id, {
        flockR: centerR + (rnd() - 0.5) * 6,
        flockH: h + (rnd() - 0.5) * 4,
        speed: 0.18 + rnd() * 0.04,
        angle: rnd() * 0.6,
        dir: id === "bird" ? 1 : -1,
        perched: false,
      });
    }
  }
  if (perch) {
    const b = agents.find((a) => a.type === "bird");
    b.perchOn = perch;
  }

  // меши
  for (const t of Object.values(types)) {
    const count = t.count ?? 0;
    if (!count) continue;
    t.bodyMesh = new THREE.InstancedMesh(t.def.body, t.mat ?? mat, count);
    t.bodyMesh.frustumCulled = false;
    t.bodyMesh.castShadow = false;
    group.add(t.bodyMesh);
    if (t.def.limb && t.def.limbs.length) {
      t.limbMesh = new THREE.InstancedMesh(t.def.limb, t.mat ?? mat, count * t.def.limbs.length);
      t.limbMesh.frustumCulled = false;
      group.add(t.limbMesh);
    }
  }

  // поводок (линия от руки робота к ошейнику собаки)
  const leashGeo = new THREE.BufferGeometry();
  leashGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(pairs.length * 6), 3));
  const leash = new THREE.LineSegments(leashGeo, new THREE.LineBasicMaterial({ color: "#e11d48" }));
  leash.frustumCulled = false;
  group.add(leash);

  const M = new THREE.Matrix4();
  const L = new THREE.Matrix4();
  const R = new THREE.Matrix4();
  const S = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const tmpV = new THREE.Vector3();

  const posOf = (a, out) => out.set(Math.cos(a.angle) * a.r, groundY, Math.sin(a.angle) * a.r);

  function update(elapsed, dt) {
    dt = Math.min(dt, 0.1);
    for (const a of agents) {
      const t = a.t;
      const def = t.def;
      let moving = 0;
      let x;
      let y;
      let z;
      let yaw;
      let roll = 0;
      let bob = 0;

      if (t.flock) {
        if (a.perchOn) {
          // снегирь сидит на голове у робота
          const host = a.perchOn;
          posOf(host, v);
          x = v.x;
          z = v.z;
          y = groundY + host.t.def.height * host.scale + 0.05;
          yaw = host.yaw ?? 0;
        } else {
          a.angle += a.dir * a.speed * dt;
          const wob = Math.sin(elapsed * 0.6 + a.phase) * 2.5;
          x = Math.cos(a.angle) * (a.flockR + wob);
          z = Math.sin(a.angle) * (a.flockR + wob);
          y = a.flockH + Math.sin(elapsed * 0.9 + a.phase) * 1.2;
          yaw = Math.atan2(-Math.sin(a.angle) * a.dir, Math.cos(a.angle) * a.dir);
          roll = -a.dir * 0.25;
          moving = 1;
        }
      } else if (a.rider) {
        const host = a.rider;
        posOf(host, v);
        x = v.x;
        z = v.z;
        y = groundY + (host.t.def.height * 0.62) * host.scale;
        yaw = host.yaw ?? 0;
      } else if (a.leader) {
        // идёт рядом с ведущим, чуть позади/сбоку
        const ld = a.leader;
        const ang = ld.angle - ((a.follow ?? 2) / ld.r) * ld.dir * -1;
        a.angle += (ang - a.angle) * Math.min(1, dt * 3);
        a.r += (ld.r + (a.side ?? 0.8) - a.r) * Math.min(1, dt * 2);
        posOf(a, v);
        x = v.x;
        z = v.z;
        y = groundY;
        moving = ld.moving ?? 0;
        yaw = ld.yaw ?? 0;
      } else {
        // гуляет по кругу вокруг ёлки, иногда останавливается полюбоваться
        if (a.pause > 0) {
          a.pause -= dt;
          a.walkFor = 5 + Math.random() * 12;
        } else {
          a.walkFor -= dt;
          if (a.walkFor <= 0) a.pause = 2 + Math.random() * 5;
          a.angle += (a.dir * a.speed * dt) / a.r;
          // плавное «петляние» по радиусу
          a.r += Math.sin(elapsed * 0.25 + a.phase) * 0.6 * dt;
          a.r = Math.max(innerR, Math.min(outerR, a.r));
          moving = 1;
        }
        posOf(a, v);
        x = v.x;
        z = v.z;
        y = groundY;
        // лицом по ходу движения; на остановке — к ёлке
        const along = Math.atan2(-Math.sin(a.angle) * a.dir, Math.cos(a.angle) * a.dir);
        const toTree = Math.atan2(-x, -z);
        const target = moving ? along : toTree;
        const cur = a.yaw ?? target;
        let d = target - cur;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw = cur + d * Math.min(1, dt * 3);
      }
      a.moving = moving;
      a.yaw = yaw;

      const stride = elapsed * (def.gait === "quad" ? 7 : 6) * (a.speed || 1) + a.phase;
      if (def.gait === "hop" && moving) bob = Math.abs(Math.sin(stride * 0.9)) * 0.55;
      if ((def.gait === "biped" || def.gait === "robot") && moving) bob = Math.abs(Math.sin(stride)) * 0.06;
      if (def.gait === "waddle") roll = Math.sin(stride * 0.8) * (moving ? 0.18 : 0.03);

      e.set(0, yaw, roll, "YXZ");
      q.setFromEuler(e);
      v.set(x, y + bob, z);
      S.makeScale(a.scale, a.scale, a.scale);
      M.compose(v, q, one).multiply(S);
      t.bodyMesh.setMatrixAt(a.idx, M);

      if (t.limbMesh) {
        def.limbs.forEach((p, li) => {
          let ang = 0;
          if (def.gait === "fly") {
            // крылья: взмахи вокруг оси Z
            const flap = Math.sin(elapsed * 12 + a.phase) * 0.7 * (a.perchOn ? 0.05 : 1);
            R.makeRotationZ(li === 0 ? -flap : Math.PI + flap);
          } else if (def.gait === "wheels") {
            R.makeRotationX(moving ? elapsed * 6 : 0);
          } else {
            const sgn = li % 2 === 0 ? 1 : -1;
            ang = moving ? Math.sin(stride) * (def.gait === "quad" ? 0.55 : 0.6) * sgn : 0;
            if (def.gait === "robot") ang *= 0.6;
            R.makeRotationX(ang);
          }
          L.makeTranslation(p[0], p[1], p[2]);
          L.premultiply(M).multiply(R);
          t.limbMesh.setMatrixAt(a.idx * def.limbs.length + li, L);
        });
      }
    }
    for (const t of Object.values(types)) {
      if (t.bodyMesh) t.bodyMesh.instanceMatrix.needsUpdate = true;
      if (t.limbMesh) t.limbMesh.instanceMatrix.needsUpdate = true;
    }
    // поводки
    const pa = leashGeo.attributes.position;
    pairs.forEach(([rb, dg], i) => {
      posOf(rb, tmpV);
      const hy = groundY + 6 * U * rb.scale;
      const hx = tmpV.x + Math.cos((rb.yaw ?? 0)) * 3.6 * U;
      const hz = tmpV.z - Math.sin((rb.yaw ?? 0)) * 3.6 * U;
      posOf(dg, tmpV);
      const neckY = groundY + dg.t.def.height * 0.75 * dg.scale;
      const fx = tmpV.x + Math.sin(dg.yaw ?? 0) * 2.4 * U;
      const fz = tmpV.z + Math.cos(dg.yaw ?? 0) * 2.4 * U;
      pa.setXYZ(i * 2, hx, hy, hz);
      pa.setXYZ(i * 2 + 1, fx, neckY, fz);
    });
    pa.needsUpdate = true;
  }

  update(0, 0);

  return {
    group,
    update,
    stats: { residents: agents.length },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose?.();
      });
      mat.dispose();
      robotMat.dispose();
    },
  };
}
