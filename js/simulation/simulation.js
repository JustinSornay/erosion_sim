/**
 * Conservative virtual-pipe height-field model (v2).
 * d: water volume / cell area; s: equivalent solid volume / cell area.
 * b + s is conserved, including solid exported through an open boundary.
 * This is an interactive landscape model, not a calibrated hydraulic solver.
 */
function configureSourceOutlets(src) {
  if (!Number.isInteger(src.x) || !Number.isInteger(src.y) ||
      src.x < 0 || src.y < 0 || src.x >= N || src.y >= N ||
      !Number.isFinite(src.rate) || src.rate < 0 || src.rate > 100)
    throw new Error("Source invalide.");
  // A point source changes water depth at the click, not five cells away.
  // There is no compass direction, terrain excavation, or hidden rock collar.
  src.outletCount = 1;
  src.outletIndices = new Int32Array([idx(src.x, src.y)]);
  src.outletWeights = new Float64Array([1]);
  src.directionX = 0;
  src.directionY = 0;
}

function refreshSourceProtectionMask() {
  // Retained API for the renderer and old callers; water sources are not rocks.
  sourceProtectionMask.fill(1);
}

function resetBudgets() {
  let initialWater = 0, initialSolid = 0;
  for (let i = 0; i < NN; i++) {
    initialWater += d[i] * L * L;
    initialSolid += (b[i] + s[i]) * L * L;
  }
  budget = { initialWater, initialSolid, injected: 0, rain: 0, evaporated: 0,
    waterIn: 0, waterOut: 0, sedimentOut: 0, eroded: 0, deposited: 0, lastOutflow: 0 };
}

function injectSources() {
  const area = L * L;
  for (const src of sources) {
    if (!src.active || src.rate === 0) continue;
    const volume = DT * src.rate;
    d[idx(src.x, src.y)] += volume / area;
    budget.injected += volume;
  }
  if (simulationOptions.rainfall > 0) {
    const depth = simulationOptions.rainfall * DT;
    for (let i = 0; i < NN; i++) d[i] += depth;
    budget.rain += depth * NN * area;
  }
}

// A marine face sees a fixed external free surface, not a bottomless drain.
// Signed momentum is persisted; accepted inward water is counted explicitly.
function marineFaceFlux(face, i, h, acceleration, damping) {
  const outsideHead = Math.max(b[i], seaLevel);
  const q = (seaFlux[face] + acceleration * (h - outsideHead)) * damping;
  seaFlux[face] = q;
  if (q < 0) seaIncoming[i] -= q;
  return Math.max(0, q);
}

/** One signed flux per face. Opposing fictitious pipes cannot circulate water. */
function updateFluxes() {
  const acceleration = DT * A * G / L;
  const damping = 1 / (1 + FLOW_DRAG * DT);
  const open = simulationOptions.boundary === "open";
  const marine = seaLevel !== null;
  if (marine) seaIncoming.fill(0);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, y), h = b[i] + d[i];
      if (x < N - 1) {
        const j = i + 1;
        const q = ((fR[i] - fL[j]) + acceleration * (h - b[j] - d[j])) * damping;
        fR[i] = q > 0 ? q : 0;
        fL[j] = q < 0 ? -q : 0;
      }
      if (y < N - 1) {
        const j = i + N;
        const q = ((fB[i] - fT[j]) + acceleration * (h - b[j] - d[j])) * damping;
        fB[i] = q > 0 ? q : 0;
        fT[j] = q < 0 ? -q : 0;
      }
      // Free outflow, no water supplied from outside. Extrapolate only a
      // descending bed; an uphill boundary does not create a negative head.
      if (x === 0) fL[i] = marine ? marineFaceFlux(y, i, h, acceleration, damping)
        : open ? Math.max(0, (fL[i] + acceleration * (d[i] + Math.max(0, b[i + 1] - b[i]))) * damping) : 0;
      if (x === N - 1) fR[i] = marine ? marineFaceFlux(N + y, i, h, acceleration, damping)
        : open ? Math.max(0, (fR[i] + acceleration * (d[i] + Math.max(0, b[i - 1] - b[i]))) * damping) : 0;
      if (y === 0) fT[i] = marine ? marineFaceFlux(2 * N + x, i, h, acceleration, damping)
        : open ? Math.max(0, (fT[i] + acceleration * (d[i] + Math.max(0, b[i + N] - b[i]))) * damping) : 0;
      if (y === N - 1) fB[i] = marine ? marineFaceFlux(3 * N + x, i, h, acceleration, damping)
        : open ? Math.max(0, (fB[i] + acceleration * (d[i] + Math.max(0, b[i - N] - b[i]))) * damping) : 0;
    }
  }
  const area = L * L;
  for (let i = 0; i < NN; i++) {
    // Immobile microscopic films are retained, not erased. This avoids
    // subnormal arithmetic without changing either conservation budget.
    if (d[i] < DRY_DEPTH * 0.001) {
      fL[i] = fR[i] = fT[i] = fB[i] = 0;
      continue;
    }
    const total = fL[i] + fR[i] + fT[i] + fB[i];
    if (total === 0) continue;
    // Headroom of a few floating-point ulps preserves donor positivity even
    // when a cell empties. No absolute clipping / global renormalization.
    const scale = Math.min(1, (d[i] * area) / (DT * total) * (1 - 8 * Number.EPSILON));
    fL[i] *= scale; fR[i] *= scale; fT[i] *= scale; fB[i] *= scale;
  }
  if (marine) for (let k = 0; k < N; k++) {
    // Retain actual accepted outflow momentum after the donor limiter.
    if (seaFlux[k] > 0) seaFlux[k] = fL[k * N];
    if (seaFlux[N + k] > 0) seaFlux[N + k] = fR[k * N + N - 1];
    if (seaFlux[2 * N + k] > 0) seaFlux[2 * N + k] = fT[k];
    if (seaFlux[3 * N + k] > 0) seaFlux[3 * N + k] = fB[NN - N + k];
  }
}

/** The same accepted water transfers carry sediment, using pre-transfer depth. */
function transportWaterAndSediment() {
  const dtArea = DT / (L * L);
  tmpD.fill(0);
  tmpS.fill(0);
  let exportedWater = 0, exportedSediment = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      const qL = fL[i] * dtArea, qR = fR[i] * dtArea;
      const qT = fT[i] * dtArea, qB = fB[i] * dtArea;
      const total = qL + qR + qT + qB;
      if (total === 0) {
        tmpD[i] += d[i]; tmpS[i] += s[i];
        continue;
      }
      const retainedWater = d[i] - total;
      // Flux limiting guarantees this invariant; do not hide a broken budget.
      if (retainedWater < 0 || !Number.isFinite(retainedWater))
        throw new Error(`Transport non conservatif: step=${steps}, cell=${i}, d=${d[i]}, total=${total}, remainder=${retainedWater}`);
      tmpD[i] += retainedWater;
      // Ratios of accepted water volumes stay in [0,1]. Unlike s/d, they
      // cannot overflow for almost dry cells loaded from a valid snapshot.
      const moved = s[i] * Math.min(1, total / d[i]);
      let remaining = s[i];
      const mL = Math.min(remaining, moved * (qL / total)); remaining -= mL;
      const mR = Math.min(remaining, moved * (qR / total)); remaining -= mR;
      const mT = Math.min(remaining, moved * (qT / total)); remaining -= mT;
      const mB = Math.min(remaining, moved * (qB / total)); remaining -= mB;
      tmpS[i] += remaining;
      if (x > 0) { tmpD[i - 1] += qL; tmpS[i - 1] += mL; }
      else { exportedWater += qL; exportedSediment += mL; }
      if (x < N - 1) { tmpD[i + 1] += qR; tmpS[i + 1] += mR; }
      else { exportedWater += qR; exportedSediment += mR; }
      if (y > 0) { tmpD[i - N] += qT; tmpS[i - N] += mT; }
      else { exportedWater += qT; exportedSediment += mT; }
      if (y < N - 1) { tmpD[i + N] += qB; tmpS[i + N] += mB; }
      else { exportedWater += qB; exportedSediment += mB; }
    }
  }
  if (seaLevel !== null) {
    let importedWater = 0;
    for (let i = 0; i < NN; i++) if (seaIncoming[i] > 0) {
      const depth = seaIncoming[i] * dtArea;
      tmpD[i] += depth; importedWater += depth;
    }
    budget.waterIn += importedWater * L * L; // Incoming sea has no suspended load.
  }
  [d, tmpD] = [tmpD, d]; // tmpD now holds the pre-transfer water depth.
  [s, tmpS] = [tmpS, s];
  budget.waterOut += exportedWater * L * L;
  budget.sedimentOut += exportedSediment * L * L;
  budget.lastOutflow = exportedWater * L * L / DT;
}

/** Simultaneous bed exchange: gradients never see partially updated terrain. */
function updateVelocityAndExchange() {
  const erodeFraction = -Math.expm1(-simulationOptions.erosionRate * DT);
  const depositFraction = -Math.expm1(-simulationOptions.depositionRate * DT);
  bedDelta.fill(0);
  let eroded = 0, deposited = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      if (d[i] <= DRY_DEPTH && s[i] === 0) { u[i] = v[i] = 0; continue; }
      const inL = x > 0 ? fR[i - 1] : seaLevel === null ? 0 : Math.max(0, -seaFlux[y]);
      const inR = x < N - 1 ? fL[i + 1] : seaLevel === null ? 0 : Math.max(0, -seaFlux[N + y]);
      const inT = y > 0 ? fB[i - N] : seaLevel === null ? 0 : Math.max(0, -seaFlux[2 * N + x]);
      const inB = y < N - 1 ? fT[i + N] : seaLevel === null ? 0 : Math.max(0, -seaFlux[3 * N + x]);
      const meanDepth = Math.max(DRY_DEPTH, (tmpD[i] + d[i]) * 0.5);
      u[i] = (inL - fL[i] + fR[i] - inR) / (2 * L * meanDepth);
      v[i] = (inT - fT[i] + fB[i] - inB) / (2 * L * meanDepth);
      if (!simulationOptions.erosion) continue;
      const dx = ((x < N - 1 ? b[i + 1] : b[i]) - (x > 0 ? b[i - 1] : b[i])) / (2 * L);
      const dy = ((y < N - 1 ? b[i + N] : b[i]) - (y > 0 ? b[i - N] : b[i])) / (2 * L);
      const slope = Math.sqrt(dx * dx + dy * dy);
      const sinSlope = slope / Math.sqrt(1 + slope * slope);
      const capacity = d[i] > DRY_DEPTH ? d[i] * Math.min(MAX_SEDIMENT_CONCENTRATION,
        simulationOptions.capacity * sinSlope * Math.sqrt(u[i] * u[i] + v[i] * v[i])) : 0;
      const excess = s[i] - capacity;
      if (excess > 0) {
        const amount = d[i] <= DRY_DEPTH ? s[i] : depositFraction * excess;
        bedDelta[i] = amount; s[i] -= amount; deposited += amount;
      } else if (excess < 0) {
        const amount = Math.min(-excess * erodeFraction, Math.max(0, b[i] - bedrock[i]));
        bedDelta[i] = -amount; s[i] += amount; eroded += amount;
      }
    }
  }
  for (let i = 0; i < NN; i++) b[i] += bedDelta[i];
  budget.eroded += eroded * L * L;
  budget.deposited += deposited * L * L;
}

function evaporateWater() {
  const fraction = -Math.expm1(-simulationOptions.evaporation * DT);
  let removed = 0;
  for (let i = 0; i < NN; i++) {
    const amount = d[i] * fraction;
    d[i] -= amount; removed += amount;
    // Evaporation removes water, never sediment. Dry suspended material settles.
    // Settle below-resolution traces as well: retaining exponentially tiny
    // suspended loads would eventually trigger very slow subnormal arithmetic.
    // The transferred amount is still recorded in the solid budget.
    if (simulationOptions.erosion && (d[i] <= DRY_DEPTH || s[i] < 1e-24) && s[i] > 0) {
      const deposited = s[i]; b[i] += deposited; s[i] = 0;
      budget.deposited += deposited * L * L;
    }
  }
  budget.evaporated += removed * L * L;
}

function step() {
  injectSources();
  updateFluxes();
  transportWaterAndSediment();
  updateVelocityAndExchange();
  evaporateWater();
  steps++;
  simTime = steps * DT;
}

/** Observations only: this function never corrects or renormalizes the state. */
function getSimulationStats() {
  let water = 0, suspended = 0, solid = 0, wetCells = 0, incision = 0, deposit = 0;
  let maxDepth = 0, minWater = Infinity, minSediment = Infinity, finite = true;
  for (let i = 0; i < NN; i++) {
    water += d[i] * L * L; suspended += s[i] * L * L;
    solid += (b[i] + s[i]) * L * L;
    if (d[i] > 0.001) wetCells++;
    maxDepth = Math.max(maxDepth, d[i]);
    minWater = Math.min(minWater, d[i]); minSediment = Math.min(minSediment, s[i]);
    incision = Math.max(incision, bInit[i] - b[i]); deposit = Math.max(deposit, b[i] - bInit[i]);
    if (!Number.isFinite(b[i] + d[i] + s[i] + u[i] + v[i])) finite = false;
  }
  return { version: PHYSICS_VERSION, steps, simTime, seed: terrainSeed, preset: terrainPreset,
    water, suspended, solid, wetCells, incision, deposit, maxDepth, minWater, minSediment, finite,
    ...budget, waterResidual: budget.initialWater + budget.injected + budget.rain + budget.waterIn -
      budget.waterOut - budget.evaporated - water,
    solidResidual: budget.initialSolid - solid - budget.sedimentOut };
}
