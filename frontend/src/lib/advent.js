// ============================================================================
// Адвент-календарь Всемирной ёлки: 1–31 декабря, каждый день — новое окошко
// с подарком для мастерской или Ёлки (шаблон фигурки, звук, цвет, погода,
// гирлянда, мелодия, салют). Открытые окошки хранятся в браузере.
// ============================================================================

export const ADVENT_YEAR = 2026;
const OPENED_KEY = "wfg_advent_opened_v1";

// --- генераторы фигурок 8×8×8 ---------------------------------------------
function fig(build) {
  const blocks = [];
  const seen = new Set();
  const add = (x, y, z, color) => {
    if (x < 0 || x > 7 || y < 0 || y > 7 || z < 0 || z > 7) return;
    const k = `${x},${y},${z}`;
    if (seen.has(k)) {
      const i = blocks.findIndex((b) => b.x === x && b.y === y && b.z === z);
      blocks[i].color = color;
      return;
    }
    seen.add(k);
    blocks.push({ x, y, z, color });
  };
  build(add);
  return blocks;
}

const C = {
  red: "#e11d48", gold: "#fbbf24", white: "#f8fafc", green: "#059669", ice: "#38bdf8",
  wood: "#92400e", orange: "#f97316", black: "#1e293b", violet: "#a855f7", pink: "#f472b6",
};

const TEMPLATES = {
  gift_box: fig((add) => {
    for (let x = 1; x <= 6; x++) for (let z = 1; z <= 6; z++) for (let y = 0; y <= 3; y++) {
      const ribbon = x === 3 || x === 4 || z === 3 || z === 4;
      add(x, y, z, ribbon ? C.gold : C.red);
    }
    add(3, 4, 3, C.gold); add(4, 4, 4, C.gold); add(2, 5, 3, C.gold); add(5, 5, 4, C.gold);
    add(3, 5, 3, C.gold); add(4, 5, 4, C.gold);
  }),
  snowflake: fig((add) => {
    const z = 4;
    for (let i = 0; i <= 7; i++) { add(i, 3, z, C.ice); add(3, i, z, C.ice); }
    for (let i = 1; i <= 6; i++) { add(i, i - 0, z, C.white); add(i, 7 - i - 1, z, C.white); }
    add(3, 3, z, C.white);
  }),
  bell: fig((add) => {
    const rad = [3.2, 3.0, 2.6, 2.2, 1.8, 1.4];
    rad.forEach((r, y) => {
      for (let x = 0; x <= 7; x++) for (let z = 0; z <= 7; z++) {
        const d = Math.hypot(x - 3.5, z - 3.5);
        if (d <= r && d >= r - 1.2) add(x, y + 1, z, C.gold);
      }
    });
    add(3, 0, 3, C.wood); add(4, 0, 4, C.wood);
    add(3, 7, 3, C.red); add(4, 7, 4, C.red); add(3, 7, 4, C.green);
  }),
  candy_cane: fig((add) => {
    for (let y = 0; y <= 5; y++) add(3, y, 3, y % 2 ? C.white : C.red);
    [[3, 6], [4, 7], [5, 7], [6, 6], [6, 5]].forEach(([x, y], i) => add(x, y, 3, i % 2 ? C.red : C.white));
  }),
  mitten: fig((add) => {
    for (let x = 2; x <= 5; x++) for (let y = 0; y <= 5; y++) for (let z = 3; z <= 4; z++) add(x, y, z, y === 0 ? C.white : C.ice);
    add(1, 3, 3, C.ice); add(1, 4, 3, C.ice); add(1, 3, 4, C.ice); add(1, 4, 4, C.ice);
    for (let x = 2; x <= 5; x++) add(x, 2, 2, C.white);
  }),
  penguin: fig((add) => {
    for (let x = 2; x <= 5; x++) for (let z = 2; z <= 5; z++) for (let y = 0; y <= 5; y++) {
      const front = z === 5 && x >= 3 && x <= 4 && y <= 4;
      add(x, y, z, front ? C.white : C.black);
    }
    add(3, 4, 6, C.orange); add(4, 4, 6, C.orange);
    add(2, 0, 6, C.orange); add(5, 0, 6, C.orange);
    add(3, 5, 6, C.white); add(4, 5, 6, C.white);
    for (let x = 2; x <= 5; x++) add(x, 6, 3, C.red);
  }),
  matryoshka: fig((add) => {
    const rows = [2.6, 2.8, 2.8, 2.5, 2.0, 2.2, 2.0, 1.3];
    rows.forEach((r, y) => {
      for (let x = 0; x <= 7; x++) for (let z = 0; z <= 7; z++) {
        if (Math.hypot(x - 3.5, z - 3.5) <= r) {
          const face = y >= 4 && y <= 6 && z >= 5;
          add(x, y, z, face ? (y === 5 && (x === 3 || x === 4) ? C.black : C.white) : y < 2 ? C.gold : C.red);
        }
      }
    });
  }),
  lighthouse: fig((add) => {
    for (let y = 0; y <= 5; y++) for (let x = 2; x <= 5; x++) for (let z = 2; z <= 5; z++) {
      if (x === 2 || x === 5 || z === 2 || z === 5) add(x, y, z, Math.floor(y / 2) % 2 ? C.white : C.red);
    }
    for (let x = 3; x <= 4; x++) for (let z = 3; z <= 4; z++) { add(x, 6, z, C.gold); add(x, 7, z, C.red); }
  }),
  rocket: fig((add) => {
    for (let y = 1; y <= 6; y++) for (let x = 3; x <= 4; x++) for (let z = 3; z <= 4; z++) add(x, y, z, y === 4 ? C.ice : C.white);
    add(3, 7, 3, C.red); add(4, 7, 4, C.red);
    [[2, 3], [5, 4], [3, 2], [4, 5]].forEach(([x, z]) => { add(x, 1, z, C.red); add(x, 2, z, C.red); });
    add(3, 0, 3, C.orange); add(4, 0, 4, C.gold);
  }),
};

// --- новые тембры (синтезируются в ChamberOrchestraSynth.synthExtra) --------
export const ADVENT_VOICES = [
  { id: "organ", icon: "⛪", name: "Орган" },
  { id: "xylophone", icon: "🎶", name: "Ксилофон" },
  { id: "marimba", icon: "🪵", name: "Маримба" },
  { id: "kalimba", icon: "🎐", name: "Калимба" },
  { id: "harpsichord", icon: "🏰", name: "Клавесин" },
  { id: "sleighbells", icon: "🛷", name: "Бубенцы" },
  { id: "accordion", icon: "🪗", name: "Баян" },
];

// --- мелодии (народные и старинные, общественное достояние) ----------------
export const ADVENT_MELODIES = {
  jingle: {
    title: "Бубенцы (Jingle Bells)",
    tempo: 132,
    celesta: [9, 9, 9, 0, 9, 9, 9, 0, 9, 10, 7, 8, 9, 0, 0, 0],
    harp: [1, 3, 4, 3, 1, 3, 4, 3, 1, 3, 4, 3, 2, 4, 6, 4],
    cello: [1, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 1, 0, 0, 0],
    flute: Array(16).fill(0),
    drum_track: [1, 4, 5, 4, 2, 4, 5, 4, 1, 4, 5, 4, 2, 4, 6, 4],
    voices: { celesta: "sleighbells", harp: "piano", cello: "bass", flute: "flute" },
  },
  elochka: {
    title: "В лесу родилась ёлочка",
    tempo: 120,
    celesta: [4, 9, 9, 8, 9, 7, 4, 4, 4, 9, 9, 18, 8, 10, 0, 0],
    harp: [1, 0, 3, 0, 1, 0, 3, 0, 1, 0, 3, 0, 2, 0, 4, 0],
    cello: [1, 0, 0, 0, 1, 0, 0, 0, 15, 0, 0, 0, 4, 0, 0, 0],
    flute: Array(16).fill(0),
    drum_track: [0, 0, 6, 0, 0, 0, 6, 0, 0, 0, 6, 0, 0, 0, 6, 0],
    voices: { celesta: "musicbox", harp: "harp", cello: "strings", flute: "flute" },
  },
  silent: {
    title: "Тихая ночь",
    tempo: 84,
    celesta: [4, 0, 5, 4, 3, 0, 0, 0, 4, 0, 5, 4, 3, 0, 0, 0],
    harp: [1, 3, 4, 3, 1, 3, 4, 3, 1, 3, 4, 3, 1, 3, 4, 3],
    cello: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    flute: Array(16).fill(0),
    drum_track: Array(16).fill(0),
    voices: { celesta: "choir", harp: "harp", cello: "pad", flute: "flute" },
  },
};

// --- сами окошки ------------------------------------------------------------
// type: template | voice | color | weather | garland | melody | effect
export const ADVENT_DAYS = [
  { day: 1, type: "template", id: "gift_box", icon: "🎁", title: "Фигурка «Подарок»" },
  { day: 2, type: "voice", id: "sleighbells", icon: "🛷", title: "Звук «Бубенцы»" },
  { day: 3, type: "color", id: "frost", icon: "🩵", title: "Цвет «Иней»", hex: "#bae6fd" },
  { day: 4, type: "weather", id: "aurora_night", icon: "🌌", title: "Погода «Северное сияние»" },
  { day: 5, type: "template", id: "snowflake", icon: "❄️", title: "Фигурка «Снежинка»" },
  { day: 6, type: "melody", id: "jingle", icon: "🔔", title: "Мелодия «Бубенцы»" },
  { day: 7, type: "voice", id: "xylophone", icon: "🎶", title: "Звук «Ксилофон»" },
  { day: 8, type: "color", id: "tangerine", icon: "🍊", title: "Цвет «Мандарин»", hex: "#fb923c" },
  { day: 9, type: "template", id: "bell", icon: "🛎️", title: "Фигурка «Колокольчик»" },
  { day: 10, type: "weather", id: "diamond_dust", icon: "💎", title: "Погода «Алмазная пыль»" },
  { day: 11, type: "voice", id: "kalimba", icon: "🎐", title: "Звук «Калимба»" },
  { day: 12, type: "color", id: "lingonberry", icon: "🍒", title: "Цвет «Брусника»", hex: "#be123c" },
  { day: 13, type: "template", id: "candy_cane", icon: "🍭", title: "Фигурка «Леденец»" },
  { day: 14, type: "color", id: "silver", icon: "🩶", title: "Цвет «Серебро»", hex: "#cbd5e1" },
  { day: 15, type: "voice", id: "marimba", icon: "🪵", title: "Звук «Маримба»" },
  { day: 16, type: "melody", id: "elochka", icon: "🎄", title: "Мелодия «В лесу родилась ёлочка»" },
  { day: 17, type: "template", id: "mitten", icon: "🧤", title: "Фигурка «Варежка»" },
  { day: 18, type: "color", id: "champagne", icon: "🥂", title: "Цвет «Шампанское»", hex: "#fde68a" },
  { day: 19, type: "weather", id: "pink_sunset", icon: "🌇", title: "Погода «Розовый закат»" },
  { day: 20, type: "voice", id: "harpsichord", icon: "🏰", title: "Звук «Клавесин»" },
  { day: 21, type: "template", id: "penguin", icon: "🐧", title: "Фигурка «Пингвин»" },
  { day: 22, type: "color", id: "aurora_mint", icon: "🌿", title: "Цвет «Сияние»", hex: "#34d399" },
  { day: 23, type: "voice", id: "accordion", icon: "🪗", title: "Звук «Баян»" },
  { day: 24, type: "melody", id: "silent", icon: "🌟", title: "Мелодия «Тихая ночь»" },
  { day: 25, type: "template", id: "matryoshka", icon: "🪆", title: "Фигурка «Матрёшка»" },
  { day: 26, type: "voice", id: "organ", icon: "⛪", title: "Звук «Орган»" },
  { day: 27, type: "weather", id: "star_rain", icon: "🌠", title: "Погода «Звёздная ночь»" },
  { day: 28, type: "template", id: "lighthouse", icon: "🗼", title: "Фигурка «Маяк»" },
  { day: 29, type: "color", id: "royal_violet", icon: "🔮", title: "Цвет «Фиалка»", hex: "#7c3aed" },
  { day: 30, type: "template", id: "rocket", icon: "🚀", title: "Фигурка «Ракета»" },
  { day: 31, type: "effect", id: "fireworks", icon: "🎆", title: "Салют над Ёлкой" },
];

export const ADVENT_WEATHER = [
  { id: "aurora_night", title: "Северное сияние", icon: "🌌", time: "night", temp: "-27°C", snow: 0.05, windSpeed: 0.2, fallSpeed: 0.5, diamondSparkle: 0.5, fogMul: 0.7, wind: 0.3, aurora: 0.9 },
  { id: "diamond_dust", title: "Алмазная пыль", icon: "💎", time: "morning", temp: "-31°C", snow: 0.25, windSpeed: 0.15, fallSpeed: 0.3, diamondSparkle: 1.0, fogMul: 0.9, wind: 0.2 },
  { id: "pink_sunset", title: "Розовый закат", icon: "🌇", time: "evening", temp: "-8°C", snow: 0.08, windSpeed: 0.3, fallSpeed: 0.6, diamondSparkle: 0.5, fogMul: 0.8, wind: 0.4 },
  { id: "star_rain", title: "Звёздная ночь", icon: "🌠", time: "night", temp: "-15°C", snow: 0.0, windSpeed: 0.2, fallSpeed: 0.5, diamondSparkle: 0.6, fogMul: 0.6, wind: 0.3, aurora: 0.35 },
];

export const ADVENT_TEMPLATES = TEMPLATES;

// --- дата и состояние ------------------------------------------------------
/** Какой день декабря сейчас по Москве (0 — декабрь ещё не наступил, 32 — уже прошёл). */
export function adventToday(nowMs = Date.now()) {
  if (typeof window !== "undefined") {
    const override = Number(new URLSearchParams(window.location.search).get("advent_day"));
    if (override >= 0 && override <= 32 && window.location.search.includes("advent_day")) return override;
  }
  const msk = new Date(nowMs + 3 * 3600 * 1000);
  const y = msk.getUTCFullYear();
  const m = msk.getUTCMonth();
  const d = msk.getUTCDate();
  if (y < ADVENT_YEAR || (y === ADVENT_YEAR && m < 11)) return 0;
  if (y > ADVENT_YEAR) return 32;
  return d;
}

export function daysUntilAdvent(nowMs = Date.now()) {
  const start = Date.UTC(ADVENT_YEAR, 11, 1) - 3 * 3600 * 1000; // 00:00 МСК 1 декабря
  return Math.max(0, Math.ceil((start - nowMs) / 86400000));
}

export function loadOpened() {
  try {
    const arr = JSON.parse(localStorage.getItem(OPENED_KEY) || "[]");
    return new Set(Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n)) : []);
  } catch {
    return new Set();
  }
}

export function saveOpened(set) {
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify([...set].sort((a, b) => a - b)));
  } catch {
    /* хранилище недоступно */
  }
}

/** Предметы, которые мастер уже получил (открыл окошко в свой день или позже). */
export function unlockedItems(opened, today) {
  const items = ADVENT_DAYS.filter((d) => d.day <= today && opened.has(d.day));
  return {
    templates: items.filter((d) => d.type === "template").map((d) => ({ id: `advent_${d.id}`, title: `${d.icon} ${d.title.replace(/^Фигурка «(.*)»$/, "$1")}`, blocks: TEMPLATES[d.id] })),
    voices: items.filter((d) => d.type === "voice").map((d) => ADVENT_VOICES.find((v) => v.id === d.id)).filter(Boolean),
    colors: items.filter((d) => d.type === "color").map((d) => ({ id: d.id, name: d.title.replace(/^Цвет «(.*)»$/, "$1"), hex: d.hex })),
    weather: items.filter((d) => d.type === "weather").map((d) => ADVENT_WEATHER.find((w) => w.id === d.id)).filter(Boolean),
    melodies: items.filter((d) => d.type === "melody").map((d) => ({ id: d.id, ...ADVENT_MELODIES[d.id] })),
    garlands: items.filter((d) => d.type === "garland").map((d) => d.id),
    fireworks: items.some((d) => d.type === "effect"),
  };
}

/** Серия: сколько дней подряд (до сегодняшнего) окошко открыто. */
export function adventStreak(opened, today) {
  let n = 0;
  for (let d = Math.min(today, 31); d >= 1 && opened.has(d); d--) n++;
  return n;
}
