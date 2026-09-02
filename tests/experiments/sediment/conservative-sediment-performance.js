/**
 * CATEGORY: EXPERIMENT
 *
 * PURPOSE:
 * Measures throughput of conservative suspended-sediment transport.
 *
 * STATUS:
 * ACCEPTED MECHANISM / REJECTED AS COMPLETE SOLUTION
 *
 * RESULT:
 * TRANSPORT B — conservation fixed, downstream morphology insufficient.
 *
 * PRODUCTION:
 * Does not modify production physics.
 *
 * RUN:
 * node tests/experiments/sediment/conservative-sediment-performance.js
 */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "../../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const { conservativeSource: buildConservativeSource } = require("./conservative-sediment-transport.js");
const conservativeSource = () => buildConservativeSource();

function timed(source) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  const start = performance.now();
  new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
    genTerrain(); const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
    for (let stepIndex = 0; stepIndex < 5000; stepIndex++) step();
  `)(math, Float32Array, Int32Array, Uint8Array);
  return performance.now() - start;
}

function benchmark(name, source) {
  timed(source); const milliseconds = Array.from({ length: 11 }, () => timed(source));
  const meanMilliseconds = milliseconds.reduce((sum, value) => sum + value, 0) / milliseconds.length;
  return { variant: name, repetitions: 11, meanMilliseconds, stepsPerSecond: 5000 / (meanMilliseconds / 1000) };
}
const current = benchmark("CURRENT", currentSource); const conservative = benchmark("CONSERVATIVE_TRANSPORT", conservativeSource());
console.table([current, conservative].map((result) => ({ ...result, deltaPercent: (result.stepsPerSecond / current.stepsPerSecond - 1) * 100 })));
