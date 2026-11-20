// ============================================================================
// Жители площади Ёлки мира в стиле «Пиксели»: фигуры из блестящих кубиков.
//
// Кубики «запечены» заранее из реалистичных моделей (tools/vox-bake): у людей
// 8 кадров шага + поза стоя, у зверей одна поза. Файлы — /models/vox/*.bin,
// все вместе ≈ 0,5 МБ. Каждый кадр — InstancedBufferGeometry из одинаковых
// кубиков; житель — обычный Mesh, у которого меняется геометрия-кадр.
//
// У ёлки стоят Дед Мороз и Снегурочка-андроид. Гуляющие по очереди подходят
// к ним поговорить; над Дедом Морозом появляется облачко с репликой.
// ============================================================================
import * as THREE from "three";

const METER = 2.2; // единиц сцены в метре
const BASE = "/models/vox/";

// Где стоят Дед Мороз и Снегурочка: угол и радиус от оси ёлки
export const HOSTS_ANGLE = -Math.PI / 2;
export const HOSTS_RADIUS = 33;

const PHRASES = [
  "С Новым годом!",
  "Загадай желание!",
  "Зажги свечу шару!",
  "Повесь свой шар!",
  "Тепла твоему дому!",
  "Чудеса рядом!",
  "До полуночи — чуть-чуть!",
];

const WALKERS_DESKTOP = ["man", "woman", "child", "android", "elderly-woman", "hoodie-teen", "elderly-man", "woman", "android", "child", "man", "hoodie-teen"];
const WALKERS_MOBILE = ["woman", "man", "child", "android", "elderly-woman", "android"];

// звери: [имя, угол, радиус, поворот относительно «к ёлке»]
const ANIMALS_DESKTOP = [
  ["reindeer", HOSTS_ANGLE - 0.13, HOSTS_RADIUS - 3.2, 1.3],
  ["reindeer", 0.62, 51.5, 0.3],
  ["polar-bear", 2.25, 50.5, -0.4],
  ["penguin", 2.55, 49.5, 0.2],
  ["penguin", 2.63, 48.6, -0.3],
  ["penguin", 2.7, 50.2, 0.5],
  ["dog", 4.05, 33.6, 1.2],
  ["puppy", 1.18, 33.4, 0.1],
  ["fox", 5.3, 52.0, -1.0],
  ["rabbit", 3.55, 26.6, 0.4],
  ["rabbit", 3.62, 27.2, -0.6],
];
const ANIMALS_MOBILE = [
  ["reindeer", HOSTS_ANGLE - 0.13, HOSTS_RADIUS - 3.2, 1.3],
  ["penguin", 2.55, 49.5, 0.2],
  ["penguin", 2.63, 48.6, -0.3],
  ["dog", 4.05, 33.6, 1.2],
];

// --- данные ----------------------------------------------------------------------
async function loadVox(name) {
  const res = await fetch(BASE + name + ".bin");
  if (!res.ok) throw new Error(name + ": " + res.status);
  const dv = new DataView(await res.arrayBuffer());
  const cell = dv.getFloat32(4, true);
  const count = dv.getUint8(8);
  const stand = dv.getUint8(9);
  const frames = [];
  let o = 16;
  for (let f = 0; f < count; f++) {
    const n = dv.getUint16(o, true);
    o += 2;
    const off = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let maxY = 0;
    for (let i = 0; i < n; i++) {
      off[i * 3] = dv.getInt8(o);
      off[i * 3 + 1] = dv.getUint8(o + 1);
      off[i * 3 + 2] = dv.getInt8(o + 2);
      maxY = Math.max(maxY, off[i * 3 + 1]);
      // sRGB → линейное пространство
      col[i * 3] = Math.pow(dv.getUint8(o + 3) / 255, 2.2);
      col[i * 3 + 1] = Math.pow(dv.getUint8(o + 4) / 255, 2.2);
      col[i * 3 + 2] = Math.pow(dv.getUint8(o + 5) / 255, 2.2);
      o += 6;
    }
    frames.push({ off, col, n, maxY });
  }
  return { cell, frames, stand };
}

// Кубик «как в Пикселях»: глянец, светлые рёбра и мягкое свечение изнутри
function makeVoxelMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.24, metalness: 0.12, envMapIntensity: 1.1 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 iOff;\nattribute vec3 iCol;\nvarying vec3 vICol;\nvarying vec2 vEdgeUv;"
      )
      .replace(
        "#include <begin_vertex>",
        "vec3 transformed = position * 0.9 + iOff + vec3(0.0, 0.5, 0.0);\nvICol = iCol;\nvEdgeUv = uv;"
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vICol;\nvarying vec2 vEdgeUv;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vICol;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n" +
          "float edge = max(abs(vEdgeUv.x - 0.5), abs(vEdgeUv.y - 0.5)) * 2.0;\n" +
          "float e = smoothstep(0.7, 0.98, edge);\n" +
          "diffuseColor.rgb *= 1.0 - e * 0.25;\n" +
          "totalEmissiveRadiance += vICol * (0.1 + e * 0.32);"
      );
  };
  return mat;
}

function frameGeometry(cube, fr) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = cube.index;
  g.attributes.position = cube.attributes.position;
  g.attributes.normal = cube.attributes.normal;
  g.attributes.uv = cube.attributes.uv;
  g.setAttribute("iOff", new THREE.InstancedBufferAttribute(fr.off, 3));
  g.setAttribute("iCol", new THREE.InstancedBufferAttribute(fr.col, 3));
  g.instanceCount = fr.n;
  return g;
}

// Снегирь из кубиков: два кадра (крылья вверх/вниз)
function birdFrames() {
  const make = (wingUp) => {
    const v = [];
    const put = (x, y, z, c) => v.push([x, y, z, c]);
    const grey = [0.36, 0.42, 0.5], red = [0.9, 0.22, 0.2], black = [0.08, 0.08, 0.1];
    for (let z = -2; z <= 1; z++) for (let x = -1; x <= 0; x++) for (let y = 0; y <= 1; y++) put(x, y, z, y === 0 && z >= 0 ? red : grey);
    for (let x = -1; x <= 0; x++) for (let y = 1; y <= 2; y++) put(x, y, 2, black);
    put(0, 1, 3, [0.15, 0.15, 0.15]);
    put(-1, 1, -3, black);
    put(0, 1, -3, black);
    for (let s of [-1, 1]) {
      for (let k = 1; k <= 3; k++) {
        const x = s < 0 ? -1 - k : k;
        const y = 1 + (wingUp ? k : -Math.floor(k / 2));
        put(x, y, 0, grey);
        put(x, y, -1, grey);
      }
    }
    const n = v.length;
    const off = new Float32Array(n * 3), col = new Float32Array(n * 3);
    v.forEach(([x, y, z, c], i) => {
      off.set([x, y, z], i * 3);
      col.set(c.map((t) => Math.pow(t, 2.2)), i * 3);
    });
    return { off, col, n, maxY: 5 };
  };
  return { cell: 0.07, frames: [make(true), make(false)], stand: 0 };
}

// Облачко с репликой: «пиксельный» шрифт на холсте
function makeBubble() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(5.2, 1.3, 1);
  sprite.visible = false;
  sprite.renderOrder = 10;
  const draw = (text) => {
    const g = c.getContext("2d");
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = "rgba(255,255,255,0.94)";
    g.fillRect(8, 8, 496, 88);
    g.fillRect(232, 96, 24, 12);
    g.fillRect(240, 108, 12, 10);
    g.strokeStyle = "#1e293b";
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 88);
    g.fillStyle = "#0f172a";
    g.font = "bold 40px monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 256, 54);
    tex.needsUpdate = true;
  };
  return { sprite, draw, dispose: () => (tex.dispose(), sprite.material.dispose()) };
}

export function createVoxResidents({ groundY, innerR = 28, outerR = 47, isMobile = false, obstacles = [] }) {
  const group = new THREE.Group();
  group.name = "vox-residents";
  const mat = makeVoxelMaterial();
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const walkerKinds = isMobile ? WALKERS_MOBILE : WALKERS_DESKTOP;
  const animalSpots = isMobile ? ANIMALS_MOBILE : ANIMALS_DESKTOP;
  const geoms = [];
  const walkers = [];
  const animals = [];
  const birds = [];
  let hosts = null;
  const bubble = makeBubble();
  group.add(bubble.sprite);

  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const hostX = Math.cos(HOSTS_ANGLE) * HOSTS_RADIUS;
  const hostZ = Math.sin(HOSTS_ANGLE) * HOSTS_RADIUS;
  // гости встают с внешней стороны, лицом к хозяевам
  const outward = new THREE.Vector2(Math.cos(HOSTS_ANGLE), Math.sin(HOSTS_ANGLE));
  const tangent = new THREE.Vector2(-outward.y, outward.x);
  obstacles.push({ x: hostX, z: hostZ, r: 4.5 });

  const makeActor = (data) => {
    const frames = data.frames.map((fr) => {
      const g = frameGeometry(cube, fr);
      geoms.push(g);
      return g;
    });
    const mesh = new THREE.Mesh(frames[data.stand], mat);
    mesh.frustumCulled = false;
    const k = data.cell * METER;
    mesh.scale.setScalar(k);
    const holder = new THREE.Group();
    holder.add(mesh);
    group.add(holder);
    return { holder, mesh, frames, data, k, height: data.frames[data.stand].maxY * k };
  };

  const ready = (async () => {
    const names = [...new Set(["dedmoroz", "snegurochka", ...walkerKinds, ...animalSpots.map((a) => a[0])])];
    const cache = {};
    await Promise.all(
      names.map(async (n) => {
        try {
          cache[n] = await loadVox(n);
        } catch (err) {
          console.warn("[Residents] нет данных", n, err);
        }
      })
    );

    // Дед Мороз и Снегурочка стоят рядом, лицом наружу, чуть развернувшись друг к другу
    if (cache.dedmoroz && cache.snegurochka) {
      const dm = makeActor(cache.dedmoroz);
      const sn = makeActor(cache.snegurochka);
      const face = Math.atan2(outward.x, outward.y);
      dm.holder.position.set(hostX + tangent.x * 1.4, groundY, hostZ + tangent.y * 1.4);
      sn.holder.position.set(hostX - tangent.x * 1.4, groundY, hostZ - tangent.y * 1.4);
      dm.baseYaw = face - 0.25;
      sn.baseYaw = face + 0.25;
      dm.yaw = dm.baseYaw;
      sn.yaw = sn.baseYaw;
      hosts = { dm, sn, face };
    }

    walkerKinds.forEach((name, i) => {
      const d = cache[name];
      if (!d) return;
      const a = makeActor(d);
      walkers.push({
        name,
        ...a,
        angle: (i / walkerKinds.length) * Math.PI * 2 + rnd() * 0.3,
        r: innerR + 1 + rnd() * (outerR - innerR - 2),
        dir: rnd() < 0.5 ? -1 : 1,
        speed: (name === "child" ? 1.0 : name.startsWith("elderly") ? 0.8 : 1.2) * (0.9 + rnd() * 0.2) * METER,
        stride: (name === "child" ? 1.0 : 1.35) * METER,
        cycle: rnd(),
        mode: "orbit",
        pos: new THREE.Vector2(),
        yaw: 0,
        phase: rnd() * Math.PI * 2,
      });
    });

    for (const [name, ang, r, yawOff] of animalSpots) {
      const d = cache[name];
      if (!d) continue;
      const a = makeActor(d);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      a.holder.position.set(x, groundY, z);
      a.holder.rotation.y = Math.atan2(-x, -z) + yawOff;
      animals.push({ ...a, name, phase: rnd() * Math.PI * 2 });
      obstacles.push({ x, z, r: name === "polar-bear" || name === "reindeer" ? 3.2 : 1.6 });
    }

    // стайки снегирей над площадью
    const bd = birdFrames();
    const nBirds = isMobile ? 6 : 14;
    for (let i = 0; i < nBirds; i++) {
      const a = makeActor(bd);
      birds.push({
        ...a,
        angle: rnd() * Math.PI * 2,
        r: 26 + rnd() * 22,
        h: 12 + rnd() * 16,
        speed: (0.16 + rnd() * 0.06) * (i % 3 === 0 ? -1 : 1),
        phase: rnd() * Math.PI * 2,
      });
    }
    console.info("[Residents] пиксельная площадь:", walkers.length, "гуляют,", animals.length, "зверей,", birds.length, "птиц");
  })();

  // очередь гостей к Деду Морозу и Снегурочке
  let visitor = null;
  let nextVisitAt = 4;
  let bubbleUntil = 0;
  // гость встаёт сбоку от хозяев, вполоборота — так он не закрывает их от камеры
  const meetPoint = (side) =>
    new THREE.Vector2(hostX + outward.x * 2.4 + tangent.x * side, hostZ + outward.y * 2.4 + tangent.y * side);

  const v2 = new THREE.Vector2();

  function stepToward(w, target, dt) {
    v2.copy(target).sub(w.pos);
    const d = v2.length();
    if (d < 0.15) return true;
    const step = Math.min(d, w.speed * dt);
    w.pos.addScaledVector(v2.normalize(), step);
    w.cycle += step / w.stride;
    const yaw = Math.atan2(v2.x, v2.y);
    let dd = yaw - w.yaw;
    dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    w.yaw += dd * Math.min(1, dt * 6);
    return false;
  }

  function update(elapsed, dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);

    // назначаем следующего гостя
    if (hosts && !visitor && elapsed > nextVisitAt && walkers.length) {
      const free = walkers.filter((w) => w.mode === "orbit");
      // ближайший к хозяевам — чтобы подходил недолго
      free.sort((a, b) => Math.hypot(a.pos.x - hostX, a.pos.y - hostZ) - Math.hypot(b.pos.x - hostX, b.pos.y - hostZ));
      const w = free[Math.floor(rnd() * Math.min(3, free.length))];
      if (w) {
        visitor = w;
        w.mode = "approach";
        w.target = meetPoint((rnd() < 0.5 ? -1 : 1) * (4.3 + rnd() * 0.8));
      }
    }

    for (const w of walkers) {
      let walking = true;
      if (w.mode === "orbit") {
        w.angle += (w.dir * w.speed * dt) / w.r;
        let push = Math.sin(elapsed * 0.08 + w.phase) * 0.35;
        const x = Math.cos(w.angle) * w.r, z = Math.sin(w.angle) * w.r;
        for (const ob of obstacles) {
          const dx = x - ob.x, dz = z - ob.z;
          const d = Math.hypot(dx, dz);
          const lim = (ob.r + 1.6) * 2;
          if (d < lim) push += ((dx * x + dz * z) / w.r >= 0 ? 1 : -1) * (1 - d / lim) * 6;
        }
        w.r = Math.max(innerR, Math.min(outerR, w.r + push * dt));
        const nx = Math.cos(w.angle) * w.r, nz = Math.sin(w.angle) * w.r;
        w.cycle += (Math.hypot(nx - w.pos.x, nz - w.pos.y) || w.speed * dt) / w.stride;
        w.pos.set(nx, nz);
        const yaw = Math.atan2(-Math.sin(w.angle) * w.dir, Math.cos(w.angle) * w.dir);
        let dd = yaw - w.yaw;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        w.yaw += dd * Math.min(1, dt * 4);
      } else if (w.mode === "approach") {
        if (stepToward(w, w.target, dt)) {
          w.mode = "talk";
          w.talkUntil = elapsed + 4.5 + rnd() * 2.5;
          bubble.draw(PHRASES[Math.floor(rnd() * PHRASES.length)]);
          bubbleUntil = w.talkUntil - 0.6;
        }
      } else if (w.mode === "talk") {
        walking = false;
        // лицом к хозяевам
        const yaw = Math.atan2(hostX - w.pos.x, hostZ - w.pos.y);
        let dd = yaw - w.yaw;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        w.yaw += dd * Math.min(1, dt * 4);
        if (elapsed > w.talkUntil) {
          w.mode = "leave";
          w.angle = Math.atan2(w.pos.y, w.pos.x) + w.dir * 0.12;
          w.r = Math.min(outerR, HOSTS_RADIUS + 7 + rnd() * 4);
          w.target = new THREE.Vector2(Math.cos(w.angle) * w.r, Math.sin(w.angle) * w.r);
        }
      } else if (w.mode === "leave") {
        if (stepToward(w, w.target, dt)) {
          w.mode = "orbit";
          visitor = null;
          nextVisitAt = elapsed + 3 + rnd() * 4;
        }
      }
      // кадр шага или поза стоя
      const walkFrames = w.frames.length - 1;
      const f = walking && walkFrames > 0 ? Math.floor((((w.cycle % 1) + 1) % 1) * walkFrames) : w.data.stand;
      w.mesh.geometry = w.frames[f];
      w.holder.position.set(w.pos.x, groundY, w.pos.y);
      w.holder.rotation.y = w.yaw;
    }

    // хозяева: дышат и поворачиваются к собеседнику
    if (hosts) {
      for (const h of [hosts.dm, hosts.sn]) {
        let target = h.baseYaw;
        if (visitor && visitor.mode === "talk") {
          target = Math.atan2(visitor.pos.x - h.holder.position.x, visitor.pos.y - h.holder.position.z);
        }
        let dd = target - h.yaw;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        h.yaw += dd * Math.min(1, dt * 2.5);
        h.holder.rotation.y = h.yaw;
        h.holder.scale.y = 1 + Math.sin(elapsed * 1.7 + (h === hosts.dm ? 0 : 1.3)) * 0.008;
      }
      const showBubble = elapsed < bubbleUntil;
      bubble.sprite.visible = showBubble;
      if (showBubble) {
        const p = hosts.dm.holder.position;
        bubble.sprite.position.set(p.x, groundY + hosts.dm.height + 0.75 + Math.sin(elapsed * 2) * 0.05, p.z);
      }
    }

    for (const a of animals) {
      a.holder.scale.y = 1 + Math.sin(elapsed * 1.6 + a.phase) * 0.012;
      if (a.name === "penguin") a.holder.rotation.z = Math.sin(elapsed * 1.3 + a.phase) * 0.05;
    }

    for (const b of birds) {
      b.angle += b.speed * dt;
      const wob = Math.sin(elapsed * 0.6 + b.phase) * 2.5;
      b.holder.position.set(Math.cos(b.angle) * (b.r + wob), b.h + Math.sin(elapsed * 0.9 + b.phase) * 1.2, Math.sin(b.angle) * (b.r + wob));
      const dir = Math.sign(b.speed);
      b.holder.rotation.y = Math.atan2(-Math.sin(b.angle) * dir, Math.cos(b.angle) * dir);
      b.mesh.geometry = b.frames[Math.floor(elapsed * 9 + b.phase) % 2];
    }
  }

  return {
    group,
    ready,
    update,
    hosts: { angle: HOSTS_ANGLE, radius: HOSTS_RADIUS, x: hostX, z: hostZ },
    stats: { walkers: walkerKinds.length, animals: animalSpots.length },
    dispose() {
      geoms.forEach((g) => g.dispose());
      cube.dispose();
      mat.dispose();
      bubble.dispose();
    },
  };
}
