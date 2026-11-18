// ============================================================================
// Объёмный салют над Ёлкой: ракеты с хвостом, разные типы залпов (пион,
// хризантема со следами, золотая ива, кольцо, мерцающий «треск»), вспышки,
// которые подсвечивают хвою, и звук с задержкой «по расстоянию».
// Частицы считаются на CPU (до 6–7 тыс.), рисуются одним THREE.Points с
// аддитивным смешиванием — их подхватывает bloom, поэтому огни светятся.
// ============================================================================
import * as THREE from "three";

const PALETTE = [
  [1.0, 0.82, 0.4], // золото
  [1.0, 0.35, 0.35], // красный
  [0.35, 1.0, 0.55], // зелёный
  [0.4, 0.65, 1.0], // синий
  [1.0, 0.45, 0.9], // розовый
  [0.75, 0.55, 1.0], // фиолетовый
  [1.0, 1.0, 1.0], // белый
  [0.4, 1.0, 1.0], // бирюза
];

const KIND = { ROCKET: 0, SPARK: 1, TRAIL: 2, GLITTER: 3, FLASH: 4 };

export function createFireworks3D({ scene, camera, isMobile = false, getAudioContext = null }) {
  const MAX = isMobile ? 3600 : 7000;
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const size = new Float32Array(MAX);
  const alpha = new Float32Array(MAX);
  // симуляция
  const vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const maxLife = new Float32Array(MAX);
  const kind = new Uint8Array(MAX);
  const drag = new Float32Array(MAX);
  const grav = new Float32Array(MAX);
  const trailEvery = new Float32Array(MAX);
  const trailAcc = new Float32Array(MAX);
  const baseSize = new Float32Array(MAX);
  const shellRef = new Int32Array(MAX);
  const alive = new Uint8Array(MAX);
  // стек свободных слотов — спавн за O(1), даже когда частиц тысячи
  const freeStack = new Int32Array(MAX);
  let freeTop = MAX;
  for (let i = 0; i < MAX; i++) freeStack[i] = MAX - 1 - i;
  let cursor = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uPixel: { value: Math.min(2, window.devicePixelRatio || 1) } },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aAlpha;
      uniform float uPixel;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixel * (320.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        if (d > 1.0) discard;
        // горячее белое ядро и мягкий ореол цвета
        float core = smoothstep(0.45, 0.0, d);
        float halo = pow(1.0 - d, 2.2);
        vec3 c3 = vColor * halo * 1.6 + vec3(1.0, 0.97, 0.9) * core * 1.4;
        gl_FragColor = vec4(c3 * vAlpha, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;
  scene.add(points);

  // вспышки света: подсвечивают ель и снег цветом залпа
  const flashes = [0, 1, 2].map(() => {
    // свет всегда «в сцене» с нулевой яркостью: включение/выключение
    // источников заставило бы three.js перекомпилировать все шейдеры
    const l = new THREE.PointLight(0xffffff, 0, 420, 1.2);
    scene.add(l);
    return { light: l, t: 0, peak: 0, on: false };
  });
  const ambientFlash = new THREE.AmbientLight(0xffffff, 0);
  scene.add(ambientFlash);
  let ambientTarget = 0;

  function spawn(k, x, y, z, vx, vy, vz, l, r, g, b, s, opts = {}) {
    let i;
    if (freeTop > 0) i = freeStack[--freeTop];
    else {
      // всё занято — гасим самый «старый» слот по кругу (кроме ракет)
      i = cursor;
      cursor = (cursor + 1) % MAX;
      if (kind[i] === KIND.ROCKET && alive[i]) return -1;
    }
    alive[i] = 1;
    kind[i] = k;
    pos.set([x, y, z], i * 3);
    vel.set([vx, vy, vz], i * 3);
    col.set([r, g, b], i * 3);
    life[i] = l;
    maxLife[i] = l;
    baseSize[i] = s;
    size[i] = s;
    alpha[i] = 1;
    drag[i] = opts.drag ?? 0.985;
    grav[i] = opts.gravity ?? 9;
    trailEvery[i] = opts.trailEvery ?? 0;
    trailAcc[i] = 0;
    shellRef[i] = opts.shell ?? -1;
    return i;
  }

  // ---------------------------------------------------------- звук
  function audio() {
    const ctx = getAudioContext?.();
    return ctx && ctx.state === "running" ? ctx : null;
  }
  function noiseBurst(ctx, t, dur, freq, type, gain) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  }
  function soundLaunch() {
    const ctx = audio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(900 + Math.random() * 300, t);
    o.frequency.exponentialRampToValueAtTime(2400 + Math.random() * 600, t + 1.1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.025, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 1.25);
  }
  function soundBoom(distance, big) {
    const ctx = audio();
    if (!ctx) return;
    // звук приходит позже вспышки — как в жизни (слегка ускорено)
    const t = ctx.currentTime + Math.min(0.9, distance / 600);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(big ? 90 : 120, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    g.gain.setValueAtTime(big ? 0.55 : 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 1);
    noiseBurst(ctx, t, 0.7, 700, "lowpass", big ? 0.5 : 0.32);
  }
  function soundCrackle(distance) {
    const ctx = audio();
    if (!ctx) return;
    const t0 = ctx.currentTime + Math.min(0.9, distance / 600) + 0.5;
    for (let i = 0; i < 14; i++) noiseBurst(ctx, t0 + Math.random() * 0.9, 0.03, 4000, "highpass", 0.18);
  }

  // ---------------------------------------------------------- залпы
  const shells = []; // {r,g,b, kind, crackle}
  const tmpV = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function pickColor() {
    return PALETTE[(Math.random() * PALETTE.length) | 0];
  }

  /** Точка взрыва в поле зрения камеры: впереди, выше центра кадра. */
  function burstPointInView() {
    camera.getWorldDirection(fwd);
    fwd.y *= 0.3;
    fwd.normalize();
    right.crossVectors(fwd, up).normalize();
    const D = 150 + Math.random() * 90;
    const side = (Math.random() * 2 - 1) * D * 0.42;
    const p = camera.position.clone().addScaledVector(fwd, D).addScaledVector(right, side);
    // высота: заметно выше камеры, чтобы залпы шли «в небе» над Ёлкой
    const camTanHalf = Math.tan(THREE.MathUtils.degToRad((camera.fov || 50) / 2));
    p.y = camera.position.y + D * camTanHalf * (0.15 + Math.random() * 0.55);
    return { p, D };
  }

  function launchRocket() {
    const { p, D } = burstPointInView();
    const groundY = -4;
    const h = Math.max(30, p.y - groundY);
    const t = 1.5 + Math.random() * 0.5; // время подъёма
    const vy = (h + 0.5 * 9 * t * t) / t;
    const i = spawn(KIND.ROCKET, p.x + (Math.random() - 0.5) * 6, groundY, p.z + (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 2, vy, (Math.random() - 0.5) * 2, t, 1, 0.85, 0.6, 1.6,
      { drag: 1, gravity: 9, trailEvery: 0.016 });
    if (i < 0) return;
    const c = pickColor();
    const types = ["peony", "chrys", "willow", "ring", "peony", "chrys", "crackle"];
    shells[i] = { c, c2: Math.random() < 0.35 ? pickColor() : c, type: types[(Math.random() * types.length) | 0], D };
    soundLaunch();
  }

  function explode(i) {
    const sh = shells[i] || { c: pickColor(), c2: pickColor(), type: "peony", D: 180 };
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const big = sh.type === "willow" || Math.random() < 0.3;
    const n = (isMobile ? 0.55 : 1) * (sh.type === "willow" ? 150 : sh.type === "ring" ? 110 : 190);
    const speed = big ? 48 : 38;
    // ориентация кольца — случайная плоскость
    const ringN = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
    const ringA = new THREE.Vector3().crossVectors(ringN, up).normalize();
    const ringB = new THREE.Vector3().crossVectors(ringN, ringA).normalize();
    for (let k = 0; k < n; k++) {
      let dx, dy, dz;
      if (sh.type === "ring") {
        const a = (k / n) * Math.PI * 2;
        tmpV.copy(ringA).multiplyScalar(Math.cos(a)).addScaledVector(ringB, Math.sin(a));
        dx = tmpV.x; dy = tmpV.y; dz = tmpV.z;
      } else {
        // равномерно по сфере (спираль Фибоначчи) + немного шума
        const yy = 1 - (2 * (k + 0.5)) / n;
        const r = Math.sqrt(1 - yy * yy);
        const phi = k * 2.399963;
        dx = Math.cos(phi) * r; dy = yy; dz = Math.sin(phi) * r;
      }
      const sp = speed * (0.85 + Math.random() * 0.3);
      const c = k % 3 === 0 ? sh.c2 : sh.c;
      if (sh.type === "willow") {
        spawn(KIND.SPARK, x, y, z, dx * sp * 0.75, dy * sp * 0.75, dz * sp * 0.75, 3.2 + Math.random(), 1.0, 0.72, 0.32, 2.3,
          { drag: 0.955, gravity: 5, trailEvery: 0.05 });
      } else {
        spawn(KIND.SPARK, x, y, z, dx * sp, dy * sp, dz * sp, 1.5 + Math.random() * 0.7, c[0], c[1], c[2], 3.2,
          { drag: 0.972, gravity: 7, trailEvery: sh.type === "chrys" ? 0.03 : 0, shell: sh.type === "crackle" ? 1 : -1 });
      }
    }
    // центральная вспышка
    spawn(KIND.FLASH, x, y, z, 0, 0, 0, 0.25, sh.c[0], sh.c[1], sh.c[2], 26, { drag: 1, gravity: 0 });
    // свет
    const f = flashes.reduce((a, b) => (a.light.intensity <= b.light.intensity ? a : b));
    f.light.position.set(x, y, z);
    f.light.color.setRGB(sh.c[0], sh.c[1], sh.c[2]);
    f.peak = big ? 700 : 450;
    f.t = 0;
    f.on = true;
    ambientTarget = Math.min(0.22, ambientTarget + (big ? 0.1 : 0.06));
    ambientFlash.color.setRGB(sh.c[0], sh.c[1], sh.c[2]);
    soundBoom(sh.D, big);
    if (sh.type === "crackle") soundCrackle(sh.D);
    shells[i] = undefined;
  }

  // ---------------------------------------------------------- цикл
  let running = false;
  let intensity = 1;
  let launchAcc = 0;
  let endAt = 0;
  let clock = 0;

  function update(dtRaw) {
    const dt = Math.min(0.05, dtRaw || 0.016);
    clock += dt;
    if (running) {
      launchAcc += dt;
      const every = 0.55 / intensity;
      while (launchAcc > every) {
        launchAcc -= every * (0.6 + Math.random() * 0.8);
        launchRocket();
        if (Math.random() < 0.25 * intensity) launchRocket();
      }
      if (endAt && clock > endAt) running = false;
    }
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (!alive[i]) continue;
      any = true;
      life[i] -= dt;
      const i3 = i * 3;
      if (life[i] <= 0) {
        if (kind[i] === KIND.ROCKET) explode(i);
        else if (shellRef[i] === 1 && Math.random() < 0.6) {
          // «треск»: вспыхивающие белые искорки на месте погасшей
          spawn(KIND.GLITTER, pos[i3], pos[i3 + 1], pos[i3 + 2], 0, 0, 0, 0.12, 1, 1, 0.95, 3.2, { drag: 1, gravity: 0 });
        }
        alive[i] = 0;
        alpha[i] = 0;
        size[i] = 0;
        freeStack[freeTop++] = i;
        continue;
      }
      const d = Math.pow(drag[i], dt * 60);
      vel[i3] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d - grav[i] * dt;
      vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = life[i] / maxLife[i];
      if (kind[i] === KIND.SPARK) {
        alpha[i] = Math.min(1, t * 2.2) * (0.75 + Math.random() * 0.25); // мерцание
        size[i] = baseSize[i] * (0.6 + 0.4 * t);
      } else if (kind[i] === KIND.TRAIL) {
        alpha[i] = t * 0.55;
        size[i] = baseSize[i] * t;
      } else if (kind[i] === KIND.FLASH || kind[i] === KIND.GLITTER) {
        alpha[i] = t;
        size[i] = baseSize[i] * (0.5 + t);
      } else {
        alpha[i] = 1;
      }
      if (trailEvery[i] > 0) {
        trailAcc[i] += dt;
        while (trailAcc[i] > trailEvery[i]) {
          trailAcc[i] -= trailEvery[i];
          const r = kind[i] === KIND.ROCKET;
          spawn(KIND.TRAIL, pos[i3], pos[i3 + 1], pos[i3 + 2],
            (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5 - (r ? 2 : 0), (Math.random() - 0.5) * 1.5,
            r ? 0.5 : 0.7, col[i3] * 0.9, col[i3 + 1] * 0.75, col[i3 + 2] * 0.6, r ? 1.3 : 1.5,
            { drag: 0.94, gravity: 2 });
        }
      }
    }
    // свет вспышек
    flashes.forEach((f) => {
      if (!f.on) return;
      f.t += dt;
      f.light.intensity = f.peak * Math.exp(-f.t * 5.5);
      if (f.light.intensity < 5) {
        f.light.intensity = 0;
        f.on = false;
      }
    });
    ambientTarget *= Math.exp(-dt * 4);
    ambientFlash.intensity = ambientTarget;
    if (any || running) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    }
    points.visible = any || running;
  }

  return {
    /** Запустить салют на seconds секунд (0 — пока не вызовут stop). */
    start(seconds = 20, level = 1) {
      running = true;
      intensity = level;
      launchAcc = 0.5;
      endAt = seconds ? clock + seconds : 0;
    },
    stop() {
      running = false;
    },
    get active() {
      return running;
    },
    update,
    dispose() {
      scene.remove(points);
      geo.dispose();
      mat.dispose();
      flashes.forEach((f) => scene.remove(f.light));
      scene.remove(ambientFlash);
    },
  };
}
