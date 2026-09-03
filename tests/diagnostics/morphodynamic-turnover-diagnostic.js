/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Measures cumulative, cell-level bed reworking against fixed-path hydraulic
 * health. The benchmark distinguishes turnover from the remaining net bed
 * shape; it does not alter production morphodynamic behaviour.
 *
 * RUN:
 * node tests/diagnostics/morphodynamic-turnover-diagnostic.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/morphodynamic-turnover");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const checkpoints = Array.from({ length: 40 }, (_, index) => (index + 1) * 250);
const wetThreshold = 1e-6;
const epsilon = 1e-12;
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);
function progress(message) { fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`); }
function mean(values) { return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1); }

/**
 * Applies the established direct-exchange ablations in memory. Counter writes
 * are adjacent to the original applied exchanges, leaving their arithmetic and
 * ordering intact for every enabled branch.
 */
function instrumentedSource(mode) {
  let source = `${currentSource}\nlet cumulativeErosion = new Float64Array(NN); let cumulativeDeposition = new Float64Array(NN);`;
  const erosion = mode === "NO_MORPH" || mode === "DEPOSITION_ONLY"
    ? ""
    : "cumulativeErosion[i] += diff; b[i] -= diff; s[i] = si + diff;";
  const deposition = mode === "NO_MORPH" || mode === "EROSION_ONLY"
    ? ""
    : "cumulativeDeposition[i] += diff; b[i] += diff; s[i] = Math.max(0, si - diff);";
  const erosionPattern = /const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/;
  const depositionPattern = /const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/;
  source = source.replace(erosionPattern, `const diff = KS * (C - si) * sourceProtectionMask[i];\n        ${erosion}`);
  source = source.replace(depositionPattern, `const diff = KD * (si - C);\n        ${deposition}`);
  if (!source.includes("let cumulativeErosion = new Float64Array(NN)")) throw new Error(`Instrumentation injection failed for ${mode}`);
  return source;
}

function simulate(source, observe) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", `${source}
    genTerrain();
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    const snapshot = () => ({ N, NN, b, bInit, d, u, v, source: sourcePoint, cumulativeErosion, cumulativeDeposition });
    for (let stepIndex = 1; stepIndex <= 10000; stepIndex++) { step(); if (${JSON.stringify(checkpoints)}.includes(stepIndex)) observe(stepIndex, snapshot()); }
  `)(math, Float32Array, Float64Array, Int32Array, Uint8Array, observe);
}

/** Frozen CURRENT@1000 centreline ensures equal sections for all variants and times. */
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

function section(snapshot, pathCells, position) {
  const cell = pathCells[Math.min(position, pathCells.length - 1)]; const before = pathCells[Math.max(0, position - 1)]; const after = pathCells[Math.min(pathCells.length - 1, position + 1)];
  const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1;
  const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; const normalX = -Math.sign(dy); const normalY = Math.sign(dx);
  let discharge = 0; let magnitude = 0; let vectorU = 0; let vectorV = 0;
  for (let offset = -2; offset <= 2; offset++) {
    const sx = x + normalX * offset; const sy = y + normalY * offset;
    if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue;
    const i = sy * snapshot.N + sx; const q = snapshot.d[i] * Math.hypot(snapshot.u[i], snapshot.v[i]);
    discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length);
    magnitude += q; vectorU += snapshot.d[i] * snapshot.u[i]; vectorV += snapshot.d[i] * snapshot.v[i];
  }
  return { discharge, coherence: Math.hypot(vectorU, vectorV) / Math.max(magnitude, epsilon) };
}

function connectedWetCells(snapshot) {
  const visited = new Uint8Array(snapshot.NN); const queue = [];
  for (const i of [snapshot.source.y * snapshot.N + snapshot.source.x, ...snapshot.source.outletIndices]) if (snapshot.d[i] > wetThreshold && !visited[i]) { visited[i] = 1; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]; const x = i % snapshot.N; const y = (i / snapshot.N) | 0;
    for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; const next = ny * snapshot.N + nx; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N && snapshot.d[next] > wetThreshold && !visited[next]) { visited[next] = 1; queue.push(next); } }
  }
  return queue.length;
}

function turnoverMetrics(snapshot) {
  let grossErosion = 0; let grossDeposition = 0; let absoluteNetBedChange = 0; let bothCells = 0; let threshold2 = 0; let threshold5 = 0; let threshold10 = 0; let threshold50 = 0;
  for (let i = 0; i < snapshot.NN; i++) {
    const erosion = snapshot.cumulativeErosion[i]; const deposition = snapshot.cumulativeDeposition[i]; const turnover = erosion + deposition; const net = Math.abs(snapshot.b[i] - snapshot.bInit[i]);
    grossErosion += erosion; grossDeposition += deposition; absoluteNetBedChange += net;
    if (erosion > 0 && deposition > 0) bothCells++;
    const ratio = turnover / Math.max(net, epsilon);
    if (ratio >= 2) threshold2 += turnover;
    if (ratio >= 5) threshold5 += turnover;
    if (ratio >= 10) threshold10 += turnover;
    if (ratio >= 50) threshold50 += turnover;
  }
  const grossTurnover = grossErosion + grossDeposition; const reworkedAmount = Math.max(0, grossTurnover - absoluteNetBedChange);
  return { grossErosion, grossDeposition, grossTurnover, absoluteNetBedChange, reworkedAmount, turnoverRatio: grossTurnover / Math.max(absoluteNetBedChange, epsilon), reworkedFraction: reworkedAmount / Math.max(grossTurnover, epsilon), cellsWithBothErosionAndDeposition: bothCells, bothExchangeCellFraction: bothCells / snapshot.NN, grossTurnoverFractionLocalRatioAtLeast2: threshold2 / Math.max(grossTurnover, epsilon), grossTurnoverFractionLocalRatioAtLeast5: threshold5 / Math.max(grossTurnover, epsilon), grossTurnoverFractionLocalRatioAtLeast10: threshold10 / Math.max(grossTurnover, epsilon), grossTurnoverFractionLocalRatioAtLeast50: threshold50 / Math.max(grossTurnover, epsilon) };
}

function hydraulicMetrics(snapshot, pathCells) {
  const zones = [[0, 5], [6, 15], [16, pathCells.length - 1]].map(([start, end]) => {
    const rows = []; for (let position = start; position <= Math.min(end, pathCells.length - 1); position++) rows.push(section(snapshot, pathCells, position));
    return { discharge: mean(rows.map((row) => row.discharge)), coherence: mean(rows.map((row) => row.coherence)) };
  });
  let totalWater = 0; let wetCellCount = 0;
  for (let i = 0; i < snapshot.NN; i++) { totalWater += snapshot.d[i]; if (snapshot.d[i] > wetThreshold) wetCellCount++; }
  return { downstreamDischarge: zones[2].discharge, downstreamVsMouth: zones[2].discharge / Math.max(zones[0].discharge, epsilon), directionalCoherence: mean(zones.map((zone) => zone.coherence)), wetConnectedCellCount: connectedWetCells(snapshot), totalWater, wetCellCount };
}

function spatialMetrics(snapshot) {
  const bands = { SOURCE_BAND: { grossTurnover: 0, absoluteNetBedChange: 0, cellsWithBothExchanges: 0 }, NEAR: { grossTurnover: 0, absoluteNetBedChange: 0, cellsWithBothExchanges: 0 }, MID: { grossTurnover: 0, absoluteNetBedChange: 0, cellsWithBothExchanges: 0 }, FAR: { grossTurnover: 0, absoluteNetBedChange: 0, cellsWithBothExchanges: 0 } };
  for (let i = 0; i < snapshot.NN; i++) {
    const x = i % snapshot.N; const y = (i / snapshot.N) | 0; const distance = Math.hypot(x - snapshot.source.x, y - snapshot.source.y);
    const band = distance <= 6 ? bands.SOURCE_BAND : distance <= 15 ? bands.NEAR : distance <= 30 ? bands.MID : bands.FAR;
    band.grossTurnover += snapshot.cumulativeErosion[i] + snapshot.cumulativeDeposition[i]; band.absoluteNetBedChange += Math.abs(snapshot.b[i] - snapshot.bInit[i]);
    if (snapshot.cumulativeErosion[i] > 0 && snapshot.cumulativeDeposition[i] > 0) band.cellsWithBothExchanges++;
  }
  for (const band of Object.values(bands)) { band.reworkedAmount = Math.max(0, band.grossTurnover - band.absoluteNetBedChange); band.reworkedFraction = band.reworkedAmount / Math.max(band.grossTurnover, epsilon); }
  return bands;
}

function row(snapshot, pathCells) { return { ...turnoverMetrics(snapshot), ...hydraulicMetrics(snapshot, pathCells) }; }
function runVariant(variant, pathCells, includeSpatial) {
  const timeline = []; const spatialBands = {};
  simulate(variant.source, (step, snapshot) => { timeline.push({ step, ...row(snapshot, pathCells) }); if (includeSpatial) spatialBands[step] = spatialMetrics(snapshot); });
  return { name: variant.name, mode: variant.mode, timeline, ...(includeSpatial ? { spatialBands } : {}) };
}
function at(run, step) { return run.timeline.find((row) => row.step === step); }
function hydraulicCollapseStep(current) { const baseline = mean([at(current, 250).downstreamDischarge, at(current, 500).downstreamDischarge]); return current.timeline.find((row) => row.downstreamDischarge < baseline * .25)?.step ?? null; }
function increasedStrongly(row, baseline) { return (row.reworkedFraction >= Math.max(.10, baseline.reworkedFraction * 2) || row.bothExchangeCellFraction >= Math.max(.001, baseline.bothExchangeCellFraction * 2)); }
function classify(current, erosionOnly, depositionOnly, collapseStep) {
  const baseline = { reworkedFraction: mean([at(current, 250).reworkedFraction, at(current, 500).reworkedFraction]), bothExchangeCellFraction: mean([at(current, 250).bothExchangeCellFraction, at(current, 500).bothExchangeCellFraction]) };
  const collapseIndex = current.timeline.findIndex((row) => row.step === collapseStep); const prior = collapseIndex > 0 ? current.timeline[collapseIndex - 1] : null; const collapse = collapseIndex >= 0 ? current.timeline[collapseIndex] : null;
  const healthyThreshold = mean([at(current, 250).downstreamDischarge, at(current, 500).downstreamDischarge]) * .25;
  const healthyAblations = [erosionOnly, depositionOnly].every((run) => !collapseStep || at(run, collapseStep).downstreamDischarge >= healthyThreshold);
  const ablationPrecursor = [erosionOnly, depositionOnly].some((run) => { const controlBase = { reworkedFraction: mean([at(run, 250).reworkedFraction, at(run, 500).reworkedFraction]), bothExchangeCellFraction: mean([at(run, 250).bothExchangeCellFraction, at(run, 500).bothExchangeCellFraction]) }; return prior && increasedStrongly(at(run, prior.step), controlBase); });
  const currentPrecedes = prior && increasedStrongly(prior, baseline); const currentAtCollapse = collapse && increasedStrongly(collapse, baseline);
  const controlsTurnover = collapseStep && Math.max(at(erosionOnly, collapseStep).grossTurnover, at(depositionOnly, collapseStep).grossTurnover);
  const distinguishes = collapseStep && collapse.grossTurnover > controlsTurnover * 1.25;
  let classification = "TURNOVER C — turnover and collapse evolve together; causality unresolved";
  if (!distinguishes) classification = "TURNOVER D — gross turnover does not distinguish CURRENT from healthy ablations";
  else if (currentPrecedes && healthyAblations && !ablationPrecursor) classification = "TURNOVER A — high reworking strongly precedes hydraulic collapse";
  else if (!currentPrecedes && currentAtCollapse) classification = "TURNOVER B — high reworking appears only after hydraulic collapse";
  return { classification, classificationEvidence: { baseline, priorStep: prior?.step ?? null, currentPrecursor: Boolean(currentPrecedes), currentAtCollapse: Boolean(currentAtCollapse), healthyAblations, ablationPrecursorWithHealthyHydraulics: ablationPrecursor, grossTurnoverDistinguishesCurrent: Boolean(distinguishes), hydraulicHealthyThreshold: healthyThreshold, rule: "A requires a strong reworking increase at least one 250-step checkpoint before collapse, without the same precursor in healthy EROSION_ONLY or DEPOSITION_ONLY. Other temporal overlap remains non-causal." } };
}

function main() {
  const variants = ["CURRENT", "NO_MORPH", "EROSION_ONLY", "DEPOSITION_ONLY"].map((mode) => ({ name: mode, mode, source: instrumentedSource(mode) }));
  let referenceSnapshot;
  simulate(variants[0].source, (step, snapshot) => { if (step === 1000) referenceSnapshot = { N: snapshot.N, NN: snapshot.NN, u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v), source: snapshot.source }; });
  const pathCells = referenceFlowPath(referenceSnapshot); if (!pathCells.length) throw new Error("Frozen CURRENT@1000 reference path is empty"); progress(`[reference path] CURRENT@1000 ${pathCells.length} cells`);
  const runs = [];
  for (const variant of variants) { progress(`[run] ${variant.name}`); runs.push(runVariant(variant, pathCells, variant.mode === "CURRENT")); progress(`[completed] ${variant.name}`); }
  const byMode = Object.fromEntries(runs.map((run) => [run.mode, run])); const current = byMode.CURRENT; const collapseStep = hydraulicCollapseStep(current);
  const collapseIndex = current.timeline.findIndex((entry) => entry.step === collapseStep); const window = collapseIndex < 0 ? [] : current.timeline.slice(Math.max(0, collapseIndex - 1), collapseIndex + 2);
  const conclusion = classify(current, byMode.EROSION_ONLY, byMode.DEPOSITION_ONLY, collapseStep);
  const summary = { controls: { productionSimulationModified: false, frozenReferencePath: "CURRENT@1000", referencePathCellCount: pathCells.length, checkpoints, ablations: "Existing direct CURRENT / NO_MORPH / EROSION_ONLY / DEPOSITION_ONLY benchmark ablations; no physics parameters changed.", counterSemantics: "Each enabled direct bed exchange increments its cell cumulative counter by the actually applied diff." }, variants: runs.map(({ spatialBands, ...run }) => run), currentTimeline: current.timeline, spatialBands: current.spatialBands, hydraulicCollapseStep: collapseStep, collapseWindow: window, classification: conclusion.classification, classificationEvidence: conclusion.classificationEvidence, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${summary.classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${summary.classification}`);
  console.table(window.map(({ step, downstreamDischarge, grossTurnover, absoluteNetBedChange, reworkedFraction, bothExchangeCellFraction, wetConnectedCellCount }) => ({ step, downstreamDischarge, grossTurnover, absoluteNetBedChange, reworkedFraction, bothExchangeCellFraction, wetConnectedCellCount })));
  if (collapseStep) console.table(["EROSION_ONLY", "DEPOSITION_ONLY"].map((mode) => { const value = at(byMode[mode], collapseStep); return { mode, step: collapseStep, downstreamDischarge: value.downstreamDischarge, grossTurnover: value.grossTurnover, absoluteNetBedChange: value.absoluteNetBedChange, reworkedFraction: value.reworkedFraction, bothExchangeCellFraction: value.bothExchangeCellFraction, wetConnectedCellCount: value.wetConnectedCellCount }; }));
  console.log(summary.classification);
}

try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
