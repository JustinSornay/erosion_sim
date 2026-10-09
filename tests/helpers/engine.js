const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const scripts = ['core/config', 'core/math', 'core/state', 'simulation/terrain', 'core/terrain-history', 'simulation/simulation', 'simulation/drainage', 'core/session'];
const source = scripts.map(file => fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8')).join('\n');
function createEngine(options = {}) {
  return new Function(`${source}
    return {
      createTerrainHistory, terrainCatalog: TERRAIN_CATALOG,
      init: genTerrain, save: exportSimulation, load: restoreSimulation, step, stats: getSimulationStats, resetBudgets, injectSources,
      flux: updateFluxes, transport: transportWaterAndSediment,
      exchange: updateVelocityAndExchange, evaporate: evaporateWater,
      options: simulationOptions,
      addSource(x,y,rate=DEFAULT_RATE){const src={x,y,rate,active:true};configureSourceOutlets(src);sources.push(src);return src;},
      fields(){return {b,bInit,bedrock,d,s,fL,fR,fT,fB,u,v,tmpS,tmpD,sourceProtectionMask,flowTo,accum};},
      sources(){return sources;},
      constants:{N,NN,L,DT,DRY_DEPTH,SOIL_THICKNESS},
    };`)();
}
module.exports = { createEngine, root, source };
