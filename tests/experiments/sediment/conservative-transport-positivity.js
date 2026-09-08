/**
 * CATEGORY: EXPERIMENT
 * PURPOSE: Tests a donor-side positivity invariant for experimental conservative transport.
 * PRODUCTION: Reads simulation.js; performs all source changes in memory only.
 * RUN: node tests/experiments/sediment/conservative-transport-positivity.js
 */
const fs = require("fs");
const path = require("path");
const { conservativeSource } = require("./conservative-sediment-transport.js");

const root = path.resolve(__dirname, "../../..");
const output = path.join(root, "tests/generated/conservative-transport-positivity");
const checkpoints = [100, 299, 1000, 5000, 10000];
const cuts = [56, 60, 64, 68, 72, 76, 80, 84, 88, 92];
const compareFields = ["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"];
const epsilon = 1e-30;

fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, "COMPLETE"), { force: true });
fs.writeFileSync(path.join(output, "progress.log"), `[start] ${new Date().toISOString()}\n`);
const progress = (line) => fs.appendFileSync(path.join(output, "progress.log"), `${new Date().toISOString()} ${line}\n`);
const sum = (values) => { let total = 0; for (const value of values) total += value; return total; };
const mean = (values) => values.length ? sum(values) / values.length : null;
const ratio = (numerator, denominator) => numerator / Math.max(Math.abs(denominator), epsilon);

/** Only exchange target changes between variants: C for legacy, C*d for concentration. */
function exchangeSource(mode) {
  const target = mode === "CONCENTRATION" ? "C * d[i]" : "C";
  const replacement = `const C = KC * sinA * vel * dNorm;
      const si = s[i]; const targetMass = ${target};
      if (targetMass > si) {
        const diff = KS * (targetMass - si) * sourceProtectionMask[i];
        b[i] -= diff; s[i] = si + diff; exchangeErosionByCell[i] += diff;
      } else {
        const diff = KD * (si - targetMass);
        b[i] += diff; s[i] = Math.max(0, si - diff); exchangeDepositionByCell[i] += diff;
      }`;
  const pattern = /const C = KC \* sinA \* vel \* dNorm;\r?\n\s*const si = s\[i\];\r?\n\s*if \(C > si\) \{\r?\n\s*const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;\r?\n\s*\} else \{\r?\n\s*const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);\r?\n\s*\}/;
  const source = conservativeSource().replace(pattern, replacement);
  if (source === conservativeSource()) throw new Error(`Exchange injection failed: ${mode}`);
  return source;
}

const oldTransport = `      const requestedOutSediment = outL + outR + outT + outB;
      if (requestedOutSediment > s[i] && requestedOutSediment > 0) {
        const limiter = s[i] / requestedOutSediment;
        outL *= limiter; outR *= limiter; outT *= limiter; outB *= limiter;
      }
      tmpS[i] += s[i] - outL - outR - outT - outB;
      if (x > 0) tmpS[i - 1] += outL;
      if (x < N - 1) tmpS[i + 1] += outR;
      if (y > 0) tmpS[i - N] += outT;
      if (y < N - 1) tmpS[i + N] += outB;
      d[i] *= 1 - KE * DT;`;

/** Replaces only donor sediment outputs; water fluxes, concentration, and exchange remain unchanged. */
function positiveTransportSource(source) {
  const replacement = `      const available = s[i];
      positivityPreTransport(diagnosticStepIndex, i, available);
      const requestedOutSediment = outL + outR + outT + outB;
      let limiter = 1;
      if (requestedOutSediment > available && requestedOutSediment > 0) {
        limiter = available / requestedOutSediment;
        outL *= limiter; outR *= limiter; outT *= limiter; outB *= limiter;
      }
      let realisedOut = outL + outR + outT + outB;
      if (realisedOut > available) {
        const excess = realisedOut - available;
        let largest = outL, direction = "L";
        if (outR > largest) { largest = outR; direction = "R"; }
        if (outT > largest) { largest = outT; direction = "T"; }
        if (outB > largest) { largest = outB; direction = "B"; }
        if (largest <= 0 || largest < excess) positivityStop("POST_CAP_DIRECTION_FAILURE", diagnosticStepIndex, i, { available, realisedOut, excess });
        if (direction === "L") outL -= excess;
        else if (direction === "R") outR -= excess;
        else if (direction === "T") outT -= excess;
        else outB -= excess;
        realisedOut = outL + outR + outT + outB;
      }
      if (realisedOut > available + 1e-15) positivityStop("POST_CAP_INVARIANT_FAILURE", diagnosticStepIndex, i, { available, realisedOut });
      let retained = available - realisedOut;
      if (retained < 0 && retained >= -1e-15) { roundingResidualCorrection += -retained; retained = 0; }
      if (retained < -1e-15) positivityStop("NEGATIVE_RETAINED_FAILURE", diagnosticStepIndex, i, { available, realisedOut, retained });
      if (outL < 0 || outR < 0 || outT < 0 || outB < 0 || retained < 0) positivityStop("NEGATIVE_CONTRIBUTION", diagnosticStepIndex, i, { outL, outR, outT, outB, retained });
      transportDonor(diagnosticStepIndex, i, available, realisedOut, limiter);
      transportContribution(diagnosticStepIndex, i, i, retained, tmpS);
      if (x > 0) transportContribution(diagnosticStepIndex, i, i - 1, outL, tmpS);
      if (x < N - 1) transportContribution(diagnosticStepIndex, i, i + 1, outR, tmpS);
      if (y > 0) transportContribution(diagnosticStepIndex, i, i - N, outT, tmpS);
      if (y < N - 1) transportContribution(diagnosticStepIndex, i, i + N, outB, tmpS);
      d[i] *= 1 - KE * DT;`;
  const result = source.replace(oldTransport, replacement);
  if (result === source) throw new Error("Positive transport injection failed");
  return result;
}

/** Adds observational hooks outside original transport body, preserving original arithmetic verbatim. */
function boundaryInstrumentation(source) {
  let result = source.replace("  tmpS.fill(0);", "  transportBegin(diagnosticStepIndex, s);\n  tmpS.fill(0);");
  const swap = `  {
    const t = s;
    s = tmpS;
    tmpS = t;
  }`;
  result = result.replace(swap, `${swap}\n  transportEnd(diagnosticStepIndex, s, tmpS);`);
  if (!result.includes("transportBegin") || !result.includes("transportEnd")) throw new Error("Transport boundary injection failed");
  return result;
}

function snapshot(N, NN, b, bInit, d, s, u, v, fL, fR, fT, fB, erosion, deposition) { return { N, NN, b, bInit, d, s, u, v, fL, fR, fT, fB, erosion, deposition }; }
function execute(source, maximumSteps, callback) {
  const math = Object.create(Math); math.random = () => .3141592653;
  return new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "callback", "transportBegin", "transportEnd", "transportDonor", "transportContribution", "positivityPreTransport", "positivityStop", `${source}
    let roundingResidualCorrection = 0; const exchangeErosionByCell = new Float64Array(NN), exchangeDepositionByCell = new Float64Array(NN);
    genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    let diagnosticStepIndex = 0;
    callback(0, ${snapshot.toString().match(/return (.*);/)[1]});
    for (diagnosticStepIndex = 1; diagnosticStepIndex <= ${maximumSteps}; diagnosticStepIndex++) { step(); callback(diagnosticStepIndex, ${snapshot.toString().match(/return (.*);/)[1]}); }
  `)(math, Float32Array, Float64Array, Int32Array, Uint8Array, callback, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
}

function scan(values) { let min = Infinity, negative = 0, finite = true; for (let i = 0; i < values.length; i++) { const value = values[i]; min = Math.min(min, value); if (value < 0) negative++; if (!Number.isFinite(value)) finite = false; } return { min, negative, finite }; }
function copyBuffers(state) { return Object.fromEntries(compareFields.map((key) => [key, new Float32Array(state[key]) ])); }
function fieldDiff(left, right) { let maximum = 0, total = 0; for (let i = 0; i < left.length; i++) { const value = Math.abs(left[i] - right[i]); maximum = Math.max(maximum, value); total += value; } return { maxAbsDiff: maximum, meanAbsDiff: total / left.length }; }
function cutMetrics(state, histories) { return cuts.map((y) => { let netSouthward = 0, totalPositiveSouth = 0; const values = []; for (let x = 0; x < state.N; x++) { const flux = state.fB[(y - 1) * state.N + x] - state.fT[y * state.N + x]; netSouthward += flux; const positive = Math.max(0, flux); totalPositiveSouth += positive; values.push(positive); } const p = totalPositiveSouth ? values.map((value) => value / totalPositiveSouth) : null; const prior = histories && histories[y].at(-1), lag100 = histories && histories[y].at(-100); if (histories) { histories[y].push(p); if (histories[y].length > 100) histories[y].shift(); } const divergence = (left, right) => { if (!left || !right) return null; let result = 0; for (let i = 0; i < left.length; i++) { const mid = (left[i] + right[i]) / 2; if (left[i]) result += .5 * left[i] * Math.log(left[i] / mid); if (right[i]) result += .5 * right[i] * Math.log(right[i] / mid); } return result; }; let entropy = 0; if (p) for (const value of p) if (value) entropy -= value * Math.log(value); return { y, netSouthward, totalPositiveSouth, weightedShapeChange: divergence(p, prior), weightedDrift100: divergence(p, lag100), weightedEffectiveWidth: p ? Math.exp(entropy) : null }; }); }
function morphology(state) {
  let grossErosion = 0, grossDeposition = 0, absoluteNetBedChange = 0, erosionY = 0, depositionY = 0;
  for (let i = 0; i < state.NN; i++) { const y = (i / state.N) | 0; const e = state.erosion[i], d = state.deposition[i]; grossErosion += e; grossDeposition += d; erosionY += y * e; depositionY += y * d; absoluteNetBedChange += Math.abs(state.b[i] - state.bInit[i]); }
  return { grossErosion, grossDeposition, grossTurnover: grossErosion + grossDeposition, absoluteNetBedChange, redepositionFraction: grossDeposition / Math.max(grossErosion, epsilon), erosionCentroidY: erosionY / Math.max(grossErosion, epsilon), depositionCentroidY: depositionY / Math.max(grossDeposition, epsilon), transportDistanceY: depositionY / Math.max(grossDeposition, epsilon) - erosionY / Math.max(grossErosion, epsilon) };
}

function runVariant(name, mode, positive, maximumSteps = 10000) {
  const exchange = exchangeSource(mode); const source = boundaryInstrumentation(positive ? positiveTransportSource(exchange) : exchange);
  const checkpointsData = {}, late = [], histories = Object.fromEntries(cuts.map((y) => [y, []])), conservation = { maxAbsTransportResidual: 0, netTransportResidual: 0, cumulativeAbsTransportResidual: 0, analyticalDonorResidual: 0, float32GlobalStorageResidual: 0, roundingResidualCorrection: 0, totalSedimentThroughput: 0 };
  const validation = { minimumS: Infinity, minimumTmpS: Infinity, numberNegativeS: 0, numberNegativeTmpS: 0, allFinite: true, maxOutgoingMinusAvailable: -Infinity, maxOutgoingOverAvailableRatio: 0, negativeContribution: null, preTransportNegative: null, stop: null };
  const erosion = new Float64Array(192 * 192), deposition = new Float64Array(192 * 192); let beforeTransport = null, stepDonorResidual = 0, stepIndex = 0;
  const oldExecute = execute;
  const math = Object.create(Math); math.random = () => .3141592653;
  const callback = (step, state) => {
    state.erosion = state.erosion || erosion; state.deposition = state.deposition || deposition; conservation.roundingResidualCorrection = state.roundingResidualCorrection || 0; const sInfo = scan(state.s), tmpInfo = scan(state.tmpS); validation.minimumS = Math.min(validation.minimumS, sInfo.min); validation.minimumTmpS = Math.min(validation.minimumTmpS, tmpInfo.min); validation.numberNegativeS += sInfo.negative; validation.numberNegativeTmpS += tmpInfo.negative; validation.allFinite &&= sInfo.finite && tmpInfo.finite;
    if (checkpoints.includes(step)) checkpointsData[step] = { buffers: copyBuffers(state), morphology: morphology(state), cuts: cutMetrics(state) };
    if (step >= 4750 && step <= 5500) { const cut = cutMetrics(state, histories); const weighted = (field) => { const rows = cut.filter((row) => row[field] !== null); const weight = sum(rows.map((row) => row.totalPositiveSouth)); return weight ? sum(rows.map((row) => row.totalPositiveSouth * row[field])) / weight : null; }; late.push({ step, weightedShapeChange: weighted("weightedShapeChange"), weightedDrift100: weighted("weightedDrift100"), weightedEffectiveWidth: weighted("weightedEffectiveWidth") }); }
  };
  const transportBegin = (step, s) => { stepIndex = step; beforeTransport = sum(s); stepDonorResidual = 0; };
  const transportEnd = (step, s) => { const residual = sum(s) - beforeTransport; conservation.maxAbsTransportResidual = Math.max(conservation.maxAbsTransportResidual, Math.abs(residual)); conservation.netTransportResidual += residual; conservation.cumulativeAbsTransportResidual += Math.abs(residual); conservation.analyticalDonorResidual += stepDonorResidual; conservation.float32GlobalStorageResidual += residual - stepDonorResidual; conservation.totalSedimentThroughput += Math.abs(beforeTransport); };
  const donor = (step, index, available, realisedOut) => { validation.maxOutgoingMinusAvailable = Math.max(validation.maxOutgoingMinusAvailable, realisedOut - available); validation.maxOutgoingOverAvailableRatio = Math.max(validation.maxOutgoingOverAvailableRatio, realisedOut / Math.max(available, epsilon)); stepDonorResidual += available - realisedOut - (available - realisedOut); };
  const contribution = (step, donorIndex, receiver, value, tmpS) => { if (value < 0 && !validation.negativeContribution) validation.negativeContribution = { step, donorIndex, receiver, value }; tmpS[receiver] += value; };
  const pre = (step, index, available) => { if (available < 0 && !validation.preTransportNegative) { validation.preTransportNegative = { step, index, value: available }; throw Object.assign(new Error("PRE_TRANSPORT_NEGATIVE"), { diagnostic: validation.preTransportNegative }); } };
  const stop = (kind, step, index, detail) => { validation.stop = { kind, step, index, detail }; throw Object.assign(new Error(kind), { diagnostic: validation.stop }); };
  try {
    new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "callback", "transportBegin", "transportEnd", "transportDonor", "transportContribution", "positivityPreTransport", "positivityStop", `let roundingResidualCorrection = 0;
      ${source}
      const exchangeErosionByCell = new Float64Array(NN), exchangeDepositionByCell = new Float64Array(NN); genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
      let diagnosticStepIndex = 0; callback(0, { N, NN, b, bInit, d, s, tmpS, u, v, fL, fR, fT, fB, erosion: exchangeErosionByCell, deposition: exchangeDepositionByCell, roundingResidualCorrection });
      for (diagnosticStepIndex = 1; diagnosticStepIndex <= ${maximumSteps}; diagnosticStepIndex++) { step(); callback(diagnosticStepIndex, { N, NN, b, bInit, d, s, tmpS, u, v, fL, fR, fT, fB, erosion: exchangeErosionByCell, deposition: exchangeDepositionByCell, roundingResidualCorrection }); }
    `)(math, Float32Array, Float64Array, Int32Array, Uint8Array, callback, transportBegin, transportEnd, donor, contribution, pre, stop);
  } catch (error) { if (!validation.stop && !validation.preTransportNegative) validation.stop = { kind: error.message }; }
  return { name, mode, positive, completedSteps: validation.stop || validation.preTransportNegative ? stepIndex : maximumSteps, validation, conservation, checkpoints: Object.fromEntries(Object.entries(checkpointsData).map(([step, data]) => [step, { morphology: data.morphology, cuts: data.cuts }])), buffers: Object.fromEntries(Object.entries(checkpointsData).map(([step, data]) => [step, data.buffers])), late };
}

/** Locates first original negative without applying positivity correction or threshold. */
function firstOriginalNegative() {
  let source = exchangeSource("CONCENTRATION");
  const replacement = `      const requestedOutSediment = outL + outR + outT + outB;
      if (requestedOutSediment > s[i] && requestedOutSediment > 0) { const limiter = s[i] / requestedOutSediment; outL *= limiter; outR *= limiter; outT *= limiter; outB *= limiter; }
      auditContribution(diagnosticStepIndex, i, i, s[i] - outL - outR - outT - outB, tmpS);
      if (x > 0) auditContribution(diagnosticStepIndex, i, i - 1, outL, tmpS);
      if (x < N - 1) auditContribution(diagnosticStepIndex, i, i + 1, outR, tmpS);
      if (y > 0) auditContribution(diagnosticStepIndex, i, i - N, outT, tmpS);
      if (y < N - 1) auditContribution(diagnosticStepIndex, i, i + N, outB, tmpS);
      d[i] *= 1 - KE * DT;`;
  source = source.replace(oldTransport, replacement); if (!source.includes("auditContribution")) throw new Error("Original audit injection failed");
  let found = null; const math = Object.create(Math); math.random = () => .3141592653;
  const audit = (step, donor, receiver, value, tmpS) => { const before = tmpS[receiver]; tmpS[receiver] += value; if (!found && tmpS[receiver] < 0) found = { step, stage: "TMP_S_ACCUMULATION", index: receiver, value: tmpS[receiver], origin: receiver === donor ? "retained contribution" : "incoming transfer", donorIndex: donor, contribution: value, before }; };
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "auditContribution", `${source}
    const exchangeErosionByCell = new Float64Array(NN), exchangeDepositionByCell = new Float64Array(NN); genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); let diagnosticStepIndex = 0;
    for (diagnosticStepIndex = 1; diagnosticStepIndex <= 10000; diagnosticStepIndex++) step();
  `)(math, Float32Array, Float64Array, Int32Array, Uint8Array, audit);
  return found;
}

function benchmark(name, mode, positive) { const samples = []; for (let repeat = 0; repeat < 5; repeat++) { const start = performance.now(); runVariant(name, mode, positive, 1000); samples.push(performance.now() - start); } const milliseconds = mean(samples); return { variant: name, steps: 1000, repetitions: 5, meanMilliseconds: milliseconds, stepsPerSecond: 1000 / (milliseconds / 1000) }; }
function compareLegacy(original, positive) { return Object.fromEntries(checkpoints.map((step) => [step, Object.fromEntries(compareFields.map((field) => [field, fieldDiff(original.buffers[step][field], positive.buffers[step][field])]))])); }
function classify(legacy, concentration) {
  const legacyValid = !legacy.validation.stop && !legacy.validation.preTransportNegative && legacy.validation.numberNegativeS === 0 && legacy.validation.numberNegativeTmpS === 0 && Math.abs(legacy.conservation.netTransportResidual) <= 1e-5 && Math.abs(legacy.conservation.netTransportResidual) / Math.max(legacy.conservation.totalSedimentThroughput, epsilon) <= 1e-6;
  const concentrationValid = !concentration.validation.stop && !concentration.validation.preTransportNegative && concentration.validation.numberNegativeS === 0 && concentration.validation.numberNegativeTmpS === 0;
  if (!legacyValid) return "POSITIVITY C — FIX BREAKS MASS CONSERVATION";
  if (!concentrationValid) return "POSITIVITY B — NEGATIVE PROPAGATION FIXED BUT CONCENTRATION STILL FAILS";
  return "POSITIVITY A — MINIMAL FIX RESTORES NONNEGATIVE CONSERVATIVE TRANSPORT";
}
function main() {
  const originalNegative = firstOriginalNegative(); progress(`[original-first-negative] ${JSON.stringify(originalNegative)}`);
  const variants = [
    ["ORIGINAL_CONSERVATIVE_LEGACY", "LEGACY", false], ["POSITIVE_CONSERVATIVE_LEGACY", "LEGACY", true],
    ["ORIGINAL_CONSERVATIVE_CONCENTRATION", "CONCENTRATION", false], ["POSITIVE_CONSERVATIVE_CONCENTRATION", "CONCENTRATION", true],
  ];
  const runs = []; for (const [name, mode, positive] of variants) { progress(`[run] ${name}`); runs.push(runVariant(name, mode, positive)); progress(`[completed] ${name}`); }
  const byName = Object.fromEntries(runs.map((run) => [run.name, run]));
  const performance = [benchmark("ORIGINAL_CONSERVATIVE_LEGACY", "LEGACY", false), benchmark("POSITIVE_CONSERVATIVE_LEGACY", "LEGACY", true)]; performance[1].overheadPercentVsOriginal = (performance[0].stepsPerSecond / performance[1].stepsPerSecond - 1) * 100;
  const legacyComparison = compareLegacy(byName.ORIGINAL_CONSERVATIVE_LEGACY, byName.POSITIVE_CONSERVATIVE_LEGACY);
  const classification = classify(byName.POSITIVE_CONSERVATIVE_LEGACY, byName.POSITIVE_CONSERVATIVE_CONCENTRATION);
  const budget = (run) => run.checkpoints[10000].morphology; const originalBudget = budget(byName.ORIGINAL_CONSERVATIVE_LEGACY), positiveBudget = budget(byName.POSITIVE_CONSERVATIVE_LEGACY); const legacyBudget = Object.fromEntries(["grossErosion", "grossDeposition", "grossTurnover", "absoluteNetBedChange", "redepositionFraction", "erosionCentroidY", "depositionCentroidY"].map((field) => [field, { original: originalBudget[field], positive: positiveBudget[field], ratioPositiveOverOriginal: ratio(positiveBudget[field], originalBudget[field]) }]));
  const summary = { purpose: "Positivity-preserving donor cap experiment for conservative transport; production remains unchanged.", definitions: { sediment: "s is sediment mass per cell", legacyTargetMass: "C", concentrationTargetMass: "C*d", correction: "Positive donor outputs are proportionally capped; only post-scale arithmetic excess is removed from largest positive outflow." }, originalConcentrationFirstNegative: originalNegative, variants: runs.map(({ buffers, ...run }) => run), legacyPerturbation: legacyComparison, legacyBudget, performance, classification, completedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2)); fs.writeFileSync(path.join(output, "COMPLETE"), `classification: ${classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${classification}`); console.log(classification);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); throw error; }
