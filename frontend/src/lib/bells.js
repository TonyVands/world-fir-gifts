// ============================================================================
// Колокола для новогодней полуночи: бой курантов и праздничный перезвон.
// Всё синтезируется Web Audio: у настоящего колокола обертоны негармоничны
// (гул, основной тон, малая терция, квинта, октава…), и каждый затухает со
// своей скоростью — так получается «медный» звук, а не электронный писк.
// Четвертной перезвон — «Вестминстерские четверти» (1793 г., общественное
// достояние), затем 12 ударов большого колокола, последний — ровно в полночь.
// ============================================================================

const PARTIALS = [
  // [множитель частоты, громкость, доля времени затухания]
  [0.5, 0.32, 1.5], // гул (hum)
  [1.0, 0.55, 1.0], // основной (prime)
  [1.183, 0.28, 0.7], // малая терция (tierce)
  [1.506, 0.2, 0.6], // квинта (quint)
  [2.0, 0.32, 0.5], // октава (nominal)
  [2.514, 0.12, 0.35],
  [2.662, 0.1, 0.3],
  [3.011, 0.08, 0.25],
  [4.166, 0.05, 0.18],
];

let bus = null;
function master(ctx) {
  if (bus && bus.context === ctx) return bus;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  const g = ctx.createGain();
  g.gain.value = 0.9;
  g.connect(comp).connect(ctx.destination);
  bus = g;
  return bus;
}

/** Один удар колокола. freq — основной тон, decay — секунды до затухания. */
export function strikeBell(ctx, t, freq, gain = 0.5, decay = 5) {
  if (!ctx) return;
  const out = master(ctx);
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const sum = ctx.createGain();
  sum.gain.value = gain;
  if (pan) {
    pan.pan.value = (Math.random() - 0.5) * 0.5;
    sum.connect(pan).connect(out);
  } else sum.connect(out);
  PARTIALS.forEach(([m, g, d]) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    // лёгкая расстройка — у литого колокола тоны «бьются»
    o.frequency.setValueAtTime(freq * m * (1 + (Math.random() - 0.5) * 0.002), t);
    const env = ctx.createGain();
    const len = Math.max(0.3, decay * d);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(g, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(env).connect(sum);
    o.start(t);
    o.stop(t + len + 0.05);
  });
  // удар языка — короткий металлический щелчок
  const n = Math.floor(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 4);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.min(8000, freq * 6);
  bp.Q.value = 2;
  const ng = ctx.createGain();
  ng.gain.value = 0.25;
  src.connect(bp).connect(ng).connect(sum);
  src.start(t);
}

// Вестминстерские четверти (ми мажор), 4 фразы по 4 ноты
const E4 = 329.63;
const Fs4 = 369.99;
const Gs4 = 415.3;
const B3 = 246.94;
const QUARTERS = [
  [Gs4, Fs4, E4, B3],
  [E4, Gs4, Fs4, B3],
  [E4, Fs4, Gs4, E4],
  [Gs4, E4, Fs4, B3],
];
const NOTE = 0.75;
const PHRASE_GAP = 0.9;
export const STRIKE_INTERVAL = 2.6;
const BEFORE_STRIKES = 2.2;

/** Сколько секунд до полуночи нужно начинать бой курантов. */
export const CHIMES_LEAD_S = (() => {
  const quarters = QUARTERS.length * (4 * NOTE) + (QUARTERS.length - 1) * PHRASE_GAP;
  return Math.ceil(quarters + BEFORE_STRIKES + 11 * STRIKE_INTERVAL + 1);
})();

/**
 * Планирует бой курантов так, чтобы 12-й удар пришёлся ровно на tMidnight
 * (время AudioContext). Если до полуночи меньше, часть ударов пропускается.
 * Возвращает времена ударов (для счётчика на экране).
 */
export function scheduleKremlinChimes(ctx, tMidnight) {
  if (!ctx) return [];
  const now = ctx.currentTime;
  const strikes = [];
  for (let k = 0; k < 12; k++) strikes.push(tMidnight - (11 - k) * STRIKE_INTERVAL);
  // четверти перед ударами
  let t = strikes[0] - BEFORE_STRIKES - (QUARTERS.length * 4 * NOTE + (QUARTERS.length - 1) * PHRASE_GAP);
  QUARTERS.forEach((phrase, pi) => {
    phrase.forEach((f, ni) => {
      if (t >= now) strikeBell(ctx, t, f, ni === 3 ? 0.42 : 0.34, 3.2);
      t += NOTE;
    });
    if (pi < QUARTERS.length - 1) t += PHRASE_GAP;
  });
  // двенадцать ударов большого колокола
  strikes.forEach((ts) => {
    if (ts >= now - 0.05) strikeBell(ctx, Math.max(now, ts), 110, 0.75, 7);
  });
  return strikes;
}

/** Праздничный перезвон (как на колокольне): 6 колоколов, «круги» и переборы. */
export function startPeal(ctx, seconds = 25) {
  if (!ctx) return () => {};
  const scale = [587.33, 523.25, 493.88, 440.0, 392.0, 369.99]; // ре мажор вниз
  let order = [0, 1, 2, 3, 4, 5];
  const step = 0.27;
  let t = ctx.currentTime + 0.05;
  const end = t + seconds;
  let row = 0;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    while (t < ctx.currentTime + 1.2 && t < end) {
      order.forEach((b, i) => {
        strikeBell(ctx, t + i * step, scale[b], 0.3 + (b === 5 ? 0.06 : 0), 2.6);
      });
      // каждые 2 больших колокола: гул низкого
      if (row % 2 === 0) strikeBell(ctx, t, 146.83, 0.35, 5);
      t += order.length * step + step; // «пропуск» между кругами, как у звонарей
      row += 1;
      // перестановка пар (простейший «перебор» plain hunt)
      const swapFrom = row % 2;
      const next = [...order];
      for (let i = swapFrom; i + 1 < next.length; i += 2) [next[i], next[i + 1]] = [next[i + 1], next[i]];
      order = next;
    }
    if (t >= end) clearInterval(timer);
  }, 250);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
