const { createEngine, root } = require('../helpers/engine');
const fs = require('fs');
const path = require('path');
const e = createEngine();
const out = path.join(root, 'tests/generated/landscape-preview');
fs.mkdirSync(out, { recursive: true });
const names = Object.keys(e.terrainCatalog);
for (const preset of names) for (const seed of [3,1,2]) {
  e.init({ preset, seed });
  const { b, flowTo } = e.fields();
  fs.writeFileSync(path.join(out, `${preset}-${seed}.f64`), Buffer.from(b.buffer));
  let lo=Infinity,hi=-Infinity,jump=0;
  const N=e.constants.N;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const i=x+y*N, z=b[i];lo=Math.min(lo,z);hi=Math.max(hi,z);
    if(x<N-1)jump=Math.max(jump,Math.abs(z-b[i+1]));
    if(y<N-1)jump=Math.max(jump,Math.abs(z-b[i+N]));
  }
  console.log(`${preset} ${seed} view ${seed%3}: range ${(hi-lo).toFixed(3)} jump ${jump.toFixed(4)}`);
}
