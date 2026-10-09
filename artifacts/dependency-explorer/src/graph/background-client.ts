import { SpatialIndex } from "./spatial";
import type { ImpactResult, LoadInput, PreparedGraph, WorkerRequest, WorkerResponse } from "./background-protocol";
import type { DependencyEdge, DependencyNode, Point } from "./types";

export type BackgroundWorkspace = PreparedGraph & { spatial: SpatialIndex };
export const makeGraphWorker = () => new Worker(new URL("./graph.worker.ts", import.meta.url), { type: "module" });

/** Staged transaction: the old worker/graph remains live until preparation succeeds. */
export class GraphBackground {
  metrics: { workerPhases: Record<string, number>; adjacencyBytes: number; viewerBatchMs: number; maxViewerBatchMs: number; totalMs: number } | null = null;
  private active: Worker | null = null;
  private candidate: Worker | null = null;
  private generation = 0;
  private query = 0;
  private rejectLoad: ((e: Error) => void) | null = null;
  private impactFailure: ((message: string) => void) | null = null;
  private activeError: string | null = null;

  cancelLoad() {
    this.generation++;
    this.candidate?.terminate();
    this.candidate = null;
    this.rejectLoad?.(new Error("Loading cancelled."));
    this.rejectLoad = null;
  }
  dispose() {
    this.cancelLoad();
    this.query++;
    this.active?.terminate();
    this.active = null;
  }
  async load(input: LoadInput, progress: (phase: string) => void): Promise<BackgroundWorkspace> {
    this.cancelLoad();
    const generation = this.generation;
    const started = performance.now();
    const worker = makeGraphWorker();
    this.candidate = worker;
    const current = () => this.generation === generation;
    const nodes = new Map<string, DependencyNode>();
    const edges = new Map<string, DependencyEdge>();
    const outgoing = new Map<string, string[]>(), incoming = new Map<string, string[]>();
    const docNodes: DependencyNode[] = [], docEdges: DependencyEdge[] = [];
    const original = new Map<string, Point>(), positions = new Map<string, Point>();
    const supplied: Record<string, Point> = Object.create(null);
    const pinned = new Set<string>(), moved = new Set<string>();
    const spatial = new SpatialIndex(new Map());
    let viewerBatchMs = 0, maxViewerBatchMs = 0;
    this.metrics = null;
    try {
      const graph = await new Promise<PreparedGraph>((resolve, reject) => {
        this.rejectLoad = reject;
        worker.onerror = (event) => reject(new Error(`Background graph processing failed: ${event.message || "Worker could not start."}`));
        worker.onmessageerror = () => reject(new Error("Could not receive the background graph."));
        worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
          if (!current()) return;
          try {
          if (data.type === "nodes" || data.type === "edges") {
            const start = performance.now();
            if (data.type === "nodes") {
              data.nodes.forEach((raw, i) => {
                // Reconstruct stable-shape entities instead of retaining the
                // structured-clone receiver's property storage for every item.
                const node: DependencyNode = {
                  id: raw.id, label: raw.label, kind: raw.kind, description: raw.description,
                  owner: raw.owner, version: raw.version, icon: raw.icon, tags: raw.tags,
                };
                nodes.set(node.id, node); docNodes.push(node);
                outgoing.set(node.id, []); incoming.set(node.id, []);
                original.set(node.id, data.original[i]!);
                positions.set(node.id, data.positions[i]!);
                spatial.update(node.id, data.positions[i]!);
                if (data.supplied[i]) supplied[node.id] = data.supplied[i]!;
                if (data.pinned[i]) pinned.add(node.id);
                if (data.moved[i]) moved.add(node.id);
              });
            } else {
              for (const raw of data.edges) {
                // Reuse canonical node ID strings across independently cloned batches.
                const edge: DependencyEdge = {
                  id: raw.id, source: nodes.get(raw.source)!.id, target: nodes.get(raw.target)!.id,
                  kind: raw.kind, label: raw.label,
                };
                edges.set(edge.id, edge); docEdges.push(edge);
                outgoing.get(edge.source)!.push(edge.id); incoming.get(edge.target)!.push(edge.id);
              }
            }
            const elapsed = performance.now() - start;
            viewerBatchMs += elapsed; maxViewerBatchMs = Math.max(maxViewerBatchMs, elapsed);
            // A fresh task gives input/paint/timers a chance before the next
            // batch. Only this acknowledgement releases the worker producer.
            setTimeout(() => {
              if (current()) worker.postMessage({ type: "continue" } satisfies WorkerRequest);
            }, 0);
          } else if (data.type === "progress") progress(data.phase);
          else if (data.type === "error") reject(new Error(data.message));
          else if (data.type === "storage") {
            let raw: string | null = null, warning: string | null = null;
            try { raw = window.localStorage.getItem(data.key); }
            catch (e) { warning = `Saved layout could not be read, using supplied positions. (${e instanceof Error ? e.message : String(e)})`; }
            worker.postMessage({ type: "layout", raw, warning } satisfies WorkerRequest);
          } else if (data.type === "ready") {
            this.metrics = {
              workerPhases: data.timings, adjacencyBytes: data.adjacencyBytes, viewerBatchMs, maxViewerBatchMs,
              totalMs: performance.now() - started,
            };
            resolve({
              doc: { ...data.metadata, nodes: docNodes, edges: docEdges,
                view: data.hasView ? { positions: supplied, pinned: data.viewPinned } : undefined },
              index: { nodes, edges, outgoing, incoming }, analysis: data.analysis,
              original, positions, pinned, moved, storageKey: data.storageKey,
              gridPlaced: data.gridPlaced, storageWarning: data.storageWarning,
            });
          }
          } catch (e) { reject(e); }
        };
        worker.postMessage({ type: "load", input } satisfies WorkerRequest);
      });
      if (!current()) throw new Error("Loading cancelled.");
      this.active?.terminate();
      this.query++;
      this.active = worker;
      this.impactFailure = null;
      this.activeError = null;
      this.candidate = null;
      this.rejectLoad = null;
      worker.onmessage = null;
      this.listenForFailure(worker);
      return { ...graph, spatial };
    } catch (e) {
      worker.terminate();
      if (current()) { this.candidate = null; this.rejectLoad = null; }
      throw e;
    }
  }
  private listenForFailure(worker: Worker) {
    // Separate closure scope: do not retain the load input and staged maps.
    const fail = (message: string) => {
      if (worker !== this.active) return;
      this.activeError = message;
      this.impactFailure?.(message);
    };
    worker.onerror = (event) => fail(`Background impact processing failed: ${event.message || "Worker stopped."}`);
    worker.onmessageerror = () => fail("Could not receive background impact results.");
  }
  impact(root: string | null, done: (result: ImpactResult) => void, failed: (message: string) => void) {
    const worker = this.active;
    const request = ++this.query;
    this.impactFailure = failed;
    if (!worker) { if (root) failed("Background graph is unavailable; reload the dataset."); return () => {}; }
    if (this.activeError) { if (root) failed(this.activeError); return () => {}; }
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (worker !== this.active || request !== this.query) return;
      if (data.type === "impact" && data.request === request) done(data.result);
      if (data.type === "error" && data.request === request) failed(data.message);
    };
    worker.postMessage({ type: "impact", request, root } satisfies WorkerRequest);
    return () => {
      if (request !== this.query) return;
      worker.postMessage({ type: "impact", request: ++this.query, root: null } satisfies WorkerRequest);
      this.impactFailure = null;
    };
  }
}
