const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine, root } = require('../helpers/engine');
const scenarios = [
  { name: 'valley-20000', preset: 'valley', seed: 314159265, count: 20000, boundary: 'open', sources: [[107, 22, 2.2]] },
  { name: 'historical-natural-10000', preset: 'natural', seed: 314159265, count: 10000, boundary: 'open', sources: [[48, 48, 2.2]] },
  { name: 'multisource-10000', preset: 'natural', seed: 271828182, count: 10000, boundary: 'closed', sources: [[36, 43, 2.2], [132, 70, 4], [55, 146, 1]] },
  { name: 'rain-basin-5000', preset: 'basin', seed: 987654321, count: 5000, boundary: 'closed', rainfall: .00001, sources: [] },
];
const results = [];
for (const scenario of scenarios.filter(s => !process.argv[2] || s.name === process.argv[2])) {
  const e = createEngine(); e.init({ seed: scenario.seed, preset: scenario.preset });
  e.options.boundary = scenario.boundary; e.options.rainfall = scenario.rainfall || 0;
  for (const source of scenario.sources) e.addSource(...source);
  const started = performance.now(), checkpoints = [];
  let maxWaterError = 0, maxSolidError = 0;
  for (let step = 1; step <= scenario.count; step++) {
    e.step();
    if (step % 1000 !== 0) continue;
    const stats = e.stats(), f = e.fields();
    assert.ok(stats.finite && stats.minWater >= 0 && stats.minSediment >= 0, 'nonnegative, finite state');
    for (const key of ['b', 'd', 's', 'u', 'v', 'fL', 'fR', 'fT', 'fB']) assert.ok(f[key].every(Number.isFinite), `${key} finite`);
    for (let i = 0; i < f.b.length; i++) assert.ok(f.b[i] >= f.bedrock[i] - 1e-12, 'bedrock');
    maxWaterError = Math.max(maxWaterError, Math.abs(stats.waterResidual));
    maxSolidError = Math.max(maxSolidError, Math.abs(stats.solidResidual));
    assert.ok(maxWaterError < 1e-7 && maxSolidError < 1e-7, 'conservation');
    checkpoints.push(stats);
    console.log(`${scenario.name}: ${step}/${scenario.count}, water error=${stats.waterResidual.toExponential(2)}, solid error=${stats.solidResidual.toExponential(2)}, elapsed=${((performance.now()-started)/1000).toFixed(1)}s`);
  }
  const stats = e.stats(), f = e.fields();
  let erodedOutsideSource = 0, depositedOutsideSource = 0;
  for (let i = 0; i < f.b.length; i++) {
    const x = i % 192, y = Math.floor(i / 192);
    if (scenario.sources.some(([sx, sy]) => Math.hypot(sx - x, sy - y) <= 8)) continue;
    if (f.bInit[i] - f.b[i] > 1e-5) erodedOutsideSource++;
    if (f.b[i] - f.bInit[i] > 1e-5) depositedOutsideSource++;
  }
  assert.ok(stats.eroded > 0 && stats.deposited > 0, 'active erosion and deposition');
  assert.ok(erodedOutsideSource > 50 && depositedOutsideSource > 20, 'morphology beyond source crater');
  if (scenario.boundary === 'closed') assert.equal(stats.waterOut, 0);
  if (scenario.name === 'valley-20000') {
    assert.ok(stats.waterOut > 100, 'real outlet');
    assert.ok(checkpoints.at(-1).waterOut - checkpoints.at(-2).waterOut > 10, 'late outflow remains active');
    const beforeStop = stats.water;
    for (const source of e.sources()) source.active = false;
    for (let i = 0; i < 1500; i++) e.step();
    assert.ok(e.stats().water < beforeStop * .9, 'stopping source actually drains river');
  }
  results.push({ scenario, checkpoints, maxWaterError, maxSolidError, erodedOutsideSource, depositedOutsideSource,
    elapsedSeconds: (performance.now() - started) / 1000, afterSourceStop: e.stats() });
}
assert.ok(results.length > 0, 'unknown scenario');
const out = path.join(root, 'tests/generated/v2-validation'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, process.argv[2] ? `long-run-${process.argv[2]}.json` : 'long-run.json'), JSON.stringify({ passed: true, results }, null, 2));
console.log(`PASS: ${results.length} long-run scenarios`);
