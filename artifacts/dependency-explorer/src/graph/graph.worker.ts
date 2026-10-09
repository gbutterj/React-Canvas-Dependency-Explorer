import { analyzeGraph } from "./analysis";
import { buildGraphIndex, parseGraphDocument, parseGraphView } from "./model";
import { createDemoDocument } from "./fixtures";
import { createScaleDocument } from "./scale-fixtures";
import { compactGraph, compactNeighbors, compactReachable, type CompactGraph } from "./compact";
import type { PreparedGraph, WorkerRequest, WorkerResponse } from "./background-protocol";
import type { GraphDocument } from "./types";

const port = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};
const send = (message: WorkerResponse) => port.postMessage(message);
const error = (e: unknown) => e instanceof Error ? e.message : String(e);
let prepared: PreparedGraph | null = null;
let compact: CompactGraph | null = null;
let latest = 0;
let resumeSending: (() => void) | null = null;
let timings: Record<string, number> = {};
function phase<T>(name: string, fn: () => T): T {
  send({ type: "progress", phase: name });
  const start = performance.now();
  const result = fn();
  timings[name] = performance.now() - start;
  return result;
}

port.onmessage = async ({ data }) => {
  try {
    if (data.type === "continue") {
      const resume = resumeSending;
      resumeSending = null;
      resume?.();
      return;
    }
    if (data.type === "load") {
      const input = data.input;
      timings = {};
      let doc: GraphDocument;
      if (input.kind === "import") {
        send({ type: "progress", phase: "Reading import" });
        const text = typeof input.text === "string" ? input.text : await input.text.text();
        let raw: unknown;
        try { raw = phase("Parsing JSON", () => JSON.parse(text)); }
        catch (e) { throw new Error(`Not valid JSON: ${error(e)}`); }
        doc = phase("Validating graph", () => parseGraphDocument(raw));
      } else {
        doc = phase("Generating synthetic dataset", () => input.sample === "demo"
          ? createDemoDocument()
          : createScaleDocument(input.sample === "scale-1000" ? 1000 : input.sample === "scale-50000" ? 50000 : 10000, input.density));
      }
      const index = phase("Indexing relationships", () => buildGraphIndex(doc));
      const analysis = phase("Analyzing cycle groups", () => analyzeGraph(index));
      compact = phase("Preparing background traversal", () => compactGraph(index));
      const original = new Map<string, { x: number; y: number }>();
      const cols = Math.max(1, Math.ceil(Math.sqrt(doc.nodes.length)));
      let gridPlaced = 0;
      phase("Preparing positions", () => doc.nodes.forEach((node, i) => {
        const p = doc.view?.positions[node.id];
        original.set(node.id, p ? { ...p } : { x: (i % cols) * 120, y: Math.floor(i / cols) * 120 });
        if (!p) gridPlaced++;
      }));
      prepared = {
        doc, index, analysis, original, positions: new Map([...original].map(([id, p]) => [id, { ...p }])),
        pinned: new Set(doc.view?.pinned ?? []), moved: new Set(), gridPlaced,
        storageKey: `depx.layout.v1:${doc.name}:${doc.nodes.length}:${doc.edges.length}`, storageWarning: null,
      };
      send({ type: "storage", key: prepared.storageKey });
    } else if (data.type === "layout" && prepared && compact) {
      const graph = prepared;
      graph.storageWarning = data.warning;
      if (data.raw) {
        try {
          const view = phase("Validating saved layout", () => parseGraphView(JSON.parse(data.raw!), graph.index.nodes));
          for (const [id, p] of Object.entries(view.positions)) {
            graph.positions.set(id, p);
            graph.moved.add(id);
          }
          if (view.pinned) graph.pinned = new Set(view.pinned);
        } catch (e) {
          graph.storageWarning = `Saved layout could not be read, using supplied positions. (${error(e)})`;
        }
      }
      send({ type: "progress", phase: "Sending graph to viewer" });
      const sending = performance.now();
      const sendBatch = (message: WorkerResponse) => {
        // Wait for viewer acknowledgement: bounded messages alone can still
        // flood its event queue and retain hundreds of cloned batches.
        const continued = new Promise<void>((resolve) => { resumeSending = resolve; });
        send(message);
        return continued;
      };
      // Bounded messages avoid a giant main-thread structured-clone task.
      // The viewer incrementally indexes the same cloned entity objects: no
      // duplicate full adjacency payload, no second worker-owned object graph.
      for (let at = 0; at < graph.doc.nodes.length; at += 512) {
        const nodes = graph.doc.nodes.slice(at, at + 512);
        await sendBatch({
          type: "nodes", nodes,
          original: nodes.map((n) => graph.original.get(n.id)!),
          positions: nodes.map((n) => graph.positions.get(n.id)!),
          supplied: nodes.map((n) => graph.doc.view?.positions[n.id] ?? null),
          pinned: nodes.map((n) => graph.pinned.has(n.id)),
          moved: nodes.map((n) => graph.moved.has(n.id)),
        });
      }
      for (let at = 0; at < graph.doc.edges.length; at += 2048) {
        await sendBatch({ type: "edges", edges: graph.doc.edges.slice(at, at + 2048) });
      }
      timings["Sending graph to viewer"] = performance.now() - sending;
      send({
        type: "ready",
        metadata: { schemaVersion: 1, name: graph.doc.name, description: graph.doc.description },
        hasView: !!graph.doc.view, viewPinned: graph.doc.view?.pinned,
        analysis: graph.analysis, storageKey: graph.storageKey,
        gridPlaced: graph.gridPlaced, storageWarning: graph.storageWarning, timings,
        adjacencyBytes: compact.outgoing.byteLength + compact.incoming.byteLength
          + compact.outgoingOffsets.byteLength + compact.incomingOffsets.byteLength,
      });
      prepared = null;
    } else if (data.type === "impact") {
      latest = data.request;
      if (!data.root || !compact) return;
      const graph = compact, root = data.root, request = data.request;
      const cancelled = () => latest !== request;
      const dependencies = await compactReachable(graph, root, false, Infinity, cancelled);
      if (!dependencies) return;
      const dependents = await compactReachable(graph, root, true, Infinity, cancelled);
      if (!dependents) return;
      const directDependencies = compactNeighbors(graph, root, false);
      const directDependents = compactNeighbors(graph, root, true);
      if (cancelled()) return;
      send({ type: "impact", request, result: { root, dependencies, dependents, directDependencies, directDependents } });
    }
  } catch (e) {
    send({ type: "error", message: error(e), request: data.type === "impact" ? data.request : undefined });
  }
};
