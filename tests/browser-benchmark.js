/*
 * Repeats full-browser measurements with a warm-up period so visual changes
 * are assessed from distributions rather than one transient headless sample.
 * Usage: node tests/browser-benchmark.js [--warmup-ms 7000] [--duration-ms 15000] [--runs 5]
 */
const http = require("http");

const options = {
  port: 9225,
  warmupMs: 7000,
  durationMs: 15000,
  runs: 5,
};

for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = Number.parseInt(process.argv[index + 1], 10);
  if (!Number.isFinite(value)) throw new Error(`Invalid value for ${option}`);
  if (option === "--port") options.port = value;
  else if (option === "--warmup-ms") options.warmupMs = value;
  else if (option === "--duration-ms") options.durationMs = value;
  else if (option === "--runs") options.runs = value;
  else throw new Error(`Unknown option: ${option}`);
}

const configurations = [
  { name: "all layers", layers: { relief: true, contours: true, eau: true, reseau: true, erosion: true, particules: true } },
  { name: "no particles", layers: { relief: true, contours: true, eau: true, reseau: true, erosion: true, particules: false } },
  { name: "no active network", layers: { relief: true, contours: true, eau: true, reseau: false, erosion: true, particules: true } },
  { name: "minimal rendering", layers: { relief: false, contours: false, eau: false, reseau: false, erosion: false, particules: false } },
];

function requestJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: options.port, path }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

function percentile(values, fraction) {
  return values[Math.floor((values.length - 1) * fraction)];
}

function summary(values) {
  const sorted = [...values].sort((first, second) => first - second);
  return {
    min: sorted[0],
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    max: sorted.at(-1),
  };
}

async function createSession() {
  const pages = await requestJson("/json");
  const page = pages.find(({ type, url }) => type === "page" && url.startsWith("file:"));
  if (!page) throw new Error("No file:// page found. Launch Chrome with --remote-debugging-port first.");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const messages = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const listener = messages.get(message.id);
    if (!listener) return;
    messages.delete(message.id);
    if (message.error) listener.reject(new Error(message.error.message));
    else listener.resolve(message.result);
  });

  return {
    async evaluate(expression) {
      const id = ++sequence;
      const response = new Promise((resolve, reject) => messages.set(id, { resolve, reject }));
      socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
      const result = await response;
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    },
    close() { socket.close(); },
  };
}

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

async function measure(session, layers) {
  const setup = JSON.stringify(layers);
  await session.evaluate(`
    (() => {
      Object.assign(layerOn, ${setup});
      viewMode = "composite";
      paused = false;
      speedEl.value = String(SPEED_STEPS.length - 1);
      speedEl.oninput();
      window.__erosionBrowserBenchmark = { frames: 0, startedAt: performance.now() };
      const counter = window.__erosionBrowserBenchmark;
      const countFrame = () => {
        if (window.__erosionBrowserBenchmark === counter) {
          counter.frames += 1;
          requestAnimationFrame(countFrame);
        }
      };
      requestAnimationFrame(countFrame);
    })();
  `);
  await sleep(options.warmupMs);
  const start = await session.evaluate(`({ steps, frames: window.__erosionBrowserBenchmark.frames, now: performance.now() })`);
  await sleep(options.durationMs);
  const end = await session.evaluate(`({ steps, frames: window.__erosionBrowserBenchmark.frames, now: performance.now() })`);
  const elapsedSeconds = (end.now - start.now) / 1000;
  return {
    fps: (end.frames - start.frames) / elapsedSeconds,
    stepsPerSecond: (end.steps - start.steps) / elapsedSeconds,
  };
}

(async () => {
  const session = await createSession();
  try {
    console.log(`Chrome headless benchmark: ${options.runs} runs, ${options.warmupMs}ms warm-up, ${options.durationMs}ms measurement.`);
    for (const configuration of configurations) {
      const samples = [];
      for (let run = 0; run < options.runs; run++) {
        const result = await measure(session, configuration.layers);
        samples.push(result);
        console.log(`${configuration.name} run ${run + 1}/${options.runs}: ${result.fps.toFixed(2)} FPS, ${result.stepsPerSecond.toFixed(1)} steps/s`);
      }
      const fps = summary(samples.map(({ fps: value }) => value));
      const steps = summary(samples.map(({ stepsPerSecond }) => stepsPerSecond));
      console.table({
        configuration: configuration.name,
        fpsMin: fps.min.toFixed(2), fpsP25: fps.p25.toFixed(2), fpsMedian: fps.median.toFixed(2), fpsP75: fps.p75.toFixed(2), fpsMax: fps.max.toFixed(2),
        stepsMin: steps.min.toFixed(1), stepsP25: steps.p25.toFixed(1), stepsMedian: steps.median.toFixed(1), stepsP75: steps.p75.toFixed(1), stepsMax: steps.max.toFixed(1),
      });
    }
  } finally {
    session.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
