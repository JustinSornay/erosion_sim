// Card-specific hydrology. Profiles are generated once, independently of the
// terrain sampler's RNG. Browsing always restores this complete initial scene.
const SCENE_VERSION = 1;
const SCENE_CLIMATES = Object.freeze({
  headwaters: [18, 38, .9, 1, 2], meanders: [12, 28, .7, 1, 2],
  hillside: [10, 28, .8, 0, 1], confluence: [14, 30, .8, 2, 3],
  spillway: [18, 38, .8, 0, 1], massif: [10, 26, .8, 1, 3],
  tableland: [16, 38, .25, 0, 1], lowlands: [12, 28, .8, 1, 2],
  canyon: [18, 40, .2, 0, 1], badlands: [42, 70, .2, 0, 0],
  glacial: [5, 14, .55, 1, 2], karst: [20, 42, .8, 0, 1],
  caldera: [12, 30, .5, 0, 1], fan: [24, 50, .35, 1, 1],
  mesas: [20, 48, .15, 0, 0], cuesta: [12, 30, .6, 0, 1],
  braided: [10, 24, .7, 2, 3], natural: [8, 36, .6, 0, 2],
  island: [16, 40, .85, 0, 2], archipelago: [12, 34, .7, 0, 1],
  coast: [8, 28, .65, 0, 1], estuary: [16, 34, .8, 2, 3],
  fjord: [10, 26, .8, 1, 2], lagoon: [10, 24, .6, 0, 1],
  atoll: [4, 12, .45, 0, 0], lake: [12, 30, .8, 1, 2],
  craterlake: [10, 26, .75, 0, 1],
});
const SEA_PRESETS = new Set(['island', 'archipelago', 'coast', 'estuary', 'fjord', 'lagoon', 'atoll']);
function rainAppearance(rate) {
  if (rate < .000010) return { label: 'Bruine', icon: 'cloud-drizzle', intensity: 'drizzle' };
  if (rate < .000024) return { label: 'Pluie fine', icon: 'cloud-rain', intensity: 'light' };
  if (rate < .000042) return { label: 'Pluie soutenue', icon: 'cloud-rain-wind', intensity: 'steady' };
  return { label: 'Averse', icon: 'cloud-rain-heavy', intensity: 'heavy' };
}
function makeSceneProfile(preset, value) {
  const random = terrainRandom(value ^ 0x781ced03);
  const [lo, hi, chance, minSources, maxSources] = SCENE_CLIMATES[preset] || SCENE_CLIMATES.natural;
  const rainRate = Math.round(lo + random() * (hi - lo)) / 1000000;
  const rainDefault = random() < chance;
  const sourceCount = minSources + Math.floor(random() * (maxSources - minSources + 1));
  // Larger river systems receive stronger discharges than small maritime
  // catchments. Variations stay modest so a source never overwhelms an islet.
  const flowScale = ({estuary: 1.45, braided: 1.4, confluence: 1.2, lowlands: 1.15,
    archipelago: .55, atoll: .40, island: .75, coast: .85, lagoon: .65,
    craterlake: .65, glacial: .85, karst: .8})[preset] || 1;
  const sourceRate = Math.round((.7 + random() * 1.5) * flowScale * 100) / 100;
  return { version: SCENE_VERSION, rainRate, rainDefault, sourceCount,
    manualSourceRate: sourceRate, waterKind: SEA_PRESETS.has(preset) ? 'sea'
      : ['lake', 'craterlake'].includes(preset) ? 'lake' : 'none',
    initialWetCells: 0, initialSourceCount: 0 };
}
function getSceneProfile() {
  // A v2 saved custom rain remains the fixed on-intensity for that saved card.
  if (sceneState) return sceneState;
  const profile = makeSceneProfile(terrainPreset, terrainSeed);
  if (simulationOptions.rainfall > 0) profile.rainRate = simulationOptions.rainfall;
  return profile;
}
function setSceneRain(enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Etat de pluie invalide.');
  if (!sceneState) sceneState = getSceneProfile();
  simulationOptions.rainfall = enabled ? sceneState.rainRate : 0;
}

// Four-connected flood fill prevents filling isolated inland depressions with
// seawater merely because they lie below zero. Diagonal-only joins are not pipes.
function submergedComponent(level, starts) {
  const mask = new Uint8Array(NN), queue = new Int32Array(NN);
  let tail = 0;
  const visit = i => { if (!mask[i] && b[i] < level) { mask[i] = 1; queue[tail++] = i; } };
  for (const i of starts) visit(i);
  for (let head = 0; head < tail; head++) {
    const i = queue[head], x = i % N, y = (i / N) | 0;
    if (x > 0) visit(i - 1); if (x < N - 1) visit(i + 1);
    if (y > 0) visit(i - N); if (y < N - 1) visit(i + N);
  }
  return { mask, cells: queue.subarray(0, tail), touchesEdge: queue.subarray(0, tail).some(i =>
    i % N === 0 || i % N === N - 1 || i < N || i >= NN - N) };
}
function fillSceneWater(profile, value) {
  if (profile.waterKind === 'sea') {
    const edges = [];
    for (let k = 0; k < N; k++) edges.push(k, NN - N + k, k * N, k * N + N - 1);
    const component = submergedComponent(0, edges);
    for (const i of component.cells) d[i] = -b[i];
    seaLevel = 0; // boundary reservoir, never an interior depth clamp
  } else if (profile.waterKind === 'lake') {
    let minimum = (NN / 2) | 0;
    for (let y = 12; y < N - 12; y++) for (let x = 12; x < N - 12; x++) {
      const i = idx(x, y); if (b[i] < b[minimum]) minimum = i;
    }
    const component = submergedComponent(0, [minimum]);
    if (!component.touchesEdge) for (const i of component.cells) d[i] = -b[i];
  } else if (['spillway', 'caldera', 'karst', 'natural'].includes(terrainPreset)) {
    const random = terrainRandom(value ^ 0x194acc11);
    if (random() < .60) {
      // Try a small retained lake, never a fictitious dam across an open valley.
      let minimum = -1;
      for (let y = 16; y < N - 16; y++) for (let x = 16; x < N - 16; x++) {
        const i = idx(x, y);
        if (flowTo[i] < 0 && (minimum < 0 || b[i] < b[minimum])) minimum = i;
      }
      if (minimum >= 0) {
        let depth = .08 + .10 * random();
        for (let attempt = 0; attempt < 5; attempt++, depth *= .5) {
          const level = b[minimum] + depth, component = submergedComponent(level, [minimum]);
          if (!component.touchesEdge && component.cells.length >= 16) {
            for (const i of component.cells) d[i] = level - b[i];
            profile.waterKind = 'pond'; break;
          }
        }
      }
    }
  }
  profile.initialWetCells = d.reduce((sum, depth) => sum + (depth > .001 ? 1 : 0), 0);
}

function placeSceneSources(profile, value) {
  if (!profile.sourceCount) return;
  const random = terrainRandom(value ^ 0x98bade31);
  const order = Array.from(b, (_, i) => i).sort((a, c) => b[a] - b[c]);
  const path = new Uint16Array(NN), drains = new Uint8Array(NN);
  for (const i of order) {
    const j = flowTo[i], edge = i < N || i >= NN - N || i % N === 0 || i % N === N - 1;
    if (d[i] > .002 || edge) drains[i] = 1;
    else if (j >= 0) { drains[i] = drains[j]; path[i] = path[j] + 1; }
  }
  const land = order.filter(i => d[i] < .00001);
  const threshold = land[Math.floor(land.length * .40)];
  const candidates = [];
  for (let y = 14; y < N - 14; y += 2) for (let x = 14; x < N - 14; x += 2) {
    const i = idx(x, y), j = flowTo[i];
    if (d[i] > .00001 || j < 0 || !drains[i] || path[i] < 22 || b[i] < b[threshold]) continue;
    const slope = b[i] - b[j];
    if (slope <= .0001 || slope > .075) continue;
    // Prefer a meaningful downstream journey. Random tie-breaking varies the
    // chosen catchments without placing a source in the sea or on a cliff.
    candidates.push({ i, x, y, score: path[i] * (.70 + random() * .6), slope, length: path[i] });
  }
  candidates.sort((a, c) => c.score - a.score);
  for (const candidate of candidates) {
    if (sources.length >= profile.sourceCount) break;
    if (sources.some(src => Math.hypot(src.x - candidate.x, src.y - candidate.y) < N * .23)) continue;
    const catchment = Math.min(1, Math.log1p(accum[candidate.i]) / Math.log(100));
    const journey = Math.min(1, candidate.length / N);
    const rate = Math.round(profile.manualSourceRate * (.75 + .2 * journey + .15 * catchment) * (.9 + .2 * random()) * 100) / 100;
    const src = { x: candidate.x, y: candidate.y, rate, active: true };
    configureSourceOutlets(src); sources.push(src);
  }
  profile.initialSourceCount = sources.length;
}
function generateScene(recipe) {
  genTerrain(recipe);
  const profile = makeSceneProfile(terrainPreset, terrainSeed);
  Object.assign(simulationOptions, DEFAULT_SIMULATION_OPTIONS);
  simulationOptions.rainfall = profile.rainDefault ? profile.rainRate : 0;
  // Large bodies evaporate slowly at this uncalibrated simulation timescale.
  simulationOptions.evaporation = profile.waterKind === 'sea' ? .00008
    : profile.waterKind === 'lake' ? .00012 : .0012;
  fillSceneWater(profile, terrainSeed);
  placeSceneSources(profile, terrainSeed);
  sceneState = profile;
  refreshSourceProtectionMask(); resetBudgets(); computeActiveNetwork();
  return profile;
}
