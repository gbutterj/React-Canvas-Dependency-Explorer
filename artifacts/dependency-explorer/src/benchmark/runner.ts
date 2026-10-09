/**
 * Developer-only browser microbenchmark. Imports the actual model and renderer.
 * Instrumentation is instance-local and does not change rendering policy.
 */
import { createStressDocument } from "../graph/fixtures";
import { analyzeGraph } from "../graph/analysis";
import { buildGraphIndex, parseGraphDocument, reachable } from "../graph/model";
import { SpatialIndex } from "../graph/spatial";
import type { GraphDocument, GraphIndex } from "../graph/types";
import { GraphRenderer, type RenderStats, type Scene } from "../lib/renderer";

function dataset(count: number, degree: number): GraphDocument {
  const doc = createStressDocument(count);
  doc.edges = [];
  let seed = 734981;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let i = 1; i < count; i++) {
    const chosen = new Set<number>([i - 1]);
    while (chosen.size < Math.min(degree, i)) chosen.add(random() % i);
    let j = 0;
    for (const target of chosen) {
      doc.edges.push({ id: `e-${i}-${j}`, source: doc.nodes[i]!.id, target: doc.nodes[target]!.id, kind: j++ % 2 ? "build" : "runtime" });
    }
    if (i % 200 === 0) doc.edges.push({ id: `cycle-${i}`, source: doc.nodes[i - 1]!.id, target: doc.nodes[i]!.id, kind: "runtime" });
  }
  return doc;
}

function summary(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
  return { median: percentile(0.5), p95: percentile(0.95), min: s[0], max: s[s.length - 1], samples: samples.length };
}
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function measure<T>(fn: () => T): { ms: number; value: T } {
  const t = performance.now();
  const value = fn();
  return { ms: performance.now() - t, value };
}

async function runCase(count: number, degree: number) {
  const fixture = measure(() => dataset(count, degree));
  let doc: GraphDocument = fixture.value;
  const serialization = measure(() => JSON.stringify(doc));
  const json = serialization.value;
  const phases: Record<string, number[]> = {};
  const add = (name: string, ms: number) => (phases[name] ??= []).push(ms);
  let index!: GraphIndex;
  let analysis!: ReturnType<typeof analyzeGraph>;
  let positions!: Scene["positions"];
  let spatial!: SpatialIndex;
  for (let repetition = 0; repetition < 3; repetition++) {
    await wait(30);
    const decoded = measure(() => JSON.parse(json) as unknown);
    add("jsonParse", decoded.ms);
    const parsed = measure(() => parseGraphDocument(decoded.value));
    add("validate", parsed.ms); doc = parsed.value;
    const indexed = measure(() => buildGraphIndex(doc));
    add("index", indexed.ms); index = indexed.value;
    const analyzed = measure(() => analyzeGraph(index));
    add("analysis", analyzed.ms); analysis = analyzed.value;
    const located = measure(() => new Map(Object.entries(doc.view!.positions).map(([id, p]) => [id, { ...p }])));
    add("positions", located.ms); positions = located.value;
    const partitioned = measure(() => new SpatialIndex(positions));
    add("spatial", partitioned.ms); spatial = partitioned.value;
    add("dependencies", measure(() => reachable(index, doc.nodes[count - 1]!.id, "dependencies")).ms);
    add("dependents", measure(() => reachable(index, doc.nodes[0]!.id, "dependents")).ms);
  }
  const canvas = document.getElementById("graph") as HTMLCanvasElement;
  const mini = document.getElementById("minimap") as HTMLCanvasElement;
  let stats: RenderStats | null = null;
  let submitted: number[] = [];
  let submitTimes: number[] = [];
  let profiles: Record<string, number[]> = {};
  let frameProfile: Record<string, number> = {};
  let inEdges = false;
  const renderer = new GraphRenderer(canvas, {
    onHover: () => {}, onSelect: () => {}, onActivate: () => {},
    onDragEnd: () => {}, onStats: (s) => { stats = s; },
  });
  // TS private methods remain ordinary methods at runtime. Instrument only the
  // benchmark's instance so the renderer source stays exactly as shipped.
  const instrumented = renderer as unknown as { draw(): void; edges(...args: unknown[]): void; drawMinimap(): void };
  for (const method of ["edges", "drawMinimap"] as const) {
    const original = instrumented[method].bind(renderer);
    instrumented[method] = (...args: unknown[]) => {
      const t = performance.now();
      inEdges = method === "edges";
      const result = original(...args);
      inEdges = false;
      frameProfile[method] = (frameProfile[method] ?? 0) + performance.now() - t;
      return result;
    };
  }
  // stroke/fill submission is timed separately within the edge pass. Deferred
  // raster/compositing remains in the request-to-rAF metric, not these timers.
  const context = canvas.getContext("2d")!;
  for (const method of ["stroke", "fill"] as const) {
    const original = context[method].bind(context);
    (context as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      const t = performance.now();
      (original as (...args: unknown[]) => void)(...args);
      if (inEdges) frameProfile.canvasSubmit = (frameProfile.canvasSubmit ?? 0) + performance.now() - t;
    };
  }
  const actualDraw = instrumented.draw.bind(renderer);
  instrumented.draw = () => {
    const t = performance.now();
    frameProfile = {};
    actualDraw();
    submitted.push(performance.now() - t);
    submitTimes.push(performance.now());
    for (const [name, ms] of Object.entries(frameProfile)) (profiles[name] ??= []).push(ms);
  };
  const scene: Scene = {
    index, positions, spatial, visible: null, matches: null, highlight: null,
    transitive: false, selected: null, cycleIds: analysis.cycleNodeIds, pinned: new Set(),
  };
  renderer.resize();
  renderer.minimap = mini;
  renderer.setScene(scene);
  renderer.fit(null, false);
  await nextFrame();
  const views: Record<string, unknown> = {};
  try {
    for (const view of ["overview", "zoomed"] as const) {
      if (view === "zoomed") renderer.centerOn(positions.get(doc.nodes[Math.floor(count / 2)]!.id)!, 1, false);
      for (let warmup = 0; warmup < 2; warmup++) { renderer.panBy(0.5, 0); await nextFrame(); }
      submitted = []; submitTimes = []; profiles = {};
      const panLatency: number[] = [];
      for (let step = 0; step < 12; step++) {
        const t = performance.now();
        renderer.panBy(step % 2 ? -2 : 2, 0);
        await nextFrame();
        panLatency.push(performance.now() - t);
      }
      const panDraw = summary(submitted);
      const panProfile = Object.fromEntries(Object.entries(profiles).map(([name, samples]) => [name, summary(samples)]));
      const panIntervals = summary(submitTimes.slice(1).map((t, i) => t - submitTimes[i]!));
      const zoomLatency: number[] = [];
      for (let step = 0; step < 6; step++) {
        const t = performance.now();
        renderer.zoomCenter(step % 2 ? 1 / 1.02 : 1.02);
        await nextFrame();
        zoomLatency.push(performance.now() - t);
      }
      // Actual renderer pointer handlers, excluding OS event delivery and React UI.
      const root = positions.get(doc.nodes[Math.floor(count / 2)]!.id)!;
      const sx = root.x * renderer.cam.k + renderer.cam.x;
      const sy = root.y * renderer.cam.k + renderer.cam.y;
      const pickBatch = measure(() => {
        for (let i = 0; i < 1000; i++) {
          canvas.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", clientX: sx + i % 3, clientY: sy, bubbles: true }));
        }
      }).ms;
      const dragLatency: number[] = [];
      // Dispatch uses the same handlers as the viewer. Suppress only pointer
      // capture: synthetic events do not create a real browser pointer stream.
      const capture = canvas.setPointerCapture.bind(canvas);
      canvas.setPointerCapture = () => {};
      canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, pointerType: "mouse", clientX: sx, clientY: sy, buttons: 1 }));
      for (let step = 0; step < 8; step++) {
        const t = performance.now();
        canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, pointerType: "mouse", clientX: sx + 10 + step * 2, clientY: sy + step, buttons: 1 }));
        await nextFrame();
        dragLatency.push(performance.now() - t);
      }
      canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, pointerType: "mouse", clientX: sx + 24, clientY: sy + 7 }));
      canvas.setPointerCapture = capture;
      // No saved layouts are read or written; each case uses a fresh scene.
      views[view] = {
        zoom: renderer.cam.k, stats, panDrawMs: panDraw, panFrameIntervalMs: panIntervals, panProfile,
        panRequestToRafMs: summary(panLatency), zoomRequestToRafMs: summary(zoomLatency),
        dragRequestToRafMs: summary(dragLatency), pointerHandlerMeanMs: pickBatch / 1000,
      };
    }
  } finally { renderer.dispose(); }
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return {
    nodes: count, requestedEdgesPerNode: degree, edges: doc.edges.length,
    bytesJson: json.length, fixtureMs: fixture.ms, serializationMs: serialization.ms,
    phases: Object.fromEntries(Object.entries(phases).map(([name, values]) => [name, summary(values)])),
    views, heapMiB: memory ? memory.usedJSHeapSize / 1048576 : null,
    cyclicGroups: analysis.cycles.length, viewport: { width: canvas.clientWidth, height: canvas.clientHeight, dpr: devicePixelRatio },
  };
}

declare global {
  interface Window { dependencyBenchmark: { runCase: typeof runCase; checkRenderer(): Promise<unknown>; ready: boolean } }
}
window.dependencyBenchmark = {
  runCase, ready: true,
  checkRenderer: async () => (await import("./renderer-checks")).checkRenderer(),
};
