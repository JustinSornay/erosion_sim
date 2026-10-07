const speedEl = document.getElementById("speed"),
  speedLbl = document.getElementById("speedLbl");
const pauseBtn = document.getElementById("pause");
const pauseIcon = document.getElementById("pauseIcon");
const sourcesDiv = document.getElementById("sources");
const modeLbl = document.getElementById("modeLbl");
const layersBox = document.getElementById("layersBox");
const dividerBottom = document.getElementById("divider-bottom");
const sidePanel = document.getElementById("side-panel");
const panelTab = document.getElementById("panel-tab");
const closePanelBtn = document.getElementById("close-panel");
let paused = false;

// SVG symbols are inline in both distributions, including in offline file:// use.
function setIcon(element, name) {
  element.querySelector("use").setAttribute("href", "#icon-" + name);
}
function createIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("icon"); svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#icon-" + name); svg.appendChild(use); return svg;
}

// UI bounds derive from requested simulation targets, preventing stale slider positions.
speedEl.min = "0";
speedEl.max = String(SPEED_STEPS.length - 1);
speedEl.value = String(
  Math.min(Math.max(Number(speedEl.value) || 0, 0), SPEED_STEPS.length - 1),
);
speedLbl.textContent = "×" + SPEED_STEPS[+speedEl.value];

function buildLayerUI(defs, containerId) {
  const container = document.getElementById(containerId);
  defs.forEach((L) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "layer-item on";
    row.dataset.id = L.id;
    row.style.setProperty("--c", L.color);
    row.innerHTML = `<div class="swatch"></div><span>${L.label}</span>`;
    row.onclick = () => {
      layerOn[L.id] = !layerOn[L.id];
      updateLayersUI();
    };
    container.appendChild(row);
  });
}

buildLayerUI(LAYER_DEFS_TERRAIN, "layers-terrain");
buildLayerUI(LAYER_DEFS_WATER, "layers-water");

function updateLayersUI() {
  document.querySelectorAll(".layer-item").forEach((row) => {
    row.classList.toggle("on", !!layerOn[row.dataset.id]);
    row.setAttribute("aria-pressed", String(!!layerOn[row.dataset.id]));
  });
  document.querySelectorAll(".layer-group-title").forEach(button => {
    const items = [...document.getElementById(button.dataset.group).querySelectorAll(".layer-item")];
    const count = items.filter(item => layerOn[item.dataset.id]).length;
    button.setAttribute("aria-pressed", count === 0 ? "false" : count === items.length ? "true" : "mixed");
  });
}

function setMode(m) {
  viewMode = m;
  document
    .querySelectorAll(".modes button[data-m]")
    .forEach((b) => {
      b.classList.toggle("on", b.dataset.m === m);
      b.setAttribute("aria-pressed", String(b.dataset.m === m));
    });
  modeLbl.textContent = m === "composite" ? "Simulation" : m === "change" ? "Érosion / dépôts" : "Pentes D8";
  if (m === "contribution") { computeDrainage(); invalidateDrainagePaths(); }
  document.getElementById("stage-hint").textContent = m === "change"
    ? "Orange : érosion. Vert : dépôts. Le fond gris est inchangé."
    : m === "contribution" ? "Réseau potentiel du relief : les cuvettes peuvent retenir l'eau."
    : "Cliquez pour ajouter une source ; cliquez dessus pour l'activer ou la couper.";
  document.getElementById("stage-hint").hidden = m === "composite";
  layersBox.style.display = m === "composite" ? "block" : "none";
  dividerBottom.style.display = m === "composite" ? "block" : "none";
  updateLayersUI();
}

document.querySelectorAll(".modes button[data-m]").forEach((btn) => {
  btn.onclick = () => setMode(btn.dataset.m);
});

// --- Make group titles clickable toggles ---
function toggleGroup(groupId) {
  const list = document.getElementById(groupId);
  const items = list.querySelectorAll(".layer-item");
  let allOn = true;
  items.forEach((item) => {
    if (!layerOn[item.dataset.id]) allOn = false;
  });
  const newState = !allOn;
  items.forEach((item) => {
    layerOn[item.dataset.id] = newState;
  });
  updateLayersUI();
}

document.querySelectorAll(".layer-group-title").forEach((title) => {
  title.addEventListener("click", () => {
    const groupId = title.dataset.group;
    if (groupId) toggleGroup(groupId);
  });
});

speedEl.oninput = () => {
  speedLbl.textContent = "×" + SPEED_STEPS[+speedEl.value];
  speedEl.setAttribute("aria-valuetext", speedLbl.textContent);
};

pauseBtn.onclick = () => {
  paused = !paused;
  pauseBtn.classList.toggle("active", paused);
  setIcon(pauseIcon, paused ? "play" : "pause");
  pauseBtn.setAttribute("aria-label", paused ? "Reprendre la simulation" : "Mettre en pause");
  pauseBtn.setAttribute("aria-pressed", String(paused));
  resetClock();
};
document.getElementById("regen").onclick = () => {
  const btn = document.getElementById("regen");
  btn.style.transform = "scale(0.9)";
  setTimeout(() => (btn.style.transform = "scale(1)"), 100);
  generateFromControls(true);
};
document.getElementById("clearSrc").onclick = () => {
  sources.length = 0;
  refreshSourceProtectionMask();
  refreshSourceList();
};

// Keep off-canvas settings out of keyboard navigation on small screens.
const mobilePanelQuery = matchMedia("(max-width: 767px)");
function syncPanelAccessibility() {
  const open = sidePanel.classList.contains("open");
  const hidden = mobilePanelQuery.matches && !open;
  sidePanel.inert = hidden;
  panelTab.classList.toggle("hidden", open);
  panelTab.setAttribute("aria-expanded", String(!hidden));
}
function setPanelOpen(open, focus = false) {
  sidePanel.classList.toggle("open", open); syncPanelAccessibility();
  if (focus && mobilePanelQuery.matches) (open ? closePanelBtn : panelTab).focus({ preventScroll: true });
}
function togglePanel() { setPanelOpen(!sidePanel.classList.contains("open"), true); }
mobilePanelQuery.addEventListener("change", () => {
  syncPanelAccessibility();
  if (sidePanel.inert && sidePanel.contains(document.activeElement)) panelTab.focus({ preventScroll: true });
});
syncPanelAccessibility();
panelTab.addEventListener("click", togglePanel);
closePanelBtn.addEventListener("click", togglePanel);

// Fonction utilitaire pour ajouter une source (utilisée pour le clic gauche et le clic droit)
function addSourceAt(gx, gy) {
  for (let i = 0; i < sources.length; i++) {
    const s2 = sources[i];
    if (Math.hypot(s2.x - gx, s2.y - gy) < 6) {
      s2.active = !s2.active;
      refreshSourceProtectionMask();
      refreshSourceList();
      return;
    }
  }
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
  if (sources.length >= 128) { notify("Limite de 128 sources atteinte."); return; }
  const cx = Math.max(0, Math.min(N - 1, Math.floor(gx)));
  const cy = Math.max(0, Math.min(N - 1, Math.floor(gy)));
  const source = { x: cx, y: cy, rate: DEFAULT_RATE, active: true };
  configureSourceOutlets(source);
  sources.push(source);
  refreshSourceProtectionMask();

  canvas.style.transform = "scale(0.99)";
  setTimeout(() => (canvas.style.transform = "scale(1)"), 100);

  refreshSourceList();
}

// Clic gauche (existant)
canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const px0 = (e.clientX - rect.left) / rect.width,
    py0 = (e.clientY - rect.top) / rect.height;
  addSourceAt(px0 * N, py0 * N);
});

// Clic droit : Afficher le menu contextuel personnalisé
const contextMenu = document.getElementById("context-menu");
const ctxAddBtn = document.getElementById("ctx-add-source");
const ctxToggleBtn = document.getElementById("ctx-toggle-source");
const ctxDeleteBtn = document.getElementById("ctx-delete-source");
const ctxToggleIcon = ctxToggleBtn.querySelector(".icon");
const ctxToggleLabel = ctxToggleBtn.querySelector(".context-menu-label");
let contextMenuTarget = { x: 0, y: 0, index: -1 };

/** Aligns source-state feedback with the action exposed by the context menu. */
function updateSourceContextMenu(source) {
  const isActive = source.active;
  setIcon(ctxToggleIcon, isActive ? "toggle-on" : "toggle-off");
  ctxToggleLabel.textContent = isActive
    ? "Désactiver la source"
    : "Activer la source";
  ctxToggleBtn.dataset.state = isActive ? "active" : "inactive";
}

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const px0 = (e.clientX - rect.left) / rect.width,
    py0 = (e.clientY - rect.top) / rect.height;
  const gx = px0 * N;
  const gy = py0 * N;
  contextMenuTarget = { x: gx, y: gy, index: -1 };

  // Vérifier si on a cliqué sur une source existante
  for (let i = 0; i < sources.length; i++) {
    const s2 = sources[i];
    if (Math.hypot(s2.x - gx, s2.y - gy) < 6) {
      contextMenuTarget.index = i;
      break;
    }
  }

  // Configurer le menu en conséquence
  if (contextMenuTarget.index >= 0) {
    const source = sources[contextMenuTarget.index];
    ctxAddBtn.style.display = "none";
    ctxToggleBtn.style.display = "flex";
    ctxDeleteBtn.style.display = "flex";
    updateSourceContextMenu(source);
  } else {
    ctxAddBtn.style.display = "flex";
    ctxToggleBtn.style.display = "none";
    ctxDeleteBtn.style.display = "none";
  }

  // Positionner le menu
  contextMenu.style.display = "block";
  // The menu belongs to the stage, not the whole window: keep edge clicks
  // away from the settings panel and inside the stage's clipped area.
  const stageRect = document.getElementById("stage").getBoundingClientRect();
  contextMenu.style.left = Math.max(8, Math.min(e.clientX - stageRect.left, stageRect.width - contextMenu.offsetWidth - 8)) + "px";
  contextMenu.style.top = Math.max(8, Math.min(e.clientY - stageRect.top, stageRect.height - contextMenu.offsetHeight - 8)) + "px";
});

// Fermer le menu quand on clique ailleurs
document.addEventListener("click", (e) => {
  if (!contextMenu.contains(e.target)) {
    contextMenu.style.display = "none";
  }
});

// Action du menu contextuel : ajouter
ctxAddBtn.addEventListener("click", () => {
  addSourceAt(contextMenuTarget.x, contextMenuTarget.y);
  contextMenu.style.display = "none";
});

// Action du menu contextuel : toggle source
ctxToggleBtn.addEventListener("click", () => {
  if (contextMenuTarget.index >= 0) {
    const src = sources[contextMenuTarget.index];
    src.active = !src.active;
    refreshSourceProtectionMask();
    refreshSourceList();
  }
  contextMenu.style.display = "none";
});

// Action du menu contextuel : supprimer
ctxDeleteBtn.addEventListener("click", () => {
  if (contextMenuTarget.index >= 0) {
    sources.splice(contextMenuTarget.index, 1);
    refreshSourceProtectionMask();
    refreshSourceList();
  }
  contextMenu.style.display = "none";
});

function refreshSourceList() {
  sourcesDiv.replaceChildren();
  document.getElementById("srcCount").textContent = `${sources.filter(source => source.active).length} / ${sources.length}`;
  if (sources.length === 0) {
    const empty = document.createElement("p"); empty.className = "empty-sources";
    empty.textContent = "Aucune source. Clic sur le terrain."; sourcesDiv.appendChild(empty); return;
  }
  sources.forEach((source, i) => {
    const row = document.createElement("div"); row.className = "src-row";
    const toggle = document.createElement("button"); toggle.className = source.active ? "source-toggle" : "source-toggle off";
    toggle.textContent = `Source ${i + 1}`;
    toggle.title = `Source ${i + 1} : ${source.active ? "désactiver" : "activer"}`;
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-pressed", String(source.active));
    toggle.onclick = () => { source.active = !source.active; refreshSourceList(); };
    const rate = document.createElement("input"); rate.type = "number";
    rate.min = "0"; rate.max = "100"; rate.step = "0.1"; rate.value = source.rate;
    rate.setAttribute("aria-label", `Débit de la source ${i + 1}, unités de volume par seconde de simulation`);
    rate.onchange = () => {
      const value = rate.valueAsNumber;
      if (!Number.isFinite(value) || value < 0 || value > 100) { rate.value = source.rate; notify("Débit attendu : 0 à 100."); return; }
      source.rate = value;
    };
    const unit = document.createElement("span"); unit.className = "source-unit"; unit.textContent = "u\u00b3/s";
    const remove = document.createElement("button"); remove.appendChild(createIcon("close")); remove.className = "source-remove";
    remove.setAttribute("aria-label", `Supprimer la source ${i + 1}`);
    remove.onclick = () => { sources.splice(i, 1); refreshSourceProtectionMask(); refreshSourceList(); };
    row.append(toggle, rate, unit, remove); sourcesDiv.appendChild(row);
  });
}

let toastTimer;
function notify(message, error = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message; toast.classList.toggle("error", error); toast.classList.add("visible");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("visible"), 5000);
}
function resetClock() {
  // Called only by user actions, after main.js has initialized these bindings.
  stepAccumulator = 0; lastT = performance.now(); achievedStepsPerSecSmoothed = 0;
}
function syncTerrainControls() {
  document.getElementById("terrainSeed").value = terrainSeed;
  document.getElementById("preset").value = terrainPreset;
  document.getElementById("boundary").value = simulationOptions.boundary;
  const rainSelect = document.getElementById("rain");
  rainSelect.querySelectorAll("option[data-custom]").forEach(option => option.remove());
  const rainValue = String(simulationOptions.rainfall);
  if (![...rainSelect.options].some(option => option.value === rainValue)) {
    const option = document.createElement("option"); option.value = rainValue;
    option.textContent = `Personnalisée (${rainValue})`; option.dataset.custom = "true"; rainSelect.appendChild(option);
  }
  rainSelect.value = rainValue;
  document.getElementById("erode").checked = simulationOptions.erosion;
  const names = { valley: "Vallée sinueuse", natural: "Terrain naturel", basin: "Cuvette", ridge: "Crête" };
  document.getElementById("terrainCaption").textContent = `${names[terrainPreset]} / ${terrainSeed}`;
}
function generateFromControls(random = false) {
  try {
    genTerrain({ seed: random ? Math.floor(Math.random() * 1e9) : document.getElementById("terrainSeed").valueAsNumber,
      preset: document.getElementById("preset").value });
    contextMenu.style.display = "none";
    resetClock(); syncTerrainControls(); refreshSourceList(); updateMetrics();
  } catch (error) { notify(error.message, true); }
}
document.getElementById("applyTerrain").onclick = () => generateFromControls();
document.getElementById("replay").onclick = () => {
  const keep = sources.map(({ x, y, rate, active }) => ({ x, y, rate, active }));
  genTerrain({ seed: terrainSeed, preset: terrainPreset });
  for (const src of keep) { configureSourceOutlets(src); sources.push(src); }
  resetClock(); syncTerrainControls(); refreshSourceList(); updateMetrics();
  notify("Même terrain, mêmes sources : simulation remise à zéro.");
};
document.getElementById("demo").onclick = () => {
  genTerrain({ seed: 314159265, preset: "valley" });
  Object.assign(simulationOptions, DEFAULT_SIMULATION_OPTIONS);
  const src = { x: 107, y: 22, rate: DEFAULT_RATE, active: true }; configureSourceOutlets(src); sources.push(src);
  paused = false; setIcon(pauseIcon, "pause"); pauseBtn.setAttribute("aria-label", "Mettre en pause"); pauseBtn.classList.remove("active"); pauseBtn.setAttribute("aria-pressed", "false");
  speedEl.value = "2"; speedEl.oninput(); resetClock(); syncTerrainControls(); refreshSourceList(); setMode("composite");
  notify("La rivière est lancée. La vue Érosion / dépôts révèle le travail de l'eau.");
};
document.getElementById("boundary").onchange = event => { simulationOptions.boundary = event.target.value; };
document.getElementById("rain").onchange = event => { simulationOptions.rainfall = Number(event.target.value); };
document.getElementById("erode").onchange = event => { simulationOptions.erosion = event.target.checked; };
function updateMetrics() {
  const stats = getSimulationStats();
  for (const [id, key] of [["statWater", "water"], ["statOut", "waterOut"], ["statEroded", "eroded"], ["statDeposited", "deposited"]])
    document.getElementById(id).textContent = stats[key].toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const good = stats.finite && Math.abs(stats.waterResidual) < 1e-6 && Math.abs(stats.solidResidual) < 1e-6;
  const status = document.getElementById("budget-status");
  status.textContent = good ? "Eau et matière : bilans conservés." : "Attention : écart dans les bilans.";
  status.className = good ? "budget-ok" : "budget-error";
  document.getElementById("budget-values").textContent = `Écarts : eau ${stats.waterResidual.toExponential(1)} ; solide ${stats.solidResidual.toExponential(1)}. ` +
    `Évaporé : ${stats.evaporated.toFixed(2)}. Sédiment sorti : ${stats.sedimentOut.toFixed(2)}. Incision max. : ${stats.incision.toFixed(3)}.`;
  return stats;
}
document.getElementById("saveSession").onclick = () => {
  const blob = new Blob([JSON.stringify(exportSimulation())], { type: "application/json" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `erosion-${terrainSeed}-${steps}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); notify("Sauvegarde exportée.");
};
document.getElementById("loadSession").onclick = () => document.getElementById("sessionFile").click();
document.getElementById("sessionFile").onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 35 * 1024 * 1024) throw new Error("Sauvegarde trop volumineuse (35 Mo maximum).");
    const parsed = JSON.parse(await file.text()); restoreSimulation(parsed);
    paused = true; setIcon(pauseIcon, "play"); pauseBtn.setAttribute("aria-label", "Reprendre la simulation"); pauseBtn.classList.add("active"); pauseBtn.setAttribute("aria-pressed", "true");
    resetClock(); syncTerrainControls(); refreshSourceList(); updateMetrics();
    notify("Sauvegarde restaurée en pause. Reprenez quand vous le souhaitez.");
  } catch (error) { notify(error.message, true); }
  finally { event.target.value = ""; }
};
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    contextMenu.style.display = "none";
    if (mobilePanelQuery.matches && sidePanel.classList.contains("open")) setPanelOpen(false, true);
    return;
  }
  if (event.target.closest("input, select, textarea, button, summary, a") || event.target.isContentEditable) return;
  if (event.code === "Space") { event.preventDefault(); pauseBtn.click(); }
});
