/**
 * Post-processes an existing morphology audit into a net-routing audit.
 *
 * This diagnostic deliberately reads the completed capture only: it never
 * loads production code, mutates simulation state, or reruns the model.
 * RUN: node tests/diagnostics/analyze-source-relative-routing.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const input = path.join(root, "tests/generated/source-relative-morphology/summary.json");
const output = path.join(root, "tests/generated/source-relative-routing-audit");
const source = JSON.parse(fs.readFileSync(input, "utf8"));
const variants = ["CURRENT", "POSITIVE_CONSERVATIVE_LEGACY"];
const windows = ["0..1000", "1001..2500", "2501..5000", "5001..7500", "7501..10000"];
const radii = [8, 12, 16, 24, 32, 48];
const lateWindows = windows.slice(-2);
const focusRadii = [16, 24, 32];
const directions = ["north", "south", "west", "east"];
const epsilon = 1e-30;

const divide = (value, total) => total ? value / total : 0;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key]]));

/** Classifies net export without treating positive local crossings as export. */
function netDirection(surface) {
  const north = surface.north.netOutward;
  const south = surface.south.netOutward;
  if (north > 0 && north > south) return "NET_NORTH";
  if (south > 0 && south > north) return "NET_SOUTH";
  return "MIXED/RECIRCULATING";
}

function directionSummary(surfaces, key = "netOutward") {
  const rows = focusRadii.map((radius) => surfaces[radius]);
  const classified = rows.map((surface) => key === "netOutward" ? netDirection(surface) : sedimentDirection(surface));
  const counts = Object.fromEntries(["NET_NORTH", "NET_SOUTH", "MIXED/RECIRCULATING"].map((name) => [name, classified.filter((value) => value === name).length]));
  return {
    medianPositiveOutShares: Object.fromEntries(directions.map((side) => [side, median(rows.map((row) => row[`${side}Share`]))])),
    medianNorth: median(rows.map((row) => row.north[key])),
    medianSouth: median(rows.map((row) => row.south[key])),
    directions: Object.fromEntries(focusRadii.map((radius, index) => [radius, classified[index]])),
    majority: counts.NET_NORTH > counts.NET_SOUTH && counts.NET_NORTH > counts["MIXED/RECIRCULATING"] ? "NET_NORTH" : counts.NET_SOUTH > counts.NET_NORTH && counts.NET_SOUTH > counts["MIXED/RECIRCULATING"] ? "NET_SOUTH" : "MIXED/RECIRCULATING",
    counts
  };
}

/** Sediment controls use `net`, while water controls use `netOutward`. */
function sedimentDirection(surface) {
  if (surface.north.net > 0 && surface.north.net > surface.south.net) return "NET_NORTH";
  if (surface.south.net > 0 && surface.south.net > surface.north.net) return "NET_SOUTH";
  return "MIXED/RECIRCULATING";
}

function waterAudit(surfaces) {
  return Object.fromEntries(radii.map((radius) => {
    const surface = surfaces[radius];
    const denominator = directions.reduce((total, side) => total + Math.abs(surface[side].netOutward), 0);
    const netTotalOutward = directions.reduce((total, side) => total + surface[side].netOutward, 0);
    return [radius, {
      positiveOutShares: Object.fromEntries(directions.map((side) => [side, surface[`${side}Share`]])),
      net: Object.fromEntries(directions.map((side) => [side, surface[side].netOutward])),
      netTotalOutward,
      netFractionSigned: Object.fromEntries(directions.map((side) => [side, surface[side].netOutward / Math.max(denominator, epsilon)])),
      northMinusSouthNet: surface.north.netOutward - surface.south.netOutward,
      localDirection: netDirection(surface),
      recirculationIndex: Object.fromEntries(directions.map((side) => [side, surface[side].positiveOutward / Math.max(Math.abs(surface[side].netOutward), epsilon)]))
    }];
  }));
}

function sedimentAudit(surfaces) {
  return Object.fromEntries(radii.map((radius) => {
    const surface = surfaces[radius];
    return [radius, {
      net: Object.fromEntries(directions.map((side) => [side, surface[side].net])),
      positiveOut: Object.fromEntries(directions.map((side) => [side, surface[side].positiveOut])),
      incoming: Object.fromEntries(directions.map((side) => [side, surface[side].incoming])),
      sedimentNorthMinusSouthNet: surface.north.net - surface.south.net,
      localDirection: sedimentDirection(surface),
      sedimentRecirculationNorth: surface.north.positiveOut / Math.max(Math.abs(surface.north.net), epsilon)
    }];
  }));
}

function morphologyAudit(morphology) {
  const normalisedAnnuli = Object.fromEntries(Object.entries(morphology.annuli)
    .filter(([name]) => name !== "r0..6")
    .map(([name, row]) => [name, {
      upstream: pick(row.upstream, ["grossErosion", "grossDeposition", "erosionShare", "depositionShare"]),
      downstream: pick(row.downstream, ["grossErosion", "grossDeposition", "erosionShare", "depositionShare"])
    }]));
  return {
    halfPlanes: Object.fromEntries(["UPSTREAM", "DOWNSTREAM", "SOURCE_BAND"].map((name) => [name, pick(morphology.halfPlanes[name], ["erosionShare", "depositionShare"])])),
    sectors: Object.fromEntries(["UPSTREAM_WEDGE", "DOWNSTREAM_WEDGE", "LEFT_LATERAL", "RIGHT_LATERAL"].map((name) => [name, pick(morphology.sectors[name], ["erosionShare", "depositionShare"])])),
    annuliNormalisedByWindowTotal: normalisedAnnuli,
    distributions: {
      erosion: pick(morphology.erosion, ["centroidDy", "p10Dy", "p25Dy", "p50Dy", "p75Dy", "p90Dy", "centroidR", "p50R", "p90R"]),
      deposition: pick(morphology.deposition, ["centroidDy", "p10Dy", "p25Dy", "p50Dy", "p75Dy", "p90Dy", "centroidR", "p50R", "p90R"])
    }
  };
}

function scaleClassification(audit) {
  const directionsByRadius = Object.fromEntries(radii.map((radius) => [radius, audit[radius].localDirection]));
  const smallNorth = [8, 12, 16, 24].every((radius) => directionsByRadius[radius] === "NET_NORTH");
  const largerSouthOrMixed = [32, 48].every((radius) => directionsByRadius[radius] !== "NET_NORTH");
  const multiscaleNorth = [16, 24, 32, 48].every((radius) => directionsByRadius[radius] === "NET_NORTH");
  return { directionsByRadius, classification: smallNorth && largerSouthOrMixed ? "LOCAL_NORTH_ONLY" : multiscaleNorth ? "MULTISCALE_NORTH" : "MIXED_SCALE" };
}

function fullGridQuadrants(variant) {
  const N = Math.sqrt(variant.fullGridAt10000.cumulativeErosionByCell.length);
  const calculate = (values) => {
    const rows = Object.fromEntries(["NW", "NE", "SW", "SE"].map((name) => [name, { gross: 0, weightedR: 0 }]));
    for (let index = 0; index < values.length; index++) {
      const x = index % N, y = Math.floor(index / N), dx = x - source.source.x, dy = y - source.source.y, radius = Math.hypot(dx, dy);
      if (radius <= 6 || dx === 0 || dy === 0) continue;
      const quadrant = dy < 0 ? (dx < 0 ? "NW" : "NE") : (dx < 0 ? "SW" : "SE");
      rows[quadrant].gross += values[index];
      rows[quadrant].weightedR += values[index] * radius;
    }
    const total = Object.values(rows).reduce((sum, row) => sum + row.gross, 0);
    return Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, { gross: row.gross, share: divide(row.gross, total), centroidR: divide(row.weightedR, row.gross) }]));
  };
  return { erosion: calculate(variant.fullGridAt10000.cumulativeErosionByCell), deposition: calculate(variant.fullGridAt10000.cumulativeDepositionByCell) };
}

function lateWaterSedimentCoherence(water, sediment) {
  const result = {};
  for (const radius of focusRadii) {
    const waterNorth = water[radius].localDirection === "NET_NORTH";
    const sedimentNorth = sediment[radius].localDirection === "NET_NORTH";
    result[radius] = waterNorth && sedimentNorth ? "COHERENT_NORTH" : waterNorth ? "WATER_NORTH_SEDIMENT_NOT" : sedimentNorth ? "SEDIMENT_NORTH_WATER_NOT" : "MIXED";
  }
  return result;
}

function routingVerdict(current, legacy) {
  const late = lateWindows.map((window) => legacy.windows[window].water);
  const multiscaleCounts = late.map((audit) => [16, 24, 32, 48].filter((radius) => audit[radius].localDirection === "NET_NORTH").length);
  const localOnly = late.every((audit) => scaleClassification(audit).classification === "LOCAL_NORTH_ONLY");
  const currentNorth = lateWindows.flatMap((window) => focusRadii.map((radius) => current.windows[window].water[radius].localDirection === "NET_NORTH")).filter(Boolean).length;
  const legacyNorth = lateWindows.flatMap((window) => focusRadii.map((radius) => legacy.windows[window].water[radius].localDirection === "NET_NORTH")).filter(Boolean).length;
  const northSharesHighButRecirculating = late.some((audit) => focusRadii.some((radius) => audit[radius].positiveOutShares.north >= .5 && audit[radius].recirculationIndex.north > 5));
  if (multiscaleCounts.every((count) => count >= 3)) return "ROUTING-AUDIT A — TRUE MULTISCALE NET UPSTREAM EXPORT";
  if (localOnly) return "ROUTING-AUDIT B — LOCAL UPSTREAM ROUTING, DOWNSTREAM AT LARGER SCALE";
  if (northSharesHighButRecirculating) return "ROUTING-AUDIT C — POSITIVE-OUT NORTH SHARE IS MAINLY RECIRCULATION";
  if (currentNorth > legacyNorth) return "ROUTING-AUDIT D — UPSTREAM ROUTING IS CURRENT-SPECIFIC";
  return "ROUTING-AUDIT E — SHARED MIXED / SCALE-DEPENDENT ROUTING";
}

function main() {
  const result = {
    purpose: "Net-flux routing audit derived solely from source-relative-morphology/summary.json; no simulation was run.",
    instrumentationValidity: {
      invalidForQuantitativeClassification: ["hydraulicExposure.erosion", "hydraulicExposure.deposition", "erosionPerWetCellStep", "depositionPerWetCellStep", "erosionPerDepthExposure", "depositionPerDepthExposure"],
      reason: "e-priorE and d-priorD are accumulated at every step while priorE/priorD advance only at a window boundary.",
      validInputs: ["morphology by window", "morphology checkpoints", "waterControlSurfaces", "sedimentControlSurfaces", "fullGridAt10000", "identity controls"]
    },
    sourceAuditConclusions: source.conclusions,
    identityControls: source.controls,
    variants: {},
    currentVsPositiveLegacy: { waterNetDifferenceCurrentMinusLegacy: {} },
    verdict: null
  };
  for (const name of variants) {
    const variant = source.variants[name];
    const audit = { windows: {}, checkpoints: {}, fullGridAt10000QuadrantsExcludingR6: fullGridQuadrants(variant) };
    for (const window of windows) {
      const capture = variant.windows[window];
      const water = waterAudit(capture.waterControlSurfaces);
      audit.windows[window] = {
        morphology: morphologyAudit(capture.morphology),
        water,
        waterR16R24R32Summary: directionSummary(capture.waterControlSurfaces),
        scaleDependence: lateWindows.includes(window) ? scaleClassification(water) : undefined,
        ...(capture.sedimentControlSurfaces ? {
          sediment: sedimentAudit(capture.sedimentControlSurfaces),
          sedimentR16R24R32Summary: directionSummary(capture.sedimentControlSurfaces, "net"),
          waterSedimentCoherenceR16R24R32: lateWindows.includes(window) ? lateWaterSedimentCoherence(water, sedimentAudit(capture.sedimentControlSurfaces)) : undefined
        } : {})
      };
    }
    for (const checkpoint of [1000, 2500, 5000, 7500, 10000]) {
      const morphology = variant.checkpoints[checkpoint].morphology;
      audit.checkpoints[checkpoint] = {
        erosion: pick(morphology.erosion, ["centroidDy", "fractionDyLessThan0"]),
        deposition: pick(morphology.deposition, ["centroidDy", "fractionDyLessThan0"])
      };
    }
    const early = variant.checkpoints[2500].morphology.halfPlanes.UPSTREAM;
    const final = variant.checkpoints[10000].morphology.halfPlanes.UPSTREAM;
    audit.earlyTransientRecheck = {
      upstreamProducedBy2500Over10000: {
        erosion: divide(early.grossErosion, final.grossErosion),
        deposition: divide(early.grossDeposition, final.grossDeposition)
      },
      lateWindowUpstreamShares: Object.fromEntries(lateWindows.map((window) => [window, pick(variant.windows[window].morphology.halfPlanes.UPSTREAM, ["erosionShare", "depositionShare"])])),
      earlyTransientDominated: false
    };
    result.variants[name] = audit;
  }
  for (const window of windows) {
    result.currentVsPositiveLegacy.waterNetDifferenceCurrentMinusLegacy[window] = Object.fromEntries(radii.map((radius) => {
      const current = source.variants.CURRENT.windows[window].waterControlSurfaces[radius];
      const legacy = source.variants.POSITIVE_CONSERVATIVE_LEGACY.windows[window].waterControlSurfaces[radius];
      return [radius, { northNetOutward: current.north.netOutward - legacy.north.netOutward, southNetOutward: current.south.netOutward - legacy.south.netOutward, currentDirection: netDirection(current), legacyDirection: netDirection(legacy) }];
    }));
  }
  result.verdict = routingVerdict(result.variants.CURRENT, result.variants.POSITIVE_CONSERVATIVE_LEGACY);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(output, "COMPLETE"), `completedAt: ${new Date().toISOString()}\nverdict: ${result.verdict}\n`);
  console.log(result.verdict);
}

main();
