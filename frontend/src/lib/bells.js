// ============================================================================
// Колокола новогодней полуночи: бой курантов и русский праздничный трезвон.
//
// Реализм достигается тем же, из чего состоит звук настоящего литого колокола:
//  • модальный синтез: у колокола негармоничный спектр — «гул» на октаву ниже,
//    основной тон, малая терция, квинта, «номинал», децима и т.д.;
//  • каждый обертон — пара близких мод (дублет): колокол не идеально круглый,
//    моды расщеплены на доли герца, отсюда характерное «уа-уа» биение;
//  • у каждой моды своё время затухания: верхние гаснут за секунды, гул тянется
//    десятки секунд;
//  • удар языка: короткий металлический «клац» (шум + россыпь высоких мод);
//  • пространство: свёртка с синтетической импульсной характеристикой площади
//    (ранние отражения от стен + длинный тёмный хвост) и «воздух» — срез верхов.
// Как у настоящих курантов: Новый год наступает с первым звуком перезвона
// (так объясняет звонарь Кремля), затем 12 ударов часового колокола.
// ============================================================================

// [отношение к номиналу, громкость, T60 в долях базового затухания, расщепление дублета, Гц]
const BIG_BELL = [
  [0.25, 0.22, 1.0, 0.25], // гул (hum)
  [0.5, 0.42, 0.85, 0.35], // основной (prime)
  [0.6, 0.30, 0.6, 0.6], // малая терция (tierce)
  [0.75, 0.16, 0.45, 0.5], // квинта (quint)
  [1.0, 0.50, 0.55, 0.8], // номинал — «нота удара»
  [1.25, 0.16, 0.3, 1.1], // децима
  [1.335, 0.13, 0.26, 1.2], // ундецима
  [1.5, 0.12, 0.22, 1.4], // дуодецима
  [2.0, 0.10, 0.16, 1.8], // верхняя октава
  [2.66, 0.06, 0.1, 2.4],
  [3.2, 0.05, 0.07, 3.0],
];
const SMALL_BELL = BIG_BELL.filter((_, i) => i !== 0 && i !== 6 && i !== 9);

let chain = null;
function makeImpulse(ctx, seconds, decay, brightness) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      // со временем хвост темнеет: однополюсный фильтр с растущим сглаживанием
      const k = Math.min(0.995, brightness + t * 0.12);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.exp(-t * decay) * 3;
    }
    // ранние отражения — фасады вокруг площади
    [0.031, 0.047, 0.083, 0.119, 0.167].forEach((tt, j) => {
      const at = Math.floor((tt + ch * 0.006) * ctx.sampleRate);
      if (at < len) d[at] += (0.5 - j * 0.07) * (ch ? 0.9 : 1);
    });
  }
  return ir;
}

/** Общая цепочка: сухой сигнал + реверберация площади + «воздух» + компрессор. */
function output(ctx) {
  if (chain && chain.ctx === ctx) return chain.input;
  const input = ctx.createGain();
  const air = ctx.createBiquadFilter();
  air.type = "lowpass";
  air.frequency.value = 6500;
  const dry = ctx.createGain();
  dry.gain.value = 0.55;
  const wet = ctx.createGain();
  wet.gain.value = 0.75;
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx, 6.5, 0.9, 0.35);
  const pre = ctx.createDelay(0.2);
  pre.delayTime.value = 0.035;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.4;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  input.connect(air);
  air.connect(dry).connect(comp);
  air.connect(pre).connect(conv).connect(wet).connect(comp);
  comp.connect(master).connect(ctx.destination);
  chain = { ctx, input };
  return input;
}

/**
 * Удар колокола. nominal — частота «ноты удара» (Гц), decay — T60 гула в секундах,
 * big — полный набор мод (часовой колокол) или облегчённый (малые колокола).
 */
export function strikeBell(ctx, t, nominal, gain = 0.5, decay = 12, big = true) {
  if (!ctx) return;
  const out = output(ctx);
  const bus = ctx.createGain();
  bus.gain.value = gain;
  if (ctx.createStereoPanner) {
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.35;
    bus.connect(pan).connect(out);
  } else bus.connect(out);
  // сила удара каждый раз немного разная — как у живого механизма
  const force = 0.85 + Math.random() * 0.3;
  const modes = big ? BIG_BELL : SMALL_BELL;
  modes.forEach(([ratio, amp, t60k, split]) => {
    const f = nominal * ratio;
    if (f > 9000) return;
    const t60 = Math.max(0.25, decay * t60k);
    [-1, 1].forEach((side) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f + (side * split) / 2, t);
      const g = ctx.createGain();
      // верхние моды сильнее при сильном ударе
      const a = (amp / 2) * (ratio > 1 ? force * force : force) * (side > 0 ? 0.92 : 1);
      g.gain.setValueAtTime(0.00001, t);
      g.gain.linearRampToValueAtTime(a, t + 0.0025 + ratio * 0.0008);
      // экспоненциальное затухание до -60 дБ за t60
      g.gain.setTargetAtTime(0.00001, t + 0.003, t60 / 6.9);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + t60 + 0.2);
    });
  });
  // удар языка: металлический клац
  const n = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.min(7000, nominal * 7.3);
  bp.Q.value = 1.4;
  const ng = ctx.createGain();
  ng.gain.value = 0.32 * force;
  src.connect(bp).connect(ng).connect(bus);
  src.start(t);
  [5.4, 6.8, 8.9, 11.7].forEach((m, i) => {
    const f = nominal * m;
    if (f > 11000) return;
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05 / (i + 1), t);
    g.gain.exponentialRampToValueAtTime(0.00001, t + 0.12 + i * 0.03);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.3);
  });
}

// --- бой курантов -----------------------------------------------------------
// Короткий перезвон звучит в последние секунды отсчёта, а ровно в 00:00
// начинаются 12 ударов часового колокола — весь бой укладывается в ~10 с,
// как в телетрансляции.
const Q = { a: 659.25, b: 587.33, c: 523.25, d: 392.0 };
const QUARTER_PHRASES = [
  [Q.a, Q.b, Q.c, Q.d],
  [Q.c, Q.a, Q.b, Q.d],
];
const NOTE = 0.5;
const PHRASE_GAP = 0.45;
const AFTER_QUARTERS = 0.9;
export const STRIKE_INTERVAL = 0.9;
const HOUR_BELL_NOMINAL = 196; // крупный часовой колокол (соль малой октавы)

/** Сколько секунд перезвон звучит до полуночи. */
export const QUARTERS_LEAD =
  QUARTER_PHRASES.length * 4 * NOTE + (QUARTER_PHRASES.length - 1) * PHRASE_GAP + AFTER_QUARTERS - NOTE;
/** Совместимость: перезвон теперь целиком до полуночи. */
export const QUARTERS_DURATION = 0;
/** Шоу начинается за ~10 с до полуночи (отсчёт). */
export const CHIMES_LEAD_S = 11;
/** Последний, 12-й удар — через столько секунд после 00:00. */
export const LAST_STRIKE_S = 11 * STRIKE_INTERVAL;

/**
 * Перезвон заканчивается перед полуночью, первый удар — ровно в tMidnight.
 * Возвращает времена 12 ударов.
 */
export function scheduleKremlinChimes(ctx, tMidnight) {
  if (!ctx) return [];
  const now = ctx.currentTime;
  let t = tMidnight - QUARTERS_LEAD;
  QUARTER_PHRASES.forEach((phrase, pi) => {
    phrase.forEach((f, ni) => {
      if (t >= now - 0.02) strikeBell(ctx, Math.max(now, t), f, ni === 3 ? 0.32 : 0.26, 5, false);
      t += NOTE;
    });
    if (pi < QUARTER_PHRASES.length - 1) t += PHRASE_GAP;
  });
  const strikes = [];
  for (let k = 0; k < 12; k++) {
    const ts = tMidnight + k * STRIKE_INTERVAL;
    strikes.push(ts);
    // удары чуть тише и короче, чтобы не сливаться в гул при частом бое
    if (ts >= now - 0.02) strikeBell(ctx, Math.max(now, ts), HOUR_BELL_NOMINAL, 0.46, k === 11 ? 12 : 6, true);
  }
  return strikes;
}

// --- праздничный трезвон -----------------------------------------------------
/**
 * Русский трезвон: зазвонные (малые) колокола частят узором, подзвонные
 * держат ритм, большой колокол — на сильные доли. Планирование порциями:
 * scheduleUntil(t) дописывает удары до момента t.
 */
export function createPeal(ctx, t0, seconds = 22) {
  const beat = 0.24;
  const zazvon = [1174.66, 987.77, 1318.51, 880.0]; // малые колокола
  const podzvon = [523.25, 440.0]; // средние
  const big = 261.63; // большой
  const pattern = [0, 1, 2, 1, 0, 3, 2, 3]; // узор зазвонных на 8 долей
  const end = t0 + seconds;
  let step = 0;
  let t = t0;
  return {
    scheduleUntil(limit) {
      while (t < Math.min(limit, end)) {
        const fade = Math.min(1, (end - t) / 4); // к концу звон стихает
        strikeBell(ctx, t, zazvon[pattern[step % 8]], 0.13 * fade, 3.2, false);
        if (step % 2 === 0) strikeBell(ctx, t, podzvon[(step / 2) % 2], 0.16 * fade, 5, false);
        if (step % 8 === 0) strikeBell(ctx, t, big, 0.36 * fade, 12, true);
        t += beat * (0.97 + Math.random() * 0.06); // живой звонарь чуть «дышит»
        step += 1;
      }
    },
    get done() {
      return t >= end;
    },
  };
}

/** Трезвон в реальном времени (порции по ~1,5 с вперёд). */
export function startPeal(ctx, seconds = 22) {
  if (!ctx) return () => {};
  const peal = createPeal(ctx, ctx.currentTime + 0.05, seconds);
  peal.scheduleUntil(ctx.currentTime + 1.5);
  const timer = setInterval(() => {
    peal.scheduleUntil(ctx.currentTime + 1.5);
    if (peal.done) clearInterval(timer);
  }, 400);
  return () => clearInterval(timer);
}
