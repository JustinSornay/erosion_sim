/*
 * Captures or validates physical buffers for one deterministic scenario.
 * Usage: node tests/physics-regression.js <steps> [--write-baseline] [--force]
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const fields = ["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB"];
const steps = Number.parseInt(process.argv[2] || "1000", 10);
const writeFixture = process.argv.includes("--write-baseline");
const forceWrite = process.argv.includes("--force");
const baselineVersion = process.argv
  .find((argument) => argument.startsWith("--baseline-version="))
  ?.slice("--baseline-version=".length);
const physicalScripts = [
  "js/core/config.js",
  "js/core/math.js",
  "js/core/state.js",
  "js/simulation/terrain.js",
  "js/simulation/simulation.js",
  "js/simulation/drainage.js",
];

function runSimulation() {
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
    `${source}
      genTerrain();
      const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
      configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();
      for (let i = 0; i < ${steps}; i++) step();
      return { b, d, s, u, v, fL, fR, fT, fB };`,
  );
  return run(deterministicMath, Float32Array, Int32Array, Uint8Array);
}

function serialize(snapshot) {
  return Buffer.concat(fields.map((field) => Buffer.from(snapshot[field].buffer)));
}

function compare(snapshot, fixture) {
  const bytesPerField = snapshot.b.byteLength;
  let failed = false;
  const results = fields.map((field, fieldIndex) => {
    const reference = new Float32Array(
      fixture.buffer,
      fixture.byteOffset + fieldIndex * bytesPerField,
      snapshot[field].length,
    );
    let maxAbsoluteDifference = 0;
    let totalAbsoluteDifference = 0;
    for (let i = 0; i < reference.length; i++) {
      const difference = Math.abs(snapshot[field][i] - reference[i]);
      maxAbsoluteDifference = Math.max(maxAbsoluteDifference, difference);
      totalAbsoluteDifference += difference;
    }
    failed ||= maxAbsoluteDifference !== 0;
    return {
      field,
      maxAbsoluteDifference,
      averageAbsoluteDifference: totalAbsoluteDifference / reference.length,
    };
  });
  console.table(results);
  return failed;
}

const snapshot = runSimulation();
const gridSize = Math.sqrt(snapshot.b.length);
const fixtureDirectory = path.join(
  __dirname,
  "fixtures",
  `N${gridSize}${baselineVersion ? `-${baselineVersion}` : ""}`,
);
const fixturePath = path.join(fixtureDirectory, `physics-${steps}.bin`);

if (writeFixture) {
  fs.mkdirSync(fixtureDirectory, { recursive: true });
  if (fs.existsSync(fixturePath) && !forceWrite) {
    throw new Error(
      `Baseline already exists: ${path.relative(root, fixturePath)}. Use --force to replace it.`,
    );
  }
  fs.writeFileSync(fixturePath, serialize(snapshot));
  console.log(`Baseline written: ${path.relative(root, fixturePath)}`);
} else if (!fs.existsSync(fixturePath)) {
  throw new Error(`Missing baseline: ${path.relative(root, fixturePath)}`);
} else {
  const failed = compare(snapshot, fs.readFileSync(fixturePath));
  console.log(`Physical regression after ${steps} steps: ${failed ? "FAILED" : "PASS"}`);
  process.exitCode = failed ? 1 : 0;
}
