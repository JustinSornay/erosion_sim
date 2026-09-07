/**
 * CATEGORY: DIAGNOSTIC
 * PURPOSE: Observes competing absolute-grid flow corridors in a deterministic
 * CURRENT run. Source instrumentation is evaluated in memory only.
 * RUN: node tests/diagnostics/route-competition-diagnostic.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const files = ["js/core/config.js", "js/core/math.js", "js/core/state.js", "js/simulation/terrain.js", "js/simulation/simulation.js", "js/simulation/drainage.js"];
const source = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const output = path.join(root, "tests/generated/route-competition");
const summaryPath = path.join(output, "summary.json");
const progressPath = path.join(output, "progress.log");
const completePath = path.join(output, "COMPLETE");
const cuts = [52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96];
const activeCuts = cuts.slice(1, -1);
const keySteps = [4000, 4200, 4300, 4400, 4485, 4600, 4683, 4750, 4811, 4824, 4900, 4969, 5000, 5100];
const persistence = 20;

fs.mkdirSync(output, { recursive: true });
fs.rmSync(completePath, { force: true });
fs.writeFileSync(progressPath, `[start] ${new Date().toISOString()} CURRENT deterministic route competition\n`);
const log = (message) => fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => sum(values) / Math.max(values.length, 1);
const finiteMean = (values) => { const valid = values.filter(Number.isFinite); return valid.length ? mean(valid) : null; };
const observe = (step) => [1000, 2500, 3200].includes(step) || (step >= 3400 && step <= 5100);
const smooth = (values) => values.map((value, x) => (values[Math.max(0, x - 1)] + 2 * value + values[Math.min(values.length - 1, x + 1)]) / 4);
const nearby = (profile, x) => { const xs = [-2, -1, 0, 1, 2].map((offset) => Math.max(0, Math.min(profile.bed.length - 1, x + offset))); return { meanBed: mean(xs.map((i) => profile.bed[i])), meanDepth: mean(xs.map((i) => profile.depth[i])), meanHead: mean(xs.map((i) => profile.head[i])), erosionStep: sum(xs.map((i) => profile.erosion[i])), depositionStep: sum(xs.map((i) => profile.deposition[i])) }; };
function peaks(values) {
  const s = smooth(values), maximum = Math.max(...s);
  if (!(maximum > 0)) return [];
  const candidates = s.map((flux, x) => ({ x, flux })).filter(({ x, flux }) => flux >= maximum * .05 && ((x === 0 && flux >= s[1]) || (x === s.length - 1 && flux >= s[x - 1]) || (x > 0 && x < s.length - 1 && flux >= s[x - 1] && flux > s[x + 1]))).sort((a, b) => b.flux - a.flux);
  const selected = [];
  for (const peak of candidates) if (selected.every((existing) => Math.abs(existing.x - peak.x) >= 4)) selected.push(peak);
  const total = sum(values);
  return selected.map((peak) => ({ ...peak, fractionTotalPositiveSouth: peak.flux / Math.max(total, 1e-12) }));
}
function instrumented() {
  let text = `${source}\nlet diagnosticErosion = new Float64Array(NN); let diagnosticDeposition = new Float64Array(NN);`;
  text = text.replace(/const diff = KS \* \(C - si\) \* sourceProtectionMask\[i\];\r?\n\s*b\[i\] -= diff;\r?\n\s*s\[i\] = si \+ diff;/, "const diff = KS * (C - si) * sourceProtectionMask[i]; diagnosticErosion[i] = diff; b[i] -= diff; s[i] = si + diff;");
  text = text.replace(/const diff = KD \* \(si - C\);\r?\n\s*b\[i\] \+= diff;\r?\n\s*s\[i\] = Math\.max\(0, si - diff\);/, "const diff = KD * (si - C); diagnosticDeposition[i] = diff; b[i] += diff; s[i] = Math.max(0, si - diff);");
  if (!text.includes("diagnosticErosion[i] = diff") || !text.includes("diagnosticDeposition[i] = diff")) throw new Error("Diagnostic erosion/deposition instrumentation failed");
  return text;
}
function snapshotCut(snapshot, y) {
  const positive = [], erosion = [], deposition = [], bed = [], depth = [], head = [];
  let grossSouthward = 0, grossNorthward = 0;
  for (let x = 0; x < snapshot.N; x++) {
    const south = (y - 1) * snapshot.N + x, north = y * snapshot.N + x;
    const southward = snapshot.fB[south], northward = snapshot.fT[north];
    grossSouthward += southward; grossNorthward += northward; positive.push(Math.max(0, southward - northward));
    let e = 0, d = 0, b = 0, h = 0, count = 0;
    for (let row = y - 3; row <= y + 3; row++) { const i = row * snapshot.N + x; e += snapshot.erosion[i]; d += snapshot.deposition[i]; b += snapshot.b[i]; h += snapshot.b[i] + snapshot.d[i]; count++; }
    erosion.push(e); deposition.push(d); bed.push(b / count); depth.push(snapshot.d[north]); head.push(h / count);
  }
  const totalPositiveSouth = sum(positive), centroidX = totalPositiveSouth ? sum(positive.map((value, x) => value * x)) / totalPositiveSouth : null;
  const allPeaks = peaks(positive), largest = allPeaks[0];
  return { totalPositiveSouth, grossSouthward, grossNorthward, netSouthward: grossSouthward - grossNorthward, centroidX, modeX: largest?.x ?? null, secondaryPeakFraction: largest && allPeaks[1] ? allPeaks[1].flux / largest.flux : 0, peaks: allPeaks, profile: { positive, erosion, deposition, bed, depth, head } };
}
function slope(rows, key) { const xs = rows.map((row) => row.step), ys = rows.map((row) => row.cuts[key.y][key.metric]); const mx = mean(xs), my = mean(ys); const v = sum(xs.map((x) => (x - mx) ** 2)); return v ? sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / v : 0; }
function baselineCandidate(rows) {
  const candidates = [];
  for (let start = 3200; start <= 3801; start++) {
    const window = rows.filter((row) => row.step >= start && row.step < start + 200);
    if (window.length !== 200) continue;
    const stable = cuts.every((y) => { const flux = window.map((row) => row.cuts[y].totalPositiveSouth); const fluxMean = mean(flux); const centroidSlope = slope(window, { y, metric: "centroidX" }); const takeover = window.some((row) => { const p = row.cuts[y].peaks; return p[1] && p[1].flux > p[0].flux; }); return Math.abs(centroidSlope) < .002 && (Math.max(...flux) - Math.min(...flux)) / Math.max(fluxMean, 1e-12) < .15 && !takeover; });
    if (stable) candidates.push({ start, end: start + 199 });
  }
  return candidates.find(({ start }) => start === 3400) || candidates[candidates.length - 1] || { start: 3400, end: 3599, unstable: true };
}
function baselineFor(rows, y) {
  const profile = {};
  for (const key of ["positive", "bed", "depth", "head"]) profile[key] = rows[0].cuts[y].profile[key].map((_, x) => mean(rows.map((row) => row.cuts[y].profile[key][x])));
  const averagePeaks = peaks(profile.positive), incumbent = averagePeaks[0] || { x: null, flux: 0, fractionTotalPositiveSouth: 0 };
  return { centroidX: finiteMean(rows.map((row) => row.cuts[y].centroidX)), modeX: incumbent.x, secondaryPeakFraction: finiteMean(rows.map((row) => row.cuts[y].secondaryPeakFraction)), totalPositiveSouth: finiteMean(rows.map((row) => row.cuts[y].totalPositiveSouth)), netSouthward: finiteMean(rows.map((row) => row.cuts[y].netSouthward)), incumbentBaselineX: incumbent.x, incumbentBaselineFluxFraction: incumbent.fractionTotalPositiveSouth, profile };
}
function closestPeak(list, x, maximumDistance = 6) { return list.filter((peak) => Math.abs(peak.x - x) <= maximumDistance).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0] || null; }
function sustained(rows, predicate) { let run = 0; for (const row of rows) { run = predicate(row) ? run + 1 : 0; if (run >= persistence) return row.step - persistence + 1; } return null; }
function corr(pairs) { const x = pairs.map((p) => p[0]), y = pairs.map((p) => p[1]), mx = mean(x), my = mean(y); const denominator = Math.sqrt(sum(x.map((v) => (v - mx) ** 2)) * sum(y.map((v) => (v - my) ** 2))); return denominator ? sum(x.map((v, i) => (v - mx) * (y[i] - my))) / denominator : null; }
function ranks(values) { return values.map((value) => 1 + values.filter((other) => other < value).length + (values.filter((other) => other === value).length - 1) / 2); }
function regression(events) { const pairs = events.filter((event) => Number.isFinite(event.step)); if (pairs.length < 3) return null; const mx = mean(pairs.map((p) => p.y)), my = mean(pairs.map((p) => p.step)); const denominator = sum(pairs.map((p) => (p.y - mx) ** 2)); const b = sum(pairs.map((p) => (p.y - mx) * (p.step - my))) / denominator, a = my - b * mx; const residuals = pairs.map((p) => ({ y: p.y, step: p.step, residual: p.step - (a + b * p.y) })); const r2 = 1 - sum(residuals.map((p) => p.residual ** 2)) / sum(pairs.map((p) => (p.step - my) ** 2)); return { a, b, r2, pearson: corr(pairs.map((p) => [p.y, p.step])), spearman: corr(ranks(pairs.map((p) => p.y)).map((rank, i) => [rank, ranks(pairs.map((p) => p.step))[i]])), residuals, adjacentDeltas: pairs.slice(0, -1).map((p, i) => ({ y: p.y, nextY: pairs[i + 1].y, delta: pairs[i + 1].step - p.step })) };
}
function main() {
  const rows = [];
  new Function("Math", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "observe", `${instrumented()}\ngenTerrain(); const sourcePoint={x:48,y:48,rate:DEFAULT_RATE,active:true}; configureSourceOutlets(sourcePoint); sources.push(sourcePoint); refreshSourceProtectionMask(); const snap=()=>({N,b,d,fT,fB,erosion:diagnosticErosion,deposition:diagnosticDeposition}); for(let stepIndex=1;stepIndex<=5100;stepIndex++){step();observe(stepIndex,snap());diagnosticErosion.fill(0);diagnosticDeposition.fill(0);}`)(Object.assign(Object.create(Math), { random: () => .3141592653 }), Float32Array, Float64Array, Int32Array, Uint8Array, (step, snapshot) => { if (!observe(step)) return; rows.push({ step, cuts: Object.fromEntries(cuts.map((y) => [y, snapshotCut(snapshot, y)])) }); if (step % 250 === 0) log(`[observe] step=${step}`); });
  const selection = baselineCandidate(rows); const baselineRows = rows.filter((row) => row.step >= selection.start && row.step <= selection.end); const baseline = Object.fromEntries(cuts.map((y) => [y, baselineFor(baselineRows, y)])); const dense = rows.filter((row) => row.step >= 3400);
  for (const y of cuts) { let previousIncumbent = baseline[y].incumbentBaselineX, previousChallenger = null; for (const row of dense) { const cut = row.cuts[y], incumbent = closestPeak(cut.peaks, previousIncumbent) || closestPeak(cut.peaks, baseline[y].incumbentBaselineX) || null; if (incumbent) previousIncumbent = incumbent.x; const candidates = cut.peaks.filter((peak) => !incumbent || Math.abs(peak.x - incumbent.x) >= 6); let challenger = previousChallenger === null ? candidates[0] : closestPeak(candidates, previousChallenger) || candidates[0] || null; if (challenger) previousChallenger = challenger.x; const inc = incumbent ? nearby(cut.profile, incumbent.x) : null, cha = challenger ? nearby(cut.profile, challenger.x) : null; cut.route = { incumbentX: incumbent?.x ?? null, incumbentFlux: incumbent?.flux ?? 0, incumbentFraction: incumbent?.fractionTotalPositiveSouth ?? 0, challengerX: challenger?.x ?? null, challengerFlux: challenger?.flux ?? 0, challengerFraction: challenger?.fractionTotalPositiveSouth ?? 0, shareDifference: (challenger?.fractionTotalPositiveSouth ?? 0) - (incumbent?.fractionTotalPositiveSouth ?? 0), incumbent: inc, challenger: cha, deltaBedPreference: cha && inc ? cha.meanBed - inc.meanBed : null, deltaHeadPreference: cha && inc ? cha.meanHead - inc.meanHead : null, deltaDepth: cha && inc ? cha.meanDepth - inc.meanDepth : null, morphAdvantage: cha && inc ? (cha.depositionStep - cha.erosionStep) - (inc.depositionStep - inc.erosionStep) : null, erosionDifference: cha && inc ? cha.erosionStep - inc.erosionStep : null, depositionDifference: cha && inc ? cha.depositionStep - inc.depositionStep : null }; } }
  const cutResults = {};
  for (const y of cuts) { const sequence = dense.map((row) => ({ step: row.step, ...row.cuts[y] })), b = baseline[y]; const meaningful = (entry) => entry && entry.totalPositiveSouth >= .25 * b.totalPositiveSouth && Math.abs(entry.netSouthward) >= .25 * Math.abs(b.netSouthward); const competition = sustained(sequence, (entry) => entry.route.challengerFraction >= .25); const takeover = sustained(sequence, (entry) => entry.route.challengerFlux > entry.route.incumbentFlux && entry.route.challengerFraction >= .35); const dominant = sustained(sequence, (entry) => entry.route.challengerFraction >= .55); const routeAt = (step) => sequence.find((entry) => entry.step === step); const takeRow = routeAt(takeover); const pre = takeover ? sequence.filter((entry) => entry.step >= takeover - 100 && entry.step < takeover) : []; const accumulated = (route, field) => sum(pre.map((entry) => entry.route[route]?.[field] || 0)); cutResults[y] = { y, baseline: b, firstChallengerAppearance: sequence.find((entry) => entry.route.challengerX !== null)?.step ?? null, firstPersistentCompetition: competition, firstTakeoverStep: takeover, firstDominantTakeover: dominant, challengerSide: takeRow?.route?.challengerX == null ? null : Math.sign(takeRow.route.challengerX - b.incumbentBaselineX), competitionLowFlux: competition ? !meaningful(routeAt(competition)) : null, takeoverLowFlux: takeover ? !meaningful(takeRow) : null, firstPersistentBedPreference: sustained(sequence, (entry) => entry.route.deltaBedPreference !== null && entry.route.deltaBedPreference < 0), firstPersistentHeadPreference: sustained(sequence, (entry) => entry.route.deltaHeadPreference !== null && entry.route.deltaHeadPreference < 0), preTakeoverMorphology: takeover ? { cumErosionIncumbent: accumulated("incumbent", "erosionStep"), cumDepositionIncumbent: accumulated("incumbent", "depositionStep"), cumErosionChallenger: accumulated("challenger", "erosionStep"), cumDepositionChallenger: accumulated("challenger", "depositionStep"), netBedIncumbent: accumulated("incumbent", "depositionStep") - accumulated("incumbent", "erosionStep"), netBedChallenger: accumulated("challenger", "depositionStep") - accumulated("challenger", "erosionStep") } : null };
  }
  const historical = { 56: 4485, 60: 4400, 64: 4436, 68: 4506, 72: 4577, 76: 4588, 80: 4575, 84: 4561, 88: 4645, 92: 4735 };
  const active = activeCuts.map((y) => cutResults[y]); const sides = active.filter((result) => result.challengerSide !== null); const sameSide = sides.filter((result) => result.challengerSide === -1).length / Math.max(sides.length, 1); const competitionEvents = active.map((result) => ({ y: result.y, step: result.firstPersistentCompetition })); const takeoverEvents = active.map((result) => ({ y: result.y, step: result.firstTakeoverStep })); const competitionFront = regression(competitionEvents), takeoverFront = regression(takeoverEvents); const validTakeovers = active.filter((result) => result.firstTakeoverStep && !result.takeoverLowFlux); const corridor = sameSide >= .75 && competitionFront?.r2 >= .5 && validTakeovers.length >= 3; const classification = corridor ? "ROUTE-COMP A — ONE COMPETING CORRIDOR PROPAGATES DOWNSTREAM" : active.some((result) => result.firstPersistentCompetition) ? "ROUTE-COMP C — MULTIMODAL REDISTRIBUTION WITHOUT TAKEOVER" : "ROUTE-COMP D — NO ROBUST ROUTE COMPETITION";
  const timeline = keySteps.map((step) => { const row = rows.find((entry) => entry.step === step); return { step, cuts: Object.fromEntries(activeCuts.map((y) => { const c = row?.cuts[y], r = c?.route; return [y, c ? { incumbentX: r.incumbentX, incumbentFraction: r.incumbentFraction, challengerX: r.challengerX, challengerFraction: r.challengerFraction, shareDifference: r.shareDifference, totalPositiveSouth: c.totalPositiveSouth, netSouthward: c.netSouthward, deltaBedPreference: r.deltaBedPreference, deltaHeadPreference: r.deltaHeadPreference } : null]; })) }; });
  // Full 192-cell profiles preserve route evidence independently of peak summaries.
  const series = dense.map((row) => ({ step: row.step, cuts: Object.fromEntries(cuts.map((y) => { const c = row.cuts[y], r = c.route; return [y, { positiveSouthProfile: c.profile.positive, peaks: c.peaks, totalPositiveSouth: c.totalPositiveSouth, grossSouthward: c.grossSouthward, grossNorthward: c.grossNorthward, netSouthward: c.netSouthward, incumbentX: r.incumbentX, incumbentFlux: r.incumbentFlux, incumbentFraction: r.incumbentFraction, challengerX: r.challengerX, challengerFlux: r.challengerFlux, challengerFraction: r.challengerFraction, shareDifference: r.shareDifference, deltaBedPreference: r.deltaBedPreference, deltaHeadPreference: r.deltaHeadPreference, deltaDepth: r.deltaDepth, morphAdvantage: r.morphAdvantage, erosionDifference: r.erosionDifference, depositionDifference: r.depositionDifference }]; })) }));
  const summary = { controls: { run: "CURRENT only", deterministicRandom: .3141592653, simulationSteps: 5100, snapshotCadence: "1000,2500,3200; every step 3400..5100", productionSimulationModified: false, productionPhysicsModified: false }, methodology: { cuts: "horizontal absolute-grid boundaries y=52..96", causalZone: "y=56..92; y=96 downstream boundary only", faceFlux: "southward=fB[(y-1)N+x]; northward=fT[yN+x]; positiveSouth=max(0,southward-northward)", smoothing: "[1,2,1]/4", peakThreshold: ">=5% local maximum; minimum separation 4 cells", persistenceSteps: persistence }, baselineSelection: { ...selection, requestedWindowStable: selection.start === 3400 && !selection.unstable }, baseline, cutResults, propagation: { competition: competitionFront, takeover: takeoverFront, sameNegativeChallengerSideFraction: sameSide, historicalCentroidShifts: historical, comparison: active.map((result) => ({ y: result.y, competitionStep: result.firstPersistentCompetition, takeoverStep: result.firstTakeoverStep, centroidShiftStep: historical[result.y], competitionPrecedesCentroidShift: result.firstPersistentCompetition !== null && result.firstPersistentCompetition < historical[result.y] })) }, timeline, series, classification, causalSubclassification: null, completedAt: new Date().toISOString() };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); fs.writeFileSync(completePath, `${classification}\ncompletedAt: ${summary.completedAt}\n`); log(`[complete] ${classification}`); console.log(classification);
}
try { main(); } catch (error) { log(`[failed] ${error.stack || error.message}`); throw error; }
