/** Checks preservation, not agreement with stale historical baselines. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {createLegacyEngine, root} = require('../helpers/legacy-engine');
const snapshot = path.join(root, 'tests/fixtures/legacy-engine');
const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(snapshot,name))).digest('hex'), expected, name);
}
for (const name of manifest.pinnedResearchScripts) {
  const code = fs.readFileSync(path.join(root,name),'utf8');
  assert.ok(code.includes('tests/fixtures/legacy-engine'), `Unpinned research: ${name}`);
}
const first = createLegacyEngine(), second = createLegacyEngine();
for (const engine of [first, second]) {engine.init();engine.addSource();for(let i=0;i<200;i++)engine.step();}
for (const name of Object.keys(first.fields())) assert.deepEqual(first.fields()[name], second.fields()[name], name);
console.log(`PASS: ${Object.keys(manifest.files).length} original JS hashes; ${manifest.pinnedResearchScripts.length} historical runners pinned; archived engine deterministic at 200 steps.`);
console.log('Historical binary fixture agreement is a separate, known-failing diagnostic: npm run audit:legacy.');
