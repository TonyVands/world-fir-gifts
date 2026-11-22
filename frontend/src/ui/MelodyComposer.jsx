// Сочинялка мелодии для шара памяти: 16 шагов × 12 нот пентатоники, четыре дорожки.
// Нажатие на клетку ставит ноту (и сразу её звучание), повторное — убирает.
import { useState } from "react";
import {
  CUSTOM_ROWS,
  CUSTOM_STARTERS,
  CUSTOM_TEMPO,
  CUSTOM_TRACKS,
  CUSTOM_VOICES,
  customNoteCount,
  emptyCustom,
} from "../lib/memorialMelodies.js";

export default function MelodyComposer({ value, onChange, player, playing, onTogglePlay }) {
  const [slot, setSlot] = useState("celesta");
  const track = CUSTOM_TRACKS.find((t) => t.slot === slot);
  const notes = value[track.key];
  const voice = value.voices?.[slot] || CUSTOM_VOICES[slot][0][0];
  const count = customNoteCount(value);

  const setNote = (step, note) => {
    const next = notes.slice();
    const removing = next[step] === note;
    next[step] = removing ? 0 : note;
    onChange({ ...value, [track.key]: next });
    if (!removing) player?.note?.(slot, note, voice);
  };
  const setVoice = (v) => {
    onChange({ ...value, voices: { ...value.voices, [slot]: v } });
    const first = notes.find((n) => n > 0) || 7;
    player?.note?.(slot, first, v);
  };
  const applyStarter = (st) => {
    const base = emptyCustom();
    onChange({
      ...base,
      tempo: st.tempo,
      celesta: st.celesta || base.celesta,
      harp: st.harp || base.harp,
      cello: st.cello || base.cello,
      flute: st.flute || base.flute,
    });
  };
  const others = CUSTOM_TRACKS.filter((t) => t.slot !== slot);

  return (
    <div className="space-y-3 p-3 rounded-2xl bg-white/[0.04] border border-sky-200/20">
      <div className="text-[12px] text-slate-300 leading-snug">
        Нажимайте на клетки: слева направо идут шаги мелодии, снизу вверх — звуки от низких к высоким. Любые сочетания звучат мягко.
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-[11px] text-slate-500 self-center">Заготовки:</span>
        {CUSTOM_STARTERS.map((st) => (
          <button key={st.title} type="button" onClick={() => applyStarter(st)} className="px-2.5 py-1 rounded-full bg-white/10 text-[11px] text-slate-200">
            {st.title}
          </button>
        ))}
        <button type="button" onClick={() => onChange(emptyCustom())} className="px-2.5 py-1 rounded-full bg-white/5 text-[11px] text-slate-400">
          Очистить
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-black/20" role="tablist" aria-label="Дорожки мелодии">
        {CUSTOM_TRACKS.map((t) => {
          const n = value[t.key].filter((v) => v > 0).length;
          return (
            <button
              key={t.slot}
              type="button"
              role="tab"
              aria-selected={slot === t.slot}
              onClick={() => setSlot(t.slot)}
              className={`py-1.5 rounded-lg text-[11px] leading-tight ${slot === t.slot ? "bg-white/15 text-white font-semibold" : "text-slate-400"}`}
            >
              <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: t.color }} />
              {t.title}
              {n > 0 && <span className="block text-[10px] opacity-60">{n}</span>}
            </button>
          );
        })}
      </div>
      <div className="text-[11px] text-slate-500 -mt-1">{track.hint}</div>

      <div className="flex gap-1">
        <div className="flex flex-col text-[9px] text-slate-500 w-6 shrink-0">
          {CUSTOM_ROWS.map((r) => (
            <div key={r.note} className="h-[22px] flex items-center justify-end pr-1">
              {r.label}
            </div>
          ))}
        </div>
        <div className="flex-1 grid gap-[2px] select-none touch-manipulation" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
          {CUSTOM_ROWS.map((r) =>
            Array.from({ length: 16 }, (_, step) => {
              const on = notes[step] === r.note;
              const ghost = !on && others.some((o) => value[o.key][step] === r.note);
              return (
                <button
                  key={`${r.note}-${step}`}
                  type="button"
                  onClick={() => setNote(step, r.note)}
                  aria-label={`Шаг ${step + 1}, ${r.label}`}
                  aria-pressed={on}
                  className="h-[22px] rounded-[4px] relative"
                  style={{
                    background: on ? track.color : step % 4 === 0 ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)",
                    boxShadow: on ? `0 0 8px ${track.color}99` : undefined,
                  }}
                >
                  {ghost && <span className="absolute inset-0 m-auto w-1.5 h-1.5 rounded-full bg-white/35" />}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">Звучание дорожки «{track.title}»</div>
        <div className="flex flex-wrap gap-1.5">
          {CUSTOM_VOICES[slot].map(([id, name]) => (
            <button
              key={id}
              type="button"
              onClick={() => setVoice(id)}
              aria-pressed={voice === id}
              className={`px-2.5 py-1 rounded-full border text-[12px] ${voice === id ? "bg-white/15 border-white/40 text-white" : "bg-white/5 border-white/10 text-slate-300"}`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="flex justify-between text-[11px] text-slate-400">
          <span>Темп</span>
          <span>{value.tempo < 70 ? "очень неспешно" : value.tempo < 82 ? "неспешно" : "ровно"}</span>
        </span>
        <input
          type="range"
          min={CUSTOM_TEMPO[0]}
          max={CUSTOM_TEMPO[1]}
          step="2"
          value={value.tempo}
          onChange={(e) => onChange({ ...value, tempo: +e.target.value })}
          className="w-full accent-sky-300"
        />
      </label>

      <button
        type="button"
        onClick={onTogglePlay}
        disabled={count === 0}
        className="w-full py-2.5 rounded-xl bg-sky-200 text-slate-950 text-sm font-semibold disabled:opacity-40"
      >
        {playing ? "❚❚ Остановить" : "▶ Послушать всю мелодию"}
      </button>
      <div className={`text-[11px] text-center ${count < 4 ? "text-amber-200/80" : "text-slate-500"}`}>
        {count < 4 ? `Нужно хотя бы 4 ноты — пока ${count}` : `Нот: ${count}`}
      </div>
    </div>
  );
}
