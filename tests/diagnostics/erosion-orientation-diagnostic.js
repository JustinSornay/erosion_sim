/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE:
 * Separates longitudinal incision from lateral widening along realised flow paths.
 *
 * STATUS:
 * REJECTED
 *
 * RESULT:
 * CASE A2 — NOT EXPLAINED BY LATERAL WIDENING.
 *
 * PRODUCTION:
 * Does not modify production physics.
 *
 * RUN:
 * node tests/diagnostics/erosion-orientation-diagnostic.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const checkpoints = [500, 1000, 2500, 5000, 10000];
const controlCheckpoints = [1000, 5000];
const profilePositions = [2, 4, 6, 8, 12, 16, 20, 24];
const erosionThresholds = [0.001, 0.005, 0.01, 0.05];
const d8x = [-1, 0, 1, -1, 1, -1, 0, 1];
const d8y = [-1, -1, -1, 0, 0, 1, 1, 1];

function centerlineBiasedSource() {
  const replacement = `const rawAlignment = Math.max(0, -(dzx * ui + dzy * vi) / Math.max(slope * vel, 1e-9));
        const erosionFactor = 0.5 + 0.5 * rawAlignment;
        const diff = KS * (C - si) * sourceProtectionMask[i] * erosionFactor;
        b[i] -= diff;
        s[i] = si + diff;`;
  const variant = currentSource.replace(
    /const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/,
    replacement,
  );
  if (variant === currentSource) throw new Error("CENTERLINE_BIASED injection failed");
  return variant;
}

function simulate(source, steps) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  const run = new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain();
    const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
    for (let stepIndex = 0; stepIndex < ${steps}; stepIndex++) step();
    return { N, b, bInit, d, u, v, source };
  `);
  return run(math, Float32Array, Int32Array, Uint8Array);
}

function traceReferencePath(snapshot, maximumPositions = 41) {
  const cells = []; const visited = new Uint8Array(snapshot.N * snapshot.N); let index = snapshot.source.outletIndices[0];
  for (let position = 0; position < maximumPositions && !visited[index]; position++) {
    cells.push(index); visited[index] = 1;
    const x = index % snapshot.N; const y = (index / snapshot.N) | 0;
    let next = -1; let bestProjection = 0;
    for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction]; const ny = y + d8y[direction];
      if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx;
      const projection = snapshot.u[index] * d8x[direction] + snapshot.v[index] * d8y[direction];
      if (!visited[candidate] && projection > bestProjection) { bestProjection = projection; next = candidate; }
    }
    if (next < 0) for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction]; const ny = y + d8y[direction];
      if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx;
      if (!visited[candidate] && snapshot.b[candidate] < snapshot.b[index] && (next < 0 || snapshot.b[candidate] < snapshot.b[next])) next = candidate;
    }
    if (next < 0) break;
    index = next;
  }
  return cells;
}

function pathFrame(referencePath, position, N) {
  const cell = referencePath[position]; const before = referencePath[Math.max(0, position - 1)]; const after = referencePath[Math.min(referencePath.length - 1, position + 1)];
  const dx = (after % N) - (before % N); const dy = ((after / N) | 0) - ((before / N) | 0); const length = Math.hypot(dx, dy) || 1;
  return { cell, x: cell % N, y: (cell / N) | 0, channelX: dx / length, channelY: dy / length, normalX: -Math.sign(dy), normalY: Math.sign(dx) };
}

function slopeMetrics(snapshot, index) {
  const x = index % snapshot.N; const y = (index / snapshot.N) | 0;
  const left = x > 0 ? snapshot.b[index - 1] : snapshot.b[index]; const right = x < snapshot.N - 1 ? snapshot.b[index + 1] : snapshot.b[index];
  const top = y > 0 ? snapshot.b[index - snapshot.N] : snapshot.b[index]; const bottom = y < snapshot.N - 1 ? snapshot.b[index + snapshot.N] : snapshot.b[index];
  const dzx = (right - left) * 0.5; const dzy = (bottom - top) * 0.5; const slopeMagnitude = Math.hypot(dzx, dzy);
  const velocity = Math.hypot(snapshot.u[index], snapshot.v[index]);
  if (velocity <= 1e-12) return { longitudinalSlope: 0, lateralSlope: 0, alignment: 0 };
  const directionX = snapshot.u[index] / velocity; const directionY = snapshot.v[index] / velocity;
  const longitudinalSlope = Math.abs(dzx * directionX + dzy * directionY);
  const lateralSlope = Math.abs(dzx * directionY - dzy * directionX);
  return { longitudinalSlope, lateralSlope, alignment: longitudinalSlope / Math.max(slopeMagnitude, 1e-12) };
}

function positionMetrics(snapshot, referencePath, position) {
  const frame = pathFrame(referencePath, position, snapshot.N);
  const erosion = { center: 0, inner: 0, outer: 0 }; const erodedWidth = Object.fromEntries(erosionThresholds.map((threshold) => [threshold, 0]));
  let wetWidth = 0; let sectionDischarge = 0; let sumQ = 0; let vectorU = 0; let vectorV = 0;
  let alignmentTotal = 0; let longitudinalTotal = 0; let lateralTotal = 0; let wetCells = 0;
  for (let offset = -4; offset <= 4; offset++) {
    const x = frame.x + frame.normalX * offset; const y = frame.y + frame.normalY * offset;
    if (x < 0 || y < 0 || x >= snapshot.N || y >= snapshot.N) continue;
    const index = y * snapshot.N + x; const depth = snapshot.d[index]; const velocity = Math.hypot(snapshot.u[index], snapshot.v[index]); const cellErosion = Math.max(0, snapshot.bInit[index] - snapshot.b[index]);
    const group = offset === 0 ? "center" : Math.abs(offset) === 1 ? "inner" : "outer";
    erosion[group] += cellErosion;
    for (const threshold of erosionThresholds) if (cellErosion > threshold) erodedWidth[threshold]++;
    if (depth > 1e-6) {
      wetWidth++; wetCells++;
      const slopes = slopeMetrics(snapshot, index); alignmentTotal += slopes.alignment; longitudinalTotal += slopes.longitudinalSlope; lateralTotal += slopes.lateralSlope;
    }
    const q = depth * velocity;
    sectionDischarge += depth * Math.max(0, snapshot.u[index] * frame.channelX + snapshot.v[index] * frame.channelY);
    sumQ += q; vectorU += depth * snapshot.u[index]; vectorV += depth * snapshot.v[index];
  }
  const lateralErosion = erosion.inner + erosion.outer;
  return {
    position, centerErosion: erosion.center, innerErosion: erosion.inner, outerErosion: erosion.outer,
    lateralErosion, lateralToCenterRatio: lateralErosion / Math.max(erosion.center, 1e-12), wetWidth,
    erodedWidth001: erodedWidth[0.001], erodedWidth005: erodedWidth[0.005], erodedWidth01: erodedWidth[0.01], erodedWidth05: erodedWidth[0.05],
    sectionDischarge, directionalCoherence: Math.hypot(vectorU, vectorV) / Math.max(sumQ, 1e-12),
    meanAlignment: alignmentTotal / Math.max(wetCells, 1), meanLongitudinalSlope: longitudinalTotal / Math.max(wetCells, 1), meanLateralSlope: lateralTotal / Math.max(wetCells, 1),
  };
}

function zoneSummary(rows, zone, start, end) {
  const selected = rows.filter(({ position }) => position >= start && position <= end); const sum = (key) => selected.reduce((total, row) => total + row[key], 0);
  const mean = (key) => sum(key) / selected.length; const centerErosion = sum("centerErosion"); const lateralErosion = sum("lateralErosion");
  return { zone, centerErosion, innerErosion: sum("innerErosion"), outerErosion: sum("outerErosion"),
    centerShare: centerErosion / Math.max(centerErosion + lateralErosion, 1e-12), lateralShare: lateralErosion / Math.max(centerErosion + lateralErosion, 1e-12),
    meanAlignment: mean("meanAlignment"), meanLongitudinalSlope: mean("meanLongitudinalSlope"), meanLateralSlope: mean("meanLateralSlope"),
    wetWidth: mean("wetWidth"), erodedWidth: mean("erodedWidth01"), meanSectionDischarge: mean("sectionDischarge"), meanDirectionalCoherence: mean("directionalCoherence") };
}

function analysis(snapshot, referencePath) {
  const rows = referencePath.map((_, position) => positionMetrics(snapshot, referencePath, position));
  const zones = [zoneSummary(rows, "MOUTH", 0, 5), zoneSummary(rows, "MID", 6, 15), zoneSummary(rows, "DOWNSTREAM", 16, referencePath.length - 1)];
  const centerErosion = zones.reduce((sum, zone) => sum + zone.centerErosion, 0); const lateralErosion = zones.reduce((sum, zone) => sum + zone.innerErosion + zone.outerErosion, 0);
  return { rows, zones, global: { centerErosion, lateralErosion, lateralToCenterRatio: lateralErosion / Math.max(centerErosion, 1e-12),
    wetWidth: rows.reduce((sum, row) => sum + row.wetWidth, 0) / rows.length, erodedWidth: rows.reduce((sum, row) => sum + row.erodedWidth01, 0) / rows.length,
    downstreamDischarge: zones[2].meanSectionDischarge, downstreamCoherence: zones[2].meanDirectionalCoherence } };
}

function temporalRows(results) {
  let previous; return checkpoints.map((steps) => {
    const global = results.get(steps).global;
    const row = { steps, lateralErosion: global.lateralErosion, wetWidth: global.wetWidth, downstreamDischarge: global.downstreamDischarge,
      deltaLateralErosion: previous ? global.lateralErosion - previous.lateralErosion : 0,
      deltaWetWidth: previous ? global.wetWidth - previous.wetWidth : 0,
      deltaDownstreamDischarge: previous ? global.downstreamDischarge - previous.downstreamDischarge : 0 };
    previous = global; return row;
  });
}

const referencePath = traceReferencePath(simulate(currentSource, 1000));
const currentResults = new Map(checkpoints.map((steps) => [steps, analysis(simulate(currentSource, steps), referencePath)]));
const biasedResults = new Map(controlCheckpoints.map((steps) => [steps, analysis(simulate(centerlineBiasedSource(), steps), referencePath)]));
console.log(`Reference flow path: ${referencePath.length} positions.`);
for (const steps of checkpoints) {
  const result = currentResults.get(steps);
  console.log(`\nCURRENT ORIENTATION | ${steps}`); console.table(result.rows.filter(({ position }) => profilePositions.includes(position)));
  console.log("Orientation budgets"); console.table(result.zones);
}
console.log("\nTEMPORAL CORRELATION | CURRENT"); console.table(temporalRows(currentResults));
console.log("\nCENTERLINE_BIASED CONTROL");
console.table(controlCheckpoints.map((steps) => {
  const current = currentResults.get(steps).global; const biased = biasedResults.get(steps).global;
  return { steps, currentLateralToCenterRatio: current.lateralToCenterRatio, biasedLateralToCenterRatio: biased.lateralToCenterRatio,
    currentErodedWidth: current.erodedWidth, biasedErodedWidth: biased.erodedWidth, currentWetWidth: current.wetWidth, biasedWetWidth: biased.wetWidth,
    currentDownstreamDischarge: current.downstreamDischarge, biasedDownstreamDischarge: biased.downstreamDischarge,
    currentDownstreamCoherence: current.downstreamCoherence, biasedDownstreamCoherence: biased.downstreamCoherence,
    currentCenterErosion: current.centerErosion, biasedCenterErosion: biased.centerErosion };
}));
const current5000 = currentResults.get(5000).global; const biased5000 = biasedResults.get(5000).global;
const lateralSignal = biased5000.lateralToCenterRatio < current5000.lateralToCenterRatio
  && biased5000.erodedWidth <= current5000.erodedWidth && biased5000.wetWidth <= current5000.wetWidth
  && (biased5000.downstreamDischarge > current5000.downstreamDischarge || biased5000.downstreamCoherence > current5000.downstreamCoherence)
  && biased5000.centerErosion >= current5000.centerErosion * 0.8;
console.log(`\nCONCLUSION: ${lateralSignal ? "CASE A1 — LATERAL WIDENING FEEDBACK" : "CASE A2 — NOT EXPLAINED BY LATERAL WIDENING"}`);
