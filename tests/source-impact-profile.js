/*
 * Compares localized and distributed injection with the deterministic terrain.
 * Downstream erosion follows the terrain's pre-simulation drainage path.
 *
 * Usage: node tests/source-impact-profile.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const physicalScripts = [
  "js/core/config.js",
  "js/core/math.js",
  "js/core/state.js",
  "js/simulation/terrain.js",
  "js/simulation/simulation.js",
  "js/simulation/drainage.js",
];
const source = physicalScripts
  .map((relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8"))
  .join("\n");
const sourceX = 48;
const sourceY = 48;
const checkpoints = process.argv
  .slice(2)
  .map((value) => Number.parseInt(value, 10))
  .filter(Number.isFinite);
if (checkpoints.length === 0) checkpoints.push(500, 2000, 5000, 10000);

function runSimulation({ distributed, steps }) {
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.3141592653;
  const injection = distributed
    ? ""
    : `injectSources = function() {
        for (let i = 0; i < sources.length; i++) {
          const src = sources[i];
          if (src.active) d[idx(src.x, src.y)] += DT * src.rate;
        }
      };`;
  const run = new Function(
    "Math",
    "Float32Array",
    "Int32Array",
    "Uint8Array",
    `${source}
      ${injection}
      genTerrain();
      const source = { x: ${sourceX}, y: ${sourceY}, rate: DEFAULT_RATE, active: true };
      configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
      for (let i = 0; i < ${steps}; i++) step();
      return { N, b, bInit, d, flowTo };`,
  );
  return run(deterministicMath, Float32Array, Int32Array, Uint8Array);
}

function meanAltitudeInRadius({ N, b }) {
  let total = 0;
  let count = 0;
  for (let y = sourceY - 2; y <= sourceY + 2; y++) {
    for (let x = sourceX - 2; x <= sourceX + 2; x++) {
      if ((x - sourceX) ** 2 + (y - sourceY) ** 2 > 4) continue;
      total += b[y * N + x];
      count++;
    }
  }
  return total / count;
}

function maximumWaterInRadius({ N, d }) {
  let maximum = 0;
  for (let y = sourceY - 3; y <= sourceY + 3; y++) {
    for (let x = sourceX - 3; x <= sourceX + 3; x++) {
      if ((x - sourceX) ** 2 + (y - sourceY) ** 2 > 9) continue;
      maximum = Math.max(maximum, d[y * N + x]);
    }
  }
  return maximum;
}

function downstreamMeanErosion({ N, b, bInit, flowTo }) {
  let cell = sourceY * N + sourceX;
  let total = 0;
  let count = 0;
  for (let step = 0; step < 30; step++) {
    cell = flowTo[cell];
    if (cell < 0) break;
    if (step >= 5) {
      total += bInit[cell] - b[cell];
      count++;
    }
  }
  return total / count;
}

function measure(snapshot) {
  const sourceCell = sourceY * snapshot.N + sourceX;
  return {
    sourceAltitude: snapshot.b[sourceCell],
    radiusTwoMeanAltitude: meanAltitudeInRadius(snapshot),
    radiusThreeMaxWater: maximumWaterInRadius(snapshot),
    downstreamMeanErosion: downstreamMeanErosion(snapshot),
  };
}

for (const steps of checkpoints) {
  const modes = process.argv.includes("--localized")
    ? [false]
    : process.argv.includes("--distributed")
      ? [true]
      : [false, true];
  console.table(
    modes.map((distributed) => ({
      steps,
      injection: distributed ? "distributed" : "localized",
      ...measure(runSimulation({ distributed, steps })),
    })),
  );
}
