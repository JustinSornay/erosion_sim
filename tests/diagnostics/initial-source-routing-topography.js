/**
 * CATEGORY: DIAGNOSTIC
 * PURPOSE: Explains initial source-centred north routing without changing production physics.
 * RUN: node tests/diagnostics/initial-source-routing-topography.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const production = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const output = path.join(root, "tests/generated/initial-source-routing-topography");
const sourceX = 48, sourceY = 48, radii = [6, 8, 12, 16, 24, 32, 48], escapeRadii = [8, 12, 16, 24, 32, 48], checkpoints = [1, 2, 5, 10, 20, 50, 100, 150, 200, 250];
const d8 = [[-1, -1, "NW"], [0, -1, "NORTH"], [1, -1, "NE"], [-1, 0, "WEST"], [1, 0, "EAST"], [-1, 1, "SW"], [0, 1, "SOUTH"], [1, 1, "SE"]];

fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, "COMPLETE"), { force: true });
fs.writeFileSync(path.join(output, "progress.log"), `[start] ${new Date().toISOString()} initial source routing topology\n`);
const log = (message) => fs.appendFileSync(path.join(output, "progress.log"), `${new Date().toISOString()} ${message}\n`);
const mean = (values) => values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const weightedMean = (rows) => rows.reduce((total, row) => total + row.value * row.weight, 0) / Math.max(rows.reduce((total, row) => total + row.weight, 0), 1e-30);
const weightedMedian = (rows) => { const sorted = [...rows].sort((a, b) => a.value - b.value); const half = sorted.reduce((total, row) => total + row.weight, 0) / 2; let running = 0; for (const row of sorted) { running += row.weight; if (running >= half) return row.value; } return null; };
const cell = (N, x, y) => y * N + x;
const coordinates = (N, index) => ({ x: index % N, y: Math.floor(index / N) });
const position = (N, index) => { const { x, y } = coordinates(N, index); return { x, y, dx: x - sourceX, dy: y - sourceY, r: Math.hypot(x - sourceX, y - sourceY) }; };
const neighbors = (N, b, index) => d8.map(([dx, dy, direction]) => { const { x, y } = coordinates(N, index), nx = x + dx, ny = y + dy; return nx < 0 || ny < 0 || nx >= N || ny >= N ? null : { direction, x: nx, y: ny, index: cell(N, nx, ny), b: b[cell(N, nx, ny)], deltaB: b[cell(N, nx, ny)] - b[index] }; }).filter(Boolean);

/** Loads exact production source, freezing only morphodynamic bed writes for the hydraulic run. */
function noMorphSource() {
  let text = production;
  text = text.replace(/const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, "const diff = KS * (C - si) * sourceProtectionMask[i];");
  text = text.replace(/const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, "const diff = KD * (si - C);");
  if (text === production) throw new Error("NO_MORPH instrumentation injection failed");
  return text;
}

function createInitialState() {
  const body = `${production}\ngenTerrain(); const sourcePoint={x:${sourceX},y:${sourceY},rate:DEFAULT_RATE,active:true}; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); return {N,b,source:sourcePoint};`;
  return new Function("Math", "Float32Array", "Int32Array", "Uint8Array", body)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Int32Array, Uint8Array);
}

function gradientMetrics(N, b, radius, weightPower = 0) {
  const rows = [], north = [], south = [];
  for (let y = sourceY - radius; y <= sourceY + radius; y++) for (let x = sourceX - radius; x <= sourceX + radius; x++) {
    const index = cell(N, x, y), r = Math.hypot(x - sourceX, y - sourceY); if (r > radius || x === 0 || y === 0 || x === N - 1 || y === N - 1) continue;
    const dzdx = (b[index + 1] - b[index - 1]) * .5, dzdy = (b[index + N] - b[index - N]) * .5, weight = weightPower ? 1 / Math.max(r ** weightPower, 1) : 1;
    rows.push({ dzdx, dzdy, weight }); north.push(b[index - N] < b[index]); south.push(b[index + N] < b[index]);
  }
  const value = (key, kind) => kind ? weightedMean(rows.map((row) => ({ value: row[key], weight: row.weight }))) : mean(rows.map((row) => row[key]));
  const middle = (key, kind) => kind ? weightedMedian(rows.map((row) => ({ value: row[key], weight: row.weight }))) : median(rows.map((row) => row[key]));
  return { cellCount: rows.length, weight: weightPower === 1 ? "1/max(r,1)" : weightPower === 2 ? "1/max(r²,1)" : "uniform", meanDzdx: value("dzdx", weightPower), medianDzdx: middle("dzdx", weightPower), meanDzdy: value("dzdy", weightPower), medianDzdy: middle("dzdy", weightPower), fractionDescendingNorth: north.filter(Boolean).length / north.length, fractionDescendingSouth: south.filter(Boolean).length / south.length };
}

function cardinalProfiles(N, b) {
  const definitions = { north: (k) => [sourceX, sourceY - k], south: (k) => [sourceX, sourceY + k], west: (k) => [sourceX - k, sourceY], east: (k) => [sourceX + k, sourceY] };
  return Object.fromEntries(Object.entries(definitions).map(([direction, coordinate]) => {
    const profile = Array.from({ length: 49 }, (_, distance) => { const [x, y] = coordinate(distance); return { distance, x, y, b: b[cell(N, x, y)] }; });
    const sourceBed = profile[0].b, minimum = profile.reduce((best, row) => row.b < best.b ? row : best, profile[0]);
    const barrier = (limit) => Math.max(...profile.slice(1, limit + 1).map((row) => row.b - sourceBed), 0);
    return [direction, { profile, minimumBed: minimum.b, distanceToMinimum: minimum.distance, maximumBarrierAboveSource: barrier(48), maximumBarrierAlongFirst8: barrier(8), maximumBarrierAlongFirst16: barrier(16), netDeltaAt8: profile[8].b - sourceBed, netDeltaAt16: profile[16].b - sourceBed, netDeltaAt24: profile[24].b - sourceBed, netDeltaAt32: profile[32].b - sourceBed, netDeltaAt48: profile[48].b - sourceBed }];
  }));
}

function minimax(N, b, starts, radius) {
  const x0 = sourceX - radius, x1 = sourceX + radius, y0 = sourceY - radius, y1 = sourceY + radius, size = N * N;
  const cost = new Float64Array(size); cost.fill(Infinity); const previous = new Int32Array(size); previous.fill(-1); const used = new Uint8Array(size);
  for (const start of starts) { cost[start] = b[start]; }
  for (;;) { let current = -1, best = Infinity; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = cell(N, x, y); if (!used[i] && cost[i] < best) { best = cost[i]; current = i; } }
    if (current < 0) break; used[current] = 1; const { x, y } = coordinates(N, current);
    for (const [dx, dy] of d8) { const nx = x + dx, ny = y + dy; if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue; const next = cell(N, nx, ny), candidate = Math.max(cost[current], b[next]); if (candidate < cost[next]) { cost[next] = candidate; previous[next] = current; } }
  }
  const target = (side) => { let targetIndex = -1, best = Infinity; for (let offset = -radius; offset <= radius; offset++) { const x = side === "north" || side === "south" ? sourceX + offset : side === "west" ? sourceX - radius : sourceX + radius; const y = side === "west" || side === "east" ? sourceY + offset : side === "north" ? sourceY - radius : sourceY + radius; const i = cell(N, x, y); if (cost[i] < best) { best = cost[i]; targetIndex = i; } } return targetIndex; };
  return { cost, previous, target };
}
function escapeMetrics(N, b, mouth) {
  const starts = Array.from(mouth.outletIndices), minimumMouthBed = Math.min(...starts.map((i) => b[i]));
  const all = {}, paths = {};
  for (const radius of escapeRadii) { const result = minimax(N, b, starts, radius); all[radius] = { minimumMouthBed, sides: Object.fromEntries(["north", "south", "west", "east"].map((side) => { const target = result.target(side); return [side, { escapeBarrierSide: result.cost[target] - minimumMouthBed, minimumMaxBedAlongPath: result.cost[target] }]; })) };
    if ([16, 24, 32, 48].includes(radius)) for (const side of ["north", "south"]) { let current = result.target(side); const reversed = []; while (current >= 0) { reversed.push(current); current = result.previous[current]; } const route = reversed.reverse(); const highest = route.reduce((best, index) => b[index] > b[best] ? index : best, route[0]); paths[`R${radius}`] ||= {}; paths[`R${radius}`][side] = { pathLength: route.length, maximumBed: result.cost[result.target(side)], barrierAboveMouth: result.cost[result.target(side)] - minimumMouthBed, highestBarrier: { ...coordinates(N, highest), b: b[highest] }, coordinates: route.map((index) => coordinates(N, index)) }; }
  }
  return { byRadius: all, minimaxPaths: paths };
}

function monotonicReachability(N, b, start) {
  const reachable = new Uint8Array(N * N), queue = [start]; reachable[start] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) for (const neighbor of neighbors(N, b, queue[cursor])) if (!reachable[neighbor.index] && neighbor.b <= b[queue[cursor]]) { reachable[neighbor.index] = 1; queue.push(neighbor.index); }
  let maxNorthDyMagnitude = 0, maxSouthDy = 0; for (const index of queue) { const { y } = coordinates(N, index); maxNorthDyMagnitude = Math.max(maxNorthDyMagnitude, sourceY - y); maxSouthDy = Math.max(maxSouthDy, y - sourceY); }
  const reachedSurface = Object.fromEntries([8, 16, 24, 32].flatMap((radius) => [[`R${radius}North` , queue.some((i) => coordinates(N, i).y <= sourceY - radius)], [`R${radius}South`, queue.some((i) => coordinates(N, i).y >= sourceY + radius)]]));
  return { reachableCount: queue.length, maxNorthDyMagnitude, maxSouthDy, reachedSurface };
}
function steepestPath(N, b, start) {
  const route = [], visited = new Uint8Array(N * N); let current = start, termination = "ERROR";
  for (;;) { if (visited[current]) { termination = "CYCLE_IMPOSSIBLE_ERROR"; break; } visited[current] = 1; route.push(current); const { x, y } = coordinates(N, current); if (x === 0 || y === 0 || x === N - 1 || y === N - 1) { termination = "DOMAIN_BORDER"; break; } const lower = neighbors(N, b, current).filter((row) => row.b < b[current]).sort((a, z) => a.b - z.b)[0]; if (!lower) { termination = "LOCAL_SINK"; break; } current = lower.index; }
  const ys = route.map((index) => coordinates(N, index).y), final = coordinates(N, route[route.length - 1]); return { termination, pathLength: route.length, finalX: final.x, finalY: final.y, minY: Math.min(...ys), maxY: Math.max(...ys), first20Coordinates: route.slice(0, 20).map((index) => coordinates(N, index)) };
}
function sideHead(N, b, d, radius) { return Object.fromEntries(["north", "south", "west", "east"].map((side) => { const values = []; for (let offset = -radius; offset <= radius; offset++) { const x = side === "north" || side === "south" ? sourceX + offset : side === "west" ? sourceX - radius : sourceX + radius; const y = side === "west" || side === "east" ? sourceY + offset : side === "north" ? sourceY - radius : sourceY + radius; values.push(b[cell(N, x, y)] + d[cell(N, x, y)]); } return [side, { meanHead: mean(values), minimumHead: Math.min(...values), maximumHead: Math.max(...values) }]; })); }
function surfaceFlux(N, state, radius) { const row = { north: 0, south: 0 }; const yN = sourceY - radius, yS = sourceY + radius; for (let x = sourceX - radius; x <= sourceX + radius; x++) { row.north += state.fT[cell(N, x, yN)] - state.fB[cell(N, x, yN - 1)]; row.south += state.fB[cell(N, x, yS)] - state.fT[cell(N, x, yS + 1)]; } return { north: { netOutward: row.north }, south: { netOutward: row.south } }; }
function wetFront(N, d) { let minDx = Infinity, maxDx = -Infinity, minDy = Infinity, maxDy = -Infinity, northCount = 0, southCount = 0, northMass = 0, southMass = 0, farthestWetNorth = 0, farthestWetSouth = 0; for (let i = 0; i < d.length; i++) if (d[i] > 1e-6) { const p = position(N, i); minDx = Math.min(minDx, p.dx); maxDx = Math.max(maxDx, p.dx); minDy = Math.min(minDy, p.dy); maxDy = Math.max(maxDy, p.dy); if (p.dy < 0) { northCount++; northMass += d[i]; farthestWetNorth = Math.max(farthestWetNorth, -p.dy); } if (p.dy > 0) { southCount++; southMass += d[i]; farthestWetSouth = Math.max(farthestWetSouth, p.dy); } } return { minDx, maxDx, minDy, maxDy, wetCountNorthOfSource: northCount, wetCountSouthOfSource: southCount, depthMassNorth: northMass, depthMassSouth: southMass, farthestWetNorth, farthestWetSouth }; }

function runNoMorph(observe) { const body = `${noMorphSource()}\ngenTerrain(); const sourcePoint={x:${sourceX},y:${sourceY},rate:DEFAULT_RATE,active:true}; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const initialB=new Float32Array(b); for(let stepIndex=1;stepIndex<=250;stepIndex++){step();observe(stepIndex,{N,b,d,fL,fR,fT,fB,source:sourcePoint,initialB});}`; new Function("Math", "Float32Array", "Int32Array", "Uint8Array", "observe", body)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Int32Array, Uint8Array, observe); }

function classify(topo, mouthClass, dynamics) {
  const northDynamics = dynamics.finalWetNorth && dynamics.firstStepNorthExceedsSouth !== null;
  if (topo.label === "TOPO_NORTH_FAVORED" && mouthClass === "MOUTH_NORTH_BIASED" && northDynamics) return "INITIAL-ROUTING D — MULTIPLE INITIAL BIASES ALIGN NORTH";
  if (topo.label === "TOPO_NORTH_FAVORED" && northDynamics) return "INITIAL-ROUTING A — INITIAL TOPOGRAPHY FAVORS NORTH";
  if ((topo.label === "TOPO_MIXED" || topo.label === "TOPO_SOUTH_FAVORED") && mouthClass === "MOUTH_NORTH_BIASED" && northDynamics) return "INITIAL-ROUTING B — MOUTH GEOMETRY SEEDS NORTH ROUTE";
  if (topo.label !== "TOPO_NORTH_FAVORED" && mouthClass !== "MOUTH_NORTH_BIASED" && northDynamics) return "INITIAL-ROUTING C — FILLING DYNAMICS CREATES NORTH ROUTE";
  return "INITIAL-ROUTING E — MIXED / NO SINGLE STATIC EXPLANATION";
}

function main() {
  log("[terrain] exact deterministic production terrain; no step() invoked"); const initial = createInitialState(), { N, b, source: mouth } = initial, sourceIndex = cell(N, sourceX, sourceY);
  const terrainDump = []; for (let y = 0; y <= 96; y++) for (let x = 0; x <= 96; x++) { const index = cell(N, x, y); terrainDump.push({ x, y, b: b[index], dx: x - sourceX, dy: y - sourceY, r: Math.hypot(x - sourceX, y - sourceY) }); }
  const outletRows = Array.from(mouth.outletIndices, (gridIndex, rank) => { const p = position(N, gridIndex), local = neighbors(N, b, gridIndex), descending = local.filter((row) => row.deltaB < 0).sort((a, z) => a.b - z.b)[0] || null; return { index: gridIndex, outletRank: rank, x: p.x, y: p.y, dx: p.dx, dy: p.dy, weight: mouth.outletWeights[rank], b: b[gridIndex], deltaBFromSource: b[gridIndex] - b[sourceIndex], neighbors: local, steepestDescendingNeighbor: descending && { x: descending.x, y: descending.y, b: descending.b }, direction: descending?.direction ?? null, drop: descending ? -descending.deltaB : 0 }; });
  const sourceNeighbors = neighbors(N, b, sourceIndex), sourceDescent = sourceNeighbors.filter((row) => row.deltaB < 0).sort((a, z) => a.b - z.b)[0] || null;
  const gradients = Object.fromEntries(radii.map((radius) => [radius, { uniform: gradientMetrics(N, b, radius), inverseR: gradientMetrics(N, b, radius, 1), inverseRSquared: gradientMetrics(N, b, radius, 2) }]));
  const escape = escapeMetrics(N, b, mouth), monotonic = outletRows.map((row, rank) => ({ outletIndex: rank, x: row.x, y: row.y, ...monotonicReachability(N, b, mouth.outletIndices[rank]) })), steepest = outletRows.map((row, rank) => ({ outletIndex: rank, x: row.x, y: row.y, ...steepestPath(N, b, mouth.outletIndices[rank]) }));
  const totalWeight = outletRows.reduce((total, row) => total + row.weight, 0), centroidX = outletRows.reduce((total, row) => total + row.x * row.weight, 0) / totalWeight, centroidY = outletRows.reduce((total, row) => total + row.y * row.weight, 0) / totalWeight, centroidDy = centroidY - sourceY;
  const mouthClass = centroidDy < -.25 ? "MOUTH_NORTH_BIASED" : centroidDy > .25 ? "MOUTH_SOUTH_BIASED" : "MOUTH_NEUTRAL";
  const northEscape = escape.byRadius[48].sides.north.escapeBarrierSide, southEscape = escape.byRadius[48].sides.south.escapeBarrierSide, maxNorthReach = Math.max(...monotonic.map((row) => row.maxNorthDyMagnitude)), maxSouthReach = Math.max(...monotonic.map((row) => row.maxSouthDy));
  const flags = { A_northEscapeLower: northEscape < southEscape, B_northMonotonicFurther: maxNorthReach > maxSouthReach, C_weightedLocalNorth: [8, 16].every((radius) => gradients[radius].inverseR.meanDzdy > 0), D_steepestMouthPathNorth: steepest.some((row) => row.minY < sourceY) };
  const northVotes = Object.values(flags).filter(Boolean).length, southFlags = { A_southEscapeLower: southEscape < northEscape, B_southMonotonicFurther: maxSouthReach > maxNorthReach, C_weightedLocalSouth: [8, 16].every((radius) => gradients[radius].inverseR.meanDzdy < 0), D_steepestMouthPathSouth: steepest.some((row) => row.maxY > sourceY) }, southVotes = Object.values(southFlags).filter(Boolean).length;
  const topo = { label: northVotes >= 2 ? "TOPO_NORTH_FAVORED" : southVotes >= 2 ? "TOPO_SOUTH_FAVORED" : "TOPO_MIXED", northVotes, southVotes, northCriteria: flags, southCriteria: southFlags };
  log("[hydraulics] NO_MORPH steps 1..250"); const checkpointRows = {}, fluxSeries = [], firstNorth = Object.fromEntries([8, 12, 16, 24].map((radius) => [radius, { firstNetNorthStep: null, firstNetSouthStep: null, firstStepNorthExceedsSouth: null, first100StepPersistentNorth: null, streak: 0 }]));
  runNoMorph((step, state) => { const flux = Object.fromEntries([8, 12, 16, 24].map((radius) => [radius, surfaceFlux(N, state, radius)])); for (const radius of [8, 12, 16, 24]) { const row = flux[radius], track = firstNorth[radius], north = row.north.netOutward > 0, south = row.south.netOutward > 0; if (north && track.firstNetNorthStep === null) track.firstNetNorthStep = step; if (south && track.firstNetSouthStep === null) track.firstNetSouthStep = step; if (row.north.netOutward > row.south.netOutward && track.firstStepNorthExceedsSouth === null) track.firstStepNorthExceedsSouth = step; track.streak = north ? track.streak + 1 : 0; if (track.streak >= 100 && track.first100StepPersistentNorth === null) track.first100StepPersistentNorth = step - 99; } fluxSeries.push({ step, surfaces: flux }); if (!checkpoints.includes(step)) return; const heads = Object.fromEntries([8, 12, 16, 24].map((radius) => { const sides = sideHead(N, state.b, state.d, radius); return [radius, { sides, northMinusSouthMeanHead: sides.north.meanHead - sides.south.meanHead }]; })); checkpointRows[step] = { wetFront: wetFront(N, state.d), head: heads }; });
  const fluxOnset = Object.fromEntries(Object.entries(firstNorth).map(([radius, row]) => [radius, { firstNetNorthStep: row.firstNetNorthStep, firstNetSouthStep: row.firstNetSouthStep, firstStepNorthExceedsSouth: row.firstStepNorthExceedsSouth, first100StepPersistentNorth: row.first100StepPersistentNorth }]));
  const finalWet = checkpointRows[250].wetFront, dynamics = { finalWetNorth: finalWet.farthestWetNorth > finalWet.farthestWetSouth || finalWet.depthMassNorth > finalWet.depthMassSouth, firstStepNorthExceedsSouth: fluxOnset[8].firstStepNorthExceedsSouth, wetFrontArrival: { north: checkpoints.find((step) => checkpointRows[step].wetFront.farthestWetNorth > 0) ?? null, south: checkpoints.find((step) => checkpointRows[step].wetFront.farthestWetSouth > 0) ?? null } };
  const classification = classify(topo, mouthClass, dynamics);
  const summary = { purpose: "Initial source-routing diagnostic. Terrain generation, source and outlets exactly match deterministic production; production simulation.js remains unchanged.", controls: { deterministicRandom: .3141592653, source: { x: sourceX, y: sourceY }, terrainOnlyBeforeHydraulics: true, noMorphSteps: 250, simulationJsUnchanged: true, terrainComponents: "Not reported: terrain.js exposes only final composed bed; components are not explicitly accessible separately." }, terrainDump: { rectangle: "x=0..96, y=0..96", fields: ["b", "dx", "dy", "r"], cells: terrainDump }, mouth: { outlets: outletRows, centroid: { outletCentroidX: centroidX, outletCentroidY: centroidY, outletCentroidDx: centroidX - sourceX, outletCentroidDy: centroidDy, classification: mouthClass } }, sourceCell: { x: sourceX, y: sourceY, b: b[sourceIndex], neighbors: sourceNeighbors, steepestDescentDirection: sourceDescent?.direction ?? null, steepestDescentDrop: sourceDescent ? -sourceDescent.deltaB : 0 }, localGradients: gradients, cardinalProfiles: cardinalProfiles(N, b), escapeCost: escape, monotonicDownhillReachability: monotonic, steepestDescentBasin: steepest, terrainFavorability: topo, noMorph: { checkpoints: checkpointRows, netFluxSeries: fluxSeries, netFluxOnset: fluxOnset, correlationWithEscapeBarrier: { initialEscapeBarrier: { north: northEscape, south: southEscape }, wetFrontArrival: dynamics.wetFrontArrival, netFluxOnset: Object.fromEntries([8, 12, 16, 24].map((radius) => [radius, { north: fluxOnset[radius].firstNetNorthStep, south: fluxOnset[radius].firstNetSouthStep }])) } }, classification, completedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2)); fs.writeFileSync(path.join(output, "COMPLETE"), `classification: ${classification}\ncompletedAt: ${summary.completedAt}\n`); log(`[complete] ${classification}`); console.log(classification);
}
try { main(); } catch (error) { log(`[failed] ${error.stack || error.message}`); throw error; }
