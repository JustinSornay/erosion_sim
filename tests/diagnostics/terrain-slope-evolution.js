/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Diagnoses terrain-slope evolution beyond initial deterministic terrain envelope.
 *
 * STATUS:
 * ACTIVE
 *
 * RESULT:
 * Pending diagnostic result.
 *
 * PRODUCTION:
 * Does not modify production physics.
 *
 * RUN:
 * node tests/diagnostics/terrain-slope-evolution.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const checkpoints = [0, 500, 1000, 2500, 5000, 10000, 20000];
const edges = [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2]];
const directions = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))];
}

function distribution(values) {
  let total = 0; let maximum = -Infinity;
  for (const value of values) { total += value; maximum = Math.max(maximum, value); }
  return { meanSlope: total / Math.max(values.length, 1), medianSlope: percentile(values, .5), p90: percentile(values, .9), p95: percentile(values, .95), p99: percentile(values, .99), p99_9: percentile(values, .999), maxSlope: values.length ? maximum : null, edges: values.length };
}

/** Each undirected D8 edge occurs once: right, bottom, and both downward diagonals. */
function edgeSlopes(snapshot, cellMask) {
  const values = []; const downhill = [];
  for (let y = 0; y < snapshot.N; y++) for (let x = 0; x < snapshot.N; x++) {
    const i = y * snapshot.N + x;
    for (const [dx, dy, distance] of edges) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const j = ny * snapshot.N + nx;
      if (cellMask && (!cellMask[i] || !cellMask[j])) continue;
      const drop = snapshot.b[i] - snapshot.b[j];
      const slope = Math.abs(drop) / distance;
      values.push(slope);
      // On an undirected edge, the positive downhill drop is high-to-low.
      if (drop !== 0) downhill.push(slope);
    }
  }
  return { absolute: distribution(values), positiveDownhill: distribution(downhill) };
}

function traceReferencePath(snapshot, maximum = 41) {
  const result = []; const visited = new Uint8Array(snapshot.N * snapshot.N); let index = snapshot.source.outletIndices[0];
  for (let position = 0; position < maximum && !visited[index]; position++) {
    result.push(index); visited[index] = 1;
    const x = index % snapshot.N; const y = (index / snapshot.N) | 0; let next = -1; let projection = 0;
    for (const [dx, dy] of directions) {
      const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidateProjection = snapshot.u[index] * dx + snapshot.v[index] * dy;
      if (!visited[ny * snapshot.N + nx] && candidateProjection > projection) { projection = candidateProjection; next = ny * snapshot.N + nx; }
    }
    if (next < 0) for (const [dx, dy] of directions) {
      const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx;
      if (!visited[candidate] && snapshot.b[candidate] < snapshot.b[index] && (next < 0 || snapshot.b[candidate] < snapshot.b[next])) next = candidate;
    }
    if (next < 0) break;
    index = next;
  }
  return result;
}

function corridorMask(snapshot, referencePath, start, end, halfWidth = 5) {
  const mask = new Uint8Array(snapshot.N * snapshot.N);
  for (let position = start; position <= Math.min(end, referencePath.length - 1); position++) {
    const cell = referencePath[position]; const before = referencePath[Math.max(0, position - 1)]; const after = referencePath[Math.min(referencePath.length - 1, position + 1)];
    const dx = Math.sign((after % snapshot.N) - (before % snapshot.N)); const dy = Math.sign(((after / snapshot.N) | 0) - ((before / snapshot.N) | 0));
    const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0;
    for (let offset = -halfWidth; offset <= halfWidth; offset++) {
      const nx = x - dy * offset; const ny = y + dx * offset;
      if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N) mask[ny * snapshot.N + nx] = 1;
    }
  }
  return mask;
}

function sourceDistanceMask(snapshot, minimum, maximum) {
  const mask = new Uint8Array(snapshot.N * snapshot.N);
  for (let y = 0; y < snapshot.N; y++) for (let x = 0; x < snapshot.N; x++) {
    const distance = Math.hypot(x - snapshot.source.x, y - snapshot.source.y);
    if (distance >= minimum && distance <= maximum) mask[y * snapshot.N + x] = 1;
  }
  return mask;
}

function section(snapshot, referencePath, position) {
  const cell = referencePath[position]; const before = referencePath[Math.max(0, position - 1)]; const after = referencePath[Math.min(referencePath.length - 1, position + 1)];
  const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1;
  const normalX = -Math.sign(dy); const normalY = Math.sign(dx); const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0;
  let sectionDischarge = 0; let wetWidth = 0; let magnitude = 0; let vectorU = 0; let vectorV = 0;
  for (let offset = -2; offset <= 2; offset++) {
    const nx = x + normalX * offset; const ny = y + normalY * offset; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
    const i = ny * snapshot.N + nx; const speed = Math.hypot(snapshot.u[i], snapshot.v[i]);
    sectionDischarge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length);
    wetWidth += snapshot.d[i] > 1e-6 ? 1 : 0; magnitude += snapshot.d[i] * speed; vectorU += snapshot.d[i] * snapshot.u[i]; vectorV += snapshot.d[i] * snapshot.v[i];
  }
  return { sectionDischarge, wetWidth, directionalCoherence: Math.hypot(vectorU, vectorV) / Math.max(magnitude, 1e-12) };
}

function observe(snapshot, referencePath, initial) {
  const global = edgeSlopes(snapshot); const result = { globalAbsolute: global.absolute, globalPositiveDownhill: global.positiveDownhill };
  result.p99VsInitial = global.absolute.p99 / Math.max(initial.p99, 1e-12); result.maxVsInitial = global.absolute.maxSlope / Math.max(initial.maxSlope, 1e-12);
  for (const [name, start, end] of [["MOUTH", 0, 5], ["MID", 6, 15], ["DOWNSTREAM", 16, referencePath.length - 1]]) {
    const slopes = edgeSlopes(snapshot, corridorMask(snapshot, referencePath, start, end)).absolute;
    const values = []; for (let position = start; position <= Math.min(end, referencePath.length - 1); position++) values.push(section(snapshot, referencePath, position));
    const mean = (key) => values.reduce((sum, value) => sum + value[key], 0) / Math.max(values.length, 1);
    result[name] = { p95Slope: slopes.p95, p99Slope: slopes.p99, maxSlope: slopes.maxSlope, sectionDischarge: mean("sectionDischarge"), wetWidth: mean("wetWidth"), directionalCoherence: mean("directionalCoherence") };
  }
  for (const [name, minimum, maximum] of [["SOURCE_0_5", 0, 5], ["SOURCE_6_10", 6, 10], ["SOURCE_11_20", 11, 20], ["SOURCE_21_40", 21, 40]]) result[name] = edgeSlopes(snapshot, sourceDistanceMask(snapshot, minimum, maximum)).absolute;
  return result;
}

function run(steps, observer) {
  const math = Object.create(Math); math.random = () => .3141592653;
  return new Function("Math", "Float32Array", "Int32Array", "Uint8Array", "observe", `${currentSource}
    genTerrain(); const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
    const snapshot = () => ({ N, b, bInit, d, u, v, source }); observe(0, snapshot());
    for (let stepIndex = 1; stepIndex <= ${steps}; stepIndex++) { step(); if ([500, 1000, 2500, 5000, 10000, 20000].includes(stepIndex)) observe(stepIndex, snapshot()); }
  `)(math, Float32Array, Int32Array, Uint8Array, observer);
}

const referenceSnapshot = (() => { let value; run(1000, (step, snapshot) => { if (step === 1000) value = { ...snapshot, b: new Float32Array(snapshot.b), d: new Float32Array(snapshot.d), u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v) }; }); return value; })();
const referencePath = traceReferencePath(referenceSnapshot);
const reports = [];
let initial;
run(20000, (step, snapshot) => { if (step === 0) initial = edgeSlopes(snapshot).absolute; reports.push({ step, ...observe(snapshot, referencePath, initial) }); });

console.log("TERRAIN SLOPE EVOLUTION | GLOBAL");
console.table(reports.map(({ step, globalAbsolute, globalPositiveDownhill, p99VsInitial, maxVsInitial }) => ({ step, ...globalAbsolute, downhillMeanSlope: globalPositiveDownhill.meanSlope, downhillP99: globalPositiveDownhill.p99, downhillMaxSlope: globalPositiveDownhill.maxSlope, p99VsInitial, maxVsInitial })));
console.log("INITIAL TERRAIN ENVELOPE"); console.table([initial]);
for (const zone of ["MOUTH", "MID", "DOWNSTREAM"]) { console.log(`CHANNEL CORRIDOR WIDTH 5 | ${zone}`); console.table(reports.map(({ step, [zone]: values }) => ({ step, ...values }))); }
for (const band of ["SOURCE_0_5", "SOURCE_6_10", "SOURCE_11_20", "SOURCE_21_40"]) { console.log(`SOURCE DISTANCE | ${band}`); console.table(reports.map(({ step, [band]: values }) => ({ step, ...values }))); }
console.log("HYDRAULIC / SLOPE CORRELATION"); console.table(reports.flatMap(({ step, MOUTH, MID, DOWNSTREAM }) => [["MOUTH", MOUTH], ["MID", MID], ["DOWNSTREAM", DOWNSTREAM]].map(([sectionName, values]) => ({ step, section: sectionName, meanSlope: values.p95Slope, p99Slope: values.p99Slope, maxSlope: values.maxSlope, sectionDischarge: values.sectionDischarge, wetWidth: values.wetWidth, directionalCoherence: values.directionalCoherence }))));
