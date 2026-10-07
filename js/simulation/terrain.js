function genTerrain(options = {}) {
  const requestedSeed = options.seed === undefined ? (Math.random() * 1e9) | 0 : Number(options.seed);
  if (!Number.isInteger(requestedSeed) || requestedSeed < 0 || requestedSeed > 2147483647)
    throw new Error("La graine doit etre un entier entre 0 et 2147483647.");
  const preset = options.preset || terrainPreset;
  if (!["natural", "valley", "basin", "ridge"].includes(preset)) throw new Error("Terrain inconnu.");
  terrainSeed = requestedSeed;
  terrainPreset = preset;
  seed = terrainSeed;
  reseedPerm();
  b = new Float64Array(NN);
  bInit = new Float64Array(NN);
  d = new Float64Array(NN);
  s = new Float64Array(NN);
  fL = new Float64Array(NN);
  fR = new Float64Array(NN);
  fT = new Float64Array(NN);
  fB = new Float64Array(NN);
  u = new Float64Array(NN);
  v = new Float64Array(NN);
  tmpS = new Float64Array(NN);
  tmpD = new Float64Array(NN);
  bedrock = new Float64Array(NN);
  bedDelta = new Float64Array(NN);
  flowTo = new Int32Array(NN);
  accum = new Float32Array(NN);
  accumSmooth = new Float32Array(NN);
  sortIdx = new Int32Array(NN);
  drainReady = false;
  activeCell = new Uint8Array(NN);
  activeVel = new Float32Array(NN);
  activeCellsList = new Int32Array(NN);
  activeCellsCount = 0;
  maxActiveQ = 1e-6;
  sourceProtectionMask = new Float32Array(NN);
  sourceProtectionMask.fill(1);
  /*
   * A local depression establishes one natural outlet without imposing a
   * directional slope or raising any terrain border.
   */
  const outletX = 0.35 + rnd() * 0.3;
  const outletY = 1.02;
  const OUTLET_DEPTH = 0.28;
  const OUTLET_WIDTH_X = 0.14;
  const OUTLET_WIDTH_Y = 0.12;

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const nx = (x / N) * 3.2,
        ny = (y / N) * 3.2;
      const macro = (fbm(nx * 0.4, ny * 0.4) + 1) * 0.5;
      const detail = (fbm(nx, ny) + 1) * 0.5;
      let h = macro * 0.8 + detail * 0.2;

      const px = x / (N - 1);
      const py = y / (N - 1);
      const dx = (px - outletX) / OUTLET_WIDTH_X;
      const dy = (py - outletY) / OUTLET_WIDTH_Y;
      const outletInfluence = Math.exp(-0.5 * (dx * dx + dy * dy));
      h -= OUTLET_DEPTH * outletInfluence;

      if (preset === "valley") {
        // A reproducible demonstration, explicitly distinct from natural terrain.
        const center = 0.50 + 0.105 * Math.sin(py * 6.5);
        h = 0.10 + 0.95 * (1 - py) + 1.9 * (px - center) ** 2
          + 0.018 * fbm(nx * 0.9, ny * 0.9);
      } else if (preset === "basin") {
        const radius = Math.hypot((px - 0.5) * 1.2, py - 0.5);
        h = 0.20 + 1.5 * radius * radius + 0.009 * fbm(nx, ny);
      } else if (preset === "ridge") {
        h = 0.2 + 0.9 * Math.exp(-(((px - 0.5) / 0.15) ** 2))
          + 0.15 * (1 - py) + 0.025 * fbm(nx, ny);
      }
      b[idx(x, y)] = h * 0.9;
    }
  bInit.set(b);
  for (let i = 0; i < NN; i++) bedrock[i] = b[i] - SOIL_THICKNESS;
  sources.length = 0;
  steps = 0;
  simTime = 0;
  px = new Float32Array(NP);
  py = new Float32Array(NP);
  pAlive = new Uint8Array(NP);
  for (let i = 0; i < NP; i++) {
    px[i] = rnd() * N;
    py[i] = rnd() * N;
    pAlive[i] = 0;
  }
  resetBudgets();
  computeDrainage();
  if (typeof invalidateDrainagePaths === "function") invalidateDrainagePaths();
}
