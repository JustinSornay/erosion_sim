/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Tests whether hydraulic routing is overly sensitive to fine-scale bed change.
 * b remains authoritative for morphodynamics; bHydro only supplies hydraulic heads.
 *
 * RUN:
 * node tests/experiments/morphodynamics/hydraulic-bed-filter-comparison.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const outputDirectory = path.join(root, "tests/generated/hydraulic-bed-filter");
const summaryPath = path.join(outputDirectory, "summary.json");
const progressPath = path.join(outputDirectory, "progress.log");
const completePath = path.join(outputDirectory, "COMPLETE");
const checkpoints = [100, 500, 1000, 2500, 5000, 10000];
const candidateCheckpoints = [5000, 10000];
const controlCheckpoints = new Set(checkpoints);
const wetThreshold = 1e-6;
const d8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);

function progress(message) { fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`); }
function mean(values) { return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1); }
function percentile(values, fraction) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * fraction)]; }
function maxAbsoluteDifference(first, second) { let maximum = 0; for (let i = 0; i < first.length; i++) maximum = Math.max(maximum, Math.abs(first[i] - second[i])); return maximum; }

/** Injects a separate, benchmark-only bed used solely while computing hydraulic heads. */
function hydraulicBedSource({ filter, radius = 0, alpha = 1, noMorph = false }) {
  const filterSetup = filter === "BOX"
    ? `for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let total = 0; let count = 0; for (let dy = -${radius}; dy <= ${radius}; dy++) for (let dx = -${radius}; dx <= ${radius}; dx++) { const nx = Math.max(0, Math.min(N - 1, x + dx)); const ny = Math.max(0, Math.min(N - 1, y + dy)); total += b[ny * N + nx]; count++; } bHydro[y * N + x] = total / count; }`
    : filter === "WEIGHTED_R1"
    ? `for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let total = 0; let weightTotal = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = Math.max(0, Math.min(N - 1, x + dx)); const ny = Math.max(0, Math.min(N - 1, y + dy)); const weight = dx === 0 && dy === 0 ? 4 : (dx === 0 || dy === 0 ? 2 : 1); total += b[ny * N + nx] * weight; weightTotal += weight; } bHydro[y * N + x] = total / weightTotal; }`
    : filter === "RELAXED"
    ? `for (let i = 0; i < NN; i++) bHydro[i] = hydraulicBedInitialized ? lerp(bHydro[i], b[i], ${alpha}) : b[i]; hydraulicBedInitialized = true;`
    : "for (let i = 0; i < NN; i++) bHydro[i] = b[i];";
  const instrumentation = `
let bHydro = new Float32Array(NN);
let hydraulicBedInitialized = false;
let grossErosion = 0;
let grossDeposition = 0;
function rebuildHydraulicBed() { ${filterSetup} }
`;
  let source = `${currentSource}\n${instrumentation}`;
  source = source.replace("  injectSources();", "  injectSources();\n  rebuildHydraulicBed();");
  source = source.replace(/const h = b\[i\] \+ d\[i\];\r?\n/g, "const h = bHydro[i] + d[i];\n");
  source = source.replace(/\(b\[i - 1\] \+ d\[i - 1\]\)/g, "(bHydro[i - 1] + d[i - 1])");
  source = source.replace(/\(b\[i \+ 1\] \+ d\[i \+ 1\]\)/g, "(bHydro[i + 1] + d[i + 1])");
  source = source.replace(/\(b\[i - N\] \+ d\[i - N\]\)/g, "(bHydro[i - N] + d[i - N])");
  source = source.replace(/\(b\[i \+ N\] \+ d\[i \+ N\]\)/g, "(bHydro[i + N] + d[i + N])");
  const erosion = noMorph ? "grossErosion += diff;" : "b[i] -= diff; s[i] = si + diff; grossErosion += diff;";
  const deposition = noMorph ? "grossDeposition += diff;" : "b[i] += diff; s[i] = Math.max(0, si - diff); grossDeposition += diff;";
  source = source.replace(/b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, erosion);
  source = source.replace(/b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, deposition);
  if (!source.includes("rebuildHydraulicBed()") || !source.includes("bHydro[i] + d[i]")) throw new Error(`Hydraulic-bed injection failed for ${filter}`);
  return source;
}

function simulate(source, maximumSteps, observe) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  return new Function("Math", "Float32Array", "Int32Array", "Uint8Array", "observe", `${source}
    genTerrain();
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    const snapshot = () => ({ N, NN, b, bInit, bHydro, d, s, u, v, source: sourcePoint, grossErosion, grossDeposition });
    observe(0, snapshot());
    for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); if (${JSON.stringify([...checkpoints, 20000])}.includes(stepIndex)) observe(stepIndex, snapshot()); }
  `)(math, Float32Array, Int32Array, Uint8Array, observe);
}

/** Frozen CURRENT path prevents variants from choosing more favourable routes. */
function referenceFlowPath(snapshot) {
  const cells = []; const visited = new Uint8Array(snapshot.NN); let cell = snapshot.source.outletIndices[0];
  for (let position = 0; position < 41 && !visited[cell]; position++) {
    cells.push(cell); visited[cell] = 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; let next = -1; let best = 0;
    for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const candidate = ny * snapshot.N + nx; const projection = snapshot.u[cell] * dx + snapshot.v[cell] * dy; if (!visited[candidate] && projection > best) { best = projection; next = candidate; } }
    if (next < 0) break; cell = next;
  }
  return cells;
}

function section(snapshot, pathCells, position) {
  const cell = pathCells[position]; const before = pathCells[Math.max(0, position - 1)]; const after = pathCells[Math.min(pathCells.length - 1, position + 1)]; const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; const normalX = -Math.sign(dy); const normalY = Math.sign(dx); let discharge = 0; let wetWidth = 0; let magnitude = 0; let vectorU = 0; let vectorV = 0;
  for (let offset = -2; offset <= 2; offset++) { const sx = x + normalX * offset; const sy = y + normalY * offset; if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue; const i = sy * snapshot.N + sx; const speed = Math.hypot(snapshot.u[i], snapshot.v[i]); discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length); if (snapshot.d[i] > wetThreshold) wetWidth++; magnitude += snapshot.d[i] * speed; vectorU += snapshot.d[i] * snapshot.u[i]; vectorV += snapshot.d[i] * snapshot.v[i]; }
  return { discharge, wetWidth, coherence: Math.hypot(vectorU, vectorV) / Math.max(magnitude, 1e-12) };
}

function surfaceStats(surface, N) {
  const slopes = []; let maxSlope = 0; let roughness = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x; let neighbourTotal = 0; let neighbourCount = 0; for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue; const value = surface[ny * N + nx]; neighbourTotal += value; neighbourCount++; } roughness += Math.abs(surface[i] - neighbourTotal / Math.max(neighbourCount, 1)); for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) { const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue; const slope = Math.abs(surface[i] - surface[ny * N + nx]) / Math.hypot(dx, dy); slopes.push(slope); maxSlope = Math.max(maxSlope, slope); } }
  return { p95Slope: percentile(slopes, .95), p99Slope: percentile(slopes, .99), maxSlope, roughness: roughness / (N * N) };
}

function connectedWetCells(snapshot) { const visited = new Uint8Array(snapshot.NN); const queue = []; const sourceIndex = snapshot.source.y * snapshot.N + snapshot.source.x; for (const i of [sourceIndex, ...snapshot.source.outletIndices]) if (snapshot.d[i] > wetThreshold && !visited[i]) { visited[i] = 1; queue.push(i); } for (let head = 0; head < queue.length; head++) { const i = queue[head]; const x = i % snapshot.N; const y = (i / snapshot.N) | 0; for (const [dx, dy] of d8) { const nx = x + dx; const ny = y + dy; const next = ny * snapshot.N + nx; if (nx >= 0 && ny >= 0 && nx < snapshot.N && ny < snapshot.N && snapshot.d[next] > wetThreshold && !visited[next]) { visited[next] = 1; queue.push(next); } } } return queue.length; }

function metrics(snapshot, pathCells) {
  const zones = [[0, 5], [6, 15], [16, pathCells.length - 1]].map(([start, end]) => { const rows = []; for (let p = start; p <= Math.min(end, pathCells.length - 1); p++) rows.push(section(snapshot, pathCells, p)); return { discharge: mean(rows.map((row) => row.discharge)), wetWidth: mean(rows.map((row) => row.wetWidth)), coherence: mean(rows.map((row) => row.coherence)) }; });
  let rmsTotal = 0; let maxDifference = 0; for (let i = 0; i < snapshot.NN; i++) { const difference = snapshot.b[i] - snapshot.bHydro[i]; rmsTotal += difference * difference; maxDifference = Math.max(maxDifference, Math.abs(difference)); }
  const morph = surfaceStats(snapshot.b, snapshot.N); const hydro = surfaceStats(snapshot.bHydro, snapshot.N);
  return { mouthDischarge: zones[0].discharge, midDischarge: zones[1].discharge, downstreamDischarge: zones[2].discharge, downstreamVsMouth: zones[2].discharge / Math.max(zones[0].discharge, 1e-12), directionalCoherence: mean(zones.map((zone) => zone.coherence)), wetWidth: mean(zones.map((zone) => zone.wetWidth)), wetConnectedCellCount: connectedWetCells(snapshot), grossErosion: snapshot.grossErosion, grossDeposition: snapshot.grossDeposition, p95Slope: morph.p95Slope, p99Slope: morph.p99Slope, maxSlope: morph.maxSlope, hydroP95Slope: hydro.p95Slope, hydroP99Slope: hydro.p99Slope, hydroMaxSlope: hydro.maxSlope, bedHydroRmsDifference: Math.sqrt(rmsTotal / snapshot.NN), bedHydroMaxDifference: maxDifference, morphRoughness: morph.roughness, hydroRoughness: hydro.roughness };
}

function runVariant(variant, maximumSteps, pathCells) { const rows = {}; const buffers = {}; simulate(variant.source, maximumSteps, (step, snapshot) => { if (!checkpoints.includes(step) && step !== 20000) return; rows[step] = metrics(snapshot, pathCells); if (controlCheckpoints.has(step)) buffers[step] = Object.fromEntries(["b", "d", "s", "u", "v"].map((key) => [key, new Float32Array(snapshot[key])])); }); return { ...variant, checkpoints: rows, buffers }; }
function differences(first, second) { return Object.fromEntries(checkpoints.map((step) => [step, Object.fromEntries(["b", "d", "s", "u", "v"].map((key) => [key, maxAbsoluteDifference(first.buffers[step][key], second.buffers[step][key])]))])); }
function exact(difference) { return Object.values(difference).every((checkpoint) => Object.values(checkpoint).every((value) => value === 0)); }
function candidate(run, current, noMorph) { return candidateCheckpoints.every((step) => { const row = run.checkpoints[step]; const baseline = current.checkpoints[step]; const gap = noMorph.checkpoints[step].downstreamDischarge - baseline.downstreamDischarge; const exchange = row.grossErosion + row.grossDeposition; const baselineExchange = baseline.grossErosion + baseline.grossDeposition; return row.downstreamDischarge >= baseline.downstreamDischarge * 2 && row.downstreamDischarge - baseline.downstreamDischarge >= gap * .5 && row.directionalCoherence >= baseline.directionalCoherence && exchange >= baselineExchange * .5 && exchange <= baselineExchange * 1.5; }); }
function classification(candidates) { const spatial = candidates.some((run) => run.family === "SPATIAL"); const temporal = candidates.some((run) => run.family === "TEMPORAL"); if (spatial && temporal) return "HYDRO-BED C — both spatial and temporal smoothing help"; if (spatial) return "HYDRO-BED A — spatial smoothing of hydraulic bed restores downstream routing"; if (temporal) return "HYDRO-BED B — temporal smoothing of hydraulic bed restores downstream routing"; return "HYDRO-BED D — hydraulic degradation insensitive to bed filtering"; }

function main() {
  const currentVariant = { name: "CURRENT", family: "CONTROL", source: hydraulicBedSource({ filter: "IDENTITY" }) };
  const radiusZero = { name: "FILTER_RADIUS_0", family: "SPATIAL", source: hydraulicBedSource({ filter: "BOX", radius: 0 }) };
  const noMorph = { name: "NO_MORPH", family: "CONTROL", source: hydraulicBedSource({ filter: "IDENTITY", noMorph: true }) };
  let referenceSnapshot; simulate(currentVariant.source, 1000, (step, snapshot) => { if (step === 1000) referenceSnapshot = { N: snapshot.N, NN: snapshot.NN, u: new Float32Array(snapshot.u), v: new Float32Array(snapshot.v), source: snapshot.source }; });
  const pathCells = referenceFlowPath(referenceSnapshot); if (!pathCells.length) throw new Error("Frozen CURRENT@1000 reference path is empty"); progress(`[reference path] ${pathCells.length} cells`);
  const current = runVariant(currentVariant, 10000, pathCells); const filterRadiusZero = runVariant(radiusZero, 10000, pathCells); const noMorphRun = runVariant(noMorph, 10000, pathCells);
  const radiusZeroDifferences = differences(current, filterRadiusZero); const radiusZeroPasses = exact(radiusZeroDifferences);
  const controls = { filterRadiusZero: { passes: radiusZeroPasses, maxAbsoluteDifference: radiusZeroDifferences }, noMorph: "Hydraulic control with bed and sediment exchanges disabled." };
  if (!radiusZeroPasses) { const summary = { controls, failure: "FILTER_RADIUS_0 differs from CURRENT; experiment stopped.", failedAt: new Date().toISOString() }; fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); throw new Error(`FILTER_RADIUS_0 differs from CURRENT: ${JSON.stringify(radiusZeroDifferences)}`); }
  const variants = [{ name: "BOX_R1", family: "SPATIAL", source: hydraulicBedSource({ filter: "BOX", radius: 1 }) }, { name: "BOX_R2", family: "SPATIAL", source: hydraulicBedSource({ filter: "BOX", radius: 2 }) }, { name: "BOX_R3", family: "SPATIAL", source: hydraulicBedSource({ filter: "BOX", radius: 3 }) }, { name: "WEIGHTED_R1", family: "SPATIAL", source: hydraulicBedSource({ filter: "WEIGHTED_R1" }) }, ...[1, .5, .25, .1].map((alpha) => ({ name: `RELAXED_ALPHA_${alpha}`, family: "TEMPORAL", source: hydraulicBedSource({ filter: "RELAXED", alpha }) }))];
  const runs = [current, filterRadiusZero, noMorphRun]; for (const variant of variants) { progress(`[run] ${variant.name}`); runs.push(runVariant(variant, 10000, pathCells)); progress(`[completed] ${variant.name}`); }
  const candidates = runs.slice(3).filter((run) => candidate(run, current, noMorphRun)); for (const run of candidates) { progress(`[candidate 20000] ${run.name}`); const extended = runVariant(run, 20000, pathCells); run.checkpoints[20000] = extended.checkpoints[20000]; }
  for (const run of runs) { delete run.source; delete run.buffers; }
  const conclusion = classification(candidates); const summary = { controls, checkpoints, candidates: candidates.map((run) => run.name), current, noMorph: noMorphRun, variants: runs.slice(1, 2).concat(runs.slice(3)), referenceFlowPath: pathCells, candidateRule: "At 5000 and 10000: downstream discharge >= 2x CURRENT, >=50% CURRENT→NO_MORPH gap, coherence >= CURRENT, and total gross exchange 50–150% CURRENT.", conclusion, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${conclusion}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${conclusion}`); console.log("FILTER_RADIUS_0 control: PASS"); console.table(runs.map((run) => ({ variant: run.name, discharge5000: run.checkpoints[5000].downstreamDischarge, discharge10000: run.checkpoints[10000].downstreamDischarge, hydroP99Slope10000: run.checkpoints[10000].hydroP99Slope, hydroRoughness10000: run.checkpoints[10000].hydroRoughness, candidate: candidates.includes(run) }))); console.log(conclusion);
}

try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); throw error; }
