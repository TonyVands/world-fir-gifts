// ============================================================================
// Жители площади Ёлки мира — реалистичные 3D-модели (Grab3D, лицензия CC0).
//
// Люди и андроиды ходят по площади с настоящей анимацией походки (скелет +
// клип «walk»). Звери — фотореалистичные статичные модели: стоят и сидят у
// скамеек, домиков и фонарей, едва заметно «дышат». Симбиоз человека и
// машины: андроиды гуляют рядом с людьми, малиновка сидит у андроида на плече.
//
// Модели грузятся ПОСЛЕ ёлки (сайт открывается так же быстро), на телефоне —
// облегчённый набор. Масштаб сцены: 1 метр = METER единиц.
// ============================================================================
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

const METER = 2.2;
const BASE = "/models/residents/";

// рост в метрах (по нему нормируем модели) и скорость шага
const KINDS = {
  "santa-claus": { h: 1.85, speed: 0.95 },
  man: { h: 1.82, speed: 1.3 },
  woman: { h: 1.7, speed: 1.2 },
  "elderly-man": { h: 1.72, speed: 0.85 },
  "elderly-woman": { h: 1.6, speed: 0.8 },
  child: { h: 1.25, speed: 1.05 },
  "hoodie-teen": { h: 1.74, speed: 1.35 },
  android: { h: 1.82, speed: 1.15 },
  reindeer: { h: 1.75 },
  dog: { h: 0.72 },
  puppy: { h: 0.45 },
  fox: { h: 0.6 },
  rabbit: { h: 0.38 },
  penguin: { h: 1.05 },
  owl: { h: 0.45 },
  "polar-bear": { h: 1.45 },
  bird: { h: 0.16 },
};

// Кто гуляет (по порядку важности; на телефоне берём первые)
const WALKERS_DESKTOP = [
  "santa-claus", "android", "woman", "man", "child", "elderly-woman", "android",
  "hoodie-teen", "elderly-man", "woman", "child", "man", "android", "hoodie-teen",
];
const WALKERS_MOBILE = ["santa-claus", "android", "woman", "man", "child"];

// Где стоят звери: угол (рад), радиус, поворот (к ёлке = 0)
const ANIMALS_DESKTOP = [
  ["reindeer", 0.35, 50.5, 0.6],
  ["reindeer", 0.62, 51.5, 0.3],
  ["polar-bear", 2.25, 50.5, -0.4],
  ["penguin", 2.55, 49.5, 0.2],
  ["penguin", 2.63, 48.6, -0.3],
  ["penguin", 2.7, 50.2, 0.5],
  ["dog", 4.05, 33.6, 1.2],
  ["puppy", 1.18, 33.4, 0.1],
  ["fox", 5.3, 52.0, -1.0],
  ["rabbit", 3.55, 26.2, 0.4],
  ["rabbit", 3.62, 26.8, -0.6],
  ["bird", 1.96, 31.1, 0.0, "bench"],
];
const ANIMALS_MOBILE = [
  ["reindeer", 0.35, 50.5, 0.6],
  ["penguin", 2.55, 49.5, 0.2],
  ["penguin", 2.63, 48.6, -0.3],
  ["dog", 4.05, 33.6, 1.2],
];

function loadGLB(loader, name) {
  return new Promise((resolve, reject) => loader.load(BASE + name + ".glb", resolve, undefined, reject));
}

// Нормализация: ставим модель на землю и приводим к росту h метров
function normalize(root, hMeters) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const k = (hMeters * METER) / Math.max(1e-6, size.y);
  const holder = new THREE.Group();
  root.scale.multiplyScalar(k);
  root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root);
  root.position.y -= b2.min.y;
  root.position.x -= (b2.min.x + b2.max.x) / 2;
  root.position.z -= (b2.min.z + b2.max.z) / 2;
  holder.add(root);
  return holder;
}

function tuneMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m) return;
      m.side = THREE.FrontSide;
      if ("envMapIntensity" in m) m.envMapIntensity = 0.9;
    });
    if (o.isSkinnedMesh) o.frustumCulled = false; // кости двигают меш за пределы исходной рамки
  });
}

export function createRealResidents({ groundY, innerR = 25, outerR = 47, isMobile = false, obstacles = [] }) {
  const group = new THREE.Group();
  group.name = "real-residents";
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const walkerKinds = isMobile ? WALKERS_MOBILE : WALKERS_DESKTOP;
  const animalSpots = isMobile ? ANIMALS_MOBILE : ANIMALS_DESKTOP;
  const needed = [...new Set([...walkerKinds, ...animalSpots.map((a) => a[0]), ...(isMobile ? ["bird"] : [])])];

  const walkers = [];
  const animals = [];
  const mixers = [];
  let disposed = false;
  const rnd = (() => {
    let s = 20261231;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();

  const ready = (async () => {
    // люди сначала: они важнее; модели грузим по очереди, чтобы не мешать ёлке
    const cache = {};
    for (const name of needed) {
      if (disposed) return;
      try {
        cache[name] = await loadGLB(loader, name);
      } catch (err) {
        console.warn("[Residents] не загрузилась модель", name, err);
      }
    }
    if (disposed) return;

    // --- гуляющие ---
    walkerKinds.forEach((name, i) => {
      const gltf = cache[name];
      if (!gltf) return;
      const kind = KINDS[name];
      const inst = cloneSkinned(gltf.scene);
      tuneMaterials(inst);
      const body = normalize(inst, kind.h * (0.96 + rnd() * 0.08));
      group.add(body);
      const mixer = new THREE.AnimationMixer(inst);
      const clip = gltf.animations.find((a) => /walk/i.test(a.name)) || gltf.animations[0];
      const speedM = kind.speed * (0.9 + rnd() * 0.2); // м/с
      if (clip) {
        const act = mixer.clipAction(clip);
        // шаг: за один цикл клипа (≈1 с) человек проходит ~1,4 м
        act.timeScale = speedM / (1.4 * (kind.h / 1.75)) * clip.duration;
        act.time = rnd() * clip.duration;
        act.play();
      }
      mixers.push(mixer);
      walkers.push({
        name,
        body,
        inst,
        angle: (i / walkerKinds.length) * Math.PI * 2 + rnd() * 0.4,
        r: innerR + 2 + rnd() * (outerR - innerR - 4),
        lane: 0,
        dir: rnd() < 0.5 ? -1 : 1,
        speed: speedM * METER,
        phase: rnd() * Math.PI * 2,
      });
    });

    // Пары «человек + машина»: андроиды идут рядом с людьми
    const santa = walkers.find((w) => w.name === "santa-claus");
    const androids = walkers.filter((w) => w.name === "android");
    const humans = walkers.filter((w) => w.name !== "android" && w.name !== "santa-claus");
    if (androids[0] && santa) Object.assign(androids[0], { leader: santa, follow: 0.6, side: 2.4 });
    if (androids[1] && humans[0]) Object.assign(androids[1], { leader: humans[0], follow: 0.4, side: -2.3 });
    if (humans[1] && humans[2] && humans[2].name === "child") Object.assign(humans[2], { leader: humans[1], follow: 0.2, side: 1.8 });

    // --- звери ---
    for (const [name, ang, r, yawOff, place] of animalSpots) {
      const gltf = cache[name];
      if (!gltf) continue;
      const inst = gltf.scene.clone(true);
      tuneMaterials(inst);
      const body = normalize(inst, KINDS[name].h * (0.94 + rnd() * 0.12));
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      body.position.set(x, groundY + (place === "bench" ? 0.98 * METER * 0.45 : 0), z);
      body.rotation.y = Math.atan2(-x, -z) + yawOff;
      group.add(body);
      animals.push({ body, phase: rnd() * Math.PI * 2, name, baseYaw: body.rotation.y });
      obstacles.push({ x, z, r: name === "polar-bear" || name === "reindeer" ? 3.2 : 1.6 });
    }

    // Малиновка на плече у андроида — маленький символ союза природы и машины
    const perchHost = androids[0];
    const birdGltf = cache.bird;
    if (perchHost && birdGltf) {
      let shoulder = null;
      perchHost.inst.traverse((o) => {
        if (!shoulder && o.isBone && /shoulder|clavicle|upperarm/i.test(o.name) && /(^|[^a-z])(l|left)/i.test(o.name)) shoulder = o;
      });
      const bird = normalize(birdGltf.scene.clone(true), KINDS.bird.h);
      tuneMaterials(bird);
      if (shoulder) {
        // кость в масштабе модели: переносим птицу в её систему координат
        const holder = new THREE.Group();
        shoulder.add(holder);
        perchHost.inst.updateMatrixWorld(true);
        const s = new THREE.Vector3();
        shoulder.getWorldScale(s);
        holder.scale.setScalar(1 / Math.max(1e-6, s.x));
        holder.position.set(0, 0.06 / Math.max(1e-6, s.x) * METER, 0);
        holder.add(bird);
      } else {
        perchHost.body.add(bird);
        bird.position.set(0.22 * METER, KINDS.android.h * METER * 0.83, 0);
      }
    }
    console.info("[Residents] на площади:", walkers.length, "гуляют,", animals.length, "зверей");
  })();

  const v = new THREE.Vector3();

  function update(elapsed, dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    for (const m of mixers) m.update(dt);

    for (const w of walkers) {
      if (w.leader) {
        const ld = w.leader;
        const target = ld.angle + (w.follow / Math.max(8, ld.r)) * ld.dir * METER;
        w.angle += (target - w.angle) * Math.min(1, dt * 2.5);
        w.r += (ld.r + w.side - w.r) * Math.min(1, dt * 1.5);
        w.dir = ld.dir;
      } else {
        w.angle += (w.dir * w.speed * dt) / w.r;
        // мягко петляем между «дорожками» и обходим зверей, скамейки, фонари
        let push = Math.sin(elapsed * 0.08 + w.phase) * 0.35;
        const x = Math.cos(w.angle) * w.r;
        const z = Math.sin(w.angle) * w.r;
        for (const ob of obstacles) {
          const dx = x - ob.x;
          const dz = z - ob.z;
          const d2 = dx * dx + dz * dz;
          const lim = ob.r + 1.6;
          if (d2 < lim * lim * 4) {
            const d = Math.sqrt(d2);
            const radial = (dx * x + dz * z) / Math.max(1e-3, w.r); // наружу/внутрь от ёлки
            push += (radial >= 0 ? 1 : -1) * Math.max(0, 1 - d / (lim * 2)) * 6;
          }
        }
        w.r = Math.max(innerR, Math.min(outerR, w.r + push * dt));
      }
      v.set(Math.cos(w.angle) * w.r, groundY, Math.sin(w.angle) * w.r);
      w.body.position.copy(v);
      // лицом по ходу движения
      const yaw = Math.atan2(-Math.sin(w.angle) * w.dir, Math.cos(w.angle) * w.dir);
      const cur = w.yaw ?? yaw;
      let d = yaw - cur;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      w.yaw = cur + d * Math.min(1, dt * 4);
      w.body.rotation.y = w.yaw;
    }

    // звери «дышат»; пингвины чуть переминаются с лапы на лапу
    for (const a of animals) {
      const b = 1 + Math.sin(elapsed * 1.6 + a.phase) * 0.012;
      a.body.scale.set(1, b, 1);
      if (a.name === "penguin") a.body.rotation.z = Math.sin(elapsed * 1.3 + a.phase) * 0.05;
    }
  }

  return {
    group,
    ready,
    update,
    stats: { walkers: walkerKinds.length, animals: animalSpots.length },
    dispose() {
      disposed = true;
      mixers.forEach((m) => m.stopAllAction());
      group.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            if (!m) return;
            for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap"]) m[k]?.dispose?.();
            m.dispose?.();
          });
        }
      });
    },
  };
}
