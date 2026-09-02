/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Benchmarks conservative talus relaxation after hydraulic bed exchange.
 *
 * STATUS:
 * ACTIVE EXPERIMENT
 *
 * RESULT:
 * Pending benchmark result.
 *
 * PRODUCTION:
 * Does not modify production physics.
 *
 * RUN:
 * node tests/experiments/morphodynamics/talus-relaxation-comparison.js
 */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const statusDir = path.join(root, "tests/generated/talus"); const statusPath = path.join(statusDir, "status.json"); const completePath = path.join(statusDir, "COMPLETE"); const progressPath = path.join(statusDir, "progress.log"); fs.mkdirSync(statusDir, { recursive: true }); fs.rmSync(completePath, { force: true }); fs.writeFileSync(progressPath, "[start]\n");
const benchmarkStart = process.hrtime.bigint(); let currentPhase = "initialization";
function writeStatus(data, message) { const status = { ...data, elapsedSeconds: Number((Number(process.hrtime.bigint() - benchmarkStart) / 1e9).toFixed(1)), updatedAt: new Date().toISOString() }; fs.writeFileSync(`${statusPath}.tmp`, JSON.stringify(status, null, 2)); fs.renameSync(`${statusPath}.tmp`, statusPath); if (message) fs.appendFileSync(progressPath, `${message}\n`); }
let failurePersisted = false;
function setPhase(phase, data = {}, logMessage = null) { currentPhase = phase; writeStatus({ state: "running", phase, ...data }, logMessage); }
function persistFailure(error) { if (failurePersisted) return; failurePersisted = true; fs.rmSync(completePath, { force: true }); writeStatus({ state: "failed", phase: currentPhase, error: error.stack || error.message || String(error) }, "[failed]"); }
function persistComplete(conclusion) { currentPhase = "complete"; const totalElapsedSeconds = elapsedSeconds(); writeStatus({ state: "complete", phase: "complete", completed: 1, total: 1, percent: 100, currentVariant: "", conclusion, totalElapsedSeconds }, "[complete]"); fs.writeFileSync(completePath, ["TALUS BENCHMARK COMPLETE", `completedAt: ${new Date().toISOString()}`, `totalElapsedSeconds: ${totalElapsedSeconds}`, `conclusion: ${conclusion}`, ""].join("\n")); }
process.on("uncaughtException", (error) => { persistFailure(error); console.error(error); process.exitCode = 1; });
process.on("unhandledRejection", (error) => { persistFailure(error); console.error(error); process.exitCode = 1; });
const edges = [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2]];
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function sum(values) { let result = 0; for (const value of values) result += value; return result; }
function percentile(values, fraction) { const ordered = [...values].sort((a, b) => a - b); return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))]; }
function slopeStats(snapshot) { const slopes = []; let maximum = -Infinity; for (let y = 0; y < snapshot.N; y++) for (let x = 0; x < snapshot.N; x++) for (const [dx, dy, distance] of edges) { const nx = x + dx; const ny = y + dy; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N) { const slope = Math.abs(snapshot.b[y * snapshot.N + x] - snapshot.b[ny * snapshot.N + nx]) / distance; slopes.push(slope); maximum = Math.max(maximum, slope); } } return { p99Slope: percentile(slopes, .99), maxSlope: maximum }; }

/** Double-buffered local bed-to-bed transfer; return values distinguish talus from hydraulic exchange. */
function relaxTerrainBuffer(b, N, maximumSlope, rate) {
  const delta = new Float32Array(b.length); let totalTalusTransferred = 0; let edgesRelaxed = 0; const cells = new Uint8Array(b.length);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (const [dx, dy, distance] of edges) {
    const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const i = y * N + x; const j = ny * N + nx; const difference = b[i] - b[j]; const excess = Math.abs(difference) - maximumSlope * distance;
    if (excess <= 0) continue;
    const transfer = excess * .5 * rate; const high = difference > 0 ? i : j; const low = difference > 0 ? j : i;
    delta[high] -= transfer; delta[low] += transfer; totalTalusTransferred += transfer; edgesRelaxed++; cells[high] = 1; cells[low] = 1;
  }
  for (let i = 0; i < b.length; i++) b[i] += delta[i];
  return { totalTalusTransferred, edgesRelaxed, cellsRelaxed: cells.reduce((count, value) => count + value, 0), terrainDelta: delta };
}

function talusSource(maximumSlope, rate, frequency) {
  const instrumentation = `let hydraulicErosion = 0, hydraulicDeposition = 0, talusTransfer = 0, talusEdgesRelaxed = 0, talusCellsRelaxed = 0; const terrainDelta = new Float32Array(NN); const talusCells = new Uint8Array(NN);
function benchmarkRelaxTerrain() {
  terrainDelta.fill(0); talusCells.fill(0); let moved = 0; let edgesRelaxed = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (const edge of [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2]]) {
    const nx = x + edge[0], ny = y + edge[1]; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const i = y * N + x, j = ny * N + nx, difference = b[i] - b[j], excess = Math.abs(difference) - ${maximumSlope} * edge[2]; if (excess <= 0) continue;
    const transfer = excess * .5 * ${rate}, high = difference > 0 ? i : j, low = difference > 0 ? j : i;
    terrainDelta[high] -= transfer; terrainDelta[low] += transfer; moved += transfer; edgesRelaxed++; talusCells[high] = 1; talusCells[low] = 1;
  }
  for (let i = 0; i < NN; i++) { b[i] += terrainDelta[i]; talusCellsRelaxed += talusCells[i]; }
  talusTransfer += moved; talusEdgesRelaxed += edgesRelaxed;
}`;
  // State exists only after engine declarations have evaluated.
  let source = `${currentSource}\n${instrumentation}`;
  source = source.replace(/b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, "hydraulicErosion += diff; b[i] -= diff;\n        s[i] = si + diff;");
  source = source.replace(/b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, "hydraulicDeposition += diff; b[i] += diff;\n        s[i] = Math.max(0, si - diff);");
  const anchor = /  \}\r?\n\r?\n  for \(let y = 0; y < N; y\+\+\) \{\r?\n    const row = y \* N;\r?\n    for \(let x = 0; x < N; x\+\+\) \{\r?\n      const i = row \+ x;\r?\n      let sx = x - \(u\[i\] \* DT\) \/ L,/;
  const replacement = `  }\n\n  if ((steps + 1) % ${frequency} === 0) benchmarkRelaxTerrain();\n\n  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      let sx = x - (u[i] * DT) / L,`;
  source = source.replace(anchor, replacement);
  if (!source.includes("benchmarkRelaxTerrain()") || !source.includes("hydraulicErosion += diff")) throw new Error("Talus benchmark injection failed");
  return source;
}

// Frequency zero compiles the same hydraulic instrumentation without a D8 talus pass.
function instrumentCurrentSource() { return talusSource(Number.MAX_VALUE, 0, 0); }
function simulate(source, maximumSteps, observe) { const math = Object.create(Math); math.random = () => .3141592653; return new Function("Math", "Float32Array", "Int32Array", "Uint8Array", "observe", `${source}
  genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
  const snapshot = () => ({ N, NN, b, bInit, d, u, v, s, source: sourcePoint, hydraulicErosion, hydraulicDeposition, talusTransfer, talusEdgesRelaxed, talusCellsRelaxed }); observe(0, snapshot());
  for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); if ([1000, 5000, 10000, 20000].includes(stepIndex)) observe(stepIndex, snapshot()); }
`)(math, Float32Array, Int32Array, Uint8Array, observe); }

function referencePath(snapshot) { const pathCells = []; const visited = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0]; for (let position = 0; position < 41 && !visited[cell]; position++) { pathCells.push(cell); visited[cell] = 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; let next = -1; let projection = 0; for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N || visited[ny * snapshot.N + nx]) continue; const score = snapshot.u[cell] * dx + snapshot.v[cell] * dy; if (score > projection) { projection = score; next = ny * snapshot.N + nx; } } if (next < 0) break; cell = next; } return pathCells; }
function section(snapshot, pathCells, position) { const cell = pathCells[position]; const before = pathCells[Math.max(0, position - 1)]; const after = pathCells[Math.min(pathCells.length - 1, position + 1)]; const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; const nx = -Math.sign(dy); const ny = Math.sign(dx); let discharge = 0, wetWidth = 0, magnitude = 0, vectorU = 0, vectorV = 0; for (let offset = -2; offset <= 2; offset++) { const sx = x + nx * offset, sy = y + ny * offset; if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue; const i = sy * snapshot.N + sx; const speed = Math.hypot(snapshot.u[i], snapshot.v[i]); discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length); wetWidth += snapshot.d[i] > 1e-6 ? 1 : 0; magnitude += snapshot.d[i] * speed; vectorU += snapshot.d[i] * snapshot.u[i]; vectorV += snapshot.d[i] * snapshot.v[i]; } return { discharge, wetWidth, coherence: Math.hypot(vectorU, vectorV) / Math.max(magnitude, 1e-12) }; }
function metrics(snapshot, pathCells, initialTerrainMass) { const zones = [[0, 5], [6, 15], [16, pathCells.length - 1]].map(([start, end]) => { const values = []; let erosion = 0; for (let p = start; p <= Math.min(end, pathCells.length - 1); p++) { values.push(section(snapshot, pathCells, p)); erosion += Math.max(0, snapshot.bInit[pathCells[p]] - snapshot.b[pathCells[p]]); } const mean = (key) => values.reduce((total, value) => total + value[key], 0) / Math.max(values.length, 1); return { erosion, discharge: mean("discharge"), wetWidth: mean("wetWidth"), coherence: mean("coherence") }; }); const slopes = slopeStats(snapshot); return { nearErosion: zones[0].erosion, midErosion: zones[1].erosion, downstreamErosion: zones[2].erosion, totalErosion: zones.reduce((total, zone) => total + zone.erosion, 0), mouthDischarge: zones[0].discharge, downstreamDischarge: zones[2].discharge, downstreamVsMouth: zones[2].discharge / Math.max(zones[0].discharge, 1e-12), wetWidth: zones.reduce((total, zone) => total + zone.wetWidth, 0) / 3, directionalCoherence: zones.reduce((total, zone) => total + zone.coherence, 0) / 3, ...slopes, terrainMassResidual: (sum(snapshot.b) - initialTerrainMass) / Math.max(Math.abs(initialTerrainMass), 1e-12), hydraulicErosion: snapshot.hydraulicErosion, hydraulicDeposition: snapshot.hydraulicDeposition, talusTransfer: snapshot.talusTransfer, edgesRelaxed: snapshot.talusEdgesRelaxed, cellsRelaxed: snapshot.talusCellsRelaxed }; }
function microTests() { const tests = [["simple slope", [[0, 0, 3]]], ["peak", [[1, 1, 5]]], ["pit", [[1, 1, -5]]], ["ridge", [[1, 0, 4], [1, 1, 4], [1, 2, 4]]], ["diagonal", [[0, 0, 4], [1, 1, 1]]], ["multiple unstable", [[0, 0, 5], [2, 0, -3], [1, 2, 4]]]]; return tests.map(([name, cells]) => { const bed = new Float32Array(9); for (const [x, y, value] of cells) bed[y * 3 + x] = value; const before = sum(bed); const result = relaxTerrainBuffer(bed, 3, .1, 1); const after = sum(bed); return { test: name, terrainMassResidual: (after - before) / Math.max(Math.abs(before), 1), ...result }; }); }

function formatDuration(seconds) { const total = Math.max(0, Math.round(seconds)); const minutes = Math.floor(total / 60); const secs = total % 60; return `${minutes}m ${secs}s`; }
function elapsedSeconds() { return Number(process.hrtime.bigint() - benchmarkStart) / 1e9; }
function main() {
setPhase("initialization", { completed: 0, total: 0, percent: 0, currentVariant: "" }, "[start]");
setPhase("micro-tests", { completed: 0, total: 1, percent: 0 });
console.log("=== PHASE 1/4 — CONSERVATION MICRO-TESTS ==="); console.table(microTests().map(({ terrainDelta, ...row }) => row));
let currentAt1000; simulate(instrumentCurrentSource(), 1000, (step, snapshot) => { if (step === 1000) currentAt1000 = { ...snapshot, b: new Float32Array(snapshot.b), d: new Float32Array(snapshot.d), u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v) }; });
setPhase("micro-tests", { completed: 1, total: 1, percent: 100, currentVariant: "" }, "[micro-tests complete]");
const pathCells = referencePath(currentAt1000); const initialSlopes = slopeStats(currentAt1000.bInit ? { ...currentAt1000, b: currentAt1000.bInit } : currentAt1000); const thresholds = [["T1 initial p95", .95], ["T2 initial p99", .99], ["T3 initial p99.5", .995], ["T4 initial p99.9", .999]].map(([name, quantile]) => [name, percentile((() => { const values = []; const snapshot = { ...currentAt1000, b: currentAt1000.bInit }; for (let y = 0; y < snapshot.N; y++) for (let x = 0; x < snapshot.N; x++) for (const [dx, dy, distance] of edges) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N) values.push(Math.abs(snapshot.b[y * snapshot.N + x] - snapshot.b[ny * snapshot.N + nx]) / distance); } return values; })(), quantile)]).concat([["1.25 initial p99", initialSlopes.p99Slope * 1.25], ["1.5 initial p99", initialSlopes.p99Slope * 1.5]]);
const talusVariants = thresholds.flatMap(([label, threshold]) => [.25, .5, 1].flatMap((rate) => [1, 2, 4, 8].map((frequency) => ({
  name: `${label} | R${rate} F${frequency}`, source: talusSource(threshold, rate, frequency), threshold, rate, frequency,
}))));
const variants = [{ name: "CURRENT", source: instrumentCurrentSource(), threshold: null, rate: null, frequency: null }, ...talusVariants];
console.log("=== PHASE 2/4 — GRID 1000/5000/10000 ===");
setPhase("micro-tests", { completed: 0, total: 1, percent: 0 });
const runs = []; const totalVariants = variants.length; let completedVariants = 0; setPhase("grid", { completed: 0, total: totalVariants, percent: 0, currentVariant: "" });
for (const variant of variants) { const runStart = process.hrtime.bigint(); writeStatus({ state: "running", phase: "grid", completed: completedVariants, total: totalVariants, percent: completedVariants / totalVariants * 100, currentVariant: variant.name }); console.log(`Running TALUS ${completedVariants + 1}/${totalVariants}:\n${variant.name} ...`); const initialMass = []; simulate(variant.source, 10000, (step, snapshot) => { if (step === 0) initialMass[0] = sum(snapshot.b); if (step === 1000 || step === 5000 || step === 10000) runs.push({ variant, step, ...metrics(snapshot, pathCells, initialMass[0]) }); }); completedVariants++; const last = Number(process.hrtime.bigint() - runStart) / 1e9; const elapsed = elapsedSeconds(); const eta = (elapsed / completedVariants) * (totalVariants - completedVariants); writeStatus({ state: "running", phase: "grid", completed: completedVariants, total: totalVariants, percent: completedVariants / totalVariants * 100, currentVariant: variant.name, etaSeconds: eta }, "[completed]"); console.log(`[TALUS ${completedVariants}/${totalVariants} | ${(completedVariants / totalVariants * 100).toFixed(1)}%]\n${variant.name}\nelapsed: ${formatDuration(elapsed)}\nlast: ${formatDuration(last)}\nETA: ${formatDuration(eta)}`); }
for (const step of [1000, 5000, 10000]) {
  const current = runs.find((row) => row.variant.name === "CURRENT" && row.step === step);
  console.log(`TALUS COMPARISON | ${step}`);
  console.table(runs.filter((row) => row.step === step).map(({ variant, ...row }) => ({
    variant: variant.name, ...row,
    candidate: variant.name !== "CURRENT" && row.downstreamDischarge > current.downstreamDischarge && row.downstreamVsMouth > current.downstreamVsMouth && row.directionalCoherence >= current.directionalCoherence && row.wetWidth <= current.wetWidth && row.downstreamErosion >= current.downstreamErosion * .9 && row.hydraulicErosion >= current.hydraulicErosion * .8,
  })));
}
setPhase("selection", { completed: 0, total: 1, percent: 0, currentVariant: "" }, "[selection]");
const candidates = variants.slice(1).filter((variant) => [5000, 10000].every((step) => { const row = runs.find((item) => item.variant === variant && item.step === step); const current = runs.find((item) => item.variant.name === "CURRENT" && item.step === step); return row.downstreamDischarge > current.downstreamDischarge && row.downstreamVsMouth > current.downstreamVsMouth && row.directionalCoherence >= current.directionalCoherence && row.wetWidth <= current.wetWidth && row.downstreamErosion >= current.downstreamErosion * .9 && row.hydraulicErosion >= current.hydraulicErosion * .8 && row.p99Slope <= initialSlopes.p99Slope * 1.5; })).sort((a, b) => runs.find((row) => row.variant === b && row.step === 10000).downstreamDischarge - runs.find((row) => row.variant === a && row.step === 10000).downstreamDischarge).slice(0, 2);
setPhase("selection", { completed: 1, total: 1, percent: 100, currentVariant: "", candidates: candidates.map((variant) => variant.name) }, "[selection complete]");
console.log("=== PHASE 3/4 — SELECTED 20000 RUNS ==="); console.log("BEST CANDIDATES FOR 20000"); console.table(candidates.map(({ name, threshold, rate, frequency }) => ({ name, threshold, rate, frequency })));
setPhase("long-run", { completed: 0, total: candidates.length, percent: candidates.length === 0 ? 100 : 0, currentVariant: "" }, "[long-run]");
for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) { const variant = candidates[candidateIndex]; setPhase("long-run", { completed: candidateIndex, total: candidates.length, percent: candidateIndex / candidates.length * 100, currentVariant: variant.name }); const masses = []; simulate(variant.source, 20000, (step, snapshot) => { if (step === 0) masses[0] = sum(snapshot.b); if (step === 20000) console.table([{ variant: variant.name, step, ...metrics(snapshot, pathCells, masses[0]) }]); }); setPhase("long-run", { completed: candidateIndex + 1, total: candidates.length, percent: (candidateIndex + 1) / candidates.length * 100, currentVariant: variant.name }, `[long-run] ${candidateIndex + 1}/${candidates.length}`); }
console.log("=== PHASE 4/4 — PERFORMANCE ===");
function speed(source, label, repetitions = 11) { const start = process.hrtime.bigint(); for (let repetition = 0; repetition < repetitions; repetition++) { setPhase("performance", { completed: repetition, total: repetitions, percent: repetition / repetitions * 100, currentVariant: label }); console.log(`[PERF ${label} ${repetition + 1}/${repetitions}]`); simulate(source, 5000, () => {}); setPhase("performance", { completed: repetition + 1, total: repetitions, percent: (repetition + 1) / repetitions * 100, currentVariant: label }, `[performance] ${label} ${repetition + 1}/${repetitions}`); } return repetitions * 5000 / (Number(process.hrtime.bigint() - start) / 1e9); }
setPhase("performance", { completed: 0, total: 11, percent: 0, currentVariant: "CURRENT" }, "[performance]");
const currentSpeed = speed(instrumentCurrentSource(), "CURRENT"); const performance = candidates.map((variant) => { const stepsPerSecond = speed(variant.source, variant.name); return { variant: variant.name, stepsPerSecond, deltaPercentCurrent: (stepsPerSecond / currentSpeed - 1) * 100 }; }); console.log("N192 PERFORMANCE | 5000 STEPS | 11 REPETITIONS"); console.table([{ variant: "CURRENT", stepsPerSecond: currentSpeed, deltaPercentCurrent: 0 }, ...performance]);
const conclusion = candidates.length ? "TALUS A — candidate passes hydraulic and slope criteria" : "TALUS B — relaxation stabilizes slopes but hydraulics still degrade"; console.log(`TALUS CONCLUSION: ${conclusion}`); console.log("========================================\nTALUS BENCHMARK COMPLETE\nTotal elapsed: " + formatDuration(elapsedSeconds()) + "\n========================================"); persistComplete(conclusion);
}
try { main(); } catch (error) { persistFailure(error); console.error(error); process.exitCode = 1; }
