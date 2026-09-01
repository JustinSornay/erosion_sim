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
    const row = document.createElement("div");
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
  });
}

function setMode(m) {
  viewMode = m;
  document
    .querySelectorAll(".modes button[data-m]")
    .forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  modeLbl.textContent = m === "composite" ? "Simulation" : "Analyse";
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
};

pauseBtn.onclick = () => {
  paused = !paused;
  pauseBtn.classList.toggle("active", paused);
  pauseIcon.textContent = paused ? "play_arrow" : "pause";
};
document.getElementById("regen").onclick = () => {
  const btn = document.getElementById("regen");
  btn.style.transform = "scale(0.9)";
  setTimeout(() => (btn.style.transform = "scale(1)"), 100);
  genTerrain();
  refreshSourceList();
};
document.getElementById("clearSrc").onclick = () => {
  sources.length = 0;
  refreshSourceProtectionMask();
  refreshSourceList();
};

// Gestion de la languette mobile et du bouton fermer
function togglePanel() {
  sidePanel.classList.toggle("open");
  panelTab.classList.toggle("hidden", sidePanel.classList.contains("open"));
}

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
  const cx = Math.max(1, Math.min(N - 2, Math.round(gx)));
  const cy = Math.max(1, Math.min(N - 2, Math.round(gy)));
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
const ctxToggleIcon = ctxToggleBtn.querySelector(".material-symbols-outlined");
const ctxToggleLabel = ctxToggleBtn.querySelector(".context-menu-label");
let contextMenuTarget = { x: 0, y: 0, index: -1 };

/** Aligns source-state feedback with the action exposed by the context menu. */
function updateSourceContextMenu(source) {
  const isActive = source.active;
  ctxToggleIcon.textContent = isActive ? "toggle_on" : "toggle_off";
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
  contextMenu.style.left = e.clientX + "px";
  contextMenu.style.top = e.clientY + "px";
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
  sourcesDiv.innerHTML = "";
  document.getElementById("srcCount").textContent = sources.length;
  if (sources.length === 0) {
    sourcesDiv.innerHTML =
      '<div style="opacity:.5;font-size:11px;padding:4px">Aucune source. Clic sur le terrain.</div>';
    return;
  }
  sources.forEach((s2, i) => {
    const row = document.createElement("div");
    row.className = "src-row";
    // Le style .off est appliqué ici pour les sources désactivées (barré et grisé)
    row.innerHTML = `<span class="${s2.active ? "" : "off"}">Source ${i + 1} [${s2.rate.toFixed(1)} L/s]</span><a data-i="${i}"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">close</span></a>`;
    row.querySelector("a").onclick = () => {
      sources.splice(i, 1);
      refreshSourceProtectionMask();
      refreshSourceList();
    };
    sourcesDiv.appendChild(row);
  });
}
