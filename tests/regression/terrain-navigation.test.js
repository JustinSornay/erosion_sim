const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createEngine, root } = require('../helpers/engine');
const e = createEngine();
const presets = Object.keys(e.terrainCatalog);
const KEY = 'erosion.terrain-browser.v1';
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}
const makeHistory = (store = null, entropy = () => 1234567) => e.createTerrainHistory({ storage: store, entropy });
function routeStats() {
  const { b, flowTo } = e.fields(), N = e.constants.N;
  const order = Array.from(b, (_, i) => i).sort((a, z) => b[a] - b[z]);
  const reachesEdge = new Uint8Array(b.length), lengths = new Uint32Array(b.length);
  let pits = 0;
  for (const i of order) {
    const x = i % N, y = Math.floor(i / N), j = flowTo[i];
    if (x === 0 || x === N - 1 || y === 0 || y === N - 1) reachesEdge[i] = 1;
    else if (j >= 0) reachesEdge[i] = reachesEdge[j];
    else pits++;
    lengths[i] = j < 0 ? 0 : lengths[j] + 1;
  }
  return { drainage: reachesEdge.reduce((a, b) => a + b, 0) / b.length, longest: Math.max(...lengths), pits };
}

test('The discovery catalogue combines the original natural terrain with seventeen curated landscape families', () => {
  assert.deepEqual(presets, ['headwaters', 'meanders', 'hillside', 'confluence', 'spillway', 'massif', 'tableland', 'lowlands', 'canyon', 'badlands', 'glacial', 'karst', 'caldera', 'fan', 'mesas', 'cuesta', 'braided', 'natural']);
  for (const info of Object.values(e.terrainCatalog)) {
    assert.ok(info.name.length > 0 && info.description.length > 15);
  }
});

for (const preset of presets) {
  test(`${preset}: the entire relief is reproducible, varied and initially dry`, () => {
    const shapes = [];
    for (const seed of [0, 314159265, 271828182, 2147483647]) {
      e.init({ seed, preset }); const { b, bInit, bedrock, d, s } = e.fields();
      assert.ok(b.every(Number.isFinite)); assert.ok(d.every(x => x === 0) && s.every(x => x === 0));
      assert.deepEqual(b, bInit); assert.equal(e.sources().length, 0); assert.equal(e.stats().steps, 0);
      assert.ok(Math.max(...b) - Math.min(...b) > .35, 'meaningful macro relief');
      for (let i = 0; i < b.length; i++) assert.ok(Math.abs(b[i] - bedrock[i] - e.constants.SOIL_THICKNESS) < 1e-12);
      let jump = 0;
      for (let y = 0; y < 192; y++) for (let x = 0; x < 192; x++) {
        const i = y * 192 + x;
        if (x < 191) jump = Math.max(jump, Math.abs(b[i] - b[i + 1]));
        if (y < 191) jump = Math.max(jump, Math.abs(b[i] - b[i + 192]));
      }
      assert.ok(jump < .09, `no discontinuous wall or edge: ${jump}`);
      const before = b.slice(); e.addSource(50, 50); e.step(); e.init({ seed, preset });
      assert.deepEqual(e.fields().b, before); shapes.push(before);
    }
    for (let i = 1; i < shapes.length; i++) {
      const rms = Math.sqrt(shapes[i].reduce((a, h, j) => a + (h - shapes[0][j]) ** 2, 0) / shapes[i].length);
      assert.ok(rms > .04, `seed changes the landscape, not only tiny noise: ${rms}`);
    }
  });
  test(`${preset}: rain and real sources preserve water/solid budgets; saves continue exactly`, () => {
    e.init({ seed: 271828182, preset }); e.options.rainfall = .00001;
    e.addSource(54, 73); for (let i = 0; i < 120; i++) e.step();
    const stats = e.stats();
    assert.ok(stats.finite && stats.water > 0 && stats.eroded > 0);
    assert.ok(Math.abs(stats.waterResidual) < 1e-8 && Math.abs(stats.solidResidual) < 1e-8);
    const saved = JSON.parse(JSON.stringify(e.save()));
    for (let i = 0; i < 20; i++) e.step(); const expected = e.save();
    e.load(saved); for (let i = 0; i < 20; i++) e.step();
    assert.deepEqual(e.save(), expected); e.options.rainfall = 0;
  });
}

test('Open landscapes have continuous downhill routes instead of trapping most water in pits', () => {
  const engineeredOpen = presets.filter(preset => !['spillway', 'natural', 'karst', 'caldera', 'canyon', 'mesas'].includes(preset));
  for (const preset of engineeredOpen) for (const seed of [0, 1, 2, 3, 10, 100, 7654321, 12345678, 314159265, 271828182, 1000000000, 2147483647]) {
    e.init({ seed, preset }); const stats = routeStats();
    assert.ok(stats.drainage > .65, `${preset}/${seed}: ${stats.drainage} drainage fraction`);
    assert.ok(stats.longest > 100, `${preset}/${seed}: ${stats.longest} longest downhill route`);
  }
});

test('Karst and caldera families deliberately preserve enclosed basins as part of their identity', () => {
  for (const preset of ['karst', 'caldera']) {
    const samples = [0, 2, 314159265].map(seed => { e.init({ seed, preset }); return routeStats(); });
    assert.ok(samples.some(stats => stats.pits > 0), `${preset} should produce enclosed basins for at least one framing`);
    assert.ok(samples.some(stats => stats.drainage > .02), `${preset} still needs some open runoff`);
  }
});

test('The rediscovered natural terrain is bit-for-bit identical to the archived default generator', () => {
  const knownBeds = new Map([
    [0, '89ad8214994f1cfad1365f7fe21b678032c87b1f5b4097d3402a8a2b752d8b66'],
    [2, 'd07486e732f0e1d03998457606a3147080c6dbae76b5e087662b90e897c42876'],
    [314159265, '1412ed2b08f3406568713dfebf2a2e4d61f85c641f3233654e6dd044ff39bc77'],
    [2147483647, '80c2de2c538fdc2e35eeedd27663166790d31a74463f327e61f4ce9bd57fc5d8'],
  ]);
  for (const [seed, expectedHash] of knownBeds) {
    e.init({ seed, preset: 'natural' });
    const actualHash = createHash('sha256').update(Buffer.from(e.fields().b.buffer)).digest('hex');
    assert.equal(actualHash, expectedHash, `original terrain preserved at seed ${seed}`);
    assert.deepEqual(e.fields().b, e.fields().bInit);
  }
});

test('Classic natural terrain retains irregular depressions unlike the engineered drainage landscapes', () => {
  e.init({ seed: 314159265, preset: 'natural' });
  const stats = routeStats();
  assert.ok(stats.pits > 20 && stats.drainage < .45,
    `original terrain intentionally retains natural depressions: ${JSON.stringify(stats)}`);
});

test('A basin keeps a real depression as well as an open downstream catchment', () => {
  e.init({ seed: 314159265, preset: 'spillway' }); const stats = routeStats();
  assert.ok(stats.pits > 0 && stats.drainage > .05 && stats.drainage < .95);
});

test('Scrolling explores all three camera framings rather than only close-ups', () => {
  const history = makeHistory(null, () => 1234567);
  const visited = [history.start()];
  for (let i = 1; i < 24; i++) visited.push(history.next());
  const views = visited.map(recipe => recipe.seed % 3);
  assert.deepEqual([...new Set(views)].sort(), [0, 1, 2]);
  assert.ok(views.slice(1).filter((view, i) => view !== views[i]).length >= 19,
    'the default sequence alternates close, landscape and regional framings');
  assert.equal(visited.length, new Set(visited.map(v => v.seed)).size);
});

test('All wide-area landscapes are reproducible, continuous and keep water budgets', () => {
  for (const preset of presets) {
    e.init({ seed: 2, preset });
    const first = e.fields().b.slice();
    let maxJump = 0;
    for (let y = 0; y < 192; y++) for (let x = 0; x < 192; x++) {
      const i = y * 192 + x;
      if (x < 191) maxJump = Math.max(maxJump, Math.abs(first[i] - first[i + 1]));
      if (y < 191) maxJump = Math.max(maxJump, Math.abs(first[i] - first[i + 192]));
    }
    assert.ok(maxJump < .09, `${preset}: no cliffs formed by a wide view (${maxJump})`);
    e.addSource(90, 75); e.options.rainfall = .00001;
    for (let i = 0; i < 45; i++) e.step();
    const stats = e.stats();
    assert.ok(stats.finite && stats.water > 0 && stats.eroded > 0, preset);
    assert.ok(Math.abs(stats.waterResidual) < 1e-8 && Math.abs(stats.solidResidual) < 1e-8, preset);
    e.init({ seed: 2, preset });
    assert.deepEqual(e.fields().b, first, `the same regional recipe remains exact: ${preset}`);
    e.options.rainfall = 0;
  }
});

test('Previous/next reproduce recipe order; a fresh history has no fake previous terrain', () => {
  const history = makeHistory(); assert.equal(history.previous(), null);
  const a = history.start(); assert.equal(history.canPrevious(), false);
  const b = history.next(), c = history.next();
  assert.deepEqual(history.previous(), b); assert.deepEqual(history.previous(), a);
  assert.equal(history.previous(), null); assert.deepEqual(history.current(), a);
  assert.deepEqual(history.next(), b); assert.deepEqual(history.next(), c);
  assert.notEqual(history.next().seed, c.seed);
});

test('Every opening advances the stored sequence even with a constant entropy provider', () => {
  const store = storage(), seeds = new Set(); let last;
  for (let i = 0; i < 100; i++) {
    const history = makeHistory(store), recipe = history.start();
    assert.ok(!seeds.has(recipe.seed)); seeds.add(recipe.seed);
    if (last) { assert.deepEqual(history.previous(), last); assert.deepEqual(history.next(), recipe); }
    last = recipe;
  }
  assert.equal(seeds.size, 100);
});

test('A shuffled bag explores every family before repeating and avoids adjacent duplicates', () => {
  const history = makeHistory(); const all = [history.start()];
  for (let i = 1; i < 100; i++) all.push(history.next());
  for (let i = 0; i < all.length; i += presets.length) {
    const batch = all.slice(i, i + presets.length);
    assert.equal(new Set(batch.map(x => x.preset)).size, batch.length);
  }
  for (let i = 1; i < all.length; i++) assert.notEqual(all[i].preset, all[i - 1].preset);
});

test('History is bounded to 60 recipes without persisting simulation buffers', () => {
  const store = storage(), history = makeHistory(store); history.start();
  for (let i = 0; i < 90; i++) history.next();
  const raw = store.getItem(KEY), saved = JSON.parse(raw);
  assert.equal(saved.entries.length, 60); assert.ok(raw.length < 7000);
  assert.deepEqual(Object.keys(saved.entries[0]), ['seed', 'preset', 'number']);
  let available = 0; while (history.previous()) available++;
  assert.equal(available, 59); assert.equal(history.canPrevious(), false);
});

test('Pre-existing 2.1.1 histories discover newly added families without losing recipes', () => {
  const store = storage();
  store.setItem(KEY, JSON.stringify({ version: 1, nextSeed: 371, nextNumber: 2,
    entries: [{ seed: 63, preset: 'headwaters', number: 1 }],
    bag: ['hillside', 'lowlands', 'massif'],
  }));
  const upgraded = makeHistory(store), restored = upgraded.start();
  assert.ok(['canyon', 'badlands', 'glacial', 'karst', 'caldera', 'fan', 'mesas', 'cuesta', 'braided', 'natural'].includes(restored.preset));
  assert.equal(restored.seed, 371);
  assert.deepEqual(upgraded.previous(), { seed: 63, preset: 'headwaters', number: 1 });
  assert.deepEqual(upgraded.next(), restored);
  assert.equal(JSON.parse(store.getItem(KEY)).catalogRevision, 3);
  // A second browser launch must not insert the same family into the bag again.
  const again = makeHistory(store).start();
  assert.ok(presets.includes(again.preset));
  assert.equal(again.number, 3);
});

test('Blocked and full storage never prevent terrain generation or backward navigation', () => {
  for (const store of [null, { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } },
    { getItem() { return null; }, setItem() { throw Error('quota'); } }]) {
    const history = makeHistory(store), a = history.start(), b = history.next();
    assert.notEqual(a.seed, b.seed); assert.deepEqual(history.previous(), a);
  }
});

test('Malformed or oversized stored histories are ignored atomically', () => {
  const store = storage(); makeHistory(store).start(); const good = JSON.parse(store.getItem(KEY));
  const corrupt = [data => data.version = 99, data => data.bag = ['invented'], data => data.nextSeed = -1,
    data => data.nextNumber = 'bad', data => data.entries[0].seed = 1.5,
    data => data.entries[0].preset = '__proto__', data => data.entries.push(data.entries[0])];
  for (const mutate of corrupt) {
    const bad = structuredClone(good); mutate(bad); store.setItem(KEY, JSON.stringify(bad));
    assert.equal(makeHistory(store).start().number, 1);
  }
  for (const raw of ['{', 'null', 'x'.repeat(30001)]) {
    store.setItem(KEY, raw); assert.equal(makeHistory(store).start().number, 1);
  }
});

test('Imported legacy recipes join history; invalid imports do not mutate it', () => {
  const history = makeHistory(); const a = history.start();
  const imported = history.remember({ seed: 314159265, preset: 'ridge' });
  assert.equal(imported.preset, 'ridge'); assert.deepEqual(history.previous(), a);
  assert.deepEqual(history.next(), imported); assert.deepEqual(history.remember(imported), imported);
  assert.throws(() => history.remember({ seed: -1, preset: 'headwaters' }));
  assert.deepEqual(history.current(), imported);
});

test('Returned recipes cannot mutate internal or stored history', () => {
  const store = storage(), history = makeHistory(store), original = history.start();
  const copy = history.current(); copy.seed = -1; copy.preset = 'invented';
  assert.deepEqual(history.current(), original); assert.deepEqual(JSON.parse(store.getItem(KEY)).entries[0], original);
});

test('All old v2 reliefs and frozen physical options still round-trip exactly', () => {
  for (const preset of ['natural', 'valley', 'basin', 'ridge']) {
    e.init({ seed: 314159265, preset }); e.options.erosion = false;
    const saved = JSON.parse(JSON.stringify(e.save())); e.load(saved); assert.deepEqual(e.save(), saved);
  }
  e.options.erosion = true;
});

test('Deleted features have no residual HTML controls or UI handlers', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui/ui.js'), 'utf8');
  for (const id of ['demo', 'erode', 'preset', 'terrainSeed', 'applyTerrain', 'replay']) {
    assert.ok(!html.includes(`id="${id}"`)); assert.ok(!ui.includes(`getElementById("${id}")`));
  }
  assert.ok(!html.includes('Lancer une rivi\u00e8re'));
  assert.ok(html.includes('id="previousTerrain"') && html.includes('id="nextTerrain"'));
});
