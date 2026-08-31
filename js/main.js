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

  computeDrainage();
  computeActiveNetwork();
  stepParticles(paused ? 0 : getParticleVisualDt(targetMultiplier));
  render(DEFAULT_ISO_STEP);
  tEl.textContent = steps;
  tsimEl.textContent = simTime.toFixed(1);
  requestAnimationFrame(loop);
}

genTerrain();
refreshSourceList();
setMode("composite");
requestAnimationFrame(loop);
