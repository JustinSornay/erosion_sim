/**
 * CATEGORY: EXPERIMENT
 * PURPOSE: Tests reference-depth concentration capacity under accepted positive conservative transport.
 * PRODUCTION: Reads simulation.js only; candidate physics exists solely in injected experiment source.
 * RUN: node tests/experiments/sediment/reference-depth-concentration-capacity.js
 */
const fs = require("fs");
const path = require("path");
const { conservativeSource } = require("./conservative-sediment-transport.js");
const { boundaryInstrumentation, positiveTransportSource, runVariant: acceptedLegacyRun } = require("./conservative-transport-positivity.js");

const root = path.resolve(__dirname, "../../..");
const output = path.join(root, "tests/generated/reference-depth-concentration-capacity");
const checkpoints = [100, 1000, 2500, 5000, 7500, 10000];
const reportSteps = [1000, 2500, 5000, 7500, 10000];
const cuts = [56, 60, 64, 68, 72, 76, 80, 84, 88, 92];
const fields = ["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"];
const bands = [[48, 64], [65, 80], [81, 96], [97, 128], [129, 191]];
const epsilon = 1e-30;
const dRef = .25;

fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, "COMPLETE"), { force: true });
fs.writeFileSync(path.join(output, "progress.log"), `[start] ${new Date().toISOString()}\n`);
const progress = (line) => fs.appendFileSync(path.join(output, "progress.log"), `${new Date().toISOString()} ${line}\n`);
const sum = (values) => { let result = 0; for (const value of values) result += value; return result; };
const mean = (values) => values.length ? sum(values) / values.length : null;
const ratio = (numerator, denominator) => numerator / Math.max(Math.abs(denominator), epsilon);
const percentile = (values, fraction) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * fraction)]; };
const finiteMean = (values) => mean(values.filter(Number.isFinite));

/** Keeps legacy capacity unchanged; candidate represents concentration capacity at production dNorm reference depth. */
function exchangeSource(mode) {
  const target = mode === "LEGACY_MASS_CAPACITY" ? "base * dNorm" : "(base / dRef) * d[i]";
  const replacement = `const dRef = ${dRef}; const base = KC * sinA * vel;
      const targetMass = ${target};
      const legacyTargetMass = base * dNorm;
      exchangeDiagnostic(diagnosticStepIndex, i, d[i], targetMass / Math.max(legacyTargetMass, 1e-30), targetMass);
      const si = s[i];
      if (targetMass > si) {
        const diff = KS * (targetMass - si) * sourceProtectionMask[i];
        b[i] -= diff; s[i] = si + diff; exchangeErosionByCell[i] += diff; stepErosion[i] += diff;
      } else {
        const diff = KD * (si - targetMass);
        b[i] += diff; s[i] = Math.max(0, si - diff); exchangeDepositionByCell[i] += diff; stepDeposition[i] += diff;
      }`;
  const pattern = /const C = KC \* sinA \* vel \* dNorm;\r?\n\s*const si = s\[i\];\r?\n\s*if \(C > si\) \{\r?\n\s*const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;\r?\n\s*\} else \{\r?\n\s*const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);\r?\n\s*\}/;
  const source = conservativeSource().replace(pattern, replacement);
  if (source === conservativeSource()) throw new Error(`Exchange injection failed: ${mode}`);
  return source;
}

function scan(values) { let min = Infinity, negative = 0, finite = true; for (const value of values) { min = Math.min(min, value); if (value < 0) negative++; finite &&= Number.isFinite(value); } return { min, negative, finite }; }
function copy(state) { return Object.fromEntries(fields.map((field) => [field, new Float32Array(state[field])])); }
function diff(left, right) { let maxAbsDiff = 0, total = 0; for (let i = 0; i < left.length; i++) { const value = Math.abs(left[i] - right[i]); maxAbsDiff = Math.max(maxAbsDiff, value); total += value; } return { maxAbsDiff, meanAbsDiff: total / left.length }; }
function weightedDistribution(values, weights) {
  const rows = values.map((value, index) => ({ value, weight: weights[index] })).filter(({ value, weight }) => Number.isFinite(value) && weight > 0).sort((a, b) => a.value - b.value);
  const total = sum(rows.map(({ weight }) => weight)); if (!total) return { mean: null, p50: null, p90: null, p99: null, max: null };
  let running = 0, weightedSum = 0; const at = (fraction) => { const threshold = total * fraction; for (const row of rows) { running += row.weight; if (running >= threshold) { running = 0; return row.value; } } running = 0; return rows.at(-1).value; };
  for (const row of rows) weightedSum += row.value * row.weight;
  return { mean: weightedSum / total, p50: at(.5), p90: at(.9), p99: at(.99), max: rows.at(-1).value };
}
function cutMetrics(state, histories) {
  return cuts.map((y) => { let netSouthward = 0, totalPositiveSouth = 0; const values = [];
    for (let x = 0; x < state.N; x++) { const flux = state.fB[(y - 1) * state.N + x] - state.fT[y * state.N + x]; netSouthward += flux; const positive = Math.max(0, flux); totalPositiveSouth += positive; values.push(positive); }
    const probabilities = totalPositiveSouth ? values.map((value) => value / totalPositiveSouth) : null; const prior = histories && histories[y].at(-1), lag100 = histories && histories[y].at(-100);
    if (histories) { histories[y].push(probabilities); if (histories[y].length > 100) histories[y].shift(); }
    const divergence = (left, right) => { if (!left || !right) return null; let result = 0; for (let i = 0; i < left.length; i++) { const middle = (left[i] + right[i]) / 2; if (left[i]) result += .5 * left[i] * Math.log(left[i] / middle); if (right[i]) result += .5 * right[i] * Math.log(right[i] / middle); } return result; };
    let entropy = 0; if (probabilities) for (const value of probabilities) if (value) entropy -= value * Math.log(value);
    return { y, netSouthward, totalPositiveSouth, weightedShapeChange: divergence(probabilities, prior), weightedDrift100: divergence(probabilities, lag100), weightedEffectiveWidth: probabilities ? Math.exp(entropy) : null };
  });
}
function morphology(state) {
  let grossErosion = 0, grossDeposition = 0, absoluteNetBedChange = 0, erosionY = 0, depositionY = 0; const erosionYs = [], depositionYs = []; const spatialBands = bands.map(([from, to]) => ({ from, to, grossErosion: 0, grossDeposition: 0, absoluteNetBedChange: 0 }));
  for (let i = 0; i < state.NN; i++) { const y = (i / state.N) | 0, erosion = state.erosion[i], deposition = state.deposition[i], bedChange = Math.abs(state.b[i] - state.bInit[i]); grossErosion += erosion; grossDeposition += deposition; absoluteNetBedChange += bedChange; erosionY += y * erosion; depositionY += y * deposition;
    if (erosion) erosionYs.push([y, erosion]); if (deposition) depositionYs.push([y, deposition]); const band = spatialBands.find(({ from, to }) => y >= from && y <= to); if (band) { band.grossErosion += erosion; band.grossDeposition += deposition; band.absoluteNetBedChange += bedChange; }
  }
  const weightedY = (rows, fraction) => { const total = sum(rows.map(([, weight]) => weight)); let running = 0; for (const [y, weight] of rows) { running += weight; if (running >= total * fraction) return y; } return null; };
  return { grossErosion, grossDeposition, grossTurnover: grossErosion + grossDeposition, absoluteNetBedChange, suspendedSedimentMass: sum(state.s), netErosion: grossErosion - grossDeposition, erosionCentroidY: erosionY / Math.max(grossErosion, epsilon), depositionCentroidY: depositionY / Math.max(grossDeposition, epsilon), transportDistanceY: depositionY / Math.max(grossDeposition, epsilon) - erosionY / Math.max(grossErosion, epsilon), erosionQuantilesY: Object.fromEntries([.25, .5, .75, .9].map((p) => [`p${p * 100}Y`, weightedY(erosionYs, p)])), depositionQuantilesY: Object.fromEntries([.25, .5, .75, .9].map((p) => [`p${p * 100}Y`, weightedY(depositionYs, p)])), spatialBands };
}
function depthAudit(state, stepErosion, stepDeposition) {
  let wet = 0, below = 0, above = 0, flux = 0, fluxAbove = 0, erosion = 0, erosionAbove = 0, deposition = 0, depositionAbove = 0; const values = [], fluxWeights = [], erosionWeights = [];
  for (let i = 0; i < state.NN; i++) { const depth = state.d[i]; if (depth <= 1e-12) continue; wet++; const isAbove = depth > dRef; below += isAbove ? 0 : 1; above += isAbove ? 1 : 0; const fluxWeight = Math.abs(state.fL[i]) + Math.abs(state.fR[i]) + Math.abs(state.fT[i]) + Math.abs(state.fB[i]); const erosionWeight = stepErosion[i], depositionWeight = stepDeposition[i], targetRatio = isAbove ? depth / dRef : 1; flux += fluxWeight; fluxAbove += isAbove ? fluxWeight : 0; erosion += erosionWeight; erosionAbove += isAbove ? erosionWeight : 0; deposition += depositionWeight; depositionAbove += isAbove ? depositionWeight : 0; values.push(targetRatio); fluxWeights.push(fluxWeight); erosionWeights.push(erosionWeight); }
  return { fractionWetCellsBelowRef: below / Math.max(wet, 1), fractionWetCellsAboveRef: above / Math.max(wet, 1), fractionFluxAtDepthAboveRef: fluxAbove / Math.max(flux, epsilon), fractionErosionAtDepthAboveRef: erosionAbove / Math.max(erosion, epsilon), fractionDepositionAtDepthAboveRef: depositionAbove / Math.max(deposition, epsilon), targetRatioDistribution: { waterFluxWeighted: weightedDistribution(values, fluxWeights), erosionActivityWeighted: weightedDistribution(values, erosionWeights) } };
}

function runObserved(name, mode, maximumSteps = 10000) {
  const source = boundaryInstrumentation(positiveTransportSource(exchangeSource(mode))); const checkpointsData = {}, late = [], histories = Object.fromEntries(cuts.map((y) => [y, []]));
  const conservation = { maxAbsTransportResidual: 0, netTransportResidual: 0, cumulativeAbsTransportResidual: 0, totalSedimentThroughput: 0 }; const validation = { minimumS: Infinity, minimumTmpS: Infinity, numberNegativeS: 0, numberNegativeTmpS: 0, allFinite: true, maxOutgoingMinusAvailable: -Infinity, maxOutgoingOverAvailableRatio: 0, negativeContribution: null, preTransportNegative: null, stop: null };
  let beforeTransport = 0, completedSteps = maximumSteps, initialSumS = null;
  const callback = (step, state) => { const sInfo = scan(state.s), tmpInfo = scan(state.tmpS); validation.minimumS = Math.min(validation.minimumS, sInfo.min); validation.minimumTmpS = Math.min(validation.minimumTmpS, tmpInfo.min); validation.numberNegativeS += sInfo.negative; validation.numberNegativeTmpS += tmpInfo.negative; validation.allFinite &&= sInfo.finite && tmpInfo.finite; if (step === 0) initialSumS = sum(state.s);
    const audit = depthAudit(state, state.stepErosion, state.stepDeposition); if (checkpoints.includes(step)) checkpointsData[step] = { buffers: copy(state), morphology: morphology(state), cuts: cutMetrics(state), depthAudit: audit }; if (step >= 4750 && step <= 5500) { const rows = cutMetrics(state, histories); const weighted = (field) => { const valid = rows.filter((row) => row[field] !== null), weight = sum(valid.map((row) => row.totalPositiveSouth)); return weight ? sum(valid.map((row) => row.totalPositiveSouth * row[field])) / weight : null; }; late.push({ step, weightedShapeChange: weighted("weightedShapeChange"), weightedDrift100: weighted("weightedDrift100"), weightedEffectiveWidth: weighted("weightedEffectiveWidth") }); }
    state.stepErosion.fill(0); state.stepDeposition.fill(0);
  };
  const begin = (_, sediment) => { beforeTransport = sum(sediment); };
  const end = (_, sediment) => { const residual = sum(sediment) - beforeTransport; conservation.maxAbsTransportResidual = Math.max(conservation.maxAbsTransportResidual, Math.abs(residual)); conservation.netTransportResidual += residual; conservation.cumulativeAbsTransportResidual += Math.abs(residual); conservation.totalSedimentThroughput += Math.abs(beforeTransport); };
  const donor = (_, __, available, outgoing) => { validation.maxOutgoingMinusAvailable = Math.max(validation.maxOutgoingMinusAvailable, outgoing - available); validation.maxOutgoingOverAvailableRatio = Math.max(validation.maxOutgoingOverAvailableRatio, outgoing / Math.max(available, epsilon)); };
  const contribution = (step, donorIndex, receiver, value, tmpS) => { if (value < 0 && !validation.negativeContribution) validation.negativeContribution = { step, donorIndex, receiver, value }; tmpS[receiver] += value; };
  const pre = (step, index, value) => { if (value < 0 && !validation.preTransportNegative) { validation.preTransportNegative = { step, index, value }; throw Error("PRE_TRANSPORT_NEGATIVE"); } };
  const stop = (kind, step, index, detail) => { validation.stop = { kind, step, index, detail }; throw Error(kind); };
  const diagnostic = () => {};
  try {
    const math = Object.create(Math); math.random = () => .3141592653;
    new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "callback", "transportBegin", "transportEnd", "transportDonor", "transportContribution", "positivityPreTransport", "positivityStop", "exchangeDiagnostic", `let roundingResidualCorrection = 0; ${source}
      const exchangeErosionByCell = new Float64Array(NN), exchangeDepositionByCell = new Float64Array(NN), stepErosion = new Float64Array(NN), stepDeposition = new Float64Array(NN); genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); let diagnosticStepIndex = 0;
      callback(0, { N, NN, b, bInit, d, s, tmpS, u, v, fL, fR, fT, fB, erosion: exchangeErosionByCell, deposition: exchangeDepositionByCell, stepErosion, stepDeposition, roundingResidualCorrection });
      for (diagnosticStepIndex = 1; diagnosticStepIndex <= ${maximumSteps}; diagnosticStepIndex++) { step(); callback(diagnosticStepIndex, { N, NN, b, bInit, d, s, tmpS, u, v, fL, fR, fT, fB, erosion: exchangeErosionByCell, deposition: exchangeDepositionByCell, stepErosion, stepDeposition, roundingResidualCorrection }); }`)(math, Float32Array, Float64Array, Int32Array, Uint8Array, callback, begin, end, donor, contribution, pre, stop, diagnostic);
  } catch (error) { completedSteps = validation.stop || validation.preTransportNegative ? Math.min(maximumSteps, checkpoints.at(-1)) : 0; if (!validation.stop && !validation.preTransportNegative) validation.stop = { kind: error.message }; }
  const final = checkpointsData[10000]?.morphology; const sedimentBudget = final && { initialSumS, finalSumS: final.suspendedSedimentMass, deltaSumS: final.suspendedSedimentMass - initialSumS, grossErosion: final.grossErosion, grossDeposition: final.grossDeposition, expectedDeltaS: final.grossErosion - final.grossDeposition, budgetResidual: final.suspendedSedimentMass - initialSumS - (final.grossErosion - final.grossDeposition), relativeBudgetResidual: Math.abs(final.suspendedSedimentMass - initialSumS - (final.grossErosion - final.grossDeposition)) / Math.max(final.grossErosion + final.grossDeposition, epsilon) };
  return { name, mode, completedSteps, validation, conservation, checkpoints: Object.fromEntries(Object.entries(checkpointsData).map(([step, data]) => [step, { morphology: data.morphology, cuts: data.cuts, depthAudit: data.depthAudit }])), buffers: Object.fromEntries(Object.entries(checkpointsData).map(([step, data]) => [step, data.buffers])), late, sedimentBudget };
}

function benchmark(name, mode) { const samples = []; for (let repeat = 0; repeat < 5; repeat++) { const start = performance.now(); runObserved(name, mode, 1000); samples.push(performance.now() - start); } const milliseconds = mean(samples); return { variant: name, steps: 1000, repetitions: 5, meanMilliseconds: milliseconds, stepsPerSecond: 1000 / (milliseconds / 1000) }; }
function compareBuffers(control, run) { return Object.fromEntries([100, 1000, 5000, 10000].map((step) => [step, Object.fromEntries(fields.map((field) => [field, diff(control.buffers[step][field], run.buffers[step][field])]))])); }
function profile(run) { return Object.fromEntries(["weightedShapeChange", "weightedDrift100", "weightedEffectiveWidth"].map((field) => [`mean${field.slice(0, 1).toUpperCase()}${field.slice(1)}`, finiteMean(run.late.map((row) => row[field]))])); }
function spatialShares(metrics) { const rows = metrics.spatialBands; const range = (from, to, field) => sum(rows.filter((row) => row.from >= from && row.to <= to).map((row) => row[field])) / Math.max(metrics[field], epsilon); return { erosionShareNear: range(48, 64, "grossErosion"), erosionShareMid: range(65, 96, "grossErosion"), erosionShareDown: range(97, 191, "grossErosion"), depositionShareNear: range(48, 64, "grossDeposition"), depositionShareMid: range(65, 96, "grossDeposition"), depositionShareDown: range(97, 191, "grossDeposition") }; }
function classify(legacy, candidate, cutRetention, driftRatio) { const l = legacy.checkpoints[10000].morphology, c = candidate.checkpoints[10000].morphology, erosionRatio = ratio(c.grossErosion, l.grossErosion), turnoverRatio = ratio(c.grossTurnover, l.grossTurnover); const positive = [legacy, candidate].every((run) => !run.validation.stop && !run.validation.preTransportNegative && run.validation.numberNegativeS === 0 && run.validation.numberNegativeTmpS === 0); const conserved = [legacy, candidate].every((run) => Math.abs(run.conservation.netTransportResidual) <= 1e-5 && Math.abs(run.conservation.netTransportResidual) / Math.max(run.conservation.totalSedimentThroughput, epsilon) <= 1e-6 && run.sedimentBudget.relativeBudgetResidual <= 1e-6); if (!positive || !conserved) return "CAPACITY-REF D â€” DEEP-WATER CAPACITY BECOMES OVERACTIVE"; if (erosionRatio < .5) return "CAPACITY-REF C â€” EXCHANGE STILL COLLAPSES"; if (erosionRatio > 2) return "CAPACITY-REF D â€” DEEP-WATER CAPACITY BECOMES OVERACTIVE"; if (erosionRatio >= .5 && erosionRatio <= 2 && turnoverRatio >= .5 && turnoverRatio <= 2 && cutRetention >= .7 && driftRatio <= 1.25 && c.transportDistanceY > l.transportDistanceY) return "CAPACITY-REF A â€” REFERENCE-DEPTH CONCENTRATION IS COHERENT AND ACTIVE"; return "CAPACITY-REF E â€” ACTIVITY PRESERVED BUT SPATIAL BEHAVIOR NOT IMPROVED"; }

function main() {
  progress("[control] accepted POSITIVE_CONSERVATIVE_LEGACY"); const control = acceptedLegacyRun("POSITIVE_CONSERVATIVE_LEGACY_CONTROL", "LEGACY", true);
  progress("[run] POSITIVE_LEGACY_MASS_CAPACITY"); const legacy = runObserved("POSITIVE_LEGACY_MASS_CAPACITY", "LEGACY_MASS_CAPACITY"); const legacyReproduction = compareBuffers(control, legacy); const legacyBitIdentical = Object.values(legacyReproduction).every((step) => Object.values(step).every(({ maxAbsDiff }) => maxAbsDiff === 0)); if (!legacyBitIdentical) throw Error("LEGACY_BIT_IDENTICAL_CONTROL_FAILED"); progress("[legacy-bit-identical] PASS");
  progress("[run] POSITIVE_REFERENCE_DEPTH_CONCENTRATION"); const candidate = runObserved("POSITIVE_REFERENCE_DEPTH_CONCENTRATION", "REFERENCE_DEPTH_CONCENTRATION");
  const legacyProfile = profile(legacy), candidateProfile = profile(candidate); const profileRatios = Object.fromEntries(Object.keys(legacyProfile).map((field) => [field, ratio(candidateProfile[field], legacyProfile[field])])); const legacyCuts = legacy.checkpoints[10000].cuts, candidateCuts = candidate.checkpoints[10000].cuts, maximumLegacyCut = Math.max(...legacyCuts.map((cut) => Math.abs(cut.netSouthward))); const cutComparison = [5000, 10000].map((step) => ({ step, cuts: legacy.checkpoints[step].cuts.map((cut, index) => { const other = candidate.checkpoints[step].cuts[index]; return { y: cut.y, legacyNetSouthward: cut.netSouthward, candidateNetSouthward: other.netSouthward, legacyTotalPositiveSouth: cut.totalPositiveSouth, candidateTotalPositiveSouth: other.totalPositiveSouth, ratioAbsNet: ratio(other.netSouthward, cut.netSouthward), sameSign: Math.sign(other.netSouthward) === Math.sign(cut.netSouthward) }; }) })); const meaningful = cutComparison.find(({ step }) => step === 10000).cuts.filter((cut) => Math.abs(cut.legacyNetSouthward) >= .1 * maximumLegacyCut); const retained = meaningful.filter((cut) => cut.sameSign && Math.abs(cut.candidateNetSouthward) >= .7 * Math.abs(cut.legacyNetSouthward)); const cutRetention = retained.length / Math.max(meaningful.length, 1);
  const l10000 = legacy.checkpoints[10000].morphology, c10000 = candidate.checkpoints[10000].morphology; const activityRatios = Object.fromEntries(["grossErosion", "grossDeposition", "grossTurnover", "absoluteNetBedChange", "suspendedSedimentMass", "netErosion"].map((field) => [field, ratio(c10000[field], l10000[field])])); const classification = classify(legacy, candidate, cutRetention, profileRatios.meanWeightedDrift100);
  const performance = [benchmark("POSITIVE_LEGACY_MASS_CAPACITY", "LEGACY_MASS_CAPACITY"), benchmark("POSITIVE_REFERENCE_DEPTH_CONCENTRATION", "REFERENCE_DEPTH_CONCENTRATION")]; performance[1].overheadPercentVsLegacy = (performance[0].stepsPerSecond / performance[1].stepsPerSecond - 1) * 100;
  const summary = { purpose: "Reference-depth concentration capacity experiment using accepted positivity-preserving conservative transport; production remains unchanged.", definitions: { dRef, legacyTargetMass: "KC * sinA * vel * min(1, d / dRef)", candidateTargetMass: "(KC * sinA * vel / dRef) * d", targetRatio: "1 for d <= dRef; d / dRef for d > dRef", current: "Historical CURRENT is non-conservative; historical total deposition is not a target." }, variants: [legacy, candidate].map(({ buffers, ...run }) => run), legacyBitIdenticalControl: { passed: legacyBitIdentical, checkpoints: legacyReproduction }, activityRatiosAt10000: activityRatios, profiles4750to5500: { legacy: legacyProfile, candidate: candidateProfile, ratios: profileRatios }, cutComparison, cutRetentionAt10000: { meaningfulCuts: meaningful.length, retainedCuts: retained.length, cutRetention }, spatializationAt10000: { legacy: { bands: l10000.spatialBands, shares: spatialShares(l10000) }, candidate: { bands: c10000.spatialBands, shares: spatialShares(c10000) } }, performance, classification, completedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2)); fs.writeFileSync(path.join(output, "COMPLETE"), `classification: ${classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${classification}`); console.log(classification);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); throw error; }
