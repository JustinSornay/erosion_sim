/*
 * Profiles erosion and sediment capacity along the dominant simulated flow
 * leaving one fixed source mouth. Usage: node tests/erosion-path-profile.js
 * [1000 5000 10000 20000]
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const scripts = [
  "js/core/config.js",
  "js/core/math.js",
  "js/core/state.js",
  "js/simulation/terrain.js",
  "js/simulation/simulation.js",
  "js/simulation/drainage.js",
];
const source = scripts.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const checkpoints = process.argv.slice(2).map(Number).filter(Number.isFinite);
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
  const sinSlopeMagnitude = slopeMagnitude / Math.sqrt(1 + slopeMagnitude * slopeMagnitude);
  const capacity = snapshot.KC * sinSlopeMagnitude * velocity * Math.min(1, snapshot.d[cell] * 4);
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
  let totalSaturation = 0;
  let maximumErosionPotential = 0;
  let maximumDischarge = 0;
  let totalSlopeMagnitude = 0;
  let totalFlowSlope = 0;
  let minimumTerrainDelta = Infinity;
  let minimumTerrainDeltaDistance = 0;
  for (let distance = 0; distance < cells.length; distance++) {
    const metric = measure(snapshot, cells, distance);
    maximumCapacity = Math.max(maximumCapacity, metric.C);
    totalSaturation += metric["s/C"];
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
    meanSC: totalSaturation / cells.length,
    maxCMinusS: maximumErosionPotential,
    qMax: maximumDischarge,
    meanSlopeMag: totalSlopeMagnitude / cells.length,
    meanFlowSlope: totalFlowSlope / cells.length,
    terrainDeltaMin: minimumTerrainDelta,
    terrainDeltaMinDistance: minimumTerrainDeltaDistance,
  };
}

for (const steps of checkpoints) {
  const snapshot = run(steps);
  const pathCells = tracePath(snapshot);
  console.log(`Erosion path profile after ${steps} steps; traced ${pathCells.length - 1} cells.`);
  console.table(distances.map((distance) => measure(snapshot, pathCells, distance)));
  console.table([summarize(snapshot, pathCells, steps)]);
}
