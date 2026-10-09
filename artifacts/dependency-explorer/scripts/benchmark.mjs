import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { cpus, totalmem, platform, arch } from "node:os";
import path from "node:path";

// No new dependency or workflow required: use Chromium and Node's native CDP
// WebSocket client. The benchmark HTML is developer-only, not a build entry.
const output = path.resolve("generated-artifacts/graph-benchmarks");
await mkdir(output, { recursive: true });
const profile = await import("node:fs/promises").then(fs => fs.mkdtemp("/tmp/dependency-benchmark-"));
const chrome = spawn(process.env.CHROMIUM_BIN || "/repl/tools/bin/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--window-size=1100,850", "--force-device-scale-factor=1",
  "--enable-precise-memory-info", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
chrome.stderr.on("data", b => { stderr = (stderr + b).slice(-8000); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  next = 0;
  pending = new Map();
  targets = new Map();
  async open(url) {
    this.ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        if (message.method === "Target.attachedToTarget") this.targets.set(message.params.sessionId, message.params.targetInfo);
        if (message.method === "Target.detachedFromTarget") this.targets.delete(message.params.sessionId);
        return;
      }
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id); clearTimeout(task.timer);
      if (message.error) task.reject(new Error(JSON.stringify(message.error)));
      else task.resolve(message.result);
    });
    this.ws.addEventListener("close", () => {
      for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error("Chromium connection closed")); }
      this.pending.clear();
    });
    return this;
  }
  send(method, params = {}, timeout = 180000, sessionId) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  close() { this.ws?.close(); }
}
let browser, page;
const results = {
  startedAt: new Date().toISOString(),
  machine: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramGiB: totalmem() / 2 ** 30, platform: platform(), arch: arch() },
  conditions: {
    viewport: "1000×700 CSS px, DPR 1", minimap: "180×120 enabled",
    distribution: "Fixed 68-unit grid; backward chain + seeded random dependencies; a 2-node cycle every 200 nodes",
    icons: "Five built-in vector type icons; no external image downloads",
    modelRepeats: 3, panSamples: 12, zoomSamples: 6, dragSamples: 8,
    scope: "Actual shipped graph model and Canvas renderer, without the React workbench. Dev Vite serves the modules; no forced CPU throttling.",
    timing: "Draw = JavaScript Canvas command submission, not GPU completion. Interaction = request to next rAF callback after draw, not physical input-to-display.",
    memory: "Heap is post-case JS heap including fixture, JSON and repeated model allocations; not total process memory or steady-state viewer memory.",
  },
  cases: [],
};
async function save() {
  results.updatedAt = new Date().toISOString();
  await writeFile(path.join(output, process.env.SETUP_ONLY ? "setup-results.json" : "results.json"), JSON.stringify(results, null, 2));
}
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await sleep(100); }
  }
  if (!port) throw new Error(`Chromium did not start: ${stderr}`);
  const base = `http://127.0.0.1:${port}`;
  const version = await (await fetch(`${base}/json/version`)).json();
  browser = await new CDP().open(version.webSocketDebuggerUrl);
  results.browser = await browser.send("Browser.getVersion");
  results.system = await browser.send("SystemInfo.getInfo");
  const target = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
  page = await new CDP().open(target.webSocketDebuggerUrl);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  if (process.env.SETUP_ONLY) await page.send("Target.setAutoAttach", {
    autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
  });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 850, deviceScaleFactor: 1, mobile: false });
  const url = process.env.BENCHMARK_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/benchmark.html`;
  if (!process.env.BENCHMARK_URL && !process.env.REPLIT_DEV_DOMAIN) throw new Error("No preview domain or BENCHMARK_URL.");
  if (process.env.SETUP_ONLY) {
    delete results.conditions.minimap;
    delete results.conditions.icons;
    delete results.conditions.panSamples;
    delete results.conditions.zoomSamples;
    delete results.conditions.dragSamples;
    results.conditions.scope = "Actual graph background client/worker vs equivalent synchronous import + model + positions + spatial setup. No React panels or Canvas drawing.";
    results.conditions.timing = "Three repetitions; total wall time, 16ms timer gaps and long-task observer during setup. Fixture generation/JSON serialization/Blob construction excluded. Sync consumes prepared JSON text; worker reads prepared file Blob. Impact measured separately.";
    results.conditions.memory = "CDP live JS heaps after requested GC, separately main page and graph worker, with latest viewer retained. Includes dev modules and measurement overhead, not peak allocations or native browser memory. Staged replacement temporarily holds old+new graphs.";
  }
  for (const count of process.env.CHECKS_ONLY || process.env.BACKGROUND_CHECKS_ONLY ? [] : (process.env.COUNTS?.split(",").map(Number) || [1000, 10000, 50000])) {
    for (const degree of (process.env.DEGREES?.split(",").map(Number) || [2, 5, 20])) {
    for (const mode of process.env.SETUP_ONLY ? ["sync", "worker"] : ["renderer"]) {
      await page.send("Page.navigate", { url });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const response = await page.send("Runtime.evaluate", { expression: "!!window.dependencyBenchmark?.ready", returnByValue: true });
        if (response.result.value) { ready = true; break; }
        await sleep(100);
      }
      if (!ready) throw new Error("Benchmark page did not initialize.");
      await page.send("HeapProfiler.collectGarbage");
      console.log(`Running ${count.toLocaleString()} nodes × ~${degree} outgoing edges…`);
      const response = await page.send("Runtime.evaluate", {
        expression: mode === "renderer" ? `window.dependencyBenchmark.runCase(${count},${degree})`
          : `window.dependencyBenchmark.runSetupCase(${count},${degree},${JSON.stringify(mode)})`,
        awaitPromise: true, returnByValue: true,
      });
      if (response.exceptionDetails) {
        results.cases.push({ nodes: count, requestedEdgesPerNode: degree, error: response.exceptionDetails.exception?.description || response.exceptionDetails.text });
      } else {
        const result = response.result.value;
        results.cases.push(result);
        if (mode !== "renderer") {
          await page.send("HeapProfiler.collectGarbage");
          const main = await page.send("Runtime.getHeapUsage");
          const worker = [...page.targets].find(([, target]) => target.type === "worker");
          let workerHeap = null;
          if (worker) {
            const [sessionId] = worker;
            await page.send("HeapProfiler.collectGarbage", {}, 180000, sessionId);
            workerHeap = await page.send("Runtime.getHeapUsage", {}, 180000, sessionId);
          }
          result.liveHeap = { main, worker: workerHeap };
          console.log(JSON.stringify(result));
        } else console.log(JSON.stringify({
          nodes: result.nodes, edges: result.edges,
          overviewDrawMedianMs: result.views.overview.panDrawMs.median,
          overviewRafMedianMs: result.views.overview.panRequestToRafMs.median,
          zoomedDrawMedianMs: result.views.zoomed.panDrawMs.median,
          zoomedRafMedianMs: result.views.zoomed.panRequestToRafMs.median,
        }));
      }
      await save();
    }
    }
  }
  await page.send("Page.navigate", { url });
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await page.send("Runtime.evaluate", { expression: "!!window.dependencyBenchmark?.ready", returnByValue: true });
    if (response.result.value) break;
    await sleep(100);
  }
  const checks = await page.send("Runtime.evaluate", {
    expression: process.env.SETUP_ONLY || process.env.BACKGROUND_CHECKS_ONLY ? "window.dependencyBenchmark.checkBackground()" : "window.dependencyBenchmark.checkRenderer()", awaitPromise: true, returnByValue: true,
  });
  if (checks.exceptionDetails) throw new Error(checks.exceptionDetails.exception?.description || checks.exceptionDetails.text);
  console.log("Regression checks:", JSON.stringify(checks.result.value));
  if (process.env.SETUP_ONLY || process.env.BACKGROUND_CHECKS_ONLY) results.backgroundChecks = checks.result.value;
  else results.rendererChecks = checks.result.value;
  results.finishedAt = new Date().toISOString();
  if (!process.env.CHECKS_ONLY && !process.env.BACKGROUND_CHECKS_ONLY) await save();
  if (!process.env.CHECKS_ONLY && !process.env.BACKGROUND_CHECKS_ONLY)
    console.log(`Results: ${path.relative(process.cwd(), output)}/${process.env.SETUP_ONLY ? "setup-results.json" : "results.json"}`);
} catch (error) {
  console.error("Chromium diagnostic output:", stderr);
  throw error;
} finally {
  page?.close(); browser?.close(); chrome.kill("SIGTERM");
}
