import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { HorizontalTiltShiftShader } from "three/examples/jsm/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/examples/jsm/shaders/VerticalTiltShiftShader.js";
import { createRealisticFir, createCapLoopGeometry } from "./scene/realisticFir.js";
import { createClearing } from "./scene/clearing.js";
import { TIME_OF_DAY, WEATHER_PRESETS, createAtmosphereController } from "./scene/atmosphere.js";
import { createFireworks3D } from "./scene/fireworks3d.js";
import { CHIMES_LEAD_S } from "./lib/bells.js";
const MidnightShow = React.lazy(() => import("./ui/MidnightShow.jsx"));
import { computeDeterministicGenomeHash } from "./lib/genome.js";
import { inspectVoxelGeometrySafety } from "./lib/voxelSafety.js";
import { inspectContentSafety, normalizeForModeration } from "./lib/moderation.js";
import {
  ADVENT_DAYS,
  ADVENT_VOICES,
  ADVENT_WEATHER,
  adventStreak,
  adventToday,
  daysUntilAdvent,
  loadOpened as loadAdventOpened,
  saveOpened as saveAdventOpened,
  unlockedItems as adventUnlockedItems,
} from "./lib/advent.js";
import {
  connectTreeEvents,
  createGift as apiCreateGift,
  fetchCandleLeaders as apiFetchCandleLeaders,
  fetchCandleStatus as apiFetchCandleStatus,
  fetchAchievements as apiFetchAchievements,
  fetchCityLeaders as apiFetchCityLeaders,
  fetchMyCollection as apiFetchMyCollection,
  fetchTelegramStatus as apiFetchTelegramStatus,
  createTelegramLink as apiCreateTelegramLink,
  deleteTelegramLink as apiDeleteTelegramLink,
  fetchGifts as apiFetchGifts,
  fetchMyGift as apiFetchMyGift,
  updateGift as apiUpdateGift,
  fetchMyProfile as apiFetchMyProfile,
  fetchMyRing as apiFetchMyRing,
  fetchRingStatus as apiFetchRingStatus,
  giftNodeFromDTO,
  giveHandshakeConsent as apiGiveHandshakeConsent,
  isNetworkError,
  lightGiftCandle as apiLightGiftCandle,
  loadLitGiftIds,
  reportGift as apiReportGift,
  saveLitGiftIds,
} from "./api.js";

// ============================================================================
// 1. CONSTANTS, VOXEL BLUEPRINTS & ORCHESTRA SYNTHESIZER (v10.0 CRYSTAL ORBS)
// ============================================================================
const GOLDEN_ANGLE_RAD = Math.PI * (3.0 - Math.sqrt(5.0));
const GIFTS_PER_TIER = 12;
const MAX_INSTANCES = 500;
const MAX_TOTAL_TREE_VOXELS = 18000;
const VERTICAL_STEP_PER_GIFT = 0.42;
// Нижняя граница полёта камеры: земля (снежное поле) на y=-2.7, камера остаётся выше
const MAX_SCROLL_DEPTH = 57;
// Жёсткий барьер высоты камеры (идея из v16.1): никогда не провалиться под землю
const MIN_CAMERA_Y = -0.3;
// Масштаб подарочных хрустальных шаров — дары должны читаться крупно на большой ёлке
// v16.1: шары уменьшены (было 2.2), чтобы Ель выглядела пропорционально.
const GIFT_ORB_SCALE = 1.65;
// Зум камеры (щипок двумя пальцами / Ctrl+колесо). Минимум дополнительно
// ограничен радиусом кроны, чтобы камера не «ныряла» в ветви.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.3;
const WELCOME_SEEN_KEY = "wfg_welcome_seen_v1";
// Облик Ёлки: реалистичная процедурная ель + киношная атмосфера (v16.4 —
// по умолчанию). Прежний «конусный» вид остаётся по ссылке ?look=classic.
const LOOK_NEW =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("look") !== "classic";
const UNLOCK_TARGET_MS = new Date("2026-12-31T23:59:59Z").getTime();

// ============================================================================
// 1.1. РОЖДЕСТВЕНСКИЕ ПРЕСЕТЫ ПОГОДЫ И АТМОСФЕРЫ (v14.0)
// ============================================================================
const CHRISTMAS_ATMOSPHERE_PRESETS = [
  {
    id: "christmas_night",
    title: "🎅 Рождественская Ночь",
    temp: "-14°C",
    skyTop: "#040b1c",
    skyBottom: "#141e38",
    fogColor: "#081226",
    hemiSky: "#93c5fd",
    hemiGround: "#1e1b4b",
    dirColor: "#fef08a",
    dirIntensity: 2.4,
    auroraStrength: 1.0,
    windSpeed: 0.7,
    fallSpeed: 1.0,
    diamondSparkle: 0.4,
    frostVignette: 0.22,
  },
  {
    id: "fireplace_cozy",
    title: "🕯 Уют у Камина",
    temp: "-8°C",
    skyTop: "#1a0c18",
    skyBottom: "#361822",
    fogColor: "#1f101a",
    hemiSky: "#fde68a",
    hemiGround: "#451a03",
    dirColor: "#fbbf24",
    dirIntensity: 2.8,
    auroraStrength: 0.45,
    windSpeed: 0.4,
    fallSpeed: 0.75,
    diamondSparkle: 0.65,
    frostVignette: 0.1,
  },
  {
    id: "fluffy_blizzard",
    title: "❄️ Пушистый Снегопад",
    temp: "-18°C",
    skyTop: "#08182e",
    skyBottom: "#1e3a5f",
    fogColor: "#0f2442",
    hemiSky: "#e0f2fe",
    hemiGround: "#1e293b",
    dirColor: "#f8fafc",
    dirIntensity: 2.2,
    auroraStrength: 0.85,
    windSpeed: 1.55,
    fallSpeed: 1.45,
    diamondSparkle: 0.5,
    frostVignette: 0.45,
  },
  {
    id: "diamond_frost",
    title: "💎 Алмазный Иней",
    temp: "-32°C",
    skyTop: "#020617",
    skyBottom: "#0f172a",
    fogColor: "#061024",
    hemiSky: "#38bdf8",
    hemiGround: "#090d16",
    dirColor: "#e0f2fe",
    dirIntensity: 2.6,
    auroraStrength: 1.35,
    windSpeed: 0.5,
    fallSpeed: 0.85,
    diamondSparkle: 1.0,
    frostVignette: 0.65,
  },
  {
    id: "frosty_dawn",
    title: "🌅 Морозное Утро",
    temp: "-21°C",
    skyTop: "#1e1b4b",
    skyBottom: "#be185d",
    fogColor: "#311042",
    hemiSky: "#fbcfe8",
    hemiGround: "#1e1b4b",
    dirColor: "#fde047",
    dirIntensity: 2.9,
    auroraStrength: 0.3,
    windSpeed: 0.6,
    fallSpeed: 0.95,
    diamondSparkle: 0.8,
    frostVignette: 0.3,
  },
];

function createSnowflakeBokehTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 60);
  grad.addColorStop(0, "rgba(255, 255, 255, 1.0)");
  grad.addColorStop(0.35, "rgba(240, 249, 255, 0.85)");
  grad.addColorStop(0.7, "rgba(186, 230, 253, 0.32)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0.0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const x2 = 64 + Math.cos(angle) * 44;
    const y2 = 64 + Math.sin(angle) * 44;
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const bx = 64 + Math.cos(angle) * 26;
    const by = 64 + Math.sin(angle) * 26;
    for (const side of [-0.55, 0.55]) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(
        bx + Math.cos(angle + side) * 12,
        by + Math.sin(angle + side) * 12
      );
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createRadialGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  grad.addColorStop(0, "rgba(255, 250, 230, 1.0)");
  grad.addColorStop(0.35, "rgba(255, 214, 130, 0.55)");
  grad.addColorStop(1, "rgba(255, 190, 60, 0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createWhiteGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.9)");
  grad.addColorStop(0.4, "rgba(255, 255, 255, 0.35)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const DRUM_INSTRUMENTS = [
  { index: 6, label: "✨ Треугольник", short: "Tri" },
  { index: 5, label: "❄️ Шейкер инея", short: "Shk" },
  { index: 4, label: "🔔 Бубенцы саней", short: "Bell" },
  { index: 3, label: "🪵 Римшот (Щелчок)", short: "Rim" },
  { index: 2, label: "🥁 Мягкий Малый", short: "Snr" },
  { index: 1, label: "💓 Тёплая Бочка", short: "Kick" },
  { index: 0, label: "— Пауза", short: "—" },
];

const DRUM_GROOVE_PRESETS = [
  {
    id: "sleigh_bells",
    title: "🔔 Снежные бубенцы",
    pattern: [1, 4, 5, 4, 2, 4, 5, 4, 1, 4, 5, 4, 2, 4, 6, 4],
  },
  {
    id: "nutcracker_march",
    title: "👑 Марш Щелкунчика",
    pattern: [1, 0, 3, 3, 2, 0, 4, 0, 1, 1, 3, 0, 2, 3, 6, 0],
  },
  {
    id: "lofi_hearth",
    title: "🕯️ Lo-Fi Уют у камина",
    pattern: [1, 5, 4, 5, 2, 5, 1, 4, 1, 5, 4, 5, 2, 5, 3, 6],
  },
  {
    id: "crystal_waltz",
    title: "❄️ Хрустальный вальс",
    pattern: [1, 4, 4, 2, 4, 4, 1, 4, 4, 2, 6, 4, 1, 4, 4, 6],
  },
  {
    id: "polar_pulse",
    title: "💓 Полярный пульс",
    pattern: [1, 5, 2, 5, 1, 1, 2, 4, 1, 5, 2, 5, 1, 3, 2, 6],
  },
];

const NOTE_FREQUENCIES = {
  0: 0,
  1: 261.63,  // C4
  2: 293.66,  // D4
  3: 329.63,  // E4
  4: 392.0,   // G4
  5: 440.0,   // A4
  6: 493.88,  // B4
  7: 523.25,  // C5
  8: 587.33,  // D5
  9: 659.25,  // E5
  10: 783.99, // G5
  11: 880.0,  // A5
  12: 987.77, // B5
  13: 1046.5, // C6
  14: 1174.66,// D6
  15: 349.23, // F4 (Субдоминанта / Миксолидийский)
  16: 369.99, // F#4 (Сказочный Лидийский IV#)
  17: 415.3,  // G#4 (Зимний Гармонический минор VII#)
  18: 698.46, // F5 (Верхняя субдоминанта)
};

const NOTE_META = [
  { index: 14, label: "D6" },
  { index: 13, label: "C6" },
  { index: 12, label: "B5" },
  { index: 11, label: "A5" },
  { index: 10, label: "G5" },
  { index: 18, label: "F5" },
  { index: 9, label: "E5" },
  { index: 8, label: "D5" },
  { index: 7, label: "C5" },
  { index: 6, label: "B4" },
  { index: 5, label: "A4" },
  { index: 17, label: "G#4" },
  { index: 4, label: "G4" },
  { index: 16, label: "F#4" },
  { index: 15, label: "F4" },
  { index: 3, label: "E4" },
  { index: 2, label: "D4" },
  { index: 1, label: "C4" },
  { index: 0, label: "Пауза" },
];

const SCALE_MODES = [
  {
    id: "pentatonic",
    title: "✨ Хрустальная Пентатоника",
    badge: "Безошибочный",
    mood: "Чистая волшебная шкатулка без резких полутонов — любые нажатые ноты звучат идеально",
    notes: [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14],
  },
  {
    id: "c_major",
    title: "☀️ Светлый Мажор (Ионийский)",
    badge: "Радость и гимн",
    mood: "Лучезарный, открытый праздничный строй новогоднего утра и солнечного инея",
    notes: [1, 2, 3, 15, 4, 5, 6, 7, 8, 9, 18, 10, 11, 12, 13, 14],
  },
  {
    id: "a_minor",
    title: "🌙 Северный Минор (Эолийский)",
    badge: "Зимняя лирика",
    mood: "Глубокая арктическая сказка, полярная ночь и тёплый свет далёкого маяка",
    notes: [3, 15, 4, 5, 6, 7, 8, 9, 18, 10, 11, 12, 13],
  },
  {
    id: "dorian",
    title: "❄️ Скандинавский Дорийский",
    badge: "Северный эпос",
    mood: "Старинный былинный лад северных мореплавателей со светлой VI ступенью надежды",
    notes: [2, 3, 15, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14],
  },
  {
    id: "lydian",
    title: "🪄 Сказочный Лидийский (IV#)",
    badge: "Магия кино",
    mood: "Высокая IV# ступень (F#) создаёт ощущение чуда, полёта совы и звёздного волшебства",
    notes: [1, 2, 3, 16, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  },
  {
    id: "harmonic_minor",
    title: "👑 Зимний Гармонический (Щелкунчик)",
    badge: "Классика Чайковского",
    mood: "Утончённая барочная и классическая таинственность с острой вводной ступенью G#",
    notes: [3, 15, 17, 5, 6, 7, 8, 9, 18, 11, 12, 13],
  },
  {
    id: "mixolydian",
    title: "🕯️ Полярный Миксолидийский",
    badge: "Тёплый хоровод",
    mood: "Уютный ярмарочный и балладный строй с мягкой низкой VII ступенью",
    notes: [1, 2, 3, 15, 4, 5, 7, 8, 9, 18, 10, 11, 13, 14],
  },
  {
    id: "phrygian",
    title: "💎 Хрупкий Фригийский",
    badge: "Ледяной кристалл",
    mood: "Загадочное мерцание ледяных пещер и хрустальных граней на морозе",
    notes: [3, 15, 4, 5, 6, 7, 9, 18, 10, 11, 12, 13],
  },
];

// 12 секторов Квинто-Квартового Круга (по часовой стрелке — шаг в чистую квинту)
const CIRCLE_OF_FIFTHS_SECTORS = [
  {
    idx: 0,
    major: "C",
    minor: "Am",
    majorTitle: "До мажор (C)",
    minorTitle: "Ля минор (Am)",
    majorVoicing: { cello: 1, harp: [1, 3, 4, 7], flute: 9, celesta: [7, 9, 10, 13] },
    minorVoicing: { cello: 5, harp: [5, 7, 9, 11], flute: 11, celesta: [11, 9, 7, 9] },
  },
  {
    idx: 1,
    major: "G",
    minor: "Em",
    majorTitle: "Соль мажор (G)",
    minorTitle: "Ми минор (Em)",
    majorVoicing: { cello: 4, harp: [4, 6, 8, 10], flute: 10, celesta: [10, 12, 14, 10] },
    minorVoicing: { cello: 3, harp: [3, 4, 6, 9], flute: 9, celesta: [9, 10, 12, 9] },
  },
  {
    idx: 2,
    major: "D",
    minor: "Bm",
    majorTitle: "Ре мажор (D)",
    minorTitle: "Си минор (Bm)",
    majorVoicing: { cello: 2, harp: [2, 16, 5, 8], flute: 8, celesta: [8, 11, 14, 11] },
    minorVoicing: { cello: 6, harp: [6, 8, 16, 12], flute: 12, celesta: [12, 8, 11, 8] },
  },
  {
    idx: 3,
    major: "A",
    minor: "F#m",
    majorTitle: "Ля мажор (A)",
    minorTitle: "Фа# минор (F#m)",
    majorVoicing: { cello: 5, harp: [5, 17, 9, 11], flute: 11, celesta: [11, 9, 13, 11] },
    minorVoicing: { cello: 16, harp: [16, 5, 7, 11], flute: 11, celesta: [11, 7, 9, 11] },
  },
  {
    idx: 4,
    major: "E",
    minor: "C#m",
    majorTitle: "Ми мажор (E)",
    minorTitle: "До# минор (C#m)",
    majorVoicing: { cello: 3, harp: [3, 17, 6, 9], flute: 9, celesta: [9, 12, 17, 9] },
    minorVoicing: { cello: 3, harp: [3, 4, 7, 9], flute: 9, celesta: [9, 7, 10, 9] },
  },
  {
    idx: 5,
    major: "B",
    minor: "G#m",
    majorTitle: "Си мажор (B)",
    minorTitle: "Соль# минор (G#m)",
    majorVoicing: { cello: 6, harp: [6, 16, 9, 12], flute: 12, celesta: [12, 9, 11, 12] },
    minorVoicing: { cello: 17, harp: [17, 6, 9, 12], flute: 12, celesta: [12, 17, 9, 12] },
  },
  {
    idx: 6,
    major: "F#",
    minor: "D#m",
    majorTitle: "Фа# мажор (F#)",
    minorTitle: "Ре# минор (D#m)",
    majorVoicing: { cello: 16, harp: [16, 5, 17, 11], flute: 11, celesta: [16, 11, 13, 11] },
    minorVoicing: { cello: 2, harp: [2, 16, 5, 8], flute: 8, celesta: [8, 16, 11, 8] },
  },
  {
    idx: 7,
    major: "Db",
    minor: "Bbm",
    majorTitle: "Реb мажор (Db)",
    minorTitle: "Сиb минор (Bbm)",
    majorVoicing: { cello: 1, harp: [1, 15, 17, 7], flute: 18, celesta: [7, 18, 10, 13] },
    minorVoicing: { cello: 5, harp: [5, 7, 18, 11], flute: 18, celesta: [11, 18, 7, 11] },
  },
  {
    idx: 8,
    major: "Ab",
    minor: "Fm",
    majorTitle: "Ляb мажор (Ab)",
    minorTitle: "Фа минор (Fm)",
    majorVoicing: { cello: 17, harp: [17, 7, 8, 13], flute: 13, celesta: [17, 7, 13, 10] },
    minorVoicing: { cello: 15, harp: [15, 17, 7, 18], flute: 18, celesta: [18, 7, 17, 7] },
  },
  {
    idx: 9,
    major: "Eb",
    minor: "Cm",
    majorTitle: "Миb мажор (Eb)",
    minorTitle: "До минор (Cm)",
    majorVoicing: { cello: 2, harp: [2, 4, 5, 8], flute: 10, celesta: [8, 10, 11, 14] },
    minorVoicing: { cello: 1, harp: [1, 2, 4, 7], flute: 10, celesta: [7, 10, 8, 7] },
  },
  {
    idx: 10,
    major: "Bb",
    minor: "Gm",
    majorTitle: "Сиb мажор (Bb)",
    minorTitle: "Соль минор (Gm)",
    majorVoicing: { cello: 5, harp: [5, 2, 15, 8], flute: 8, celesta: [8, 18, 11, 14] },
    minorVoicing: { cello: 4, harp: [4, 5, 8, 10], flute: 10, celesta: [10, 8, 18, 10] },
  },
  {
    idx: 11,
    major: "F",
    minor: "Dm",
    majorTitle: "Фа мажор (F)",
    minorTitle: "Ре минор (Dm)",
    majorVoicing: { cello: 15, harp: [15, 5, 7, 18], flute: 18, celesta: [18, 11, 13, 18] },
    minorVoicing: { cello: 2, harp: [2, 15, 5, 8], flute: 18, celesta: [8, 18, 11, 8] },
  },
];

// Обучающие формулы великих композиторов на Квинто-Квартовом круге
const GUIDED_CIRCLE_PROGRESSIONS = [
  {
    id: "canon_light",
    title: "🌟 Канон Света (I → V → vi → IV)",
    formula: "Тоника (Дом) → Доминанта (Взлёт) → Параллельный минор (Душа) → Субдоминанта (Тепло)",
    steps: [
      { sectorIdx: 0, ring: "major", role: "I (Тоника)" },
      { sectorIdx: 1, ring: "major", role: "V (Доминанта)" },
      { sectorIdx: 0, ring: "minor", role: "vi (Паралл. минор)" },
      { sectorIdx: 11, ring: "major", role: "IV (Субдоминанта)" },
    ],
  },
  {
    id: "northern_ballad",
    title: "❄️ Северная Баллада (vi → IV → I → V)",
    formula: "Начинается с лирического минора и раскрывается в широком мажорном припеве",
    steps: [
      { sectorIdx: 0, ring: "minor", role: "vi (Минорный зачин)" },
      { sectorIdx: 11, ring: "major", role: "IV (Субдоминанта)" },
      { sectorIdx: 0, ring: "major", role: "I (Светлая Тоника)" },
      { sectorIdx: 1, ring: "major", role: "V (Доминанта)" },
    ],
  },
  {
    id: "classical_cadence",
    title: "👑 Классический Каданс (I → IV → V → I)",
    formula: "Фундамент европейской классики: шаг против часовой (S), шаг по часовой (D) и возврат домой (T)",
    steps: [
      { sectorIdx: 0, ring: "major", role: "I (Тоника)" },
      { sectorIdx: 11, ring: "major", role: "IV (Квартовый шаг S)" },
      { sectorIdx: 1, ring: "major", role: "V (Квинтовый шаг D)" },
      { sectorIdx: 0, ring: "major", role: "I (Разрешение в Дом)" },
    ],
  },
  {
    id: "fairytale_turn",
    title: "🪄 Сказочный Оборот (IV → V → iii → vi)",
    formula: "Любимая прогрессия японских и зимних анимационных сказок — плавное скольжение по кругу",
    steps: [
      { sectorIdx: 11, ring: "major", role: "IV (Мечта)" },
      { sectorIdx: 1, ring: "major", role: "V (Взлёт)" },
      { sectorIdx: 1, ring: "minor", role: "iii (Тайна)" },
      { sectorIdx: 0, ring: "minor", role: "vi (Уютное эхо)" },
    ],
  },
];

export function quantizeTrackToScale(track, scaleId) {
  const scaleObj = SCALE_MODES.find((s) => s.id === scaleId) || SCALE_MODES[0];
  const allowed = scaleObj.notes;
  return normalizeTrackTo16Steps(track).map((noteIdx) => {
    if (!noteIdx || noteIdx <= 0) return 0;
    if (allowed.includes(noteIdx)) return noteIdx;
    const targetFreq = NOTE_FREQUENCIES[noteIdx] || 440;
    let bestNote = allowed[0];
    let minDiff = Infinity;
    for (const candidate of allowed) {
      const diff = Math.abs((NOTE_FREQUENCIES[candidate] || 440) - targetFreq);
      if (diff < minDiff) {
        minDiff = diff;
        bestNote = candidate;
      }
    }
    return bestNote;
  });
}

function build16StepTracksFrom4Bars(barSlots, currentDrums = null) {
  const celesta = Array(16).fill(0);
  const harp = Array(16).fill(0);
  const cello = Array(16).fill(0);
  const flute = Array(16).fill(0);
  const drums =
    currentDrums && currentDrums.some((d) => d > 0)
      ? normalizeTrackTo16Steps(currentDrums)
      : [...DRUM_GROOVE_PRESETS[0].pattern];

  barSlots.forEach((slot, barIdx) => {
    const sector =
      CIRCLE_OF_FIFTHS_SECTORS[slot.sectorIdx % 12] ||
      CIRCLE_OF_FIFTHS_SECTORS[0];
    const voicing =
      slot.ring === "minor" ? sector.minorVoicing : sector.majorVoicing;
    const offset = barIdx * 4;

    cello[offset] = voicing.cello;
    cello[offset + 2] = barIdx === 3 ? voicing.cello : 0;

    for (let i = 0; i < 4; i++) {
      harp[offset + i] = voicing.harp[i % voicing.harp.length];
      celesta[offset + i] =
        i === 3 && barIdx === 3
          ? voicing.celesta[0]
          : voicing.celesta[i % voicing.celesta.length];
    }

    flute[offset + 1] = voicing.flute;
    flute[offset + 3] = barIdx % 2 === 0 ? voicing.flute : 0;
  });

  return { celesta, harp, cello, flute, drums };
}

const ORCHESTRA_INSTRUMENTS = [
  {
    id: "celesta",
    title: "🔔 Челеста",
    subtitle: "Колокольчики",
    colorClass: "bg-amber-400 border-amber-200 text-slate-950",
  },
  {
    id: "harp",
    title: "🪕 Арфа",
    subtitle: "Щипковый перебор",
    colorClass: "bg-sky-400 border-sky-200 text-slate-950",
  },
  {
    id: "cello",
    title: "🎻 Виолончель",
    subtitle: "Бархатный смычок",
    colorClass: "bg-rose-500 border-rose-200 text-white",
  },
  {
    id: "flute",
    title: "🪈 Флейта",
    subtitle: "Деревянное соло",
    colorClass: "bg-emerald-400 border-emerald-200 text-slate-950",
  },
  {
    id: "drums",
    title: "🥁 Барабаны",
    subtitle: "Ритм и бубенцы",
    colorClass: "bg-purple-400 border-purple-200 text-slate-950",
  },
];

function normalizeTrackTo16Steps(track = []) {
  if (!Array.isArray(track) || track.length === 0) {
    return Array(16).fill(0);
  }
  if (track.length >= 16) {
    return track.slice(0, 16);
  }
  if (track.length === 8) {
    return [...track, ...track];
  }
  const padded = [...track];
  while (padded.length < 16) {
    padded.push(track[padded.length % track.length] || 0);
  }
  return padded;
}

const VOXEL_PALETTE = [
  { id: "gold", name: "Золото", hex: "#fbbf24", emissive: true },
  { id: "ruby", name: "Рубин", hex: "#e11d48", emissive: false },
  { id: "pine", name: "Хвоя", hex: "#059669", emissive: false },
  { id: "snow", name: "Снег", hex: "#f8fafc", emissive: false },
  { id: "ice", name: "Сияющий лёд", hex: "#38bdf8", emissive: true },
  { id: "wood", name: "Кедр", hex: "#92400e", emissive: false },
  { id: "amber", name: "Янтарь", hex: "#f97316", emissive: true },
  { id: "amethyst", name: "Аметист", hex: "#a855f7", emissive: true },
  { id: "obsidian", name: "Обсидиан", hex: "#1e293b", emissive: false },
];

function buildVoxelPreset(presetId) {
  const blocks = [];
  const add = (x, y, z, color) => blocks.push({ x, y, z, color });

  if (presetId === "pine_tree") {
    for (let y = 0; y < 2; y++) {
      add(3, y, 3, "#92400e");
      add(4, y, 3, "#92400e");
      add(3, y, 4, "#92400e");
      add(4, y, 4, "#92400e");
    }
    for (let x = 1; x <= 6; x++)
      for (let z = 1; z <= 6; z++) add(x, 2, z, "#059669");
    for (let x = 2; x <= 5; x++)
      for (let z = 2; z <= 5; z++) {
        add(x, 3, z, "#059669");
        add(x, 4, z, "#10b981");
      }
    for (let x = 3; x <= 4; x++)
      for (let z = 3; z <= 4; z++) {
        add(x, 5, z, "#10b981");
        add(x, 6, z, "#f8fafc");
      }
    add(3, 7, 3, "#fbbf24");
    add(4, 7, 4, "#fbbf24");
    add(1, 2, 1, "#e11d48");
    add(6, 2, 6, "#fbbf24");
    add(2, 4, 5, "#38bdf8");
  } else if (presetId === "snowman") {
    for (let x = 2; x <= 5; x++)
      for (let z = 2; z <= 5; z++) {
        add(x, 0, z, "#f8fafc");
        add(x, 1, z, "#f8fafc");
        add(x, 2, z, "#f8fafc");
      }
    for (let x = 2; x <= 5; x++)
      for (let z = 2; z <= 5; z++) add(x, 3, z, "#e11d48");
    for (let x = 3; x <= 4; x++)
      for (let z = 3; z <= 4; z++) {
        add(x, 4, z, "#f8fafc");
        add(x, 5, z, "#f8fafc");
      }
    add(3, 4, 5, "#f97316");
    add(3, 5, 5, "#1e293b");
    add(4, 5, 5, "#1e293b");
    for (let x = 2; x <= 5; x++)
      for (let z = 2; z <= 5; z++) add(x, 6, z, "#1e293b");
    add(3, 7, 3, "#fbbf24");
    add(4, 7, 4, "#fbbf24");
  } else if (presetId === "train") {
    for (let z = 1; z <= 6; z++) {
      add(2, 0, z, "#1e293b");
      add(5, 0, z, "#1e293b");
      for (let x = 2; x <= 5; x++) add(x, 1, z, "#e11d48");
    }
    for (let x = 2; x <= 5; x++)
      for (let y = 2; y <= 4; y++) {
        add(x, y, 1, "#fbbf24");
        add(x, y, 2, "#fbbf24");
      }
    for (let x = 3; x <= 4; x++)
      for (let z = 3; z <= 6; z++) {
        add(x, 2, z, "#1e293b");
        add(x, 3, z, "#1e293b");
      }
    add(3, 4, 5, "#fbbf24");
    add(3, 5, 5, "#f8fafc");
    add(3, 6, 4, "#f8fafc");
    add(4, 7, 3, "#38bdf8");
  } else if (presetId === "star_heart") {
    const coords = [
      [3, 1, 3], [4, 1, 3],
      [2, 2, 3], [3, 2, 3], [4, 2, 3], [5, 2, 3],
      [1, 3, 3], [2, 3, 3], [3, 3, 3], [4, 3, 3], [5, 3, 3], [6, 3, 3],
      [1, 4, 3], [2, 4, 3], [3, 4, 3], [4, 4, 3], [5, 4, 3], [6, 4, 3],
      [2, 5, 3], [3, 5, 3], [4, 5, 3], [5, 5, 3],
      [2, 6, 3], [5, 6, 3],
    ];
    coords.forEach(([x, y, z]) => {
      add(x, y, z, "#e11d48");
      add(x, y, z + 1, "#fbbf24");
    });
    add(3, 3, 2, "#38bdf8");
    add(4, 4, 5, "#38bdf8");
  } else {
    for (let x = 1; x <= 6; x++)
      for (let z = 1; z <= 6; z++) add(x, 0, z, "#f8fafc");
    for (let y = 1; y <= 3; y++) {
      for (let x = 2; x <= 5; x++)
        for (let z = 2; z <= 5; z++) {
          const isWindow =
            y === 2 && (x === 2 || x === 5 || z === 2 || z === 5);
          add(x, y, z, isWindow ? "#fbbf24" : "#92400e");
        }
    }
    for (let x = 1; x <= 6; x++)
      for (let z = 1; z <= 6; z++) add(x, 4, z, "#e11d48");
    for (let x = 2; x <= 5; x++)
      for (let z = 2; z <= 5; z++) add(x, 5, z, "#f8fafc");
    for (let x = 3; x <= 4; x++)
      for (let z = 3; z <= 4; z++) add(x, 6, z, "#f8fafc");
    add(5, 5, 5, "#92400e");
    add(5, 6, 5, "#92400e");
    add(5, 7, 5, "#38bdf8");
  }
  return blocks;
}

const VOXEL_BLUEPRINTS = [
  { id: "cottage", title: "🏡 Лесной терем", blocks: buildVoxelPreset("cottage") },
  { id: "pine_tree", title: "🎄 Ёлка с игрушками", blocks: buildVoxelPreset("pine_tree") },
  { id: "snowman", title: "⛄ Снеговик в шляпе", blocks: buildVoxelPreset("snowman") },
  { id: "train", title: "🚂 Полярный экспресс", blocks: buildVoxelPreset("train") },
  { id: "star_heart", title: "💖 Рубиновое сердце", blocks: buildVoxelPreset("star_heart") },
];

// ============================================================================
// 1.2. DEEP 18+ CENSORSHIP ENGINE (3D VOXEL TOPOLOGY + TEXT NSFW GUARD)
// ============================================================================
// Правила и алгоритмы модерации вынесены в src/lib (общие с бэкендом,
// см. app/services/moderation.py). Реэкспорт — для тестов и обратной совместимости.
export { inspectVoxelGeometrySafety, inspectContentSafety, normalizeForModeration };

const BOX_SHAPES = [
  { id: "cube", title: "Классическая сфера", badge: "🔮" },
  { id: "cylinder", title: "Высокий купол", badge: "🏛️" },
  { id: "hex_prism", title: "Гранёный хрусталь", badge: "💎" },
  { id: "pyramid_box", title: "Звёздный фонарь", badge: "✨" },
];

const WAX_SEALS = [
  { id: "owl", title: "Полярная сова", symbol: "🦉" },
  { id: "snowflake", title: "Снежинка", symbol: "❄️" },
  { id: "crown", title: "Корона", symbol: "👑" },
  { id: "star", title: "Путеводная звезда", symbol: "✦" },
  { id: "compass", title: "Роза ветров", symbol: "🧭" },
];

const WAX_SEAL_MAP = Object.fromEntries(WAX_SEALS.map((w) => [w.id, w]));

const BASE_MATERIALS = [
  { id: "mahogany", title: "Красное дерево", color: "#5c2409" },
  { id: "brass", title: "Старинная латунь", color: "#b45309" },
  { id: "obsidian", title: "Звёздный обсидиан", color: "#1e293b" },
  { id: "birch", title: "Карельская берёза", color: "#d6d3d1" },
];

const BASE_MAT_COLOR_MAP = Object.fromEntries(
  BASE_MATERIALS.map((m) => [m.id, m.color])
);

const WISH_INSPIRATION_PROMPTS = [
  {
    label: "🤲 Тепло человеческих рук",
    text: "В мире, где так много машин и алгоритмов, я собрал этот снежный шар для тебя вручную — кубик за кубиком, нота за нотой. Пусть в новом году вокруг тебя всегда будет живое человеческое участие и настоящее тепло!",
  },
  {
    label: "🧭 Напутствие Навигатора",
    text: "Приветствую тебя, добрый друг! Посылаю тебе этот хрустальный шар с авторской миниатюрой как путеводный маяк сквозь зимние метели.",
  },
];

export function computeAntiSybilScoreDetails({
  wishText = "",
  wishCharCount = 0,
  uniqueWordCount = 0,
  celestaTrack = [],
  harpTrack = [],
  celloTrack = [],
  fluteTrack = [],
  drumTrack = [],
  voxelsCount = 24,
  engravingText = "",
  candlesCount = 0,
}) {
  const effectiveLen = wishText ? wishText.trim().length : wishCharCount;
  const effectiveWords = wishText
    ? new Set(wishText.trim().toLowerCase().split(/\s+/).filter(Boolean)).size
    : uniqueWordCount || Math.max(8, Math.floor(effectiveLen / 7));

  const wishScore = Math.min(effectiveLen / 12.0 + effectiveWords * 0.8, 45.0);
  const allTracks = [
    ...celestaTrack,
    ...harpTrack,
    ...celloTrack,
    ...fluteTrack,
    ...drumTrack,
  ];
  const activeNotes = allTracks.filter((n) => n > 0).length;
  const uniquePitches = new Set(allTracks.filter((n) => n > 0)).size;
  const melodyScore = Math.min(activeNotes * 0.8 + uniquePitches * 1.8, 30.0);

  const craftScore = Math.min(
    (engravingText || "").trim().length * 0.2 + Math.min(voxelsCount * 0.15, 6.0),
    10.0
  );
  const candlesBonus = Math.min(Math.log2(candlesCount + 1) * 5.0, 15.0);

  const total = Number(
    (wishScore + melodyScore + craftScore + candlesBonus).toFixed(1)
  );

  let echelon = {
    id: "crystal",
    title: "Хрустальный Эшелон",
    label: "❄️ Хрустальный Эшелон (<45)",
    colorClass: "bg-sky-950/80 text-sky-300 border-sky-400/40",
  };
  if (total >= 75) {
    echelon = {
      id: "gold",
      title: "Золотой Мастер",
      label: "🏆 Золотой Эшелон (75–100)",
      colorClass: "bg-amber-500/20 text-amber-300 border-amber-400/50",
    };
  } else if (total >= 45) {
    echelon = {
      id: "silver",
      title: "Серебряный Резонанс",
      label: "🥈 Серебряный Эшелон (45–74)",
      colorClass: "bg-emerald-950/80 text-emerald-300 border-emerald-400/40",
    };
  }

  return {
    wishScore: Number(wishScore.toFixed(1)),
    melodyScore: Number(melodyScore.toFixed(1)),
    craftScore: Number(craftScore.toFixed(1)),
    candlesBonus: Number(candlesBonus.toFixed(1)),
    total,
    echelon,
  };
}

// ============================================================================
// 1.5. NFT RELIC GENOME HASH & STANDALONE 3D HTML CAPSULE GENERATOR
// (канонический sha256-хэш общим модулем: src/lib/genome.js — паритет с бэкендом)
// ============================================================================

// /g/<id> или /?gift=<id> — ссылка на конкретный шар
function deepLinkGiftId() {
  if (typeof window === "undefined") return null;
  const m = window.location.pathname.match(/^\/g\/([0-9a-fA-F-]{8,40})\/?$/);
  return m ? m[1] : new URLSearchParams(window.location.search).get("gift");
}

const INVITE_TEXT = "Я повесил шар на Всемирную ёлку — зажги свечу 🕯";

// Ссылка «открыть этот шар на Ёлке»: /g/<id>
function giftShareUrl(gift) {
  const origin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://world-fir-timyrabdrakhimov.waw0.amvera.tech";
  return gift?.id && !gift.offline ? `${origin}/g/${encodeURIComponent(gift.id)}` : origin;
}

function buildNftRelicMetadata(gift, recipientCity = null) {
  const genomeHash = gift?.genome_hash || computeDeterministicGenomeHash(gift);
  const seq = gift?.coordinates?.sequence_number ?? 0;
  const tier = gift?.coordinates?.tier_index ?? 0;
  const voxels = gift?.snowglobe?.voxels || [];
  const uniqueColors = new Set(voxels.map((v) => v.color)).size;

  const scoreDetails = computeAntiSybilScoreDetails({
    wishCharCount: gift?.wish_char_count || 180,
    celestaTrack: gift?.melody?.celesta_track || [],
    harpTrack: gift?.melody?.harp_track || [],
    celloTrack: gift?.melody?.cello_track || [],
    fluteTrack: gift?.melody?.flute_track || [],
    voxelsCount: voxels.length,
    engravingText: gift?.snowglobe?.engraving_text || "",
    candlesCount: gift?.candles_count || 0,
  });

  const activeInstruments = [];
  const voicesMap = gift?.melody?.voices || {};
  for (const slot of ["celesta", "harp", "cello", "flute"]) {
    if ((gift?.melody?.[`${slot}_track`] || []).some((n) => n > 0)) {
      activeInstruments.push(VOICE_BY_ID[voicesMap[slot] || slot]?.name || slot);
    }
  }
  if ((gift?.melody?.drum_track || []).some((n) => n > 0))
    activeInstruments.push("Бубенцы и ритм");

  const baseMatObj =
    BASE_MATERIALS.find((b) => b.id === gift?.snowglobe?.base_material) ||
    BASE_MATERIALS[0];
  const sealObj =
    WAX_SEAL_MAP[gift?.packaging?.wax_seal_stamp] || WAX_SEALS[0];

  const tokenId = `WFG2026-${String(seq).padStart(4, "0")}-${genomeHash
    .slice(2, 8)
    .toUpperCase()}`;

  return {
    // Это не токен в блокчейне, а «паспорт» шара: метаданные в формате,
    // совместимом с ERC-721 metadata JSON, — их можно выпустить как NFT позже.
    standard: "World Fir Gifts relic passport v1 (ERC-721 metadata JSON compatible, not minted)",
    token_id: tokenId,
    genome_sha256: genomeHash,
    name: `Хрустальный Шар #${seq} • ${gift?.card_preview?.teaser_tag || "Дар Севера"}`,
    description: `Ручная работа человека на Всемирной ёлке подарков (World Fir Gifts 2026). Гравировка на подиуме: «${
      gift?.snowglobe?.engraving_text || "Свет 2026"
    }». Автор: ${gift?.card_preview?.author_display_name || "Хранитель"} (г. ${
      gift?.card_preview?.city || "Мирный"
    })${recipientCity ? ` ⇄ Получатель в г. ${recipientCity}` : ""}.`,
    external_url: giftShareUrl(gift),
    soulbound: true,
    human_crafted: true,
    edition: "1 of 1 (Hand-Crafted Voxel & 5-Track Audio Artifact)",
    attributes: [
      { trait_type: "Эшелон Света", value: scoreDetails.echelon.title },
      { trait_type: "Индекс Тепла (LightScore)", value: scoreDetails.total },
      { trait_type: "Ярус Спирали Фибоначчи", value: tier },
      { trait_type: "Слот на Мировой Ёлке", value: `#${seq}` },
      { trait_type: "Уложено 3D-вокселей", value: voxels.length },
      { trait_type: "Палитра минералов", value: `${uniqueColors} оттенков` },
      { trait_type: "Материал подиума", value: baseMatObj.title },
      {
        trait_type: "Оркестр шкатулки",
        value: activeInstruments.join(", ") || "Челеста",
      },
      {
        trait_type: "Темп симфонии",
        value: `${gift?.melody?.tempo_bpm || 104} BPM`,
      },
      { trait_type: "Сургучная печать", value: sealObj.title },
      { trait_type: "Свечей Ожидания", value: gift?.candles_count || 0 },
    ],
    onchain_genome: {
      voxels,
      base_material: gift?.snowglobe?.base_material || "mahogany",
      base_color_hex: baseMatObj.color,
      glitter_color: gift?.snowglobe?.glitter_color || "#fde047",
      engraving_text: gift?.snowglobe?.engraving_text || "Свет 2026",
      melody: gift?.melody,
    },
  };
}

// Пользовательские строки (бирка, имя, город) попадают в скачиваемый HTML —
// экранируем, чтобы «<script>» в бирке не исполнился у получателя файла.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generateStandalone3DCapsuleHtml(nftMeta) {
  // JSON внутри <script>: экранируем «<» и разделители строк, чтобы нельзя было закрыть тег.
  const genomeJson = JSON.stringify(nftMeta)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(nftMeta.name)} — 3D-открытка (${escapeHtml(nftMeta.token_id)})</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 25%, #0f172a 0%, #030712 100%);
      color: #f8fafc;
      font-family: system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      max-width: 560px;
      width: 100%;
      background: rgba(9, 18, 36, 0.92);
      border: 1px solid rgba(251, 191, 36, 0.45);
      border-radius: 24px;
      padding: 24px;
      box-shadow: 0 0 60px rgba(245, 158, 11, 0.18);
      text-align: center;
    }
    .badge {
      display: inline-block;
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.12);
      border: 1px solid rgba(251, 191, 36, 0.35);
      padding: 4px 12px;
      border-radius: 999px;
      margin-bottom: 10px;
    }
    h1 { font-size: 22px; color: #fef3c7; margin-bottom: 6px; }
    .desc { font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 16px; }
    #canvas-wrap {
      width: 300px;
      height: 300px;
      margin: 0 auto 14px;
      border-radius: 20px;
      border: 1px solid rgba(251, 191, 36, 0.3);
      background: radial-gradient(circle, #0b1528 0%, #040812 100%);
      cursor: grab;
      overflow: hidden;
    }
    .hash {
      font-family: monospace;
      font-size: 11px;
      color: #38bdf8;
      background: #020617;
      padding: 8px 10px;
      border-radius: 10px;
      word-break: break-all;
      margin-bottom: 14px;
      border: 1px solid #1e293b;
    }
    .btn {
      background: linear-gradient(90deg, #fbbf24, #f59e0b);
      color: #020617;
      border: none;
      font-weight: 700;
      padding: 12px 20px;
      border-radius: 14px;
      cursor: pointer;
      font-size: 13px;
      width: 100%;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-top: 16px;
      text-align: left;
    }
    .trait {
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 10px;
      padding: 8px 10px;
    }
    .trait-k { font-size: 10px; color: #94a3b8; text-transform: uppercase; }
    .trait-v { font-size: 12px; color: #fef08a; font-weight: 700; margin-top: 2px; }
    .link { display: block; margin-top: 14px; font-size: 12px; color: #fbbf24; }
    .offline { padding: 110px 20px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">🤲 Ручная Работа Человека • ${escapeHtml(nftMeta.token_id)}</div>
    <h1>${escapeHtml(nftMeta.name)}</h1>
    <p class="desc">${escapeHtml(nftMeta.description)}</p>
    <div id="canvas-wrap" title="Крутите шар мышью или пальцем"></div>
    <div class="hash">GENOME SHA-256: ${escapeHtml(nftMeta.genome_sha256)}</div>
    <button class="btn" id="play-btn">▶ Прослушать мелодию шкатулки</button>
    <div class="grid" id="traits"></div>
    <a class="link" href="${escapeHtml(nftMeta.external_url)}" target="_blank" rel="noopener">🎄 Открыть шар на Всемирной ёлке</a>
  </div>
  <script>
    const META = ${genomeJson};
    const traitsEl = document.getElementById("traits");
    META.attributes.slice(0, 8).forEach(a => {
      const d = document.createElement("div");
      d.className = "trait";
      const k = document.createElement("div");
      k.className = "trait-k";
      k.textContent = String(a.trait_type);
      const v = document.createElement("div");
      v.className = "trait-v";
      v.textContent = String(a.value);
      d.append(k, v);
      traitsEl.appendChild(d);
    });

    const FREQS = {0:0,1:261.63,2:293.66,3:329.63,4:392,5:440,6:493.88,7:523.25,8:587.33,9:659.25,10:783.99,11:880,12:987.77,13:1046.5,14:1174.66,15:349.23,16:369.99,17:415.3,18:698.46};
    let audioCtx = null;
    function drum(ctx, kind, t) {
      // простая «шкатулочная» перкуссия: бочка — синус вниз, остальное — шум
      if (kind === 1) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.22);
        return;
      }
      const len = Math.floor(ctx.sampleRate * 0.12);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf;
      f.type = kind === 2 ? "bandpass" : "highpass";
      f.frequency.value = kind === 2 ? 1800 : 6000;
      g.gain.value = kind === 2 ? 0.25 : 0.12;
      src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(t);
    }
    document.getElementById("play-btn").onclick = () => {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
      audioCtx = audioCtx || new AudioCtx();
      const ctx = audioCtx;
      if (ctx.state === "suspended") ctx.resume();
      const mel = META.onchain_genome.melody || {};
      const cTrack = mel.celesta_track || [];
      const stepsCount = cTrack.length || 16;
      const stepSec = 60 / (mel.tempo_bpm || 104) / 2;
      const now = ctx.currentTime + 0.05;
      for (let s = 0; s < stepsCount; s++) {
        const t = now + s * stepSec;
        [["celesta_track", "sine", 1], ["harp_track", "triangle", 0.5], ["cello_track", "sawtooth", 0.5], ["flute_track", "sine", 1.5]].forEach(([k, type, mult]) => {
          const n = (mel[k] || [])[s] || 0;
          if (n > 0 && FREQS[n]) {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(FREQS[n] * mult, t);
            g.gain.setValueAtTime(0.001, t);
            g.gain.linearRampToValueAtTime(type === "sawtooth" ? 0.07 : 0.14, t + 0.03);
            g.gain.exponentialRampToValueAtTime(0.001, t + stepSec * 1.4);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(t); osc.stop(t + stepSec * 1.5);
          }
        });
        const dh = (mel.drum_track || [])[s] || 0;
        if (dh > 0) drum(ctx, dh, t);
      }
    };

    const wrap = document.getElementById("canvas-wrap");
    if (!window.THREE) {
      // нет интернета для three.js — мелодия и паспорт всё равно работают
      wrap.innerHTML = '<div class="offline">3D-вид загрузится при подключении к интернету</div>';
    } else {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 1.8, 12.2);
    camera.lookAt(0, -0.3, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(300, 300);
    wrap.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight("#ffffff", 1.5));
    const dl = new THREE.DirectionalLight("#fef08a", 2.2);
    dl.position.set(8, 14, 10);
    scene.add(dl);

    const root = new THREE.Group();
    scene.add(root);

    const baseMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.85, 1.4, 32),
      new THREE.MeshStandardMaterial({ color: META.onchain_genome.base_color_hex || "#451a03", roughness: 0.4, metalness: 0.35 })
    );
    baseMesh.position.y = -3.1;
    root.add(baseMesh);

    const vSize = 0.52;
    const bGeo = new THREE.BoxGeometry(vSize * 0.96, vSize * 0.96, vSize * 0.96);
    (META.onchain_genome.voxels || []).forEach(v => {
      const m = new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ color: v.color, roughness: 0.3 }));
      m.position.set((v.x - 3.5) * vSize, -2.05 + v.y * vSize, (v.z - 3.5) * vSize);
      root.add(m);
    });

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(3.65, 32, 24),
      new THREE.MeshPhongMaterial({ color: "#e0f2fe", transparent: true, opacity: 0.22, shininess: 120 })
    );
    dome.position.y = 0.45;
    root.add(dome);

    let drag = false, px = 0, py = 0, ry = 0.5, rx = 0.12;
    wrap.style.touchAction = "none";
    wrap.onpointerdown = e => { drag = true; px = e.clientX; py = e.clientY; };
    window.onpointermove = e => {
      if (!drag) return;
      ry += (e.clientX - px) * 0.015;
      rx = Math.max(-0.45, Math.min(0.6, rx + (e.clientY - py) * 0.01));
      px = e.clientX; py = e.clientY;
    };
    window.onpointerup = () => drag = false;

    function loop() {
      requestAnimationFrame(loop);
      if (!drag) ry += 0.008;
      root.rotation.y = ry;
      root.rotation.x = rx;
      renderer.render(scene, camera);
    }
    loop();
    }
  </script>
</body>
</html>`;
}

function triggerBrowserFileDownload(filename, contentStr, mimeType) {
  const blob = new Blob([contentStr], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Safari/Firefox не успевают начать скачивание, если отозвать ссылку сразу
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function harmonizeOrchestraFromWish(wishText, scaleId = "pentatonic") {
  const clean = (wishText || "Свет сквозь снега").trim();
  const scaleObj =
    SCALE_MODES.find((s) => s.id === scaleId) || SCALE_MODES[0];
  const highScale = scaleObj.notes.filter((n) => n >= 7);
  const lowScale = scaleObj.notes.filter((n) => n <= 8);
  const effHigh = highScale.length > 0 ? highScale : [7, 8, 9, 10, 11, 13];
  const effLow = lowScale.length > 0 ? lowScale : [1, 2, 3, 4, 5, 7];

  const celesta = [];
  const harp = [];
  const cello = [];
  const flute = [];
  let sumCode = 0;

  for (let step = 0; step < 16; step++) {
    const charA = clean.charCodeAt((step * 5) % clean.length) || 70;
    const charB = clean.charCodeAt((step * 11 + 3) % clean.length) || 40;
    sumCode += charA + charB;

    celesta.push(
      step % 4 === 3 && step > 10
        ? 0
        : effHigh[(charA + step) % effHigh.length]
    );
    harp.push(
      step % 2 === 0
        ? effLow[(charB + step) % effLow.length]
        : effLow[charA % effLow.length]
    );
    cello.push(step % 4 === 0 ? effLow[charA % Math.min(4, effLow.length)] : 0);
    flute.push(
      step % 2 === 1 ? effHigh[(charB + step + 2) % effHigh.length] : 0
    );
  }
  const groove =
    DRUM_GROOVE_PRESETS[sumCode % DRUM_GROOVE_PRESETS.length].pattern;
  return {
    tempo: 96 + (sumCode % 36),
    celesta,
    harp,
    cello,
    flute,
    drums: [...groove],
  };
}

function generateTrackPatternByRole(roleInstrument, scaleId = "pentatonic") {
  if (roleInstrument === "drums") {
    const randomGroove =
      DRUM_GROOVE_PRESETS[
        Math.floor(Math.random() * DRUM_GROOVE_PRESETS.length)
      ];
    return [...randomGroove.pattern];
  }
  const scaleObj =
    SCALE_MODES.find((s) => s.id === scaleId) || SCALE_MODES[0];
  const notes = scaleObj.notes;
  const high = notes.filter((n) => n >= 7);
  const low = notes.filter((n) => n <= 7);
  const result = [];

  for (let s = 0; s < 16; s++) {
    if (roleInstrument === "celesta") {
      result.push(
        s % 8 === 7 ? 0 : high[(s * 2 + (s % 3)) % high.length] || 10
      );
    } else if (roleInstrument === "harp") {
      const arpIdx = [0, 1, 2, 3, 2, 1, 0, 2][s % 8];
      result.push(low[arpIdx % low.length] || 4);
    } else if (roleInstrument === "cello") {
      result.push(s % 4 === 0 ? low[(s / 4) % low.length] || 1 : 0);
    } else {
      result.push(
        s % 2 === 1 ? high[(s + 3) % high.length] || 9 : 0
      );
    }
  }
  return result;
}

function getConeEnvelopeRadius(yHeight) {
  const clampedY = Math.max(0, yHeight);
  return 1.85 + clampedY * 0.24 + 0.35 * Math.sqrt(clampedY);
}

export function computeFibonacciSpiralSlot(sequenceNumber) {
  const tierIndex = Math.floor(sequenceNumber / GIFTS_PER_TIER);
  const branchAngleRad = (sequenceNumber * GOLDEN_ANGLE_RAD) % (2.0 * Math.PI);
  const yHeight = Number((sequenceNumber * VERTICAL_STEP_PER_GIFT).toFixed(4));
  // Кромка листвы яруса и подвес подарочных шаров СНАРУЖИ — за кончиками лап
  const foliageEdge = getConeEnvelopeRadius(yHeight + 1.2) * 0.88;
  const tierWave = 0.24 * Math.sin(sequenceNumber * 0.7);
  const radiusOffset = Number((foliageEdge + 3.3 + tierWave).toFixed(4));

  return {
    sequence_number: sequenceNumber,
    tier_index: tierIndex,
    branch_angle_rad: Number(branchAngleRad.toFixed(6)),
    radius_offset: radiusOffset,
    y_height: yHeight,
  };
}

// Раскладка шаров для нового облика: верхний шар висит ниже звезды и макушки,
// нижний — над снежной «юбкой». Шаг подстраивается под число шаров, поэтому
// ни 10, ни 500 подарков не уходят ни в звезду, ни под снег.
const DISPLAY_TOP_Y = 6.2; // y_height верхнего шара (мир: 60 - 6.2 = 53.8)
const DISPLAY_BOTTOM_Y = 58.2; // y_height нижнего шара (мир ≈ 1.8)
const DISPLAY_MAX_STEP = 1.15;
export function computeDisplaySlot(sequenceNumber, total) {
  const base = computeFibonacciSpiralSlot(sequenceNumber);
  const span = DISPLAY_BOTTOM_Y - DISPLAY_TOP_Y;
  const step = total > 1 ? Math.min(DISPLAY_MAX_STEP, span / (total - 1)) : 0;
  const yHeight = DISPLAY_TOP_Y + sequenceNumber * step;
  // Кончики лап новой ели: envelope + 1.25. Шар висит сразу за ними, а не в
  // пустоте на 3 единицы дальше — иначе ветка-подвес торчит в воздухе.
  const foliageTip = getConeEnvelopeRadius(yHeight) + 1.25;
  const tierWave = 0.22 * Math.sin(sequenceNumber * 0.7);
  return {
    ...base,
    radius_offset: Number((foliageTip + 1.35 + tierWave).toFixed(4)),
    y_height: Number(yHeight.toFixed(4)),
  };
}

const MELODY_PRESETS = [
  {
    name: "✨ Северное Сияние",
    genre: "Ambient Symphonic",
    tempo: 104,
    celesta: [7, 9, 10, 13, 12, 10, 9, 7, 8, 10, 11, 14, 13, 10, 9, 7],
    harp: [1, 4, 5, 7, 5, 4, 3, 1, 2, 4, 5, 8, 7, 5, 4, 1],
    cello: [1, 0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 5, 0, 1, 0],
    flute: [0, 10, 0, 13, 0, 12, 0, 9, 0, 11, 0, 14, 0, 13, 10, 0],
    drums: [1, 4, 5, 4, 2, 4, 5, 4, 1, 4, 5, 4, 2, 4, 6, 4],
  },
  {
    name: "🩰 Танец Феи Драже",
    genre: "Классика Чайковского",
    tempo: 118,
    celesta: [13, 12, 13, 11, 10, 9, 8, 7, 10, 9, 10, 8, 7, 6, 7, 0],
    harp: [1, 0, 4, 0, 5, 0, 4, 0, 3, 0, 5, 0, 4, 0, 1, 0],
    cello: [1, 0, 0, 0, 5, 0, 0, 0, 3, 0, 0, 0, 4, 0, 1, 0],
    flute: [0, 0, 13, 0, 0, 0, 10, 0, 0, 0, 11, 0, 9, 0, 7, 0],
    drums: [1, 0, 3, 3, 2, 0, 4, 0, 1, 1, 3, 0, 2, 3, 6, 0],
  },
  {
    name: "🚂 Полярный Экспресс",
    genre: "Кинематографический драйв",
    tempo: 126,
    celesta: [7, 7, 10, 7, 11, 10, 9, 7, 8, 8, 11, 8, 13, 11, 10, 7],
    harp: [1, 4, 1, 4, 5, 7, 5, 4, 2, 5, 2, 5, 4, 7, 4, 1],
    cello: [1, 0, 4, 0, 5, 0, 4, 0, 2, 0, 5, 0, 4, 0, 1, 0],
    flute: [0, 9, 10, 0, 13, 0, 10, 0, 0, 11, 13, 0, 14, 0, 13, 0],
    drums: [1, 5, 2, 5, 1, 1, 2, 4, 1, 5, 2, 5, 1, 3, 2, 6],
  },
  {
    name: "🦉 Зимняя Колыбельная",
    genre: "Уютный Lo-Fi Вальс",
    tempo: 84,
    celesta: [5, 7, 8, 10, 8, 7, 5, 3, 7, 8, 10, 11, 10, 8, 7, 5],
    harp: [1, 3, 5, 0, 4, 5, 7, 0, 3, 5, 7, 0, 2, 4, 1, 0],
    cello: [1, 0, 0, 0, 4, 0, 0, 0, 3, 0, 0, 0, 2, 0, 1, 0],
    flute: [0, 8, 0, 10, 0, 9, 0, 7, 0, 10, 0, 11, 0, 9, 7, 0],
    drums: [1, 5, 4, 5, 2, 5, 1, 4, 1, 5, 4, 5, 2, 5, 3, 6],
  },
  {
    name: "❄️ Хрустальный Вальс",
    genre: "Вальс цветов и льда",
    tempo: 112,
    celesta: [7, 0, 10, 12, 13, 0, 12, 10, 11, 0, 9, 7, 8, 0, 7, 0],
    harp: [1, 4, 4, 1, 5, 7, 7, 5, 4, 6, 6, 4, 1, 4, 4, 1],
    cello: [1, 0, 0, 5, 0, 0, 4, 0, 0, 2, 0, 0, 1, 0, 0, 0],
    flute: [0, 10, 12, 0, 13, 14, 12, 0, 11, 9, 0, 7, 8, 9, 7, 0],
    drums: [1, 4, 4, 2, 4, 4, 1, 4, 4, 2, 6, 4, 1, 4, 4, 6],
  },
  {
    name: "🌟 Звёздный Хорал",
    genre: "Торжественный гимн",
    tempo: 92,
    celesta: [7, 8, 9, 10, 11, 10, 9, 13, 12, 11, 10, 9, 8, 9, 7, 7],
    harp: [1, 2, 3, 4, 5, 4, 3, 7, 6, 5, 4, 3, 2, 4, 1, 1],
    cello: [1, 0, 3, 0, 4, 0, 7, 0, 5, 0, 4, 0, 2, 0, 1, 0],
    flute: [7, 0, 9, 0, 11, 0, 13, 0, 12, 0, 10, 0, 8, 0, 7, 0],
    drums: [1, 0, 4, 0, 2, 0, 4, 0, 1, 0, 4, 0, 2, 0, 6, 0],
  },
  {
    name: "⚓ Огни Мурманска",
    genre: "Полярная романтика",
    tempo: 98,
    celesta: [9, 11, 13, 11, 9, 7, 5, 7, 8, 10, 12, 10, 9, 7, 5, 0],
    harp: [3, 5, 7, 9, 7, 5, 3, 5, 2, 4, 6, 8, 5, 7, 3, 0],
    cello: [3, 0, 0, 0, 5, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0],
    flute: [0, 13, 0, 11, 0, 9, 0, 7, 0, 12, 0, 10, 0, 9, 0, 0],
    drums: [1, 5, 4, 5, 2, 5, 1, 4, 1, 5, 4, 5, 2, 5, 3, 6],
  },
  {
    name: "🌲 Таёжная Сказка",
    genre: "Эпический фолк",
    tempo: 110,
    celesta: [10, 9, 7, 5, 7, 9, 10, 13, 14, 13, 10, 9, 7, 8, 7, 0],
    harp: [4, 1, 4, 5, 4, 1, 4, 7, 5, 2, 5, 7, 4, 2, 1, 0],
    cello: [4, 0, 1, 0, 4, 0, 7, 0, 5, 0, 2, 0, 4, 0, 1, 0],
    flute: [10, 0, 7, 0, 9, 0, 13, 0, 14, 0, 10, 0, 9, 0, 7, 0],
    drums: [1, 4, 5, 4, 2, 4, 5, 4, 1, 4, 5, 4, 2, 4, 6, 4],
  },
];

const TOTEM_PETS = ["Полярная сова", "Северный лис", "Таёжная рысь", "Белый медведь"];

function generateProceduralGifts(count = 144) {
  const shapes = BOX_SHAPES.map((b) => b.id);
  const seals = WAX_SEALS.map((w) => w.id);
  const ribbons = ["#fbbf24", "#fef08a", "#38bdf8", "#f43f5e", "#34d399"];
  const cities = ["Мирный", "Архангельск", "Санкт-Петербург", "Ярославль", "Уфа", "Мурманск", "Казань"];
  const names = ["Мастер Илья", "Анна (Ручная лепка)", "Тимур", "Елена", "Дмитрий", "София", "Артём"];
  const list = [];

  for (let seq = 0; seq < count; seq++) {
    const preset = MELODY_PRESETS[seq % MELODY_PRESETS.length];
    const blueprint = VOXEL_BLUEPRINTS[seq % VOXEL_BLUEPRINTS.length];

    const wishLen = 150 + ((seq * 31) % 250);
    const candles = seq % 4 === 0 ? 0 : (seq * 2) % 9;
    const engrave = "Ручная работа • 2026";

    const scoreObj = computeAntiSybilScoreDetails({
      wishCharCount: wishLen,
      celestaTrack: preset.celesta,
      harpTrack: preset.harp,
      celloTrack: preset.cello,
      fluteTrack: preset.flute,
      voxelsCount: blueprint.blocks.length,
      engravingText: engrave,
      candlesCount: candles,
    });

    list.push({
      id: `gift-node-${seq}`,
      author_id: `user-${seq}`,
      created_order: seq,
      offline: true,
      quality_score: scoreObj.total,
      coordinates: computeFibonacciSpiralSlot(seq),
      snowglobe: {
        sculpture_id: blueprint.id,
        voxels: blueprint.blocks,
        base_material: BASE_MATERIALS[seq % BASE_MATERIALS.length].id,
        glitter_color: ["#fde047", "#38bdf8", "#f472b6", "#34d399"][seq % 4],
        custom_craft_title: blueprint.title,
        engraving_text: engrave,
      },
      packaging: {
        box_shape: shapes[seq % shapes.length],
        paper_pattern: "nordic_knit",
        ribbon_color: ribbons[seq % ribbons.length],
        wax_seal_stamp: seals[seq % seals.length],
      },
      melody: {
        tempo_bpm: preset.tempo,
        celesta_track: [...preset.celesta],
        harp_track: [...preset.harp],
        cello_track: [...preset.cello],
        flute_track: [...preset.flute],
        drum_track: [...(preset.drums || DRUM_GROOVE_PRESETS[0].pattern)],
      },
      card_preview: {
        teaser_tag: `${blueprint.title} • Шар #${seq + 1}`,
        author_display_name: `${names[seq % names.length]}`,
        city: cities[seq % cities.length],
        totem_pet: TOTEM_PETS[seq % TOTEM_PETS.length],
      },
      secret_wish:
        "В мире, переполненном машинами, я собрал этот снежный шар для тебя вручную — кубик за кубиком. Пусть в новом году дома ждёт живое тепло и уют!",
      wish_char_count: wishLen,
      candles_count: candles,
    });
  }

  list.sort(
    (a, b) =>
      b.quality_score - a.quality_score || a.created_order - b.created_order
  );
  list.forEach((gift, sortedSeq) => {
    gift.coordinates = computeFibonacciSpiralSlot(sortedSeq);
  });
  return list;
}

// ============================================================================
// 2. ZERO-OVERLAP 5-VOICE CHAMBER ORCHESTRA & DRUMS DAW ENGINE (v12.0)
// ============================================================================
const EXTRA_TIMBRES = new Set([
  "piano", "musicbox", "bells", "glock", "epiano", "guitar",
  "strings", "pad", "violin", "bass", "clarinet", "choir",
  // адвент-звуки
  "organ", "xylophone", "marimba", "kalimba", "harpsichord", "sleighbells", "accordion",
]);

// Тихий WAV (0,25 с) для разблокировки аудиосессии старых iOS
let _silentWav = null;
function silentWavUrl() {
  if (_silentWav) return _silentWav;
  const rate = 8000;
  const n = rate / 4;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, "data");
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  _silentWav = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  return _silentWav;
}

class ChamberOrchestraSynth {
  constructor() {
    this.ctx = null;
    this.sessionMasterGain = null;
    this.activeOscillators = new Set();
    this.timers = [];
    this.activePlayingId = null;
    this.isLooping = false;
    this.trackConfig = {
      celesta: { muted: false, solo: false, volume: 0.9 },
      harp: { muted: false, solo: false, volume: 0.85 },
      cello: { muted: false, solo: false, volume: 0.85 },
      flute: { muted: false, solo: false, volume: 0.85 },
      drums: { muted: false, solo: false, volume: 0.85 },
    };
    this.listeners = new Set();
    this.activeVoices = {};
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(step = null) {
    const state = {
      playingId: this.activePlayingId,
      step,
      isPlaying: Boolean(this.activePlayingId),
      isLooping: this.isLooping,
    };
    this.listeners.forEach((fn) => fn(state));
  }

  setTrackMix(instId, patch) {
    if (!this.trackConfig[instId]) return;
    this.trackConfig[instId] = { ...this.trackConfig[instId], ...patch };
  }

  setLooping(loopFlag) {
    this.isLooping = Boolean(loopFlag);
    this.notify(null);
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx({ latencyHint: "interactive" });
    }
    // iOS: после звонка/сворачивания контекст бывает в состоянии "interrupted"
    if (this.ctx && this.ctx.state !== "running" && this.ctx.state !== "closed") {
      this.ctx.resume().catch(() => {});
    }
  }

  /**
   * Разблокировка звука на iPhone/iPad. Вызывается из первого касания:
   *  1) audioSession.type = "playback" (Safari 17+) — звук идёт даже при
   *     включённом беззвучном режиме, как у видео;
   *  2) для старых iOS — тихий зацикленный <audio>, который переводит
   *     аудиосессию в режим воспроизведения;
   *  3) создаём/возобновляем AudioContext и проигрываем пустой буфер — без
   *     этого Safari держит контекст «на паузе».
   */
  unlock() {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== "playback") {
        navigator.audioSession.type = "playback";
      }
    } catch {
      /* старый Safari */
    }
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS && !navigator.audioSession && !this.silentEl) {
      try {
        this.silentEl = document.createElement("audio");
        this.silentEl.src = silentWavUrl();
        this.silentEl.loop = true;
        this.silentEl.setAttribute("playsinline", "");
        this.silentEl.volume = 0.01;
        this.silentEl.play().catch(() => {});
      } catch {
        this.silentEl = null;
      }
    }
    this.init();
    if (this.ctx && !this.unlockedOnce) {
      try {
        const b = this.ctx.createBuffer(1, 1, 22050);
        const src = this.ctx.createBufferSource();
        src.buffer = b;
        src.connect(this.ctx.destination);
        src.start(0);
        this.unlockedOnce = this.ctx.state === "running";
      } catch {
        /* ignore */
      }
    }
  }

  stop() {
    if (this.liveTimer) {
      window.clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];

    if (this.ctx && this.sessionMasterGain) {
      const oldBus = this.sessionMasterGain;
      this.sessionMasterGain = null;
      try {
        const now = this.ctx.currentTime;
        oldBus.gain.cancelScheduledValues(now);
        oldBus.gain.setValueAtTime(Math.max(0.0001, oldBus.gain.value), now);
        oldBus.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
        window.setTimeout(() => {
          try {
            oldBus.disconnect();
          } catch {}
        }, 25);
      } catch {
        try {
          oldBus.disconnect();
        } catch {}
      }
    }

    this.activeOscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    });
    this.activeOscillators.clear();
    this.activePlayingId = null;
    this.notify(null);
  }

  createFreshSessionBus() {
    this.init();
    if (!this.ctx) return null;
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(1.0, this.ctx.currentTime);
    bus.connect(this.ctx.destination);
    this.sessionMasterGain = bus;
    return bus;
  }

  isInstrumentAudible(instrument) {
    const anySolo = Object.values(this.trackConfig).some((cfg) => cfg.solo);
    const cfg = this.trackConfig[instrument] || {
      muted: false,
      solo: false,
      volume: 0.85,
    };
    if (anySolo) return cfg.solo;
    return !cfg.muted;
  }

  registerOsc(osc) {
    this.activeOscillators.add(osc);
    osc.onended = () => {
      this.activeOscillators.delete(osc);
    };
  }

  triggerDrumHit(drumIdx, startTime, targetBus = null) {
    if (!this.ctx || drumIdx <= 0) return;
    if (!this.isInstrumentAudible("drums")) return;
    const destination =
      targetBus || this.sessionMasterGain || this.ctx.destination;
    const vol = this.trackConfig.drums?.volume ?? 0.85;

    if (drumIdx === 1) {
      // 1: Warm Kick (Тёплая Бочка)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(130, startTime);
      osc.frequency.exponentialRampToValueAtTime(34, startTime + 0.14);
      gain.gain.setValueAtTime(0.36 * vol, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0008, startTime + 0.22);
      osc.connect(gain);
      gain.connect(destination);
      this.registerOsc(osc);
      osc.start(startTime);
      osc.stop(startTime + 0.24);
    } else if (drumIdx === 2 || drumIdx === 5) {
      // 2: Brush Snare (Мягкий Малый) или 5: Frost Shaker (Шейкер инея)
      const dur = drumIdx === 2 ? 0.14 : 0.065;
      const bufSize = Math.floor(this.ctx.sampleRate * dur);
      const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = drumIdx === 2 ? "bandpass" : "highpass";
      filter.frequency.setValueAtTime(drumIdx === 2 ? 1850 : 5400, startTime);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime((drumIdx === 2 ? 0.2 : 0.11) * vol, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0008, startTime + dur);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      this.registerOsc(noise);
      noise.start(startTime);
    } else if (drumIdx === 3) {
      // 3: Wood Rimshot (Щелчок)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(840, startTime);
      osc.frequency.exponentialRampToValueAtTime(280, startTime + 0.045);
      gain.gain.setValueAtTime(0.22 * vol, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0008, startTime + 0.055);
      osc.connect(gain);
      gain.connect(destination);
      this.registerOsc(osc);
      osc.start(startTime);
      osc.stop(startTime + 0.06);
    } else if (drumIdx === 4 || drumIdx === 6) {
      // 4: Sleigh Bells (Бубенцы саней) или 6: Crystal Triangle (Треугольник)
      const partials =
        drumIdx === 4 ? [2650, 3480, 4920] : [3120, 6240];
      const decay = drumIdx === 6 ? 0.42 : 0.15;
      partials.forEach((f) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, startTime);
        gain.gain.setValueAtTime(0.065 * vol, startTime);
        gain.gain.exponentialRampToValueAtTime(0.0008, startTime + decay);
        osc.connect(gain);
        gain.connect(destination);
        this.registerOsc(osc);
        osc.start(startTime);
        osc.stop(startTime + decay + 0.02);
      });
    }
  }

  /**
   * Дополнительные «обычные» тембры: пианино, шкатулка, колокола, гитара,
   * струнные, хор и т.д. Всё синтезируется на лету через Web Audio — без
   * загрузки сэмплов, поэтому работает и на слабом мобильном интернете.
   */
  synthExtra(timbre, freq, t, duration, dest, vol) {
    if (!EXTRA_TIMBRES.has(timbre)) return false;
    const ctx = this.ctx;
    const env = (g, peak, attack, release) => {
      g.gain.setValueAtTime(0.0008, t);
      g.gain.linearRampToValueAtTime(peak * vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0008, t + attack + release);
      return t + attack + release + 0.05;
    };
    const osc = (type, f, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (detune) o.detune.setValueAtTime(detune, t);
      this.registerOsc(o);
      return o;
    };
    const run = (oscs, end) => {
      oscs.forEach((o) => {
        o.start(t);
        o.stop(end);
      });
    };
    const out = ctx.createGain();
    out.connect(dest);

    switch (timbre) {
      case "piano": {
        const a = osc("triangle", freq);
        const b = osc("sine", freq * 2, 4);
        const bg = ctx.createGain();
        bg.gain.value = 0.35;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(freq * 6, t);
        lp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.9);
        a.connect(lp);
        b.connect(bg).connect(lp);
        lp.connect(out);
        run([a, b], env(out, 0.24, 0.006, Math.min(1.6, 0.5 + duration * 2.5)));
        break;
      }
      case "musicbox": {
        const f = freq * 2;
        const a = osc("sine", f);
        const b = osc("sine", f * 4.02);
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.25, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        a.connect(out);
        b.connect(bg).connect(out);
        run([a, b], env(out, 0.16, 0.003, 0.9));
        break;
      }
      case "bells": {
        // FM-колокол: негармонический модулятор даёт «церковный» призвук
        const car = osc("sine", freq);
        const mod = osc("sine", freq * 1.4);
        const mg = ctx.createGain();
        mg.gain.setValueAtTime(freq * 2.2, t);
        mg.gain.exponentialRampToValueAtTime(freq * 0.1, t + 1.6);
        mod.connect(mg).connect(car.frequency);
        car.connect(out);
        run([car, mod], env(out, 0.17, 0.004, 2.2));
        break;
      }
      case "glock": {
        const a = osc("sine", freq * 2);
        const b = osc("sine", freq * 2 * 2.76);
        const bg = ctx.createGain();
        bg.gain.value = 0.2;
        a.connect(out);
        b.connect(bg).connect(out);
        run([a, b], env(out, 0.15, 0.002, 0.7));
        break;
      }
      case "epiano": {
        const car = osc("sine", freq);
        const mod = osc("sine", freq * 7);
        const mg = ctx.createGain();
        mg.gain.setValueAtTime(freq * 0.9, t);
        mg.gain.exponentialRampToValueAtTime(1, t + 0.4);
        mod.connect(mg).connect(car.frequency);
        car.connect(out);
        run([car, mod], env(out, 0.22, 0.005, Math.min(1.4, 0.4 + duration * 2)));
        break;
      }
      case "guitar": {
        const a = osc("sawtooth", freq * 0.5);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.Q.value = 2;
        lp.frequency.setValueAtTime(freq * 5, t);
        lp.frequency.exponentialRampToValueAtTime(freq * 0.8, t + 0.35);
        a.connect(lp).connect(out);
        run([a], env(out, 0.2, 0.004, 0.75));
        break;
      }
      case "strings":
      case "pad": {
        const isPad = timbre === "pad";
        const a = osc("sawtooth", freq * (isPad ? 1 : 0.5), -8);
        const b = osc("sawtooth", freq * (isPad ? 1 : 0.5), 8);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(isPad ? freq * 2.5 : freq * 3, t);
        a.connect(lp);
        b.connect(lp);
        lp.connect(out);
        const att = isPad ? 0.25 : 0.12;
        run([a, b], env(out, isPad ? 0.08 : 0.1, att, duration * 1.8 + 0.3));
        break;
      }
      case "violin": {
        const a = osc("sawtooth", freq);
        const vib = osc("sine", 5.6);
        const vg = ctx.createGain();
        vg.gain.value = freq * 0.006;
        vib.connect(vg).connect(a.frequency);
        const bp = ctx.createBiquadFilter();
        bp.type = "lowpass";
        bp.frequency.value = freq * 4;
        a.connect(bp).connect(out);
        run([a, vib], env(out, 0.1, 0.07, duration * 1.4 + 0.15));
        break;
      }
      case "bass": {
        const a = osc("triangle", freq * 0.25);
        const b = osc("sine", freq * 0.5);
        const bg = ctx.createGain();
        bg.gain.value = 0.4;
        a.connect(out);
        b.connect(bg).connect(out);
        run([a, b], env(out, 0.3, 0.01, Math.min(1.0, duration * 1.6 + 0.2)));
        break;
      }
      case "clarinet": {
        const a = osc("square", freq);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = freq * 2.2;
        a.connect(lp).connect(out);
        run([a], env(out, 0.07, 0.05, duration * 1.3 + 0.1));
        break;
      }
      case "choir": {
        // три голоса + форманты гласной «а»
        const vs = [-10, 0, 9].map((d) => osc("sawtooth", freq, d));
        const f1 = ctx.createBiquadFilter();
        f1.type = "bandpass";
        f1.frequency.value = 750;
        f1.Q.value = 4;
        const f2 = ctx.createBiquadFilter();
        f2.type = "bandpass";
        f2.frequency.value = 1150;
        f2.Q.value = 5;
        vs.forEach((v) => {
          v.connect(f1);
          v.connect(f2);
        });
        f1.connect(out);
        f2.connect(out);
        run(vs, env(out, 0.22, 0.18, duration * 1.6 + 0.35));
        break;
      }
      case "organ": {
        const parts = [
          [1, 0.5],
          [2, 0.35],
          [3, 0.18],
          [4, 0.12],
        ].map(([m, g]) => {
          const o = osc("sine", freq * m);
          const gg = ctx.createGain();
          gg.gain.value = g;
          o.connect(gg).connect(out);
          return o;
        });
        run(parts, env(out, 0.16, 0.04, duration * 1.5 + 0.12));
        break;
      }
      case "xylophone":
      case "marimba": {
        const isX = timbre === "xylophone";
        const f = isX ? freq * 2 : freq;
        const a = osc("sine", f);
        const b = osc("sine", f * (isX ? 3.93 : 4.0));
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(isX ? 0.4 : 0.18, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + (isX ? 0.08 : 0.15));
        a.connect(out);
        b.connect(bg).connect(out);
        run([a, b], env(out, isX ? 0.2 : 0.26, 0.002, isX ? 0.35 : 0.65));
        break;
      }
      case "kalimba": {
        const a = osc("sine", freq * 2);
        const b = osc("sine", freq * 2 * 5.4);
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.3, t);
        bg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        a.connect(out);
        b.connect(bg).connect(out);
        run([a, b], env(out, 0.2, 0.003, 1.1));
        break;
      }
      case "harpsichord": {
        const a = osc("sawtooth", freq);
        const b = osc("square", freq * 2);
        const bg = ctx.createGain();
        bg.gain.value = 0.25;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = freq * 0.8;
        a.connect(hp);
        b.connect(bg).connect(hp);
        hp.connect(out);
        run([a, b], env(out, 0.09, 0.002, 0.6));
        break;
      }
      case "sleighbells": {
        const a = osc("sine", freq * 2);
        a.connect(out);
        // «звяканье» бубенцов — короткий высокий шум
        const len = Math.floor(ctx.sampleRate * 0.18);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 6500;
        const ng = ctx.createGain();
        ng.gain.value = 0.5;
        src.connect(hp).connect(ng).connect(out);
        src.start(t);
        run([a], env(out, 0.16, 0.002, 0.5));
        break;
      }
      case "accordion": {
        const a = osc("square", freq, -6);
        const b = osc("square", freq, 7);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = freq * 2.6;
        const trem = osc("sine", 5.5);
        const tg = ctx.createGain();
        tg.gain.value = 0.25;
        const amp = ctx.createGain();
        amp.gain.value = 0.75;
        trem.connect(tg).connect(amp.gain);
        a.connect(lp);
        b.connect(lp);
        lp.connect(amp).connect(out);
        run([a, b, trem], env(out, 0.07, 0.05, duration * 1.4 + 0.12));
        break;
      }
      default:
        return false;
    }
    return true;
  }

  triggerVoice(track, freq, startTime, duration, targetBus = null, timbreOverride = null) {
    if (!this.ctx || freq <= 0) return;
    if (!this.isInstrumentAudible(track)) return;

    const destination = targetBus || this.sessionMasterGain || this.ctx.destination;
    const vol = this.trackConfig[track]?.volume ?? 0.85;
    // Дорожка (track) — это «слот», а звучит выбранный для неё тембр.
    const instrument = timbreOverride || this.activeVoices?.[track] || track;
    if (this.synthExtra(instrument, freq, startTime, duration, destination, vol)) return;

    if (instrument === "celesta") {
      const osc = this.ctx.createOscillator();
      const overtone = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const overGain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      overtone.type = "sine";
      overtone.frequency.setValueAtTime(freq * 3.0, startTime);

      overGain.gain.setValueAtTime(0.08 * vol, startTime);
      overGain.gain.exponentialRampToValueAtTime(
        0.0008,
        startTime + duration * 0.4
      );

      gain.gain.setValueAtTime(0.0008, startTime);
      gain.gain.linearRampToValueAtTime(0.18 * vol, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(
        0.0008,
        startTime + duration * 1.35
      );

      osc.connect(gain);
      overtone.connect(overGain);
      overGain.connect(gain);
      gain.connect(destination);

      this.registerOsc(osc);
      this.registerOsc(overtone);
      osc.start(startTime);
      overtone.start(startTime);
      osc.stop(startTime + duration * 1.45);
      overtone.stop(startTime + duration * 1.45);
    } else if (instrument === "harp") {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq * 0.5, startTime);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(freq * 3.0, startTime);
      filter.frequency.exponentialRampToValueAtTime(
        freq * 0.7,
        startTime + duration
      );

      gain.gain.setValueAtTime(0.0008, startTime);
      gain.gain.linearRampToValueAtTime(0.22 * vol, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.0008,
        startTime + duration * 1.55
      );

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(destination);

      this.registerOsc(osc);
      osc.start(startTime);
      osc.stop(startTime + duration * 1.65);
    } else if (instrument === "cello") {
      const osc = this.ctx.createOscillator();
      const vibrato = this.ctx.createOscillator();
      const vibratoGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq * 0.5, startTime);

      vibrato.frequency.setValueAtTime(5.2, startTime);
      vibratoGain.gain.setValueAtTime(2.5, startTime);
      vibrato.connect(vibratoGain);
      vibratoGain.connect(osc.frequency);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(freq * 1.8, startTime);

      gain.gain.setValueAtTime(0.0008, startTime);
      gain.gain.linearRampToValueAtTime(0.16 * vol, startTime + 0.09);
      gain.gain.exponentialRampToValueAtTime(
        0.0008,
        startTime + duration * 1.9
      );

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(destination);

      this.registerOsc(osc);
      this.registerOsc(vibrato);
      osc.start(startTime);
      vibrato.start(startTime);
      osc.stop(startTime + duration * 2.0);
      vibrato.stop(startTime + duration * 2.0);
    } else if (instrument === "flute") {
      const osc = this.ctx.createOscillator();
      const vibrato = this.ctx.createOscillator();
      const vibratoGain = this.ctx.createGain();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * 1.5, startTime);

      vibrato.frequency.setValueAtTime(6.0, startTime);
      vibratoGain.gain.setValueAtTime(4.0, startTime);
      vibrato.connect(vibratoGain);
      vibratoGain.connect(osc.frequency);

      gain.gain.setValueAtTime(0.0008, startTime);
      gain.gain.linearRampToValueAtTime(0.15 * vol, startTime + 0.06);
      gain.gain.exponentialRampToValueAtTime(
        0.0008,
        startTime + duration * 1.4
      );

      osc.connect(gain);
      gain.connect(destination);

      this.registerOsc(osc);
      this.registerOsc(vibrato);
      osc.start(startTime);
      vibrato.start(startTime);
      osc.stop(startTime + duration * 1.5);
      vibrato.stop(startTime + duration * 1.5);
    }
  }

  playSingleNote(instr, noteIdx, timbre = null) {
    this.init();
    if (!this.ctx || noteIdx <= 0) return;
    if (instr === "drums") {
      this.triggerDrumHit(
        noteIdx,
        this.ctx.currentTime + 0.01,
        this.ctx.destination
      );
      return;
    }
    const freq = NOTE_FREQUENCIES[noteIdx] || 440;
    this.triggerVoice(
      instr,
      freq,
      this.ctx.currentTime + 0.01,
      0.38,
      this.ctx.destination,
      timbre
    );
  }

  toggleMelody(
    playbackId,
    tempoBpm,
    celestaTrack = [],
    harpTrack = [],
    celloTrack = [],
    fluteTrack = [],
    drumTrack = [],
    onStepCallback = null,
    voices = null
  ) {
    if (this.activePlayingId === playbackId) {
      this.stop();
      if (onStepCallback) onStepCallback(null);
      return false;
    }
    this.playMelody(
      tempoBpm,
      celestaTrack,
      harpTrack,
      celloTrack,
      fluteTrack,
      drumTrack,
      onStepCallback,
      playbackId,
      voices
    );
    return true;
  }

  playMelody(
    tempoBpm,
    celestaTrack = [],
    harpTrack = [],
    celloTrack = [],
    fluteTrack = [],
    drumTrack = [],
    onStepCallback = null,
    playbackId = "studio-preview",
    voices = null
  ) {
    this.stop();
    const bus = this.createFreshSessionBus();
    if (!this.ctx || !bus) return;

    this.activePlayingId = playbackId;
    this.activeVoices = voices || {};
    const c16 = normalizeTrackTo16Steps(celestaTrack);
    const h16 = normalizeTrackTo16Steps(harpTrack);
    const v16 = normalizeTrackTo16Steps(celloTrack);
    const f16 = normalizeTrackTo16Steps(fluteTrack);
    const d16 = normalizeTrackTo16Steps(drumTrack);

    const totalSteps = 16;
    const stepSec = 60 / (tempoBpm || 104) / 2;
    const now = this.ctx.currentTime + 0.04;

    for (let step = 0; step < totalSteps; step++) {
      const t = now + step * stepSec;
      const cNote = c16[step] || 0;
      const hNote = h16[step] || 0;
      const vNote = v16[step] || 0;
      const fNote = f16[step] || 0;
      const dHit = d16[step] || 0;

      if (cNote > 0)
        this.triggerVoice("celesta", NOTE_FREQUENCIES[cNote], t, stepSec, bus);
      if (hNote > 0)
        this.triggerVoice("harp", NOTE_FREQUENCIES[hNote], t, stepSec, bus);
      if (vNote > 0)
        this.triggerVoice(
          "cello",
          NOTE_FREQUENCIES[vNote],
          t,
          stepSec * 1.4,
          bus
        );
      if (fNote > 0)
        this.triggerVoice(
          "flute",
          NOTE_FREQUENCIES[fNote],
          t,
          stepSec * 1.1,
          bus
        );
      if (dHit > 0) this.triggerDrumHit(dHit, t, bus);

      const tid = window.setTimeout(() => {
        if (this.activePlayingId !== playbackId) return;
        this.notify(step);
        if (onStepCallback) onStepCallback(step);
      }, step * stepSec * 1000);
      this.timers.push(tid);
    }

    const totalDurationMs = totalSteps * stepSec * 1000 + 70;
    const endTid = window.setTimeout(() => {
      if (this.activePlayingId !== playbackId) return;
      if (this.isLooping) {
        this.playMelody(
          tempoBpm,
          c16,
          h16,
          v16,
          f16,
          d16,
          onStepCallback,
          playbackId,
          voices
        );
      } else {
        this.activePlayingId = null;
        this.notify(null);
        if (onStepCallback) onStepCallback(null);
      }
    }, totalDurationMs);
    this.timers.push(endTid);
  }

  /**
   * «Живое» воспроизведение для секвенсора: шаги планируются с опережением
   * ~120 мс и каждый раз читают актуальный паттерн через getPattern(), поэтому
   * правки нот и темпа слышны сразу, без перезапуска. getPattern() → {tempo,
   * loop, celesta, harp, cello, flute, drums}. Шаг сообщается через notify().
   */
  playLive(playbackId, getPattern, startStep = 0) {
    this.stop();
    const bus = this.createFreshSessionBus();
    if (!this.ctx || !bus) return;
    this.activePlayingId = playbackId;
    let step = Math.max(0, Math.min(15, startStep | 0));
    let nextTime = this.ctx.currentTime + 0.05;
    const voices = ["celesta", "harp", "cello", "flute"];
    const lengthMul = { celesta: 1, harp: 1, cello: 1.4, flute: 1.1 };
    const tick = () => {
      if (this.activePlayingId !== playbackId || !this.ctx) return;
      const pat = getPattern() || {};
      this.activeVoices = pat.voices || {};
      const stepSec = 60 / Math.max(40, Math.min(220, pat.tempo || 104)) / 2;
      while (nextTime < this.ctx.currentTime + 0.12) {
        for (const v of voices) {
          const n = (pat[v] || [])[step] || 0;
          if (n > 0 && this.isInstrumentAudible(v)) {
            this.triggerVoice(v, NOTE_FREQUENCIES[n], nextTime, stepSec * lengthMul[v], bus);
          }
        }
        const d = (pat.drums || [])[step] || 0;
        if (d > 0 && this.isInstrumentAudible("drums")) this.triggerDrumHit(d, nextTime, bus);
        const shown = step;
        const delay = Math.max(0, (nextTime - this.ctx.currentTime) * 1000);
        this.timers.push(
          window.setTimeout(() => {
            if (this.activePlayingId === playbackId) this.notify(shown);
          }, delay)
        );
        if (this.timers.length > 96) this.timers = this.timers.slice(-48);
        nextTime += stepSec;
        step += 1;
        if (step >= 16) {
          step = 0;
          if (!pat.loop) {
            // доигрываем последний шаг и останавливаемся
            window.clearInterval(this.liveTimer);
            this.liveTimer = null;
            const endDelay = Math.max(0, (nextTime - this.ctx.currentTime) * 1000);
            this.timers.push(
              window.setTimeout(() => {
                if (this.activePlayingId === playbackId) {
                  this.activePlayingId = null;
                  this.notify(null);
                }
              }, endDelay)
            );
            return;
          }
        }
      }
    };
    this.liveTimer = window.setInterval(tick, 25);
    tick();
  }

  playOwlChime() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime + 0.02;
    [523.25, 659.25, 783.99, 1046.5, 1174.66].forEach((f, idx) => {
      this.triggerVoice(
        "celesta",
        f,
        now + idx * 0.1,
        0.55,
        this.ctx.destination
      );
    });
  }

  toggleCozyHearthAmbient(enable) {
    this.init();
    if (!this.ctx) return false;
    if (this.hearthInterval) {
      window.clearInterval(this.hearthInterval);
      this.hearthInterval = null;
    }
    if (this.hearthWindNode) {
      try {
        this.hearthWindNode.stop();
        this.hearthWindNode.disconnect();
      } catch {}
      this.hearthWindNode = null;
    }
    if (!enable) return false;

    // 1. Мягкий фоновый гул камина и зимнего ветра
    const dur = 4.0;
    const bufSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.35;
    }
    const windSource = this.ctx.createBufferSource();
    windSource.buffer = buffer;
    windSource.loop = true;

    const lowFilter = this.ctx.createBiquadFilter();
    lowFilter.type = "lowpass";
    lowFilter.frequency.setValueAtTime(290, this.ctx.currentTime);

    const windGain = this.ctx.createGain();
    windGain.gain.setValueAtTime(0.055, this.ctx.currentTime);

    windSource.connect(lowFilter);
    lowFilter.connect(windGain);
    windGain.connect(this.ctx.destination);
    windSource.start();
    this.hearthWindNode = windSource;

    // 2. Потрескивание угольков и далёкие рождественские бубенцы
    this.hearthInterval = window.setInterval(() => {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      // Щелчок уголька в камине
      if (Math.random() < 0.78) {
        const crackleOsc = this.ctx.createOscillator();
        const crackleGain = this.ctx.createGain();
        crackleOsc.type = "triangle";
        crackleOsc.frequency.setValueAtTime(
          900 + Math.random() * 1900,
          now
        );
        crackleGain.gain.setValueAtTime(0.025, now);
        crackleGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.035);
        crackleOsc.connect(crackleGain);
        crackleGain.connect(this.ctx.destination);
        crackleOsc.start(now);
        crackleOsc.stop(now + 0.04);
      }
      // Далёкий звон рождественского колокольчика
      if (Math.random() < 0.32) {
        const bellFreqs = [1046.5, 1318.5, 1567.98, 2093.0];
        const f = bellFreqs[Math.floor(Math.random() * bellFreqs.length)];
        const bellOsc = this.ctx.createOscillator();
        const bellGain = this.ctx.createGain();
        bellOsc.type = "sine";
        bellOsc.frequency.setValueAtTime(f, now);
        bellGain.gain.setValueAtTime(0.022, now);
        bellGain.gain.exponentialRampToValueAtTime(0.0004, now + 0.9);
        bellOsc.connect(bellGain);
        bellGain.connect(this.ctx.destination);
        bellOsc.start(now);
        bellOsc.stop(now + 0.95);
      }
    }, 320);

    return true;
  }
}

const musicBoxSynth = new ChamberOrchestraSynth();

// Первое касание/клик/клавиша разблокирует звук (обязательно для iPhone).
// Повторяем на каждом жесте — iOS «прерывает» контекст после звонков и фона.
if (typeof window !== "undefined") {
  const unlockAudio = () => musicBoxSynth.unlock();
  ["touchend", "pointerup", "click", "keydown"].forEach((ev) =>
    window.addEventListener(ev, unlockAudio, { capture: true, passive: true })
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && musicBoxSynth.ctx) musicBoxSynth.init();
  });
}

// ============================================================================
// 3. ИНТЕРАКТИВНЫЙ 3D-ПРОСМОТРЩИК ХРУСТАЛЬНОГО ШАРА (VOXEL SNOWGLOBE VIEWER)
// ============================================================================
function VoxelSnowglobe3DViewer({
  voxels = [],
  baseMaterial = "mahogany",
  glitterColor = "#fde047",
  engravingText = "Свет 2026",
  size = "sm",
}) {
  const mountRef = useRef(null);
  const dim = size === "lg" ? 260 : 132;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
    camera.position.set(0, 1.8, 11.6);
    camera.lookAt(0, -0.35, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(dim, dim);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight("#ffffff", 1.55));
    const dl = new THREE.DirectionalLight("#fef08a", 2.4);
    dl.position.set(8, 14, 10);
    scene.add(dl);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    const baseColor = BASE_MAT_COLOR_MAP[baseMaterial] || "#5c2409";
    const baseMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.65, 1.25, 28),
      new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.4,
        metalness: 0.35,
      })
    );
    baseMesh.position.y = -3.0;
    rootGroup.add(baseMesh);

    const rimMesh = new THREE.Mesh(
      new THREE.TorusGeometry(3.25, 0.14, 10, 32),
      new THREE.MeshStandardMaterial({
        color: "#fbbf24",
        metalness: 0.85,
        roughness: 0.2,
      })
    );
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = -2.38;
    rootGroup.add(rimMesh);

    const vSize = 0.5;
    const blockGeo = new THREE.BoxGeometry(
      vSize * 0.95,
      vSize * 0.95,
      vSize * 0.95
    );
    const activeVoxels =
      voxels && voxels.length > 0 ? voxels : VOXEL_BLUEPRINTS[0].blocks;

    activeVoxels.forEach((v) => {
      const m = new THREE.Mesh(
        blockGeo,
        new THREE.MeshStandardMaterial({
          color: v.color || "#fbbf24",
          roughness: 0.28,
          metalness: 0.15,
        })
      );
      m.position.set(
        (v.x - 3.5) * vSize,
        -2.05 + v.y * vSize,
        (v.z - 3.5) * vSize
      );
      rootGroup.add(m);
    });

    const glitterGeo = new THREE.BufferGeometry();
    const gCount = 48;
    const gPos = new Float32Array(gCount * 3);
    for (let i = 0; i < gCount; i++) {
      const r = Math.random() * 2.7;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI;
      gPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      gPos[i * 3 + 1] = 0.3 + r * Math.cos(ph);
      gPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    glitterGeo.setAttribute("position", new THREE.BufferAttribute(gPos, 3));
    const glitterMat = new THREE.PointsMaterial({
      color: glitterColor || "#fde047",
      size: 0.22,
      transparent: true,
      opacity: 0.85,
    });
    const glitterPoints = new THREE.Points(glitterGeo, glitterMat);
    rootGroup.add(glitterPoints);

    const domeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(3.45, 28, 22),
      new THREE.MeshPhongMaterial({
        color: "#e0f2fe",
        transparent: true,
        opacity: 0.22,
        shininess: 120,
        depthWrite: false,
      })
    );
    domeMesh.position.y = 0.4;
    rootGroup.add(domeMesh);

    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let rotY = 0.45;
    let rotX = 0.12;

    const onDown = (e) => {
      isDragging = true;
      prevX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      prevY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    };
    const onMove = (e) => {
      if (!isDragging) return;
      const cx = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      rotY += (cx - prevX) * 0.015;
      rotX = Math.max(-0.4, Math.min(0.55, rotX + (cy - prevY) * 0.012));
      prevX = cx;
      prevY = cy;
    };
    const onUp = () => {
      isDragging = false;
    };

    const dom = renderer.domElement;
    dom.addEventListener("mousedown", onDown);
    dom.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);

    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (!isDragging) rotY += 0.009;
      rootGroup.rotation.y = rotY;
      rootGroup.rotation.x = rotX;
      glitterPoints.rotation.y -= 0.005;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      dom.removeEventListener("mousedown", onDown);
      dom.removeEventListener("touchstart", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
      renderer.dispose();
    };
  }, [voxels, baseMaterial, glitterColor, dim]);

  return (
    <div className="flex flex-col items-center shrink-0">
      <div
        ref={mountRef}
        style={{ width: dim, height: dim }}
        className="rounded-2xl border border-amber-400/35 bg-gradient-to-b from-slate-900/90 to-slate-950 cursor-grab active:cursor-grabbing overflow-hidden shadow-inner"
        title="Потяните мышью или пальцем для вращения 3D-шара"
      />
      {engravingText && (
        <div className="mt-1.5 px-2.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-400/35 text-[10px] font-mono text-amber-200 max-w-[180px] truncate">
          «{engravingText}»
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 4. МОДАЛЬНОЕ ОКНО МАСТЕРСКОЙ 3D-ШАРА, КВИНТОВОГО КРУГА И 5 ДОРОЖЕК (v14.0)
// ============================================================================
// ============================================================================
// 4.1. СТУДИЯ МЕЛОДИИ: привычный шаговый секвенсор (16 шагов × 5 дорожек)
// ============================================================================
const SCALE_SHORT = {
  pentatonic: "Пентатоника",
  c_major: "Мажор",
  a_minor: "Минор",
  dorian: "Северный",
  lydian: "Сказочный",
  harmonic_minor: "Щелкунчик",
  mixolydian: "Хоровод",
  phrygian: "Кристалл",
};

const MELODY_MOODS = [
  { id: "tale", label: "❄️ Сказка", text: "сказочный рождественский вальс со снежными бубенцами",
    voices: { celesta: "musicbox", harp: "harp", cello: "strings", flute: "flute" } },
  { id: "lullaby", label: "🌙 Колыбельная", text: "тихая нежная колыбельная зимней ночи",
    voices: { celesta: "celesta", harp: "piano", cello: "pad", flute: "choir" } },
  { id: "party", label: "🎉 Праздник", text: "весёлый праздничный марш, бубенцы и смех",
    voices: { celesta: "glock", harp: "guitar", cello: "bass", flute: "clarinet" } },
  { id: "aurora", label: "✨ Сияние", text: "волшебное северное сияние и звёзды над тайгой",
    voices: { celesta: "bells", harp: "epiano", cello: "pad", flute: "choir" } },
];

const INSTRUMENT_SHORT = {
  celesta: { icon: "🔔", name: "Челеста", cell: "bg-amber-300", ring: "ring-amber-300" },
  harp: { icon: "🪕", name: "Арфа", cell: "bg-sky-300", ring: "ring-sky-300" },
  cello: { icon: "🎻", name: "Виолончель", cell: "bg-rose-400", ring: "ring-rose-400" },
  flute: { icon: "🪈", name: "Флейта", cell: "bg-emerald-300", ring: "ring-emerald-300" },
  drums: { icon: "🥁", name: "Ритм", cell: "bg-violet-300", ring: "ring-violet-300" },
};

const STUDIO_PLAYBACK_ID = "workshop-live";

// Тембры для мелодических дорожек: от шкатулки до хора
const VOICE_OPTIONS = [
  { id: "musicbox", icon: "🎁", name: "Шкатулка" },
  { id: "celesta", icon: "🔔", name: "Челеста" },
  { id: "piano", icon: "🎹", name: "Пианино" },
  { id: "bells", icon: "🛎️", name: "Колокола" },
  { id: "glock", icon: "✨", name: "Глокеншпиль" },
  { id: "epiano", icon: "🎛️", name: "Электропиано" },
  { id: "harp", icon: "🪕", name: "Арфа" },
  { id: "guitar", icon: "🎸", name: "Гитара" },
  { id: "strings", icon: "🎻", name: "Струнные" },
  { id: "violin", icon: "🎻", name: "Скрипка" },
  { id: "cello", icon: "🎻", name: "Виолончель" },
  { id: "bass", icon: "🔊", name: "Бас" },
  { id: "flute", icon: "🪈", name: "Флейта" },
  { id: "clarinet", icon: "🎷", name: "Кларнет" },
  { id: "choir", icon: "👼", name: "Хор" },
  { id: "pad", icon: "🌌", name: "Синт-пэд" },
];
const ALL_WEATHER = [...WEATHER_PRESETS, ...ADVENT_WEATHER];
const VOICE_BY_ID = Object.fromEntries([...VOICE_OPTIONS, ...ADVENT_VOICES].map((v) => [v.id, v]));
const DEFAULT_VOICES = { celesta: "celesta", harp: "harp", cello: "cello", flute: "flute" };

function MelodyStudio({
  tracks,
  setTrack,
  tempo,
  setTempo,
  scaleId,
  onScaleChange,
  onCompose,
  autoplayTick = 0,
  harmonyPanel,
  voices = DEFAULT_VOICES,
  setVoice,
  extraVoices = [],
  lockedVoices = 0,
  melodies = [],
  onMelody,
}) {
  const [active, setActive] = useState("celesta");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playStep, setPlayStep] = useState(null);
  const [pausedAt, setPausedAt] = useState(0);
  const [loop, setLoop] = useState(true);
  const [showHarmony, setShowHarmony] = useState(false);
  const [mutes, setMutes] = useState({});
  const patternRef = useRef(null);
  patternRef.current = { tempo, loop, voices, ...tracks };

  useEffect(() => {
    const unsub = musicBoxSynth.subscribe((st) => {
      const mine = st.playingId === STUDIO_PLAYBACK_ID;
      setIsPlaying(mine);
      if (mine && st.step != null) setPlayStep(st.step);
      if (!mine) setPlayStep(null);
    });
    return () => {
      unsub();
      if (musicBoxSynth.activePlayingId === STUDIO_PLAYBACK_ID) musicBoxSynth.stop();
      // заглушки студии не должны влиять на прослушивание шаров на Ёлке
      Object.keys(INSTRUMENT_SHORT).forEach((id) => musicBoxSynth.setTrackMix(id, { muted: false }));
    };
  }, []);

  useEffect(() => {
    Object.keys(INSTRUMENT_SHORT).forEach((id) => musicBoxSynth.setTrackMix(id, { muted: Boolean(mutes[id]) }));
  }, [mutes]);

  const play = (from = pausedAt) => musicBoxSynth.playLive(STUDIO_PLAYBACK_ID, () => patternRef.current, from);

  // «Сочинить», смена лада или аккордов — сразу слышим результат с начала
  const seenTickRef = useRef(autoplayTick);
  useEffect(() => {
    if (autoplayTick === seenTickRef.current) return;
    seenTickRef.current = autoplayTick;
    play(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplayTick]);
  const pause = () => {
    setPausedAt(playStep == null ? 0 : (playStep + 1) % 16);
    musicBoxSynth.stop();
  };
  const stop = () => {
    setPausedAt(0);
    musicBoxSynth.stop();
  };

  const scale = SCALE_MODES.find((m) => m.id === scaleId) || SCALE_MODES[0];
  const cursor = isPlaying ? playStep : null;

  // ---------- общие данные ----------
  const MUSICIANS = [
    { id: "celesta", role: "Мелодия", hint: "главный голос", color: "#fcd34d", cell: "bg-amber-300" },
    { id: "harp", role: "Аккорды", hint: "подыгрывает", color: "#7dd3fc", cell: "bg-sky-300" },
    { id: "cello", role: "Бас", hint: "низкие ноты", color: "#fb7185", cell: "bg-rose-400" },
    { id: "flute", role: "Соло", hint: "украшения", color: "#6ee7b7", cell: "bg-emerald-300" },
    { id: "drums", role: "Ритм", hint: "бубенцы и удары", color: "#c4b5fd", cell: "bg-violet-300" },
  ];
  const allVoices = [...VOICE_OPTIONS, ...extraVoices];
  const voiceOf = (id) => (id === "drums" ? null : VOICE_BY_ID[voices[id] || DEFAULT_VOICES[id]]);
  const SOLFEGE = { C: "До", D: "Ре", E: "Ми", F: "Фа", G: "Соль", A: "Ля", B: "Си" };
  const ruNote = (label) => {
    const m = /^([A-G])(#?)(\d)$/.exec(label || "");
    if (!m) return { name: label, oct: "" };
    return { name: `${SOLFEGE[m[1]]}${m[2] ? "♯" : ""}`, oct: m[3] };
  };
  const DRUM_RU = { 6: "Треуг.", 5: "Шейкер", 4: "Бубенцы", 3: "Щелчок", 2: "Малый", 1: "Бочка" };

  // ---------- отмена ----------
  const historyRef = useRef([]);
  const snapshot = () => {
    historyRef.current.push({ ...tracks });
    if (historyRef.current.length > 40) historyRef.current.shift();
  };
  const undo = () => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    Object.keys(INSTRUMENT_SHORT).forEach((id) => setTrack(id, () => [...(prev[id] || Array(16).fill(0))]));
  };
  const editTrack = (id, updater) => {
    snapshot();
    setTrack(id, updater);
  };

  // ---------- режим ----------
  const [mode, setModeState] = useState(() => {
    try {
      return localStorage.getItem("wfg_studio_mode") || "simple";
    } catch {
      return "simple";
    }
  });
  const setMode = (m) => {
    setModeState(m);
    try {
      localStorage.setItem("wfg_studio_mode", m);
    } catch {
      /* без хранилища */
    }
  };

  // ---------- простой режим: настроение → вариант → инструмент ----------
  const [moodId, setMoodId] = useState(null);
  const [batch, setBatch] = useState(0);
  const [variantIdx, setVariantIdx] = useState(null);
  const [showAllVoices, setShowAllVoices] = useState(false);
  const moods = [...MELODY_MOODS, ...melodies.map((m) => ({ id: `advent_${m.id}`, label: `🎁 ${m.title}`, melody: m }))];
  const mood = moods.find((m) => m.id === moodId) || null;
  const variants = useMemo(() => {
    if (!mood) return [];
    if (mood.melody) return [{ ...mood.melody, title: "Как в окошке календаря" }];
    return [0, 1, 2].map((k) => {
      const h = harmonizeOrchestraFromWish(`${mood.text} #${batch * 3 + k}`, scaleId);
      return { ...h, voices: mood.voices, title: ["Вариант А", "Вариант Б", "Вариант В"][k] };
    });
  }, [mood, batch, scaleId]);
  const pickVariant = (i) => {
    snapshot();
    setVariantIdx(i);
    onMelody?.(variants[i]); // применяет темп, ноты и звуки — и запускает воспроизведение
  };
  const pickMood = (id) => {
    setMoodId(id);
    setVariantIdx(null);
    setBatch(0);
  };
  const LEAD_TOP = ["musicbox", "piano", "bells", "celesta", "glock", "harp", "flute", "choir"];

  // ---------- подробный режим ----------
  const [voiceMenuFor, setVoiceMenuFor] = useState(null);
  const meta = MUSICIANS.find((m) => m.id === active) || MUSICIANS[0];
  const rows =
    active === "drums"
      ? DRUM_INSTRUMENTS.filter((r) => r.index > 0)
      : NOTE_META.filter((r) => r.index > 0 && scale.notes.includes(r.index));
  const track = tracks[active] || [];
  const toggleCell = (stepIdx, noteVal) => {
    musicBoxSynth.playSingleNote(active, noteVal, active === "drums" ? null : voices[active] || DEFAULT_VOICES[active]);
    editTrack(active, (prev) => prev.map((n, i) => (i === stepIdx ? (n === noteVal ? 0 : noteVal) : n)));
  };
  const sectionTitle = "text-[11px] uppercase tracking-[0.14em] text-slate-400";
  const iconBtn = "h-11 rounded-xl flex items-center justify-center transition";

  // мини-дорожка: столбики по высоте ноты
  const MiniPattern = ({ arr, color }) => (
    <div className="flex-1 grid gap-[2px] items-end h-6" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }} aria-hidden="true">
      {Array.from({ length: 16 }).map((_, i) => {
        const v = arr?.[i] || 0;
        const h = v > 0 ? 25 + Math.min(75, (v / 18) * 75) : 8;
        return (
          <div
            key={i}
            style={{ height: `${h}%`, background: v > 0 ? color : "rgba(255,255,255,0.12)", opacity: cursor === i ? 1 : v > 0 ? 0.85 : 1 }}
            className={`rounded-[2px] ${cursor === i ? "ring-1 ring-white" : ""}`}
          />
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Переключатель режимов */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-slate-300">
          {mode === "simple" ? "Мелодия за три касания" : "В шкатулке играют 5 музыкантов"}
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-white/5 shrink-0" role="tablist" aria-label="Режим студии">
          {[
            { id: "simple", label: "Просто" },
            { id: "pro", label: "Подробно" },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`h-9 px-3 rounded-lg text-sm ${mode === m.id ? "bg-white/15 text-white font-semibold" : "text-slate-400"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === "simple" ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className={sectionTitle}>Шаг 1 · Настроение</div>
            <div className="grid grid-cols-2 gap-2">
              {moods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickMood(m.id)}
                  className={`text-left px-3.5 py-3 rounded-2xl border transition ${
                    moodId === m.id ? "bg-amber-300/15 border-amber-300 text-amber-50" : "bg-white/[0.04] border-white/10 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  <div className="text-sm font-semibold">{m.label}</div>
                  {m.voices && (
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {Object.values(m.voices)
                        .slice(0, 3)
                        .map((v) => VOICE_BY_ID[v]?.name)
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className={`space-y-2 ${mood ? "" : "opacity-40 pointer-events-none"}`} aria-disabled={!mood}>
            <div className={sectionTitle}>Шаг 2 · Послушайте и выберите</div>
            {variants.map((v, i) => {
              const selected = variantIdx === i;
              return (
                <button
                  key={`${batch}-${i}`}
                  type="button"
                  onClick={() => (selected && isPlaying ? stop() : pickVariant(i))}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl border text-left ${
                    selected ? "bg-amber-300/15 border-amber-300" : "bg-white/[0.04] border-white/10 hover:bg-white/10"
                  }`}
                >
                  <span className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${selected ? "bg-amber-300 text-slate-950" : "bg-white/10 text-white"}`}>
                    {selected && isPlaying ? "❚❚" : "▶"}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-sm font-semibold ${selected ? "text-amber-50" : "text-slate-100"}`}>{v.title}</span>
                    <span className="block text-[11px] text-slate-400">
                      {selected ? (isPlaying ? "играет…" : "выбран") : `темп ${v.tempo}`}
                    </span>
                  </span>
                  <MiniPattern arr={v.celesta} color={selected ? "#fcd34d" : "#94a3b8"} />
                </button>
              );
            })}
            {mood && !mood.melody && (
              <button
                type="button"
                onClick={() => {
                  setBatch((b) => b + 1);
                  setVariantIdx(null);
                }}
                className="w-full h-11 rounded-2xl border border-dashed border-white/20 text-sm text-slate-300 hover:bg-white/5"
              >
                🎲 Сочинить ещё три
              </button>
            )}
            {!mood && <div className="text-xs text-slate-500">Сначала выберите настроение</div>}
          </div>

          <div className={`space-y-2 ${variantIdx != null ? "" : "opacity-40 pointer-events-none"}`}>
            <div className={sectionTitle}>Шаг 3 · Главный инструмент</div>
            <div className="grid grid-cols-4 gap-2">
              {(showAllVoices ? allVoices : allVoices.filter((v) => LEAD_TOP.includes(v.id))).map((v) => {
                const on = (voices.celesta || DEFAULT_VOICES.celesta) === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setVoice("celesta", v.id);
                      musicBoxSynth.playSingleNote("celesta", 9, v.id);
                    }}
                    className={`h-16 rounded-2xl border flex flex-col items-center justify-center gap-0.5 ${
                      on ? "bg-amber-300/15 border-amber-300 text-amber-50" : "bg-white/[0.04] border-white/10 text-slate-200"
                    }`}
                  >
                    <span className="text-lg leading-none">{v.icon}</span>
                    <span className="text-[11px]">{v.name}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => setShowAllVoices((s) => !s)} className="text-xs text-amber-200/90 underline-offset-2 hover:underline">
              {showAllVoices ? "Свернуть" : `Все инструменты (${allVoices.length})`}
            </button>
            {variantIdx != null && (
              <div className="text-xs text-slate-400">
                Хотите поменять отдельные ноты или звук аккордов и баса? Откройте{" "}
                <button type="button" onClick={() => setMode("pro")} className="text-amber-200 underline">
                  «Подробно»
                </button>
                .
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Ансамбль из 5 музыкантов */}
          <div className="space-y-1.5">
            {MUSICIANS.map((m, i) => {
              const v = voiceOf(m.id);
              const arr = tracks[m.id] || [];
              const notes = arr.filter((n) => n > 0).length;
              const isActive = active === m.id;
              return (
                <div key={m.id} className="space-y-1.5">
                  <div
                    className={`p-2 rounded-2xl border transition space-y-1.5 ${
                      isActive ? "bg-white/10 border-white/30" : "bg-white/[0.04] border-white/10"
                    } ${mutes[m.id] ? "opacity-50" : ""}`}
                    style={isActive ? { boxShadow: `inset 3px 0 0 ${m.color}` } : undefined}
                  >
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setActive(m.id)}
                        aria-label={`Редактировать: ${m.role}`}
                        className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center font-bold text-slate-950"
                        style={{ background: m.color }}
                      >
                        {i + 1}
                      </button>
                      <button type="button" onClick={() => setActive(m.id)} className="flex-1 min-w-0 text-left">
                        <div className="text-sm font-semibold text-white leading-tight">{m.role}</div>
                        <div className="text-[11px] text-slate-400 leading-tight truncate">{m.hint}</div>
                      </button>
                      {m.id !== "drums" ? (
                        <button
                          type="button"
                          onClick={() => setVoiceMenuFor((x) => (x === m.id ? null : m.id))}
                          aria-expanded={voiceMenuFor === m.id}
                          className="shrink-0 h-10 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white flex items-center gap-1.5"
                          title="Сменить инструмент"
                        >
                          <span>{v?.icon}</span>
                          <span className="max-w-[96px] truncate">{v?.name}</span>
                          <span className="text-slate-400">▾</span>
                        </button>
                      ) : (
                        <span className="shrink-0 h-10 px-3 rounded-xl bg-white/5 text-xs text-slate-300 flex items-center">🥁 Ударные</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setMutes((p) => ({ ...p, [m.id]: !p[m.id] }))}
                        aria-label={`${mutes[m.id] ? "Включить" : "Заглушить"}: ${m.role}`}
                        className={`w-10 h-10 shrink-0 rounded-xl text-sm ${mutes[m.id] ? "bg-rose-500/20 text-rose-200" : "bg-white/5 text-slate-300"}`}
                      >
                        {mutes[m.id] ? "🔇" : "🔈"}
                      </button>
                    </div>
                    <button type="button" onClick={() => setActive(m.id)} className="w-full flex items-center pl-[50px] h-6" aria-label={`${m.role}: ${notes} нот`}>
                      {notes > 0 ? (
                        <MiniPattern arr={arr} color={m.color} />
                      ) : (
                        <span className="text-[11px] text-slate-500">молчит — нажмите, чтобы добавить ноты</span>
                      )}
                    </button>
                  </div>
                  {voiceMenuFor === m.id && (
                    <div className="flex flex-wrap gap-1.5 p-2 rounded-2xl bg-black/30 border border-white/10">
                      {allVoices.map((vo) => (
                        <button
                          key={vo.id}
                          type="button"
                          onClick={() => {
                            setVoice(m.id, vo.id);
                            musicBoxSynth.playSingleNote(m.id, 7, vo.id);
                          }}
                          className={`px-2.5 py-1.5 rounded-full text-xs border ${
                            (voices[m.id] || DEFAULT_VOICES[m.id]) === vo.id
                              ? "bg-white/20 border-white/40 text-white"
                              : "bg-white/[0.04] border-white/10 text-slate-300"
                          }`}
                        >
                          {vo.icon} {vo.name}
                        </button>
                      ))}
                      {lockedVoices > 0 && (
                        <span className="px-2.5 py-1.5 rounded-full text-[11px] border border-dashed border-white/15 text-slate-500">
                          🔒 ещё {lockedVoices} в адвент-календаре
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Ноты выбранного музыканта */}
          <div className="rounded-2xl bg-black/30 border border-white/10 p-1.5 sm:p-2">
            <div className="flex items-center justify-between px-1 pb-1.5 text-[11px] text-slate-400">
              <span>
                Ноты: <b style={{ color: meta.color }}>{meta.role}</b>
                {voiceOf(active) ? ` · ${voiceOf(active).name}` : ""}
              </span>
              <span>нажмите клетку — нота зазвучит</span>
            </div>
            <div className="grid grid-cols-[38px_repeat(16,minmax(0,1fr))] sm:grid-cols-[50px_repeat(16,minmax(0,1fr))] gap-[2px] sm:gap-[3px] mb-1">
              <div />
              {Array.from({ length: 16 }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => (isPlaying ? play(i) : setPausedAt(i))}
                  title="Играть с этого шага"
                  className={`h-4 rounded text-[9px] font-mono ${
                    cursor === i
                      ? "bg-amber-300 text-slate-950"
                      : !isPlaying && pausedAt === i
                      ? "bg-amber-300/30 text-amber-100"
                      : i % 4 === 0
                      ? "text-slate-300"
                      : "text-slate-600"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            {rows.map((row) => {
              const rn = active === "drums" ? { name: DRUM_RU[row.index] || row.short, oct: "" } : ruNote(row.label);
              return (
                <div key={row.index} className="grid grid-cols-[38px_repeat(16,minmax(0,1fr))] sm:grid-cols-[50px_repeat(16,minmax(0,1fr))] gap-[2px] sm:gap-[3px] mb-[2px] sm:mb-[3px]">
                  <div className="text-[10px] text-slate-300 text-right pr-1 self-center truncate">
                    {rn.name}
                    {rn.oct && <sup className="text-slate-500 ml-px">{rn.oct}</sup>}
                  </div>
                  {Array.from({ length: 16 }).map((_, sIdx) => {
                    const on = track[sIdx] === row.index;
                    const isCur = cursor === sIdx;
                    return (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => toggleCell(sIdx, row.index)}
                        aria-label={`Шаг ${sIdx + 1}, ${rn.name}${rn.oct}`}
                        aria-pressed={on}
                        className={`h-6 rounded-[5px] transition-colors ${
                          on
                            ? `${meta.cell} ${isCur ? "brightness-125 scale-105" : ""}`
                            : isCur
                            ? "bg-amber-200/25"
                            : Math.floor(sIdx / 4) % 2 === 0
                            ? "bg-white/[0.07] hover:bg-white/15"
                            : "bg-white/[0.035] hover:bg-white/15"
                        }`}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => editTrack(active, () => Array(16).fill(0))}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-slate-300"
            >
              Очистить «{meta.role}»
            </button>
            {active === "drums" &&
              DRUM_GROOVE_PRESETS.map((gr) => (
                <button
                  key={gr.id}
                  type="button"
                  onClick={() => editTrack("drums", () => [...gr.pattern])}
                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-violet-200"
                >
                  {gr.title}
                </button>
              ))}
            <button
              type="button"
              onClick={() => setShowHarmony((v) => !v)}
              aria-expanded={showHarmony}
              className="ml-auto px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-slate-300"
            >
              Лад и аккорды {showHarmony ? "▴" : "▾"}
            </button>
          </div>

          {showHarmony && (
            <div className="space-y-3 rounded-2xl bg-white/5 border border-white/10 p-3">
              <div className="flex flex-wrap gap-1.5">
                {SCALE_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onScaleChange(m.id)}
                    title={m.mood}
                    className={`px-3 py-1.5 rounded-full text-xs border ${
                      scaleId === m.id
                        ? "bg-amber-300 text-slate-950 border-amber-200 font-semibold"
                        : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {SCALE_SHORT[m.id] || m.title}
                  </button>
                ))}
              </div>
              {harmonyPanel}
            </div>
          )}
        </div>
      )}

      {/* Плеер: всегда под рукой внизу */}
      <div className="sticky bottom-0 z-10 -mx-4 sm:-mx-5 px-4 sm:px-5 py-2 bg-[#0a1226]/95 backdrop-blur border-t border-white/10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => (isPlaying ? pause() : play())}
          aria-label={isPlaying ? "Пауза" : "Играть"}
          className="w-12 h-12 rounded-full bg-amber-300 hover:bg-amber-200 text-slate-950 text-lg font-bold flex items-center justify-center shrink-0"
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>
        <button type="button" onClick={stop} aria-label="Стоп" className={`${iconBtn} w-11 bg-white/5 text-slate-200 shrink-0`}>
          ■
        </button>
        <button
          type="button"
          onClick={undo}
          aria-label="Отменить"
          title="Отменить"
          className={`${iconBtn} w-11 bg-white/5 text-slate-200 shrink-0`}
        >
          ↶
        </button>
        <button
          type="button"
          onClick={() => setLoop((v) => !v)}
          aria-pressed={loop}
          aria-label="Повтор"
          title="Повтор"
          className={`${iconBtn} w-11 shrink-0 ${loop ? "bg-amber-300/20 text-amber-200 ring-1 ring-amber-300/50" : "bg-white/5 text-slate-400"}`}
        >
          🔁
        </button>
        <div className="flex-1 min-w-0 px-1">
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Темп {tempo}</span>
            <span className="font-mono">{String((cursor ?? pausedAt) + 1).padStart(2, "0")}/16</span>
          </div>
          <input
            type="range"
            min={60}
            max={160}
            step={2}
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
            aria-label="Темп"
            className="w-full accent-amber-300"
          />
        </div>
      </div>
    </div>
  );
}

function GiftWorkshopModal({
  isOpen,
  onClose,
  onGiftCreated,
  onGiftUpdated,
  editGift = null,
  remainingGifts = null,
  maxGifts = 3,
  advent = null,
}) {
  const isEdit = Boolean(editGift);
  const blueprints = advent?.templates?.length ? [...VOXEL_BLUEPRINTS, ...advent.templates] : VOXEL_BLUEPRINTS;
  const palette = advent?.colors?.length ? [...VOXEL_PALETTE, ...advent.colors] : VOXEL_PALETTE;
  const [stepTab, setStepTab] = useState(0);
  const [voxels, setVoxels] = useState(() => [...VOXEL_BLUEPRINTS[0].blocks]);
  const [activeLayerY, setActiveLayerY] = useState(2);
  const [selectedColor, setSelectedColor] = useState("#fbbf24");
  const [baseMaterial, setBaseMaterial] = useState("mahogany");
  const [glitterColor, setGlitterColor] = useState("#fde047");
  const [engravingText, setEngravingText] = useState("Ручная работа • 2026");

  const [scaleId, setScaleId] = useState("pentatonic");
  const [tempoBpm, setTempoBpm] = useState(104);
  const [celestaTrack, setCelestaTrack] = useState(() => [
    ...MELODY_PRESETS[0].celesta,
  ]);
  const [harpTrack, setHarpTrack] = useState(() => [...MELODY_PRESETS[0].harp]);
  const [celloTrack, setCelloTrack] = useState(() => [
    ...MELODY_PRESETS[0].cello,
  ]);
  const [fluteTrack, setFluteTrack] = useState(() => [
    ...MELODY_PRESETS[0].flute,
  ]);
  const [drumTrack, setDrumTrack] = useState(() => [
    ...MELODY_PRESETS[0].drums,
  ]);

  const [tonicSectorIdx, setTonicSectorIdx] = useState(0);
  const [activeBarIdx, setActiveBarIdx] = useState(0);
  const [barSlots, setBarSlots] = useState([
    { sectorIdx: 0, ring: "major", label: "C" },
    { sectorIdx: 1, ring: "major", label: "G" },
    { sectorIdx: 0, ring: "minor", label: "Am" },
    { sectorIdx: 11, ring: "major", label: "F" },
  ]);
  const [autoplayTick, setAutoplayTick] = useState(0);
  const [voices, setVoices] = useState(() => ({ ...DEFAULT_VOICES, celesta: "musicbox" }));
  const composeSeedRef = useRef(0);

  const [teaserTag, setTeaserTag] = useState("Тёплый маяк Севера");
  const [secretWish, setSecretWish] = useState(
    WISH_INSPIRATION_PROMPTS[0].text
  );
  const [authorName, setAuthorName] = useState("Хранитель Огня");
  const [city, setCity] = useState("Санкт-Петербург");
  const [totemPet, setTotemPet] = useState(TOTEM_PETS[0]);
  const [contactHandle, setContactHandle] = useState("");
  const [boxShape, setBoxShape] = useState("cube");
  const [waxSeal, setWaxSeal] = useState("owl");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Режим правки: загружаем шар мастера в мастерскую; после правки новая
  // мастерская снова открывается с чистого шаблона.
  const loadedKeyRef = useRef("new");
  useEffect(() => {
    if (!isOpen) return;
    const key = editGift ? `edit:${editGift.id}` : "new";
    if (key === loadedKeyRef.current) return;
    loadedKeyRef.current = key;
    const g = editGift;
    const sg = g?.snowglobe || {};
    const mel = g?.melody || {};
    const card = g?.card_preview || {};
    const pick = (arr, fallback) => (Array.isArray(arr) && arr.length ? normalizeTrackTo16Steps(arr) : [...fallback]);
    setStepTab(0);
    setSubmitError("");
    setVoxels(g ? (sg.voxels || []).map((v) => ({ ...v })) : [...VOXEL_BLUEPRINTS[0].blocks]);
    setBaseMaterial(sg.base_material || "mahogany");
    setGlitterColor(sg.glitter_color || "#fde047");
    setEngravingText(g ? sg.engraving_text || "" : "Ручная работа • 2026");
    setTempoBpm(mel.tempo_bpm || 104);
    setCelestaTrack(pick(g && mel.celesta_track, MELODY_PRESETS[0].celesta));
    setHarpTrack(pick(g && mel.harp_track, MELODY_PRESETS[0].harp));
    setCelloTrack(pick(g && mel.cello_track, MELODY_PRESETS[0].cello));
    setFluteTrack(pick(g && mel.flute_track, MELODY_PRESETS[0].flute));
    setDrumTrack(pick(g && mel.drum_track, MELODY_PRESETS[0].drums));
    setVoices(g ? { ...DEFAULT_VOICES, ...(mel.voices || {}) } : { ...DEFAULT_VOICES, celesta: "musicbox" });
    setTeaserTag(g ? card.teaser_tag || "" : "Тёплый маяк Севера");
    setSecretWish(g ? g.secret_wish || "" : WISH_INSPIRATION_PROMPTS[0].text);
    setAuthorName(g ? card.author_display_name || "" : "Хранитель Огня");
    setCity(g ? card.city || "" : "Санкт-Петербург");
    setTotemPet(card.totem_pet || TOTEM_PETS[0]);
    setContactHandle("");
    setBoxShape(g?.packaging?.box_shape || "cube");
    setWaxSeal(g?.packaging?.wax_seal_stamp || "owl");
  }, [isOpen, editGift]);

  if (!isOpen) return null;

  const voxelSafety = inspectVoxelGeometrySafety(voxels);
  const effectiveContact = contactHandle.trim();
  // Контакт не модерируется как публичный текст: его видит только партнёр
  // после двойного согласия, а ссылки вида t.me/nick здесь законны.
  const contactIsValid = isEdit ? effectiveContact.length === 0 || effectiveContact.length >= 3 : effectiveContact.length >= 3;
  const textSafety = inspectContentSafety({
    Пожелание: secretWish,
    Бирка: teaserTag,
    Гравировка: engravingText,
    Автор: authorName,
    Город: city,
  });
  const limitReached = !isEdit && remainingGifts === 0;
  const canSubmit =
    voxelSafety.isSafe && textSafety.isSafe && contactIsValid && !isSubmitting && !limitReached;

  const liveScore = computeAntiSybilScoreDetails({
    wishText: secretWish,
    celestaTrack,
    harpTrack,
    celloTrack,
    fluteTrack,
    drumTrack,
    voxelsCount: voxels.length,
    engravingText,
    candlesCount: 1,
  });

  const handleScaleChange = (newScaleId) => {
    setScaleId(newScaleId);
    const qCelesta = quantizeTrackToScale(celestaTrack, newScaleId);
    const qHarp = quantizeTrackToScale(harpTrack, newScaleId);
    const qCello = quantizeTrackToScale(celloTrack, newScaleId);
    const qFlute = quantizeTrackToScale(fluteTrack, newScaleId);
    setCelestaTrack(qCelesta);
    setHarpTrack(qHarp);
    setCelloTrack(qCello);
    setFluteTrack(qFlute);
    setAutoplayTick((t) => t + 1);
  };

  const handleSelectCircleSector = (sectorIdx, ring = "major") => {
    const sector = CIRCLE_OF_FIFTHS_SECTORS[sectorIdx];
    const nextBars = [...barSlots];
    nextBars[activeBarIdx] = {
      sectorIdx,
      ring,
      label: ring === "minor" ? sector.minor : sector.major,
    };
    setBarSlots(nextBars);
    setTonicSectorIdx(sectorIdx);
    const built = build16StepTracksFrom4Bars(nextBars, drumTrack);
    setCelestaTrack(built.celesta);
    setHarpTrack(built.harp);
    setCelloTrack(built.cello);
    setFluteTrack(built.flute);
    setActiveBarIdx((prev) => (prev + 1) % 4);
    musicBoxSynth.playSingleNote(
      "celesta",
      ring === "minor"
        ? sector.minorVoicing.celesta[0]
        : sector.majorVoicing.celesta[0]
    );
  };

  const handleAiGenerateSymphony = (moodText = "", moodVoices = null) => {
    if (moodVoices) setVoices({ ...moodVoices });
    composeSeedRef.current += 1;
    const harmonized = harmonizeOrchestraFromWish(
      `${moodText} ${secretWish} #${composeSeedRef.current}`,
      scaleId
    );
    setTempoBpm(harmonized.tempo);
    setCelestaTrack(harmonized.celesta);
    setHarpTrack(harmonized.harp);
    setCelloTrack(harmonized.cello);
    setFluteTrack(harmonized.flute);
    setDrumTrack(harmonized.drums);
    setAutoplayTick((t) => t + 1);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setSubmitError("");
    try {
      await (isEdit ? onGiftUpdated : onGiftCreated)({
      snowglobe: {
        sculpture_id: "cottage",
        voxels,
        base_material: baseMaterial,
        glitter_color: glitterColor,
        custom_craft_title: teaserTag,
        engraving_text: engravingText,
      },
      packaging: {
        box_shape: boxShape,
        paper_pattern: "nordic_knit",
        ribbon_color: "#fbbf24",
        wax_seal_stamp: waxSeal,
      },
      melody: {
        tempo_bpm: tempoBpm,
        celesta_track: celestaTrack,
        harp_track: harpTrack,
        cello_track: celloTrack,
        flute_track: fluteTrack,
        drum_track: drumTrack,
        voices,
      },
      card: {
        teaser_tag: teaserTag,
        secret_wish: secretWish,
        author_display_name: authorName,
        city,
        totem_pet: totemPet,
        contact_handle: effectiveContact,
      },
      });
      onClose();
    } catch (err) {
      setSubmitError(err?.message || "Не удалось повесить шар. Попробуйте ещё раз.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const subdominantIdx = (tonicSectorIdx + 11) % 12;
  const dominantIdx = (tonicSectorIdx + 1) % 12;

  const trackSetters = {
    celesta: setCelestaTrack,
    harp: setHarpTrack,
    cello: setCelloTrack,
    flute: setFluteTrack,
    drums: setDrumTrack,
  };
  const setTrack = (id, updater) => trackSetters[id]?.(updater);
  const applyBars = (nextBars) => {
    const built = build16StepTracksFrom4Bars(nextBars, drumTrack);
    setCelestaTrack(built.celesta);
    setHarpTrack(built.harp);
    setCelloTrack(built.cello);
    setFluteTrack(built.flute);
  };

  const STEPS = [
    { label: "Фигурка", icon: "🧊" },
    { label: "Мелодия", icon: "🎵" },
    { label: "Пожелание", icon: "✉️" },
  ];
  const isLast = stepTab === STEPS.length - 1;
  const field =
    "w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 focus:border-amber-300/60 outline-none text-sm text-white placeholder:text-slate-500";
  const chipCls = "px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-200";

  const closeWorkshop = () => {
    musicBoxSynth.stop();
    onClose();
  };

  const harmonyPanel = (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 items-center">
      <svg viewBox="0 0 240 240" className="w-48 h-48 mx-auto" aria-label="Круг аккордов">
        {CIRCLE_OF_FIFTHS_SECTORS.map((sec, idx) => {
          const angle = (idx * 30 - 90) * (Math.PI / 180);
          const xMaj = 120 + Math.cos(angle) * 88;
          const yMaj = 120 + Math.sin(angle) * 88;
          const xMin = 120 + Math.cos(angle) * 52;
          const yMin = 120 + Math.sin(angle) * 52;
          const isTonic = idx === tonicSectorIdx;
          const fillMaj = isTonic
            ? "#fcd34d"
            : idx === subdominantIdx
            ? "#34d399"
            : idx === dominantIdx
            ? "#fb7185"
            : "rgba(255,255,255,0.07)";
          return (
            <g key={sec.major}>
              <circle cx={xMaj} cy={yMaj} r="18" fill={fillMaj} className="cursor-pointer" onClick={() => handleSelectCircleSector(idx, "major")} />
              <text x={xMaj} y={yMaj + 4} textAnchor="middle" fill={isTonic ? "#0f172a" : "#f8fafc"} fontSize="11" fontWeight="bold" className="pointer-events-none">
                {sec.major}
              </text>
              <circle cx={xMin} cy={yMin} r="13" fill={isTonic ? "#a78bfa" : "rgba(255,255,255,0.04)"} className="cursor-pointer" onClick={() => handleSelectCircleSector(idx, "minor")} />
              <text x={xMin} y={yMin + 3} textAnchor="middle" fill="#cbd5e1" fontSize="9" className="pointer-events-none">
                {sec.minor}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="space-y-2">
        <div className="text-[11px] text-slate-400">Выберите такт, затем аккорд на круге</div>
        <div className="grid grid-cols-4 gap-1.5">
          {barSlots.map((slot, bIdx) => (
            <button
              key={bIdx}
              type="button"
              onClick={() => setActiveBarIdx(bIdx)}
              className={`py-1.5 rounded-xl border text-center ${
                activeBarIdx === bIdx ? "border-amber-300 bg-amber-300/15" : "border-white/10 bg-white/5"
              }`}
            >
              <div className="text-[10px] text-slate-400">Такт {bIdx + 1}</div>
              <div className="text-sm font-mono font-bold text-amber-200">{slot.label}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {GUIDED_CIRCLE_PROGRESSIONS.map((prog) => (
            <button
              key={prog.id}
              type="button"
              title={prog.formula}
              onClick={() => {
                const next = prog.steps.map((st) => ({
                  sectorIdx: st.sectorIdx,
                  ring: st.ring,
                  label:
                    st.ring === "minor"
                      ? CIRCLE_OF_FIFTHS_SECTORS[st.sectorIdx].minor
                      : CIRCLE_OF_FIFTHS_SECTORS[st.sectorIdx].major,
                }));
                setBarSlots(next);
                applyBars(next);
                setAutoplayTick((t) => t + 1);
              }}
              className={chipCls}
            >
              {prog.title.replace(/\s*\(.*\)\s*$/, "")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Новый шар"
        className={`${glassPanel} w-full max-w-4xl rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col wfg-h-94 sm:h-auto sm:max-h-[92vh]`}
      >
        {/* Шапка: заголовок + шаги */}
        <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div className="font-serif text-xl text-amber-50">{isEdit ? "Переделать шар" : "Новый шар"}</div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 hidden sm:inline">✨ {liveScore.total}</span>
              <button
                type="button"
                onClick={closeWorkshop}
                aria-label="Закрыть"
                className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-lg"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {STEPS.map((st, i) => (
              <button
                key={st.label}
                type="button"
                onClick={() => setStepTab(i)}
                aria-current={stepTab === i ? "step" : undefined}
                className="text-left"
              >
                <div className={`h-1 rounded-full ${i <= stepTab ? "bg-amber-300" : "bg-white/10"}`} />
                <div className={`mt-1.5 text-xs ${stepTab === i ? "text-amber-100" : "text-slate-400"}`}>
                  {st.icon} {st.label}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Тело шага */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          {stepTab === 0 && (
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-5 items-start">
              <div className="flex flex-col items-center gap-3">
                <VoxelSnowglobe3DViewer
                  voxels={voxels}
                  baseMaterial={baseMaterial}
                  glitterColor={glitterColor}
                  engravingText={engravingText}
                  size="lg"
                />
                <input
                  type="text"
                  maxLength={44}
                  value={engravingText}
                  onChange={(e) => setEngravingText(e.target.value)}
                  placeholder="Надпись на подставке"
                  aria-label="Надпись на подставке"
                  className={field + " text-center"}
                />
              </div>

              <div className="space-y-3.5">
                <div>
                  <div className="text-[11px] text-slate-400 mb-1.5">Начать с шаблона</div>
                  <div className="flex flex-wrap gap-1.5">
                    {blueprints.map((bp) => (
                      <button key={bp.id} type="button" onClick={() => setVoxels(bp.blocks.map((b) => ({ ...b })))} className={chipCls}>
                        {bp.title}
                      </button>
                    ))}
                    <button type="button" onClick={() => setVoxels([])} className={chipCls + " text-slate-400"}>
                      С нуля
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {palette.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedColor(c.hex)}
                      style={{ backgroundColor: c.hex }}
                      aria-label={c.name}
                      title={c.name}
                      className={`w-7 h-7 rounded-full transition ${
                        selectedColor === c.hex ? "ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110" : ""
                      }`}
                    />
                  ))}
                </div>

                <div className="flex gap-3 items-start">
                  <div className="grid grid-cols-8 gap-1 p-2 rounded-2xl bg-black/30 border border-white/10">
                    {Array.from({ length: 64 }).map((_, idx) => {
                      const vx = idx % 8;
                      const vz = Math.floor(idx / 8);
                      const existing = voxels.find((b) => b.x === vx && b.y === activeLayerY && b.z === vz);
                      const below = !existing && voxels.some((b) => b.x === vx && b.y === activeLayerY - 1 && b.z === vz);
                      return (
                        <button
                          key={idx}
                          type="button"
                          aria-label={`Кубик ${vx + 1}×${vz + 1}`}
                          onClick={() => {
                            if (existing) {
                              setVoxels((prev) =>
                                prev.filter((b) => !(b.x === vx && b.y === activeLayerY && b.z === vz))
                              );
                            } else {
                              setVoxels((prev) => [...prev, { x: vx, y: activeLayerY, z: vz, color: selectedColor }]);
                            }
                          }}
                          style={{ backgroundColor: existing ? existing.color : undefined }}
                          className={`w-8 h-8 sm:w-7 sm:h-7 rounded-md transition ${
                            existing ? "ring-1 ring-white/60" : below ? "bg-white/15" : "bg-white/5 hover:bg-white/15"
                          }`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex flex-col-reverse gap-1" aria-label="Этаж">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((ly) => (
                      <button
                        key={ly}
                        type="button"
                        onClick={() => setActiveLayerY(ly)}
                        aria-label={`Этаж ${ly + 1}`}
                        className={`w-8 h-7 rounded-lg text-xs ${
                          activeLayerY === ly ? "bg-amber-300 text-slate-950 font-bold" : "bg-white/5 text-slate-400"
                        }`}
                      >
                        {ly + 1}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">Этаж {activeLayerY + 1} из 8 · светлые клетки — кубики этажом ниже</div>

                {!voxelSafety.isSafe && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/40 text-xs text-rose-200">
                    ⚠️ {voxelSafety.reason}
                  </div>
                )}
              </div>
            </div>
          )}

          {stepTab === 1 && (
            <MelodyStudio
              tracks={{ celesta: celestaTrack, harp: harpTrack, cello: celloTrack, flute: fluteTrack, drums: drumTrack }}
              setTrack={setTrack}
              tempo={tempoBpm}
              setTempo={setTempoBpm}
              scaleId={scaleId}
              onScaleChange={handleScaleChange}
              onCompose={handleAiGenerateSymphony}
              autoplayTick={autoplayTick}
              harmonyPanel={harmonyPanel}
              voices={voices}
              setVoice={(slot, id) => setVoices((p) => ({ ...p, [slot]: id }))}
              extraVoices={advent?.voices || []}
              lockedVoices={Math.max(0, ADVENT_VOICES.length - (advent?.voices?.length || 0))}
              melodies={advent?.melodies || []}
              onMelody={(m) => {
                setTempoBpm(m.tempo);
                setCelestaTrack([...m.celesta]);
                setHarpTrack([...m.harp]);
                setCelloTrack([...m.cello]);
                setFluteTrack([...m.flute]);
                setDrumTrack([...m.drums]);
                setVoices({ ...DEFAULT_VOICES, ...m.voices });
                setAutoplayTick((t) => t + 1);
              }}
            />
          )}

          {stepTab === 2 && (
            <div className="space-y-3 max-w-2xl mx-auto">
              <input
                type="text"
                value={teaserTag}
                onChange={(e) => setTeaserTag(e.target.value)}
                placeholder="Название шара"
                aria-label="Название шара"
                className={field + " font-serif text-base"}
              />
              <div>
                <textarea
                  rows={4}
                  value={secretWish}
                  onChange={(e) => setSecretWish(e.target.value)}
                  placeholder="Пожелание получателю"
                  aria-label="Пожелание"
                  className={field + " resize-none"}
                />
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">Откроется в новогоднюю ночь. Идея:</span>
                  {WISH_INSPIRATION_PROMPTS.map((w) => (
                    <button key={w.label} type="button" onClick={() => setSecretWish(w.text)} className={chipCls + " py-1"}>
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Имя"
                  aria-label="Имя"
                  className={field}
                />
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Город"
                  aria-label="Город"
                  className={field}
                />
              </div>
              <div>
                <input
                  type="text"
                  value={contactHandle}
                  onChange={(e) => setContactHandle(e.target.value)}
                  placeholder={isEdit ? "Новый контакт (пусто — оставить прежний)" : "Контакт: @ник, телефон или e-mail"}
                  aria-label="Контакт"
                  maxLength={120}
                  autoComplete="off"
                  className={field + (contactIsValid ? "" : " border-amber-400/60")}
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  🔒 Увидит только ваш партнёр по обмену — и только если вы оба согласитесь.
                </div>
              </div>

              {!textSafety.isSafe && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/40 text-xs text-rose-200">
                  ⚠️ «{textSafety.field}»: {textSafety.reason}
                </div>
              )}
              {submitError && (
                <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-400/40 text-xs text-rose-200">
                  ⚠️ {submitError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Низ: назад / далее / повесить */}
        <div className="px-4 sm:px-5 pt-3 border-t border-white/10 flex items-center gap-2 wfg-safe-b">
          {stepTab > 0 ? (
            <button
              type="button"
              onClick={() => setStepTab((v) => v - 1)}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-sm text-slate-200"
            >
              ← Назад
            </button>
          ) : (
            <span />
          )}
          <div className="flex-1 min-w-0 text-[11px] text-slate-400 truncate text-center">
            {isEdit
              ? "Свечи сохранятся"
              : limitReached
              ? `У вас уже ${maxGifts} шара — это максимум`
              : isLast && !contactIsValid
              ? "Добавьте контакт для обмена"
              : remainingGifts != null
              ? `Ещё ${remainingGifts} из ${maxGifts} шаров`
              : ""}
          </div>
          {isLast ? (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="px-5 py-2.5 rounded-xl bg-amber-300 hover:bg-amber-200 disabled:opacity-40 text-slate-950 font-semibold text-sm"
            >
              {isSubmitting ? (isEdit ? "Сохраняем…" : "Вешаем…") : isEdit ? "💾 Сохранить шар" : "🎄 Повесить на Ёлку"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStepTab((v) => v + 1)}
              className="px-5 py-2.5 rounded-xl bg-amber-300 hover:bg-amber-200 text-slate-950 font-semibold text-sm"
            >
              Далее →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5. МОДАЛЬНОЕ ОКНО КОЛЬЦА ЧУДЕС И ПАСПОРТА NFT-РЕЛИКВИИ
// ============================================================================
function nodeFromUnlockedGift(card) {
  const details = card.gift_details;
  return {
    id: details.gift_id,
    coordinates: {
      sequence_number: 0,
      tier_index: 0,
      branch_angle_rad: 0,
      radius_offset: 0,
      y_height: 0,
    },
    snowglobe: details.snowglobe,
    packaging: details.packaging,
    melody: details.melody,
    card_preview: {
      teaser_tag: details.teaser_tag,
      author_display_name: card.partner_display_name,
      city: card.partner_city,
      totem_pet: card.partner_totem_pet,
    },
    secret_wish: details.secret_wish,
    wish_char_count: details.wish_char_count,
    quality_score: details.quality_score,
    candles_count: details.candles_count,
    genome_hash: details.genome_hash,
  };
}

function MiracleRingModal({
  isOpen,
  onClose,
  myUserId,
  myGift,
  isOfflineMode = false,
  countdownText = "",
  isUnlocked = false,
  unlockAtMs = null,
  onTriggerOwlFlight,
  onOpenNftPassport,
}) {
  const [cards, setCards] = useState([]);
  const [loadState, setLoadState] = useState("idle");
  const [myConsent, setMyConsent] = useState(false);
  const [partnerConsent, setPartnerConsent] = useState(true);

  useEffect(() => {
    if (!isOpen || !isUnlocked) return;
    if (isOfflineMode || !myUserId) {
      setLoadState("demo");
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    // Первые минуты после полуночи — разносим запросы во времени (0–15 с).
    const justUnlocked = unlockAtMs != null && Date.now() - unlockAtMs < 3 * 60 * 1000;
    apiFetchMyRing({ jitterMs: justUnlocked ? 15000 : 0 })
      .then((data) => {
        if (cancelled) return;
        setCards(Array.isArray(data) ? data : []);
        setLoadState(data && data.length > 0 ? "ready" : "empty");
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadState(err?.status === 403 ? "locked" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, isUnlocked, isOfflineMode, myUserId, unlockAtMs]);

  if (!isOpen) return null;
  const mutual = myConsent && partnerConsent;

  const handleConsent = async (card) => {
    if (!myUserId) return;
    try {
      const updated = await apiGiveHandshakeConsent(card.handshake_id);
      setCards((prev) =>
        prev.map((c) => (c.handshake_id === updated.handshake_id ? updated : c))
      );
    } catch {
      /* согласие можно повторить позже */
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xl flex items-end sm:items-center justify-center sm:p-3" role="dialog" aria-modal="true" aria-label="Кольцо Чудес">
      <div className="max-w-lg w-full bg-[#091224] border border-amber-400/50 rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl wfg-mh-92 overflow-y-auto wfg-safe-b">
        <div className="wfg-sticky-head flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-amber-400 font-bold">
            🦉 Кольцо Чудес 2026
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-10 h-10 rounded-xl bg-slate-800 text-slate-200 text-lg"
          >
            ✕
          </button>
        </div>

        <h3 className="font-serif text-2xl font-bold text-white">
          Двойное Рукопожатие Мастеров
        </h3>

        {(!isUnlocked || loadState === "locked") && (
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-sky-400/30 text-center space-y-2">
            <div className="text-xs text-sky-200 font-semibold">
              ⏳ Кольцо Чудес откроется в Новогоднюю полночь
            </div>
            <div className="font-mono text-lg font-bold text-amber-300">
              {countdownText}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              До полуночи тайные пожелания и контакты мастеров запечатаны сургучом.
              Распаковка и обмен контактами — только после Новогоднего звона.
            </p>
            {myGift && (
              <button
                type="button"
                onClick={() => onOpenNftPassport?.(myGift, null)}
                className="py-2.5 px-3 rounded-xl bg-sky-500/20 border border-sky-400/50 text-sky-200 font-bold text-xs"
              >
                📜 Паспорт моего шара
              </button>
            )}
          </div>
        )}

        {isUnlocked && loadState === "loading" && (
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-amber-400/30 text-xs text-amber-200 text-center">
            🦉 Сверяем пары Кольца Чудес…
          </div>
        )}

        {isUnlocked && loadState === "error" && (
          <div className="p-4 rounded-2xl bg-rose-950/70 border border-rose-400/40 text-xs text-rose-200 text-center">
            ⚠️ Не удалось загрузить связи обмена. Попробуйте открыть окно ещё раз.
          </div>
        )}

        {isUnlocked && loadState === "empty" && (
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-amber-400/30 text-xs text-slate-300 leading-relaxed">
            {myUserId
              ? "Ваш шар появился на Ёлке уже после того, как Кольцо Чудес этого года сомкнулось. Он остаётся украшением Ёлки, а в следующем Кольце вы будете одним из первых."
              : "Ваши связи обмена пока не сформированы. Повесьте хрустальный шар на Ёлку — и Кольцо Чудес соединит вас с другими мастерами в Новогоднюю ночь."}
          </div>
        )}

        {isUnlocked &&
          loadState === "ready" &&
          cards.map((card) => (
            <div
              key={card.handshake_id}
              className="p-3.5 rounded-2xl bg-slate-950/80 border border-amber-400/30 flex flex-col sm:flex-row items-center gap-3.5"
            >
              <VoxelSnowglobe3DViewer
                voxels={card.gift_details.snowglobe?.voxels}
                baseMaterial={card.gift_details.snowglobe?.base_material}
                glitterColor={card.gift_details.snowglobe?.glitter_color}
                engravingText={card.gift_details.snowglobe?.engraving_text}
                size="sm"
              />
              <div className="space-y-1.5 text-xs flex-1 min-w-0">
                <div className="font-bold text-amber-200">
                  {card.role === "MY_RECIPIENT" ? "🎁 Ваш получатель" : "🎅 Ваш Тайный Санта"}
                  : {card.partner_display_name} ({card.partner_city} • {card.partner_totem_pet})
                </div>
                <div className="text-amber-100">«{card.gift_details.teaser_tag}»</div>
                <p className="text-slate-300 leading-relaxed">
                  «{card.gift_details.secret_wish}»
                </p>
                <div className="text-[11px] text-emerald-300">
                  {card.mutual_unlocked
                    ? `🤝 Оба мастера дали согласие! Контакт открыт: ${card.partner_decrypted_contact}`
                    : card.my_consent
                    ? "⏳ Ожидаем согласия партнёра на обмен контактами…"
                    : "Ожидается ваше согласие на обмен прямыми контактами."}
                </div>
              </div>
              <div className="flex sm:flex-col gap-2 shrink-0">
                {!card.my_consent && (
                  <button
                    type="button"
                    onClick={() => handleConsent(card)}
                    className="py-2.5 px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs"
                  >
                    🤝 Рукопожатие
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onOpenNftPassport?.(nodeFromUnlockedGift(card), card.partner_city)
                  }
                  className="py-2.5 px-3 rounded-xl bg-sky-500/20 border border-sky-400/50 text-sky-200 font-bold text-xs"
                >
                  📜 Паспорт шара
                </button>
              </div>
            </div>
          ))}

        {isUnlocked && loadState === "demo" && myGift && (
          <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-amber-400/30 flex items-center gap-3.5">
            <VoxelSnowglobe3DViewer
              voxels={myGift.snowglobe?.voxels}
              baseMaterial={myGift.snowglobe?.base_material}
              glitterColor={myGift.snowglobe?.glitter_color}
              engravingText={myGift.snowglobe?.engraving_text}
              size="sm"
            />
            <div className="space-y-1.5 text-xs">
              <div className="font-bold text-amber-200">
                {myGift.card_preview?.teaser_tag}
              </div>
              <p className="text-slate-300 leading-relaxed">
                «{myGift.secret_wish}»
              </p>
              <div className="text-[11px] text-emerald-300">
                {mutual
                  ? "🤝 Оба мастера дали согласие! Контакт открыт: @polar_navigator_2026"
                  : "Ожидается ваше согласие на обмен прямыми контактами."}
              </div>
            </div>
          </div>
        )}

        {isUnlocked && loadState === "demo" && myGift && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setMyConsent(true);
                setPartnerConsent(true);
                onTriggerOwlFlight?.({
                  handshake_id: `hs-${Date.now()}`,
                  from_city: myGift.card_preview?.city || "Мирный",
                  to_city: "Санкт-Петербург",
                });
              }}
              className="flex-1 py-2.5 px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs"
            >
              🤝 Подтвердить Рукопожатие и выпустить Сову
            </button>
            <button
              type="button"
              onClick={() => onOpenNftPassport?.(myGift, "Санкт-Петербург")}
              className="py-2.5 px-3 rounded-xl bg-sky-500/20 border border-sky-400/50 text-sky-200 font-bold text-xs"
            >
              📜 Паспорт шара
            </button>
          </div>
        )}

        {isUnlocked && loadState === "demo" && !myGift && (
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-amber-400/30 text-xs text-slate-300 leading-relaxed">
            Демо-режим: повесьте свой хрустальный шар на Ёлку, чтобы испытать
            Двойное Рукопожатие и полёт Северной Совы.
          </div>
        )}
      </div>
    </div>
  );
}

function InviteSheet({ gift, isOwn, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!gift) return null;
  const url = giftShareUrl(gift);
  const text = isOwn ? INVITE_TEXT : `Посмотри шар «${gift.card_preview?.teaser_tag || ""}» на Всемирной ёлке 🎄`;
  const enc = encodeURIComponent;
  const links = [
    { id: "tg", label: "Telegram", href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}` },
    { id: "wa", label: "WhatsApp", href: `https://wa.me/?text=${enc(`${text} ${url}`)}` },
    { id: "vk", label: "ВКонтакте", href: `https://vk.com/share.php?url=${enc(url)}&title=${enc(text)}` },
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* буфер обмена недоступен */
    }
  };
  return (
    <div className="fixed inset-0 z-[58] bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Пригласить">
      <button type="button" aria-label="Закрыть" onClick={onClose} className="absolute inset-0" />
      <div className={`${glassPanel} relative w-full max-w-md rounded-t-3xl sm:rounded-3xl p-4 space-y-3 wfg-safe-b wfg-mh-92 overflow-y-auto`}>
        <div className="flex items-center justify-between">
          <div className="font-serif text-lg text-amber-50">{isOwn ? "Позовите друзей зажечь свечу" : "Поделиться шаром"}</div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="w-10 h-10 rounded-xl bg-white/10 text-slate-200 text-lg">✕</button>
        </div>
        {!gift.offline && (
          <img
            src={`/api/share/gift/${encodeURIComponent(gift.id)}.png?v=${gift.candles_count || 0}`}
            alt="Превью шара для мессенджеров"
            className="w-full rounded-2xl border border-white/10 aspect-[1200/630] object-cover bg-white/5"
          />
        )}
        <div className="text-xs text-slate-400">Так ссылка будет выглядеть в мессенджере. Каждая свеча поднимает шар выше.</div>
        <div className="grid grid-cols-3 gap-2">
          {links.map((l) => (
            <a
              key={l.id}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-center text-xs text-slate-100"
            >
              {l.label}
            </a>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={copy} className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-100">
            {copied ? "✓ Скопировано" : "Скопировать ссылку"}
          </button>
          {typeof navigator !== "undefined" && navigator.share && (
            <button
              type="button"
              onClick={() => navigator.share({ title: text, text, url }).catch(() => {})}
              className="flex-1 py-2.5 rounded-xl bg-amber-300 hover:bg-amber-200 text-slate-950 text-xs font-semibold"
            >
              Другое…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ShareGiftButton({ gift, title }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = giftShareUrl(gift);
    try {
      if (navigator.share) {
        await navigator.share({ title, text: "Шар на Всемирной ёлке 🎄", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* окно «Поделиться» закрыли — ничего не делаем */
    }
  };
  return (
    <button
      type="button"
      onClick={share}
      className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-100 text-xs font-semibold"
    >
      {copied ? "✓ Ссылка скопирована" : "🔗 Поделиться ссылкой на шар"}
    </button>
  );
}

function NftRelicPassportModal({ isOpen, onClose, gift, recipientCity }) {
  if (!isOpen || !gift) return null;
  const nftMeta = buildNftRelicMetadata(gift, recipientCity);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex items-end sm:items-center justify-center sm:p-3" role="dialog" aria-modal="true" aria-label="Паспорт шара">
      <div className="max-w-lg w-full bg-[#091224] border border-sky-400/50 rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl wfg-mh-92 overflow-y-auto wfg-safe-b">
        <div className="wfg-sticky-head flex items-center justify-between">
          <span className="text-xs font-mono text-sky-300 font-bold">
            📜 Паспорт шара · {nftMeta.token_id}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-10 h-10 rounded-xl bg-slate-800 text-slate-200 text-lg"
          >
            ✕
          </button>
        </div>

        <h3 className="font-serif text-xl font-bold text-white">
          {nftMeta.name}
        </h3>
        <p className="text-xs text-slate-300 leading-relaxed">
          {nftMeta.description}
        </p>

        <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[10px] text-sky-300 break-all">
          Отпечаток (SHA-256): {nftMeta.genome_sha256}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {nftMeta.attributes.slice(0, 8).map((attr, idx) => (
            <div
              key={idx}
              className="p-2 rounded-xl bg-slate-900/90 border border-slate-800"
            >
              <div className="text-[10px] text-slate-400 uppercase">
                {attr.trait_type}
              </div>
              <div className="text-xs font-bold text-amber-300 mt-0.5">
                {attr.value}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-slate-400 leading-snug">
          Паспорт и 3D-открытка — память о шаре: открытка работает без сайта, её можно переслать
          или сохранить. В блокчейн шар не выпускается.
        </p>

        {!gift.offline && <ShareGiftButton gift={gift} title={nftMeta.name} />}

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            type="button"
            onClick={() =>
              triggerBrowserFileDownload(
                `${nftMeta.token_id}-3d-capsule.html`,
                generateStandalone3DCapsuleHtml(nftMeta),
                "text/html;charset=utf-8"
              )
            }
            className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-bold text-xs"
          >
            ⬇ 3D-открытка (.html)
          </button>
          <button
            type="button"
            onClick={() =>
              triggerBrowserFileDownload(
                `${nftMeta.token_id}-metadata.json`,
                JSON.stringify(nftMeta, null, 2),
                "application/json;charset=utf-8"
              )
            }
            className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-400/40 font-bold text-xs"
          >
            Метаданные (.json)
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5.9. ПРИВЕТСТВИЕ И КРАТКИЙ ГАЙД (показывается при первом визите и по «❓»)
// ============================================================================
const WELCOME_STEPS = [
  {
    icon: "🧊",
    title: "Слепите фигурку",
    text: "В хрустальном шаре — конструктор из кубиков 8×8×8. Возьмите готовый домик, ёлочку или снеговика или соберите что-то своё.",
  },
  {
    icon: "🎻",
    title: "Сочините мелодию",
    text: "Пять инструментов шкатулки: челеста, арфа, виолончель, флейта и бубенцы. Не уверены в себе — подберите лад и попросите ИИ гармонизировать.",
  },
  {
    icon: "📜",
    title: "Напишите тайное пожелание",
    text: "Его прочтёт только тот, кому достанется ваш шар, — в новогоднюю ночь. Оставьте контакт: он откроется, только если вы оба нажмёте «Познакомиться».",
  },
  {
    icon: "🕯",
    title: "Повесьте шар и зажигайте свечи",
    text: "Каждый день у вас 3 свечи — по одной на шар. Свеча поднимает шар выше по Ёлке, а шар, собравший больше всех свечей за сутки, становится «Шаром дня». Свечи пополняются в полночь по Москве.",
  },
  {
    icon: "🦉",
    title: "Ждите полуночи",
    text: "В Новогоднюю полночь сомкнётся Кольцо Чудес: вам достанется шар мастера из другого города, а ваш — кому-то, кто его очень ждёт.",
  },
];

function WelcomeGuideModal({ isOpen, onClose, onStart, maxGifts = 3 }) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-[55] bg-slate-950/80 backdrop-blur-lg flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wfg-welcome-title"
    >
      <div className="w-full max-w-lg wfg-mh-92 overflow-y-auto bg-[#091224] border border-amber-400/50 rounded-3xl shadow-2xl p-5 space-y-4">
        <div className="wfg-sticky-head flex justify-end !pb-0 !bg-transparent">
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-10 h-10 rounded-xl bg-slate-800/90 text-slate-200 text-lg"
          >
            ✕
          </button>
        </div>
        <div className="text-center space-y-2 !mt-0">
          <div className="text-4xl">🎄</div>
          <h2 id="wfg-welcome-title" className="font-serif text-2xl sm:text-3xl font-bold text-amber-50">
            Добро пожаловать к Всемирной ёлке
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Здесь нет покупных подарков — только то, что сделано руками. Каждый шар на этих ветвях
            кто-то собрал по кубику, сочинил ему мелодию и вложил внутрь несколько тёплых слов.
            В новогоднюю ночь все шары разлетятся по Кольцу Чудес, и один из них станет вашим.
          </p>
          <p className="text-sm text-amber-200/90 font-semibold">
            Не бойтесь, что выйдет «не идеально». Чудо делают не пиксели, а внимание.
          </p>
        </div>

        <ol className="space-y-2.5">
          {WELCOME_STEPS.map((step, idx) => (
            <li
              key={step.title}
              className="flex gap-3 items-start p-3 rounded-2xl bg-slate-950/70 border border-slate-800"
            >
              <span className="text-2xl leading-none mt-0.5" aria-hidden="true">
                {step.icon}
              </span>
              <div>
                <div className="text-xs font-bold text-amber-300">
                  {idx + 1}. {step.title}
                </div>
                <div className="text-xs text-slate-300 leading-relaxed mt-0.5">{step.text}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="p-3 rounded-2xl bg-sky-950/40 border border-sky-400/25 text-[11px] text-sky-100 leading-relaxed space-y-1">
          <div>
            👆 <strong>Как гулять по Ёлке:</strong> свайп — облететь и подняться к вершине, щипок двумя
            пальцами (или Ctrl + колесо) — приблизить, тап по шару — послушать его мелодию.
          </div>
          <div>
            🤝 <strong>Правила тепла:</strong> до {maxGifts} шаров на мастера, 3 свечи в день (одна на шар),
            без грубостей, рекламы и ссылок — фильтр это проверит.
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={onStart}
            className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-bold text-sm shadow-lg"
          >
            🤲 Создать свой шар
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-sm"
          >
            Сначала посмотрю Ёлку
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5.95. ИНТЕРФЕЙС НОВОГО ОБЛИКА: верхняя панель, меню-шторка, компактная карточка
// ============================================================================
const glassPanel =
  "bg-[#070d1c]/80 backdrop-blur-xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.45)]";

function NewLookTopBar({ countdownText, isOfflineMode, onOpenRing, onOpenWorkshop, onOpenMenu, onOpenMine }) {
  return (
    <div className="fixed top-3 left-3 right-3 z-30 flex items-start justify-between gap-2 pointer-events-none">
      <button
        type="button"
        onClick={onOpenRing}
        className={`${glassPanel} pointer-events-auto rounded-2xl px-3.5 py-2 text-left min-w-0`}
      >
        <div className="font-serif text-base sm:text-xl text-amber-50 leading-tight truncate">
          Всемирная ёлка
        </div>
        <div className="text-[11px] text-slate-300 font-mono whitespace-nowrap">
          {isOfflineMode ? "демо-режим · " : ""}
          <span className="hidden sm:inline">до Кольца Чудес </span>⏳ {countdownText}
        </div>
      </button>
      <div className="flex items-center gap-2 pointer-events-auto shrink-0">
        <button
          type="button"
          onClick={onOpenWorkshop}
          aria-label="Создать шар"
          className="px-3.5 sm:px-4 py-2.5 rounded-2xl bg-amber-300 hover:bg-amber-200 text-slate-950 font-semibold text-sm shadow-lg transition"
        >
          <span className="sm:hidden">＋ Шар</span>
          <span className="hidden sm:inline">Создать шар</span>
        </button>
        <button
          type="button"
          onClick={onOpenMine}
          aria-label="Мои шары"
          title="Мои шары"
          className={`${glassPanel} w-11 h-11 rounded-2xl flex items-center justify-center text-lg`}
        >
          🎁
        </button>
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Открыть меню"
          className={`${glassPanel} w-11 h-11 rounded-2xl flex flex-col items-center justify-center gap-[5px]`}
        >
          <span className="block w-5 h-[2px] bg-slate-100 rounded" />
          <span className="block w-5 h-[2px] bg-slate-100 rounded" />
          <span className="block w-3.5 h-[2px] bg-slate-100 rounded self-center" />
        </button>
      </div>
    </div>
  );
}

function MenuSection({ title, children }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{title}</div>
      {children}
    </div>
  );
}

function formatResetTime(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "00:00 МСК";
  const ms = t - Date.now();
  if (ms <= 0) return "вот-вот";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `через ${h} ч ${m} мин` : `через ${m} мин`;
}

function CandleDaySection({ quota, leaders, cityInfo, onShowGift }) {
  const limit = quota?.limit || 3;
  const remaining = quota?.remaining ?? limit;
  const winner = leaders?.yesterday_winner;
  const today = leaders?.today || [];
  return (
    <div className="space-y-2.5">
      <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-200">Ваши свечи на сегодня</div>
          <div className="text-base tracking-wide" aria-label={`Осталось ${remaining} из ${limit}`}>
            {Array.from({ length: limit }).map((_, i) => (
              <span key={i} className={i < remaining ? "" : "opacity-25 grayscale"}>🕯</span>
            ))}
          </div>
        </div>
        <div className="mt-1 text-[11px] text-slate-400 leading-snug">
          Каждый день — {limit} свечи, одна на шар. Пополнятся {formatResetTime(quota?.resetsAt)}.
          Шар, собравший больше всех свечей за сутки, становится «Шаром дня».
        </div>
      </div>
      {winner && (
        <button
          type="button"
          onClick={() => onShowGift(winner.gift_id)}
          className="w-full text-left rounded-2xl bg-amber-300/10 border border-amber-300/30 p-3 hover:bg-amber-300/15"
        >
          <div className="text-[11px] uppercase tracking-[0.12em] text-amber-200/80">👑 Шар дня (итог вчера)</div>
          <div className="font-serif text-amber-50 truncate">«{winner.teaser_tag}»</div>
          <div className="text-[11px] text-slate-400 truncate">
            {winner.author_display_name} · {winner.city} · 🕯 {winner.candles} за сутки
          </div>
        </button>
      )}
      {cityInfo?.city && (
        <button
          type="button"
          disabled={!cityInfo.today}
          onClick={() => cityInfo.today && onShowGift(cityInfo.today.gift_id)}
          className="w-full text-left rounded-2xl bg-white/5 border border-white/10 p-3 hover:bg-white/10 disabled:hover:bg-white/5"
        >
          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">🏙 Шар дня · {cityInfo.city}</div>
          <div className="text-xs text-slate-200 truncate mt-0.5">
            {cityInfo.today
              ? `«${cityInfo.today.teaser_tag}» · 🕯 ${cityInfo.today.candles} сегодня`
              : "Сегодня в вашем городе ещё не зажигали свечей"}
          </div>
        </button>
      )}
      <div className="space-y-1">
        <div className="text-[11px] text-slate-400">Гонка сегодня</div>
        {today.length === 0 ? (
          <div className="text-xs text-slate-500">Сегодня ещё никто не зажигал свечей — ваша может решить всё.</div>
        ) : (
          today.map((e, i) => (
            <button
              key={e.gift_id}
              type="button"
              onClick={() => onShowGift(e.gift_id)}
              className="w-full flex items-center gap-2 rounded-xl px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-left"
            >
              <span className="w-5 text-xs text-amber-200">{i === 0 ? "★" : i + 1}</span>
              <span className="flex-1 min-w-0 truncate text-xs text-slate-200">«{e.teaser_tag}»</span>
              <span className="text-xs text-slate-400">🕯 {e.candles}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 5.95. АДВЕНТ-КАЛЕНДАРЬ И АЧИВКИ
// ============================================================================
function AdventModal({ today, opened, onOpen, onClose }) {
  const before = today === 0;
  const streak = adventStreak(opened, today);
  const DEC = (d) => `${d} дек`;
  return (
    <div className="fixed inset-0 z-[57] bg-slate-950/80 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Адвент-календарь">
      <button type="button" aria-label="Закрыть" onClick={onClose} className="absolute inset-0" />
      <div className={`${glassPanel} relative w-full max-w-3xl wfg-mh-94 overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 space-y-3 wfg-safe-b`}>
        <div className="wfg-sticky-head flex items-start justify-between gap-3">
          <div>
            <div className="font-serif text-xl text-amber-50">Адвент-календарь</div>
            <div className="text-xs text-slate-400">
              {before
                ? `Первое окошко откроется 1 декабря — через ${daysUntilAdvent()} дн. Каждый день — новый подарок для мастерской.`
                : today > 31
                ? "Календарь этого года завершён. С Новым годом!"
                : `Сегодня ${today} декабря. Открыто ${opened.size} из 31${streak > 1 ? ` · серия ${streak} дн. подряд 🔥` : ""}`}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="w-10 h-10 shrink-0 rounded-xl bg-white/10 text-slate-200 text-lg">✕</button>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {ADVENT_DAYS.map((d) => {
            const isOpen = opened.has(d.day) && d.day <= today;
            const canOpen = !isOpen && d.day <= today && today <= 31;
            const isToday = d.day === today;
            return (
              <button
                key={d.day}
                type="button"
                disabled={!canOpen}
                onClick={() => onOpen(d)}
                title={isOpen ? d.title : canOpen ? "Открыть окошко" : `Откроется ${d.day} декабря`}
                className={`relative aspect-square rounded-2xl border p-1.5 flex flex-col items-center justify-center text-center transition ${
                  isOpen
                    ? "bg-amber-300/10 border-amber-300/30"
                    : canOpen
                    ? "bg-gradient-to-br from-rose-500/40 to-amber-400/40 border-amber-200/60 animate-pulse hover:scale-105"
                    : "bg-white/[0.03] border-white/10"
                } ${isToday ? "ring-2 ring-amber-300" : ""}`}
              >
                <span className="absolute top-1 left-1.5 text-[10px] text-slate-400">{d.day}</span>
                {isOpen ? (
                  <>
                    <span className="text-2xl leading-none">{d.icon}</span>
                    <span className="mt-1 text-[9px] leading-tight text-amber-100 line-clamp-2">{d.title}</span>
                  </>
                ) : canOpen ? (
                  <span className="text-2xl">🎁</span>
                ) : (
                  <span className="text-lg text-slate-600">🔒</span>
                )}
                {!isOpen && !canOpen && <span className="mt-1 text-[9px] text-slate-600">{DEC(d.day)}</span>}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-slate-500">
          Пропустили день — не страшно: прошедшие окошки можно открыть позже. Фигурки, цвета и звуки появятся в мастерской, погода
          и гирлянда — в меню Ёлки.
        </div>
      </div>
    </div>
  );
}

// Значок «Поделиться»: три связанные точки — привычный по Android и мессенджерам
function ShareIcon({ className = "w-5 h-5" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="18" cy="5" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="19" r="2.6" fill="currentColor" stroke="none" />
      <path d="M8.3 10.8 15.7 6.4M8.3 13.2l7.4 4.4" />
    </svg>
  );
}

// Миниатюра фигурки: изометрия вокселей на маленьком canvas (без WebGL)
function VoxelThumb({ voxels, size = 56 }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.clearRect(0, 0, size, size);
    const grad = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(186,230,253,0.18)");
    grad.addColorStop(1, "rgba(186,230,253,0.04)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    g.fill();
    const list = (voxels || []).slice(0, 512);
    const s = size / 22;
    const h = s * 1.15;
    const ox = size / 2;
    const oy = size * 0.72;
    const P = (x, y, z) => [ox + (x - z) * s, oy + (x + z) * s * 0.5 - y * h - 8 * s * 0.5];
    const shade = (hex, k) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
      const n = m ? parseInt(m[1], 16) : 0xfbbf24;
      const r = Math.min(255, ((n >> 16) & 255) * k) | 0;
      const gg = Math.min(255, ((n >> 8) & 255) * k) | 0;
      const b = Math.min(255, (n & 255) * k) | 0;
      return `rgb(${r},${gg},${b})`;
    };
    const poly = (pts, fill) => {
      g.fillStyle = fill;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    };
    [...list]
      .sort((a, b) => a.x + a.z - (b.x + b.z) || a.y - b.y)
      .forEach((v) => {
        const x = v.x - 3.5;
        const y = v.y;
        const z = v.z - 3.5;
        poly([P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], shade(v.color, 1.08));
        poly([P(x, y + 1, z + 1), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1), P(x, y, z + 1)], shade(v.color, 0.7));
        poly([P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1), P(x + 1, y, z)], shade(v.color, 0.88));
      });
  }, [voxels, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} className="shrink-0 rounded-full" aria-hidden="true" />;
}

function dayLabel(day, today) {
  if (!day) return "";
  if (day === today) return "сегодня";
  const d = new Date(`${day}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  const diff = Math.round((t - d) / 86400000);
  if (diff === 1) return "вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function MyGiftsSheet({ data, loading, error, onRetry, initialTab = "mine", litToday, candlesLeft, onShow, onShare, onEdit, onCreate, onClose }) {
  const [tab, setTab] = useState(initialTab);
  const mine = data?.mine || [];
  const lit = data?.lit || [];
  const list = tab === "mine" ? mine : lit;
  const tabBtn = (id, label, n) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`flex-1 py-2 rounded-xl text-sm ${tab === id ? "bg-white/15 text-white font-semibold" : "text-slate-400"}`}
    >
      {label}
      {n > 0 && <span className="ml-1.5 text-xs opacity-70">{n}</span>}
    </button>
  );
  return (
    <div className="fixed inset-0 z-[57] bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Мои шары">
      <button type="button" aria-label="Закрыть фон" onClick={onClose} className="absolute inset-0" />
      <div className={`${glassPanel} relative w-full max-w-lg wfg-mh-88 flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden`}>
        <div className="p-4 pb-3 border-b border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-serif text-xl text-amber-50">Мои шары</div>
            <button type="button" onClick={onClose} aria-label="Закрыть" className="w-10 h-10 rounded-xl bg-white/10 text-slate-200 text-lg">
              ✕
            </button>
          </div>
          <div className="flex gap-1 p-1 rounded-2xl bg-white/5">
            {tabBtn("mine", "🎄 Мои", mine.length)}
            {tabBtn("lit", "🕯 Я зажёг", lit.length)}
          </div>
        </div>
        <div className="p-3 overflow-y-auto flex-1 space-y-2">
          {loading && !data && <div className="text-sm text-slate-400 p-3">Собираем шары…</div>}
          {!loading && error && !data && (
            <div className="text-center p-6 space-y-3">
              <div className="text-sm text-slate-300">Ёлка не ответила вовремя — так бывает на слабой связи.</div>
              <button type="button" onClick={onRetry} className="px-5 py-2.5 rounded-xl bg-amber-300 text-slate-950 font-semibold text-sm">
                Попробовать ещё раз
              </button>
            </div>
          )}
          {!loading && !(error && !data) && list.length === 0 && (
            <div className="text-center p-6 space-y-3">
              <div className="text-4xl">{tab === "mine" ? "🎁" : "🕯"}</div>
              <div className="text-sm text-slate-300">
                {tab === "mine"
                  ? "Вы ещё не повесили ни одного шара."
                  : "Вы ещё не зажигали свечей. Найдите шар, который тронул, — и поддержите мастера."}
              </div>
              {tab === "mine" && (
                <button type="button" onClick={onCreate} className="px-5 py-2.5 rounded-xl bg-amber-300 text-slate-950 font-semibold text-sm">
                  Создать шар
                </button>
              )}
            </div>
          )}
          {list.map((g) => {
            const card = g.card_preview || {};
            return (
              <div key={g.id} className="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 p-2.5">
                <button type="button" onClick={() => onShow(g.id)} className="shrink-0" aria-label={`Показать «${card.teaser_tag}» на Ёлке`}>
                  <VoxelThumb voxels={g.snowglobe?.voxels} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-amber-50 truncate font-serif">«{card.teaser_tag}»</div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {tab === "lit" ? `${card.author_display_name} · ${card.city}` : card.city}
                  </div>
                  <div className="text-[11px] text-slate-300 mt-0.5">
                    #{g.rank} · 🕯 {g.candles_count}
                    {tab === "lit" &&
                      ` · ваших ${g.my_candles} · ${
                        g.last_lit_day === data?.today || litToday?.has(g.id) ? "горит сегодня" : dayLabel(g.last_lit_day, data?.today)
                      }`}
                    {tab === "mine" && g.is_quarantined && " · на проверке"}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button type="button" onClick={() => onShow(g.id)} className="px-3 py-1.5 rounded-lg bg-amber-300 text-slate-950 text-xs font-semibold">
                    Показать
                  </button>
                  {tab === "mine" ? (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => onShare(g)} aria-label="Поделиться" className="flex-1 px-2 py-1.5 rounded-lg bg-white/10 text-slate-200 flex items-center justify-center">
                        <ShareIcon className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(g.id)}
                        aria-label="Переделать"
                        title={g.can_edit ? "Переделать шар" : "Править можно раз в несколько дней"}
                        className={`flex-1 px-2 py-1.5 rounded-lg text-xs ${g.can_edit ? "bg-white/10 text-slate-200" : "bg-white/5 text-slate-500"}`}
                      >
                        ✏️
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => onShare(g)} className="px-3 py-1.5 rounded-lg bg-white/10 text-xs text-slate-200 flex items-center gap-1.5">
                      <ShareIcon className="w-3.5 h-3.5" /> Позвать
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {tab === "lit" && lit.length > 0 && candlesLeft != null && (
            <div className="text-[11px] text-slate-500 text-center pt-1">Свечей на сегодня: {candlesLeft}. Каждый день — новые.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TelegramSheet({ status, hasGift, onConnect, onDisconnect, onClose }) {
  return (
    <div className="fixed inset-0 z-[57] bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Уведомления в Telegram">
      <button type="button" aria-label="Закрыть" onClick={onClose} className="absolute inset-0" />
      <div className={`${glassPanel} relative w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-3 wfg-safe-b wfg-mh-92 overflow-y-auto`}>
        <div className="flex items-center justify-between">
          <div className="font-serif text-lg text-amber-50">🔔 Уведомления в Telegram</div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="w-10 h-10 rounded-xl bg-white/10 text-slate-200 text-lg">✕</button>
        </div>
        <ul className="text-sm text-slate-300 space-y-1.5">
          <li>🕯 «Ваш шар зажгли 5 раз»</li>
          <li>👑 «Ваш шар — Шар дня!»</li>
          <li>⏳ «До Кольца Чудес 1 час» и поздравление в полночь</li>
        </ul>
        {!status ? (
          <div className="text-xs text-slate-400">Проверяем…</div>
        ) : !status.enabled ? (
          <div className="text-xs text-amber-200/90">Бот уведомлений скоро заработает — загляните чуть позже.</div>
        ) : !hasGift ? (
          <div className="text-xs text-amber-200/90">Сначала повесьте свой шар — уведомления приходят о нём.</div>
        ) : status.linked ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-emerald-300">✓ Подключено{status.bot ? ` к @${status.bot}` : ""}</span>
            <button type="button" onClick={onDisconnect} className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-slate-300">
              Отключить
            </button>
          </div>
        ) : (
          <button type="button" onClick={onConnect} className="w-full py-3 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 font-semibold text-sm">
            Подключить в Telegram
          </button>
        )}
        <div className="text-[11px] text-slate-500">Бот пишет только о вашем шаре и Кольце Чудес. Отключить можно в любой момент командой /stop.</div>
      </div>
    </div>
  );
}

function AchievementsModal({ data, onClose }) {
  const items = data?.items || [];
  return (
    <div className="fixed inset-0 z-[57] bg-slate-950/80 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Ачивки мастера">
      <button type="button" aria-label="Закрыть" onClick={onClose} className="absolute inset-0" />
      <div className={`${glassPanel} relative w-full max-w-2xl wfg-mh-94 overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 space-y-3 wfg-safe-b`}>
        <div className="wfg-sticky-head flex items-center justify-between">
          <div>
            <div className="font-serif text-xl text-amber-50">Ачивки мастера</div>
            <div className="text-xs text-slate-400">
              Получено {data?.unlocked ?? 0} из {data?.total ?? items.length}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="w-10 h-10 rounded-xl bg-white/10 text-slate-200 text-lg">✕</button>
        </div>
        {!data && <div className="text-sm text-slate-400">Считаем огоньки…</div>}
        <div className="grid sm:grid-cols-2 gap-2">
          {items.map((a) => (
            <div
              key={a.id}
              className={`rounded-2xl border p-3 flex gap-3 items-center ${
                a.unlocked ? "bg-amber-300/10 border-amber-300/30" : "bg-white/[0.03] border-white/10"
              }`}
            >
              <div className={`text-3xl ${a.unlocked ? "" : "grayscale opacity-40"}`}>{a.icon}</div>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-semibold ${a.unlocked ? "text-amber-100" : "text-slate-300"}`}>{a.title}</div>
                <div className="text-[11px] text-slate-400 leading-snug">{a.description}</div>
                {!a.unlocked && a.target > 1 && (
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-amber-300/70" style={{ width: `${Math.round((a.progress / a.target) * 100)}%` }} />
                  </div>
                )}
                {!a.unlocked && a.target > 1 && (
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {a.progress} / {a.target}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NewLookMenu({
  isOpen,
  onClose,
  timeOfDay,
  onTimeOfDay,
  weatherId,
  onWeather,
  onToTop,
  onToGround,
  isHearthOn,
  onToggleHearth,
  onOpenRing,
  onOpenGuide,
  candleQuota,
  candleLeaders,
  onShowGift,
  garlandMode,
  onGarlandMode,
  extraWeather = [],
  extraGarlands = [],
  fest = {},
}) {
  if (!isOpen) return null;
  const chip = (active) =>
    `px-3 py-2 rounded-xl border text-xs transition ${
      active
        ? "bg-amber-300 text-slate-950 border-amber-200 font-semibold"
        : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"
    }`;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Меню">
      <button type="button" aria-label="Закрыть меню" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div
        className={`${glassPanel} absolute right-0 top-0 bottom-0 w-[min(360px,92vw)] rounded-l-3xl flex flex-col overflow-hidden`}
      >
        <div className="flex items-center justify-between px-5 pb-3 border-b border-white/10" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
          <div className="font-serif text-xl text-amber-50">Ёлка</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-10 h-10 rounded-xl bg-white/10 text-slate-200 hover:bg-white/15 text-lg"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-4 space-y-6 wfg-safe-b">

        <MenuSection title="Мои шары">
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => fest.onMine?.("mine")} className={chip(false)}>
              🎄 Мои шары
            </button>
            <button type="button" onClick={() => fest.onMine?.("lit")} className={chip(false)}>
              🕯 Я зажёг
            </button>
          </div>
        </MenuSection>

        <MenuSection title="Праздник">
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={fest.onAdvent} className={`${chip(false)} relative`}>
              📅 Адвент
              {fest.adventBadge && <span className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-rose-400" />}
            </button>
            <button type="button" onClick={fest.onAchievements} className={chip(false)}>
              🏅 Ачивки{fest.achievementsLabel ? ` ${fest.achievementsLabel}` : ""}
            </button>
            <button type="button" onClick={fest.onTelegram} className={`${chip(Boolean(fest.telegramLinked))} col-span-2`}>
              {fest.telegramLinked ? "🔔 Telegram ✓" : "🔔 Уведомления"}
            </button>
            {fest.fireworksUnlocked && (
              <button type="button" onClick={fest.onRehearsal} className={`${chip(false)} col-span-2`}>
                🎆 Запустить салют
              </button>
            )}
          </div>
        </MenuSection>

        <MenuSection title="Свечи дня">
          <CandleDaySection quota={candleQuota} leaders={candleLeaders} cityInfo={fest.cityInfo} onShowGift={onShowGift} />
        </MenuSection>

        <MenuSection title="Время суток">
          <div className="grid grid-cols-4 gap-1.5">
            {Object.values(TIME_OF_DAY).map((t) => (
              <button key={t.id} type="button" onClick={() => onTimeOfDay(t.id)} className={chip(timeOfDay === t.id)}>
                <div className="text-base leading-none mb-1">{t.icon}</div>
                {t.label}
              </button>
            ))}
          </div>
        </MenuSection>

        <MenuSection title="Погода">
          <div className="grid grid-cols-2 gap-1.5">
            {[...WEATHER_PRESETS, ...extraWeather].map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onWeather(w.id)}
                className={`${chip(weatherId === w.id)} text-left flex items-center gap-2`}
              >
                <span className="text-base">{w.icon}</span>
                <span className="leading-tight">
                  {w.title}
                  <span className={`block text-[10px] ${weatherId === w.id ? "text-slate-800" : "text-slate-400"}`}>
                    {w.temp}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </MenuSection>

        <MenuSection title="Прогулка">
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={onToTop} className={chip(false)}>
              К звезде
            </button>
            <button type="button" onClick={onToGround} className={chip(false)}>
              К поляне
            </button>
            <button type="button" onClick={onToggleHearth} className={chip(isHearthOn)}>
              {isHearthOn ? "Камин звучит" : "Звук камина"}
            </button>
            <button type="button" onClick={onOpenRing} className={chip(false)}>
              Кольцо Чудес
            </button>
          </div>
        </MenuSection>

        <MenuSection title="Справка">
          <button type="button" onClick={onOpenGuide} className={`${chip(false)} w-full`}>
            Как это работает
          </button>
        </MenuSection>
        </div>
      </div>
    </div>
  );
}

function CompactGiftCard({
  gift,
  isPlaying,
  isLooping,
  playStep,
  isOwn,
  isLit,
  isReported,
  candlesLeft,
  badge,
  onPlay,
  onToggleLoop,
  onCandle,
  rank,
  total,
  onRankDown,
  onRankUp,
  onClose,
  onInspect,
  onNft,
  onReport,
  onEdit,
  onShare,
}) {
  const [expanded, setExpanded] = useState(false);
  const iconBtn =
    "w-9 h-9 shrink-0 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 flex items-center justify-center text-sm";
  return (
    <div className={`${glassPanel} fixed z-30 left-2.5 right-2.5 bottom-2.5 md:left-auto md:right-4 md:bottom-4 md:w-[400px] rounded-3xl p-3.5`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-serif text-lg text-amber-50 leading-tight truncate">
            «{gift.card_preview.teaser_tag}»
          </div>
          <div className="text-[12px] text-slate-400 truncate">
            {gift.card_preview.author_display_name} · {gift.card_preview.city} · 🕯 {gift.candles_count}
          </div>
          {total > 0 && (
            <div className="text-[11px] text-amber-200/70">
              #{rank} из {total} в рейтинге{badge ? ` · ${badge}` : ""}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRankDown}
          aria-label="Ниже в рейтинге"
          title="Ниже в рейтинге"
          className={iconBtn}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={onRankUp}
          aria-label="Выше в рейтинге"
          title="Выше в рейтинге"
          className={iconBtn}
        >
          ›
        </button>
        <button type="button" onClick={onClose} aria-label="Закрыть" className={iconBtn}>
          ✕
        </button>
      </div>

      {isPlaying && (
        <div className="mt-2.5 flex gap-[3px]" aria-hidden="true">
          {Array.from({ length: 16 }).map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${playStep === i ? "bg-amber-300" : "bg-white/10"}`}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onPlay}
          className="flex-1 py-2.5 rounded-xl bg-white/8 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-100 text-sm"
        >
          {isPlaying ? "■ Стоп" : "▶ Мелодия"}
        </button>
        <button
          type="button"
          onClick={onCandle}
          disabled={isOwn || isLit || candlesLeft === 0}
          className="flex-1 py-2.5 rounded-xl bg-amber-300 hover:bg-amber-200 disabled:bg-amber-300/30 disabled:text-amber-100 text-slate-950 text-sm font-semibold"
        >
          {isOwn
            ? "Ваш шар"
            : isLit
            ? "Свеча горит сегодня"
            : candlesLeft === 0
            ? "Свечи до полуночи"
            : candlesLeft != null
            ? `Зажечь свечу · ${candlesLeft}`
            : "Зажечь свечу"}
        </button>
        {!gift.offline && onShare && (
          <button type="button" onClick={onShare} aria-label="Поделиться" title="Поделиться" className={iconBtn + " h-auto w-11 flex items-center justify-center"}>
            <ShareIcon />
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label="Ещё"
          aria-expanded={expanded}
          className={iconBtn + " h-auto w-11"}
        >
          ⋯
        </button>
      </div>

      {expanded && (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-xs">
          <button type="button" onClick={onInspect} className="py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200">
            Рассмотреть шар
          </button>
          {isOwn && !gift.offline && onEdit && (
            <button type="button" onClick={onEdit} className="py-2 rounded-xl bg-amber-300/15 hover:bg-amber-300/25 text-amber-100">
              ✏️ Переделать шар
            </button>
          )}
          <button type="button" onClick={onNft} className="py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200">
            Паспорт и 3D-капсула
          </button>
          <button
            type="button"
            onClick={onToggleLoop}
            className={`py-2 rounded-xl ${isLooping ? "bg-amber-300/20 text-amber-200" : "bg-white/5 text-slate-200"} hover:bg-white/10`}
          >
            Повтор мелодии: {isLooping ? "вкл" : "выкл"}
          </button>
          {!gift.offline && (
            <button
              type="button"
              onClick={onReport}
              disabled={isReported}
              className="py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 disabled:opacity-50"
            >
              {isReported ? "Жалоба отправлена" : "Пожаловаться"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 6. MAIN 3D WORLD TREE SCENE (CRYSTAL ORBS + TRUE 3D SNOW & CHRISTMAS SANCTUARY)
// ============================================================================
export default function App() {
  const mountRef = useRef(null);
  const fgSnowCanvasRef = useRef(null);
  const giftsMapRef = useRef(new Map());
  const selectedGiftRef = useRef(null);

  const glassGlobeMeshRef = useRef(null);
  const pedestalBaseMeshRef = useRef(null);
  const pedestalRimMeshRef = useRef(null);
  const topCrownCapMeshRef = useRef(null);
  const globalVoxelsMeshRef = useRef(null);
  const globeInstanceToSeqRef = useRef([]);

  const candleFlameMeshRef = useRef(null);
  const candleHaloMeshRef = useRef(null);
  const orbHaloPointsRef = useRef(null);
  const orbHaloMatRef = useRef(null);
  const activeCandlesMetaRef = useRef([]);
  const selectionRingRef = useRef(null);
  const spawnOwlRef = useRef(null);

  const scrollTargetRef = useRef(9.5);
  // Рождественская погода и управление снегопадом (v15.1 Mobile-First)
  const [weatherPresetId, setWeatherPresetId] = useState("christmas_night");
  const [snowDensityMultiplier, setSnowDensityMultiplier] = useState(LOOK_NEW ? 0.35 : 0.7);
  // В новом облике крупные «боке»-хлопья поверх экрана выключены: они спорят с елью.
  const [isForegroundSnowOn, setIsForegroundSnowOn] = useState(!LOOK_NEW);
  const [isHearthSoundOn, setIsHearthSoundOn] = useState(false);
  const [isWeatherDrawerOpen, setIsWeatherDrawerOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMobileCardExpanded, setIsMobileCardExpanded] = useState(false);

  const weatherPresetRef = useRef(CHRISTMAS_ATMOSPHERE_PRESETS[0]);
  // Новый облик: время суток и погода
  const [timeOfDay, setTimeOfDay] = useState("night");
  const [newWeatherId, setNewWeatherId] = useState("clear_night");
  const atmosphereRef = useRef(null);
  const timeOfDayRef = useRef("night");
  const newWeatherRef = useRef(WEATHER_PRESETS[0]);
  const cameraFocusRef = useRef(null);
  const snowDensityRef = useRef(LOOK_NEW ? 0.35 : 0.7);

  const [selectedGift, setSelectedGift] = useState(null);
  const [isInspectModalOpen, setIsInspectModalOpen] = useState(false);
  const [nftModalState, setNftModalState] = useState({
    isOpen: false,
    gift: null,
    recipientCity: null,
  });

  const [currentTier, setCurrentTier] = useState(0);
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [totalVoxelsOnTree, setTotalVoxelsOnTree] = useState(0);
  const [litGiftIds, setLitGiftIds] = useState(() => loadLitGiftIds());
  // Свечи дня: запас на сутки (пополняется в полночь по Москве) и лидеры дня.
  const [candleQuota, setCandleQuota] = useState({ limit: 3, remaining: null, resetsAt: null });
  const [candleLeaders, setCandleLeaders] = useState({ today: [], yesterday_winner: null });
  const [audioPlaybackState, setAudioPlaybackState] = useState({
    playingId: null,
    step: null,
    isPlaying: false,
    isLooping: false,
  });

  const [isWorkshopOpen, setIsWorkshopOpen] = useState(false);
  // Обе гирлянды горят всегда (выбор гирлянды из меню убран)
  const [garlandMode, setGarlandMode] = useState("both");
  const garlandModeRef = useRef(garlandMode);
  useEffect(() => {
    garlandModeRef.current = garlandMode;
    firApiRef.current?.setGarlandMode?.(garlandMode);
  }, [garlandMode]);
  const [isRingModalOpen, setIsRingModalOpen] = useState(false);
  const [myHungGift, setMyHungGift] = useState(null);
  const [owlBanner, setOwlBanner] = useState(null);
  const owlBannerTimeoutRef = useRef(null);
  const [countdownText, setCountdownText] = useState("");
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  const [serverUnlockAtMs, setServerUnlockAtMs] = useState(null);
  // Разница «часы сервера − часы устройства»: у многих телефонов время сбито на минуты.
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  // --- праздник: адвент, карта, ачивки ---
  const [adventOpened, setAdventOpened] = useState(() => loadAdventOpened());
  const [isAdventOpen, setIsAdventOpen] = useState(false);
  const [isAchOpen, setIsAchOpen] = useState(false);
  const [achievements, setAchievements] = useState(null);
  const [myCity, setMyCity] = useState("");
  const adventDay = adventToday(Date.now() + clockOffsetMs);
  const advent = useMemo(() => adventUnlockedItems(adventOpened, adventDay), [adventOpened, adventDay]);
  const adventBadge = adventDay >= 1 && adventDay <= 31 && !adventOpened.has(adventDay);
  const [midnightShow, setMidnightShow] = useState(null);
  const [telegramStatus, setTelegramStatus] = useState(null);
  const [isTelegramOpen, setIsTelegramOpen] = useState(false);
  const telegramLinked = Boolean(telegramStatus?.linked);
  const refreshTelegram = useCallback(() => {
    apiFetchTelegramStatus()
      .then(setTelegramStatus)
      .catch(() => setTelegramStatus({ enabled: false, linked: false }));
  }, []);
  useEffect(() => {
    refreshTelegram();
  }, [refreshTelegram]);
  const handleTelegram = () => {
    refreshTelegram();
    setIsTelegramOpen(true);
  };
  // Скрытая репетиция полуночи для проверки: /?rehearsal=1
  useEffect(() => {
    if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("rehearsal")) return undefined;
    const t = window.setTimeout(() => {
      zoomTargetRef.current = ZOOM_MAX;
      setMidnightShow({ mode: "rehearsal", key: Date.now() });
    }, 6000);
    return () => window.clearTimeout(t);
  }, []);

  const startMidnightShow = useCallback((mode) => {
    musicBoxSynth.init();
    // отходим от Ёлки, чтобы небо с салютом было в кадре
    zoomTargetRef.current = ZOOM_MAX;
    setMidnightShow({ mode, key: Date.now() });
  }, []);
  const [reportedGiftIds, setReportedGiftIds] = useState(() => new Set());
  // Свои шары (с сервера): у них нельзя зажечь свечу, и по ним считаем лимит.
  const [myGiftIds, setMyGiftIds] = useState(() => new Set());
  const [maxGifts, setMaxGifts] = useState(3);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const zoomTargetRef = useRef(1);
  const firApiRef = useRef(null);
  const fireworksRef = useRef(null);
  const lastHangersRef = useRef([]);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(() => {
    try {
      return !localStorage.getItem(WELCOME_SEEN_KEY);
    } catch {
      return false;
    }
  });

  const showToast = useCallback((text, tone = "info") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ text, tone, id: Date.now() });
    toastTimerRef.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const closeWelcome = useCallback(() => {
    setIsWelcomeOpen(false);
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      /* хранилище недоступно */
    }
  }, []);

  const activeWeatherPreset = useMemo(
    () =>
      CHRISTMAS_ATMOSPHERE_PRESETS.find((p) => p.id === weatherPresetId) ||
      CHRISTMAS_ATMOSPHERE_PRESETS[0],
    [weatherPresetId]
  );

  useEffect(() => {
    if (LOOK_NEW) return;
    weatherPresetRef.current = activeWeatherPreset;
  }, [activeWeatherPreset]);

  // Новый облик: погода задаёт снег/ветер и время суток; время можно менять отдельно
  useEffect(() => {
    if (!LOOK_NEW) return;
    const w = ALL_WEATHER.find((p) => p.id === newWeatherId) || WEATHER_PRESETS[0];
    newWeatherRef.current = w;
    weatherPresetRef.current = {
      ...CHRISTMAS_ATMOSPHERE_PRESETS[0],
      windSpeed: w.windSpeed,
      fallSpeed: w.fallSpeed,
      diamondSparkle: w.diamondSparkle,
    };
    snowDensityRef.current = w.snow;
    setSnowDensityMultiplier(w.snow);
    atmosphereRef.current?.set(timeOfDayRef.current, w);
  }, [newWeatherId]);

  useEffect(() => {
    if (!LOOK_NEW) return;
    timeOfDayRef.current = timeOfDay;
    atmosphereRef.current?.set(timeOfDay, newWeatherRef.current);
  }, [timeOfDay]);

  useEffect(() => {
    snowDensityRef.current = snowDensityMultiplier;
  }, [snowDensityMultiplier]);

  useEffect(() => {
    selectedGiftRef.current = selectedGift;
  }, [selectedGift]);

  // Новый облик: камера облетает Ёлку к выбранному шару и чуть приближается.
  // Первый автоматический выбор при загрузке пропускаем — сцена открывается общим планом.
  // По ссылке /g/<id> (или /?gift=<id>) — наоборот, сразу летим к нужному шару.
  const skipFirstFocusRef = useRef(!deepLinkGiftId());
  const focusKey = selectedGift
    ? `${selectedGift.id}:${selectedGift.coordinates?.sequence_number}`
    : "";
  useEffect(() => {
    if (!LOOK_NEW) return;
    if (!selectedGift) {
      cameraFocusRef.current = null;
      zoomTargetRef.current = 1;
      return;
    }
    if (skipFirstFocusRef.current) {
      skipFirstFocusRef.current = false;
      return;
    }
    const { branch_angle_rad, radius_offset, y_height } = selectedGift.coordinates;
    cameraFocusRef.current = {
      angle: branch_angle_rad,
      x: Math.cos(branch_angle_rad) * radius_offset,
      y: 60.0 - y_height + 0.2,
      z: Math.sin(branch_angle_rad) * radius_offset,
    };
    scrollTargetRef.current = Math.min(MAX_SCROLL_DEPTH, Math.max(0, y_height - 0.5));
    zoomTargetRef.current = 0.6;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  useEffect(() => {
    return musicBoxSynth.subscribe((st) => {
      setAudioPlaybackState(st);
    });
  }, []);

  useEffect(() => {
    return () => {
      musicBoxSynth.toggleCozyHearthAmbient(false);
    };
  }, []);

  // Передний 2D-параллакс холст рождественских снежинок (60 FPS, 100% видимость на любом экране)
  useEffect(() => {
    const canvas = fgSnowCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const MAX_FG_FLAKES = 180;
    const flakes = Array.from({ length: MAX_FG_FLAKES }, (_, i) => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: 1.4 + Math.random() * 3.6,
      vy: 0.65 + Math.random() * 1.45,
      vx: (Math.random() - 0.5) * 0.7,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.025,
      angle: Math.random() * Math.PI * 2,
      isStarFlake: i % 4 === 0,
      isGoldSparkle: i % 9 === 0,
    }));

    const renderSnowOverlay = () => {
      animId = requestAnimationFrame(renderSnowOverlay);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const density = snowDensityRef.current;
      if (!isForegroundSnowOn || density <= 0.02) return;

      const preset = weatherPresetRef.current;
      const activeCount = Math.min(
        MAX_FG_FLAKES,
        Math.floor(50 * density)
      );

      for (let i = 0; i < activeCount; i++) {
        const f = flakes[i];
        f.phase += 0.02;
        f.angle += f.spin;
        f.y += f.vy * preset.fallSpeed * (0.75 + density * 0.2);
        f.x +=
          (f.vx + Math.sin(f.phase) * 0.65) * preset.windSpeed;

        if (f.y > canvas.height + 12) {
          f.y = -10;
          f.x = Math.random() * canvas.width;
        }
        if (f.x > canvas.width + 12) f.x = -10;
        if (f.x < -12) f.x = canvas.width + 10;

        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.angle);

        if (f.isGoldSparkle) {
          const pulse = 0.45 + 0.5 * Math.sin(f.phase * 2.5);
          ctx.fillStyle = `rgba(253, 224, 71, ${pulse * 0.85})`;
          ctx.beginPath();
          ctx.arc(0, 0, f.r * 0.9, 0, Math.PI * 2);
          ctx.fill();
        } else if (f.isStarFlake && f.r > 2.6) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
          ctx.lineWidth = 1.25;
          for (let arm = 0; arm < 6; arm++) {
            const a = (arm * Math.PI) / 3;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(a) * f.r * 1.9, Math.sin(a) * f.r * 1.9);
            ctx.stroke();
          }
        } else {
          const grad = ctx.createRadialGradient(0, 0, 0.2, 0, 0, f.r * 1.4);
          grad.addColorStop(0, "rgba(255, 255, 255, 0.92)");
          grad.addColorStop(0.6, "rgba(224, 242, 254, 0.55)");
          grad.addColorStop(1, "rgba(255, 255, 255, 0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, f.r * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    };
    renderSnowOverlay();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [isForegroundSnowOn]);

  useEffect(() => {
    const updateTimer = () => {
      const diff = (serverUnlockAtMs ?? UNLOCK_TARGET_MS) - (Date.now() + clockOffsetMs);
      if (diff <= 0) {
        setCountdownText("Кольцо Чудес открыто!");
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const mins = Math.floor((diff / (1000 * 60)) % 60);
      const secs = Math.floor((diff / 1000) % 60);
      setCountdownText(
        `${days}д ${String(hours).padStart(2, "0")}ч ${String(mins).padStart(
          2,
          "0"
        )}м ${String(secs).padStart(2, "0")}с`
      );
    };
    updateTimer();
    const id = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(id);
  }, [serverUnlockAtMs, clockOffsetMs]);

  // Настоящая полночь: если Ёлка открыта, за 10 секунд до обмена начинается шоу.
  useEffect(() => {
    const target = serverUnlockAtMs ?? UNLOCK_TARGET_MS;
    // куранты начинаются заранее: 12-й удар — ровно в полночь
    const msLeft = target - (Date.now() + clockOffsetMs) - (CHIMES_LEAD_S * 1000 + 500);
    if (msLeft < -5_000 || msLeft > 2 ** 31 - 1) return undefined;
    const t = window.setTimeout(() => {
      zoomTargetRef.current = ZOOM_MAX;
      setMidnightShow({ mode: "live", key: target });
    }, Math.max(0, msLeft));
    return () => window.clearTimeout(t);
  }, [serverUnlockAtMs, clockOffsetMs]);

  const syncInstancedMeshes = useCallback(() => {
    if (LOOK_NEW) {
      // Координаты меняем на месте: копии подарков в состоянии React делят
      // с картой один объект coordinates и сразу видят новую раскладку.
      const total = giftsMapRef.current.size;
      giftsMapRef.current.forEach((gift, seq) => {
        if (!gift?.coordinates) return;
        Object.assign(gift.coordinates, computeDisplaySlot(seq, total));
      });
    }
    const glassGlobeMesh = glassGlobeMeshRef.current;
    const pedestalMesh = pedestalBaseMeshRef.current;
    const rimMesh = pedestalRimMeshRef.current;
    const crownCapMesh = topCrownCapMeshRef.current;
    const voxelsMesh = globalVoxelsMeshRef.current;
    const flameMesh = candleFlameMeshRef.current;
    const haloMesh = candleHaloMeshRef.current;

    if (
      !glassGlobeMesh ||
      !pedestalMesh ||
      !rimMesh ||
      !crownCapMesh ||
      !voxelsMesh ||
      !flameMesh ||
      !haloMesh
    ) {
      return;
    }

    const dummy = new THREE.Object3D();
    const voxelDummy = new THREE.Object3D();
    const colorHelper = new THREE.Color();

    const instanceToSeq = [];
    const candleMeta = [];
    const orbHaloMeta = [];
    const hangers = [];
    let globeIdx = 0;
    let globalVoxelIdx = 0;

    const ORB = GIFT_ORB_SCALE;
    const miniVoxelSize = 0.092 * ORB;

    giftsMapRef.current.forEach((gift) => {
      if (globeIdx >= MAX_INSTANCES) return;

      const { sequence_number, branch_angle_rad, radius_offset, y_height } =
        gift.coordinates;
      const worldY = 60.0 - y_height;
      const worldX = Math.cos(branch_angle_rad) * radius_offset;
      const worldZ = Math.sin(branch_angle_rad) * radius_offset;
      const yaw = -branch_angle_rad + Math.PI * 0.5;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);

      dummy.position.set(worldX, worldY - 0.36 * ORB, worldZ);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(ORB, ORB, ORB);
      dummy.updateMatrix();
      pedestalMesh.setMatrixAt(globeIdx, dummy.matrix);

      const baseHex =
        BASE_MAT_COLOR_MAP[gift.snowglobe?.base_material] || "#5c2409";
      colorHelper.set(baseHex);
      pedestalMesh.setColorAt(globeIdx, colorHelper);

      dummy.position.set(worldX, worldY - 0.24 * ORB, worldZ);
      dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.scale.set(ORB, ORB, ORB);
      dummy.updateMatrix();
      rimMesh.setMatrixAt(globeIdx, dummy.matrix);

      dummy.position.set(worldX, worldY + 0.14 * ORB, worldZ);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(ORB, ORB, ORB);
      dummy.updateMatrix();
      glassGlobeMesh.setMatrixAt(globeIdx, dummy.matrix);
      colorHelper.set(gift.snowglobe?.glitter_color || "#e0f2fe");
      glassGlobeMesh.setColorAt(globeIdx, colorHelper);

      dummy.position.set(worldX, worldY + 0.76 * ORB, worldZ);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(ORB, ORB, ORB);
      dummy.updateMatrix();
      crownCapMesh.setMatrixAt(globeIdx, dummy.matrix);

      const voxelsList =
        gift.snowglobe?.voxels && gift.snowglobe.voxels.length > 0
          ? gift.snowglobe.voxels
          : VOXEL_BLUEPRINTS[0].blocks;

      for (let vIdx = 0; vIdx < voxelsList.length; vIdx++) {
        if (globalVoxelIdx >= MAX_TOTAL_TREE_VOXELS) break;
        const v = voxelsList[vIdx];

        const lx = (v.x - 3.5) * miniVoxelSize;
        const ly = -0.2 * ORB + v.y * miniVoxelSize;
        const lz = (v.z - 3.5) * miniVoxelSize;

        const rx = lx * cosY - lz * sinY;
        const rz = lx * sinY + lz * cosY;

        voxelDummy.position.set(worldX + rx, worldY + ly, worldZ + rz);
        voxelDummy.rotation.set(0, yaw, 0);
        voxelDummy.scale.set(
          miniVoxelSize * 0.95,
          miniVoxelSize * 0.95,
          miniVoxelSize * 0.95
        );
        voxelDummy.updateMatrix();

        voxelsMesh.setMatrixAt(globalVoxelIdx, voxelDummy.matrix);
        colorHelper.set(v.color || "#fbbf24");
        voxelsMesh.setColorAt(globalVoxelIdx, colorHelper);
        globalVoxelIdx++;
      }

      instanceToSeq.push(sequence_number);

      const cCount = gift.candles_count || 0;
      const baseScale =
        cCount > 0 ? Math.min(0.32 + cCount * 0.045, 0.78) : 0.0001;
      candleMeta.push({
        worldX,
        worldY: worldY + 0.98 * ORB,
        worldZ,
        baseScale: baseScale * ORB,
        phase: sequence_number * 1.37,
        hasCandle: cCount > 0,
      });

      hangers.push({ x: worldX, z: worldZ, topY: worldY + (LOOK_NEW ? 1.03 : 0.98) * ORB });

      orbHaloMeta.push({
        worldX,
        worldY: worldY + 0.14 * ORB,
        worldZ,
        color: gift.snowglobe?.glitter_color || "#fde047",
        size: (2.2 + Math.min(0.6, cCount * 0.05)) * ORB,
        phase: sequence_number * 0.61,
      });

      globeIdx++;
    });

    globeInstanceToSeqRef.current = instanceToSeq;
    lastHangersRef.current = hangers;
    if (firApiRef.current) firApiRef.current.setGiftHangers(hangers);

    glassGlobeMesh.count = globeIdx;
    pedestalMesh.count = globeIdx;
    rimMesh.count = globeIdx;
    crownCapMesh.count = globeIdx;
    voxelsMesh.count = globalVoxelIdx;
    flameMesh.count = globeIdx;
    haloMesh.count = globeIdx;

    glassGlobeMesh.instanceMatrix.needsUpdate = true;
    pedestalMesh.instanceMatrix.needsUpdate = true;
    rimMesh.instanceMatrix.needsUpdate = true;
    crownCapMesh.instanceMatrix.needsUpdate = true;
    voxelsMesh.instanceMatrix.needsUpdate = true;

    if (glassGlobeMesh.instanceColor)
      glassGlobeMesh.instanceColor.needsUpdate = true;
    if (pedestalMesh.instanceColor)
      pedestalMesh.instanceColor.needsUpdate = true;
    if (voxelsMesh.instanceColor) voxelsMesh.instanceColor.needsUpdate = true;

    for (const m of [
      glassGlobeMesh,
      pedestalMesh,
      rimMesh,
      crownCapMesh,
      voxelsMesh,
      flameMesh,
      haloMesh,
    ]) {
      m.frustumCulled = false;
      m.boundingSphere = null;
      m.boundingBox = null;
    }

    activeCandlesMetaRef.current = candleMeta;

    const orbHalosRef = orbHaloPointsRef.current;
    if (orbHalosRef) {
      const hPos = orbHalosRef.geometry.getAttribute("position");
      const hCol = orbHalosRef.geometry.getAttribute("aColor");
      const hSize = orbHalosRef.geometry.getAttribute("aSize");
      const hPhase = orbHalosRef.geometry.getAttribute("aPhase");
      const tmpHalo = new THREE.Color();
      orbHaloMeta.forEach((m, i) => {
        hPos.setXYZ(i, m.worldX, m.worldY, m.worldZ);
        tmpHalo.set(m.color);
        hCol.setXYZ(i, tmpHalo.r, tmpHalo.g, tmpHalo.b);
        hSize.setX(i, m.size);
        hPhase.setX(i, m.phase);
      });
      hPos.needsUpdate = true;
      hCol.needsUpdate = true;
      hSize.needsUpdate = true;
      hPhase.needsUpdate = true;
      orbHalosRef.geometry.setDrawRange(0, orbHaloMeta.length);
    }

    setTotalLoaded(globeIdx);
    setTotalVoxelsOnTree(globalVoxelIdx);
  }, []);

  // Загрузка витрины подарков из API (фолбэк на демо-данные при недоступности).
  // Размещён ПОСЛЕ syncInstancedMeshes: иначе deps-массив бьётся о TDZ.
  useEffect(() => {
    let cancelled = false;

    const loadShowcase = async () => {
      const [giftsRes, profileRes, ringRes] = await Promise.allSettled([
        apiFetchGifts(),
        apiFetchMyProfile(),
        apiFetchRingStatus(),
      ]);
      if (cancelled) return;

      if (ringRes.status === "fulfilled" && ringRes.value) {
        const serverNow = Date.parse(ringRes.value.server_time || "");
        const offset = Number.isNaN(serverNow) ? 0 : serverNow - Date.now();
        // Сдвиг меньше 2 с не трогаем — это просто задержка сети.
        if (Math.abs(offset) > 2000) setClockOffsetMs(offset);
        if (ringRes.value.unlocked) setServerUnlockAtMs(Date.now() + offset - 1);
        else if (ringRes.value.unlock_at) {
          const parsed = Date.parse(ringRes.value.unlock_at);
          if (!Number.isNaN(parsed)) setServerUnlockAtMs(parsed);
        }
      }
      if (profileRes.status === "fulfilled" && profileRes.value) {
        if (profileRes.value.user_id) setMyUserId(profileRes.value.user_id);
        if (Array.isArray(profileRes.value.gift_ids)) {
          setMyGiftIds(new Set(profileRes.value.gift_ids));
        }
        if (profileRes.value.max_gifts) setMaxGifts(profileRes.value.max_gifts);
        if (profileRes.value.city) setMyCity(profileRes.value.city);
      }

      const map = new Map();
      if (giftsRes.status === "fulfilled" && Array.isArray(giftsRes.value)) {
        giftsRes.value.forEach((dto) => {
          const node = giftNodeFromDTO(dto);
          map.set(node.coordinates.sequence_number, node);
        });
      } else {
        setIsOfflineMode(true);
        generateProceduralGifts(144).forEach((gift, idx) => map.set(idx, gift));
      }
      giftsMapRef.current = map;

      // Ссылка /?gift=<id> открывает конкретный шар (из «Поделиться» и 3D-открытки)
      const wantedId = deepLinkGiftId();
      let firstGift = map.get(0);
      if (wantedId) {
        for (const g of map.values()) {
          if (g.id === wantedId) {
            firstGift = g;
            break;
          }
        }
      }
      if (firstGift) setSelectedGift({ ...firstGift });
      syncInstancedMeshes();
    };

    loadShowcase();
    return () => {
      cancelled = true;
    };
  }, [syncInstancedMeshes]);

  // Живые события Ёлки: полёт Северной Совы после Двойного Рукопожатия
  useEffect(() => {
    const disconnect = connectTreeEvents((event, data) => {
      if (event === "CELESTIAL_OWL_FLIGHT") {
        spawnOwlRef.current?.(data);
      }
    });
    return disconnect;
  }, []);

  useEffect(() => {
    const ring = selectionRingRef.current;
    if (!ring) return;
    if (LOOK_NEW) {
      // в новом облике выбранный шар выделяет камера (центрирует и приближает)
      ring.visible = false;
      return;
    }
    if (!selectedGift) {
      ring.visible = false;
      return;
    }
    const { branch_angle_rad, radius_offset, y_height } =
      selectedGift.coordinates;
    const worldY = 60.0 - y_height;
    const worldX = Math.cos(branch_angle_rad) * radius_offset;
    const worldZ = Math.sin(branch_angle_rad) * radius_offset;
    ring.position.set(worldX, worldY - 0.34 * GIFT_ORB_SCALE, worldZ);
    ring.scale.setScalar(GIFT_ORB_SCALE);
    ring.visible = true;
  }, [selectedGift]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#040914");
    scene.fog = new THREE.FogExp2("#050d1a", 0.011);

    const camera = new THREE.PerspectiveCamera(
      48,
      container.clientWidth / container.clientHeight,
      0.1,
      320
    );

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);

    // Постобработка: мягкое сияние (bloom) для гирлянды, звезды, свечей и авроры
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(container.clientWidth, container.clientHeight);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.35,
      0.45,
      0.85
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const skyGeo = new THREE.SphereGeometry(210, 48, 32);
    const auroraUniforms = {
      uTime: { value: 0 },
      uTopColor: { value: new THREE.Color("#040b1c") },
      uBottomColor: { value: new THREE.Color("#141e38") },
      uAuroraStrength: { value: 1.0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uTopColor;
        uniform vec3 uBottomColor;
        uniform float uAuroraStrength;
        varying vec2 vUv;
        void main() {
          vec3 col = mix(uBottomColor, uTopColor, smoothstep(0.0, 0.85, vUv.y));
          float wave1 = sin(vUv.x * 12.0 + uTime * 0.45) * 0.035;
          float wave2 = cos(vUv.x * 20.0 - uTime * 0.3) * 0.025;
          float band = smoothstep(0.42 + wave1, 0.58 + wave1, vUv.y) * (1.0 - smoothstep(0.62 + wave2, 0.82 + wave2, vUv.y));
          vec3 auroraCol = mix(vec3(0.06, 0.72, 0.51), vec3(0.55, 0.25, 0.92), sin(vUv.x * 6.28 + uTime * 0.2) * 0.5 + 0.5);
          col += auroraCol * band * 0.42 * uAuroraStrength;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      uniforms: auroraUniforms,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyDome);

    const hemiLight = new THREE.HemisphereLight("#93c5fd", "#1e1b4b", 1.65);
    scene.add(hemiLight);
    const starPointLight = new THREE.PointLight("#fde047", 7.2, 72);
    starPointLight.position.set(0, 62.2, 0);
    scene.add(starPointLight);
    const dirLight = new THREE.DirectionalLight("#fef08a", 2.4);
    dirLight.position.set(28, 85, 34);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // ========================================================================
    // ВЕЛИЧЕСТВЕННАЯ ВСЕМИРНАЯ ЕЛЬ v15.0 (ПЫШНАЯ МНОГОСЛОЙНАЯ ХВОЯ И ШИШКИ)
    // ========================================================================
    const trunkGeo = new THREE.CylinderGeometry(0.45, 4.6, 120, 20);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: "#2c1608",
      roughness: 0.92,
    });
    const trunkMesh = new THREE.Mesh(trunkGeo, trunkMat);
    trunkMesh.position.set(0, -16, 0);
    scene.add(trunkMesh);

    // 1. Внутреннее густое ядро из каскадных волнистых ярусов хвои со снежной кромкой
    // (крона достаёт до снежного поля, но не зарывается глубоко под землю)
    const CROWN_TIERS = 35;
    const coreCrownGroup = new THREE.Group();
    const crownMat = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.82,
      flatShading: true,
      vertexColors: true,
    });
    const forestPineMat = new THREE.MeshStandardMaterial({
      color: "#064e3b",
      roughness: 0.8,
      flatShading: true,
    });
    const tierSnowMat = new THREE.MeshStandardMaterial({
      color: "#e2e8f0",
      roughness: 0.52,
      flatShading: true,
    });

    for (let tier = 0; tier < CROWN_TIERS; tier++) {
      const yHeight = tier * 1.85;
      const worldY = 59.8 - yHeight;
      const baseR = getConeEnvelopeRadius(yHeight + 1.2) * 0.88;

      // Основной зубчатый колокол яруса (частые зубцы — рваная хвойная кромка)
      const coneG = new THREE.ConeGeometry(baseR, 3.2, 26, 3);
      const posAttr = coneG.attributes.position;
      for (let vi = 0; vi < posAttr.count; vi++) {
        const vx = posAttr.getX(vi);
        const vy = posAttr.getY(vi);
        const vz = posAttr.getZ(vi);
        if (vy < 0.2) {
          const angle = Math.atan2(vz, vx);
          const ruffle =
            1.0 +
            0.1 * Math.sin(angle * 13.0 + tier * 1.3) +
            0.05 * Math.sin(angle * 5.0 - tier * 0.7);
          posAttr.setX(vi, vx * ruffle);
          posAttr.setZ(vi, vz * ruffle);
          posAttr.setY(
            vi,
            vy + 0.16 * Math.cos(angle * 13.0) + 0.08 * Math.cos(angle * 5.0)
          );
        }
      }
      coneG.computeVertexNormals();

      // Градиент хвои: тень у верха яруса, сочная зелень и инеистая кромка внизу
      const colorArr = new Float32Array(posAttr.count * 3);
      const topTint = new THREE.Color(tier % 2 === 0 ? "#03251d" : "#053228");
      const edgeTint = new THREE.Color(tier % 2 === 0 ? "#0a6049" : "#0d7358");
      const frostTint = new THREE.Color("#bfe8dc");
      const gradColor = new THREE.Color();
      for (let vi = 0; vi < posAttr.count; vi++) {
        const vy = posAttr.getY(vi);
        const tTop = THREE.MathUtils.clamp((vy + 1.6) / 3.2, 0, 1);
        gradColor.lerpColors(edgeTint, topTint, tTop);
        if (vy < 0.2) gradColor.lerp(frostTint, 0.22);
        colorArr[vi * 3] = gradColor.r;
        colorArr[vi * 3 + 1] = gradColor.g;
        colorArr[vi * 3 + 2] = gradColor.b;
      }
      coneG.setAttribute("color", new THREE.BufferAttribute(colorArr, 3));

      const coneM = new THREE.Mesh(coneG, crownMat);
      coneM.position.set(0, worldY, 0);
      coneM.rotation.y = tier * 0.38;
      coneM.castShadow = true;
      coneM.receiveShadow = true;
      coreCrownGroup.add(coneM);

      // Снежная бахрома по краю яруса
      const snowSkirtG = new THREE.ConeGeometry(baseR * 0.96, 1.15, 22);
      const snowSkirtM = new THREE.Mesh(snowSkirtG, tierSnowMat);
      snowSkirtM.position.set(0, worldY - 0.55, 0);
      snowSkirtM.rotation.y = tier * 0.38 + 0.15;
      coreCrownGroup.add(snowSkirtM);
    }
    scene.add(coreCrownGroup);

    // 2. 1350 пушистых веерных еловых лап (5-лучевые кластеры вокруг каждого слота и между ними)
    const totalBoughs = 300;
    const SUB_FRONDS = 7;
    const totalSubFronds = totalBoughs * SUB_FRONDS;

    const boughGeo = new THREE.ConeGeometry(0.95, 2.85, 7);
    boughGeo.rotateX(Math.PI * 0.44);
    const boughMat = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.7,
      flatShading: true,
    });
    const boughInstanced = new THREE.InstancedMesh(
      boughGeo,
      boughMat,
      totalSubFronds
    );
    boughInstanced.castShadow = true;
    boughInstanced.receiveShadow = true;

    // Пухлые снежные подушки на лапах
    const snowCapGeo = new THREE.ConeGeometry(1.08, 1.55, 8);
    snowCapGeo.rotateX(Math.PI * 0.44);
    const snowCapMat = new THREE.MeshStandardMaterial({
      color: "#f1f5f9",
      roughness: 0.45,
      metalness: 0.05,
      flatShading: true,
    });
    const snowCapInstanced = new THREE.InstancedMesh(
      snowCapGeo,
      snowCapMat,
      totalBoughs
    );

    // Настоящие лесные шишки под еловыми лапами
    const pineconesCount = 420;
    const pineconeGeo = new THREE.DodecahedronGeometry(0.24, 1);
    pineconeGeo.scale(0.82, 1.45, 0.82);
    const pineconeMat = new THREE.MeshStandardMaterial({
      color: "#5c2d16",
      roughness: 0.8,
      metalness: 0.1,
    });
    const pineconeInstanced = new THREE.InstancedMesh(
      pineconeGeo,
      pineconeMat,
      pineconesCount
    );

    const boughDummy = new THREE.Object3D();
    const boughColor = new THREE.Color();
    const sparkleTipArr = [];
    const pinePalette = ["#065f46", "#047857", "#064e3b", "#0f766e", "#059669"];
    let frondCursor = 0;

    for (let i = 0; i < totalBoughs; i++) {
      const coords = computeFibonacciSpiralSlot(i);
      const wy = 60.0 - coords.y_height;
      const r = Math.max(0.85, coords.radius_offset - 3.2);
      const baseAngle = coords.branch_angle_rad;

      // Веер из 7 густых хвойных побегов на каждой ветви
      const midF = (SUB_FRONDS - 1) / 2;
      for (let f = 0; f < SUB_FRONDS; f++) {
        const spread = (f - midF) * 0.105;
        const localAngle = baseAngle + spread;
        const reach = r + (f === midF ? 0.35 : f % 2 === 0 ? 0.12 : -0.15);
        const wx = Math.cos(localAngle) * reach;
        const wz = Math.sin(localAngle) * reach;
        const liftY = wy - 0.42 + (f === midF ? 0.08 : -0.06);

        boughDummy.position.set(wx, liftY, wz);
        boughDummy.lookAt(
          Math.cos(localAngle) * (reach + 5.5),
          liftY - 1.05,
          Math.sin(localAngle) * (reach + 5.5)
        );
        const scaleW = 0.85 + (i % 5) * 0.08 + (f === midF ? 0.25 : 0);
        boughDummy.scale.set(scaleW, 0.58, 0.85);
        boughDummy.updateMatrix();
        boughInstanced.setMatrixAt(frondCursor, boughDummy.matrix);

        boughColor.set(pinePalette[(i + f) % pinePalette.length]);
        boughInstanced.setColorAt(frondCursor, boughColor);
        frondCursor++;

        sparkleTipArr.push(
          Math.cos(localAngle) * (reach + 1.25),
          liftY - 0.18,
          Math.sin(localAngle) * (reach + 1.25)
        );
      }

      // Снежная шапка поверх центральной лапы
      boughDummy.position.set(
        Math.cos(baseAngle) * (r + 0.34),
        wy - 0.28,
        Math.sin(baseAngle) * (r + 0.34)
      );
      boughDummy.lookAt(
        Math.cos(baseAngle) * (r + 5.0),
        wy - 0.88,
        Math.sin(baseAngle) * (r + 5.0)
      );
      boughDummy.scale.set(1.05, 0.42, 1.08);
      boughDummy.updateMatrix();
      snowCapInstanced.setMatrixAt(i, boughDummy.matrix);
    }

    // Развешиваем 420 шишек на ветвях
    for (let p = 0; p < pineconesCount; p++) {
      const yH = (p * 0.18) % 72;
      const wy = 59.5 - yH;
      const envR = getConeEnvelopeRadius(yH) * 0.94;
      const ang = p * GOLDEN_ANGLE_RAD * 1.7;
      boughDummy.position.set(
        Math.cos(ang) * envR,
        wy - 0.58,
        Math.sin(ang) * envR
      );
      boughDummy.rotation.set(0.2, ang, 0.15);
      boughDummy.scale.setScalar(0.85 + (p % 3) * 0.2);
      boughDummy.updateMatrix();
      pineconeInstanced.setMatrixAt(p, boughDummy.matrix);
    }

    boughInstanced.instanceMatrix.needsUpdate = true;
    if (boughInstanced.instanceColor)
      boughInstanced.instanceColor.needsUpdate = true;
    snowCapInstanced.instanceMatrix.needsUpdate = true;
    pineconeInstanced.instanceMatrix.needsUpdate = true;

    scene.add(boughInstanced);
    scene.add(snowCapInstanced);
    scene.add(pineconeInstanced);

    // ========================================================================
    // МЕРЦАЮЩИЙ ИНЕЙ НА КОНЕЧКАХ ХВОИ (3D-ИСКРЫ С TWINKLE-ШЕЙДЕРОМ)
    // ========================================================================
    const sparklePosArr = [...sparkleTipArr];
    const EXTRA_CROWN_SPARKLES = 550;
    for (let i = 0; i < EXTRA_CROWN_SPARKLES; i++) {
      const yH = (i * 0.13) % 72;
      const envR = getConeEnvelopeRadius(yH) * (0.55 + Math.random() * 0.42);
      const ang = i * GOLDEN_ANGLE_RAD * 2.3;
      sparklePosArr.push(
        Math.cos(ang) * envR,
        59.6 - yH + Math.random() * 0.6,
        Math.sin(ang) * envR
      );
    }
    const sparkleCount = sparklePosArr.length / 3;
    const sparkleGeo = new THREE.BufferGeometry();
    sparkleGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(sparklePosArr), 3)
    );
    const sparklePhase = new Float32Array(sparkleCount);
    const sparkleSize = new Float32Array(sparkleCount);
    for (let i = 0; i < sparkleCount; i++) {
      sparklePhase[i] = Math.random() * Math.PI * 2;
      sparkleSize[i] = 0.28 + Math.random() * 0.5;
    }
    sparkleGeo.setAttribute("aPhase", new THREE.BufferAttribute(sparklePhase, 1));
    sparkleGeo.setAttribute("aSize", new THREE.BufferAttribute(sparkleSize, 1));
    const sparkleMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        varying float vTwinkle;
        void main() {
          vTwinkle = 0.5 + 0.5 * sin(uTime * 2.1 + aPhase * 9.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (1100.0 / max(1.0, -mv.z)) * (0.55 + 0.9 * vTwinkle);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vTwinkle;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float core = smoothstep(0.5, 0.0, d);
          float rays = max(0.0, 1.0 - abs(uv.x) * 9.0) + max(0.0, 1.0 - abs(uv.y) * 9.0);
          float a = (core * core + rays * 0.35) * (0.25 + 0.75 * vTwinkle);
          vec3 col = mix(vec3(0.72, 0.9, 1.0), vec3(1.0, 0.96, 0.78), vTwinkle);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const frostSparkles = new THREE.Points(sparkleGeo, sparkleMat);
    frostSparkles.frustumCulled = false;
    scene.add(frostSparkles);

    // ========================================================================
    // ПРАЗДНИЧНЫЕ ДЕТАЛИ: СТЕКЛЯННЫЕ ШАРЫ, СОСУЛЬКИ, КАЛИНА И СУГРОБКИ
    // ========================================================================
    const decorGroup = new THREE.Group();
    scene.add(decorGroup);

    // 140 аккуратных игрушек — фон для подарков, не конкурент им
    const ORNAMENT_COUNT = 140;
    const ornamentGeo = new THREE.SphereGeometry(0.18, 12, 10);
    const ornamentMat = new THREE.MeshStandardMaterial({
      metalness: 0.55,
      roughness: 0.18,
    });
    const ornamentInstanced = new THREE.InstancedMesh(
      ornamentGeo,
      ornamentMat,
      ORNAMENT_COUNT
    );
    ornamentInstanced.castShadow = true;
    const ornamentPalette = [
      "#e11d48",
      "#fbbf24",
      "#38bdf8",
      "#f8fafc",
      "#a855f7",
      "#34d399",
    ];
    const ornamentColor = new THREE.Color();
    for (let i = 0; i < ORNAMENT_COUNT; i++) {
      const coords = computeFibonacciSpiralSlot(i + 3);
      const wy = 60.0 - coords.y_height;
      const r = Math.max(0.8, coords.radius_offset - 0.55);
      const ang = coords.branch_angle_rad + 0.35;      boughDummy.position.set(
        Math.cos(ang) * r,
        wy - 0.5,
        Math.sin(ang) * r
      );
      boughDummy.rotation.set(0, 0, 0);
      boughDummy.scale.setScalar(0.85 + (i % 4) * 0.12);
      boughDummy.updateMatrix();
      ornamentInstanced.setMatrixAt(i, boughDummy.matrix);
      ornamentColor.set(ornamentPalette[i % ornamentPalette.length]);
      ornamentInstanced.setColorAt(i, ornamentColor);
    }
    ornamentInstanced.instanceMatrix.needsUpdate = true;
    if (ornamentInstanced.instanceColor)
      ornamentInstanced.instanceColor.needsUpdate = true;
    decorGroup.add(ornamentInstanced);

    // 264 ледяных сосулек под снежными карнизами ярусов
    const ICICLE_COUNT = 210;
    const icicleGeo = new THREE.ConeGeometry(0.06, 0.55, 6);
    icicleGeo.rotateX(Math.PI);
    const icicleMat = new THREE.MeshStandardMaterial({
      color: "#dbeafe",
      transparent: true,
      opacity: 0.62,
      roughness: 0.08,
      metalness: 0.1,
      emissive: "#7dd3fc",
      emissiveIntensity: 0.14,
    });
    const icicleInstanced = new THREE.InstancedMesh(
      icicleGeo,
      icicleMat,
      ICICLE_COUNT
    );
    let icicleIdx = 0;
    for (let tier = 0; tier < CROWN_TIERS; tier++) {
      const yHeight = tier * 1.85;
      const worldY = 59.8 - yHeight;
      const baseR = getConeEnvelopeRadius(yHeight + 1.2) * 0.88;
      for (let k = 0; k < 6; k++) {
        const ang = tier * 0.38 + k * 1.05 + (k % 2) * 0.2;
        const rr = baseR * (0.82 + (k % 3) * 0.06);
        boughDummy.position.set(
          Math.cos(ang) * rr,
          worldY - 1.32,
          Math.sin(ang) * rr
        );
        boughDummy.rotation.set(0, 0, k % 2 ? 0.06 : -0.05);
        boughDummy.scale.setScalar(0.7 + (k % 3) * 0.3);
        boughDummy.updateMatrix();
        icicleInstanced.setMatrixAt(icicleIdx, boughDummy.matrix);
        icicleIdx++;
      }
    }
    icicleInstanced.instanceMatrix.needsUpdate = true;
    decorGroup.add(icicleInstanced);

    // 300 ягод калины — красные кисти на ветвях
    const BERRY_COUNT = 300;
    const berryGeo = new THREE.SphereGeometry(0.085, 8, 6);
    const berryMat = new THREE.MeshStandardMaterial({
      color: "#dc2626",
      roughness: 0.35,
      emissive: "#7f1d1d",
      emissiveIntensity: 0.35,
    });
    const berryInstanced = new THREE.InstancedMesh(
      berryGeo,
      berryMat,
      BERRY_COUNT
    );
    for (let i = 0; i < BERRY_COUNT; i++) {
      const cluster = Math.floor(i / 5);
      const coords = computeFibonacciSpiralSlot(cluster * 3 + 1);
      const wy = 60.0 - coords.y_height;
      const r = Math.max(0.7, coords.radius_offset - 1.1);
      const ang = coords.branch_angle_rad + (i % 5) * 0.09;
      const jx = ((i * 37) % 17) / 17 - 0.5;
      const jy = ((i * 53) % 11) / 11 - 0.5;
      const jz = ((i * 29) % 19) / 19 - 0.5;
      boughDummy.position.set(
        Math.cos(ang) * r + jx * 0.22,
        wy - 0.3 + jy * 0.12,
        Math.sin(ang) * r + jz * 0.22
      );
      boughDummy.rotation.set(0, 0, 0);
      boughDummy.scale.setScalar(0.8 + (i % 3) * 0.18);
      boughDummy.updateMatrix();
      berryInstanced.setMatrixAt(i, boughDummy.matrix);
    }
    berryInstanced.instanceMatrix.needsUpdate = true;
    decorGroup.add(berryInstanced);

    // 240 мягких сугробков на лапах
    const PUFF_COUNT = 240;
    const puffGeo = new THREE.SphereGeometry(0.3, 10, 8);
    puffGeo.scale(1.15, 0.5, 1.15);
    const puffMat = new THREE.MeshStandardMaterial({
      color: "#f8fafc",
      roughness: 0.55,
      flatShading: true,
    });
    const puffInstanced = new THREE.InstancedMesh(
      puffGeo,
      puffMat,
      PUFF_COUNT
    );
    for (let i = 0; i < PUFF_COUNT; i++) {
      const cluster = Math.floor(i / 2);
      const coords = computeFibonacciSpiralSlot(cluster * 2 + 4);
      const wy = 60.0 - coords.y_height;
      const r = Math.max(0.7, coords.radius_offset - 1.4);
      const ang = coords.branch_angle_rad + (i % 2) * 0.25;
      boughDummy.position.set(
        Math.cos(ang) * r,
        wy - 0.1 + (i % 2) * 0.1,
        Math.sin(ang) * r
      );
      boughDummy.rotation.set(0, ang, 0);
      boughDummy.scale.setScalar(0.75 + (i % 4) * 0.14);
      boughDummy.updateMatrix();
      puffInstanced.setMatrixAt(i, boughDummy.matrix);
    }
    puffInstanced.instanceMatrix.needsUpdate = true;
    decorGroup.add(puffInstanced);

    // ========================================================================
    // РОЖДЕСТВЕНСКАЯ ТЁПЛАЯ ГИРЛЯНДА (360 СВЕТЯЩИХСЯ ОГОНЬКОВ ПО СПИРАЛИ)
    // ========================================================================
    const GARLAND_BULBS = 360;
    const bulbGeo = new THREE.SphereGeometry(0.21, 10, 10);
    const bulbMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const garlandInstanced = new THREE.InstancedMesh(
      bulbGeo,
      bulbMat,
      GARLAND_BULBS
    );
    const garlandPalette = [
      new THREE.Color("#fbbf24"), // Тёплое рождественское золото
      new THREE.Color("#ef4444"), // Праздничный рубин
      new THREE.Color("#10b981"), // Изумрудная хвоя
      new THREE.Color("#fef08a"), // Сливочный огонёк
      new THREE.Color("#38bdf8"), // Морозный лазурит
    ];
    const bulbDummy = new THREE.Object3D();
    const bulbMeta = [];
    for (let i = 0; i < GARLAND_BULBS; i++) {
      const yH = i * 0.19;
      const worldY = 60.2 - yH;
      const envR = getConeEnvelopeRadius(yH) * 1.02;
      const angle = i * 0.42;
      const wx = Math.cos(angle) * envR;
      const wz = Math.sin(angle) * envR;
      bulbDummy.position.set(wx, worldY, wz);
      bulbDummy.scale.setScalar(1);
      bulbDummy.updateMatrix();
      garlandInstanced.setMatrixAt(i, bulbDummy.matrix);
      garlandInstanced.setColorAt(i, garlandPalette[i % garlandPalette.length]);
      bulbMeta.push({ wx, worldY, wz, phase: i * 0.65 });
    }
    garlandInstanced.instanceMatrix.needsUpdate = true;
    if (garlandInstanced.instanceColor)
      garlandInstanced.instanceColor.needsUpdate = true;
    scene.add(garlandInstanced);

    // Мягкие ореолы вокруг лампочек с «бегущей» по ёлке волной мерцания
    const haloGeo = new THREE.BufferGeometry();
    const haloPos = new Float32Array(GARLAND_BULBS * 3);
    const haloPhase = new Float32Array(GARLAND_BULBS);
    const haloWave = new Float32Array(GARLAND_BULBS);
    for (let i = 0; i < GARLAND_BULBS; i++) {
      const bm = bulbMeta[i];
      haloPos[i * 3] = bm.wx;
      haloPos[i * 3 + 1] = bm.worldY;
      haloPos[i * 3 + 2] = bm.wz;
      haloPhase[i] = bm.phase;
      haloWave[i] = i * 0.19;
    }
    haloGeo.setAttribute("position", new THREE.BufferAttribute(haloPos, 3));
    haloGeo.setAttribute("aPhase", new THREE.BufferAttribute(haloPhase, 1));
    haloGeo.setAttribute("aWave", new THREE.BufferAttribute(haloWave, 1));
    const garlandHaloMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGlow: { value: createRadialGlowTexture() },
      },
      vertexShader: `
        attribute float aPhase;
        attribute float aWave;
        uniform float uTime;
        varying float vGlow;
        void main() {
          float run = 0.5 + 0.5 * sin(uTime * 1.6 - aWave * 0.5);
          float twinkle = 0.5 + 0.5 * sin(uTime * 3.4 + aPhase);
          vGlow = 0.35 + 0.65 * run * (0.6 + 0.4 * twinkle);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 1.25 * (1100.0 / max(1.0, -mv.z)) * (0.7 + 0.5 * vGlow);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uGlow;
        varying float vGlow;
        void main() {
          vec4 tex = texture2D(uGlow, gl_PointCoord);
          gl_FragColor = vec4(tex.rgb, tex.a * vGlow * 0.55);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const garlandHalos = new THREE.Points(haloGeo, garlandHaloMat);
    garlandHalos.frustumCulled = false;
    scene.add(garlandHalos);

    // ========================================================================
    // ЗАСНЕЖЕННАЯ РОЖДЕСТВЕНСКАЯ ПОЛЯНА И ВИКТОРИАНСКИЕ ФОНАРИ У ПОДНОЖИЯ
    // ========================================================================
    const clearingGroup = new THREE.Group();
    const groundY = -4.0;
    const snowFieldGeo = new THREE.CylinderGeometry(42, 46, 2.6, 36);
    const snowFieldMat = new THREE.MeshStandardMaterial({
      color: "#f1f5f9",
      roughness: 0.65,
      metalness: 0.08,
    });
    const snowFieldMesh = new THREE.Mesh(snowFieldGeo, snowFieldMat);
    snowFieldMesh.position.set(0, groundY, 0);
    snowFieldMesh.receiveShadow = true;
    clearingGroup.add(snowFieldMesh);

    // 4 старинных рождественских фонаря с тёплым светом и подарки в сугробах
    for (let lIdx = 0; lIdx < 4; lIdx++) {
      const lAngle = (lIdx * Math.PI) / 2 + Math.PI / 4;
      const lRadius = 21.5;
      const lx = Math.cos(lAngle) * lRadius;
      const lz = Math.sin(lAngle) * lRadius;

      const postMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.24, 5.5, 10),
        new THREE.MeshStandardMaterial({
          color: "#1e293b",
          metalness: 0.7,
          roughness: 0.3,
        })
      );
      postMesh.position.set(lx, groundY + 3.8, lz);
      clearingGroup.add(postMesh);

      const lanternGlass = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.65, 1),
        new THREE.MeshBasicMaterial({ color: "#fde047", fog: false })
      );
      lanternGlass.position.set(lx, groundY + 6.7, lz);
      clearingGroup.add(lanternGlass);

      const lanternLight = new THREE.PointLight("#fb923c", 3.2, 24);
      lanternLight.position.set(lx, groundY + 6.5, lz);
      clearingGroup.add(lanternLight);
    }

    // Окружающий сказочный рождественский лес (36 заснеженных елей вокруг поляны)
    for (let tIdx = 0; tIdx < 36; tIdx++) {
      const tAngle = (tIdx / 36) * Math.PI * 2 + (tIdx % 2) * 0.08;
      const tDist = 29.0 + (tIdx % 5) * 4.2;
      const tx = Math.cos(tAngle) * tDist;
      const tz = Math.sin(tAngle) * tDist;
      const treeScale = 0.85 + (tIdx % 4) * 0.32;

      for (let layer = 0; layer < 3; layer++) {
        const coneR = (3.2 - layer * 0.75) * treeScale;
        const coneH = (5.2 - layer * 0.8) * treeScale;
        const treeLayer = new THREE.Mesh(
          new THREE.ConeGeometry(coneR, coneH, 9),
          layer === 2 ? snowCapMat : forestPineMat
        );
        treeLayer.position.set(
          tx,
          groundY + 2.5 + layer * 2.8 * treeScale,
          tz
        );
        treeLayer.rotation.y = tIdx + layer;
        treeLayer.userData.oldForest = true;
        clearingGroup.add(treeLayer);
      }
    }
    scene.add(clearingGroup);

    // ========================================================================
    // НАСТОЯЩИЙ ТРЁХМЕРНЫЙ СНЕГОПАД (2 СЛОЯ В THREE.JS С FOG: FALSE)
    // ========================================================================
    // Слой A: 700 объёмных 3D-кристаллов снега (InstancedMesh), кружащихся прямо вокруг камеры
    const SNOW_3D_COUNT = 700;
    const snowCrystalGeo = new THREE.OctahedronGeometry(0.17, 0);
    const snowCrystalMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.92,
      fog: false,
    });
    const snowCrystalInstanced = new THREE.InstancedMesh(
      snowCrystalGeo,
      snowCrystalMat,
      SNOW_3D_COUNT
    );
    snowCrystalInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const snow3DData = [];
    const snowCrystalColor = new THREE.Color();
    for (let i = 0; i < SNOW_3D_COUNT; i++) {
      const radius = 2.5 + Math.random() * 28.0;
      const angle = Math.random() * Math.PI * 2;
      const yOffset = (Math.random() - 0.5) * 34.0;
      const speedY = 1.6 + Math.random() * 2.4;
      const scale = 0.45 + Math.random() * 0.95;
      snow3DData.push({
        radius,
        angle,
        yOffset,
        speedY,
        scale,
        phase: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 2.5,
      });
      snowCrystalColor.set(
        i % 7 === 0 ? "#fde047" : i % 5 === 0 ? "#bae6fd" : "#ffffff"
      );
      snowCrystalInstanced.setColorAt(i, snowCrystalColor);
    }
    if (snowCrystalInstanced.instanceColor)
      snowCrystalInstanced.instanceColor.needsUpdate = true;
    scene.add(snowCrystalInstanced);

    // Слой B: 1300 крупных пушистых снежинок с текстурой боке (THREE.Points, fog: false)
    const SNOW_PARTICLES_COUNT = 1300;
    const snowPositions = new Float32Array(SNOW_PARTICLES_COUNT * 3);
    const snowVel = [];
    for (let i = 0; i < SNOW_PARTICLES_COUNT; i++) {
      const r = 1.8 + Math.random() * 34.0;
      const theta = Math.random() * Math.PI * 2;
      snowPositions[i * 3] = Math.cos(theta) * r;
      snowPositions[i * 3 + 1] = Math.random() * 90.0 - 15.0;
      snowPositions[i * 3 + 2] = Math.sin(theta) * r;
      snowVel.push({
        vy: 1.5 + Math.random() * 2.4,
        swirl: (Math.random() - 0.5) * 0.8,
        phase: Math.random() * Math.PI * 2,
      });
    }
    const snowBufferGeo = new THREE.BufferGeometry();
    snowBufferGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(snowPositions, 3)
    );
    const flakeTexture = createSnowflakeBokehTexture();
    const snowPointsMat = new THREE.PointsMaterial({
      size: 1.35,
      map: flakeTexture,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      fog: false,
    });
    const snowPointsSystem = new THREE.Points(snowBufferGeo, snowPointsMat);
    scene.add(snowPointsSystem);

    const pedestalGeo = new THREE.CylinderGeometry(0.48, 0.56, 0.24, 20);
    const pedestalMat = new THREE.MeshStandardMaterial({
      roughness: 0.4,
      metalness: 0.35,
    });
    const pedestalInstanced = new THREE.InstancedMesh(
      pedestalGeo,
      pedestalMat,
      MAX_INSTANCES
    );
    pedestalInstanced.castShadow = true;
    pedestalInstanced.receiveShadow = true;
    pedestalInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(pedestalInstanced);
    pedestalBaseMeshRef.current = pedestalInstanced;

    const rimGeo = new THREE.TorusGeometry(0.49, 0.03, 10, 24);
    const rimMat = new THREE.MeshStandardMaterial({
      color: "#fbbf24",
      metalness: 0.85,
      roughness: 0.2,
    });
    const rimInstanced = new THREE.InstancedMesh(rimGeo, rimMat, MAX_INSTANCES);
    rimInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(rimInstanced);
    pedestalRimMeshRef.current = rimInstanced;

    const crownCapGeo = new THREE.CylinderGeometry(0.14, 0.18, 0.1, 14);
    const crownCapInstanced = new THREE.InstancedMesh(
      crownCapGeo,
      rimMat,
      MAX_INSTANCES
    );
    crownCapInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(crownCapInstanced);
    topCrownCapMeshRef.current = crownCapInstanced;

    const unitVoxelGeo = new THREE.BoxGeometry(1, 1, 1);
    const unitVoxelMat = new THREE.MeshStandardMaterial({
      roughness: 0.28,
      metalness: 0.15,
    });
    const globalVoxelsInstanced = new THREE.InstancedMesh(
      unitVoxelGeo,
      unitVoxelMat,
      MAX_TOTAL_TREE_VOXELS
    );
    globalVoxelsInstanced.castShadow = true;
    globalVoxelsInstanced.receiveShadow = true;
    globalVoxelsInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(globalVoxelsInstanced);
    globalVoxelsMeshRef.current = globalVoxelsInstanced;

    // Нимбы подарочных шаров: мягкий цветной свет в тон glitter-цвету дара —
    // главный признак «это подарок», а не игрушка на ветке
    const orbHaloGeo = new THREE.BufferGeometry();
    orbHaloGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3).setUsage(
        THREE.DynamicDrawUsage
      )
    );
    orbHaloGeo.setAttribute(
      "aColor",
      new THREE.BufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3).setUsage(
        THREE.DynamicDrawUsage
      )
    );
    orbHaloGeo.setAttribute(
      "aSize",
      new THREE.BufferAttribute(new Float32Array(MAX_INSTANCES), 1).setUsage(
        THREE.DynamicDrawUsage
      )
    );
    orbHaloGeo.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(new Float32Array(MAX_INSTANCES), 1).setUsage(
        THREE.DynamicDrawUsage
      )
    );
    const orbHaloMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGlow: { value: createWhiteGlowTexture() },
      },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        varying vec3 vColor;
        varying float vPulse;
        void main() {
          vColor = aColor;
          vPulse = 0.78 + 0.22 * sin(uTime * 1.8 + aPhase);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (1100.0 / max(1.0, -mv.z)) * vPulse;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uGlow;
        varying vec3 vColor;
        varying float vPulse;
        void main() {
          vec4 tex = texture2D(uGlow, gl_PointCoord);
          gl_FragColor = vec4(vColor, tex.a * 0.5 * vPulse);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const orbHalos = new THREE.Points(orbHaloGeo, orbHaloMat);
    orbHalos.frustumCulled = false;
    orbHalos.geometry.setDrawRange(0, 0);
    scene.add(orbHalos);
    orbHaloPointsRef.current = orbHalos;
    orbHaloMatRef.current = orbHaloMat;

    const glassGlobeGeo = new THREE.SphereGeometry(0.62, 24, 20);
    const glassGlobeMat = new THREE.MeshPhysicalMaterial({
      color: "#e0f2fe",
      transparent: true,
      opacity: 0.4,
      roughness: 0.06,
      metalness: 0.1,
      clearcoat: 1.0,
      depthWrite: false,
    });
    const glassGlobeInstanced = new THREE.InstancedMesh(
      glassGlobeGeo,
      glassGlobeMat,
      MAX_INSTANCES
    );
    glassGlobeInstanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(glassGlobeInstanced);
    glassGlobeMeshRef.current = glassGlobeInstanced;

    const flameInstanced = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.16, 0.52, 10),
      new THREE.MeshBasicMaterial({
        color: "#fef08a",
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      MAX_INSTANCES
    );
    scene.add(flameInstanced);
    candleFlameMeshRef.current = flameInstanced;

    const haloInstanced = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.45, 10, 10),
      new THREE.MeshBasicMaterial({
        color: "#f59e0b",
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      MAX_INSTANCES
    );
    scene.add(haloInstanced);
    candleHaloMeshRef.current = haloInstanced;

    const selRingMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.045, 12, 32),
      new THREE.MeshBasicMaterial({
        color: "#fde047",
        blending: THREE.AdditiveBlending,
      })
    );
    selRingMesh.geometry.rotateX(Math.PI / 2);
    selRingMesh.visible = false;
    scene.add(selRingMesh);
    selectionRingRef.current = selRingMesh;

    const topStarGroup = new THREE.Group();
    topStarGroup.position.set(0, 61.8, 0);
    const coreOctGeo = new THREE.OctahedronGeometry(1.45, 0);
    const coreOctMat = new THREE.MeshBasicMaterial({
      color: "#fef08a",
      blending: THREE.AdditiveBlending,
    });
    const starCoreA = new THREE.Mesh(coreOctGeo, coreOctMat);
    const starCoreB = new THREE.Mesh(coreOctGeo, coreOctMat);
    starCoreB.rotation.y = Math.PI / 4;
    starCoreB.rotation.z = Math.PI / 4;
    topStarGroup.add(starCoreA, starCoreB);
    scene.add(topStarGroup);

    // Нимб вокруг верховой звезды
    const starGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createRadialGlowTexture(),
        color: "#fde047",
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    );
    starGlow.scale.setScalar(9.5);
    topStarGroup.add(starGlow);

    syncInstancedMeshes();

    const owlFlightsGroup = new THREE.Group();
    scene.add(owlFlightsGroup);
    const activeOwlFlights = [];

    let scrollDepth = 9.5;
    let isDragging = false;
    let dragDistance = 0;
    let prevPointerY = 0;
    let prevPointerX = 0;
    let manualAzimuthOffset = 0;
    let zoomLevel = zoomTargetRef.current;
    const lookTarget = new THREE.Vector3(0, 60 - 9.5 - 1.1, 0);
    const clock = new THREE.Clock();

    spawnOwlRef.current = (payload) => {
      setOwlBanner(payload);
      if (owlBannerTimeoutRef.current)
        window.clearTimeout(owlBannerTimeoutRef.current);
      owlBannerTimeoutRef.current = window.setTimeout(
        () => setOwlBanner(null),
        6500
      );
      musicBoxSynth.playOwlChime();

      const centerCamY = 60.0 - scrollDepth;
      const baseRadius = getConeEnvelopeRadius(scrollDepth) * 1.12;
      const startAngle = scrollDepth * 0.18 + manualAzimuthOffset - 1.2;

      const controlPoints = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const angle = startAngle + t * Math.PI * 2.5;
        const r = baseRadius + 1.6 + Math.sin(t * Math.PI) * 3.5;
        const y = centerCamY - 5.5 + t * 9.5 + Math.sin(t * Math.PI) * 3.8;
        controlPoints.push(
          new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r)
        );
      }

      const curve = new THREE.CatmullRomCurve3(controlPoints);
      const sampledPoints = curve.getPoints(180);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(sampledPoints);
      lineGeo.setDrawRange(0, 2);

      const lineMat = new THREE.LineBasicMaterial({
        color: "#fde047",
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const lineMesh = new THREE.Line(lineGeo, lineMat);
      owlFlightsGroup.add(lineMesh);

      const owlHeadMesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.48, 1),
        new THREE.MeshBasicMaterial({ color: "#fff" })
      );
      owlHeadMesh.position.copy(sampledPoints[0]);
      owlFlightsGroup.add(owlHeadMesh);

      activeOwlFlights.push({
        curve,
        lineMesh,
        lineMat,
        owlHeadMesh,
        totalPoints: 180,
        startTime: clock.getElapsedTime(),
        duration: 4.8,
      });
    };

    // ======================================================================
    // НОВЫЙ ОБЛИК (по умолчанию; ?look=classic — прежний): реалистичная ель, HDR-свет, туман, DOF
    // ======================================================================
    let fir = null;
    let clearing = null;
    let atmosphere = null;
    let fireworks3d = null;
    let lastElapsed = 0;
    let tiltPasses = [];
    // Адаптивное качество: замеряем FPS после прогрева и упрощаем сцену на слабых устройствах
    const perf = { frames: 0, start: 0, level: 0, done: false };
    if (LOOK_NEW) {
      const isMobileGpu =
        window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 760;
      // старую ель, декор, шумные эффекты прячем (объекты остаются, но не рисуются)
      [
        trunkMesh,
        coreCrownGroup,
        boughInstanced,
        snowCapInstanced,
        pineconeInstanced,
        frostSparkles,
        decorGroup,
        garlandInstanced,
        garlandHalos,
        snowCrystalInstanced,
        orbHalos,
        haloInstanced,
      ].forEach((o) => {
        if (o) o.visible = false;
      });
      clearingGroup.children.forEach((c) => {
        if (c.userData.oldForest) c.visible = false;
      });

      fir = createRealisticFir({ isMobile: isMobileGpu });
      scene.add(fir.group);
      firApiRef.current = fir;
      fir.setGarlandMode?.(garlandModeRef.current);
      fir.setGiftHangers(lastHangersRef.current);

      // Поляна: равнина, лес из настоящих елей, викторианские фонари, сугробы
      clearingGroup.visible = false;
      clearing = createClearing({ foliage: fir.foliage, isMobile: isMobileGpu });
      scene.add(clearing.group);

      // Шары — как настоящие ёлочные игрушки: без пьедестала и «пики»-свечи,
      // с классическим колпачком и петелькой, за которую они подвешены на нити
      pedestalInstanced.visible = false;
      rimInstanced.visible = false;
      flameInstanced.visible = false;
      crownCapInstanced.geometry.dispose();
      crownCapInstanced.geometry = createCapLoopGeometry();

      scene.fog = new THREE.FogExp2("#0d1830", 0.0085);
      starPointLight.intensity = 5;
      bloomPass.radius = 0.55;
      bloomPass.threshold = 0.82;

      // Время суток, погода, HDR-освещение, звёзды, луна/солнце — с плавными переходами
      atmosphere = createAtmosphereController({
        scene,
        renderer,
        camera,
        hemiLight,
        dirLight,
        auroraUniforms,
        bloomPass,
        fir,
        lanterns: clearing.lanterns,
      });
      atmosphereRef.current = atmosphere;
      atmosphere.set(timeOfDayRef.current, newWeatherRef.current);

      // Объёмный салют (полночь, репетиция, окошко 31 декабря)
      fireworks3d = createFireworks3D({
        scene,
        camera,
        isMobile: isMobileGpu,
        getAudioContext: () => musicBoxSynth.ctx,
      });
      fireworksRef.current = fireworks3d;

      // Настоящая пятиконечная звезда вместо двух жёлтых ромбов
      starCoreA.visible = false;
      starCoreB.visible = false;
      const starShape = new THREE.Shape();
      for (let i = 0; i <= 10; i++) {
        const r = i % 2 === 0 ? 1.45 : 0.6;
        const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
        if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const starGeo = new THREE.ExtrudeGeometry(starShape, {
        depth: 0.32,
        bevelEnabled: true,
        bevelThickness: 0.14,
        bevelSize: 0.12,
        bevelSegments: 3,
      });
      starGeo.center();
      const newStar = new THREE.Mesh(
        starGeo,
        new THREE.MeshStandardMaterial({
          color: "#ffe2a0",
          emissive: "#ffb347",
          emissiveIntensity: 1.8,
          metalness: 0.65,
          roughness: 0.28,
        })
      );
      topStarGroup.add(newStar);
      // звезда садится прямо на верхушку-«лидер», без зазора над стволом
      topStarGroup.position.y = 59.9;

      // киношная глубина резкости: ель в фокусе, верх и низ кадра мягко размыты
      const hBlur = new ShaderPass(HorizontalTiltShiftShader);
      const vBlur = new ShaderPass(VerticalTiltShiftShader);
      const blurAmount = isMobileGpu ? 1.6 : 2.4;
      hBlur.uniforms.h.value = blurAmount / container.clientWidth;
      vBlur.uniforms.v.value = blurAmount / container.clientHeight;
      hBlur.uniforms.r.value = 0.5;
      vBlur.uniforms.r.value = 0.5;
      composer.insertPass(hBlur, composer.passes.length - 1);
      composer.insertPass(vBlur, composer.passes.length - 1);
      tiltPasses = [hBlur, vBlur];

      if (typeof snowPointsMat !== "undefined" && snowPointsMat) {
        snowPointsMat.size *= 0.45;
        snowPointsMat.opacity = Math.min(snowPointsMat.opacity ?? 1, 0.6);
      }
      console.info("[WorldFir] Новый облик:", fir.stats, clearing.stats);
    }

    const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    let isPinching = false;
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    const touchDistance = (touches) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    const onWheel = (e) => {
      e.preventDefault();
      if (!e.ctrlKey) cameraFocusRef.current = null;
      // Ctrl+колесо — это и «щипок» на тачпаде ноутбука: приближение/отдаление.
      if (e.ctrlKey) {
        zoomTargetRef.current = clampZoom(zoomTargetRef.current * Math.exp(e.deltaY * 0.01));
        return;
      }
      scrollTargetRef.current = Math.max(
        0,
        Math.min(MAX_SCROLL_DEPTH, scrollTargetRef.current + e.deltaY * 0.022)
      );
    };
    const onMouseDown = (e) => {
      cameraFocusRef.current = null;
      isDragging = true;
      dragDistance = 0;
      prevPointerY = e.clientY;
      prevPointerX = e.clientX;
    };
    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dy = prevPointerY - e.clientY;
      const dx = prevPointerX - e.clientX;
      dragDistance += Math.abs(dy) + Math.abs(dx);
      prevPointerY = e.clientY;
      prevPointerX = e.clientX;
      scrollTargetRef.current = Math.max(
        0,
        Math.min(MAX_SCROLL_DEPTH, scrollTargetRef.current + dy * 0.05)
      );
      // без инверсии: тянем вправо — ель поворачивается вправо
      manualAzimuthOffset -= dx * 0.006;
    };
    const onMouseUp = () => {
      isDragging = false;
    };

    // Полноценная поддержка сенсорного экрана (Touch-свайпы пальцем для вращения и полёта вдоль Ели)
    const onTouchStart = (e) => {
      if (!e.touches || e.touches.length === 0) return;
      cameraFocusRef.current = null;
      if (e.touches.length >= 2) {
        // Второй палец — переходим в режим щипка, вращение не трогаем.
        isPinching = true;
        isDragging = false;
        dragDistance = 999; // чтобы щипок не засчитался как тап по шару
        pinchStartDist = touchDistance(e.touches) || 1;
        pinchStartZoom = zoomTargetRef.current;
        return;
      }
      isDragging = true;
      dragDistance = 0;
      prevPointerX = e.touches[0].clientX;
      prevPointerY = e.touches[0].clientY;
    };
    const onTouchMove = (e) => {
      if (isPinching && e.touches && e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        const dist = touchDistance(e.touches) || 1;
        // Пальцы разводим — приближаемся (дистанция камеры уменьшается).
        zoomTargetRef.current = clampZoom(pinchStartZoom * (pinchStartDist / dist));
        return;
      }
      if (!isDragging || !e.touches || e.touches.length === 0) return;
      if (e.cancelable) e.preventDefault();
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      const dy = prevPointerY - cy;
      const dx = prevPointerX - cx;
      dragDistance += Math.abs(dy) + Math.abs(dx);
      prevPointerY = cy;
      prevPointerX = cx;
      scrollTargetRef.current = Math.max(
        0,
        Math.min(MAX_SCROLL_DEPTH, scrollTargetRef.current + dy * 0.065)
      );
      manualAzimuthOffset -= dx * 0.008;
    };
    const onTouchEnd = (e) => {
      if (isPinching && (!e?.touches || e.touches.length < 2)) {
        isPinching = false;
      }
      isDragging = false;
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (e) => {
      if (dragDistance > 10) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const clientX = e.clientX ?? e.changedTouches?.[0]?.clientX ?? 0;
      const clientY = e.clientY ?? e.changedTouches?.[0]?.clientY ?? 0;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const targets = [
        glassGlobeMeshRef.current,
        pedestalBaseMeshRef.current,
      ].filter(Boolean);
      const intersects = raycaster.intersectObjects(targets, false);

      if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
        const instanceIdx = intersects[0].instanceId;
        const seqNum = globeInstanceToSeqRef.current[instanceIdx];
        if (seqNum !== undefined) {
          const hitGift = giftsMapRef.current.get(seqNum);
          if (hitGift) {
            const prevSelected = selectedGiftRef.current;
            if (prevSelected && prevSelected.id === hitGift.id) {
              musicBoxSynth.toggleMelody(
                hitGift.id,
                hitGift.melody.tempo_bpm,
                hitGift.melody.celesta_track,
                hitGift.melody.harp_track,
                hitGift.melody.cello_track,
                hitGift.melody.flute_track,
                hitGift.melody.drum_track,
                null,
                hitGift.melody.voices
              );
            } else {
              setSelectedGift({ ...hitGift });
              musicBoxSynth.playMelody(
                hitGift.melody.tempo_bpm,
                hitGift.melody.celesta_track,
                hitGift.melody.harp_track,
                hitGift.melody.cello_track,
                hitGift.melody.flute_track,
                hitGift.melody.drum_track,
                null,
                hitGift.id,
                hitGift.melody.voices
              );
            }
          }
        }
      }
    };

    const domElem = renderer.domElement;
    domElem.style.touchAction = "none";
    domElem.addEventListener("wheel", onWheel, { passive: false });
    domElem.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    domElem.addEventListener("touchstart", onTouchStart, { passive: true });
    domElem.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    domElem.addEventListener("click", onClick);

    let animFrameId;
    const flameDummy = new THREE.Object3D();
    const snowDummy = new THREE.Object3D();

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const preset = weatherPresetRef.current;
      const density = snowDensityRef.current;

      // Применяем параметры выбранной Рождественской Погоды к небу, туману и свету
      auroraUniforms.uTime.value = elapsed;
      if (fir) {
        fir.update(elapsed);
        atmosphere?.update(Math.min(0.1, elapsed - lastElapsed), elapsed);
        fireworks3d?.update(Math.min(0.1, elapsed - lastElapsed));
        lastElapsed = elapsed;
        if (!perf.done) {
          if (elapsed > 2.5) {
            if (!perf.start) perf.start = performance.now();
            perf.frames++;
            const span = performance.now() - perf.start;
            if (span > 3000) {
              const fps = (perf.frames * 1000) / span;
              if (fps < 45 && perf.level === 0) {
                // ступень 1: меньше хвои, без размытия, обычная плотность пикселей
                perf.level = 1;
                fir.setQuality(0.65);
                tiltPasses.forEach((ps) => (ps.enabled = false));
                renderer.setPixelRatio(1);
                composer.setPixelRatio(1);
              } else if (fps < 28 && perf.level === 1) {
                // ступень 2: минимум хвои и без свечения
                perf.level = 2;
                fir.setQuality(0.45);
                bloomPass.enabled = false;
              } else {
                perf.done = true;
              }
              perf.frames = 0;
              perf.start = 0;
              if (perf.level === 2) perf.done = true;
              console.info("[WorldFir] FPS", Math.round(fps), "→ уровень качества", perf.level);
            }
          }
        }
      } else {
        auroraUniforms.uTopColor.value.set(preset.skyTop);
        auroraUniforms.uBottomColor.value.set(preset.skyBottom);
        auroraUniforms.uAuroraStrength.value = preset.auroraStrength;
        scene.background.set(preset.skyTop);
        scene.fog.color.set(preset.fogColor);
        hemiLight.color.set(preset.hemiSky);
        hemiLight.groundColor.set(preset.hemiGround);
        dirLight.color.set(preset.dirColor);
        dirLight.intensity = preset.dirIntensity;
      }

      scrollDepth += (scrollTargetRef.current - scrollDepth) * 0.08;
      const focus = cameraFocusRef.current;
      if (focus) {
        // плавно доворачиваем камеру так, чтобы шар оказался прямо перед ней
        let diff = focus.angle - scrollDepth * 0.18 - manualAzimuthOffset;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        manualAzimuthOffset += diff * 0.06;
      }
      const spiralAngle = scrollDepth * 0.18 + manualAzimuthOffset;
      zoomLevel += (zoomTargetRef.current - zoomLevel) * 0.12;
      const baseConeRadius = getConeEnvelopeRadius(scrollDepth) * 1.3 + 27.0;
      // Нижняя граница: крона чуть ниже камеры + кольцо подвешенных шаров + запас.
      // Ближе камера не подойдёт ни при каком зуме — без «погружения» в ветви.
      const minSafeDistance =
        getConeEnvelopeRadius(scrollDepth + 4.0) * 0.88 + 3.6 + 1.3 * GIFT_ORB_SCALE + 3.5;
      const currentConeRadius = Math.max(minSafeDistance, baseConeRadius * zoomLevel);
      const camY = 60.0 - scrollDepth;

      camera.position.set(
        Math.cos(spiralAngle) * currentConeRadius,
        Math.max(camY + 1.9, MIN_CAMERA_Y),
        Math.sin(spiralAngle) * currentConeRadius
      );
      // точка взгляда: ось Ёлки, а при выбранном шаре — смещается к нему
      if (focus) lookTarget.lerp(new THREE.Vector3(focus.x, focus.y, focus.z), 0.08);
      else lookTarget.lerp(new THREE.Vector3(0, camY - 1.1, 0), 0.08);
      camera.lookAt(lookTarget);
      skyDome.position.y = camY;
      topStarGroup.rotation.y = elapsed * 0.85;

      // Сияние: twinkle инея, волна гирлянды, нимб звезды и дыхание ветра
      sparkleMat.uniforms.uTime.value = elapsed;
      garlandHaloMat.uniforms.uTime.value = elapsed;
      if (orbHaloMatRef.current) orbHaloMatRef.current.uniforms.uTime.value = elapsed;
      starGlow.scale.setScalar(9.5 + Math.sin(elapsed * 2.6) * 1.2);
      starGlow.material.opacity = 0.5 + 0.18 * Math.sin(elapsed * 3.1);
      if (fir) {
        // в новом облике звезда — аккуратный огонёк, а не жёлтое пятно на полнеба
        starGlow.scale.multiplyScalar(0.42);
        starGlow.material.opacity *= 0.7;
      }
      coreCrownGroup.rotation.z = Math.sin(elapsed * 0.55) * 0.0035;
      coreCrownGroup.rotation.x = Math.cos(elapsed * 0.42) * 0.0025;
      boughInstanced.rotation.z = coreCrownGroup.rotation.z;
      snowCapInstanced.rotation.z = coreCrownGroup.rotation.z;
      pineconeInstanced.rotation.z = coreCrownGroup.rotation.z;
      frostSparkles.rotation.z = coreCrownGroup.rotation.z;
      decorGroup.rotation.z = coreCrownGroup.rotation.z;
      bloomPass.strength = 0.3 + preset.diamondSparkle * 0.22;

      // Анимация мерцания 360 рождественских лампочек гирлянды
      for (let i = 0; i < GARLAND_BULBS; i++) {
        const bm = bulbMeta[i];
        const pulse =
          0.75 + 0.45 * Math.sin(elapsed * 4.2 + bm.phase);
        bulbDummy.position.set(bm.wx, bm.worldY, bm.wz);
        bulbDummy.scale.setScalar(pulse);
        bulbDummy.updateMatrix();
        garlandInstanced.setMatrixAt(i, bulbDummy.matrix);
      }
      garlandInstanced.instanceMatrix.needsUpdate = true;

      // Анимация Слоя A: 700 объёмных 3D-снежинок всегда вокруг текущей высоты камеры camY
      const active3DSnowCount = Math.min(
        SNOW_3D_COUNT,
        Math.floor(270 * density)
      );
      snowCrystalInstanced.count = active3DSnowCount;
      for (let i = 0; i < active3DSnowCount; i++) {
        const sd = snow3DData[i];
        sd.yOffset -=
          0.028 * sd.speedY * preset.fallSpeed * (0.4 + density * 0.45);
        if (sd.yOffset < -17.0) sd.yOffset = 17.0;
        sd.angle += 0.004 * preset.windSpeed;

        const sway = Math.sin(elapsed * 1.8 + sd.phase) * 0.65;
        const sx = Math.cos(sd.angle) * (sd.radius + sway);
        const sz = Math.sin(sd.angle) * (sd.radius + sway);
        const sy = camY + sd.yOffset;

        snowDummy.position.set(sx, sy, sz);
        snowDummy.rotation.set(
          elapsed * sd.rotSpeed,
          elapsed * sd.rotSpeed * 0.8,
          sd.phase
        );
        const sparkleBoost =
          1.0 +
          preset.diamondSparkle *
            0.35 *
            Math.sin(elapsed * 6.0 + sd.phase);
        snowDummy.scale.setScalar(sd.scale * sparkleBoost);
        snowDummy.updateMatrix();
        snowCrystalInstanced.setMatrixAt(i, snowDummy.matrix);
      }
      snowCrystalInstanced.instanceMatrix.needsUpdate = true;

      // Анимация Слоя B: 1300 пушистых снежинок с текстурой боке (масштабируются ползунком интенсивности)
      snowPointsSystem.visible = density > 0.02;
      snowPointsMat.opacity = Math.min(1.0, 0.3 + density * 0.34);
      snowPointsMat.size = 0.9 + density * 0.28;

      const posAttr = snowBufferGeo.getAttribute("position");
      const posArr = posAttr.array;
      for (let i = 0; i < SNOW_PARTICLES_COUNT; i++) {
        const v = snowVel[i];
        let py =
          posArr[i * 3 + 1] -
          0.045 * v.vy * preset.fallSpeed * (0.35 + density * 0.5);
        if (py < camY - 26.0) {
          py = camY + 26.0;
        } else if (py > camY + 28.0) {
          py = camY - 24.0;
        }
        posArr[i * 3 + 1] = py;
        posArr[i * 3] +=
          Math.sin(elapsed * 1.4 + v.phase) * 0.03 * preset.windSpeed;
        posArr[i * 3 + 2] +=
          Math.cos(elapsed * 1.2 + v.phase) * 0.03 * preset.windSpeed;
      }
      posAttr.needsUpdate = true;

      const flameM = candleFlameMeshRef.current;
      const haloM = candleHaloMeshRef.current;
      const metas = activeCandlesMetaRef.current;
      if (flameM && haloM && metas.length > 0) {
        for (let i = 0; i < metas.length; i++) {
          const m = metas[i];
          if (!m.hasCandle) {
            flameDummy.position.set(0, -999, 0);
            flameDummy.scale.setScalar(0.0001);
            flameDummy.updateMatrix();
            flameM.setMatrixAt(i, flameDummy.matrix);
            haloM.setMatrixAt(i, flameDummy.matrix);
            continue;
          }
          const flicker = 1.0 + 0.18 * Math.sin(elapsed * 9.0 + m.phase);
          flameDummy.position.set(m.worldX, m.worldY, m.worldZ);
          flameDummy.scale.set(
            m.baseScale * 0.9,
            m.baseScale * 1.35 * flicker,
            m.baseScale * 0.9
          );
          flameDummy.updateMatrix();
          flameM.setMatrixAt(i, flameDummy.matrix);
          haloM.setMatrixAt(i, flameDummy.matrix);
        }
        flameM.instanceMatrix.needsUpdate = true;
        haloM.instanceMatrix.needsUpdate = true;
      }

      for (let i = activeOwlFlights.length - 1; i >= 0; i--) {
        const flight = activeOwlFlights[i];
        const progress = (elapsed - flight.startTime) / flight.duration;
        if (progress >= 1.25) {
          owlFlightsGroup.remove(flight.lineMesh);
          owlFlightsGroup.remove(flight.owlHeadMesh);
          flight.lineMesh.geometry.dispose();
          flight.lineMat.dispose();
          activeOwlFlights.splice(i, 1);
          continue;
        }
        const clampedT = Math.min(progress, 1.0);
        const currentPos = flight.curve.getPointAt(clampedT);
        flight.owlHeadMesh.position.copy(currentPos);
        const drawCount = Math.max(2, Math.floor(clampedT * flight.totalPoints));
        flight.lineMesh.geometry.setDrawRange(0, drawCount);
      }

      const activeSeq = Math.max(
        0,
        Math.floor(scrollDepth / VERTICAL_STEP_PER_GIFT)
      );
      setCurrentTier(Math.floor(activeSeq / GIFTS_PER_TIER));

      composer.render();
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
      composer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", handleResize);
      if (fir) {
        fir.dispose();
        firApiRef.current = null;
      }
      if (clearing) clearing.dispose();
      if (atmosphere) {
        atmosphere.dispose();
        atmosphereRef.current = null;
        fireworks3d?.dispose();
        fireworksRef.current = null;
      }
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchend", onTouchEnd);
      domElem.removeEventListener("wheel", onWheel);
      domElem.removeEventListener("mousedown", onMouseDown);
      domElem.removeEventListener("touchstart", onTouchStart);
      domElem.removeEventListener("touchmove", onTouchMove);
      domElem.removeEventListener("click", onClick);
      musicBoxSynth.stop();
      composer.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [syncInstancedMeshes]);

  const resortTreeByLightHierarchy = useCallback((focusGiftId) => {
    const allGifts = Array.from(giftsMapRef.current.values());
    allGifts.forEach((g) => {
      if (!g.offline) return;
      const details = computeAntiSybilScoreDetails({
        wishText: g.secret_wish || "",
        wishCharCount: g.wish_char_count || 180,
        celestaTrack: g.melody?.celesta_track || [],
        harpTrack: g.melody?.harp_track || [],
        celloTrack: g.melody?.cello_track || [],
        fluteTrack: g.melody?.flute_track || [],
        drumTrack: g.melody?.drum_track || [],
        voxelsCount: g.snowglobe?.voxels?.length || 24,
        engravingText: g.snowglobe?.engraving_text || "",
        candlesCount: g.candles_count || 0,
      });
      g.quality_score = details.total;
    });

    allGifts.sort(
      (a, b) =>
        b.quality_score - a.quality_score ||
        (a.created_order || 0) - (b.created_order || 0)
    );

    const newMap = new Map();
    let focusedGiftUpdated = null;
    allGifts.forEach((g, newSeq) => {
      g.coordinates = computeFibonacciSpiralSlot(newSeq);
      newMap.set(newSeq, g);
      if (g.id === focusGiftId) focusedGiftUpdated = { ...g };
    });
    giftsMapRef.current = newMap;
    return focusedGiftUpdated;
  }, []);

  const refreshCandles = useCallback(async () => {
    const [st, lead] = await Promise.allSettled([apiFetchCandleStatus(), apiFetchCandleLeaders()]);
    if (st.status === "fulfilled" && st.value) {
      const v = st.value;
      setCandleQuota({ limit: v.daily_limit, remaining: v.remaining_today, resetsAt: v.resets_at });
      const ids = new Set(v.lit_today || []);
      setLitGiftIds(ids);
      saveLitGiftIds(ids);
    }
    if (lead.status === "fulfilled" && lead.value) {
      setCandleLeaders({
        today: lead.value.today || [],
        yesterday_winner: lead.value.yesterday_winner || null,
      });
    }
  }, []);

  useEffect(() => {
    refreshCandles();
  }, [refreshCandles]);

  // В полночь по Москве свечи пополняются — подтягиваем новый запас и лидеров.
  useEffect(() => {
    if (!candleQuota.resetsAt) return undefined;
    const ms = Date.parse(candleQuota.resetsAt) - (Date.now() + clockOffsetMs);
    if (!Number.isFinite(ms)) return undefined;
    const t = setTimeout(refreshCandles, Math.max(1000, Math.min(ms + 1500, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [candleQuota.resetsAt, clockOffsetMs, refreshCandles]);

  const [cityInfo, setCityInfo] = useState(null);
  useEffect(() => {
    if (!myCity || !isMenuOpen) return;
    apiFetchCityLeaders(myCity)
      .then((d) => setCityInfo(d.my_city || null))
      .catch(() => {});
  }, [myCity, isMenuOpen]);

  const refreshAchievements = useCallback(async () => {
    try {
      const data = await apiFetchAchievements();
      setAchievements(data);
      const unlocked = (data.items || []).filter((a) => a.unlocked).map((a) => a.id);
      let seen = null;
      try {
        seen = JSON.parse(localStorage.getItem("wfg_ach_seen") || "null");
      } catch {
        seen = null;
      }
      if (Array.isArray(seen)) {
        const fresh = (data.items || []).filter((a) => a.unlocked && !seen.includes(a.id));
        if (fresh.length) showToast(`🏅 Новая ачивка: ${fresh.map((a) => `${a.icon} ${a.title}`).join(", ")}`, "success");
      }
      try {
        localStorage.setItem("wfg_ach_seen", JSON.stringify(unlocked));
      } catch {
        /* без хранилища */
      }
    } catch {
      /* ачивки — не критично */
    }
  }, [showToast]);

  useEffect(() => {
    refreshAchievements();
  }, [refreshAchievements]);

  const openAdventWindow = (d) => {
    setAdventOpened((prev) => {
      const next = new Set(prev).add(d.day);
      saveAdventOpened(next);
      return next;
    });
    const where = {
      template: "уже в мастерской, в шаблонах",
      voice: "уже в студии мелодии",
      color: "уже в палитре мастерской",
      weather: "уже в меню погоды",
      garland: "уже в меню гирлянды",
      melody: "уже в студии — кнопки «Сочинить»",
      effect: "запускайте из меню «Праздник»",
    }[d.type];
    showToast(`🎁 ${d.day} декабря: ${d.title} — ${where}!`, "success");
    musicBoxSynth.playSingleNote("celesta", 13, "bells");
    if (d.type === "weather") {
      setNewWeatherId(d.id);
      const w = ALL_WEATHER.find((p) => p.id === d.id);
      if (w) setTimeOfDay(w.time);
    }
    if (d.type === "garland") setGarlandMode("ice");
  };

  const focusGiftById = (giftId) => {
    for (const g of giftsMapRef.current.values()) {
      if (g.id === giftId) {
        setSelectedGift({ ...g });
        setIsMenuOpen(false);
        return true;
      }
    }
    showToast("Этот шар сейчас не на Ёлке.", "info");
    return false;
  };

  const handleLightCandle = () => {
    if (!selectedGift || litGiftIds.has(selectedGift.id)) return;
    if (myGiftIds.has(selectedGift.id)) {
      showToast("Это ваш шар 🙂 Свечи у него зажигают другие мастера.", "info");
      return;
    }
    if (!selectedGift.offline && candleQuota.remaining === 0) {
      showToast("Свечи на сегодня закончились 🕯 Новые появятся в полночь по Москве.", "info");
      return;
    }
    if (!selectedGift.offline && candleQuota.remaining != null) {
      setCandleQuota((q) => ({ ...q, remaining: Math.max(0, (q.remaining ?? 1) - 1) }));
    }
    const seq = selectedGift.coordinates.sequence_number;
    const nodeInMap = giftsMapRef.current.get(seq);
    const updatedCount = selectedGift.candles_count + 1;
    if (nodeInMap) nodeInMap.candles_count = updatedCount;

    const litId = selectedGift.id;
    const markLit = (isLit) =>
      setLitGiftIds((prev) => {
        const next = new Set(prev);
        if (isLit) next.add(litId);
        else next.delete(litId);
        saveLitGiftIds(next);
        return next;
      });

    if (!selectedGift.offline && nodeInMap) {
      apiLightGiftCandle(litId)
        .then((dto) => {
          nodeInMap.quality_score = dto.quality_score;
          nodeInMap.candles_count = dto.candles_count;
          const serverAscended = resortTreeByLightHierarchy(nodeInMap.id);
          syncInstancedMeshes();
          if (serverAscended) {
            setSelectedGift(serverAscended);
            scrollTargetRef.current = Math.min(
              MAX_SCROLL_DEPTH,
              serverAscended.coordinates.y_height
            );
          }
          showToast("🕯 Свеча зажжена — шар поднялся выше на Ёлке!", "success");
          refreshCandles();
          refreshAchievements();
        })
        .catch((err) => {
          // Сервер свечу не засчитал — откатываем оптимистичный +1 и честно говорим почему.
          nodeInMap.candles_count = Math.max(1, nodeInMap.candles_count - 1);
          syncInstancedMeshes();
          setSelectedGift((prev) =>
            prev && prev.id === litId ? { ...prev, candles_count: nodeInMap.candles_count } : prev
          );
          if (err?.status === 403) {
            setMyGiftIds((prev) => new Set(prev).add(litId));
            showToast("Это ваш шар 🙂 Свечи у него зажигают другие мастера.", "info");
          } else if (err?.status === 409) {
            showToast("Сегодня вы уже зажгли свечу у этого шара. Завтра — снова можно.", "info");
          } else if (err?.status === 429) {
            markLit(false);
            showToast(err.message || "Свечи на сегодня закончились. Новые — после полуночи.", "warn");
          } else {
            markLit(false);
            showToast("Нет связи с Ёлкой — свеча не засчитана. Попробуйте ещё раз.", "warn");
          }
          refreshCandles();
        });
    }

    const ascendedGift = resortTreeByLightHierarchy(selectedGift.id);
    syncInstancedMeshes();
    if (ascendedGift) {
      setSelectedGift(ascendedGift);
      scrollTargetRef.current = Math.min(
        MAX_SCROLL_DEPTH,
        ascendedGift.coordinates.y_height
      );
    }

    markLit(true);
    musicBoxSynth.playSingleNote("celesta", 13);
  };

  const handleReportGift = async () => {
    if (!selectedGift || selectedGift.offline || reportedGiftIds.has(selectedGift.id)) return;
    const giftId = selectedGift.id;
    setReportedGiftIds((prev) => new Set(prev).add(giftId));
    try {
      const res = await apiReportGift(giftId, "other");
      if (res?.quarantined) {
        showToast("Спасибо! Шар скрыт до проверки модератором.", "success");
      } else if (res?.accepted === false) {
        showToast("Вы уже отправляли жалобу на этот шар.", "info");
      } else {
        showToast("Спасибо! Жалоба отправлена модераторам.", "success");
      }
    } catch {
      setReportedGiftIds((prev) => {
        const next = new Set(prev);
        next.delete(giftId);
        return next;
      });
      showToast("Не удалось отправить жалобу. Попробуйте позже.", "warn");
    }
  };

  const [editingGift, setEditingGift] = useState(null);
  const [inviteGift, setInviteGift] = useState(null);
  const [myGiftsSheet, setMyGiftsSheet] = useState(null); // null | "mine" | "lit"
  const [collection, setCollection] = useState(null);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState(false);
  const openMyGifts = (tab) => {
    setIsMenuOpen(false);
    setMyGiftsSheet(tab);
    setCollectionLoading(true);
    setCollectionError(false);
    apiFetchMyCollection()
      .then(setCollection)
      .catch(() => setCollectionError(true))
      .finally(() => setCollectionLoading(false));
  };

  const handleOpenEdit = async (giftId) => {
    try {
      const mine = await apiFetchMyGift(giftId);
      if (!mine.can_edit) {
        const when = mine.next_edit_at
          ? new Date(mine.next_edit_at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
          : null;
        showToast(
          when
            ? `Шар можно переделывать раз в ${mine.edit_cooldown_days} дн. Следующая правка — ${when}.`
            : "Сейчас этот шар изменить нельзя.",
          "info"
        );
        return;
      }
      musicBoxSynth.stop();
      setEditingGift(mine);
      setIsWorkshopOpen(true);
    } catch (err) {
      showToast(isNetworkError(err) ? "Нет связи с Ёлкой — попробуйте позже." : err.message, "warn");
    }
  };

  const handleGiftUpdated = async (formData) => {
    if (!editingGift) return;
    const dto = await apiUpdateGift(editingGift.id, formData);
    const fresh = giftNodeFromDTO(dto);
    for (const [seq, g] of giftsMapRef.current.entries()) {
      if (g.id === dto.id) {
        giftsMapRef.current.set(seq, { ...fresh, coordinates: { ...g.coordinates } });
        break;
      }
    }
    const placed = resortTreeByLightHierarchy(dto.id);
    syncInstancedMeshes();
    if (placed) setSelectedGift(placed);
    setEditingGift(null);
    showToast("✨ Шар обновлён! Свечи остались с ним.", "success");
  };

  const handleGiftCreated = async (formData) => {
    const orderIdx = giftsMapRef.current.size;
    const wishText = formData.card.secret_wish || "";
    let newGiftNode = null;

    if (!isOfflineMode) {
      try {
        const dto = await apiCreateGift(formData);
        newGiftNode = giftNodeFromDTO(dto);
        if (dto.my_user_id) setMyUserId(dto.my_user_id);
        if (formData.card?.city) setMyCity(formData.card.city);
        window.setTimeout(refreshAchievements, 800);
        const nextCount = myGiftIds.size + 1;
        setMyGiftIds((prev) => new Set(prev).add(dto.id));
        showToast(
          nextCount >= maxGifts
            ? `🎄 Шар на Ёлке! Это ваш ${nextCount}-й шар из ${maxGifts} — больше повесить нельзя.`
            : `🎄 Шар на Ёлке! Вы можете повесить ещё ${maxGifts - nextCount}.`,
          "success"
        );
      } catch (err) {
        // Сервер ОТКЛОНИЛ шар (модерация, лимит и т.п.) — не делаем вид, что он повешен:
        // ошибка уходит в Мастерскую, где человек может её исправить.
        if (!isNetworkError(err)) throw err;
        console.warn("[WorldFir] API недоступен — шар сохранён локально:", err);
        showToast(
          "Нет связи с сервером: шар виден только на этом устройстве и не попадёт в Кольцо. Повесьте его ещё раз, когда связь появится.",
          "warn"
        );
      }
    }

    if (!newGiftNode) {
      const initialScoreObj = computeAntiSybilScoreDetails({
        wishText,
        celestaTrack: formData.melody.celesta_track,
        harpTrack: formData.melody.harp_track,
        celloTrack: formData.melody.cello_track,
        fluteTrack: formData.melody.flute_track,
        drumTrack: formData.melody.drum_track,
        voxelsCount: formData.snowglobe.voxels?.length || 24,
        engravingText: formData.snowglobe.engraving_text,
        candlesCount: 1,
      });

      newGiftNode = {
        id: `my-gift-${orderIdx}`,
        author_id: "my-local-user",
        created_order: orderIdx,
        offline: true,
        quality_score: initialScoreObj.total,
        coordinates: computeFibonacciSpiralSlot(orderIdx),
        snowglobe: formData.snowglobe,
        packaging: formData.packaging,
        melody: formData.melody,
        card_preview: {
          teaser_tag: formData.card.teaser_tag,
          author_display_name: formData.card.author_display_name,
          city: formData.card.city,
          totem_pet: formData.card.totem_pet,
        },
        secret_wish: wishText,
        wish_char_count: wishText.trim().length,
        candles_count: 1,
      };
      newGiftNode.genome_hash = computeDeterministicGenomeHash(newGiftNode);
    }

    giftsMapRef.current.set(orderIdx, newGiftNode);
    const placedGift = resortTreeByLightHierarchy(newGiftNode.id) || newGiftNode;
    syncInstancedMeshes();

    setMyHungGift(placedGift);
    setSelectedGift(placedGift);
    if (!placedGift.offline) window.setTimeout(() => setInviteGift(placedGift), 1600);
    scrollTargetRef.current = Math.min(
      MAX_SCROLL_DEPTH,
      placedGift.coordinates.y_height
    );
    musicBoxSynth.playMelody(
      placedGift.melody.tempo_bpm,
      placedGift.melody.celesta_track,
      placedGift.melody.harp_track,
      placedGift.melody.cello_track,
      placedGift.melody.flute_track,
      placedGift.melody.drum_track,
      null,
      placedGift.id,
      placedGift.melody.voices
    );
  };

  // Место 0 — лидер. delta=-1: выше по рейтингу (кнопка ›), +1: ниже (‹).
  const handleStepNeighborGift = (delta) => {
    if (!selectedGift) return;
    const total = giftsMapRef.current.size;
    if (total === 0) return;
    const curSeq = selectedGift.coordinates.sequence_number;
    let nextSeq = (curSeq + delta + total) % total;
    if (LOOK_NEW && (curSeq + delta < 0 || curSeq + delta >= total)) {
      showToast(delta < 0 ? "Это лидер рейтинга 👑" : "Это последний шар в рейтинге", "info");
      return;
    }
    const nextGift = giftsMapRef.current.get(nextSeq);
    if (nextGift) {
      setSelectedGift({ ...nextGift });
      scrollTargetRef.current = Math.min(
        MAX_SCROLL_DEPTH,
        nextGift.coordinates.y_height
      );
      musicBoxSynth.playMelody(
        nextGift.melody.tempo_bpm,
        nextGift.melody.celesta_track,
        nextGift.melody.harp_track,
        nextGift.melody.cello_track,
        nextGift.melody.flute_track,
        nextGift.melody.drum_track,
        null,
        nextGift.id,
        nextGift.melody.voices
      );
    }
  };

  const selectedSealMeta = selectedGift
    ? WAX_SEAL_MAP[selectedGift.packaging.wax_seal_stamp] || WAX_SEALS[0]
    : null;

  const isSelectedGiftPlaying =
    selectedGift && audioPlaybackState.playingId === selectedGift.id;

  const selectedGiftGenomeShort = useMemo(() => {
    if (!selectedGift) return "";
    return computeDeterministicGenomeHash(selectedGift).slice(0, 14) + "…";
  }, [selectedGift]);

  return (
    <div className="relative w-full h-screen bg-[#040914] overflow-hidden select-none font-sans text-slate-100">
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
      />

      {/* Передний 2D-параллакс слой резных снежинок (100% видимость при любом ракурсе) */}
      <canvas
        ref={fgSnowCanvasRef}
        className="fixed inset-0 pointer-events-none z-10"
      />

      {/* Морозная рождественская изморозь по краям экрана */}
      {!LOOK_NEW && <div
        className="fixed inset-0 pointer-events-none z-10 transition-opacity duration-700"
        style={{
          opacity: activeWeatherPreset.frostVignette,
          background:
            "radial-gradient(circle at 50% 50%, transparent 58%, rgba(186, 230, 253, 0.22) 88%, rgba(224, 242, 254, 0.45) 100%)",
        }}
      />}

      {/* ЕДИНАЯ ВЕРХНЯЯ ПАНЕЛЬ БЕЗ НАЛОЖЕНИЙ (Mobile-First + Desktop) */}
      {LOOK_NEW && (
        <NewLookTopBar
          countdownText={countdownText}
          isOfflineMode={isOfflineMode}
          onOpenRing={() => setIsRingModalOpen(true)}
          onOpenWorkshop={() => setIsWorkshopOpen(true)}
          onOpenMenu={() => setIsMenuOpen(true)}
          onOpenMine={() => openMyGifts("mine")}
        />
      )}
      <NewLookMenu
        isOpen={LOOK_NEW && isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        timeOfDay={timeOfDay}
        onTimeOfDay={setTimeOfDay}
        weatherId={newWeatherId}
        onWeather={(id) => {
          setNewWeatherId(id);
          const w = ALL_WEATHER.find((p) => p.id === id);
          if (w) setTimeOfDay(w.time);
        }}
        onToTop={() => {
          cameraFocusRef.current = null;
          scrollTargetRef.current = 2.0;
          setIsMenuOpen(false);
        }}
        onToGround={() => {
          cameraFocusRef.current = null;
          scrollTargetRef.current = 56.0;
          setIsMenuOpen(false);
        }}
        isHearthOn={isHearthSoundOn}
        onToggleHearth={() => {
          const next = !isHearthSoundOn;
          setIsHearthSoundOn(next);
          musicBoxSynth.toggleCozyHearthAmbient(next);
        }}
        onOpenRing={() => {
          setIsMenuOpen(false);
          setIsRingModalOpen(true);
        }}
        candleQuota={candleQuota}
        candleLeaders={candleLeaders}
        garlandMode={garlandMode}
        onGarlandMode={setGarlandMode}
        extraWeather={advent.weather}
        extraGarlands={advent.garlands}
        fest={{
          cityInfo,
          onMine: openMyGifts,
          onAdvent: () => {
            setIsMenuOpen(false);
            setIsAdventOpen(true);
          },
          adventBadge,
          onAchievements: () => {
            setIsMenuOpen(false);
            setIsAchOpen(true);
            refreshAchievements();
          },
          achievementsLabel: achievements ? `${achievements.unlocked}/${achievements.total}` : "",
          onTelegram: () => {
            setIsMenuOpen(false);
            handleTelegram();
          },
          telegramLinked,
          onRehearsal: () => {
            setIsMenuOpen(false);
            startMidnightShow("fireworks");
          },
          fireworksUnlocked: advent.fireworks,
        }}
        onShowGift={focusGiftById}
        onOpenGuide={() => {
          setIsMenuOpen(false);
          setIsWelcomeOpen(true);
        }}
      />
      {!LOOK_NEW && (
      <div className="fixed top-2.5 left-2.5 right-2.5 z-30 flex flex-col gap-2 pointer-events-none">
        {/* Главная компактная строка управления */}
        <div className="flex items-center justify-between gap-2">
          {/* Левый блок: название + быстрые бейджи + кнопка открытия погоды */}
          <div className="bg-[#0a1326]/85 backdrop-blur-xl border border-amber-400/40 rounded-2xl px-3 py-2 shadow-2xl pointer-events-auto flex items-center gap-2.5 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm sm:text-base">🎄</span>
                <h1 className="font-serif text-sm sm:text-xl font-bold text-amber-50 truncate">
                  Всемирная ёлка подарков
                </h1>
              </div>
              <div className="flex items-center gap-1 mt-0.5 text-[10px]">
                <span className="px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-400/40 text-emerald-300 font-semibold whitespace-nowrap">
                  🛡️ 18+
                </span>
                {isOfflineMode && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-950/90 border border-amber-400/40 text-amber-300 font-semibold whitespace-nowrap">
                    ⚠️ Демо-режим
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-amber-300 font-mono whitespace-nowrap">
                  🌲 Ярус {currentTier}
                </span>
                <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-sky-300 font-mono whitespace-nowrap">
                  🧊 {totalVoxelsOnTree}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsWeatherDrawerOpen((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold transition whitespace-nowrap shrink-0 ${
                isWeatherDrawerOpen
                  ? "bg-amber-400 text-slate-950 border-amber-200 shadow-md"
                  : "bg-slate-900/90 text-sky-200 border-sky-400/35 hover:border-amber-400/50"
              }`}
            >
              🌨 Погода {activeWeatherPreset.temp} {isWeatherDrawerOpen ? "▲" : "▼"}
            </button>
          </div>

          {/* Правый блок: таймер Кольца Чудес + кнопка Создать шар (никогда не перекрывают левый блок) */}
          <div className="flex items-center gap-1.5 pointer-events-auto shrink-0">
            <button
              type="button"
              onClick={() => setIsRingModalOpen(true)}
              className="bg-[#0b1528]/85 backdrop-blur-xl border border-amber-400/40 rounded-2xl px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-right shadow-2xl whitespace-nowrap"
            >
              <div className="text-[9px] sm:text-[10px] uppercase tracking-wider text-amber-400 font-semibold">
                🦉 Кольцо Чудес
              </div>
              <div className="text-[11px] sm:text-xs font-mono font-bold text-amber-50">
                ⏳ {countdownText}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setIsWorkshopOpen(true)}
              className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-bold text-xs sm:text-sm shadow-xl whitespace-nowrap"
            >
              🤲 <span className="hidden xs:inline">Создать</span> шар
            </button>
          </div>
        </div>

        {/* Быстрые кнопки навигации по высоте Ели и звука камина (в одну аккуратную строчку) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pointer-events-auto no-scrollbar">
          <button
            type="button"
            onClick={() => {
              scrollTargetRef.current = 2.0;
            }}
            className="px-2.5 py-1 rounded-xl bg-[#091224]/85 backdrop-blur-md border border-amber-400/30 text-amber-200 text-[11px] whitespace-nowrap shrink-0"
          >
            ✨ К вершине
          </button>
          <button
            type="button"
            onClick={() => {
              scrollTargetRef.current = 56.0;
            }}
            className="px-2.5 py-1 rounded-xl bg-[#091224]/85 backdrop-blur-md border border-amber-400/30 text-emerald-300 text-[11px] whitespace-nowrap shrink-0"
          >
            🏮 Поляна и фонари
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !isHearthSoundOn;
              setIsHearthSoundOn(next);
              musicBoxSynth.toggleCozyHearthAmbient(next);
            }}
            className={`px-2.5 py-1 rounded-xl border text-[11px] font-semibold whitespace-nowrap shrink-0 ${
              isHearthSoundOn
                ? "bg-amber-500/30 border-amber-400 text-amber-200"
                : "bg-[#091224]/85 border-slate-700 text-slate-300"
            }`}
          >
            🔥 Камин {isHearthSoundOn ? "ВКЛ" : ""}
          </button>
          <button
            type="button"
            onClick={() =>
              spawnOwlRef.current?.({
                handshake_id: `test-${Date.now()}`,
                from_city: "Мирный",
                to_city: "Санкт-Петербург",
              })
            }
            className="px-2.5 py-1 rounded-xl bg-amber-500/20 border border-amber-400/45 text-amber-300 text-[11px] font-semibold whitespace-nowrap shrink-0"
          >
            🦉 Полёт совы
          </button>
          <button
            type="button"
            onClick={() => setIsWelcomeOpen(true)}
            className="px-2.5 py-1 rounded-xl bg-[#091224]/85 backdrop-blur-md border border-sky-400/35 text-sky-200 text-[11px] font-semibold whitespace-nowrap shrink-0"
          >
            ❓ Как это работает
          </button>
        </div>

        {/* Выпадающая панель выбора погоды и интенсивности снегопада (открывается по кнопке «🌨 Погода») */}
        {isWeatherDrawerOpen && (
          <div className="bg-[#0a1326]/95 backdrop-blur-xl border border-amber-400/45 rounded-2xl p-3 shadow-2xl max-w-md pointer-events-auto space-y-2.5">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-amber-300 font-semibold">
              <span>🌨 Атмосфера и рождественский снег</span>
              <button
                type="button"
                onClick={() => setIsWeatherDrawerOpen(false)}
                className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]"
              >
                Скрыть ✕
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
              {CHRISTMAS_ATMOSPHERE_PRESETS.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => setWeatherPresetId(pr.id)}
                  className={`px-2 py-1.5 rounded-xl text-[10px] font-semibold border transition truncate ${
                    weatherPresetId === pr.id
                      ? "bg-amber-400 text-slate-950 border-amber-200 shadow-md"
                      : "bg-slate-900/90 text-slate-300 border-slate-700 hover:border-amber-400/40"
                  }`}
                >
                  {pr.title}
                </button>
              ))}
            </div>

            <div className="bg-slate-950/85 border border-sky-400/25 rounded-xl p-2 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-sky-200 font-semibold">
                  ❄️ Интенсивность снегопада:
                </span>
                <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono font-bold text-[10px]">
                  {Math.round(snowDensityMultiplier * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={3.0}
                step={0.1}
                value={snowDensityMultiplier}
                onChange={(e) =>
                  setSnowDensityMultiplier(Number(e.target.value))
                }
                className="w-full accent-sky-400 cursor-pointer h-1.5 rounded-lg"
              />
              <div className="flex items-center justify-between gap-1 pt-0.5">
                {[
                  { label: "Штиль 0%", val: 0 },
                  { label: "Лёгкий 80%", val: 0.8 },
                  { label: "Густой 150%", val: 1.5 },
                  { label: "Буран 300%", val: 3.0 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSnowDensityMultiplier(preset.val)}
                    className={`flex-1 py-0.5 px-1.5 rounded text-[9px] font-semibold border transition whitespace-nowrap ${
                      Math.abs(snowDensityMultiplier - preset.val) < 0.08
                        ? "bg-sky-400 text-slate-950 border-sky-200"
                        : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsForegroundSnowOn((v) => !v)}
              className={`w-full py-1.5 px-2.5 rounded-xl border text-[10px] font-semibold whitespace-nowrap ${
                isForegroundSnowOn
                  ? "bg-sky-500/25 border-sky-400 text-sky-200"
                  : "bg-slate-900 border-slate-700 text-slate-400"
              }`}
            >
              ❄️ Резные снежинки у экрана: {isForegroundSnowOn ? "ВКЛ" : "ВЫКЛ"}
            </button>
          </div>
        )}
      </div>
      )}

      {owlBanner && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-bounce">
          <div className="flex items-center gap-3.5 px-6 py-3.5 rounded-2xl bg-[#091224]/95 border-2 border-amber-400/70 shadow-2xl">
            <span className="text-3xl">🦉</span>
            <div>
              <div className="text-[10px] uppercase text-amber-300 font-bold">
                Свершилось Двойное Рукопожатие Мастеров!
              </div>
              <div className="font-serif text-lg font-bold text-white">
                {owlBanner.from_city} ⇄ {owlBanner.to_city}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedGift && LOOK_NEW && (
        <CompactGiftCard
          key={selectedGift.id}
          gift={selectedGift}
          isPlaying={isSelectedGiftPlaying}
          isLooping={audioPlaybackState.isLooping}
          playStep={audioPlaybackState.step}
          isOwn={myGiftIds.has(selectedGift.id)}
          isLit={litGiftIds.has(selectedGift.id)}
          isReported={reportedGiftIds.has(selectedGift.id)}
          candlesLeft={selectedGift.offline ? null : candleQuota.remaining}
          badge={
            candleLeaders.yesterday_winner?.gift_id === selectedGift.id
              ? "👑 Шар дня"
              : candleLeaders.today[0]?.gift_id === selectedGift.id
              ? "★ лидер дня"
              : ""
          }
          onPlay={() =>
            musicBoxSynth.toggleMelody(
              selectedGift.id,
              selectedGift.melody.tempo_bpm,
              selectedGift.melody.celesta_track,
              selectedGift.melody.harp_track,
              selectedGift.melody.cello_track,
              selectedGift.melody.flute_track,
              selectedGift.melody.drum_track,
              null,
              selectedGift.melody.voices
            )
          }
          onToggleLoop={() => musicBoxSynth.setLooping(!audioPlaybackState.isLooping)}
          onCandle={handleLightCandle}
          rank={selectedGift.coordinates.sequence_number + 1}
          total={giftsMapRef.current.size}
          onRankUp={() => handleStepNeighborGift(-1)}
          onRankDown={() => handleStepNeighborGift(1)}
          onClose={() => {
            musicBoxSynth.stop();
            setSelectedGift(null);
          }}
          onInspect={() => setIsInspectModalOpen(true)}
          onNft={() => setNftModalState({ isOpen: true, gift: selectedGift, recipientCity: null })}
          onReport={handleReportGift}
          onEdit={() => handleOpenEdit(selectedGift.id)}
          onShare={() => setInviteGift(selectedGift)}
        />
      )}

      {selectedGift && !LOOK_NEW && (
        <div className="fixed bottom-2.5 right-2.5 left-2.5 md:left-auto md:w-[450px] wfg-mh-75 overflow-y-auto bg-[#0b1528]/92 backdrop-blur-xl border border-amber-400/45 rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-2xl z-30">
          <div className="flex justify-between items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/40 whitespace-nowrap">
                  ✨ {selectedGift.quality_score}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/40 whitespace-nowrap">
                  🕯 {selectedGift.candles_count}
                </span>
                <h3 className="font-serif text-sm sm:text-lg font-bold text-amber-50 truncate">
                  «{selectedGift.card_preview.teaser_tag}»
                </h3>
              </div>
              <div className="text-[11px] text-slate-300 truncate mt-0.5">
                Мастер: <strong className="text-white">{selectedGift.card_preview.author_display_name}</strong> ({selectedGift.card_preview.city})
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* На мобильных кнопка разворачивания/сворачивания 3D-превью шара */}
              <button
                type="button"
                onClick={() => setIsMobileCardExpanded((v) => !v)}
                className="md:hidden px-2 py-1 rounded-lg bg-slate-800 text-amber-300 border border-amber-400/30 text-[10px] font-semibold whitespace-nowrap"
              >
                {isMobileCardExpanded ? "Свернуть ▲" : "3D-Шар ▼"}
              </button>
              <button
                type="button"
                title="Предыдущий шар на спирали"
                onClick={() => handleStepNeighborGift(-1)}
                className="text-slate-300 hover:text-amber-300 text-xs w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-800/90 flex items-center justify-center"
              >
                ◀
              </button>
              <button
                type="button"
                title="Следующий шар на спирали"
                onClick={() => handleStepNeighborGift(1)}
                className="text-slate-300 hover:text-amber-300 text-xs w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-800/90 flex items-center justify-center"
              >
                ▶
              </button>
              <button
                type="button"
                onClick={() => {
                  musicBoxSynth.stop();
                  setSelectedGift(null);
                }}
                className="text-slate-400 hover:text-white text-xs w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-800 flex items-center justify-center"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Детальная витрина шара: всегда видна на ПК, а на телефоне открывается по кнопке «3D-Шар ▼», чтобы не закрывать Ель */}
          <div
            className={`${
              isMobileCardExpanded ? "flex" : "hidden md:flex"
            } mt-2.5 p-3 rounded-2xl bg-[#050a14]/90 border border-amber-500/25 flex-col sm:flex-row items-center gap-3.5`}
          >
            <VoxelSnowglobe3DViewer
              voxels={selectedGift.snowglobe?.voxels}
              baseMaterial={selectedGift.snowglobe?.base_material || "mahogany"}
              glitterColor={selectedGift.snowglobe?.glitter_color || "#fde047"}
              engravingText={selectedGift.snowglobe?.engraving_text}
              size="sm"
            />
            <div className="flex-1 text-xs space-y-1.5 w-full">
              <p className="text-slate-300">
                Тотем:{" "}
                <span className="text-amber-300">
                  {selectedSealMeta?.symbol}{" "}
                  {selectedGift.card_preview.totem_pet}
                </span>
              </p>
              <div className="text-[10px] font-mono text-sky-300 truncate">
                Геном: {selectedGiftGenomeShort}
              </div>

              <button
                type="button"
                onClick={() => setIsInspectModalOpen(true)}
                className="w-full py-1.5 px-3 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-amber-400/35 text-amber-200 font-semibold text-xs transition"
              >
                🔍 Осмотреть ручную работу крупным планом
              </button>

              <button
                type="button"
                onClick={() =>
                  setNftModalState({
                    isOpen: true,
                    gift: selectedGift,
                    recipientCity: null,
                  })
                }
                className="w-full py-1.5 px-3 rounded-xl bg-gradient-to-r from-sky-500/25 to-indigo-500/25 hover:from-sky-500/35 hover:to-indigo-500/35 border border-sky-400/50 text-sky-200 font-semibold text-xs transition"
              >
                📜 Паспорт шара и 3D-открытка
              </button>
            </div>
          </div>

          {/* 16-шаговый индикатор проигрывания симфонии */}
          <div className="mt-2.5 bg-[#050a14]/90 border border-slate-800 rounded-xl p-2 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span className="truncate">
                {isSelectedGiftPlaying
                  ? `🎶 Играет шаг ${(audioPlaybackState.step ?? 0) + 1} из 16`
                  : "Тап по шару на Ёлке включает/выключает музыку"}
              </span>
              <button
                type="button"
                onClick={() =>
                  musicBoxSynth.setLooping(!audioPlaybackState.isLooping)
                }
                className={`px-2 py-0.5 rounded font-semibold transition whitespace-nowrap ${
                  audioPlaybackState.isLooping
                    ? "bg-amber-400/25 text-amber-300 border border-amber-400/40"
                    : "bg-slate-900 text-slate-400 hover:text-slate-200"
                }`}
              >
                🔁 Цикл {audioPlaybackState.isLooping ? "ВКЛ" : "ВЫКЛ"}
              </button>
            </div>
            <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1">
              {Array.from({ length: 16 }).map((_, sIdx) => {
                const isActive =
                  isSelectedGiftPlaying && audioPlaybackState.step === sIdx;
                return (
                  <div
                    key={sIdx}
                    className={`h-1.5 rounded-full transition ${
                      isActive
                        ? "bg-amber-400 scale-y-125 shadow-[0_0_8px_#fbbf24]"
                        : sIdx % 4 === 0
                        ? "bg-slate-700"
                        : "bg-slate-800"
                    }`}
                  />
                );
              })}
            </div>
          </div>

          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() =>
                musicBoxSynth.toggleMelody(
                  selectedGift.id,
                  selectedGift.melody.tempo_bpm,
                  selectedGift.melody.celesta_track,
                  selectedGift.melody.harp_track,
                  selectedGift.melody.cello_track,
                  selectedGift.melody.flute_track,
                  selectedGift.melody.drum_track,
                  null,
                  selectedGift.melody.voices
                )
              }
              className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold whitespace-nowrap transition ${
                isSelectedGiftPlaying
                  ? "bg-rose-500 hover:bg-rose-400 border-rose-300 text-white"
                  : "bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-400/30"
              }`}
            >
              {isSelectedGiftPlaying
                ? "⏹ Стоп"
                : "▶ Слушать (5 дорожек)"}
            </button>
            <button
              type="button"
              disabled={litGiftIds.has(selectedGift.id) || myGiftIds.has(selectedGift.id)}
              onClick={handleLightCandle}
              className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-bold text-xs whitespace-nowrap disabled:opacity-60"
            >
              {myGiftIds.has(selectedGift.id)
                ? "🤲 Ваш шар"
                : litGiftIds.has(selectedGift.id)
                ? "🕯 Свеча горит"
                : "🕯 Зажечь свечу"}
            </button>
            {!selectedGift.offline && (
              <button
                type="button"
                title="Пожаловаться на неуместное содержимое"
                aria-label="Пожаловаться на шар"
                disabled={reportedGiftIds.has(selectedGift.id)}
                onClick={handleReportGift}
                className="py-2 px-2.5 rounded-xl border border-slate-700 bg-slate-900 text-slate-400 hover:text-rose-300 disabled:opacity-50 text-xs"
              >
                {reportedGiftIds.has(selectedGift.id) ? "✓" : "⚑"}
              </button>
            )}
          </div>
        </div>
      )}

      {isInspectModalOpen && selectedGift && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#030712]/90 backdrop-blur-xl sm:p-4" role="dialog" aria-modal="true" aria-label="Рассмотреть шар">
          <div className="bg-[#091224] border border-amber-400/50 rounded-t-3xl sm:rounded-3xl p-5 max-w-md w-full flex flex-col items-center space-y-4 shadow-2xl wfg-mh-92 overflow-y-auto wfg-safe-b">
            <div className="wfg-sticky-head w-full flex items-center justify-between self-stretch">
              <span className="text-xs uppercase tracking-widest text-amber-400 font-semibold">
                🤲 Рассмотреть шар
              </span>
              <button
                type="button"
                onClick={() => setIsInspectModalOpen(false)}
                aria-label="Закрыть"
                className="w-10 h-10 rounded-xl bg-slate-800 text-slate-200 text-lg"
              >
                ✕
              </button>
            </div>
            <h3 className="font-serif text-2xl font-bold text-white text-center">
              «{selectedGift.card_preview.teaser_tag}»
            </h3>
            <VoxelSnowglobe3DViewer
              voxels={selectedGift.snowglobe?.voxels}
              baseMaterial={selectedGift.snowglobe?.base_material}
              glitterColor={selectedGift.snowglobe?.glitter_color}
              engravingText={selectedGift.snowglobe?.engraving_text}
              size="lg"
            />
            <button
              type="button"
              onClick={() => {
                setIsInspectModalOpen(false);
                setNftModalState({
                  isOpen: true,
                  gift: selectedGift,
                  recipientCity: null,
                });
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-amber-400 text-slate-950 font-bold text-xs"
            >
              📜 Паспорт шара и 3D-открытка
            </button>
          </div>
        </div>
      )}

      {/* Модальное окно Мастерской 3D-Шара и 5-дорожечной Симфонии */}
      <GiftWorkshopModal
        isOpen={isWorkshopOpen}
        onClose={() => {
          setIsWorkshopOpen(false);
          setEditingGift(null);
        }}
        onGiftCreated={handleGiftCreated}
        onGiftUpdated={handleGiftUpdated}
        editGift={editingGift}
        advent={advent}
        remainingGifts={isOfflineMode ? null : Math.max(0, maxGifts - myGiftIds.size)}
        maxGifts={maxGifts}
      />

      {midnightShow && (
        <React.Suspense fallback={null}>
          <MidnightShow
            key={midnightShow.key}
            mode={midnightShow.mode}
            startAtMs={serverUnlockAtMs ?? UNLOCK_TARGET_MS}
            nowOffsetMs={clockOffsetMs}
            onOwl={() => musicBoxSynth.playOwlChime()}
            fireworks3d={fireworksRef.current}
            getAudioContext={() => {
              musicBoxSynth.init();
              return musicBoxSynth.ctx;
            }}
            onDone={(mode) => {
              setMidnightShow(null);
              if (mode === "live") setIsRingModalOpen(true);
            }}
          />
        </React.Suspense>
      )}

      {isAdventOpen && (
        <AdventModal today={adventDay} opened={adventOpened} onOpen={openAdventWindow} onClose={() => setIsAdventOpen(false)} />
      )}
      {isTelegramOpen && (
        <TelegramSheet
          status={telegramStatus}
          hasGift={myGiftIds.size > 0}
          onClose={() => setIsTelegramOpen(false)}
          onConnect={async () => {
            // окно открываем сразу (в обработчике клика), иначе браузер его заблокирует
            const win = window.open("about:blank", "_blank");
            try {
              const { url } = await apiCreateTelegramLink();
              if (win) win.location.href = url;
              else window.location.href = url;
              showToast("Нажмите «Старт» в Telegram — и уведомления подключатся 🔔", "info");
              window.setTimeout(refreshTelegram, 15000);
            } catch (err) {
              win?.close();
              showToast(err.message || "Не удалось подключить бота", "warn");
            }
          }}
          onDisconnect={async () => {
            await apiDeleteTelegramLink().catch(() => {});
            refreshTelegram();
          }}
        />
      )}
      {isAchOpen && <AchievementsModal data={achievements} onClose={() => setIsAchOpen(false)} />}

      {myGiftsSheet && (
        <MyGiftsSheet
          key={myGiftsSheet}
          data={collection}
          loading={collectionLoading}
          error={collectionError}
          onRetry={() => openMyGifts(myGiftsSheet)}
          initialTab={myGiftsSheet}
          litToday={litGiftIds}
          candlesLeft={candleQuota.remaining}
          onClose={() => setMyGiftsSheet(null)}
          onCreate={() => {
            setMyGiftsSheet(null);
            setIsWorkshopOpen(true);
          }}
          onShow={(id) => {
            if (focusGiftById(id)) setMyGiftsSheet(null);
          }}
          onShare={(g) => setInviteGift(giftNodeFromDTO(g))}
          onEdit={(id) => {
            setMyGiftsSheet(null);
            handleOpenEdit(id);
          }}
        />
      )}

      {inviteGift && (
        <InviteSheet
          gift={inviteGift}
          isOwn={myGiftIds.has(inviteGift.id)}
          onClose={() => setInviteGift(null)}
        />
      )}

      <WelcomeGuideModal
        isOpen={isWelcomeOpen}
        onClose={closeWelcome}
        onStart={() => {
          closeWelcome();
          setIsWorkshopOpen(true);
        }}
        maxGifts={maxGifts}
      />

      {toast && (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className={`fixed left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] sm:max-w-md pointer-events-none ${LOOK_NEW ? "top-20" : "bottom-24 md:bottom-6"}`}
        >
          <div
            className={`px-4 py-2.5 rounded-2xl border shadow-2xl backdrop-blur-xl text-xs sm:text-sm leading-snug ${
              toast.tone === "success"
                ? "bg-emerald-950/90 border-emerald-400/50 text-emerald-100"
                : toast.tone === "warn"
                ? "bg-rose-950/90 border-rose-400/50 text-rose-100"
                : "bg-[#0b1528]/95 border-amber-400/50 text-amber-50"
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}

      {/* Модальное окно Кольца Чудес и Новогодней Распаковки */}
      <MiracleRingModal
        isOpen={isRingModalOpen}
        onClose={() => setIsRingModalOpen(false)}
        myUserId={myUserId}
        myGift={myHungGift || selectedGift}
        isOfflineMode={isOfflineMode}
        countdownText={countdownText}
        isUnlocked={(serverUnlockAtMs ?? UNLOCK_TARGET_MS) <= Date.now() + clockOffsetMs}
        unlockAtMs={serverUnlockAtMs ?? UNLOCK_TARGET_MS}
        onTriggerOwlFlight={(payload) => spawnOwlRef.current?.(payload)}
        onOpenNftPassport={(giftNode, recipientCity) => {
          setIsRingModalOpen(false);
          setNftModalState({
            isOpen: true,
            gift: giftNode,
            recipientCity,
          });
        }}
      />

      {/* Паспорт шара и 3D-открытка */}
      <NftRelicPassportModal
        isOpen={nftModalState.isOpen}
        onClose={() =>
          setNftModalState({ isOpen: false, gift: null, recipientCity: null })
        }
        gift={nftModalState.gift}
        recipientCity={nftModalState.recipientCity}
      />
    </div>
  );
}