// 3D-щит построек — бит-в-бит повторяет app/services/moderation.py::inspect_voxel_geometry_safety.

function rotateMatrix8x8(mat) {
  const res = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      res[c][7 - r] = mat[r][c];
    }
  }
  return res;
}

function hasSwastikaPatternIn2DGrid(grid8x8) {
  const templates5x5 = [
    [
      [1, 0, 1, 1, 1],
      [1, 0, 1, 0, 0],
      [1, 1, 1, 1, 1],
      [0, 0, 1, 0, 1],
      [1, 1, 1, 0, 1],
    ],
    [
      [1, 1, 1, 0, 1],
      [0, 0, 1, 0, 1],
      [1, 1, 1, 1, 1],
      [1, 0, 1, 0, 0],
      [1, 0, 1, 1, 1],
    ],
  ];

  let current = grid8x8;
  for (let rot = 0; rot < 4; rot++) {
    for (let rOff = 0; rOff <= 3; rOff++) {
      for (let cOff = 0; cOff <= 3; cOff++) {
        for (const tpl of templates5x5) {
          let matchedOnes = 0;
          let matchedZeros = 0;
          for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
              const val = current[rOff + r][cOff + c];
              if (tpl[r][c] === 1 && val === 1) matchedOnes++;
              if (tpl[r][c] === 0 && val === 0) matchedZeros++;
            }
          }
          if (matchedOnes >= 15 && matchedZeros >= 7) {
            return true;
          }
        }
      }
    }
    current = rotateMatrix8x8(current);
  }
  return false;
}

export function inspectVoxelGeometrySafety(voxels) {
  if (!voxels || voxels.length < 4) {
    return {
      isSafe: false,
      code: "TOO_FEW_BLOCKS",
      reason: "Постройте фигурку минимум из 4 воксельных кубиков внутри шара.",
    };
  }

  const uniqueMap = new Map();
  voxels.forEach((v) => {
    const x = Math.max(0, Math.min(7, Number(v.x) || 0));
    const y = Math.max(0, Math.min(7, Number(v.y) || 0));
    const z = Math.max(0, Math.min(7, Number(v.z) || 0));
    uniqueMap.set(`${x},${y},${z}`, { x, y, z });
  });
  const pts = Array.from(uniqueMap.values());
  const total = pts.length;

  for (let slice = 0; slice < 8; slice++) {
    const gridXY = Array.from({ length: 8 }, () => Array(8).fill(0));
    const gridXZ = Array.from({ length: 8 }, () => Array(8).fill(0));
    const gridYZ = Array.from({ length: 8 }, () => Array(8).fill(0));
    pts.forEach((p) => {
      if (p.z === slice) gridXY[p.y][p.x] = 1;
      if (p.y === slice) gridXZ[p.z][p.x] = 1;
      if (p.x === slice) gridYZ[p.y][p.z] = 1;
    });
    if (
      hasSwastikaPatternIn2DGrid(gridXY) ||
      hasSwastikaPatternIn2DGrid(gridXZ) ||
      hasSwastikaPatternIn2DGrid(gridYZ)
    ) {
      return {
        isSafe: false,
        code: "BANNED_SYMBOL_3D",
        reason:
          "3D-анализатор обнаружил запрещённую символику на одном из срезов модели.",
      };
    }
  }

  const axes = [
    { main: "y", u: "x", v: "z" },
    { main: "x", u: "y", v: "z" },
    { main: "z", u: "x", v: "y" },
  ];

  for (const ax of axes) {
    const layers = Array.from({ length: 8 }, () => []);
    pts.forEach((p) => layers[p[ax.main]].push(p));

    const nonEmptyLayers = [];
    for (let idx = 0; idx < 8; idx++) {
      if (layers[idx].length > 0) nonEmptyLayers.push(idx);
    }
    if (nonEmptyLayers.length < 5) continue;

    const layerStats = nonEmptyLayers.map((lvl) => {
      const arr = layers[lvl];
      const uVals = arr.map((p) => p[ax.u]);
      const vVals = arr.map((p) => p[ax.v]);
      const spanU = Math.max(...uVals) - Math.min(...uVals) + 1;
      const spanV = Math.max(...vVals) - Math.min(...vVals) + 1;
      const centerU = uVals.reduce((a, b) => a + b, 0) / uVals.length;
      const centerV = vVals.reduce((a, b) => a + b, 0) / vVals.length;
      return {
        lvl,
        count: arr.length,
        spanU,
        spanV,
        maxSpan: Math.max(spanU, spanV),
        centerU,
        centerV,
      };
    });

    for (const stats of [layerStats, [...layerStats].reverse()]) {
      const baseLayers = stats.slice(0, 2);
      const upperLayers = stats.slice(2);

      const maxBaseSpan = Math.max(...baseLayers.map((s) => s.maxSpan));
      const baseBlockCount = baseLayers.reduce((acc, s) => acc + s.count, 0);

      const narrowShaftLayers = upperLayers.filter(
        (s) => s.spanU <= 2 && s.spanV <= 2 && s.count <= 4
      );
      const wideUpperLayers = upperLayers.filter((s) => s.maxSpan >= 3);

      if (
        maxBaseSpan >= 4 &&
        baseBlockCount >= 4 &&
        baseBlockCount <= 18 &&
        narrowShaftLayers.length >= 4 &&
        wideUpperLayers.length === 0
      ) {
        const avgU =
          narrowShaftLayers.reduce((a, s) => a + s.centerU, 0) /
          narrowShaftLayers.length;
        const avgV =
          narrowShaftLayers.reduce((a, s) => a + s.centerV, 0) /
          narrowShaftLayers.length;
        const maxDeviation = Math.max(
          ...narrowShaftLayers.map(
            (s) => Math.hypot(s.centerU - avgU, s.centerV - avgV)
          )
        );

        if (maxDeviation <= 1.1) {
          return {
            isSafe: false,
            code: "NSFW_SILHOUETTE_18PLUS",
            reason:
              "3D-фильтр 18+ обнаружил недопустимый анатомический силуэт или жест (узкий столб на широком основании). Добавьте боковые ветви, крышу или декор.",
          };
        }
      }
    }
  }

  const visited = new Set();
  const keyOf = (p) => `${p.x},${p.y},${p.z}`;
  let largestCluster = 0;

  for (const startPt of pts) {
    const startKey = keyOf(startPt);
    if (visited.has(startKey)) continue;
    let clusterSize = 0;
    const queue = [startPt];
    visited.add(startKey);

    while (queue.length > 0) {
      const curr = queue.pop();
      clusterSize++;
      for (const other of pts) {
        const oKey = keyOf(other);
        if (!visited.has(oKey)) {
          if (
            Math.abs(curr.x - other.x) <= 1 &&
            Math.abs(curr.y - other.y) <= 1 &&
            Math.abs(curr.z - other.z) <= 1
          ) {
            visited.add(oKey);
            queue.push(other);
          }
        }
      }
    }
    if (clusterSize > largestCluster) largestCluster = clusterSize;
  }

  if (largestCluster / total < 0.45 && total > 10) {
    return {
      isSafe: false,
      code: "FRAGMENTED_NOISE",
      reason:
        "Воксели слишком разрознены в воздухе. Соедините блоки в цельную 3D-композицию.",
    };
  }

  return { isSafe: true, code: "OK", reason: null };
}

