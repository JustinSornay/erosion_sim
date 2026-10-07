const fpsEl = document.getElementById("fps"), tEl = document.getElementById("tcount"), tsimEl = document.getElementById("tsim");
const tgtMultEl = document.getElementById("tgtMult"), realMultEl = document.getElementById("realMult");
let lastT = performance.now(), frames = 0, fpsAcc = 0;
let stepAccumulator = 0, achievedStepsPerSecSmoothed = 0;
const FRAME_BUDGET_MS = 14;
let lastDrainageUpdate = 0, lastActiveNetworkUpdate = 0, lastParticleUpdate = 0, lastRender = 0, lastHudUpdate = 0;
let renderedFrames = 0;
window.__erosionPerformance = { renderedFrames: 0 };

function loop(now) {
  const dtRealMs = Math.max(0, Math.min(80, now - lastT)); lastT = now;
  if (document.hidden) { stepAccumulator = 0; requestAnimationFrame(loop); return; }
  frames++; fpsAcc += dtRealMs;
  if (fpsAcc > 500) { fpsEl.textContent = (1000 * frames / fpsAcc).toFixed(0); frames = 0; fpsAcc = 0; }
  const targetMultiplier = SPEED_STEPS[Number(speedEl.value)] || 1;
  const cadence = getVisualCadence(targetMultiplier);
  let achieved = 0;
  if (!paused) {
    // Drop wall-clock debt when overloaded, never alter or skip a physical step.
    // x1 means 1 second of model time per second, not the historical 60*DT.
    stepAccumulator = Math.min(stepAccumulator + targetMultiplier * dtRealMs / (1000 * DT), targetMultiplier * 12);
    const toRun = Math.floor(stepAccumulator), started = performance.now();
    try {
      while (achieved < toRun) {
        step(); achieved++;
        if (performance.now() - started >= FRAME_BUDGET_MS) break;
      }
      stepAccumulator -= achieved;
    } catch (error) {
      paused = true; stepAccumulator = 0; pauseIcon.textContent = "\u25b6";
      pauseBtn.classList.add("active"); pauseBtn.setAttribute("aria-pressed", "true");
      notify(`Simulation arrêtée : ${error.message}`, true); console.error(error);
    }
  } else stepAccumulator = 0;
  achievedStepsPerSecSmoothed = lerp(achievedStepsPerSecSmoothed, achieved / (dtRealMs / 1000 || 1), .15);
  tgtMultEl.textContent = "\u00d7" + targetMultiplier;
  realMultEl.textContent = paused ? "pause" : "\u00d7" + (achievedStepsPerSecSmoothed * DT).toFixed(1);

  // D8 is an optional terrain analysis, not an input to the water solver.
  if (viewMode === "contribution" && !paused && now - lastDrainageUpdate >= DRAINAGE_UPDATE_MS) {
    computeDrainage(); invalidateDrainagePaths(); lastDrainageUpdate = now;
  }
  if (viewMode === "composite" && now - lastActiveNetworkUpdate >= 1000 / cadence.activeNetworkHz) {
    computeActiveNetwork(); lastActiveNetworkUpdate = now;
  }
  if (now - lastParticleUpdate >= 1000 / cadence.particleHz && layerOn.particules && viewMode === "composite") {
    if (!paused) stepParticles(getParticleVisualDt(targetMultiplier));
    lastParticleUpdate = now;
  }
  if (now - lastRender >= 1000 / cadence.renderHz) {
    render(DEFAULT_ISO_STEP); lastRender = now;
    window.__erosionPerformance.renderedFrames = ++renderedFrames;
  }
  if (now - lastHudUpdate >= HUD_UPDATE_MS) {
    tEl.textContent = steps; tsimEl.textContent = simTime.toFixed(1); updateMetrics(); lastHudUpdate = now;
  }
  requestAnimationFrame(loop);
}

document.addEventListener("visibilitychange", resetClock);
genTerrain({ seed: 314159265, preset: "valley" });
syncTerrainControls(); refreshSourceList(); setMode("composite"); updateMetrics();
requestAnimationFrame(loop);
