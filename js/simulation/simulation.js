/**
 * Fixes a source mouth to terrain outlets selected at source creation. This
 * prevents erosion and retained water from feeding back into source routing.
 */
function injectSources() {
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (!src.active) continue;

    const volumeStep = DT * src.rate;
    if (src.outletCount === 0) {
      d[idx(src.x, src.y)] += volumeStep / (L * L);
      continue;
    }
    const volumePerArea = volumeStep / (L * L);
    for (let outlet = 0; outlet < src.outletCount; outlet++) {
      d[src.outletIndices[outlet]] += volumePerArea * src.outletWeights[outlet];
    }
  }
}

/** Calculates a fixed three-cell mouth facing the lowest terrain direction. */
function configureSourceOutlets(src) {
  const sourceIndex = idx(src.x, src.y);
  const sourceAltitude = b[sourceIndex];
  let lowestIndex = -1;
  let lowestAltitude = sourceAltitude;
  let directionX = 0;
  let directionY = 0;
  for (let y = Math.max(0, src.y - 7); y <= Math.min(N - 1, src.y + 7); y++) {
    for (let x = Math.max(0, src.x - 7); x <= Math.min(N - 1, src.x + 7); x++) {
      const dx = x - src.x;
      const dy = y - src.y;
      const distanceSquared = dx * dx + dy * dy;
      if (
        distanceSquared < SOURCE_DIRECTION_MIN_RADIUS_SQUARED ||
        distanceSquared > SOURCE_DIRECTION_MAX_RADIUS_SQUARED
      ) continue;
      const neighborIndex = idx(x, y);
      if (b[neighborIndex] >= lowestAltitude) continue;
      lowestAltitude = b[neighborIndex];
      lowestIndex = neighborIndex;
      directionX = dx;
      directionY = dy;
    }
  }
  if (lowestIndex < 0) {
    src.outletCount = 0;
    src.outletIndices = new Int32Array(0);
    src.outletWeights = new Float32Array(0);
    return;
  }
  const outletIndices = new Int32Array(3);
  const outletScores = new Float32Array(3);
  outletScores.fill(-Infinity);
  for (let y = Math.max(0, src.y - 5); y <= Math.min(N - 1, src.y + 5); y++) {
    for (let x = Math.max(0, src.x - 5); x <= Math.min(N - 1, src.x + 5); x++) {
      const dx = x - src.x;
      const dy = y - src.y;
      if (dx * dx + dy * dy > SOURCE_FOUNDATION_RADIUS_SQUARED) continue;
      const score = dx * directionX + dy * directionY;
      if (score <= outletScores[2]) continue;
      outletScores[2] = score;
      outletIndices[2] = idx(x, y);
      for (let rank = 2; rank > 0 && outletScores[rank] > outletScores[rank - 1]; rank--) {
        const scoreSwap = outletScores[rank - 1];
        outletScores[rank - 1] = outletScores[rank];
        outletScores[rank] = scoreSwap;
        const indexSwap = outletIndices[rank - 1];
        outletIndices[rank - 1] = outletIndices[rank];
        outletIndices[rank] = indexSwap;
      }
    }
  }
  src.outletCount = 3;
  src.outletIndices = outletIndices;
  src.outletWeights = new Float32Array([0.6, 0.2, 0.2]);
  src.directionX = directionX;
  src.directionY = directionY;
}

/** Rebuilds erosion-only source protection after source topology changes. */
function refreshSourceProtectionMask() {
  sourceProtectionMask.fill(1);
  for (let source = 0; source < sources.length; source++) {
    const src = sources[source];
    for (let y = Math.max(0, src.y - SOURCE_PROTECTION_MAX_RADIUS); y <= Math.min(N - 1, src.y + SOURCE_PROTECTION_MAX_RADIUS); y++) {
      for (let x = Math.max(0, src.x - SOURCE_PROTECTION_MAX_RADIUS); x <= Math.min(N - 1, src.x + SOURCE_PROTECTION_MAX_RADIUS); x++) {
        const dx = x - src.x;
        const dy = y - src.y;
        const distanceSquared = dx * dx + dy * dy;
        let factor = 1;
        if (distanceSquared <= SOURCE_FOUNDATION_RADIUS_SQUARED) factor = 0;
        else if (distanceSquared <= SOURCE_TRANSITION_RADIUS_SQUARED) factor = 0.5;
        const cell = idx(x, y);
        if (factor < sourceProtectionMask[cell]) sourceProtectionMask[cell] = factor;
      }
    }
  }
}

function step() {
  injectSources();

  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
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
    }
  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      const fin =
        (x > 0 ? fR[i - 1] : 0) +
        (x < N - 1 ? fL[i + 1] : 0) +
        (y > 0 ? fB[i - N] : 0) +
        (y < N - 1 ? fT[i + N] : 0);
      const fout = fL[i] + fR[i] + fT[i] + fB[i];
      tmpD[i] = Math.max(0, d[i] + (DT * (fin - fout)) / (L * L));
    }
  }
  {
    const t = d;
    d = tmpD;
    tmpD = t;
  }

  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
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
        const diff = KS * (C - si) * sourceProtectionMask[i];
        b[i] -= diff;
        s[i] = si + diff;
      } else {
        const diff = KD * (si - C);
        b[i] += diff;
        s[i] = Math.max(0, si - diff);
      }
    }
  }

  for (let y = 0; y < N; y++) {
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
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
      const row0 = y0 * N,
        row1 = y1 * N;
      const s00 = s[row0 + x0],
        s10 = s[row0 + x1];
      const s01 = s[row1 + x0],
        s11 = s[row1 + x1];
      tmpS[i] = lerp(lerp(s00, s10, tx), lerp(s01, s11, tx), ty);
      d[i] *= 1 - KE * DT;
    }
  }
  {
    const t = s;
    s = tmpS;
    tmpS = t;
  }

  steps++;
  simTime += DT;
}
