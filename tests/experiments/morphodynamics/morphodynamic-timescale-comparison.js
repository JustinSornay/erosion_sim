/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Tests whether batching bed/sediment exchange changes hydraulic degradation
 * without reducing total morphodynamic demand. Production simulation is read,
 * transformed in memory, and never modified.
 *
 * RUN:
 * node tests/experiments/morphodynamics/morphodynamic-timescale-comparison.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/morphodynamic-timescale");
const checkpoints = [1000, 2500, 5000, 10000];
const controlCheckpoints = new Set([1000, 5000, 10000]);
const intervals = [1, 2, 4, 8, 16, 32];
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

fs.mkdirSync(outputDirectory, { recursive: true });
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);

function writeProgress(message) { fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`); }
function sum(values) { let total = 0; for (const value of values) total += value; return total; }
function percentile(values, fraction) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * fraction)]; }
function maxAbsoluteDifference(first, second) { let maximum = 0; for (let i = 0; i < first.length; i++) maximum = Math.max(maximum, Math.abs(first[i] - second[i])); return maximum; }

/** Builds a benchmark-only step implementation with deferred morphodynamic exchange. */
function timescaleSource(mode, interval) {
  const instrumentation = `
let morphDelta = new Float32Array(NN);
let morphUpdateCount = 0;
let accumulatedMorphMagnitude = 0;
let maximumPendingMorphDelta = 0;
let terrainRemoved = 0;
let sedimentAdded = 0;
let terrainDeposited = 0;
let sedimentRemoved = 0;
function applyMorphDelta() {
  let hasDelta = false;
  for (let i = 0; i < NN; i++) if (morphDelta[i] !== 0) { hasDelta = true; b[i] += morphDelta[i]; ${mode === "FULL_MORPH_DELAY" ? "s[i] = Math.max(0, s[i] - morphDelta[i]);" : ""} morphDelta[i] = 0; }
  if (hasDelta) morphUpdateCount++;
}

`;
  let source = `${currentSource}\n${instrumentation}`;
  const erosion = interval === 1
    ? "accumulatedMorphMagnitude += Math.abs(diff); terrainRemoved += diff; sedimentAdded += diff; b[i] -= diff; s[i] = si + diff;"
    : mode === "BED_DELAY_ONLY"
    ? "morphDelta[i] -= diff; accumulatedMorphMagnitude += Math.abs(diff); terrainRemoved += diff; sedimentAdded += diff; s[i] = si + diff;"
    : "morphDelta[i] -= diff; accumulatedMorphMagnitude += Math.abs(diff); terrainRemoved += diff; sedimentAdded += diff;";
  const deposition = interval === 1
    ? "accumulatedMorphMagnitude += Math.abs(diff); terrainDeposited += diff; sedimentRemoved += diff; b[i] += diff; s[i] = Math.max(0, si - diff);"
    : mode === "BED_DELAY_ONLY"
    ? "morphDelta[i] += diff; accumulatedMorphMagnitude += Math.abs(diff); terrainDeposited += diff; sedimentRemoved += diff; s[i] = Math.max(0, si - diff);"
    : "morphDelta[i] += diff; accumulatedMorphMagnitude += Math.abs(diff); terrainDeposited += diff; sedimentRemoved += diff;";
  const fullSediment = mode === "FULL_MORPH_DELAY" && interval > 1 ? "const si = Math.max(0, s[i] - morphDelta[i]);" : "const si = s[i];";
  source = source.replace("const si = s[i];", fullSediment);
  source = source.replace(/b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, erosion);
  source = source.replace(/b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, deposition);
  const exchangeEnd = /  \}\r?\n\r?\n  for \(let y = 0; y < N; y\+\+\) \{\r?\n    const row = y \* N;\r?\n    for \(let x = 0; x < N; x\+\+\) \{\r?\n      const i = row \+ x;\r?\n      let sx = x - \(u\[i\] \* DT\) \/ L,/;
  const checkpoint = `  }

  let pendingMagnitude = 0;
  for (let i = 0; i < NN; i++) pendingMagnitude = Math.max(pendingMagnitude, Math.abs(morphDelta[i]));
  maximumPendingMorphDelta = Math.max(maximumPendingMorphDelta, pendingMagnitude);
  if ((steps + 1) % ${interval} === 0) applyMorphDelta();

  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      let sx = x - (u[i] * DT) / L,`;
  source = source.replace(exchangeEnd, checkpoint);
  if (source === `${currentSource}\n${instrumentation}` || !source.includes("applyMorphDelta()")) throw new Error(`Timescale injection failed for ${mode} interval ${interval}`);
  return source;
}

/** Adds observation fields only; exchange statements remain byte-for-byte production logic. */
function currentObservationSource() {
  return `${currentSource}
let morphUpdateCount = 0;
let accumulatedMorphMagnitude = 0;
let maximumPendingMorphDelta = 0;
let terrainRemoved = 0;
let sedimentAdded = 0;
let terrainDeposited = 0;
let sedimentRemoved = 0;`;
}

function simulate(source, maximumSteps, observe) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  return new Function("Math", "Float32Array", "Int32Array", "Uint8Array", "observe", `${source}
    genTerrain();
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    const snapshot = () => ({ N, NN, b, bInit, d, u, v, s, source: sourcePoint, morphUpdateCount, accumulatedMorphMagnitude, maximumPendingMorphDelta, terrainRemoved, sedimentAdded, terrainDeposited, sedimentRemoved });
    observe(0, snapshot());
    for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); if ([1000, 2500, 5000, 10000, 20000].includes(stepIndex)) observe(stepIndex, snapshot()); }
  `)(math, Float32Array, Int32Array, Uint8Array, observe);
}

/** Fixed once from CURRENT at 1000, preventing each variant from selecting an easier route. */
function referenceFlowPath(snapshot) {
  const cells = []; const visited = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0];
  for (let position = 0; position < 41 && !visited[cell]; position++) {
    cells.push(cell); visited[cell] = 1;
    const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; let next = -1; let projection = 0;
    for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; const candidate = ny * snapshot.N + nx; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N || visited[candidate]) continue; const score = snapshot.u[cell] * dx + snapshot.v[cell] * dy; if (score > projection) { projection = score; next = candidate; } }
    if (next < 0) break;
    cell = next;
  }
  return cells;
}

function section(snapshot, pathCells, position) {
  const cell = pathCells[position]; const before = pathCells[Math.max(0, position - 1)]; const after = pathCells[Math.min(pathCells.length - 1, position + 1)];
  const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1;
  const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; const normalX = -Math.sign(dy); const normalY = Math.sign(dx); let discharge = 0; let wetWidth = 0; let magnitude = 0; let vectorU = 0; let vectorV = 0;
  for (let offset = -2; offset <= 2; offset++) { const sx = x + normalX * offset; const sy = y + normalY * offset; if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue; const i = sy * snapshot.N + sx; const speed = Math.hypot(snapshot.u[i], snapshot.v[i]); discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length); if (snapshot.d[i] > 1e-6) wetWidth++; magnitude += snapshot.d[i] * speed; vectorU += snapshot.d[i] * snapshot.u[i]; vectorV += snapshot.d[i] * snapshot.v[i]; }
  return { discharge, wetWidth, coherence: Math.hypot(vectorU, vectorV) / Math.max(magnitude, 1e-12) };
}

function slopeStats(snapshot) {
  const slopes = []; let maxSlope = 0;
  for (let y = 0; y < snapshot.N; y++) for (let x = 0; x < snapshot.N; x++) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) { const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const slope = Math.abs(snapshot.b[y * snapshot.N + x] - snapshot.b[ny * snapshot.N + nx]) / Math.hypot(dx, dy); slopes.push(slope); maxSlope = Math.max(maxSlope, slope); }
  return { p95Slope: percentile(slopes, .95), p99Slope: percentile(slopes, .99), maxSlope };
}

function metrics(snapshot, pathCells) {
  const zones = [[0, 5], [6, 15], [16, pathCells.length - 1]].map(([start, end]) => { const rows = []; let erosion = 0; for (let position = start; position <= Math.min(end, pathCells.length - 1); position++) { rows.push(section(snapshot, pathCells, position)); const i = pathCells[position]; erosion += Math.max(0, snapshot.bInit[i] - snapshot.b[i]); } const mean = (key) => rows.reduce((total, row) => total + row[key], 0) / Math.max(rows.length, 1); return { erosion, discharge: mean("discharge"), wetWidth: mean("wetWidth"), coherence: mean("coherence") }; });
  let terrainDeltaMin = Infinity; for (let i = 0; i < snapshot.NN; i++) terrainDeltaMin = Math.min(terrainDeltaMin, snapshot.b[i] - snapshot.bInit[i]);
  return { nearErosion: zones[0].erosion, midErosion: zones[1].erosion, downstreamErosion: zones[2].erosion, totalErosion: zones.reduce((total, zone) => total + zone.erosion, 0), mouthDischarge: zones[0].discharge, midDischarge: zones[1].discharge, downstreamDischarge: zones[2].discharge, downstreamVsMouth: zones[2].discharge / Math.max(zones[0].discharge, 1e-12), wetWidth: zones.reduce((total, zone) => total + zone.wetWidth, 0) / 3, directionalCoherence: zones.reduce((total, zone) => total + zone.coherence, 0) / 3, ...slopeStats(snapshot), terrainDeltaMin, morphUpdateCount: snapshot.morphUpdateCount, accumulatedMorphMagnitude: snapshot.accumulatedMorphMagnitude, maximumPendingMorphDelta: snapshot.maximumPendingMorphDelta, conservation: { terrainRemoved: snapshot.terrainRemoved, sedimentAdded: snapshot.sedimentAdded, terrainDeposited: snapshot.terrainDeposited, sedimentRemoved: snapshot.sedimentRemoved, erosionExchangeResidual: snapshot.terrainRemoved - snapshot.sedimentAdded, depositionExchangeResidual: snapshot.terrainDeposited - snapshot.sedimentRemoved } };
}

function runVariant(variant, maximumSteps, pathCells) {
  const rows = {}; const buffers = {};
  simulate(variant.source, maximumSteps, (step, snapshot) => { if (!checkpoints.includes(step) && step !== 20000) return; rows[step] = metrics(snapshot, pathCells); if (variant.interval === 1 && controlCheckpoints.has(step)) buffers[step] = { b: new Float32Array(snapshot.b), d: new Float32Array(snapshot.d), s: new Float32Array(snapshot.s), u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v) }; });
  return { ...variant, checkpoints: rows, buffers };
}

function controlDifferences(current, control) { const differences = {}; for (const step of controlCheckpoints) differences[step] = ["b", "d", "s", "u", "v"].reduce((result, key) => ({ ...result, [key]: maxAbsoluteDifference(current.buffers[step][key], control.buffers[step][key]) }), {}); return differences; }
function degradedAt(run) { const baseline = run.checkpoints[1000]; for (const step of checkpoints.slice(1)) { const row = run.checkpoints[step]; if (row.downstreamDischarge < baseline.downstreamDischarge * .8 || row.directionalCoherence < baseline.directionalCoherence * .8) return step; } return null; }
function candidate(run, current) { return [5000, 10000].every((step) => { const row = run.checkpoints[step]; const baseline = current.checkpoints[step]; return row.downstreamDischarge > baseline.downstreamDischarge * 1.10 && row.downstreamVsMouth > baseline.downstreamVsMouth * 1.10 && row.directionalCoherence >= baseline.directionalCoherence && row.totalErosion >= baseline.totalErosion * .8 && row.totalErosion <= baseline.totalErosion * 1.2 && row.downstreamErosion >= baseline.downstreamErosion * .9; }); }
function conclude(candidates, variants, current) { if (candidates.length) return "TIMESCALE A — delaying bed feedback substantially preserves downstream hydraulics"; const delayed = variants.some((run) => run.hydraulicDegradationStep && current.hydraulicDegradationStep && run.hydraulicDegradationStep > current.hydraulicDegradationStep); return delayed ? "TIMESCALE B — delaying morphodynamics only delays the same failure without improving long-run morphology" : "TIMESCALE C — hydraulic degradation is insensitive to morphodynamic update frequency"; }

function main() {
  const currentVariant = { name: "CURRENT", mode: "CURRENT", interval: 1, source: currentObservationSource() };
  let referenceSnapshot;
  simulate(currentVariant.source, 1000, (step, snapshot) => { if (step === 1000) referenceSnapshot = { N: snapshot.N, NN: snapshot.NN, b: new Float32Array(snapshot.b), u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v), source: snapshot.source }; });
  const pathCells = referenceFlowPath(referenceSnapshot);
  writeProgress(`[reference path] ${pathCells.length} cells`);
  const current = runVariant(currentVariant, 10000, pathCells);
  const variants = [current];
  for (const mode of ["BED_DELAY_ONLY", "FULL_MORPH_DELAY"]) for (const interval of intervals) {
    const name = `${mode} interval=${interval}`;
    writeProgress(`[run] ${name}`);
    variants.push(runVariant({ name, mode, interval, source: timescaleSource(mode, interval) }, 10000, pathCells));
    writeProgress(`[completed] ${name}`);
  }
  const bedDelayControl = variants.find((run) => run.mode === "BED_DELAY_ONLY" && run.interval === 1);
  const fullDelayControl = variants.find((run) => run.mode === "FULL_MORPH_DELAY" && run.interval === 1);
  const bedDelayControlDifferences = controlDifferences(current, bedDelayControl);
  const fullDelayControlDifferences = controlDifferences(current, fullDelayControl);
  const bedDelayControlPasses = Object.values(bedDelayControlDifferences).every((row) => Object.values(row).every((difference) => difference === 0));
  if (!bedDelayControlPasses) throw new Error(`BED_DELAY_ONLY interval=1 differs from CURRENT: ${JSON.stringify(bedDelayControlDifferences)}`);
  for (const run of variants) { run.hydraulicDegradationStep = degradedAt(run); delete run.source; delete run.buffers; }
  const candidates = variants.slice(1).filter((run) => candidate(run, current));
  for (const run of candidates) { const longRun = runVariant({ ...run, source: timescaleSource(run.mode, run.interval) }, 20000, pathCells); run.checkpoints[20000] = longRun.checkpoints[20000]; }
  const conclusion = conclude(candidates, variants, current);
  const summary = { current, variants: variants.slice(1), candidates: candidates.map((run) => run.name), controls: { bedDelayOnlyInterval1: { passes: bedDelayControlPasses, maxAbsoluteDifference: bedDelayControlDifferences }, fullMorphDelayInterval1: { maxAbsoluteDifference: fullDelayControlDifferences } }, referenceFlowPath: pathCells, degradationRule: "first checkpoint after 1000 with downstreamDischarge or directionalCoherence below 80% of that variant's 1000 value", conclusion, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(completePath, `${conclusion}\ncompletedAt: ${summary.completedAt}\n`);
  writeProgress(`[complete] ${conclusion}`);
  console.table(variants.map((run) => ({ variant: run.name, degradation: run.hydraulicDegradationStep, discharge5000: run.checkpoints[5000].downstreamDischarge, discharge10000: run.checkpoints[10000].downstreamDischarge, candidate: candidates.includes(run) })));
}

try { main(); } catch (error) { writeProgress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
