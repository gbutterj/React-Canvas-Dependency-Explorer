import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { sampleFromUrl, type SampleKind, type ScaleDensity } from "@/graph/scale-fixtures";
import { neighborhood } from "@/graph/model";
import { GraphBackground, type BackgroundWorkspace } from "@/graph/background-client";
import type { ImpactResult, LoadInput } from "@/graph/background-protocol";
import type { GraphDocument, NodeKind, Point } from "@/graph/types";
import type { Role, Scene } from "@/lib/renderer";

export type Mode = "both" | "dependencies" | "dependents";
export interface Focus { root: string; depth: number }
export interface Source { kind: "demo" | "stress" | "import"; label: string; sample?: SampleKind; density?: ScaleDensity }
export interface Notice { id: number; tone: "ok" | "error" | "info"; text: string }

export type Workspace = BackgroundWorkspace;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function sampleSource(sample: SampleKind, density: ScaleDensity): Source {
  if (sample === "demo") return { kind: "demo", sample, label: "Demo dataset (synthetic)" };
  const count = sample === "scale-1000" ? 1000 : sample === "scale-50000" ? 50000 : 10000;
  return { kind: "stress", sample, density, label: `${count.toLocaleString()} synthetic nodes` };
}

export function useWorkbench() {
  const [ws, setWorkspace] = useState<Workspace | null>(null);
  const [source, setSource] = useState<Source>(() => {
    const sample = sampleFromUrl();
    return sampleSource(sample.kind, sample.density);
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadPhase, setLoadPhase] = useState("Starting background processing");
  const [selected, setSelected] = useState<string | null>(null);
  const [impactState, setImpactState] = useState<{ ws: Workspace; root: string; result?: ImpactResult; error?: string } | null>(null);
  const background = useRef<GraphBackground | null>(null);
  if (!background.current) background.current = new GraphBackground();
  const loadSequence = useRef(0);
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

  const notify = useCallback((tone: Notice["tone"], text: string) => {
    clearTimeout(noticeTimer.current);
    setNotice({ id: Date.now(), tone, text });
    if (tone !== "error") noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
  }, []);

  const resetView = useCallback(() => {
    setSelected(null); setQuery(""); setHiddenKinds(new Set()); setCyclesOnly(false);
    setFocus(null); setDirty(false); setPersistError(null);
  }, []);

  const startLoad = useCallback(async (input: LoadInput, nextSource: Source): Promise<string | null> => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadPhase("Starting background processing");
    setError(null);
    try {
      const next = await background.current!.load(input, (phase) => {
        if (sequence === loadSequence.current) setLoadPhase(phase);
      });
      if (sequence !== loadSequence.current) return "Loading cancelled.";
      resetView();
      setWorkspace(next);
      setSource(nextSource.kind === "import" ? { ...nextSource, label: `Imported: ${input.kind === "import" ? input.name || next.doc.name : next.doc.name}` } : nextSource);
      if (input.kind === "sample" && input.sample === "demo") setSelected("checkout-api");
      setLoading(false);
      setFitTick((t) => t + 1);
      if (input.kind === "import") notify("ok", `Imported ${next.doc.nodes.length.toLocaleString()} nodes and ${next.doc.edges.length.toLocaleString()} edges.`);
      return null;
    } catch (e) {
      const message = msg(e);
      if (sequence === loadSequence.current) {
        setError(message);
        setLoading(false);
        notify("error", message);
      }
      return message;
    }
  }, [resetView, notify]);

  const cancelLoad = useCallback(() => {
    loadSequence.current++;
    background.current!.cancelLoad();
    setLoading(false);
    setError("Loading cancelled.");
  }, []);
  const loadSample = useCallback((kind: SampleKind, density: ScaleDensity = source.density ?? 2) => {
    void startLoad({ kind: "sample", sample: kind, density }, sampleSource(kind, density));
  }, [startLoad, source.density]);
  const importText = useCallback((text: string | Blob, name: string) =>
    startLoad({ kind: "import", text, name }, { kind: "import", label: name }), [startLoad]);

  useEffect(() => {
    const sample = sampleFromUrl();
    void startLoad({ kind: "sample", sample: sample.kind, density: sample.density }, sampleSource(sample.kind, sample.density));
    return () => {
      loadSequence.current++;
      background.current!.dispose();
      clearTimeout(noticeTimer.current);
    };
  }, [startLoad]);

  useEffect(() => {
    if (!ws || !selected || !ws.index.nodes.has(selected)) {
      setImpactState(null);
      return background.current!.impact(null, () => {}, () => {});
    }
    setImpactState({ ws, root: selected });
    return background.current!.impact(selected,
      (result) => setImpactState({ ws, root: selected, result }),
      (message) => setImpactState({ ws, root: selected, error: message }));
  }, [ws, selected]);
  const currentImpact = impactState?.ws === ws && impactState.root === selected ? impactState : null;
  const impact = currentImpact?.result ?? null;
  const impactError = currentImpact?.error ?? null;
  const impactLoading = !!ws && !!selected && !impact && !impactError;

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
    const m = new Map<string, Role>();
    if (impact) {
      if (mode !== "dependents") for (const id of transitive ? impact.dependencies : impact.directDependencies) m.set(id, "dependency");
      if (mode !== "dependencies") for (const id of transitive ? impact.dependents : impact.directDependents) m.set(id, m.has(id) ? "both" : "dependent");
    }
    m.set(selected, "root");
    return m;
  }, [ws, selected, mode, transitive, impact]);

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
    ws, error, source, loading, loadPhase, cancelLoad, impact, impactLoading, impactError, selected, setSelected, query, setQuery, hiddenKinds, toggleKind,
    clearKinds: () => { setHiddenKinds(new Set()); setCyclesOnly(false); },
    cyclesOnly, setCyclesOnly, mode, setMode, transitive, setTransitive, focus, visible, matches, highlight, scene,
     listNodes, fitTick, requestFit, focusNode, focusSelected, expandFocus, resetFocus, onDragEnd, togglePin, saveLayout, restoreSupplied,
    exportJson, importText, loadSample, dirty, persistError, notice, dismissNotice: () => setNotice(null), rev,
  };
}
