/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Tests whether outgoing hydraulic fluxes retain a state built against the
 * previous step's bed. Production sources are loaded unchanged; flux-memory
 * changes exist only in the in-memory benchmark source. This replacement runs
 * BED_TRIGGERED only; legacy MEMORY_DECAY results remain historical evidence.
 *
 * CURRENT ORDER:
 * injectSources -> flux update -> water update -> velocity and direct bed
 * exchange -> signed/absolute bed-change capture -> sediment transport/
 * evaporation. The following flux update observes that retained morph change.
 *
 * RUN:
 * node tests/experiments/hydraulics/flux-memory-comparison.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/flux-memory");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const checkpoints = Array.from({ length: 40 }, (_, index) => (index + 1) * 250);
const equalityCheckpoints = [1000, 5000, 10000];
const sanityThresholds = [0, 1e-5, 1e-4, 1e-3, 1e-2];
const bedThresholds = [0, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
const bedDecayFactors = [0, .25, .5, .75, .9, .99, 1];
const epsilon = 1e-12;
const fluxEpsilon = 1e-12;
const wetThreshold = 1e-6;
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

fs.mkdirSync(outputDirectory, { recursive: true });
const legacySummary = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, "utf8")) : null;
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);
function progress(message) { fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`); }
function mean(values) { return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1); }
function maxDifference(first, second) { let maximum = 0; for (let i = 0; i < first.length; i++) maximum = Math.max(maximum, Math.abs(first[i] - second[i])); return maximum; }

/** Instruments only benchmark-local counters and outgoing flux memory. */
function instrumentedSource({ mode = "CURRENT", family = "CURRENT", factor = 1, threshold = 0, decay = 1, collectEveryStep = false }) {
  const erosion = mode === "NO_MORPH" ? "" : "cumulativeErosion[i] += diff; b[i] -= diff; s[i] = si + diff;";
  const deposition = mode === "NO_MORPH" ? "" : "cumulativeDeposition[i] += diff; b[i] += diff; s[i] = Math.max(0, si - diff);";
  const state = `
let cumulativeErosion = new Float64Array(NN), cumulativeDeposition = new Float64Array(NN);
// Retained after morphodynamics so hydraulics consumes the preceding bed change.
let bedBeforeMorph = new Float32Array(NN), bedChangeSinceHydraulics = new Float32Array(NN), signedBedChange = new Float32Array(NN);
let oldFL = new Float32Array(NN), oldFR = new Float32Array(NN), oldFT = new Float32Array(NN), oldFB = new Float32Array(NN);
let fluxObservation = {}, triggerAggregate = { stepsWithTriggeredFaces: 0, triggeredFaceCount: 0, triggeredFluxFraction: 0, maxTriggeredFaceCount: 0, samples: 0 };
function bedTriggered(i, neighbor) { return neighbor >= 0 && (bedChangeSinceHydraulics[i] > ${threshold} || bedChangeSinceHydraulics[neighbor] > ${threshold}); }
function recordFluxObservation() {
  let total = 0, maximum = 0, change = 0, oldTotal = 0, persistence = 0, faces = 0, adverse = 0, adverseMagnitude = 0, triggeredFaces = 0, triggeredMagnitude = 0, erosionTriggeredFaces = 0, depositionTriggeredFaces = 0, mixedTriggeredFaces = 0;
  const inspect = (oldValue, newValue, i, neighbor, enabled) => {
    if (neighbor < 0) return;
    total += newValue; maximum = Math.max(maximum, newValue); change += Math.abs(newValue - oldValue); oldTotal += oldValue; persistence += Math.min(oldValue, newValue);
    if (newValue > 1e-12) { faces++; if (b[i] + d[i] <= b[neighbor] + d[neighbor]) { adverse++; adverseMagnitude += newValue; } }
    if (enabled) { triggeredFaces++; triggeredMagnitude += newValue;
      const erosion = signedBedChange[i] < -${threshold} || signedBedChange[neighbor] < -${threshold};
      const deposition = signedBedChange[i] > ${threshold} || signedBedChange[neighbor] > ${threshold};
      if (erosion && deposition) mixedTriggeredFaces++; else if (erosion) erosionTriggeredFaces++; else if (deposition) depositionTriggeredFaces++;
    }
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x;
    inspect(oldFL[i], fL[i], i, x > 0 ? i - 1 : -1, bedTriggered(i, x > 0 ? i - 1 : -1));
    inspect(oldFR[i], fR[i], i, x < N - 1 ? i + 1 : -1, bedTriggered(i, x < N - 1 ? i + 1 : -1));
    inspect(oldFT[i], fT[i], i, y > 0 ? i - N : -1, bedTriggered(i, y > 0 ? i - N : -1));
    inspect(oldFB[i], fB[i], i, y < N - 1 ? i + N : -1, bedTriggered(i, y < N - 1 ? i + N : -1));
  }
  fluxObservation = { meanFlux: total / Math.max(faces, 1), maxFlux: maximum, totalFluxMagnitude: total, meanFluxChange: change / Math.max(faces, 1), fluxPersistence: persistence / Math.max(oldTotal, 1e-12), adverseFluxMagnitude: adverseMagnitude, adverseFluxFraction: adverseMagnitude / Math.max(total, 1e-12), adverseFaceFraction: adverse / Math.max(faces, 1), triggeredFaceCount: triggeredFaces, triggeredFluxMagnitude: triggeredMagnitude, triggeredFluxFraction: triggeredMagnitude / Math.max(total, 1e-12), erosionTriggeredFaceFraction: erosionTriggeredFaces / Math.max(triggeredFaces, 1), depositionTriggeredFaceFraction: depositionTriggeredFaces / Math.max(triggeredFaces, 1), mixedTriggeredFaceFraction: mixedTriggeredFaces / Math.max(triggeredFaces, 1) };
  triggerAggregate.samples++; triggerAggregate.triggeredFaceCount += triggeredFaces; triggerAggregate.triggeredFluxFraction += fluxObservation.triggeredFluxFraction; triggerAggregate.maxTriggeredFaceCount = Math.max(triggerAggregate.maxTriggeredFaceCount, triggeredFaces); if (triggeredFaces > 0) triggerAggregate.stepsWithTriggeredFaces++;
}
`;
  let source = `${currentSource}\n${state}`;
  source = source.replace(/const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, `const diff = KS * (C - si) * sourceProtectionMask[i];\n        ${erosion}`);
  source = source.replace(/const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, `const diff = KD * (si - C);\n        ${deposition}`);
  source = source.replace("  injectSources();", "  injectSources();\n  const observeFluxStep = " + collectEveryStep + " || (steps + 1) % 250 === 0;\n  if (observeFluxStep) { oldFL.set(fL); oldFR.set(fR); oldFT.set(fT); oldFB.set(fB); }");
  if (family === "MEMORY_DECAY" && factor !== 1) {
    source = source.replace("fL[i] + (DT * A * G * dhL) / L", `(${factor}) * fL[i] + (DT * A * G * dhL) / L`).replace("fR[i] + (DT * A * G * dhR) / L", `(${factor}) * fR[i] + (DT * A * G * dhR) / L`).replace("fT[i] + (DT * A * G * dhT) / L", `(${factor}) * fT[i] + (DT * A * G * dhT) / L`).replace("fB[i] + (DT * A * G * dhB) / L", `(${factor}) * fB[i] + (DT * A * G * dhB) / L`);
  }
  if (family === "BED_TRIGGERED") {
    source = source.replace("fL[i] + (DT * A * G * dhL) / L", `(${decay}) * (bedTriggered(i, x > 0 ? i - 1 : -1) ? fL[i] : 0) + (bedTriggered(i, x > 0 ? i - 1 : -1) ? 0 : fL[i]) + (DT * A * G * dhL) / L`).replace("fR[i] + (DT * A * G * dhR) / L", `(${decay}) * (bedTriggered(i, x < N - 1 ? i + 1 : -1) ? fR[i] : 0) + (bedTriggered(i, x < N - 1 ? i + 1 : -1) ? 0 : fR[i]) + (DT * A * G * dhR) / L`).replace("fT[i] + (DT * A * G * dhT) / L", `(${decay}) * (bedTriggered(i, y > 0 ? i - N : -1) ? fT[i] : 0) + (bedTriggered(i, y > 0 ? i - N : -1) ? 0 : fT[i]) + (DT * A * G * dhT) / L`).replace("fB[i] + (DT * A * G * dhB) / L", `(${decay}) * (bedTriggered(i, y < N - 1 ? i + N : -1) ? fB[i] : 0) + (bedTriggered(i, y < N - 1 ? i + N : -1) ? 0 : fB[i]) + (DT * A * G * dhB) / L`);
  }
  source = source.replace("  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      const inL =", "  // Snapshot terrain before the direct erosion/deposition pass.\n  bedBeforeMorph.set(b);\n\n  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      const inL =");
  source = source.replace("  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      const fin =", "  if (observeFluxStep) recordFluxObservation();\n\n  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      const fin =");
  source = source.replace("  }\n\n  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      let sx =", "  }\n\n  // Preserve signed and absolute change until next hydraulic update.\n  for (let i = 0; i < NN; i++) { signedBedChange[i] = b[i] - bedBeforeMorph[i]; bedChangeSinceHydraulics[i] = Math.abs(signedBedChange[i]); }\n\n  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      let sx =");
  if (!source.includes("recordFluxObservation();") || !source.includes("bedChangeSinceHydraulics[i] = Math.abs(signedBedChange[i])")) throw new Error(`Instrumentation injection failed: ${family}`);
  return source;
}

function simulate(source, maximumSteps, observe) {
  const math = Object.create(Math); math.random = () => .3141592653;
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", `${source}
    genTerrain();
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    const snapshot = () => ({ N, NN, b, bInit, d, s, u, v, fL, fR, fT, fB, source: sourcePoint, cumulativeErosion, cumulativeDeposition, fluxObservation, triggerAggregate });
    for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); if (${JSON.stringify(checkpoints)}.includes(stepIndex) || stepIndex === 20000) observe(stepIndex, snapshot()); }
  `)(math, Float32Array, Float64Array, Int32Array, Uint8Array, observe);
}

function referenceFlowPath(snapshot) { const cells = [], visited = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0]; for (let position = 0; position < 41 && !visited[cell]; position++) { cells.push(cell); visited[cell] = 1; const x = cell % snapshot.N, y = (cell / snapshot.N) | 0; let next = -1, projection = 0; for (const [dx, dy] of d8) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const candidate = ny * snapshot.N + nx, score = snapshot.u[cell] * dx + snapshot.v[cell] * dy; if (!visited[candidate] && score > projection) { projection = score; next = candidate; } } if (next < 0) break; cell = next; } return cells; }
function section(snapshot, pathCells, position) { const cell = pathCells[Math.min(position, pathCells.length - 1)], before = pathCells[Math.max(0, position - 1)], after = pathCells[Math.min(pathCells.length - 1, position + 1)], dx = (after % snapshot.N) - (before % snapshot.N), dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0), length = Math.hypot(dx, dy) || 1, x = cell % snapshot.N, y = (cell / snapshot.N) | 0, normalX = -Math.sign(dy), normalY = Math.sign(dx); let discharge = 0, magnitude = 0, vectorU = 0, vectorV = 0; for (let offset = -2; offset <= 2; offset++) { const sx = x + normalX * offset, sy = y + normalY * offset; if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue; const i = sy * snapshot.N + sx, speed = Math.hypot(snapshot.u[i], snapshot.v[i]); discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length); magnitude += snapshot.d[i] * speed; vectorU += snapshot.d[i] * snapshot.u[i]; vectorV += snapshot.d[i] * snapshot.v[i]; } return { discharge, coherence: Math.hypot(vectorU, vectorV) / Math.max(magnitude, epsilon) }; }
function connectedWetCells(snapshot) { const visited = new Uint8Array(snapshot.NN), queue = []; for (const i of [snapshot.source.y * snapshot.N + snapshot.source.x, ...snapshot.source.outletIndices]) if (snapshot.d[i] > wetThreshold && !visited[i]) { visited[i] = 1; queue.push(i); } for (let head = 0; head < queue.length; head++) { const i = queue[head], x = i % snapshot.N, y = (i / snapshot.N) | 0; for (const [dx, dy] of d8) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N) { const next = ny * snapshot.N + nx; if (snapshot.d[next] > wetThreshold && !visited[next]) { visited[next] = 1; queue.push(next); } } } } return queue.length; }
function metrics(snapshot, pathCells) { let grossErosion = 0, grossDeposition = 0, absoluteNetBedChange = 0, totalWater = 0, wetCellCount = 0; for (let i = 0; i < snapshot.NN; i++) { grossErosion += snapshot.cumulativeErosion[i]; grossDeposition += snapshot.cumulativeDeposition[i]; absoluteNetBedChange += Math.abs(snapshot.b[i] - snapshot.bInit[i]); totalWater += snapshot.d[i]; if (snapshot.d[i] > wetThreshold) wetCellCount++; } const zones = [[0, 5], [6, 15], [16, pathCells.length - 1]].map(([start, end]) => { const values = []; for (let p = start; p <= Math.min(end, pathCells.length - 1); p++) values.push(section(snapshot, pathCells, p)); return { discharge: mean(values.map((value) => value.discharge)), coherence: mean(values.map((value) => value.coherence)) }; }); return { grossErosion, grossDeposition, grossTurnover: grossErosion + grossDeposition, absoluteNetBedChange, downstreamDischarge: zones[2].discharge, downstreamVsMouth: zones[2].discharge / Math.max(zones[0].discharge, epsilon), directionalCoherence: mean(zones.map((zone) => zone.coherence)), wetConnectedCellCount: connectedWetCells(snapshot), totalWater, wetCellCount, ...snapshot.fluxObservation }; }
function runVariant(variant, maximumSteps, pathCells) { const rows = {}, buffers = {}; let triggerAggregate; simulate(variant.source, maximumSteps, (step, snapshot) => { rows[step] = metrics(snapshot, pathCells); triggerAggregate = snapshot.triggerAggregate; if (variant.control && equalityCheckpoints.includes(step)) buffers[step] = Object.fromEntries(["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"].map((key) => [key, new Float32Array(snapshot[key])])); }); return { ...variant, checkpoints: rows, buffers, triggerAggregate }; }
function differences(current, control) { return Object.fromEntries(equalityCheckpoints.map((step) => [step, Object.fromEntries(["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"].map((key) => [key, maxDifference(current.buffers[step][key], control.buffers[step][key])]))])); }
function exact(difference) { return Object.values(difference).every((row) => Object.values(row).every((value) => value === 0)); }
function collapseStep(run, threshold) { return checkpoints.find((step) => run.checkpoints[step].downstreamDischarge < threshold) ?? null; }
function candidate(run, current, noMorph) { return [5000, 10000].every((step) => { const row = run.checkpoints[step], baseline = current.checkpoints[step], healthy = noMorph.checkpoints[step]; return row.downstreamDischarge >= .5 * healthy.downstreamDischarge && row.directionalCoherence >= baseline.directionalCoherence && row.grossTurnover >= .7 * baseline.grossTurnover && row.grossTurnover <= 1.3 * baseline.grossTurnover && row.absoluteNetBedChange >= .7 * baseline.absoluteNetBedChange && row.absoluteNetBedChange <= 1.3 * baseline.absoluteNetBedChange && run.collapseStep === null; }); }
function classify(memoryRuns, bedRuns, candidates) { if (candidates.some((run) => run.family === "MEMORY_DECAY")) return "FLUX-MEMORY A — reducing hydraulic flux memory prevents collapse while preserving morphodynamics"; if (candidates.some((run) => run.family === "BED_TRIGGERED")) return "FLUX-MEMORY B — bed-change-triggered flux adaptation prevents collapse while preserving morphodynamics"; if (memoryRuns.some((run) => run.collapseStep === null) || bedRuns.some((run) => run.collapseStep === null)) return "FLUX-MEMORY C — memory changes delay collapse but fail long-run"; return "FLUX-MEMORY D — flux memory is not the dominant mechanism"; }

function main() {
  const current = { name: "CURRENT", family: "CURRENT", control: true, source: instrumentedSource({}) };
  let reference; simulate(current.source, 1000, (step, snapshot) => { if (step === 1000) reference = { N: snapshot.N, NN: snapshot.NN, u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v), source: snapshot.source }; }); const pathCells = referenceFlowPath(reference); if (!pathCells.length) throw new Error("Frozen CURRENT@1000 reference path is empty"); progress(`[reference path] CURRENT@1000 ${pathCells.length} cells`);
  /* Legacy combined sweep retained only as historical source; never execute MEMORY_FACTOR again.
  const runs = []; for (const variant of variants) { progress(`[run] ${variant.name}`); runs.push(runVariant(variant, 10000, pathCells)); progress(`[completed] ${variant.name}`); }
  const byName = Object.fromEntries(runs.map((run) => [run.name, run])); const baseline = byName.CURRENT, healthy = byName.NO_MORPH, controls = { memoryFactor1BitIdentical: differences(baseline, byName.MEMORY_FACTOR_1) }; controls.memoryFactor1Exact = exact(controls.memoryFactor1BitIdentical); if (!controls.memoryFactor1Exact) throw new Error(`MEMORY_FACTOR_1 control failed: ${JSON.stringify(controls.memoryFactor1BitIdentical)}`); progress("[control] MEMORY_FACTOR_1 exact PASS");
  const threshold = mean([baseline.checkpoints[250].downstreamDischarge, baseline.checkpoints[500].downstreamDischarge]) * .25; for (const run of runs) run.collapseStep = collapseStep(run, threshold);
  const memoryRuns = runs.filter((run) => run.family === "MEMORY_DECAY" && run.factor !== 1), bedRuns = runs.filter((run) => run.family === "BED_TRIGGERED"); const candidates = runs.filter((run) => (run.family === "MEMORY_DECAY" || run.family === "BED_TRIGGERED") && candidate(run, baseline, healthy)); for (const run of candidates) { progress(`[candidate 20000] ${run.name}`); run.checkpoints[20000] = runVariant(run, 20000, pathCells).checkpoints[20000]; }
  const classification = classify(memoryRuns, bedRuns, candidates); const classificationEvidence = { candidateRule: "At 5000 and 10000: Q >= 50% NO_MORPH, coherence >= CURRENT, gross turnover and absolute net bed change each 70–130% CURRENT, no collapse through 10000.", collapseDefinition: "First 250-step checkpoint with Q below 25% of mean CURRENT Q@250/Q@500.", collapseThreshold: threshold, memoryFactorOneExact: controls.memoryFactor1Exact, currentCollapseStep: baseline.collapseStep, candidateCount: candidates.length };
  const summary = { controls: { productionSimulationModified: false, memoryFactor1Exact: controls.memoryFactor1Exact, memoryFactor1BitIdentical: controls.memoryFactor1BitIdentical, noMorph: "Existing healthy hydraulic control, with direct bed exchange disabled benchmark-only.", frozenReferencePath: "CURRENT@1000", referencePathCellCount: pathCells.length }, temporalOrder: "injectSources -> copy prior flux for diagnostics -> flux update -> flux diagnostics against pre-water head -> water update -> velocity/direct erosion-deposition -> capture previousBed -> sediment transport/evaporation", previousBedSemantics: "previousBed is initialized from terrain and captured immediately after each direct morphodynamic pass. Therefore the following hydraulic step knows whether either adjacent bed changed during preceding step.", currentTimeline: baseline.checkpoints, currentCriticalWindow: [4750, 5000, 5250].map((step) => ({ step, ...baseline.checkpoints[step] })), memoryDecayVariants: memoryRuns.map(({ source, buffers, ...run }) => run), bedTriggeredVariants: bedRuns.map(({ source, buffers, ...run }) => run), candidates: candidates.map((run) => run.name), classification, classificationEvidence, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${classification}`); console.table(memoryRuns.map((run) => ({ factor: run.factor, Q5000: run.checkpoints[5000].downstreamDischarge, Q10000: run.checkpoints[10000].downstreamDischarge, collapseStep: run.collapseStep, GT10000Current: run.checkpoints[10000].grossTurnover / Math.max(baseline.checkpoints[10000].grossTurnover, epsilon), NB10000Current: run.checkpoints[10000].absoluteNetBedChange / Math.max(baseline.checkpoints[10000].absoluteNetBedChange, epsilon), adverseFluxFraction10000: run.checkpoints[10000].adverseFluxFraction }))); console.log(classification); */
  const sanity = {}; for (const threshold of sanityThresholds) { const run = runVariant({ threshold, source: instrumentedSource({ threshold, collectEveryStep: true }) }, 1000, pathCells); const a = run.triggerAggregate; sanity[threshold] = { stepsWithTriggeredFaces: a.stepsWithTriggeredFaces, meanTriggeredFaceCount: a.triggeredFaceCount / a.samples, maxTriggeredFaceCount: a.maxTriggeredFaceCount, meanTriggeredFluxFraction: a.triggeredFluxFraction / a.samples }; } progress(`[sanity] ${JSON.stringify(sanity)}`); if (!sanity[0].maxTriggeredFaceCount) throw new Error("BED_TRIGGERED sanity failed at threshold=0");
  const baseline = runVariant(current, 10000, pathCells), healthy = runVariant({ source: instrumentedSource({ mode: "NO_MORPH" }) }, 10000, pathCells), bedRuns = [];
  for (const threshold of bedThresholds) for (const decay of bedDecayFactors) { const run = { name: `BED_CHANGE threshold=${threshold} decay=${decay}`, threshold, decay, control: decay === 1, source: instrumentedSource({ family: "BED_TRIGGERED", threshold, decay }) }; progress(`[run] ${run.name}`); bedRuns.push(runVariant(run, 10000, pathCells)); }
  const controls = Object.fromEntries(bedRuns.filter((run) => run.decay === 1).map((run) => [run.threshold, differences(baseline, run)])); if (!Object.values(controls).every(exact)) throw new Error(`BED_TRIGGERED decay=1 control failed: ${JSON.stringify(controls)}`);
  const collapseThreshold = mean([baseline.checkpoints[250].downstreamDischarge, baseline.checkpoints[500].downstreamDischarge]) * .25; for (const run of bedRuns) run.collapseStep = collapseStep(run, collapseThreshold); const candidates = bedRuns.filter((run) => candidate(run, baseline, healthy));
  const classification = candidates.length ? "BED-FLUX A — local bed-change-triggered flux adaptation prevents collapse while preserving morphodynamics" : bedRuns.some((run) => run.collapseStep === null) ? "BED-FLUX B — local adaptation delays collapse but fails long-run" : "BED-FLUX D — correctly triggered local adaptation has little/no useful effect";
  const table = bedRuns.map((run) => ({ threshold: run.threshold, decay: run.decay, triggeredFluxFraction5000: run.checkpoints[5000].triggeredFluxFraction, triggeredFluxFraction10000: run.checkpoints[10000].triggeredFluxFraction, Q5000: run.checkpoints[5000].downstreamDischarge, Q10000: run.checkpoints[10000].downstreamDischarge, collapseStep: run.collapseStep, GT10000CURRENT: run.checkpoints[10000].grossTurnover / baseline.checkpoints[10000].grossTurnover, NB10000CURRENT: run.checkpoints[10000].absoluteNetBedChange / baseline.checkpoints[10000].absoluteNetBedChange, fluxPersistence10000: run.checkpoints[10000].fluxPersistence, adverseFluxFraction10000: run.checkpoints[10000].adverseFluxFraction, candidate: candidates.includes(run) }));
  const summary = { controls: { productionSimulationModified: false, bedTriggeredDecayOneExact: true, bedTriggeredDecayOneBitIdentical: controls }, temporalOrder: "injectSources -> flux update uses prior bedChangeSinceHydraulics -> water update -> velocity -> bedBeforeMorph.set(b) -> erosion/deposition -> signedBedChange and bedChangeSinceHydraulics capture -> sediment transport/evaporation", triggerSemantics: "Absolute change triggers faces; signed change separates erosion, deposition, and mixed faces. Fractions use triggered directed faces as denominator.", sanityCheckCurrent1000: sanity, currentTimeline: baseline.checkpoints, noMorphTimeline: healthy.checkpoints, bedTriggeredVariants: bedRuns.map(({ source, buffers, triggerAggregate, ...run }) => run), bedTriggeredTable: table, candidates: candidates.map((run) => run.name), classification, legacy: { globalMemoryDecay: legacySummary?.memoryDecayVariants ?? "GLOBAL MEMORY DECAY: hydraulic improvement coupled to severe morphodynamic suppression.", invalidBedTriggered: "INVALID — trigger state overwritten before next hydraulic step." }, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${classification}`); console.table(table);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
