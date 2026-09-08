/**
 * CATEGORY: DIAGNOSTIC
 *
 * PURPOSE: Locates the first non-finite state produced by the provisional
 * concentration exchange interpretation.  Evaluated sources are in-memory;
 * production simulation physics remains untouched.
 *
 * RUN: node tests/diagnostics/concentration-exchange-failure.js
 */
const fs = require("fs");
const path = require("path");
const { conservativeSource } = require("../experiments/sediment/conservative-sediment-transport.js");

const root = path.resolve(__dirname, "../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const originalSource = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const output = path.join(root, "tests/generated/concentration-exchange-failure");
const summaryPath = path.join(output, "summary.json");
const progressPath = path.join(output, "progress.log");
const completePath = path.join(output, "COMPLETE");
const epsilon = 1e-30;
const maximumSteps = 10000;
const radius = 3;
const ringSize = 20;

fs.mkdirSync(output, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()}\n`);
const progress = (message) => fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`);
const finite = (value) => Number.isFinite(value);
const sum = (values) => { let total = 0; for (const value of values) total += value; return total; };
const mean = (values) => values.length ? sum(values) / values.length : null;
const percentile = (values, fraction) => {
  const valid = values.filter(finite).sort((left, right) => left - right);
  return valid.length ? valid[Math.floor((valid.length - 1) * fraction)] : null;
};

/** Reuses the validated conservative transport source and changes only targetMass. */
function exchangeSource(mode) {
  const target = mode === "CONSERVATIVE_CONCENTRATION" ? "C * d[i]" : "C";
  const replacement = `const C = KC * sinA * vel * dNorm;
      const si = s[i]; const bi = b[i]; const targetMass = ${target};
      exchangeDepth[i] = d[i]; exchangeDzx[i] = dzx; exchangeDzy[i] = dzy; exchangeSlope[i] = slope; exchangeSinA[i] = sinA;
      exchangeVel[i] = vel; exchangeDNorm[i] = dNorm; exchangeC[i] = C; exchangeTargetMass[i] = targetMass;
      if (targetMass > si) {
        const diff = KS * (targetMass - si) * sourceProtectionMask[i];
        b[i] -= diff; s[i] = si + diff;
        exchangeErosionDiff[i] = diff; exchangeDepositionDiff[i] = 0;
        stepAnalyticalExchangeResidual += -diff + diff;
      } else {
        const diff = KD * (si - targetMass);
        b[i] += diff; s[i] = Math.max(0, si - diff);
        exchangeErosionDiff[i] = 0; exchangeDepositionDiff[i] = diff;
        stepAnalyticalExchangeResidual += diff - diff;
      }
      stepStorageExchangeResidual += (b[i] - bi) + (s[i] - si);`;
  const pattern = /const C = KC \* sinA \* vel \* dNorm;\r?\n\s*const si = s\[i\];\r?\n\s*if \(C > si\) \{\r?\n\s*const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;\r?\n\s*\} else \{\r?\n\s*const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);\r?\n\s*\}/;
  let source = conservativeSource();
  source = source.replace(pattern, replacement);
  if (source === conservativeSource()) throw new Error(`Exchange injection failed: ${mode}`);
  return `let stepAnalyticalExchangeResidual = 0, stepStorageExchangeResidual = 0;
let exchangeDepth, exchangeDzx, exchangeDzy, exchangeSlope, exchangeSinA, exchangeVel, exchangeDNorm, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff;
${source}`;
}

function snapshotExpression() {
  return "({ N, NN, b, d, s, u, v, fL, fR, fT, fB, exchangeDepth, exchangeDzx, exchangeDzy, exchangeSlope, exchangeSinA, exchangeVel, exchangeDNorm, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff, stepAnalyticalExchangeResidual, stepStorageExchangeResidual })";
}

/** Runs deterministic source and exposes observations after every complete step. */
function execute(source, onStep) {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  return new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "onStep", `${source}
    genTerrain();
    exchangeDepth = new Float64Array(NN); exchangeDzx = new Float64Array(NN); exchangeDzy = new Float64Array(NN); exchangeSlope = new Float64Array(NN); exchangeSinA = new Float64Array(NN); exchangeVel = new Float64Array(NN); exchangeDNorm = new Float64Array(NN); exchangeC = new Float64Array(NN); exchangeTargetMass = new Float64Array(NN); exchangeErosionDiff = new Float64Array(NN); exchangeDepositionDiff = new Float64Array(NN);
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    if (onStep(0, ${snapshotExpression()})) return;
    for (let stepIndex = 1; stepIndex <= ${maximumSteps}; stepIndex++) { step(); if (onStep(stepIndex, ${snapshotExpression()})) return; }
  `)(math, Float32Array, Float64Array, Int32Array, Uint8Array, onStep);
}

function invalid(snapshot) {
  const fields = [["s", snapshot.s, (value) => value < -1e-8], ["b", snapshot.b], ["d", snapshot.d], ["u", snapshot.u], ["v", snapshot.v], ["fL", snapshot.fL], ["fR", snapshot.fR], ["fT", snapshot.fT], ["fB", snapshot.fB]];
  for (const [field, values, extra] of fields) for (let index = 0; index < snapshot.NN; index++) {
    if (!finite(values[index]) || (extra && extra(values[index]))) return { field, index, x: index % snapshot.N, y: (index / snapshot.N) | 0, value: values[index] };
  }
  return null;
}

function extremes(snapshot) {
  const depth = Array.from(snapshot.d), velocity = [], slope = Array.from(snapshot.exchangeSlope), capacity = Array.from(snapshot.exchangeC), target = Array.from(snapshot.exchangeTargetMass), sediment = Array.from(snapshot.s);
  for (let i = 0; i < snapshot.NN; i++) velocity.push(Math.hypot(snapshot.u[i], snapshot.v[i]));
  const maximum = (values) => values.reduce((best, value) => finite(value) && value > best ? value : best, -Infinity);
  return { maxDepth: maximum(depth), p99Depth: percentile(depth, .99), maxVelocity: maximum(velocity), p99Velocity: percentile(velocity, .99), maxSlope: maximum(slope), p99Slope: percentile(slope, .99), maxC: maximum(capacity), p99C: percentile(capacity, .99), maxTargetMassConcentration: maximum(target), p99TargetMassConcentration: percentile(target, .99), maxSedimentMass: maximum(sediment), p99SedimentMass: percentile(sediment, .99), maxErosionDiff: maximum(Array.from(snapshot.exchangeErosionDiff)), maxDepositionDiff: maximum(Array.from(snapshot.exchangeDepositionDiff)), minBed: snapshot.b.reduce((best, value) => finite(value) && value < best ? value : best, Infinity), maxBed: maximum(Array.from(snapshot.b)) };
}

function cloneSnapshot(step, snapshot) {
  const keys = ["b", "d", "s", "u", "v", "fL", "fR", "fT", "fB", "exchangeDepth", "exchangeDzx", "exchangeDzy", "exchangeSlope", "exchangeSinA", "exchangeVel", "exchangeDNorm", "exchangeC", "exchangeTargetMass", "exchangeErosionDiff", "exchangeDepositionDiff"];
  return Object.fromEntries([["step", step], ...keys.map((key) => [key, new Float64Array(snapshot[key])])]);
}

function eventHistory(metrics, history, events) {
  const definitions = [["DEPTH_SPIKE", "maxDepth", 2], ["CAPACITY_SPIKE", "maxC", 5], ["TARGET_SPIKE", "maxTargetMassConcentration", 5], ["EROSION_SPIKE", "maxErosionDiff", 5], ["VELOCITY_SPIKE", "maxVelocity", 5]];
  if (history.length >= 100) for (const [name, field, factor] of definitions) if (!events[name]) {
    const baseline = mean(history.slice(-100).map((row) => row[field]));
    if (finite(metrics[field]) && finite(baseline) && baseline > epsilon && metrics[field] > factor * baseline) events[name] = { step: metrics.step, value: metrics[field], baseline, factor };
  }
  if (!events.BED_RUNAWAY && history.length) {
    const baseline = Math.min(...history.slice(-100).map((row) => row.minBed));
    if (finite(metrics.minBed) && metrics.minBed < baseline - .1) events.BED_RUNAWAY = { step: metrics.step, minBed: metrics.minBed, prior100MinBed: baseline, drop: baseline - metrics.minBed };
  }
}

function cellRecord(snapshot, index) {
  const C = snapshot.exchangeC[index], d = snapshot.exchangeDepth[index], target = snapshot.exchangeTargetMass[index];
  return { d, dAfterStep: snapshot.d[index], vel: snapshot.exchangeVel[index], slope: snapshot.exchangeSlope[index], C, targetMassLegacy: C, targetMassConcentration: C * d, targetMass: target, targetOverC: target / Math.max(C, epsilon), s: snapshot.s[index], erosionDiff: snapshot.exchangeErosionDiff[index], depositionDiff: snapshot.exchangeDepositionDiff[index], b: snapshot.b[index], head: snapshot.b[index] + d, dzx: snapshot.exchangeDzx[index], dzy: snapshot.exchangeDzy[index], sinA: snapshot.exchangeSinA[index], dNorm: snapshot.exchangeDNorm[index], u: snapshot.u[index], v: snapshot.v[index], fL: snapshot.fL[index], fR: snapshot.fR[index], fT: snapshot.fT[index], fB: snapshot.fB[index], depthRegime: d < .25 ? "quadratic-target regime" : "linear-target regime" };
}

function localTrace(ring, index, N) {
  return ring.map((snapshot) => {
    const cells = [];
    const x0 = index % N, y0 = (index / N) | 0;
    for (let y = Math.max(0, y0 - radius); y <= Math.min(N - 1, y0 + radius); y++) for (let x = Math.max(0, x0 - radius); x <= Math.min(N - 1, x0 + radius); x++) cells.push({ index: y * N + x, x, y, ...cellRecord(snapshot, y * N + x) });
    return { step: snapshot.step, focus: cellRecord(snapshot, index), neighborhood: cells };
  });
}

function feedback(trace) {
  const values = trace.map(({ step, focus }) => ({ step, d: focus.d, C: focus.C, CTimesD: focus.targetMassConcentration, erosionDiff: focus.erosionDiff, b: focus.b }));
  const increases = (field) => values.slice(1).filter((row, index) => finite(row[field]) && row[field] > values[index][field]).length;
  const coherent = ["d", "CTimesD", "erosionDiff"].every((field) => increases(field) >= Math.max(2, values.length * .55)) && values.at(-1).b < values[0].b;
  return { values, observed: coherent, interpretation: coherent ? "Observed: d, C*d and erosion rise while bed declines." : "Not established by final twenty-step local trace." };
}

function classify(concentration, trace) {
  const first = concentration.firstInvalid;
  if (!first) return "FAILURE D — FLOAT32 STORAGE / BUDGET DIAGNOSTIC ARTIFACT";
  const eventStep = (name) => concentration.events[name] && concentration.events[name].step;
  const hydraulic = Math.min(...[eventStep("VELOCITY_SPIKE"), eventStep("DEPTH_SPIKE")].filter(Number.isFinite));
  const exchange = Math.min(...[eventStep("CAPACITY_SPIKE"), eventStep("TARGET_SPIKE"), eventStep("EROSION_SPIKE")].filter(Number.isFinite));
  if (["u", "v", "fL", "fR", "fT", "fB", "d"].includes(first.field) && hydraulic < exchange) return "FAILURE B — HYDRAULIC INSTABILITY PRECEDES EXCHANGE FAILURE";
  if (first.field === "s") return "FAILURE C — SEDIMENT TRANSPORT NUMERICAL FAILURE";
  if (feedback(trace).observed && exchange <= hydraulic) return "FAILURE A — DEPTH/CAPACITY POSITIVE FEEDBACK";
  return "FAILURE E — OTHER LOCAL EXCHANGE RUNAWAY";
}

function runVariant(name, source, stopAtStep = maximumSteps) {
  const ring = [], history = [], events = {}, result = { name, firstInvalid: null, metricsBeforeFailure: [], maxAbsAnalyticalExchangeResidual: 0, cumulativeAnalyticalExchangeResidual: 0, maxAbsStorageExchangeResidual: 0, cumulativeStorageExchangeResidual: 0, grossTurnover: 0, initialTotal: null, finalTotal: null };
  execute(source, (step, snapshot) => {
    const total = sum(snapshot.b) + sum(snapshot.s);
    if (step === 0) { result.initialTotal = total; return false; }
    result.finalTotal = total;
    result.maxAbsAnalyticalExchangeResidual = Math.max(result.maxAbsAnalyticalExchangeResidual, Math.abs(snapshot.stepAnalyticalExchangeResidual)); result.cumulativeAnalyticalExchangeResidual += snapshot.stepAnalyticalExchangeResidual;
    result.maxAbsStorageExchangeResidual = Math.max(result.maxAbsStorageExchangeResidual, Math.abs(snapshot.stepStorageExchangeResidual)); result.cumulativeStorageExchangeResidual += snapshot.stepStorageExchangeResidual;
    result.grossTurnover += sum(snapshot.exchangeErosionDiff) + sum(snapshot.exchangeDepositionDiff);
    const metrics = { step, ...extremes(snapshot) }; eventHistory(metrics, history, events); history.push(metrics); if (history.length > 100) history.shift();
    ring.push(cloneSnapshot(step, snapshot)); if (ring.length > ringSize) ring.shift();
    const found = invalid(snapshot);
    if (found && !result.firstInvalid) { result.firstInvalid = { step, ...found }; result.ring = ring; result.metricsBeforeFailure = history.slice(-100); return true; }
    if (step >= stopAtStep) { result.ring = ring; result.metricsBeforeFailure = history.slice(-100); return true; }
    return false;
  });
  for (const name of ["DEPTH_SPIKE", "CAPACITY_SPIKE", "TARGET_SPIKE", "EROSION_SPIKE", "VELOCITY_SPIKE", "BED_RUNAWAY"]) if (!events[name]) events[name] = null;
  result.events = events; result.globalResidual = result.finalTotal - result.initialTotal; result.globalResidualRelativeToGrossTurnover = Math.abs(result.globalResidual) / Math.max(result.grossTurnover, epsilon);
  return result;
}

function publicRun(run) {
  return { name: run.name, firstInvalid: run.firstInvalid, events: run.events, extremes100StepsBeforeFailure: run.metricsBeforeFailure, exchangeClosure: { maxAbsAnalyticalExchangeResidual: run.maxAbsAnalyticalExchangeResidual, cumulativeAnalyticalExchangeResidual: run.cumulativeAnalyticalExchangeResidual, maxAbsStorageExchangeResidual: run.maxAbsStorageExchangeResidual, cumulativeStorageExchangeResidual: run.cumulativeStorageExchangeResidual }, globalClosedBudget: { deltaSumBPlusS: run.globalResidual, grossTurnover: run.grossTurnover, relativeResidual: run.globalResidualRelativeToGrossTurnover } };
}

function main() {
  // Kept separate so diagnostic can prove legacy behavior without source mutation.
  const legacySource = exchangeSource("CONSERVATIVE_LEGACY");
  const concentrationSource = exchangeSource("CONSERVATIVE_CONCENTRATION");
  progress("[run] CONSERVATIVE_CONCENTRATION");
  const concentration = runVariant("CONSERVATIVE_CONCENTRATION", concentrationSource);
  const firstInvalidStep = concentration.firstInvalid && concentration.firstInvalid.step;
  progress(`[concentration] firstInvalidStep=${firstInvalidStep ?? "none"}`);
  progress("[run] CONSERVATIVE_LEGACY");
  const legacy = runVariant("CONSERVATIVE_LEGACY", legacySource, firstInvalidStep || maximumSteps);
  const focus = concentration.firstInvalid ? concentration.firstInvalid.index : 0;
  const concentrationTrace = localTrace(concentration.ring, focus, 192);
  const legacyTrace = localTrace(legacy.ring, focus, 192);
  const eventOrder = Object.entries(concentration.events).filter(([, event]) => event).sort(([, left], [, right]) => left.step - right.step).map(([type, event]) => ({ type, ...event }));
  const summary = { purpose: "Failure localization for provisional C*d exchange using validated conservative transport.", variants: { legacy: publicRun(legacy), concentration: publicRun(concentration) }, firstInvalidStep, firstInvalidField: concentration.firstInvalid && concentration.firstInvalid.field, firstInvalidIndex: concentration.firstInvalid && concentration.firstInvalid.index, x: concentration.firstInvalid && concentration.firstInvalid.x, y: concentration.firstInvalid && concentration.firstInvalid.y, firstDivergenceEventsInExactOrder: eventOrder, divergesFirst: eventOrder[0] || null, concentrationPreFailureTrace: concentrationTrace, legacyAtSameIndexAndNeighborhood: legacyTrace, depthFeedback: feedback(concentrationTrace), classification: classify(concentration, concentrationTrace), measurementTiming: "State fields are post-step. Exchange d, head and derivatives are captured at exchange evaluation; dAfterStep records post-evaporation depth.", completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(completePath, `classification: ${summary.classification}\ncompletedAt: ${summary.completedAt}\n`);
  progress(`[complete] ${summary.classification}`);
  console.log(`firstInvalidStep: ${firstInvalidStep}`); console.log(`classification: ${summary.classification}`);
}

try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); throw error; }
