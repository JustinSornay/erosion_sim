function genTerrain() {
  seed = (Math.random() * 1e9) | 0;
  reseedPerm();
  b = new Float32Array(NN);
  bInit = new Float32Array(NN);
  d = new Float32Array(NN);
  s = new Float32Array(NN);
  fL = new Float32Array(NN);
  fR = new Float32Array(NN);
  fT = new Float32Array(NN);
  fB = new Float32Array(NN);
  u = new Float32Array(NN);
  v = new Float32Array(NN);
  tmpS = new Float32Array(NN);
  tmpD = new Float32Array(NN);
  flowTo = new Int32Array(NN);
  accum = new Float32Array(NN);
  accumSmooth = new Float32Array(NN);
  sortIdx = new Int32Array(NN);
  drainReady = false;
  activeCell = new Uint8Array(NN);
  activeVel = new Float32Array(NN);
  maxActiveQ = 1e-6;
  const OUTLET_DROP = 0.55;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const nx = (x / N) * 3.2,
        ny = (y / N) * 3.2;
      const macro = (fbm(nx * 0.4, ny * 0.4) + 1) * 0.5;
      const detail = (fbm(nx, ny) + 1) * 0.5;
      let h = macro * 0.8 + detail * 0.2;
      h += OUTLET_DROP * (1 - y / N);
      const wallDist = Math.min(x / N, 1 - x / N, y / N);
      h += Math.pow(Math.max(0, 1 - wallDist * 7), 2) * 0.4;
      b[idx(x, y)] = h * 0.9;
    }
  bInit.set(b);
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
  computeDrainage();
}
