/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Localises the terrain/sediment exchange region causally responsible for
 * downstream hydraulic degradation. This is a benchmark-only ablation: removed
 * exchange is intentionally not redistributed and production files stay read-only.
 *
 * RUN:
 * node tests/experiments/morphodynamics/spatial-morphology-ablation.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/spatial-morphology-ablation");
const checkpoints = [1000, 2500, 5000, 10000];
const equalityCheckpoints = [1000, 5000, 10000];
const corridorHalfWidth = 5;
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

fs.mkdirSync(outputDirectory, { recursive: true });
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);

function writeProgress(message) { fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`); }
function percentile(values, fraction) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * fraction)]; }
function maxAbsoluteDifference(first, second) { let maximum = 0; for (let i = 0; i < first.length; i++) maximum = Math.max(maximum, Math.abs(first[i] - second[i])); return maximum; }
function mean(rows, key) { return rows.reduce((total, row) => total + row[key], 0) / Math.max(rows.length, 1); }

/** Applies a binary benchmark mask after existing source-protection erosion logic. */
function ablationSource() {
  let source = currentSource;
  source = source.replace(
    /const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/,
    "const diff = KS * (C - si) * sourceProtectionMask[i];\n        if (morphologyMask[i]) { b[i] -= diff; s[i] = si + diff; }",
  );
  source = source.replace(
    /const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/,
    "const diff = KD * (si - C);\n        if (morphologyMask[i]) { b[i] += diff; s[i] = Math.max(0, si - diff); }",
  );
  if (!source.includes("if (morphologyMask[i])")) throw new Error("Morphology ablation injection failed");
  return source;
}

function simulate(source, morphologyMask, maximumSteps, observe) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  return new Function("Math", "Float32Array", "Int32Array", "Uint8Array", "morphologyMask", "observe", `${source}
    genTerrain();
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    const snapshot = () => ({ N, NN, b, bInit, d, u, v, s, source: sourcePoint });
    observe(0, snapshot());
    for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); if (${JSON.stringify(checkpoints)}.includes(stepIndex)) observe(stepIndex, snapshot()); }
  `)(math, Float32Array, Int32Array, Uint8Array, morphologyMask, observe);
}

/** Frozen from the realised CURRENT velocity field at step 1000. */
function referenceFlowPath(snapshot) {
  const cells = []; const visited = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0];
  for (let position = 0; position < 41 && !visited[cell]; position++) {
    cells.push(cell); visited[cell] = 1;
    const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; let next = -1; let projection = 0;
    for (const [dx, dy] of d8) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx; const score = snapshot.u[cell] * dx + snapshot.v[cell] * dy;
      if (!visited[candidate] && score > projection) { projection = score; next = candidate; }
    }
    if (next < 0) break;
    cell = next;
  }
  return cells;
}

/** Chebyshev-width corridor makes every path cell own a fixed 11 by 11 footprint. */
function corridorMask(N, pathCells, start = 0, end = pathCells.length - 1) {
  const mask = new Uint8Array(N * N);
  for (let position = Math.max(0, start); position <= Math.min(end, pathCells.length - 1); position++) {
    const cell = pathCells[position]; const cx = cell % N; const cy = (cell / N) | 0;
    for (let y = Math.max(0, cy - corridorHalfWidth); y <= Math.min(N - 1, cy + corridorHalfWidth); y++) {
      for (let x = Math.max(0, cx - corridorHalfWidth); x <= Math.min(N - 1, cx + corridorHalfWidth); x++) mask[y * N + x] = 1;
    }
  }
  return mask;
}

function unionMasks(...masks) { const result = new Uint8Array(masks[0].length); for (const mask of masks) for (let i = 0; i < result.length; i++) result[i] ||= mask[i]; return result; }
function complementMask(mask) { const result = new Uint8Array(mask.length); for (let i = 0; i < mask.length; i++) result[i] = mask[i] ? 0 : 1; return result; }
function enabledMask(size) { const mask = new Uint8Array(size); mask.fill(1); return mask; }

function section(snapshot, pathCells, position) {
  const cell = pathCells[position]; const before = pathCells[Math.max(0, position - 1)]; const after = pathCells[Math.min(pathCells.length - 1, position + 1)];
  const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1;
  const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; const normalX = -Math.sign(dy); const normalY = Math.sign(dx); let discharge = 0; let wetWidth = 0; let magnitude = 0; let vectorU = 0; let vectorV = 0;
  for (let offset = -2; offset <= 2; offset++) {
    const sx = x + normalX * offset; const sy = y + normalY * offset;
    if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue;
    const i = sy * snapshot.N + sx; const speed = Math.hypot(snapshot.u[i], snapshot.v[i]);
    discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length);
    if (snapshot.d[i] > 1e-6) wetWidth++;
    magnitude += snapshot.d[i] * speed; vectorU += snapshot.d[i] * snapshot.u[i]; vectorV += snapshot.d[i] * snapshot.v[i];
  }
  return { discharge, wetWidth, coherence: Math.hypot(vectorU, vectorV) / Math.max(magnitude, 1e-12) };
}

function slopeStats(snapshot) {
  const slopes = []; let maxSlope = 0;
  for (let y = 0; y < snapshot.N; y++) for (let x = 0; x < snapshot.N; x++) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
    const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
    const slope = Math.abs(snapshot.b[y * snapshot.N + x] - snapshot.b[ny * snapshot.N + nx]) / Math.hypot(dx, dy); slopes.push(slope); maxSlope = Math.max(maxSlope, slope);
  }
  return { p95Slope: percentile(slopes, .95), p99Slope: percentile(slopes, .99), maxSlope };
}

function metrics(snapshot, pathCells, morphologyMask) {
  const ranges = [[0, 5], [6, 15], [16, pathCells.length - 1]];
  const zones = ranges.map(([start, end]) => {
    const rows = []; let erosion = 0;
    for (let position = start; position <= Math.min(end, pathCells.length - 1); position++) { rows.push(section(snapshot, pathCells, position)); erosion += Math.max(0, snapshot.bInit[pathCells[position]] - snapshot.b[pathCells[position]]); }
    return { erosion, discharge: mean(rows, "discharge"), wetWidth: mean(rows, "wetWidth"), coherence: mean(rows, "coherence") };
  });
  let terrainDeltaMin = Infinity; let enabledCount = 0; let wetCount = 0; let enabledWetCount = 0;
  for (let i = 0; i < snapshot.NN; i++) { terrainDeltaMin = Math.min(terrainDeltaMin, snapshot.b[i] - snapshot.bInit[i]); enabledCount += morphologyMask[i]; if (snapshot.d[i] > 1e-6) { wetCount++; enabledWetCount += morphologyMask[i]; } }
  return { nearErosion: zones[0].erosion, midErosion: zones[1].erosion, downstreamErosion: zones[2].erosion, totalErosion: zones.reduce((total, zone) => total + zone.erosion, 0), mouthDischarge: zones[0].discharge, midDischarge: zones[1].discharge, downstreamDischarge: zones[2].discharge, downstreamVsMouth: zones[2].discharge / Math.max(zones[0].discharge, 1e-12), wetWidth: mean(zones, "wetWidth"), directionalCoherence: mean(zones, "coherence"), ...slopeStats(snapshot), terrainDeltaMin, enabledMorphCellFraction: enabledCount / snapshot.NN, enabledMorphWetCellFraction: enabledWetCount / Math.max(wetCount, 1) };
}

function runVariant(variant, source, pathCells) {
  const rows = {}; const buffers = {};
  simulate(source, variant.mask, 10000, (step, snapshot) => {
    if (!checkpoints.includes(step)) return;
    rows[step] = metrics(snapshot, pathCells, variant.mask);
    if (variant.name === "CURRENT" || variant.name === "ALL_ENABLED") buffers[step] = { b: new Float32Array(snapshot.b), d: new Float32Array(snapshot.d), s: new Float32Array(snapshot.s), u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v) };
  });
  return { name: variant.name, checkpoints: rows, buffers };
}

function controlDifferences(current, allEnabled) { const result = {}; for (const step of equalityCheckpoints) result[step] = Object.fromEntries(["b", "d", "s", "u", "v"].map((key) => [key, maxAbsoluteDifference(current.buffers[step][key], allEnabled.buffers[step][key])])); return result; }
/** Avoids presenting unstable causal ratios when the CURRENT/NO_EROSION gap is negligible. */
function recovery(variant, current, noErosion, step, key) {
  const currentValue = current.checkpoints[step][key]; const noErosionValue = noErosion.checkpoints[step][key];
  const denominator = noErosionValue - currentValue; const tolerance = Math.max(1e-12, Math.max(Math.abs(currentValue), Math.abs(noErosionValue)) * .01);
  return Math.abs(denominator) <= tolerance ? null : (variant.checkpoints[step][key] - currentValue) / denominator;
}
function retention(numerator, denominator) { return Math.abs(denominator) < 1e-12 ? null : numerator / denominator; }
function both(run, key, threshold) { return [5000, 10000].every((step) => run[key][step] !== null && run[key][step] >= threshold); }

function classify(runs) {
  const byName = Object.fromEntries(runs.map((run) => [run.name, run])); const singles = ["FREEZE_MOUTH", "FREEZE_MID", "FREEZE_DOWNSTREAM"];
  for (const [name, label] of [["FREEZE_MOUTH", "SPATIAL A — MOUTH DOMINANT"], ["FREEZE_MID", "SPATIAL B — MID DOMINANT"], ["FREEZE_DOWNSTREAM", "SPATIAL C — DOWNSTREAM DOMINANT"]]) {
    if (both(byName[name], "hydraulicRecovery", .5) && [5000, 10000].every((step) => singles.filter((other) => other !== name).every((other) => byName[name].hydraulicRecovery[step] >= byName[other].hydraulicRecovery[step] + .15))) return label;
  }
  if (both(byName.CORRIDOR_ONLY, "hydraulicRecovery", .7) && [5000, 10000].every((step) => byName.CORRIDOR_ONLY.hydraulicRecovery[step] > byName.OUTSIDE_CORRIDOR_ONLY.hydraulicRecovery[step] + .15)) return "SPATIAL E — OFF-PATH / GLOBAL";
  if (!singles.some((name) => both(byName[name], "hydraulicRecovery", .5)) && ["FREEZE_CORRIDOR", "FREEZE_MOUTH_MID", "FREEZE_MID_DOWNSTREAM"].some((name) => both(byName[name], "hydraulicRecovery", .7))) return "SPATIAL D — CORRIDOR-WIDE / DISTRIBUTED";
  return "SPATIAL F — NONLOCAL / INTERACTION";
}

function main() {
  let referenceSnapshot;
  simulate(currentSource, new Uint8Array(0), 1000, (step, snapshot) => { if (step === 1000) referenceSnapshot = { N: snapshot.N, NN: snapshot.NN, u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v), source: snapshot.source }; });
  const pathCells = referenceFlowPath(referenceSnapshot);
  if (!pathCells.length) throw new Error("Frozen reference path is empty");
  const allMask = enabledMask(referenceSnapshot.NN);
  const mouth = corridorMask(referenceSnapshot.N, pathCells, 0, 5); const mid = corridorMask(referenceSnapshot.N, pathCells, 6, 15); const downstream = corridorMask(referenceSnapshot.N, pathCells, 16); const corridor = corridorMask(referenceSnapshot.N, pathCells);
  const variants = [
    ["CURRENT", allMask, currentSource], ["ALL_ENABLED", allMask, ablationSource()], ["NO_EROSION", new Uint8Array(allMask.length), ablationSource()],
    ["FREEZE_MOUTH", complementMask(mouth)], ["FREEZE_MID", complementMask(mid)], ["FREEZE_DOWNSTREAM", complementMask(downstream)],
    ["FREEZE_MOUTH_MID", complementMask(unionMasks(mouth, mid))], ["FREEZE_MID_DOWNSTREAM", complementMask(unionMasks(mid, downstream))], ["FREEZE_CORRIDOR", complementMask(corridor)],
    ["ONLY_MOUTH", mouth], ["ONLY_MID", mid], ["ONLY_DOWNSTREAM", downstream], ["OUTSIDE_CORRIDOR_ONLY", complementMask(corridor)], ["CORRIDOR_ONLY", corridor],
  ].map(([name, mask, source = ablationSource()]) => ({ name, mask, source }));
  writeProgress(`[reference path] positions=${pathCells.length} corridorHalfWidth=${corridorHalfWidth}`);
  const runs = [];
  for (const variant of variants) { writeProgress(`[run] ${variant.name}`); runs.push(runVariant(variant, variant.source, pathCells)); writeProgress(`[completed] ${variant.name}`); }
  const current = runs.find((run) => run.name === "CURRENT"); const allEnabled = runs.find((run) => run.name === "ALL_ENABLED"); const noErosion = runs.find((run) => run.name === "NO_EROSION");
  const differences = controlDifferences(current, allEnabled); const controlPasses = Object.values(differences).every((checkpoint) => Object.values(checkpoint).every((difference) => difference === 0));
  if (!controlPasses) throw new Error(`ALL_ENABLED differs from CURRENT: ${JSON.stringify(differences)}`);
  for (const run of runs) {
    run.hydraulicRecovery = Object.fromEntries([5000, 10000].map((step) => [step, recovery(run, current, noErosion, step, "downstreamDischarge")]));
    run.coherenceRecovery = Object.fromEntries([5000, 10000].map((step) => [step, recovery(run, current, noErosion, step, "directionalCoherence")]));
    run.erosionRetention = Object.fromEntries([5000, 10000].map((step) => [step, retention(run.checkpoints[step].totalErosion, current.checkpoints[step].totalErosion)]));
    run.downstreamErosionRetention = Object.fromEntries([5000, 10000].map((step) => [step, retention(run.checkpoints[step].downstreamErosion, current.checkpoints[step].downstreamErosion)]));
    delete run.buffers;
  }
  const classification = classify(runs);
  const summary = { referenceFlowPath: pathCells, corridorHalfWidth, controls: { allEnabledEquality: { passes: controlPasses, maxAbsoluteDifference: differences }, noErosion: "morphologyMask=0 everywhere" }, variants: runs, recoveryDenominatorTolerance: "1% of the larger CURRENT/NO_EROSION metric magnitude, minimum 1e-12", classification, classificationRule: "A-C require >=50% discharge recovery at both causal checkpoints and >=15 percentage-point lead; D requires no single-zone result and >=70% corridor/combination recovery; E requires CORRIDOR_ONLY >=70% and >=15-point lead over OUTSIDE_CORRIDOR_ONLY; otherwise F.", completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(completePath, `classification: ${classification}\ncompletedAt: ${summary.completedAt}\n`);
  writeProgress(`[complete] ${classification}`);
  console.log(`Control ALL_ENABLED equality: ${controlPasses ? "PASS" : "FAIL"}`);
  for (const step of [5000, 10000]) console.table(runs.map((run) => ({ variant: run.name, downstreamDischarge: run.checkpoints[step].downstreamDischarge, hydraulicRecovery: run.hydraulicRecovery[step], coherence: run.checkpoints[step].directionalCoherence, coherenceRecovery: run.coherenceRecovery[step], totalErosion: run.checkpoints[step].totalErosion, erosionRetention: run.erosionRetention[step], downstreamErosion: run.checkpoints[step].downstreamErosion, downstreamErosionRetention: run.downstreamErosionRetention[step] })));
  console.log(`CLASSIFICATION: ${classification}`);
}

try { main(); } catch (error) { writeProgress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
