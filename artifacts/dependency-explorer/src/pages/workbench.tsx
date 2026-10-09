import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertTriangle, ChevronDown, CircleHelp, Crosshair, Download, FileUp, Focus, ListTree, Pin, PinOff, PlusCircle,
  RotateCcw, Save, Search, SlidersHorizontal, Undo2, X,
} from "lucide-react";
import { neighbors, reachable } from "@/graph/model";
import { NODE_KINDS, type NodeKind } from "@/graph/types";
import { GraphCanvas, KindIcon, type CanvasHandle } from "@/components/graph-canvas";
import { Modal } from "@/components/modal";
import { useWorkbench, type Mode } from "@/hooks/use-workbench";
import { KIND_COLOR, KIND_LABEL, cx } from "@/lib/node-style";

const SAMPLE_JSON = `{
  "schemaVersion": 1,
  "name": "My system",
  "nodes": [
    { "id": "web", "label": "Web app", "kind": "service" },
    { "id": "db", "label": "Primary DB", "kind": "database" }
  ],
  "edges": [
    { "id": "e1", "source": "web", "target": "db", "kind": "data" }
  ],
  "view": { "positions": { "web": { "x": 0, "y": 0 }, "db": { "x": 220, "y": 0 } } }
}`;

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
        <path d="M6 7l12-2M6 7l4 12M18 5l-8 14" stroke="#e9b44c" strokeWidth="1.6" />
        <circle cx="6" cy="7" r="3.2" fill="#3aa7a0" /><circle cx="18" cy="5" r="3.2" fill="#e9b44c" /><circle cx="10" cy="19" r="3.2" fill="#f1ede3" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">Dependency Explorer</div>
        <div className="hidden text-[10.5px] text-[hsl(42_20%_72%)] sm:block">what breaks when this changes</div>
      </div>
    </div>
  );
}

function ImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (t: string, n: string) => string | null }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    if (!text.trim()) return setErr("Paste JSON or choose a file first.");
    const e = onImport(text, name);
    if (e) setErr(e);
    else onClose();
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setText(await f.text());
      setName(f.name);
      setErr(null);
    } catch (e) {
      setErr(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <Modal title="Import graph JSON" onClose={onClose} wide>
      <p className="text-sm text-muted-foreground">
        Edges point from a source that depends on a target. Include <span className="mono">view.positions</span> for node placement; nodes without positions are put on a plain grid because layout is not computed here.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted">
          <FileUp size={14} /> Choose .json file
          <input type="file" accept="application/json,.json" className="sr-only" data-testid="input-import-file" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => { setText(SAMPLE_JSON); setName("example.json"); setErr(null); }} data-testid="button-insert-example">
          Insert minimal example
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setErr(null); }}
        spellCheck={false}
        aria-label="Graph JSON"
        placeholder="Paste a graph document here"
        className="mono mt-3 h-56 w-full resize-y rounded-md border border-input bg-background p-3 text-xs outline-none focus:ring-2 focus:ring-ring"
        data-testid="input-import-json"
      />
      {err && (
        <div role="alert" className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-[hsl(350_70%_96%)] p-3 text-sm text-destructive" data-testid="error-import">
          <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> This file was not loaded</div>
          {err}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onClick={onClose}>Cancel</button>
        <button className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90" onClick={submit} data-testid="button-submit-import">Validate and load</button>
      </div>
    </Modal>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const row = (k: string, v: string) => (<><dt className="mono text-xs font-medium">{k}</dt><dd className="text-sm text-muted-foreground">{v}</dd></>);
  return (
    <Modal title="How to read this workbench" onClose={onClose} wide>
      <div className="grid gap-5 sm:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Direction</h3>
          <p className="text-sm text-muted-foreground">An arrow runs from the thing that depends to the thing it depends on. Select a node: <b className="text-[hsl(var(--dep))]">teal</b> nodes are its dependencies (what it needs), <b className="text-[hsl(var(--dpn))]">amber</b> nodes are its dependents (what breaks if it changes). Dashed crimson rings mark nodes in a cycle, from a strongly-connected-component analysis.</p>
          <h3 className="mb-2 mt-4 text-sm font-semibold">Layout</h3>
          <p className="text-sm text-muted-foreground">No layout engine runs. Nodes sit at the positions supplied in the data, or where you drag them. Pinned nodes cannot be dragged. Saving stores positions in this browser only. A layout adapter interface exists for a future algorithm to plug in.</p>
          <h3 className="mb-2 mt-4 text-sm font-semibold">Datasets</h3>
          <p className="text-sm text-muted-foreground">The demo and the 1,000 / 10,000 / 50,000-node scale graphs are synthetic. Choose 2, 5, or 20 dependencies per node to explore all nine benchmark cases. Counts are computed from the loaded data. Scale graphs use supplied grid positions, not a force layout; dense overviews may render slowly.</p>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Controls</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {row("Click / tap", "Select a node")}
            {row("Hover", "Details card (touch: use the selection bar)")}
            {row("Double click", "Focus its neighborhood")}
            {row("Drag node", "Move it (view only)")}
            {row("Drag / pinch / wheel", "Pan and zoom")}
            {row("Arrows, + / -", "Pan and zoom when canvas focused")}
            {row("0", "Fit to screen")}
            {row("Escape", "Clear selection")}
            {row("Node list", "Arrow keys move, Enter selects")}
          </dl>
          <h3 className="mb-2 mt-4 text-sm font-semibold">Neighborhood</h3>
          <p className="text-sm text-muted-foreground">Focus hides everything outside the selected node's neighborhood. Expand adds one more hop. Reset clears focus, filters and selection.</p>
        </section>
      </div>
    </Modal>
  );
}

export default function Workbench() {
  const wb = useWorkbench();
  const canvas = useRef<CanvasHandle>(null);
  const [panel, setPanel] = useState<null | "list" | "details">(null);
  const [dialog, setDialog] = useState<null | "import" | "help">(null);
  const [exportOpen, setExportOpen] = useState(false);
  const { ws, selected } = wb;

  useEffect(() => { canvas.current?.fit(null); }, [ws, wb.fitTick]);

  const node = ws && selected ? ws.index.nodes.get(selected) ?? null : null;
  const impact = useMemo(() => {
    if (!ws || !node) return null;
    return {
      deps: neighbors(ws.index, node.id, "dependencies"),
      dpns: neighbors(ws.index, node.id, "dependents"),
      tDeps: reachable(ws.index, node.id, "dependencies").size,
      tDpns: reachable(ws.index, node.id, "dependents").size,
      cycles: ws.analysis.cycles.filter((c) => c.includes(node.id)),
    };
  }, [ws, node]);

  const pick = (id: string) => { wb.setSelected(id); canvas.current?.centerOn(id); };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)];
    if (next) { e.preventDefault(); next.focus(); }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    ws?.doc.nodes.forEach((n) => { c[n.kind] = (c[n.kind] ?? 0) + 1; });
    return c;
  }, [ws]);

  const modeBtn = (m: Mode, label: string, color: string) => (
    <button
      key={m}
      aria-pressed={wb.mode === m}
      onClick={() => wb.setMode(m)}
      data-testid={`button-mode-${m}`}
      className={cx("flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors", wb.mode === m ? "bg-[hsl(var(--ink))] text-[hsl(42_30%_95%)]" : "hover:bg-muted")}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}
    </button>
  );

  if (!ws) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-6">
        <div role="alert" className="max-w-lg rounded-xl border border-destructive/40 bg-card p-6" data-testid="error-workspace">
          <h1 className="text-lg font-semibold text-destructive">The graph could not be loaded</h1>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{wb.error ?? "Unknown error"}</p>
          <div className="mt-4 flex gap-2">
            <button className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={() => wb.loadSample("demo")} data-testid="button-retry-demo">Retry with demo dataset</button>
            <button className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => setDialog("import")}>Import JSON</button>
          </div>
        </div>
        {dialog === "import" && <ImportDialog onClose={() => setDialog(null)} onImport={wb.importText} />}
      </div>
    );
  }

  const total = ws.doc.nodes.length;
  const shown = wb.visible ? wb.visible.size : total;
  const filtersActive = wb.hiddenKinds.size > 0 || wb.cyclesOnly || !!wb.focus || !!wb.query;

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <header className="z-40 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 bg-[hsl(var(--ink))] px-3 py-2 text-[hsl(42_30%_95%)] sm:px-4">
        <Brand />
        <div className="flex items-center gap-2">
          <span className={cx("rounded-full px-2.5 py-1 text-[11px] font-semibold", wb.source.kind === "import" ? "bg-[hsl(160_50%_28%)]" : "bg-[hsl(38_70%_38%)]")} data-testid="badge-dataset">{wb.source.label}</span>
          <div className="relative">
            <select
              aria-label="Choose dataset"
              value={wb.source.kind === "import" ? "" : wb.source.sample ?? "demo"}
              disabled={wb.loading}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "demo" || value === "scale-1000" || value === "scale-10000" || value === "scale-50000") wb.loadSample(value);
              }}
              className="appearance-none rounded-md border border-white/20 bg-transparent py-1 pl-2 pr-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#e9b44c]"
              data-testid="select-dataset"
            >
              {wb.source.kind === "import" && <option value="" className="text-black">Imported file</option>}
              <option value="demo" className="text-black">Demo (Atlas commerce)</option>
              <option value="scale-1000" className="text-black">Scale: 1,000 nodes</option>
              <option value="scale-10000" className="text-black">Scale: 10,000 nodes</option>
              <option value="scale-50000" className="text-black">Scale: 50,000 nodes</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1.5" />
          </div>
          {wb.source.kind === "stress" && (
            <select
              aria-label="Choose edge density"
              data-testid="select-density"
              value={wb.source.density ?? 2}
              disabled={wb.loading}
              onChange={(e) => {
                const density = Number(e.target.value);
                if ((density === 2 || density === 5 || density === 20) && wb.source.sample) wb.loadSample(wb.source.sample, density);
              }}
              className="rounded-md border border-white/20 bg-transparent px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[#e9b44c]"
            >
              <option value="2" className="text-black">Sparse · ~2 edges/node</option>
              <option value="5" className="text-black">Medium · ~5 edges/node</option>
              <option value="20" className="text-black">Dense · ~20 edges/node</option>
            </select>
          )}
          {wb.loading && <span className="text-xs text-[hsl(42_20%_72%)]" role="status">Building dataset...</span>}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
           <button aria-label="Import graph JSON" onClick={() => setDialog("import")} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs hover:bg-white/10" data-testid="button-import"><FileUp size={14} /><span className="hidden sm:inline">Import</span></button>
          <div className="relative">
             <button aria-label="Export graph JSON" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs hover:bg-white/10" data-testid="button-export"><Download size={14} /><span className="hidden sm:inline">Export</span></button>
            {exportOpen && (
              <div className="panel-in absolute right-0 top-9 z-50 w-64 rounded-lg border border-border bg-popover p-1 text-foreground shadow-xl">
                <button className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { wb.exportJson("full"); setExportOpen(false); }} data-testid="button-export-full">
                  Full graph<span className="block text-xs text-muted-foreground">All nodes, current positions and pins</span>
                </button>
                <button className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { wb.exportJson("visible"); setExportOpen(false); }} data-testid="button-export-visible">
                  Current view only<span className="block text-xs text-muted-foreground">{shown.toLocaleString()} visible nodes after filters and focus</span>
                </button>
              </div>
            )}
          </div>
           <button aria-label="Help and graph conventions" onClick={() => setDialog("help")} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs hover:bg-white/10" data-testid="button-help"><CircleHelp size={14} /><span className="hidden sm:inline">Help</span></button>
        </div>
      </header>
      {wb.source.kind === "stress" && (
        <div className="shrink-0 border-b border-border bg-secondary px-4 py-1.5 text-xs text-muted-foreground" data-testid="note-scale">
          Synthetic scale graph: {total.toLocaleString()} nodes · {ws.doc.edges.length.toLocaleString()} edges.
          {" "}Grid coordinates, not a force layout. Zoom in for icons and hover cards; search a module to inspect its dependencies.
          {wb.source.density === 20 && " Dense overviews can be slow on your device."}
        </div>
      )}

      {(ws.storageWarning || wb.persistError || ws.gridPlaced > 0) && (
        <div className="shrink-0 space-y-px text-xs">
          {ws.storageWarning && <div role="alert" className="bg-[hsl(38_80%_89%)] px-4 py-1.5 text-[hsl(30_70%_20%)]" data-testid="warning-storage">{ws.storageWarning}</div>}
          {wb.persistError && <div role="alert" className="bg-[hsl(350_70%_94%)] px-4 py-1.5 text-destructive" data-testid="error-persist">{wb.persistError}</div>}
          {ws.gridPlaced > 0 && <div className="bg-secondary px-4 py-1.5" data-testid="note-grid">{ws.gridPlaced.toLocaleString()} node(s) had no supplied position and were placed on a plain grid. No layout is computed.</div>}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* left: search + list */}
        <aside className={cx(panel === "list" ? "flex" : "hidden", "absolute inset-0 z-30 w-full flex-col border-r border-border bg-sidebar md:static md:z-auto md:flex md:w-[300px] md:shrink-0")} aria-label="Node search and list">
          <div className="space-y-3 border-b border-border p-3">
            <div className="flex items-center justify-between md:hidden">
              <span className="text-sm font-semibold">Nodes</span>
              <button aria-label="Close list" onClick={() => setPanel(null)} className="rounded-md p-1.5 hover:bg-muted"><X size={16} /></button>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
              <input
                type="search"
                value={wb.query}
                onChange={(e) => wb.setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && wb.listNodes[0]) { pick(wb.listNodes[0].id); } if (e.key === "ArrowDown") (document.querySelector("[data-node-list] button") as HTMLElement | null)?.focus(); }}
                placeholder="Search name, id, owner, tag"
                aria-label="Search nodes"
                className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-8 text-sm outline-none focus:ring-2 focus:ring-ring"
                data-testid="input-search"
              />
              {wb.query && <button aria-label="Clear search" onClick={() => wb.setQuery("")} className="absolute right-2 top-2 text-muted-foreground"><X size={15} /></button>}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by node type">
              {NODE_KINDS.map((k: NodeKind) => {
                const on = !wb.hiddenKinds.has(k);
                return (
                  <button key={k} aria-pressed={on} onClick={() => wb.toggleKind(k)} data-testid={`filter-kind-${k}`}
                    className={cx("flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-all", on ? "border-transparent text-white" : "border-border bg-background text-muted-foreground line-through opacity-70")}
                    style={on ? { background: KIND_COLOR[k] } : undefined}>
                    <KindIcon kind={k} size={12} />{KIND_LABEL[k]} <span className="mono opacity-80">{counts[k] ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={wb.cyclesOnly} onChange={(e) => wb.setCyclesOnly(e.target.checked)} className="accent-[hsl(var(--cyc))]" data-testid="checkbox-cycles-only" />
              Only nodes in cycles <span className="mono text-muted-foreground">({ws.analysis.cycleNodeIds.size})</span>
            </label>
          </div>
          <div className="mono flex items-center justify-between px-3 py-1.5 text-[10.5px] text-muted-foreground" aria-live="polite" data-testid="text-list-count">
            <span>{wb.listNodes.length.toLocaleString()} of {total.toLocaleString()} nodes</span>
            {filtersActive && <button className="underline" onClick={wb.resetFocus} data-testid="button-clear-filters">clear all</button>}
          </div>
          {wb.listNodes.length === 0 ? (
            <div className="m-3 rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground" data-testid="empty-list">
              <Search className="mx-auto mb-2" size={18} />No nodes match.
              <button className="mt-2 block w-full text-primary underline" onClick={wb.resetFocus}>Clear search and filters</button>
            </div>
          ) : (
            <ul data-node-list role="listbox" aria-label="Nodes" onKeyDown={onListKey} className="scroll-thin min-h-0 flex-1 overflow-auto px-1.5 pb-3">
              {wb.listNodes.slice(0, 300).map((n) => (
                <li key={n.id} role="option" aria-selected={n.id === selected}>
                  <button onClick={() => { pick(n.id); setPanel(null); }} data-testid={`item-node-${n.id}`}
                    className={cx("group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", n.id === selected ? "bg-[hsl(var(--ink))] text-[hsl(42_30%_95%)]" : "hover:bg-muted")}>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white transition-transform group-hover:scale-110" style={{ background: KIND_COLOR[n.kind] }}><KindIcon kind={n.kind} size={13} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{n.label}</span><span className="mono block truncate text-[10px] opacity-60">{n.id}</span></span>
                    {ws.analysis.cycleNodeIds.has(n.id) && <span className="h-2 w-2 shrink-0 rounded-full border-2 border-dashed border-[hsl(var(--cyc))]" title="In a cycle" />}
                  </button>
                </li>
              ))}
              {wb.listNodes.length > 300 && <li className="px-3 py-2 text-xs text-muted-foreground">Showing the first 300 of {wb.listNodes.length.toLocaleString()}. Narrow the search to see more.</li>}
            </ul>
          )}
        </aside>

        {/* center: canvas */}
        <main className="relative min-w-0 flex-1">
           <GraphCanvas ref={canvas} scene={wb.scene} onSelect={wb.setSelected} onActivate={wb.focusNode} onDragEnd={wb.onDragEnd} onClear={() => wb.setSelected(null)}>
            <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex flex-wrap items-start gap-2">
              <div className="pointer-events-auto flex overflow-hidden rounded-lg border border-border bg-card shadow-md" role="group" aria-label="Highlight direction">
                {modeBtn("both", "Both", "hsl(205 40% 25%)")}
                {modeBtn("dependencies", "Dependencies", "#14876a")}
                {modeBtn("dependents", "Dependents", "#d98a0b")}
              </div>
              <div className="pointer-events-auto flex overflow-hidden rounded-lg border border-border bg-card shadow-md" role="group" aria-label="Depth">
                {[{ t: false, l: "1 hop" }, { t: true, l: "Transitive" }].map((o) => (
                  <button key={o.l} aria-pressed={wb.transitive === o.t} onClick={() => wb.setTransitive(o.t)} data-testid={`button-depth-${o.t ? "all" : "1"}`}
                    className={cx("px-2.5 py-1.5 text-xs font-medium", wb.transitive === o.t ? "bg-[hsl(var(--ink))] text-[hsl(42_30%_95%)]" : "hover:bg-muted")}>{o.l}</button>
                ))}
              </div>
              <div className="pointer-events-auto flex overflow-hidden rounded-lg border border-border bg-card shadow-md">
                <button disabled={!selected} onClick={wb.focusSelected} data-testid="button-focus" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40"><Focus size={13} />Focus</button>
                <button disabled={!wb.focus} onClick={wb.expandFocus} data-testid="button-expand" className="flex items-center gap-1.5 border-l border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40"><PlusCircle size={13} />Expand{wb.focus ? ` (${wb.focus.depth} hop${wb.focus.depth > 1 ? "s" : ""})` : ""}</button>
                <button onClick={wb.resetFocus} data-testid="button-reset" className="flex items-center gap-1.5 border-l border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"><RotateCcw size={13} />Reset</button>
              </div>
            </div>
            {shown === 0 && (
              <div className="absolute inset-0 z-10 flex items-center justify-center p-6" data-testid="empty-canvas">
                <div className="max-w-sm rounded-xl border border-dashed border-border bg-card/95 p-6 text-center">
                  <SlidersHorizontal className="mx-auto mb-2 text-muted-foreground" />
                  <p className="font-semibold">{total === 0 ? "This graph has no nodes" : "Nothing visible with these filters"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{total === 0 ? "Import a graph document to begin." : "Type filters, cycles-only or focus hid every node."}</p>
                  <button className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={total === 0 ? () => setDialog("import") : wb.resetFocus}>{total === 0 ? "Import JSON" : "Reset view"}</button>
                </div>
              </div>
            )}
            {/* mobile controls and touch fallback for hover details */}
            <div className="absolute inset-x-3 bottom-[7.5rem] z-10 flex flex-col gap-2 sm:bottom-3 sm:right-auto md:hidden lg:hidden">
              {node && panel === null && (
                <button onClick={() => setPanel("details")} className="panel-in flex items-center gap-2.5 rounded-lg border border-border bg-card p-2.5 text-left shadow-lg" data-testid="bar-selection">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ background: KIND_COLOR[node.kind] }}><KindIcon kind={node.kind} size={15} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{node.label}</span><span className="block truncate text-xs text-muted-foreground">{KIND_LABEL[node.kind]}{node.owner ? ` / ${node.owner}` : ""}{node.version ? ` / ${node.version}` : ""}</span></span>
                  <span className="text-xs text-primary">Details</span>
                </button>
              )}
            </div>
             <div className="absolute bottom-3 left-3 z-10 flex gap-2 lg:hidden sm:bottom-14">
               <button onClick={() => setPanel("list")} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium shadow-md md:hidden" data-testid="button-open-list"><ListTree size={14} />Nodes</button>
              <button onClick={() => setPanel("details")} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium shadow-md lg:hidden" data-testid="button-open-details"><Crosshair size={14} />Details</button>
            </div>
             <div className="pointer-events-none absolute bottom-14 left-3 z-10 hidden items-center gap-3 rounded-full border border-border bg-card/90 px-3 py-1.5 text-[11px] backdrop-blur lg:flex">
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-5 rounded bg-[#14876a]" />dependencies</span>
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-5 rounded bg-[#d98a0b]" />dependents</span>
              <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-full border-2 border-dashed border-[#c0203f]" />cycle</span>
            </div>
          </GraphCanvas>
        </main>

        {/* right: details */}
        <aside className={cx(panel === "details" ? "flex" : "hidden", "absolute inset-y-0 right-0 z-30 w-full flex-col border-l border-border bg-sidebar sm:w-[360px] lg:static lg:z-auto lg:flex lg:w-[340px] lg:shrink-0")} aria-label="Details">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 lg:hidden">
            <span className="text-sm font-semibold">Details</span>
            <button aria-label="Close details" onClick={() => setPanel(null)} className="rounded-md p-1.5 hover:bg-muted"><X size={16} /></button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            {node && impact ? (
              <div key={node.id} className="panel-in space-y-4 p-4" data-testid="panel-node-details">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white" style={{ background: KIND_COLOR[node.kind] }}><KindIcon kind={node.kind} size={22} /></span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold leading-tight" data-testid="text-node-label">{node.label}</h2>
                    <div className="mono truncate text-[11px] text-muted-foreground">{node.id}</div>
                    <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white" style={{ background: KIND_COLOR[node.kind] }}>{KIND_LABEL[node.kind]}</span>
                  </div>
                </div>
                {node.description && <p className="text-sm text-muted-foreground">{node.description}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border bg-card p-3"><div className="mono text-2xl font-semibold text-[hsl(var(--dpn))]" data-testid="text-dependents-count">{impact.tDpns}</div><div className="text-xs text-muted-foreground">transitive dependents<br />({impact.dpns.length} direct)</div></div>
                  <div className="rounded-lg border border-border bg-card p-3"><div className="mono text-2xl font-semibold text-[hsl(var(--dep))]" data-testid="text-dependencies-count">{impact.tDeps}</div><div className="text-xs text-muted-foreground">transitive dependencies<br />({impact.deps.length} direct)</div></div>
                </div>
                <dl className="mono grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {node.owner && (<><dt className="text-muted-foreground">owner</dt><dd>{node.owner}</dd></>)}
                  {node.version && (<><dt className="text-muted-foreground">version</dt><dd>{node.version}</dd></>)}
                  {node.tags?.length ? (<><dt className="text-muted-foreground">tags</dt><dd>{node.tags.join(", ")}</dd></>) : null}
                  {node.icon && (<><dt className="text-muted-foreground">icon</dt><dd className="truncate">{node.icon}</dd></>)}
                </dl>
                {impact.cycles.length > 0 && (
                  <div className="rounded-lg border border-[hsl(var(--cyc)/.4)] bg-[hsl(350_70%_96%)] p-3 text-xs" data-testid="panel-cycles">
                    <div className="mb-1 font-semibold text-[hsl(var(--cyc))]">In a dependency cycle (strongly connected group)</div>
                    {impact.cycles.map((c, i) => (<button key={i} className="block text-left underline-offset-2 hover:underline" onClick={() => canvas.current?.fit(c)}>{c.map((id) => ws.index.nodes.get(id)?.label ?? id).join(", ")}</button>))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" onClick={wb.focusSelected} data-testid="button-details-focus"><Focus size={13} />Focus neighborhood</button>
                  <button className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => wb.togglePin(node.id)} data-testid="button-pin">{ws.pinned.has(node.id) ? <PinOff size={13} /> : <Pin size={13} />}{ws.pinned.has(node.id) ? "Unpin" : "Pin position"}</button>
                  <button className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => canvas.current?.centerOn(node.id)}><Crosshair size={13} />Center</button>
                </div>
                {([["Depends on", impact.deps, "dep"], ["Used by", impact.dpns, "dpn"]] as const).map(([title, list, c]) => (
                  <div key={title}>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title} ({list.length})</h3>
                    {list.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
                      <ul className="flex flex-wrap gap-1.5">
                        {list.slice(0, 40).map((n) => (
                          <li key={n.id}><button onClick={() => pick(n.id)} className="flex items-center gap-1.5 rounded-full border bg-card px-2 py-1 text-[11px] hover:bg-muted" style={{ borderColor: `hsl(var(--${c}) / .5)` }}><span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[n.kind] }} />{n.label}</button></li>
                        ))}
                        {list.length > 40 && <li className="px-1 py-1 text-[11px] text-muted-foreground">+{list.length - 40} more</li>}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4 p-4" data-testid="panel-overview">
                <div>
                  <h2 className="text-lg font-semibold leading-tight">{ws.doc.name}</h2>
                  {ws.doc.description && <p className="mt-1 text-sm text-muted-foreground">{ws.doc.description}</p>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["nodes", total], ["edges", ws.index.edges.size], ["cyclic groups", ws.analysis.cycles.length],
                    ["components", ws.analysis.components.length], ["orphans", ws.analysis.orphanIds.length], ["max fan-in", ws.analysis.maxFanIn],
                  ].map(([l, v]) => (
                    <div key={l} className="rounded-lg border border-border bg-card px-3 py-2"><div className="mono text-xl font-semibold" data-testid={`stat-${String(l).replace(" ", "-")}`}>{Number(v).toLocaleString()}</div><div className="text-[11px] text-muted-foreground">{l}</div></div>
                  ))}
                </div>
                <div className="rounded-lg bg-secondary p-3 text-sm">Select a node on the canvas or from the list to see what it needs and what would break if it changed.</div>
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cyclic groups</h3>
                  {ws.analysis.cycles.length === 0 ? <p className="text-sm text-muted-foreground">No cycles found in this graph.</p> : (
                    <ul className="space-y-1.5">
                      {ws.analysis.cycles.slice(0, 25).map((c, i) => (
                        <li key={i}><button className="w-full rounded-md border border-[hsl(var(--cyc)/.35)] bg-card px-2.5 py-1.5 text-left text-xs hover:bg-muted" onClick={() => { wb.setSelected(c[0]); canvas.current?.fit(c); }} data-testid={`button-cycle-${i}`}>
                          <span className="font-semibold text-[hsl(var(--cyc))]">{c.length === 1 ? "Self-loop" : `${c.length} nodes`}</span> {c.slice(0, 4).map((id) => ws.index.nodes.get(id)?.label ?? id).join(", ")}{c.length > 4 ? ", ..." : ""}
                        </button></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-border p-3">
            <div className="flex items-center gap-2">
              <button onClick={wb.saveLayout} className={cx("flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium", wb.dirty ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted")} data-testid="button-save-layout"><Save size={13} />{wb.dirty ? "Save layout (unsaved)" : "Save layout"}</button>
              <button onClick={wb.restoreSupplied} title="Restore supplied positions and clear saved layout" aria-label="Restore supplied positions" className="rounded-md border border-border p-2 hover:bg-muted" data-testid="button-restore-layout"><Undo2 size={14} /></button>
            </div>
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">Saved to this browser only. {ws.moved.size} moved, {ws.pinned.size} pinned.</p>
          </div>
        </aside>
      </div>

      {wb.notice && (
        <div role={wb.notice.tone === "error" ? "alert" : "status"} className={cx("panel-in fixed bottom-4 left-1/2 z-[60] flex max-w-[92vw] -translate-x-1/2 items-start gap-3 rounded-lg px-4 py-2.5 text-sm shadow-xl", wb.notice.tone === "error" ? "bg-destructive text-destructive-foreground" : "bg-[hsl(var(--ink))] text-[hsl(42_30%_95%)]")} data-testid="toast-notice">
          <span>{wb.notice.text}</span>
          <button aria-label="Dismiss" onClick={wb.dismissNotice}><X size={14} /></button>
        </div>
      )}
      {dialog === "import" && <ImportDialog onClose={() => setDialog(null)} onImport={wb.importText} />}
      {dialog === "help" && <HelpDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
