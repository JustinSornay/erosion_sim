/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Causally separates the existing hydraulic erosion and deposition exchanges.
 * Production physics stays read-only: every variant is an in-memory source
 * injection and disabled exchange deliberately leaves both bed and sediment intact.
 *
 * RUN:
 * node tests/experiments/morphodynamics/erosion-deposition-ablation.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/erosion-deposition-ablation");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const checkpoints = [100, 500, 1000, 2500, 5000, 10000];
const equalityCheckpoints = [1000, 2500, 5000, 10000];
const causalCheckpoints = [5000, 10000];
const wetThreshold = 1e-6;
const connectedThresholds = [1e-6, 1e-4];
const depositThresholds = [0.001, 0.005, 0.01, 0.02];
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);

function writeProgress(message) { fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`); }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1); }
function percentile(values, fraction) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * fraction)]; }
function maxAbsoluteDifference(first, second) { let maximum = 0; for (let i = 0; i < first.length; i++) maximum = Math.max(maximum, Math.abs(first[i] - second[i])); return maximum; }

/** Injects counters and independently gated copies of CURRENT exchange branches. */
function instrumentedSource({ erosionEnabled, depositionEnabled }) {
  let source = `let exchangeGrossErosion = 0; let exchangeGrossDeposition = 0;\n${currentSource}`;
  const erosionExchange = erosionEnabled === null
    ? "b[i] -= diff; s[i] = si + diff; exchangeGrossErosion += diff;"
    : `if (${erosionEnabled}) { b[i] -= diff; s[i] = si + diff; exchangeGrossErosion += diff; }`;
  const depositionExchange = depositionEnabled === null
    ? "b[i] += diff; s[i] = Math.max(0, si - diff); exchangeGrossDeposition += diff;"
    : `if (${depositionEnabled}) { b[i] += diff; s[i] = Math.max(0, si - diff); exchangeGrossDeposition += diff; }`;
  source = source.replace(
    /const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/,
    `const diff = KS * (C - si) * sourceProtectionMask[i];\n        ${erosionExchange}`,
  );
  source = source.replace(
    /const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/,
    `const diff = KD * (si - C);\n        ${depositionExchange}`,
  );
  if (!source.includes("exchangeGrossErosion += diff") || !source.includes("exchangeGrossDeposition += diff")) throw new Error("Erosion/deposition ablation injection failed");
  return source;
}

function simulate(source, maximumSteps, observe) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  return new Function("Math", "Float32Array", "Int32Array", "Uint8Array", "observe", `${source}
    genTerrain();
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    const snapshot = () => ({ N, NN, b, bInit, d, u, v, s, source: sourcePoint, exchangeGrossErosion, exchangeGrossDeposition });
    observe(0, snapshot());
    for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); if (${JSON.stringify(checkpoints)}.includes(stepIndex)) observe(stepIndex, snapshot()); }
  `)(math, Float32Array, Int32Array, Uint8Array, observe);
}

/** Frozen from realised CURRENT velocity field at step 1000. */
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
  const cell = pathCells[position]; const before = pathCells[Math.max(0, position - 1)]; const after = pathCells[Math.min(pathCells.length - 1, position + 1)];
  const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1;
  const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; const normalX = -Math.sign(dy); const normalY = Math.sign(dx);
  let discharge = 0; let wetWidth = 0; let magnitude = 0; let vectorU = 0; let vectorV = 0;
  for (let offset = -2; offset <= 2; offset++) {
    const sx = x + normalX * offset; const sy = y + normalY * offset;
    if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue;
    const index = sy * snapshot.N + sx; const speed = Math.hypot(snapshot.u[index], snapshot.v[index]);
    discharge += snapshot.d[index] * Math.max(0, (snapshot.u[index] * dx + snapshot.v[index] * dy) / length);
    if (snapshot.d[index] > wetThreshold) wetWidth++;
    magnitude += snapshot.d[index] * speed; vectorU += snapshot.d[index] * snapshot.u[index]; vectorV += snapshot.d[index] * snapshot.v[index];
  }
  return { discharge, wetWidth, coherence: Math.hypot(vectorU, vectorV) / Math.max(magnitude, 1e-12) };
}

function connectedWetCells(snapshot, threshold) {
  const visited = new Uint8Array(snapshot.NN); const queue = [];
  const sourceIndex = snapshot.source.y * snapshot.N + snapshot.source.x;
  for (const index of [sourceIndex, ...snapshot.source.outletIndices]) if (snapshot.d[index] > threshold && !visited[index]) { visited[index] = 1; queue.push(index); }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]; const x = index % snapshot.N; const y = (index / snapshot.N) | 0;
    for (const [dx, dy] of d8) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const next = ny * snapshot.N + nx;
      if (snapshot.d[next] > threshold && !visited[next]) { visited[next] = 1; queue.push(next); }
    }
  }
  let wetCellCount = 0;
  for (let i = 0; i < snapshot.NN; i++) if (snapshot.d[i] > threshold) wetCellCount++;
  return { count: queue.length, fraction: queue.length / Math.max(wetCellCount, 1) };
}

/** Deposits are evaluated on wet cells plus their immediate hydraulic neighbourhood. */
function depositDiagnostics(snapshot) {
  const relevant = new Uint8Array(snapshot.NN);
  for (let i = 0; i < snapshot.NN; i++) {
    if (snapshot.d[i] <= wetThreshold) continue;
    relevant[i] = 1;
    const x = i % snapshot.N; const y = (i / snapshot.N) | 0;
    for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N) relevant[ny * snapshot.N + nx] = 1; }
  }
  const values = []; const aboveThreshold = Object.fromEntries(depositThresholds.map((threshold) => [threshold, 0]));
  for (let i = 0; i < snapshot.NN; i++) if (relevant[i]) {
    const delta = Math.max(0, snapshot.b[i] - snapshot.bInit[i]); values.push(delta);
    for (const threshold of depositThresholds) if (delta > threshold) aboveThreshold[threshold]++;
  }
  return { hydraulicNeighbourhoodCellCount: values.length, depositP95: percentile(values, .95), depositP99: percentile(values, .99), depositMax: values.length ? Math.max(...values) : 0, depositCellCountAboveThreshold: aboveThreshold };
}

function metrics(snapshot, pathCells) {
  const ranges = [[0, 5], [6, 15], [16, pathCells.length - 1]];
  const zones = ranges.map(([start, end]) => {
    const rows = [];
    for (let position = start; position <= Math.min(end, pathCells.length - 1); position++) rows.push(section(snapshot, pathCells, position));
    return { discharge: mean(rows.map((row) => row.discharge)), wetWidth: mean(rows.map((row) => row.wetWidth)), coherence: mean(rows.map((row) => row.coherence)) };
  });
  let totalWater = 0; let wetCellCount = 0; let activeCellCount = 0; let wetDepthSum = 0; let wetSpeedSum = 0; let maxDepth = 0; let maxSpeed = 0;
  let netBedChange = 0; let erodedCellCount = 0; let depositedCellCount = 0; let erosionSum = 0; let depositionSum = 0; let maxErosionDepth = 0; let maxDepositionHeight = 0;
  for (let i = 0; i < snapshot.NN; i++) {
    const depth = snapshot.d[i]; const speed = Math.hypot(snapshot.u[i], snapshot.v[i]); const delta = snapshot.b[i] - snapshot.bInit[i];
    totalWater += depth; netBedChange += delta; maxDepth = Math.max(maxDepth, depth); maxSpeed = Math.max(maxSpeed, speed);
    if (depth > wetThreshold) { wetCellCount++; wetDepthSum += depth; wetSpeedSum += speed; }
    if (depth > 0) activeCellCount++;
    if (delta < 0) { const erosion = -delta; erodedCellCount++; erosionSum += erosion; maxErosionDepth = Math.max(maxErosionDepth, erosion); }
    if (delta > 0) { depositedCellCount++; depositionSum += delta; maxDepositionHeight = Math.max(maxDepositionHeight, delta); }
  }
  const connected = Object.fromEntries(connectedThresholds.map((threshold) => [threshold, connectedWetCells(snapshot, threshold)]));
  return {
    mouthDischarge: zones[0].discharge, midDischarge: zones[1].discharge, downstreamDischarge: zones[2].discharge,
    downstreamVsMouth: zones[2].discharge / Math.max(zones[0].discharge, 1e-12), directionalCoherence: mean(zones.map((zone) => zone.coherence)), wetWidth: mean(zones.map((zone) => zone.wetWidth)),
    totalWater, wetCellCount, activeCellCount, meanWetDepth: wetDepthSum / Math.max(wetCellCount, 1), maxDepth, meanWetSpeed: wetSpeedSum / Math.max(wetCellCount, 1), maxSpeed,
    grossErosion: snapshot.exchangeGrossErosion, grossDeposition: snapshot.exchangeGrossDeposition, netBedChange,
    erodedCellCount, depositedCellCount, erodedAreaFraction: erodedCellCount / snapshot.NN, depositedAreaFraction: depositedCellCount / snapshot.NN,
    meanErosionOnErodedCells: erosionSum / Math.max(erodedCellCount, 1), meanDepositionOnDepositedCells: depositionSum / Math.max(depositedCellCount, 1), maxErosionDepth, maxDepositionHeight,
    wetConnectedCellCount: connected[wetThreshold].count, wetConnectedFraction: connected[wetThreshold].fraction,
    wetConnectedCellCountAt1e4: connected[1e-4].count, wetConnectedFractionAt1e4: connected[1e-4].fraction,
    ...depositDiagnostics(snapshot),
  };
}

function runVariant(variant, pathCells) {
  const rows = {}; const buffers = {};
  simulate(variant.source, 10000, (step, snapshot) => {
    if (!checkpoints.includes(step)) return;
    rows[step] = metrics(snapshot, pathCells);
    if (["CURRENT", "ALL_ENABLED", "EROSION_ONLY", "NO_DEPOSITION", "DEPOSITION_ONLY", "NO_EROSION"].includes(variant.name) && equalityCheckpoints.includes(step)) {
      buffers[step] = Object.fromEntries(["b", "d", "s", "u", "v"].map((key) => [key, new Float32Array(snapshot[key])]));
    }
  });
  return { name: variant.name, checkpoints: rows, buffers };
}

function differences(first, second) { return Object.fromEntries(equalityCheckpoints.map((step) => [step, Object.fromEntries(["b", "d", "s", "u", "v"].map((key) => [key, maxAbsoluteDifference(first.buffers[step][key], second.buffers[step][key])]))])); }
function exact(difference) { return Object.values(difference).every((checkpoint) => Object.values(checkpoint).every((value) => value === 0)); }
function recovery(value, current, noMorph) { const denominator = noMorph - current; const tolerance = Math.max(1e-12, Math.max(Math.abs(current), Math.abs(noMorph)) * .01); return Math.abs(denominator) <= tolerance ? null : (value - current) / denominator; }

function recoveries(runs) {
  const byName = Object.fromEntries(runs.map((run) => [run.name, run]));
  return Object.fromEntries(runs.map((run) => [run.name, Object.fromEntries(causalCheckpoints.map((step) => {
    const current = byName.CURRENT.checkpoints[step]; const noMorph = byName.NO_MORPH.checkpoints[step]; const row = run.checkpoints[step];
    return [step, {
      downstreamDischarge: recovery(row.downstreamDischarge, current.downstreamDischarge, noMorph.downstreamDischarge),
      directionalCoherence: recovery(row.directionalCoherence, current.directionalCoherence, noMorph.directionalCoherence),
      wetConnectedCellCount: recovery(row.wetConnectedCellCount, current.wetConnectedCellCount, noMorph.wetConnectedCellCount),
    }];
  }))]));
}

function hasDepositionSignal(erosionOnly, current, step) {
  const candidate = erosionOnly.checkpoints[step]; const baseline = current.checkpoints[step];
  const connectivityHigher = candidate.wetConnectedCellCount > baseline.wetConnectedCellCount * 1.1;
  const p99Reduced = candidate.depositP99 < baseline.depositP99 * .7;
  const maxReduced = candidate.depositMax < baseline.depositMax * .7;
  const thresholdCountsReduced = depositThresholds.some((threshold) => candidate.depositCellCountAboveThreshold[threshold] < baseline.depositCellCountAboveThreshold[threshold] * .7);
  return { present: connectivityHigher || p99Reduced || maxReduced || thresholdCountsReduced, connectivityHigher, p99Reduced, maxReduced, thresholdCountsReduced };
}

function classification(runs, recoveryByVariant) {
  const byName = Object.fromEntries(runs.map((run) => [run.name, run])); const evidence = {};
  for (const step of causalCheckpoints) {
    const erosionOnlyRecovery = recoveryByVariant.EROSION_ONLY[step].downstreamDischarge;
    const depositionOnlyRecovery = recoveryByVariant.DEPOSITION_ONLY[step].downstreamDischarge;
    evidence[step] = { erosionOnlyDischargeRecovery: erosionOnlyRecovery, depositionOnlyDischargeRecovery: depositionOnlyRecovery, depositionDominanceSecondSignal: hasDepositionSignal(byName.EROSION_ONLY, byName.CURRENT, step) };
  }
  const every = (predicate) => causalCheckpoints.every((step) => predicate(evidence[step]));
  if (every((row) => row.depositionOnlyDischargeRecovery !== null && row.depositionOnlyDischargeRecovery >= .7 && row.erosionOnlyDischargeRecovery !== null && row.erosionOnlyDischargeRecovery < .3)) return { classification: "EXCHANGE-ABLATION A — EROSION DOMINANT", evidence };
  if (every((row) => row.erosionOnlyDischargeRecovery !== null && row.erosionOnlyDischargeRecovery >= .7 && row.depositionOnlyDischargeRecovery !== null && row.depositionOnlyDischargeRecovery < .3)) {
    const strongConfidence = every((row) => row.depositionDominanceSecondSignal.present);
    return { classification: "EXCHANGE-ABLATION B — DEPOSITION DOMINANT", confidence: strongConfidence ? "strong" : "limited", evidence };
  }
  if (every((row) => row.erosionOnlyDischargeRecovery !== null && row.erosionOnlyDischargeRecovery >= .7 && row.depositionOnlyDischargeRecovery !== null && row.depositionOnlyDischargeRecovery >= .7)) return { classification: "EXCHANGE-ABLATION C — BOTH INDEPENDENT", evidence };
  return { classification: "EXCHANGE-ABLATION D — INTERACTION", evidence };
}

function main() {
  const currentInstrumentedSource = instrumentedSource({ erosionEnabled: null, depositionEnabled: null });
  const allEnabledSource = instrumentedSource({ erosionEnabled: true, depositionEnabled: true });
  let referenceSnapshot;
  simulate(allEnabledSource, 1000, (step, snapshot) => { if (step === 1000) referenceSnapshot = { N: snapshot.N, NN: snapshot.NN, u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v), source: snapshot.source }; });
  const pathCells = referenceFlowPath(referenceSnapshot);
  if (!pathCells.length) throw new Error("Frozen CURRENT@1000 reference path is empty");
  const variants = [
    { name: "CURRENT", source: currentInstrumentedSource }, { name: "ALL_ENABLED", source: allEnabledSource },
    { name: "NO_MORPH", source: instrumentedSource({ erosionEnabled: false, depositionEnabled: false }) },
    { name: "EROSION_ONLY", source: instrumentedSource({ erosionEnabled: true, depositionEnabled: false }) },
    { name: "DEPOSITION_ONLY", source: instrumentedSource({ erosionEnabled: false, depositionEnabled: true }) },
    { name: "NO_EROSION", source: instrumentedSource({ erosionEnabled: false, depositionEnabled: true }) },
    { name: "NO_DEPOSITION", source: instrumentedSource({ erosionEnabled: true, depositionEnabled: false }) },
  ];
  writeProgress(`[reference path] positions=${pathCells.length}`);
  const runs = [];
  for (const variant of variants) { writeProgress(`[run] ${variant.name}`); runs.push(runVariant(variant, pathCells)); writeProgress(`[completed] ${variant.name}`); }
  const byName = Object.fromEntries(runs.map((run) => [run.name, run]));
  const allEnabledDifference = differences(byName.CURRENT, byName.ALL_ENABLED); const erosionAliasDifference = differences(byName.EROSION_ONLY, byName.NO_DEPOSITION); const depositionAliasDifference = differences(byName.DEPOSITION_ONLY, byName.NO_EROSION);
  const controls = { allEnabledEquality: { passes: exact(allEnabledDifference), maxAbsoluteDifference: allEnabledDifference }, aliases: { passes: exact(erosionAliasDifference) && exact(depositionAliasDifference), erosionOnlyEqualsNoDeposition: erosionAliasDifference, depositionOnlyEqualsNoErosion: depositionAliasDifference } };
  if (!controls.allEnabledEquality.passes || !controls.aliases.passes) {
    const summary = { controls, checkpoints, variants: runs.map(({ buffers, ...run }) => run), failedAt: new Date().toISOString(), failure: "Equivalence control failed; classification intentionally not evaluated." };
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    throw new Error(`Equivalence control failed: ${JSON.stringify(controls)}`);
  }
  const recoveryByVariant = recoveries(runs); const result = classification(runs, recoveryByVariant);
  const summary = { controls, checkpoints, variants: runs.map(({ buffers, ...run }) => run), recoveries: recoveryByVariant, classification: result.classification, classificationEvidence: result.evidence, classificationConfidence: result.confidence || null, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(completePath, `classification: ${summary.classification}\ncompletedAt: ${summary.completedAt}\n`);
  writeProgress(`[complete] ${summary.classification}`);
  console.log(`Control ALL_ENABLED: PASS`); console.log(`Control aliases: PASS`);
  for (const step of causalCheckpoints) console.table(["CURRENT", "NO_MORPH", "EROSION_ONLY", "DEPOSITION_ONLY"].map((name) => ({ variant: name, downstreamDischarge: byName[name].checkpoints[step].downstreamDischarge, dischargeRecovery: recoveryByVariant[name][step].downstreamDischarge, directionalCoherence: byName[name].checkpoints[step].directionalCoherence, coherenceRecovery: recoveryByVariant[name][step].directionalCoherence, wetConnectedCellCount: byName[name].checkpoints[step].wetConnectedCellCount, connectivityRecovery: recoveryByVariant[name][step].wetConnectedCellCount, grossErosion: byName[name].checkpoints[step].grossErosion, grossDeposition: byName[name].checkpoints[step].grossDeposition, depositP99: byName[name].checkpoints[step].depositP99, depositMax: byName[name].checkpoints[step].depositMax })));
  console.log(`CLASSIFICATION: ${summary.classification}${summary.classificationConfidence ? ` (${summary.classificationConfidence} confidence)` : ""}`);
}

try { main(); } catch (error) { writeProgress(`[failed] ${error.stack || error.message}`); throw error; }
