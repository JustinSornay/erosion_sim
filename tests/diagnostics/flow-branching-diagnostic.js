/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Measures continuous hydraulic partitioning around CURRENT's source and
 * CURRENT@1000 frozen path. The isolated evaluated source records exchange
 * only; production simulation and production physics remain unchanged.
 *
 * RUN: node tests/diagnostics/flow-branching-diagnostic.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/flow-branching");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const radii = [8, 12, 16, 24, 32, 48];
const positions = [8, 16, 24, 32, 40, 48];
const keyRadii = [16, 24, 32];
const keySteps = [4500, 4600, 4683, 4750, 4811, 4824, 4900, 4969, 5000, 5250, 5500, 5850, 6000];
const wetThreshold = 1e-6;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()} CURRENT deterministic flow-branching diagnostic\n`);
const progress = (message) => fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`);
const observeStep = (step) => [1000, 2500, 4000, 4500].includes(step) || (step >= 4500 && step <= 5200) || (step >= 5200 && step % 10 === 0);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Captures step-local exchange without changing production source files. */
function instrumentedSource() {
  let source = `${currentSource}\nlet diagnosticStepErosion = new Float64Array(NN); let diagnosticStepDeposition = new Float64Array(NN);`;
  source = source.replace(/const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, "const diff = KS * (C - si) * sourceProtectionMask[i]; diagnosticStepErosion[i] = diff; b[i] -= diff; s[i] = si + diff;");
  source = source.replace(/const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, "const diff = KD * (si - C); diagnosticStepDeposition[i] = diff; b[i] += diff; s[i] = Math.max(0, si - diff);");
  if (!source.includes("diagnosticStepErosion[i] = diff") || !source.includes("diagnosticStepDeposition[i] = diff")) throw new Error("Diagnostic instrumentation injection failed");
  return source;
}
function traceFrozenPath(snapshot) {
  const cells = []; const used = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0];
  for (let count = 0; count < 64 && !used[cell]; count++) {
    cells.push(cell); used[cell] = 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; let next = -1; let projection = 0;
    for (const [dx, dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]) { const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const score = snapshot.u[cell] * dx + snapshot.v[cell] * dy; const candidate = ny * snapshot.N + nx; if (!used[candidate] && score > projection) { projection = score; next = candidate; } }
    if (next < 0) break; cell = next;
  }
  return cells;
}
function distributionMetrics(values) {
  const total = sum(values); const fractions = values.map((value) => value / Math.max(total, 1e-12)); const nonEmpty = fractions.filter((value) => value > 0).length;
  const entropy = -sum(fractions.filter((value) => value > 0).map((value) => value * Math.log(value)));
  const sorted = [...fractions].sort((a, b) => b - a);
  return { total, fractions, dominantBinFraction: sorted[0] || 0, top2BinFraction: sum(sorted.slice(0, 2)), top4BinFraction: sum(sorted.slice(0, 4)), angularEntropy: entropy, entropyNormalized: entropy / Math.log(Math.max(2, nonEmpty)), effectiveBranchCount: Math.exp(entropy), nonEmptyBins: nonEmpty };
}
function radialMetrics(snapshot, radius) {
  const bins = Array(32).fill(0), erosion = Array(32).fill(0), deposition = Array(32).fill(0); const { x: sx, y: sy } = snapshot.source;
  for (let i = 0; i < snapshot.NN; i++) { const dx = i % snapshot.N - sx, dy = ((i / snapshot.N) | 0) - sy, distance = Math.hypot(dx, dy); if (Math.abs(distance - radius) > .75 || !distance) continue; const rx = dx / distance, ry = dy / distance, speed = Math.hypot(snapshot.u[i], snapshot.v[i]); const bin = clamp(Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 32), 0, 31); const qRadial = snapshot.d[i] * speed * Math.max(0, (snapshot.u[i] * rx + snapshot.v[i] * ry) / Math.max(speed, 1e-12)); bins[bin] += qRadial; erosion[bin] += snapshot.diagnosticStepErosion[i]; deposition[bin] += snapshot.diagnosticStepDeposition[i]; }
  const hydraulic = distributionMetrics(bins), morph = distributionMetrics(erosion.map((value, index) => value + deposition[index]));
  return { ...hydraulic, grossErosionStep: sum(erosion), grossDepositionStep: sum(deposition), netBedChangeStep: sum(deposition) - sum(erosion), hydraulicAngularDistribution: hydraulic.fractions, morphChangeAngularDistribution: morph.fractions, morphEffectiveBranchCount: morph.effectiveBranchCount, morphDominantBinFraction: morph.dominantBinFraction, morphAngularEntropy: morph.angularEntropy, hydroMorphDistributionDistance: sum(hydraulic.fractions.map((value, index) => Math.abs(value - morph.fractions[index]))) };
}
function tangent(pathCells, position, N) { const before = pathCells[Math.max(0, position - 1)], after = pathCells[Math.min(pathCells.length - 1, position + 1)]; const dx = after % N - before % N, dy = ((after / N) | 0) - ((before / N) | 0), length = Math.hypot(dx, dy) || 1; return { x: dx / length, y: dy / length }; }
function faceProjected(snapshot, index, tx, ty) { const right = snapshot.fR[index] - snapshot.fL[index], down = snapshot.fB[index] - snapshot.fT[index]; return Math.max(0, right * tx + down * ty); }
function countPeaks(values, sensitivity) { const smooth = values.map((_, index) => (values[Math.max(0, index - 1)] + 2 * values[index] + values[Math.min(values.length - 1, index + 1)]) / 4); const threshold = Math.max(...smooth) * sensitivity; let peaks = 0; for (let i = 1; i < smooth.length - 1; i++) if (smooth[i] >= threshold && smooth[i] >= smooth[i - 1] && smooth[i] > smooth[i + 1]) peaks++; return peaks; }
function sectionMetrics(snapshot, pathCells, position) {
  if (position >= pathCells.length) return null;
  const center = pathCells[position], cx = center % snapshot.N, cy = (center / snapshot.N) | 0, downstream = tangent(pathCells, position, snapshot.N), normal = { x: -downstream.y, y: downstream.x };
  const rows = [];
  for (let offset = -30; offset <= 30; offset++) { const x = Math.round(cx + normal.x * offset), y = Math.round(cy + normal.y * offset); if (x < 0 || y < 0 || x >= snapshot.N || y >= snapshot.N) continue; const i = y * snapshot.N + x, speed = Math.hypot(snapshot.u[i], snapshot.v[i]); rows.push({ offset, q: snapshot.d[i] * Math.max(0, snapshot.u[i] * downstream.x + snapshot.v[i] * downstream.y), face: faceProjected(snapshot, i, downstream.x, downstream.y), erosion: snapshot.diagnosticStepErosion[i], deposition: snapshot.diagnosticStepDeposition[i] }); }
  const total = sum(rows.map((row) => row.q)), faceTotal = sum(rows.map((row) => row.face)); const weighted = (key) => sum(rows.map((row) => row.offset * row[key])) / Math.max(total, 1e-12); const centroidOffset = weighted("q"); const qValues = rows.map((row) => row.q);
  const groups = { oldCore: 0, nearBranches: 0, farBranches: 0 }; for (const row of rows) { if (Math.abs(row.offset) <= 2) groups.oldCore += row.q; else if (Math.abs(row.offset) <= 10) groups.nearBranches += row.q; else groups.farBranches += row.q; }
  const sorted = [...rows].sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset)); let cumulative = 0, p90AbsoluteOffset = 0; for (const row of sorted) { cumulative += row.q; if (cumulative >= total * .9) { p90AbsoluteOffset = Math.abs(row.offset); break; } }
  return { totalProjectedQ: total, netCrossSectionFlux: faceTotal, centroidOffset, stdOffset: Math.sqrt(sum(rows.map((row) => row.q * (row.offset - centroidOffset) ** 2)) / Math.max(total, 1e-12)), p90AbsoluteOffset, numberOfPeaks: countPeaks(qValues, .1), numberOfPeaksSensitivity: { relative5Percent: countPeaks(qValues, .05), relative20Percent: countPeaks(qValues, .2) }, oldCoreFraction: groups.oldCore / Math.max(total, 1e-12), nearBranchFraction: groups.nearBranches / Math.max(total, 1e-12), farBranchFraction: groups.farBranches / Math.max(total, 1e-12), qProjectedLateralDistribution: qValues.map((value) => value / Math.max(total, 1e-12)), faceFluxLateralDistribution: rows.map((row) => row.face / Math.max(faceTotal, 1e-12)), faceFluxShapeL1Distance: sum(rows.map((row) => Math.abs(row.q / Math.max(total, 1e-12) - row.face / Math.max(faceTotal, 1e-12)))), grossErosionStep: sum(rows.map((row) => row.erosion)), grossDepositionStep: sum(rows.map((row) => row.deposition)), netBedChangeStep: sum(rows.map((row) => row.deposition - row.erosion)) };
}
function sustained(rows, predicate, length) { let run = 0; for (let i = 0; i < rows.length; i++) { run = predicate(rows[i]) ? run + 1 : 0; if (run >= length) return rows[i - length + 1].step; } return null; }
function main() {
  const rows = []; let frozenPath = null;
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", `${instrumentedSource()}\n genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const snapshot = () => ({ N, NN, b, d, u, v, fL, fR, fT, fB, source: sourcePoint, diagnosticStepErosion, diagnosticStepDeposition }); for (let stepIndex = 1; stepIndex <= 6000; stepIndex++) { step(); observe(stepIndex, snapshot()); diagnosticStepErosion.fill(0); diagnosticStepDeposition.fill(0); }`)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Float64Array, Int32Array, Uint8Array, (step, snapshot) => {
    if (step === 1000) { frozenPath = traceFrozenPath(snapshot); progress(`[reference] frozenPath=CURRENT@1000 cells=${frozenPath.length}`); }
    if (!frozenPath || !observeStep(step)) return;
    const radiusMetrics = Object.fromEntries(radii.map((radius) => [radius, radialMetrics(snapshot, radius)])); const sectionMetricsByPosition = Object.fromEntries(positions.map((position) => [position, sectionMetrics(snapshot, frozenPath, position)])); const historicalFrozenQ = sum(frozenPath.map((i) => snapshot.d[i] * Math.hypot(snapshot.u[i], snapshot.v[i])));
    rows.push({ step, downstreamHistoricalFrozenQ: historicalFrozenQ, radii: radiusMetrics, sections: sectionMetricsByPosition });
  });
  const baselineRows = rows.filter((row) => row.step >= 4500 && row.step <= 4600); const baseline = Object.fromEntries(keyRadii.map((radius) => [radius, { effectiveBranchCount: sum(baselineRows.map((row) => row.radii[radius].effectiveBranchCount)) / baselineRows.length, dominantBinFraction: sum(baselineRows.map((row) => row.radii[radius].dominantBinFraction)) / baselineRows.length, morphEffectiveBranchCount: sum(baselineRows.map((row) => row.radii[radius].morphEffectiveBranchCount)) / baselineRows.length, morphDominantBinFraction: sum(baselineRows.map((row) => row.radii[radius].morphDominantBinFraction)) / baselineRows.length }]));
  const dense = rows.filter((row) => row.step >= 4500 && row.step <= 5200);
  const branchingOnsetStep = sustained(dense, (row) => keyRadii.filter((radius) => row.radii[radius].effectiveBranchCount >= baseline[radius].effectiveBranchCount * 1.5 && row.radii[radius].dominantBinFraction <= baseline[radius].dominantBinFraction * .8).length >= 2, 10);
  const morphologicRedistributionStep = sustained(dense, (row) => keyRadii.filter((radius) => row.radii[radius].morphEffectiveBranchCount >= baseline[radius].morphEffectiveBranchCount * 1.5 && row.radii[radius].morphDominantBinFraction <= baseline[radius].morphDominantBinFraction * .8).length >= 2, 10);
  const later = rows.filter((row) => branchingOnsetStep && row.step >= branchingOnsetStep); const reconcentrationStep = branchingOnsetStep ? sustained(later, (row) => keyRadii.filter((radius) => row.radii[radius].dominantBinFraction > .6 && row.radii[radius].effectiveBranchCount <= baseline[radius].effectiveBranchCount * 1.1).length >= 2, 25) : null;
  const hydraulicSignal = branchingOnsetStep !== null; const morphSignal = morphologicRedistributionStep !== null; const classification = hydraulicSignal && (!morphSignal || branchingOnsetStep + 10 < morphologicRedistributionStep) ? "BRANCHING A — DISTRIBUTED HYDRAULIC BIFURCATION" : morphSignal && (!hydraulicSignal || morphologicRedistributionStep + 10 < branchingOnsetStep) ? "BRANCHING B — MORPHOLOGY-DRIVEN BIFURCATION" : hydraulicSignal && morphSignal ? "BRANCHING C — COUPLED BRANCHING" : "BRANCHING D — NO DISTRIBUTED BRANCHING";
  const keyTimeline = keySteps.map((step) => { const row = rows.find((entry) => entry.step === step); return row ? { step, effectiveBranchCount: Object.fromEntries(keyRadii.map((radius) => ["R" + radius, row.radii[radius].effectiveBranchCount])), dominantBinFraction: Object.fromEntries(keyRadii.map((radius) => ["R" + radius, row.radii[radius].dominantBinFraction])), entropy: Object.fromEntries(keyRadii.map((radius) => ["R" + radius, row.radii[radius].angularEntropy])), oldCoreFractionCut24: row.sections[24]?.oldCoreFraction ?? null, nearBranchFractionCut24: row.sections[24]?.nearBranchFraction ?? null, farBranchFractionCut24: row.sections[24]?.farBranchFraction ?? null, numberOfPeaksCut24: row.sections[24]?.numberOfPeaks ?? null } : { step, unavailable: true }; });
  const summary = { controls: { run: "CURRENT only", deterministicRandom: .3141592653, simulationSteps: 6000, snapshotCadence: "1000,2500,4000,4500; every step 4500..5200; every 10 steps 5200..6000", productionSimulationModified: false, productionPhysicsModified: false }, methodology: { hydraulicQ: "q=d*hypot(u,v), all wet cells; percentiles are not used", radialProjection: "q * max(0, velocityUnit dot outwardRadialUnit), sampled in a +/-0.75-cell annulus", effectiveBranchCount: "exp(Shannon entropy), continuous equivalent count", sections: "CURRENT@1000 frozen-path local normals; +/-30 cells", faceFlux: "face directional projection; compared by normalized lateral L1 shape distance", morphology: "step-local erosion/deposition captured through isolated diagnostic instrumentation" }, frozenPath: { source: "CURRENT@1000", cells: frozenPath.length }, baseline4500to4600: baseline, branchingDefinition: "first >=10-step run with >=50% effective count increase and >=20% dominant-bin decrease on >=2 of R16/R24/R32", branchingOnsetStep, morphologicRedistributionStep, reconcentrationDefinition: "after onset, first >=25-step run with dominant bin >0.6 and effective count within 10% of baseline on >=2 key radii", reconcentrationStep, historicalComparison: { branchingOnsetStep, historicalCrossing4824: 4824, largestFrozenPathQDrop4969: 4969, priorDominantBranchBirth5850: 5850, reconcentrationStep, branchingBefore4824: branchingOnsetStep !== null && branchingOnsetStep < 4824, reconcentrationAfter4824: reconcentrationStep !== null && reconcentrationStep > 4824 }, classification, classificationBasis: { hydraulicRedistributionStep: branchingOnsetStep, morphologicRedistributionStep, temporalToleranceSteps: 10, note: "classification is descriptive; morphology condition is a diagnostic heuristic, not production physics" }, keyTimeline, timeline: rows, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${classification}\nbranchingOnsetStep: ${branchingOnsetStep}\nreconcentrationStep: ${reconcentrationStep}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${classification}; branching=${branchingOnsetStep}; reconcentration=${reconcentrationStep}`); console.table(keyTimeline); console.log(classification);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
