/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Compares historical terrain-magnitude capacity with directional slope capacity.
 *
 * STATUS:
 * REJECTED
 *
 * RESULT:
 * Improves early source distribution but globally weakens erosion.
 *
 * PRODUCTION:
 * Does not modify production physics.
 *
 * RUN:
 * node tests/experiments/slope/directional-slope-comparison.js [checkpoints]
 */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const directionalSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const currentSource = directionalSource.replace(
  /let flowSlope = 0;\s*if \(vel > 1e-6\) \{\s*flowSlope = Math\.max\(0, -\(dzx \* ui \+ dzy \* vi\) \/ vel\);\s*\}\s*const sinA = flowSlope \/ Math\.sqrt\(1 \+ flowSlope \* flowSlope\);/,
  "const slope = Math.sqrt(dzx * dzx + dzy * dzy); const sinA = slope / Math.sqrt(1 + slope * slope);",
);
const checkpoints = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (checkpoints.length === 0) checkpoints.push(1000, 5000, 10000, 20000);

function simulate(source, steps) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  const run = new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain(); const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
    for (let stepIndex = 0; stepIndex < ${steps}; stepIndex++) step(); return { N, b, bInit, source };`);
  return run(math, Float32Array, Int32Array, Uint8Array);
}

function erosionBands(snapshot) {
  const mouth = snapshot.source.outletIndices[0]; const mx = mouth % snapshot.N; const my = (mouth / snapshot.N) | 0;
  const totals = [0, 0, 0];
  for (let y = 0; y < snapshot.N; y++) for (let x = 0; x < snapshot.N; x++) {
    const distance = Math.hypot(x - mx, y - my); const erosion = Math.max(0, snapshot.bInit[y * snapshot.N + x] - snapshot.b[y * snapshot.N + x]);
    if (distance <= 8) totals[0] += erosion; else if (distance <= 20) totals[1] += erosion; else if (distance <= 40) totals[2] += erosion;
  }
  const totalErosion = totals[0] + totals[1] + totals[2];
  return {
    erosionNearSource: totals[0], erosionMidstream: totals[1], erosionDownstream: totals[2], totalErosion,
    nearShare: totals[0] / totalErosion, downstreamShare: totals[2] / totalErosion,
  };
}

for (const steps of checkpoints) {
  const current = erosionBands(simulate(currentSource, steps));
  const directional = erosionBands(simulate(directionalSource, steps));
  console.table([{ steps, variant: "CURRENT", ...current }, { steps, variant: "DIRECTIONAL", ...directional }]);
  console.table(["erosionNearSource", "erosionMidstream", "erosionDownstream", "totalErosion", "nearShare", "downstreamShare"].map((zone) => ({
    steps, zone, current: current[zone], directional: directional[zone], deltaPercent: ((directional[zone] / current[zone]) - 1) * 100,
  })));
}
