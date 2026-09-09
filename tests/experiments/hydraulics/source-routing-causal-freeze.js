/**
 * Causal source-routing experiment using in-memory variants of production code.
 *
 * No source, terrain, outlet, sediment-transport, capacity, or production file
 * is changed.  Variant edits are limited to exchange writes while the hydraulic
 * step, source injection, evaporation, and control surfaces remain identical.
 * RUN: node tests/experiments/hydraulics/source-routing-causal-freeze.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const output = path.join(root, "tests/generated/source-routing-causal-freeze");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const production = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const checkpoints = [100, 250, 500, 1000, 1500, 2500, 3500, 5000];
const controlCheckpoints = [1000, 2500, 5000];
const windows = [{ name: "1..250", start: 1, end: 250 }, { name: "251..500", start: 251, end: 500 }, { name: "501..1000", start: 501, end: 1000 }, { name: "1001..1500", start: 1001, end: 1500 }, { name: "1501..2500", start: 1501, end: 2500 }, { name: "2501..3500", start: 2501, end: 3500 }, { name: "3501..5000", start: 3501, end: 5000 }];
const radii = [8, 12, 16, 24, 32, 48];
const sides = ["north", "south", "west", "east"];
const sourceX = 48, sourceY = 48, epsilon = 1e-30;

fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, "COMPLETE"), { force: true });
fs.writeFileSync(path.join(output, "progress.log"), `[start] ${new Date().toISOString()}\n`);
const progress = (message) => fs.appendFileSync(path.join(output, "progress.log"), `${new Date().toISOString()} ${message}\n`);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const maxAbsDifference = (a, b) => { let maximum = 0; for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i])); return maximum; };
const direction = (row) => row.north.netOutward > 0 && row.north.netOutward > row.south.netOutward ? "NET_NORTH" : row.south.netOutward > 0 && row.south.netOutward > row.north.netOutward ? "NET_SOUTH" : "MIXED";

/** Injects observers without altering state writes in CURRENT. */
function variantSource(kind) {
  let text = `let auditErosion, auditDeposition, auditEvaporation;\n${production}`;
  const erosion = kind === "NO_MORPH"
    ? "const diff = KS * (C - si) * sourceProtectionMask[i];"
    : "const diff = KS * (C - si) * sourceProtectionMask[i]; auditErosion[i] += diff; b[i] -= diff; s[i] = si + diff;";
  const deposition = kind === "CURRENT"
    ? "const diff = KD * (si - C); auditDeposition[i] += diff; b[i] += diff; s[i] = Math.max(0, si - diff);"
    : "const diff = KD * (si - C);";
  text = text.replace(/const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, erosion);
  text = text.replace(/const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, deposition);
  text = text.replace("d[i] *= 1 - KE * DT;", "auditEvaporation[i] += d[i] * KE * DT; d[i] *= 1 - KE * DT;");
  if (!text.includes("auditEvaporation[i]")) throw new Error("Evaporation instrumentation injection failed");
  return text;
}

function position(N, index) { const x = index % N, y = Math.floor(index / N); return { x, y, dx: x - sourceX, dy: y - sourceY, r: Math.hypot(x - sourceX, y - sourceY) }; }
function plane(dy) { return dy < -6 ? "UPSTREAM" : dy > 6 ? "DOWNSTREAM" : "SOURCE_BAND"; }
function emptyFlux() { return Object.fromEntries(sides.map((side) => [side, { netOutward: 0, positiveOutward: 0 }])); }
function addFlux(N, state, controls) {
  for (const radius of radii) {
    const row = controls[radius], x0 = sourceX - radius, x1 = sourceX + radius, y0 = sourceY - radius, y1 = sourceY + radius;
    const add = (side, value) => { row[side].netOutward += value; row[side].positiveOutward += Math.max(0, value); };
    for (let x = x0; x <= x1; x++) { add("north", state.fT[y0 * N + x] - (y0 ? state.fB[(y0 - 1) * N + x] : 0)); add("south", state.fB[y1 * N + x] - (y1 < N - 1 ? state.fT[(y1 + 1) * N + x] : 0)); }
    for (let y = y0; y <= y1; y++) { add("west", state.fL[y * N + x0] - (x0 ? state.fR[y * N + x0 - 1] : 0)); add("east", state.fR[y * N + x1] - (x1 < N - 1 ? state.fL[y * N + x1 + 1] : 0)); }
  }
}
function oneStepFlux(N, state) { const controls = Object.fromEntries(radii.map((radius) => [radius, emptyFlux()])); addFlux(N, state, controls); return controls; }
function storage(N, depth) { return Object.fromEntries(radii.map((radius) => [radius, sum(depth.filter((_, index) => { const p = position(N, index); return Math.abs(p.dx) <= radius && Math.abs(p.dy) <= radius; }))])); }
function areaValue(N, values, radius) { let total = 0; for (let i = 0; i < values.length; i++) { const p = position(N, i); if (Math.abs(p.dx) <= radius && Math.abs(p.dy) <= radius) total += values[i]; } return total; }
function surfaceResult(controls, storageStart, storageEnd, evaporation, sourceWaterInjected) {
  return Object.fromEntries(radii.map((radius) => {
    const row = controls[radius], netTotalOutward = sum(sides.map((side) => row[side].netOutward));
    return [radius, {
      ...row,
      northMinusSouthNet: row.north.netOutward - row.south.netOutward,
      netTotalOutward,
      localDirection: direction(row),
      storage: { startDepthSum: storageStart[radius], endDepthSum: storageEnd[radius], approxStorageChangeRatio: storageEnd[radius] / Math.max(storageStart[radius], epsilon), changeDepthSum: storageEnd[radius] - storageStart[radius] },
      sourceWaterInjected,
      estimatedEvaporationLossDepthSum: evaporation[radius]
    }];
  }));
}
function summaryDirection(surfaces, radiiSet) { const values = radiiSet.map((radius) => surfaces[radius].localDirection); const north = values.filter((value) => value === "NET_NORTH").length, south = values.filter((value) => value === "NET_SOUTH").length; return north > south && north > values.length - north - south ? "NET_NORTH" : south > north && south > values.length - north - south ? "NET_SOUTH" : "MIXED"; }
function terrainDescription(N, state, mouth) {
  const descriptions = Object.fromEntries([8, 16, 24, 32].map((radius) => {
    const dz = [], north = [], south = [];
    for (let i = 0; i < state.NN; i++) { const p = position(N, i); if (p.r > radius || p.y === 0 || p.y === N - 1) continue; const dy = (state.b[i + N] - state.b[i - N]) * .5; dz.push(dy); north.push(state.b[i - N] < state.b[i]); south.push(state.b[i + N] < state.b[i]); }
    const sorted = [...dz].sort((a, b) => a - b);
    return [radius, { meanDzDy: sum(dz) / dz.length, medianDzDy: sorted[Math.floor(sorted.length / 2)], fractionCellsLocallyDescendingNorth: north.filter(Boolean).length / north.length, fractionCellsLocallyDescendingSouth: south.filter(Boolean).length / south.length }];
  }));
  return { terrain: descriptions, initialHead: "No initial water: initial hydraulic head equals terrain bed.", sourceOutlets: Array.from(mouth.outletIndices, (index, rank) => { const p = position(N, index); return { rank, x: p.x, y: p.y, dx: p.dx, dy: p.dy, weight: mouth.outletWeights[rank], terrainB: state.b[index], initialLocalHead: state.b[index] + state.d[index] }; }) };
}

function run(kind, observe) {
  const sourceText = variantSource(kind);
  const body = `${sourceText}\n auditErosion = new Float64Array(NN); auditDeposition = new Float64Array(NN); auditEvaporation = new Float64Array(NN); genTerrain(); const sourcePoint={x:48,y:48,rate:DEFAULT_RATE,active:true}; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const snapshot=()=>({N,NN,b,bInit,d,s,u,v,fL,fR,fT,fB,auditErosion,auditDeposition,auditEvaporation,source:sourcePoint,DT,L,KE}); observe(0,snapshot()); for(let stepIndex=1;stepIndex<=5000;stepIndex++){ step(); observe(stepIndex,snapshot()); auditErosion.fill(0); auditDeposition.fill(0); auditEvaporation.fill(0); }`;
  return new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", body)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Float64Array, Int32Array, Uint8Array, observe);
}

function stateBuffers(kind) { const buffers = {}; run(kind, (step, state) => { if (controlCheckpoints.includes(step)) buffers[step] = Object.fromEntries(["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"].map((field) => [field, new Float32Array(state[field]) ])); }); return buffers; }
function currentIdentityControl() { const baseline = stateBuffers("CURRENT"); const productionBuffers = {}; const body = `${production}\n genTerrain(); const sourcePoint={x:48,y:48,rate:DEFAULT_RATE,active:true}; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const snapshot=()=>({b,d,s,u,v,fL,fR,fT,fB}); for(let stepIndex=1;stepIndex<=5000;stepIndex++){step(); if([1000,2500,5000].includes(stepIndex)) observe(stepIndex,snapshot());}`;
  new Function("Math", "Float32Array", "Int32Array", "Uint8Array", "observe", body)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Int32Array, Uint8Array, (step, state) => { productionBuffers[step] = Object.fromEntries(Object.entries(state).map(([field, values]) => [field, new Float32Array(values)])); });
  const differences = Object.fromEntries(controlCheckpoints.map((step) => [step, Object.fromEntries(Object.keys(baseline[step]).map((field) => [field, maxAbsDifference(baseline[step][field], productionBuffers[step][field])]))]));
  return { passes: Object.values(differences).every((row) => Object.values(row).every((value) => value === 0)), differences };
}

function experiment(kind) {
  const result = { checkpoints: {}, windows: {}, firstWindowNetNorth: Object.fromEntries(radii.map((radius) => [radius, null])), firstStepPersistentNetNorth: Object.fromEntries(radii.map((radius) => [radius, null])), morphologyOnset: kind === "CURRENT" ? { r16: { "0.001": null, "0.01": null, "0.1": null }, r32: { "0.001": null, "0.01": null, "0.1": null } } : undefined };
  let active, initialTerrain, priorNorth = Object.fromEntries(radii.map((radius) => [radius, { count: 0, first: null }]));
  run(kind, (step, state) => {
    if (step === 0) { initialTerrain = terrainDescription(state.N, state, state.source); return; }
    const perStep = oneStepFlux(state.N, state);
    for (const radius of radii) { const netNorth = direction(perStep[radius]) === "NET_NORTH", streak = priorNorth[radius]; streak.count = netNorth ? streak.count + 1 : 0; streak.first = netNorth && streak.count === 1 ? step : streak.first; if (streak.count >= 100 && result.firstStepPersistentNetNorth[radius] === null) result.firstStepPersistentNetNorth[radius] = streak.first; }
    const window = windows.find((row) => row.start === step);
    if (window) active = { window, controls: Object.fromEntries(radii.map((radius) => [radius, emptyFlux()])), storageStart: storage(state.N, Array.from(state.d)), evaporation: Object.fromEntries(radii.map((radius) => [radius, 0])), morphology: Object.fromEntries(["UPSTREAM", "DOWNSTREAM", "SOURCE_BAND"].map((name) => [name, { grossErosion: 0, grossDeposition: 0, netBedChange: 0 }])), sourceWaterInjected: 0 };
    addFlux(state.N, state, active.controls);
    for (const radius of radii) active.evaporation[radius] += areaValue(state.N, state.auditEvaporation, radius);
    active.sourceWaterInjected += state.DT * state.source.rate;
    for (let i = 0; i < state.NN; i++) { const row = active.morphology[plane(position(state.N, i).dy)]; row.grossErosion += state.auditErosion[i]; row.grossDeposition += state.auditDeposition[i]; row.netBedChange += state.auditDeposition[i] - state.auditErosion[i]; }
    if (kind === "CURRENT") for (const [label, radius] of [["r16", 16], ["r32", 32]]) { const absolute = (() => { let total = 0; for (let i = 0; i < state.NN; i++) if (position(state.N, i).r <= radius) total += Math.abs(state.b[i] - state.bInit[i]); return total; })(); for (const threshold of ["0.001", "0.01", "0.1"]) if (absolute > Number(threshold) && result.morphologyOnset[label][threshold] === null) result.morphologyOnset[label][threshold] = step; }
    if (windows.some((row) => row.end === step)) { const surfaces = surfaceResult(active.controls, active.storageStart, storage(state.N, Array.from(state.d)), active.evaporation, active.sourceWaterInjected); for (const radius of radii) if (result.firstWindowNetNorth[radius] === null && surfaces[radius].localDirection === "NET_NORTH") result.firstWindowNetNorth[radius] = active.window.name; result.windows[active.window.name] = { surfaces, majorityDirectionR16R24R32: summaryDirection(surfaces, [16, 24, 32]), multiscaleDirectionR16R24R32R48: summaryDirection(surfaces, [16, 24, 32, 48]), bedChangeByHalfPlane: active.morphology }; }
    if (checkpoints.includes(step)) result.checkpoints[step] = { maxAbsBedMinusInitial: maxAbsDifference(state.b, state.bInit), grossDepositionCumulative: sum(Array.from(state.auditDeposition)) };
  });
  result.initialTerrainAndOutlets = initialTerrain;
  if (kind === "NO_MORPH") result.noMorphBedControl = { passes: Object.values(result.checkpoints).every((checkpoint) => checkpoint.maxAbsBedMinusInitial === 0), maxAbsBedMinusInitialByCheckpoint: Object.fromEntries(Object.entries(result.checkpoints).map(([step, checkpoint]) => [step, checkpoint.maxAbsBedMinusInitial])) };
  if (kind === "EROSION_ONLY") result.erosionOnlyControl = { passes: Object.values(result.windows).every((window) => Object.values(window.bedChangeByHalfPlane).every((row) => row.grossDeposition === 0)), grossDepositionByWindow: Object.fromEntries(Object.entries(result.windows).map(([name, window]) => [name, sum(Object.values(window.bedChangeByHalfPlane).map((row) => row.grossDeposition))])) };
  return result;
}

function causalWindow(current, frozen, erosionOnly, name) { const c = current.windows[name], n = frozen.windows[name], e = erosionOnly.windows[name]; const majorityCurrent = c.majorityDirectionR16R24R32, majorityFrozen = n.majorityDirectionR16R24R32; const comparisons = Object.fromEntries(radii.map((radius) => { const a = c.surfaces[radius], b = n.surfaces[radius]; return [radius, { currentNorthNetOutward: a.north.netOutward, noMorphNorthNetOutward: b.north.netOutward, ratioNorth: a.north.netOutward / Math.max(Math.abs(b.north.netOutward), epsilon), diffNorth: a.north.netOutward - b.north.netOutward, currentSouthNetOutward: a.south.netOutward, noMorphSouthNetOutward: b.south.netOutward, ratioSouth: a.south.netOutward / Math.max(Math.abs(b.south.netOutward), epsilon), diffSouth: a.south.netOutward - b.south.netOutward }]; })); const cMargin = [16,24,32].map((r) => c.surfaces[r].northMinusSouthNet), nMargin = [16,24,32].map((r) => n.surfaces[r].northMinusSouthNet); const classification = majorityFrozen === "NET_NORTH" ? (majorityCurrent === "NET_NORTH" && cMargin.every((value, index) => value >= 1.5 * nMargin[index]) ? "MORPH_AMPLIFIED_NORTH" : "FROZEN_NORTH") : majorityCurrent === "NET_NORTH" ? "MORPH_CREATED_NORTH" : "MIXED"; return { comparisons, currentMajority: majorityCurrent, noMorphMajority: majorityFrozen, erosionOnlyMajority: e.majorityDirectionR16R24R32, classification }; }

function main() {
  progress("[control] CURRENT instrumented identity"); const identity = currentIdentityControl(); if (!identity.passes) throw new Error("CURRENT instrumented identity control failed");
  const variants = {}; for (const kind of ["CURRENT", "NO_MORPH", "EROSION_ONLY"]) { progress(`[run] ${kind}`); variants[kind] = experiment(kind); }
  const comparisons = Object.fromEntries(windows.map(({ name }) => [name, causalWindow(variants.CURRENT, variants.NO_MORPH, variants.EROSION_ONLY, name)]));
  const late = ["2501..3500", "3501..5000"].map((name) => [name, comparisons[name]]);
  const earlyFrozenNorth = ["1..250", "251..500", "501..1000"].every((name) => variants.NO_MORPH.windows[name].majorityDirectionR16R24R32 === "NET_NORTH");
  const lateClassifications = late.map(([, row]) => row.classification);
  const causalClassification = earlyFrozenNorth ? (lateClassifications.some((value) => value === "MORPH_AMPLIFIED_NORTH") ? "ROUTING-CAUSE C — MORPHODYNAMICS AMPLIFIES PRE-EXISTING NORTH BIAS" : "ROUTING-CAUSE A — INITIAL/FROZEN TERRAIN ALREADY ROUTES NORTH") : lateClassifications.every((value) => value === "MORPH_CREATED_NORTH") ? "ROUTING-CAUSE B — MORPHODYNAMICS CREATES UPSTREAM ROUTING" : "ROUTING-CAUSE F — MIXED / SCALE-DEPENDENT CAUSALITY";
  const summary = { purpose: "Causal frozen-bed routing experiment through 5000 steps; source, terrain initialization, outlets, transport, capacity and exchange constants unchanged.", controls: { currentInstrumentedBitIdenticalProduction: identity, noMorphFrozenBed: variants.NO_MORPH.noMorphBedControl, erosionOnlyNoDeposition: variants.EROSION_ONLY.erosionOnlyControl, simulationJsUnchanged: true }, methodology: { surfaces: "Absolute source-centred control surfaces reused from routing audit.", perStepPersistentNorth: "NET_NORTH for at least 100 consecutive post-step surface observations.", sourceAndEvaporation: "Source injection and evaporation retained; sourceWaterInjected is volume, evaporation/storage are depth sums." }, variants, currentVsNoMorphByWindow: comparisons, currentVsNoMorphByLateWindow: Object.fromEntries(late), causalClassification, completedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2)); fs.writeFileSync(path.join(output, "COMPLETE"), `completedAt: ${summary.completedAt}\nclassification: ${causalClassification}\n`); progress(`[complete] ${causalClassification}`); console.log(causalClassification);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); throw error; }
