/**
 * CATEGORY: DIAGNOSTIC
 * PURPOSE: Attributes the first step-299 sediment non-finite to an exact
 * exchange/transport stage without changing production simulation physics.
 * RUN: node tests/diagnostics/sediment-stage-failure.js
 */
const fs = require("fs");
const path = require("path");
const { conservativeSource } = require("../experiments/sediment/conservative-sediment-transport.js");

const root = path.resolve(__dirname, "../..");
const output = path.join(root, "tests/generated/sediment-stage-failure");
const focal = 11356, maximumSteps = 350, epsilon = 1e-30, dMin = 1e-6;
const stages = ["STAGE_A_PRE_EXCHANGE", "STAGE_B_POST_EXCHANGE", "STAGE_C_PRE_TRANSPORT", "STAGE_D_DURING_TRANSPORT_ACCUMULATION", "STAGE_E_PRE_SEDIMENT_SWAP", "STAGE_F_POST_SEDIMENT_SWAP", "STAGE_G_END_STEP"];
fs.mkdirSync(output, { recursive: true }); fs.rmSync(path.join(output, "COMPLETE"), { force: true });
fs.writeFileSync(path.join(output, "progress.log"), `[start] ${new Date().toISOString()}\n`);
const progress = (line) => fs.appendFileSync(path.join(output, "progress.log"), `${new Date().toISOString()} ${line}\n`);
const finite = Number.isFinite;
const sum = (values) => { let value = 0; for (const item of values) value += item; return value; };
const percentile = (values, p) => { const sorted = values.filter(finite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : null; };

/** Exactly preserves prior diagnostic exchange alternatives: target C or C*d. */
function exchangeSource(mode) {
  const target = mode === "CONSERVATIVE_CONCENTRATION" ? "C * d[i]" : "C";
  const replacement = `const C = KC * sinA * vel * dNorm;
      const si = s[i]; const targetMass = ${target};
      exchangeC[i] = C; exchangeTargetMass[i] = targetMass;
      if (targetMass > si) {
        const diff = KS * (targetMass - si) * sourceProtectionMask[i];
        b[i] -= diff; s[i] = si + diff; exchangeErosionDiff[i] = diff; exchangeDepositionDiff[i] = 0;
      } else {
        const diff = KD * (si - targetMass);
        b[i] += diff; s[i] = Math.max(0, si - diff); exchangeErosionDiff[i] = 0; exchangeDepositionDiff[i] = diff;
      }`;
  const pattern = /const C = KC \* sinA \* vel \* dNorm;\r?\n\s*const si = s\[i\];\r?\n\s*if \(C > si\) \{\r?\n\s*const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;\r?\n\s*\} else \{\r?\n\s*const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);\r?\n\s*\}/;
  const source = conservativeSource().replace(pattern, replacement);
  if (source === conservativeSource()) throw new Error(`Exchange injection failed: ${mode}`);
  return `let exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff;\n${source}`;
}

/** Adds hooks around existing conservative transport operations, retaining operation order and arithmetic. */
function instrument(source) {
  const preExchange = "  for (let y = 0; y < N; y++) {\n    const row = y * N;\n    for (let x = 0; x < N; x++) {\n      const i = row + x;\n      const inL = x > 0 ? fR[i - 1] : 0,";
  const capture = (stage) => `stageCapture("${stage}", diagnosticStepIndex, N, NN, b, d, s, tmpS, u, v, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff);`;
  let result = source.replace(preExchange, `  ${capture("STAGE_A_PRE_EXCHANGE")}\n` + preExchange);
  if (result === source) throw new Error("Pre-exchange anchor missing");
  result = result.replace("  tmpS.fill(0);", `  ${capture("STAGE_B_POST_EXCHANGE")}\n  ${capture("STAGE_C_PRE_TRANSPORT")}\n  tmpS.fill(0);`);
  if (!result.includes("STAGE_C_PRE_TRANSPORT")) throw new Error("Transport anchor missing");
  const oldTransport = `      const requestedOutSediment = outL + outR + outT + outB;
      if (requestedOutSediment > s[i] && requestedOutSediment > 0) {
        const limiter = s[i] / requestedOutSediment;
        outL *= limiter; outR *= limiter; outT *= limiter; outB *= limiter;
      }
      tmpS[i] += s[i] - outL - outR - outT - outB;
      if (x > 0) tmpS[i - 1] += outL;
      if (x < N - 1) tmpS[i + 1] += outR;
      if (y > 0) tmpS[i - N] += outT;
      if (y < N - 1) tmpS[i + N] += outB;
      d[i] *= 1 - KE * DT;`;
  const newTransport = `      const rawL = outL, rawR = outR, rawT = outT, rawB = outB;
      const requestedOutSediment = rawL + rawR + rawT + rawB;
      let limiter = 1;
      if (requestedOutSediment > s[i] && requestedOutSediment > 0) {
        limiter = s[i] / requestedOutSediment;
        outL *= limiter; outR *= limiter; outT *= limiter; outB *= limiter;
      }
      transportDonor(diagnosticStepIndex, i, s[i], d[i], rawL, rawR, rawT, rawB, outL, outR, outT, outB, requestedOutSediment, limiter, fL, fR, fT, fB);
      transportAdd(diagnosticStepIndex, i, s[i] - outL - outR - outT - outB, i, tmpS, N, NN, b, d, s, u, v, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff);
      if (x > 0) transportAdd(diagnosticStepIndex, i - 1, outL, i, tmpS, N, NN, b, d, s, u, v, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff);
      if (x < N - 1) transportAdd(diagnosticStepIndex, i + 1, outR, i, tmpS, N, NN, b, d, s, u, v, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff);
      if (y > 0) transportAdd(diagnosticStepIndex, i - N, outT, i, tmpS, N, NN, b, d, s, u, v, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff);
      if (y < N - 1) transportAdd(diagnosticStepIndex, i + N, outB, i, tmpS, N, NN, b, d, s, u, v, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff);
      d[i] *= 1 - KE * DT;`;
  result = result.replace(oldTransport, newTransport);
  if (!result.includes("transportDonor")) throw new Error("Conservative transport body anchor missing");
  const swap = `  {
    const t = s;
    s = tmpS;
    tmpS = t;
  }`;
  result = result.replace(swap, `  ${capture("STAGE_E_PRE_SEDIMENT_SWAP")}
${swap}
  ${capture("STAGE_F_POST_SEDIMENT_SWAP")}
  ${capture("STAGE_G_END_STEP")}`);
  if (!result.includes("STAGE_G_END_STEP")) throw new Error("Swap anchor missing");
  return result;
}

function firstInvalid(name, values, limit) {
  for (let i = 0; i < limit; i++) if (!finite(values[i]) || ((name === "s" || name === "tmpS") && values[i] < -1e-8)) return { field: name, index: i, value: values[i] };
  return null;
}
function invalidState(snapshot) {
  for (const [name, values] of [["s", snapshot.s], ["tmpS", snapshot.tmpS], ["b", snapshot.b], ["d", snapshot.d]]) { const found = firstInvalid(name, values, snapshot.NN); if (found) return found; }
  return null;
}
function localIndices(N) { const output = []; const x0 = focal % N, y0 = (focal / N) | 0; for (let y = y0 - 1; y <= y0 + 1; y++) for (let x = x0 - 1; x <= x0 + 1; x++) if (x >= 0 && y >= 0 && x < N && y < N) output.push(y * N + x); return output; }
function recordCell(snapshot, index) {
  const d = snapshot.d[index], s = snapshot.s[index];
  return { index, x: index % snapshot.N, y: (index / snapshot.N) | 0, b: snapshot.b[index], d, s, tmpS: snapshot.tmpS[index], u: snapshot.u[index], v: snapshot.v[index], C: snapshot.exchangeC[index], targetMass: snapshot.exchangeTargetMass[index], erosionDiff: snapshot.exchangeErosionDiff[index], depositionDiff: snapshot.exchangeDepositionDiff[index], concentration: s / Math.max(d, dMin) };
}
function stepExtremes(snapshot) {
  const sediment = [], concentration = [], tmp = []; let minPositiveDepth = Infinity, dryCount = 0, dryMass = 0;
  for (let i = 0; i < snapshot.NN; i++) { const s = snapshot.s[i], d = snapshot.d[i]; sediment.push(s); tmp.push(snapshot.tmpS[i]); concentration.push(s / Math.max(d, dMin)); if (s > 0 && d > 0) minPositiveDepth = Math.min(minPositiveDepth, d); if (d <= dMin && Math.abs(s) > epsilon) { dryCount++; dryMass += s; } }
  const max = (values) => values.reduce((best, value) => finite(value) && value > best ? value : best, -Infinity);
  return { maxS: max(sediment), p99S: percentile(sediment, .99), maxConcentration: max(concentration), p99Concentration: percentile(concentration, .99), maxTmpS: max(tmp), minPositiveDepthOfSedimentCells: minPositiveDepth, maxSOverDepth: max(concentration), numberDrySedimentCells: dryCount, sedimentMassInDryCells: dryMass };
}
function thresholdEvents(rows) {
  const baseline = rows.filter((row) => row.step >= 200 && row.step <= 240); const fields = ["maxS", "maxConcentration", "maxRawSedimentTransfer", "maxRealisedSedimentTransfer", "maxOutgoingScale", "maxTmpS", "minPositiveDepthOfSedimentCells", "maxSOverDepth"]; const result = {};
  for (const field of fields) { const base = sum(baseline.map((row) => row[field]).filter(finite)) / Math.max(1, baseline.map((row) => row[field]).filter(finite).length); result[field] = { baseline: base, first10x: null, first100x: null, first1000x: null }; for (const row of rows.filter((item) => item.step >= 250 && item.step <= 299)) for (const factor of [10, 100, 1000]) if (!result[field][`first${factor}x`] && finite(row[field]) && base > epsilon && row[field] > base * factor) result[field][`first${factor}x`] = { step: row.step, value: row[field] }; }
  return result;
}

function execute(name, source) {
  const trace = [], stageInvalid = [], metrics = [], transport299 = { donors: [], additions: [], focal: null }, budgets = [];
  let stepIndex = 0, firstStageInvalid = null, transportBefore = null, maxRaw = 0, maxRealised = 0, maxScale = 0, maxOverAvailable = 0;
  const stageCapture = (stage, step, N, NN, b, d, s, tmpS, u, v, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff) => {
    stepIndex = step;
    const snapshot = { N, NN, b, d, s, tmpS, u, v, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff };
    if (stepIndex >= 280 && stepIndex <= 305) { const issue = invalidState(snapshot); const row = { step: stepIndex, stage, invalid: issue }; stageInvalid.push(row); if (issue && !firstStageInvalid) firstStageInvalid = { step: stepIndex, stage, ...issue }; }
    if (stepIndex >= 295 && stepIndex <= 299) trace.push({ step: stepIndex, stage, focal: recordCell(snapshot, focal), neighbors: localIndices(snapshot.N).filter((index) => index !== focal).map((index) => recordCell(snapshot, index)) });
    if (stage === "STAGE_G_END_STEP" && stepIndex >= 200 && stepIndex <= 299) metrics.push({ step: stepIndex, ...stepExtremes(snapshot), maxRawSedimentTransfer: maxRaw, maxRealisedSedimentTransfer: maxRealised, maxOutgoingScale: maxScale, maxOutgoingOverAvailableRatio: maxOverAvailable });
    if (stage === "STAGE_C_PRE_TRANSPORT" && stepIndex >= 280 && stepIndex <= 299) transportBefore = sum(snapshot.s);
    if (stage === "STAGE_F_POST_SEDIMENT_SWAP" && stepIndex >= 280 && stepIndex <= 299 && finite(transportBefore)) { const after = sum(snapshot.s); budgets.push({ step: stepIndex, sedimentBeforeTransport: transportBefore, sedimentAfterTransport: after, transportResidual: after - transportBefore }); }
  };
  const transportDonor = (step, donor, donorS, donorDepth, rawL, rawR, rawT, rawB, outL, outR, outT, outB, rawTotal, limiter, fL, fR, fT, fB) => {
    stepIndex = step;
    const realised = outL + outR + outT + outB; maxRaw = Math.max(maxRaw, Math.abs(rawL), Math.abs(rawR), Math.abs(rawT), Math.abs(rawB)); maxRealised = Math.max(maxRealised, Math.abs(outL), Math.abs(outR), Math.abs(outT), Math.abs(outB)); maxScale = Math.max(maxScale, limiter); maxOverAvailable = Math.max(maxOverAvailable, Math.abs(realised) / Math.max(Math.abs(donorS), epsilon));
    if (stepIndex === 299 && ([donor - 1, donor + 1, donor - 192, donor + 192].includes(focal) || donor === focal)) transport299.donors.push({ donorIndex: donor, x: donor % 192, y: (donor / 192) | 0, donorS, donorDepth, concentration: donorS / Math.max(donorDepth, dMin), drySedimentCell: donorDepth <= dMin && Math.abs(donorS) > epsilon, waterFluxToReceiver: donor === focal - 1 ? fR[donor] : donor === focal + 1 ? fL[donor] : donor === focal - 192 ? fB[donor] : donor === focal + 192 ? fT[donor] : null, rawSedimentTransfer: donor === focal - 1 ? rawR : donor === focal + 1 ? rawL : donor === focal - 192 ? rawB : donor === focal + 192 ? rawT : null, totalRawOutgoingSediment: rawTotal, availableSediment: donorS, outgoingScale: limiter, realisedSedimentTransfer: donor === focal - 1 ? outR : donor === focal + 1 ? outL : donor === focal - 192 ? outB : donor === focal + 192 ? outT : null, realisedOutgoing: realised, realisedOutL: outL, realisedOutR: outR, realisedOutT: outT, realisedOutB: outB, outgoingOverAvailableRatio: Math.abs(realised) / Math.max(Math.abs(donorS), epsilon) });
  };
  const transportAdd = (step, receiver, value, donor, tmpS, N, NN, b, d, s, u, v, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff) => { stepIndex = step; const before = tmpS[receiver], rawDoubleValueBeforeAssignment = before + value; tmpS[receiver] += value; const storedValueAfterAssignment = tmpS[receiver]; if (receiver === focal) stageCapture("STAGE_D_DURING_TRANSPORT_ACCUMULATION", step, N, NN, b, d, s, tmpS, u, v, exchangeC, exchangeTargetMass, exchangeErosionDiff, exchangeDepositionDiff); if (stepIndex === 299 && receiver === focal) transport299.additions.push({ donorIndex: donor, receiverTmpSBefore: before, contribution: value, rawDoubleValueBeforeAssignment, storedValueAfterAssignment }); };
  const math = Object.create(Math); math.random = () => .3141592653;
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "stageCapture", "transportDonor", "transportAdd", `${source}
    genTerrain(); exchangeC = new Float64Array(NN); exchangeTargetMass = new Float64Array(NN); exchangeErosionDiff = new Float64Array(NN); exchangeDepositionDiff = new Float64Array(NN);
    const sourcePoint = { x: 48, y: 48, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask();
    let diagnosticStepIndex = 0;
    for (diagnosticStepIndex = 1; diagnosticStepIndex <= ${maximumSteps}; diagnosticStepIndex++) step();
  `)(math, Float32Array, Float64Array, Int32Array, Uint8Array, stageCapture, transportDonor, transportAdd);
  const stage299 = trace.filter((row) => row.step === 299); const pre = stage299.find((row) => row.stage === "STAGE_C_PRE_TRANSPORT"); const post = stage299.find((row) => row.stage === "STAGE_F_POST_SEDIMENT_SWAP");
  if (pre && post) { const incoming = transport299.donors.filter((donor) => donor.donorIndex !== focal).reduce((total, donor) => total + donor.realisedSedimentTransfer, 0); const own = transport299.additions.find((row) => row.donorIndex === focal); transport299.focal = { initialSediment: pre.focal.s, incomingLeft: transport299.donors.find((row) => row.donorIndex === focal - 1)?.realisedSedimentTransfer || 0, incomingRight: transport299.donors.find((row) => row.donorIndex === focal + 1)?.realisedSedimentTransfer || 0, incomingTop: transport299.donors.find((row) => row.donorIndex === focal - 192)?.realisedSedimentTransfer || 0, incomingBottom: transport299.donors.find((row) => row.donorIndex === focal + 192)?.realisedSedimentTransfer || 0, outgoingLeft: null, outgoingRight: null, outgoingTop: null, outgoingBottom: null, totalIncoming: incoming, totalOutgoing: null, expectedFinalSediment: null, actualTmpS: pre.focal.tmpS, actualPostSwapS: post.focal.s, focalRetainedContribution: own && own.contribution }; }
  return { name, firstStageInvalid, stages: stageInvalid, trace, transport299, metrics, thresholds: thresholdEvents(metrics), budgets, bufferTypes: { s: "Float32Array", tmpS: "Float32Array" }, maxOutgoingOverAvailableRatio: maxOverAvailable };
}

function finalizeFocal(run) {
  const donor = run.transport299.donors.find((row) => row.donorIndex === focal);
  if (!donor || !run.transport299.focal) return;
  const focalBudget = run.transport299.focal; focalBudget.outgoingLeft = donor.realisedOutgoing - (donor.realisedSedimentTransfer || 0); // Replaced below by directional values retained in donor trace.
  focalBudget.outgoingLeft = donor.realisedOutL; focalBudget.outgoingRight = donor.realisedOutR; focalBudget.outgoingTop = donor.realisedOutT; focalBudget.outgoingBottom = donor.realisedOutB;
  focalBudget.totalOutgoing = donor.realisedOutgoing;
  focalBudget.expectedFinalSediment = focalBudget.initialSediment + focalBudget.totalIncoming - focalBudget.totalOutgoing;
  focalBudget.actualTmpS = run.transport299.additions.at(-1)?.storedValueAfterAssignment;
}
function classify(run) {
  const first = run.firstStageInvalid;
  if (!first) return "STAGE G — OTHER";
  if (["STAGE_A_PRE_EXCHANGE", "STAGE_B_POST_EXCHANGE"].includes(first.stage)) return "STAGE A — EXCHANGE PRODUCES NON-FINITE S DIRECTLY";
  const donors = run.transport299.donors;
  if (run.maxOutgoingOverAvailableRatio > 1 + 1e-6 || donors.some((row) => row.donorS < 0 || !finite(row.realisedSedimentTransfer))) return "STAGE D — CONSERVATIVE TRANSPORT CAP/ARITHMETIC BUG";
  if (donors.some((row) => row.drySedimentCell)) return "STAGE C — DRY-CELL CONCENTRATION PATHOLOGY";
  const add = run.transport299.additions.find((row) => finite(row.rawDoubleValueBeforeAssignment) && !finite(row.storedValueAfterAssignment));
  if (add) return "STAGE E — FLOAT32 STORAGE OVERFLOW";
  if (run.transport299.additions.some((row) => !finite(row.rawDoubleValueBeforeAssignment))) return "STAGE F — RECEIVER ACCUMULATION OVERFLOW";
  return "STAGE B — EXCHANGE PRODUCES EXTREME FINITE S, THEN TRANSPORT OVERFLOWS";
}
function main() {
  progress("[run] CONSERVATIVE_CONCENTRATION"); const concentration = execute("CONSERVATIVE_CONCENTRATION", instrument(exchangeSource("CONSERVATIVE_CONCENTRATION"))); finalizeFocal(concentration);
  progress("[run] CONSERVATIVE_LEGACY"); const legacy = execute("CONSERVATIVE_LEGACY", instrument(exchangeSource("CONSERVATIVE_LEGACY"))); finalizeFocal(legacy);
  const summary = { purpose: "Intra-step attribution of concentration exchange sediment failure.", focal: { index: focal, x: 28, y: 59 }, variants: { concentration, legacy }, firstInvalidStage: concentration.firstStageInvalid, classification: classify(concentration), completedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2)); fs.writeFileSync(path.join(output, "COMPLETE"), `classification: ${summary.classification}\ncompletedAt: ${summary.completedAt}\n`); progress(`[complete] ${summary.classification}`); console.log(`first invalid: ${JSON.stringify(summary.firstInvalidStage)}`); console.log(summary.classification);
}
try { main(); } catch (error) { progress(`[failed] ${error.stack || error.message}`); throw error; }
