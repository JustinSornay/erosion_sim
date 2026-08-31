let b, bInit, d, s, fL, fR, fT, fB, u, v, tmpS, tmpD;
let flowTo, accum, accumSmooth, sortIdx, drainReady;
let activeCell, activeVel, maxActiveQ;
let sources = [];
let steps = 0,
  simTime = 0;
// ---------- particules de flux ----------
const NP = 260;
let px, py, pAlive;
