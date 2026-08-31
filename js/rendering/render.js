const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
function resizeCanvas() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  let size;
  if (w < 768) {
    size = Math.min(w, h) * 0.98;
  } else {
    size = Math.min(w - 330, h - 20);
  }

  canvas.style.width = size + "px";
  canvas.style.height = size + "px";
}
window.addEventListener("resize", resizeCanvas);
const DISPLAY = 1024;
canvas.width = DISPLAY;
canvas.height = DISPLAY;
resizeCanvas();

const off = document.createElement("canvas");
off.width = N;
off.height = N;
const octx = off.getContext("2d");
const img = octx.createImageData(N, N);

// ---------- vues & calques ----------
let viewMode = "composite";
const LAYER_DEFS_TERRAIN = [
  { id: "relief", label: "Sable / Roche", color: "#8c7b65" },
  { id: "contours", label: "Courbes Topo", color: "#bfa88c" },
  { id: "erosion", label: "Sédiments & Usure", color: "#d2a15c" },
];
const LAYER_DEFS_WATER = [
  { id: "eau", label: "Masse d'eau", color: "#3f8cb0" },
  { id: "reseau", label: "Courants Actifs", color: "#5db8d8" },
  { id: "particules", label: "Traceurs d'écoulement", color: "#d2eeff" },
];
const layerOn = {
  relief: true,
  contours: true,
  eau: true,
  reseau: true,
  erosion: true,
  particules: true,
};

function render(isoStepMajor) {
  const data = img.data;
  let bmin = 1e9,
    bmax = -1e9;
  for (let i = 0; i < NN; i++) {
    const h = b[i];
    if (h < bmin) bmin = h;
    if (h > bmax) bmax = h;
  }
  const range = Math.max(1e-4, bmax - bmin);
  const isoMinor = isoStepMajor / 5;
  const isContribution = viewMode === "contribution";

  const showRelief = !isContribution && layerOn.relief;
  const showContours = !isContribution && layerOn.contours;
  const showErosion = !isContribution && layerOn.erosion;
  const showWater = !isContribution && layerOn.eau;
  const showActive = !isContribution && layerOn.reseau;
  const showParticles = !isContribution && layerOn.particules;

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      const h = b[i];
      const t = (h - bmin) / range;
      let r, g2, bl;

      if (isContribution) {
        const v = Math.pow(accumSmooth[i], 0.6);
        const g = Math.round(lerp(20, 200, v));
        r = Math.round(g * 0.4);
        g2 = Math.round(g * 0.6);
        bl = g;
        const o = i * 4;
        data[o] = r;
        data[o + 1] = g2;
        data[o + 2] = bl;
        data[o + 3] = 255;
        continue;
      }

      if (showRelief) {
        r = Math.round(lerp(70, 140, t));
        g2 = Math.round(lerp(60, 120, t));
        bl = Math.round(lerp(50, 100, t));
      } else {
        r = 30;
        g2 = 29;
        bl = 27;
      }

      if (showContours && d[i] < 0.02) {
        const majorHere = Math.floor(h / isoStepMajor);
        const minorHere = Math.floor(h / isoMinor);
        let majorLine = false,
          minorLine = false;
        if (x < N - 1) {
          if (Math.floor(b[i + 1] / isoStepMajor) !== majorHere)
            majorLine = true;
          else if (Math.floor(b[i + 1] / isoMinor) !== minorHere)
            minorLine = true;
        }
        if (y < N - 1) {
          if (Math.floor(b[i + N] / isoStepMajor) !== majorHere)
            majorLine = true;
          else if (Math.floor(b[i + N] / isoMinor) !== minorHere)
            minorLine = true;
        }
        if (majorLine) {
          r = Math.round(lerp(r, 190, 0.3));
          g2 = Math.round(lerp(g2, 170, 0.3));
          bl = Math.round(lerp(bl, 150, 0.3));
        } else if (minorLine) {
          r = Math.round(lerp(r, 160, 0.1));
          g2 = Math.round(lerp(g2, 140, 0.1));
          bl = Math.round(lerp(bl, 120, 0.1));
        }
      }

      if (showErosion) {
        const diff = (b[i] - bInit[i]) / EROSION_VIS_SCALE;
        if (diff < -0.02) {
          const w = Math.min(1, -diff);
          r = Math.round(lerp(r, 170, w * 0.6));
          g2 = Math.round(lerp(g2, 150, w * 0.6));
          bl = Math.round(lerp(bl, 120, w * 0.6));
        } else if (diff > 0.02) {
          const w = Math.min(1, diff);
          r = Math.round(lerp(r, 40, w * 0.5));
          g2 = Math.round(lerp(g2, 35, w * 0.5));
          bl = Math.round(lerp(bl, 30, w * 0.5));
        }
      }

      const depth = d[i];
      if (showWater || showActive) {
        const depthT = smoothstep(0, 0.07, depth);
        if (showWater && depthT > 0.002) {
          r = Math.round(lerp(r, 50, depthT * 0.8));
          g2 = Math.round(lerp(g2, 110 + 20 * depthT, depthT * 0.8));
          bl = Math.round(lerp(bl, 140 + 40 * depthT, depthT * 0.8));
        }
        if (showActive && activeCell[i]) {
          const q = depth * activeVel[i];
          const qn = Math.min(1, q / maxActiveQ);
          const riverT = qn * 0.6 * Math.min(1, depthT * 3 + 0.15);
          if (riverT > 0.02) {
            r = Math.min(255, Math.round(lerp(r, 100, riverT)));
            g2 = Math.min(255, Math.round(lerp(g2, 180, riverT)));
            bl = Math.min(255, Math.round(lerp(bl, 210, riverT)));
          }
        }
      }

      const o = i * 4;
      data[o] = r;
      data[o + 1] = g2;
      data[o + 2] = bl;
      data[o + 3] = 255;
    }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, DISPLAY, DISPLAY);
  ctx.drawImage(off, 0, 0, DISPLAY, DISPLAY);

  if (isContribution) {
    const streamPath = new Path2D(),
      riverPath = new Path2D();
    for (let i = 0; i < NN; i++) {
      const j = flowTo[i];
      if (j < 0) continue;
      const val = accumSmooth[i];
      if (val < STREAM_FRAC) continue;
      const x0 = i % N,
        y0 = (i / N) | 0,
        x1 = j % N,
        y1 = (j / N) | 0;
      const sx = ((x0 + 0.5) / N) * DISPLAY,
        sy = ((y0 + 0.5) / N) * DISPLAY;
      const ex = ((x1 + 0.5) / N) * DISPLAY,
        ey = ((y1 + 0.5) / N) * DISPLAY;
      const path = val >= RIVER_FRAC ? riverPath : streamPath;
      path.moveTo(sx, sy);
      path.lineTo(ex, ey);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(100,150,180,.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke(streamPath);
    ctx.strokeStyle = "rgba(120,180,220,.7)";
    ctx.lineWidth = 3.5;
    ctx.stroke(riverPath);
  }

  if (showActive) {
    const streamPath = new Path2D(),
      riverPath = new Path2D();
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = idx(x, y);
        if (!activeCell[i]) continue;
        const j = activeDownstream(x, y, i);
        if (j < 0) continue;
        const q = d[i] * activeVel[i];
        const qn = q / maxActiveQ;
        const x1 = j % N,
          y1 = (j / N) | 0;
        const sx = ((x + 0.5) / N) * DISPLAY,
          sy = ((y + 0.5) / N) * DISPLAY;
        const ex = ((x1 + 0.5) / N) * DISPLAY,
          ey = ((y1 + 0.5) / N) * DISPLAY;
        const path = qn >= 0.45 ? riverPath : streamPath;
        path.moveTo(sx, sy);
        path.lineTo(ex, ey);
      }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(90,160,200,.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke(streamPath);
    ctx.strokeStyle = "rgba(120,200,240,.9)";
    ctx.lineWidth = 3.5;
    ctx.stroke(riverPath);
  }

  if (showParticles) {
    ctx.strokeStyle = "rgba(200,230,250,.45)";
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.fillStyle = "rgba(200,230,250,.8)";
    for (let i = 0; i < NP; i++) {
      if (!pAlive[i]) continue;
      const depth = bilerp(d, px[i], py[i]);
      const uu = bilerp(u, px[i], py[i]),
        vv = bilerp(v, px[i], py[i]);
      const vel = Math.hypot(uu, vv);
      const q = depth * vel;
      if (depth < D_DEATH || vel < V_DEATH || q < Q_DEATH) continue;
      const sx = ((px[i] + 0.5) / N) * DISPLAY,
        sy = ((py[i] + 0.5) / N) * DISPLAY;

      // Trail length represents local physical speed, independent from traceur cadence.
      const trailLength = Math.min(11, 2 + vel * 4);
      const trailX = sx - (uu / vel) * trailLength;
      const trailY = sy - (vv / vel) * trailLength;
      ctx.beginPath();
      ctx.moveTo(trailX, trailY);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(sx, sy, 1.6, 0, 7);
      ctx.fill();
    }
  }

  // Source markers - "physical damp spots" style
  for (let k = 0; k < sources.length; k++) {
    const src = sources[k];
    const px2 = ((src.x + 0.5) / N) * DISPLAY,
      py2 = ((src.y + 0.5) / N) * DISPLAY;
    ctx.globalAlpha = src.active ? 0.8 : 0.2;

    ctx.fillStyle = "rgba(60, 130, 170, 0.4)";
    ctx.beginPath();
    ctx.arc(px2, py2, 12, 0, 7);
    ctx.fill();

    ctx.fillStyle = "rgba(30, 80, 110, 0.9)";
    ctx.beginPath();
    ctx.arc(px2, py2, 4, 0, 7);
    ctx.fill();

    ctx.globalAlpha = 1;
  }
}
