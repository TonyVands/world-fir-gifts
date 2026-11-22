// Мелодии и «энергия жизни» для шаров памяти.
// Ноты — индексы шкатулки Ёлки (NOTE_FREQUENCIES в App.jsx):
// 1 C4 · 2 D4 · 3 E4 · 15 F4 · 16 F#4 · 4 G4 · 17 G#4 · 5 A4 · 6 B4 ·
// 7 C5 · 8 D5 · 9 E5 · 18 F5 · 10 G5 · 11 A5 · 12 B5 · 13 C6 · 14 D6
// Виолончель звучит октавой ниже. 16 шагов = два такта восьмыми, играется по кругу.
// Классика — мотивы произведений в общественном достоянии, переложенные для шкатулки.
// Список id совпадает с app/services/memorial.py → MELODIES.

const Z = () => new Array(16).fill(0);

export const MEMORIAL_MELODIES = [
  {
    id: "moonlight",
    title: "Лунная соната",
    author: "мотив Л. ван Бетховена",
    tempo: 60,
    celesta: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 9],
    harp: [5, 7, 9, 5, 7, 9, 5, 7, 5, 7, 18, 5, 7, 18, 17, 6],
    cello: [5, 0, 0, 0, 0, 0, 0, 0, 15, 0, 0, 0, 3, 0, 0, 0],
    flute: Z(),
  },
  {
    id: "chopin_prelude",
    title: "Прелюдия ми минор",
    author: "мотив Ф. Шопена",
    tempo: 56,
    celesta: Z(),
    harp: [7, 9, 7, 9, 7, 9, 7, 9, 6, 9, 6, 9, 6, 8, 6, 8],
    cello: [5, 0, 0, 0, 5, 0, 0, 0, 5, 0, 0, 0, 17, 0, 0, 0],
    flute: [9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 18, 0, 9, 0],
  },
  {
    id: "bach_air",
    title: "Ария",
    author: "мотив И. С. Баха",
    tempo: 58,
    celesta: Z(),
    harp: [0, 9, 0, 0, 0, 8, 0, 0, 0, 7, 0, 0, 0, 6, 0, 0],
    cello: [7, 0, 7, 0, 6, 0, 6, 0, 5, 0, 5, 0, 4, 0, 4, 0],
    flute: [9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11, 18, 8, 7, 6, 7],
  },
  {
    id: "brahms_lullaby",
    title: "Колыбельная",
    author: "мотив И. Брамса",
    tempo: 76,
    celesta: [9, 9, 10, 0, 9, 9, 10, 0, 9, 10, 13, 12, 11, 0, 11, 10],
    harp: [1, 3, 4, 3, 1, 3, 4, 3, 2, 15, 4, 15, 2, 15, 4, 15],
    cello: [1, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0],
    flute: Z(),
  },
  {
    id: "quiet_candle",
    title: "Тихая свеча",
    author: "мелодия Ёлки мира",
    tempo: 60,
    celesta: [9, 0, 8, 7, 6, 0, 7, 0, 5, 0, 0, 0, 6, 0, 0, 0],
    harp: [5, 9, 11, 9, 5, 9, 11, 9, 8, 18, 11, 18, 17, 6, 9, 6],
    cello: [5, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0],
    flute: Z(),
  },
  {
    id: "warm_light",
    title: "Тёплый свет",
    author: "мелодия Ёлки мира",
    tempo: 72,
    celesta: [7, 0, 9, 0, 10, 0, 9, 8, 7, 0, 8, 9, 8, 0, 0, 0],
    harp: [1, 4, 7, 9, 1, 4, 7, 9, 15, 5, 7, 18, 4, 6, 8, 10],
    cello: [1, 0, 0, 0, 1, 0, 0, 0, 15, 0, 0, 0, 4, 0, 0, 0],
    flute: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 9, 7],
  },
  {
    id: "snow_city",
    title: "Снег над городом",
    author: "мелодия Ёлки мира",
    tempo: 66,
    celesta: [13, 0, 0, 12, 0, 0, 11, 0, 0, 10, 0, 0, 9, 0, 0, 0],
    harp: [5, 7, 9, 7, 5, 7, 9, 7, 4, 6, 8, 6, 3, 17, 6, 17],
    cello: [5, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 3, 0, 0, 0],
    flute: Z(),
  },
  {
    id: "way_home",
    title: "Дорога домой",
    author: "мелодия Ёлки мира",
    tempo: 80,
    celesta: Z(),
    harp: [1, 4, 7, 4, 5, 7, 9, 7, 15, 5, 7, 5, 4, 6, 8, 6],
    cello: [1, 0, 0, 0, 5, 0, 0, 0, 15, 0, 0, 0, 4, 0, 0, 0],
    flute: [9, 0, 10, 0, 11, 0, 10, 9, 8, 0, 9, 0, 7, 0, 0, 0],
  },
];

export const melodyById = (id) => MEMORIAL_MELODIES.find((m) => m.id === id) || MEMORIAL_MELODIES[4];

// «Жизненная энергия» — свет, который кружит внутри шара вокруг портрета
export const MEMORIAL_ENERGIES = [
  { id: "light", title: "Свет", color: "#cfe6ff" },
  { id: "warm", title: "Тепло", color: "#ffb35c" },
  { id: "love", title: "Любовь", color: "#ff8fb3" },
  { id: "wisdom", title: "Мудрость", color: "#b79cff" },
  { id: "nature", title: "Природа", color: "#8fe3a1" },
  { id: "strength", title: "Сила", color: "#ff7a4a" },
  { id: "sea", title: "Море", color: "#6fd3ff" },
];

export const energyById = (id) => MEMORIAL_ENERGIES.find((e) => e.id === id) || MEMORIAL_ENERGIES[0];

// ---------------------------------------------------------------------------
// Своя мелодия близких. Все ноты — пентатоника до мажора: любое сочетание звучит мягко.
// Ряды сверху вниз: D6 C6 A5 G5 E5 D5 C5 A4 G4 E4 D4 C4. Бэкенд принимает только эти тембры.
// ---------------------------------------------------------------------------
export const CUSTOM_ROWS = [
  { note: 14, label: "D6" },
  { note: 13, label: "C6" },
  { note: 11, label: "A5" },
  { note: 10, label: "G5" },
  { note: 9, label: "E5" },
  { note: 8, label: "D5" },
  { note: 7, label: "C5" },
  { note: 5, label: "A4" },
  { note: 4, label: "G4" },
  { note: 3, label: "E4" },
  { note: 2, label: "D4" },
  { note: 1, label: "C4" },
];

export const CUSTOM_TRACKS = [
  { slot: "celesta", key: "celesta", title: "Мотив", hint: "главная мелодия", color: "#ffd98a" },
  { slot: "harp", key: "harp", title: "Аккомпанемент", hint: "плавный перебор", color: "#9fd0ff" },
  { slot: "cello", key: "cello", title: "Бас", hint: "долгие низкие ноты", color: "#ff9fb8" },
  { slot: "flute", key: "flute", title: "Голос", hint: "тихая линия сверху", color: "#a8f0c0" },
];

export const CUSTOM_VOICES = {
  celesta: [["celesta", "Челеста"], ["musicbox", "Шкатулка"], ["piano", "Пианино"], ["bells", "Колокольчики"]],
  harp: [["harp", "Арфа"], ["guitar", "Гитара"], ["piano", "Пианино"], ["epiano", "Электропиано"]],
  cello: [["cello", "Виолончель"], ["strings", "Струнные"], ["pad", "Пэд"], ["bass", "Бас"]],
  flute: [["flute", "Флейта"], ["choir", "Хор"], ["pad", "Пэд"], ["clarinet", "Кларнет"], ["violin", "Скрипка"]],
};

export const CUSTOM_TEMPO = [60, 92];

// Заготовки: запускают сочинение, чтобы не начинать с тишины
export const CUSTOM_STARTERS = [
  {
    title: "Спокойный перебор",
    tempo: 66,
    harp: [1, 0, 4, 0, 7, 0, 4, 0, 2, 0, 5, 0, 8, 0, 5, 0],
    cello: [1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    title: "Светлая нота",
    tempo: 72,
    celesta: [9, 0, 0, 10, 0, 0, 9, 0, 8, 0, 0, 7, 0, 0, 0, 0],
    cello: [1, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    title: "Длинные голоса",
    tempo: 60,
    flute: [10, 0, 0, 0, 9, 0, 0, 0, 8, 0, 0, 0, 7, 0, 0, 0],
    cello: [1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
  },
];

export const emptyCustom = () => ({
  tempo: 68,
  celesta: Z(),
  harp: Z(),
  cello: Z(),
  flute: Z(),
  voices: { celesta: "celesta", harp: "harp", cello: "cello", flute: "flute" },
});

export const customNoteCount = (c) =>
  c ? ["celesta", "harp", "cello", "flute"].reduce((n, k) => n + (c[k] || []).filter((v) => v > 0).length, 0) : 0;

// → тело для API (melody_custom)
export const customToApi = (c) => ({
  tempo_bpm: c.tempo,
  celesta_track: c.celesta,
  harp_track: c.harp,
  cello_track: c.cello,
  flute_track: c.flute,
  voices: c.voices,
});

// ← из ответа API в форму, понятную плееру
export const customFromApi = (api) => ({
  id: "custom",
  title: "Мелодия близких",
  author: "сочинена своими руками",
  tempo: api.tempo_bpm,
  celesta: api.celesta_track,
  harp: api.harp_track,
  cello: api.cello_track,
  flute: api.flute_track,
  voices: api.voices || {},
});

// Готовая или своя мелодия по данным памяти
export const resolveMelody = (id, customApi) => (id === "custom" && customApi ? customFromApi(customApi) : melodyById(id));
