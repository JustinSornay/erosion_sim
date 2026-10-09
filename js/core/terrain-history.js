const TERRAIN_HISTORY_KEY = "erosion.terrain-browser.v1";
const TERRAIN_HISTORY_LIMIT = 60;
const TERRAIN_CATALOG_REVISION = 4;
function terrainEntropy() {
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
  }
  return (Math.floor(Math.random() * 0x80000000) ^ Date.now()) & 0x7fffffff;
}
function createTerrainHistory({ storage = null, entropy = terrainEntropy } = {}) {
  const catalog = Object.keys(TERRAIN_CATALOG);
  const validSeed = value => Number.isInteger(value) && value >= 0 && value <= 0x7fffffff;
  const validNumber = value => Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
  let entries = [], cursor = -1, bag = [], nextSeed = entropy() & 0x7fffffff, nextNumber = 1;
  try {
    const raw = storage && storage.getItem(TERRAIN_HISTORY_KEY);
    const saved = raw && raw.length < 30000 ? JSON.parse(raw) : null;
    if (saved && saved.version === 1 && validSeed(saved.nextSeed) && validNumber(saved.nextNumber) &&
        Array.isArray(saved.entries) && saved.entries.length <= TERRAIN_HISTORY_LIMIT &&
        saved.entries.every((entry, i) => entry && validSeed(entry.seed) && isTerrainPreset(entry.preset) &&
          validNumber(entry.number) && entry.number < saved.nextNumber && (!i || entry.number > saved.entries[i - 1].number)) &&
        Array.isArray(saved.bag) && saved.bag.length <= catalog.length && new Set(saved.bag).size === saved.bag.length &&
        saved.bag.every(preset => Object.hasOwn(TERRAIN_CATALOG, preset))) {
      entries = saved.entries.map(({ seed, preset, number }) => ({ seed, preset, number }));
      bag = saved.bag.slice(); nextSeed = saved.nextSeed; nextNumber = saved.nextNumber;
      // Older histories keep their recipes, but newly introduced families should
      // be discovered without waiting for several full shuffles. Record the
      // revision so a reload never injects the same migration twice.
      if (saved.catalogRevision !== TERRAIN_CATALOG_REVISION) {
        const additions = [];
        if (!saved.catalogRevision || saved.catalogRevision < 2) additions.push('natural');
        if (!saved.catalogRevision || saved.catalogRevision < 3) additions.push('canyon', 'badlands', 'glacial', 'karst', 'caldera', 'fan', 'mesas', 'cuesta', 'braided');
        if (!saved.catalogRevision || saved.catalogRevision < 4) additions.push(...WATER_TERRAIN_KEYS);
        const missing = additions.filter(preset => Object.hasOwn(TERRAIN_CATALOG, preset) && !bag.includes(preset));
        if (missing.length) bag = missing.concat(bag);
      }
    }
  } catch (_) { /* Storage can be denied, full or unavailable for local files. */ }
  function persist() {
    try {
      if (storage) storage.setItem(TERRAIN_HISTORY_KEY, JSON.stringify({ version: 1, catalogRevision: TERRAIN_CATALOG_REVISION, entries, bag, nextSeed, nextNumber }));
    } catch (_) { /* Navigation still works in memory. */ }
  }
  function current() { return cursor >= 0 ? { ...entries[cursor] } : null; }
  function append(recipe) {
    if (nextNumber >= Number.MAX_SAFE_INTEGER - 1) {
      // Preserve ordering even after an externally forged near-overflow counter.
      entries.forEach((entry, i) => { entry.number = i + 1; }); nextNumber = entries.length + 1;
    }
    entries.push({ seed: recipe.seed, preset: recipe.preset, number: nextNumber++ });
    if (entries.length > TERRAIN_HISTORY_LIMIT) entries.shift();
    cursor = entries.length - 1; persist(); return current();
  }
  function fresh() {
    if (!bag.length) {
      bag = catalog.slice();
      const random = terrainRandom(entropy());
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    // A first visit opens a ready-to-explore aquatic card. This is a swap,
    // not an extra draw: every family still occurs exactly once per bag.
    if (!entries.length) {
      const aquatic = bag.findIndex(preset => WATER_TERRAIN_KEYS.has(preset));
      if (aquatic > 0) [bag[0], bag[aquatic]] = [bag[aquatic], bag[0]];
    }
    const previous = entries.at(-1);
    if (bag.length > 1 && previous && bag[0] === previous.preset) [bag[0], bag[1]] = [bag[1], bag[0]];
    const recipe = { seed: nextSeed, preset: bag.shift() };
    // Odd stride is a full-period permutation of the 31-bit seed space.
    // Persisting its successor prevents a reload from restarting the sequence.
    nextSeed = (nextSeed + 0x1e3779b9) & 0x7fffffff;
    return append(recipe);
  }
  return {
    start: fresh,
    current,
    canPrevious: () => cursor > 0,
    previous() { if (cursor <= 0) return null; cursor--; return current(); },
    next() { if (cursor < 0 || cursor === entries.length - 1) return fresh(); cursor++; return current(); },
    remember(recipe) {
      if (!recipe || !validSeed(recipe.seed) || !isTerrainPreset(recipe.preset)) throw new Error("Relief invalide.");
      const existing = entries.findIndex(entry => entry.seed === recipe.seed && entry.preset === recipe.preset);
      if (existing >= 0) { cursor = existing; return current(); }
      return append(recipe);
    },
  };
}
