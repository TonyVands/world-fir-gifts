// ============================================================================
// Атмосфера нового облика: время суток, пресеты погоды, HDR-освещение,
// звёзды, луна/солнце и плавные переходы между состояниями.
// ============================================================================
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

// Время суток. env.* — параметры процедурной панорамы для освещения (PMREM).
export const TIME_OF_DAY = {
  night: {
    id: "night",
    label: "Ночь",
    icon: "🌙",
    skyTop: "#040915",
    skyBottom: "#17233f",
    fogColor: "#0d1830",
    fogDensity: 0.0085,
    sunColor: "#c4d4ff",
    sunIntensity: 1.35,
    sunPos: [-40, 80, -30],
    hemiSky: "#6f86c4",
    hemiGround: "#141a2c",
    hemiIntensity: 0.35,
    envIntensity: 1.15,
    exposure: 1.05,
    garland: 1.0,
    lanterns: 1.0,
    bloom: 0.55,
    stars: 1.0,
    disc: { color: "#dfe8ff", size: 9, glow: 0.55 },
    hdr: "winter_evening",
    env: {
      zenith: [0.012, 0.028, 0.075],
      horizon: [0.1, 0.13, 0.24],
      glow: [0.45, 0.25, 0.12],
      ground: [0.16, 0.19, 0.27],
      sun: [9, 10, 12],
      windows: 1,
      gain: 1.6,
    },
  },
  evening: {
    id: "evening",
    label: "Вечер",
    icon: "🌆",
    skyTop: "#0b1838",
    skyBottom: "#5a4a72",
    fogColor: "#2a2f52",
    fogDensity: 0.0075,
    sunColor: "#ffb27a",
    sunIntensity: 0.9,
    sunPos: [70, 14, 20],
    hemiSky: "#8a8fd0",
    hemiGround: "#2a2238",
    hemiIntensity: 0.5,
    envIntensity: 1.1,
    exposure: 1.08,
    garland: 0.9,
    lanterns: 0.9,
    bloom: 0.5,
    stars: 0.35,
    disc: { color: "#ffb27a", size: 14, glow: 0.7 },
    hdr: "night_bridge",
    env: {
      zenith: [0.03, 0.05, 0.14],
      horizon: [0.35, 0.25, 0.38],
      glow: [0.9, 0.45, 0.2],
      ground: [0.25, 0.24, 0.33],
      sun: [14, 7, 3],
      windows: 1,
      gain: 1.5,
    },
  },
  morning: {
    id: "morning",
    label: "Утро",
    icon: "🌅",
    skyTop: "#5b8fd6",
    skyBottom: "#f3d4b8",
    fogColor: "#c9d6ea",
    fogDensity: 0.006,
    sunColor: "#ffd9b0",
    sunIntensity: 2.2,
    sunPos: [60, 25, 40],
    hemiSky: "#bcd3f5",
    hemiGround: "#e8eef7",
    hemiIntensity: 0.6,
    envIntensity: 0.9,
    exposure: 0.95,
    garland: 0.4,
    lanterns: 0.25,
    bloom: 0.35,
    stars: 0,
    disc: { color: "#fff0d8", size: 12, glow: 0.8 },
    hdr: "winter_lake_01",
    env: {
      zenith: [0.25, 0.42, 0.75],
      horizon: [0.95, 0.82, 0.72],
      glow: [1.0, 0.6, 0.35],
      ground: [0.85, 0.88, 0.95],
      sun: [40, 30, 22],
      windows: 0,
      gain: 1.0,
    },
  },
  day: {
    id: "day",
    label: "День",
    icon: "☀️",
    skyTop: "#4f86d9",
    skyBottom: "#cfe0f5",
    fogColor: "#d7e3f2",
    fogDensity: 0.005,
    sunColor: "#fff6e8",
    sunIntensity: 2.6,
    sunPos: [50, 90, 30],
    hemiSky: "#cfe2ff",
    hemiGround: "#f0f4fa",
    hemiIntensity: 0.8,
    envIntensity: 0.85,
    exposure: 0.9,
    garland: 0.25,
    lanterns: 0,
    bloom: 0.25,
    stars: 0,
    disc: { color: "#fffaf0", size: 8, glow: 0.9 },
    hdr: "snowy_park_01",
    env: {
      zenith: [0.22, 0.42, 0.85],
      horizon: [0.8, 0.88, 0.97],
      glow: [0.4, 0.38, 0.32],
      ground: [0.9, 0.93, 0.98],
      sun: [60, 55, 48],
      windows: 0,
      gain: 1.0,
    },
  },
};

// Погода = время суток + снег, ветер, туман. windSpeed/fallSpeed/diamondSparkle
// читает существующая система снегопада.
export const WEATHER_PRESETS = [
  { id: "clear_night", title: "Ясная ночь", icon: "✨", time: "night", temp: "-18°C", snow: 0.15, windSpeed: 0.4, fallSpeed: 0.7, diamondSparkle: 0.35, fogMul: 0.85, wind: 0.6 },
  { id: "quiet_snow", title: "Тихий снегопад", icon: "🌨", time: "evening", temp: "-6°C", snow: 0.55, windSpeed: 0.5, fallSpeed: 0.85, diamondSparkle: 0.3, fogMul: 1.2, wind: 0.8 },
  { id: "blizzard", title: "Метель", icon: "🌬", time: "night", temp: "-22°C", snow: 1.0, windSpeed: 3.2, fallSpeed: 1.9, diamondSparkle: 0.2, fogMul: 2.3, wind: 2.4 },
  { id: "frost_morning", title: "Морозное утро", icon: "❄️", time: "morning", temp: "-25°C", snow: 0.06, windSpeed: 0.2, fallSpeed: 0.5, diamondSparkle: 0.95, fogMul: 0.8, wind: 0.3 },
  { id: "sunny_day", title: "Солнечный день", icon: "☀️", time: "day", temp: "-9°C", snow: 0, windSpeed: 0.3, fallSpeed: 0.6, diamondSparkle: 0.6, fogMul: 0.7, wind: 0.5 },
  { id: "blue_hour", title: "Синий час", icon: "🌆", time: "evening", temp: "-11°C", snow: 0.2, windSpeed: 0.4, fallSpeed: 0.7, diamondSparkle: 0.4, fogMul: 1.0, wind: 0.6 },
];

// ---------------------------------------------------------------------------
// Процедурная HDR-панорама для любого времени суток
// ---------------------------------------------------------------------------
export function createSkyEnvironment(renderer, tod) {
  const e = tod.env;
  const envScene = new THREE.Scene();
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: v3(e.zenith) },
      uHorizon: { value: v3(e.horizon) },
      uGlow: { value: v3(e.glow) },
      uGround: { value: v3(e.ground) },
      uGain: { value: e.gain },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uZenith, uHorizon, uGlow, uGround;
      uniform float uGain;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.65, h));
        col += uGlow * exp(-abs(h) * 14.0) * 0.55;
        if (h < 0.0) col = mix(uHorizon * 0.9, uGround, smoothstep(0.0, -0.4, h));
        gl_FragColor = vec4(col * uGain, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), skyMat));

  const sunDir = new THREE.Vector3(...tod.sunPos).normalize();
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(e.sun[0], e.sun[1], e.sun[2]) })
  );
  sun.position.copy(sunDir.multiplyScalar(40));
  envScene.add(sun);

  if (e.windows) {
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

// ---------------------------------------------------------------------------
// Настоящие HDRI (Poly Haven, CC0): кладутся в frontend/public/hdri/ и
// перечисляются в manifest.json. Нет файла — используется процедурная панорама.
// ---------------------------------------------------------------------------
let manifestPromise = null;
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch("/hdri/manifest.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && Array.isArray(j.files) ? new Set(j.files) : new Set()))
      .catch(() => new Set());
  }
  return manifestPromise;
}

export async function loadHdrEnvironment(renderer, name) {
  if (!name) return null;
  const files = await loadManifest();
  const file = `${name}_1k.hdr`;
  if (!files.has(file)) return null;
  try {
    const tex = await new RGBELoader().loadAsync(`/hdri/${file}`);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    tex.dispose();
    return rt;
  } catch (err) {
    console.warn("[WorldFir] HDRI не загрузился, остаётся процедурное небо:", file, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Звёзды и диск луны/солнца
// ---------------------------------------------------------------------------
function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.18, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.32, "rgba(255,255,255,0.25)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSkyDecor() {
  const group = new THREE.Group();
  const count = 1400;
  const pos = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < count; i++) {
    const u = rnd();
    const v = 0.08 + rnd() * 0.92; // только верхняя полусфера
    const th = u * Math.PI * 2;
    const ph = Math.acos(v);
    pos.set([Math.sin(ph) * Math.cos(th) * 190, Math.cos(ph) * 190, Math.sin(ph) * Math.sin(th) * 190], i * 3);
    sizes[i] = 0.6 + Math.pow(rnd(), 6) * 2.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uOpacity: { value: 1 }, uTime: { value: 0 } },
    vertexShader: `
      attribute float aSize;
      uniform float uTime;
      varying float vTw;
      void main() {
        vTw = 0.65 + 0.35 * sin(uTime * 1.7 + position.x * 0.13 + position.z * 0.07);
        gl_PointSize = aSize * 1.6;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * uOpacity * vTw;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a);
      }`,
  });
  const stars = new THREE.Points(geo, starMat);
  stars.frustumCulled = false;
  group.add(stars);

  const disc = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: "#dfe8ff",
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    })
  );
  group.add(disc);
  return { group, starMat, disc };
}

// ---------------------------------------------------------------------------
// Контроллер атмосферы с плавными переходами
// ---------------------------------------------------------------------------
export function createAtmosphereController(ctx) {
  const { scene, renderer, hemiLight, dirLight, auroraUniforms, bloomPass, fir, lanterns = [], camera } = ctx;
  const decor = createSkyDecor();
  scene.add(decor.group);

  const envCache = new Map();
  const cur = {
    skyTop: new THREE.Color(), skyBottom: new THREE.Color(), fog: new THREE.Color(),
    sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), disc: new THREE.Color(),
    fogDensity: 0.0085, sunIntensity: 1, hemiIntensity: 0.35, envIntensity: 1, exposure: 1,
    garland: 1, lanterns: 1, bloom: 0.5, stars: 1, discSize: 9, discGlow: 0.5, sunPos: new THREE.Vector3(),
    aurora: 0,
  };
  let target = null;
  let weatherFogMul = 1;
  let firstApply = true;

  async function ensureEnv(tod) {
    if (envCache.has(tod.id)) return envCache.get(tod.id);
    let rt = await loadHdrEnvironment(renderer, tod.hdr);
    if (!rt) rt = createSkyEnvironment(renderer, tod);
    envCache.set(tod.id, rt);
    return rt;
  }

  function set(timeId, weather) {
    const tod = TIME_OF_DAY[timeId] || TIME_OF_DAY.night;
    weatherFogMul = weather?.fogMul ?? 1;
    target = {
      skyTop: new THREE.Color(tod.skyTop),
      skyBottom: new THREE.Color(tod.skyBottom),
      fog: new THREE.Color(tod.fogColor),
      sun: new THREE.Color(tod.sunColor),
      hemiSky: new THREE.Color(tod.hemiSky),
      hemiGround: new THREE.Color(tod.hemiGround),
      disc: new THREE.Color(tod.disc.color),
      fogDensity: tod.fogDensity * weatherFogMul,
      sunIntensity: tod.sunIntensity * (weather?.id === "blizzard" ? 0.55 : 1),
      hemiIntensity: tod.hemiIntensity,
      envIntensity: tod.envIntensity,
      exposure: tod.exposure,
      garland: tod.garland,
      lanterns: tod.lanterns,
      bloom: tod.bloom,
      stars: tod.stars * (weather?.snow > 0.7 ? 0.15 : 1),
      discSize: tod.disc.size,
      discGlow: tod.disc.glow * (weather?.snow > 0.7 ? 0.2 : 1),
      sunPos: new THREE.Vector3(...tod.sunPos),
      aurora: weather?.aurora ?? 0,
    };
    if (fir && weather) fir.uniforms.uWind.value = weather.wind ?? 1;
    ensureEnv(tod).then((rt) => {
      scene.environment = rt.texture;
    });
    if (firstApply) {
      firstApply = false;
      snap();
    }
  }

  function snap() {
    if (!target) return;
    for (const k of Object.keys(target)) {
      if (target[k]?.isColor || target[k]?.isVector3) cur[k].copy(target[k]);
      else cur[k] = target[k];
    }
    apply();
  }

  function apply() {
    auroraUniforms.uTopColor.value.copy(cur.skyTop);
    auroraUniforms.uBottomColor.value.copy(cur.skyBottom);
    auroraUniforms.uAuroraStrength.value = cur.aurora;
    scene.background.copy(cur.skyTop);
    if (scene.fog) {
      scene.fog.color.copy(cur.fog);
      scene.fog.density = cur.fogDensity;
    }
    dirLight.color.copy(cur.sun);
    dirLight.intensity = cur.sunIntensity;
    dirLight.position.copy(cur.sunPos);
    hemiLight.color.copy(cur.hemiSky);
    hemiLight.groundColor.copy(cur.hemiGround);
    hemiLight.intensity = cur.hemiIntensity;
    scene.environmentIntensity = cur.envIntensity;
    renderer.toneMappingExposure = cur.exposure;
    if (bloomPass.enabled) bloomPass.strength = cur.bloom;
    fir?.setGarlandGlow?.(cur.garland);
    lanterns.forEach((l) => l.setGlow(cur.lanterns));
    decor.starMat.uniforms.uOpacity.value = cur.stars;
    decor.disc.material.color.copy(cur.disc);
    decor.disc.material.opacity = cur.discGlow;
  }

  const lerpK = (a, b, k) => a + (b - a) * k;
  function update(dt, elapsed) {
    if (target) {
      const k = 1 - Math.exp(-dt * 2.2); // ~1.5 с на переход
      for (const key of Object.keys(target)) {
        const t = target[key];
        if (t?.isColor) cur[key].lerp(t, k);
        else if (t?.isVector3) cur[key].lerp(t, k);
        else cur[key] = lerpK(cur[key], t, k);
      }
      apply();
    }
    decor.starMat.uniforms.uTime.value = elapsed;
    // звёзды и диск «привязаны» к небу вокруг камеры
    decor.group.position.copy(camera.position);
    const dir = cur.sunPos.clone().normalize();
    decor.disc.position.copy(dir.multiplyScalar(170));
    decor.disc.scale.setScalar(cur.discSize * 2.2);
  }

  return {
    set,
    update,
    dispose() {
      envCache.forEach((rt) => rt.dispose());
      decor.group.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.map?.dispose?.();
        o.material?.dispose?.();
      });
    },
  };
}
