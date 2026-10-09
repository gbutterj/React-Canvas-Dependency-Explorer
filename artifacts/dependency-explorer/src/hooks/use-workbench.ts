import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { analyzeGraph } from "@/graph/analysis";
import { createDemoDocument } from "@/graph/fixtures";
import { createScaleDocument, sampleFromUrl, type SampleKind, type ScaleDensity } from "@/graph/scale-fixtures";
import { buildGraphIndex, neighborhood, parseGraphDocument, reachable } from "@/graph/model";
import { SpatialIndex } from "@/graph/spatial";
import type { GraphAnalysis, GraphDocument, GraphIndex, NodeKind, Point } from "@/graph/types";
import type { Role, Scene } from "@/lib/renderer";

export type Mode = "both" | "dependencies" | "dependents";
export interface Focus { root: string; depth: number }
export interface Source { kind: "demo" | "stress" | "import"; label: string; sample?: SampleKind; density?: ScaleDensity }
export interface Notice { id: number; tone: "ok" | "error" | "info"; text: string }

export interface Workspace {
  doc: GraphDocument;
  index: GraphIndex;
  analysis: GraphAnalysis;
  positions: Map<string, Point>;
  original: Map<string, Point>;
  spatial: SpatialIndex;
  pinned: Set<string>;
  moved: Set<string>;
  storageKey: string;
  gridPlaced: number;
  storageWarning: string | null;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function buildWorkspace(doc: GraphDocument): Workspace {
  const index = buildGraphIndex(doc);
  const analysis = analyzeGraph(index);
  const supplied = doc.view?.positions ?? {};
  const cols = Math.max(1, Math.ceil(Math.sqrt(doc.nodes.length)));
  const original = new Map<string, Point>();
  let gridPlaced = 0;
  doc.nodes.forEach((n, i) => {
    const p = supplied[n.id];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) original.set(n.id, { x: p.x, y: p.y });
    else {
      original.set(n.id, { x: (i % cols) * 120, y: Math.floor(i / cols) * 120 });
      gridPlaced++;
    }
  });
  const positions = new Map<string, Point>();
  original.forEach((p, id) => positions.set(id, { ...p }));
  const pinned = new Set((doc.view?.pinned ?? []).filter((id) => index.nodes.has(id)));
  const moved = new Set<string>();
  const storageKey = `depx.layout.v1:${doc.name}:${doc.nodes.length}:${doc.edges.length}`;
  let storageWarning: string | null = null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
       const s = parseGraphDocument({ ...doc, view: JSON.parse(raw) }).view!;
       for (const [id, p] of Object.entries(s.positions)) {
         positions.set(id, { x: p.x, y: p.y });
         moved.add(id);
       }
       if (s.pinned) {
         pinned.clear();
         for (const id of s.pinned) pinned.add(id);
       }
    }
  } catch (e) {
    storageWarning = `Saved layout could not be read, using supplied positions. (${msg(e)})`;
  }
  return { doc, index, analysis, positions, original, spatial: new SpatialIndex(positions), pinned, moved, storageKey, gridPlaced, storageWarning };
}

type Loaded = { doc: GraphDocument | null; source: Source; error: string | null };
function load(sample: SampleKind, density: ScaleDensity = 2): Loaded {
  const kind = sample === "demo" ? "demo" : "stress";
  try {
    if (kind === "demo") return { doc: createDemoDocument(), source: { kind, sample, label: "Demo dataset (synthetic)" }, error: null };
    const count = sample === "scale-1000" ? 1000 : sample === "scale-50000" ? 50000 : 10000;
    return { doc: createScaleDocument(count, density), source: { kind, sample, density, label: `${count.toLocaleString()} synthetic nodes` }, error: null };
  } catch (e) {
    return { doc: null, source: { kind, label: "Dataset" }, error: msg(e) };
  }
}

export function useWorkbench() {
  const [loaded, setLoaded] = useState<Loaded>(() => {
    const sample = sampleFromUrl();
    return load(sample.kind, sample.density);
  });
  const [loading, setLoading] = useState(false);
   const [selected, setSelected] = useState<string | null>(() => sampleFromUrl().kind === "demo" ? "checkout-api" : null);
  const [query, setQuery] = useState("");
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<NodeKind>>(new Set());
  const [cyclesOnly, setCyclesOnly] = useState(false);
  const [mode, setMode] = useState<Mode>("both");
   const [transitive, setTransitive] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [rev, setRev] = useState(0);
  const [fitTick, setFitTick] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef(0);
  const deferredQuery = useDeferredValue(query);

  const built = useMemo<{ ws: Workspace | null; error: string | null }>(() => {
    if (!loaded.doc) return { ws: null, error: loaded.error };
    try {
      return { ws: buildWorkspace(loaded.doc), error: null };
    } catch (e) {
      return { ws: null, error: msg(e) };
    }
  }, [loaded]);
  const ws = built.ws;

  const notify = useCallback((tone: Notice["tone"], text: string) => {
    clearTimeout(noticeTimer.current);
    setNotice({ id: Date.now(), tone, text });
    if (tone !== "error") noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
  }, []);

  const resetView = useCallback(() => {
    setSelected(null); setQuery(""); setHiddenKinds(new Set()); setCyclesOnly(false);
    setFocus(null); setDirty(false); setPersistError(null);
  }, []);

  const loadDoc = useCallback((doc: GraphDocument, source: Source) => {
    resetView();
    setLoaded({ doc, source, error: null });
    setFitTick((t) => t + 1);
  }, [resetView]);

  const loadSample = useCallback((kind: SampleKind, density: ScaleDensity = loaded.source.density ?? 2) => {
    setLoading(true);
    window.setTimeout(() => {
      const r = load(kind, density);
      resetView();
      setLoaded(r);
      setLoading(false);
      setFitTick((t) => t + 1);
      if (r.error) notify("error", r.error);
    }, 30);
  }, [resetView, notify, loaded.source.density]);

  const importText = useCallback((text: string, name: string): string | null => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return `Not valid JSON: ${msg(e)}`;
    }
    try {
      const doc = parseGraphDocument(raw);
      loadDoc(doc, { kind: "import", label: `Imported: ${name || doc.name}` });
      notify("ok", `Imported ${doc.nodes.length.toLocaleString()} nodes and ${doc.edges.length.toLocaleString()} edges.`);
      return null;
    } catch (e) {
      return msg(e);
    }
  }, [loadDoc, notify]);

  const matches = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!ws || !q) return null;
    const out = new Set<string>();
    for (const n of ws.doc.nodes) {
      if (n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q) || n.owner?.toLowerCase().includes(q) || n.tags?.some((t) => t.toLowerCase().includes(q)))
        out.add(n.id);
    }
    return out;
  }, [ws, deferredQuery]);

  const visible = useMemo(() => {
    if (!ws) return null;
    const base = focus && ws.index.nodes.has(focus.root) ? neighborhood(ws.index, focus.root, mode === "both" ? "both" : mode, focus.depth) : null;
    if (!base && hiddenKinds.size === 0 && !cyclesOnly) return null;
    const out = new Set<string>();
    for (const id of base ?? ws.index.nodes.keys()) {
      const n = ws.index.nodes.get(id);
      if (!n || hiddenKinds.has(n.kind)) continue;
      if (cyclesOnly && !ws.analysis.cycleNodeIds.has(id)) continue;
      out.add(id);
    }
    return out;
  }, [ws, focus, mode, hiddenKinds, cyclesOnly]);

  const highlight = useMemo(() => {
    if (!ws || !selected || !ws.index.nodes.has(selected)) return null;
    const depth = transitive ? undefined : 1;
    const m = new Map<string, Role>();
    if (mode !== "dependents") for (const id of reachable(ws.index, selected, "dependencies", depth)) m.set(id, "dependency");
    if (mode !== "dependencies") for (const id of reachable(ws.index, selected, "dependents", depth)) m.set(id, m.has(id) ? "both" : "dependent");
    m.set(selected, "root");
    return m;
  }, [ws, selected, mode, transitive]);

  const scene = useMemo<Scene | null>(() => {
    if (!ws) return null;
    void rev;
    return {
      index: ws.index, positions: ws.positions, spatial: ws.spatial, visible, matches, highlight, transitive,
      selected: selected && ws.index.nodes.has(selected) ? selected : null,
      cycleIds: ws.analysis.cycleNodeIds, pinned: ws.pinned,
    };
  }, [ws, visible, matches, highlight, transitive, selected, rev]);

  const listNodes = useMemo(() => {
    if (!ws) return [];
    const q = deferredQuery.trim();
    return ws.doc.nodes
      .filter((n) => !hiddenKinds.has(n.kind) && (!q || matches?.has(n.id)) && (!cyclesOnly || ws.analysis.cycleNodeIds.has(n.id)))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [ws, deferredQuery, matches, hiddenKinds, cyclesOnly]);

  const requestFit = () => setFitTick((t) => t + 1);
  const toggleKind = (k: NodeKind) =>
    setHiddenKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
   const focusNode = (id: string) => { setSelected(id); setFocus({ root: id, depth: 1 }); requestFit(); };
   const focusSelected = () => { if (selected) focusNode(selected); };
  const expandFocus = () => { setFocus((f) => (f ? { ...f, depth: f.depth + 1 } : f)); requestFit(); };
  const resetFocus = () => { setFocus(null); setSelected(null); setQuery(""); setHiddenKinds(new Set()); setCyclesOnly(false); requestFit(); };

  const onDragEnd = (id: string) => { if (ws) { ws.moved.add(id); setDirty(true); setRev((r) => r + 1); } };
  const togglePin = (id: string) => {
    if (!ws) return;
    if (!ws.pinned.delete(id)) ws.pinned.add(id);
    setDirty(true);
    setRev((r) => r + 1);
  };

  const saveLayout = () => {
    if (!ws) return;
    try {
       const positions: Record<string, Point> = Object.create(null);
      for (const id of ws.moved) { const p = ws.positions.get(id); if (p) positions[id] = p; }
      window.localStorage.setItem(ws.storageKey, JSON.stringify({ v: 1, positions, pinned: [...ws.pinned], savedAt: new Date().toISOString() }));
      setDirty(false);
      setPersistError(null);
      notify("ok", `Saved ${ws.moved.size} moved node position${ws.moved.size === 1 ? "" : "s"} and ${ws.pinned.size} pin${ws.pinned.size === 1 ? "" : "s"} in this browser.`);
    } catch (e) {
      const t = `Layout was NOT saved: ${msg(e)}. Storage may be full or disabled; export JSON to keep your layout.`;
      setPersistError(t);
      notify("error", t);
    }
  };

  const restoreSupplied = () => {
    if (!ws) return;
    ws.original.forEach((p, id) => { const c = { ...p }; ws.positions.set(id, c); ws.spatial.update(id, c); });
    ws.moved.clear();
    ws.pinned.clear();
    for (const id of ws.doc.view?.pinned ?? []) if (ws.index.nodes.has(id)) ws.pinned.add(id);
    try {
      window.localStorage.removeItem(ws.storageKey);
      setPersistError(null);
    } catch (e) {
      setPersistError(`Positions restored, but the saved layout could not be cleared: ${msg(e)}`);
    }
    setDirty(false);
    setRev((r) => r + 1);
    notify("info", "Supplied positions restored.");
  };

  const exportJson = (scope: "full" | "visible") => {
    if (!ws) return;
    try {
      const keep = (id: string) => scope === "full" || !visible || visible.has(id);
       const positions: Record<string, Point> = Object.create(null);
      for (const [id, p] of ws.positions) if (keep(id)) positions[id] = { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
      const out: GraphDocument = {
        ...ws.doc,
        nodes: ws.doc.nodes.filter((n) => keep(n.id)),
        edges: ws.doc.edges.filter((e) => keep(e.source) && keep(e.target)),
        view: { positions, pinned: [...ws.pinned].filter(keep) },
      };
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ws.doc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "graph"}${scope === "visible" ? "-visible" : ""}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("ok", `Exported ${out.nodes.length.toLocaleString()} nodes, ${out.edges.length.toLocaleString()} edges with current positions and pins.`);
    } catch (e) {
      notify("error", `Export failed: ${msg(e)}`);
    }
  };

  return {
    ws, error: built.error, source: loaded.source, loading, selected, setSelected, query, setQuery, hiddenKinds, toggleKind,
    clearKinds: () => { setHiddenKinds(new Set()); setCyclesOnly(false); },
    cyclesOnly, setCyclesOnly, mode, setMode, transitive, setTransitive, focus, visible, matches, highlight, scene,
     listNodes, fitTick, requestFit, focusNode, focusSelected, expandFocus, resetFocus, onDragEnd, togglePin, saveLayout, restoreSupplied,
    exportJson, importText, loadSample, dirty, persistError, notice, dismissNotice: () => setNotice(null), rev,
  };
}
