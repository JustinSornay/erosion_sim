// Versioned local snapshots. Validate all fields BEFORE changing live state.
// v2 remains importable; v3 adds card hydrology and signed ocean-boundary momentum.
const SESSION_FIELDS = ['b', 'bInit', 'bedrock', 'd', 's', 'fL', 'fR', 'fT', 'fB', 'u', 'v'];
function exportSimulation() {
  const fields = { b, bInit, bedrock, d, s, fL, fR, fT, fB, u, v };
  return { format: 'erosion-session', version: 3, physics: PHYSICS_VERSION, grid: N,
    seed: terrainSeed, preset: terrainPreset, steps, options: { ...simulationOptions },
    scene: sceneState ? { ...sceneState } : null,
    marine: seaLevel === null ? null : { level: seaLevel, flux: Array.from(seaFlux) },
    budget: { ...budget }, sources: sources.map(({ x, y, rate, active }) => ({ x, y, rate, active })),
    fields: Object.fromEntries(SESSION_FIELDS.map(name => [name, Array.from(fields[name])])) };
}
function restoreSimulation(data) {
  const fail = () => { throw new Error('Sauvegarde invalide ou incompatible (version 2 ou 3 requise).'); };
  if (!data || data.format !== 'erosion-session' || ![2, 3].includes(data.version) || data.grid !== N || data.physics !== PHYSICS_VERSION) fail();
  if (!Number.isInteger(data.seed) || data.seed < 0 || data.seed > 2147483647 ||
      !Number.isSafeInteger(data.steps) || data.steps < 0 || data.steps > 1e9 || !isTerrainPreset(data.preset)) fail();
  const fields = {};
  for (const name of SESSION_FIELDS) {
    const values = data.fields && data.fields[name];
    if (!Array.isArray(values) || values.length !== NN) fail();
    const nonnegative = ['d', 's', 'fL', 'fR', 'fT', 'fB'].includes(name);
    if (values.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6 || (nonnegative && value < 0))) fail();
    fields[name] = new Float64Array(values);
  }
  for (let i = 0; i < NN; i++) if (fields.b[i] < fields.bedrock[i] - 1e-10) fail();
  const opt = data.options;
  if (!opt || !['open', 'closed'].includes(opt.boundary) || typeof opt.erosion !== 'boolean') fail();
  for (const [key, max] of [['rainfall', .01], ['evaporation', 10], ['capacity', 10], ['erosionRate', 100], ['depositionRate', 100]])
    if (!Number.isFinite(opt[key]) || opt[key] < 0 || opt[key] > max) fail();
  if (!Array.isArray(data.sources) || data.sources.length > 128) fail();
  const nextSources = data.sources.map(src => {
    if (!src || typeof src.active !== 'boolean') fail();
    const result = { x: src.x, y: src.y, rate: src.rate, active: src.active };
    configureSourceOutlets(result); return result;
  });
  const budgetKeys = ['initialWater', 'initialSolid', 'injected', 'rain', 'evaporated', 'waterOut', 'sedimentOut', 'eroded', 'deposited', 'lastOutflow'];
  const nextBudget = {};
  for (const key of budgetKeys) {
    const value = data.budget && data.budget[key];
    if (!Number.isFinite(value) || Math.abs(value) > 1e15 || (key !== 'initialSolid' && value < 0)) fail();
    nextBudget[key] = value;
  }
  nextBudget.waterIn = data.version === 2 ? 0 : data.budget.waterIn;
  if (!Number.isFinite(nextBudget.waterIn) || nextBudget.waterIn < 0 || nextBudget.waterIn > 1e15) fail();
  let nextScene = null, nextLevel = null, nextSeaFlux = new Float64Array(4 * N);
  if (data.version === 3) {
    if (data.scene !== null) {
      const sc = data.scene;
      if (!sc || sc.version !== 1 || typeof sc.rainDefault !== 'boolean' ||
          !['sea', 'lake', 'pond', 'none'].includes(sc.waterKind) ||
          !Number.isFinite(sc.rainRate) || sc.rainRate <= 0 || sc.rainRate > .01 ||
          !Number.isFinite(sc.manualSourceRate) || sc.manualSourceRate <= 0 || sc.manualSourceRate > 100) fail();
      for (const [key, max] of [['sourceCount', 128], ['initialWetCells', NN], ['initialSourceCount', 128]])
        if (!Number.isInteger(sc[key]) || sc[key] < 0 || sc[key] > max) fail();
      if (opt.rainfall !== 0 && opt.rainfall !== sc.rainRate) fail();
      nextScene = { version: sc.version, rainRate: sc.rainRate, rainDefault: sc.rainDefault,
        sourceCount: sc.sourceCount, manualSourceRate: sc.manualSourceRate, waterKind: sc.waterKind,
        initialWetCells: sc.initialWetCells, initialSourceCount: sc.initialSourceCount };
    }
    if (data.marine !== null) {
      const m = data.marine;
      if (!m || !Number.isFinite(m.level) || Math.abs(m.level) > 1e6 ||
          !Array.isArray(m.flux) || m.flux.length !== 4 * N || m.flux.some(q => !Number.isFinite(q) || Math.abs(q) > 1e6)) fail();
      nextLevel = m.level; nextSeaFlux = new Float64Array(m.flux);
    }
    if (nextScene && ((nextScene.waterKind === 'sea') !== (nextLevel !== null))) fail();
  }
  genTerrain({ seed: data.seed, preset: data.preset });
  ({ b, bInit, bedrock, d, s, fL, fR, fT, fB, u, v } = fields);
  for (const key of Object.keys(simulationOptions)) simulationOptions[key] = opt[key];
  sceneState = nextScene; seaLevel = nextLevel; seaFlux = nextSeaFlux;
  sources = nextSources; budget = nextBudget; steps = data.steps; simTime = steps * DT;
  refreshSourceProtectionMask(); computeDrainage(); computeActiveNetwork();
  if (typeof invalidateDrainagePaths === 'function') invalidateDrainagePaths();
}
