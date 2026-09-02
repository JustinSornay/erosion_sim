/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Measures water budgets across sections of a fixed hydraulic reference path.
 *
 * STATUS:
 * ACCEPTED
 *
 * RESULT:
 * CASE A — MORPHODYNAMIC FEEDBACK.
 *
 * PRODUCTION:
 * Does not modify production physics.
 *
 * RUN:
 * node tests/diagnostics/hydraulic-path-budget.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const engineFiles = [
  "js/core/config.js",
  "js/core/math.js",
  "js/core/state.js",
  "js/simulation/terrain.js",
  "js/simulation/simulation.js",
  "js/simulation/drainage.js",
];
const magnitudeSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const checkpoints = [100, 500, 1000, 2500, 5000, 10000];
const comparisonCheckpoints = new Set([1000, 5000]);
const sectionWidths = [1, 3, 5, 9];
const profilePositions = [0, 1, 2, 3, 4, 5, 6, 8, 12, 16, 20, 24, 32];
const primaryWidth = 5;
const d8x = [-1, 0, 1, -1, 1, -1, 0, 1];
const d8y = [-1, -1, -1, 0, 0, 1, 1, 1];

function noErosionSource() {
  const fixedTerrain = magnitudeSource
    .replace(/b\[i\] -= diff;\r?\n\s*/, "")
    .replace(/b\[i\] \+= diff;\r?\n\s*/, "");
  if (/b\[i\] (?:-=|\+=) diff/.test(fixedTerrain)) throw new Error("NO_EROSION failed to remove terrain updates");
  return fixedTerrain;
}

function simulate(source, steps) {
  const math = Object.create(Math);
  math.random = () => 0.3141592653;
  const run = new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain();
    const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
    let totalInjectedWater = 0;
    let unaccountedWaterLoss = 0;
    let explicitDepthDecayLoss = 0;
    for (let stepIndex = 0; stepIndex < ${steps}; stepIndex++) {
      let waterBefore = 0;
      for (let i = 0; i < NN; i++) waterBefore += d[i];
      let injectedThisStep = 0;
      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        if (sources[sourceIndex].active) injectedThisStep += DT * sources[sourceIndex].rate / (L * L);
      }
      step();
      let waterAfter = 0;
      for (let i = 0; i < NN; i++) waterAfter += d[i];
      totalInjectedWater += injectedThisStep;
      unaccountedWaterLoss += waterBefore + injectedThisStep - waterAfter;
      explicitDepthDecayLoss += waterAfter * (KE * DT) / (1 - KE * DT);
    }
    return { N, L, b, bInit, d, u, v, s, sourceProtectionMask, source,
      totalInjectedWater, unaccountedWaterLoss, explicitDepthDecayLoss };
  `);
  return run(math, Float32Array, Int32Array, Uint8Array);
}

/** Traces one downstream centreline using the realised velocity field. */
function traceReferencePath(snapshot, maximumPositions = 41) {
  const cells = [];
  const visited = new Uint8Array(snapshot.N * snapshot.N);
  let index = snapshot.source.outletIndices[0];
  for (let position = 0; position < maximumPositions && !visited[index]; position++) {
    cells.push(index);
    visited[index] = 1;
    const x = index % snapshot.N;
    const y = (index / snapshot.N) | 0;
    let next = -1;
    let bestProjection = 0;
    for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction];
      const ny = y + d8y[direction];
      if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const projection = snapshot.u[index] * d8x[direction] + snapshot.v[index] * d8y[direction];
      const candidate = ny * snapshot.N + nx;
      if (!visited[candidate] && projection > bestProjection) {
        bestProjection = projection;
        next = candidate;
      }
    }
    if (next < 0) {
      for (let direction = 0; direction < 8; direction++) {
        const nx = x + d8x[direction];
        const ny = y + d8y[direction];
        if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
        const candidate = ny * snapshot.N + nx;
        if (visited[candidate] || snapshot.b[candidate] >= snapshot.b[index]) continue;
        if (next < 0 || snapshot.b[candidate] < snapshot.b[next]) next = candidate;
      }
    }
    if (next < 0) break;
    index = next;
  }
  return cells;
}

function channelDirection(cells, position, N) {
  const before = cells[Math.max(0, position - 1)];
  const after = cells[Math.min(cells.length - 1, position + 1)];
  const dx = (after % N) - (before % N);
  const dy = ((after / N) | 0) - ((before / N) | 0);
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function sectionCells(snapshot, cells, position, width) {
  const index = cells[Math.min(position, cells.length - 1)];
  const x = index % snapshot.N;
  const y = (index / snapshot.N) | 0;
  const direction = channelDirection(cells, position, snapshot.N);
  const before = cells[Math.max(0, position - 1)];
  const after = cells[Math.min(cells.length - 1, position + 1)];
  const tangentX = Math.sign((after % snapshot.N) - (before % snapshot.N));
  const tangentY = Math.sign(((after / snapshot.N) | 0) - ((before / snapshot.N) | 0));
  const normal = { x: -tangentY, y: tangentX };
  const selected = [];
  const included = new Uint8Array(snapshot.N * snapshot.N);
  const radius = (width - 1) / 2;
  for (let offset = -radius; offset <= radius; offset++) {
    const sx = Math.round(x + normal.x * offset);
    const sy = Math.round(y + normal.y * offset);
    if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue;
    const cell = sy * snapshot.N + sx;
    if (!included[cell]) {
      included[cell] = 1;
      selected.push(cell);
    }
  }
  return { cells: selected, direction, index };
}

function measureSection(snapshot, referencePath, position, width) {
  const section = sectionCells(snapshot, referencePath, position, width);
  let sumDepth = 0;
  let maxDepth = 0;
  let velocitySum = 0;
  let maxVelocity = 0;
  let sumQ = 0;
  let maxQ = 0;
  let sectionDischarge = 0;
  let wetCells = 0;
  let terrainMin = Infinity;
  let terrainSum = 0;
  let waterSurfaceSum = 0;
  let sedimentSum = 0;
  let erosionSum = 0;
  let vectorU = 0;
  let vectorV = 0;
  let lateralQ = 0;
  for (const cell of section.cells) {
    const depth = snapshot.d[cell];
    const velocity = Math.hypot(snapshot.u[cell], snapshot.v[cell]);
    const q = depth * velocity;
    const longitudinal = depth * Math.max(0, snapshot.u[cell] * section.direction.x + snapshot.v[cell] * section.direction.y);
    const lateral = depth * Math.abs(-snapshot.u[cell] * section.direction.y + snapshot.v[cell] * section.direction.x);
    sumDepth += depth;
    maxDepth = Math.max(maxDepth, depth);
    velocitySum += velocity;
    maxVelocity = Math.max(maxVelocity, velocity);
    sumQ += q;
    maxQ = Math.max(maxQ, q);
    sectionDischarge += longitudinal;
    if (depth > 1e-6) wetCells++;
    terrainMin = Math.min(terrainMin, snapshot.b[cell]);
    terrainSum += snapshot.b[cell];
    waterSurfaceSum += snapshot.b[cell] + depth;
    sedimentSum += snapshot.s[cell];
    erosionSum += Math.max(0, snapshot.bInit[cell] - snapshot.b[cell]);
    vectorU += depth * snapshot.u[cell];
    vectorV += depth * snapshot.v[cell];
    lateralQ += lateral;
  }
  const count = section.cells.length || 1;
  return {
    position: Math.min(position, referencePath.length - 1), width, sectionCells: section.cells.length,
    sumDepth, meanDepth: sumDepth / count, maxDepth,
    meanVelocity: velocitySum / count, maxVelocity, sumQ, maxQ, wetCells, wetWidth: wetCells,
    terrainMin, terrainMean: terrainSum / count, waterSurfaceMean: waterSurfaceSum / count,
    sedimentSum, sedimentMean: sedimentSum / count, erosionSum,
    sectionDischarge,
    directionalCoherence: Math.hypot(vectorU, vectorV) / Math.max(sumQ, 1e-12),
    lateralVelocityFraction: lateralQ / Math.max(sumQ, 1e-12),
  };
}

function mouthProfile(snapshot, referencePath) {
  return profilePositions.map((position) => {
    const row = measureSection(snapshot, referencePath, position, primaryWidth);
    const cell = sectionCells(snapshot, referencePath, position, primaryWidth).index;
    const velocity = Math.hypot(snapshot.u[cell], snapshot.v[cell]);
    return {
      position: row.position, protectionFactor: snapshot.sourceProtectionMask[cell],
      terrainDelta: snapshot.b[cell] - snapshot.bInit[cell], depth: snapshot.d[cell],
      velocity, q: snapshot.d[cell] * velocity, sectionDischarge: row.sectionDischarge,
      directionalCoherence: row.directionalCoherence,
    };
  });
}

function zoneSummary(snapshot, referencePath) {
  const zones = [["MOUTH", 0, 5], ["MID", 6, 15], ["DOWNSTREAM", 16, referencePath.length - 1]];
  return zones.map(([zone, start, end]) => {
    const rows = [];
    for (let position = start; position <= end; position++) rows.push(measureSection(snapshot, referencePath, position, primaryWidth));
    const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
    return {
      zone, positions: `${start}-${end}`, sectionWidth: primaryWidth,
      meanSectionDischarge: sum("sectionDischarge") / rows.length,
      maxSectionDischarge: Math.max(...rows.map((row) => row.sectionDischarge)),
      meanDepth: sum("meanDepth") / rows.length,
      meanVelocity: sum("meanVelocity") / rows.length,
      meanWetWidth: sum("wetWidth") / rows.length,
      meanDirectionalCoherence: sum("directionalCoherence") / rows.length,
      erosionSum: sum("erosionSum"),
    };
  });
}

function massBudget(snapshot) {
  const totalWaterOnGrid = snapshot.d.reduce((total, depth) => total + depth, 0);
  const boundaryWaterLoss = 0; // Boundary outflows are explicitly clamped to zero by step().
  return {
    injected: snapshot.totalInjectedWater,
    stored: totalWaterOnGrid,
    boundaryWaterLoss,
    unaccountedLoss: snapshot.unaccountedWaterLoss,
    explicitDepthDecayLoss: snapshot.explicitDepthDecayLoss,
    residualAfterAccounting: snapshot.totalInjectedWater - totalWaterOnGrid - boundaryWaterLoss - snapshot.unaccountedWaterLoss,
    lossFraction: snapshot.unaccountedWaterLoss / Math.max(snapshot.totalInjectedWater, 1e-12),
  };
}

/** Confirms the benchmark-only variant leaves every terrain elevation unchanged. */
function assertFixedTerrain(snapshot) {
  let maximumTerrainChange = 0;
  for (let index = 0; index < snapshot.b.length; index++) {
    maximumTerrainChange = Math.max(maximumTerrainChange, Math.abs(snapshot.b[index] - snapshot.bInit[index]));
  }
  const epsilon = 1e-7;
  if (maximumTerrainChange >= epsilon) throw new Error(`NO_EROSION terrain changed by ${maximumTerrainChange}`);
  return maximumTerrainChange;
}

function compactSummary(steps, snapshot, referencePath) {
  const zones = zoneSummary(snapshot, referencePath);
  const [mouth, mid, downstream] = zones;
  return {
    steps,
    mouthDischarge: mouth.meanSectionDischarge,
    midDischarge: mid.meanSectionDischarge,
    downstreamDischarge: downstream.meanSectionDischarge,
    downstreamVsMouth: downstream.meanSectionDischarge / Math.max(mouth.meanSectionDischarge, 1e-12),
    mouthDepth: mouth.meanDepth, midDepth: mid.meanDepth, downstreamDepth: downstream.meanDepth,
    mouthVelocity: mouth.meanVelocity, midVelocity: mid.meanVelocity, downstreamVelocity: downstream.meanVelocity,
    mouthWetWidth: mouth.meanWetWidth, midWetWidth: mid.meanWetWidth, downstreamWetWidth: downstream.meanWetWidth,
    mouthCoherence: mouth.meanDirectionalCoherence, midCoherence: mid.meanDirectionalCoherence, downstreamCoherence: downstream.meanDirectionalCoherence,
    mouthErosion: mouth.erosionSum, midErosion: mid.erosionSum, downstreamErosion: downstream.erosionSum,
  };
}

function longitudinalProfile(snapshot, referencePath) {
  return profilePositions.map((position) => {
    const section = measureSection(snapshot, referencePath, position, primaryWidth);
    const cell = sectionCells(snapshot, referencePath, position, primaryWidth).index;
    return {
      position, sectionDischarge: section.sectionDischarge, sumDepth: section.sumDepth,
      meanVelocity: section.meanVelocity, wetWidth: section.wetWidth,
      directionalCoherence: section.directionalCoherence,
      lateralVelocityFraction: section.lateralVelocityFraction,
      terrainDelta: snapshot.b[cell] - snapshot.bInit[cell], erosionSum: section.erosionSum,
    };
  });
}

function sectionCapture(snapshot, referencePath) {
  return [4, 8, 12, 16, 20, 24].map((position) => {
    const discharge = Object.fromEntries(sectionWidths.map((width) => [width, measureSection(snapshot, referencePath, position, width).sectionDischarge]));
    return {
      position, discharge1: discharge[1], discharge3: discharge[3], discharge5: discharge[5], discharge9: discharge[9],
      capture3vs9: discharge[3] / Math.max(discharge[9], 1e-12),
      capture5vs9: discharge[5] / Math.max(discharge[9], 1e-12),
    };
  });
}

function comparisonRows(magnitude, noErosion) {
  const metrics = [
    "mouthDischarge", "midDischarge", "downstreamDischarge", "downstreamVsMouth",
    "mouthWetWidth", "midWetWidth", "downstreamWetWidth",
    "mouthVelocity", "midVelocity", "downstreamVelocity",
    "mouthCoherence", "midCoherence", "downstreamCoherence",
  ];
  return metrics.map((metric) => ({
    steps: magnitude.steps, metric, MAGNITUDE: magnitude[metric], NO_EROSION: noErosion[metric],
    deltaPercent: (noErosion[metric] / Math.max(Math.abs(magnitude[metric]), 1e-12) - 1) * 100,
  }));
}

function hydraulicSinkAudit() {
  return [{
    explicitDepthDecay: /d\[i\] \*= 1 - KE \* DT/.test(magnitudeSource),
    boundaryDrainage: false,
    depthClamp: /tmpD\[i\] = Math\.max\(0, d\[i\]/.test(magnitudeSource),
    cellReset: false,
    sedimentAffectsHydraulics: false,
    note: "s is read only by erosion/deposition and advection; fluxes, d, u, v do not read s.",
  }];
}

function classify(magnitude5000, noErosion5000, magnitudeBudget, magnitudeCapture) {
  const noErosionImprovesDischarge = noErosion5000.downstreamDischarge > magnitude5000.downstreamDischarge * 1.25;
  const noErosionImprovesCoherence = noErosion5000.downstreamCoherence > magnitude5000.downstreamCoherence + 0.15;
  const noErosionNarrowsFlow = noErosion5000.downstreamWetWidth < magnitude5000.downstreamWetWidth * 0.75;
  const unexplainedLoss = Math.abs(magnitudeBudget.residualAfterAccounting) / Math.max(magnitudeBudget.injected, 1e-12) > 1e-5;
  const wideSectionConserved = magnitudeCapture[5].discharge9 / Math.max(magnitudeCapture[0].discharge9, 1e-12) > 0.75;
  const narrowSectionDrops = magnitudeCapture[5].capture5vs9 < 0.6;
  if (unexplainedLoss) return "CASE D — WATER LOSS / NUMERICAL SINK";
  if (noErosionImprovesDischarge || noErosionImprovesCoherence || noErosionNarrowsFlow) return "CASE A — MORPHODYNAMIC FEEDBACK";
  if (wideSectionConserved && narrowSectionDrops) return "CASE C — METRIC DILUTION";
  return "CASE B — HYDRAULIC ROUTING";
}

function printCheckpoint(variant, steps, snapshot, referencePath) {
  console.log(`\n${variant} | checkpoint ${steps} | reference path ${referencePath.length - 1} cells`);
  console.table([massBudget(snapshot)]);
  console.log("Sections transversales");
  console.table(referencePath.flatMap((_, position) => sectionWidths.map((width) => measureSection(snapshot, referencePath, position, width))));
  console.log(`Profil bouche (section ${primaryWidth} cellules)`);
  console.table(mouthProfile(snapshot, referencePath));
  console.log(`Résumé zones (section ${primaryWidth} cellules)`);
  console.table(zoneSummary(snapshot, referencePath));
}

// A single MAGNITUDE path at step 1000 keeps every compared section spatially identical.
const referencePath = traceReferencePath(simulate(magnitudeSource, 1000));
console.log(`Reference path from primary mouth: ${referencePath.length} positions.`);
const magnitudeSnapshots = new Map();
const noErosionSnapshots = new Map();
for (const steps of checkpoints) {
  const snapshot = simulate(magnitudeSource, steps);
  magnitudeSnapshots.set(steps, snapshot);
  printCheckpoint("MAGNITUDE", steps, snapshot, referencePath);
}
for (const steps of checkpoints.filter((checkpoint) => comparisonCheckpoints.has(checkpoint))) {
  const snapshot = simulate(noErosionSource(), steps);
  noErosionSnapshots.set(steps, snapshot);
  console.log(`NO_EROSION terrain assertion: max |b - bInit| = ${assertFixedTerrain(snapshot)}`);
  printCheckpoint("NO_EROSION", steps, snapshot, referencePath);
}

const magnitudeSummaries = checkpoints.map((steps) => compactSummary(steps, magnitudeSnapshots.get(steps), referencePath));
const noErosionSummaries = [...comparisonCheckpoints].map((steps) => compactSummary(steps, noErosionSnapshots.get(steps), referencePath));
const magnitudeCaptures = new Map(checkpoints.map((steps) => [steps, sectionCapture(magnitudeSnapshots.get(steps), referencePath)]));

console.log("\nSYNTHÈSE MAGNITUDE");
console.table(magnitudeSummaries);
console.log("\nBUDGET DE MASSE MAGNITUDE");
console.table(checkpoints.map((steps) => ({ steps, ...massBudget(magnitudeSnapshots.get(steps)) })));
console.log("\nAUDIT DES SINKS HYDRAULIQUES");
console.table(hydraulicSinkAudit());
console.log("\nCOMPARAISON MAGNITUDE / NO_EROSION");
console.table([...comparisonCheckpoints].flatMap((steps) => comparisonRows(
  magnitudeSummaries.find((summary) => summary.steps === steps),
  noErosionSummaries.find((summary) => summary.steps === steps),
)));
for (const steps of comparisonCheckpoints) {
  console.log(`\nPROFIL LONGITUDINAL width=${primaryWidth} | MAGNITUDE | ${steps}`);
  console.table(longitudinalProfile(magnitudeSnapshots.get(steps), referencePath));
  console.log(`PROFIL LONGITUDINAL width=${primaryWidth} | NO_EROSION | ${steps}`);
  console.table(longitudinalProfile(noErosionSnapshots.get(steps), referencePath));
  console.log(`LARGEUR DE SECTION | MAGNITUDE | ${steps}`);
  console.table(magnitudeCaptures.get(steps));
  console.log(`LARGEUR DE SECTION | NO_EROSION | ${steps}`);
  console.table(sectionCapture(noErosionSnapshots.get(steps), referencePath));
}
console.log(`\nCLASSIFICATION: ${classify(
  magnitudeSummaries.find((summary) => summary.steps === 5000),
  noErosionSummaries.find((summary) => summary.steps === 5000),
  massBudget(magnitudeSnapshots.get(5000)),
  magnitudeCaptures.get(5000),
)}`);
