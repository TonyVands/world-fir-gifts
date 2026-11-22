// «Ярус памяти» на Ёлке: на нижнем ярусе — пиксельные ангелы, каждый держит
// портрет человека в золотой рамке. Тихий голубой свет, ангелы чуть покачиваются.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { portraitToCanvas } from "../lib/portrait.js";

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const V = 0.14; // кубик ангела (чуть крупнее вокселя жителей — видно издалека)

// Ангел из кубиков: [w, h, d, x, y, z, цвет] в «кубиках» (позиция — центр)
function angelGeometry() {
  const ROBE = "#eef3ff";
  const ROBE_S = "#c9d6f2";
  const SKIN = "#f2cfb0";
  const HAIR = "#e8c46a";
  const WING = "#ffffff";
  const WING_S = "#d8e4fb";
  const boxes = [
    // подол и платье расширяются книзу
    [9, 3, 5, 0, 1.5, 0, ROBE_S],
    [8, 4, 4.5, 0, 5, 0, ROBE],
    [7, 4, 4, 0, 9, 0, ROBE],
    [6, 3, 3.6, 0, 12.5, 0, ROBE],
    [1, 10, 0.4, -1.5, 7, 2.3, ROBE_S], // складки
    [1, 10, 0.4, 1.5, 7, 2.3, ROBE_S],
    // рукава к рамке
    [2, 5, 2, -3.6, 11, 1.2, ROBE],
    [2, 5, 2, 3.6, 11, 1.2, ROBE],
    [1.4, 1.4, 1.4, -3.3, 7.4, 2.4, SKIN],
    [1.4, 1.4, 1.4, 3.3, 7.4, 2.4, SKIN],
    // голова и волосы
    [4, 4, 4, 0, 16, 0, SKIN],
    [4.6, 1.6, 4.6, 0, 18.3, -0.2, HAIR],
    [4.6, 3.4, 1.2, 0, 16.4, -2.2, HAIR],
    [1, 2.6, 4, -2.3, 16.6, -0.3, HAIR],
    [1, 2.6, 4, 2.3, 16.6, -0.3, HAIR],
    [0.6, 0.6, 0.3, -0.9, 16.2, 2.05, "#5a6b8c"],
    [0.6, 0.6, 0.3, 0.9, 16.2, 2.05, "#5a6b8c"],
    // крылья ступеньками
    [4, 8, 1, -4.5, 12.5, -2.6, WING],
    [3, 7, 1, -7.5, 13.5, -2.9, WING_S],
    [2, 5, 1, -9.8, 14.8, -3.1, WING],
    [4, 8, 1, 4.5, 12.5, -2.6, WING],
    [3, 7, 1, 7.5, 13.5, -2.9, WING_S],
    [2, 5, 1, 9.8, 14.8, -3.1, WING],
  ];
  const c = new THREE.Color();
  const geos = boxes.map(([w, h, d, x, y, z, col]) => {
    const g = new THREE.BoxGeometry(w * V, h * V, d * V).toNonIndexed();
    g.translate(x * V, y * V, z * V);
    c.set(col);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const nrm = g.attributes.normal.array;
    for (let i = 0; i < n; i++) {
      const ny = nrm[i * 3 + 1];
      const k = ny > 0.5 ? 1.08 : ny < -0.5 ? 0.7 : nrm[i * 3] !== 0 ? 0.88 : 1;
      arr[i * 3] = c.r * k;
      arr[i * 3 + 1] = c.g * k;
      arr[i * 3 + 2] = c.b * k;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  });
  const geo = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return geo;
}

function haloGeometry() {
  // нимб — кольцо из 12 кубиков
  const parts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    parts.push(new THREE.BoxGeometry(V * 1.1, V * 0.6, V * 1.1).translate(Math.cos(a) * V * 2.6, V * 19.9, Math.sin(a) * V * 2.6 - V * 0.3));
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(200,225,255,0.9)");
  gr.addColorStop(0.35, "rgba(150,190,255,0.35)");
  gr.addColorStop(1, "rgba(120,160,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {object} o
 * @param {(worldY:number)=>number} o.radiusAt — радиус кончиков лап на высоте
 * @param {number} o.bottomY, o.topY — полоса яруса (мировые Y)
 */
export function createMemoryTier({ radiusAt, bottomY = 2.6, topY = 7.6, isMobile = false }) {
  const group = new THREE.Group();
  group.name = "memoryTier";
  const max = isMobile ? 24 : 48;

  const angelGeo = angelGeometry();
  const angelMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
    emissive: new THREE.Color("#5f7fc0"),
    emissiveIntensity: 0.22,
  });
  const angels = new THREE.InstancedMesh(angelGeo, angelMat, max);
  angels.count = 0;
  angels.frustumCulled = false;
  const haloGeo = haloGeometry();
  const haloMat = new THREE.MeshStandardMaterial({ color: "#ffe39a", emissive: "#ffcf5a", emissiveIntensity: 2.2, flatShading: true });
  const halos = new THREE.InstancedMesh(haloGeo, haloMat, max);
  halos.count = 0;
  halos.frustumCulled = false;
  group.add(angels, halos);

  // рамки портретов: золото + тёмная подложка; сам портрет — отдельная текстура
  const frameGeo = mergeGeometries(
    [
      new THREE.BoxGeometry(V * 12, V * 14, V * 0.8),
    ],
    false
  );
  const frameMat = new THREE.MeshStandardMaterial({ color: "#c9a860", metalness: 0.55, roughness: 0.4, flatShading: true });
  const frames = new THREE.InstancedMesh(frameGeo, frameMat, max);
  frames.count = 0;
  frames.frustumCulled = false;
  group.add(frames);
  const plaqueGeo = new THREE.PlaneGeometry(V * 10, V * 12);
  const plaques = [];

  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 });
  const glows = [];

  let slots = []; // { id, x, y, z, angle, rot, phase, k }
  const tmp = new THREE.Object3D();

  function clearPlaques() {
    plaques.forEach((p) => {
      p.material.map?.dispose();
      p.material.dispose();
      group.remove(p);
    });
    plaques.length = 0;
    glows.forEach((s) => group.remove(s));
    glows.length = 0;
  }

  function setMemorials(list) {
    clearPlaques();
    const items = (list || []).filter((m) => m && m.portrait).slice(0, max);
    slots = items.map((m, i) => {
      const angle = (i * GOLDEN * 3.1 + 0.4) % (Math.PI * 2);
      const row = i % 2;
      const y = bottomY + row * ((topY - bottomY) * 0.55) + ((i * 0.37) % 1) * 0.6;
      const r = radiusAt(y) + 2.2;
      return {
        id: m.id,
        angle,
        x: Math.cos(angle) * r,
        y,
        z: Math.sin(angle) * r,
        rot: Math.atan2(Math.cos(angle), Math.sin(angle)),
        phase: i * 1.7,
        k: Math.min(1, 0.45 + (m.candles || 0) * 0.04),
      };
    });
    angels.count = halos.count = frames.count = slots.length;
    items.forEach((m, i) => {
      const tex = new THREE.CanvasTexture(portraitToCanvas(m.portrait, { scale: 2, bg: "#141b33" }));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: new THREE.Color("#ffffff"), emissiveMap: tex, emissiveIntensity: 0.35 });
      const p = new THREE.Mesh(plaqueGeo, mat);
      p.userData.memorialId = m.id;
      plaques.push(p);
      group.add(p);
      const s = new THREE.Sprite(glowMat);
      s.scale.setScalar(4.2);
      glows.push(s);
      group.add(s);
    });
    update(0);
  }

  function update(t) {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const bob = Math.sin(t * 0.9 + s.phase) * 0.12;
      const sway = Math.sin(t * 0.55 + s.phase) * 0.06;
      tmp.position.set(s.x, s.y + bob, s.z);
      tmp.rotation.set(0, s.rot, sway);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      angels.setMatrixAt(i, tmp.matrix);
      halos.setMatrixAt(i, tmp.matrix);
      // рамка с портретом — в руках, перед грудью
      const fwd = new THREE.Vector3(Math.sin(s.rot), 0, Math.cos(s.rot));
      const fx = s.x + fwd.x * V * 3.4;
      const fz = s.z + fwd.z * V * 3.4;
      const fy = s.y + bob + V * 7.2;
      tmp.position.set(fx, fy, fz);
      tmp.updateMatrix();
      frames.setMatrixAt(i, tmp.matrix);
      const p = plaques[i];
      if (p) {
        p.position.set(fx + fwd.x * V * 0.45, fy, fz + fwd.z * V * 0.45);
        p.rotation.set(0, s.rot, sway);
      }
      const g = glows[i];
      if (g) {
        g.position.set(s.x - fwd.x * 0.4, s.y + bob + 1.2, s.z - fwd.z * 0.4);
        g.material.opacity = 0.35 + 0.2 * s.k + Math.sin(t * 1.3 + s.phase) * 0.06;
      }
    }
    angels.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    frames.instanceMatrix.needsUpdate = true;
  }

  // Попадание луча: id памяти или null
  function pick(raycaster) {
    if (!slots.length) return null;
    const hits = raycaster.intersectObjects([...plaques, angels, frames], false);
    if (!hits.length) return null;
    const h = hits[0];
    if (h.object.userData.memorialId) return h.object.userData.memorialId;
    if (h.instanceId !== undefined && slots[h.instanceId]) return slots[h.instanceId].id;
    return null;
  }

  function slotOf(id) {
    return slots.find((s) => s.id === id) || null;
  }

  function dispose() {
    clearPlaques();
    angelGeo.dispose();
    haloGeo.dispose();
    frameGeo.dispose();
    plaqueGeo.dispose();
    angelMat.dispose();
    haloMat.dispose();
    frameMat.dispose();
    glowMat.map?.dispose();
    glowMat.dispose();
  }

  return { group, setMemorials, update, pick, slotOf, dispose };
}
