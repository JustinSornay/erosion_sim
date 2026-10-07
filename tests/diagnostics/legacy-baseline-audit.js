/** Read-only audit. Reports disagreement; never rewrites an historical fixture. */
const fs = require('node:fs');
const path = require('node:path');
const {createLegacyEngine, root} = require('../helpers/legacy-engine');
const {createEngine} = require('../helpers/engine');
const legacy = createLegacyEngine();legacy.init();legacy.addSource();
function inventories(fields) {
  let solid = 0, water = 0, sediment = 0;
  for(let i=0;i<fields.b.length;i++){solid+=fields.b[i]+fields.s[i];water+=fields.d[i];sediment+=fields.s[i];}
  return {solid,water,sediment};
}
const initial = inventories(legacy.fields());
const report = {description:'Original archived engine versus already supplied binary fixtures; read-only diagnostic, not a passing fixture regression.', seed:314159265, source:{x:48,y:48,rate:2.2}, baselineComparisons:[], checkpoints:[]};
for(let i=1;i<=5000;i++) {
  legacy.step();
  if(i!==1000 && i!==5000)continue;
  const fields=legacy.fields(), current=inventories(fields);
  report.checkpoints.push({steps:i,...current,bedPlusSedimentError:current.solid-initial.solid});
  if(i!==1000)continue;
  for(const folder of ['N192','N192-incoming-source']) {
    const file=path.join(root,'tests/fixtures',folder,'physics-1000.bin');
    const data=fs.readFileSync(file), names=Object.keys(fields);
    if(data.byteLength!==names.length*fields.b.byteLength)throw new Error('Unexpected fixture size: '+folder);
    const comparison={fixture:path.relative(root,file),matches:false,fields:[]};
    for(const [j,name] of names.entries()) {
      const reference=new Float32Array(data.buffer,data.byteOffset+j*fields.b.byteLength,fields.b.length);
      let max=0,total=0;
      for(let k=0;k<reference.length;k++){const diff=Math.abs(reference[k]-fields[name][k]);max=Math.max(max,diff);total+=diff;}
      comparison.fields.push({name,maxAbsoluteDifference:max,totalAbsoluteDifference:total});
    }
    comparison.matches=comparison.fields.every(field=>field.maxAbsoluteDifference===0);
    report.baselineComparisons.push(comparison);
  }
}
const current=createEngine();current.init({seed:314159265,preset:'natural'});current.addSource(48,48,2.2);
for(let i=0;i<5000;i++)current.step();
report.v2After5000=current.stats();
report.caveat='v2 differs in source geometry, boundary condition, precision, transport and exchange; this is an invariant audit, NOT a single-variable morphology/performance experiment.';
const out=path.join(root,'tests/generated/v2-validation/legacy-audit.json');
fs.writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
console.log('AUDIT COMPLETE. matches=false records a historical inconsistency, not a v2 regression.');
