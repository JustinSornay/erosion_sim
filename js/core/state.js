// All conserved fields use Float64 storage: subnormal Float32 donor errors in
// the historical research must not manufacture negative sediment.
let b, bInit, bedrock, d, s, fL, fR, fT, fB, u, v, tmpS, tmpD, bedDelta;
let flowTo, accum, accumSmooth, sortIdx, drainReady;
let activeCell, activeVel, maxActiveQ, activeCellsList, activeCellsCount;
let sourceProtectionMask;
let sources = [];
let steps = 0, simTime = 0, terrainSeed = 314159265, terrainPreset = "valley";
const NP = 260;
let px, py, pAlive;
const DEFAULT_SIMULATION_OPTIONS = Object.freeze({
  boundary: "open", rainfall: 0, evaporation: 0.002,
  erosion: true, capacity: 0.22, erosionRate: 2.7, depositionRate: 2.7,
});
const simulationOptions = { ...DEFAULT_SIMULATION_OPTIONS };
let budget = {};
