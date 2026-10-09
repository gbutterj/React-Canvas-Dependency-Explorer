import { GraphBackground } from "../graph/background-client";
import { analyzeGraph } from "../graph/analysis";
import { buildGraphIndex, neighbors, parseGraphDocument, reachable } from "../graph/model";
import type { GraphDocument } from "../graph/types";
import type { ImpactResult } from "../graph/background-protocol";

export async function checkBackground() {
  const assertions: string[] = [];
  function check(condition: unknown, label: string) {
    if (!condition) throw new Error(label);
    assertions.push(label);
  }
  const doc: GraphDocument = {
    schemaVersion: 1, name: "background-check",
    nodes: ["a", "b", "c", "loop", "orphan"].map((id) => ({ id, label: id, kind: "service" })),
    edges: [
      { id: "ab", source: "a", target: "b", kind: "runtime" },
      { id: "ab2", source: "a", target: "b", kind: "build" },
      { id: "bc", source: "b", target: "c", kind: "runtime" },
      { id: "cb", source: "c", target: "b", kind: "runtime" },
      { id: "self", source: "loop", target: "loop", kind: "runtime" },
    ],
    view: { positions: { a: { x: 23, y: 54 } }, pinned: ["a"] },
  };
  const json = JSON.stringify(doc), baseline = buildGraphIndex(parseGraphDocument(doc));
  const client = new GraphBackground();
  const key = `depx.layout.v1:${doc.name}:${doc.nodes.length}:${doc.edges.length}`;
  const saved = localStorage.getItem(key);
  const same = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  try {
    localStorage.removeItem(key);
    const ws = await client.load({ kind: "import", text: new Blob([json]), name: "check.json" }, () => {});
    check(ws.doc.nodes[0] === ws.index.nodes.get("a") && ws.doc.edges[0] === ws.index.edges.get("ab"),
      "Streaming keeps document/index entity identity without duplicate full graph objects");
    check(JSON.stringify(ws.analysis) === JSON.stringify(analyzeGraph(baseline)),
      "SCC grouping, self-loops, parallel edges, weak components and orphans match synchronous analysis");
    check(same(ws.analysis.cycleNodeIds, analyzeGraph(baseline).cycleNodeIds), "Cycle node membership matches synchronous analysis");
    check(ws.gridPlaced === 4 && ws.positions.get("a")!.x === 23 && ws.pinned.has("a"),
      "Supplied positions, grid fallback and pins survive worker preparation");
    check(ws.spatial.nearest(ws.positions.get("a")!, 0.1) === "a", "Streamed viewer spatial index supports exact picking");
    const getImpact = (root: string) => new Promise<ImpactResult>((resolve, reject) => {
      client.impact(root, resolve, (e) => reject(new Error(e)));
    });
    for (const root of doc.nodes.map((n) => n.id)) {
      const result = await getImpact(root);
      check(same(result.dependencies, reachable(baseline, root, "dependencies"))
        && same(result.dependents, reachable(baseline, root, "dependents"))
        && same(result.directDependencies, neighbors(baseline, root, "dependencies").map((n) => n.id))
        && same(result.directDependents, neighbors(baseline, root, "dependents").map((n) => n.id)),
      `Exact source-depends-on-target direct/transitive semantics for ${root}`);
    }
    let stale = false;
    client.impact("a", () => { stale = true; }, () => { stale = true; });
    await getImpact("orphan");
    check(!stale, "New selection suppresses stale impact response");
    const invalid: unknown[] = [
      { ...doc, schemaVersion: 2 }, { ...doc, nodes: [...doc.nodes, doc.nodes[0]] },
      { ...doc, edges: [...doc.edges, doc.edges[0]] },
      { ...doc, edges: [{ ...doc.edges[0], target: "missing" }] },
      { ...doc, nodes: [{ ...doc.nodes[0], kind: "invalid" }] },
      { ...doc, view: { positions: { missing: { x: 0, y: 0 } } } },
      { ...doc, view: { positions: { a: { x: "bad", y: 0 } } } },
      { ...doc, view: { positions: {}, pinned: ["missing"] } },
      { ...doc, edges: [{ ...doc.edges[0], kind: "invalid" }] },
    ];
    for (const raw of invalid) {
      let expected = "", actual = "";
      try { parseGraphDocument(raw); } catch (e) { expected = (e as Error).message; }
      try { await client.load({ kind: "import", text: JSON.stringify(raw), name: "" }, () => {}); }
      catch (e) { actual = (e as Error).message; }
      check(!!expected && actual === expected, `Validation error preserved: ${expected}`);
    }
    let parseError = "";
    try { await client.load({ kind: "import", text: "{", name: "" }, () => {}); }
    catch (e) { parseError = (e as Error).message; }
    check(parseError.startsWith("Not valid JSON:"), "JSON parse errors keep their import prefix");
    check((await getImpact("a")).dependencies.size === 2 && ws.positions.get("a")!.x === 23,
      "Failed import leaves original graph and active analysis worker usable");
    localStorage.setItem(key, JSON.stringify({ positions: { a: { x: 999, y: 111 } }, pinned: ["b"] }));
    const restored = await client.load({ kind: "import", text: json, name: "" }, () => {});
    check(restored.positions.get("a")!.x === 999 && restored.original.get("a")!.x === 23
      && restored.pinned.has("b") && restored.moved.has("a"), "Saved layout applies without replacing supplied originals");
    localStorage.setItem(key, JSON.stringify({ positions: { missing: { x: 0, y: 0 } } }));
    const warned = await client.load({ kind: "import", text: json, name: "" }, () => {});
    check(!!warned.storageWarning && warned.positions.get("a")!.x === 23, "Invalid saved layout warns and uses supplied positions");
    const slow = client.load({ kind: "sample", sample: "scale-50000", density: 20 }, () => {})
      .then(() => "unexpected success", (e: Error) => e.message);
    const latest = await client.load({ kind: "import", text: json, name: "" }, () => {});
    check(await slow === "Loading cancelled." && latest.doc.name === doc.name,
      "Rapid dataset replacement terminates candidate and only commits latest graph");
    const cancelled = client.load({ kind: "sample", sample: "scale-50000", density: 20 }, () => {})
      .then(() => false, () => true);
    client.cancelLoad();
    check(await cancelled && (await getImpact("a")).dependencies.size === 2,
      "Explicit load cancellation retains current analysis worker");
    const duringDelivery = client.load({ kind: "sample", sample: "scale-10000", density: 2 }, (phase) => {
      if (phase === "Sending graph to viewer") client.cancelLoad();
    }).then(() => false, () => true);
    check(await duringDelivery && (await getImpact("a")).dependencies.size === 2,
      "Cancellation during streamed delivery discards partial viewer indexes and retains current graph");
    return { passed: assertions.length, assertions };
  } finally {
    client.dispose();
    if (saved === null) localStorage.removeItem(key); else localStorage.setItem(key, saved);
  }
}
