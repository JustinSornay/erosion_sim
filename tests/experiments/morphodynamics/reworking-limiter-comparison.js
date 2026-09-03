/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Causally ablates only exchange opposite to a cell's cumulative bed-change
 * history. Production physics is loaded unchanged and modified in memory.
 *
 * RUN:
 * node tests/experiments/morphodynamics/reworking-limiter-comparison.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/reworking-limiter");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const checkpoints = Array.from({ length: 40 }, (_, index) => (index + 1) * 250);
const equalityCheckpoints = [1000, 5000, 10000];
const candidateCheckpoints = [5000, 10000];
const reworkRatios = [0, .05, .10, .20, .40, .80];
const netChanges = [.001, .005, .01, .02];
const epsilon = 1e-12;
const wetThreshold = 1e-6;
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);
function progress(message) { fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`); }
function mean(values) { return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1); }
function maxDifference(first, second) { let maximum = 0; for (let i = 0; i < first.length; i++) maximum = Math.max(maximum, Math.abs(first[i] - second[i])); return maximum; }

/**
 * Inserts counters beside the two direct bed exchanges. REWORK_CAP permits
 * same-direction exchange freely and constrains only its opposite cumulative
 * counterpart; NET_SIGN_HYSTERESIS accepts an opposite exchange only when it
 * clears the configured net-sign dead band.
 */
function instrumentedSource({ mode = "CURRENT", reworkRatio = null, minNetChange = null }) {
  const enabledErosion = mode !== "NO_MORPH" && mode !== "DEPOSITION_ONLY";
  const enabledDeposition = mode !== "NO_MORPH" && mode !== "EROSION_ONLY";
  const limiter = reworkRatio !== null ? "REWORK_CAP" : minNetChange !== null ? "NET_SIGN_HYSTERESIS" : "LIMITER_OFF";
  const state = `
let cumulativeErosion = new Float64Array(NN);
let cumulativeDeposition = new Float64Array(NN);
let requestedErosion = 0, appliedErosion = 0, rejectedErosion = 0;
let requestedDeposition = 0, appliedDeposition = 0, rejectedDeposition = 0;
function applyErosion(i, requested, sediment) {
  requestedErosion += requested;
  let applied = requested;
  const net = cumulativeErosion[i] - cumulativeDeposition[i];
  if ("${limiter}" === "REWORK_CAP" && net < 0) {
    const maximumErosion = (${reworkRatio}) * cumulativeDeposition[i] / (2 + (${reworkRatio}));
    applied = Math.min(requested, Math.max(0, maximumErosion - cumulativeErosion[i]));
  }
  if ("${limiter}" === "NET_SIGN_HYSTERESIS" && net < 0 && cumulativeErosion[i] + requested < cumulativeDeposition[i] + (${minNetChange})) applied = 0;
  rejectedErosion += requested - applied;
  cumulativeErosion[i] += applied; appliedErosion += applied;
  b[i] -= applied; s[i] = sediment + applied;
}
function applyDeposition(i, requested, sediment) {
  requestedDeposition += requested;
  let applied = requested;
  const net = cumulativeErosion[i] - cumulativeDeposition[i];
  if ("${limiter}" === "REWORK_CAP" && net > 0) {
    const maximumDeposition = (${reworkRatio}) * cumulativeErosion[i] / (2 + (${reworkRatio}));
    applied = Math.min(requested, Math.max(0, maximumDeposition - cumulativeDeposition[i]));
  }
  if ("${limiter}" === "NET_SIGN_HYSTERESIS" && net > 0 && cumulativeDeposition[i] + requested < cumulativeErosion[i] + (${minNetChange})) applied = 0;
  rejectedDeposition += requested - applied;
  cumulativeDeposition[i] += applied; appliedDeposition += applied;
  b[i] += applied; s[i] = Math.max(0, sediment - applied);
}
`;
  let source = `${currentSource}\n${state}`;
  const erosion = enabledErosion ? "applyErosion(i, diff, si);" : "";
  const deposition = enabledDeposition ? "applyDeposition(i, diff, si);" : "";
  source = source.replace(/const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, `const diff = KS * (C - si) * sourceProtectionMask[i];\n        ${erosion}`);
  source = source.replace(/const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, `const diff = KD * (si - C);\n        ${deposition}`);
  if (!source.includes("let cumulativeErosion = new Float64Array(NN)")) throw new Error(`Instrumentation injection failed: ${mode}/${limiter}`);
  return source;
}

function simulate(source, maximumSteps, observe) {
  const math = Object.create(Math); math.random = () => .3141592653;
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", `${source}
    genTerrain();
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    const snapshot = () => ({ N, NN, b, bInit, d, s, u, v, source: sourcePoint, cumulativeErosion, cumulativeDeposition, requestedErosion, appliedErosion, rejectedErosion, requestedDeposition, appliedDeposition, rejectedDeposition });
    for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); if (${JSON.stringify(checkpoints)}.includes(stepIndex) || stepIndex === 20000) observe(stepIndex, snapshot()); }
  `)(math, Float32Array, Float64Array, Int32Array, Uint8Array, observe);
}

/** Frozen CURRENT@1000 centreline keeps hydraulic sections comparable. */
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
  const cell = pathCells[Math.min(position, pathCells.length - 1)]; const before = pathCells[Math.max(0, position - 1)]; const after = pathCells[Math.min(pathCells.length - 1, position + 1)]; const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; const normalX = -Math.sign(dy); const normalY = Math.sign(dx); let discharge = 0; let magnitude = 0; let vectorU = 0; let vectorV = 0;
  for (let offset = -2; offset <= 2; offset++) { const sx = x + normalX * offset; const sy = y + normalY * offset; if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue; const i = sy * snapshot.N + sx; const speed = Math.hypot(snapshot.u[i], snapshot.v[i]); discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length); magnitude += snapshot.d[i] * speed; vectorU += snapshot.d[i] * snapshot.u[i]; vectorV += snapshot.d[i] * snapshot.v[i]; }
  return { discharge, coherence: Math.hypot(vectorU, vectorV) / Math.max(magnitude, epsilon) };
}
function connectedWetCells(snapshot) { const visited = new Uint8Array(snapshot.NN); const queue = []; for (const i of [snapshot.source.y * snapshot.N + snapshot.source.x, ...snapshot.source.outletIndices]) if (snapshot.d[i] > wetThreshold && !visited[i]) { visited[i] = 1; queue.push(i); } for (let head = 0; head < queue.length; head++) { const i = queue[head]; const x = i % snapshot.N; const y = (i / snapshot.N) | 0; for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; const next = ny * snapshot.N + nx; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N && snapshot.d[next] > wetThreshold && !visited[next]) { visited[next] = 1; queue.push(next); } } } return queue.length; }
function turnoverMetrics(snapshot) {
  let grossErosion = 0; let grossDeposition = 0; let absoluteNetBedChange = 0; let bothCells = 0; let threshold2 = 0; let threshold5 = 0; let threshold10 = 0; let threshold50 = 0;
  for (let i = 0; i < snapshot.NN; i++) { const erosion = snapshot.cumulativeErosion[i]; const deposition = snapshot.cumulativeDeposition[i]; const turnover = erosion + deposition; const net = Math.abs(erosion - deposition); grossErosion += erosion; grossDeposition += deposition; absoluteNetBedChange += net; if (erosion > 0 && deposition > 0) bothCells++; const ratio = turnover / Math.max(net, epsilon); if (ratio >= 2) threshold2 += turnover; if (ratio >= 5) threshold5 += turnover; if (ratio >= 10) threshold10 += turnover; if (ratio >= 50) threshold50 += turnover; }
  const grossTurnover = grossErosion + grossDeposition; const reworkedAmount = Math.max(0, grossTurnover - absoluteNetBedChange); return { grossErosion, grossDeposition, grossTurnover, absoluteNetBedChange, reworkedAmount, reworkedFraction: reworkedAmount / Math.max(grossTurnover, epsilon), bothExchangeCellFraction: bothCells / snapshot.NN, grossTurnoverFractionLocalRatioAtLeast2: threshold2 / Math.max(grossTurnover, epsilon), grossTurnoverFractionLocalRatioAtLeast5: threshold5 / Math.max(grossTurnover, epsilon), grossTurnoverFractionLocalRatioAtLeast10: threshold10 / Math.max(grossTurnover, epsilon), grossTurnoverFractionLocalRatioAtLeast50: threshold50 / Math.max(grossTurnover, epsilon) };
}
function hydraulicMetrics(snapshot, pathCells) { const zones = [[0, 5], [6, 15], [16, pathCells.length - 1]].map(([start, end]) => { const rows = []; for (let p = start; p <= Math.min(end, pathCells.length - 1); p++) rows.push(section(snapshot, pathCells, p)); return { discharge: mean(rows.map((row) => row.discharge)), coherence: mean(rows.map((row) => row.coherence)) }; }); let totalWater = 0; let wetCellCount = 0; for (let i = 0; i < snapshot.NN; i++) { totalWater += snapshot.d[i]; if (snapshot.d[i] > wetThreshold) wetCellCount++; } return { downstreamDischarge: zones[2].discharge, downstreamVsMouth: zones[2].discharge / Math.max(zones[0].discharge, epsilon), directionalCoherence: mean(zones.map((zone) => zone.coherence)), wetConnectedCellCount: connectedWetCells(snapshot), totalWater, wetCellCount }; }
function metrics(snapshot, pathCells) { const erosionResidual = snapshot.requestedErosion - snapshot.appliedErosion - snapshot.rejectedErosion; const depositionResidual = snapshot.requestedDeposition - snapshot.appliedDeposition - snapshot.rejectedDeposition; return { ...turnoverMetrics(snapshot), ...hydraulicMetrics(snapshot, pathCells), requestedErosion: snapshot.requestedErosion, appliedErosion: snapshot.appliedErosion, rejectedErosion: snapshot.rejectedErosion, requestedDeposition: snapshot.requestedDeposition, appliedDeposition: snapshot.appliedDeposition, rejectedDeposition: snapshot.rejectedDeposition, conservation: { erosionResidual, depositionResidual } }; }
function runVariant(variant, maximumSteps, pathCells) { const rows = {}; const buffers = {}; simulate(variant.source, maximumSteps, (step, snapshot) => { rows[step] = metrics(snapshot, pathCells); if (variant.control && equalityCheckpoints.includes(step)) buffers[step] = Object.fromEntries(["b", "d", "s", "u", "v"].map((key) => [key, new Float32Array(snapshot[key])])); }); return { ...variant, checkpoints: rows, buffers }; }
function differences(current, control) { return Object.fromEntries(equalityCheckpoints.map((step) => [step, Object.fromEntries(["b", "d", "s", "u", "v"].map((key) => [key, maxDifference(current.buffers[step][key], control.buffers[step][key])]))])); }
function exact(difference) { return Object.values(difference).every((row) => Object.values(row).every((value) => value === 0)); }
function collapseStep(run, threshold) { return checkpoints.find((step) => run.checkpoints[step].downstreamDischarge < threshold) ?? null; }
function candidate(run, current, noMorph) { return candidateCheckpoints.every((step) => { const row = run.checkpoints[step]; const baseline = current.checkpoints[step]; const healthy = noMorph.checkpoints[step]; return row.downstreamDischarge >= .5 * healthy.downstreamDischarge && row.directionalCoherence >= baseline.directionalCoherence && row.grossTurnover >= .5 * baseline.grossTurnover && row.absoluteNetBedChange >= .7 * baseline.absoluteNetBedChange && row.reworkedFraction < baseline.reworkedFraction; }); }
function classify(candidates, capRuns, current) { const ratios = capRuns.map((run) => run.reworkRatio); const fractionsMonotone = capRuns.every((run, index) => index === 0 || run.checkpoints[10000].reworkedFraction + 1e-10 >= capRuns[index - 1].checkpoints[10000].reworkedFraction); const collapses = capRuns.map((run) => run.collapseStep === null ? Infinity : run.collapseStep); const collapseMonotone = collapses.every((step, index) => index === 0 || step <= collapses[index - 1]); if (candidates.length && fractionsMonotone && collapseMonotone) return "REWORK A — limiting repeated local reworking prevents hydraulic collapse with preserved net morphodynamics"; if (candidates.length) return "REWORK B — limiter delays collapse but long-run failure remains"; if (capRuns.some((run) => run.checkpoints[10000].reworkedFraction < current.checkpoints[10000].reworkedFraction * .5)) return "REWORK C — reworking reduction has little hydraulic effect"; return "REWORK D — only near-total morphodynamic suppression works"; }

function main() {
  const currentVariant = { name: "CURRENT", family: "CONTROL", control: true, source: instrumentedSource({}) };
  const limiterOff = { name: "LIMITER_OFF", family: "CONTROL", control: true, source: instrumentedSource({ reworkRatio: null }) };
  const variants = [currentVariant, limiterOff, { name: "NO_MORPH", family: "CONTROL", source: instrumentedSource({ mode: "NO_MORPH" }) }, { name: "EROSION_ONLY", family: "CONTROL", source: instrumentedSource({ mode: "EROSION_ONLY" }) }, { name: "DEPOSITION_ONLY", family: "CONTROL", source: instrumentedSource({ mode: "DEPOSITION_ONLY" }) }];
  for (const reworkRatio of reworkRatios) variants.push({ name: `REWORK_CAP ratio=${reworkRatio.toFixed(2)}`, family: "REWORK_CAP", reworkRatio, source: instrumentedSource({ reworkRatio }) });
  for (const minNetChange of netChanges) variants.push({ name: `NET_SIGN_HYSTERESIS minNetChange=${minNetChange}`, family: "NET_SIGN_HYSTERESIS", minNetChange, source: instrumentedSource({ minNetChange }) });
  let reference; simulate(currentVariant.source, 1000, (step, snapshot) => { if (step === 1000) reference = { N: snapshot.N, NN: snapshot.NN, u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v), source: snapshot.source }; });
  const pathCells = referenceFlowPath(reference); if (!pathCells.length) throw new Error("Frozen CURRENT@1000 reference path is empty"); progress(`[reference path] CURRENT@1000 ${pathCells.length} cells`);
  const runs = []; for (const variant of variants) { progress(`[run] ${variant.name}`); runs.push(runVariant(variant, 10000, pathCells)); progress(`[completed] ${variant.name}`); }
  const byName = Object.fromEntries(runs.map((run) => [run.name, run])); const current = byName.CURRENT; const noMorph = byName.NO_MORPH; const threshold = mean([current.checkpoints[250].downstreamDischarge, current.checkpoints[500].downstreamDischarge]) * .25;
  const controls = { limiterOffBitIdentical: differences(current, byName.LIMITER_OFF) }; controls.passes = exact(controls.limiterOffBitIdentical); if (!controls.passes) throw new Error(`LIMITER_OFF control failed: ${JSON.stringify(controls.limiterOffBitIdentical)}`);
  for (const run of runs) run.collapseStep = collapseStep(run, threshold);
  const conservation = Object.fromEntries(runs.map((run) => [run.name, Object.fromEntries(checkpoints.map((step) => { const row = run.checkpoints[step]; const tolerance = Math.max(1e-10, (row.requestedErosion + row.requestedDeposition) * 1e-9); return [step, { ...row.conservation, passes: Math.abs(row.conservation.erosionResidual) <= tolerance && Math.abs(row.conservation.depositionResidual) <= tolerance }]; }))]));
  if (!Object.values(conservation).every((rows) => Object.values(rows).every((row) => row.passes))) throw new Error("Requested/applied/rejected conservation failed");
  const capRuns = runs.filter((run) => run.family === "REWORK_CAP"); const candidates = runs.filter((run) => run.family !== "CONTROL" && candidate(run, current, noMorph));
  for (const run of candidates) { progress(`[candidate 20000] ${run.name}`); const longRun = runVariant(run, 20000, pathCells); run.checkpoints[20000] = longRun.checkpoints[20000]; }
  const classification = classify(candidates, capRuns, current); const summary = { controls: { productionSimulationModified: false, frozenReferencePath: "CURRENT@1000", referencePathCellCount: pathCells.length, checkpoints, limiterOffBitIdentical: controls.limiterOffBitIdentical, passes: true }, limiterDefinitions: { reworkCap: "reworked = gross - abs(cumulativeErosion - cumulativeDeposition); opposite cumulative exchange is capped so reworked <= MAX_REWORK_RATIO * abs(net). Same-direction exchange is never limited.", netSignHysteresis: "An opposite request is rejected unless it crosses to the opposite net state by MIN_NET_CHANGE; same-direction exchange is never limited." }, collapseDefinition: "First checkpoint with Q below 25% of mean CURRENT Q@250/Q@500.", collapseThreshold: threshold, conservation, candidates: candidates.map((run) => run.name), classification, variants: runs.map(({ source, buffers, ...run }) => run), completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${classification}`); console.table(runs.map((run) => ({ variant: run.name, discharge5000: run.checkpoints[5000].downstreamDischarge, discharge10000: run.checkpoints[10000].downstreamDischarge, reworked5000: run.checkpoints[5000].reworkedFraction, reworked10000: run.checkpoints[10000].reworkedFraction, collapseStep: run.collapseStep, candidate: candidates.includes(run) }))); console.log(classification);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
