// Quantitative sampling, not a geological accuracy claim.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createEngine,root}=require('../helpers/engine');
const e=createEngine(),families=['island','archipelago','coast','estuary','fjord','lagoon','atoll','lake','craterlake'];
const out=path.join(root,'tests/generated/scenes-validation');fs.mkdirSync(out,{recursive:true});
const mapsFile=path.join(out,'map-audit.json');
const longOnly=process.argv.includes('--long-only'), mapsOnly=process.argv.includes('--maps-only');
const report=longOnly ? JSON.parse(fs.readFileSync(mapsFile,'utf8')) : {samples:0,families:{},longRuns:[],passed:false};

if(!longOnly) for(const preset of families){
  const row={minimumWaterFraction:1,maximumWaterFraction:0,maximumAdjacentHeightJump:0,minimumSources:Infinity,maximumSources:0};
  for(let k=0;k<64;k++){
    const seed=(Math.imul(k+1,19349663)^0x3f1245ab)&0x7fffffff;
    const profile=e.generateScene({preset,seed}),{b,d}=e.fields(),fraction=profile.initialWetCells/36864;
    assert.ok(fraction>.06&&fraction<.96,`${preset}/${seed}: fraction ${fraction}`);
    assert.ok(b.every(Number.isFinite)&&d.every(Number.isFinite));
    row.minimumWaterFraction=Math.min(row.minimumWaterFraction,fraction);row.maximumWaterFraction=Math.max(row.maximumWaterFraction,fraction);
    row.minimumSources=Math.min(row.minimumSources,e.sources().length);row.maximumSources=Math.max(row.maximumSources,e.sources().length);
    let jump=0;
    for(let y=0;y<192;y++)for(let x=0;x<192;x++){
      const i=y*192+x;if(x<191)jump=Math.max(jump,Math.abs(b[i]-b[i+1]));if(y<191)jump=Math.max(jump,Math.abs(b[i]-b[i+192]));
    }
    assert.ok(jump<.10,`${preset}/${seed}: jump ${jump}`);row.maximumAdjacentHeightJump=Math.max(row.maximumAdjacentHeightJump,jump);
    report.samples++;
  }
  report.families[preset]=row;console.log(preset,row);fs.writeFileSync(mapsFile,JSON.stringify(report,null,2));
}
if(!mapsOnly) for(const preset of ['island','estuary','lake']){
  console.log('Long run starts:',preset);
  e.generateScene({preset,seed:12347});e.setSceneRain(true);
  const initial=e.stats(),maximumErrors={water:0,solid:0};
  for(let i=0;i<2000;i++){
    e.step();if(i%100===99){const s=e.stats();assert.ok(s.finite&&s.minWater>=0&&s.minSediment>=0);
      maximumErrors.water=Math.max(maximumErrors.water,Math.abs(s.waterResidual));maximumErrors.solid=Math.max(maximumErrors.solid,Math.abs(s.solidResidual));
      assert.ok(maximumErrors.water<1e-6&&maximumErrors.solid<1e-6);
    }
  }
  const final=e.stats();assert.ok(final.water>initial.water*.8);
  report.longRuns.push({preset,steps:2000,maximumErrors,initialWater:initial.water,finalWater:final.water,seaIn:final.waterIn,outflow:final.waterOut,eroded:final.eroded});
}
report.passed=report.samples===576 && (mapsOnly || report.longRuns.length===3);
fs.writeFileSync(path.join(out,mapsOnly?'map-audit.json':'audit.json'),JSON.stringify(report,null,2));
console.log(`${report.samples} aquatic maps and ${report.longRuns.length*2000} forced physical steps passed`);
