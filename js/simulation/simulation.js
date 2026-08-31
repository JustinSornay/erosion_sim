function step() {
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (src.active) d[idx(src.x, src.y)] += DT * src.rate;
  }

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      const h = b[i] + d[i];
      let dhL = 0,
        dhR = 0,
        dhT = 0,
        dhB = 0;
      if (x > 0) dhL = h - (b[i - 1] + d[i - 1]);
      if (x < N - 1) dhR = h - (b[i + 1] + d[i + 1]);
      if (y > 0) dhT = h - (b[i - N] + d[i - N]);
      if (y < N - 1) dhB = h - (b[i + N] + d[i + N]);
      let nl = Math.max(0, fL[i] + (DT * A * G * dhL) / L);
      let nr = Math.max(0, fR[i] + (DT * A * G * dhR) / L);
      let nt = Math.max(0, fT[i] + (DT * A * G * dhT) / L);
      let nb = Math.max(0, fB[i] + (DT * A * G * dhB) / L);
      if (x === 0) nl = 0;
      if (x === N - 1) nr = 0;
      if (y === 0) nt = 0;
      if (y === N - 1) nb = 0;
      const sum = nl + nr + nt + nb;
      if (sum > 0) {
        const K = Math.min(1, (d[i] * L * L) / (sum * DT + 1e-9));
        nl *= K;
        nr *= K;
        nt *= K;
        nb *= K;
      }
      fL[i] = nl;
      fR[i] = nr;
      fT[i] = nt;
      fB[i] = nb;
    }

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      const fin =
        (x > 0 ? fR[i - 1] : 0) +
        (x < N - 1 ? fL[i + 1] : 0) +
        (y > 0 ? fB[i - N] : 0) +
        (y < N - 1 ? fT[i + N] : 0);
      const fout = fL[i] + fR[i] + fT[i] + fB[i];
      tmpD[i] = Math.max(0, d[i] + (DT * (fin - fout)) / (L * L));
    }
  {
    const t = d;
    d = tmpD;
    tmpD = t;
  }

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      const inL = x > 0 ? fR[i - 1] : 0,
        outL = fL[i];
      const inR = x < N - 1 ? fL[i + 1] : 0,
        outR = fR[i];
      const inT = y > 0 ? fB[i - N] : 0,
        outT = fT[i];
      const inB = y < N - 1 ? fT[i + N] : 0,
        outB = fB[i];
      const wx = (inL - outL + (outR - inR)) * 0.5;
      const wy = (inT - outT + (outB - inB)) * 0.5;
      const dbar = Math.max(1e-4, d[i]);
      const ui = wx / (L * dbar),
        vi = wy / (L * dbar);
      u[i] = ui;
      v[i] = vi;

      const bl = x > 0 ? b[i - 1] : b[i],
        brr = x < N - 1 ? b[i + 1] : b[i];
      const bt = y > 0 ? b[i - N] : b[i],
        bb = y < N - 1 ? b[i + N] : b[i];
      const dzx = (brr - bl) * 0.5,
        dzy = (bb - bt) * 0.5;
      const slope = Math.sqrt(dzx * dzx + dzy * dzy);
      const sinA = slope / Math.sqrt(1 + slope * slope);
      const vel = Math.sqrt(ui * ui + vi * vi);
      const dNorm = Math.min(1, d[i] * 4);
      const C = KC * sinA * vel * dNorm;
      const si = s[i];
      if (C > si) {
        const diff = KS * (C - si);
        b[i] -= diff;
        s[i] = si + diff;
      } else {
        const diff = KD * (si - C);
        b[i] += diff;
        s[i] = Math.max(0, si - diff);
      }
    }

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      let sx = x - (u[i] * DT) / L,
        sy = y - (v[i] * DT) / L;
      sx = Math.min(N - 1.001, Math.max(0, sx));
      sy = Math.min(N - 1.001, Math.max(0, sy));
      const x0 = sx | 0,
        y0 = sy | 0,
        x1 = Math.min(x0 + 1, N - 1),
        y1 = Math.min(y0 + 1, N - 1),
        tx = sx - x0,
        ty = sy - y0;
      const s00 = s[idx(x0, y0)],
        s10 = s[idx(x1, y0)];
      const s01 = s[idx(x0, y1)],
        s11 = s[idx(x1, y1)];
      tmpS[i] = lerp(lerp(s00, s10, tx), lerp(s01, s11, tx), ty);
      d[i] *= 1 - KE * DT;
    }
  {
    const t = s;
    s = tmpS;
    tmpS = t;
  }

  steps++;
  simTime += DT;
}
