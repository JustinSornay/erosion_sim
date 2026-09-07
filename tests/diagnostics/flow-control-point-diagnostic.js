/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Maps route changes across absolute horizontal grid boundaries. This isolated
 * CURRENT run deliberately has no frozen-path, dynamic-path, or percentile
 * network dependency; production simulation and physics are never modified.
 *
 * RUN: node tests/diagnostics/flow-control-point-diagnostic.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/flow-control-point");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const cuts = Array.from({ length: 27 }, (_, index) => 56 + index * 4);
const keyCuts = [64, 80, 96, 112, 128, 144];
const keySteps = [4500, 4600, 4683, 4750, 4811, 4824, 4900, 4969, 5000, 5100, 5200, 5500];
const persistenceLength = 20;
const baselineStart = 4300;
const baselineEnd = 4400;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()} CURRENT deterministic flow-control-point diagnostic\n`);
const progress = (message) => fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => sum(values) / Math.max(values.length, 1);
const finiteMean = (values) => mean(values.filter(Number.isFinite));
const observeStep = (step) => [1000, 2500, 4000].includes(step) || (step >= 4300 && step <= 5200) || (step > 5200 && step <= 5500 && step % 5 === 0);

/** Captures direct per-step bed exchange only inside evaluated source text. */
function instrumentedSource() {
  let source = `${currentSource}\nlet diagnosticStepErosion = new Float64Array(NN); let diagnosticStepDeposition = new Float64Array(NN);`;
  source = source.replace(/const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, "const diff = KS * (C - si) * sourceProtectionMask[i]; diagnosticStepErosion[i] = diff; b[i] -= diff; s[i] = si + diff;");
  source = source.replace(/const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, "const diff = KD * (si - C); diagnosticStepDeposition[i] = diff; b[i] += diff; s[i] = Math.max(0, si - diff);");
  if (!source.includes("diagnosticStepErosion[i] = diff") || !source.includes("diagnosticStepDeposition[i] = diff")) throw new Error("Diagnostic instrumentation injection failed");
  return source;
}

function smooth(values) { return Array.from(values, (value, index) => (values[Math.max(0, index - 1)] + 2 * value + values[Math.min(values.length - 1, index + 1)]) / 4); }
function weightedQuantile(values, weights, fraction) {
  const rows = values.map((value, index) => ({ value, weight: weights[index] })).sort((a, b) => a.value - b.value);
  const total = sum(weights); let running = 0;
  for (const row of rows) { running += row.weight; if (running >= total * fraction) return row.value; }
  return null;
}
function weightedCentroid(values, weights) { const total = sum(weights); return total ? sum(values.map((value, index) => value * weights[index])) / total : null; }
function peakMetrics(values) {
  const smoothed = smooth(values); const maximum = Math.max(...smoothed); const modeX = smoothed.indexOf(maximum);
  const peakList = smoothed.map((value, x) => ({ x, value })).filter(({ x, value }) => (x === 0 && value >= smoothed[1]) || (x === smoothed.length - 1 && value >= smoothed[x - 1]) || (x > 0 && x < smoothed.length - 1 && value >= smoothed[x - 1] && value > smoothed[x + 1])).sort((a, b) => b.value - a.value);
  const primary = peakList[0] || { x: modeX, value: maximum };
  const secondary = peakList.find((peak) => Math.abs(peak.x - primary.x) > 3);
  const count = (fraction) => peakList.filter((peak) => peak.value >= maximum * fraction).length;
  return { modeX, smoothed, peaks: peakList, unimodalityScore: sum(values.filter((_, x) => Math.abs(x - modeX) <= 3)) / Math.max(sum(values), 1e-12), secondaryPeakFraction: (secondary?.value || 0) / Math.max(primary.value, 1e-12), numberOfPeaks: count(.1), peakSensitivity: { relative5Percent: count(.05), relative10Percent: count(.1), relative20Percent: count(.2) } };
}
function topPeaks(values, limit = 2) { return peakMetrics(values).peaks.slice(0, limit).map(({ x, value }) => ({ x, flux: value })); }
function distribution(values) {
  const xs = values.map((_, x) => x); const totalPositiveSouth = sum(values); const centroidX = weightedCentroid(xs, values);
  const metrics = peakMetrics(values);
  return { totalPositiveSouth, centroidX, medianX: weightedQuantile(xs, values, .5), modeX: metrics.modeX, stdX: centroidX === null ? null : Math.sqrt(sum(values.map((value, x) => value * (x - centroidX) ** 2)) / Math.max(totalPositiveSouth, 1e-12)), p10X: weightedQuantile(xs, values, .1), p90X: weightedQuantile(xs, values, .9), unimodalityScore: metrics.unimodalityScore, secondaryPeakFraction: metrics.secondaryPeakFraction, numberOfPeaks: metrics.numberOfPeaks, peakSensitivity: metrics.peakSensitivity, topFluxPeaks: topPeaks(values) };
}
function morphDistribution(erosion, deposition) {
  const absolute = erosion.map((value, x) => Math.abs(deposition[x] - value)); const xs = absolute.map((_, x) => x);
  return { morphCentroidX: weightedCentroid(xs, absolute), erosionCentroidX: weightedCentroid(xs, erosion), depositionCentroidX: weightedCentroid(xs, deposition), totalErosionStep: sum(erosion), totalDepositionStep: sum(deposition), totalAbsNetBedChangeStep: sum(absolute) };
}
function cutSnapshot(snapshot, y) {
  const positiveSouth = []; const erosion = []; const deposition = []; const bed = []; const depth = []; const head = [];
  let grossSouthward = 0; let grossNorthward = 0;
  for (let x = 0; x < snapshot.N; x++) {
    const northCell = y * snapshot.N + x; const southCell = (y - 1) * snapshot.N + x;
    const southward = snapshot.fB[southCell]; const northward = snapshot.fT[northCell];
    grossSouthward += southward; grossNorthward += northward; positiveSouth.push(Math.max(0, southward - northward));
    let e = 0; let d = 0; let b = 0; let h = 0;
    for (let row = Math.max(0, y - 3); row <= Math.min(snapshot.N - 1, y + 3); row++) { const i = row * snapshot.N + x; e += snapshot.diagnosticStepErosion[i]; d += snapshot.diagnosticStepDeposition[i]; b += snapshot.b[i]; h += snapshot.b[i] + snapshot.d[i]; }
    erosion.push(e); deposition.push(d); bed.push(b / 7); depth.push(snapshot.d[northCell]); head.push(h / 7);
  }
  return { ...distribution(positiveSouth), grossSouthward, grossNorthward, netSouthward: grossSouthward - grossNorthward, ...morphDistribution(erosion, deposition), profile: { positiveSouth: Float32Array.from(positiveSouth), erosion: Float32Array.from(erosion), deposition: Float32Array.from(deposition), bed: Float32Array.from(bed), depth: Float32Array.from(depth), head: Float32Array.from(head) } };
}
function baselineFor(rows, y) {
  const sections = rows.map((row) => row.cuts[y]); const averageProfile = (key) => sections[0].profile[key].map((_, x) => mean(sections.map((section) => section.profile[key][x])));
  return { centroidX: finiteMean(sections.map((section) => section.centroidX)), stdX: finiteMean(sections.map((section) => section.stdX)), modeX: Math.round(finiteMean(sections.map((section) => section.modeX))), morphCentroidX: finiteMean(sections.map((section) => section.morphCentroidX)), totalPositiveSouth: finiteMean(sections.map((section) => section.totalPositiveSouth)), netSouthward: finiteMean(sections.map((section) => section.netSouthward)), profile: Object.fromEntries(["positiveSouth", "bed", "depth", "head"].map((key) => [key, averageProfile(key)])) };
}
function firstPersistent(rows, value, threshold = 4) {
  let sign = 0; let run = 0;
  for (const row of rows) { const candidate = value(row); const nextSign = Math.sign(candidate || 0); if (Math.abs(candidate || 0) >= threshold && nextSign === sign) run++; else { sign = Math.abs(candidate || 0) >= threshold ? nextSign : 0; run = sign ? 1 : 0; } if (run >= persistenceLength) return { step: row.step - persistenceLength + 1, sign }; }
  return null;
}
function firstPersistentSplit(rows, y) { let run = 0; for (const row of rows) { const section = row.cuts[y]; run = section.secondaryPeakFraction >= .5 && section.unimodalityScore <= .5 ? run + 1 : 0; if (run >= persistenceLength) return row.step - persistenceLength + 1; } return null; }
function correlation(pairs) { const xs = pairs.map((pair) => pair[0]); const ys = pairs.map((pair) => pair[1]); const mx = mean(xs); const my = mean(ys); const numerator = sum(xs.map((x, index) => (x - mx) * (ys[index] - my))); const denominator = Math.sqrt(sum(xs.map((x) => (x - mx) ** 2)) * sum(ys.map((y) => (y - my) ** 2))); return denominator ? numerator / denominator : null; }
function rank(values) { return values.map((value) => 1 + values.filter((other) => other < value).length + (values.filter((other) => other === value).length - 1) / 2); }
function propagation(results) {
  const pairs = cuts.map((y) => [y, results[y].firstPersistentShiftStep]).filter(([, step]) => Number.isFinite(step)); const deltas = cuts.slice(0, -1).map((y) => results[y + 4].firstPersistentShiftStep === null || results[y].firstPersistentShiftStep === null ? null : results[y + 4].firstPersistentShiftStep - results[y].firstPersistentShiftStep).filter(Number.isFinite);
  const medianDeltaStep = deltas.length ? [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)] : null; const direction = Math.sign(medianDeltaStep || 0); const fractionSameDirection = direction ? deltas.filter((delta) => Math.sign(delta) === direction).length / deltas.length : 0; const pearson = pairs.length >= 5 ? correlation(pairs) : null; const rankY = rank(pairs.map((pair) => pair[1])); const spearman = pairs.length >= 5 ? correlation(rank(pairs.map((pair) => pair[0])).map((value, index) => [value, rankY[index]])) : null;
  const spatialOrder = pairs.length < 5 ? "INSUFFICIENT" : pearson >= .6 && fractionSameDirection >= .7 ? "DOWNSTREAM PROPAGATION" : pearson <= -.6 && fractionSameDirection >= .7 ? "UPSTREAM PROPAGATION" : "DISTRIBUTED";
  return { validShiftCuts: pairs.length, deltaSteps: deltas, medianDeltaStep, fractionSameDirection, pearsonYFirstShift: pearson, spearmanYFirstShift: spearman, spatialOrder };
}
function windowMean(profile, center) { const indices = Array.from({ length: 5 }, (_, index) => Math.max(0, Math.min(profile.bed.length - 1, center - 2 + index))); return { meanBed: mean(indices.map((x) => profile.bed[x])), meanDepth: mean(indices.map((x) => profile.depth[x])), meanHead: mean(indices.map((x) => profile.head[x])) }; }
function eventEvidence(rows, result, baseline) {
  if (!result.firstPersistentShiftStep) return null;
  const start = result.firstPersistentShiftStep; const before = rows.find((row) => row.step === start - 1) || rows.find((row) => row.step === start); const after = rows.find((row) => row.step === start + persistenceLength - 1) || rows.find((row) => row.step === start);
  const beforeSection = before.cuts[result.y]; const afterSection = after.cuts[result.y];
  return { y: result.y, step: start, centroidBefore: beforeSection.centroidX, centroidAfter: afterSection.centroidX, modeBefore: beforeSection.modeX, modeAfter: afterSection.modeX, stdBefore: beforeSection.stdX, stdAfter: afterSection.stdX, secondaryPeakBefore: beforeSection.secondaryPeakFraction, secondaryPeakAfter: afterSection.secondaryPeakFraction, totalPositiveSouthBefore: beforeSection.totalPositiveSouth, totalPositiveSouthAfter: afterSection.totalPositiveSouth, topFluxPeaksBefore: topPeaks(beforeSection.profile.positiveSouth), topFluxPeaksAfter: topPeaks(afterSection.profile.positiveSouth), baselineModeX: baseline.modeX };
}
function controlCandidate(rows, result, baseline) {
  const evidence = eventEvidence(rows, result, baseline); if (!evidence) return null;
  const oldX = baseline.modeX; const newX = evidence.modeAfter; const prior = rows.filter((row) => row.step >= evidence.step - 100 && row.step < evidence.step).map((row) => row.cuts[result.y].profile);
  const current = rows.find((row) => row.step === evidence.step + persistenceLength - 1).cuts[result.y].profile;
  const oldNow = windowMean(current, oldX); const newNow = windowMean(current, newX); const oldBase = windowMean(baseline.profile, oldX); const newBase = windowMean(baseline.profile, newX);
  const accumulated = (key, x) => sum(prior.map((profile) => sum(profile[key].slice(Math.max(0, x - 2), x + 3))));
  const route = (x, now, base) => ({ x, ...now, deltaBed: now.meanBed - base.meanBed, deltaHead: now.meanHead - base.meanHead, erosion: accumulated("erosion", x), deposition: accumulated("deposition", x), netBed: accumulated("deposition", x) - accumulated("erosion", x) });
  return { y: result.y, shiftStep: evidence.step, oldPeak: route(oldX, oldNow, oldBase), newPeak: route(newX, newNow, newBase), topFluxPeaksBefore: evidence.topFluxPeaksBefore, topFluxPeaksAfter: evidence.topFluxPeaksAfter, routeHeadInterpretation: { newRouteLowerHead: newNow.meanHead < newBase.meanHead, oldRouteHigherHead: oldNow.meanHead > oldBase.meanHead } };
}
function main() {
  const rows = [];
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", `${instrumentedSource()}\n genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const snapshot = () => ({ N, NN, b, d, fT, fB, source: sourcePoint, diagnosticStepErosion, diagnosticStepDeposition }); for (let stepIndex = 1; stepIndex <= 5500; stepIndex++) { step(); observe(stepIndex, snapshot()); diagnosticStepErosion.fill(0); diagnosticStepDeposition.fill(0); }`)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Float64Array, Int32Array, Uint8Array, (step, snapshot) => {
    if (!observeStep(step)) return;
    rows.push({ step, cuts: Object.fromEntries(cuts.map((y) => [y, cutSnapshot(snapshot, y)])) });
    if (step % 250 === 0) progress(`[observe] step=${step}`);
  });
  const baselineRows = rows.filter((row) => row.step >= baselineStart && row.step <= baselineEnd); const baseline = Object.fromEntries(cuts.map((y) => [y, baselineFor(baselineRows, y)]));
  const denseRows = rows.filter((row) => row.step >= 4400 && row.step <= 5200);
  for (const row of rows) for (const y of cuts) { const section = row.cuts[y]; section.lateralShift = section.centroidX - baseline[y].centroidX; section.widthChange = section.stdX / baseline[y].stdX; section.morphShift = section.morphCentroidX - baseline[y].morphCentroidX; section.normalizedNetSouthward = section.netSouthward / baseline[y].netSouthward; }
  const results = Object.fromEntries(cuts.map((y) => { const hydraulic = firstPersistent(denseRows, (row) => row.cuts[y].lateralShift); const morph = firstPersistent(denseRows, (row) => row.cuts[y].morphShift); const split = firstPersistentSplit(denseRows, y); return [y, { y, baseline: { baselineCentroidX: baseline[y].centroidX, baselineStdX: baseline[y].stdX, baselineModeX: baseline[y].modeX, baselineMorphCentroidX: baseline[y].morphCentroidX }, firstPersistentShiftStep: hydraulic?.step ?? null, hydraulicShiftSign: hydraulic?.sign ?? null, firstPersistentSplitStep: split, firstPersistentMorphShiftStep: morph?.step ?? null, morphShiftSign: morph?.sign ?? null, morphLeadLag: hydraulic && morph ? hydraulic.step - morph.step : null }]; }));
  const propagationSummary = propagation(results); const earliestShift = Object.values(results).filter((result) => result.firstPersistentShiftStep !== null).sort((a, b) => a.firstPersistentShiftStep - b.firstPersistentShiftStep)[0] || null; const earliestSplit = Object.values(results).filter((result) => result.firstPersistentSplitStep !== null).sort((a, b) => a.firstPersistentSplitStep - b.firstPersistentSplitStep)[0] || null;
  const primary = propagationSummary.spatialOrder === "DOWNSTREAM PROPAGATION" || propagationSummary.spatialOrder === "UPSTREAM PROPAGATION" ? "CONTROL-POINT A — SINGLE LOCAL ROUTE SWITCH" : propagationSummary.validShiftCuts >= 2 ? "CONTROL-POINT B — MULTIPLE LOCAL ROUTE SWITCHES" : "CONTROL-POINT F — NO ROBUST LOCAL CONTROL STRUCTURE";
  const lags = Object.values(results).map((result) => result.morphLeadLag).filter(Number.isFinite); const causal = lags.length >= 3 && lags.filter((lag) => lag > 25).length / lags.length >= .6 ? "C — MORPHOLOGY-LED LOCAL SWITCH" : lags.length >= 3 && lags.filter((lag) => lag < -25).length / lags.length >= .6 ? "D — HYDRAULIC-LED LOCAL SWITCH" : lags.length >= 3 && lags.filter((lag) => Math.abs(lag) <= 25).length / lags.length >= .6 ? "E — COUPLED LOCAL SWITCHES" : null;
  const classification = causal ? `${primary} + ${causal}` : primary;
  const earliestEvidence = earliestShift ? eventEvidence(denseRows, earliestShift, baseline[earliestShift.y]) : null;
  const candidates = Object.values(results).filter((result) => result.firstPersistentShiftStep !== null).sort((a, b) => a.firstPersistentShiftStep - b.firstPersistentShiftStep).slice(0, 5).map((result) => controlCandidate(denseRows, result, baseline[result.y]));
  const keyTimeline = keySteps.map((step) => { const row = rows.find((entry) => entry.step === step); return { step, cuts: Object.fromEntries(keyCuts.map((y) => { const section = row?.cuts[y]; return [y, section ? Object.fromEntries(["centroidX", "lateralShift", "stdX", "secondaryPeakFraction", "totalPositiveSouth", "netSouthward", "morphCentroidX", "normalizedNetSouthward"].map((key) => [key, section[key]])) : null]; })) }; });
  const matrices = { steps: denseRows.map((row) => row.step), cuts, lateralShift: denseRows.map((row) => cuts.map((y) => row.cuts[y].lateralShift)), secondaryPeakFraction: denseRows.map((row) => cuts.map((y) => row.cuts[y].secondaryPeakFraction)) };
  const timeline = rows.map((row) => ({ step: row.step, cuts: Object.fromEntries(cuts.map((y) => { const section = row.cuts[y]; return [y, Object.fromEntries(["centroidX", "lateralShift", "widthChange", "modeX", "stdX", "p10X", "p90X", "unimodalityScore", "secondaryPeakFraction", "numberOfPeaks", "peakSensitivity", "totalPositiveSouth", "grossSouthward", "grossNorthward", "netSouthward", "normalizedNetSouthward", "morphCentroidX", "erosionCentroidX", "depositionCentroidX", "morphShift"].map((key) => [key, section[key]]))]; })) }));
  const summary = { controls: { run: "CURRENT only", deterministicRandom: .3141592653, simulationSteps: 5500, snapshotCadence: "1000,2500,4000; every step 4300..5200; every 5 steps 5205..5500", productionSimulationModified: false, productionPhysicsModified: false }, methodology: { spatialReference: "absolute grid x/y only; no frozen path, dynamic path, ACTIVE percentile, or frozen-path normals", cuts: "horizontal boundaries y=56..160 in increments of four", faceFlux: "southward=fB[(y-1)N+x]; northward=fT[yN+x]; positiveSouth=max(0,southward-northward)", morphology: "step-local erosion/deposition observed across rows y-3..y+3", smoothing: "three-point triangular [1,2,1]/4", persistence: "absolute lateral/morph shift >=4 cells with unchanged sign for 20 steps", splitPersistence: "secondaryPeakFraction >=0.5 and unimodalityScore <=0.5 for 20 steps" }, baseline: { range: "4300..4400", cuts: Object.fromEntries(cuts.map((y) => [y, results[y].baseline])) }, cutResults: results, propagation: propagationSummary, earliestPersistentShiftCut: earliestShift ? { y: earliestShift.y, step: earliestShift.firstPersistentShiftStep } : null, earliestPersistentSplitCut: earliestSplit ? { y: earliestSplit.y, step: earliestSplit.firstPersistentSplitStep } : null, earliestShiftEvidence: earliestEvidence, fiveEarliestHydraulicControls: candidates, classification, classificationBasis: { primary, causalSubLabel: causal, note: "Net southward transport remains an independent metric; route movement is not interpreted as vertical transport loss." }, keyTimeline, matrices, timeline, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${classification}; earliestShift=${summary.earliestPersistentShiftCut?.step ?? null}`); console.log(classification);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
