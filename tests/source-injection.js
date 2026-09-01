/*
 * Verifies source routing independently from transport, evaporation and
 * erosion. Every scenario must inject its complete external timestep volume.
 *
 * Usage: node tests/source-injection.js
 */
const assert = require("assert");
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

function createRoutingSimulation() {
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.3141592653;
  const create = new Function(
    "Math",
    "Float32Array",
    "Int32Array",
    "Uint8Array",
    `${source}
      return ({ x, y, lowerHeads, steps = 1 }) => {
        genTerrain();
        b.fill(101);
        d.fill(0);
        const sourceIndex = idx(x, y);
        b[sourceIndex] = 100;
        for (let i = 0; i < lowerHeads.length; i++) {
          const neighbor = lowerHeads[i];
          b[idx(x + neighbor.dx, y + neighbor.dy)] = neighbor.head;
        }
        const source = { x, y, rate: DEFAULT_RATE, active: true };
        configureSourceOutlets(source);
        sources.push(source);
        refreshSourceProtectionMask();
        for (let i = 0; i < steps; i++) injectSources();
        let total = 0;
        for (let i = 0; i < NN; i++) total += d[i];
        return { d, sourceIndex, N, total, volumeStep: DT * DEFAULT_RATE };
      };`,
  );
  return create(deterministicMath, Float32Array, Int32Array, Uint8Array);
}

function assertClose(actual, expected, description, tolerance = 1e-8) {
  const difference = Math.abs(actual - expected);
  assert.ok(
    difference <= tolerance,
    `${description}: expected ${expected}, received ${actual} (difference ${difference})`,
  );
}

const simulate = createRoutingSimulation();
const cases = [
  {
    name: "one descending neighbor",
    source: { x: 48, y: 48 },
    lowerHeads: [{ dx: 5, dy: 0, head: 90 }],
    expectedTargets: [{ dx: 3, dy: 0, share: 1 }],
  },
  {
    name: "multiple descending neighbors",
    source: { x: 48, y: 48 },
    lowerHeads: [
      { dx: 5, dy: 0, head: 90 },
      { dx: 0, dy: 5, head: 95 },
    ],
    expectedTargets: [
      { dx: 3, dy: 0, share: 2 / 3 },
      { dx: 0, dy: 3, share: 1 / 3 },
    ],
  },
  {
    name: "border source",
    source: { x: 0, y: 48 },
    lowerHeads: [{ dx: 5, dy: 0, head: 90 }],
    expectedTargets: [{ dx: 3, dy: 0, share: 1 }],
  },
  {
    name: "near-corner source",
    source: { x: 1, y: 1 },
    lowerHeads: [{ dx: 5, dy: 0, head: 90 }],
    expectedTargets: [{ dx: 3, dy: 0, share: 1 }],
  },
  {
    name: "closed depression",
    source: { x: 48, y: 48 },
    lowerHeads: [],
    expectedTargets: [],
    retainsAtSource: true,
  },
];

for (const testCase of cases) {
  const { source, lowerHeads, expectedTargets, retainsAtSource } = testCase;
  const result = simulate({ ...source, lowerHeads });
  assertClose(result.total, result.volumeStep, `${testCase.name} total volume`);
  assertClose(
    result.d[result.sourceIndex],
    retainsAtSource ? result.volumeStep : 0,
    `${testCase.name} source cell`,
  );
  console.log(`${testCase.name}: ${result.total} injected`);
}

const repeated = simulate({
  x: 48,
  y: 48,
  lowerHeads: [{ dx: 5, dy: 0, head: 0 }],
  steps: 25,
});
assertClose(
  repeated.total,
  repeated.volumeStep * 25,
  "25-step external volume",
  1e-6,
);
console.log("Incoming source routing conservation: PASS");
