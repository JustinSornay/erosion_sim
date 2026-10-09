// Dry topographies for the aquatic catalogue. Filling is a separate, conserved
// scene initialization step; no water, current or erosion is painted into b.
function waterLandscapeSampler(preset, value, view) {
  const random = terrainRandom(value ^ 0x4a53dc71);
  const extent = [1.5, 2.05, 2.8][view];
  const angle = random() * Math.PI * 2, cs = Math.cos(angle), sn = Math.sin(angle);
  const cx = (random() - .5) * .09, cy = (random() - .5) * .09;
  const ox = 20 + 170 * random(), oy = 20 + 170 * random();
  const phase = random() * Math.PI * 2, phase2 = random() * Math.PI * 2;
  const amplitude = .62 + .18 * random(), oval = .78 + .24 * random();
  const islandCount = [3, 5, 7][view];
  const islands = [];
  for (let k = 0; k < islandCount; k++) {
    // Staggered islands, not a stack of peaks occupying the same central hill.
    const row = Math.floor(k / 3), column = k % 3;
    islands.push({ x: (column - 1) * .27 + (random() - .5) * .09,
      y: (row - (Math.ceil(islandCount / 3) - 1) / 2) * .29 + (random() - .5) * .10,
      rx: .11 + random() * .04, ry: .105 + random() * .035, h: .44 + random() * .32 });
  }
  const peaks = Array.from({length: 5 + 2 * view}, () => ({
    x: (random() - .5) * .85, y: (random() - .5) * .85,
    rx: .10 + random() * .12, ry: .10 + random() * .12, h: .12 + .16 * random(),
  }));
  const atollRadius = .29 + .025 * random(), atollWidth = .046 + random() * .014;
  const opening = -.65 + .45 * random();
  return (px, py) => {
    const dx = px - .5 - cx, dy = py - .5 - cy;
    const x = cs * dx - sn * dy, y = sn * dx + cs * dy;
    const broad = .7 * perlin(ox + x * extent * 1.7, oy + y * extent * 1.7)
      + .3 * perlin(ox + x * extent * 3.4, oy + y * extent * 3.4);
    const fine = perlin(ox + x * extent * 7, oy + y * extent * 7);
    const coastLine = .035 + .065 * Math.sin(y * 8 + phase) + .045 * broad;
    const channel = .06 * Math.sin(y * 5 + phase) + .03 * Math.sin(y * 11 + phase2);
    let uplands = 0;
    for (const peak of peaks) uplands += peak.h * radialGaussian(x - peak.x, y - peak.y, peak.rx, peak.ry);
    if (preset === 'island') {
      const r = Math.hypot(x / oval, y);
      const a = Math.atan2(y, x);
      const rim = .27 * (1 + .12 * Math.sin(3 * a + phase) + .07 * Math.sin(5 * a + phase2));
      const core = Math.exp(-1.25 * (r / rim) ** 2);
      return -.30 + (amplitude + .33) * core + .10 * broad * core + .17 * uplands * core;
    }
    if (preset === 'archipelago') {
      let h = -.20;
      for (const island of islands) {
        const r = ((x - island.x + .014 * broad) / island.rx) ** 2 + ((y - island.y) / island.ry) ** 2;
        h += island.h * Math.exp(-1.8 * r);
      }
      return h + .045 * broad + .009 * fine;
    }
    if (preset === 'atoll') {
      const a = Math.atan2(y, x), r = Math.hypot(x / oval, y);
      const radius = atollRadius * (1 + .055 * Math.sin(4 * a + phase));
      const ring = .42 * gaussian(r - radius, atollWidth);
      const heightVariation = .64 + .36 * Math.sin(3 * a + phase2) ** 2;
      // Two submerged passes connect the lagoon to the external sea.
      const pass = .32 * radialGaussian(x - radius * Math.cos(opening), y - radius * Math.sin(opening), .08, .075)
        + .24 * radialGaussian(x + radius * .8, y - radius * .3, .07, .07);
      return -.19 + ring * heightVariation - pass + .012 * broad;
    }
    if (preset === 'coast') {
      const shore = x - coastLine;
      return .50 * Math.tanh(6 * shore) + .25 * uplands * terrainSmooth(-.08, .20, shore)
        + .032 * broad + .006 * fine;
    }
    if (preset === 'estuary') {
      const width = .042 + .12 * terrainSmooth(-.30, .28, y);
      const valley = .48 * (1 - Math.exp(-(((x - channel) / width) ** 2)));
      const floor = -.07 - .68 * y;
      const land = floor + valley + .08 * uplands + .016 * broad;
      const sea = -.28 - .30 * Math.max(0, y);
      return lerp(land, sea, terrainSmooth(.05, .40, y));
    }
    if (preset === 'fjord') {
      let distance = Math.abs(x - channel);
      const fork = .24 * (1 - terrainSmooth(-.27, -.02, y));
      if (view > 0) distance = Math.min(distance, Math.abs(x - channel + fork));
      const walls = amplitude * (1 - Math.exp(-((distance / (.068 + .01 * view)) ** 2)));
      const valley = -.22 - .43 * y + walls + .16 * uplands + .02 * broad;
      return lerp(valley, -.42, terrainSmooth(.23, .52, y));
    }
    if (preset === 'lagoon') {
      const shore = x - coastLine;
      const hinterland = .48 * Math.tanh(7 * (shore - .13));
      const beach = .49 * gaussian(shore + .10, .048 + .008 * view);
      const pass = 1 - .98 * gaussian(y - .08 * Math.sin(phase), .057);
      return hinterland + beach * pass + .16 + .12 * uplands * terrainSmooth(.08, .22, shore) + .011 * broad;
    }
    if (preset === 'lake') {
      const axis = x - .04 * Math.sin(y * 7 + phase);
      const radius = Math.hypot(axis / .29, y / .43);
      return -.22 + .79 * terrainSmooth(.22, 1.28, radius) + .12 * uplands + .023 * broad + .004 * fine;
    }
    // A lake below an irregular crater rim. Borders remain dry at level zero.
    const radius = Math.hypot(x / oval, y);
    const a = Math.atan2(y, x);
    const rim = .31 * (1 + .065 * Math.sin(3 * a + phase));
    return .16 + .53 * gaussian(radius - rim, .105) - .47 * gaussian(radius, .24)
      + .04 * uplands + .019 * broad;
  };
}
