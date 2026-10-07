/**
 * Compresses simulation speed into a readable visual rate. Traceurs show flow
 * direction at every multiplier instead of attempting to reproduce elapsed time.
 */
function getParticleVisualDt(multiplier) {
  return DT * (1 + Math.log2(Math.max(1, multiplier)) * 0.12);
}

const flowSample = { depth: 0, u: 0, v: 0 };

/** Samples all fields required by a traceur with one shared bilinear lookup. */
function sampleFlow(fx, fy, output) {
  const clampedX = Math.min(N - 1.001, Math.max(0, fx));
  const clampedY = Math.min(N - 1.001, Math.max(0, fy));
  const x0 = clampedX | 0;
  const y0 = clampedY | 0;
  const x1 = Math.min(x0 + 1, N - 1);
  const y1 = Math.min(y0 + 1, N - 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;
  const topLeft = idx(x0, y0);
  const topRight = idx(x1, y0);
  const bottomLeft = idx(x0, y1);
  const bottomRight = idx(x1, y1);

  output.depth = lerp(
    lerp(d[topLeft], d[topRight], tx),
    lerp(d[bottomLeft], d[bottomRight], tx),
    ty,
  );
  output.u = lerp(
    lerp(u[topLeft], u[topRight], tx),
    lerp(u[bottomLeft], u[bottomRight], tx),
    ty,
  );
  output.v = lerp(
    lerp(v[topLeft], v[topRight], tx),
    lerp(v[bottomLeft], v[bottomRight], tx),
    ty,
  );
}

function stepParticles(dtSim) {
  if (dtSim <= 0) return;
  const SCALE = 55;
  for (let i = 0; i < NP; i++) {
    let x = px[i],
      y = py[i];
    if (pAlive[i]) {
      sampleFlow(x, y, flowSample);
      const depth = flowSample.depth;
      const uu = flowSample.u;
      const vv = flowSample.v;
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
    if (activeCellsCount > 0) {
      const cell = activeCellsList[(rnd() * activeCellsCount) | 0];
      px[i] = (cell % N) + rnd();
      py[i] = ((cell / N) | 0) + rnd();
      pAlive[i] = 1;
    } else pAlive[i] = 0;
  }
}
