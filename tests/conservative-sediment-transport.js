/**
 * Benchmark-only audit of flux-form suspended-sediment transport.  Production
 * keeps its historical semi-Lagrangian transport; this file injects the
 * conservative alternative into an isolated engine source.
 * Usage: node tests/conservative-sediment-transport.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const engineFiles = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const currentSource = engineFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const checkpoints = [1000, 5000, 10000];
const d8x = [-1, 0, 1, -1, 1, -1, 0, 1];
const d8y = [-1, -1, -1, 0, 0, 1, 1, 1];

function conservativeSource() {
  const historicalTransport = /  for \(let y = 0; y < N; y\+\+\) \{\r?\n    const row = y \* N;\r?\n    for \(let x = 0; x < N; x\+\+\) \{\r?\n      const i = row \+ x;\r?\n      let sx = x - \(u\[i\] \* DT\) \/ L,[\s\S]*?  \{\r?\n    const t = s;\r?\n    s = tmpS;\r?\n    tmpS = t;\r?\n  \}/;
  const replacement = `  // Fluxes are volumes/time: water updates depth with DT * (fin-fout) / L².
  // s is bed-height-equivalent mass per cell, therefore each sediment transfer
  // uses the identical DT / L² factor and the donor concentration s / d.
  tmpS.fill(0);
  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      const concentration = s[i] / Math.max(d[i], 1e-12);
      const scale = DT / (L * L);
      let outL = fL[i] * concentration * scale;
      let outR = fR[i] * concentration * scale;
      let outT = fT[i] * concentration * scale;
      let outB = fB[i] * concentration * scale;
      const requestedOutSediment = outL + outR + outT + outB;
      if (requestedOutSediment > s[i] && requestedOutSediment > 0) {
        const limiter = s[i] / requestedOutSediment;
        outL *= limiter; outR *= limiter; outT *= limiter; outB *= limiter;
      }
      tmpS[i] += s[i] - outL - outR - outT - outB;
      if (x > 0) tmpS[i - 1] += outL;
      if (x < N - 1) tmpS[i + 1] += outR;
      if (y > 0) tmpS[i - N] += outT;
      if (y < N - 1) tmpS[i + N] += outB;
      d[i] *= 1 - KE * DT;
    }
  }
  {
    const t = s;
    s = tmpS;
    tmpS = t;
  }`;
  const variant = currentSource.replace(historicalTransport, replacement);
  if (variant === currentSource) throw new Error("Conservative transport injection failed");
  return variant;
}

function noBedExchangeSource(source) {
  const variant = source.replace(
    /const C = KC \* sinA \* vel \* dNorm;\r?\n\s*const si = s\[i\];\r?\n\s*if \(C > si\) \{\r?\n\s*const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;\r?\n\s*\} else \{\r?\n\s*const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);\r?\n\s*\}/,
    "const si = s[i]; s[i] = si;",
  );
  if (variant === source) throw new Error("Bed-exchange removal failed");
  return variant;
}

function run(source, steps, setup = "") {
  const math = Object.create(Math); math.random = () => 0.3141592653;
  return new Function("Math", "Float32Array", "Int32Array", "Uint8Array", "Float64Array", `${source}
    genTerrain(); ${setup}
    for (let stepIndex = 0; stepIndex < ${steps}; stepIndex++) step();
    return { N, NN, b, bInit, d, s, u, v, fL, fR, fT, fB, sources };
  `)(math, Float32Array, Int32Array, Uint8Array, Float64Array);
}

function scenario(source, steps) {
  return run(source, steps, `const source = { x: 48, y: 48, rate: DEFAULT_RATE, active: true };
    configureSourceOutlets(source); sources.push(source); refreshSourceProtectionMask();`);
}

function sum(values) { let total = 0; for (const value of values) total += value; return total; }
function percentile(values, fraction) { if (!values.length) return null; const ordered = [...values].sort((a, b) => a - b); return ordered[Math.floor((ordered.length - 1) * fraction)]; }

function tracePath(snapshot, maximum = 41) {
  const source = snapshot.sources[0]; const path = []; const visited = new Uint8Array(snapshot.NN); let cell = source.outletIndices[0];
  for (let position = 0; position < maximum && !visited[cell]; position++) {
    path.push(cell); visited[cell] = 1; const x = cell % snapshot.N; const y = (cell / snapshot.N) | 0; let next = -1; let projection = 0;
    for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction]; const ny = y + d8y[direction]; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx; const dot = snapshot.u[cell] * d8x[direction] + snapshot.v[cell] * d8y[direction];
      if (!visited[candidate] && dot > projection) { projection = dot; next = candidate; }
    }
    if (next < 0) for (let direction = 0; direction < 8; direction++) {
      const nx = x + d8x[direction]; const ny = y + d8y[direction]; if (nx < 0 || ny < 0 || nx >= snapshot.N || ny >= snapshot.N) continue;
      const candidate = ny * snapshot.N + nx;
      if (!visited[candidate] && snapshot.b[candidate] < snapshot.b[cell] && (next < 0 || snapshot.b[candidate] < snapshot.b[next])) next = candidate;
    }
    if (next < 0) break; cell = next;
  }
  return path;
}

function section(snapshot, path, position, halfWidth = 2) {
  const center = path[position]; const previous = path[Math.max(0, position - 1)]; const next = path[Math.min(path.length - 1, position + 1)];
  const dx = (next % snapshot.N) - (previous % snapshot.N); const dy = ((next / snapshot.N) | 0) - ((previous / snapshot.N) | 0); const length = Math.hypot(dx, dy) || 1;
  const normalX = -Math.sign(dy); const normalY = Math.sign(dx); const x = center % snapshot.N; const y = (center / snapshot.N) | 0;
  let discharge = 0; let q = 0; let vectorX = 0; let vectorY = 0; let wetWidth = 0;
  for (let offset = -halfWidth; offset <= halfWidth; offset++) {
    const sx = x + normalX * offset; const sy = y + normalY * offset; if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue;
    const i = sy * snapshot.N + sx; const velocity = Math.hypot(snapshot.u[i], snapshot.v[i]);
    discharge += snapshot.d[i] * Math.max(0, (snapshot.u[i] * dx + snapshot.v[i] * dy) / length); q += snapshot.d[i] * velocity;
    vectorX += snapshot.d[i] * snapshot.u[i]; vectorY += snapshot.d[i] * snapshot.v[i]; if (snapshot.d[i] > 1e-5) wetWidth++;
  }
  return { discharge, wetWidth, coherence: Math.hypot(vectorX, vectorY) / Math.max(q, 1e-12) };
}

function zoneIndices(snapshot, path, start, end) {
  const selected = new Uint8Array(snapshot.NN); const indices = [];
  for (let position = start; position <= Math.min(end, path.length - 1); position++) {
    const center = path[position]; const previous = path[Math.max(0, position - 1)]; const next = path[Math.min(path.length - 1, position + 1)];
    const dx = Math.sign((next % snapshot.N) - (previous % snapshot.N)); const dy = Math.sign(((next / snapshot.N) | 0) - ((previous / snapshot.N) | 0)); const x = center % snapshot.N; const y = (center / snapshot.N) | 0;
    for (let offset = -2; offset <= 2; offset++) { const sx = x - dy * offset; const sy = y + dx * offset; if (sx < 0 || sy < 0 || sx >= snapshot.N || sy >= snapshot.N) continue; const i = sy * snapshot.N + sx; if (!selected[i]) { selected[i] = 1; indices.push(i); } }
  }
  return indices;
}

function capacity(snapshot, i) {
  const x = i % snapshot.N; const y = (i / snapshot.N) | 0; const left = x ? snapshot.b[i - 1] : snapshot.b[i]; const right = x < snapshot.N - 1 ? snapshot.b[i + 1] : snapshot.b[i]; const top = y ? snapshot.b[i - snapshot.N] : snapshot.b[i]; const bottom = y < snapshot.N - 1 ? snapshot.b[i + snapshot.N] : snapshot.b[i];
  const slope = Math.hypot((right - left) * 0.5, (bottom - top) * 0.5); return 0.055 * (slope / Math.sqrt(1 + slope * slope)) * Math.hypot(snapshot.u[i], snapshot.v[i]) * Math.min(1, snapshot.d[i] * 4);
}

function bedBudget(snapshot) {
  let suspended = 0; let bedLoss = 0; let bedGain = 0; let netBedRemoval = 0;
  for (let i = 0; i < snapshot.NN; i++) { const delta = snapshot.bInit[i] - snapshot.b[i]; suspended += snapshot.s[i]; bedLoss += Math.max(0, delta); bedGain += Math.max(0, -delta); netBedRemoval += delta; }
  // Material relative to initial bed is (b - bInit) + s = s - netBedRemoval.
  // With no sediment boundary flux, its zero initial value must remain zero.
  return { totalErosion: bedLoss, totalBedGain: bedGain, netBedRemoval, totalSuspendedSediment: suspended, sedimentResidual: suspended - netBedRemoval };
}

function zoneMetrics(snapshot, path, name, start, end) {
  const cells = zoneIndices(snapshot, path, start, end); let suspendedMass = 0; let water = 0; let erosionPotential = 0; let depositionPotential = 0; const concentrations = [];
  for (const i of cells) { const c = snapshot.s[i] / Math.max(snapshot.d[i], 1e-12); suspendedMass += snapshot.s[i]; water += snapshot.d[i]; concentrations.push(c); const C = capacity(snapshot, i); erosionPotential += Math.max(0, C - snapshot.s[i]); depositionPotential += Math.max(0, snapshot.s[i] - C); }
  const sections = []; let erosion = 0;
  for (let position = start; position <= Math.min(end, path.length - 1); position++) { sections.push(section(snapshot, path, position)); erosion += Math.max(0, snapshot.bInit[path[position]] - snapshot.b[path[position]]); }
  return { zone: name, erosion, suspendedMass, meanConcentration: suspendedMass / Math.max(water, 1e-12), medianCellConcentration: percentile(concentrations.filter((_, index) => snapshot.d[cells[index]] > 1e-5), 0.5), p90CellConcentration: percentile(concentrations.filter((_, index) => snapshot.d[cells[index]] > 1e-5), 0.9), erosionPotential, depositionPotential, discharge: sum(sections.map((value) => value.discharge)) / sections.length, wetWidth: sum(sections.map((value) => value.wetWidth)) / sections.length, coherence: sum(sections.map((value) => value.coherence)) / sections.length };
}

function sedimentDistanceTrace(snapshot) {
  const source = snapshot.sources[0]; const bins = [0, 0, 0, 0];
  for (let i = 0; i < snapshot.NN; i++) { const x = i % snapshot.N; const y = (i / snapshot.N) | 0; const distance = Math.hypot(x - source.x, y - source.y); const bin = distance <= 8 ? 0 : distance <= 20 ? 1 : distance <= 40 ? 2 : 3; bins[bin] += snapshot.s[i]; }
  const total = sum(bins); return { source0to8: bins[0] / Math.max(total, 1e-12), source9to20: bins[1] / Math.max(total, 1e-12), source21to40: bins[2] / Math.max(total, 1e-12), beyond40: bins[3] / Math.max(total, 1e-12) };
}

function fullMetrics(snapshot, path) {
  const mouth = zoneMetrics(snapshot, path, "MOUTH", 0, 5); const mid = zoneMetrics(snapshot, path, "MID", 6, 15); const downstream = zoneMetrics(snapshot, path, "DOWNSTREAM", 16, path.length - 1); const budget = bedBudget(snapshot); const pathErosion = mouth.erosion + mid.erosion + downstream.erosion;
  return { ...budget, nearErosion: mouth.erosion, midErosion: mid.erosion, downstreamErosion: downstream.erosion, nearShare: mouth.erosion / Math.max(pathErosion, 1e-12), downstreamShare: downstream.erosion / Math.max(pathErosion, 1e-12), mouthDischarge: mouth.discharge, midDischarge: mid.discharge, downstreamDischarge: downstream.discharge, downstreamVsMouth: downstream.discharge / Math.max(mouth.discharge, 1e-12), wetWidth: (mouth.wetWidth + mid.wetWidth + downstream.wetWidth) / 3, directionalCoherence: (mouth.coherence + mid.coherence + downstream.coherence) / 3, distance: sedimentDistanceTrace(snapshot), zones: [mouth, mid, downstream] };
}

function microSetup(kind) {
  const base = `sources.length = 0; b.fill(0); d.fill(0.05); s.fill(0); fL.fill(0); fR.fill(0); fT.fill(0); fB.fill(0);`;
  if (kind === "blob advecté") return `${base} for (let y = 94; y <= 98; y++) for (let x = 30; x <= 34; x++) s[y * N + x] = 1; for (let i = 0; i < NN; i++) fR[i] = 0.2; for (let y = 0; y < N; y++) fR[y * N + N - 1] = 0;`;
  if (kind === "gradient uniforme") return `${base} for (let y = 70; y < 90; y++) for (let x = 70; x < 90; x++) s[y * N + x] = x - 69; for (let i = 0; i < NN; i++) fB[i] = 0.15; for (let x = 0; x < N; x++) fB[(N - 1) * N + x] = 0;`;
  if (kind === "convergence") return `${base} for (let y = 86; y <= 106; y++) for (let x = 86; x <= 106; x++) s[y * N + x] = 1; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x; if (x < 96) fR[i] = 0.1; if (x > 96) fL[i] = 0.1; }`;
  if (kind === "divergence") return `${base} for (let y = 92; y <= 100; y++) for (let x = 92; x <= 100; x++) s[y * N + x] = 1; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x; if (x < 96) fL[i] = 0.1; if (x > 96) fR[i] = 0.1; }`;
  return `${base} for (let y = 94; y <= 98; y++) for (let x = 94; x <= 98; x++) s[y * N + x] = 1;`;
}

function microMetrics(kind, steps) {
  const source = noBedExchangeSource(conservativeSource()); const setup = microSetup(kind);
  const initial = run(source, 0, setup); const final = run(source, steps, setup); const before = sum(initial.s); const after = sum(final.s); let minimumS = Infinity; let maximumS = -Infinity;
  for (const value of final.s) { minimumS = Math.min(minimumS, value); maximumS = Math.max(maximumS, value); }
  return { test: kind, steps, initialSediment: before, finalSediment: after, relativeError: Math.abs(after - before) / Math.max(before, 1e-12), minimumS, maximumS };
}

if (require.main === module) {
const conservative = conservativeSource();
console.log("CONSERVATIVE TRANSPORT SEMANTICS");
console.table([{ s: "suspended sediment mass per cell", transfer: "DT/L² × waterFlux × (s/d)", boundary: "water boundary fluxes are zero, therefore sediment boundary fluxes are zero", positivity: "donor outflows proportionally limited to s[i]" }]);
console.log("CONSERVATION MICRO-TESTS");
console.table(["blob advecté", "gradient uniforme", "convergence", "divergence", "eau quasi immobile"].flatMap((kind) => [1, 10, 100, 1000].map((steps) => microMetrics(kind, steps))));

const referencePath = tracePath(scenario(currentSource, 1000));
const rows = [];
for (const [label, source] of [["CURRENT", currentSource], ["CONSERVATIVE_TRANSPORT", conservative]]) for (const steps of checkpoints) {
  const metrics = fullMetrics(scenario(source, steps), referencePath);
  rows.push({ variant: label, steps, ...metrics });
}
console.log("MORPHODYNAMIC COMPARISON");
console.table(rows.map(({ distance, zones, ...row }) => row));
for (const row of rows) { console.log(`SEDIMENT ZONES | ${row.variant} | ${row.steps}`); console.table(row.zones); }
console.log("SUSPENDED SEDIMENT DISTANCE TRACE"); console.table(rows.map(({ variant, steps, distance }) => ({ variant, steps, ...distance })));

const currentBySteps = new Map(rows.filter((row) => row.variant === "CURRENT").map((row) => [row.steps, row]));
const conservativeBySteps = new Map(rows.filter((row) => row.variant === "CONSERVATIVE_TRANSPORT").map((row) => [row.steps, row]));
const mechanicallyValid = ["blob advecté", "gradient uniforme", "convergence", "divergence", "eau quasi immobile"].every((kind) => [1, 10, 100, 1000].every((steps) => microMetrics(kind, steps).relativeError < 1e-5));
const promising = [5000, 10000].every((steps) => { const current = currentBySteps.get(steps); const variant = conservativeBySteps.get(steps); return variant.totalErosion >= current.totalErosion * 0.7 && variant.totalErosion <= current.totalErosion * 1.3 && (variant.downstreamDischarge > current.downstreamDischarge || variant.downstreamVsMouth > current.downstreamVsMouth) && (variant.downstreamErosion > current.downstreamErosion || variant.downstreamShare > current.downstreamShare) && variant.nearErosion < current.nearErosion * 2; });
const conclusion = !mechanicallyValid ? "TRANSPORT C — conservative implementation itself fails conservation" : promising ? "TRANSPORT A — conservative transport fixes sediment conservation and improves downstream morphology" : "TRANSPORT B — conservative transport fixes conservation but morphology still fails";
console.log(`TRANSPORT CONCLUSION: ${conclusion}`);
}

module.exports = { conservativeSource };
