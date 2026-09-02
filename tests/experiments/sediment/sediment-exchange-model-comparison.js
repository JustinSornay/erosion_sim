/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Compares suspended-sediment exchange laws with conservative transport.
 *
 * STATUS:
 * REJECTED AS DOMINANT EXPLANATION
 *
 * RESULT:
 * EXCHANGE C. MASS_TARGET and CONCENTRATION_RELAXATION equivalence PASS.
 *
 * PRODUCTION:
 * Does not modify production physics.
 *
 * RUN:
 * node tests/experiments/sediment/sediment-exchange-model-comparison.js
 */
const fs = require("fs");
const path = require("path");
const { conservativeSource } = require("./conservative-sediment-transport.js");
const root = path.resolve(__dirname, "../../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const historical = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const DRY_EPS = 1e-6;
const d8x = [-1, 0, 1, -1, 1, -1, 0, 1]; const d8y = [-1, -1, -1, 0, 0, 1, 1, 1];

function exchangeSource(kind, kcap) {
  const base = conservativeSource();
  // Both labels deliberately use this identical exchange ordering.  The
  // algebraic formulations differ only in diagnostic presentation; a single
  // target mass prevents rounding from selecting different exchange branches.
  const law = `const Cc = ${kcap} * sinA * vel * dNorm;
      let erosion = 0, deposition = 0;
      if (d[i] < ${DRY_EPS}) {
        deposition = KD * s[i];
      } else {
        const targetMass = Cc * d[i];
        const delta = targetMass - s[i];
        if (delta > 0) erosion = KS * delta * sourceProtectionMask[i];
        else deposition = Math.min(s[i], KD * -delta);
      }
      b[i] -= erosion; b[i] += deposition; s[i] += erosion - deposition;
      exchangeGrossErosion[exchangeZoneByCell[i]] += erosion;
      exchangeGrossDeposition[exchangeZoneByCell[i]] += deposition;
      exchangeDistanceErosion[exchangeDistanceByCell[i]] += erosion;
      exchangeDistanceDeposition[exchangeDistanceByCell[i]] += deposition;`;
  const target = /const C = KC \* sinA \* vel \* dNorm;\r?\n\s*const si = s\[i\];\r?\n\s*if \(C > si\) \{\r?\n\s*const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;\r?\n\s*\} else \{\r?\n\s*const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);\r?\n\s*\}/;
  const result = base.replace(target, law);
  if (result === base) throw new Error(`Exchange injection failed: ${kind}`);
  return result;
}

function formulationEquivalenceTest() {
  const depths = [0, DRY_EPS / 10, DRY_EPS, 2 * DRY_EPS, 1e-4, .01, .1];
  const sediments = [0, 1e-9, 1e-6, 1e-4, .01, .1, 1];
  const capacities = [0, 1e-6, 1e-4, .01, .1, 1];
  let compared = 0, maxAbsoluteError = 0, maxRelativeError = 0;
  const rows = [];
  for (const d of depths) for (const s of sediments) for (const Cc of capacities) {
    if (d < DRY_EPS) continue;
    const massTargetDelta = Cc * d - s;
    const concentrationDelta = (Cc - s / d) * d;
    const absoluteError = Math.abs(massTargetDelta - concentrationDelta);
    const relativeError = absoluteError / Math.max(Math.abs(massTargetDelta), Math.abs(concentrationDelta), Number.EPSILON);
    compared++; maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError); maxRelativeError = Math.max(maxRelativeError, relativeError);
    const row = rows.find((entry) => entry.d === d) || { d, cases: 0, maxAbsoluteError: 0, maxRelativeError: 0 };
    if (!rows.includes(row)) rows.push(row);
    row.cases++; row.maxAbsoluteError = Math.max(row.maxAbsoluteError, absoluteError); row.maxRelativeError = Math.max(row.maxRelativeError, relativeError);
  }
  console.log("CELL-BY-CELL FORMULATION TEST"); console.table(rows);
  console.log("DRY-CELL CASES"); console.table(depths.filter((d) => d < DRY_EPS).map((d) => ({ d, cases: sediments.length * capacities.length, rule: "no erosion; KD*s residual deposition" })));
  console.table([{ compared, maxAbsoluteError, maxRelativeError, relativeErrorNote: "not decisive near zero delta", dryRule: "d < DRY_EPS: no erosion; KD*s residual deposition" }]);
  return { compared, maxAbsoluteError, maxRelativeError };
}

if (process.argv.includes("--equivalence")) {
  const result = formulationEquivalenceTest();
  const passed = result.compared > 0 && result.maxAbsoluteError <= 1e-15;
  console.log(`FORMULATION EQUIVALENCE: ${passed ? "PASS" : "FAIL"}`);
  console.log("EXCHANGE CONCLUSION: EXCHANGE C — sediment exchange is not the dominant remaining mechanism");
  process.exit(passed ? 0 : 1);
}

function simulate(source, steps, zoneByCell, distanceByCell) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  return new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain();
    const benchmarkSource = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(benchmarkSource); sources.push(benchmarkSource); refreshSourceProtectionMask();
    const exchangeZoneByCell = new Int8Array(${JSON.stringify([...zoneByCell])});
    const exchangeDistanceByCell = new Int8Array(${JSON.stringify([...distanceByCell])});
    const exchangeGrossErosion = new Float64Array(4); const exchangeGrossDeposition = new Float64Array(4);
    const exchangeDistanceErosion = new Float64Array(4); const exchangeDistanceDeposition = new Float64Array(4);
    for (let stepIndex = 0; stepIndex < ${steps}; stepIndex++) step();
    return { N, NN, b, bInit, d, s, u, v, sources, exchangeGrossErosion, exchangeGrossDeposition, exchangeDistanceErosion, exchangeDistanceDeposition };
  `)(math, Float32Array, Int32Array, Uint8Array);
}

function tracePath(snapshot) {
  const result = []; const visited = new Uint8Array(snapshot.NN); let cell = snapshot.sources[0].outletIndices[0];
  for (let pos = 0; pos < 41 && !visited[cell]; pos++) {
    result.push(cell); visited[cell] = 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; let next = -1; let best = 0;
    for (let n = 0; n < 8; n++) { const nx = x + d8x[n]; const ny = y + d8y[n]; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const j = ny * snapshot.N + nx; const dot = snapshot.u[cell] * d8x[n] + snapshot.v[cell] * d8y[n]; if (!visited[j] && dot > best) { best = dot; next = j; } }
    if (next < 0) for (let n = 0; n < 8; n++) { const nx = x + d8x[n]; const ny = y + d8y[n]; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue; const j = ny * snapshot.N + nx; if (!visited[j] && snapshot.b[j] < snapshot.b[cell] && (next < 0 || snapshot.b[j] < snapshot.b[next])) next = j; }
    if (next < 0) break; cell = next;
  }
  return result;
}

function buildZones(snapshot, path) {
  const zoneByCell = new Int8Array(snapshot.NN); zoneByCell.fill(3);
  const corridor = [0, 0, 0];
  for (let p = 0; p < path.length; p++) {
    const zone = p <= 5 ? 0 : p <= 15 ? 1 : 2; const cell = path[p]; const before = path[Math.max(0, p - 1)]; const after = path[Math.min(path.length - 1, p + 1)]; const dx = Math.sign((after % snapshot.N) - (before % snapshot.N)); const dy = Math.sign(((after / snapshot.N) | 0) - ((before / snapshot.N) | 0)); const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0;
    for (let offset = -2; offset <= 2; offset++) { const sx = x - dy * offset; const sy = y + dx * offset; if (sx >= 0 && sy >= 0 && sx < snapshot.N && sy < snapshot.N) zoneByCell[sy * snapshot.N + sx] = zone; }
  }
  return zoneByCell;
}

function buildDistanceBins(snapshot) {
  const bins = new Int8Array(snapshot.NN); const src = snapshot.sources[0];
  for (let i = 0; i < snapshot.NN; i++) { const x = i % snapshot.N; const y = (i / snapshot.N) | 0; const distance = Math.hypot(x - src.x, y - src.y); bins[i] = distance <= 8 ? 0 : distance <= 20 ? 1 : distance <= 40 ? 2 : 3; }
  return bins;
}

function sum(values) { let result = 0; for (const value of values) result += value; return result; }
function percentile(values, p) { if (!values.length) return null; const ordered = [...values].sort((a, b) => a - b); return ordered[Math.floor((ordered.length - 1) * p)]; }
function capacity(snapshot, i, kcap = 0.055) { const x = i % snapshot.N; const y = (i / snapshot.N) | 0; const left = x ? snapshot.b[i - 1] : snapshot.b[i]; const right = x < snapshot.N - 1 ? snapshot.b[i + 1] : snapshot.b[i]; const top = y ? snapshot.b[i - snapshot.N] : snapshot.b[i]; const bottom = y < snapshot.N - 1 ? snapshot.b[i + snapshot.N] : snapshot.b[i]; const slope = Math.hypot((right - left) * .5, (bottom - top) * .5); return kcap * slope / Math.sqrt(1 + slope * slope) * Math.hypot(snapshot.u[i], snapshot.v[i]) * Math.min(1, snapshot.d[i] * 4); }

function section(snapshot, path, position) { const cell = path[position]; const before = path[Math.max(0, position - 1)]; const after = path[Math.min(path.length - 1, position + 1)]; const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; const nx = -Math.sign(dy); const ny = Math.sign(dx); let discharge = 0, q = 0, vx = 0, vy = 0, wet = 0;
  for (let offset = -2; offset <= 2; offset++) { const sx = x + nx * offset; const sy = y + ny * offset; if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue; const i = sy * snapshot.N + sx; const vel = Math.hypot(snapshot.u[i], snapshot.v[i]); discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length); q += snapshot.d[i] * vel; vx += snapshot.d[i] * snapshot.u[i]; vy += snapshot.d[i] * snapshot.v[i]; if (snapshot.d[i] > 1e-5) wet++; }
  return { discharge, wet, coherence: Math.hypot(vx, vy) / Math.max(q, 1e-12) };
}

function zoneStats(snapshot, path, zoneByCell, zone, kcap) {
  let waterMass = 0, suspendedMass = 0, capacityMass = 0, undersaturatedWater = 0, erosion = 0; const concentrations = []; const sections = [];
  for (let i = 0; i < snapshot.NN; i++) if (zoneByCell[i] === zone) { const d = snapshot.d[i]; const c = snapshot.s[i] / Math.max(d, DRY_EPS); const cc = capacity(snapshot, i, kcap); waterMass += d; suspendedMass += snapshot.s[i]; capacityMass += cc; if (d >= DRY_EPS && c < cc) undersaturatedWater += d; if (d >= DRY_EPS) concentrations.push(c); }
  const range = zone === 0 ? [0, 5] : zone === 1 ? [6, 15] : [16, path.length - 1];
  for (let p = range[0]; p <= range[1]; p++) { sections.push(section(snapshot, path, p)); erosion += Math.max(0, snapshot.bInit[path[p]] - snapshot.b[path[p]]); }
  return { waterMass, suspendedMass, bulkConcentration: suspendedMass / Math.max(waterMass, DRY_EPS), meanCellConcentration: sum(concentrations) / Math.max(concentrations.length, 1), capacityConcentrationMean: capacityMass / Math.max(concentrations.length, 1), saturationRatio: (suspendedMass / Math.max(waterMass, DRY_EPS)) / Math.max(capacityMass / Math.max(concentrations.length, 1), DRY_EPS), undersaturatedWaterFraction: undersaturatedWater / Math.max(waterMass, DRY_EPS), erosion, discharge: sum(sections.map((v) => v.discharge)) / sections.length, wetWidth: sum(sections.map((v) => v.wet)) / sections.length, coherence: sum(sections.map((v) => v.coherence)) / sections.length };
}

function metrics(snapshot, path, zones, kcap) {
  const values = [0, 1, 2].map((zone) => zoneStats(snapshot, path, zones, zone, kcap)); let totalErosion = 0, netBedRemoval = 0, suspended = 0;
  for (let i = 0; i < snapshot.NN; i++) { totalErosion += Math.max(0, snapshot.bInit[i] - snapshot.b[i]); netBedRemoval += snapshot.bInit[i] - snapshot.b[i]; suspended += snapshot.s[i]; }
  const pathErosion = values.reduce((total, value) => total + value.erosion, 0); const grossErosion = [...snapshot.exchangeGrossErosion]; const grossDeposition = [...snapshot.exchangeGrossDeposition];
  return { totalErosion, sedimentResidual: suspended - netBedRemoval, nearErosion: values[0].erosion, midErosion: values[1].erosion, downstreamErosion: values[2].erosion, nearShare: values[0].erosion / Math.max(pathErosion, 1e-12), downstreamShare: values[2].erosion / Math.max(pathErosion, 1e-12), mouthDischarge: values[0].discharge, midDischarge: values[1].discharge, downstreamDischarge: values[2].discharge, downstreamVsMouth: values[2].discharge / Math.max(values[0].discharge, 1e-12), wetWidth: values.reduce((total, value) => total + value.wetWidth, 0) / 3, directionalCoherence: values.reduce((total, value) => total + value.coherence, 0) / 3, zones: values, grossErosion, grossDeposition };
}

function distanceStats(snapshot, kcap) { const src = snapshot.sources[0]; const bins = [[0, 8], [9, 20], [21, 40], [41, Infinity]].map(() => ({ waterMass: 0, suspendedMass: 0, capacity: 0, cells: 0, under: 0 })); for (let i = 0; i < snapshot.NN; i++) { const x = i % snapshot.N; const y = (i / snapshot.N) | 0; const distance = Math.hypot(x - src.x, y - src.y); const n = distance <= 8 ? 0 : distance <= 20 ? 1 : distance <= 40 ? 2 : 3; const d = snapshot.d[i]; const c = snapshot.s[i] / Math.max(d, DRY_EPS); const cc = capacity(snapshot, i, kcap); bins[n].waterMass += d; bins[n].suspendedMass += snapshot.s[i]; bins[n].capacity += cc; bins[n].cells++; if (d >= DRY_EPS && c < cc) bins[n].under += d; } return bins.map((bin, index) => ({ distance: ["0-8", "9-20", "21-40", ">40"][index], waterMass: bin.waterMass, suspendedMass: bin.suspendedMass, bulkConcentration: bin.suspendedMass / Math.max(bin.waterMass, DRY_EPS), meanCapacityConcentration: bin.capacity / Math.max(bin.cells, 1), undersaturatedWaterFraction: bin.under / Math.max(bin.waterMass, DRY_EPS), grossErosion: snapshot.exchangeDistanceErosion[index], grossDeposition: snapshot.exchangeDistanceDeposition[index] })); }

const zeroBins = new Int8Array(192 * 192); const reference = simulate(historical, 1000, zeroBins, zeroBins); const referencePath = tracePath(reference); const zones = buildZones(reference, referencePath); const distanceBins = buildDistanceBins(reference);
const control = metrics(simulate(historical, 5000, zones, distanceBins), referencePath, zones, .055);
const conservativeOnly = metrics(simulate(conservativeSource(), 5000, zones, distanceBins), referencePath, zones, .055);
console.log("CONTROL MATRIX | 5000"); console.table([{ variant: "HISTORICAL", ...control }, { variant: "CONSERVATIVE_ONLY", ...conservativeOnly }].map(({ zones: ignored, grossErosion, grossDeposition, ...row }) => row));

const pass1 = [];
for (const model of ["MASS_TARGET", "CONCENTRATION_RELAXATION"]) for (const kcap of [.025, .05, .1, .2, .4, .8, 1.6, 3.2]) for (const steps of [1000, 5000]) { const result = metrics(simulate(exchangeSource(model, kcap), steps, zones, distanceBins), referencePath, zones, kcap); pass1.push({ model, kcap, steps, ...result }); }
console.log("PASS 1"); console.table(pass1.map(({ zones: ignored, grossErosion, grossDeposition, ...row }) => ({ ...row, erosionPercentCurrent: row.totalErosion / control.totalErosion * 100, selected: row.steps === 5000 && row.totalErosion >= control.totalErosion * .5 && row.totalErosion <= control.totalErosion * 2 })));
const selected = pass1.filter((row) => row.steps === 5000 && row.totalErosion >= control.totalErosion * .5 && row.totalErosion <= control.totalErosion * 2).sort((a, b) => Math.abs(a.totalErosion - control.totalErosion) - Math.abs(b.totalErosion - control.totalErosion)).slice(0, 3);
const pass2Coefficients = [...new Set(selected.flatMap(({ kcap }) => [kcap * .8, kcap, kcap * 1.25]).map((value) => Number(value.toFixed(4))))]; const pass2 = [];
for (const model of ["MASS_TARGET", "CONCENTRATION_RELAXATION"]) for (const kcap of pass2Coefficients) { const result = metrics(simulate(exchangeSource(model, kcap), 5000, zones, distanceBins), referencePath, zones, kcap); pass2.push({ model, kcap, steps: 5000, ...result }); }
console.log("PASS 2"); console.table(pass2.map(({ zones: ignored, grossErosion, grossDeposition, ...row }) => row));
function candidate(row) { return row.totalErosion >= control.totalErosion * .7 && row.totalErosion <= control.totalErosion * 1.3 && row.nearShare < control.nearShare && row.downstreamErosion > control.downstreamErosion && row.downstreamShare > control.downstreamShare && (row.downstreamDischarge > control.downstreamDischarge * 1.1 || row.downstreamVsMouth > control.downstreamVsMouth * 1.1) && Math.abs(row.sedimentResidual) < Math.max(row.totalErosion, 1) * 1e-3; }
const best = pass2.filter(candidate).sort((a, b) => b.downstreamDischarge - a.downstreamDischarge)[0];
if (best) { const longRun = metrics(simulate(exchangeSource(best.model, best.kcap), 10000, zones, distanceBins), referencePath, zones, best.kcap); console.log("BEST CANDIDATE | 10000"); console.table([{ model: best.model, kcap: best.kcap, ...longRun }].map(({ zones: ignored, grossErosion, grossDeposition, ...row }) => row)); for (const [index, name] of ["MOUTH", "MID", "DOWNSTREAM"].entries()) console.log(`SATURATION | ${name}`), console.table([{ zone: name, ...longRun.zones[index], grossErosion: longRun.grossErosion[index], grossDeposition: longRun.grossDeposition[index], netExchange: longRun.grossErosion[index] - longRun.grossDeposition[index], turnover: longRun.grossErosion[index] + longRun.grossDeposition[index] }]); console.log("SOURCE SATURATION TRACE | 100, 500, 1000, 2500, 5000"); for (const steps of [100, 500, 1000, 2500, 5000]) console.log(`steps ${steps}`), console.table(distanceStats(simulate(exchangeSource(best.model, best.kcap), steps, zones, distanceBins), best.kcap)); }
const equivalent = pass1.every((row) => { const twin = pass1.find((other) => other.model !== row.model && other.kcap === row.kcap && other.steps === row.steps); return twin && Math.abs(row.totalErosion - twin.totalErosion) < 1e-5 && Math.abs(row.sedimentResidual - twin.sedimentResidual) < 1e-5; });
const conclusion = best ? "EXCHANGE A — conservative mass + concentration capacity improves morphology" : selected.length ? "EXCHANGE B — exchange law still saturates downstream too strongly" : "EXCHANGE C — sediment exchange is not the dominant remaining mechanism";
console.log(`FORMULATION EQUIVALENCE: ${equivalent ? "MASS_TARGET and CONCENTRATION_RELAXATION match to Float32 tolerance" : "formulations diverge; inspect dry-cell treatment"}`); console.log(`EXCHANGE CONCLUSION: ${conclusion}`);
