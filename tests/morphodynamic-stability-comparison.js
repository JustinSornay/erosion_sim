/**
 * Benchmark-only comparison of a local incision floor. The production engine
 * remains unchanged: variants are injected into an isolated source string.
 * Usage: node tests/morphodynamic-stability-comparison.js [--write-captures]
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const checkpoints = [1000, 5000, 10000, 20000];
const incidenceLimits = [0.05, 0.10, 0.20, 0.40, 0.80];
const sectionWidth = 5;
const captureSteps = new Set([5000, 10000, 20000]);
const d8x = [-1, 0, 1, -1, 1, -1, 0, 1];
const d8y = [-1, -1, -1, 0, 0, 1, 1, 1];

function localIncisionSource(maximumLocalIncidence) {
  const replacement = `const diff = KS * (C - si) * sourceProtectionMask[i];
        let minNeighborB = Infinity;
        for (let neighborY = Math.max(0, y - 1); neighborY <= Math.min(N - 1, y + 1); neighborY++) {
          for (let neighborX = Math.max(0, x - 1); neighborX <= Math.min(N - 1, x + 1); neighborX++) {
            if (neighborX === x && neighborY === y) continue;
            minNeighborB = Math.min(minNeighborB, b[neighborY * N + neighborX]);
          }
        }
        const oldB = b[i];
        const proposed = oldB - diff;
        const localFloor = minNeighborB - ${maximumLocalIncidence};
        const newB = Math.max(proposed, localFloor);
        const actualDiff = oldB - newB;
        b[i] = newB;
        s[i] = si + actualDiff;`;
  const variant = currentSource.replace(
    /const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/,
    replacement,
  );
  if (variant === currentSource) throw new Error("MAX_LOCAL_INCIDENCE injection failed");
  return variant;
}

function simulate(source, steps) {
  const math = Object.create(Math);
  math.random = () => 0.3141592653;
  const run = new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain();
    const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
    for (let stepIndex = 0; stepIndex < ${steps}; stepIndex++) step();
    return { N, b, bInit, d, u, v, s, source };
  `);
  return run(math, Float32Array, Int32Array, Uint8Array);
}

/** Follows realised current until a terrain-downhill fallback is required. */
function traceReferencePath(snapshot, maximumPositions = 41) {
  const cells = [];
  const visited = new Uint8Array(snapshot.N * snapshot.N);
  let index = snapshot.source.outletIndices[0];
  for (let position = 0; position < maximumPositions && !visited[index]; position++) {
    cells.push(index); visited[index] = 1;
    const x = index % snapshot.N; const y = (index / snapshot.N) | 0;
    let next = -1; let bestProjection = 0;
    for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction]; const ny = y + d8y[direction];
      if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx;
      const projection = snapshot.u[index] * d8x[direction] + snapshot.v[index] * d8y[direction];
      if (!visited[candidate] && projection > bestProjection) { bestProjection = projection; next = candidate; }
    }
    if (next < 0) for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction]; const ny = y + d8y[direction];
      if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx;
      if (!visited[candidate] && snapshot.b[candidate] < snapshot.b[index] && (next < 0 || snapshot.b[candidate] < snapshot.b[next])) next = candidate;
    }
    if (next < 0) break;
    index = next;
  }
  return cells;
}

function section(snapshot, referencePath, position) {
  const cell = referencePath[position]; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0;
  const before = referencePath[Math.max(0, position - 1)]; const after = referencePath[Math.min(referencePath.length - 1, position + 1)];
  const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0);
  const length = Math.hypot(dx, dy) || 1; const channelX = dx / length; const channelY = dy / length;
  const normalX = -Math.sign(dy); const normalY = Math.sign(dx);
  let sectionDischarge = 0; let wetWidth = 0; let sumQ = 0; let vectorU = 0; let vectorV = 0;
  for (let offset = -2; offset <= 2; offset++) {
    const sx = x + normalX * offset; const sy = y + normalY * offset;
    if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue;
    const index = sy * snapshot.N + sx; const depth = snapshot.d[index]; const velocity = Math.hypot(snapshot.u[index], snapshot.v[index]);
    sectionDischarge += depth * Math.max(0, snapshot.u[index] * channelX + snapshot.v[index] * channelY);
    if (depth > 1e-6) wetWidth++;
    sumQ += depth * velocity; vectorU += depth * snapshot.u[index]; vectorV += depth * snapshot.v[index];
  }
  return { sectionDischarge, wetWidth, directionalCoherence: Math.hypot(vectorU, vectorV) / Math.max(sumQ, 1e-12) };
}

function erosionZones(snapshot, referencePath) {
  const zones = [[0, 5], [6, 15], [16, referencePath.length - 1]];
  return zones.map(([start, end]) => {
    let erosion = 0;
    for (let position = start; position <= end; position++) {
      const cell = referencePath[position]; erosion += Math.max(0, snapshot.bInit[cell] - snapshot.b[cell]);
    }
    return erosion;
  });
}

function localTerrainRoughness(snapshot, referencePath) {
  const included = new Uint8Array(snapshot.N * snapshot.N); let total = 0; let count = 0;
  for (const pathCell of referencePath) {
    const x = pathCell % snapshot.N; const y = (pathCell / snapshot.N) | 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const nx = x + ox; const ny = y + oy;
      if (nx < 1 || ny < 1 || nx >= snapshot.N - 1 || ny >= snapshot.N - 1) continue;
      const index = ny * snapshot.N + nx;
      if (included[index]) continue;
      included[index] = 1;
      let neighborTotal = 0;
      for (let direction = 0; direction < 8; direction++) neighborTotal += snapshot.b[(ny + d8y[direction]) * snapshot.N + nx + d8x[direction]];
      total += Math.abs(snapshot.b[index] - neighborTotal / 8); count++;
    }
  }
  return total / Math.max(count, 1);
}

function pitMetrics(snapshot) {
  let maxLocalPitDepth = 0; let positiveTotal = 0; let positiveCount = 0; let over01 = 0; let over05 = 0;
  for (let y = 0; y < snapshot.N; y++) for (let x = 0; x < snapshot.N; x++) {
    const index = y * snapshot.N + x; let minNeighborB = Infinity;
    for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction]; const ny = y + d8y[direction];
      if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N) minNeighborB = Math.min(minNeighborB, snapshot.b[ny * snapshot.N + nx]);
    }
    const localPitDepth = minNeighborB - snapshot.b[index];
    if (localPitDepth <= 0) continue;
    maxLocalPitDepth = Math.max(maxLocalPitDepth, localPitDepth); positiveTotal += localPitDepth; positiveCount++;
    if (localPitDepth > 0.1) over01++;
    if (localPitDepth > 0.5) over05++;
  }
  return { maxLocalPitDepth, meanPositivePitDepth: positiveTotal / Math.max(positiveCount, 1), cellsWithPitDepthOver0_1: over01, cellsWithPitDepthOver0_5: over05 };
}

function metrics(snapshot, referencePath) {
  const [mouth, mid, downstream] = [[0, 5], [6, 15], [16, referencePath.length - 1]].map(([start, end]) => {
    const rows = []; for (let position = start; position <= end; position++) rows.push(section(snapshot, referencePath, position));
    const mean = (key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    return { discharge: mean("sectionDischarge"), wetWidth: mean("wetWidth"), coherence: mean("directionalCoherence") };
  });
  const [nearErosion, midErosion, downstreamErosion] = erosionZones(snapshot, referencePath);
  return { nearErosion, midErosion, downstreamErosion, totalErosion: nearErosion + midErosion + downstreamErosion,
    mouthDischarge: mouth.discharge, midDischarge: mid.discharge, downstreamDischarge: downstream.discharge,
    downstreamVsMouth: downstream.discharge / Math.max(mouth.discharge, 1e-12),
    mouthWetWidth: mouth.wetWidth, midWetWidth: mid.wetWidth, downstreamWetWidth: downstream.wetWidth,
    mouthCoherence: mouth.coherence, midCoherence: mid.coherence, downstreamCoherence: downstream.coherence,
    localTerrainRoughness: localTerrainRoughness(snapshot, referencePath), ...pitMetrics(snapshot) };
}

function qualifies(candidate, current) {
  return candidate.downstreamDischarge > current.downstreamDischarge
    && candidate.downstreamWetWidth <= current.downstreamWetWidth
    && candidate.downstreamCoherence >= current.downstreamCoherence
    && candidate.downstreamErosion >= current.downstreamErosion
    && candidate.maxLocalPitDepth < current.maxLocalPitDepth
    && candidate.totalErosion >= current.totalErosion * 0.85;
}

function writeCapture(snapshot, variant, steps) {
  const outputDirectory = path.join(__dirname, "morphodynamic-stability-captures");
  fs.mkdirSync(outputDirectory, { recursive: true });
  let terrainMin = Infinity; let terrainMax = -Infinity;
  for (const elevation of snapshot.b) { terrainMin = Math.min(terrainMin, elevation); terrainMax = Math.max(terrainMax, elevation); }
  const pixels = Buffer.alloc(snapshot.N * snapshot.N * 3);
  for (let index = 0; index < snapshot.b.length; index++) {
    const terrain = Math.round(255 * (snapshot.b[index] - terrainMin) / Math.max(terrainMax - terrainMin, 1e-12));
    const water = Math.min(1, snapshot.d[index] * 20);
    pixels[index * 3] = Math.round(terrain * (1 - water));
    pixels[index * 3 + 1] = Math.round(terrain * (1 - water) + 130 * water);
    pixels[index * 3 + 2] = Math.round(terrain * (1 - water) + 255 * water);
  }
  const outputPath = path.join(outputDirectory, `${variant.replace(/[^A-Z0-9]+/g, "-")}-${steps}.ppm`);
  fs.writeFileSync(outputPath, Buffer.concat([Buffer.from(`P6\n${snapshot.N} ${snapshot.N}\n255\n`), pixels]));
  return path.relative(root, outputPath);
}

const referencePath = traceReferencePath(simulate(currentSource, 1000));
const variants = [{ name: "CURRENT", source: currentSource }, ...incidenceLimits.map((limit) => ({ name: `MAX_LOCAL_INCIDENCE ${limit}`, source: localIncisionSource(limit) }))];
const results = new Map();
for (const variant of variants) for (const steps of checkpoints) {
  const snapshot = simulate(variant.source, steps); const result = metrics(snapshot, referencePath);
  results.set(`${variant.name}:${steps}`, { snapshot, result });
}
for (const steps of checkpoints) {
  const current = results.get(`CURRENT:${steps}`).result;
  console.log(`\nMORPHODYNAMIC STABILITY | ${steps}`);
  console.table(variants.map(({ name }) => {
    const result = results.get(`${name}:${steps}`).result;
    return { steps, variant: name, ...result, erosionDeltaPercent: (result.totalErosion / Math.max(current.totalErosion, 1e-12) - 1) * 100,
      selectionCandidate: name !== "CURRENT" && qualifies(result, current) };
  }));
}
const current5000 = results.get("CURRENT:5000").result;
const ranking = variants.slice(1).map(({ name }) => ({ variant: name, ...results.get(`${name}:5000`).result,
  selectionCandidate: qualifies(results.get(`${name}:5000`).result, current5000) }))
  .sort((first, second) => (Number(second.selectionCandidate) - Number(first.selectionCandidate)) || (second.downstreamDischarge - first.downstreamDischarge));
console.log("\nRANKING 5000"); console.table(ranking);
const bestVariants = ranking.slice(0, 2);
if (process.argv.includes("--write-captures")) for (const { variant } of bestVariants) for (const steps of captureSteps) {
  console.log(`Capture written: ${writeCapture(results.get(`${variant}:${steps}`).snapshot, variant, steps)}`);
}
