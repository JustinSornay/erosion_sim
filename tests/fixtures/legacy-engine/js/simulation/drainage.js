function computeDrainage() {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      const hi = b[i];
      let bestJ = -1,
        bestSlope = 1e-6;
      for (let k = 0; k < 8; k++) {
        const nx = x + NDX[k],
          ny = y + NDY[k];
        if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
        const j = idx(nx, ny);
        const slope = (hi - b[j]) / NDIST[k];
        if (slope > bestSlope) {
          bestSlope = slope;
          bestJ = j;
        }
      }
      flowTo[i] = bestJ;
    }
  for (let i = 0; i < NN; i++) sortIdx[i] = i;
  sortIdx.sort((p, q) => b[q] - b[p]);
  accum.fill(1);
  for (let k = 0; k < NN; k++) {
    const i = sortIdx[k];
    const j = flowTo[i];
    if (j >= 0) accum[j] += accum[i];
  }
  const maxLog = Math.log(1 + NN);
  for (let i = 0; i < NN; i++) {
    const lg = Math.log(1 + accum[i]) / maxLog;
    accumSmooth[i] = drainReady
      ? accumSmooth[i] * DRAIN_SMOOTH + lg * (1 - DRAIN_SMOOTH)
      : lg;
  }
  drainReady = true;
}

function smoothstep(a, c, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (c - a)));
  return t * t * (3 - 2 * t);
}

function computeActiveNetwork() {
  maxActiveQ = 1e-6;
  activeCellsCount = 0;
  for (let i = 0; i < NN; i++) {
    const depth = d[i];
    const vel = Math.sqrt(u[i] * u[i] + v[i] * v[i]);
    const q = depth * vel;
    activeVel[i] = vel;
    const was = activeCell[i];
    let now;
    if (was) now = !(depth < D_DEATH || vel < V_DEATH || q < Q_DEATH);
    else now = depth > D_SPAWN && vel > V_SPAWN && q > Q_SPAWN;
    activeCell[i] = now ? 1 : 0;
    if (now) {
      activeCellsList[activeCellsCount++] = i;
      if (q > maxActiveQ) maxActiveQ = q;
    }
  }
}

function activeDownstream(x, y, i) {
  const uu = u[i],
    vv = v[i];
  if (uu === 0 && vv === 0) return -1;
  let bestK = -1,
    bestDot = 0;
  for (let k = 0; k < 8; k++) {
    const dot = (uu * NDX[k] + vv * NDY[k]) / NDIST[k];
    if (dot > bestDot) {
      bestDot = dot;
      bestK = k;
    }
  }
  if (bestK < 0) return -1;
  const nx = x + NDX[bestK],
    ny = y + NDY[bestK];
  if (nx < 0 || nx >= N || ny < 0 || ny >= N) return -1;
  return idx(nx, ny);
}
