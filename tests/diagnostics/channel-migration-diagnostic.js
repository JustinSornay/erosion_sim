/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Determines whether CURRENT transport moves as a laterally translating,
 * concentrated channel. Instrumentation exists only in this evaluated source;
 * production simulation and physics remain unchanged.
 *
 * RUN: node tests/diagnostics/channel-migration-diagnostic.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/channel-migration");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const positions = [8, 12, 16, 20, 24, 28, 32, 36, 40];
const coherencePositions = [16, 20, 24, 28, 32];
const keyPositions = [16, 24, 32];
const keySteps = [4400, 4500, 4600, 4683, 4750, 4811, 4824, 4900, 4969, 5000, 5100, 5200, 5500, 5850, 6000];
const velocityWindows = [[4400, 4750], [4750, 4824], [4824, 4969], [4969, 5200]];
const width = 40;
const persistenceLength = 25;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()} CURRENT deterministic channel-migration diagnostic\n`);
const progress = (message) => fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => sum(values) / Math.max(values.length, 1);
const observeStep = (step) => [1000, 2500, 4000].includes(step) || (step >= 4300 && step <= 5200) || (step > 5200 && step % 10 === 0);

/** Captures direct bed exchange at its business event, without altering production files. */
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
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
      const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx; const score = snapshot.u[cell] * dx + snapshot.v[cell] * dy;
      if (!used[candidate] && score > projection) { projection = score; next = candidate; }
    }
    if (next < 0) break; cell = next;
  }
  return cells;
}

function frame(pathCells, position, N) {
  if (position >= pathCells.length) return null;
  const before = pathCells[Math.max(0, position - 1)]; const after = pathCells[Math.min(pathCells.length - 1, position + 1)];
  const dx = after % N - before % N; const dy = ((after / N) | 0) - ((before / N) | 0); const length = Math.hypot(dx, dy) || 1;
  return { x: pathCells[position] % N, y: (pathCells[position] / N) | 0, downstreamX: dx / length, downstreamY: dy / length, normalX: -dy / length, normalY: dx / length };
}

function weightedQuantile(rows, fraction) {
  const total = sum(rows.map((row) => row.weight)); let cumulative = 0;
  for (const row of [...rows].sort((a, b) => a.offset - b.offset)) { cumulative += row.weight; if (cumulative >= total * fraction) return row.offset; }
  return 0;
}

function centroid(rows, key) {
  const total = sum(rows.map((row) => row[key]));
  return total ? sum(rows.map((row) => row.offset * row[key])) / total : null;
}

function spread(rows, key, center) {
  const total = sum(rows.map((row) => row[key]));
  return total ? Math.sqrt(sum(rows.map((row) => row[key] * (row.offset - center) ** 2)) / total) : null;
}

function modeAndPeaks(rows) {
  const values = rows.map((row) => row.q); const modeIndex = values.indexOf(Math.max(...values));
  const smoothed = values.map((_, index) => (values[Math.max(0, index - 1)] + 2 * values[index] + values[Math.min(values.length - 1, index + 1)]) / 4);
  const orderedPeaks = smoothed.map((value, index) => ({ value, index })).filter(({ value, index }) => index > 0 && index < smoothed.length - 1 && value >= smoothed[index - 1] && value > smoothed[index + 1]).sort((a, b) => b.value - a.value);
  const first = orderedPeaks[0] || { value: Math.max(...smoothed), index: smoothed.indexOf(Math.max(...smoothed)) };
  const second = orderedPeaks.find((peak) => Math.abs(peak.index - first.index) > 3);
  const total = sum(values);
  const unimodalityScore = sum(rows.filter((row) => Math.abs(row.offset - rows[modeIndex].offset) <= 3).map((row) => row.q)) / Math.max(total, 1e-12);
  return { modeOffset: rows[modeIndex].offset, unimodalityScore, secondaryPeakFraction: (second?.value || 0) / Math.max(first.value, 1e-12) };
}

function sectionMetrics(snapshot, frozenPath, position) {
  const local = frame(frozenPath, position, snapshot.N); if (!local) return null;
  const rows = []; const coordinates = new Set();
  for (let requestedOffset = -width; requestedOffset <= width; requestedOffset++) {
    const x = Math.round(local.x + local.normalX * requestedOffset); const y = Math.round(local.y + local.normalY * requestedOffset);
    if (x < 0 || y < 0 || x >= snapshot.N || y >= snapshot.N || coordinates.has(`${x},${y}`)) continue;
    coordinates.add(`${x},${y}`); const i = y * snapshot.N + x; const offset = (x - local.x) * local.normalX + (y - local.y) * local.normalY;
    const q = snapshot.d[i] * Math.max(0, snapshot.u[i] * local.downstreamX + snapshot.v[i] * local.downstreamY);
    const face = Math.max(0, (snapshot.fR[i] - snapshot.fL[i]) * local.downstreamX + (snapshot.fB[i] - snapshot.fT[i]) * local.downstreamY);
    rows.push({ offset, q, face, erosion: snapshot.diagnosticStepErosion[i], deposition: snapshot.diagnosticStepDeposition[i] });
  }
  const totalQ = sum(rows.map((row) => row.q)); const centroidOffset = centroid(rows, "q"); const faceCentroidOffset = centroid(rows, "face");
  const erosionCentroidOffset = centroid(rows, "erosion"); const depositionCentroidOffset = centroid(rows, "deposition");
  const absoluteMorphRows = rows.map((row) => ({ ...row, absoluteMorph: Math.abs(row.deposition - row.erosion) }));
  const peaks = modeAndPeaks(rows); const oldCoreFraction = sum(rows.filter((row) => Math.abs(row.offset) <= 2).map((row) => row.q)) / Math.max(totalQ, 1e-12);
  const newCoreFraction = sum(rows.filter((row) => Math.abs(row.offset - centroidOffset) <= 2).map((row) => row.q)) / Math.max(totalQ, 1e-12);
  const left = rows.filter((row) => row.offset < centroidOffset); const right = rows.filter((row) => row.offset > centroidOffset);
  return {
    totalQ, centroidOffset, medianOffset: weightedQuantile(rows.map((row) => ({ offset: row.offset, weight: row.q })), .5), modeOffset: peaks.modeOffset,
    stdOffset: spread(rows, "q", centroidOffset), p10Offset: weightedQuantile(rows.map((row) => ({ offset: row.offset, weight: row.q })), .1), p90Offset: weightedQuantile(rows.map((row) => ({ offset: row.offset, weight: row.q })), .9),
    faceCentroidOffset, faceStdOffset: spread(rows, "face", faceCentroidOffset), centroidDifference: faceCentroidOffset === null ? null : centroidOffset - faceCentroidOffset,
    erosionCentroidOffset, depositionCentroidOffset, morphCentroidOffset: centroid(absoluteMorphRows, "absoluteMorph"), netMorph: rows.map(({ offset, erosion, deposition }) => ({ offset, value: deposition - erosion })),
    erosionLeft: sum(left.map((row) => row.erosion)), erosionRight: sum(right.map((row) => row.erosion)), depositionLeft: sum(left.map((row) => row.deposition)), depositionRight: sum(right.map((row) => row.deposition)),
    oldCoreFraction, newCoreFraction, unimodalityScore: peaks.unimodalityScore, secondaryPeakFraction: peaks.secondaryPeakFraction
  };
}

function firstPersistent(rows, key, baseline) {
  let sign = 0; let run = 0;
  for (const row of rows) {
    const value = row.sections[key]?.migrationOffset; const nextSign = Math.sign(value || 0);
    if (Math.abs(value || 0) >= 5 && nextSign === sign) run++; else { sign = Math.abs(value || 0) >= 5 ? nextSign : 0; run = sign ? 1 : 0; }
    if (run >= persistenceLength) return { step: row.step - persistenceLength + 1, sign };
  }
  return null;
}

function rollingAverage(values, size) {
  return values.map((value, index) => mean(values.slice(Math.max(0, index - size + 1), index + 1)));
}

function classify(positionResults, coherentMigrationStep, rows) {
  const signals = Object.values(positionResults).filter((result) => result.hydraulicMigration);
  if (!signals.length) return "MIGRATION F — NO SIGNIFICANT MIGRATION";
  let splitRun = 0;
  for (const row of rows) {
    splitRun = coherencePositions.filter((position) => row.sections[position]?.secondaryPeakFraction >= .5 && row.sections[position]?.unimodalityScore <= .5).length >= 3 ? splitRun + 1 : 0;
    if (splitRun >= persistenceLength) return "MIGRATION D — TRUE MULTI-BRANCH REORGANIZATION";
  }
  const signs = new Set(signals.map((result) => result.hydraulicMigration.sign));
  if (!coherentMigrationStep && signs.size > 1) return "MIGRATION E — DISTRIBUTED / INCOHERENT SHIFT";
  const leadLags = signals.map((result) => result.morphLeadLag).filter(Number.isFinite);
  if (leadLags.length && leadLags.every((value) => Math.abs(value) <= 25)) return "MIGRATION C — COUPLED CHANNEL MIGRATION";
  if (leadLags.length && mean(leadLags) > 25) return "MIGRATION A — MORPHOLOGY-DRIVEN CHANNEL MIGRATION";
  return "MIGRATION B — HYDRAULIC CHANNEL MIGRATION";
}

function main() {
  const rows = []; let frozenPath = null;
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", `${instrumentedSource()}\n genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const snapshot = () => ({ N, NN, d, u, v, fL, fR, fT, fB, source: sourcePoint, diagnosticStepErosion, diagnosticStepDeposition }); for (let stepIndex = 1; stepIndex <= 6000; stepIndex++) { step(); observe(stepIndex, snapshot()); diagnosticStepErosion.fill(0); diagnosticStepDeposition.fill(0); }`)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Float64Array, Int32Array, Uint8Array, (step, snapshot) => {
    if (step === 1000) { frozenPath = traceFrozenPath(snapshot); progress(`[reference] CURRENT@1000 frozen path cells=${frozenPath.length}`); }
    if (!frozenPath || !observeStep(step)) return;
    rows.push({ step, sections: Object.fromEntries(positions.map((position) => [position, sectionMetrics(snapshot, frozenPath, position)])) });
  });
  const baselineRows = rows.filter((row) => row.step >= 4300 && row.step <= 4400);
  const baselines = Object.fromEntries(positions.map((position) => [position, { centroid: mean(baselineRows.map((row) => row.sections[position]?.centroidOffset).filter(Number.isFinite)), morph: mean(baselineRows.map((row) => row.sections[position]?.morphCentroidOffset).filter(Number.isFinite)) }]));
  for (const row of rows) for (const position of positions) {
    const section = row.sections[position]; if (!section) continue;
    section.migrationOffset = section.centroidOffset - baselines[position].centroid;
    section.morphMigrationOffset = section.morphCentroidOffset - baselines[position].morph;
  }
  const denseRows = rows.filter((row) => row.step >= 4300 && row.step <= 5200);
  const positionResults = Object.fromEntries(positions.map((position) => {
    const hydraulicMigration = firstPersistent(denseRows, position, baselines[position].centroid);
    const morphMigration = (() => { let sign = 0; let run = 0; for (const row of denseRows) { const value = row.sections[position]?.morphMigrationOffset; const nextSign = Math.sign(value || 0); if (Math.abs(value || 0) >= 5 && nextSign === sign) run++; else { sign = Math.abs(value || 0) >= 5 ? nextSign : 0; run = sign ? 1 : 0; } if (run >= persistenceLength) return { step: row.step - persistenceLength + 1, sign }; } return null; })();
    const velocityRows = denseRows.filter((row) => row.sections[position]); const velocities = velocityRows.map((row, index) => index ? row.sections[position].centroidOffset - velocityRows[index - 1].sections[position].centroidOffset : null); const smoothed = rollingAverage(velocities.map((value) => value ?? 0), persistenceLength);
    const migrationVelocity = Object.fromEntries(velocityRows.map((row, index) => [row.step, velocities[index]])); const smoothedMigrationVelocity = Object.fromEntries(velocityRows.map((row, index) => [row.step, smoothed[index]]));
    const velocityWindowsSummary = Object.fromEntries(velocityWindows.map(([start, end]) => { const values = velocityRows.filter((row, index) => row.step >= start && row.step <= end && index > 0).map((row) => smoothedMigrationVelocity[row.step]); return [`${start}..${end}`, { meanMigrationVelocity: mean(values), maxMigrationVelocity: values.length ? Math.max(...values.map(Math.abs)) : null }]; }));
    return [position, { baselineCentroid: baselines[position].centroid, baselineMorphCentroid: baselines[position].morph, persistentMigrationStep: hydraulicMigration?.step ?? null, firstPersistentMorphShift: morphMigration?.step ?? null, hydraulicMigration, morphMigration, morphLeadLag: hydraulicMigration && morphMigration ? hydraulicMigration.step - morphMigration.step : null, migrationVelocity, smoothedMigrationVelocity, velocityWindows: velocityWindowsSummary }];
  }));
  let coherentMigrationStep = null;
  for (let index = 0; index <= denseRows.length - persistenceLength && !coherentMigrationStep; index++) {
    const candidates = coherencePositions.map((position) => ({ position, sign: Math.sign(denseRows[index].sections[position]?.migrationOffset || 0) })).filter(({ sign }) => sign);
    for (const direction of [-1, 1]) if (candidates.filter(({ position, sign }) => sign === direction && denseRows.slice(index, index + persistenceLength).every((row) => Math.sign(row.sections[position]?.migrationOffset || 0) === direction && Math.abs(row.sections[position]?.migrationOffset || 0) >= 5)).length >= 3) { coherentMigrationStep = denseRows[index].step; break; }
  }
  const firstMorphShift = Math.min(...Object.values(positionResults).map((result) => result.firstPersistentMorphShift).filter(Number.isFinite), Infinity);
  const classification = classify(positionResults, coherentMigrationStep, denseRows);
  const keyTimeline = keySteps.map((step) => { const row = rows.find((entry) => entry.step === step); return { step, positions: Object.fromEntries(keyPositions.map((position) => { const section = row?.sections[position]; return [position, section ? Object.fromEntries(["centroidOffset", "faceCentroidOffset", "stdOffset", "modeOffset", "oldCoreFraction", "newCoreFraction", "secondaryPeakFraction", "erosionCentroidOffset", "depositionCentroidOffset"].map((key) => [key, section[key]])) : null]; })) }; });
  const summary = { controls: { run: "CURRENT only", deterministicRandom: .3141592653, simulationSteps: 6000, snapshotCadence: "1000,2500,4000; every step 4300..5200; every 10 steps 5210..6000", productionSimulationModified: false, productionPhysicsModified: false }, methodology: { frozenPath: "CURRENT@1000 spatial reference only", sections: "local normals to frozen path, requested width +/-40 cells; duplicate rounded cells excluded", hydraulicFlux: "q=d*max(0,u*downstreamX+v*downstreamY), unthresholded", faceFlux: "max(0,(fR-fL)*downstreamX+(fB-fT)*downstreamY), independent of u/v", morphology: "step-local direct erosion/deposition captured in isolated diagnostic source", persistence: "absolute offset >=5 cells with unchanged sign for 25 consecutive steps" }, frozenPath: { source: "CURRENT@1000", cells: frozenPath.length, unavailablePositions: positions.filter((position) => position >= frozenPath.length) }, baseline: { range: "4300..4400", positions: baselines }, positions: positionResults, coherentMigrationStep, firstMorphShift: Number.isFinite(firstMorphShift) ? firstMorphShift : null, historicalComparison: { firstMorphShift: Number.isFinite(firstMorphShift) ? firstMorphShift : null, coherentMigrationStep, connectivityAnomaly4811: 4811, frozenPathThresholdCrossing4824: 4824, largestFrozenPathQDrop4969: 4969, lateDominantBranchDetection5850: 5850, migrationBeginsBefore4824: coherentMigrationStep !== null && coherentMigrationStep < 4824 }, classification, classificationBasis: "Descriptive geometry only; historicalFrozenPathQ is intentionally absent as health metric.", keyTimeline, timeline: rows, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${classification}\ncoherentMigrationStep: ${coherentMigrationStep}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${classification}; coherentMigrationStep=${coherentMigrationStep}`); console.table(keyTimeline.map((row) => ({ step: row.step, centroid16: row.positions[16]?.centroidOffset, centroid24: row.positions[24]?.centroidOffset, centroid32: row.positions[32]?.centroidOffset }))); console.log(classification);
}

try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
