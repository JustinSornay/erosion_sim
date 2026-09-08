/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE: Reassesses the already-validated flux-form sediment transport with
 * absolute face-flux profiles.  Path-based hydraulic-health criteria are not
 * used: morphodynamic feedback may reorganise routes without a global collapse.
 *
 * PRODUCTION: Source is instrumented and changed only in memory. simulation.js
 * remains read-only.
 *
 * RUN: node tests/experiments/sediment/conservative-transport-causal-revisit.js
 */
const fs = require("fs");
const path = require("path");
const { conservativeSource } = require("./conservative-sediment-transport.js");

const root = path.resolve(__dirname, "../../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const productionSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const output = path.join(root, "tests/generated/conservative-transport-causal-revisit");
const summaryPath = path.join(output, "summary.json");
const progressPath = path.join(output, "progress.log");
const completePath = path.join(output, "COMPLETE");
const cuts = [56, 60, 64, 68, 72, 76, 80, 84, 88, 92];
const observations = [1000, 2500, 3400, 4000, 4400, 4750, 5000, 6000, 7500, 10000];
const equalityCheckpoints = [1000, 5000, 10000];
const periods = [[3400, 4000], [4000, 4400], [4400, 4750], [4750, 5000], [5000, 5500]];
const bands = [[48, 64], [65, 80], [81, 96], [97, 128], [129, 191]];
const significantFlux = 1e-12;

fs.mkdirSync(output, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);
const progress = (message) => fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`);
const mean = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const percentile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] : 0;
function maxDiff(first, second) { let maximum = 0; for (let i = 0; i < first.length; i++) maximum = Math.max(maximum, Math.abs(first[i] - second[i])); return maximum; }

/** Adds observations without changing physical state or operation ordering. */
function instrument(source, { erosion = true, deposition = true } = {}) {
  let result = `let directErosion = 0, directDeposition = 0, sedimentBeforeTransport = 0, sedimentAfterTransport = 0;\nlet directErosionByCell, directDepositionByCell;\n${source}`;
  const erosionReplacement = erosion
    ? "b[i] -= diff; s[i] = si + diff; directErosion += diff; directErosionByCell[i] += diff;"
    : "s[i] = si;";
  const depositionReplacement = deposition
    ? "b[i] += diff; s[i] = Math.max(0, si - diff); directDeposition += diff; directDepositionByCell[i] += diff;"
    : "s[i] = si;";
  const beforeExchangeInjection = result;
  result = result.replace(/b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, erosionReplacement);
  result = result.replace(/b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, depositionReplacement);
  if (result === beforeExchangeInjection) throw new Error("Exchange instrumentation injection failed");
  // Exact placement means this sum observes the post-exchange, pre-advection state.
  const transportStart = "  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      let sx = x - (u[i] * DT) / L,";
  const measurement = "  sedimentBeforeTransport = 0; for (let sedimentIndex = 0; sedimentIndex < NN; sedimentIndex++) sedimentBeforeTransport += s[sedimentIndex];\n";
  if (result.includes(transportStart)) result = result.replace(transportStart, measurement + transportStart);
  else if (result.includes("  tmpS.fill(0);")) result = result.replace("  tmpS.fill(0);", measurement + "  tmpS.fill(0);");
  else throw new Error("Transport anchor missing");
  const swap = /  \{\r?\n    const t = s;\r?\n    s = tmpS;\r?\n    tmpS = t;\r?\n  \}/;
  if (!swap.test(result)) throw new Error("Sediment swap anchor missing");
  return result.replace(swap, (match) => `${match}\n  sedimentAfterTransport = 0; for (let sedimentIndex = 0; sedimentIndex < NN; sedimentIndex++) sedimentAfterTransport += s[sedimentIndex];`);
}

function snapshotFunction() {
  return "({ N, NN, b, bInit, d, s, u, v, fL, fR, fT, fB, directErosion, directDeposition, directErosionByCell, directDepositionByCell, sedimentBeforeTransport, sedimentAfterTransport })";
}
function run(source, maximumSteps, callback) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  const isInstrumented = source.includes("directErosionByCell");
  const snapshot = isInstrumented ? snapshotFunction() : "({ N, NN, b, bInit, d, s, u, v, fL, fR, fT, fB })";
  return new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "callback", `${source}
    genTerrain(); ${isInstrumented ? "directErosionByCell = new Float64Array(NN); directDepositionByCell = new Float64Array(NN);" : ""} const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    callback(0, ${snapshot});
    for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); callback(stepIndex, ${snapshot}); }
  `)(math, Float32Array, Float64Array, Int32Array, Uint8Array, callback);
}

function profileMetrics(values) {
  const total = sum(values); if (total <= significantFlux) return { totalPositiveSouth: total, profile: null, entropy: null, effectiveWidth: null, participationRatio: null, centroidX: null, stdX: null };
  const profile = values.map((value) => value / total); let entropy = 0, squared = 0, centroidX = 0;
  for (let x = 0; x < profile.length; x++) { const p = profile[x]; if (p) entropy -= p * Math.log(p); squared += p * p; centroidX += x * p; }
  let variance = 0; for (let x = 0; x < profile.length; x++) variance += profile[x] * (x - centroidX) ** 2;
  return { totalPositiveSouth: total, profile, entropy, effectiveWidth: Math.exp(entropy), participationRatio: 1 / Math.max(squared, 1e-30), centroidX, stdX: Math.sqrt(variance) };
}
function js(first, second) { if (!first || !second) return null; let value = 0; for (let i = 0; i < first.length; i++) { const m = (first[i] + second[i]) / 2; if (first[i]) value += .5 * first[i] * Math.log(first[i] / m); if (second[i]) value += .5 * second[i] * Math.log(second[i] / m); } return value; }
function w1(first, second) { if (!first || !second) return null; let firstCdf = 0, secondCdf = 0, distance = 0; for (let i = 0; i < first.length; i++) { firstCdf += first[i]; secondCdf += second[i]; distance += Math.abs(firstCdf - secondCdf); } return distance; }

/** Absolute horizontal cuts: fB above face minus fT below face, never a frozen path. */
function cutMetrics(snapshot, histories) {
  return cuts.map((y) => {
    const positive = []; let grossSouthward = 0, grossNorthward = 0, netSouthward = 0;
    for (let x = 0; x < snapshot.N; x++) { const southward = snapshot.fB[(y - 1) * snapshot.N + x]; const northward = snapshot.fT[y * snapshot.N + x]; grossSouthward += southward; grossNorthward += northward; netSouthward += southward - northward; positive.push(Math.max(0, southward - northward)); }
    const shape = profileMetrics(positive); const history = histories[y];
    const row = { y, grossSouthward, grossNorthward, netSouthward, ...shape, jsLag1: js(shape.profile, history.at(-1)), jsLag20: js(shape.profile, history.at(-20)), jsLag100: js(shape.profile, history.at(-100)), w1Lag1: w1(shape.profile, history.at(-1)), w1Lag20: w1(shape.profile, history.at(-20)), w1Lag100: w1(shape.profile, history.at(-100)) };
    history.push(shape.profile); if (history.length > 100) history.shift(); delete row.profile; return row;
  });
}
function weighted(rows, key) { const valid = rows.filter((row) => row[key] !== null && row.totalPositiveSouth > significantFlux); const denominator = sum(valid.map((row) => row.totalPositiveSouth)); return denominator ? sum(valid.map((row) => row.totalPositiveSouth * row[key])) / denominator : null; }
function unweighted(rows, key) { return mean(rows.map((row) => row[key]).filter((value) => value !== null)); }
function morphology(snapshot) {
  let absoluteNetBedChange = 0, erosionCellCount = 0, depositionCellCount = 0, totalQMagnitude = 0; const deposits = [];
  const bandRows = bands.map(([fromY, toY]) => ({ y: `${fromY}..${toY}`, grossErosion: 0, grossDeposition: 0, absoluteNetBedChange: 0 }));
  for (let i = 0; i < snapshot.NN; i++) { const delta = snapshot.b[i] - snapshot.bInit[i]; absoluteNetBedChange += Math.abs(delta); totalQMagnitude += Math.abs(snapshot.fL[i]) + Math.abs(snapshot.fR[i]) + Math.abs(snapshot.fT[i]) + Math.abs(snapshot.fB[i]); if (delta < 0) erosionCellCount++; if (delta > 0) { depositionCellCount++; deposits.push(delta); } const y = (i / snapshot.N) | 0; const band = bandRows.find((row, index) => y >= bands[index][0] && y <= bands[index][1]); if (band) { band.grossErosion += snapshot.directErosionByCell[i]; band.grossDeposition += snapshot.directDepositionByCell[i]; band.absoluteNetBedChange += Math.abs(delta); } }
  return { grossErosion: snapshot.directErosion, grossDeposition: snapshot.directDeposition, grossTurnover: snapshot.directErosion + snapshot.directDeposition, absoluteNetBedChange, erosionCellCount, depositionCellCount, depositP99: percentile(deposits, .99), depositMax: deposits.length ? Math.max(...deposits) : 0, bands: bandRows, totalQMagnitude };
}
function observation(snapshot, histories) {
  const cutRows = cutMetrics(snapshot, histories); const residual = snapshot.sedimentAfterTransport - snapshot.sedimentBeforeTransport;
  return { cuts: cutRows, weightedShapeChange: weighted(cutRows, "jsLag1"), weightedDrift100: weighted(cutRows, "jsLag100"), weightedEffectiveWidth: weighted(cutRows, "effectiveWidth"), unweightedShapeChange: unweighted(cutRows, "jsLag1"), unweightedDrift100: unweighted(cutRows, "jsLag100"), unweightedEffectiveWidth: unweighted(cutRows, "effectiveWidth"), sumB: sum(snapshot.b), sumS: sum(snapshot.s), sumBPlusS: sum(snapshot.b) + sum(snapshot.s), directErosion: snapshot.directErosion, directDeposition: snapshot.directDeposition, sedimentBeforeTransport: snapshot.sedimentBeforeTransport, sedimentAfterTransport: snapshot.sedimentAfterTransport, transportMassResidual: residual, ...morphology(snapshot) };
}
function compact(row) { const { cuts: cutRows, bands: bandRows, ...rest } = row; return { ...rest, cuts: cutRows.map(({ profile, ...cut }) => cut), bands: bandRows }; }
function periodSummary(rows, from, to) {
  const selected = Object.entries(rows).filter(([step]) => Number(step) >= from && Number(step) <= to).map(([, row]) => row);
  return { range: `${from}..${to}`, meanWeightedShapeChange: mean(selected.map((row) => row.weightedShapeChange).filter((value) => value !== null)), meanWeightedDrift100: mean(selected.map((row) => row.weightedDrift100).filter((value) => value !== null)), meanWeightedEffectiveWidth: mean(selected.map((row) => row.weightedEffectiveWidth).filter((value) => value !== null)), meanNetSouthwardByCut: Object.fromEntries(cuts.map((y) => [y, mean(selected.map((row) => row.cuts.find((cut) => cut.y === y).netSouthward))])), meanTotalPositiveSouthByCut: Object.fromEntries(cuts.map((y) => [y, mean(selected.map((row) => row.cuts.find((cut) => cut.y === y).totalPositiveSouth))])) };
}
function runVariant(name, source) {
  const histories = Object.fromEntries(cuts.map((y) => [y, []])); const rows = {}; const buffers = {};
  let maxAbsTransportResidual = 0, cumulativeAbsTransportResidual = 0, netTransportResidual = 0;
  run(source, 10000, (step, snapshot) => {
    if (step) { const residual = snapshot.sedimentAfterTransport - snapshot.sedimentBeforeTransport; maxAbsTransportResidual = Math.max(maxAbsTransportResidual, Math.abs(residual)); cumulativeAbsTransportResidual += Math.abs(residual); netTransportResidual += residual; }
    // Lag histories are only required around non-stationarity window; avoid
    // spending diagnostic time on unused pre-window profiles.
    if (step >= 3300 && step <= 5500) rows[step] = observation(snapshot, histories);
    else if (observations.includes(step)) rows[step] = observation(snapshot, Object.fromEntries(cuts.map((y) => [y, []])));
    if (equalityCheckpoints.includes(step)) buffers[step] = Object.fromEntries(["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"].map((key) => [key, new Float32Array(snapshot[key])]));
  });
  return { name, rows, buffers, conservation: { maxAbsTransportResidual, cumulativeAbsTransportResidual, netTransportResidual }, periods: periods.map(([from, to]) => periodSummary(rows, from, to)) };
}
function productionBuffers(source) {
  const buffers = {};
  run(source, 10000, (step, snapshot) => { if (equalityCheckpoints.includes(step)) buffers[step] = Object.fromEntries(["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"].map((key) => [key, new Float32Array(snapshot[key])])); });
  return buffers;
}
function benchmark(name, source) { const timed = () => { const started = performance.now(); run(source, 1000, () => {}); return performance.now() - started; }; timed(); const milliseconds = mean(Array.from({ length: 5 }, timed)); return { variant: name, steps: 1000, repetitions: 5, meanMilliseconds: milliseconds, stepsPerSecond: 1000 / (milliseconds / 1000) }; }
function classification(runs) {
  const byName = Object.fromEntries(runs.map((run) => [run.name, run])); const current = byName.CURRENT; const conservative = byName.CONSERVATIVE_TRANSPORT; const period = (run) => run.periods.find((row) => row.range === "4750..5000"); const later = (run) => run.periods.find((row) => row.range === "5000..5500");
  const currentWindow = [period(current), later(current)], conservativeWindow = [period(conservative), later(conservative)];
  const shapeRatio = mean(conservativeWindow.map((row, index) => row.meanWeightedShapeChange / currentWindow[index].meanWeightedShapeChange)); const driftRatio = mean(conservativeWindow.map((row, index) => row.meanWeightedDrift100 / currentWindow[index].meanWeightedDrift100));
  const c10000 = conservative.rows[10000], b10000 = current.rows[10000]; const gtRatio = c10000.grossTurnover / Math.max(b10000.grossTurnover, 1e-30), nbRatio = c10000.absoluteNetBedChange / Math.max(b10000.absoluteNetBedChange, 1e-30); const erosionRatio = c10000.grossErosion / Math.max(b10000.grossErosion, 1e-30), depositionRatio = c10000.grossDeposition / Math.max(b10000.grossDeposition, 1e-30);
  const retainedCuts = cuts.filter((y) => Math.abs(c10000.cuts.find((row) => row.y === y).netSouthward) >= .7 * Math.abs(b10000.cuts.find((row) => row.y === y).netSouthward)).length; const cutRetention = retainedCuts / cuts.length;
  const conservationFixed = conservative.conservation.maxAbsTransportResidual <= Math.max(1e-8, current.conservation.maxAbsTransportResidual * 1e-3);
  const stable = driftRatio <= .7 && shapeRatio <= .8, preserved = gtRatio >= .7 && nbRatio >= .7, cutsPreserved = cutRetention >= .7;
  let label = "SEDIMENT-CAUSAL D — CONSERVATIVE TRANSPORT CHANGES BEHAVIOR WITHOUT CLEAR IMPROVEMENT";
  if (stable && !preserved) label = "SEDIMENT-CAUSAL C — APPARENT STABILIZATION COMES FROM MORPHODYNAMIC SUPPRESSION";
  else if (conservationFixed && driftRatio >= .8 && shapeRatio >= .8) label = "SEDIMENT-CAUSAL B — CONSERVATION FIXED, PROFILE NONSTATIONARITY PERSISTS";
  else if (stable && preserved && cutsPreserved) label = "SEDIMENT-CAUSAL A — CONSERVATIVE TRANSPORT REDUCES NONSTATIONARITY WHILE PRESERVING MORPHODYNAMICS";
  return { label, evidence: { shapeRatio4750to5500: shapeRatio, driftRatio4750to5500: driftRatio, gtRatio10000: gtRatio, nbRatio10000: nbRatio, erosionRatio10000: erosionRatio, depositionRatio10000: depositionRatio, retainedCuts, cutRetention, conservationFixed } };
}
function main() {
  const current = instrument(productionSource); const conservative = instrument(conservativeSource());
  const variants = [["CURRENT", current], ["CONSERVATIVE_TRANSPORT", conservative], ["EROSION_ONLY", instrument(productionSource, { deposition: false })], ["NO_MORPH", instrument(productionSource, { erosion: false, deposition: false })]];
  const runs = []; for (const [name, source] of variants) { progress(`[run] ${name}`); runs.push(runVariant(name, source)); progress(`[completed] ${name}`); }
  const byName = Object.fromEntries(runs.map((run) => [run.name, run])); const fields = ["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"];
  const controlBuffers = productionBuffers(productionSource); const identity = Object.fromEntries(equalityCheckpoints.map((step) => [step, Object.fromEntries(fields.map((field) => [field, maxDiff(byName.CURRENT.buffers[step][field], controlBuffers[step][field])]))]));
  const passes = Object.values(identity).every((row) => Object.values(row).every((value) => value === 0));
  if (!passes) { const failed = { controls: { currentBitIdentical: { passes, differences: identity } }, failure: "CURRENT instrumentation differs from production; STOP.", completedAt: new Date().toISOString() }; fs.writeFileSync(summaryPath, JSON.stringify(failed, null, 2)); throw new Error(failed.failure); }
  const performance = [benchmark("CURRENT", current), benchmark("CONSERVATIVE_TRANSPORT", conservative)]; performance[1].overheadPercent = (performance[0].stepsPerSecond / performance[1].stepsPerSecond - 1) * 100;
  const result = classification(runs); const summary = { purpose: "Absolute face-flux/profile-dynamics revisit of benchmark-local TRANSPORT B.", historicalNote: "TRANSPORT B historical evaluation used path-based morphology criteria that are now deprecated as global hydraulic-health evidence. This revisit evaluates the same conservative transport using absolute face-flux and profile-dynamics metrics.", controls: { currentBitIdentical: { passes, checkpoints: equalityCheckpoints, differences: identity } }, definitions: { cuts, positiveSouth: "max(0, fB[(y-1)N+x] - fT[yN+x])", periods: periods.map(([from, to]) => `${from}..${to}`), benchmark: "Separate 1000-step N=192 runs; excluded from diagnostic run." }, variants: runs.map(({ buffers, rows, ...run }) => ({ ...run, observations: Object.fromEntries(Object.entries(rows).map(([step, row]) => [step, compact(row)])) })), performance, classification: result.label, classificationEvidence: result.evidence, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `classification: ${summary.classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${summary.classification}`); console.log(`CURRENT bit-identical: PASS`); console.log(`CLASSIFICATION: ${summary.classification}`);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); throw error; }
