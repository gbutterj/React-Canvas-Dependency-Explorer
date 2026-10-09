import type { SpatialIndex } from "@/graph/spatial";
import type { DependencyEdge, GraphIndex, Point } from "@/graph/types";
import { ICON_PATH, KIND_COLOR, ROLE_COLOR } from "./node-style";

export type Role = "root" | "dependency" | "dependent" | "both";
export interface Scene {
  index: GraphIndex;
  positions: Map<string, Point>;
  spatial: SpatialIndex;
  visible: Set<string> | null;
  matches: Set<string> | null;
  highlight: Map<string, Role> | null;
  transitive: boolean;
  selected: string | null;
  cycleIds: ReadonlySet<string>;
  pinned: ReadonlySet<string>;
}
export interface RenderStats { nodes: number; edges: number; total: number; k: number }
export interface Handlers {
  onHover(id: string | null, x: number, y: number): void;
  onSelect(id: string | null): void;
  onActivate(id: string): void;
  onDragEnd(id: string): void;
  onStats(s: RenderStats): void;
}
interface Cam { x: number; y: number; k: number }

const TAU = Math.PI * 2;
let iconPaths: Record<string, Path2D> | null = null;
const getIcons = () => {
  if (!iconPaths) {
    iconPaths = {};
    for (const [k, d] of Object.entries(ICON_PATH)) iconPaths[k] = new Path2D(d);
  }
  return iconPaths;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const BG = "#f1ede3";

export class GraphRenderer {
  cam: Cam = { x: 0, y: 0, k: 1 };
  scene: Scene | null = null;
  hovered: string | null = null;
  minimap: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;
  private lastT = 0;
  private tween: { from: Cam; to: Cam; t0: number; dur: number } | null = null;
  private dim = 0;
  private dimTarget = 0;
  private images = new Map<string, HTMLImageElement | "error">();
  private mm = { minX: 0, minY: 0, s: 1, ox: 0, oy: 0 };
  private mmBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private mmDirty = true;
  private ptrs = new Map<number, Point>();
  private mode: "none" | "pan" | "drag" | "pinch" = "none";
  private downId: string | null = null;
  private moved = false;
  private start: Point = { x: 0, y: 0 };
  private last: Point = { x: 0, y: 0 };
  private dragOff: Point = { x: 0, y: 0 };
  private pinchDist = 0;
  private statsKey = "";
  private disposed = false;

  constructor(readonly canvas: HTMLCanvasElement, public handlers: Handlers) {
    const c = canvas.getContext("2d");
    if (!c) throw new Error("Canvas 2D context is not available in this browser.");
    this.ctx = c;
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("dblclick", this.onDbl);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("pointerleave", this.onLeave);
    c.removeEventListener("dblclick", this.onDbl);
    c.removeEventListener("wheel", this.onWheel);
  }

  setScene(s: Scene | null) {
    this.scene = s;
    this.dimTarget = s && (s.highlight || s.matches) ? 1 : 0;
    this.mmDirty = true;
    this.request();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.request();
  }

  request() {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private animateTo(to: Cam, animate: boolean) {
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.tween = null;
      this.cam = to;
    } else {
      this.tween = { from: { ...this.cam }, to, t0: performance.now(), dur: 420 };
    }
    this.request();
  }

  fit(ids?: Iterable<string> | null, animate = true) {
    const s = this.scene;
    if (!s || this.w < 2) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
    const src = ids ?? s.visible ?? s.positions.keys();
    for (const id of src) {
      const p = s.positions.get(id);
      if (!p) continue;
      n++;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!n) return;
    const pad = 70;
    const bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1);
    const k = n === 1 ? 1.2 : clamp(Math.min((this.w - pad * 2) / bw, (this.h - pad * 2) / bh), 0.02, 1.4);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.animateTo({ k, x: this.w / 2 - cx * k, y: this.h / 2 - cy * k }, animate);
  }

  centerOn(p: Point, k?: number, animate = true) {
    const nk = k ?? Math.max(this.cam.k, 0.7);
    this.animateTo({ k: nk, x: this.w / 2 - p.x * nk, y: this.h / 2 - p.y * nk }, animate);
  }
  centerOnNode(id: string) {
    const p = this.scene?.positions.get(id);
    if (p) this.centerOn(p);
  }
  zoomAt(sx: number, sy: number, f: number) {
    const c = this.cam;
    const nk = clamp(c.k * f, 0.02, 6);
    const r = nk / c.k;
    this.tween = null;
    c.x = sx - (sx - c.x) * r;
    c.y = sy - (sy - c.y) * r;
    c.k = nk;
    this.request();
  }
  zoomCenter(f: number) { this.zoomAt(this.w / 2, this.h / 2, f); }
  panBy(dx: number, dy: number) {
    this.tween = null;
    this.cam.x += dx;
    this.cam.y += dy;
    this.request();
  }
  minimapPointer(px: number, py: number) {
    const m = this.mm;
    this.centerOn({ x: (px - m.ox) / m.s + m.minX, y: (py - m.oy) / m.s + m.minY }, this.cam.k, false);
  }

  private frame = (t: number) => {
    this.raf = 0;
    let animating = false;
    if (this.tween) {
      const tw = this.tween;
      const p = Math.min(1, (t - tw.t0) / tw.dur);
      const e = 1 - Math.pow(1 - p, 3);
      this.cam = {
        k: tw.from.k + (tw.to.k - tw.from.k) * e,
        x: tw.from.x + (tw.to.x - tw.from.x) * e,
        y: tw.from.y + (tw.to.y - tw.from.y) * e,
      };
      if (p >= 1) this.tween = null;
      else animating = true;
    }
    if (Math.abs(this.dim - this.dimTarget) > 0.005) {
      const dt = this.lastT ? Math.min(50, t - this.lastT) : 16;
      const step = dt / 180;
      this.dim += Math.sign(this.dimTarget - this.dim) * Math.min(step, Math.abs(this.dimTarget - this.dim));
      animating = true;
    } else this.dim = this.dimTarget;
    this.lastT = animating ? t : 0;
    this.draw();
    if (animating) this.request();
  };

  private img(url: string): HTMLImageElement | null {
    const hit = this.images.get(url);
    if (hit === "error") return null;
    if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null;
    const im = new Image();
    im.decoding = "async";
    im.onload = () => this.request();
    im.onerror = () => this.images.set(url, "error");
    im.src = url;
    this.images.set(url, im);
    return null;
  }

  private draw() {
    const ctx = this.ctx;
    const { k } = this.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.w, this.h);
    // dot grid
    ctx.fillStyle = "rgba(20,33,43,0.10)";
    const gs = 28;
    for (let x = ((this.cam.x % gs) + gs) % gs; x < this.w; x += gs)
      for (let y = ((this.cam.y % gs) + gs) % gs; y < this.h; y += gs) ctx.fillRect(x, y, 1.2, 1.2);
    const s = this.scene;
    if (!s) return;
    const { x: cx, y: cy } = this.cam;
    const pad = 40 / k;
    const ids = s.spatial.query(-cx / k - pad, -cy / k - pad, (this.w - cx) / k + pad, (this.h - cy) / k + pad);
    const vis = s.visible;
    const inView = new Set<string>();
    for (const id of ids) if (!vis || vis.has(id)) inView.add(id);

    const base: DependencyEdge[] = [], dep: DependencyEdge[] = [], dpn: DependencyEdge[] = [];
    const hl = s.highlight;
    const classify = (e: DependencyEdge): void => {
      if (hl) {
        const a = hl.get(e.source), b = hl.get(e.target);
        if (a && b) {
          const aDep = a === "root" || a === "dependency" || a === "both";
          const bDep = b === "dependency" || b === "both";
          if (aDep && bDep && (s.transitive || a === "root")) { dep.push(e); return; }
          const aDpn = a === "dependent" || a === "both";
          const bDpn = b === "root" || b === "dependent" || b === "both";
          if (aDpn && bDpn && (s.transitive || b === "root")) { dpn.push(e); return; }
        }
      }
      base.push(e);
    };
    for (const id of inView) {
      for (const eid of s.index.outgoing.get(id) ?? []) {
        const e = s.index.edges.get(eid);
        if (e && (!vis || vis.has(e.target))) classify(e);
      }
      for (const eid of s.index.incoming.get(id) ?? []) {
        const e = s.index.edges.get(eid);
        if (e && !inView.has(e.source) && (!vis || vis.has(e.source))) classify(e);
      }
    }
     const r = Math.max(2.2, Math.min(k * 18, 24));
    const dimmed = this.dim > 0.01;
    const crowd = base.length > 4000;
    const baseAlpha = (crowd ? 0.28 : 0.5) * (1 - 0.8 * this.dim) + 0.0;
    this.edges(base, "#4a5a64", crowd ? 0.7 : 1, baseAlpha, r, k >= 0.3);
    this.edges(dep, ROLE_COLOR.dependency, 2, 1, r, true);
    this.edges(dpn, ROLE_COLOR.dependent, 2, 1, r, true);

    // nodes
    const faded: string[] = [], normal: string[] = [], strong: string[] = [];
    const m = s.matches;
    for (const id of inView) {
      const f = (hl && !hl.has(id)) || (m && !m.has(id));
      if (hl?.has(id) || id === s.selected || id === this.hovered) strong.push(id);
      else if (f) faded.push(id);
      else normal.push(id);
    }
    const labels: { id: string; x: number; y: number; a: number; bold: boolean }[] = [];
     const showAll = r >= 9 && k >= (s.positions.size <= 200 ? 0.45 : 0.75);
    const drawList = (list: string[], alpha: number) => {
      for (const id of list) {
        const p = s.positions.get(id), n = s.index.nodes.get(id);
        if (!p || !n) continue;
        const sx = p.x * k + cx, sy = p.y * k + cy;
        const role = hl?.get(id);
        this.node(id, sx, sy, r, alpha, role, n.kind, n.icon, s);
        const emph = !!role || id === s.selected || id === this.hovered;
        if ((showAll && labels.length < 500) || (emph && k >= 0.3))
          labels.push({ id, x: sx, y: sy + r + 12, a: alpha, bold: emph });
      }
    };
    drawList(faded, dimmed ? 1 - 0.8 * this.dim : 1);
    drawList(normal, 1);
    drawList(strong, 1);
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    for (const l of labels) {
      const n = s.index.nodes.get(l.id);
      if (!n) continue;
      const t = n.label.length > 28 ? n.label.slice(0, 27) + "\u2026" : n.label;
      ctx.globalAlpha = l.a;
      ctx.font = `${l.bold ? 600 : 500} 11.5px "Bricolage Grotesque", sans-serif`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = BG;
      ctx.strokeText(t, l.x, l.y);
      ctx.fillStyle = "#14212b";
      ctx.fillText(t, l.x, l.y);
    }
    ctx.globalAlpha = 1;
    const key = `${inView.size}|${base.length + dep.length + dpn.length}|${k.toFixed(3)}`;
    if (key !== this.statsKey) {
      this.statsKey = key;
      this.handlers.onStats({
        nodes: inView.size,
        edges: base.length + dep.length + dpn.length,
        total: vis ? vis.size : s.positions.size,
        k,
      });
    }
    this.drawMinimap();
  }

  private edges(list: DependencyEdge[], color: string, width: number, alpha: number, r: number, arrows: boolean) {
    if (!list.length) return;
    const s = this.scene!;
    const { x: cx, y: cy, k } = this.cam;
    const line = new Path2D(), head = new Path2D();
    for (const e of list) {
      const a = s.positions.get(e.source), b = s.positions.get(e.target);
      if (!a || !b) continue;
      const ax = a.x * k + cx, ay = a.y * k + cy, bx = b.x * k + cx, by = b.y * k + cy;
      if (e.source === e.target) {
        const lx = ax + r * 0.9, ly = ay - r * 1.1;
        line.moveTo(lx + 8, ly);
        line.arc(lx, ly, 8, 0, TAU);
        continue;
      }
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 2 * r + 2) continue;
      const mx = (ax + bx) / 2 - (dy / len) * len * 0.1, my = (ay + by) / 2 + (dx / len) * len * 0.1;
      let ux = mx - ax, uy = my - ay;
      let l = Math.hypot(ux, uy);
      ux /= l; uy /= l;
      let vx = mx - bx, vy = my - by;
      l = Math.hypot(vx, vy);
      vx /= l; vy /= l;
      const sx = ax + ux * r, sy = ay + uy * r;
      const ex = bx + vx * (r + 1.5), ey = by + vy * (r + 1.5);
      line.moveTo(sx, sy);
      line.quadraticCurveTo(mx, my, ex, ey);
      if (arrows) {
        const sz = Math.min(8, Math.max(5, len * 0.15));
        const wx = -vx, wy = -vy;
        head.moveTo(ex, ey);
        head.lineTo(ex - wx * sz - wy * sz * 0.5, ey - wy * sz + wx * sz * 0.5);
        head.lineTo(ex - wx * sz + wy * sz * 0.5, ey - wy * sz - wx * sz * 0.5);
        head.closePath();
      }
    }
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(line);
    if (arrows) ctx.fill(head);
    ctx.globalAlpha = 1;
  }

  private node(
    id: string, sx: number, sy: number, r: number, alpha: number,
    role: Role | undefined, kind: keyof typeof KIND_COLOR, icon: string | undefined, s: Scene,
  ) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    const color = KIND_COLOR[kind];
    if (r < 4) {
      ctx.fillStyle = role ? ROLE_COLOR[role] : color;
      const d = role ? r + 1 : r;
      ctx.fillRect(sx - d, sy - d, d * 2, d * 2);
      if (s.cycleIds.has(id)) {
        ctx.strokeStyle = ROLE_COLOR.cycle;
        ctx.lineWidth = 1;
        ctx.strokeRect(sx - d - 1.5, sy - d - 1.5, d * 2 + 3, d * 2 + 3);
      }
      return;
    }
    if (role && role !== "root") {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 4, 0, TAU);
      ctx.fillStyle = ROLE_COLOR[role] + "40";
      ctx.fill();
    }
    if (s.cycleIds.has(id)) {
      ctx.setLineDash([3, 2.5]);
      ctx.strokeStyle = ROLE_COLOR.cycle;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 5, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = role === "root" ? 3 : 1.5;
    ctx.strokeStyle = role === "root" ? ROLE_COLOR.root : "rgba(255,255,255,0.6)";
    ctx.stroke();
    if (r >= 8) {
      const im = icon && r >= 12 ? this.img(icon) : null;
      if (im) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, r - 1, 0, TAU);
        ctx.clip();
        ctx.fillStyle = "#fff";
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
        const sz = r * 1.35;
        ctx.drawImage(im, sx - sz / 2, sy - sz / 2, sz, sz);
        ctx.restore();
      } else {
        const sc = (r * 1.15) / 24;
        ctx.save();
        ctx.translate(sx - sc * 12, sy - sc * 12);
        ctx.scale(sc, sc);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke(getIcons()[kind]);
        ctx.restore();
      }
    }
    if (s.pinned.has(id)) {
      ctx.beginPath();
      ctx.arc(sx + r * 0.75, sy - r * 0.75, 3.6, 0, TAU);
      ctx.fillStyle = ROLE_COLOR.root;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = BG;
      ctx.stroke();
    }
    if (id === s.selected || id === this.hovered) {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 8, 0, TAU);
      ctx.lineWidth = id === s.selected ? 1.8 : 1.2;
      ctx.strokeStyle = id === s.selected ? ROLE_COLOR.root : "rgba(20,33,43,0.45)";
      ctx.stroke();
    }
  }

  private drawMinimap() {
    const c = this.minimap, s = this.scene;
    if (!c || !s) return;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    const d = this.dpr;
    if (c.width !== Math.round(W * d) || c.height !== Math.round(H * d)) {
      c.width = Math.round(W * d);
      c.height = Math.round(H * d);
    }
    const g = c.getContext("2d");
    if (!g) return;
    if (this.mmDirty || !this.mmBounds) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of s.visible ?? s.positions.keys()) {
        const p = s.positions.get(id);
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      this.mmBounds = isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
      this.mmDirty = false;
    }
    const b = this.mmBounds;
    const bw = Math.max(b.maxX - b.minX, 1), bh = Math.max(b.maxY - b.minY, 1);
    // include viewport in bounds so the rectangle stays visible
    const sc = Math.min((W - 14) / bw, (H - 14) / bh);
    this.mm = { minX: b.minX, minY: b.minY, s: sc, ox: (W - bw * sc) / 2, oy: (H - bh * sc) / 2 };
    const m = this.mm;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(241,237,227,0.92)";
    g.fillRect(0, 0, W, H);
    for (const id of s.visible ?? s.positions.keys()) {
      const p = s.positions.get(id);
      if (!p) continue;
      const role = s.highlight?.get(id);
      g.fillStyle = role ? ROLE_COLOR[role] : "rgba(20,33,43,0.55)";
      const z = role ? 3 : 1.6;
      g.fillRect((p.x - m.minX) * m.s + m.ox - z / 2, (p.y - m.minY) * m.s + m.oy - z / 2, z, z);
    }
    const { x, y, k } = this.cam;
    g.strokeStyle = ROLE_COLOR.root;
    g.lineWidth = 1.2;
    g.strokeRect(((-x / k) - m.minX) * m.s + m.ox, ((-y / k) - m.minY) * m.s + m.oy, (this.w / k) * m.s, (this.h / k) * m.s);
  }

  // ---------- interaction ----------
  private local(e: { clientX: number; clientY: number }): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hit(sx: number, sy: number): string | null {
    const s = this.scene;
    if (!s) return null;
    const { x, y, k } = this.cam;
    const wx = (sx - x) / k, wy = (sy - y) / k;
     const rad = (Math.max(2.2, Math.min(k * 18, 24)) + 5) / k;
    if (!s.visible) return s.spatial.nearest({ x: wx, y: wy }, rad);
    let best: string | null = null, bd = Infinity;
    for (const id of s.spatial.query(wx - rad, wy - rad, wx + rad, wy + rad)) {
      if (!s.visible.has(id)) continue;
      const p = s.positions.get(id);
      if (!p) continue;
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d <= rad && d < bd) { bd = d; best = id; }
    }
    return best;
  }

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.ptrs.set(e.pointerId, p);
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.mode = "pinch";
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.moved = true;
      return;
    }
    this.tween = null;
    this.moved = false;
    this.start = p;
    this.last = p;
    this.downId = this.hit(p.x, p.y);
    const sc = this.scene;
    if (this.downId && sc && !sc.pinned.has(this.downId)) {
      this.mode = "drag";
      const np = sc.positions.get(this.downId)!;
      this.dragOff = { x: np.x - (p.x - this.cam.x) / this.cam.k, y: np.y - (p.y - this.cam.y) / this.cam.k };
    } else this.mode = "pan";
  };

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p);
    if (this.mode === "pinch" && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinchDist);
      this.pinchDist = d;
      return;
    }
    if (this.mode === "none") {
      if (e.pointerType !== "mouse") return;
      const id = this.hit(p.x, p.y);
      if (id !== this.hovered) {
        this.hovered = id;
        this.canvas.style.cursor = id ? "pointer" : "grab";
        this.request();
      }
      this.handlers.onHover(id, p.x, p.y);
      return;
    }
    if (!this.moved && Math.hypot(p.x - this.start.x, p.y - this.start.y) < 4) return;
    if (!this.moved) {
      this.moved = true;
      this.hovered = null;
      this.handlers.onHover(null, 0, 0);
    }
    const s = this.scene;
    if (this.mode === "drag" && this.downId && s) {
      const np = { x: (p.x - this.cam.x) / this.cam.k + this.dragOff.x, y: (p.y - this.cam.y) / this.cam.k + this.dragOff.y };
      s.positions.set(this.downId, np);
      s.spatial.update(this.downId, np);
      this.mmDirty = true;
      this.canvas.style.cursor = "grabbing";
      this.request();
    } else if (this.mode === "pan") {
      this.panBy(p.x - this.last.x, p.y - this.last.y);
      this.canvas.style.cursor = "grabbing";
    }
    this.last = p;
  };

  private onUp = (e: PointerEvent) => {
    this.ptrs.delete(e.pointerId);
    if (this.mode === "pinch") {
      if (this.ptrs.size < 2) this.mode = "none";
      return;
    }
    if (this.mode === "none") return;
    if (!this.moved) this.handlers.onSelect(this.downId);
    else if (this.mode === "drag" && this.downId) this.handlers.onDragEnd(this.downId);
    this.mode = "none";
    this.downId = null;
    this.canvas.style.cursor = "grab";
  };

  private onLeave = () => {
    if (this.mode !== "none") return;
    if (this.hovered) { this.hovered = null; this.request(); }
    this.handlers.onHover(null, 0, 0);
  };

  private onDbl = (e: MouseEvent) => {
    const p = this.local(e);
    const id = this.hit(p.x, p.y);
    if (id) this.handlers.onActivate(id);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : 1;
    this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * 0.0015));
  };
}
