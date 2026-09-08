/**
 * CATEGORY: OFFLINE DIAGNOSTIC
 * PURPOSE: Characterizes spatial flux-profile non-stationarity without assigning route identities.
 * INPUT: tests/generated/route-competition/summary.json
 * OUTPUT: tests/generated/flux-profile-dynamics/summary.json and COMPLETE
 * RUN: node tests/diagnostics/analyze-flux-profile-dynamics.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const inputPath = path.join(root, "tests/generated/route-competition/summary.json");
const outputDirectory = path.join(root, "tests/generated/flux-profile-dynamics");
const cuts = [52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96];
const activeCuts = cuts.slice(1, -1);
const lags = [1, 5, 20, 50, 100, 200];
const keySteps = [4400, 4485, 4600, 4683, 4750, 4811, 4824, 4900, 4969, 5000];
const periods = [[3400, 4000], [4000, 4400], [4400, 4750], [4750, 4824], [4824, 4969], [4969, 5100]];
const epsilon = 1e-15;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => values.length ? sum(values) / values.length : null;
const standardDeviation = (values) => {
  const average = mean(values);
  return average === null ? null : Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};
const finite = (value) => Number.isFinite(value) ? value : null;
const cleanMean = (values) => mean(values.filter(Number.isFinite));
const normalise = (profile) => {
  const total = sum(profile);
  return total > epsilon ? profile.map((value) => value / total) : null;
};
const js = (left, right) => {
  if (!left || !right) return null;
  let divergence = 0;
  for (let x = 0; x < left.length; x++) {
    const p = Math.max(left[x], epsilon), q = Math.max(right[x], epsilon), midpoint = (p + q) / 2;
    divergence += .5 * p * Math.log(p / midpoint) + .5 * q * Math.log(q / midpoint);
  }
  return divergence;
};
const l1 = (left, right) => left && right ? sum(left.map((value, x) => Math.abs(value - right[x]))) : null;
const w1 = (left, right) => {
  if (!left || !right) return null;
  let cumulative = 0, distance = 0;
  for (let x = 0; x < left.length; x++) { cumulative += left[x] - right[x]; distance += Math.abs(cumulative); }
  return distance;
};
const distributionMetrics = (profile) => {
  const probability = normalise(profile);
  if (!probability) return { entropy: null, effectiveWidth: null, participationRatio: null, top1CellFraction: null, top5CellsFraction: null, top10CellsFraction: null, top20CellsFraction: null, centroidX: null, stdX: null };
  const entropy = -sum(probability.filter((value) => value > 0).map((value) => value * Math.log(value)));
  const centroidX = sum(probability.map((value, x) => value * x));
  const sorted = [...probability].sort((a, b) => b - a);
  return { entropy, effectiveWidth: Math.exp(entropy), participationRatio: 1 / sum(probability.map((value) => value ** 2)), top1CellFraction: sum(sorted.slice(0, 1)), top5CellsFraction: sum(sorted.slice(0, 5)), top10CellsFraction: sum(sorted.slice(0, 10)), top20CellsFraction: sum(sorted.slice(0, 20)), centroidX, stdX: Math.sqrt(sum(probability.map((value, x) => value * (x - centroidX) ** 2))) };
};
const meanProfile = (cumulative, start, end) => {
  if (start < 0 || end <= start) return null;
  const width = cumulative[0].length, count = end - start;
  return normalise(Array.from({ length: width }, (_, x) => (cumulative[end][x] - cumulative[start][x]) / count));
};
const changes = (series) => series.map((row, index) => {
  if (index < 50 || index + 50 >= series.length) return null;
  const left = series.slice(index - 50, index).filter(Number.isFinite), right = series.slice(index + 1, index + 51).filter(Number.isFinite);
  const leftMean = mean(left), rightMean = mean(right), leftVariance = standardDeviation(left) ** 2, rightVariance = standardDeviation(right) ** 2;
  const pooled = Math.sqrt((leftVariance + rightVariance) / 2);
  return pooled > epsilon ? Math.abs(rightMean - leftMean) / pooled : (Math.abs(rightMean - leftMean) > epsilon ? Infinity : 0);
});
const correlation = (left, right) => {
  const pairs = left.map((value, index) => [value, right[index]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pairs.length < 3) return null;
  const aMean = mean(pairs.map((pair) => pair[0])), bMean = mean(pairs.map((pair) => pair[1]));
  const divisor = Math.sqrt(sum(pairs.map(([a]) => (a - aMean) ** 2)) * sum(pairs.map(([, b]) => (b - bMean) ** 2)));
  return divisor > epsilon ? sum(pairs.map(([a, b]) => (a - aMean) * (b - bMean))) / divisor : null;
};
const crossCorrelation = (upper, lower) => {
  const candidates = [];
  for (let lag = -150; lag <= 150; lag++) {
    const pairs = upper.map((value, index) => [value, lower[index + lag]]).filter(([, value]) => value !== undefined);
    const value = correlation(pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1]));
    if (value !== null) candidates.push({ lag, correlation: value });
  }
  return candidates.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation) || b.correlation - a.correlation)[0] || null;
};
const periodSummary = (rows, start, end) => {
  const selected = rows.filter((row) => row.step >= start && row.step < end);
  return { start, end: end - 1, meanTotalPositiveSouth: cleanMean(selected.map((row) => row.totalPositiveSouth)), meanEffectiveWidth: cleanMean(selected.map((row) => row.effectiveWidth)), meanShapeChangeRate: cleanMean(selected.map((row) => row.shapeChangeRate)), meanProfileDrift100: cleanMean(selected.map((row) => row.profileDrift100)) };
};
const groupedEvents = (rows, key) => {
  const groups = [];
  for (const row of rows.filter((entry) => entry[key] >= 5)) {
    const previous = groups[groups.length - 1];
    if (!previous || row.step > previous.end + 1) groups.push({ start: row.step, end: row.step, peakStep: row.step, score: row[key] });
    else { previous.end = row.step; if (row[key] > previous.score) { previous.peakStep = row.step; previous.score = row[key]; } }
  }
  return groups;
};
function classify(cutSummaries, propagation) {
  const active = cutSummaries.filter((summary) => summary.y >= 56 && summary.y <= 92);
  const average = (key) => cleanMean(active.map((summary) => summary.summary[key]));
  const drift = average("meanProfileDrift100"), rapid = average("meanShapeChangeRate"), within = average("meanWithinWindowJS100");
  const changePoints = sum(active.map((summary) => summary.changePoints.shapeChangeRate.length));
  const positiveLag = propagation.fractionPositiveLag;
  if (positiveLag !== null && positiveLag >= .7 && propagation.medianPropagationLag > 0 && propagation.meanBestCorrelation >= .5) return "PROFILE D — PROPAGATING PROFILE REORGANIZATION";
  if (positiveLag !== null && positiveLag <= .35 && changePoints >= 8) return "PROFILE E — GLOBAL DISTRIBUTED REORGANIZATION";
  if (drift !== null && rapid !== null && within !== null && drift > 0 && rapid > 0 && within > 0) return "PROFILE F — MIXED MULTISCALE NONSTATIONARITY";
  return "PROFILE B — SLOW CONTINUOUS DRIFT";
}
function main() {
  const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const inputRows = source.series.filter((row) => row.step >= 3400 && row.step <= 5100);
  const byCut = {}, allRows = [];
  for (const y of cuts) {
    const rows = inputRows.map((sourceRow) => {
      const cut = sourceRow.cuts[y], profile = cut.positiveSouthProfile, metrics = distributionMetrics(profile);
      return { step: sourceRow.step, totalPositiveSouth: cut.totalPositiveSouth, netSouthward: cut.netSouthward, probability: normalise(profile), ...metrics };
    });
    const cumulative = [new Float64Array(inputRows[0].cuts[y].positiveSouthProfile.length)];
    for (const row of rows) {
      const next = new Float64Array(cumulative[cumulative.length - 1]);
      for (let x = 0; x < next.length; x++) next[x] += row.probability?.[x] || 0;
      cumulative.push(next);
    }
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], previous = rows[index - 1];
      row.amplitudeChangeRate = previous ? Math.abs(row.totalPositiveSouth - previous.totalPositiveSouth) : null;
      row.shapeChangeRate = previous ? js(row.probability, previous.probability) : null;
      row.deltaCentroid1 = previous && row.centroidX !== null && previous.centroidX !== null ? row.centroidX - previous.centroidX : null;
      row.deltaStd1 = previous && row.stdX !== null && previous.stdX !== null ? row.stdX - previous.stdX : null;
      for (const lag of lags) { const reference = rows[index - lag]; row[`l1Lag${lag}`] = reference ? l1(row.probability, reference.probability) : null; row[`jsLag${lag}`] = reference ? js(row.probability, reference.probability) : null; if ([1, 20, 100].includes(lag)) row[`w1Lag${lag}`] = reference ? w1(row.probability, reference.probability) : null; }
      for (const window of [100, 200]) {
        const start = Math.max(0, index - window + 1), currentMean = meanProfile(cumulative, start, index + 1), priorMean = index + 1 >= 2 * window ? meanProfile(cumulative, index - 2 * window + 1, index - window + 1) : null;
        row[`withinWindowJS${window}`] = js(row.probability, currentMean);
        row[`profileDrift${window}`] = js(currentMean, priorMean);
      }
      const twenty = rows[index - 20];
      row.deltaCentroid20 = twenty && row.centroidX !== null && twenty.centroidX !== null ? row.centroidX - twenty.centroidX : null;
      row.deltaStd20 = twenty && row.stdX !== null && twenty.stdX !== null ? row.stdX - twenty.stdX : null;
    }
    const shapeScores = changes(rows.map((row) => row.shapeChangeRate));
    const amplitudeScores = changes(rows.map((row) => row.totalPositiveSouth));
    rows.forEach((row, index) => { row.shapeChangeScore50 = finite(shapeScores[index]); row.amplitudeChangeScore50 = finite(amplitudeScores[index]); });
    const summary = { meanTotalPositiveSouth: cleanMean(rows.map((row) => row.totalPositiveSouth)), meanEffectiveWidth: cleanMean(rows.map((row) => row.effectiveWidth)), meanShapeChangeRate: cleanMean(rows.map((row) => row.shapeChangeRate)), meanProfileDrift100: cleanMean(rows.map((row) => row.profileDrift100)), meanWithinWindowJS100: cleanMean(rows.map((row) => row.withinWindowJS100)) };
    byCut[y] = { y, summary, periods: periods.map(([start, end]) => periodSummary(rows, start, end)), changePoints: { shapeChangeRate: groupedEvents(rows, "shapeChangeScore50"), totalPositiveSouth: groupedEvents(rows, "amplitudeChangeScore50") }, keySteps: Object.fromEntries(keySteps.map((step) => [step, rows.find((row) => row.step === step)])), rows };
    allRows.push(...rows.map((row) => ({ y, ...row })));
  }
  const adjacent = activeCuts.slice(0, -1).map((y) => ({ fromY: y, toY: y + 4, ...crossCorrelation(byCut[y].rows.map((row) => row.shapeChangeRate), byCut[y + 4].rows.map((row) => row.shapeChangeRate)) }));
  const validLags = adjacent.filter((entry) => entry.lag !== null);
  const sortedLags = validLags.map((entry) => entry.lag).sort((a, b) => a - b);
  const propagation = { adjacent, medianPropagationLag: sortedLags.length ? sortedLags[Math.floor(sortedLags.length / 2)] : null, fractionPositiveLag: validLags.length ? validLags.filter((entry) => entry.lag > 0).length / validLags.length : null, cumulativeLag56to92: validLags.length === 9 ? sum(validLags.map((entry) => entry.lag)) : null };
  propagation.meanBestCorrelation = cleanMean(validLags.map((entry) => entry.correlation));
  const acrossCuts = inputRows.map((sourceRow, index) => {
    const active = activeCuts.map((y) => byCut[y].rows[index]);
    const shapes = active.map((row) => row.shapeChangeRate);
    return { step: sourceRow.step, meanShapeChangeAcrossCuts: cleanMean(shapes), maxShapeChangeAcrossCuts: Math.max(...shapes.filter(Number.isFinite), 0), numberCutsWithShapeChangeZ5: active.filter((row) => row.shapeChangeScore50 >= 5).length, shapeChangeCorrelation: activeCuts.slice(0, -1).map((y) => correlation(byCut[y].rows.slice(Math.max(0, index - 50), index + 1).map((row) => row.shapeChangeRate), byCut[y + 4].rows.slice(Math.max(0, index - 50), index + 1).map((row) => row.shapeChangeRate))) };
  });
  const classification = classify(Object.values(byCut), propagation);
  const outputCuts = Object.fromEntries(cuts.map((y) => {
    const cut = byCut[y];
    const serialRows = cut.rows.map(({ probability, ...row }) => row);
    const serialKeySteps = Object.fromEntries(Object.entries(cut.keySteps).map(([step, row]) => { const { probability, ...metric } = row; return [step, metric]; }));
    return [y, { ...cut, keySteps: serialKeySteps, rows: serialRows }];
  }));
  const historicalCentroids = source.propagation?.historicalCentroidShifts || null;
  const result = { controls: { analysis: "OFFLINE ONLY", source: "tests/generated/route-competition/summary.json", simulationExecuted: false, productionModified: false }, methodology: { shape: "P_t(x)=positiveSouthProfile[x]/totalPositiveSouth", lags, windowSizes: [100, 200], changePoint: "50-step left/right mean comparison; score=absolute difference / pooled standard deviation", propagationConvention: "positive lag: change at y precedes y+4" }, classification, cuts: outputCuts, propagation, comparisonToHistoricalCentroidReferences: historicalCentroids ? { values: historicalCentroids, adjacentDeltas: activeCuts.slice(0, -1).map((y) => ({ fromY: y, toY: y + 4, delta: historicalCentroids[y + 4] - historicalCentroids[y] })) } : null, acrossCuts, completedAt: new Date().toISOString() };
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "summary.json"), JSON.stringify(result));
  fs.writeFileSync(path.join(outputDirectory, "COMPLETE"), `${classification}\ncompletedAt: ${result.completedAt}\n`);
  console.log(classification);
}
main();
