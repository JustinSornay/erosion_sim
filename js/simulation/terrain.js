// The browser only proposes these landscapes. Legacy recipes below remain
// available to saved sessions and deterministic physics regression fixtures.
const TERRAIN_CATALOG = Object.freeze({
  headwaters: { name: "Vallons", description: "Des petits vallons se rejoignent vers une vallée ouverte." },
  meanders: { name: "Vallée sinueuse", description: "Un fond de vallée large entre des versants irréguliers." },
  hillside: { name: "Versants", description: "Des pentes et des collines pour observer le ruissellement." },
  confluence: { name: "Confluence", description: "Deux vallées se rencontrent dans une pente commune." },
  spillway: { name: "Bassin ouvert", description: "Une dépression avec un seuil et une sortie en aval." },
  massif: { name: "Massif montagneux", description: "Une chaîne de sommets et de crêtes, entrecoupée de cols et de vallées." },
  tableland: { name: "Plateaux entaillés", description: "Des hauts plateaux et des terrasses séparés par des gorges." },
  lowlands: { name: "Plaine fluviale", description: "Un grand paysage de plaines et de bras de rivière." },
  canyon: { name: "Canyons", description: "Un plateau entaillé par une gorge étroite et ses ramifications." },
  badlands: { name: "Badlands", description: "Des ravines serrées et des crêtes friables dessinent un drainage très ramifié." },
  glacial: { name: "Vallée glaciaire", description: "Une grande vallée en U, au fond large, coincée entre des versants abrupts." },
  karst: { name: "Relief karstique", description: "Des collines calcaires ponctuées de dolines et de dépressions fermées." },
  caldera: { name: "Caldeira", description: "Un grand cratère annulaire, parfois ouvert par une brèche d'écoulement." },
  fan: { name: "Cône de déjection", description: "Une gorge débouche sur un vaste éventail de dépôts et de chenaux." },
  mesas: { name: "Mesas et buttes", description: "Des plateaux isolés émergent d'une plaine plus basse et découpée." },
  cuesta: { name: "Cuestas", description: "De longs escarpements asymétriques structurent le paysage en bandes inclinées." },
  braided: { name: "Chenaux multiples", description: "Une grande plaine est parcourue par plusieurs bras qui se divisent et se rejoignent." },
  // The original procedural topography is a first-class discovery choice again.
  // Its sampler below MUST stay on the untouched historical fbm path.
  natural: { name: "Terrain naturel", description: "Le relief aléatoire et irrégulier des toutes premières générations." },
});
const LEGACY_CLOSEUP_PRESETS = new Set(['headwaters', 'meanders', 'hillside', 'confluence', 'spillway']);
const REGIONAL_ONLY_PRESETS = new Set(['massif', 'tableland', 'lowlands', 'mesas', 'braided']);
const LEGACY_TERRAINS = Object.freeze({
  valley: { name: "Vallée historique", description: "Relief historique d'une sauvegarde." },
  basin: { name: "Cuvette historique", description: "Relief historique d'une sauvegarde." },
  ridge: { name: "Crête historique", description: "Relief historique d'une sauvegarde." },
});
function isTerrainPreset(preset) {
  return Object.hasOwn(TERRAIN_CATALOG, preset) || Object.hasOwn(LEGACY_TERRAINS, preset);
}
function terrainInfo(preset) { return TERRAIN_CATALOG[preset] || LEGACY_TERRAINS[preset]; }

// Independent, integer-based seeded parameters: rotations, valley widths and
// branching vary as well as the noise, without changing the historical RNG.
function terrainRandom(value) {
  let state = value >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function terrainSmooth(a, z, value) {
  const t = Math.max(0, Math.min(1, (value - a) / (z - a)));
  return t * t * (3 - 2 * t);
}
// Seed-determined framing is deliberately independent of browser storage.
// The browser's odd seed stride explores three levels of detail in succession,
// without ever adding a zoom setting, a physical parameter or a save field.
const TERRAIN_VIEW_LABELS = Object.freeze(["Vue rapprochée", "Vue paysage", "Vue d’ensemble"]);
function terrainViewIndex(value) { return (value >>> 0) % TERRAIN_VIEW_LABELS.length; }
function terrainViewLabel(value, preset) {
  // The restored original generator has no notion of an enlarged camera scale.
  return preset === "natural" ? "Génération classique" : TERRAIN_VIEW_LABELS[terrainViewIndex(value)];
}

function smoothStep(a, z, value) { return terrainSmooth(a, z, value); }
function gaussian(value, width) { return Math.exp(-((value / width) ** 2)); }
function radialGaussian(dx, dy, rx, ry) { return Math.exp(-((dx / rx) ** 2 + (dy / ry) ** 2)); }

// Map-scale compositions: instead of simply enlarging one valley/peak, these
// use several tributaries, hills, plateaux or basins inside a wider territory.
// Parameters are generated ONCE per seed; no unseeded random in the sampler.
function regionalLandscapeSampler(preset, value, view) {
  const random = terrainRandom(value ^ 0x6b85bf23);
  const extent = [1.0, 1.85, 3.2][view];
  const angle = Math.floor(random() * 4) * Math.PI / 2 + (random() - .5) * .34;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const driftX = (random() - .5) * .28, driftY = (random() - .5) * .24;
  const ox = 30 + random() * 170, oy = 30 + random() * 170;
  const phase = random() * Math.PI * 2, frequency = 3.8 + 2.2 * random();
  const bend = .06 + random() * .07;
  const slope = .42 + random() * .24;
  const shoulders = .45 + random() * .18;
  const channelWidth = (.105 + random() * .045) * [1.1, 1.35, 1.9][view];
  const streams = [];
  if (preset === 'headwaters' || preset === 'confluence' || preset === 'lowlands' || preset === 'braided') {
    const count = preset === 'confluence' ? (view === 2 ? 3 : 2)
      : preset === 'lowlands' ? (view === 2 ? 4 : 2)
      : preset === 'braided' ? (view === 2 ? 7 : view === 1 ? 5 : 4)
      : (view === 2 ? 6 : 4);
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const spread = (preset === 'confluence' ? .62 : preset === 'braided' ? .22 : .34)
        + .24 * Math.floor(i / 2) + .17 * random();
      const join = preset === 'lowlands' ? -.2 - .25 * random()
        : preset === 'braided' ? -.15 + .18 * random()
        : -.15 + .65 * random();
      streams.push({ side, spread, join, phase: phase + random() * 4, width: .055 + .045 * random() });
    }
  }
  const hills = [];
  const count = preset === 'massif' ? 12 : preset === 'hillside' ? 9 : preset === 'tableland' ? 0 : preset === 'spillway' ? 4 : preset === 'karst' ? 11 : 0;
  for (let i = 0; i < count; i++) {
    const y = (random() - .5) * 3.2;
    const spread = i % 3 === 0 ? 1.5 : 3.2;
    const x = preset === 'massif' ? .3 * y + (random() - .5) * spread : (random() - .5) * spread;
    hills.push({ x, y, rx: .24 + random() * .20, ry: .27 + random() * .24,
      amp: (preset === 'massif' ? .58 : preset === 'tableland' ? .39 : preset === 'spillway' ? .27 : preset === 'karst' ? .18 : .37) + random() * .2 });
  }
  const terraces = preset === 'tableland' ? [-1.25, -.42, .43, 1.30].map((position) => ({
    x: position + (random() - .5) * .20,
    width: .30 + random() * .13, height: .36 + random() * .25,
    phase: random() * Math.PI * 2, bend: .035 + random() * .035,
  })) : [];
  const basinX = -.16 + random() * .32, basinY = -.12 + random() * .20;
  const satelliteBasins = view === 2 && preset === 'spillway' ? [
    { x: .85 + .16 * random(), y: -.7 + random() * .5, radius: .3 + .1 * random() },
    { x: -.95 + .16 * random(), y: .25 + random() * .4, radius: .3 + .1 * random() },
  ] : [];
  const sinkholes = preset === 'karst' ? Array.from({ length: view === 2 ? 11 : 7 }, () => ({
    x: (random() - .5) * 2.8,
    y: (random() - .5) * 2.6,
    rx: .16 + random() * .24,
    ry: .13 + random() * .20,
    depth: .18 + random() * .18,
  })) : [];
  const mesas = preset === 'mesas' ? Array.from({ length: view === 2 ? 6 : 4 }, () => ({
    x: (random() - .5) * 2.4,
    y: (random() - .5) * 2.6,
    rx: .20 + random() * .34,
    ry: .18 + random() * .30,
    height: .28 + random() * .24,
  })) : [];
  const badlandChannels = preset === 'badlands' ? Array.from({ length: view === 2 ? 8 : 5 }, (_, i) => ({
    base: -1.22 + (2.44 * i) / Math.max(1, (view === 2 ? 7 : 4)) + (random() - .5) * .22,
    amp: .08 + random() * .12,
    phase: random() * Math.PI * 2,
    width: .045 + random() * .028,
  })) : [];
  const canyonBranches = preset === 'canyon' ? Array.from({ length: view === 2 ? 3 : 2 }, (_, i) => ({
    offset: (i === 0 ? -.85 : .85) + (random() - .5) * .28,
    join: -.2 + .55 * random(),
    phase: random() * Math.PI * 2,
    width: .06 + random() * .03,
  })) : [];
  const braidedBars = preset === 'braided' ? Array.from({ length: view === 2 ? 10 : 6 }, () => ({
    x: (random() - .5) * 2.7,
    y: (random() - .5) * 2.7,
    rx: .10 + random() * .20,
    ry: .16 + random() * .26,
    height: .03 + random() * .05,
  })) : [];
  const ringAngle = random() * Math.PI * 2;
  const calderaCenter = { x: (random() - .5) * .45, y: (random() - .5) * .4 };
  const fanApex = { x: (random() - .5) * .35, y: -1.05 - .15 * random() };
  const cuestaShift = (random() - .5) * .55;
  const badlandSlope = .62 + .06 * random();
  const sinuous = preset === 'meanders' ? .17 + random() * .11 : bend;
  return (px, py) => {
    const x = extent * ((px - .5) * cosine - (py - .5) * sine) + driftX;
    const y = extent * ((px - .5) * sine + (py - .5) * cosine) + driftY;
    const broad = .70 * perlin(ox + x * 1.1, oy + y * 1.1)
      + .30 * perlin(ox + x * 2.2, oy + y * 2.2);
    const fine = perlin(ox + x * 4.4, oy + y * 4.4);
    const river = sinuous * Math.sin(frequency * y + phase)
      + .034 * Math.sin(2.1 * y - phase) + .024 * broad;
    let dist = Math.abs(x - river);
    if (preset === 'meanders' && view === 2) dist = Math.min(dist, Math.abs(x + 1.03 - .17 * Math.sin(3.5 * y + phase + 2)));
    for (const branch of streams) {
      if (preset === 'lowlands' || preset === 'braided') {
        const diverge = terrainSmooth(-.32, .80, y);
        const spread = preset === 'braided' ? branch.spread * (.45 + .35 * Math.sin(2.2 * y + branch.phase)) : branch.spread;
        const tributary = river + branch.side * spread * diverge
          + .04 * diverge * Math.sin((preset === 'braided' ? 5.6 : 4.7) * y + branch.phase);
        dist = Math.min(dist, Math.abs(x - tributary));
      } else {
        const diverge = terrainSmooth(0, .85, branch.join - y);
        const tributary = river + branch.side * branch.spread * diverge
          + .045 * diverge * Math.sin(3.3 * y + branch.phase);
        dist = Math.min(dist, Math.abs(x - tributary));
      }
    }
    let h;
    if (preset === 'massif' || preset === 'hillside') {
      h = .26 + (preset === 'massif' ? .69 : slope) * (.55 - y);
      let crest = 0;
      for (const hill of hills) {
        const dx = (x - hill.x) / hill.rx, dy = (y - hill.y) / hill.ry;
        crest += hill.amp * Math.exp(-.78 * (dx * dx + dy * dy));
      }
      h += (preset === 'massif' ? .92 : .65) * crest + .058 * broad + .006 * fine;
    } else if (preset === 'tableland') {
      let plateau = 0;
      for (const terrace of terraces) {
        const axis = terrace.x + terrace.bend * Math.sin(1.25 * y + terrace.phase);
        const d = Math.abs(x - axis);
        plateau = Math.max(plateau, terrace.height * (1 - terrainSmooth(terrace.width * .58, terrace.width * 1.32, d)));
      }
      const gorge = .29 * Math.exp(-((dist / (channelWidth * 1.85)) ** 2));
      h = .25 + (slope + .60) * (.55 - y) + plateau - gorge + .028 * broad + .003 * fine;
    } else if (preset === 'spillway') {
      const dx = (x - basinX) / (.46 + .10 * Math.sin(phase));
      const dy = (y - basinY) / .40;
      const r2 = dx * dx + dy * dy;
      const bank = .63 * terrainSmooth(.06, 1.75, r2);
      const outflow = terrainSmooth(basinY + .19, basinY + .75, y) * Math.exp(-(((x - river) / .17) ** 2));
      let outer = 0;
      for (const hill of hills) {
        const hx = (x - hill.x) / hill.rx, hy = (y - hill.y) / hill.ry;
        outer += hill.amp * Math.exp(-.7 * (hx * hx + hy * hy));
      }
      h = .19 + .42 * (.5 - y) + bank + .21 * outer - .34 * outflow + .028 * broad + .003 * fine;
      for (const basin of satelliteBasins) {
        const sx = (x - basin.x) / basin.radius, sy = (y - basin.y) / basin.radius;
        h -= .35 * Math.exp(-.75 * (sx * sx + sy * sy));
      }
    } else if (preset === 'canyon') {
      const plateau = .54 + .26 * (.52 - y) + .03 * broad;
      let canyonDist = Math.abs(x - river);
      for (const branch of canyonBranches) {
        const join = terrainSmooth(-.45, branch.join, y);
        const branchCenter = river + branch.offset * (1 - join) + .08 * Math.sin(3.1 * y + branch.phase);
        canyonDist = Math.min(canyonDist, Math.abs(x - branchCenter));
      }
      const incision = .42 * gaussian(canyonDist, channelWidth * (view === 2 ? 1.10 : .86));
      const benches = .025 * Math.sin(8.5 * x + 2.4 * y + phase) + .018 * fine;
      h = plateau - incision + benches;
    } else if (preset === 'badlands') {
      let gully = 0;
      for (const channel of badlandChannels) {
        const center = channel.base + channel.amp * Math.sin(3.4 * y + channel.phase) + .08 * broad;
        gully = Math.max(gully, .22 * gaussian(x - center, channel.width));
      }
      const ribs = .08 * Math.abs(Math.sin(7.5 * x + 1.3 * y + phase)) + .028 * broad + .01 * fine;
      h = .26 + badlandSlope * (.58 - y) + ribs - gully;
    } else if (preset === 'glacial') {
      const floorWidth = .22 * [1.0, 1.18, 1.32][view];
      const valley = terrainSmooth(floorWidth, floorWidth * 3.1, dist);
      const sideWall = terrainSmooth(floorWidth * .95, floorWidth * 1.85, dist);
      h = .18 + .50 * (.52 - y) + .78 * valley + .18 * sideWall + .02 * broad + .004 * fine;
    } else if (preset === 'karst') {
      let hummocks = 0;
      for (const hill of hills) {
        hummocks += .18 * radialGaussian(x - hill.x, y - hill.y, hill.rx * 1.1, hill.ry * 1.1);
      }
      let dolines = 0;
      for (const sink of sinkholes) {
        dolines += sink.depth * radialGaussian(x - sink.x, y - sink.y, sink.rx, sink.ry);
      }
      h = .20 + .18 * (.48 - y) + hummocks + .05 * broad + .008 * fine - dolines;
    } else if (preset === 'caldera') {
      const dx = x - calderaCenter.x, dy = y - calderaCenter.y;
      const r = Math.hypot(dx, dy);
      const rim = .42 * gaussian(r - (.78 + .08 * Math.sin(ringAngle)), .18);
      const bowl = .46 * gaussian(r, .58);
      const notchX = calderaCenter.x + 1.05 * Math.cos(ringAngle), notchY = calderaCenter.y + 1.05 * Math.sin(ringAngle);
      const breach = .36 * radialGaussian(x - notchX, y - notchY, .30, .24) * terrainSmooth(0, 1.35, r);
      h = .30 + .28 * (.42 - y) + rim - bowl - breach + .022 * broad + .003 * fine;
    } else if (preset === 'fan') {
      const dx = x - fanApex.x, dy = y - fanApex.y;
      const radius = Math.hypot(dx, Math.max(.05, dy + 1.15));
      const spread = Math.abs(Math.atan2(dx, dy + 1.15));
      const inFan = 1 - terrainSmooth(.5, 1.2, spread);
      let branchDist = Infinity;
      for (const branch of streams.length ? streams : [{ side: 0, spread: 0, join: 0, phase }]) {
        const channel = fanApex.x + (.10 + .18 * branch.side + .06 * Math.sin(5 * y + branch.phase)) * terrainSmooth(-.8, 1.4, y);
        branchDist = Math.min(branchDist, Math.abs(x - channel));
      }
      const fanSurface = .58 - .46 * terrainSmooth(.0, 2.8, radius) + .16 * inFan;
      const mountain = .55 * gaussian(y + 1.22, .35) * (1 - terrainSmooth(.15, 1.0, Math.abs(x - fanApex.x)));
      const channels = .22 * inFan * gaussian(branchDist, .10 + .05 * terrainSmooth(-1.0, 1.5, y));
      h = .16 + .34 * (.55 - y) + mountain + fanSurface - channels + .018 * broad + .004 * fine;
    } else if (preset === 'mesas') {
      let plateau = 0;
      for (const mesa of mesas) {
        const r = Math.hypot((x - mesa.x) / mesa.rx, (y - mesa.y) / mesa.ry);
        plateau = Math.max(plateau, mesa.height * (1 - terrainSmooth(.48, 1.35, r)));
      }
      const wash = .18 * gaussian(x - river, channelWidth * 1.3);
      h = .10 + .42 * (.54 - y) + 1.10 * plateau - wash + .030 * broad + .005 * fine;
    } else if (preset === 'cuesta') {
      const axis = x + .34 * y - cuestaShift + .10 * Math.sin(1.4 * y + phase);
      const axis2 = x + .34 * y - cuestaShift - 1.05 + .08 * Math.sin(1.2 * y + phase + 1.7);
      const front1 = .35 * (1 - terrainSmooth(-.02, .22, axis));
      const front2 = .22 * (1 - terrainSmooth(-.02, .20, axis2));
      const dip1 = .16 * terrainSmooth(-.7, .7, axis);
      const dip2 = .12 * terrainSmooth(-.7, .6, axis2);
      h = .18 + .40 * (.45 - y) + front1 + front2 + dip1 + dip2 + .022 * broad + .004 * fine;
    } else if (preset === 'braided') {
      let bars = 0;
      for (const bar of braidedBars) bars += bar.height * radialGaussian(x - bar.x, y - bar.y, bar.rx, bar.ry);
      const spread = channelWidth * [1.35, 1.7, 2.2][view];
      h = .14 + .24 * (.5 - y) + .16 * (1 - Math.exp(-((dist / spread) ** 2))) + bars + .020 * broad + .003 * fine;
    } else {
      const spread = preset === 'lowlands' ? .28 * [1, 1.25, 1.45][view]
        : preset === 'headwaters' ? channelWidth * (view === 2 ? 1.10 : .82) : channelWidth;
      const strength = preset === 'lowlands' ? shoulders * .55 : shoulders;
      h = .20 + (preset === 'lowlands' ? .42 : slope) * (.55 - y)
        + strength * (1 - Math.exp(-((dist / spread) ** 2))) + (preset === 'lowlands' ? .027 : .039) * broad + .003 * fine;
    }
    return .9 * h;
  };
}

function landscapeSampler(preset, value) {
  const random = terrainRandom(value);
  const angle = Math.floor(random() * 4) * Math.PI / 2 + (random() - .5) * .65;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const ox = 12 + random() * 150, oy = 12 + random() * 150;
  const phase = random() * Math.PI * 2, bend = .04 + random() * .08;
  const width = .14 + random() * .10, slope = .55 + random() * .3;
  const height = .45 + random() * .24, centerX = .42 + random() * .16;
  const frequency = 3.5 + random() * 3, merge = .53 + random() * .18;
  const basinY = .32 + random() * .16;
  return (px, py) => {
    const across = (px - .5) * cosine - (py - .5) * sine + .5;
    const along = (px - .5) * sine + (py - .5) * cosine + .5;
    // Two broad octaves retain irregular shoulders without filling valleys
    // with grid-scale pits. Fine detail stays subordinate to the main slope.
    const macro = .72 * perlin(ox + across * 1.9, oy + along * 1.9)
      + .28 * perlin(ox + across * 3.8, oy + along * 3.8);
    const fine = perlin(ox + across * 5.2, oy + along * 5.2);
    const center = centerX + bend * Math.sin(along * frequency + phase) + .035 * macro;
    const cross = across - center;
    let distance = Math.abs(cross);
    let h;
    if (preset === "hillside") {
      const hill1 = Math.exp(-(((across - .25) / .26) ** 2 + ((along - .26) / .44) ** 2));
      const hill2 = Math.exp(-(((across - .79) / .23) ** 2 + ((along - .62) / .40) ** 2));
      h = .16 + slope * (1 - along) + height * (.4 * hill1 + .3 * hill2) + .065 * macro + .004 * fine;
    } else if (preset === "spillway") {
      const radius = ((across - centerX) * 1.55) ** 2 + ((along - basinY) * 1.6) ** 2;
      const bowl = .12 + height * 1.8 * radius + .045 * macro;
      const outlet = .19 + .35 * (.67 - along) + .016 * macro;
      const opening = terrainSmooth(.51, .83, along) * Math.exp(-((cross / (width * .68)) ** 2));
      h = lerp(bowl, outlet, opening) + .006 * fine;
    } else {
      if (preset === "confluence" || preset === "headwaters") {
        const separation = (.20 + bend) * (1 - terrainSmooth(.08, merge, along));
        const branch = .025 * Math.sin(along * 9 + phase) * (1 - terrainSmooth(.08, merge, along));
        distance = Math.min(Math.abs(cross - separation - branch), Math.abs(cross + separation));
        if (preset === "headwaters") {
          // A third tributary joins the common valley without a raised lip.
          const join = 1 - terrainSmooth(.02, merge - .12, along);
          distance = Math.min(distance, Math.abs(cross + .025 * join * Math.sin(along * 8 + phase)));
        }
      }
      const localWidth = width * (preset === "headwaters" ? .62 : preset === "confluence" ? .76 : 1);
      const shoulders = height * (1 - Math.exp(-((distance / localWidth) ** 2)));
      h = .12 + slope * (1 - along) + shoulders + .04 * macro + .003 * fine;
    }
    return h * .9;
  };
}

function genTerrain(options = {}) {
  const requestedSeed = options.seed === undefined ? (Math.random() * 1e9) | 0 : Number(options.seed);
  if (!Number.isInteger(requestedSeed) || requestedSeed < 0 || requestedSeed > 2147483647)
    throw new Error("La graine doit etre un entier entre 0 et 2147483647.");
  const preset = options.preset || terrainPreset;
  if (!isTerrainPreset(preset)) throw new Error("Terrain inconnu.");
  terrainSeed = requestedSeed;
  terrainPreset = preset;
  seed = terrainSeed;
  reseedPerm();
  b = new Float64Array(NN);
  bInit = new Float64Array(NN);
  d = new Float64Array(NN);
  s = new Float64Array(NN);
  fL = new Float64Array(NN);
  fR = new Float64Array(NN);
  fT = new Float64Array(NN);
  fB = new Float64Array(NN);
  u = new Float64Array(NN);
  v = new Float64Array(NN);
  tmpS = new Float64Array(NN);
  tmpD = new Float64Array(NN);
  bedrock = new Float64Array(NN);
  bedDelta = new Float64Array(NN);
  flowTo = new Int32Array(NN);
  accum = new Float32Array(NN);
  accumSmooth = new Float32Array(NN);
  sortIdx = new Int32Array(NN);
  drainReady = false;
  activeCell = new Uint8Array(NN);
  activeVel = new Float32Array(NN);
  activeCellsList = new Int32Array(NN);
  activeCellsCount = 0;
  maxActiveQ = 1e-6;
  sourceProtectionMask = new Float32Array(NN);
  sourceProtectionMask.fill(1);
  /*
   * A local depression establishes one natural outlet without imposing a
   * directional slope or raising any terrain border.
   */
  const outletX = 0.35 + rnd() * 0.3;
  const outletY = 1.02;
  const OUTLET_DEPTH = 0.28;
  const OUTLET_WIDTH_X = 0.14;
  const OUTLET_WIDTH_Y = 0.12;

  // "natural" intentionally uses the original fractal-height branch below,
  // rather than the regional or valley samplers used by the eight new families.
  const sampleLandscape = Object.hasOwn(TERRAIN_CATALOG, preset) && preset !== "natural"
    ? (terrainViewIndex(terrainSeed) === 0 && LEGACY_CLOSEUP_PRESETS.has(preset) && !REGIONAL_ONLY_PRESETS.has(preset)
      ? landscapeSampler(preset, terrainSeed) // Retain the familiar close-ups for the original discovery presets.
      : regionalLandscapeSampler(preset, terrainSeed, terrainViewIndex(terrainSeed)))
    : null;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (sampleLandscape) {
        b[idx(x, y)] = sampleLandscape(x / (N - 1), y / (N - 1));
        continue;
      }
      const nx = (x / N) * 3.2,
        ny = (y / N) * 3.2;
      const macro = (fbm(nx * 0.4, ny * 0.4) + 1) * 0.5;
      const detail = (fbm(nx, ny) + 1) * 0.5;
      let h = macro * 0.8 + detail * 0.2;

      const px = x / (N - 1);
      const py = y / (N - 1);
      const dx = (px - outletX) / OUTLET_WIDTH_X;
      const dy = (py - outletY) / OUTLET_WIDTH_Y;
      const outletInfluence = Math.exp(-0.5 * (dx * dx + dy * dy));
      h -= OUTLET_DEPTH * outletInfluence;

      if (preset === "valley") {
        // A reproducible demonstration, explicitly distinct from natural terrain.
        const center = 0.50 + 0.105 * Math.sin(py * 6.5);
        h = 0.10 + 0.95 * (1 - py) + 1.9 * (px - center) ** 2
          + 0.018 * fbm(nx * 0.9, ny * 0.9);
      } else if (preset === "basin") {
        const radius = Math.hypot((px - 0.5) * 1.2, py - 0.5);
        h = 0.20 + 1.5 * radius * radius + 0.009 * fbm(nx, ny);
      } else if (preset === "ridge") {
        h = 0.2 + 0.9 * Math.exp(-(((px - 0.5) / 0.15) ** 2))
          + 0.15 * (1 - py) + 0.025 * fbm(nx, ny);
      }
      b[idx(x, y)] = h * 0.9;
    }
  bInit.set(b);
  for (let i = 0; i < NN; i++) bedrock[i] = b[i] - SOIL_THICKNESS;
  sources.length = 0;
  steps = 0;
  simTime = 0;
  px = new Float32Array(NP);
  py = new Float32Array(NP);
  pAlive = new Uint8Array(NP);
  for (let i = 0; i < NP; i++) {
    px[i] = rnd() * N;
    py[i] = rnd() * N;
    pAlive[i] = 0;
  }
  resetBudgets();
  computeDrainage();
  if (typeof invalidateDrainagePaths === "function") invalidateDrainagePaths();
}
