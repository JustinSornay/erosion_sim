function stepParticles(dtSim) {
  if (dtSim <= 0) return;
  const SCALE = 55;
  for (let i = 0; i < NP; i++) {
    let x = px[i],
      y = py[i];
    if (pAlive[i]) {
      const depth = bilerp(d, x, y);
      const uu = bilerp(u, x, y),
        vv = bilerp(v, x, y);
      const vel = Math.hypot(uu, vv);
      const q = depth * vel;
      const outOfBounds = x < 1 || x > N - 2 || y < 1 || y > N - 2;
      if (!(depth < D_DEATH || vel < V_DEATH || q < Q_DEATH || outOfBounds)) {
        px[i] = x + uu * dtSim * SCALE;
        py[i] = y + vv * dtSim * SCALE;
        continue;
      }
      pAlive[i] = 0;
    }
    let bestX = -1,
      bestY = -1,
      bestQ = -1;
    for (let k = 0; k < 6; k++) {
      const cx = 1 + rnd() * (N - 2),
        cy = 1 + rnd() * (N - 2);
      const depth = bilerp(d, cx, cy);
      const uu = bilerp(u, cx, cy),
        vv = bilerp(v, cx, cy);
      const vel = Math.hypot(uu, vv);
      const q = depth * vel;
      if (depth > D_SPAWN && vel > V_SPAWN && q > Q_SPAWN && q > bestQ) {
        bestQ = q;
        bestX = cx;
        bestY = cy;
      }
    }
    if (bestX >= 0) {
      px[i] = bestX;
      py[i] = bestY;
      pAlive[i] = 1;
    } else pAlive[i] = 0;
  }
}
