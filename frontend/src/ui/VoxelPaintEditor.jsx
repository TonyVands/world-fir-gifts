import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// Редактор фигурки прямо внутри шара: нажатие на пол или на грань кубика
// ставит новый кубик рядом, «Красить» перекрашивает, «Убирать» удаляет.
// Перетаскивание поворачивает шар. Сетка 8×8×8, как у сохранённых шаров.

const N = 8;
const V = 0.5; // размер кубика (как в просмотрщике шаров)
const FLOOR_Y = -2.05 - V / 2;

const key = (v) => `${v.x},${v.y},${v.z}`;
const inside = (v) => v.x >= 0 && v.x < N && v.y >= 0 && v.y < N && v.z >= 0 && v.z < N;

export default function VoxelPaintEditor({ voxels, setVoxels, palette, color, setColor, baseColor = "#5c2409", maxVoxels = 512 }) {
  const mountRef = useRef(null);
  const [tool, setTool] = useState("add");
  const [canUndo, setCanUndo] = useState(false);
  const stateRef = useRef({});
  const historyRef = useRef([]);
  const apiRef = useRef(null);

  const commit = (next) => {
    historyRef.current.push(stateRef.current.voxels);
    if (historyRef.current.length > 60) historyRef.current.shift();
    setCanUndo(true);
    setVoxels(next);
  };
  const undo = () => {
    const prev = historyRef.current.pop();
    if (prev) setVoxels(prev);
    setCanUndo(historyRef.current.length > 0);
  };

  stateRef.current = { voxels, tool, color, commit, maxVoxels };

  // сцена создаётся один раз
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;
    const size = Math.min(el.clientWidth || 320, 380);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    camera.position.set(0, 2.6, 11.2);
    camera.lookAt(0, -0.6, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(size, size);
    el.innerHTML = "";
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.margin = "0 auto";

    scene.add(new THREE.AmbientLight("#ffffff", 1.4));
    const dl = new THREE.DirectionalLight("#fff7d6", 2.3);
    dl.position.set(6, 12, 9);
    scene.add(dl);
    const dl2 = new THREE.DirectionalLight("#bfdbfe", 0.8);
    dl2.position.set(-8, 4, -6);
    scene.add(dl2);

    const root = new THREE.Group();
    scene.add(root);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.65, 1.25, 32),
      new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, metalness: 0.35 })
    );
    base.position.y = -3.0;
    root.add(base);

    // пол-сетка 8×8: сюда ставятся первые кубики
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(N * V, N * V),
      new THREE.MeshBasicMaterial({ color: "#0b1530", transparent: true, opacity: 0.55 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    root.add(floor);
    const grid = new THREE.GridHelper(N * V, N, "#64748b", "#334155");
    grid.position.y = FLOOR_Y + 0.003;
    root.add(grid);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(3.45, 32, 24),
      new THREE.MeshPhongMaterial({ color: "#e0f2fe", transparent: true, opacity: 0.1, shininess: 120, depthWrite: false, side: THREE.BackSide })
    );
    dome.position.y = 0.4;
    root.add(dome);

    const blocks = new THREE.Group();
    root.add(blocks);
    const geo = new THREE.BoxGeometry(V * 0.96, V * 0.96, V * 0.96);
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const mats = new Map();
    const mat = (c) => {
      if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.12 }));
      return mats.get(c);
    };
    const edgeMat = new THREE.LineBasicMaterial({ color: "#000000", transparent: true, opacity: 0.25 });

    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(V * 1.01, V * 1.01, V * 1.01),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false })
    );
    ghost.visible = false;
    root.add(ghost);
    const ghostEdges = new THREE.LineSegments(new THREE.EdgesGeometry(ghost.geometry), new THREE.LineBasicMaterial({ color: "#ffffff" }));
    ghost.add(ghostEdges);

    const toWorld = (v) => new THREE.Vector3((v.x - 3.5) * V, -2.05 + v.y * V, (v.z - 3.5) * V);

    const rebuild = (list) => {
      while (blocks.children.length) blocks.remove(blocks.children[0]);
      list.forEach((v) => {
        const m = new THREE.Mesh(geo, mat(v.color || "#fbbf24"));
        m.position.copy(toWorld(v));
        m.userData.v = v;
        const e = new THREE.LineSegments(edgeGeo, edgeMat);
        m.add(e);
        blocks.add(m);
      });
    };

    // куда попадёт действие под указателем
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const target = (cx, cy) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects([...blocks.children, floor], false);
      const h = hits[0];
      if (!h) return null;
      const { tool: t } = stateRef.current;
      if (h.object !== floor) {
        const v = h.object.userData.v;
        if (t === "add") {
          const n = h.face.normal;
          const nv = { x: v.x + Math.round(n.x), y: v.y + Math.round(n.y), z: v.z + Math.round(n.z) };
          return inside(nv) ? { kind: "add", v: nv } : null;
        }
        return { kind: t, v };
      }
      if (t !== "add") return null;
      const p = root.worldToLocal(h.point.clone());
      const nv = { x: Math.round(p.x / V + 3.5), y: 0, z: Math.round(p.z / V + 3.5) };
      return inside(nv) ? { kind: "add", v: nv } : null;
    };

    const apply = (tg) => {
      if (!tg) return;
      const { voxels: cur, color: c, commit: cm, maxVoxels: mx } = stateRef.current;
      const k = key(tg.v);
      if (tg.kind === "add") {
        if (cur.some((b) => key(b) === k) || cur.length >= mx) return;
        cm([...cur, { ...tg.v, color: c }]);
      } else if (tg.kind === "paint") {
        if (cur.find((b) => key(b) === k)?.color === c) return;
        cm(cur.map((b) => (key(b) === k ? { ...b, color: c } : b)));
      } else if (tg.kind === "erase") {
        cm(cur.filter((b) => key(b) !== k));
      }
    };

    const showGhost = (tg) => {
      if (!tg) {
        ghost.visible = false;
        return;
      }
      ghost.visible = true;
      ghost.position.copy(toWorld(tg.v));
      const c = tg.kind === "erase" ? "#f43f5e" : stateRef.current.color;
      ghost.material.color.set(c);
      ghost.material.opacity = tg.kind === "add" ? 0.45 : 0.3;
      ghost.scale.setScalar(tg.kind === "add" ? 1 : 1.08);
    };

    // вращение перетаскиванием; короткое касание — действие
    let rotY = 0.6;
    let rotX = 0.28;
    let down = null;
    const onDown = (e) => {
      renderer.domElement.setPointerCapture?.(e.pointerId);
      down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    };
    const onMove = (e) => {
      if (down) {
        const dx = e.clientX - down.lx;
        const dy = e.clientY - down.ly;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) down.moved = true;
        if (down.moved) {
          rotY += dx * 0.012;
          rotX = Math.max(-0.15, Math.min(1.1, rotX + dy * 0.008));
          ghost.visible = false;
        }
        down.lx = e.clientX;
        down.ly = e.clientY;
      } else if (e.pointerType === "mouse") {
        showGhost(target(e.clientX, e.clientY));
      }
    };
    const onUp = (e) => {
      if (down && !down.moved) apply(target(e.clientX, e.clientY));
      down = null;
      if (e.pointerType !== "mouse") ghost.visible = false;
      else showGhost(target(e.clientX, e.clientY));
    };
    const onLeave = () => {
      ghost.visible = false;
    };
    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointercancel", () => (down = null));
    dom.addEventListener("pointerleave", onLeave);

    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      root.rotation.y = rotY;
      root.rotation.x = rotX;
      renderer.render(scene, camera);
    };
    loop();

    apiRef.current = {
      rebuild,
      setBase: (c) => base.material.color.set(c),
      turn: (d) => {
        rotY += d;
      },
    };
    rebuild(stateRef.current.voxels);

    return () => {
      cancelAnimationFrame(raf);
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointerleave", onLeave);
      geo.dispose();
      edgeGeo.dispose();
      mats.forEach((m) => m.dispose());
      renderer.dispose();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.rebuild(voxels);
  }, [voxels]);
  useEffect(() => {
    apiRef.current?.setBase(baseColor);
  }, [baseColor]);

  const TOOLS = [
    { id: "add", icon: "✚", label: "Ставить" },
    { id: "paint", icon: "🎨", label: "Красить" },
    { id: "erase", icon: "⌫", label: "Убирать" },
  ];
  const HINT = {
    add: "Нажмите на пол или на кубик — рядом появится новый",
    paint: "Нажмите на кубик — он станет выбранного цвета",
    erase: "Нажмите на кубик — он исчезнет",
  };

  return (
    <div className="w-full space-y-2.5">
      <div className="relative rounded-3xl border border-amber-400/30 bg-gradient-to-b from-slate-900 to-slate-950 overflow-hidden">
        <div ref={mountRef} className="w-full" style={{ minHeight: 280 }} />
        <div className="absolute top-2 left-2 right-2 flex justify-between pointer-events-none">
          <span className="px-2 py-1 rounded-lg bg-black/40 text-[11px] text-slate-200">{HINT[tool]}</span>
          <span className="px-2 py-1 rounded-lg bg-black/40 text-[11px] text-slate-400 shrink-0">{voxels.length} куб.</span>
        </div>
        <div className="absolute bottom-2 right-2 flex gap-1.5">
          <button type="button" onClick={() => apiRef.current?.turn(-Math.PI / 4)} aria-label="Повернуть влево" className="w-9 h-9 rounded-full bg-black/45 text-white text-sm">
            ⟲
          </button>
          <button type="button" onClick={() => apiRef.current?.turn(Math.PI / 4)} aria-label="Повернуть вправо" className="w-9 h-9 rounded-full bg-black/45 text-white text-sm">
            ⟳
          </button>
        </div>
        <div className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-black/40 text-[10px] text-slate-400 pointer-events-none">потяните — повернуть</div>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex-1 grid grid-cols-3 gap-1 p-1 rounded-2xl bg-white/5" role="radiogroup" aria-label="Инструмент">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={tool === t.id}
              onClick={() => setTool(t.id)}
              className={`h-10 rounded-xl text-sm flex items-center justify-center gap-1.5 ${
                tool === t.id ? "bg-amber-300 text-slate-950 font-semibold" : "text-slate-300"
              }`}
            >
              <span>{t.icon}</span>
              <span className="text-xs">{t.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          aria-label="Отменить"
          className="w-12 h-12 rounded-2xl bg-white/5 text-slate-200 disabled:opacity-30 text-lg"
        >
          ↶
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Цвет">
        {palette.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={color === c.hex}
            onClick={() => {
              setColor(c.hex);
              if (tool === "erase") setTool("add");
            }}
            style={{ backgroundColor: c.hex }}
            aria-label={c.name}
            title={c.name}
            className={`w-8 h-8 rounded-full transition ${color === c.hex ? "ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

export { VoxelPaintEditor };
