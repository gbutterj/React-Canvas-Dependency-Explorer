import { createStressDocument } from "../graph/fixtures";
import { buildGraphIndex } from "../graph/model";
import { SpatialIndex } from "../graph/spatial";
import { GraphRenderer, type RenderStats, type Scene } from "../lib/renderer";
import { KIND_COLOR, ROLE_COLOR } from "../lib/node-style";

/** Developer-only deterministic assertions against the real Canvas renderer. */
export async function checkRenderer() {
  const assertions: string[] = [];
  const check = (ok: unknown, message: string) => {
    if (!ok) throw new Error(message);
    assertions.push(message);
  };
  const canvas = document.getElementById("graph") as HTMLCanvasElement;
  const mini = document.getElementById("minimap") as HTMLCanvasElement;
  const doc = createStressDocument(5000);
  const index = buildGraphIndex(doc);
  const positions = new Map(Object.entries(doc.view!.positions).map(([id, p]) => [id, { ...p }]));
  const ids = doc.nodes.map(n => n.id);
  const scene: Scene = {
    index, positions, spatial: new SpatialIndex(positions), visible: null,
    matches: null, highlight: null, selected: null, transitive: false,
    cycleIds: new Set([ids[0]!]), pinned: new Set(),
  };
  let stats!: RenderStats;
  let hover: string | null = null, dragged: string | null = null, activated: string | null = null;
  const renderer = new GraphRenderer(canvas, {
    onStats: s => { stats = s; }, onHover: id => { hover = id; },
    onSelect: () => {}, onActivate: id => { activated = id; }, onDragEnd: id => { dragged = id; },
  });
  const internals = renderer as unknown as {
    draw(): void; drawMinimap(): void; hit(x: number, y: number): string | null;
    pathCache: Map<unknown, unknown>; mmLayer: HTMLCanvasElement | null; mmDirty: boolean;
    images: Map<string, HTMLImageElement | "error">;
    edgeGroups: { dep: unknown[]; dpn: unknown[]; sampled: unknown[]; base: unknown[] };
    mmBounds: { maxX: number };
  };
  const context = canvas.getContext("2d")!;
  const capture = canvas.setPointerCapture;
  canvas.setPointerCapture = () => {};
  const pointer = (type: string, x: number, y: number) => {
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: "mouse", clientX: rect.left + x, clientY: rect.top + y, buttons: type === "pointerup" ? 0 : 1,
    }));
  };
  try {
    renderer.resize(); renderer.minimap = mini;
    renderer.setScene(scene);
    renderer.centerOn(positions.get(ids[2500]!)!, 0.035, false); internals.draw();
    check(stats.reduced && stats.edges < stats.edgeCandidates, "Crowded view reports edge sampling");
    check(stats.nodes < stats.nodeCandidates && stats.nodeAggregates > 0, "Crowded view reports density aggregation");
    const cache = [...internals.pathCache.values()];
    const layer = internals.mmLayer;
    renderer.panBy(1, 0); internals.draw();
    check(cache.every((v, i) => [...internals.pathCache.values()][i] === v), "Translation reuses edge paths");
    check(internals.mmLayer === layer && !internals.mmDirty, "Pan reuses clean minimap layer");
    const root = ids[2500]!, p = positions.get(root)!;
    renderer.centerOn(p, 1, false); internals.draw();
    check(!stats.nodeAggregates, "Zoom restores individual nodes");
    const zoomCache = [...internals.pathCache.values()];
    check(!zoomCache.some(v => cache.includes(v)), "Zoom rebuilds edge geometry");
    pointer("pointermove", 500, 350);
    check(hover === root, "Exact spatial picking and hover survive aggregation");
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent("dblclick", { clientX: rect.left + 500, clientY: rect.top + 350 }));
    check(activated === root, `Double click activates the original node (${activated} / ${root})`);
    const original = { ...p };
    pointer("pointerdown", 500, 350); pointer("pointermove", 520, 360); internals.draw();
    check(positions.get(root)!.x === original.x + 20, "Dragging updates model coordinates");
    check(scene.spatial.nearest(positions.get(root)!, 0.1) === root, "Dragging updates spatial picking");
    const movingCache = [...internals.pathCache.values()];
    check(!movingCache.some(v => zoomCache.includes(v)), "Dragging invalidates cached edge paths");
    pointer("pointerup", 520, 360); internals.draw();
    check(dragged === root && !internals.mmDirty, "Drag release refreshes minimap and emits completion");
    renderer.setScene({ ...scene, pinned: new Set([root]) });
    renderer.centerOn(positions.get(root)!, 1, false); internals.draw();
    const pinned = { ...positions.get(root)! };
    pointer("pointerdown", 500, 350); pointer("pointermove", 520, 360); pointer("pointerup", 520, 360);
    check(positions.get(root)!.x === pinned.x && positions.get(root)!.y === pinned.y, "Pinned nodes cannot move");
    // Capture actual stroke colors: directional paths remain separate and exact.
    const edge = [...index.edges.values()].find(e => e.source === root)!;
    const incoming = [...index.edges.values()].find(e => e.target === root)!;
    const colors: string[] = [];
    const stroke = context.stroke.bind(context);
    context.stroke = ((...args: unknown[]) => {
      colors.push(String(context.strokeStyle));
      (stroke as (...args: unknown[]) => void)(...args);
    }) as typeof context.stroke;
    renderer.setScene({
      ...scene, selected: root, cycleIds: new Set([root]),
      highlight: new Map([[root, "root"], [edge.target, "dependency"], [incoming.source, "dependent"]]),
    });
    renderer.centerOn(positions.get(root)!, 0.2, false); internals.draw();
    check(colors.includes(ROLE_COLOR.dependency), "Dependency stroke uses directional color");
    check(colors.includes(ROLE_COLOR.dependent), "Dependent stroke uses directional color");
    check(colors.includes(ROLE_COLOR.cycle), "Cycle indicators stay individual in overview");
    check(internals.edgeGroups.dep.length === 1 && internals.edgeGroups.dpn.length === 1, "Direct highlight classification stays exact");
    const highlightPaths = [...internals.pathCache.values()] as { arrows: boolean }[];
    check(highlightPaths.filter(p => p.arrows).length === 2, "Both highlight directions retain arrowheads");
    colors.length = 0;
    renderer.centerOn(positions.get(root)!, 1, false); internals.draw();
    check(colors.includes("#ffffff"), "Built-in vector icons are stroked at detailed zoom");
    const url = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="red"/></svg>');
    index.nodes.get(root)!.icon = url;
    internals.draw();
    const image = internals.images.get(url) as HTMLImageElement;
    await image.decode();
    const drawImage = context.drawImage.bind(context);
    let iconDrawn = false;
    context.drawImage = ((...args: unknown[]) => {
      if (args[0] === image) iconDrawn = true;
      (drawImage as (...args: unknown[]) => void)(...args);
    }) as typeof context.drawImage;
    internals.draw();
    check(iconDrawn, "Loaded custom image icons replace built-in fallback");
    context.drawImage = drawImage;
    delete index.nodes.get(root)!.icon;
    context.stroke = stroke;
    // A position moved beyond the old minimap bounds is included at release.
    renderer.setScene(scene); renderer.centerOn(positions.get(root)!, 1, false); internals.draw();
    const oldMax = internals.mmBounds.maxX;
    pointer("pointerdown", 500, 350); pointer("pointermove", oldMax + 10000, 350); internals.draw();
    check(internals.mmBounds.maxX === oldMax, "Minimap bounds stay stable during dragging");
    pointer("pointerup", oldMax + 10000, 350); internals.draw();
    check(internals.mmBounds.maxX > oldMax, "Release includes outlying dragged positions in minimap bounds");
    const miniContext = mini.getContext("2d")!;
    let minimapRects = 0;
    const fillRect = miniContext.fillRect.bind(miniContext);
    miniContext.fillRect = (...args) => { minimapRects++; fillRect(...args); };
    renderer.panBy(2, 0); internals.draw();
    check(minimapRects === 0, "Warm minimap pan does not redraw every visible node");
    mini.style.width = "200px"; internals.draw();
    check(internals.mmLayer!.width === mini.width && mini.width === 200, "Minimap resize rebuilds its bitmap at current size");
    miniContext.fillRect = fillRect;
    mini.style.width = "180px";
    renderer.setScene({ ...scene, visible: new Set([root]), highlight: null });
    renderer.fit(null, false); internals.draw();
    check(stats.nodeCandidates === 1 && stats.edgeCandidates === 0, "Filter invalidates cached candidates");
    renderer.setScene({ ...scene, visible: new Set(), highlight: null }); internals.draw();
    check(stats.nodes === 0 && stats.edges === 0, "Empty filtered scenes clear rendering counts");
    // Cache has no image dependency. Built-in paths still stroke at icon scale.
    check(Object.keys(KIND_COLOR).length === 5, "All five built-in icon kinds remain available");
    return { assertions: assertions.length, checks: assertions };
  } finally {
    canvas.setPointerCapture = capture;
    renderer.dispose();
  }
}
