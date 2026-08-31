/*
 * Measures only the deterministic physical engine: no DOM, rendering, D8 or
 * particles. Usage: node tests/physics-benchmark.js [steps] [repetitions]
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const steps = Number.parseInt(process.argv[2] || "1000", 10);
const repetitions = Number.parseInt(process.argv[3] || "7", 10);
const warmups = 3;
const gridSizeIndex = process.argv.indexOf("--grid-size");
const gridSize = gridSizeIndex >= 0 ? Number.parseInt(process.argv[gridSizeIndex + 1], 10) : 128;
const physicalScripts = [
  "js/core/config.js",
  "js/core/math.js",
  "js/core/state.js",
  "js/simulation/terrain.js",
  "js/simulation/simulation.js",
  "js/simulation/drainage.js",
];
let source = physicalScripts
  .map((relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8"))
  .join("\n");
if (!Number.isInteger(gridSize) || gridSize < 2) throw new Error("Invalid --grid-size value");
source = source.replace(/const N = \d+,/, `const N = ${gridSize},`);
const run = new Function(
  "Math",
  "Float32Array",
  "Int32Array",
  "Uint8Array",
  `
    ${source}
    genTerrain();
    sources.push({ x: 48, y: 48, rate: DEFAULT_RATE, active: true });
    return () => { for (let i = 0; i < ${steps}; i++) step(); };
  `,
);

function createRun() {
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.3141592653;
  return run(deterministicMath, Float32Array, Int32Array, Uint8Array);
}

for (let i = 0; i < warmups; i++) createRun()();
const durations = [];
for (let i = 0; i < repetitions; i++) {
  const runSteps = createRun();
  const start = process.hrtime.bigint();
  runSteps();
  durations.push(Number(process.hrtime.bigint() - start) / 1e6);
}

durations.sort((first, second) => first - second);
const medianMs = durations[(durations.length / 2) | 0];
const rates = durations
  .map((duration) => steps / (duration / 1000))
  .sort((first, second) => first - second);
const percentile = (fraction) => rates[Math.floor((rates.length - 1) * fraction)];
console.table({
  steps,
  gridSize,
  repetitions,
  warmups,
  medianMs: medianMs.toFixed(2),
  stepsPerSecond: (steps / (medianMs / 1000)).toFixed(0),
  minStepsPerSecond: Math.min(...rates).toFixed(0),
  p25StepsPerSecond: percentile(0.25).toFixed(0),
  p75StepsPerSecond: percentile(0.75).toFixed(0),
  maxStepsPerSecond: Math.max(...rates).toFixed(0),
});
