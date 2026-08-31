// ---------- grille & constantes physiques ----------
const N = 192,
  NN = N * N,
  L = 1,
  G = 9.81,
  A = 1.2,
  DT = 0.017;
const KC = 0.055,
  KS = 0.045,
  KD = 0.045,
  KE = 0.012;
const EROSION_VIS_SCALE = 0.06;

// Constantes fixes remplaçant les sliders (valeurs par défaut actuelles)
const DEFAULT_RATE = 2.2;
const DEFAULT_ISO_STEP = 0.09;

// ---------- réseau hydrographique POTENTIEL : accumulation de bassin versant D8 ----------
const DRAIN_SMOOTH = 0.85;
const STREAM_FRAC = 0.34;
const RIVER_FRAC = 0.6;
const NDX = [-1, 0, 1, -1, 1, -1, 0, 1],
  NDY = [-1, -1, -1, 0, 0, 1, 1, 1];
const NDIST = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

// ---------- réseau hydrographique ACTIF : eau réellement présente et réellement en mouvement ----------
const D_SPAWN = 0.006,
  D_DEATH = 0.0035;
const V_SPAWN = 0.15,
  V_DEATH = 0.07;
const Q_SPAWN = 0.003,
  Q_DEATH = 0.0014;
const SPEED_STEPS = [1, 2, 5, 10, 20, 50, 100, 250, 500];

// Visual systems update independently from the physical timestep.
const DRAINAGE_UPDATE_MS = 150;
const ACTIVE_NETWORK_UPDATE_MS = 34;
const HUD_UPDATE_MS = 125;
