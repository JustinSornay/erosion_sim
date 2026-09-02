/* Benchmark-only comparison of magnitude, directional and hybrid slope models. */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const magnitudeSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const factors = [0.25, 0.35, 0.5, 0.65, 0.75];
const d8x = [-1, 0, 1, -1, 1, -1, 0, 1];
const d8y = [-1, -1, -1, 0, 0, 1, 1, 1];
const checkpoints = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (checkpoints.length === 0) checkpoints.push(1000, 5000, 10000);

function slopeVariant(factor) {
  const replacement = factor === null
    ? "const effectiveSlope = Math.max(0, -(dzx * ui + dzy * vi) / Math.max(vel, 1e-6)); const sinA = effectiveSlope / Math.sqrt(1 + effectiveSlope * effectiveSlope);"
    : `let alignment = 0; if (slope > 1e-6 && vel > 1e-6) alignment = Math.max(0, Math.min(1, -(dzx * ui + dzy * vi) / (slope * vel))); const effectiveSlope = slope * (${factor} + ${(1 - factor)} * alignment); const sinA = effectiveSlope / Math.sqrt(1 + effectiveSlope * effectiveSlope);`;
  return magnitudeSource.replace("const sinA = slope / Math.sqrt(1 + slope * slope);", replacement);
}

function simulate(source, steps) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  const run = new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain(); const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask(); for(let i=0;i<${steps};i++)step(); return {N,b,bInit,u,v,source};`);
  return run(math, Float32Array, Int32Array, Uint8Array);
}

function referenceFlowPath(snapshot, maxPositions = 41) {
  const path = [];
  const visited = new Uint8Array(snapshot.N * snapshot.N);
  let index = snapshot.source.outletIndices[0];
  for (let position = 0; position < maxPositions && !visited[index]; position++) {
    path.push(index); visited[index] = 1;
    const x = index % snapshot.N; const y = (index / snapshot.N) | 0;
    const ui = snapshot.u[index]; const vi = snapshot.v[index];
    let bestIndex = -1; let bestScore = -Infinity;
    for (let offset = 0; offset < 8; offset++) {
      const nx = x + d8x[offset]; const ny = y + d8y[offset];
      if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const score = ui * d8x[offset] + vi * d8y[offset];
      if (score > bestScore) { bestScore = score; bestIndex = ny * snapshot.N + nx; }
    }
    if (bestIndex < 0 || bestScore <= 0) break;
    index = bestIndex;
  }
  return path;
}

function metrics(snapshot, path) {
  const mouth = snapshot.source.outletIndices[0]; const mx = mouth % snapshot.N; const my = (mouth / snapshot.N) | 0;
  const radial = [0, 0, 0];
  for (let y=0;y<snapshot.N;y++) for(let x=0;x<snapshot.N;x++) { const distance=Math.hypot(x-mx,y-my); const erosion=Math.max(0,snapshot.bInit[y*snapshot.N+x]-snapshot.b[y*snapshot.N+x]); if(distance<=8)radial[0]+=erosion;else if(distance<=20)radial[1]+=erosion;else if(distance<=40)radial[2]+=erosion; }
  const corridor = [0, 0, 0]; const included = new Uint8Array(snapshot.N * snapshot.N);
  for (let position = 0; position < path.length; position++) {
    const band = position <= 8 ? 0 : position <= 20 ? 1 : position <= 40 ? 2 : -1;
    if (band < 0) continue;
    const px = path[position] % snapshot.N; const py = (path[position] / snapshot.N) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const x = px + ox; const y = py + oy; const index = y * snapshot.N + x;
      if (x < 0 || y < 0 || x >= snapshot.N || y >= snapshot.N || included[index]) continue;
      included[index] = 1; corridor[band] += Math.max(0, snapshot.bInit[index] - snapshot.b[index]);
    }
  }
  const totalErosion=radial[0]+radial[1]+radial[2]; const pathTotal=corridor[0]+corridor[1]+corridor[2];
  return {near:radial[0],midstream:radial[1],downstream:radial[2],totalErosion,nearShare:radial[0]/totalErosion,midstreamShare:radial[1]/totalErosion,downstreamShare:radial[2]/totalErosion,pathNear:corridor[0],pathMid:corridor[1],pathDown:corridor[2],pathTotal};
}

function percentageDelta(value, baseline) {
  return baseline === 0 ? null : (value / baseline - 1) * 100;
}

const referencePath = referenceFlowPath(simulate(magnitudeSource, 1000));
console.log(`Reference flow path: ${referencePath.length} positions`);
for (const steps of checkpoints) {
  const baseline = metrics(simulate(magnitudeSource, steps), referencePath);
  const variants = [["MAGNITUDE", magnitudeSource], ["DIRECTIONAL", slopeVariant(null)], ...factors.map((factor) => [`HYBRID ${factor}`, slopeVariant(factor)])];
  console.table(variants.map(([variant, source]) => {
    const value = metrics(simulate(source, steps), referencePath);
    return {
      steps, variant, ...value,
      totalDeltaPercent: percentageDelta(value.totalErosion, baseline.totalErosion),
      nearDeltaPercent: percentageDelta(value.near, baseline.near),
      downstreamDeltaPercent: percentageDelta(value.downstream, baseline.downstream),
      pathNearDeltaPercent: percentageDelta(value.pathNear, baseline.pathNear),
      pathMidDeltaPercent: percentageDelta(value.pathMid, baseline.pathMid),
      pathDownDeltaPercent: percentageDelta(value.pathDown, baseline.pathDown)
    };
  }));
}
