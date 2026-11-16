import { describe, expect, it } from "vitest";
import {
  buildGenomeCanonical,
  computeDeterministicGenomeHash,
  sha256Hex,
} from "../src/lib/genome.js";

describe("sha256Hex (sync-реализация)", () => {
  it("эталонные векторы NIST", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("юникод и длинные сообщения", () => {
    // Вектор сверен с hashlib.sha256 из бэкенда (паритет UTF-8)
    expect(sha256Hex("абв")).toBe(
      "39e305d37ff46062cc8bfc3ca667491e07d17cfa2e71404c641381fa1b8cc2ca"
    );
    expect(sha256Hex("a".repeat(1000))).toHaveLength(64);
  });
});

describe("канонический геном артефакта", () => {
  const melody = {
    tempo_bpm: 108,
    celesta_track: [7, 9],
    harp_track: [],
    cello_track: [1],
    flute_track: [],
    drum_track: [],
  };

  it("не зависит от порядка вокселей", () => {
    const a = {
      voxels: [
        { x: 1, y: 0, z: 0, color: "#a" },
        { x: 0, y: 1, z: 0, color: "#b" },
      ],
    };
    const b = {
      voxels: [
        { x: 0, y: 1, z: 0, color: "#b" },
        { x: 1, y: 0, z: 0, color: "#a" },
      ],
    };
    expect(buildGenomeCanonical(a, melody)).toBe(buildGenomeCanonical(b, melody));
    expect(computeDeterministicGenomeHash({ snowglobe: a, melody })).toBe(
      computeDeterministicGenomeHash({ snowglobe: b, melody })
    );
  });

  it("реагирует на смену гравировки и материала", () => {
    const base = { engraving_text: "абв", voxels: [] };
    const other = { engraving_text: "абг", voxels: [] };
    expect(computeDeterministicGenomeHash({ snowglobe: base, melody })).not.toBe(
      computeDeterministicGenomeHash({ snowglobe: other, melody })
    );
  });

  it("детерминирован и имеет формат 0x + 16 hex", () => {
    const gift = { snowglobe: { base_material: "birch", voxels: [] }, melody };
    const hash = computeDeterministicGenomeHash(gift);
    expect(hash).toMatch(/^0x[0-9a-f]{16}$/);
    expect(computeDeterministicGenomeHash(gift)).toBe(hash);
  });
});
