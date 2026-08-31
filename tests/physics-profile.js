/*
 * Profiles the existing step phases in a benchmark-only instrumented copy.
 * Production simulation.js remains free from timing calls.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const steps = Number.parseInt(process.argv[2] || "5000", 10);
const phases = ["sources", "flux", "waterUpdate", "velocityErosion", "sedimentAdvection"];
const scripts = [
  "js/core/config.js",
  "js/core/math.js",
  "js/core/state.js",
  "js/simulation/terrain.js",
  "js/simulation/simulation.js",
  "js/simulation/drainage.js",
];

function replaceNth(source, needle, occurrence, replacement) {
  let offset = -1;
  for (let index = 0; index < occurrence; index++) {
    offset = source.indexOf(needle, offset + 1);
  }
  if (offset < 0) throw new Error("Simulation phase marker not found");
  return source.slice(0, offset) + replacement + source.slice(offset + needle.length);
}

let simulationSource = fs.readFileSync(path.join(root, "js/simulation/simulation.js"), "utf8");
const loopMarker = "  for (let y = 0; y < N; y++) {\n";
for (let phaseIndex = 4; phaseIndex >= 1; phaseIndex--) {
  const phase = phases[phaseIndex - 1];
  simulationSource = replaceNth(
    simulationSource,
    loopMarker,
    phaseIndex,
    `  profile.${phase} += Number(nowNs() - phaseStarted);\n  phaseStarted = nowNs();\n${loopMarker}`,
  );
}
simulationSource = simulationSource
  .replace(
    "function step() {",
    "function step() {\n  let phaseStarted = nowNs();",
  )
  .replace(
    "  steps++;",
    "  profile.sedimentAdvection += Number(nowNs() - phaseStarted);\n  steps++;",
  );

const source = scripts
  .map((relativePath) =>
    relativePath.endsWith("simulation.js")
      ? simulationSource
      : fs.readFileSync(path.join(root, relativePath), "utf8"),
  )
  .join("\n");
const run = new Function(
  "Math",
  "Float32Array",
  "Int32Array",
  "Uint8Array",
  "nowNs",
  `const profile = { sources: 0, flux: 0, waterUpdate: 0, velocityErosion: 0, sedimentAdvection: 0 };
    ${source}
    genTerrain();
    sources.push({ x: 48, y: 48, rate: DEFAULT_RATE, active: true });
    for (let i = 0; i < ${steps}; i++) step();
    return profile;`,
);
const deterministicMath = Object.create(Math);
deterministicMath.random = () => 0.3141592653;
const result = run(deterministicMath, Float32Array, Int32Array, Uint8Array, process.hrtime.bigint);
const total = phases.reduce((sum, phase) => sum + result[phase], 0);
console.table(
  phases.map((phase) => ({
    phase,
    totalMs: (result[phase] / 1e6).toFixed(2),
    percent: ((result[phase] / total) * 100).toFixed(1),
  })),
);
