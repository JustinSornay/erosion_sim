/* Isolated throughput comparison for the historical and hybrid capacity models. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const magnitudeSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const factor = Number(process.argv.find((argument) => argument.startsWith("--hybrid="))?.slice(9) ?? 0.25);
const steps = Number(process.argv.find((argument) => argument.startsWith("--steps="))?.slice(8) ?? 5000);
const repetitions = Number(process.argv.find((argument) => argument.startsWith("--repetitions="))?.slice(14) ?? 11);
if (!Number.isFinite(factor) || factor < 0 || factor > 1) throw new Error("--hybrid requires a factor in [0, 1]");

const hybridSource = magnitudeSource.replace(
  "const sinA = slope / Math.sqrt(1 + slope * slope);",
  `let alignment = 0; if (slope > 1e-6 && vel > 1e-6) alignment = Math.max(0, Math.min(1, -(dzx * ui + dzy * vi) / (slope * vel))); const effectiveSlope = slope * (${factor} + ${(1 - factor)} * alignment); const sinA = effectiveSlope / Math.sqrt(1 + effectiveSlope * effectiveSlope);`,
);

function run(source) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  const simulate = new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain(); const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask(); for (let i = 0; i < ${steps}; i++) step();`);
  simulate(math, Float32Array, Int32Array, Uint8Array);
}

function measure(variant, source) {
  run(source);
  const start = process.hrtime.bigint();
  for (let repetition = 0; repetition < repetitions; repetition++) run(source);
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  return { variant, steps, repetitions, seconds, stepsPerSecond: steps * repetitions / seconds };
}

const magnitude = measure("MAGNITUDE", magnitudeSource);
const hybrid = measure(`HYBRID ${factor}`, hybridSource);
hybrid.deltaPercent = (hybrid.stepsPerSecond / magnitude.stepsPerSecond - 1) * 100;
console.table([magnitude, hybrid]);
