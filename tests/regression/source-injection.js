// v2 contract: inject where the source was placed, never at an offset mouth.
const assert = require('node:assert/strict');
const { createEngine } = require('../helpers/engine');
for (const [x, y] of [[48,48],[0,48],[191,48],[0,0],[191,191]]) {
  const e=createEngine(); e.init({seed:314159265,preset:'natural'}); e.addSource(x,y);
  for(let i=0;i<25;i++)e.injectSources();
  const f=e.fields(), volume=25*e.constants.DT*2.2;
  assert.ok(Math.abs(f.d[y*192+x]-volume)<1e-12);
  assert.equal(f.d.filter(value=>value>0).length,1);
  assert.ok(Math.abs(e.stats().waterResidual)<1e-12);
}
console.log('Exact point-source injection and conservation: PASS');
