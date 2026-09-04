/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Observes whether CURRENT's transported-water network persistently leaves its
 * CURRENT@1000 spatial reference. Instrumentation is injected into an isolated
 * evaluated source string: production simulation and its physics stay unchanged.
 *
 * RUN:
 * node tests/diagnostics/channel-avulsion-diagnostic.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/channel-avulsion");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const wetThreshold = 1e-6;
const thresholds = [0.8, 0.9, 0.95];

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()} CURRENT deterministic channel-avulsion diagnostic\n`);
const progress = (message) => fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`);
const percentile = (values, fraction) => { const ordered = [...values].sort((a, b) => a - b); return ordered.length ? ordered[Math.floor((ordered.length - 1) * fraction)] : 0; };
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const observeStep = (step) => [1000, 2500, 4000].includes(step) || (step >= 4500 && step <= 5500) || (step > 5500 && step % 25 === 0);

/** Adds step-local exchange observations at existing erosion/deposition writes. */
function instrumentedSource() {
  let source = `${currentSource}\nlet diagnosticStepErosion = new Float64Array(NN); let diagnosticStepDeposition = new Float64Array(NN);`;
  source = source.replace(/const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, "const diff = KS * (C - si) * sourceProtectionMask[i]; diagnosticStepErosion[i] = diff; b[i] -= diff; s[i] = si + diff;");
  source = source.replace(/const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, "const diff = KD * (si - C); diagnosticStepDeposition[i] = diff; b[i] += diff; s[i] = Math.max(0, si - diff);");
  if (!source.includes("diagnosticStepErosion[i] = diff") || !source.includes("diagnosticStepDeposition[i] = diff")) throw new Error("Diagnostic instrumentation injection failed");
  return source;
}

function traceFrozenPath(snapshot) {
  const pathCells = []; const used = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0];
  for (let count = 0; count < 64 && !used[cell]; count++) {
    pathCells.push(cell); used[cell] = 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; let next = -1; let projection = 0;
    for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const candidate = ny * snapshot.N + nx; const score = snapshot.u[cell] * dx + snapshot.v[cell] * dy; if (!used[candidate] && score > projection) { projection = score; next = candidate; } }
    if (next < 0) break; cell = next;
  }
  return pathCells;
}
function distancesToPath(N, NN, frozenPath) {
  const distances = new Float32Array(NN);
  for (let i = 0; i < NN; i++) { const x = i % N; const y = (i / N) | 0; let nearest = Infinity; for (const cell of frozenPath) nearest = Math.min(nearest, Math.hypot(x - cell % N, y - ((cell / N) | 0))); distances[i] = nearest; }
  return distances;
}
function activeMask(snapshot, p) {
  const wetQ = []; for (let i = 0; i < snapshot.NN; i++) if (snapshot.d[i] > wetThreshold) wetQ.push(snapshot.d[i] * Math.hypot(snapshot.u[i], snapshot.v[i]));
  const cutoff = percentile(wetQ, p); const mask = new Uint8Array(snapshot.NN); for (let i = 0; i < snapshot.NN; i++) if (snapshot.d[i] > wetThreshold && snapshot.d[i] * Math.hypot(snapshot.u[i], snapshot.v[i]) > cutoff) mask[i] = 1;
  return { mask, cutoff };
}
function labelledComponents(mask, snapshot) {
  const labels = new Int32Array(snapshot.NN); labels.fill(-1); const components = [];
  for (let start = 0; start < snapshot.NN; start++) {
    if (!mask[start] || labels[start] >= 0) continue; const cells = [start]; labels[start] = components.length;
    for (let head = 0; head < cells.length; head++) { const i = cells[head]; const x = i % snapshot.N; const y = (i / snapshot.N) | 0; for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const next = ny * snapshot.N + nx; if (mask[next] && labels[next] < 0) { labels[next] = components.length; cells.push(next); } } }
    components.push(cells);
  }
  const seeds = [snapshot.source.y * snapshot.N + snapshot.source.x, ...snapshot.source.outletIndices]; let sourceLabel = -1;
  for (const seed of seeds) if (labels[seed] >= 0) { sourceLabel = labels[seed]; break; }
  return { labels, components, sourceCells: sourceLabel >= 0 ? components[sourceLabel] : [] };
}
function weightedPercentile(rows, fraction) { const total = rows.reduce((sum, row) => sum + row.weight, 0); let cumulative = 0; for (const row of rows.sort((a, b) => a.value - b.value)) { cumulative += row.weight; if (cumulative >= total * fraction) return row.value; } return 0; }
function fluxAcrossNormal(snapshot, cells) {
  if (!cells.length) return null; let ux = 0; let uy = 0; for (const i of cells) { ux += snapshot.u[i]; uy += snapshot.v[i]; } const length = Math.hypot(ux, uy); if (!length) return null; const nx = -uy / length; const ny = ux / length; const center = cells[Math.floor(cells.length / 2)]; const cx = center % snapshot.N; const cy = (center / snapshot.N) | 0; let flux = 0;
  for (let offset = -3; offset <= 3; offset++) { const x = Math.round(cx + nx * offset); const y = Math.round(cy + ny * offset); if (x >= 0 && y >= 0 && x < snapshot.N && y < snapshot.N) { const i = y * snapshot.N + x; flux += snapshot.d[i] * Math.max(0, (snapshot.u[i] * ux + snapshot.v[i] * uy) / length); } }
  return flux;
}
function corridorMetrics(snapshot, predicate) {
  let water = 0, q = 0, bed = 0, depth = 0, sediment = 0, erosion = 0, deposition = 0, count = 0;
  for (let i = 0; i < snapshot.NN; i++) if (predicate(i)) { count++; const qi = snapshot.d[i] * Math.hypot(snapshot.u[i], snapshot.v[i]); water += snapshot.d[i]; q += qi; bed += snapshot.b[i]; depth += snapshot.d[i]; sediment += snapshot.s[i]; erosion += snapshot.diagnosticStepErosion[i]; deposition += snapshot.diagnosticStepDeposition[i]; }
  return { cells: count, water, q, meanBed: bed / Math.max(1, count), meanDepth: depth / Math.max(1, count), sediment, erosionStep: erosion, depositionStep: deposition };
}
function thresholdMetrics(snapshot, distances, p) {
  const { mask, cutoff } = activeMask(snapshot, p); const network = labelledComponents(mask, snapshot); let qTotal = 0, divertedQ = 0;
  for (let i = 0; i < snapshot.NN; i++) if (mask[i]) { const q = snapshot.d[i] * Math.hypot(snapshot.u[i], snapshot.v[i]); qTotal += q; if (distances[i] > 10) divertedQ += q; }
  return { mask, network, cutoff, activeCellCount: mask.reduce((sum, value) => sum + value, 0), sourceConnectedActiveCells: network.sourceCells.length, largestActiveComponent: Math.max(0, ...network.components.map((component) => component.length)), activeComponentCount: network.components.length, divertedFraction: divertedQ / Math.max(qTotal, 1e-12), activeQMagnitude: qTotal };
}
function branchClusters(snapshot, primary, distances) {
  const candidates = new Uint8Array(snapshot.NN); for (const i of primary.network.sourceCells) if (distances[i] > 10) candidates[i] = 1;
  const network = labelledComponents(candidates, snapshot);
  return network.components.filter((cells) => cells.length > 10).map((cells) => { let q = 0, distance = 0, maxDistance = 0; for (const i of cells) { const qi = snapshot.d[i] * Math.hypot(snapshot.u[i], snapshot.v[i]); q += qi; distance += qi * distances[i]; maxDistance = Math.max(maxDistance, distances[i]); } return { cells, activeCells: cells.length, qMagnitude: q, meanDistanceFrozen: distance / Math.max(q, 1e-12), maxDistanceFrozen: maxDistance }; });
}
function matchBranches(clusters, tracks, step) {
  const claimed = new Set();
  for (const cluster of clusters) { let best = null; let bestOverlap = 0; for (const track of tracks) { if (claimed.has(track.id)) continue; let overlap = 0; for (const i of cluster.cells) if (track.lastCells.has(i)) overlap++; if (overlap > bestOverlap) { bestOverlap = overlap; best = track; } } if (!best || bestOverlap / Math.max(1, cluster.cells.length) < .15) { best = { id: tracks.length + 1, birthStep: step, deathStep: step, maxActiveCells: 0, maxQMagnitude: 0, distanceSamples: [], maxDistanceFrozen: 0, lastCells: new Set(), samples: [] }; tracks.push(best); } claimed.add(best.id); best.deathStep = step; best.maxActiveCells = Math.max(best.maxActiveCells, cluster.activeCells); best.maxQMagnitude = Math.max(best.maxQMagnitude, cluster.qMagnitude); best.distanceSamples.push(cluster.meanDistanceFrozen); best.maxDistanceFrozen = Math.max(best.maxDistanceFrozen, cluster.maxDistanceFrozen); best.lastCells = new Set(cluster.cells); best.samples.push({ step, activeCells: cluster.activeCells, qMagnitude: cluster.qMagnitude, meanDistanceFrozen: cluster.meanDistanceFrozen, maxDistanceFrozen: cluster.maxDistanceFrozen, cells: cluster.cells }); cluster.trackId = best.id; }
}
function firstSustained(rows, predicate, required = 10) { let run = 0; for (const row of rows) { run = predicate(row) ? run + 1 : 0; if (run >= required) return rows[rows.indexOf(row) - required + 1].step; } return null; }
function main() {
  const rows = []; const tracks = []; let frozenPath; let frozenDistances; let previousBed; let dominantTrackId = null;
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", `${instrumentedSource()}\n genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const snapshot = () => ({ N, NN, b, d, s, u, v, fL, fR, fT, fB, source: sourcePoint, diagnosticStepErosion, diagnosticStepDeposition }); for (let stepIndex = 1; stepIndex <= 7000; stepIndex++) { step(); observe(stepIndex, snapshot()); diagnosticStepErosion.fill(0); diagnosticStepDeposition.fill(0); }`)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Float64Array, Int32Array, Uint8Array, (step, snapshot) => {
    if (step === 1000) { frozenPath = traceFrozenPath(snapshot); frozenDistances = distancesToPath(snapshot.N, snapshot.NN, frozenPath); previousBed = new Float32Array(snapshot.b); progress(`[reference] frozenPath=CURRENT@1000 cells=${frozenPath.length}`); }
    if (!frozenPath || !observeStep(step)) { if (previousBed) previousBed.set(snapshot.b); return; }
    const all = Object.fromEntries(thresholds.map((p) => [String(p), thresholdMetrics(snapshot, frozenDistances, p)])); const primary = all["0.9"]; const clusters = branchClusters(snapshot, primary, frozenDistances); matchBranches(clusters, tracks, step);
    const activeRows = []; let activeQ = 0; const bands = { within2: 0, "2to5": 0, "5to10": 0, "10to20": 0, outside20: 0 };
    for (let i = 0; i < snapshot.NN; i++) if (primary.mask[i]) { const q = snapshot.d[i] * Math.hypot(snapshot.u[i], snapshot.v[i]); activeQ += q; activeRows.push({ value: frozenDistances[i], weight: q }); if (frozenDistances[i] <= 2) bands.within2 += q; else if (frozenDistances[i] <= 5) bands["2to5"] += q; else if (frozenDistances[i] <= 10) bands["5to10"] += q; else if (frozenDistances[i] <= 20) bands["10to20"] += q; else bands.outside20 += q; }
    const frozenCorridor = corridorMetrics(snapshot, (i) => frozenDistances[i] <= 2); const branchIds = clusters.map((cluster) => cluster.trackId); const row = { step, p80: { divertedFraction: all["0.8"].divertedFraction, activeCellCount: all["0.8"].activeCellCount, sourceConnectedActiveCells: all["0.8"].sourceConnectedActiveCells }, p90: { divertedFraction: primary.divertedFraction, activeCellCount: primary.activeCellCount, sourceConnectedActiveCells: primary.sourceConnectedActiveCells }, p95: { divertedFraction: all["0.95"].divertedFraction, activeCellCount: all["0.95"].activeCellCount, sourceConnectedActiveCells: all["0.95"].sourceConnectedActiveCells }, activeCellCount: primary.activeCellCount, sourceConnectedActiveCells: primary.sourceConnectedActiveCells, largestActiveComponent: primary.largestActiveComponent, activeComponentCount: primary.activeComponentCount, totalQMagnitude: activeQ, distanceFrozen: { meanDistanceFrozen: activeQ ? activeRows.reduce((sum, item) => sum + item.value * item.weight, 0) / activeQ : 0, p50DistanceFrozen: weightedPercentile(activeRows, .5), p90DistanceFrozen: weightedPercentile(activeRows, .9), maxDistanceFrozen: Math.max(0, ...activeRows.map((item) => item.value)), fractionsQ: Object.fromEntries(Object.entries(bands).map(([key, value]) => [key, value / Math.max(activeQ, 1e-12)])) }, divertedFraction: primary.divertedFraction, sourceConnectedHasDivertedCells: primary.network.sourceCells.some((i) => frozenDistances[i] > 10), branches: clusters.map(({ cells, ...branch }) => ({ ...branch, branchFlux: fluxAcrossNormal(snapshot, cells) })), branchTrackIds: branchIds, frozenPathQ: frozenCorridor.q, frozenCorridorFlux: fluxAcrossNormal(snapshot, frozenPath), oldWater: frozenCorridor.water, oldQ: frozenCorridor.q, oldMeanBed: frozenCorridor.meanBed, oldMeanDepth: frozenCorridor.meanDepth, oldSediment: frozenCorridor.sediment, oldErosionStep: frozenCorridor.erosionStep, oldDepositionStep: frozenCorridor.depositionStep, totalWater: corridorMetrics(snapshot, () => true).water };
    rows.push(row); previousBed.set(snapshot.b);
  });
  const candidateStep = firstSustained(rows, (row) => row.divertedFraction > .5 && row.sourceConnectedHasDivertedCells);
  const dominant = tracks.sort((a, b) => b.maxQMagnitude - a.maxQMagnitude)[0]; if (dominant) dominantTrackId = dominant.id;
  const dominantSamples = dominant ? dominant.samples : []; const firstNewBranchBirth = dominant ? dominant.birthStep : null; const firstPersistentNewBranch = dominant ? firstSustained(rows, (row) => row.branchTrackIds.includes(dominant.id), 10) : null;
  let divergence = null;
  if (dominantSamples.length) { const cells = dominantSamples.reduce((best, sample) => sample.qMagnitude > best.qMagnitude ? sample : best).cells; let best = null; for (const pathCell of frozenPath) for (const cell of cells) { const distance = Math.abs(pathCell % 192 - cell % 192) + Math.abs(((pathCell / 192) | 0) - ((cell / 192) | 0)); if (!best || distance < best.distance) best = { pathCell, distance }; } divergence = { x: best.pathCell % 192, y: (best.pathCell / 192) | 0, distanceToDominantBranch: best.distance }; }
  const dynamicRows = rows.map((row) => { const sample = dominant ? dominant.samples.find((entry) => entry.step === row.step) : null; return { ...row, dominantBranchQMagnitude: sample?.qMagnitude || 0, dominantBranchFlux: row.branches.find((branch) => branch.trackId === dominantTrackId)?.branchFlux || null, newChannelAvailable: Boolean(sample) }; });
  // Re-run deterministic CURRENT only to derive branch-relative corridors after
  // the dominant branch and its divergence point are known.
  const local = collectLocalMorphology(frozenPath, frozenDistances, divergence, dominantTrackId);
  for (const row of dynamicRows) Object.assign(row, local.get(row.step) || {});
  const firstHeadPreferenceFlip = firstSustained(dynamicRows, (row) => row.newChannelAvailable && Number.isFinite(row.divergence?.headNewDirection) && row.divergence.headNewDirection < row.divergence.headOldDirection, 10);
  const firstNewBranchFluxDominance = firstSustained(dynamicRows, (row) => row.dominantBranchQMagnitude > row.frozenCorridorFlux, 10);
  const historical = JSON.parse(fs.readFileSync(path.join(root, "tests/generated/collapse-event/summary.json"), "utf8"));
  const robustness = Object.fromEntries(["p80", "p90", "p95"].map((key) => [key, { divertedFraction: dynamicRows.map((row) => ({ step: row.step, value: row[key].divertedFraction })), avulsionCandidateStep: firstSustained(dynamicRows, (row) => row[key].divertedFraction > .5 && row.sourceConnectedHasDivertedCells) }]));
  const candidates = Object.values(robustness).map((entry) => entry.avulsionCandidateStep); const uncertain = new Set(candidates.filter((step) => step !== null)).size > 1 || candidates.some((step) => step === null);
  const localBeforeFlip = dynamicRows.filter((row) => firstHeadPreferenceFlip && row.step >= firstHeadPreferenceFlip - 100 && row.step < firstHeadPreferenceFlip);
  const oldDeposition = localBeforeFlip.reduce((sum, row) => sum + (row.divergence?.depositionOldBranch || 0), 0);
  const newErosion = localBeforeFlip.reduce((sum, row) => sum + (row.divergence?.erosionNewBranch || 0), 0);
  const classification = uncertain || !dominant || !firstPersistentNewBranch ? "AVULSION F — METRIC/NETWORK EXTRACTION UNCERTAIN" : oldDeposition > newErosion * 1.5 ? "AVULSION B — DEPOSITION-BLOCKED OLD CHANNEL" : newErosion > oldDeposition * 1.5 ? "AVULSION C — EROSION-CAPTURED NEW CHANNEL" : oldDeposition > 0 && newErosion > 0 ? "AVULSION D — COUPLED MORPHODYNAMIC AVULSION" : "AVULSION E — HYDRAULIC SWITCH WITHOUT LOCAL MORPHOLOGIC DRIVER";
  const longTerm = dynamicRows.filter((row) => [5500, 6000, 6500, 7000].includes(row.step)).map((row) => ({ step: row.step, totalQMagnitude: row.totalQMagnitude, bandNetFluxes: bandFluxes(row), divertedFraction: row.divertedFraction, sourceConnectedActiveCells: row.sourceConnectedActiveCells }));
  const summary = { controls: { run: "CURRENT only", deterministicRandom: .3141592653, simulationSteps: 7000, snapshotCadence: "1000,2500,4000,4500; every step 4500..5500; every 25 steps 5500..7000", productionSimulationModified: false, productionPhysicsModified: false }, methodology: { frozenPath: "CURRENT@1000 spatial reference only", frozenPathQ: "transport magnitude in frozenPath distance<=2 corridor; not downstream health", active: "d > 1e-6 AND q=d*hypot(u,v) > percentile(q wet cells)", sourceConnected: "D8 ACTIVE component touching source or one configured outlet; zero when no ACTIVE seed exists" }, frozenPath: { cells: frozenPath.length }, avulsionDefinition: "candidate: divertedFraction > 0.50 for >=10 consecutive observed steps and source-connected ACTIVE cells >10 cells from frozenPath; descriptive threshold, not physical truth", avulsionCandidateStep: candidateStep, branches: tracks.map(({ lastCells, samples, distanceSamples, ...track }) => ({ ...track, meanDistanceFrozen: mean(distanceSamples) })), dominantDivertedBranch: dominant ? { id: dominant.id, birthStep: dominant.birthStep, deathStep: dominant.deathStep, maxActiveCells: dominant.maxActiveCells, maxQMagnitude: dominant.maxQMagnitude, meanDistanceFrozen: mean(dominant.distanceSamples), maxDistanceFrozen: dominant.maxDistanceFrozen } : null, divergencePoint: divergence, timeline: { firstNewBranchBirth, firstPersistentNewBranch, firstHeadPreferenceFlip, firstNewBranchFluxDominance, avulsionCandidateStep: candidateStep, frozenPathHistoricalCrossing4824: historical.exactCollapseStep, largestHistoricalQDrop4969: historical.largestSingleStepQDrop?.step }, robustness: { ...robustness, classification: uncertain ? "uncertain" : "consistent" }, localMorphologyBeforeHeadFlip: { oldDeposition, newErosion }, longTerm, classification, classificationBasis: "Automated conservative classification; local morphology observations retained in timeline.", timelineRows: dynamicRows, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${classification}`); console.log(classification);
}
function bandFluxes(row) { return row.bandNetFluxes || null; }
/**
 * Samples two short downstream corridors after divergence. "Direction" values
 * are mean scalar bed/head/depth along each route, enabling like-for-like head
 * preference comparisons rather than claiming a vector head direction.
 */
function collectLocalMorphology(frozenPath, distances, divergence) {
  const output = new Map(); if (!divergence) return output; const divergenceIndex = frozenPath.findIndex((cell) => cell === divergence.y * 192 + divergence.x); const oldCells = frozenPath.slice(Math.max(0, divergenceIndex + 1), divergenceIndex + 7); const oldSet = new Set(oldCells);
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", `${instrumentedSource()}\n genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const snapshot = () => ({ N, NN, b, d, s, u, v, fL, fR, fT, fB, source: sourcePoint, diagnosticStepErosion, diagnosticStepDeposition }); for (let stepIndex = 1; stepIndex <= 7000; stepIndex++) { step(); observe(stepIndex, snapshot()); diagnosticStepErosion.fill(0); diagnosticStepDeposition.fill(0); }`)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Float64Array, Int32Array, Uint8Array, (step, snapshot) => {
    if (!observeStep(step) || step < 1000) return;
    const primary = thresholdMetrics(snapshot, distances, .9); const clusters = branchClusters(snapshot, primary, distances); const branch = clusters.sort((a, b) => b.qMagnitude - a.qMagnitude)[0]; const branchCells = branch ? branch.cells : [];
    const newSet = new Set(); for (const i of branchCells) { const x = i % snapshot.N; const y = (i / snapshot.N) | 0; if (Math.hypot(x - divergence.x, y - divergence.y) <= 20) newSet.add(i); }
    const old = corridorMetrics(snapshot, (i) => oldSet.has(i)); const fresh = corridorMetrics(snapshot, (i) => newSet.has(i));
    const oldHead = mean(oldCells.map((i) => snapshot.b[i] + snapshot.d[i])); const newHead = mean([...newSet].map((i) => snapshot.b[i] + snapshot.d[i]));
    const netFlux = (y) => { let result = 0; for (let x = 0; x < snapshot.N; x++) { const i = y * snapshot.N + x; result += snapshot.fB[i] - (y < snapshot.N - 1 ? snapshot.fT[i + snapshot.N] : 0); } return result; };
    output.set(step, { newWater: fresh.water, newQ: fresh.q, newMeanBed: fresh.meanBed, newMeanDepth: fresh.meanDepth, newErosionStep: fresh.erosionStep, newDepositionStep: fresh.depositionStep, divergence: { bedOldDirection: old.meanBed, bedNewDirection: fresh.meanBed, headOldDirection: oldHead, headNewDirection: newHead, waterOldDirection: old.meanDepth, waterNewDirection: fresh.meanDepth, erosionOldBranch: old.erosionStep, depositionOldBranch: old.depositionStep, erosionNewBranch: fresh.erosionStep, depositionNewBranch: fresh.depositionStep, netBedChangeOld: old.depositionStep - old.erosionStep, netBedChangeNew: fresh.depositionStep - fresh.erosionStep }, bandNetFluxes: { Y64: netFlux(64), Y96: netFlux(96), Y128: netFlux(128), Y160: netFlux(160) } });
  });
  return output;
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
