const { source } = require('../helpers/engine');
const count = Number(process.argv[2] || 1000);
if (!Number.isInteger(count) || count < 1 || count > 100000) throw new Error('Expected 1..100000 steps');
const profile = new Function('count', 'performance', `${source}
  genTerrain({seed:314159265,preset:'valley'});
  const src={x:107,y:22,rate:DEFAULT_RATE,active:true};configureSourceOutlets(src);sources.push(src);
  const phases=[injectSources,updateFluxes,transportWaterAndSediment,updateVelocityAndExchange,evaporateWater];
  const times=phases.map(()=>0);
  for(let i=0;i<count;i++){
    for(let j=0;j<phases.length;j++){const started=performance.now();phases[j]();times[j]+=performance.now()-started;}
    steps++;simTime=steps*DT;
  }
  return phases.map((phase,i)=>({phase:phase.name,milliseconds:times[i]}));
`)(count, performance);
console.table(profile);
