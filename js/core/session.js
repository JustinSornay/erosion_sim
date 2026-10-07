// Versioned, local JSON snapshots. Validate everything before touching live state.
const SESSION_FIELDS = ["b", "bInit", "bedrock", "d", "s", "fL", "fR", "fT", "fB", "u", "v"];
function exportSimulation() {
  const fields = { b, bInit, bedrock, d, s, fL, fR, fT, fB, u, v };
  return { format: "erosion-session", version: 2, physics: PHYSICS_VERSION, grid: N,
    seed: terrainSeed, preset: terrainPreset, steps, options: { ...simulationOptions },
    budget: { ...budget }, sources: sources.map(({ x, y, rate, active }) => ({ x, y, rate, active })),
    fields: Object.fromEntries(SESSION_FIELDS.map(name => [name, Array.from(fields[name])])) };
}
function restoreSimulation(data) {
  const fail = () => { throw new Error("Sauvegarde invalide ou incompatible (version 2 requise)."); };
  if (!data || data.format !== "erosion-session" || data.version !== 2 || data.grid !== N || data.physics !== PHYSICS_VERSION) fail();
  if (!Number.isInteger(data.seed) || data.seed < 0 || data.seed > 2147483647 ||
      !Number.isSafeInteger(data.steps) || data.steps < 0 || data.steps > 1e9 ||
      !["natural", "valley", "basin", "ridge"].includes(data.preset)) fail();
  const fields = {};
  for (const name of SESSION_FIELDS) {
    const values = data.fields && data.fields[name];
    if (!Array.isArray(values) || values.length !== NN) fail();
    const nonnegative = ["d", "s", "fL", "fR", "fT", "fB"].includes(name);
    if (values.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6 || (nonnegative && value < 0))) fail();
    fields[name] = new Float64Array(values);
  }
  for (let i = 0; i < NN; i++) if (fields.b[i] < fields.bedrock[i] - 1e-10) fail();
  const opt = data.options;
  if (!opt || !["open", "closed"].includes(opt.boundary) || typeof opt.erosion !== "boolean") fail();
  for (const [key, max] of [["rainfall", .01], ["evaporation", 10], ["capacity", 10], ["erosionRate", 100], ["depositionRate", 100]])
    if (!Number.isFinite(opt[key]) || opt[key] < 0 || opt[key] > max) fail();
  if (!Array.isArray(data.sources) || data.sources.length > 128) fail();
  const nextSources = data.sources.map(src => {
    if (!src || typeof src.active !== "boolean") fail();
    const result = { x: src.x, y: src.y, rate: src.rate, active: src.active };
    configureSourceOutlets(result);
    return result;
  });
  const budgetKeys = ["initialWater", "initialSolid", "injected", "rain", "evaporated", "waterOut", "sedimentOut", "eroded", "deposited", "lastOutflow"];
  const nextBudget = {};
  for (const key of budgetKeys) {
    const value = data.budget && data.budget[key];
    if (!Number.isFinite(value) || Math.abs(value) > 1e15 || (key !== "initialSolid" && value < 0)) fail();
    nextBudget[key] = value;
  }
  genTerrain({ seed: data.seed, preset: data.preset });
  ({ b, bInit, bedrock, d, s, fL, fR, fT, fB, u, v } = fields);
  for (const key of Object.keys(simulationOptions)) simulationOptions[key] = opt[key];
  sources = nextSources;
  budget = nextBudget;
  steps = data.steps;
  simTime = steps * DT;
  refreshSourceProtectionMask();
  computeDrainage();
  computeActiveNetwork();
  if (typeof invalidateDrainagePaths === "function") invalidateDrainagePaths();
}
