/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE: Compares bed-exchange semantics while retaining validated
 * flux-form transport. Here s is sediment mass per cell; water-face fluxes
 * transfer mass by concentration s / max(d, 1e-6), limited by donor mass.
 *
 * PRODUCTION: All changes occur in evaluated in-memory source. Production
 * simulation.js remains read-only.
 *
 * RUN: node tests/experiments/sediment/conservative-exchange-semantics.js
 */
const fs = require("fs");
const path = require("path");
const { conservativeSource } = require("./conservative-sediment-transport.js");

const root = path.resolve(__dirname, "../../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const output = path.join(root, "tests/generated/conservative-exchange-semantics");
const summaryPath = path.join(output, "summary.json");
const progressPath = path.join(output, "progress.log");
const completePath = path.join(output, "COMPLETE");
const checkpoints = [1000, 2500, 5000, 7500, 10000];
const identityCheckpoints = [1000, 5000, 10000];
const cuts = [56, 60, 64, 68, 72, 76, 80, 84, 88, 92];
const bands = [[48, 64], [65, 80], [81, 96], [97, 128], [129, 191]];
const dMin = 1e-6;
const epsilon = 1e-30;

fs.mkdirSync(output, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);
const progress = (message) => fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`);
const sum = (values) => { let total = 0; for (const value of values) total += value; return total; };
const mean = (values) => values.length ? sum(values) / values.length : null;
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] : null;
const maxDiff = (left, right) => { let maximum = 0; for (let i = 0; i < left.length; i++) maximum = Math.max(maximum, Math.abs(left[i] - right[i])); return maximum; };

/** Replaces only exchange law; legacy and mass-capacity share targetMass=C. */
function exchangeSource(source, mode) {
  const target = mode === "CONCENTRATION" ? "C * d[i]" : "C";
  const exchange = `const C = KC * sinA * vel * dNorm;
      const si = s[i]; const bi = b[i]; const targetMass = ${target};
      if (targetMass > si) {
        const diff = KS * (targetMass - si) * sourceProtectionMask[i];
        b[i] -= diff; s[i] = si + diff;
        exchangeGrossErosion += diff; exchangeErosionByCell[i] += diff;
      } else {
        const diff = KD * (si - targetMass);
        b[i] += diff; s[i] = Math.max(0, si - diff);
        exchangeGrossDeposition += diff; exchangeDepositionByCell[i] += diff;
      }
      // Uses realised Float32 state, exposing any storage-rounding closure error.
      stepExchangeResidual += (b[i] - bi) + (s[i] - si);`;
  const pattern = /const C = KC \* sinA \* vel \* dNorm;\r?\n\s*const si = s\[i\];\r?\n\s*if \(C > si\) \{\r?\n\s*const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;\r?\n\s*\} else \{\r?\n\s*const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);\r?\n\s*\}/;
  const result = source.replace(pattern, exchange);
  if (result === source) throw new Error(`Exchange injection failed: ${mode}`);
  return result;
}

/** Adds passive budget measurements without changing simulation state. */
function instrument(source) {
  let result = `let exchangeGrossErosion = 0, exchangeGrossDeposition = 0, stepExchangeResidual = 0, sedimentBeforeTransport = 0, sedimentAfterTransport = 0;\nlet exchangeErosionByCell, exchangeDepositionByCell;\n${source}`;
  const exchangeAnchor = "  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      const inL = x > 0 ? fR[i - 1] : 0,";
  const beforeExchange = "  stepExchangeResidual = 0;\n";
  if (!result.includes(exchangeAnchor)) throw new Error("Exchange measurement anchor missing");
  result = result.replace(exchangeAnchor, beforeExchange + exchangeAnchor);
  const transportAnchor = "  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      let sx = x - (u[i] * DT) / L,";
  const beforeTransport = "  sedimentBeforeTransport = 0; for (let budgetIndex = 0; budgetIndex < NN; budgetIndex++) sedimentBeforeTransport += s[budgetIndex];\n";
  if (result.includes(transportAnchor)) result = result.replace(transportAnchor, beforeTransport + transportAnchor);
  else if (result.includes("  tmpS.fill(0);")) result = result.replace("  tmpS.fill(0);", beforeTransport + "  tmpS.fill(0);");
  else throw new Error("Transport measurement anchor missing");
  const swap = /  \{\r?\n    const t = s;\r?\n    s = tmpS;\r?\n    tmpS = t;\r?\n  \}/;
  const matches = result.match(swap); if (!matches || matches.length < 1) throw new Error("Sediment swap anchor missing");
  // Last sediment swap belongs to transport; previous replacement keeps its order intact.
  const position = result.lastIndexOf(matches[0]);
  result = result.slice(0, position + matches[0].length) + "\n  sedimentAfterTransport = 0; for (let budgetIndex = 0; budgetIndex < NN; budgetIndex++) sedimentAfterTransport += s[budgetIndex];" + result.slice(position + matches[0].length);
  return result;
}

function snapshotCode() { return "({ N, NN, b, bInit, d, s, u, v, fL, fR, fT, fB, exchangeGrossErosion, exchangeGrossDeposition, exchangeErosionByCell, exchangeDepositionByCell, stepExchangeResidual, sedimentBeforeTransport, sedimentAfterTransport })"; }
function execute(source, maximumSteps, callback) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  return new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "callback", `${source}
    genTerrain(); exchangeErosionByCell = new Float64Array(NN); exchangeDepositionByCell = new Float64Array(NN);
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    callback(0, ${snapshotCode()});
    for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); callback(stepIndex, ${snapshotCode()}); }
  `)(math, Float32Array, Float64Array, Int32Array, Uint8Array, callback);
}

function profile(values) {
  const total = sum(values); if (total <= epsilon) return null;
  const p = values.map((value) => value / total); let entropy = 0, square = 0;
  for (const value of p) { if (value) entropy -= value * Math.log(value); square += value * value; }
  return { p, total, effectiveWidth: Math.exp(entropy), square };
}
function js(left, right) { if (!left || !right) return null; let value = 0; for (let i = 0; i < left.length; i++) { const mid = (left[i] + right[i]) / 2; if (left[i]) value += .5 * left[i] * Math.log(left[i] / mid); if (right[i]) value += .5 * right[i] * Math.log(right[i] / mid); } return value; }
function cutRows(snapshot, histories) { return cuts.map((y) => { let netSouthward = 0, totalPositiveSouth = 0; const values = []; for (let x = 0; x < snapshot.N; x++) { const value = snapshot.fB[(y - 1) * snapshot.N + x] - snapshot.fT[y * snapshot.N + x]; netSouthward += value; const positive = Math.max(0, value); totalPositiveSouth += positive; values.push(positive); } const data = profile(values); const prior = histories[y].at(-1), lag100 = histories[y].at(-100); histories[y].push(data && data.p); if (histories[y].length > 100) histories[y].shift(); return { y, netSouthward, totalPositiveSouth, jsLag1: js(data && data.p, prior), jsLag100: js(data && data.p, lag100), effectiveWidth: data && data.effectiveWidth }; }); }
function weighted(rows, field) { const valid = rows.filter((row) => row[field] !== null && row.totalPositiveSouth > epsilon); const denominator = sum(valid.map((row) => row.totalPositiveSouth)); return denominator ? sum(valid.map((row) => row.totalPositiveSouth * row[field])) / denominator : null; }
function distribution(snapshot) {
  const result = bands.map(([from, to]) => ({ y: `${from}..${to}`, grossErosion: 0, grossDeposition: 0, netBedChange: 0, absoluteNetBedChange: 0 }));
  let grossErosion = 0, grossDeposition = 0, absoluteNetBedChange = 0; const erosionByY = new Float64Array(snapshot.N), depositionByY = new Float64Array(snapshot.N);
  for (let i = 0; i < snapshot.NN; i++) { const y = (i / snapshot.N) | 0, erosion = snapshot.exchangeErosionByCell[i], deposition = snapshot.exchangeDepositionByCell[i], net = snapshot.b[i] - snapshot.bInit[i]; grossErosion += erosion; grossDeposition += deposition; absoluteNetBedChange += Math.abs(net); erosionByY[y] += erosion; depositionByY[y] += deposition; const band = result.find((row, index) => y >= bands[index][0] && y <= bands[index][1]); if (band) { band.grossErosion += erosion; band.grossDeposition += deposition; band.netBedChange += net; band.absoluteNetBedChange += Math.abs(net); } }
  // Histogram avoids repeated scans while preserving mass-weighted Y quantiles.
  const spatial = (amounts, total) => { if (!total) return { centroidY: null, p50Y: null, p90Y: null }; let centroidY = 0, cumulative = 0, p50Y = null, p90Y = null; for (let y = 0; y < snapshot.N; y++) { centroidY += y * amounts[y]; cumulative += amounts[y]; if (p50Y === null && cumulative >= total * .5) p50Y = y; if (p90Y === null && cumulative >= total * .9) p90Y = y; } return { centroidY: centroidY / total, p50Y, p90Y }; };
  const share = (indices) => sum(indices.flatMap((index) => [result[index].grossErosion])) / Math.max(grossErosion, epsilon);
  const depositionShare = (indices) => sum(indices.flatMap((index) => [result[index].grossDeposition])) / Math.max(grossDeposition, epsilon);
  const erosion = spatial(erosionByY, grossErosion), deposition = spatial(depositionByY, grossDeposition);
  return { grossErosion, grossDeposition, grossTurnover: grossErosion + grossDeposition, netErosion: grossErosion - grossDeposition, absoluteNetBedChange, redepositionFraction: grossDeposition / Math.max(grossErosion, epsilon), bands: result.map((row) => ({ ...row, depositionToErosion: row.grossDeposition / Math.max(row.grossErosion, epsilon) })), erosion, deposition, transportDistanceY: deposition.centroidY === null || erosion.centroidY === null ? null : deposition.centroidY - erosion.centroidY, erosionShareNear: share([0]), erosionShareMid: share([1, 2]), erosionShareDown: share([3, 4]), depositionShareNear: depositionShare([0]), depositionShareMid: depositionShare([1, 2]), depositionShareDown: depositionShare([3, 4]) };
}
function observation(snapshot, histories) { const rows = cutRows(snapshot, histories); return { weightedShapeChange: weighted(rows, "jsLag1"), weightedDrift100: weighted(rows, "jsLag100"), weightedEffectiveWidth: weighted(rows, "effectiveWidth"), cuts: rows, sumB: sum(snapshot.b), sumS: sum(snapshot.s), sumBPlusS: sum(snapshot.b) + sum(snapshot.s), transportMassResidual: snapshot.sedimentAfterTransport - snapshot.sedimentBeforeTransport, bedSedimentExchangeResidual: snapshot.stepExchangeResidual, ...distribution(snapshot) }; }
function runVariant(name, source) {
  const histories = Object.fromEntries(cuts.map((y) => [y, []])); const rows = {}, buffers = {}; let maxAbsTransportResidual = 0, transportResidualCumulative = 0, exchangeResidualCumulative = 0, maxAbsExchangeResidual = 0, maxAbsGlobalClosedResidual = 0, globalClosedResidualCumulative = 0, previousTotal = null, invalid = false;
  execute(source, 10000, (step, snapshot) => { const total = sum(snapshot.b) + sum(snapshot.s); if (step) { const transport = snapshot.sedimentAfterTransport - snapshot.sedimentBeforeTransport, exchange = snapshot.stepExchangeResidual, globalClosed = total - previousTotal; maxAbsTransportResidual = Math.max(maxAbsTransportResidual, Math.abs(transport)); transportResidualCumulative += transport; exchangeResidualCumulative += exchange; maxAbsExchangeResidual = Math.max(maxAbsExchangeResidual, Math.abs(exchange)); maxAbsGlobalClosedResidual = Math.max(maxAbsGlobalClosedResidual, Math.abs(globalClosed)); globalClosedResidualCumulative += globalClosed; if (!Number.isFinite(transport + exchange + globalClosed) || Math.abs(exchange) > 1e-6) invalid = true; for (const value of snapshot.s) if (!Number.isFinite(value) || value < -1e-8) invalid = true; } previousTotal = total; if ((step >= 4750 && step <= 5500) || checkpoints.includes(step)) rows[step] = observation(snapshot, histories); if (identityCheckpoints.includes(step)) buffers[step] = Object.fromEntries(["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"].map((key) => [key, new Float32Array(snapshot[key])])); });
  return { name, rows, buffers, conservation: { maxAbsTransportResidual, transportResidualCumulative, maxAbsExchangeResidual, exchangeResidualCumulative, maxAbsGlobalClosedResidual, globalClosedResidualCumulative, physicallyValid: !invalid && Math.abs(transportResidualCumulative) <= 1e-6 && Math.abs(exchangeResidualCumulative) <= 1e-6 } };
}
function lateProfile(run) { const rows = Object.entries(run.rows).filter(([step]) => Number(step) >= 4750 && Number(step) <= 5500).map(([, row]) => row); return { meanWeightedShapeChange: mean(rows.map((row) => row.weightedShapeChange).filter((value) => value !== null)), meanWeightedDrift100: mean(rows.map((row) => row.weightedDrift100).filter((value) => value !== null)), meanWeightedEffectiveWidth: mean(rows.map((row) => row.weightedEffectiveWidth).filter((value) => value !== null)) }; }
function benchmark(name, source) { const elapsed = () => { const start = performance.now(); execute(source, 1000, () => {}); return performance.now() - start; }; elapsed(); const ms = mean(Array.from({ length: 5 }, elapsed)); return { variant: name, steps: 1000, repetitions: 5, meanMilliseconds: ms, stepsPerSecond: 1000 / (ms / 1000) }; }
function classify(legacy, concentration) { const legacyEnd = legacy.rows[10000], concentrationEnd = concentration.rows[10000], legacyProfile = lateProfile(legacy), concentrationProfile = lateProfile(concentration); const meaningfulCuts = concentrationEnd.cuts.filter((cut, index) => Math.abs(cut.netSouthward) >= .7 * Math.abs(legacyEnd.cuts[index].netSouthward)).length; const candidate = concentration.conservation.physicallyValid && concentrationEnd.redepositionFraction >= .1 && concentrationEnd.redepositionFraction <= .9 && concentrationEnd.transportDistanceY > 0 && concentrationEnd.grossErosion >= .7 * legacyEnd.grossErosion && meaningfulCuts >= .7 * cuts.length && concentrationProfile.meanWeightedDrift100 <= legacyProfile.meanWeightedDrift100 * 1.25; let classification = "EXCHANGE-SEMANTICS D — CONSERVATIVE SYSTEM REMAINS EROSION-DOMINATED"; if (!Number.isFinite(concentrationEnd.grossErosion)) classification = "EXCHANGE-SEMANTICS E — SEMANTICS REQUIRE DIFFERENT CAPACITY MODEL"; else if (candidate) classification = "EXCHANGE-SEMANTICS A — CONCENTRATION EXCHANGE RESTORES CONSERVATIVE REDEPOSITION"; else if (concentrationEnd.redepositionFraction > .9 || concentrationProfile.meanWeightedDrift100 > legacyProfile.meanWeightedDrift100 * 1.25) classification = "EXCHANGE-SEMANTICS C — CONCENTRATION EXCHANGE OVER-DEPOSITS / DESTABILIZES"; else if (legacy.conservation.physicallyValid && legacyEnd.redepositionFraction >= .1 && legacyEnd.redepositionFraction <= .9 && legacyEnd.transportDistanceY > 0) classification = "EXCHANGE-SEMANTICS B — CONSERVATIVE LEGACY EXCHANGE IS ALREADY ADEQUATE"; return { classification, candidateEvidence: { meaningfulCuts, redepositionFraction: concentrationEnd.redepositionFraction, transportDistanceY: concentrationEnd.transportDistanceY, erosionVsLegacy: concentrationEnd.grossErosion / Math.max(legacyEnd.grossErosion, epsilon), driftVsLegacy: concentrationProfile.meanWeightedDrift100 / Math.max(legacyProfile.meanWeightedDrift100, epsilon) } }; }
function main() {
  const current = instrument(exchangeSource(currentSource, "LEGACY")); const legacyReference = instrument(exchangeSource(conservativeSource(), "LEGACY")); const legacy = instrument(exchangeSource(conservativeSource(), "LEGACY")); const concentration = instrument(exchangeSource(conservativeSource(), "CONCENTRATION"));
  const variants = [["CURRENT", current], ["CONSERVATIVE_LEGACY_EXCHANGE", legacy], ["CONSERVATIVE_CONCENTRATION_EXCHANGE", concentration]]; const runs = [];
  for (const [name, source] of variants) { progress(`[run] ${name}`); runs.push(runVariant(name, source)); progress(`[completed] ${name}`); }
  const byName = Object.fromEntries(runs.map((run) => [run.name, run])); const referenceBuffers = {}; execute(legacyReference, 10000, (step, snapshot) => { if (identityCheckpoints.includes(step)) referenceBuffers[step] = Object.fromEntries(["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"].map((key) => [key, new Float32Array(snapshot[key])])); });
  const legacyIdentity = Object.fromEntries(identityCheckpoints.map((step) => [step, Object.fromEntries(Object.keys(referenceBuffers[step]).map((key) => [key, maxDiff(referenceBuffers[step][key], byName.CONSERVATIVE_LEGACY_EXCHANGE.buffers[step][key])]))])); const legacyPasses = Object.values(legacyIdentity).every((row) => Object.values(row).every((value) => value === 0));
  if (!legacyPasses) throw new Error("CONSERVATIVE_LEGACY_EXCHANGE differs from validated CONSERVATIVE_TRANSPORT; STOP.");
  // Mass-capacity is an explicit alias: C is target cell mass, identical to legacy.
  const massCapacity = { ...byName.CONSERVATIVE_LEGACY_EXCHANGE, name: "CONSERVATIVE_MASS_CAPACITY", aliasOf: "CONSERVATIVE_LEGACY_EXCHANGE", semanticIdentity: "targetMass = C; no duplicate execution" };
  const performance = [benchmark("CONSERVATIVE_LEGACY_EXCHANGE", legacy), benchmark("CONSERVATIVE_CONCENTRATION_EXCHANGE", concentration)]; performance[1].overheadPercentVsLegacy = (performance[0].stepsPerSecond / performance[1].stepsPerSecond - 1) * 100;
  const result = classify(byName.CONSERVATIVE_LEGACY_EXCHANGE, byName.CONSERVATIVE_CONCENTRATION_EXCHANGE);
  const summary = { purpose: "Exchange-semantics comparison using flux-form conservative sediment transport.", definitions: { sediment: "s is sediment mass per cell", transportConcentration: "s / max(d, 1e-6)", dMin, transport: "outgoing face transfers are capped by donor sediment mass", current: "NON-CONSERVATIVE REFERENCE; transportMassResidual contaminates deposition budget", massCapacity: "Alias of legacy: both define targetMass = C." }, controls: { conservativeLegacyMatchesValidatedTransport: { passes: legacyPasses, checkpoints: identityCheckpoints, differences: legacyIdentity } }, variants: [...runs, massCapacity].map(({ buffers, ...run }) => ({ ...run, lateProfile: lateProfile(run) })), performance, classification: result.classification, classificationEvidence: result.candidateEvidence, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `classification: ${summary.classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${summary.classification}`); console.log(`CONSERVATIVE_LEGACY identity: PASS`); console.log(`CLASSIFICATION: ${summary.classification}`);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); throw error; }
