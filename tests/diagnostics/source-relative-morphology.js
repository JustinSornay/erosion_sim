/**
 * Source-relative morphology audit.  All production changes are injected into
 * an in-memory engine; instrumentation only observes source-centred outcomes.
 * RUN: node tests/diagnostics/source-relative-morphology.js
 */
const fs = require("fs");
const path = require("path");
const { conservativeSource } = require("../experiments/sediment/conservative-sediment-transport.js");
const { positiveTransportSource } = require("../experiments/sediment/conservative-transport-positivity.js");

const root = path.resolve(__dirname, "../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const production = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const output = path.join(root, "tests/generated/source-relative-morphology");
const sourceX = 48, sourceY = 48, checkpoints = [1000, 2500, 5000, 7500, 10000];
const windows = [{ name: "0..1000", start: 1, end: 1000 }, { name: "1001..2500", start: 1001, end: 2500 }, { name: "2501..5000", start: 2501, end: 5000 }, { name: "5001..7500", start: 5001, end: 7500 }, { name: "7501..10000", start: 7501, end: 10000 }];
const fields = ["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"], radii = [8, 12, 16, 24, 32, 48];
const epsilon = 1e-30;

fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, "COMPLETE"), { force: true });
fs.writeFileSync(path.join(output, "progress.log"), `[start] ${new Date().toISOString()}\n`);
const progress = (message) => fs.appendFileSync(path.join(output, "progress.log"), `${new Date().toISOString()} ${message}\n`);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const share = (value, total) => total ? value / total : 0;
const percentile = (weighted, q, key) => { const total = sum(weighted.map((row) => row.weight)); if (!total) return null; let seen = 0; const target = total * q; for (const row of [...weighted].sort((a, b) => a[key] - b[key])) { seen += row.weight; if (seen >= target) return row[key]; } return weighted.at(-1)[key]; };
const diff = (left, right) => { let maximum = 0; for (let i = 0; i < left.length; i++) maximum = Math.max(maximum, Math.abs(left[i] - right[i])); return maximum; };

/** Adds observers after exchange arithmetic, preserving production state writes. */
function instrumentExchange(source) {
  let result = `let auditErosionByCell, auditDepositionByCell;\n${source}`;
  result = result.replace(/b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, "b[i] -= diff; s[i] = si + diff; auditErosionByCell[i] += diff;");
  result = result.replace(/b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, "b[i] += diff; s[i] = Math.max(0, si - diff); auditDepositionByCell[i] += diff;");
  // Legacy-capacity source keeps both exchange writes on one line.
  result = result.replace(/b\[i\] -= diff; s\[i\] = si \+ diff;/, "b[i] -= diff; s[i] = si + diff; auditErosionByCell[i] += diff;");
  result = result.replace(/b\[i\] \+= diff; s\[i\] = Math\.max\(0, si - diff\);/, "b[i] += diff; s[i] = Math.max(0, si - diff); auditDepositionByCell[i] += diff;");
  if (!result.includes("auditErosionByCell[i] += diff")) throw new Error("Exchange instrumentation injection failed");
  return result;
}

function legacyExchange(source) {
  const pattern = /const C = KC \* sinA \* vel \* dNorm;\r?\n\s*const si = s\[i\];\r?\n\s*if \(C > si\) \{\r?\n\s*const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;\r?\n\s*\} else \{\r?\n\s*const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);\r?\n\s*\}/;
  const replacement = `const C = KC * sinA * vel * dNorm;
      const si = s[i]; const targetMass = C;
      if (targetMass > si) {
        const diff = KS * (targetMass - si) * sourceProtectionMask[i];
        b[i] -= diff; s[i] = si + diff;
      } else {
        const diff = KD * (si - targetMass);
        b[i] += diff; s[i] = Math.max(0, si - diff);
      }`;
  const result = source.replace(pattern, replacement); if (result === source) throw new Error("Legacy capacity injection failed"); return result;
}

function position(N, i) { const x = i % N, y = (i / N) | 0, dx = x - sourceX, dy = y - sourceY; return { x, y, dx, dy, r: Math.hypot(dx, dy) }; }
function halfPlane(dy) { return dy < -6 ? "UPSTREAM" : dy > 6 ? "DOWNSTREAM" : "SOURCE_BAND"; }
function sector(dx, dy, r) { if (r <= 6) return "SOURCE_DISK"; if (dy > 0 && Math.abs(dx) <= dy) return "DOWNSTREAM_WEDGE"; if (dy < 0 && Math.abs(dx) <= -dy) return "UPSTREAM_WEDGE"; return dx < 0 ? "LEFT_LATERAL" : dx > 0 ? "RIGHT_LATERAL" : "AXIS"; }
function annulus(r) { return r <= 6 ? "r0..6" : r <= 12 ? "r7..12" : r <= 24 ? "r13..24" : r <= 48 ? "r25..48" : r <= 96 ? "r49..96" : "r97+"; }
function emptyMagnitude() { return { grossErosion: 0, grossDeposition: 0 }; }
function addMagnitude(row, erosion, deposition) { row.grossErosion += erosion; row.grossDeposition += deposition; }
function finalMagnitude(row, totals) { const turnover = row.grossErosion + row.grossDeposition; return { ...row, grossTurnover: turnover, erosionShare: share(row.grossErosion, totals.grossErosion), depositionShare: share(row.grossDeposition, totals.grossDeposition), turnoverShare: share(turnover, totals.grossErosion + totals.grossDeposition) }; }

function morphology(N, erosion, deposition) {
  const total = emptyMagnitude(), planes = Object.fromEntries(["UPSTREAM", "DOWNSTREAM", "SOURCE_BAND"].map((key) => [key, emptyMagnitude()]));
  const sectors = Object.fromEntries(["SOURCE_DISK", "DOWNSTREAM_WEDGE", "UPSTREAM_WEDGE", "LEFT_LATERAL", "RIGHT_LATERAL", "AXIS"].map((key) => [key, emptyMagnitude()]));
  const rings = Object.fromEntries(["r0..6", "r7..12", "r13..24", "r25..48", "r49..96", "r97+"].map((key) => [key, { ...emptyMagnitude(), absoluteNetBedChange: 0, upstream: emptyMagnitude(), downstream: emptyMagnitude() }]));
  const erosionSamples = [], depositionSamples = [];
  for (let i = 0; i < erosion.length; i++) {
    const e = erosion[i], d = deposition[i], { dx, dy, r } = position(N, i); addMagnitude(total, e, d); addMagnitude(planes[halfPlane(dy)], e, d); addMagnitude(sectors[sector(dx, dy, r)], e, d);
    const ring = rings[annulus(r)]; addMagnitude(ring, e, d); if (dy < -6) addMagnitude(ring.upstream, e, d); if (dy > 6) addMagnitude(ring.downstream, e, d);
    if (e) erosionSamples.push({ weight: e, dx, dy, r }); if (d) depositionSamples.push({ weight: d, dx, dy, r });
  }
  const distribution = (samples) => { const totalWeight = sum(samples.map((row) => row.weight)); const centroid = (key) => totalWeight ? sum(samples.map((row) => row.weight * row[key])) / totalWeight : null; return { centroidDx: centroid("dx"), centroidDy: centroid("dy"), p10Dy: percentile(samples, .10, "dy"), p25Dy: percentile(samples, .25, "dy"), p50Dy: percentile(samples, .50, "dy"), p75Dy: percentile(samples, .75, "dy"), p90Dy: percentile(samples, .90, "dy"), centroidR: centroid("r"), p25R: percentile(samples, .25, "r"), p50R: percentile(samples, .50, "r"), p75R: percentile(samples, .75, "r"), p90R: percentile(samples, .90, "r"), fractionDyLessThan0: share(sum(samples.filter((row) => row.dy < 0).map((row) => row.weight)), totalWeight) }; };
  return { total: finalMagnitude(total, total), halfPlanes: Object.fromEntries(Object.entries(planes).map(([key, value]) => [key, finalMagnitude(value, total)])), sectors: Object.fromEntries(Object.entries(sectors).map(([key, value]) => [key, finalMagnitude(value, total)])), annuli: Object.fromEntries(Object.entries(rings).map(([key, value]) => [key, { ...finalMagnitude(value, total), upstream: finalMagnitude(value.upstream, total), downstream: finalMagnitude(value.downstream, total) }])), erosion: distribution(erosionSamples), deposition: distribution(depositionSamples) };
}

function emptyExposure() { return { wetCellSteps: 0, depthIntegral: 0, velocityIntegral: 0, erosion: 0, deposition: 0 }; }
function emptyFlux() { return { north: { netOutward: 0, positiveOutward: 0 }, south: { netOutward: 0, positiveOutward: 0 }, west: { netOutward: 0, positiveOutward: 0 }, east: { netOutward: 0, positiveOutward: 0 } }; }
function emptySediment() { return { north: { net: 0, positiveOut: 0, incoming: 0 }, south: { net: 0, positiveOut: 0, incoming: 0 }, west: { net: 0, positiveOut: 0, incoming: 0 }, east: { net: 0, positiveOut: 0, incoming: 0 } }; }
function accumulateWater(N, state, controls) {
  for (const R of radii) { const flux = controls[R]; const x0 = sourceX - R, x1 = sourceX + R, y0 = sourceY - R, y1 = sourceY + R; const add = (side, value) => { flux[side].netOutward += value; flux[side].positiveOutward += Math.max(0, value); };
    for (let x = x0; x <= x1; x++) { add("north", state.fT[y0 * N + x] - (y0 ? state.fB[(y0 - 1) * N + x] : 0)); add("south", state.fB[y1 * N + x] - (y1 < N - 1 ? state.fT[(y1 + 1) * N + x] : 0)); }
    for (let y = y0; y <= y1; y++) { add("west", state.fL[y * N + x0] - (x0 ? state.fR[y * N + x0 - 1] : 0)); add("east", state.fR[y * N + x1] - (x1 < N - 1 ? state.fL[y * N + x1 + 1] : 0)); }
  }
}
function waterResult(controls) { return Object.fromEntries(radii.map((R) => { const row = controls[R], total = sum(Object.values(row).map((side) => side.positiveOutward)); return [R, { ...row, northShare: share(row.north.positiveOutward, total), southShare: share(row.south.positiveOutward, total), westShare: share(row.west.positiveOutward, total), eastShare: share(row.east.positiveOutward, total) }]; })); }
function sedimentResult(controls) { return Object.fromEntries(radii.map((R) => { const row = controls[R], total = sum(Object.values(row).map((side) => side.positiveOut)); return [R, { ...row, northShare: share(row.north.positiveOut, total), southShare: share(row.south.positiveOut, total), westShare: share(row.west.positiveOut, total), eastShare: share(row.east.positiveOut, total) }]; })); }
function crosses(R, donor, receiver, N, controls, value) { if (donor === receiver || !value) return; const a = position(N, donor), b = position(N, receiver), insideA = Math.abs(a.dx) <= R && Math.abs(a.dy) <= R, insideB = Math.abs(b.dx) <= R && Math.abs(b.dy) <= R; if (insideA === insideB) return; const outgoing = insideA; let side; if (a.y !== b.y) side = outgoing ? (b.y < a.y ? "north" : "south") : (a.y < b.y ? "north" : "south"); else side = outgoing ? (b.x < a.x ? "west" : "east") : (a.x < b.x ? "west" : "east"); const row = controls[R][side]; row.net += outgoing ? value : -value; if (outgoing) row.positiveOut += value; else row.incoming += value; }

function run(source, maximumSteps, callback, sedimentHook = false) {
  const math = Object.create(Math); math.random = () => .3141592653;
  const args = ["Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "callback", "transportBegin", "transportEnd", "transportDonor", "transportContribution", "positivityPreTransport", "positivityStop"];
  const body = `let roundingResidualCorrection = 0;
    ${source}
    auditErosionByCell = new Float64Array(NN); auditDepositionByCell = new Float64Array(NN); genTerrain(); const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    callback(0, { N, NN, b, bInit, d, s, u, v, fL, fR, fT, fB, auditErosionByCell, auditDepositionByCell });
    let diagnosticStepIndex = 0;
    for (diagnosticStepIndex = 1; diagnosticStepIndex <= ${maximumSteps}; diagnosticStepIndex++) { callback(-diagnosticStepIndex, { N, NN, b, bInit, d, s, u, v, fL, fR, fT, fB, auditErosionByCell, auditDepositionByCell }); step(); callback(diagnosticStepIndex, { N, NN, b, bInit, d, s, u, v, fL, fR, fT, fB, auditErosionByCell, auditDepositionByCell }); }`;
  return new Function(...args, body)(math, Float32Array, Float64Array, Int32Array, Uint8Array, callback, () => {}, () => {}, () => {}, sedimentHook || (() => {}), () => {}, () => {});
}

function runVariant(name, source, positive) {
  const cumulativeErosion = new Float64Array(192 * 192), cumulativeDeposition = new Float64Array(192 * 192), result = { name, checkpoints: {}, windows: {} }; let priorE = new Float64Array(192 * 192), priorD = new Float64Array(192 * 192), active = null;
  const startWindow = (window) => ({ window, exposure: Object.fromEntries(["UPSTREAM", "DOWNSTREAM", "SOURCE_BAND"].map((key) => [key, emptyExposure()])), water: Object.fromEntries(radii.map((R) => [R, emptyFlux()])), sediment: positive ? Object.fromEntries(radii.map((R) => [R, emptySediment()])) : null });
  const capture = (step, state) => {
    if (step < 0) { const window = windows.find((row) => row.start === -step); if (window) active = startWindow(window); return; }
    if (step) {
      for (let i = 0; i < state.NN; i++) { const e = state.auditErosionByCell[i], d = state.auditDepositionByCell[i]; cumulativeErosion[i] = e; cumulativeDeposition[i] = d; const { dy } = position(state.N, i), row = active.exposure[halfPlane(dy)]; if (state.d[i] > 1e-6) row.wetCellSteps++; row.depthIntegral += state.d[i]; row.velocityIntegral += Math.hypot(state.u[i], state.v[i]); row.erosion += e - priorE[i]; row.deposition += d - priorD[i]; }
      accumulateWater(state.N, state, active.water);
      if (windows.some((row) => row.end === step)) { const deltaE = new Float64Array(state.NN), deltaD = new Float64Array(state.NN); for (let i = 0; i < state.NN; i++) { deltaE[i] = cumulativeErosion[i] - priorE[i]; deltaD[i] = cumulativeDeposition[i] - priorD[i]; } const morph = morphology(state.N, deltaE, deltaD); for (const row of Object.values(active.exposure)) Object.assign(row, { erosionPerWetCellStep: share(row.erosion, row.wetCellSteps), depositionPerWetCellStep: share(row.deposition, row.wetCellSteps), erosionPerDepthExposure: share(row.erosion, row.depthIntegral), depositionPerDepthExposure: share(row.deposition, row.depthIntegral) }); result.windows[active.window.name] = { morphology: morph, hydraulicExposure: active.exposure, waterControlSurfaces: waterResult(active.water), ...(positive ? { sedimentControlSurfaces: sedimentResult(active.sediment) } : {}) }; priorE = new Float64Array(cumulativeErosion); priorD = new Float64Array(cumulativeDeposition); }
      if (checkpoints.includes(step)) result.checkpoints[step] = { morphology: morphology(state.N, cumulativeErosion, cumulativeDeposition) };
    }
  };
  const sedimentHook = positive ? (step, donor, receiver, value) => { if (active) for (const R of radii) crosses(R, donor, receiver, 192, active.sediment, value); } : null;
  run(source, 10000, capture, sedimentHook);
  result.fullGridAt10000 = { cumulativeErosionByCell: Array.from(cumulativeErosion), cumulativeDepositionByCell: Array.from(cumulativeDeposition) }; return result;
}

function buffers(source, instrumented) { const values = {}; const observed = instrumented ? source : `let auditErosionByCell, auditDepositionByCell;\n${source}`; run(observed, 10000, (step, state) => { if ([1000, 5000, 10000].includes(step)) values[step] = Object.fromEntries(fields.map((field) => [field, new Float32Array(state[field])])); }); return values; }
function identity(label, observed, baseline) { const differences = Object.fromEntries([1000, 5000, 10000].map((step) => [step, Object.fromEntries(fields.map((field) => [field, diff(observed[step][field], baseline[step][field])]))])); const passes = Object.values(differences).every((row) => Object.values(row).every((value) => value === 0)); if (!passes) throw new Error(`${label} identity failed`); return { passes, differences }; }
function median(values) { return [...values].sort((a, b) => a - b)[1]; }
function classification(current, legacy) { const late = ["5001..7500", "7501..10000"], upstream = (run, kind) => late.filter((name) => run.windows[name].morphology.halfPlanes.UPSTREAM[`${kind}Share`] >= .60).length >= 2; const currentE = upstream(current, "erosion"), currentD = upstream(current, "deposition"), legacyE = upstream(legacy, "erosion"), legacyD = upstream(legacy, "deposition"); const persistent = currentE || currentD || legacyE || legacyD; const earlyM = current.checkpoints[2500].morphology.halfPlanes.UPSTREAM, finalM = current.checkpoints[10000].morphology.halfPlanes.UPSTREAM; const early = (share(earlyM.grossErosion, finalM.grossErosion) >= .7 || share(earlyM.grossDeposition, finalM.grossDeposition) >= .7) && !currentE && !currentD; const waterDirections = (run, window) => ({ north: median([16, 24, 32].map((R) => run.windows[window].waterControlSurfaces[R].northShare)), south: median([16, 24, 32].map((R) => run.windows[window].waterControlSurfaces[R].southShare)) }); const sedimentDirections = (window) => ({ north: median([16, 24, 32].map((R) => legacy.windows[window].sedimentControlSurfaces[R].northShare)), south: median([16, 24, 32].map((R) => legacy.windows[window].sedimentControlSurfaces[R].southShare)) }); const lateWater = waterDirections(legacy, "7501..10000"), lateSediment = sedimentDirections("7501..10000"); const waterDirection = lateWater.north >= .5 ? "BULK_UPSTREAM_HYDRAULICS" : lateWater.south >= .5 ? "DOWNSTREAM_BULK_WATER" : "MULTIDIRECTIONAL_WATER"; const sedimentDirection = lateSediment.north >= .5 ? "UPSTREAM_SEDIMENT_ROUTING" : lateSediment.south >= .5 ? "DOWNSTREAM_SEDIMENT_ROUTING" : "MULTIDIRECTIONAL_SEDIMENT"; const reduced = late.some((name) => legacy.windows[name].morphology.halfPlanes.UPSTREAM.erosionShare <= .7 * current.windows[name].morphology.halfPlanes.UPSTREAM.erosionShare || legacy.windows[name].morphology.halfPlanes.UPSTREAM.depositionShare <= .7 * current.windows[name].morphology.halfPlanes.UPSTREAM.depositionShare); let label = "SOURCE-REL F — SHARED MIXED SOURCE-RELATIVE BIAS"; if (early && !persistent) label = "SOURCE-REL A — EARLY TRANSIENT DOMINATES"; else if ((currentE || currentD) && reduced) label = "SOURCE-REL E — CURRENT-SPECIFIC UPSTREAM BIAS"; else if (persistent && lateWater.north >= .5) label = "SOURCE-REL B — PERSISTENT BULK UPSTREAM HYDRAULIC ROUTING"; else if (persistent && lateWater.north < .5 && lateSediment.north >= .5) label = "SOURCE-REL C — UPSTREAM SEDIMENT ROUTING DESPITE NON-UPSTREAM BULK WATER"; else if (persistent && lateWater.north < .5 && lateSediment.north < .5) label = "SOURCE-REL D — UPSTREAM MORPHOLOGY UNDER LOW/NON-UPSTREAM THROUGHPUT"; return { earlyTransientDominated: early, persistentUpstreamMorphology: { current: { erosion: currentE, deposition: currentD }, positiveLegacy: { erosion: legacyE, deposition: legacyD } }, fractionFinalUpstreamProducedBy2500: { erosion: share(earlyM.grossErosion, finalM.grossErosion), deposition: share(earlyM.grossDeposition, finalM.grossDeposition) }, bulkWaterDirection: waterDirection, sedimentDirection, classification: label, reductionCurrentToLegacy: reduced, lateDirections: { water: lateWater, sediment: lateSediment } }; }

function main() {
  const positiveBase = positiveTransportSource(legacyExchange(conservativeSource())); const currentInstrumented = instrumentExchange(production), positiveInstrumented = instrumentExchange(positiveBase);
  progress("[control] CURRENT production identity"); const currentIdentity = identity("CURRENT", buffers(currentInstrumented, true), buffers(production, false));
  progress("[control] POSITIVE_CONSERVATIVE_LEGACY validated identity"); const positiveIdentity = identity("POSITIVE_CONSERVATIVE_LEGACY", buffers(positiveInstrumented, true), buffers(positiveBase, false));
  progress("[run] CURRENT"); const current = runVariant("CURRENT", currentInstrumented, false); progress("[run] POSITIVE_CONSERVATIVE_LEGACY"); const legacy = runVariant("POSITIVE_CONSERVATIVE_LEGACY", positiveInstrumented, true);
  const summary = { purpose: "Full-domain source-relative morphology audit; production physics and simulation.js remain unchanged.", source: { x: sourceX, y: sourceY, downstreamConvention: "dy > 0", sourceDisk: "r <= 6 reported separately" }, controls: { currentBitIdenticalProduction: currentIdentity, positiveLegacyBitIdenticalValidatedVariant: positiveIdentity }, variants: { CURRENT: current, POSITIVE_CONSERVATIVE_LEGACY: legacy }, conclusions: classification(current, legacy), completedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2)); fs.writeFileSync(path.join(output, "COMPLETE"), `completedAt: ${summary.completedAt}\nclassification: ${summary.conclusions.classification}\n`); progress(`[complete] ${summary.conclusions.classification}`); console.log(summary.conclusions.classification);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); throw error; }
