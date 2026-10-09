const test = require('node:test');
const assert = require('node:assert/strict');
const {createEngine, root} = require('../helpers/engine');
const fs = require('node:fs'), path = require('node:path');
const WATER = ['island','archipelago','coast','estuary','fjord','lagoon','atoll','lake','craterlake'];
const SEA = WATER.slice(0,7);
const e = createEngine();
const SEEDS = [0,1,2,3,4,5,104729,314159265,271828182,1000000000,2147483646,2147483647];
const near = (a, b, tol = 1e-7) => assert.ok(Math.abs(a-b) < tol, `${a} != ${b}`);
function invariant(engine) {
  const s=engine.stats();assert.ok(s.finite && s.minWater>=0 && s.minSediment>=0);
  near(s.waterResidual,0);near(s.solidResidual,0);return s;
}
function steps(engine, n) { for(let i=0;i<n;i++) engine.step(); }

test('All 27 cards have a deterministic climate and optional, dry-land, well-separated sources', () => {
  let rainy=0, arid=0, sourceCards=0, noSourceCards=0;
  for(const preset of Object.keys(e.terrainCatalog)) for(const seed of SEEDS) {
    const profile=e.generateScene({preset,seed}), {b,d,flowTo}=e.fields();
    assert.ok(profile.rainRate>0 && profile.rainRate<.001);
    assert.equal(e.options.rainfall,profile.rainDefault?profile.rainRate:0);
    if(profile.rainDefault) rainy++;else arid++;
    if(e.sources().length) sourceCards++;else noSourceCards++;
    assert.equal(profile.initialSourceCount,e.sources().length);
    for(const [index,src] of e.sources().entries()) {
      const i=src.y*192+src.x;assert.ok(d[i]<.00001 && src.rate>0 && src.rate<5 && src.active);
      assert.ok(src.x>=14 && src.y>=14 && src.x<178 && src.y<178);
      for(const other of e.sources().slice(0,index)) assert.ok(Math.hypot(src.x-other.x,src.y-other.y)>=192*.23);
      let next=i,length=0;
      while(length<36864 && d[next]<.002 && flowTo[next]>=0) { assert.ok(b[flowTo[next]]<b[next]); next=flowTo[next]; length++; }
      assert.ok(length>=22,`downstream journey: ${preset}/${seed}/${length}`);
    }
    invariant(e);
  }
  assert.ok(rainy>70 && arid>70 && sourceCards>70 && noSourceCards>70);
});

test('Aquatic cards show a meaningful mix of real water and dry land in every framing', () => {
  for(const preset of WATER) for(const seed of SEEDS) {
    const p=e.generateScene({preset,seed}), {b,d,s}=e.fields(), wet=p.initialWetCells/36864;
    assert.ok(wet>.065 && wet<.96,`${preset}/${seed}: ${wet} flooded`);
    assert.ok(s.every(v=>v===0));assert.equal(e.stats().steps,0);
    for(let i=0;i<d.length;i++) if(d[i]>0) near(b[i]+d[i],0,1e-14);
    assert.equal(e.marine().level,SEA.includes(preset)?0:null);
    assert.ok(e.stats().initialWater>50);near(e.stats().waterResidual,0);
  }
});

test('Sea only fills components connected to an external boundary, never isolated holes', () => {
  for(const preset of SEA) for(const seed of [0,1,2,19]) {
    e.generateScene({preset,seed});const {b,d}=e.fields();
    const edges=[];for(let k=0;k<192;k++)edges.push(k,36672+k,k*192,k*192+191);
    const {mask}=e.submergedComponent(0,edges);
    for(let i=0;i<36864;i++) assert.equal(d[i]>0,mask[i]===1 && b[i]<0);
  }
  e.init({preset:'natural',seed:0});const {b}=e.fields();b.fill(1);
  b[0]=-1;b[193]=-1; // diagonal alone must not connect two wet components
  assert.equal(e.submergedComponent(0,[0]).mask[193],0);
});

test('The atoll lagoon is connected to the sea through its passes, not left artificially dry', () => {
  for(const seed of SEEDS) {
    e.generateScene({preset:'atoll',seed});
    const wetCenter=[];for(let y=85;y<108;y++)for(let x=85;x<108;x++)wetCenter.push(e.fields().d[y*192+x]);
    assert.ok(wetCenter.filter(d=>d>.03).length>400);
  }
});

test('Rain is only off or the fixed card intensity, including after repeated toggles', () => {
  for(const preset of Object.keys(e.terrainCatalog)) {
    const profile=e.generateScene({preset,seed:27});
    const before=e.fields().d.slice(), sourceCopy=JSON.stringify(e.sources());
    for(let n=0;n<4;n++) { e.setSceneRain(false);assert.equal(e.options.rainfall,0);e.setSceneRain(true);assert.equal(e.options.rainfall,profile.rainRate); }
    assert.deepEqual(e.fields().d,before);assert.equal(JSON.stringify(e.sources()),sourceCopy);
    assert.throws(()=>e.setSceneRain('true'));assert.equal(e.options.rainfall,profile.rainRate);
  }
  const icons=[.000005,.000018,.000035,.00006].map(rate=>e.rainAppearance(rate).icon);
  assert.equal(new Set(icons).size,4);
});

test('Restart restores initial land, lake, rainfall, sources and budgets bit-for-bit', () => {
  for(const preset of ['natural','headwaters',...WATER]) {
    e.generateScene({preset,seed:37});const before=e.save();
    e.setSceneRain(!e.getSceneProfile().rainDefault);e.sources().length=0;steps(e,12);
    e.generateScene({preset,seed:37});assert.deepEqual(e.save(),before);
  }
});

for(const preset of WATER) {
  test(`${preset}: an unforced lake or sea starts hydrostatic and never drains through an artificial edge`, () => {
    const engine=createEngine();engine.generateScene({preset,seed:4});
    engine.options.evaporation=0;engine.setSceneRain(false);engine.sources().length=0;engine.resetBudgets();
    const before=engine.fields().d.slice(), bed=engine.fields().b.slice(), initial=engine.stats().water;
    steps(engine,240);const stats=invariant(engine);
    near(stats.water,initial);near(stats.waterOut,0);near(stats.waterIn,0);near(stats.eroded,0,1e-12);
    for(let i=0;i<before.length;i++) { near(engine.fields().d[i],before[i],1e-12);near(engine.fields().b[i],bed[i],1e-12); }
  });
}

test('Marine inflow replaces deficits, outflow exports surpluses, and both enter the water budget', () => {
  for(const factor of [.4,1.25]) {
    const engine=createEngine();engine.generateScene({preset:'archipelago',seed:2});
    engine.setSceneRain(false);engine.options.evaporation=0;engine.sources().length=0;
    for(let k=0;k<192;k++) for(const i of [k,36672+k,k*192,k*192+191])engine.fields().d[i]*=factor;
    engine.resetBudgets();steps(engine,90);const stats=invariant(engine);
    assert.ok(factor<1 ? stats.waterIn>1 : stats.waterOut>1);
  }
});

for(const preset of ['island','estuary','atoll','lake','craterlake','headwaters','natural']) {
  test(`${preset}: forced scene budgets and signed marine momentum survive JSON round trips`, () => {
    e.generateScene({preset,seed:12347});e.setSceneRain(true);steps(e,80);invariant(e);
    const saved=JSON.parse(JSON.stringify(e.save()));
    steps(e,24);const expected=e.save();e.load(saved);steps(e,24);
    assert.deepEqual(e.save(),expected);invariant(e);
  });
}

test('Old version-2 sessions remain loadable and keep their formerly custom rain rate when toggled', () => {
  e.init({preset:'natural',seed:314159265});e.options.rainfall=.000017;
  e.addSource(48,48);steps(e,20);const current=e.save(), legacy=structuredClone(current);
  legacy.version=2;delete legacy.scene;delete legacy.marine;delete legacy.budget.waterIn;
  e.load(legacy);assert.deepEqual(e.fields().d,new Float64Array(current.fields.d));
  assert.equal(e.options.rainfall,.000017);assert.equal(e.marine().level,null);
  e.setSceneRain(false);e.setSceneRain(true);assert.equal(e.options.rainfall,.000017);
  invariant(e);
});

test('Invalid v3 scene settings, sea momentum and budgets are rejected without mutating the simulation', () => {
  e.generateScene({preset:'island',seed:11});steps(e,3);const save=e.save();
  for(const mutate of [s=>s.scene.rainRate=-1,s=>s.scene.rainRate=NaN,s=>s.scene.sourceCount=129,
    s=>s.marine.flux[0]=Infinity,s=>s.marine.flux.pop(),s=>s.marine.level='0',
    s=>s.budget.waterIn=-1,s=>s.scene.waterKind='lake',s=>s.options.rainfall=.005,s=>s.version=4]) {
    const bad=structuredClone(save);mutate(bad);const before=e.fields().d;
    assert.throws(()=>e.load(bad));assert.equal(e.fields().d,before);assert.deepEqual(e.save(),save);
  }
});

test('v2.2 histories prioritize the nine water families once, without dropping previous cards', () => {
  const KEY='erosion.terrain-browser.v1', values=new Map();
  const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  values.set(KEY,JSON.stringify({version:1,catalogRevision:3,nextSeed:2,nextNumber:2,
    entries:[{preset:'natural',seed:12,number:1}],bag:['meanders','mesas']}));
  const history=e.createTerrainHistory({storage,entropy:()=>123});const first=history.start();
  assert.equal(first.preset,'island');assert.equal(first.seed,2);
  assert.deepEqual(history.previous(),{preset:'natural',seed:12,number:1});assert.deepEqual(history.next(),first);
  const rest=[];for(let i=0;i<8;i++)rest.push(history.next().preset);
  assert.deepEqual(rest,WATER.slice(1));
  assert.equal(e.createTerrainHistory({storage,entropy:()=>123}).start().preset,'meanders');
  assert.equal(JSON.parse(values.get(KEY)).catalogRevision,4);
});

test('The simplified interface contains no rain intensity, discharge or boundary editor', () => {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(html.includes('id="rainToggle"') && html.includes('id="restartScene"'));
  assert.ok(!/<select\b|type="number"|type="range"/.test(html));
  assert.equal((html.match(/data-m=/g)||[]).length,2);
  assert.ok(!html.includes('Lancer une rivi') && !html.includes('id="boundary"'));
});

test('The previous eighteen height-field generators match 108 archived v2.2.0 grids',()=>{
  const {createHash}=require('node:crypto');
  const {fixtures}=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/terrain-v220-sha256.json'),'utf8'));
  assert.equal(fixtures.length,108);
  for(const {preset,seed,sha256} of fixtures){
    e.init({preset,seed});assert.equal(createHash('sha256').update(Buffer.from(e.fields().b.buffer)).digest('hex'),sha256);
  }
});

test('Discharge scales with landscape type instead of assigning an estuary the same flow as an islet',()=>{
  for(const seed of [0,1,2,12347]){
    const small=e.generateScene({preset:'archipelago',seed}).manualSourceRate;
    const large=e.generateScene({preset:'estuary',seed}).manualSourceRate;
    assert.ok(large>small*2 && large<5);
  }
});
