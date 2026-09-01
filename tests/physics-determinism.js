/*
 * Runs the physical engine twice with identical inputs. The browser-only
 * rendering and UI scripts are intentionally excluded: this verifies that
 * terrain, sources and physical buffers stay deterministic for a step count.
 *
 * Usage: node tests/physics-determinism.js [steps]
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
const steps = Number.parseInt(process.argv[2] || "1000", 10);

function createSimulation() {
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.3141592653;
  const source = physicalScripts
    .map((relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8"))
    .join("\n");
  const run = new Function(
    "Math",
    "Float32Array",
    "Int32Array",
    "Uint8Array",
    `
      ${source}
      genTerrain();
      const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
      configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
      for (let i = 0; i < ${steps}; i++) step();
      return { b, d, s, u, v, fL, fR, fT, fB };
    `,
  );

  return run(deterministicMath, Float32Array, Int32Array, Uint8Array);
}

function compareField(name, first, second) {
  let maxAbsoluteDifference = 0;
  let totalAbsoluteDifference = 0;

  for (let i = 0; i < first.length; i++) {
    const difference = Math.abs(first[i] - second[i]);
    maxAbsoluteDifference = Math.max(maxAbsoluteDifference, difference);
    totalAbsoluteDifference += difference;
  }

  return {
    name,
    maxAbsoluteDifference,
    averageAbsoluteDifference: totalAbsoluteDifference / first.length,
  };
}

const first = createSimulation();
const second = createSimulation();
const comparisons = Object.keys(first).map((name) =>
  compareField(name, first[name], second[name]),
);
const failed = comparisons.some(
  ({ maxAbsoluteDifference }) => maxAbsoluteDifference !== 0,
);

console.table(comparisons);
console.log(`Physical determinism after ${steps} steps: ${failed ? "FAILED" : "PASS"}`);
process.exitCode = failed ? 1 : 0;
