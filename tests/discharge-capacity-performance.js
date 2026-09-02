/* Isolated throughput comparison for historical and discharge-based capacity. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const magnitudeSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const coefficient = Number(process.argv.find((argument) => argument.startsWith("--kcq="))?.slice(6) ?? 0.4);
const steps = Number(process.argv.find((argument) => argument.startsWith("--steps="))?.slice(8) ?? 5000);
const repetitions = Number(process.argv.find((argument) => argument.startsWith("--repetitions="))?.slice(14) ?? 11);
if (!Number.isFinite(coefficient) || coefficient <= 0) throw new Error("--kcq requires a positive coefficient");

const dischargeSource = magnitudeSource.replace("const C = KC * sinA * vel * dNorm;", `const C = ${coefficient} * sinA * d[i] * vel;`);

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
const discharge = measure(`Q ${coefficient}`, dischargeSource);
discharge.deltaPercent = (discharge.stepsPerSecond / magnitude.stepsPerSecond - 1) * 100;
console.table([magnitude, discharge]);
