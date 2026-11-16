import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  computeAntiSybilScoreDetails,
  computeFibonacciSpiralSlot,
} from "../src/App.jsx";
import {
  buildGenomeCanonical,
  computeDeterministicGenomeHash,
} from "../src/lib/genome.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../tests/fixtures/parity_golden.json", import.meta.url),
    "utf-8"
  )
);

describe("золотые фикстуры паритета с бэкендом (app/services/matching.py)", () => {
  it("слоты спирали Фибоначчи", () => {
    for (const expected of fixture.spiral_slots) {
      const actual = computeFibonacciSpiralSlot(expected.sequence_number);
      expect(actual.tier_index, `seq=${expected.sequence_number}`).toBe(
        expected.tier_index
      );
      expect(actual.branch_angle_rad).toBeCloseTo(expected.branch_angle_rad, 5);
      expect(actual.radius_offset).toBeCloseTo(expected.radius_offset, 4);
      expect(actual.y_height).toBeCloseTo(expected.y_height, 4);
    }
  });

  it("Индекс Тепла (LightScore) и эшелоны", () => {
    for (const caseItem of fixture.quality_scores) {
      const payload = caseItem.payload;
      const details = computeAntiSybilScoreDetails({
        wishText: payload.card.secret_wish,
        wishCharCount: payload.wish_char_count || 0,
        celestaTrack: payload.melody.celesta_track || [],
        harpTrack: payload.melody.harp_track || [],
        celloTrack: payload.melody.cello_track || [],
        fluteTrack: payload.melody.flute_track || [],
        drumTrack: payload.melody.drum_track || [],
        voxelsCount: (payload.snowglobe.voxels || []).length,
        engravingText: payload.snowglobe.engraving_text || "",
        candlesCount: caseItem.candles_count,
      });
      expect(
        Math.abs(details.total - caseItem.score) < 0.11,
        `${caseItem.id}: js=${details.total} py=${caseItem.score}`
      ).toBe(true);
    }
  });

  it("каноническая строка генома и sha256-хэш", () => {
    for (const caseItem of fixture.genome_hashes) {
      expect(
        buildGenomeCanonical(caseItem.snowglobe, caseItem.melody),
        caseItem.id
      ).toBe(caseItem.canonical);
      expect(
        computeDeterministicGenomeHash({
          snowglobe: caseItem.snowglobe,
          melody: caseItem.melody,
        }),
        caseItem.id
      ).toBe(caseItem.hash);
    }
  });
});
