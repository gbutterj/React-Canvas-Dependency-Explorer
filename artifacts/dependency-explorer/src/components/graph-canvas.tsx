import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Maximize2, Minus, Plus, Map as MapIcon, RefreshCw } from "lucide-react";
import { GraphRenderer, type RenderStats, type Scene } from "@/lib/renderer";
import { ICON_PATH, KIND_COLOR, KIND_LABEL } from "@/lib/node-style";

export interface CanvasHandle {
  fit(ids?: Iterable<string> | null): void;
  centerOn(id: string): void;
}
interface Props {
  scene: Scene | null;
  onSelect(id: string | null): void;
  onActivate(id: string): void;
  onDragEnd(id: string): void;
  onClear(): void;
  children?: ReactNode;
}

export function KindIcon({ kind, size = 16, className }: { kind: keyof typeof ICON_PATH; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICON_PATH[kind]} />
    </svg>
  );
}

export const GraphCanvas = forwardRef<CanvasHandle, Props>(function GraphCanvas(props, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const rend = useRef<GraphRenderer | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [stats, setStats] = useState<RenderStats | null>(null);
   const [showMap, setShowMap] = useState(() => window.matchMedia("(min-width: 640px)").matches);
  const [fatal, setFatal] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const statsRef = useRef<RenderStats | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !wrap.current) return;
    let timer = 0;
    let r: GraphRenderer;
    try {
      r = new GraphRenderer(el, {
        onHover: (id, x, y) => setHover(id ? { id, x, y } : null),
        onSelect: (id) => propsRef.current.onSelect(id),
        onActivate: (id) => propsRef.current.onActivate(id),
        onDragEnd: (id) => propsRef.current.onDragEnd(id),
        onStats: (s) => {
          statsRef.current = s;
          if (!timer) timer = window.setTimeout(() => { timer = 0; setStats(statsRef.current); }, 120);
        },
      });
    } catch (e) {
      setFatal(e instanceof Error ? e.message : String(e));
      return;
    }
    rend.current = r;
    const ro = new ResizeObserver(() => r.resize());
    ro.observe(wrap.current);
    r.resize();
    r.setScene(propsRef.current.scene);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      r.dispose();
      rend.current = null;
    };
  }, [attempt]);

  useEffect(() => { rend.current?.setScene(props.scene); }, [props.scene]);
  useEffect(() => {
    if (rend.current) { rend.current.minimap = showMap ? mini.current : null; rend.current.request(); }
  }, [showMap, attempt]);

  useImperativeHandle(ref, () => ({
    fit: (ids) => rend.current?.fit(ids),
    centerOn: (id) => rend.current?.centerOnNode(id),
  }), []);

  const onKey = (e: KeyboardEvent) => {
    const r = rend.current;
    if (!r) return;
    const step = e.shiftKey ? 160 : 60;
    const map: Record<string, () => void> = {
      ArrowLeft: () => r.panBy(step, 0), ArrowRight: () => r.panBy(-step, 0),
      ArrowUp: () => r.panBy(0, step), ArrowDown: () => r.panBy(0, -step),
      "+": () => r.zoomCenter(1.25), "=": () => r.zoomCenter(1.25), "-": () => r.zoomCenter(0.8),
      "0": () => r.fit(null), Escape: () => propsRef.current.onClear(),
    };
    const fn = map[e.key];
    if (fn) { e.preventDefault(); fn(); }
  };

  const node = hover && props.scene ? props.scene.index.nodes.get(hover.id) : null;
  const sc = props.scene;
  const w = wrap.current?.clientWidth ?? 800;
  const flipX = hover ? hover.x > w - 320 : false;
  const mmDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const b = e.currentTarget.getBoundingClientRect();
    rend.current?.minimapPointer(e.clientX - b.left, e.clientY - b.top);
  };
  const mmMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons !== 1) return;
    const b = e.currentTarget.getBoundingClientRect();
    rend.current?.minimapPointer(e.clientX - b.left, e.clientY - b.top);
  };

  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden">
      {fatal ? (
        <div role="alert" className="absolute inset-0 flex items-center justify-center p-6" data-testid="error-canvas">
          <div className="max-w-md rounded-xl border border-destructive/40 bg-card p-5">
            <p className="font-semibold text-destructive">The graph canvas could not start</p>
            <p className="mt-1 text-sm text-muted-foreground">{fatal}</p>
            <button onClick={() => { setFatal(null); setAttempt((a) => a + 1); }} className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" data-testid="button-retry-canvas">
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      ) : (
        <canvas
          ref={canvas}
          tabIndex={0}
          role="application"
          aria-label="Dependency graph canvas. Arrow keys pan, plus and minus zoom, 0 fits to screen, Escape clears selection. Use the node list for keyboard selection."
          onKeyDown={onKey}
          className="absolute inset-0 h-full w-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          data-testid="canvas-graph"
        />
      )}
      {props.children}

      {node && hover && (
        <div
          className="hc-in pointer-events-none absolute z-20 w-[280px] rounded-lg border border-border bg-popover p-3 shadow-[0_10px_30px_-8px_hsl(205_40%_12%/.35)]"
           style={{ left: Math.max(8, flipX ? hover.x - 296 : hover.x + 18), top: Math.max(8, Math.min(hover.y + 14, (wrap.current?.clientHeight ?? 600) - 270)) }}
          data-testid="hovercard-node"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ background: KIND_COLOR[node.kind] }}>
              <KindIcon kind={node.kind} size={16} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{node.label}</div>
              <div className="mono truncate text-[10.5px] text-muted-foreground">{node.id}</div>
            </div>
          </div>
          {node.description && <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{node.description}</p>}
          <dl className="mono mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
            <dt className="text-muted-foreground">kind</dt><dd>{KIND_LABEL[node.kind]}</dd>
            {node.owner && (<><dt className="text-muted-foreground">owner</dt><dd className="truncate">{node.owner}</dd></>)}
            {node.version && (<><dt className="text-muted-foreground">version</dt><dd>{node.version}</dd></>)}
            <dt className="text-muted-foreground">depends on</dt><dd>{sc?.index.outgoing.get(node.id)?.length ?? 0} edges</dd>
            <dt className="text-muted-foreground">used by</dt><dd>{sc?.index.incoming.get(node.id)?.length ?? 0} edges</dd>
          </dl>
          {sc?.cycleIds.has(node.id) && <p className="mt-2 text-[11px] font-semibold text-[hsl(var(--cyc))]">Member of a dependency cycle</p>}
          {node.tags && node.tags.length > 0 && <p className="mono mt-1.5 truncate text-[10.5px] text-muted-foreground">{node.tags.join(" / ")}</p>}
        </div>
      )}

      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
        {showMap && (
          <canvas
            ref={mini}
            onPointerDown={mmDown}
            onPointerMove={mmMove}
            aria-label="Minimap. Click or drag to move the viewport."
            className="h-[104px] w-[150px] cursor-crosshair touch-none rounded-lg border border-border shadow-md sm:h-[120px] sm:w-[180px]"
            data-testid="canvas-minimap"
          />
        )}
        <div className="flex overflow-hidden rounded-lg border border-border bg-card shadow-md">
          {[
            { l: "Zoom out", i: <Minus size={15} />, f: () => rend.current?.zoomCenter(0.8), t: "zoom-out" },
            { l: "Zoom in", i: <Plus size={15} />, f: () => rend.current?.zoomCenter(1.25), t: "zoom-in" },
            { l: "Fit to screen", i: <Maximize2 size={14} />, f: () => rend.current?.fit(null), t: "fit" },
            { l: showMap ? "Hide minimap" : "Show minimap", i: <MapIcon size={14} />, f: () => setShowMap((s) => !s), t: "minimap" },
          ].map((b) => (
            <button key={b.t} aria-label={b.l} title={b.l} onClick={b.f} data-testid={`button-${b.t}`} className="grid h-9 w-9 place-items-center hover:bg-muted active:bg-secondary">
              {b.i}
            </button>
          ))}
        </div>
      </div>

      {stats && sc && (
        <div className="mono pointer-events-none absolute bottom-3 left-3 z-10 hidden max-w-[60%] rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-[10.5px] text-muted-foreground backdrop-blur sm:block" data-testid="text-render-stats">
          zoom {Math.round(stats.k * 100)}% / drawn this frame: {stats.nodes.toLocaleString()} of {stats.total.toLocaleString()} nodes, {stats.edges.toLocaleString()} edges
        </div>
      )}
    </div>
  );
});
