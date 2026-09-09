/**
 * CATEGORY: DIAGNOSTIC AUDIT
 * PURPOSE: Reclassifies existing initial-routing factorial evidence without rerunning simulation.
 * RUN: node tests/diagnostics/analyze-initial-routing-factorial.js
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const input = path.join(root, "tests/generated/initial-routing-factorial/summary.json");
const output = path.join(root, "tests/generated/initial-routing-factorial-audit");
const postWindows = ["251..500", "501..750", "751..1000"], allWindows = ["1..100", "101..250", ...postWindows], radii = [8, 12, 16, 24, 32, 48], epsilon = 1e-30;

fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, "COMPLETE"), { force: true });
const source = JSON.parse(fs.readFileSync(input, "utf8"));
const rawProd = source.variants.RAW_PROD, rawMirror = source.variants.RAW_MIRRORED_Y;
if (!rawProd || !rawMirror) throw new Error("Required RAW_PROD or RAW_MIRRORED_Y result missing");
const mean = (values) => values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
const valid = (value) => typeof value === "number" && Number.isFinite(value);
const strictDirection = ({ north, south }) => !valid(north.netOutward) || !valid(south.netOutward) ? "UNAVAILABLE" : north.netOutward > 0 && north.netOutward > south.netOutward ? "NET_NORTH" : south.netOutward > 0 && south.netOutward > north.netOutward ? "NET_SOUTH" : "MIXED";
const windowMargin = (variant, window) => mean([16, 24, 32].map((radius) => variant.windows[window].surfaces[radius].meanMarginPerStep));
const ratio = (numerator, denominator) => denominator === 0 ? numerator === 0 ? null : numerator > 0 ? Infinity : -Infinity : numerator / denominator;

function effectiveFactorial() {
  const snapshots = source.initializationSnapshots, configuredZero = snapshots.configuredMinusRaw.maxAbsDiff === 0, maskZero = snapshots.afterMaskMinusConfigured.maxAbsDiff === 0;
  return { configureSourceOutletsModifiesB: snapshots.configureSourceOutletsModifiesB, bedConfigurationEffect: snapshots.bedConfigurationEffect, configuredMinusRawMaxAbsDiff: snapshots.configuredMinusRaw.maxAbsDiff, afterMaskMinusConfiguredMaxAbsDiff: snapshots.afterMaskMinusConfigured.maxAbsDiff, effectiveFactorial: configuredZero && maskZero ? "EFFECTIVE_FACTORIAL = MOUTH_ONLY_ON_FIXED_RAW_TERRAIN" : "EFFECTIVE_FACTORIAL = BED_AND_MOUTH", aliases: configuredZero && maskZero ? { RAW_PROD_EQUALS_CONFIGURED_PROD: true, RAW_MIRRORED_EQUALS_CONFIGURED_MIRRORED: true } : null };
}
function directionsByWindow() { return allWindows.map((window) => ({ window, rawProd: { majorityR16R24R32: rawProd.windows[window].majorityR16R24R32, multiscaleDirection: rawProd.windows[window].multiscaleDirection }, rawMirroredY: { majorityR16R24R32: rawMirror.windows[window].majorityR16R24R32, multiscaleDirection: rawMirror.windows[window].multiscaleDirection } })); }
function directionsByRadius() { return Object.fromEntries(postWindows.map((window) => [window, Object.fromEntries(radii.map((radius) => { const prod = rawProd.windows[window].surfaces[radius], mirror = rawMirror.windows[window].surfaces[radius]; const row = (surface) => ({ northNetOutward: surface.north.netOutward, southNetOutward: surface.south.netOutward, northMinusSouthNet: surface.northMinusSouthNet, direction: strictDirection(surface) }); return [radius, { rawProd: row(prod), rawMirroredY: row(mirror) }]; }))])); }
function persistence() { return Object.fromEntries(radii.map((radius) => [radius, { rawProd: rawProd.first100StepPersistentNetNorth[radius], rawMirroredY: rawMirror.first100StepPersistentNetNorth[radius] }])); }
function wetAndHead() { return Object.fromEntries([100, 250, 500, 1000].map((step) => { const prod = rawProd.checkpoints[step], mirror = rawMirror.checkpoints[step], wet = {}; for (const field of ["farthestWetNorth", "farthestWetSouth", "depthMassNorth", "depthMassSouth", "wetCountNorth", "wetCountSouth"]) wet[field] = { rawProd: prod.wetFront[field], rawMirroredY: mirror.wetFront[field], mirrorOverProd: ratio(mirror.wetFront[field], prod.wetFront[field]) }; return [step, { wetFront: wet, head: Object.fromEntries([8, 16, 24, 32].map((radius) => [radius, { rawProdNorthMinusSouthMeanHead: prod.head[radius].northMinusSouthMeanHead, rawMirroredYNorthMinusSouthMeanHead: mirror.head[radius].northMinusSouthMeanHead }])) }]; })); }
function staticRawSignal() { const raw = source.topologyRawVsConfigured.raw; return { inverseRMeanDzdy: raw.inverseRMeanDzdy, escapeBarrier: raw.escapeBarrier, maxMonotonicNorthReach: raw.monotonic.maxMonotonicNorthReach, maxMonotonicSouthReach: raw.monotonic.maxMonotonicSouthReach, steepestDescentByOutlet: raw.steepestDescentByOutlet, descriptiveAssessment: "Positive inverse-R dzdy and north monotonic reach exceed south; R16-R32 escape barriers tie, R48 north is lower. Static RAW indicators remain compatible with north preference; no static vote applied." }; }
function audit() {
  const directions = directionsByWindow(), post = directions.filter((row) => postWindows.includes(row.window));
  const mouthSignControl = post.filter((row) => row.rawProd.multiscaleDirection === "MULTISCALE_NET_NORTH" && ["MULTISCALE_NET_SOUTH", "MIXED"].includes(row.rawMirroredY.multiscaleDirection)).length >= 2;
  const mirrorNorthCount = post.filter((row) => row.rawMirroredY.multiscaleDirection === "MULTISCALE_NET_NORTH").length, mirrorRemainsNorth = mirrorNorthCount === 3, mirrorMostlyNorth = mirrorNorthCount >= 2;
  const perWindowAmplification = post.map(({ window }) => { const prodLateMargin = windowMargin(rawProd, window), mirrorLateMargin = windowMargin(rawMirror, window), mouthEffect = prodLateMargin - mirrorLateMargin; return { window, prodLateMargin, mirrorLateMargin, mouthEffect, relativeEffect: mouthEffect / Math.max(Math.abs(prodLateMargin), epsilon) }; });
  const causal = source.causal, mouthEffectNormalized = causal.effects.meanMouthEffect / Math.max(Math.abs(causal.lateMargins.baselineProductionLateMargin), epsilon), meanRelativeEffect = mean(perWindowAmplification.map((row) => row.relativeEffect)), mouthStrongAmplifier = meanRelativeEffect >= .30 && !mouthSignControl;
  let classification;
  if (mirrorMostlyNorth && mouthEffectNormalized < .30) classification = "INITIAL-FACTOR-AUDIT A — RAW TERRAIN DETERMINES NORTH SIGN; MOUTH EFFECT SMALL";
  else if (mouthSignControl) classification = "INITIAL-FACTOR-AUDIT B — MOUTH DETERMINES ROUTING SIGN";
  else if (mirrorMostlyNorth && mouthEffectNormalized >= .30) classification = "INITIAL-FACTOR-AUDIT C — RAW TERRAIN KEEPS NORTH SIGN; MOUTH STRONGLY AMPLIFIES";
  else if (!mirrorMostlyNorth && !mouthSignControl) classification = "INITIAL-FACTOR-AUDIT D — MOUTH REDUCES / DELAYS NORTH WITHOUT ROBUST SIGN FLIP";
  else classification = "INITIAL-FACTOR-AUDIT E — SCALE/TIME DEPENDENT";
  return { effectiveFactorial: effectiveFactorial(), exactMargins: { ...causal.lateMargins, meanBedEffect: causal.effects.meanBedEffect, meanMouthEffect: causal.effects.meanMouthEffect, interaction: causal.effects.interaction, mouthEffectNormalized }, directionsByWindow: directions, directionsByRadius: directionsByRadius(), persistence: persistence(), signControl: { mouthSignControl, priorMouthFlip: causal.mouthFlip.value, mirrorRemainsNorth, mirrorMostlyNorth, mirrorMultiscaleNorthWindowCount: mirrorNorthCount }, amplification: { perWindow: perWindowAmplification, meanRelativeEffect, mouthStrongAmplifier }, rawTerrainStaticSignal: staticRawSignal(), wetFrontAndHead: wetAndHead(), classification, interpretation: classification.startsWith("INITIAL-FACTOR-AUDIT D") ? "Production mouth materially increases north margin, but existing evidence does not establish robust routing-sign control. Next evidence should be a more discriminating terrain test, not a production change." : classification.startsWith("INITIAL-FACTOR-AUDIT C") ? "RAW terrain probably determines north sign; production mouth strongly amplifies that bias without creating it." : null };
}

const summary = { purpose: "Read-only audit of initial-routing-factorial summary. No simulation, source, terrain, or production file was executed or changed.", input: "tests/generated/initial-routing-factorial/summary.json", simulationJsUnchanged: true, ...audit(), completedAt: new Date().toISOString() };
fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(output, "COMPLETE"), `classification: ${summary.classification}\ncompletedAt: ${summary.completedAt}\n`);
console.log(summary.classification);
