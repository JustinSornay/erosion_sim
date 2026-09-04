/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Characterizes wet local water-surface minima around the CURRENT discharge
 * transition. This is observational instrumentation; production physics is
 * loaded unchanged and executed once with deterministic randomness.
 *
 * RUN:
 * node tests/diagnostics/hydraulic-trap-diagnostic.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/hydraulic-trap");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const wetThreshold = 1e-6;
const epsilon = 1e-12;
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const keySteps = [4800, 4810, 4811, 4812, 4820, 4824, 4850, 4900, 4950, 4969, 4970, 5000];

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()} CURRENT deterministic hydraulic trap diagnostic\n`);
function progress(message) { fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`); }
function mean(values) { return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1); }
function percentile(values, fraction) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]; }
function weightedPercentile(values, fraction) { const sorted = [...values].sort((a, b) => a.margin - b.margin); const target = sorted.reduce((total, value) => total + value.weight, 0) * fraction; let cumulative = 0; for (const value of sorted) { cumulative += value.weight; if (cumulative >= target) return value.margin; } return sorted[sorted.length - 1]?.margin || 0; }
function shouldSnapshot(step) { return step >= 4500 && step <= 4750 ? step % 10 === 0 : step >= 4751 && step <= 5050 ? true : step >= 5051 && step <= 5100 ? step % 5 === 0 : false; }

/** Frozen CURRENT@1000 route provides stable spatial context across later morphology. */
function traceReferencePath(snapshot) {
  const cells = [], visited = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0];
  for (let position = 0; position < 41 && !visited[cell]; position++) {
    cells.push(cell); visited[cell] = 1; const x = cell % snapshot.N, y = (cell / snapshot.N) | 0; let next = -1, projection = 0;
    for (const [dx, dy] of d8) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const candidate = ny * snapshot.N + nx, score = snapshot.u[cell] * dx + snapshot.v[cell] * dy; if (!visited[candidate] && score > projection) { projection = score; next = candidate; } }
    if (next < 0) break; cell = next;
  }
  return cells;
}
function sectionDischarge(snapshot, pathCells, position) {
  const cell = pathCells[Math.min(position, pathCells.length - 1)], before = pathCells[Math.max(0, position - 1)], after = pathCells[Math.min(pathCells.length - 1, position + 1)];
  const dx = (after % snapshot.N) - (before % snapshot.N), dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0), length = Math.hypot(dx, dy) || 1;
  const x = cell % snapshot.N, y = (cell / snapshot.N) | 0, normalX = -Math.sign(dy), normalY = Math.sign(dx); let discharge = 0;
  for (let offset = -2; offset <= 2; offset++) { const sx = x + normalX * offset, sy = y + normalY * offset; if (sx >= 0 && sy >= 0 && sx < snapshot.N && sy < snapshot.N) { const i = sy * snapshot.N + sx; discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length); } }
  return discharge;
}
function distanceToPath(index, N, pathCells) { const x = index % N, y = (index / N) | 0; let distance = Infinity; for (const cell of pathCells) distance = Math.min(distance, Math.hypot(x - cell % N, y - ((cell / N) | 0))); return distance; }
function band(distance) { return distance <= 6 ? "SOURCE" : distance <= 15 ? "NEAR" : distance <= 30 ? "MID" : "FAR"; }
function emptyBands() { return Object.fromEntries(["SOURCE", "NEAR", "MID", "FAR", "ON_PATH", "OFF_PATH"].map((name) => [name, { count: 0, persistentCount10: 0, water: 0, netAccumulation: 0 }])); }
function incomingFlux(snapshot, index, x, y) { return (x > 0 ? snapshot.fR[index - 1] : 0) + (x < snapshot.N - 1 ? snapshot.fL[index + 1] : 0) + (y > 0 ? snapshot.fB[index - snapshot.N] : 0) + (y < snapshot.N - 1 ? snapshot.fT[index + snapshot.N] : 0); }

/** Connected D8 no-lower cells distinguish coherent basins from scattered minima. */
function clustersFor(mask, snapshot, distances) {
  const visited = new Uint8Array(snapshot.NN), clusters = [], queue = [];
  for (let i = 0; i < snapshot.NN; i++) {
    if (!mask[i] || visited[i]) continue;
    visited[i] = 1; queue.length = 0; queue.push(i); let water = 0, xSum = 0, ySum = 0;
    for (let head = 0; head < queue.length; head++) { const cell = queue[head], x = cell % snapshot.N, y = (cell / snapshot.N) | 0; water += snapshot.d[cell]; xSum += x; ySum += y; for (const [dx, dy] of d8) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N) { const next = ny * snapshot.N + nx; if (mask[next] && !visited[next]) { visited[next] = 1; queue.push(next); } } } }
    const centroidX = xSum / queue.length, centroidY = ySum / queue.length;
    clusters.push({ cells: [...queue], cellCount: queue.length, water, centroidX, centroidY, distanceSource: Math.hypot(centroidX - snapshot.source.x, centroidY - snapshot.source.y), distanceFrozenPath: Math.min(...queue.map((cell) => distances[cell])) });
  }
  return clusters;
}

/** Overlap identity intentionally follows basin material, even when boundaries move by one cell. */
function trackClusters(clusters, priorClusters, records, step) {
  const assignments = new Set();
  for (const cluster of clusters) {
    let best = null, bestOverlap = 0;
    for (const prior of priorClusters) { let overlap = 0; for (const cell of cluster.cells) if (prior.cellSet.has(cell)) overlap++; if (overlap > bestOverlap) { bestOverlap = overlap; best = prior; } }
    const record = best && !assignments.has(best.id) && bestOverlap > 0 ? records.get(best.id) : { id: `trap-${records.size + 1}`, birthStep: step, deathStep: step, maxCells: 0, maxWater: 0, centroidAtBirth: { x: cluster.centroidX, y: cluster.centroidY }, centroidAtMax: { x: cluster.centroidX, y: cluster.centroidY }, distanceSource: cluster.distanceSource, distanceFrozenPath: cluster.distanceFrozenPath };
    assignments.add(record.id); record.deathStep = step;
    if (cluster.cellCount > record.maxCells) record.maxCells = cluster.cellCount;
    if (cluster.water > record.maxWater) { record.maxWater = cluster.water; record.centroidAtMax = { x: cluster.centroidX, y: cluster.centroidY }; record.distanceSource = cluster.distanceSource; record.distanceFrozenPath = cluster.distanceFrozenPath; }
    records.set(record.id, record); cluster.id = record.id; cluster.cellSet = new Set(cluster.cells);
  }
  return clusters;
}

function classify(rows, clusterRecords) {
  const pre = rows.filter((row) => row.step >= 4790 && row.step < 4824), post = rows.filter((row) => row.step >= 4824);
  const first = pre[0], last = pre[pre.length - 1];
  const growingWater = first && last && last.persistentNoLowerWater10 > first.persistentNoLowerWater10 * 1.1;
  const growingFraction = first && last && last.noLowerWaterFraction > first.noLowerWaterFraction * 1.1 && last.noLowerFractionOfWetCells <= first.noLowerFractionOfWetCells * 1.1;
  const positiveCluster = [...clusterRecords.values()].some((record) => record.birthStep < 4824 && record.maxWater >= Math.max(last?.totalWater * .01 || 0, 1e-6));
  const preTrapWater = Math.max(...pre.map((row) => row.persistentNoLowerWater10), 0), preNet = Math.max(...pre.map((row) => row.totalTrapNetAccumulation), 0);
  const negligible = preTrapWater < Math.max((last?.totalWater || 0) * .001, 1e-6) && preNet < 1e-6;
  const postGrowth = post.length && Math.max(...post.map((row) => row.persistentNoLowerWater10), 0) > preTrapWater * 1.1;
  const bedWater = last?.bedPitWater / Math.max(last?.totalNoLowerWater, epsilon) || 0;
  if (growingWater && growingFraction && positiveCluster) return { classification: bedWater >= .5 ? "TRAP A — persistent bed pits capture increasing water before Q collapse" : "TRAP B — persistent water-surface traps capture water without corresponding bed pits", evidence: { growingWater, growingFraction, positiveCluster, bedWater } };
  if (negligible) return { classification: "TRAP C — no-lower count rises, but trapped water/net accumulation remains negligible", evidence: { preTrapWater, preNet } };
  if (postGrowth) return { classification: "TRAP D — trap growth occurs only after Q decline", evidence: { preTrapWater, postPersistentWater: Math.max(...post.map((row) => row.persistentNoLowerWater10)) } };
  return { classification: "TRAP E — distributed/mixed trap behavior; no dominant cluster mechanism", evidence: { growingWater, growingFraction, positiveCluster, preTrapWater } };
}

function main() {
  const timeline = [], clusterRecords = new Map(); let referencePath = null, pathDistances = null, states = null, priorClusters = [];
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", `${currentSource}\n genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const snapshot = () => ({ N, NN, b, d, u, v, fL, fR, fT, fB, source: sourcePoint }); for (let stepIndex = 1; stepIndex <= 5100; stepIndex++) { step(); observe(stepIndex, snapshot()); }`)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Float64Array, Int32Array, Uint8Array, (step, snapshot) => {
    if (!states) states = Array.from({ length: snapshot.NN }, () => ({ birthStep: null, lastStep: null, consecutiveLifetime: 0, totalLifetime: 0 }));
    if (step === 1000) { referencePath = traceReferencePath(snapshot); pathDistances = Float64Array.from({ length: snapshot.NN }, (_, index) => distanceToPath(index, snapshot.N, referencePath)); progress(`[reference] CURRENT@1000 path=${referencePath.length}`); }
    const noLower = new Uint8Array(snapshot.NN), weak = new Uint8Array(snapshot.NN), trap1e4 = new Uint8Array(snapshot.NN), trap1e3 = new Uint8Array(snapshot.NN);
    for (let i = 0; i < snapshot.NN; i++) { if (snapshot.d[i] <= wetThreshold) continue; const x = i % snapshot.N, y = (i / snapshot.N) | 0, head = snapshot.b[i] + snapshot.d[i]; let minHead = Infinity; for (const [dx, dy] of d8) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N) minHead = Math.min(minHead, snapshot.b[ny * snapshot.N + nx] + snapshot.d[ny * snapshot.N + nx]); } const bestDrop = head - minHead; noLower[i] = bestDrop <= 0; weak[i] = bestDrop <= 1e-5; trap1e4[i] = bestDrop <= 1e-4; trap1e3[i] = bestDrop <= 1e-3; }
    let newNoLowerCellsThisStep = 0, resolvedNoLowerCellsThisStep = 0;
    for (let i = 0; i < snapshot.NN; i++) { const state = states[i]; if (noLower[i]) { if (!state.consecutiveLifetime) { state.birthStep = step; newNoLowerCellsThisStep++; } state.lastStep = step; state.consecutiveLifetime++; state.totalLifetime++; } else { if (state.consecutiveLifetime) resolvedNoLowerCellsThisStep++; state.consecutiveLifetime = 0; } }
    if (!referencePath) return;
    const clusters = trackClusters(clustersFor(noLower, snapshot, pathDistances), priorClusters, clusterRecords, step); priorClusters = clusters;
    if (!shouldSnapshot(step)) return;
    let totalWater = 0, wetCellCount = 0, totalNoLowerWater = 0, noLowerCount = 0, totalTrapIncoming = 0, totalTrapOutgoing = 0, totalTrapNetAccumulation = 0, bedPitCount = 0, bedPitWater = 0, waterSurfaceTrapOnlyCount = 0, waterSurfaceTrapOnlyWater = 0;
    const persist = { 5: { count: 0, water: 0, incoming: 0, outgoing: 0, netAccumulation: 0 }, 10: { count: 0, water: 0, incoming: 0, outgoing: 0, netAccumulation: 0 }, 25: { count: 0, water: 0, incoming: 0, outgoing: 0, netAccumulation: 0 }, 50: { count: 0, water: 0, incoming: 0, outgoing: 0, netAccumulation: 0 } }, margins = [], weightedMargins = [], bands = emptyBands();
    for (let i = 0; i < snapshot.NN; i++) {
      const depth = snapshot.d[i]; totalWater += depth; if (depth <= wetThreshold) continue; wetCellCount++; if (!noLower[i]) continue;
      const x = i % snapshot.N, y = (i / snapshot.N) | 0, head = snapshot.b[i] + depth; let minHead = Infinity, minBed = Infinity; for (const [dx, dy] of d8) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N) { const neighbor = ny * snapshot.N + nx; minHead = Math.min(minHead, snapshot.b[neighbor] + snapshot.d[neighbor]); minBed = Math.min(minBed, snapshot.b[neighbor]); } }
      const escapeMargin = minHead - head, bedBestDrop = snapshot.b[i] - minBed, incoming = incomingFlux(snapshot, i, x, y), outgoing = snapshot.fL[i] + snapshot.fR[i] + snapshot.fT[i] + snapshot.fB[i], netAccumulation = incoming - outgoing, distanceSource = Math.hypot(x - snapshot.source.x, y - snapshot.source.y), distanceFrozenPath = pathDistances[i];
      noLowerCount++; totalNoLowerWater += depth; totalTrapIncoming += incoming; totalTrapOutgoing += outgoing; totalTrapNetAccumulation += netAccumulation; margins.push(escapeMargin); weightedMargins.push({ margin: escapeMargin, weight: depth });
      const zone = bands[band(distanceSource)]; zone.count++; zone.water += depth; zone.netAccumulation += netAccumulation; const pathZone = bands[distanceFrozenPath <= 2 ? "ON_PATH" : "OFF_PATH"]; pathZone.count++; pathZone.water += depth; pathZone.netAccumulation += netAccumulation;
      if (bedBestDrop <= 0) { bedPitCount++; bedPitWater += depth; } else { waterSurfaceTrapOnlyCount++; waterSurfaceTrapOnlyWater += depth; }
      for (const threshold of [5, 10, 25, 50]) if (states[i].consecutiveLifetime >= threshold) { const entry = persist[threshold]; entry.count++; entry.water += depth; entry.incoming += incoming; entry.outgoing += outgoing; entry.netAccumulation += netAccumulation; if (threshold === 10) { zone.persistentCount10++; pathZone.persistentCount10++; } }
    }
    const largest = [...clusters].sort((a, b) => b.cellCount - a.cellCount || b.water - a.water)[0]; const mouthDischarge = mean(referencePath.slice(0, 6).map((_, position) => sectionDischarge(snapshot, referencePath, position))), midDischarge = mean(referencePath.slice(6, 16).map((_, index) => sectionDischarge(snapshot, referencePath, index + 6))), downstreamDischarge = mean(referencePath.slice(16).map((_, index) => sectionDischarge(snapshot, referencePath, index + 16)));
    const row = { step, downstreamDischarge, mouthDischarge, midDischarge, wetCellCount, totalWater, meanWetDepth: totalWater / Math.max(wetCellCount, 1), noLowerCount, weakTrapCount: weak.reduce((total, value) => total + value, 0), trap1e4Count: trap1e4.reduce((total, value) => total + value, 0), trap1e3Count: trap1e3.reduce((total, value) => total + value, 0), newNoLowerCellsThisStep, resolvedNoLowerCellsThisStep, persistentNoLowerCells_5: persist[5].count, persistentNoLowerCells_10: persist[10].count, persistentNoLowerCells_25: persist[25].count, persistentNoLowerCells_50: persist[50].count, totalNoLowerWater, noLowerWaterFraction: totalNoLowerWater / Math.max(totalWater, epsilon), fractionWaterInNoLower: totalNoLowerWater / Math.max(totalWater, epsilon), noLowerFractionOfWetCells: noLowerCount / Math.max(wetCellCount, 1), meanNoLowerDepth: totalNoLowerWater / Math.max(noLowerCount, 1), maxNoLowerDepth: noLowerCount ? Math.max(...Array.from(noLower, (value, index) => value ? snapshot.d[index] : 0)) : 0, persistentNoLowerWater5: persist[5].water, persistentNoLowerWater10: persist[10].water, persistentNoLowerWater25: persist[25].water, totalTrapIncoming, totalTrapOutgoing, totalTrapNetAccumulation, persistentTrapIncoming10: persist[10].incoming, persistentTrapOutgoing10: persist[10].outgoing, persistentTrapNetAccumulation10: persist[10].netAccumulation, bands, trapClusterCount: clusters.length, largestTrapClusterCells: largest?.cellCount || 0, largestTrapClusterWater: largest?.water || 0, largestTrapClusterCentroidX: largest?.centroidX || null, largestTrapClusterCentroidY: largest?.centroidY || null, largestTrapClusterDistanceSource: largest?.distanceSource || null, largestTrapClusterDistanceFrozenPath: largest?.distanceFrozenPath || null, escapeMargin: { unweighted: { p50: percentile(margins, .5), p90: percentile(margins, .9), p99: percentile(margins, .99), max: Math.max(...margins, 0) }, depthWeighted: { p50: weightedPercentile(weightedMargins, .5), p90: weightedPercentile(weightedMargins, .9), p99: weightedPercentile(weightedMargins, .99), max: Math.max(...weightedMargins.map((value) => value.margin), 0) } }, bedPitCount, bedPitWater, bedPitFraction: bedPitCount / Math.max(noLowerCount, 1), bedPitWaterFraction: bedPitWater / Math.max(totalNoLowerWater, epsilon), waterSurfaceTrapOnlyCount, waterSurfaceTrapOnlyWater, waterSurfaceTrapOnlyFraction: waterSurfaceTrapOnlyCount / Math.max(noLowerCount, 1), waterSurfaceTrapOnlyWaterFraction: waterSurfaceTrapOnlyWater / Math.max(totalNoLowerWater, epsilon) };
    const prior = timeline[timeline.length - 1]; if (prior) for (const key of ["downstreamDischarge", "mouthDischarge", "midDischarge", "totalNoLowerWater", "persistentNoLowerWater10", "largestTrapClusterWater", "totalTrapNetAccumulation"]) row[`${key}Delta`] = row[key] - prior[key]; timeline.push(row);
    if (step % 50 === 0 || keySteps.includes(step)) progress(`[snapshot] step=${step} noLower=${noLowerCount} water=${totalNoLowerWater} Q=${downstreamDischarge}`);
  });
  const clusterHistory = [...clusterRecords.values()].map((record) => ({ ...record, durationSteps: record.deathStep - record.birthStep + 1 }));
  const trackedClusters = clusterHistory.filter((record) => record.maxCells >= 5 || record.durationSteps >= 10);
  const topClusters = [...clusterHistory].sort((a, b) => b.maxWater - a.maxWater).slice(0, 10);
  const clusterBirths4790to4824 = trackedClusters.filter((record) => record.birthStep >= 4790 && record.birthStep <= 4824);
  const conclusion = classify(timeline, clusterRecords);
  const keyStepReport = Object.fromEntries(keySteps.map((step) => { const row = timeline.find((entry) => entry.step === step); return [step, row ? { Q: row.downstreamDischarge, wetCells: row.wetCellCount, noLowerCount: row.noLowerCount, noLowerFractionWet: row.noLowerFractionOfWetCells, noLowerWater: row.totalNoLowerWater, noLowerWaterFraction: row.noLowerWaterFraction, persistent10Count: row.persistentNoLowerCells_10, persistent10Water: row.persistentNoLowerWater10, trapClusterCount: row.trapClusterCount, largestClusterCells: row.largestTrapClusterCells, largestClusterWater: row.largestTrapClusterWater, trapNetAccumulation: row.totalTrapNetAccumulation, bedPitFraction: row.bedPitFraction, waterSurfaceTrapOnlyFraction: row.waterSurfaceTrapOnlyFraction, escapeMarginP90: row.escapeMargin.unweighted.p90, escapeMarginMax: row.escapeMargin.unweighted.max } : null]; }));
  const summary = { controls: { run: "CURRENT only", deterministicRandom: .3141592653, productionSimulationModified: false, productionPhysicsModified: false, simulationSteps: 5100, snapshotCadence: "4500..4750 every 10; 4751..5050 every step; 5051..5100 every 5", persistenceStateUpdatedEveryStep: true }, definitions: { wetThreshold, head: "b[i] + d[i]", bestDrop: "head[i] - min(head[D8 neighbor])", noLower: "bestDrop <= 0", weakTrap: "bestDrop <= 1e-5", trap1e4: "bestDrop <= 1e-4", trap1e3: "bestDrop <= 1e-3", escapeMargin: "min(head[D8 neighbor]) - head[i]", bedPit: "b[i] - min(b[D8 neighbor]) <= 0", waterSurfaceTrapOnly: "bedBestDrop > 0 && headBestDrop <= 0" }, frozenReferencePath: { source: "CURRENT@1000", cells: referencePath, cellCount: referencePath.length }, keyStepReport, trackedClusters, clusterBirths4790to4824, topClustersByMaxWater: topClusters, classification: conclusion.classification, classificationEvidence: conclusion.evidence, timeline, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${summary.classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${summary.classification}`); console.table(keySteps.map((step) => ({ step, ...keyStepReport[step] })));
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); fs.writeFileSync(summaryPath, JSON.stringify({ failedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2)); throw error; }
