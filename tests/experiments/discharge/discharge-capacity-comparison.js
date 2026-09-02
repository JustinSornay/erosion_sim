/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Compares historical velocity capacity with local-discharge capacity.
 *
 * STATUS:
 * REJECTED
 *
 * RESULT:
 * Simple C proportional to q does not provide a durable solution.
 *
 * PRODUCTION:
 * Does not modify production physics.
 *
 * RUN:
 * node tests/experiments/discharge/discharge-capacity-comparison.js [checkpoints]
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const magnitudeSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const coefficients = [0.05, 0.1, 0.2, 0.4, 0.8, 1.2];
const d8x = [-1, 0, 1, -1, 1, -1, 0, 1];
const d8y = [-1, -1, -1, 0, 0, 1, 1, 1];
const checkpoints = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (checkpoints.length === 0) checkpoints.push(1000, 5000, 10000);

function dischargeSource(coefficient) {
  return magnitudeSource.replace(
    "const C = KC * sinA * vel * dNorm;",
    `const C = ${coefficient} * sinA * d[i] * vel;`,
  );
}

function simulate(source, steps) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  const run = new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain(); const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask(); for (let i = 0; i < ${steps}; i++) step(); return { N, KC, b, bInit, d, u, v, s, source };`);
  return run(math, Float32Array, Int32Array, Uint8Array);
}

function referenceFlowPath(snapshot, maxPositions = 41) {
  const cells = []; const visited = new Uint8Array(snapshot.N * snapshot.N);
  let index = snapshot.source.outletIndices[0];
  for (let position = 0; position < maxPositions && !visited[index]; position++) {
    cells.push(index); visited[index] = 1;
    const x = index % snapshot.N; const y = (index / snapshot.N) | 0;
    let next = -1; let alignment = 0;
    for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction]; const ny = y + d8y[direction];
      if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const value = snapshot.u[index] * d8x[direction] + snapshot.v[index] * d8y[direction];
      if (value > alignment) { alignment = value; next = ny * snapshot.N + nx; }
    }
    if (next < 0) break;
    index = next;
  }
  return cells;
}

function capacity(snapshot, index, coefficient) {
  const x = index % snapshot.N; const y = (index / snapshot.N) | 0;
  const left = x > 0 ? snapshot.b[index - 1] : snapshot.b[index];
  const right = x < snapshot.N - 1 ? snapshot.b[index + 1] : snapshot.b[index];
  const top = y > 0 ? snapshot.b[index - snapshot.N] : snapshot.b[index];
  const bottom = y < snapshot.N - 1 ? snapshot.b[index + snapshot.N] : snapshot.b[index];
  const slope = Math.hypot((right - left) * 0.5, (bottom - top) * 0.5);
  const sinA = slope / Math.sqrt(1 + slope * slope);
  const velocity = Math.hypot(snapshot.u[index], snapshot.v[index]);
  const q = snapshot.d[index] * velocity;
  const C = coefficient === null ? snapshot.KC * sinA * velocity * Math.min(1, snapshot.d[index] * 4) : coefficient * sinA * q;
  return { q, C, sediment: snapshot.s[index], erosionPotential: Math.max(0, C - snapshot.s[index]) };
}

function metrics(snapshot, referencePath, coefficient) {
  const mouth = snapshot.source.outletIndices[0]; const mx = mouth % snapshot.N; const my = (mouth / snapshot.N) | 0;
  const erosion = [0, 0, 0]; const q = [0, 0, 0]; const C = [0, 0, 0]; const sediment = [0, 0, 0]; const potential = [0, 0, 0]; const count = [0, 0, 0];
  for (let y = 0; y < snapshot.N; y++) for (let x = 0; x < snapshot.N; x++) {
    const distance = Math.hypot(x - mx, y - my); const band = distance <= 8 ? 0 : distance <= 20 ? 1 : distance <= 40 ? 2 : -1;
    if (band < 0) continue;
    const index = y * snapshot.N + x; const values = capacity(snapshot, index, coefficient);
    erosion[band] += Math.max(0, snapshot.bInit[index] - snapshot.b[index]); q[band] += values.q; C[band] += values.C; sediment[band] += values.sediment; potential[band] += values.erosionPotential; count[band]++;
  }
  const pathErosion = [0, 0, 0]; const included = new Uint8Array(snapshot.N * snapshot.N);
  for (let position = 0; position < referencePath.length; position++) {
    const band = position <= 8 ? 0 : position <= 20 ? 1 : position <= 40 ? 2 : -1;
    if (band < 0) continue;
    const px = referencePath[position] % snapshot.N; const py = (referencePath[position] / snapshot.N) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const x = px + ox; const y = py + oy; const index = y * snapshot.N + x;
      if (x < 0 || y < 0 || x >= snapshot.N || y >= snapshot.N || included[index]) continue;
      included[index] = 1; pathErosion[band] += Math.max(0, snapshot.bInit[index] - snapshot.b[index]);
    }
  }
  const totalErosion = erosion[0] + erosion[1] + erosion[2];
  return {
    near: erosion[0], midstream: erosion[1], downstream: erosion[2], totalErosion,
    nearShare: erosion[0] / totalErosion, midstreamShare: erosion[1] / totalErosion, downstreamShare: erosion[2] / totalErosion,
    pathNear: pathErosion[0], pathMid: pathErosion[1], pathDown: pathErosion[2], pathTotal: pathErosion[0] + pathErosion[1] + pathErosion[2],
    qNearMean: q[0] / count[0], qMidMean: q[1] / count[1], qDownMean: q[2] / count[2],
    CNearMean: C[0] / count[0], CMidMean: C[1] / count[1], CDownMean: C[2] / count[2],
    sNearMean: sediment[0] / count[0], sMidMean: sediment[1] / count[1], sDownMean: sediment[2] / count[2],
    erosionPotentialNear: potential[0] / count[0], erosionPotentialMid: potential[1] / count[1], erosionPotentialDown: potential[2] / count[2],
  };
}

function percentageDelta(value, baseline) {
  return baseline === 0 ? null : (value / baseline - 1) * 100;
}

const referencePath = referenceFlowPath(simulate(magnitudeSource, 1000));
console.log(`Reference flow path: ${referencePath.length} positions`);
for (const steps of checkpoints) {
  const baseline = metrics(simulate(magnitudeSource, steps), referencePath, null);
  const variants = [["MAGNITUDE", null, magnitudeSource], ...coefficients.map((coefficient) => [`Q ${coefficient}`, coefficient, dischargeSource(coefficient)])];
  console.table(variants.map(([variant, coefficient, source]) => {
    const value = metrics(simulate(source, steps), referencePath, coefficient);
    return { steps, variant, ...value, totalDeltaPercent: percentageDelta(value.totalErosion, baseline.totalErosion), nearDeltaPercent: percentageDelta(value.near, baseline.near), downstreamDeltaPercent: percentageDelta(value.downstream, baseline.downstream), pathNearDeltaPercent: percentageDelta(value.pathNear, baseline.pathNear), pathMidDeltaPercent: percentageDelta(value.pathMid, baseline.pathMid), pathDownDeltaPercent: percentageDelta(value.pathDown, baseline.pathDown) };
  }));
}
