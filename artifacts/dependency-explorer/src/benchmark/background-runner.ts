import { GraphBackground, type BackgroundWorkspace } from "../graph/background-client";
import { analyzeGraph } from "../graph/analysis";
import { buildGraphIndex, parseGraphDocument } from "../graph/model";
import { createScaleDocument, type ScaleDensity } from "../graph/scale-fixtures";
import { SpatialIndex } from "../graph/spatial";
import type { ImpactResult } from "../graph/background-protocol";

let live: BackgroundWorkspace | null = null;
let client: GraphBackground | null = null;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Full setup only (no renderer/React). Baseline and worker use identical JSON. */
export async function runSetupCase(count: 1000 | 10000 | 50000, degree: ScaleDensity, mode: "sync" | "worker") {
  client?.dispose(); live = null;
  const doc = createScaleDocument(count, degree), json = JSON.stringify(doc);
  // The browser's file input supplies an existing Blob. Creating one from a
  // synthetic JSON string is fixture preparation, not part of file import.
  const inputBlob = new Blob([json]);
  const repetitions: unknown[] = [];
  for (let repetition = 0; repetition < 3; repetition++) {
    client?.dispose(); live = null;
    await pause(50);
    const gaps: number[] = [];
    let previous = performance.now();
    const pulse = setInterval(() => {
      const now = performance.now(); gaps.push(now - previous); previous = now;
    }, 16);
    const tasks: number[] = [];
    const observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) tasks.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
    await pause(20);
    const started = performance.now();
    const phases: Record<string, number> = {};
    const measure = <T>(name: string, fn: () => T) => {
      const t = performance.now(), value = fn(); phases[name] = performance.now() - t; return value;
    };
    let metrics: GraphBackground["metrics"] = null;
    if (mode === "sync") {
      const parsed = measure("Parsing JSON", () => JSON.parse(json) as unknown);
      const normalized = measure("Validating graph", () => parseGraphDocument(parsed));
      const index = measure("Indexing relationships", () => buildGraphIndex(normalized));
      const analysis = measure("Analyzing cycle groups", () => analyzeGraph(index));
      const original = measure("Original positions", () => new Map(Object.entries(normalized.view!.positions).map(([id, p]) => [id, { ...p }])));
      const positions = measure("Viewer positions", () => new Map([...original].map(([id, p]) => [id, { ...p }])));
      const spatial = measure("Spatial index", () => new SpatialIndex(positions));
      live = { doc: normalized, index, analysis, original, positions, spatial,
        pinned: new Set(), moved: new Set(), storageKey: "", gridPlaced: 0, storageWarning: null };
    } else {
      client = new GraphBackground();
      // Blob path matches file import; fixture generation/stringification excluded.
      live = await client.load({ kind: "import", text: inputBlob, name: "benchmark.json" }, () => {});
      metrics = client.metrics;
    }
    const totalMs = performance.now() - started;
    await pause(40); // Let the pulse and long-task observer report the last task.
    clearInterval(pulse); observer.disconnect();
    // Impact timer is separately monitored, not mixed with setup responsiveness.
    const impactStarted = performance.now();
    let impactGap = 0, impactPrevious = performance.now();
    const impactPulse = setInterval(() => {
      const now = performance.now(); impactGap = Math.max(impactGap, now - impactPrevious); impactPrevious = now;
    }, 16);
    let dependencyCount: number, dependentCount: number;
    if (client && mode === "worker") {
      const result = await new Promise<ImpactResult>((resolve, reject) => client!.impact(live!.doc.nodes[count - 1]!.id, resolve, (e) => reject(new Error(e))));
      dependencyCount = result.dependencies.size; dependentCount = result.dependents.size;
    } else {
      const { reachable } = await import("../graph/model");
      dependencyCount = reachable(live!.index, live!.doc.nodes[count - 1]!.id, "dependencies").size;
      dependentCount = reachable(live!.index, live!.doc.nodes[count - 1]!.id, "dependents").size;
    }
    const impactMs = performance.now() - impactStarted;
    await pause(25); clearInterval(impactPulse);
    repetitions.push({ totalMs, maxTimerGapMs: Math.max(...gaps), pulseCount: gaps.length,
      longTasksMs: tasks, phases, metrics, impactMs, impactMaxTimerGapMs: impactGap, dependencyCount, dependentCount });
  }
  return { nodes: count, edges: doc.edges.length, requestedEdgesPerNode: degree, mode, bytesJson: json.length, repetitions };
}
