/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Profiles erosion and sediment capacity along dominant simulated flow paths.
 *
 * STATUS:
 * ACTIVE
 *
 * RESULT:
 * Provides supporting path-level observations.
 *
 * PRODUCTION:
 * Does not modify production physics.
 *
 * RUN:
 * node tests/diagnostics/erosion-path-profile.js [checkpoints]
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const scripts = [
  "js/core/config.js",
  "js/core/math.js",
  "js/core/state.js",
  "js/simulation/terrain.js",
  "js/simulation/simulation.js",
  "js/simulation/drainage.js",
];
const magnitudeSource = scripts.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const hybridArgument = process.argv.find((argument) => argument.startsWith("--hybrid="));
const hybridFactor = hybridArgument ? Number(hybridArgument.slice("--hybrid=".length)) : null;
if (hybridArgument && (!Number.isFinite(hybridFactor) || hybridFactor < 0 || hybridFactor > 1)) throw new Error("--hybrid requires a factor in [0, 1]");
const source = hybridFactor === null ? magnitudeSource : magnitudeSource.replace(
  "const sinA = slope / Math.sqrt(1 + slope * slope);",
  `let alignment = 0; if (slope > 1e-6 && vel > 1e-6) alignment = Math.max(0, Math.min(1, -(dzx * ui + dzy * vi) / (slope * vel))); const effectiveSlope = slope * (${hybridFactor} + ${(1 - hybridFactor)} * alignment); const sinA = effectiveSlope / Math.sqrt(1 + effectiveSlope * effectiveSlope);`,
);
const checkpoints = process.argv.slice(2).filter((argument) => !argument.startsWith("--")).map(Number).filter(Number.isFinite);
if (checkpoints.length === 0) checkpoints.push(1000, 5000, 10000, 20000);
const distances = [0, 2, 4, 6, 8, 12, 16, 24, 32];
const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
const dy = [-1, -1, -1, 0, 0, 1, 1, 1];

function run(steps) {
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.3141592653;
  const simulate = new Function(
    "Math", "Float32Array", "Int32Array", "Uint8Array",
    `${source}
      genTerrain();
      const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
      configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
      for (let stepIndex = 0; stepIndex < ${steps}; stepIndex++) step();
      return { N, L, KC, b, bInit, d, u, v, s, sourceProtectionMask, source };`,
  );
  return simulate(deterministicMath, Float32Array, Int32Array, Uint8Array);
}

function tracePath(snapshot) {
  const start = snapshot.source.outletIndices[0];
  const cells = [start];
  let cell = start;
  for (let distance = 1; distance <= 32; distance++) {
    const x = cell % snapshot.N;
    const y = (cell / snapshot.N) | 0;
    const velocity = Math.hypot(snapshot.u[cell], snapshot.v[cell]);
    let next = -1;
    let bestAlignment = 0;
    for (let direction = 0; direction < 8; direction++) {
      const nx = x + dx[direction];
      const ny = y + dy[direction];
      if (nx < 0 || nx >= snapshot.N || ny < 0 || ny >= snapshot.N) continue;
      const alignment = (snapshot.u[cell] * dx[direction] + snapshot.v[cell] * dy[direction]) / Math.max(velocity, 1e-6);
      if (alignment > bestAlignment) { bestAlignment = alignment; next = ny * snapshot.N + nx; }
    }
    if (next < 0 || cells.includes(next)) break;
    cells.push(next);
    cell = next;
  }
  return cells;
}

function measure(snapshot, cells, distance) {
  const sampledDistance = Math.min(distance, cells.length - 1);
  const cell = cells[sampledDistance];
  const x = cell % snapshot.N;
  const y = (cell / snapshot.N) | 0;
  const left = x > 0 ? snapshot.b[cell - 1] : snapshot.b[cell];
  const right = x < snapshot.N - 1 ? snapshot.b[cell + 1] : snapshot.b[cell];
  const top = y > 0 ? snapshot.b[cell - snapshot.N] : snapshot.b[cell];
  const bottom = y < snapshot.N - 1 ? snapshot.b[cell + snapshot.N] : snapshot.b[cell];
  const dzx = (right - left) * 0.5;
  const dzy = (bottom - top) * 0.5;
  const velocity = Math.hypot(snapshot.u[cell], snapshot.v[cell]);
  const slopeMagnitude = Math.hypot(dzx, dzy);
  const flowSlope = Math.max(0, -(dzx * snapshot.u[cell] + dzy * snapshot.v[cell]) / Math.max(velocity, 1e-6));
  let alignment = 0;
  if (slopeMagnitude > 1e-6 && velocity > 1e-6) alignment = Math.max(0, Math.min(1, -(dzx * snapshot.u[cell] + dzy * snapshot.v[cell]) / (slopeMagnitude * velocity)));
  const effectiveSlope = hybridFactor === null ? slopeMagnitude : slopeMagnitude * (hybridFactor + (1 - hybridFactor) * alignment);
  const sinEffectiveSlope = effectiveSlope / Math.sqrt(1 + effectiveSlope * effectiveSlope);
  const capacity = snapshot.KC * sinEffectiveSlope * velocity * Math.min(1, snapshot.d[cell] * 4);
  const sediment = snapshot.s[cell];
  return {
    distance: sampledDistance, d: snapshot.d[cell], vel: velocity, q: snapshot.d[cell] * velocity,
    slopeMag: slopeMagnitude, flowSlope, C: capacity, s: sediment,
    "s/C": sediment / Math.max(capacity, 1e-9), "C-s": Math.max(0, capacity - sediment),
    terrainDelta: snapshot.b[cell] - snapshot.bInit[cell], protection: snapshot.sourceProtectionMask[cell],
  };
}

function summarize(snapshot, cells, steps) {
  let maximumCapacity = 0;
  const saturations = [];
  let maximumErosionPotential = 0;
  let maximumDischarge = 0;
  let totalSlopeMagnitude = 0;
  let totalFlowSlope = 0;
  let minimumTerrainDelta = Infinity;
  let minimumTerrainDeltaDistance = 0;
  for (let distance = 0; distance < cells.length; distance++) {
    const metric = measure(snapshot, cells, distance);
    maximumCapacity = Math.max(maximumCapacity, metric.C);
    if (metric.C > 1e-6) saturations.push(metric["s/C"]);
    maximumErosionPotential = Math.max(maximumErosionPotential, metric["C-s"]);
    maximumDischarge = Math.max(maximumDischarge, metric.q);
    totalSlopeMagnitude += metric.slopeMag;
    totalFlowSlope += metric.flowSlope;
    if (metric.terrainDelta < minimumTerrainDelta) {
      minimumTerrainDelta = metric.terrainDelta;
      minimumTerrainDeltaDistance = distance;
    }
  }
  return {
    steps,
    Cmax: maximumCapacity,
    activeCapacitySamples: saturations.length,
    zeroCapacityFraction: 1 - saturations.length / cells.length,
    p25SC: percentile(saturations, 0.25),
    medianSC: percentile(saturations, 0.5),
    p75SC: percentile(saturations, 0.75),
    maxCMinusS: maximumErosionPotential,
    qMax: maximumDischarge,
    meanSlopeMag: totalSlopeMagnitude / cells.length,
    meanFlowSlope: totalFlowSlope / cells.length,
    terrainDeltaMin: minimumTerrainDelta,
    terrainDeltaMinDistance: minimumTerrainDeltaDistance,
  };
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor((sorted.length - 1) * quantile)];
}

let referenceFlowPath;
for (const steps of checkpoints) {
  const snapshot = run(steps);
  const dynamicFlowPath = tracePath(snapshot);
  if (!referenceFlowPath || steps <= 1000) referenceFlowPath = dynamicFlowPath;
  const pathCells = referenceFlowPath;
  console.log(`Erosion path profile (${hybridFactor === null ? "MAGNITUDE" : `HYBRID ${hybridFactor}`}) after ${steps} steps; traced ${pathCells.length - 1} cells.`);
  console.table(distances.map((distance) => measure(snapshot, pathCells, distance)));
  console.table([summarize(snapshot, pathCells, steps)]);
  console.log(`Dynamic path length: ${dynamicFlowPath.length - 1}; reference path length: ${referenceFlowPath.length - 1}.`);
}
