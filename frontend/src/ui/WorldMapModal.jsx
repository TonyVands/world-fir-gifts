// ============================================================================
// Карта мира шаров: огоньки городов, откуда повешены шары, и «Шар дня» города.
// Загружается лениво (отдельный чанк), чтобы не утяжелять стартовую сборку.
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import { geoConicConformal, geoNaturalEarth1, geoPath } from "d3-geo";
import countries110 from "world-atlas/countries-110m.json";

const WORLD = feature(countries110, countries110.objects.countries);
const W = 800;
const H = 440;

function useProjection(view) {
  return useMemo(() => {
    if (view === "russia") {
      // Россия целиком: конформная коническая проекция с центром в Сибири
      const p = geoConicConformal().rotate([-100, 0]).parallels([52, 68]).center([0, 62]);
      p.scale(430).translate([W / 2, H / 2 + 10]);
      return p;
    }
    return geoNaturalEarth1().fitExtent(
      [
        [8, 8],
        [W - 8, H - 8],
      ],
      { type: "Sphere" }
    );
  }, [view]);
}

export default function WorldMapModal({ fetchMap, fetchCityLeaders, myCity, onShowGift, onClose }) {
  const [view, setView] = useState("russia");
  const [data, setData] = useState(null);
  const [leaders, setLeaders] = useState(null);
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState("");
  const projection = useProjection(view);
  const path = useMemo(() => geoPath(projection), [projection]);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([fetchMap(), fetchCityLeaders(myCity)]).then(([m, l]) => {
      if (!alive) return;
      if (m.status === "fulfilled") setData(m.value);
      else setError("Нет связи с Ёлкой — карта не загрузилась.");
      if (l.status === "fulfilled") setLeaders(l.value);
    });
    return () => {
      alive = false;
    };
  }, [fetchMap, fetchCityLeaders, myCity]);

  const leaderByCity = useMemo(() => {
    const m = new Map();
    (leaders?.cities || []).forEach((c) => m.set(c.city, c));
    return m;
  }, [leaders]);

  const dots = useMemo(() => {
    if (!data) return [];
    return data.cities
      .map((c) => {
        const xy = projection([c.lon, c.lat]);
        if (!xy || xy[0] < -20 || xy[0] > W + 20 || xy[1] < -20 || xy[1] > H + 20) return null;
        return { ...c, x: xy[0], y: xy[1], r: 3 + Math.sqrt(c.gifts) * 2.2 };
      })
      .filter(Boolean)
      .sort((a, b) => b.r - a.r);
  }, [data, projection]);

  const pickedLeader = picked ? leaderByCity.get(picked.city) : null;
  const mine = leaders?.my_city;

  return (
    <div className="fixed inset-0 z-[57] bg-slate-950/80 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Карта мира шаров">
      <button type="button" aria-label="Закрыть" onClick={onClose} className="absolute inset-0" />
      <div className="relative w-full max-w-4xl max-h-[94vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#070d1c]/95 border border-white/10 shadow-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-serif text-xl text-amber-50">Карта мира шаров</div>
            {data && (
              <div className="text-xs text-slate-400">
                {data.total_gifts} шаров из {data.total_cities} городов
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {[
              { id: "russia", label: "Россия" },
              { id: "world", label: "Мир" },
            ].map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setView(v.id);
                  setPicked(null);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs border ${
                  view === v.id ? "bg-amber-300 text-slate-950 border-amber-200 font-semibold" : "bg-white/5 border-white/10 text-slate-300"
                }`}
              >
                {v.label}
              </button>
            ))}
            <button type="button" onClick={onClose} aria-label="Закрыть" className="w-9 h-9 rounded-xl bg-white/5 text-slate-300 ml-1">
              ✕
            </button>
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[radial-gradient(ellipse_at_center,#0d1b36,#050a16)]">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
            <defs>
              <radialGradient id="cityGlow">
                <stop offset="0%" stopColor="#fff3c4" stopOpacity="1" />
                <stop offset="35%" stopColor="#fbbf24" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
              </radialGradient>
            </defs>
            {view === "world" && <path d={path({ type: "Sphere" })} fill="#0a1630" stroke="rgba(255,255,255,0.06)" />}
            <g>
              {WORLD.features.map((f, i) => (
                <path
                  key={i}
                  d={path(f) || ""}
                  fill={f.properties?.name === "Russia" ? "#1a2c4f" : "#13213d"}
                  stroke="rgba(148,163,184,0.25)"
                  strokeWidth={0.5}
                />
              ))}
            </g>
            {dots.map((d) => (
              <g
                key={d.city}
                transform={`translate(${d.x},${d.y})`}
                className="cursor-pointer"
                onClick={() => setPicked(d)}
              >
                <circle r={d.r * 2.6} fill="url(#cityGlow)" opacity="0.55">
                  <animate attributeName="opacity" values="0.35;0.7;0.35" dur={`${2.4 + (d.r % 1.7)}s`} repeatCount="indefinite" />
                </circle>
                <circle r={Math.max(2, d.r * 0.55)} fill="#fff7d6" />
                {picked?.city === d.city && <circle r={d.r * 1.4} fill="none" stroke="#fde68a" strokeWidth="1.5" />}
              </g>
            ))}
          </svg>
          {!data && !error && <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">Зажигаем огоньки…</div>}
          {error && <div className="absolute inset-0 flex items-center justify-center text-sm text-rose-200">{error}</div>}
        </div>

        {picked && (
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[180px]">
              <div className="text-amber-100 font-semibold">{picked.city}</div>
              <div className="text-xs text-slate-400">
                {picked.gifts} шар(ов) · 🕯 {picked.candles}
              </div>
              {pickedLeader ? (
                <div className="text-xs text-slate-300 mt-1">
                  Шар дня города: «{pickedLeader.teaser_tag}» · 🕯 {pickedLeader.candles} сегодня
                </div>
              ) : (
                <div className="text-xs text-slate-500 mt-1">Сегодня здесь ещё не зажигали свечей — ваша может решить всё.</div>
              )}
            </div>
            {pickedLeader && (
              <button
                type="button"
                onClick={() => onShowGift(pickedLeader.gift_id)}
                className="px-4 py-2 rounded-xl bg-amber-300 text-slate-950 text-xs font-semibold"
              >
                Показать шар
              </button>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400 mb-2">Шар дня в городах</div>
            {mine && (
              <div className="mb-2 text-xs text-slate-300">
                Ваш город — <b className="text-amber-100">{mine.city}</b>:{" "}
                {mine.today ? `«${mine.today.teaser_tag}» (🕯 ${mine.today.candles})` : "пока без лидера"}
                {mine.yesterday ? ` · вчера: «${mine.yesterday.teaser_tag}»` : ""}
              </div>
            )}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(leaders?.cities || []).length === 0 && <div className="text-xs text-slate-500">Сегодня свечей ещё не было.</div>}
              {(leaders?.cities || []).map((c) => (
                <button
                  key={c.city}
                  type="button"
                  onClick={() => onShowGift(c.gift_id)}
                  className="w-full flex items-center gap-2 rounded-xl px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-left"
                >
                  <span className="text-xs text-amber-200 w-28 truncate">{c.city}</span>
                  <span className="flex-1 min-w-0 truncate text-xs text-slate-300">«{c.teaser_tag}»</span>
                  <span className="text-xs text-slate-400">🕯 {c.candles}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400 mb-2">Больше всего шаров</div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(data?.cities || []).slice(0, 12).map((c, i) => (
                <div key={c.city} className="flex items-center gap-2 text-xs">
                  <span className="w-5 text-slate-500">{i + 1}</span>
                  <span className="flex-1 text-slate-200">{c.city}</span>
                  <span className="text-slate-400">{c.gifts} 🎄</span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Укажите свой город при создании шара — и на карте загорится ещё один огонёк.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
