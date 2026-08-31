// ---------- boucle ----------
const fpsEl = document.getElementById("fps"),
  tEl = document.getElementById("tcount"),
  tsimEl = document.getElementById("tsim");
const tgtMultEl = document.getElementById("tgtMult"),
  realMultEl = document.getElementById("realMult");
let lastT = performance.now(),
  frames = 0,
  fpsAcc = 0;
let stepAccumulator = 0;
let achievedStepsPerSecSmoothed = 60;
const FRAME_BUDGET_MS = 35;
let lastDrainageUpdate = 0;
let lastActiveNetworkUpdate = 0;
let lastHudUpdate = 0;

function loop(now) {
  const dtRealMs = Math.min(80, now - lastT);
  lastT = now;
  frames++;
  fpsAcc += dtRealMs;
  if (fpsAcc > 500) {
    fpsEl.textContent = (1000 / (fpsAcc / frames)).toFixed(0);
    frames = 0;
    fpsAcc = 0;
  }

  const targetMultiplier = SPEED_STEPS[+speedEl.value];
  let achieved = 0;
  if (!paused) {
    const target = targetMultiplier;
    stepAccumulator += target * (dtRealMs / (1000 / 60));
    stepAccumulator = Math.min(stepAccumulator, target * 20);
    let toRun = Math.floor(stepAccumulator);
    const budgetStart = performance.now();
    while (achieved < toRun) {
      step();
      achieved++;
      if (performance.now() - budgetStart > FRAME_BUDGET_MS) break;
    }
    stepAccumulator -= achieved;
    const instRate = achieved / (dtRealMs / 1000 || 1);
    achievedStepsPerSecSmoothed = lerp(
      achievedStepsPerSecSmoothed,
      instRate,
      0.15,
    );
    tgtMultEl.textContent = "×" + target;
    realMultEl.textContent =
      "×" + Math.max(1, Math.round(achievedStepsPerSecSmoothed / 60));
  }

  if (now - lastDrainageUpdate >= DRAINAGE_UPDATE_MS) {
    computeDrainage();
    invalidateDrainagePaths();
    lastDrainageUpdate = now;
  }

  if (now - lastActiveNetworkUpdate >= ACTIVE_NETWORK_UPDATE_MS) {
    computeActiveNetwork();
    lastActiveNetworkUpdate = now;
  }

  if (layerOn.particules && viewMode === "composite") {
    stepParticles(paused ? 0 : getParticleVisualDt(targetMultiplier));
  }
  render(DEFAULT_ISO_STEP);

  if (now - lastHudUpdate >= HUD_UPDATE_MS) {
    tEl.textContent = steps;
    tsimEl.textContent = simTime.toFixed(1);
    lastHudUpdate = now;
  }
  requestAnimationFrame(loop);
}

genTerrain();
refreshSourceList();
setMode("composite");
requestAnimationFrame(loop);
