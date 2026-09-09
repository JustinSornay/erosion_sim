/**
 * CATEGORY: OFFLINE DIAGNOSTIC
 * PURPOSE: Audits persisted reference-depth capacity results without executing simulation physics.
 * INPUT: tests/generated/reference-depth-concentration-capacity/summary.json
 * RUN: node tests/diagnostics/analyze-reference-depth-capacity.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const input = path.join(root, "tests/generated/reference-depth-concentration-capacity/summary.json");
const output = path.join(root, "tests/generated/reference-depth-capacity-audit");
const checkpoints = [1000, 2500, 5000, 7500, 10000];
const epsilon = 1e-30;
const sourceY = 48;
const metrics = ["grossErosion", "grossDeposition", "grossTurnover", "absoluteNetBedChange", "suspendedSedimentMass", "netErosion"];
const ratio = (numerator, denominator) => numerator / Math.max(Math.abs(denominator), epsilon);
const number = (value) => Number.isFinite(value) ? value : null;

function validPositive(run) {
  const { validation } = run;
  return !validation.stop && !validation.preTransportNegative && validation.numberNegativeS === 0 && validation.numberNegativeTmpS === 0 && validation.allFinite;
}
function validConservation(run) {
  const { conservation, sedimentBudget } = run;
  return Math.abs(conservation.netTransportResidual) <= 1e-5 && Math.abs(conservation.netTransportResidual) / Math.max(conservation.totalSedimentThroughput, epsilon) <= 1e-6 && sedimentBudget.relativeBudgetResidual <= 1e-6;
}
function relativeCentroids(morphology) {
  return {
    erosionCentroidRelativeToSource: morphology.erosionCentroidY - sourceY,
    depositionCentroidRelativeToSource: morphology.depositionCentroidY - sourceY,
  };
}
function coverage(morphology) {
  const bandErosion = morphology.spatialBands.reduce((total, band) => total + band.grossErosion, 0);
  const bandDeposition = morphology.spatialBands.reduce((total, band) => total + band.grossDeposition, 0);
  const coveredErosionShare = bandErosion / Math.max(morphology.grossErosion, epsilon);
  const coveredDepositionShare = bandDeposition / Math.max(morphology.grossDeposition, epsilon);
  return { coveredErosionShare, coveredDepositionShare, unreportedUpstreamErosionShare: 1 - coveredErosionShare, unreportedUpstreamDepositionShare: 1 - coveredDepositionShare, status: 1 - coveredErosionShare > .2 || 1 - coveredDepositionShare > .2 ? "INCOMPLETE SPATIAL COVERAGE" : "COMPLETE SPATIAL COVERAGE" };
}
function main() {
  const source = JSON.parse(fs.readFileSync(input, "utf8"));
  const variants = Object.fromEntries(source.variants.map((variant) => [variant.name, variant]));
  const legacy = variants.POSITIVE_LEGACY_MASS_CAPACITY;
  const candidate = variants.POSITIVE_REFERENCE_DEPTH_CONCENTRATION;
  if (!legacy || !candidate) throw new Error("Expected variants missing from persisted summary");
  const criteria = {
    positivity: validPositive(legacy) && validPositive(candidate),
    conservation: validConservation(legacy) && validConservation(candidate),
    erosionRatio_0_5_to_2: source.activityRatiosAt10000.grossErosion >= .5 && source.activityRatiosAt10000.grossErosion <= 2,
    turnoverRatio_0_5_to_2: source.activityRatiosAt10000.grossTurnover >= .5 && source.activityRatiosAt10000.grossTurnover <= 2,
    cutRetentionAtLeast70Percent: source.cutRetentionAt10000.cutRetention >= .7,
    driftRatioAtMost1_25: source.profiles4750to5500.ratios.meanWeightedDrift100 <= 1.25,
    transportDistanceImprovement: candidate.checkpoints[10000].morphology.transportDistanceY > legacy.checkpoints[10000].morphology.transportDistanceY,
  };
  const checkpointComparison = checkpoints.map((step) => {
    const l = legacy.checkpoints[step].morphology;
    const c = candidate.checkpoints[step].morphology;
    return {
      step,
      ratios: Object.fromEntries(metrics.map((metric) => [metric, ratio(c[metric], l[metric])])),
      legacyCentroids: { erosionCentroidY: l.erosionCentroidY, depositionCentroidY: l.depositionCentroidY, transportDistanceY: l.transportDistanceY, ...relativeCentroids(l) },
      candidateCentroids: { erosionCentroidY: c.erosionCentroidY, depositionCentroidY: c.depositionCentroidY, transportDistanceY: c.transportDistanceY, ...relativeCentroids(c) },
      centroidDeltaCandidateMinusLegacy: { erosionCentroidY: c.erosionCentroidY - l.erosionCentroidY, depositionCentroidY: c.depositionCentroidY - l.depositionCentroidY, transportDistanceY: c.transportDistanceY - l.transportDistanceY },
      legacyDepthAboveRef: legacy.checkpoints[step].depthAudit,
      candidateDepthAboveRef: candidate.checkpoints[step].depthAudit,
      candidateTargetRatio: candidate.checkpoints[step].depthAudit.targetRatioDistribution,
    };
  });
  const firstMaterialMorphDifference = checkpointComparison.find(({ ratios }) => Object.values(ratios).some((value) => value < .9 || value > 1.1));
  const quantiles = [5000, 10000].map((step) => {
    const l = legacy.checkpoints[step].morphology;
    const c = candidate.checkpoints[step].morphology;
    const attachRelative = (values) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { y: value, relativeToSource: value - sourceY }]));
    return { step, legacy: { erosion: attachRelative(l.erosionQuantilesY), deposition: attachRelative(l.depositionQuantilesY) }, candidate: { erosion: attachRelative(c.erosionQuantilesY), deposition: attachRelative(c.depositionQuantilesY) } };
  });
  const coverageAudit = [5000, 10000].map((step) => ({ step, legacy: coverage(legacy.checkpoints[step].morphology), candidate: coverage(candidate.checkpoints[step].morphology) }));
  const persistedBands = candidate.checkpoints[10000].morphology.spatialBands.map((band, index) => {
    const other = legacy.checkpoints[10000].morphology.spatialBands[index];
    return { range: `${band.from}..${band.to}`, legacy: { grossErosion: other.grossErosion, grossDeposition: other.grossDeposition, absoluteNetBedChange: other.absoluteNetBedChange }, candidate: { grossErosion: band.grossErosion, grossDeposition: band.grossDeposition, absoluteNetBedChange: band.absoluteNetBedChange }, ratios: { grossErosion: ratio(band.grossErosion, other.grossErosion), grossDeposition: ratio(band.grossDeposition, other.grossDeposition), absoluteNetBedChange: ratio(band.absoluteNetBedChange, other.absoluteNetBedChange) } };
  });
  const cuts = source.cutComparison.map(({ step, cuts: rows }) => {
    const normalized = rows.map((row) => ({ ...row, ratioAbsNet: Math.abs(row.candidateNetSouthward) / Math.max(Math.abs(row.legacyNetSouthward), epsilon), ratioPositiveSouth: ratio(row.candidateTotalPositiveSouth, row.legacyTotalPositiveSouth) }));
    return { step, firstYRatioAbsNetBelowPoint8: normalized.find((row) => row.ratioAbsNet < .8)?.y ?? null, rows: normalized };
  });
  const l10000 = legacy.checkpoints[10000].morphology;
  const c10000 = candidate.checkpoints[10000].morphology;
  const centroidMechanism = { deltaErosionCentroidY: c10000.erosionCentroidY - l10000.erosionCentroidY, deltaDepositionCentroidY: c10000.depositionCentroidY - l10000.depositionCentroidY, deltaTransportDistanceY: c10000.transportDistanceY - l10000.transportDistanceY, interpretation: "A: erosion shifts downstream more than deposition." };
  const incompleteCoverage = coverageAudit.some(({ legacy: l, candidate: c }) => l.status !== "COMPLETE SPATIAL COVERAGE" || c.status !== "COMPLETE SPATIAL COVERAGE");
  const verdict = incompleteCoverage ? "CAPACITY-AUDIT E — CURRENT BANDING MISSES TOO MUCH UPSTREAM MORPHOLOGY TO INTERPRET SPATIAL EFFECT RELIABLY" : centroidMechanism.deltaErosionCentroidY > 0 && Math.abs(centroidMechanism.deltaErosionCentroidY) > Math.abs(centroidMechanism.deltaDepositionCentroidY) ? "CAPACITY-AUDIT A — DEEP-WATER AMPLIFICATION SHIFTS EROSION THE WRONG WAY" : "CAPACITY-AUDIT D — CANDIDATE DIFFERENCE IS SMALL / CHAOTIC, NO CLEAR SPATIAL MECHANISM";
  const summary = { purpose: "Offline audit of persisted reference-depth concentration capacity experiment; no simulation executed.", input, criteria, criteriaFailure: Object.entries(criteria).filter(([, passed]) => !passed).map(([name]) => name), firstCheckpointWithMaterialMorphDifference: firstMaterialMorphDifference?.step ?? null, checkpointComparison, quantiles, coverageAudit, persistedBandsAt10000: persistedBands, cuts, centroidMechanism, profiles4750to5500: source.profiles4750to5500, performance: source.performance, verdict, completedAt: new Date().toISOString() };
  fs.mkdirSync(output, { recursive: true });
  fs.rmSync(path.join(output, "COMPLETE"), { force: true });
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(output, "COMPLETE"), `verdict: ${verdict}\ncompletedAt: ${summary.completedAt}\n`);
  console.log(verdict);
}
main();
