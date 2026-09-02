/**
 * CATEGORY: REGRESSION
 *
 * PURPOSE:
 * Verifies terrain-defined source outlet weights remain fixed after local erosion.
 *
 * STATUS:
 * ACTIVE
 *
 * RESULT:
 * Protects production source-routing stability.
 *
 * PRODUCTION:
 * Does not modify production physics.
 *
 * RUN:
 * node tests/regression/source-routing-stability.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const scripts = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const source = scripts.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const run = new Function("Math", "Float32Array", "Int32Array", "Uint8Array", `${source}
  genTerrain(); b.fill(101); d.fill(0);
  const src = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
  b[idx(48, 48)] = 100; b[idx(53, 48)] = 96; b[idx(48, 53)] = 94;
  configureSourceOutlets(src);
  const before = Array.from(src.outletWeights);
  b[idx(53, 48)] -= 10; b[idx(48, 53)] -= 20;
  return { before, after: Array.from(src.outletWeights), count: src.outletCount };`);
const result = run(Math, Float32Array, Int32Array, Uint8Array);
assert.strictEqual(result.count, 3);
assert.deepStrictEqual(result.after, result.before);
assert.ok(Math.abs(result.before[0] - 0.6) < 1e-7);
console.log("Fixed source outlet weights: PASS");
