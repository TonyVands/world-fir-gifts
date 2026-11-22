// «Ярус памяти» на Ёлке: на нижнем ярусе висят стеклянные шары памяти.
// Внутри каждого — объёмный портрет из кубиков, а вокруг него кружит свет
// «жизненной энергии» человека (цвет выбирают близкие). Чем больше свечей
// памяти зажгли, тем ярче и гуще этот свет.
//
// Производительность: все кубики всех портретов — один InstancedMesh, всё стекло —
// второй, все огоньки энергии — одни Points с анимацией в шейдере.
import * as THREE from "three";
import { decodePortrait, EMPTY } from "../lib/portrait.js";
import { energyById } from "../lib/memorialMelodies.js";

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
export const BALL_R = 1.75;

// Клетки портрета для Ёлки: уменьшаем до ≤ 32 по ширине (подробный — в карточке)
function portraitCells(p, maxW = 32) {
  const d = decodePortrait(p);
  if (!d) return null;
  const f = Math.max(1, Math.ceil(d.w / maxW));
  const w = Math.floor(d.w / f);
  const h = Math.floor(d.h / f);
  const cells = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let dz = 0;
      let n = 0;
      for (let yy = 0; yy < f; yy++)
        for (let xx = 0; xx < f; xx++) {
          const i = (y * f + yy) * d.w + x * f + xx;
          const v = d.px[i];
          if (v === EMPTY || !d.pal[v]) continue;
          const c = d.pal[v];
          r += c[0];
          g += c[1];
          b += c[2];
          dz += d.depth[i];
          n++;
        }
      if (n * 2 < f * f) continue; // больше половины пусто — клетка пустая
      cells.push({ x, y, r: r / n, g: g / n, b: b / n, depth: dz / n });
    }
  return { w, h, cells };
}

const glassVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vCol;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 wp = m * vec4(position, 1.0);
    vN = normalize(mat3(m) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    #ifdef USE_INSTANCING_COLOR
      vCol = instanceColor;
    #else
      vCol = vec3(0.8, 0.9, 1.0);
    #endif
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const glassFrag = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vCol;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    float f = 1.0 - abs(dot(n, v));
    float rim = pow(f, 2.6);
    vec3 L = normalize(vec3(-0.5, 0.8, 0.4));
    float spec = pow(max(dot(reflect(-L, n), v), 0.0), 40.0);
    // отражение энергии на стекле + холодный блик
    vec3 col = vCol * (0.5 + rim * 2.2) + vec3(1.0) * spec;
    float a = clamp(0.07 + rim * 0.6 + spec * 0.7, 0.0, 0.85);
    gl_FragColor = vec4(col, a);
  }
`;

const motesVert = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  attribute vec3 aCenter;
  attribute vec4 aOrbit;  // радиус, скорость, фаза, наклон
  attribute vec4 aColor;  // rgb + сила (от числа свечей)
  varying vec4 vColor;
  void main() {
    float a = uTime * aOrbit.y + aOrbit.z;
    float r = aOrbit.x;
    vec3 p = vec3(cos(a) * r, sin(a * 0.7 + aOrbit.w * 3.0) * r * 0.75, sin(a) * r);
    float t = aOrbit.w;
    p = vec3(p.x, p.y * cos(t) - p.z * sin(t), p.y * sin(t) + p.z * cos(t));
    vec4 mv = modelViewMatrix * vec4(aCenter + p, 1.0);
    float tw = 0.65 + 0.35 * sin(uTime * 2.3 + aOrbit.z * 5.0);
    vColor = vec4(aColor.rgb, aColor.a * tw);
    gl_PointSize = aColor.a > 0.0 ? uScale * (0.7 + aColor.a) * 70.0 / -mv.z : 0.0;
    gl_Position = projectionMatrix * mv;
  }
`;
const motesFrag = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float k = smoothstep(0.5, 0.0, length(d));
    gl_FragColor = vec4(vColor.rgb * (1.2 + k), vColor.a * k);
  }
`;

// псевдослучайное число по двум целым — одинаково при каждой перезагрузке
const hash = (a, b) => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

/**
 * @param {object} o
 * @param {(worldY:number)=>number} o.radiusAt — радиус кончиков лап на высоте
 */
export function createMemoryTier({ radiusAt, bottomY = 3.0, topY = 7.4, isMobile = false }) {
  const group = new THREE.Group();
  group.name = "memoryTier";
  const max = isMobile ? 24 : 48;
  const motesPerBall = isMobile ? 26 : 42;
  const maxCells = max * 32 * 40;

  const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  const cubeMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, emissive: "#ffffff", emissiveIntensity: 0.1 });
  const cubes = new THREE.InstancedMesh(cubeGeo, cubeMat, maxCells);
  cubes.count = 0;
  cubes.frustumCulled = false;

  const glassGeo = new THREE.SphereGeometry(BALL_R, 32, 20);
  const glassMat = new THREE.ShaderMaterial({
    vertexShader: glassVert,
    fragmentShader: glassFrag,
    transparent: true,
    depthWrite: false,
  });
  const glass = new THREE.InstancedMesh(glassGeo, glassMat, max);
  glass.count = 0;
  glass.frustumCulled = false;
  glass.renderOrder = 3;

  const capGeo = new THREE.CylinderGeometry(0.32, 0.4, 0.42, 12);
  const capMat = new THREE.MeshStandardMaterial({ color: "#d9b56a", metalness: 0.8, roughness: 0.3 });
  const caps = new THREE.InstancedMesh(capGeo, capMat, max);
  caps.count = 0;
  caps.frustumCulled = false;
  const loopGeo = new THREE.TorusGeometry(0.17, 0.045, 6, 14);
  const loops = new THREE.InstancedMesh(loopGeo, capMat, max);
  loops.count = 0;
  loops.frustumCulled = false;

  const threadGeo = new THREE.BufferGeometry();
  const threadMat = new THREE.LineBasicMaterial({ color: "#e8d6a8", transparent: true, opacity: 0.55 });
  const threads = new THREE.LineSegments(threadGeo, threadMat);
  threads.frustumCulled = false;

  const motesGeo = new THREE.BufferGeometry();
  const motesMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: motesVert,
    fragmentShader: motesFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const motes = new THREE.Points(motesGeo, motesMat);
  motes.frustumCulled = false;
  motes.renderOrder = 4;

  group.add(cubes, caps, loops, threads, motes, glass);

  let slots = [];
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();

  function setMemorials(list) {
    const items = (list || []).filter((m) => m && m.portrait).slice(0, max);
    slots = items.map((m, i) => {
      const angle = (i * GOLDEN * 3.1 + 0.4) % (Math.PI * 2);
      const row = i % 2;
      const y = bottomY + row * ((topY - bottomY) * 0.6) + ((i * 0.37) % 1) * 0.5;
      const r = radiusAt(y + BALL_R) + BALL_R + 0.6;
      return {
        id: m.id,
        angle,
        x: Math.cos(angle) * r,
        y,
        z: Math.sin(angle) * r,
        rot: Math.atan2(Math.cos(angle), Math.sin(angle)),
        energy: energyById(m.energy),
        k: Math.min(1, 0.35 + Math.sqrt(m.candles || 0) * 0.12),
        portrait: m.portrait,
      };
    });

    let n = 0;
    const threadPos = [];
    slots.forEach((s, i) => {
      const pc = portraitCells(s.portrait);
      const fwdX = Math.sin(s.rot);
      const fwdZ = Math.cos(s.rot);
      const rightX = Math.cos(s.rot);
      const rightZ = -Math.sin(s.rot);
      if (pc) {
        const cell = (BALL_R * 1.3) / pc.h; // портрет занимает ~2/3 диаметра
        for (const c of pc.cells) {
          if (n >= maxCells) break;
          const dz = 1 + c.depth * 0.3;
          const lx = (c.x - (pc.w - 1) / 2) * cell;
          const ly = ((pc.h - 1) / 2 - c.y) * cell - cell;
          const lz = (dz * cell) / 2 - cell * 2.5;
          tmp.position.set(s.x + rightX * lx + fwdX * lz, s.y + ly, s.z + rightZ * lx + fwdZ * lz);
          tmp.rotation.set(0, s.rot, 0);
          tmp.scale.set(cell, cell, dz * cell);
          tmp.updateMatrix();
          cubes.setMatrixAt(n, tmp.matrix);
          col.setRGB(c.r / 255, c.g / 255, c.b / 255, THREE.SRGBColorSpace);
          cubes.setColorAt(n, col);
          n++;
        }
      }
      tmp.position.set(s.x, s.y, s.z);
      tmp.rotation.set(0, s.rot, 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      glass.setMatrixAt(i, tmp.matrix);
      glass.setColorAt(i, col.set(s.energy.color));
      tmp.position.set(s.x, s.y + BALL_R + 0.12, s.z);
      tmp.updateMatrix();
      caps.setMatrixAt(i, tmp.matrix);
      tmp.position.set(s.x, s.y + BALL_R + 0.45, s.z);
      tmp.updateMatrix();
      loops.setMatrixAt(i, tmp.matrix);
      threadPos.push(s.x, s.y + BALL_R + 0.55, s.z, s.x * 0.9, s.y + BALL_R + 2.2, s.z * 0.9);
    });
    cubes.count = n;
    glass.count = caps.count = loops.count = slots.length;
    cubes.instanceMatrix.needsUpdate = true;
    if (cubes.instanceColor) cubes.instanceColor.needsUpdate = true;
    glass.instanceMatrix.needsUpdate = true;
    if (glass.instanceColor) glass.instanceColor.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    loops.instanceMatrix.needsUpdate = true;
    threadGeo.setAttribute("position", new THREE.Float32BufferAttribute(threadPos, 3));

    const total = slots.length * motesPerBall;
    const center = new Float32Array(Math.max(1, total) * 3);
    const orbit = new Float32Array(Math.max(1, total) * 4);
    const color = new Float32Array(Math.max(1, total) * 4);
    let k = 0;
    slots.forEach((s, i) => {
      col.set(s.energy.color);
      const lit = Math.round(motesPerBall * (0.5 + 0.5 * s.k));
      for (let j = 0; j < motesPerBall; j++, k++) {
        const rnd = hash(i, j);
        center.set([s.x, s.y + 0.1, s.z], k * 3);
        orbit.set([BALL_R * (0.5 + rnd * 0.38), (0.25 + rnd * 0.5) * (j % 2 ? 1 : -1), j * 2.399, rnd * Math.PI], k * 4);
        color.set([col.r, col.g, col.b, j < lit ? 0.35 + 0.55 * s.k : 0], k * 4);
      }
    });
    motesGeo.setAttribute("position", new THREE.BufferAttribute(center, 3));
    motesGeo.setAttribute("aCenter", new THREE.BufferAttribute(center, 3));
    motesGeo.setAttribute("aOrbit", new THREE.BufferAttribute(orbit, 4));
    motesGeo.setAttribute("aColor", new THREE.BufferAttribute(color, 4));
    motesGeo.setDrawRange(0, total);
  }

  function update(t) {
    motesMat.uniforms.uTime.value = t;
  }

  function setPointScale(s) {
    motesMat.uniforms.uScale.value = s;
  }

  // Попадание луча в шар: id памяти или null
  const _sphere = new THREE.Sphere();
  const _hit = new THREE.Vector3();
  function pick(raycaster) {
    let best = null;
    let bestD = Infinity;
    for (const s of slots) {
      _sphere.center.set(s.x, s.y, s.z);
      _sphere.radius = BALL_R * 1.1;
      if (raycaster.ray.intersectSphere(_sphere, _hit)) {
        const d = _hit.distanceTo(raycaster.ray.origin);
        if (d < bestD) {
          bestD = d;
          best = s.id;
        }
      }
    }
    return best;
  }

  function slotOf(id) {
    return slots.find((s) => s.id === id) || null;
  }

  function dispose() {
    [cubeGeo, glassGeo, capGeo, loopGeo, threadGeo, motesGeo].forEach((g) => g.dispose());
    [cubeMat, glassMat, capMat, threadMat, motesMat].forEach((m) => m.dispose());
  }

  return { group, setMemorials, update, pick, slotOf, setPointScale, dispose };
}
