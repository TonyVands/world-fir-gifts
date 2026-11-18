// ============================================================================
// Новогодняя полночь: обратный отсчёт, салют и сова, которая несёт шар.
// mode: "live" (настоящая полночь), "rehearsal" (репетиция с отсчётом),
// "fireworks" (просто салют — окошко 31 декабря адвент-календаря).
// ============================================================================
import React, { useEffect, useRef, useState } from "react";
import { CHIMES_LEAD_S, scheduleKremlinChimes, startPeal } from "../lib/bells.js";

const COLORS = ["#ffd166", "#ff6b6b", "#4ade80", "#60a5fa", "#f472b6", "#fde68a", "#a78bfa", "#ffffff"];

function useFireworks(canvasRef, active, intensity = 1, fireworks3d = null) {
  useEffect(() => {
    if (!active) return undefined;
    // Есть 3D-сцена — салют настоящий, объёмный, над Ёлкой; плоский холст — запасной вариант
    if (fireworks3d) {
      fireworks3d.start(0, intensity);
      return () => fireworks3d.stop();
    }
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);
    const rockets = [];
    const sparks = [];
    let audio = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audio = AC ? new AC() : null;
      audio?.resume?.();
    } catch {
      audio = null;
    }
    const boom = (size) => {
      if (!audio || audio.state !== "running") return;
      const len = Math.floor(audio.sampleRate * 0.5);
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      const src = audio.createBufferSource();
      src.buffer = buf;
      const lp = audio.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900 + size * 6;
      const g = audio.createGain();
      g.gain.value = 0.18;
      src.connect(lp).connect(g).connect(audio.destination);
      src.start();
    };
    const launch = () => {
      const w = canvas.width;
      const h = canvas.height;
      rockets.push({
        x: w * (0.15 + Math.random() * 0.7),
        y: h,
        vx: (Math.random() - 0.5) * 1.5 * dpr,
        vy: -(11 + Math.random() * 4) * dpr,
        targetY: h * (0.15 + Math.random() * 0.35),
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    };
    const explode = (r) => {
      const n = 70 + ((Math.random() * 70) | 0);
      const ring = Math.random() < 0.3;
      const second = Math.random() < 0.4 ? COLORS[(Math.random() * COLORS.length) | 0] : r.color;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
        const sp = (ring ? 4.2 : 1.2 + Math.random() * 4.2) * dpr;
        sparks.push({
          x: r.x,
          y: r.y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: 0.008 + Math.random() * 0.01,
          color: i % 3 === 0 ? second : r.color,
        });
      }
      boom(n);
    };
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now) => {
      const dt = Math.min(80, now - last);
      last = now;
      const k = dt / 16.7; // физика по времени, а не по кадрам — на слабых телефонах салют не «тормозит»
      acc += dt;
      if (acc > 420 / intensity) {
        acc = 0;
        launch();
        if (Math.random() < 0.35 * intensity) launch();
      }
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.6, 0.22 * k)})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "lighter";
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.x += r.vx * k;
        r.y += r.vy * k;
        r.vy += 0.12 * dpr * k;
        ctx.fillStyle = "#fff4d6";
        ctx.beginPath();
        ctx.arc(r.x, r.y, 2 * dpr, 0, Math.PI * 2);
        ctx.fill();
        if (r.y <= r.targetY || r.vy >= 0) {
          explode(r);
          rockets.splice(i, 1);
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * k;
        s.y += s.vy * k;
        s.vx *= Math.pow(0.985, k);
        s.vy = s.vy * Math.pow(0.985, k) + 0.05 * dpr * k;
        s.life -= s.decay * k;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.8 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      audio?.close?.();
    };
  }, [canvasRef, active, intensity, fireworks3d]);
}

function Owl() {
  // Оригинальная стилизованная сова (своя отрисовка, без чужих образов)
  return (
    <svg viewBox="0 0 160 150" className="w-full h-full" aria-hidden="true">
      <defs>
        <radialGradient id="ownBall" cx="40%" cy="35%">
          <stop offset="0%" stopColor="#fff7d6" />
          <stop offset="45%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#b45309" />
        </radialGradient>
      </defs>
      <g className="owl-wing-l" style={{ transformOrigin: "62px 62px" }}>
        <path d="M62 60 C30 40 8 52 2 74 C24 66 40 72 60 80 Z" fill="#c9b79a" />
      </g>
      <g className="owl-wing-r" style={{ transformOrigin: "98px 62px" }}>
        <path d="M98 60 C130 40 152 52 158 74 C136 66 120 72 100 80 Z" fill="#c9b79a" />
      </g>
      <ellipse cx="80" cy="74" rx="26" ry="32" fill="#efe6d6" />
      <ellipse cx="80" cy="84" rx="16" ry="18" fill="#fffaf0" />
      <circle cx="70" cy="62" r="9" fill="#fff" />
      <circle cx="90" cy="62" r="9" fill="#fff" />
      <circle cx="70" cy="62" r="4.5" fill="#1e293b" />
      <circle cx="90" cy="62" r="4.5" fill="#1e293b" />
      <path d="M80 66 l-4 6 h8 z" fill="#f59e0b" />
      <path d="M62 46 l6 8 M98 46 l-6 8" stroke="#b9a586" strokeWidth="4" strokeLinecap="round" />
      <line x1="80" y1="104" x2="80" y2="116" stroke="#d6c7a6" strokeWidth="2" />
      <circle cx="80" cy="128" r="14" fill="url(#ownBall)" />
      <rect x="75" y="111" width="10" height="5" rx="1.5" fill="#d4a017" />
    </svg>
  );
}

export default function MidnightShow({
  mode,
  startAtMs,
  nowOffsetMs = 0,
  onOwl,
  onDone,
  fireworks3d = null,
  getAudioContext = null,
}) {
  const canvasRef = useRef(null);
  const [phase, setPhase] = useState(mode === "fireworks" ? "celebrate" : "countdown");
  const [count, setCount] = useState(null); // секунды до полуночи (показываем последние 10)
  const [strike, setStrike] = useState(0); // какой удар курантов прозвучал
  const [owlFlying, setOwlFlying] = useState(false);
  // для репетиции полночь — через время боя курантов от «сейчас»
  const targetRef = useRef(mode === "live" && startAtMs ? startAtMs : Date.now() + CHIMES_LEAD_S * 1000);

  // Бой курантов: 12-й удар ровно в полночь (по часам сервера)
  useEffect(() => {
    if (mode === "fireworks") return undefined;
    const ctx = getAudioContext?.();
    if (!ctx) return undefined;
    ctx.resume?.().catch(() => {});
    const msLeft = targetRef.current - (Date.now() + (mode === "live" ? nowOffsetMs : 0));
    const strikes = scheduleKremlinChimes(ctx, ctx.currentTime + msLeft / 1000);
    // счётчик ударов на экране
    const id = window.setInterval(() => {
      const n = strikes.filter((t) => t <= ctx.currentTime + 0.02).length;
      setStrike(n);
    }, 120);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // отсчёт до полуночи
  useEffect(() => {
    if (phase !== "countdown") return undefined;
    const target = targetRef.current;
    const id = window.setInterval(() => {
      const left = Math.ceil((target - (Date.now() + (mode === "live" ? nowOffsetMs : 0))) / 1000);
      if (left <= 0) {
        window.clearInterval(id);
        setPhase("celebrate");
      } else setCount(left);
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, mode, nowOffsetMs]);

  // Праздничный перезвон колоколов вместе с салютом
  useEffect(() => {
    if (phase !== "celebrate") return undefined;
    const ctx = getAudioContext?.();
    // перезвон доигрывает сам, даже когда надпись уже исчезла
    if (ctx) startPeal(ctx, mode === "fireworks" ? 12 : 22);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "celebrate"]);

  useFireworks(canvasRef, phase === "celebrate" || phase === "owl", mode === "fireworks" ? 0.9 : 1.3, fireworks3d);

  useEffect(() => {
    if (phase !== "celebrate") return undefined;
    const timers = [];
    if (mode !== "fireworks") {
      timers.push(
        window.setTimeout(() => {
          setPhase("owl");
          setOwlFlying(true);
          onOwl?.();
        }, 4500)
      );
    }
    timers.push(window.setTimeout(() => onDone?.(mode), mode === "fireworks" ? 20_000 : 16_000));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div className="fixed inset-0 z-[70] pointer-events-none" aria-live="polite">
      <style>{`
        @keyframes owlFly { 0% { transform: translate(-20vw, 70vh) scale(.6) rotate(-8deg); }
          45% { transform: translate(40vw, 22vh) scale(1) rotate(4deg); }
          100% { transform: translate(115vw, -20vh) scale(.7) rotate(-6deg); } }
        @keyframes flapL { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(22deg) } }
        @keyframes flapR { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(-22deg) } }
        .owl-wing-l { animation: flapL .45s ease-in-out infinite }
        .owl-wing-r { animation: flapR .45s ease-in-out infinite }
        @keyframes pop { 0% { transform: scale(1.6); opacity: 0 } 30% { opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
      `}</style>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {phase === "countdown" && count != null && count > 10 && (
        <div className="absolute inset-x-0 top-[16vh] flex flex-col items-center text-center px-4">
          <div className="rounded-2xl bg-slate-950/55 backdrop-blur-md border border-amber-200/20 px-5 py-3">
            <div className="text-sm uppercase tracking-[0.25em] text-amber-100/90">
              {strike > 0 ? "Бьют куранты" : "Звучат куранты"}
            </div>
            <div className="mt-1 font-serif text-3xl text-amber-50">
              {strike > 0 ? `${strike} из 12` : `до Нового года ${count} с`}
            </div>
          </div>
        </div>
      )}
      {phase === "countdown" && count != null && count <= 10 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/30">
          <div className="text-sm uppercase tracking-[0.3em] text-amber-100/80 mb-2">
            {strike > 0 ? `Удар ${strike} из 12` : "До Нового года"}
          </div>
          <div key={count} className="font-serif text-[28vw] sm:text-[180px] leading-none text-amber-50 drop-shadow-[0_0_40px_rgba(251,191,36,0.7)]" style={{ animation: "pop .9s ease-out" }}>
            {count}
          </div>
        </div>
      )}
      {(phase === "celebrate" || phase === "owl") && mode !== "fireworks" && (
        <div className="absolute inset-x-0 top-[18vh] text-center px-4">
          <div className="font-serif text-4xl sm:text-6xl text-amber-50 drop-shadow-[0_0_30px_rgba(251,191,36,0.8)]" style={{ animation: "pop 1.2s ease-out" }}>
            С Новым годом!
          </div>
          {phase === "owl" && (
            <div className="mt-3 text-sm sm:text-base text-amber-100/90">
              {mode === "live"
                ? "Сова несёт ваш шар мастеру из другого города — а к вам летит чужой 🦉"
                : "Так будет в полночь: Кольцо Чудес сомкнётся, и сова понесёт ваш шар другому мастеру 🦉"}
            </div>
          )}
        </div>
      )}
      {owlFlying && (
        <div className="absolute left-0 top-0 w-36 h-32 sm:w-44 sm:h-40" style={{ animation: "owlFly 9s ease-in-out forwards" }}>
          <Owl />
        </div>
      )}
    </div>
  );
}
