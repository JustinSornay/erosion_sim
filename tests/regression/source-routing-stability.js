// v2 contract: the source remains at the click as the terrain changes.
const assert = require('node:assert/strict');
const { createEngine } = require('../helpers/engine');
const e=createEngine(); e.init({seed:314159265,preset:'natural'});
const s=e.addSource(48,48); const before=Array.from(s.outletIndices);
e.fields().b[53*192+48]-=10; e.fields().b[48*192+53]-=20;
assert.deepEqual(Array.from(s.outletIndices),before);
assert.deepEqual(before,[48*192+48]); assert.equal(s.outletWeights[0],1);
console.log('Unbiased fixed source position: PASS');
