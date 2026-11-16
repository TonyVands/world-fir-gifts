import { describe, expect, it } from "vitest";
import {
  inspectContentSafety,
  inspectVoxelGeometrySafety,
  normalizeForModeration,
} from "../src/App.jsx";

describe("текстовый фильтр 18+ / анти-скам", () => {
  it("чистое пожелание проходит", () => {
    expect(
      inspectContentSafety({ Пожелание: "С Новым годом! Пусть дома ждёт уют и чай." })
        .isSafe
    ).toBe(true);
  });

  it("мат, скам и ссылки блокируются", () => {
    expect(inspectContentSafety({ Пожелание: "иди нахуй" }).isSafe).toBe(false);
    expect(
      inspectContentSafety({ Бирка: "смотри https://evil.example" }).isSafe
    ).toBe(false);
    expect(inspectContentSafety({ Контакт: "t.me/spam" }).isSafe).toBe(false);
    expect(inspectContentSafety({ Автор: "Казино Вулкан" }).isSafe).toBe(false);
    expect(inspectContentSafety({ Гравировка: "оплати перевод" }).isSafe).toBe(
      false
    );
  });

  it("нормализация снимает гомоглифы и повторы", () => {
    expect(normalizeForModeration("сукa")).toBe("сука");
    expect(normalizeForModeration("ХУУУЙ")).toBe("хуй");
    expect(
      inspectContentSafety({ Пожелание: "просто сукa" }).isSafe
    ).toBe(false);
  });
});

describe("3D-топологический щит 18+", () => {
  it("слишком мало блоков", () => {
    const result = inspectVoxelGeometrySafety([{ x: 0, y: 0, z: 0 }]);
    expect(result.isSafe).toBe(false);
    expect(result.code).toBe("TOO_FEW_BLOCKS");
  });

  it("плотная композиция проходит", () => {
    const voxels = [];
    for (let x = 3; x <= 5; x++)
      for (let y = 3; y <= 5; y++)
        for (let z = 3; z <= 5; z++) voxels.push({ x, y, z, color: "#fff" });
    expect(inspectVoxelGeometrySafety(voxels).isSafe).toBe(true);
  });

  it("разрозненный мусор в воздухе блокируется", () => {
    // 12 вокселей с чётными координатами — ни одна пара не соседняя (26-связность)
    const voxels = [];
    for (let i = 0; i < 12; i++) {
      voxels.push({
        x: (i % 4) * 2,
        y: Math.floor(i / 4) * 2,
        z: 0,
        color: "#fff",
      });
    }
    const result = inspectVoxelGeometrySafety(voxels);
    expect(result.isSafe).toBe(false);
    expect(result.code).toBe("FRAGMENTED_NOISE");
  });
});

import { readFileSync } from "fs";
import { findTextViolation } from "../src/lib/moderation.js";

describe("общие тест-векторы с бэкендом (tests/fixtures/moderation_cases.json)", () => {
  const cases = JSON.parse(
    readFileSync(new URL("../../tests/fixtures/moderation_cases.json", import.meta.url), "utf-8")
  );

  it("обычные пожелания не блокируются (раньше «волшебного», «небо», «сюрприз» ловились)", () => {
    for (const text of cases.safe) expect(findTextViolation(text), text).toBeNull();
  });

  it("мат, скам, ссылки и обфускация блокируются", () => {
    for (const text of cases.unsafe) expect(findTextViolation(text), text).not.toBeNull();
  });

  it("правила совпадают с копией бэкенда", () => {
    const front = readFileSync(new URL("../src/lib/moderation_rules.json", import.meta.url), "utf-8");
    const back = readFileSync(new URL("../../app/core/moderation_rules.json", import.meta.url), "utf-8");
    expect(front).toBe(back);
  });
});
