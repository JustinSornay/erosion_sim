/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Diagnoses whether rapid local alternation between hydraulic erosion and
 * deposition causes downstream degradation. All physics edits are injected
 * into an in-memory copy of CURRENT; production files remain read-only.
 *
 * RUN:
 * node tests/experiments/morphodynamics/exchange-decoupling-comparison.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/exchange-decoupling");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const checkpoints = [100, 500, 1000, 2500, 5000, 10000];
const equalityCheckpoints = [1000, 5000, 10000];
const intervals = [2, 4, 8, 16, 32];
const cooldowns = [1, 2, 4, 8];
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const wetThreshold = 1e-6;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);
function progress(message) { fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`); }
function mean(values) { return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1); }
function sum(values) { let total = 0; for (const value of values) total += value; return total; }
function percentile(values, fraction) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * fraction)]; }
function maxDifference(first, second) { let maximum = 0; for (let i = 0; i < first.length; i++) maximum = Math.max(maximum, Math.abs(first[i] - second[i])); return maximum; }

/** Returns an in-memory source whose exchange requests may be buffered. */
function exchangeSource({ mode = "CURRENT", interval = 1, cooldown = 0 }) {
  const instrumentation = `
let pendingErosion = new Float32Array(NN);
let pendingDeposition = new Float32Array(NN);
let requestedErosion = 0, appliedErosion = 0;
let requestedDeposition = 0, appliedDeposition = 0;
let localExchangeReversalCount = 0, totalExchangeEvents = 0;
let lastExchangeSign = new Int8Array(NN);
let lastExchangeStep = new Int32Array(NN);
let lastAppliedSign = new Int8Array(NN);
let lastAppliedStep = new Int32Array(NN);
let exchangeStep = 0;
function applyPendingErosion(i) {
  const amount = pendingErosion[i];
  if (amount <= 0) return;
  b[i] -= amount; s[i] += amount; pendingErosion[i] = 0; appliedErosion += amount;
  lastAppliedSign[i] = 1; lastAppliedStep[i] = exchangeStep;
}
function applyPendingDeposition(i) {
  const requested = pendingDeposition[i];
  if (requested <= 0) return;
  const amount = Math.min(requested, s[i]);
  if (amount <= 0) return;
  b[i] += amount; s[i] = Math.max(0, s[i] - amount); pendingDeposition[i] -= amount; appliedDeposition += amount;
  lastAppliedSign[i] = -1; lastAppliedStep[i] = exchangeStep;
}
function exchangeAllowed(sign) {
  ${mode === "ALTERNATING" ? `const phase = (exchangeStep - 1) % ${interval}; return sign === 1 ? phase < ${interval / 2} : phase >= ${interval / 2};` : "return true;"}
}
function cooldownAllows(i, sign) {
  ${mode === "HYSTERESIS" ? `return lastAppliedSign[i] === 0 || lastAppliedSign[i] === sign || exchangeStep - lastAppliedStep[i] > ${cooldown};` : "return true;"}
}
function flushExchange() {
  for (let i = 0; i < NN; i++) {
    if (${mode !== "EROSION_DELAY" || interval === 1 ? "true" : `(exchangeStep % ${interval}) === 0`} && exchangeAllowed(1) && cooldownAllows(i, 1)) applyPendingErosion(i);
    if (${mode !== "DEPOSITION_DELAY" || interval === 1 ? "true" : `(exchangeStep % ${interval}) === 0`} && exchangeAllowed(-1) && cooldownAllows(i, -1)) applyPendingDeposition(i);
  }
}
function pendingMagnitude(values) { let total = 0; for (let i = 0; i < NN; i++) total += values[i]; return total; }
`;
  let source = `${currentSource}\n${instrumentation}`;
  const erosion = mode === "NO_MORPH" || mode === "DEPOSITION_ONLY"
    ? ""
    : `requestedErosion += diff; pendingErosion[i] += diff; if (lastExchangeStep[i] === exchangeStep - 1 && lastExchangeSign[i] === -1) localExchangeReversalCount++; lastExchangeSign[i] = 1; lastExchangeStep[i] = exchangeStep; totalExchangeEvents++;`;
  const deposition = mode === "NO_MORPH" || mode === "EROSION_ONLY"
    ? ""
    : `requestedDeposition += diff; pendingDeposition[i] += diff; if (lastExchangeStep[i] === exchangeStep - 1 && lastExchangeSign[i] === 1) localExchangeReversalCount++; lastExchangeSign[i] = -1; lastExchangeStep[i] = exchangeStep; totalExchangeEvents++;`;
  source = source.replace(/const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, `const diff = KS * (C - si) * sourceProtectionMask[i];\n        ${erosion}`);
  source = source.replace(/const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, `const diff = KD * (si - C);\n        ${deposition}`);
  const exchangeEnd = /  \}\r?\n\r?\n  for \(let y = 0; y < N; y\+\+\) \{\r?\n    const row = y \* N;\r?\n    for \(let x = 0; x < N; x\+\+\) \{\r?\n      const i = row \+ x;\r?\n      let sx = x - \(u\[i\] \* DT\) \/ L,/;
  source = source.replace(exchangeEnd, `  }\n\n  exchangeStep++;\n  flushExchange();\n\n  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      let sx = x - (u[i] * DT) / L,`);
  if (!source.includes("flushExchange()")) throw new Error(`Exchange injection failed: ${mode}`);
  return source;
}

function simulate(source, maximumSteps, observe) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  return new Function("Math", "Float32Array", "Int32Array", "Int8Array", "Uint8Array", "observe", `${source}
    genTerrain();
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    const snapshot = () => ({ N, NN, b, bInit, d, u, v, s, source: sourcePoint, requestedErosion, appliedErosion, requestedDeposition, appliedDeposition, pendingErosionMagnitude: pendingMagnitude(pendingErosion), pendingDepositionMagnitude: pendingMagnitude(pendingDeposition), localExchangeReversalCount, totalExchangeEvents, reversalRate: localExchangeReversalCount / Math.max(totalExchangeEvents, 1) });
    observe(0, snapshot());
    for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); if (${JSON.stringify(checkpoints)}.includes(stepIndex) || stepIndex === 20000) observe(stepIndex, snapshot()); }
  `)(math, Float32Array, Int32Array, Int8Array, Uint8Array, observe);
}

function referenceFlowPath(snapshot) {
  const cells = []; const visited = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0];
  for (let position = 0; position < 41 && !visited[cell]; position++) {
    cells.push(cell); visited[cell] = 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; let next = -1; let projection = 0;
    for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const candidate = ny * snapshot.N + nx; const score = snapshot.u[cell] * dx + snapshot.v[cell] * dy; if (!visited[candidate] && score > projection) { projection = score; next = candidate; } }
    if (next < 0) break; cell = next;
  }
  return cells;
}
function section(snapshot, pathCells, position) {
  const cell = pathCells[position]; const before = pathCells[Math.max(0, position - 1)]; const after = pathCells[Math.min(pathCells.length - 1, position + 1)]; const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; const nx = -Math.sign(dy); const ny = Math.sign(dx); let discharge = 0; let wetWidth = 0; let magnitude = 0; let vectorU = 0; let vectorV = 0;
  for (let offset = -2; offset <= 2; offset++) { const sx = x + nx * offset; const sy = y + ny * offset; if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue; const i = sy * snapshot.N + sx; const speed = Math.hypot(snapshot.u[i], snapshot.v[i]); discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length); if (snapshot.d[i] > wetThreshold) wetWidth++; magnitude += snapshot.d[i] * speed; vectorU += snapshot.d[i] * snapshot.u[i]; vectorV += snapshot.d[i] * snapshot.v[i]; }
  return { discharge, wetWidth, coherence: Math.hypot(vectorU, vectorV) / Math.max(magnitude, 1e-12) };
}
function connectedWetCells(snapshot) {
  const visited = new Uint8Array(snapshot.NN); const queue = []; for (const i of [snapshot.source.y * snapshot.N + snapshot.source.x, ...snapshot.source.outletIndices]) if (snapshot.d[i] > wetThreshold && !visited[i]) { visited[i] = 1; queue.push(i); }
  for (let head = 0; head < queue.length; head++) { const i = queue[head]; const x = i % snapshot.N; const y = (i / snapshot.N) | 0; for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; const next = ny * snapshot.N + nx; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N && snapshot.d[next] > wetThreshold && !visited[next]) { visited[next] = 1; queue.push(next); } } }
  return queue.length;
}
function metrics(snapshot, pathCells) {
  const zones = [[0, 5], [6, 15], [16, pathCells.length - 1]].map(([start, end]) => { const rows = []; for (let p = start; p <= Math.min(end, pathCells.length - 1); p++) rows.push(section(snapshot, pathCells, p)); return { discharge: mean(rows.map((row) => row.discharge)), wetWidth: mean(rows.map((row) => row.wetWidth)), coherence: mean(rows.map((row) => row.coherence)) }; });
  const deposits = []; for (let i = 0; i < snapshot.NN; i++) deposits.push(Math.max(0, snapshot.b[i] - snapshot.bInit[i]));
  const conservation = { erosionResidual: snapshot.requestedErosion - snapshot.appliedErosion - snapshot.pendingErosionMagnitude, depositionResidual: snapshot.requestedDeposition - snapshot.appliedDeposition - snapshot.pendingDepositionMagnitude };
  return { mouthDischarge: zones[0].discharge, midDischarge: zones[1].discharge, downstreamDischarge: zones[2].discharge, downstreamVsMouth: zones[2].discharge / Math.max(zones[0].discharge, 1e-12), directionalCoherence: mean(zones.map((zone) => zone.coherence)), wetWidth: mean(zones.map((zone) => zone.wetWidth)), wetConnectedCellCount: connectedWetCells(snapshot), grossErosion: snapshot.appliedErosion, grossDeposition: snapshot.appliedDeposition, depositP99: percentile(deposits, .99), depositMax: Math.max(...deposits), pendingErosionMagnitude: snapshot.pendingErosionMagnitude, pendingDepositionMagnitude: snapshot.pendingDepositionMagnitude, requestedErosion: snapshot.requestedErosion, appliedErosion: snapshot.appliedErosion, requestedDeposition: snapshot.requestedDeposition, appliedDeposition: snapshot.appliedDeposition, conservation, exchangeSignFlips: snapshot.localExchangeReversalCount, totalExchangeEvents: snapshot.totalExchangeEvents, reversalRate: snapshot.reversalRate };
}
function runVariant(variant, maximumSteps, pathCells) {
  const rows = {}; const buffers = {};
  simulate(variant.source, maximumSteps, (step, snapshot) => { if (!checkpoints.includes(step) && step !== 20000) return; rows[step] = metrics(snapshot, pathCells); if (variant.interval === 1 && equalityCheckpoints.includes(step)) buffers[step] = Object.fromEntries(["b", "d", "s", "u", "v"].map((key) => [key, new Float32Array(snapshot[key])])); });
  return { ...variant, checkpoints: rows, buffers };
}
function differences(current, control) { return Object.fromEntries(equalityCheckpoints.map((step) => [step, Object.fromEntries(["b", "d", "s", "u", "v"].map((key) => [key, maxDifference(current.buffers[step][key], control.buffers[step][key])]))])); }
function exact(result) { return Object.values(result).every((row) => Object.values(row).every((value) => value === 0)); }
function candidate(run, current, noMorph) { return [5000, 10000].every((step) => { const row = run.checkpoints[step]; const baseline = current.checkpoints[step]; const gap = noMorph.checkpoints[step].downstreamDischarge - baseline.downstreamDischarge; const exchange = row.grossErosion + row.grossDeposition; const baselineExchange = baseline.grossErosion + baseline.grossDeposition; const pending = row.pendingErosionMagnitude + row.pendingDepositionMagnitude; const requested = row.requestedErosion + row.requestedDeposition; return row.downstreamDischarge >= baseline.downstreamDischarge * 2 && row.downstreamDischarge - baseline.downstreamDischarge >= gap * .5 && row.directionalCoherence >= baseline.directionalCoherence && exchange >= baselineExchange * .7 && exchange <= baselineExchange * 1.3 && pending / Math.max(requested, 1e-12) < .1; }); }
function classify(candidates) { const names = candidates.map((run) => run.name); if (names.some((name) => name.startsWith("DEPOSITION_DELAY"))) return "DECOUPLING A — delaying deposition preserves hydraulics"; if (names.some((name) => name.startsWith("EROSION_DELAY"))) return "DECOUPLING B — delaying erosion preserves hydraulics"; if (names.some((name) => name.startsWith("EXCHANGE_ALTERNATING") || name.startsWith("HYSTERESIS"))) return "DECOUPLING C — alternating/hysteresis preserves hydraulics"; return "DECOUPLING D — exchange timing is not the dominant mechanism"; }

function main() {
  const currentVariant = { name: "CURRENT", mode: "CURRENT", interval: 1, source: exchangeSource({}) };
  let reference; simulate(currentVariant.source, 1000, (step, snapshot) => { if (step === 1000) reference = { N: snapshot.N, NN: snapshot.NN, u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v), source: snapshot.source }; });
  const pathCells = referenceFlowPath(reference); if (!pathCells.length) throw new Error("CURRENT reference path is empty"); progress(`[reference path] ${pathCells.length} cells`);
  const variants = [currentVariant, { name: "ALL_ENABLED", mode: "CURRENT", interval: 1, source: exchangeSource({}) }, { name: "NO_MORPH", mode: "NO_MORPH", interval: 1, source: exchangeSource({ mode: "NO_MORPH" }) }, { name: "EROSION_ONLY", mode: "EROSION_ONLY", interval: 1, source: exchangeSource({ mode: "EROSION_ONLY" }) }, { name: "DEPOSITION_ONLY", mode: "DEPOSITION_ONLY", interval: 1, source: exchangeSource({ mode: "DEPOSITION_ONLY" }) }, { name: "DEPOSITION_DELAY interval=1", mode: "DEPOSITION_DELAY", interval: 1, source: exchangeSource({ mode: "DEPOSITION_DELAY", interval: 1 }) }, { name: "EROSION_DELAY interval=1", mode: "EROSION_DELAY", interval: 1, source: exchangeSource({ mode: "EROSION_DELAY", interval: 1 }) }];
  for (const interval of intervals) { variants.push({ name: `DEPOSITION_DELAY interval=${interval}`, mode: "DEPOSITION_DELAY", interval, source: exchangeSource({ mode: "DEPOSITION_DELAY", interval }) }); variants.push({ name: `EROSION_DELAY interval=${interval}`, mode: "EROSION_DELAY", interval, source: exchangeSource({ mode: "EROSION_DELAY", interval }) }); variants.push({ name: `EXCHANGE_ALTERNATING interval=${interval}`, mode: "ALTERNATING", interval, source: exchangeSource({ mode: "ALTERNATING", interval }) }); }
  for (const cooldown of cooldowns) variants.push({ name: `HYSTERESIS cooldown=${cooldown}`, mode: "HYSTERESIS", cooldown, interval: 1, source: exchangeSource({ mode: "HYSTERESIS", cooldown }) });
  const runs = []; for (const variant of variants) { progress(`[run] ${variant.name}`); runs.push(runVariant(variant, 10000, pathCells)); progress(`[completed] ${variant.name}`); }
  const byName = Object.fromEntries(runs.map((run) => [run.name, run])); const current = byName.CURRENT; const controls = { allEnabledEquality: differences(current, byName.ALL_ENABLED), depositionDelayInterval1: differences(current, byName["DEPOSITION_DELAY interval=1"]), erosionDelayInterval1: differences(current, byName["EROSION_DELAY interval=1"]) }; controls.passes = Object.values(controls).filter((item) => typeof item === "object").every(exact);
  if (!controls.passes) { const summary = { controls, failure: "Interval-1 equivalence failed; deferred comparison intentionally stopped.", failedAt: new Date().toISOString() }; fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); throw new Error(`Interval-1 control failed: ${JSON.stringify(controls)}`); }
  const conservationPasses = {}; for (const run of runs) conservationPasses[run.name] = Object.fromEntries(checkpoints.map((step) => { const row = run.checkpoints[step]; const tolerance = Math.max(1e-8, (row.requestedErosion + row.requestedDeposition) * 1e-5); return [step, { erosionResidual: row.conservation.erosionResidual, depositionResidual: row.conservation.depositionResidual, passes: Math.abs(row.conservation.erosionResidual) <= tolerance && Math.abs(row.conservation.depositionResidual) <= tolerance }]; }));
  const candidates = runs.slice(1).filter((run) => candidate(run, current, byName.NO_MORPH)); for (const run of candidates) { progress(`[candidate 20000] ${run.name}`); const longRun = runVariant(run, 20000, pathCells); run.checkpoints[20000] = longRun.checkpoints[20000]; }
  const conclusion = classify(candidates); const summary = { controls: { passes: true, ...controls }, checkpoints, referenceFlowPath: pathCells, currentReversalTrace: Object.fromEntries(checkpoints.map((step) => [step, { exchangeSignFlips: current.checkpoints[step].exchangeSignFlips, totalExchangeEvents: current.checkpoints[step].totalExchangeEvents, reversalRate: current.checkpoints[step].reversalRate }])), conservation: conservationPasses, candidates: candidates.map((run) => run.name), classification: conclusion, variants: runs.map(({ source, buffers, ...run }) => run), completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${conclusion}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${conclusion}`);
  console.log("Interval-1 and ALL_ENABLED controls: PASS"); console.table(runs.map((run) => ({ variant: run.name, discharge5000: run.checkpoints[5000].downstreamDischarge, discharge10000: run.checkpoints[10000].downstreamDischarge, reversalRate10000: run.checkpoints[10000].reversalRate, candidate: candidates.includes(run) }))); console.log(conclusion);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); throw error; }
