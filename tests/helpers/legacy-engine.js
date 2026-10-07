const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const names = ['core/config', 'core/math', 'core/state', 'simulation/terrain', 'simulation/simulation', 'simulation/drainage'];
const source = names.map(name => fs.readFileSync(path.join(root, 'tests/fixtures/legacy-engine/js', name + '.js'), 'utf8')).join('\n');
function createLegacyEngine() {
  const fixedMath = Object.create(Math); fixedMath.random = () => .3141592653;
  return new Function('Math', `${source}
    return {init:genTerrain,step,fields(){return {b,d,s,u,v,fL,fR,fT,fB}},
      addSource(){const source={x:48,y:48,rate:DEFAULT_RATE,active:true};configureSourceOutlets(source);sources.push(source);refreshSourceProtectionMask();}};
  `)(fixedMath);
}
module.exports = {createLegacyEngine, root};
