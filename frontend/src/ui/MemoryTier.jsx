// «Ярус памяти»: список, карточка памяти, создание портрета из фото.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  createMemorial,
  deleteMemorial,
  fetchMemorial,
  fetchMemorials,
  lightMemorialCandle,
  reportMemorial,
} from "../api.js";
import { decodePortrait, EMPTY, loadImageFile, pixelize, portraitToCanvas } from "../lib/portrait.js";

const glassPanel =
  "bg-[#070d1c]/85 backdrop-blur-xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.45)]";

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function fmtDate(s) {
  if (!s) return "";
  if (s.length === 4) return s;
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${MONTHS[m - 1] || ""} ${y}`;
}
export function memorialYears(m) {
  const b = m.birth_date ? m.birth_date.slice(0, 4) : "";
  const d = (m.death_date || "").slice(0, 4);
  return b ? `${b} – ${d}` : d;
}

// ---------------------------------------------------------------------------
// Объёмный пиксельный портрет (барельеф из кубиков), можно покрутить пальцем
// ---------------------------------------------------------------------------
export function PortraitRelief({ portrait, size = 240, autoSwing = true }) {
  const mountRef = useRef(null);
  useEffect(() => {
    const d = decodePortrait(portrait);
    const el = mountRef.current;
    if (!d || !el) return undefined;
    const W = size;
    const H = Math.round((size * d.h) / d.w);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.appendChild(portraitToCanvas(portrait, { scale: Math.max(2, Math.floor(size / d.w)) }));
      return () => {
        el.innerHTML = "";
      };
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W, H);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight("#fff4e0", "#26304a", 1.5));
    const key = new THREE.DirectionalLight("#ffe8c8", 1.6);
    key.position.set(-0.6, 0.8, 1.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight("#9cc8ff", 0.9);
    rim.position.set(1, 0.2, -0.6);
    scene.add(rim);

    let count = 0;
    for (let i = 0; i < d.px.length; i++) if (d.px[i] !== EMPTY) count++;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    let k = 0;
    for (let y = 0; y < d.h; y++)
      for (let x = 0; x < d.w; x++) {
        const i = y * d.w + x;
        const v = d.px[i];
        if (v === EMPTY) continue;
        const z = 1 + d.depth[i] * 0.32; // высота столбика: задник ровный, лицо выступает
        tmp.position.set(x - (d.w - 1) / 2, (d.h - 1) / 2 - y, z / 2);
        tmp.scale.set(1, 1, z);
        tmp.updateMatrix();
        mesh.setMatrixAt(k, tmp.matrix);
        const [r, g, b] = d.pal[v] || [200, 200, 200];
        col.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        mesh.setColorAt(k, col);
        k++;
      }
    const pivot = new THREE.Group();
    pivot.add(mesh);
    scene.add(pivot);
    const cam = new THREE.PerspectiveCamera(32, W / H, 1, 1000);
    const dist = (d.h / 2 / Math.tan((32 * Math.PI) / 360)) * 1.12;
    cam.position.set(0, 0, dist + 6);

    let drag = null;
    let rotY = 0;
    let rotX = 0;
    let userUntil = 0;
    const onDown = (e) => {
      drag = { x: e.clientX, y: e.clientY, ry: rotY, rx: rotX };
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!drag) return;
      rotY = Math.max(-1.1, Math.min(1.1, drag.ry + (e.clientX - drag.x) * 0.01));
      rotX = Math.max(-0.6, Math.min(0.6, drag.rx + (e.clientY - drag.y) * 0.01));
      userUntil = performance.now() + 2500;
    };
    const onUp = () => {
      drag = null;
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);

    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const now = performance.now();
      if (autoSwing && !drag && now > userUntil) {
        const t = (now - t0) / 1000;
        rotY += (Math.sin(t * 0.6) * 0.45 - rotY) * 0.05;
        rotX += (Math.sin(t * 0.37) * 0.08 - rotX) * 0.05;
      }
      pivot.rotation.set(rotX, rotY, 0);
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      el.innerHTML = "";
    };
  }, [portrait, size, autoSwing]);
  return <div ref={mountRef} className="mx-auto touch-none select-none" style={{ width: size }} aria-label="Объёмный пиксельный портрет" />;
}

function PortraitThumb({ portrait, size = 72 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !portrait) return;
    portraitToCanvas(portrait, { scale: 3, bg: "#141b33", canvas: ref.current });
  }, [portrait]);
  return <canvas ref={ref} style={{ width: size, imageRendering: "pixelated" }} className="rounded-md border border-amber-200/30" />;
}

function Checkbox({ checked, onChange, children }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-sky-300 shrink-0" />
      <span>{children}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Создание памяти
// ---------------------------------------------------------------------------
function CreateMemory({ onDone, onCancel }) {
  const [imgState, setImgState] = useState(null); // { img, url }
  const [zoom, setZoom] = useState(1.2);
  const [offY, setOffY] = useState(-0.05);
  const [offX, setOffX] = useState(0);
  const [removeBg, setRemoveBg] = useState(true);
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [death, setDeath] = useState("");
  const [epitaph, setEpitaph] = useState("");
  const [relation, setRelation] = useState("");
  const [heir, setHeir] = useState(false);
  const [pd, setPd] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => imgState && URL.revokeObjectURL(imgState.url), [imgState]);

  const portrait = useMemo(() => {
    if (!imgState) return null;
    try {
      return pixelize(imgState.img, { zoom, offX, offY, removeBg });
    } catch {
      return null;
    }
  }, [imgState, zoom, offX, offY, removeBg]);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError("");
    try {
      setImgState(await loadImageFile(f));
    } catch {
      setError("Не получилось открыть фото. Попробуйте другое (JPG или PNG).");
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const birthOk = !birth || /^\d{4}$/.test(birth) || /^\d{4}-\d{2}-\d{2}$/.test(birth);
  const canSubmit = portrait && name.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(death) && birthOk && heir && pd && terms && !busy;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await createMemorial({
        full_name: name.trim(),
        birth_date: birth.trim(),
        death_date: death,
        epitaph: epitaph.trim(),
        relation: relation.trim(),
        portrait,
        heir_confirm: heir,
        pd_consent: pd,
        terms_accepted: terms,
      });
      onDone(res);
    } catch (err) {
      setError(err?.message || "Не получилось сохранить. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-300/60";

  return (
    <div className="space-y-4">
      <div className="text-[13px] text-slate-300 leading-snug">
        Выберите фотографию — мы соберём из неё портрет из кубиков прямо на вашем устройстве. Само фото никуда не отправляется.
      </div>
      <label className="block">
        <input type="file" accept="image/*" onChange={onFile} className="hidden" />
        <span className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-sky-300/15 border border-sky-200/30 text-sky-100 text-sm cursor-pointer hover:bg-sky-300/25">
          📷 {imgState ? "Выбрать другое фото" : "Выбрать фото"}
        </span>
      </label>

      {portrait && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-gradient-to-b from-[#16203f] to-[#0b1124] border border-white/10 py-3">
            <PortraitRelief portrait={portrait} size={220} />
            <div className="text-center text-[11px] text-slate-500 mt-1">Покрутите пальцем</div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-[11px] text-slate-400">
            <label className="space-y-1">
              <span>Крупнее</span>
              <input type="range" min="1" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(+e.target.value)} className="w-full accent-sky-300" />
            </label>
            <label className="space-y-1">
              <span>Выше / ниже</span>
              <input type="range" min="-0.6" max="0.6" step="0.01" value={offY} onChange={(e) => setOffY(+e.target.value)} className="w-full accent-sky-300" />
            </label>
            <label className="space-y-1">
              <span>Левее / правее</span>
              <input type="range" min="-0.6" max="0.6" step="0.01" value={offX} onChange={(e) => setOffX(+e.target.value)} className="w-full accent-sky-300" />
            </label>
          </div>
          <Checkbox checked={removeBg} onChange={setRemoveBg}>
            <span className="text-[12px] text-slate-300">Убрать однотонный фон</span>
          </Checkbox>
        </div>
      )}

      <div className="space-y-2">
        <input className={input} maxLength={80} placeholder="Имя (например: Мария Ивановна Петрова)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-400 space-y-1">
            <span>Год или дата рождения</span>
            <input className={input} maxLength={10} placeholder="1941" value={birth} onChange={(e) => setBirth(e.target.value.trim())} />
          </label>
          <label className="text-[11px] text-slate-400 space-y-1">
            <span>Дата ухода</span>
            <input type="date" className={input} max={today} min="1800-01-01" value={death} onChange={(e) => setDeath(e.target.value)} />
          </label>
        </div>
        <textarea className={input + " resize-none"} rows={2} maxLength={240} placeholder="Несколько слов памяти" value={epitaph} onChange={(e) => setEpitaph(e.target.value)} />
        <input className={input} maxLength={24} placeholder="Кем вам приходится (внучка, сын…)" value={relation} onChange={(e) => setRelation(e.target.value)} />
      </div>

      <div className="space-y-2 p-3 rounded-xl bg-white/[0.03] border border-white/10 text-[12px] leading-snug text-slate-300">
        <Checkbox checked={heir} onChange={setHeir}>
          Я близкий родственник (супруг, ребёнок, родитель) или наследник этого человека
        </Checkbox>
        <Checkbox checked={pd} onChange={setPd}>
          Даю <a href="/legal/memory" target="_blank" rel="noopener" className="underline text-sky-300">согласие на обработку и показ</a> имени, дат и портрета на Ёлке
        </Checkbox>
        <Checkbox checked={terms} onChange={setTerms}>
          Принимаю <a href="/legal/memory" target="_blank" rel="noopener" className="underline text-sky-300">правила Яруса памяти</a> и <a href="/legal/privacy" target="_blank" rel="noopener" className="underline text-sky-300">политику</a>
        </Checkbox>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/40 text-xs text-rose-200">{error}</div>}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl bg-white/10 text-sm text-slate-200">Назад</button>
        <button type="button" disabled={!canSubmit} onClick={submit} className="flex-1 py-3 rounded-xl bg-sky-200 text-slate-950 text-sm font-semibold disabled:opacity-40">
          {busy ? "Сохраняем…" : !portrait ? "Сначала выберите фото" : "Отправить на проверку"}
        </button>
      </div>
      <div className="text-[11px] text-slate-500 text-center">
        После проверки модератором память появится на нижнем ярусе Ёлки, а её отпечаток будет записан в блокчейн Bitcoin.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Карточка одной памяти
// ---------------------------------------------------------------------------
function MemoryCard({ id, initial, onBack, onChanged, onShowOnTree }) {
  const [m, setM] = useState(initial || null);
  const [error, setError] = useState("");
  const [lighting, setLighting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMemorial(id)
      .then((d) => alive && setM(d))
      .catch((e) => alive && !initial && setError(e?.message || "Память не найдена."));
    return () => {
      alive = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="p-4 text-sm text-slate-300">{error}</div>;
  if (!m) return <div className="p-4 text-sm text-slate-400">Открываем…</div>;

  const light = async () => {
    setLighting(true);
    try {
      const r = await lightMemorialCandle(m.id);
      setM({ ...m, candles: r.candles, lit_today: true });
      onChanged?.();
    } catch {
      /* молча */
    } finally {
      setLighting(false);
    }
  };
  const report = async (reason) => {
    try {
      await reportMemorial(m.id, reason);
    } catch {
      /* молча */
    }
    setReported(true);
    setReportOpen(false);
  };
  const remove = async () => {
    try {
      await deleteMemorial(m.id);
      onChanged?.();
      onBack();
    } catch (e) {
      setError(e?.message || "Не получилось удалить.");
    }
  };
  const shareUrl = `${window.location.origin}/memory/${m.id}`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `Память: ${m.full_name}`, url: shareUrl });
      else await navigator.clipboard.writeText(shareUrl);
    } catch {
      /* отменили */
    }
  };

  return (
    <div className="space-y-4 text-center">
      <div className="rounded-2xl bg-gradient-to-b from-[#16203f] to-[#0b1124] border border-white/10 py-4">
        <PortraitRelief portrait={m.portrait} size={230} />
      </div>
      <div>
        <div className="font-serif text-2xl text-amber-50">{m.full_name}</div>
        <div className="text-sm text-slate-400">
          {m.birth_date ? `${fmtDate(m.birth_date)} — ` : ""}
          {fmtDate(m.death_date)}
        </div>
        {m.epitaph && <div className="mt-3 italic text-slate-200 text-[15px] leading-snug">«{m.epitaph}»</div>}
      </div>

      {m.status === "pending" && (
        <div className="p-3 rounded-xl bg-amber-300/10 border border-amber-200/30 text-xs text-amber-100">
          Память на проверке у модератора. Обычно это занимает до суток.
        </div>
      )}
      {m.status === "rejected" && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/40 text-xs text-rose-200">Модератор не одобрил эту память.</div>
      )}

      {m.status === "approved" && (
        <>
          <button
            type="button"
            disabled={m.lit_today || lighting}
            onClick={light}
            className="w-full py-3 rounded-xl bg-amber-200 text-slate-950 text-sm font-semibold disabled:bg-amber-200/30 disabled:text-amber-100"
          >
            {m.lit_today ? `🕯 Свеча горит · ${m.candles}` : `🕯 Зажечь свечу памяти${m.candles ? ` · ${m.candles}` : ""}`}
          </button>
          <div className="flex gap-2 justify-center text-xs">
            {onShowOnTree && (
              <button type="button" onClick={() => onShowOnTree(m)} className="px-3 py-2 rounded-lg bg-white/10 text-slate-200">🎄 На Ёлке</button>
            )}
            <button type="button" onClick={share} className="px-3 py-2 rounded-lg bg-white/10 text-slate-200">🔗 Поделиться</button>
            <a href={`/memory/${m.id}/certificate`} target="_blank" rel="noopener" className="px-3 py-2 rounded-lg bg-white/10 text-slate-200">
              📜 Сертификат
            </a>
          </div>
          {m.record_hash && (
            <div className="text-[10px] text-slate-500 break-all">
              Отпечаток {m.stamped ? "в блокчейне Bitcoin" : "готовится"}: {m.record_hash.slice(0, 16)}…
            </div>
          )}
        </>
      )}

      {m.mine ? (
        confirmDel ? (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/40 space-y-2">
            <div className="text-[12px] text-rose-100">Удалить память навсегда? Портрет, имя и свечи исчезнут с Ёлки.</div>
            <div className="flex gap-2 justify-center">
              <button type="button" onClick={() => setConfirmDel(false)} className="px-4 py-2 rounded-lg bg-white/10 text-xs text-slate-200">Отмена</button>
              <button type="button" onClick={remove} className="px-4 py-2 rounded-lg bg-rose-400 text-slate-950 text-xs font-semibold">Удалить</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDel(true)} className="text-[12px] text-slate-500 underline">Удалить память</button>
        )
      ) : (
        m.status === "approved" &&
        (reported ? (
          <div className="text-[11px] text-slate-500">Спасибо, мы проверим.</div>
        ) : reportOpen ? (
          <div className="flex flex-wrap gap-2 justify-center text-[11px]">
            <button type="button" onClick={() => report("alive")} className="px-3 py-1.5 rounded-lg bg-white/10 text-slate-200">Этот человек жив</button>
            <button type="button" onClick={() => report("not_relative")} className="px-3 py-1.5 rounded-lg bg-white/10 text-slate-200">Автор — не родственник</button>
            <button type="button" onClick={() => report("other")} className="px-3 py-1.5 rounded-lg bg-white/10 text-slate-200">Другое</button>
          </div>
        ) : (
          <button type="button" onClick={() => setReportOpen(true)} className="text-[11px] text-slate-500 underline">Сообщить о проблеме</button>
        ))
      )}
      <button type="button" onClick={onBack} className="block mx-auto text-xs text-slate-400">← Ко всем памятям</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Окно «Ярус памяти»
// ---------------------------------------------------------------------------
export function MemorySheet({ openId = null, startCreate = false, onClose, onChanged, onShowOnTree }) {
  const [view, setView] = useState(openId ? { kind: "card", id: openId } : startCreate ? { kind: "create" } : { kind: "list" });
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [sent, setSent] = useState(false);

  const reload = () =>
    fetchMemorials()
      .then(setData)
      .catch(() => setData((d) => d || { items: [], mine: [] }));
  useEffect(() => {
    reload();
  }, []);
  const changed = () => {
    reload();
    onChanged?.();
  };

  const q = query.trim().toLowerCase();
  const items = (data?.items || []).filter((m) => !q || m.full_name.toLowerCase().includes(q));
  const pendingMine = (data?.mine || []).filter((m) => m.status !== "approved");
  const byId = (id) => [...(data?.items || []), ...(data?.mine || [])].find((m) => m.id === id);

  return (
    <div className="fixed inset-0 z-[58] bg-slate-950/75 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Ярус памяти">
      <button type="button" aria-label="Закрыть фон" onClick={onClose} className="absolute inset-0" />
      <div className={`${glassPanel} relative w-full max-w-lg wfg-mh-88 flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden`}>
        <div className="p-4 pb-3 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="font-serif text-xl text-sky-50">🕊 Ярус памяти</div>
            <div className="text-[11px] text-slate-400">Тихий нижний ярус Ёлки — для тех, кого с нами нет</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="w-10 h-10 rounded-xl bg-white/10 text-slate-200 text-lg">✕</button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {view.kind === "create" && (
            <CreateMemory
              onCancel={() => setView({ kind: "list" })}
              onDone={(m) => {
                setSent(true);
                changed();
                setView({ kind: "card", id: m.id, initial: m });
              }}
            />
          )}
          {view.kind === "card" && (
            <MemoryCard
              key={view.id}
              id={view.id}
              initial={view.initial || byId(view.id)}
              onBack={() => setView({ kind: "list" })}
              onChanged={changed}
              onShowOnTree={onShowOnTree}
            />
          )}
          {view.kind === "list" && (
            <div className="space-y-4">
              {sent && <div className="p-3 rounded-xl bg-emerald-400/10 border border-emerald-300/30 text-xs text-emerald-100">Память отправлена на проверку. Спасибо, что храните её.</div>}
              <button type="button" onClick={() => setView({ kind: "create" })} className="w-full py-3 rounded-xl bg-sky-200 text-slate-950 text-sm font-semibold">
                ＋ Создать память
              </button>
              {pendingMine.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500">Мои памяти</div>
                  {pendingMine.map((m) => (
                    <button key={m.id} type="button" onClick={() => setView({ kind: "card", id: m.id, initial: m })} className="w-full flex items-center gap-3 p-2 rounded-xl bg-white/[0.04] text-left">
                      <PortraitThumb portrait={m.portrait} size={44} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-100 truncate">{m.full_name}</div>
                        <div className="text-[11px] text-amber-200/80">{m.status === "pending" ? "На проверке" : "Не одобрена"}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {(data?.items || []).length > 6 && (
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Найти по имени"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
              )}
              {!data && <div className="text-sm text-slate-400">Открываем ярус…</div>}
              {data && items.length === 0 && (
                <div className="text-sm text-slate-400 text-center py-6">
                  {q ? "Никого не нашли." : "Здесь пока тихо. Вы можете первым зажечь память о близком человеке."}
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                {items.map((m) => (
                  <button key={m.id} type="button" onClick={() => setView({ kind: "card", id: m.id, initial: m })} className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-white/5">
                    <PortraitThumb portrait={m.portrait} size={80} />
                    <div className="text-[12px] text-slate-100 leading-tight text-center line-clamp-2">{m.full_name}</div>
                    <div className="text-[10px] text-slate-500">
                      {memorialYears(m)}
                      {m.candles ? ` · 🕯${m.candles}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
