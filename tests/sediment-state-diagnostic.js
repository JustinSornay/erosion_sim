/**
 * Audits sediment-state semantics and tests a mass-target concentration
 * interpretation in isolated benchmark source. Usage: node tests/sediment-state-diagnostic.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const checkpoints = [100, 500, 1000, 2500, 5000, 10000];
const concentrationCheckpoints = [1000, 5000, 10000];
const concentrationCoefficients = [0.01, 0.025, 0.05, 0.1, 0.2, 0.4, 0.8];
const d8x = [-1, 0, 1, -1, 1, -1, 0, 1];
const d8y = [-1, -1, -1, 0, 0, 1, 1, 1];

function concentrationSource(coefficient) {
  const replacement = `const Cc = ${coefficient} * sinA * vel * dNorm;
      const targetSedimentMass = Cc * d[i];
      const si = s[i];
      if (targetSedimentMass > si) {
        const diff = KS * (targetSedimentMass - si) * sourceProtectionMask[i];
        b[i] -= diff;
        s[i] = si + diff;
      } else {
        const diff = KD * (si - targetSedimentMass);
        b[i] += diff;
        s[i] = Math.max(0, si - diff);
      }`;
  const variant = currentSource.replace(
    /const C = KC \* sinA \* vel \* dNorm;\r?\n\s*const si = s\[i\];\r?\n\s*if \(C > si\) \{\r?\n\s*const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;\r?\n\s*\} else \{\r?\n\s*const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);\r?\n\s*\}/,
    replacement,
  );
  if (variant === currentSource) throw new Error("Concentration benchmark injection failed");
  return variant;
}

function noBedExchangeSource() {
  const variant = currentSource.replace(
    /const C = KC \* sinA \* vel \* dNorm;\r?\n\s*const si = s\[i\];\r?\n\s*if \(C > si\) \{\r?\n\s*const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;\r?\n\s*\} else \{\r?\n\s*const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);\r?\n\s*\}/,
    "const si = s[i]; s[i] = si;",
  );
  if (variant === currentSource) throw new Error("Advection-only benchmark injection failed");
  return variant;
}

function simulate(source, steps) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  const run = new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain();
    const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
    for (let stepIndex = 0; stepIndex < ${steps}; stepIndex++) step();
    return { N, b, bInit, d, s, u, v, source };
  `);
  return run(math, Float32Array, Int32Array, Uint8Array);
}

function traceReferencePath(snapshot, maximumPositions = 41) {
  const cells = []; const visited = new Uint8Array(snapshot.N * snapshot.N); let index = snapshot.source.outletIndices[0];
  for (let position = 0; position < maximumPositions && !visited[index]; position++) {
    cells.push(index); visited[index] = 1;
    const x = index % snapshot.N; const y = (index / snapshot.N) | 0; let next = -1; let bestProjection = 0;
    for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction]; const ny = y + d8y[direction]; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx; const projection = snapshot.u[index] * d8x[direction] + snapshot.v[index] * d8y[direction];
      if (!visited[candidate] && projection > bestProjection) { bestProjection = projection; next = candidate; }
    }
    if (next < 0) for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction]; const ny = y + d8y[direction]; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx;
      if (!visited[candidate] && snapshot.b[candidate] < snapshot.b[index] && (next < 0 || snapshot.b[candidate] < snapshot.b[next])) next = candidate;
    }
    if (next < 0) break;
    index = next;
  }
  return cells;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function capacity(snapshot, index) {
  const x = index % snapshot.N; const y = (index / snapshot.N) | 0;
  const left = x > 0 ? snapshot.b[index - 1] : snapshot.b[index]; const right = x < snapshot.N - 1 ? snapshot.b[index + 1] : snapshot.b[index];
  const top = y > 0 ? snapshot.b[index - snapshot.N] : snapshot.b[index]; const bottom = y < snapshot.N - 1 ? snapshot.b[index + snapshot.N] : snapshot.b[index];
  const slope = Math.hypot((right - left) * 0.5, (bottom - top) * 0.5); const velocity = Math.hypot(snapshot.u[index], snapshot.v[index]);
  return 0.055 * (slope / Math.sqrt(1 + slope * slope)) * velocity * Math.min(1, snapshot.d[index] * 4);
}

function zoneCells(snapshot, referencePath, start, end) {
  const included = new Uint8Array(snapshot.N * snapshot.N); const cells = [];
  for (let position = start; position <= end; position++) {
    const cell = referencePath[position]; const before = referencePath[Math.max(0, position - 1)]; const after = referencePath[Math.min(referencePath.length - 1, position + 1)];
    const dx = Math.sign((after % snapshot.N) - (before % snapshot.N)); const dy = Math.sign(((after / snapshot.N) | 0) - ((before / snapshot.N) | 0));
    const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0;
    for (let offset = -2; offset <= 2; offset++) {
      const sx = x - dy * offset; const sy = y + dx * offset;
      if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue;
      const index = sy * snapshot.N + sx; if (!included[index]) { included[index] = 1; cells.push(index); }
    }
  }
  return cells;
}

function sedimentBudget(snapshot) {
  let totalSediment = 0; let totalBedLoss = 0; let totalBedGain = 0; let netBedChange = 0;
  for (let index = 0; index < snapshot.b.length; index++) {
    const delta = snapshot.bInit[index] - snapshot.b[index]; totalSediment += snapshot.s[index]; netBedChange += delta;
    totalBedLoss += Math.max(0, delta); totalBedGain += Math.max(0, -delta);
  }
  return { totalSediment, totalBedLoss, totalBedGain, netBedChange, sedimentResidual: netBedChange - totalSediment };
}

function concentrationZone(snapshot, referencePath, zone, start, end) {
  const values = []; let depthTotal = 0; let sedimentTotal = 0; let velocityTotal = 0; let dischargeTotal = 0; let erosionRateProxy = 0; let depositionRateProxy = 0;
  for (const index of zoneCells(snapshot, referencePath, start, end)) {
    const depth = snapshot.d[index]; const sediment = snapshot.s[index]; const velocity = Math.hypot(snapshot.u[index], snapshot.v[index]); const C = capacity(snapshot, index);
    depthTotal += depth; sedimentTotal += sediment; velocityTotal += velocity; dischargeTotal += depth * velocity;
    erosionRateProxy += Math.max(0, C - sediment); depositionRateProxy += Math.max(0, sediment - C);
    if (depth > 1e-5) values.push({ concentration: sediment / depth, saturation: sediment / Math.max(C, 1e-12), concentrationPerCapacity: (sediment / depth) / Math.max(C, 1e-12), C });
  }
  const count = zoneCells(snapshot, referencePath, start, end).length || 1;
  return { zone, meanDepth: depthTotal / count, meanSediment: sedimentTotal / count, meanConcentration: values.reduce((sum, value) => sum + value.concentration, 0) / Math.max(values.length, 1),
    p25Concentration: percentile(values.map(({ concentration }) => concentration), 0.25), medianConcentration: percentile(values.map(({ concentration }) => concentration), 0.5), p75Concentration: percentile(values.map(({ concentration }) => concentration), 0.75), p95Concentration: percentile(values.map(({ concentration }) => concentration), 0.95),
    currentCapacity: values.reduce((sum, value) => sum + value.C, 0) / Math.max(values.length, 1), p25SC: percentile(values.map(({ saturation }) => saturation), 0.25), medianSC: percentile(values.map(({ saturation }) => saturation), 0.5), p75SC: percentile(values.map(({ saturation }) => saturation), 0.75),
    concentrationPerCapacity: values.reduce((sum, value) => sum + value.concentrationPerCapacity, 0) / Math.max(values.length, 1), erosionRateProxy, depositionRateProxy, meanVelocity: velocityTotal / count, sectionDischarge: dischargeTotal / count };
}

function advectionConservation(steps) {
  const source = noBedExchangeSource(); const math = Object.create(Math); math.random = () => 0.3141592653;
  const run = new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain(); sources.length = 0; b.fill(0); d.fill(0.05); s.fill(0);
    for (let y = 94; y <= 96; y++) for (let x = 94; x <= 96; x++) s[y * N + x] = 1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[y * N + x] = -x * 0.01;
    let before = 0; for (let index = 0; index < NN; index++) before += s[index];
    for (let stepIndex = 0; stepIndex < ${steps}; stepIndex++) step();
    let after = 0; for (let index = 0; index < NN; index++) after += s[index];
    return { before, after };
  `);
  const result = run(math, Float32Array, Int32Array, Uint8Array);
  return { steps, totalBefore: result.before, totalAfter: result.after, retainedFraction: result.after / result.before };
}

function dilutionExperiment() {
  const slope = 0.2; const velocity = 2; const sediment = 0.01; const depthA = 0.05; const depthB = 0.2;
  const currentC = (depth) => 0.055 * (slope / Math.sqrt(1 + slope * slope)) * velocity * Math.min(1, depth * 4);
  return [depthA, depthB].map((depth, index) => ({ scenario: index === 0 ? "A: depth d" : "B: depth 4d", depth, sediment, concentration: sediment / depth, currentCapacity: currentC(depth), currentDecision: currentC(depth) > sediment ? "ERODE" : "DEPOSIT" }));
}

function mixingExperiment() {
  const depthA = 0.05; const sedimentA = 0.01; const depthB = 0.2; const sedimentB = 0.01;
  const cMix = (sedimentA + sedimentB) / (depthA + depthB);
  const bilerpSediment = (sedimentA + sedimentB) * 0.5;
  return [{ depthA, sedimentA, concentrationA: sedimentA / depthA, depthB, sedimentB, concentrationB: sedimentB / depthB, physicalMixedConcentration: cMix, bilerpSediment, bilerpInterpretedConcentrationAtMixedDepth: bilerpSediment / ((depthA + depthB) * 0.5) }];
}

function hydraulicZone(snapshot, referencePath, start, end) {
  let dischargeTotal = 0; let coherenceTotal = 0; let erosion = 0; let positions = 0;
  for (let position = start; position <= end; position++) {
    const cell = referencePath[position]; const before = referencePath[Math.max(0, position - 1)]; const after = referencePath[Math.min(referencePath.length - 1, position + 1)];
    const dx = (after % snapshot.N) - (before % snapshot.N); const dy = ((after / snapshot.N) | 0) - ((before / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1;
    const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; const normalX = -Math.sign(dy); const normalY = Math.sign(dx);
    let discharge = 0; let sumQ = 0; let vectorU = 0; let vectorV = 0;
    for (let offset = -2; offset <= 2; offset++) {
      const sx = x + normalX * offset; const sy = y + normalY * offset; if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue;
      const index = sy * snapshot.N + sx; const depth = snapshot.d[index]; const velocity = Math.hypot(snapshot.u[index], snapshot.v[index]);
      discharge += depth * Math.max(0, snapshot.u[index] * dx / length + snapshot.v[index] * dy / length);
      sumQ += depth * velocity; vectorU += depth * snapshot.u[index]; vectorV += depth * snapshot.v[index];
    }
    dischargeTotal += discharge; coherenceTotal += Math.hypot(vectorU, vectorV) / Math.max(sumQ, 1e-12); erosion += Math.max(0, snapshot.bInit[cell] - snapshot.b[cell]); positions++;
  }
  return { erosion, discharge: dischargeTotal / positions, coherence: coherenceTotal / positions };
}

function concentrationMetrics(snapshot, referencePath) {
  const zones = [["MOUTH", 0, 5], ["MID", 6, 15], ["DOWNSTREAM", 16, referencePath.length - 1]].map(([zone, start, end]) => concentrationZone(snapshot, referencePath, zone, start, end));
  const hydraulicZones = [[0, 5], [6, 15], [16, referencePath.length - 1]].map(([start, end]) => hydraulicZone(snapshot, referencePath, start, end));
  const budget = sedimentBudget(snapshot); const totalErosion = budget.totalBedLoss; const totalPathErosion = hydraulicZones.reduce((sum, zone) => sum + zone.erosion, 0);
  return { budget, zones, totalErosion, nearShare: hydraulicZones[0].erosion / Math.max(totalPathErosion, 1e-12), downstreamErosion: hydraulicZones[2].erosion, downstreamDischarge: hydraulicZones[2].discharge, downstreamCoherence: hydraulicZones[2].coherence };
}

const referencePath = traceReferencePath(simulate(currentSource, 1000));
console.log("SEDIMENT STATE AUDIT");
console.table([
  { operation: "initialisation", code: "s = new Float32Array(NN)", semantic: "zero scalar per cell" },
  { operation: "erosion", code: "b -= diff; s += diff", semantic: "bed loss transferred to s before advection" },
  { operation: "deposition", code: "b += diff; s = max(0, s-diff)", semantic: "s transferred back to bed" },
  { operation: "advection", code: "tmpS = bilerp(s upstream)", semantic: "scalar interpolation, not flux-form mass transport" },
  { operation: "boundaries/clamps", code: "sample coordinates clamp; s has no outflow or decay", semantic: "boundary sampling retained; lower clamp only during deposition" },
]);
console.log("ADVECTION CONSERVATION"); console.table([0, 1, 10, 100, 1000].map(advectionConservation));
console.log("DILUTION EXPERIMENT"); console.table(dilutionExperiment());
console.log("MIXING EXPERIMENT"); console.table(mixingExperiment());
const currentSnapshots = new Map(checkpoints.map((steps) => [steps, simulate(currentSource, steps)]));
console.log("SEDIMENT / BED BUDGET"); console.table(checkpoints.map((steps) => ({ steps, ...sedimentBudget(currentSnapshots.get(steps)) })));
for (const steps of checkpoints) { console.log(`CONCENTRATION DIAGNOSTIC | ${steps}`); console.table([["MOUTH", 0, 5], ["MID", 6, 15], ["DOWNSTREAM", 16, referencePath.length - 1]].map(([zone, start, end]) => concentrationZone(currentSnapshots.get(steps), referencePath, zone, start, end))); }
const currentByCheckpoint = new Map(concentrationCheckpoints.map((steps) => [steps, concentrationMetrics(currentSnapshots.get(steps), referencePath)]));
const concentrationResults = [];
for (const coefficient of concentrationCoefficients) for (const steps of concentrationCheckpoints) {
  const metrics = concentrationMetrics(simulate(concentrationSource(coefficient), steps), referencePath);
  concentrationResults.push({ coefficient, steps, ...metrics });
}
function isCandidate(result, current) {
  return result.totalErosion >= current.totalErosion * 0.85 && result.totalErosion <= current.totalErosion * 1.15
    && result.nearShare < current.nearShare && result.downstreamErosion >= current.downstreamErosion * 0.9
    && result.downstreamDischarge > current.downstreamDischarge && result.downstreamCoherence >= current.downstreamCoherence
    && Math.abs(result.budget.sedimentResidual) < Math.abs(current.budget.sedimentResidual) * 2 + 1e-6;
}
console.log("CONCENTRATION MODEL GRID");
console.table(concentrationResults.map(({ coefficient, steps, budget, totalErosion, nearShare, downstreamErosion, downstreamDischarge }) => {
  const current = currentByCheckpoint.get(steps);
  const result = concentrationResults.find((entry) => entry.coefficient === coefficient && entry.steps === steps);
  const candidate = steps >= 5000 && isCandidate(result, current);
  return { coefficient, steps, totalErosion, erosionPercentCurrent: totalErosion / Math.max(current.totalErosion, 1e-12) * 100, nearShare, downstreamErosion, downstreamDischarge, downstreamCoherence: result.downstreamCoherence, sedimentResidual: budget.sedimentResidual, candidate };
}));
const candidates = concentrationCoefficients.filter((coefficient) => concentrationCheckpoints.slice(1).every((steps) => isCandidate(concentrationResults.find((result) => result.coefficient === coefficient && result.steps === steps), currentByCheckpoint.get(steps))));
if (candidates.length > 0) {
  const current20000 = concentrationMetrics(simulate(currentSource, 20000), referencePath);
  console.log("CONCENTRATION MODEL CANDIDATES | 20000");
  console.table(candidates.map((coefficient) => {
    const result = concentrationMetrics(simulate(concentrationSource(coefficient), 20000), referencePath);
    return { coefficient, totalErosion: result.totalErosion, erosionPercentCurrent: result.totalErosion / Math.max(current20000.totalErosion, 1e-12) * 100,
      nearShare: result.nearShare, downstreamErosion: result.downstreamErosion, downstreamDischarge: result.downstreamDischarge,
      downstreamCoherence: result.downstreamCoherence, sedimentResidual: result.budget.sedimentResidual };
  }));
}
console.log(`SEDIMENT MODEL CONCLUSION: SEDIMENT MODEL C — s is non-conservative / dimensionally inconsistent`);
console.log(`CONCENTRATION MODEL CONCLUSION: ${candidates.length ? "CONCENTRATION MODEL PROMISING" : "CONCENTRATION MODEL REJECTED"}`);
