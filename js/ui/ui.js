const { createIcon, setIcon, initializeIcons } = UIIcons;
initializeIcons();
const speedEl = document.getElementById('speed'), speedLbl = document.getElementById('speedLbl');
const pauseBtn = document.getElementById('pause'), pauseIcon = document.getElementById('pauseIcon');
const sourcesDiv = document.getElementById('sources'), modeLbl = document.getElementById('modeLbl');
const layersBox = document.getElementById('layersBox'), sidePanel = document.getElementById('side-panel');
const panelTab = document.getElementById('panel-tab'), closePanelBtn = document.getElementById('close-panel');
let paused = false;

function updatePlaybackUI() {
  pauseBtn.classList.toggle('active', paused);
  setIcon(pauseIcon, paused ? 'play' : 'pause');
  pauseBtn.setAttribute('aria-label', paused ? 'Reprendre la simulation' : 'Mettre en pause');
  pauseBtn.setAttribute('aria-pressed', String(paused));
  document.getElementById('playState').textContent = paused ? 'En pause' : 'En cours';
}
function setSpeedIndex(index) {
  speedEl.value = String(Math.max(0, Math.min(SPEED_STEPS.length - 1, index)));
  const speed = SPEED_STEPS[Number(speedEl.value)];
  speedLbl.textContent = '\u00d7' + speed;
  speedEl.title = `Vitesse \u00d7${speed}. Cliquer : \u00d7${SPEED_STEPS[(Number(speedEl.value) + 1) % SPEED_STEPS.length]}`;
  speedEl.setAttribute('aria-label', speedEl.title);
}
setSpeedIndex(0);
speedEl.onclick = () => { setSpeedIndex((Number(speedEl.value) + 1) % SPEED_STEPS.length); resetClock(); };
pauseBtn.onclick = () => { paused = !paused; updatePlaybackUI(); resetClock(); };

// Three optional overlays instead of two groups and six permanent switches.
for (const def of [
  {id: 'contours', label: 'Courbes du relief', color: '#bfa88c'},
  {id: 'reseau', label: 'Courants', color: '#5db8d8'},
  {id: 'particules', label: 'Traceurs', color: '#d2eeff'},
]) {
  const row = document.createElement('button'); row.type = 'button'; row.className = 'layer-item';
  row.dataset.id = def.id; row.style.setProperty('--c', def.color);
  const swatch = document.createElement('span'); swatch.className = 'swatch';
  const label = document.createElement('span'); label.textContent = def.label;
  row.append(swatch, label); row.onclick = () => { layerOn[def.id] = !layerOn[def.id]; updateLayersUI(); };
  layersBox.appendChild(row);
}
function updateLayersUI() {
  for (const row of layersBox.querySelectorAll('.layer-item')) {
    row.classList.toggle('on', !!layerOn[row.dataset.id]);
    row.setAttribute('aria-pressed', String(!!layerOn[row.dataset.id]));
  }
}
function setMode(mode) {
  if (!['composite', 'change', 'contribution'].includes(mode)) return;
  viewMode = mode;
  document.querySelectorAll('.modes button').forEach(button => {
    button.classList.toggle('on', button.dataset.m === mode);
    button.setAttribute('aria-pressed', String(button.dataset.m === mode));
  });
  const analysis = document.getElementById('analysisToggle');
  analysis.setAttribute('aria-pressed', String(mode === 'contribution'));
  analysis.textContent = mode === 'contribution' ? 'Revenir au paysage' : 'R\u00e9seau potentiel du relief';
  modeLbl.textContent = mode === 'composite' ? 'Paysage' : mode === 'change' ? '\u00c9rosion & d\u00e9p\u00f4ts' : '\u00c9coulement potentiel';
  if (mode === 'contribution') { computeDrainage(); invalidateDrainagePaths(); }
  const hint = document.getElementById('stage-hint');
  hint.textContent = mode === 'change' ? 'Orange : \u00e9rosion. Vert : d\u00e9p\u00f4ts. Gris : terrain inchang\u00e9.'
    : 'Analyse des pentes, pas des courants r\u00e9els. Les cuvettes peuvent retenir l\u2019eau.';
  hint.hidden = mode === 'composite'; layersBox.hidden = mode !== 'composite'; updateLayersUI();
}
document.querySelectorAll('.modes button').forEach(button => { button.onclick = () => setMode(button.dataset.m); });
document.getElementById('analysisToggle').onclick = () => setMode(viewMode === 'contribution' ? 'composite' : 'contribution');

const mobilePanelQuery = matchMedia('(max-width: 767px)');
function syncPanelAccessibility() {
  const open = sidePanel.classList.contains('open'), hidden = mobilePanelQuery.matches && !open;
  sidePanel.inert = hidden; panelTab.classList.toggle('hidden', open);
  panelTab.setAttribute('aria-expanded', String(!hidden));
}
function setPanelOpen(open, focus = false) {
  sidePanel.classList.toggle('open', open); syncPanelAccessibility();
  if (focus && mobilePanelQuery.matches) (open ? closePanelBtn : panelTab).focus({preventScroll: true});
}
mobilePanelQuery.addEventListener('change', () => {
  syncPanelAccessibility();
  if (sidePanel.inert && sidePanel.contains(document.activeElement)) panelTab.focus({preventScroll: true});
});
syncPanelAccessibility();
panelTab.onclick = () => setPanelOpen(true, true); closePanelBtn.onclick = () => setPanelOpen(false, true);

function addSourceAt(gx, gy) {
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
  const existing = sources.find(src => Math.hypot(src.x - gx, src.y - gy) < 6);
  if (existing) { existing.active = !existing.active; refreshSourceList(); return; }
  if (sources.length >= 128) { notify('Limite de 128 sources atteinte.'); return; }
  const x = Math.max(0, Math.min(N - 1, Math.floor(gx))), y = Math.max(0, Math.min(N - 1, Math.floor(gy)));
  if (d[idx(x, y)] > .005) { notify('Choisissez une terre \u00e9merg\u00e9e pour ajouter une source.'); return; }
  const src = {x, y, rate: getSceneProfile().manualSourceRate, active: true};
  configureSourceOutlets(src); sources.push(src); refreshSourceProtectionMask(); refreshSourceList();
}
canvas.addEventListener('click', event => {
  const rect = canvas.getBoundingClientRect();
  addSourceAt((event.clientX - rect.left) / rect.width * N, (event.clientY - rect.top) / rect.height * N);
});
const contextMenu = document.getElementById('context-menu'), ctxAddBtn = document.getElementById('ctx-add-source');
const ctxToggleBtn = document.getElementById('ctx-toggle-source'), ctxDeleteBtn = document.getElementById('ctx-delete-source');
let contextMenuTarget = {x: 0, y: 0, index: -1};
canvas.addEventListener('contextmenu', event => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * N, y = (event.clientY - rect.top) / rect.height * N;
  const index = sources.findIndex(src => Math.hypot(src.x - x, src.y - y) < 6);
  contextMenuTarget = {x, y, index};
  ctxAddBtn.style.display = index < 0 ? 'flex' : 'none';
  ctxToggleBtn.style.display = ctxDeleteBtn.style.display = index >= 0 ? 'flex' : 'none';
  if (index >= 0) {
    const active = sources[index].active;
    setIcon(ctxToggleBtn.querySelector('.icon'), active ? 'toggle-right' : 'toggle-left');
    ctxToggleBtn.querySelector('.context-menu-label').textContent = active ? 'D\u00e9sactiver la source' : 'Activer la source';
    ctxToggleBtn.dataset.state = active ? 'active' : 'inactive';
  }
  contextMenu.style.display = 'block';
  const stage = document.getElementById('stage').getBoundingClientRect();
  contextMenu.style.left = Math.max(8, Math.min(event.clientX - stage.left, stage.width - contextMenu.offsetWidth - 8)) + 'px';
  contextMenu.style.top = Math.max(8, Math.min(event.clientY - stage.top, stage.height - contextMenu.offsetHeight - 8)) + 'px';
});
document.addEventListener('click', event => { if (!contextMenu.contains(event.target)) contextMenu.style.display = 'none'; });
ctxAddBtn.onclick = () => { addSourceAt(contextMenuTarget.x, contextMenuTarget.y); contextMenu.style.display = 'none'; };
ctxToggleBtn.onclick = () => {
  const src = sources[contextMenuTarget.index]; if (src) { src.active = !src.active; refreshSourceList(); }
  contextMenu.style.display = 'none';
};
ctxDeleteBtn.onclick = () => {
  if (contextMenuTarget.index >= 0 && contextMenuTarget.index < sources.length) {
    sources.splice(contextMenuTarget.index, 1); refreshSourceProtectionMask(); refreshSourceList();
  }
  contextMenu.style.display = 'none';
};
document.getElementById('clearSrc').onclick = () => { sources.length = 0; refreshSourceProtectionMask(); refreshSourceList(); };
function refreshSourceList() {
  sourcesDiv.replaceChildren();
  document.getElementById('srcCount').textContent = `${sources.filter(src => src.active).length} / ${sources.length}`;
  document.getElementById('clearSrc').hidden = sources.length === 0;
  if (!sources.length) {
    const empty = document.createElement('p'); empty.className = 'empty-sources';
    empty.textContent = 'Aucune source sur cette carte.'; sourcesDiv.appendChild(empty); return;
  }
  sources.forEach((source, i) => {
    const row = document.createElement('div'); row.className = 'src-row';
    const toggle = document.createElement('button'); toggle.type = 'button';
    toggle.className = source.active ? 'source-toggle' : 'source-toggle off';
    toggle.appendChild(createIcon('droplet')); toggle.append(`Source ${i + 1}`);
    toggle.title = `Source ${i + 1} : ${source.active ? 'd\u00e9sactiver' : 'activer'}`;
    toggle.setAttribute('aria-label', toggle.title); toggle.setAttribute('aria-pressed', String(source.active));
    toggle.onclick = () => { source.active = !source.active; refreshSourceList(); };
    const flow = document.createElement('span'); flow.className = 'source-flow';
    flow.textContent = source.rate < 1 ? 'Faible' : source.rate < 2 ? 'Mod\u00e9r\u00e9' : 'Soutenu';
    flow.title = `D\u00e9bit pr\u00e9r\u00e9gl\u00e9 : ${source.rate.toLocaleString('fr-FR')} unit\u00e9s de volume/s (non calibr\u00e9es)`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'source-remove';
    remove.appendChild(createIcon('x')); remove.setAttribute('aria-label', `Supprimer la source ${i + 1}`);
    remove.onclick = () => { sources.splice(i, 1); refreshSourceProtectionMask(); refreshSourceList(); };
    row.append(toggle, flow, remove); sourcesDiv.appendChild(row);
  });
}

let toastTimer;
function notify(message, error = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message; toast.classList.toggle('error', error); toast.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 5000);
}
function resetClock() { stepAccumulator = 0; lastT = performance.now(); achievedStepsPerSecSmoothed = 0; }
let terrainStorage = null;
try { terrainStorage = window.localStorage; } catch (_) { /* Local file / private browsing fallback. */ }
const terrainHistory = createTerrainHistory({storage: terrainStorage});
const terrainBrowser = document.getElementById('terrain-browser');
function syncRainControls() {
  const profile = getSceneProfile(), appearance = rainAppearance(profile.rainRate), active = simulationOptions.rainfall > 0;
  const button = document.getElementById('rainToggle');
  document.getElementById('rainLabel').textContent = appearance.label;
  document.getElementById('rainState').textContent = active ? 'Active' : 'Arr\u00eat';
  setIcon(document.getElementById('rainIcon'), appearance.icon);
  button.dataset.intensity = appearance.intensity; button.classList.toggle('on', active);
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', `${active ? 'D\u00e9sactiver' : 'Activer'} : ${appearance.label.toLowerCase()}. Intensit\u00e9 fix\u00e9e par la carte.`);
}
document.getElementById('rainToggle').onclick = () => { setSceneRain(simulationOptions.rainfall === 0); syncRainControls(); };
function syncTerrainControls() {
  const info = terrainInfo(terrainPreset), entry = terrainHistory.current(), profile = getSceneProfile();
  document.getElementById('terrainName').textContent = info.name;
  document.getElementById('terrainPosition').textContent = entry ? `Carte ${entry.number} \u00b7 ${terrainViewLabel(terrainSeed, terrainPreset)}` : 'Sauvegarde';
  document.getElementById('terrainCaption').textContent = info.description;
  document.getElementById('previousTerrain').disabled = !terrainHistory.canPrevious();
  const kind = {sea: 'Mer ouverte', lake: 'Lac', pond: 'Bassin en eau', none: 'Terre ferme'}[profile.waterKind];
  const water = document.getElementById('waterSummary');
  water.textContent = profile.initialWetCells ? `${kind} \u00b7 ${Math.round(profile.initialWetCells / NN * 100)} % d\u2019eau` : kind;
  water.title = 'Eau pr\u00e9sente au d\u00e9part de cette carte';
  setIcon(document.getElementById('waterIcon'), profile.initialWetCells ? 'waves' : 'mountain');
  document.getElementById('scene-note').textContent = seaLevel !== null
    ? 'Mer : niveau maintenu aux limites. Les entr\u00e9es et sorties d\u2019eau sont compt\u00e9es dans les bilans.'
    : 'L\u2019eau des lacs est une r\u00e9serve initiale : pluie, sources, \u00e9vaporation et d\u00e9bordement la font \u00e9voluer.';
  syncRainControls();
}
function refreshSceneUI() {
  contextMenu.style.display = 'none'; contextMenuTarget.index = -1;
  resetClock(); syncTerrainControls(); refreshSourceList(); updateMetrics(); updatePlaybackUI();
  document.getElementById('tcount').textContent = steps; document.getElementById('tsim').textContent = simTime.toFixed(1);
}
function navigateTerrain(direction) {
  const previousHadFocus = document.activeElement === document.getElementById('previousTerrain');
  const recipe = direction < 0 ? terrainHistory.previous() : terrainHistory.next(); if (!recipe) return;
  generateScene(recipe); refreshSceneUI();
  if (previousHadFocus && !terrainHistory.canPrevious()) terrainBrowser.focus({preventScroll: true});
}
document.getElementById('previousTerrain').onclick = () => navigateTerrain(-1);
document.getElementById('nextTerrain').onclick = document.getElementById('regen').onclick = () => navigateTerrain(1);
document.getElementById('restartScene').onclick = () => {
  generateScene({seed: terrainSeed, preset: terrainPreset}); refreshSceneUI();
  notify('Carte r\u00e9initialis\u00e9e : eau, pluie et sources de d\u00e9part.');
};
let terrainWheelArmed = false, terrainWheelAmount = 0, terrainWheelTime = -Infinity, terrainWheelLastEvent = -Infinity;
terrainBrowser.addEventListener('focusin', () => { terrainWheelArmed = true; });
terrainBrowser.addEventListener('click', event => {
  terrainWheelArmed = true; if (!event.target.closest('button')) terrainBrowser.focus({preventScroll: true});
});
terrainBrowser.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault(); terrainWheelArmed = true;
  if (!event.repeat) navigateTerrain(event.key === 'ArrowLeft' ? -1 : 1);
});
function resetTerrainWheel() { terrainWheelAmount = 0; terrainWheelLastEvent = -Infinity; terrainWheelArmed = false; }
terrainBrowser.addEventListener('pointerleave', resetTerrainWheel); terrainBrowser.addEventListener('focusout', resetTerrainWheel);
terrainBrowser.addEventListener('wheel', event => {
  if (!terrainWheelArmed || !terrainBrowser.contains(document.activeElement) || event.ctrlKey || event.metaKey || !event.cancelable) return;
  const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY; if (!raw) return;
  event.preventDefault(); const now = performance.now();
  const delta = raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
  if (now - terrainWheelLastEvent > 180 || Math.sign(delta) !== Math.sign(terrainWheelAmount)) terrainWheelAmount = 0;
  terrainWheelLastEvent = now; if (now - terrainWheelTime < 360) return;
  terrainWheelAmount += delta; if (Math.abs(terrainWheelAmount) < 45) return;
  const direction = Math.sign(terrainWheelAmount); terrainWheelAmount = 0; terrainWheelTime = now; navigateTerrain(direction);
}, {passive: false});

function updateMetrics() {
  const stats = getSimulationStats();
  for (const [id, key] of [['statWater', 'water'], ['statIn', 'waterIn'], ['statOut', 'waterOut'], ['statEroded', 'eroded'], ['statDeposited', 'deposited']])
    document.getElementById(id).textContent = stats[key].toLocaleString('fr-FR', {maximumFractionDigits: 2});
  const good = stats.finite && Math.abs(stats.waterResidual) < 1e-6 && Math.abs(stats.solidResidual) < 1e-6;
  const status = document.getElementById('budget-status');
  status.textContent = good ? 'Eau et mati\u00e8re : bilans conserv\u00e9s.' : 'Attention : \u00e9cart dans les bilans.';
  status.className = good ? 'budget-ok' : 'budget-error';
  document.getElementById('budget-values').textContent = `\u00c9carts : eau ${stats.waterResidual.toExponential(1)} ; solide ${stats.solidResidual.toExponential(1)}. ` +
    `\u00c9vapor\u00e9 : ${stats.evaporated.toFixed(2)}. S\u00e9diment sorti : ${stats.sedimentOut.toFixed(2)}.`;
  return stats;
}
document.getElementById('saveSession').onclick = () => {
  const blob = new Blob([JSON.stringify(exportSimulation())], {type: 'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `erosion-${terrainSeed}-${steps}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Sauvegarde export\u00e9e.');
};
document.getElementById('loadSession').onclick = () => document.getElementById('sessionFile').click();
document.getElementById('sessionFile').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 35 * 1024 * 1024) throw new Error('Sauvegarde trop volumineuse (35 Mo maximum).');
    restoreSimulation(JSON.parse(await file.text()));
    terrainHistory.remember({seed: terrainSeed, preset: terrainPreset}); paused = true; refreshSceneUI();
    notify('Sauvegarde restaur\u00e9e en pause.');
  } catch (error) { notify(error.message, true); }
  finally { event.target.value = ''; }
};
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    contextMenu.style.display = 'none'; if (mobilePanelQuery.matches && sidePanel.classList.contains('open')) setPanelOpen(false, true); return;
  }
  if (event.target.closest('input, select, textarea, button, summary, a') || event.target.isContentEditable) return;
  if (event.code === 'Space') { event.preventDefault(); pauseBtn.click(); }
});
