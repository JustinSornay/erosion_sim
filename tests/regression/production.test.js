const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine, root } = require('../helpers/engine');
const sum = array => array.reduce((total, value) => total + value, 0);
const close = (actual, expected, tol = 1e-8, label = '') => assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} vs ${expected}, tolerance ${tol}`);
function engine(preset = 'valley', seed = 314159265) { const e = createEngine(); e.init({ seed, preset }); return e; }
function advance(e, count) { for (let i = 0; i < count; i++) e.step(); }
function valid(e, tolerance = 1e-8) {
  const s = e.stats(); assert.ok(s.finite); assert.ok(s.minWater >= 0); assert.ok(s.minSediment >= 0);
  close(s.waterResidual, 0, tolerance, 'water'); close(s.solidResidual, 0, tolerance, 'solid');
  const f = e.fields(); for (let i = 0; i < f.b.length; i++) assert.ok(f.b[i] >= f.bedrock[i] - 1e-12);
}

test('A dry scene neither erodes nor manufactures water', () => {
  const e = engine(), before = e.fields().b.slice(); advance(e, 100);
  assert.deepEqual(e.fields().b, before); assert.equal(e.stats().water, 0); assert.equal(e.stats().eroded, 0); valid(e);
});

test('Point injection lands at the exact centre, edges and all four corners', () => {
  const e = engine(), { N, DT } = e.constants;
  for (const [x, y] of [[48, 48], [0, 80], [191, 80], [80, 0], [80, 191], [0, 0], [0, 191], [191, 0], [191, 191]]) {
    e.init({ seed: 1 }); const bed = e.fields().b.slice(); const source = e.addSource(x, y, 2.2);
    e.injectSources(); const d = e.fields().d;
    assert.equal(source.outletCount, 1); close(d[y * N + x], 2.2 * DT, 1e-15);
    assert.equal(d.filter(value => value !== 0).length, 1); assert.deepEqual(e.fields().b, bed); valid(e);
  }
});

test('Disabled sources inject nothing; colocated sources add their actual volume', () => {
  const e = engine(); e.addSource(40, 50, 3); const off = e.addSource(40, 50, 7); off.active = false;
  e.injectSources(); close(e.stats().injected, 3 * e.constants.DT);
  off.active = true; e.injectSources(); close(e.stats().injected, 13 * e.constants.DT); valid(e);
});

test('Invalid source coordinates and rates are rejected', () => {
  const e = engine();
  for (const coords of [[-1, 2, 1], [192, 2, 1], [4.5, 2, 1], [4, NaN, 1], [4, 2, Infinity], [4, 2, -1], [4, 2, 101]])
    assert.throws(() => e.addSource(...coords));
  assert.equal(e.sources().length, 0);
});

test('Source configuration never excavates or protects a hidden rock collar', () => {
  const e = engine(); const before = e.fields().b.slice(); e.addSource(96, 96);
  assert.deepEqual(e.fields().b, before); assert.ok(e.fields().sourceProtectionMask.every(value => value === 1));
});

test('All terrain presets reproduce exactly from a seed; seeds actually differ', () => {
  const e = engine();
  for (const preset of ['natural', 'valley', 'basin', 'ridge']) {
    e.init({ seed: 314159265, preset }); const before = e.fields().b.slice();
    e.addSource(1, 1); advance(e, 2); e.init({ seed: 314159265, preset });
    assert.deepEqual(e.fields().b, before); assert.equal(e.stats().steps, 0); assert.equal(e.sources().length, 0);
    e.init({ seed: 271828182, preset }); assert.notDeepEqual(e.fields().b, before);
  }
});

test('Invalid terrain requests fail before live state is mutated', () => {
  const e = engine(); const before = e.fields().b;
  for (const options of [{ seed: NaN }, { seed: -1 }, { seed: 1.5 }, { seed: 2147483648 }, { seed: 2, preset: 'invented' }]) {
    assert.throws(() => e.init(options)); assert.strictEqual(e.fields().b, before);
  }
});

test('A closed hydrostatic lake stays at rest on uneven terrain', () => {
  const e = engine('basin'); e.options.boundary = 'closed'; e.options.evaporation = 0; e.options.erosion = false;
  const f = e.fields(); for (let i = 0; i < f.d.length; i++) f.d[i] = 2 - f.b[i];
  e.resetBudgets(); const initial = f.d.slice(); advance(e, 200);
  for (let i = 0; i < initial.length; i++) close(e.fields().d[i], initial[i], 1e-12);
  assert.ok(Math.max(...e.fields().u.map(Math.abs)) < 1e-10); valid(e);
});

test('Direction follows terrain: rotation rotates flow, not a hardcoded south axis', () => {
  const a = engine(), b = engine(), N = a.constants.N;
  for (const e of [a, b]) { e.options.boundary = 'closed'; e.options.erosion = false; e.options.evaporation = 0; }
  const af = a.fields(), bf = b.fields();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = 1 - .006 * y + .0001 * (x - 96) ** 2;
    af.b[y * N + x] = h; bf.b[x * N + (N - 1 - y)] = h;
  }
  a.resetBudgets(); b.resetBudgets(); a.addSource(96, 48); b.addSource(N - 1 - 48, 96);
  advance(a, 220); advance(b, 220);
  let weightedY = 0, water = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const depth = a.fields().d[y * N + x];
    close(depth, b.fields().d[x * N + N - 1 - y], 1e-11, 'rotation');
    weightedY += depth * y; water += depth;
  }
  assert.ok(weightedY / water > 52, 'water must progress down the slope');
});

test('Rain, sources and evaporation appear in a closed-domain water budget', () => {
  const e = engine(); e.options.boundary = 'closed'; e.options.rainfall = .00001; e.options.evaporation = .02;
  e.addSource(107, 22); advance(e, 350);
  assert.ok(e.stats().rain > 0); assert.ok(e.stats().evaporated > 0); assert.equal(e.stats().waterOut, 0); valid(e);
});

test('Open boundaries export actual water and sediment; closed boundaries do not', () => {
  for (const boundary of ['open', 'closed']) {
    const e = engine(); e.options.boundary = boundary; e.options.erosion = false; e.options.evaporation = 0;
    const f = e.fields(); f.b.fill(0); f.bedrock.fill(-1);
    for (let y = 0; y < 192; y++) for (let x = 0; x < 10; x++) { f.d[y * 192 + x] = .1; f.s[y * 192 + x] = .02; }
    e.resetBudgets(); advance(e, 150);
    if (boundary === 'open') { assert.ok(e.stats().waterOut > 1); assert.ok(e.stats().sedimentOut > .1); }
    else { assert.equal(e.stats().waterOut, 0); assert.equal(e.stats().sedimentOut, 0); }
    valid(e);
  }
});

test('Shared internal faces never simultaneously carry opposing water fluxes', () => {
  const e = engine(); e.addSource(96, 48); advance(e, 100); const f = e.fields(), N = 192;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (x < N - 1) assert.equal(f.fR[i] * f.fL[i + 1], 0);
    if (y < N - 1) assert.equal(f.fB[i] * f.fT[i + N], 0);
  }
});

test('Pure advection preserves a constant sediment/water concentration', () => {
  const e = engine(); e.options.boundary = 'closed'; e.options.erosion = false; e.options.evaporation = 0;
  const f = e.fields();
  for (let i = 0; i < f.d.length; i++) { f.d[i] = .02 + (i % 17) * .001; f.s[i] = .125 * f.d[i]; }
  e.resetBudgets(); advance(e, 80);
  const out = e.fields(); for (let i = 0; i < out.d.length; i++) close(out.s[i], out.d[i] * .125, 2e-14);
  valid(e);
});

test('Microscopic films stay nonnegative, retain water, and cannot cause NaNs', () => {
  const e = engine(); e.options.erosion = false; e.options.evaporation = 0; e.options.boundary = 'closed';
  const f = e.fields(), i = 90 * 192 + 90; f.d[i] = 2.155160705e-315; f.s[i] = 1e-320; f.fR[i] = 1;
  e.resetBudgets(); advance(e, 10);
  assert.equal(sum(e.fields().d), 2.155160705e-315); assert.equal(sum(e.fields().s), 1e-320); valid(e);
});

test('Sediment in a dry cell is deposited rather than discarded', () => {
  const e = engine(), f = e.fields(), index = 19000, before = f.b[index]; f.s[index] = .03125;
  e.resetBudgets(); e.step(); close(e.fields().b[index] - before, .03125, 1e-15);
  assert.equal(e.fields().s[index], 0); close(e.stats().deposited, .03125); valid(e);
});

test('High transport capacity cannot excavate below bedrock', () => {
  const e = engine(); e.options.capacity = 10; e.options.erosionRate = 100;
  e.addSource(107, 22, 20); advance(e, 350); valid(e);
  assert.ok(e.stats().eroded > 0); assert.ok(e.stats().incision <= e.constants.SOIL_THICKNESS + 1e-12);
});

test('Identical input histories give bit-identical physical fields', () => {
  const a = engine(), b = engine(); a.addSource(107, 22); b.addSource(107, 22);
  advance(a, 400); advance(b, 400);
  for (const field of ['b', 'd', 's', 'u', 'v', 'fL', 'fR', 'fT', 'fB']) assert.deepEqual(a.fields()[field], b.fields()[field]);
});

test('A JSON save restores an identical continuation, not merely the picture', () => {
  const e = engine(); e.addSource(107, 22); advance(e, 150);
  const saved = JSON.parse(JSON.stringify(e.save())); advance(e, 100);
  const expected = e.save(); e.load(saved); advance(e, 100);
  assert.deepEqual(e.save(), expected); valid(e);
});

test('Invalid session files are rejected atomically', () => {
  const e = engine(); e.addSource(107, 22); advance(e, 2); const saved = e.save(); const before = e.fields().b;
  for (const corrupt of [data => data.version = 1, data => data.grid = 128,
    data => data.fields.d[0] = -1, data => data.fields.s[0] = Infinity,
    data => data.sources[0].x = -1, data => data.options.rainfall = -1,
    data => data.budget.injected = NaN]) {
    const bad = structuredClone(saved); corrupt(bad); assert.throws(() => e.load(bad));
    assert.strictEqual(e.fields().b, before); assert.equal(e.stats().steps, 2);
  }
});

test('Production HTML has no remote dependency and every local script exists', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(!/<(?:script|link)[^>]+(?:src|href)="https?:/i.test(html));
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, match[1])));
});
