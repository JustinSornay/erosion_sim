/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Audits whether the historical frozen-path discharge measures hydraulic loss
 * or merely a spatial move of transport. Production physics remains untouched.
 *
 * RUN:
 * node tests/diagnostics/discharge-measurement-audit.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/discharge-measurement-audit");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const cuts = [64, 80, 96, 112, 128, 144, 160, 176];
const checkpoints = [1000, 2500, 4000, 4500, 4750, 4811, 4824, 4900, 4969, 5000, 5250, 5500];
const knownHistoricalQ = { 4750: .24532777991515928, 4824: .13772549418807675, 5000: .005426339139730569 };
const wetThreshold = 1e-6;
const epsilon = 1e-12;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()} CURRENT deterministic discharge measurement audit\n`);
function progress(message) { fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`); }
function mean(values) { return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1); }
function percentile(values, fraction) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]; }
function shouldObserve(step) { return checkpoints.includes(step) || (step >= 4700 && step <= 5050); }

/** Same route extraction as historical diagnostics; only velocity field changes for dynamic paths. */
function traceVelocityPath(snapshot) {
  const cells = [], visited = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0];
  for (let position = 0; position < 41 && !visited[cell]; position++) { cells.push(cell); visited[cell] = 1; const x = cell % snapshot.N, y = (cell / snapshot.N) | 0; let next = -1, projection = 0; for (const [dx, dy] of d8) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const candidate = ny * snapshot.N + nx, score = snapshot.u[cell] * dx + snapshot.v[cell] * dy; if (!visited[candidate] && score > projection) { projection = score; next = candidate; } } if (next < 0) break; cell = next; }
  return cells;
}
/** Surface-gradient route is a diagnostic alternative and is never fed into production routing. */
function traceHeadDownhillPath(snapshot) {
  const cells = [], visited = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0];
  for (let position = 0; position < 41 && !visited[cell]; position++) { cells.push(cell); visited[cell] = 1; const x = cell % snapshot.N, y = (cell / snapshot.N) | 0; if (x === 0 || y === 0 || x === snapshot.N - 1 || y === snapshot.N - 1) break; const head = snapshot.b[cell] + snapshot.d[cell]; let next = -1, bestDrop = 0; for (const [dx, dy] of d8) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const candidate = ny * snapshot.N + nx, drop = head - (snapshot.b[candidate] + snapshot.d[candidate]); if (!visited[candidate] && drop > bestDrop) { bestDrop = drop; next = candidate; } } if (next < 0) break; cell = next; }
  return cells;
}
function sectionDischarge(snapshot, pathCells, position) {
  if (!pathCells.length) return 0;
  const cell = pathCells[Math.min(position, pathCells.length - 1)], before = pathCells[Math.max(0, position - 1)], after = pathCells[Math.min(pathCells.length - 1, position + 1)];
  const dx = (after % snapshot.N) - (before % snapshot.N), dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0), length = Math.hypot(dx, dy) || 1, x = cell % snapshot.N, y = (cell / snapshot.N) | 0, normalX = -Math.sign(dy), normalY = Math.sign(dx); let discharge = 0;
  for (let offset = -2; offset <= 2; offset++) { const sx = x + normalX * offset, sy = y + normalY * offset; if (sx >= 0 && sy >= 0 && sx < snapshot.N && sy < snapshot.N) { const i = sy * snapshot.N + sx; discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length); } }
  return discharge;
}
function downstreamPathQ(snapshot, cells) { return mean(cells.slice(16).map((_, index) => sectionDischarge(snapshot, cells, index + 16))); }
function pathRelationship(cells, frozen, distances) { const frozenSet = new Set(frozen); return { length: cells.length, overlap: cells.filter((cell) => frozenSet.has(cell)).length / Math.max(cells.length, 1), meanDistanceToFrozenPath: mean(cells.map((cell) => distances[cell])), maxDistanceToFrozenPath: Math.max(...cells.map((cell) => distances[cell]), 0) }; }
function distancesToPath(N, NN, cells) { return Float64Array.from({ length: NN }, (_, index) => { const x = index % N, y = (index / N) | 0; return Math.min(...cells.map((cell) => Math.hypot(x - cell % N, y - ((cell / N) | 0)))); }); }
function verticalCuts(snapshot) { return Object.fromEntries(cuts.map((y) => { let southward = 0, northward = 0; for (let x = 0; x < snapshot.N; x++) { southward += snapshot.fB[(y - 1) * snapshot.N + x]; northward += snapshot.fT[y * snapshot.N + x]; } return [y, { grossSouthwardFlux: southward, grossNorthwardFlux: northward, netSouthwardFlux: southward - northward }]; })); }
function transportMetrics(snapshot, distances) {
  let totalQMagnitude = 0, xSum = 0, ySum = 0, qSquaredX = 0, qSquaredY = 0; const values = [], corridors = { within2: { water: 0, qMagnitude: 0 }, within5: { water: 0, qMagnitude: 0 }, within10: { water: 0, qMagnitude: 0 }, outside10: { water: 0, qMagnitude: 0 } };
  for (let i = 0; i < snapshot.NN; i++) { const x = i % snapshot.N, y = (i / snapshot.N) | 0, water = snapshot.d[i], qMagnitude = water * Math.hypot(snapshot.u[i], snapshot.v[i]); totalQMagnitude += qMagnitude; values.push(qMagnitude); xSum += x * qMagnitude; ySum += y * qMagnitude; qSquaredX += x * x * qMagnitude; qSquaredY += y * y * qMagnitude; const bucket = distances[i] <= 2 ? corridors.within2 : distances[i] <= 5 ? corridors.within5 : distances[i] <= 10 ? corridors.within10 : corridors.outside10; bucket.water += water; bucket.qMagnitude += qMagnitude; }
  const transportCentroidX = xSum / Math.max(totalQMagnitude, epsilon), transportCentroidY = ySum / Math.max(totalQMagnitude, epsilon); for (const bucket of Object.values(corridors)) bucket.fractionTotalQMagnitude = bucket.qMagnitude / Math.max(totalQMagnitude, epsilon);
  const wetValues = values.filter((_, index) => snapshot.d[index] > wetThreshold), activeThreshold = percentile(wetValues, .9); let activeCellCount = 0, activeQMagnitude = 0, activeX = 0, activeY = 0, activeDistance = 0;
  for (let i = 0; i < snapshot.NN; i++) { const qMagnitude = values[i]; if (snapshot.d[i] <= wetThreshold || qMagnitude <= activeThreshold) continue; activeCellCount++; activeQMagnitude += qMagnitude; activeX += (i % snapshot.N) * qMagnitude; activeY += ((i / snapshot.N) | 0) * qMagnitude; activeDistance += distances[i] * qMagnitude; }
  return { totalQMagnitude, qMagnitudePercentiles: { p50: percentile(values, .5), p90: percentile(values, .9), p99: percentile(values, .99), max: Math.max(...values) }, transportCentroidX, transportCentroidY, transportStdX: Math.sqrt(Math.max(0, qSquaredX / Math.max(totalQMagnitude, epsilon) - transportCentroidX ** 2)), transportStdY: Math.sqrt(Math.max(0, qSquaredY / Math.max(totalQMagnitude, epsilon) - transportCentroidY ** 2)), corridors, activeNetwork: { definition: "d > 1e-6 and qMagnitude > p90 of wet-cell qMagnitude", threshold: activeThreshold, activeCellCount, activeQMagnitude, centroidX: activeX / Math.max(activeQMagnitude, epsilon), centroidY: activeY / Math.max(activeQMagnitude, epsilon), meanDistanceToFrozenPath: activeDistance / Math.max(activeQMagnitude, epsilon) } };
}
function normalized(value, baseline) { return value / Math.max(Math.abs(baseline), epsilon); }
function representativeBandY(rows) { const healthy = rows.filter((row) => row.step >= 4500 && row.step <= 4750); return [...cuts].sort((left, right) => mean(healthy.map((row) => Math.abs(row.bandNetFluxes[right].netSouthwardFlux))) - mean(healthy.map((row) => Math.abs(row.bandNetFluxes[left].netSouthwardFlux))))[0]; }
function classify(rows) {
  const healthy = rows.filter((row) => row.step >= 4500 && row.step <= 4750), at5000 = rows.find((row) => row.step === 5000);
  const baseline = Object.fromEntries(["historicalFrozenPathQ", "dynamicPathQ", "dynamicHeadPathQ", "totalQMagnitude"].map((key) => [key, mean(healthy.map((row) => row[key]))]));
  const bandY = representativeBandY(rows), bandBaseline = mean(healthy.map((row) => Math.abs(row.bandNetFluxes[bandY].netSouthwardFlux)));
  const independent = [normalized(at5000.dynamicPathQ, baseline.dynamicPathQ), normalized(at5000.dynamicHeadPathQ, baseline.dynamicHeadPathQ), normalized(at5000.totalQMagnitude, baseline.totalQMagnitude), normalized(Math.abs(at5000.bandNetFluxes[bandY].netSouthwardFlux), bandBaseline)];
  const historical = normalized(at5000.historicalFrozenPathQ, baseline.historicalFrozenPathQ), outsideGrowth = at5000.corridors.outside10.fractionTotalQMagnitude - mean(healthy.map((row) => row.corridors.outside10.fractionTotalQMagnitude)), below25 = independent.filter((value) => value < .25).length, above60 = independent.filter((value) => value > .6).length;
  if (historical < .25 && below25 >= 2) return { classification: "DISCHARGE A — TRUE HYDRAULIC COLLAPSE", evidence: { historical, independent, representativeBandY: bandY, below25, outsideGrowth } };
  if (historical < .25 && above60 >= 2 && outsideGrowth > .05) return { classification: "DISCHARGE B — PATH DIVERSION", evidence: { historical, independent, representativeBandY: bandY, above60, outsideGrowth } };
  if (historical < .25 && (independent.filter((value) => value >= .25 && value <= .6).length >= 2 || outsideGrowth > .05)) return { classification: "DISCHARGE C — MIXED COLLAPSE + DIVERSION", evidence: { historical, independent, representativeBandY: bandY, outsideGrowth } };
  return { classification: "DISCHARGE D — HISTORICAL Q METRIC UNRELIABLE", evidence: { historical, independent, representativeBandY: bandY, below25, above60, outsideGrowth } };
}

function main() {
  const rows = []; let frozenPath = null, frozenDistances = null;
  new Function("Math", "Float32Array", "Int32Array", "Uint8Array", "observe", `${currentSource}\n genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const snapshot = () => ({ N, NN, b, d, u, v, fL, fR, fT, fB, source: sourcePoint }); for (let stepIndex = 1; stepIndex <= 5500; stepIndex++) { step(); observe(stepIndex, snapshot()); }`)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Int32Array, Uint8Array, (step, snapshot) => {
    if (step === 1000) { frozenPath = traceVelocityPath(snapshot); frozenDistances = distancesToPath(snapshot.N, snapshot.NN, frozenPath); progress(`[reference] CURRENT@1000 frozenPath=${frozenPath.length}`); }
    if (!frozenPath || !shouldObserve(step)) return;
    const dynamicPath = traceVelocityPath(snapshot), dynamicHeadPath = traceHeadDownhillPath(snapshot), historicalFrozenPathQ = downstreamPathQ(snapshot, frozenPath), dynamicPathQ = downstreamPathQ(snapshot, dynamicPath), dynamicHeadPathQ = downstreamPathQ(snapshot, dynamicHeadPath);
    const row = { step, historicalFrozenPathQ, dynamicPathQ, dynamicHeadPathQ, dynamicVelocityPath: pathRelationship(dynamicPath, frozenPath, frozenDistances), dynamicHeadPath: pathRelationship(dynamicHeadPath, frozenPath, frozenDistances), bandNetFluxes: verticalCuts(snapshot), boundaryOutflow: { bottomBoundaryOutflow: null, topBoundaryOutflow: null, leftBoundaryOutflow: null, rightBoundaryOutflow: null, totalBoundaryOutflow: null, status: "N/A", convention: "simulation.js explicitly zeros outward boundary fluxes before water update; no boundary flux represents evacuation." }, ...transportMetrics(snapshot, frozenDistances) };
    const prior = rows[rows.length - 1]; if (prior) for (const key of ["historicalFrozenPathQ", "dynamicPathQ", "dynamicHeadPathQ", "totalQMagnitude"]) row[`${key}Delta`] = row[key] - prior[key]; rows.push(row); if (checkpoints.includes(step) || step % 50 === 0) progress(`[snapshot] step=${step} frozenQ=${historicalFrozenPathQ} dynamicQ=${dynamicPathQ} transport=${row.totalQMagnitude}`);
  });
  const failures = Object.entries(knownHistoricalQ).filter(([step, expected]) => Math.abs(rows.find((row) => row.step === Number(step))?.historicalFrozenPathQ - expected) > 1e-12); if (failures.length) throw new Error(`Historical frozen-path Q reproduction failed: ${JSON.stringify(failures)}`);
  const classification = classify(rows), keyStepReport = Object.fromEntries(checkpoints.map((step) => { const row = rows.find((entry) => entry.step === step); return [step, row ? { step, historicalFrozenPathQ: row.historicalFrozenPathQ, dynamicPathQ: row.dynamicPathQ, dynamicHeadPathQ: row.dynamicHeadPathQ, frozenPathOverlapDynamic: row.dynamicVelocityPath.overlap, dynamicMeanDistanceFrozen: row.dynamicVelocityPath.meanDistanceToFrozenPath, netFluxY64: row.bandNetFluxes[64].netSouthwardFlux, netFluxY96: row.bandNetFluxes[96].netSouthwardFlux, netFluxY128: row.bandNetFluxes[128].netSouthwardFlux, netFluxY160: row.bandNetFluxes[160].netSouthwardFlux, totalQMagnitude: row.totalQMagnitude, fractionQWithin2: row.corridors.within2.fractionTotalQMagnitude, fractionQWithin5: row.corridors.within5.fractionTotalQMagnitude, fractionQWithin10: row.corridors.within10.fractionTotalQMagnitude, fractionQOutside10: row.corridors.outside10.fractionTotalQMagnitude, transportCentroidX: row.transportCentroidX, transportCentroidY: row.transportCentroidY } : null]; }));
  const representativeY = representativeBandY(rows), timeline4700to5050 = rows.filter((row) => row.step >= 4700 && row.step <= 5050).map((row) => ({ step: row.step, historicalFrozenPathQ: row.historicalFrozenPathQ, dynamicPathQ: row.dynamicPathQ, totalQMagnitude: row.totalQMagnitude, representativeBandY: representativeY, representativeBandNetFlux: row.bandNetFluxes[representativeY].netSouthwardFlux, fractionQOutside10: row.corridors.outside10.fractionTotalQMagnitude, dynamicMeanDistanceFrozen: row.dynamicVelocityPath.meanDistanceToFrozenPath }));
  const summary = { controls: { run: "CURRENT only", deterministicRandom: .3141592653, productionSimulationModified: false, productionPhysicsModified: false, simulationSteps: 5500, historicalFrozenPathQReproduced: true, observationCadence: "checkpoints plus every step 4700..5050" }, frozenReferencePath: { source: "CURRENT@1000", cells: frozenPath, cellCount: frozenPath.length }, boundaryConvention: "Boundary-directed fL/fR/fT/fB values are set to zero in simulation.js, so domain outflow is N/A rather than inferred.", activeNetworkConvention: "Wet cells above p90 qMagnitude; descriptive spatial mask only.", keyStepReport, timeline4700to5050, fullObservedRows: rows, classification: classification.classification, classificationEvidence: classification.evidence, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${summary.classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${summary.classification}`); console.table(Object.values(keyStepReport));
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
