import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import type { Scene } from "@/lib/renderer";
import { ICON_PATH, KIND_COLOR, KIND_LABEL } from "@/lib/node-style";
import { KindIcon, type CanvasHandle } from "@/components/graph-canvas";
import { NODE_KINDS, type NodeKind } from "@/graph/types";
import { MAX_LINKS, PAGE_SIZE, type Aggregate, type Emphasis, type GroupModel } from "@/graph/network";

interface Props {
  scene: Scene | null; model: GroupModel; agg: Aggregate; emph: Emphasis | null;
  drill: number | null; members: string[]; page: number;
  onDrill(g: number | null): void; onSelect(id: string | null): void; onActivate(id: string): void; onClear(): void;
  children?: ReactNode;
}
interface Ent { hub: boolean; gi: number; x: number; y: number; r: number; vis: number }
interface DEdge {
  a: number; b: number; count: number; dep: number; dpn: number;
  sx: number; sy: number; cx: number; cy: number; ex: number; ey: number; lx: number; ly: number;
}
interface Mark { id: string; x: number; y: number }
interface Layout { ents: Ent[]; edges: DEdge[]; marks: Mark[]; inner: [Mark, Mark][]; hidden: number; extMore: number; key: string }
type Hit = { t: "group"; i: number } | { t: "node"; id: string } | { t: "edge"; i: number };

const BG = "#f1ede3";
const INK = "#14212b";
const NODE_R = 15;
const icons: Record<string, Path2D> = {};
const icon = (k: string) => (icons[k] ??= new Path2D(ICON_PATH[k as NodeKind]));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function mkEdge(ents: Ent[], a: number, b: number, count: number, em?: { dep: number; dpn: number }): DEdge {
  const A = ents[a]!, B = ents[b]!;
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
  const off = Math.min(len * 0.14, 46);
  const mx = (A.x + B.x) / 2 + (-dy / len) * off, my = (A.y + B.y) / 2 + (dx / len) * off;
  const s = Math.hypot(mx - A.x, my - A.y) || 1, e = Math.hypot(mx - B.x, my - B.y) || 1;
  const sx = A.x + ((mx - A.x) / s) * (A.r + 3), sy = A.y + ((my - A.y) / s) * (A.r + 3);
  const ex = B.x + ((mx - B.x) / e) * (B.r + 6), ey = B.y + ((my - B.y) / e) * (B.r + 6);
  return { a, b, count, dep: em?.dep ?? 0, dpn: em?.dpn ?? 0, sx, sy, cx: mx, cy: my, ex, ey, lx: 0.25 * sx + 0.5 * mx + 0.25 * ex, ly: 0.25 * sy + 0.5 * my + 0.25 * ey };
}

export const NetworkCanvas = forwardRef<CanvasHandle, Props>(function NetworkCanvas(props, ref) {
  const { scene, model, agg, emph, drill, members, page } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const cam = useRef({ x: 0, y: 0, k: 1 });
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const raf = useRef(0);
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const hoverRef = useRef<Hit | null>(null);
  const activeRef = useRef<number | null>(null);
  activeRef.current = active;
  const pendingCenter = useRef<string | null>(null);
  const ovr = useRef(new Map<string, { x: number; y: number }>());
  const ovrOwner = useRef<GroupModel | null>(null);
  const [ver, setVer] = useState(0);
  const [dragging, setDragging] = useState(false);
  const item = useRef<{ kind: "ent" | "node"; idx: number; key: string; ox: number; oy: number } | null>(null);
  const font = useRef("system-ui, sans-serif");

  const layout = useMemo<Layout>(() => {
    const G = model.groups.length;
    const ents: Ent[] = [], edges: DEdge[] = [], marks: Mark[] = [], inner: [Mark, Mark][] = [];
    const lk = `${drill ?? "all"}:${page}:${model.groups.length}`;
    if (ovrOwner.current !== model) { ovr.current.clear(); ovrOwner.current = model; }
    void ver;
    const O = ovr.current;
    if (!scene) return { ents, edges, marks, inner, hidden: 0, extMore: 0, key: lk };
    const g0 = drill !== null ? model.groups[drill] : undefined;
    if (!g0) {
      const idx = new Map<number, number>();
      let hidden = 0;
      for (const g of model.groups) {
        if (agg.vis[g.id]! > 0) { idx.set(g.id, ents.length); { const o = O.get(`g:${g.id}`); ents.push({ hub: false, gi: g.id, x: o?.x ?? g.cx, y: o?.y ?? g.cy, r: g.r, vis: agg.vis[g.id]! }); } }
        else hidden++;
      }
      const sorted = [...agg.pairs].sort((p, q) => q.count - p.count);
      let drawn = 0;
      for (const p of sorted) {
        const ea = idx.get(p.a), eb = idx.get(p.b);
        if (ea === undefined || eb === undefined) continue;
        const em = emph?.pairs.get(p.a * G + p.b);
        if (drawn >= MAX_LINKS && !em) continue;
        drawn++;
        edges.push(mkEdge(ents, ea, eb, p.count, em));
      }
      return { ents, edges, marks, inner, hidden, extMore: 0, key: lk };
    }
    const slice = members.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const cols = Math.max(1, Math.ceil(Math.sqrt(slice.length * 1.3)));
    const sp = 52;
    const rows = Math.ceil(slice.length / cols);
    const pos = new Map<string, Mark>();
    slice.forEach((id, i) => {
      const o = O.get(`n:${id}`);
      const m = { id, x: o?.x ?? ((i % cols) - (cols - 1) / 2) * sp, y: o?.y ?? (Math.floor(i / cols) - (rows - 1) / 2) * sp };
      marks.push(m); pos.set(id, m);
    });
    const hubR = Math.max(110, Math.hypot((cols * sp) / 2, (rows * sp) / 2) + 46);
    ents.push({ hub: true, gi: g0.id, x: 0, y: 0, r: hubR, vis: agg.vis[g0.id] ?? 0 });
    const ext = new Map<number, { out: number; inn: number }>();
    for (const p of agg.pairs) {
      if (p.a === g0.id) { const e = ext.get(p.b) ?? { out: 0, inn: 0 }; e.out = p.count; ext.set(p.b, e); }
      else if (p.b === g0.id) { const e = ext.get(p.a) ?? { out: 0, inn: 0 }; e.inn = p.count; ext.set(p.a, e); }
    }
    const ranked = [...ext].sort((x, y) => y[1].out + y[1].inn - (x[1].out + x[1].inn));
    const shown = ranked.slice(0, 14).sort((x, y) => {
      const ax = Math.atan2(model.groups[x[0]]!.cy - g0.cy, model.groups[x[0]]!.cx - g0.cx);
      const ay = Math.atan2(model.groups[y[0]]!.cy - g0.cy, model.groups[y[0]]!.cx - g0.cx);
      return ax - ay;
    });
    const ringR = hubR + 190;
    shown.forEach(([gi], i) => {
      const ang = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
      const gg = model.groups[gi]!;
      const o = O.get(`e:${g0.id}:${gi}`);
      ents.push({ hub: false, gi, x: o?.x ?? Math.cos(ang) * ringR, y: o?.y ?? Math.sin(ang) * ringR, r: Math.min(50, 18 + 3 * Math.sqrt(gg.members.length)), vis: agg.vis[gi] ?? 0 });
    });
    ents.forEach((en, i) => {
      if (i === 0) return;
      const e = ext.get(en.gi)!;
      if (e.out) edges.push(mkEdge(ents, 0, i, e.out, emph?.pairs.get(g0.id * G + en.gi)));
      if (e.inn) edges.push(mkEdge(ents, i, 0, e.inn, emph?.pairs.get(en.gi * G + g0.id)));
    });
    for (const m of marks) for (const eid of scene.index.outgoing.get(m.id) ?? []) {
      const e = scene.index.edges.get(eid);
      const t = e ? pos.get(e.target) : undefined;
      if (t && t !== m) inner.push([m, t]);
    }
    return { ents, edges, marks, inner, hidden: 0, extMore: Math.max(0, ranked.length - shown.length), key: lk };
  }, [scene, model, agg, emph, drill, members, page, ver]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const modelRef = useRef(model);
  modelRef.current = model;

  const draw = () => {
    raf.current = 0;
    const c = cvs.current, sc = sceneRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const { w, h, dpr } = size.current;
    const L = layoutRef.current, M = modelRef.current, hl = sc?.highlight ?? null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
    const { x, y, k } = cam.current;
    ctx.translate(x, y); ctx.scale(k, k);
    ctx.lineCap = "round"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const hv = hoverRef.current, act = activeRef.current;
    const G = M.groups.length;
    const rootG = sc?.selected ? M.groupOf.get(sc.selected) : undefined;
    const overview = L.ents.length > 0 && !L.ents[0]!.hub;

    // hub boundary
    const hub = L.ents[0];
    if (hub?.hub) {
      const g = M.groups[hub.gi]!;
      ctx.beginPath(); ctx.arc(hub.x, hub.y, hub.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(251,248,240,.75)"; ctx.fill();
      ctx.setLineDash([8 / k, 6 / k]); ctx.lineWidth = 1.5 / k; ctx.strokeStyle = "rgba(20,33,43,.45)"; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = INK; ctx.font = `700 ${14 / k}px ${font.current}`;
      ctx.fillText(`${g.label}  ·  ${hub.vis.toLocaleString()} of ${g.members.length.toLocaleString()} nodes`, hub.x, hub.y - hub.r - 14 / k);
    }

    // aggregated links
    const emphasized = (e: DEdge) => e.dep > 0 || e.dpn > 0;
    const strokeEdge = (e: DEdge, i: number) => {
      const em = emphasized(e), isHover = hv?.t === "edge" && hv.i === i;
      const color = e.dep && e.dpn ? "#7a6a1e" : e.dep ? "#14876a" : e.dpn ? "#d98a0b" : INK;
      const alpha = isHover ? 0.95 : em ? 0.9 : hl ? 0.07 : 0.26;
      const wpx = clamp(0.9 + Math.log2(e.count + 1) * 0.55, 1, 6) + (isHover ? 1.5 : 0);
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = wpx / k;
      ctx.beginPath(); ctx.moveTo(e.sx, e.sy); ctx.quadraticCurveTo(e.cx, e.cy, e.ex, e.ey); ctx.stroke();
      const ang = Math.atan2(e.ey - e.cy, e.ex - e.cx), s = (6 + wpx) / k;
      ctx.beginPath(); ctx.moveTo(e.ex, e.ey);
      ctx.lineTo(e.ex - Math.cos(ang - 0.42) * s, e.ey - Math.sin(ang - 0.42) * s);
      ctx.lineTo(e.ex - Math.cos(ang + 0.42) * s, e.ey - Math.sin(ang + 0.42) * s);
      ctx.closePath(); ctx.fill();
    };
    L.edges.forEach((e, i) => { if (!emphasized(e) && !(hv?.t === "edge" && hv.i === i)) strokeEdge(e, i); });
    L.edges.forEach((e, i) => { if (emphasized(e) || (hv?.t === "edge" && hv.i === i)) strokeEdge(e, i); });
    ctx.globalAlpha = 1;

    // node-level internal edges in drill view
    if (L.inner.length) {
      for (const [s, t] of L.inner) {
        const rs = hl?.get(s.id), rt = hl?.get(t.id);
        const on = !hl || (rs && rt);
        ctx.globalAlpha = on ? 0.4 : 0.07; ctx.strokeStyle = INK; ctx.lineWidth = 1 / k;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        if (k > 0.8 && on) {
          const a = Math.atan2(t.y - s.y, t.x - s.x), tx = t.x - Math.cos(a) * (NODE_R + 2), ty = t.y - Math.sin(a) * (NODE_R + 2), z = 6 / k;
          ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(tx, ty);
          ctx.lineTo(tx - Math.cos(a - 0.45) * z, ty - Math.sin(a - 0.45) * z); ctx.lineTo(tx - Math.cos(a + 0.45) * z, ty - Math.sin(a + 0.45) * z); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // group bubbles
    L.ents.forEach((en, i) => {
      if (en.hub) return;
      const g = M.groups[en.gi]!;
      const role = emph?.groups.get(g.id);
      const involved = !hl || !!role;
      const isHover = hv?.t === "group" && hv.i === i;
      ctx.globalAlpha = involved ? 1 : 0.4;
      ctx.beginPath(); ctx.arc(en.x, en.y, en.r, 0, Math.PI * 2);
      ctx.fillStyle = isHover || act === g.id ? "#fffdf6" : "#fbf8f0"; ctx.fill();
      // kind mix donut
      let a0 = -Math.PI / 2;
      const tot = g.members.length;
      ctx.lineWidth = Math.max(4, en.r * 0.1);
      for (const kd of NODE_KINDS) {
        const n = g.kinds[kd]; if (!n) continue;
        const a1 = a0 + (n / tot) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(en.x, en.y, en.r - ctx.lineWidth / 2, a0, a1 - 0.02); ctx.strokeStyle = KIND_COLOR[kd]; ctx.stroke(); a0 = a1;
      }
      // role halo
      const root = g.id === rootG;
      const halo = root ? INK : role && role.dep && role.dpn ? "#7a6a1e" : role?.dep ? "#14876a" : role?.dpn ? "#d98a0b" : null;
      if (halo || isHover || act === g.id) {
        ctx.beginPath(); ctx.arc(en.x, en.y, en.r + 3.5 / k * (root ? 1.2 : 1), 0, Math.PI * 2);
        ctx.lineWidth = (root ? 3.5 : 2.5) / k; ctx.strokeStyle = halo ?? "#3aa7a0"; ctx.stroke();
      }
      if (g.cycle > 0) {
        ctx.beginPath(); ctx.arc(en.x, en.y, en.r + 8 / k, 0, Math.PI * 2);
        ctx.setLineDash([4 / k, 4 / k]); ctx.lineWidth = 1.6 / k; ctx.strokeStyle = "#c0203f"; ctx.stroke(); ctx.setLineDash([]);
      }
      // icon of dominant kind
      const dom = NODE_KINDS.reduce((m, kd) => ((g.kinds[kd] ?? 0) > (g.kinds[m] ?? 0) ? kd : m), NODE_KINDS[0]);
      const s = (en.r * 0.5) / 24;
      ctx.save(); ctx.translate(en.x - 12 * s, en.y - en.r * 0.5 - 2 * s); ctx.scale(s, s);
      ctx.lineWidth = 2 / s * (1 / Math.max(k, 0.4)) * 0.6 + 1.2; ctx.strokeStyle = KIND_COLOR[dom]; ctx.lineJoin = "round"; ctx.stroke(icon(dom)); ctx.restore();
      ctx.globalAlpha = involved ? 1 : 0.4;
      const px = en.r * k;
      if (px >= 17 || isHover || act === g.id || root) {
        ctx.fillStyle = INK;
        const fs = clamp(en.r * 0.24, 9, 15);
        ctx.font = `700 ${fs}px ${font.current}`;
        let t = g.label; const maxW = en.r * 1.55;
        while (t.length > 3 && ctx.measureText(t).width > maxW) t = t.slice(0, -2);
        if (t !== g.label) t += "...";
        ctx.fillText(t, en.x, en.y + en.r * 0.18);
        ctx.font = `500 ${fs * 0.82}px ${font.current}`; ctx.fillStyle = "#5b6670";
        ctx.fillText(en.vis === g.members.length ? `${en.vis.toLocaleString()} nodes` : `${en.vis.toLocaleString()} of ${g.members.length.toLocaleString()}`, en.x, en.y + en.r * 0.18 + fs * 1.15);
      }
      if (role && px >= 18) {
        const t = `${role.dep ? role.dep + " needs" : ""}${role.dep && role.dpn ? " / " : ""}${role.dpn ? role.dpn + " used-by" : ""}`;
        ctx.font = `600 ${11 / k}px ${font.current}`;
        const tw = ctx.measureText(t).width + 10 / k;
        ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(en.x - tw / 2, en.y + en.r + 6 / k, tw, 16 / k, 8 / k); ctx.fill();
        ctx.fillStyle = "#f1ede3"; ctx.fillText(t, en.x, en.y + en.r + 14 / k);
      }
      if (sc?.matches) {
        let mc = 0; for (const id of g.members) if (sc.matches.has(id)) mc++;
        if (mc) {
          const t = String(mc); ctx.font = `700 ${10 / k}px ${font.current}`;
          const tw = Math.max(16 / k, ctx.measureText(t).width + 8 / k);
          ctx.fillStyle = "#e9b44c"; ctx.beginPath(); ctx.roundRect(en.x + en.r * 0.6, en.y - en.r * 0.95, tw, 15 / k, 7 / k); ctx.fill();
          ctx.fillStyle = INK; ctx.fillText(t, en.x + en.r * 0.6 + tw / 2, en.y - en.r * 0.95 + 7.5 / k);
        }
      }
      ctx.globalAlpha = 1;
    });

    // link count labels
    if (L.edges.length) {
      const order = L.edges.map((e, i) => ({ e, i })).filter(({ e, i }) => emphasized(e) || (hv?.t === "edge" && hv.i === i) || (!hl && (overview ? k > 0.5 && L.edges.length < 90 : true)))
        .sort((p, q) => q.e.count - p.e.count).slice(0, 80);
      ctx.font = `700 ${10.5 / k}px ${font.current}`;
      for (const { e } of order) {
        const t = e.count.toLocaleString(), tw = ctx.measureText(t).width + 9 / k;
        ctx.fillStyle = "#fbf8f0"; ctx.strokeStyle = emphasized(e) ? (e.dep ? "#14876a" : "#d98a0b") : "rgba(20,33,43,.35)"; ctx.lineWidth = 1 / k;
        ctx.beginPath(); ctx.roundRect(e.lx - tw / 2, e.ly - 7.5 / k, tw, 15 / k, 7 / k); ctx.fill(); ctx.stroke();
        ctx.fillStyle = INK; ctx.fillText(t, e.lx, e.ly + 0.5 / k);
      }
    }

    // nodes in drill view
    for (const m of L.marks) {
      const n = sc?.index.nodes.get(m.id); if (!n) continue;
      const role = hl?.get(m.id);
      const dim = hl && !role;
      const isHover = hv?.t === "node" && hv.id === m.id;
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.beginPath(); ctx.arc(m.x, m.y, NODE_R, 0, Math.PI * 2); ctx.fillStyle = KIND_COLOR[n.kind]; ctx.fill();
      const s = 15 / 24;
      ctx.save(); ctx.translate(m.x - 12 * s, m.y - 12 * s); ctx.scale(s, s); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke(icon(n.kind)); ctx.restore();
      const ring = role === "root" ? INK : role === "dependency" ? "#14876a" : role === "dependent" ? "#d98a0b" : role === "both" ? "#7a6a1e" : isHover ? "#3aa7a0" : null;
      if (ring) { ctx.beginPath(); ctx.arc(m.x, m.y, NODE_R + 3.5, 0, Math.PI * 2); ctx.lineWidth = role === "root" ? 3.5 : 2.5; ctx.strokeStyle = ring; ctx.stroke(); }
      if (sc?.cycleIds.has(m.id)) { ctx.beginPath(); ctx.arc(m.x, m.y, NODE_R + 8, 0, Math.PI * 2); ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = "#c0203f"; ctx.stroke(); ctx.setLineDash([]); }
      if (sc?.pinned.has(m.id)) { ctx.beginPath(); ctx.arc(m.x - 12, m.y - 12, 5.5, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill(); ctx.beginPath(); ctx.arc(m.x - 12, m.y - 12, 1.8, 0, Math.PI * 2); ctx.fillStyle = "#f1ede3"; ctx.fill(); }
      if (sc?.matches?.has(m.id)) { ctx.beginPath(); ctx.arc(m.x + 12, m.y - 12, 4.5, 0, Math.PI * 2); ctx.fillStyle = "#e9b44c"; ctx.fill(); }
      if (k > 0.9 || isHover || role === "root") {
        ctx.font = `600 ${10.5}px ${font.current}`; ctx.fillStyle = INK;
        let t = n.label; while (t.length > 4 && ctx.measureText(t).width > 74) t = t.slice(0, -2);
        ctx.fillText(t === n.label ? t : t + "...", m.x, m.y + NODE_R + 12);
      }
      ctx.globalAlpha = 1;
    }

    // external group bubbles in drill view are drawn above via the group loop; guard unused
    void G;
  };
  const request = () => { if (!raf.current) raf.current = requestAnimationFrame(draw); };
  const drillRef = useRef(drill);
  drillRef.current = drill;
  const requestRef = useRef(request);
  requestRef.current = request;

  const fitPts = (pts: { x: number; y: number; r: number }[]) => {
    const { w, h } = size.current;
    if (!pts.length || !w || !h) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x - p.r); y0 = Math.min(y0, p.y - p.r); x1 = Math.max(x1, p.x + p.r); y1 = Math.max(y1, p.y + p.r); }
    const padT = 110, pad = 50;
    const k = clamp(Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad - padT) / Math.max(1, y1 - y0)), 0.02, 2);
    cam.current = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: padT + (h - padT - pad) / 2 - ((y0 + y1) / 2) * k };
    request();
  };
  const entPoint = (id: string) => {
    const L = layoutRef.current;
    const m = L.marks.find((q) => q.id === id);
    if (m) return { x: m.x, y: m.y, r: NODE_R };
    const g = modelRef.current.groupOf.get(id);
    const e = L.ents.find((q) => q.gi === g);
    return e ? { x: e.x, y: e.y, r: e.r } : null;
  };
  const tryCenter = () => {
    const id = pendingCenter.current;
    if (!id) return;
    const p = entPoint(id);
    if (!p) return;
    pendingCenter.current = null;
    const { w, h } = size.current, k = cam.current.k;
    cam.current = { k, x: w / 2 - p.x * k, y: h / 2 - p.y * k };
    request();
  };

  useImperativeHandle(ref, () => ({
    fit: (ids) => {
      const L = layoutRef.current;
      if (ids) {
        const pts = [...ids].map(entPoint).filter((p): p is { x: number; y: number; r: number } => !!p);
        if (pts.length) return fitPts(pts);
      }
      fitPts([...L.ents, ...L.marks.map((m) => ({ x: m.x, y: m.y, r: NODE_R + 20 }))]);
    },
    centerOn: (id) => { pendingCenter.current = id; tryCenter(); },
  }), []);

  useEffect(() => {
    fitPts([...layout.ents, ...layout.marks.map((m) => ({ x: m.x, y: m.y, r: NODE_R + 20 }))]);
    tryCenter();
    setHover(null); hoverRef.current = null;
  }, [layout.key, model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active !== null && !layout.ents.some((e) => e.gi === active)) setActive(null); }, [layout, active]);
  useEffect(() => { request(); }, [layout, scene, emph, active, hover]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = cvs.current, wr = wrap.current;
    if (!el || !wr) return;
    font.current = getComputedStyle(document.body).fontFamily || font.current;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1, w = wr.clientWidth, h = wr.clientHeight;
      const first = size.current.w === 0;
      size.current = { w, h, dpr };
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      if (first) fitPts([...layoutRef.current.ents, ...layoutRef.current.marks.map((m) => ({ x: m.x, y: m.y, r: NODE_R + 20 }))]);
      requestRef.current();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wr); resize();
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect(), c = cam.current;
      const k = clamp(c.k * Math.exp(-e.deltaY * 0.0015), 0.02, 6), px = e.clientX - b.left, py = e.clientY - b.top;
      cam.current = { k, x: px - ((px - c.x) / c.k) * k, y: py - ((py - c.y) / c.k) * k };
      requestRef.current();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", wheel); cancelAnimationFrame(raf.current); raf.current = 0; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hitTest = (px: number, py: number): Hit | null => {
    const { x, y, k } = cam.current, L = layoutRef.current;
    const wx = (px - x) / k, wy = (py - y) / k;
    for (const m of L.marks) if (Math.hypot(m.x - wx, m.y - wy) <= NODE_R + 3) return { t: "node", id: m.id };
    for (let i = L.ents.length - 1; i >= 0; i--) { const e = L.ents[i]!; if (!e.hub && Math.hypot(e.x - wx, e.y - wy) <= e.r + 2) return { t: "group", i }; }
    let best = -1, bd = 12;
    L.edges.forEach((e, i) => { const d = Math.hypot(e.lx * k + x - px, e.ly * k + y - py); if (d < bd) { bd = d; best = i; } });
    return best >= 0 ? { t: "edge", i: best } : null;
  };
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const b = e.currentTarget.getBoundingClientRect();
    const hit = hitTest(e.clientX - b.left, e.clientY - b.top), L = layoutRef.current, c = cam.current;
    item.current = null;
    if (hit?.t === "node") {
      const m = L.marks.find((q) => q.id === hit.id)!;
      if (!sceneRef.current?.pinned.has(hit.id))
        item.current = { kind: "node", idx: L.marks.indexOf(m), key: `n:${hit.id}`, ox: m.x - (e.clientX - b.left - c.x) / c.k, oy: m.y - (e.clientY - b.top - c.y) / c.k };
    } else if (hit?.t === "group") {
      const en = L.ents[hit.i]!, d = drillRef.current;
      item.current = { kind: "ent", idx: hit.i, key: d === null ? `g:${en.gi}` : `e:${d}:${en.gi}`, ox: en.x - (e.clientX - b.left - c.x) / c.k, oy: en.y - (e.clientY - b.top - c.y) / c.k };
    }
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current, b = e.currentTarget.getBoundingClientRect();
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      const it = item.current;
      if (d.moved && it) {
        const c = cam.current, L = layoutRef.current;
        const wx = (e.clientX - b.left - c.x) / c.k + it.ox, wy = (e.clientY - b.top - c.y) / c.k + it.oy;
        if (it.kind === "node") { const m = L.marks[it.idx]!; m.x = wx; m.y = wy; }
        else {
          const en = L.ents[it.idx]!; en.x = wx; en.y = wy;
          L.edges.forEach((ed, i) => { if (ed.a === it.idx || ed.b === it.idx) L.edges[i] = { ...mkEdge(L.ents, ed.a, ed.b, ed.count, ed), }; });
        }
        ovr.current.set(it.key, { x: wx, y: wy });
        setDragging(true); request(); return;
      }
      if (it && !d.moved) return;
      if (d.moved) { cam.current = { ...cam.current, x: d.cx + dx, y: d.cy + dy }; request(); }
      return;
    }
    const hit = hitTest(e.clientX - b.left, e.clientY - b.top);
    hoverRef.current = hit;
    setHover(hit ? { hit, x: e.clientX - b.left, y: e.clientY - b.top } : null);
  };
  const endDrag = () => {
    const had = item.current && drag.current?.moved;
    drag.current = null; item.current = null; setDragging(false);
    if (had) setVer((v) => v + 1);
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const movedItem = !!(d?.moved && item.current);
    endDrag();
    if (!d || d.moved || movedItem) return;
    const b = e.currentTarget.getBoundingClientRect();
    const hit = hitTest(e.clientX - b.left, e.clientY - b.top);
    if (hit?.t === "node") props.onSelect(hit.id);
    else if (hit?.t === "group") setActive(layoutRef.current.ents[hit.i]!.gi);
    else { setActive(null); props.onSelect(null); }
  };
  const onDbl = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const hit = hitTest(e.clientX - b.left, e.clientY - b.top);
    if (hit?.t === "node") props.onActivate(hit.id);
    else if (hit?.t === "group") props.onDrill(layoutRef.current.ents[hit.i]!.gi);
  };
  const zoom = (f: number) => { const { w, h } = size.current, c = cam.current, k = clamp(c.k * f, 0.02, 6); cam.current = { k, x: w / 2 - ((w / 2 - c.x) / c.k) * k, y: h / 2 - ((h / 2 - c.y) / c.k) * k }; request(); };
  const pan = (dx: number, dy: number) => { cam.current = { ...cam.current, x: cam.current.x + dx, y: cam.current.y + dy }; request(); };
  const onKey = (e: KeyboardEvent) => {
    const st = e.shiftKey ? 160 : 60;
    const map: Record<string, () => void> = {
      ArrowLeft: () => pan(st, 0), ArrowRight: () => pan(-st, 0), ArrowUp: () => pan(0, st), ArrowDown: () => pan(0, -st),
      "+": () => zoom(1.25), "=": () => zoom(1.25), "-": () => zoom(0.8),
      "0": () => fitPts([...layout.ents, ...layout.marks.map((m) => ({ x: m.x, y: m.y, r: NODE_R + 20 }))]),
      Escape: () => { setActive(null); props.onClear(); },
      Enter: () => { if (active !== null) props.onDrill(active); },
    };
    const fn = map[e.key];
    if (fn) { e.preventDefault(); fn(); }
  };

  const links = useMemo(() => {
    if (active === null) return null;
    const out = agg.pairs.filter((p) => p.a === active).sort((a, b) => b.count - a.count);
    const inn = agg.pairs.filter((p) => p.b === active).sort((a, b) => b.count - a.count);
    return { out, inn, outTotal: out.reduce((s, p) => s + p.count, 0), inTotal: inn.reduce((s, p) => s + p.count, 0) };
  }, [active, agg]);

  const hvk = hover?.hit;
  const hoverPinned = hvk?.t === "node" && !!scene?.pinned.has(hvk.id);
  const cursor = dragging ? "grabbing" : hoverPinned ? "not-allowed" : hvk?.t === "node" || hvk?.t === "group" ? "grab" : "default";
  const ag = active !== null ? model.groups[active] : null;
  const w = size.current.w || 800;
  const hv = hover?.hit;
  const hg = hv?.t === "group" ? model.groups[layout.ents[hv.i]!.gi] : null;
  const he = hv?.t === "edge" ? layout.edges[hv.i] : null;
  const hn = hv?.t === "node" ? scene?.index.nodes.get(hv.id) : null;
  const kindMix = (kinds: Record<string, number>) => NODE_KINDS.filter((k) => kinds[k]).map((k) => `${kinds[k]!.toLocaleString()} ${KIND_LABEL[k].toLowerCase()}`).join(", ");
  const gl = (i: number) => model.groups[i]?.label ?? "";
  const cardPos = hover ? { left: Math.max(8, hover.x > w - 320 ? hover.x - 296 : hover.x + 18), top: Math.max(8, Math.min(hover.y + 14, (wrap.current?.clientHeight ?? 600) - 250)) } : undefined;

  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={cvs} tabIndex={0} role="application"
        aria-label="Grouped dependency network. Arrow keys pan, plus and minus zoom, 0 fits, Enter opens the selected group, Escape clears. Use the node list for keyboard selection of nodes."
        onKeyDown={onKey} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onDoubleClick={onDbl}
        onPointerLeave={() => { if (!drag.current) { hoverRef.current = null; setHover(null); } }}
        style={{ cursor }}
        className="absolute inset-0 h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid="canvas-network"
      />
      {props.children}

      {hover && cardPos && (hg || he || hn) && (
        <div className="hc-in pointer-events-none absolute z-20 w-[280px] rounded-lg border border-border bg-popover p-3 shadow-[0_10px_30px_-8px_hsl(205_40%_12%/.35)]" style={cardPos} data-testid="hovercard-network">
          {hg && (() => {
            const gi = hg.id, out = agg.pairs.filter((p) => p.a === gi), inn = agg.pairs.filter((p) => p.b === gi);
            return (<>
              <div className="truncate text-sm font-semibold">{hg.label}</div>
              <div className="mono text-[10.5px] text-muted-foreground">{hg.fallback ? "Group: no owner set on these nodes" : hg.synthetic ? "Group: synthetic owner label" : "Group: owner"}</div>
              <dl className="mono mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                <dt className="text-muted-foreground">nodes</dt><dd>{(agg.vis[gi] ?? 0).toLocaleString()} visible of {hg.members.length.toLocaleString()}</dd>
                <dt className="text-muted-foreground">kinds</dt><dd className="truncate">{kindMix(hg.kinds)}</dd>
                <dt className="text-muted-foreground">inside group</dt><dd>{(agg.internal[gi] ?? 0).toLocaleString()} edges</dd>
                <dt className="text-muted-foreground">depends on</dt><dd>{out.reduce((s, p) => s + p.count, 0).toLocaleString()} edges, {out.length} groups</dd>
                <dt className="text-muted-foreground">used by</dt><dd>{inn.reduce((s, p) => s + p.count, 0).toLocaleString()} edges, {inn.length} groups</dd>
              </dl>
              {hg.cycle > 0 && <p className="mt-2 text-[11px] font-semibold text-[hsl(var(--cyc))]">{hg.cycle} node{hg.cycle === 1 ? "" : "s"} in dependency cycles</p>}
              <p className="mt-1.5 text-[10.5px] text-muted-foreground">Click for links. Double click to open.</p>
            </>);
          })()}
          {he && (
            <>
              <div className="text-sm font-semibold">{gl(layout.ents[he.a]!.gi)} <span className="text-muted-foreground">depends on</span> {gl(layout.ents[he.b]!.gi)}</div>
              <div className="mono mt-1 text-xs">{he.count.toLocaleString()} dependency edge{he.count === 1 ? "" : "s"} aggregated</div>
              {(he.dep > 0 || he.dpn > 0) && <div className="mono mt-1 text-[11px] text-muted-foreground">{he.dep ? `${he.dep} on the dependencies path` : ""}{he.dep && he.dpn ? " / " : ""}{he.dpn ? `${he.dpn} on the dependents path` : ""}</div>}
              <p className="mt-1.5 text-[10.5px] text-muted-foreground">The opposite direction is a separate line.</p>
            </>
          )}
          {hn && (
            <>
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white" style={{ background: KIND_COLOR[hn.kind] }}><KindIcon kind={hn.kind} size={16} /></span>
                <div className="min-w-0"><div className="truncate text-sm font-semibold">{hn.label}</div><div className="mono truncate text-[10.5px] text-muted-foreground">{hn.id}</div></div>
              </div>
              {hn.description && <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{hn.description}</p>}
              <dl className="mono mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                <dt className="text-muted-foreground">kind</dt><dd>{KIND_LABEL[hn.kind]}</dd>
                {hn.owner && (<><dt className="text-muted-foreground">owner</dt><dd className="truncate">{hn.owner}</dd></>)}
                {hn.version && (<><dt className="text-muted-foreground">version</dt><dd>{hn.version}</dd></>)}
                <dt className="text-muted-foreground">depends on</dt><dd>{scene?.index.outgoing.get(hn.id)?.length ?? 0} edges</dd>
                <dt className="text-muted-foreground">used by</dt><dd>{scene?.index.incoming.get(hn.id)?.length ?? 0} edges</dd>
              </dl>
              {scene?.pinned.has(hn.id) && <p className="mono mt-2 text-[11px] font-semibold" data-testid="text-pinned">Pinned: position locked, cannot be dragged</p>}
              {scene?.cycleIds.has(hn.id) && <p className="mt-2 text-[11px] font-semibold text-[hsl(var(--cyc))]">Member of a dependency cycle</p>}
              {hn.tags && hn.tags.length > 0 && <p className="mono mt-1.5 truncate text-[10.5px] text-muted-foreground">{hn.tags.join(" / ")}</p>}
            </>
          )}
        </div>
      )}

      {ag && links && (
        <div className="panel-in absolute bottom-[11rem] left-3 z-10 w-[300px] max-w-[calc(100%-1.5rem)] rounded-lg border border-border bg-card p-3 shadow-lg sm:bottom-[6.5rem]" data-testid="panel-group">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold" data-testid="text-group-label">{ag.label}</div>
              <div className="mono text-[10.5px] text-muted-foreground">{(agg.vis[ag.id] ?? 0).toLocaleString()} of {ag.members.length.toLocaleString()} nodes visible / {(agg.internal[ag.id] ?? 0).toLocaleString()} internal edges</div>
            </div>
            <button aria-label="Close group card" onClick={() => setActive(null)} className="rounded p-1 hover:bg-muted"><X size={14} /></button>
          </div>
          {([["Depends on", links.out, links.outTotal, "b", "text-[hsl(var(--dep))]"], ["Used by", links.inn, links.inTotal, "a", "text-[hsl(var(--dpn))]"]] as const).map(([title, list, total, side, cls]) => (
            <div key={title} className="mt-2">
              <div className={`text-[11px] font-semibold ${cls}`}>{title}: {total.toLocaleString()} edges across {list.length} group{list.length === 1 ? "" : "s"}</div>
              <ul className="mt-0.5 max-h-[72px] overflow-auto text-[11px]">
                {list.slice(0, 8).map((p) => (
                  <li key={p.a + "-" + p.b}><button className="flex w-full justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted" onClick={() => setActive(side === "b" ? p.b : p.a)}><span className="truncate">{gl(side === "b" ? p.b : p.a)}</span><span className="mono">{p.count.toLocaleString()}</span></button></li>
                ))}
                {list.length === 0 && <li className="px-1 text-muted-foreground">none between groups</li>}
              </ul>
            </div>
          ))}
          <button className="mt-2 w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" onClick={() => props.onDrill(ag.id)} data-testid="button-open-group">Open group ({(agg.vis[ag.id] ?? 0).toLocaleString()} nodes)</button>
        </div>
      )}

      <div className="absolute bottom-[3.5rem] right-3 z-10 flex overflow-hidden rounded-lg border border-border bg-card shadow-md md:bottom-3">
        <button disabled={ovr.current.size === 0} onClick={() => { ovr.current.clear(); setVer((v) => v + 1); }} className="border-r border-border px-2.5 text-[11px] font-medium hover:bg-muted disabled:opacity-40" title="Discard session-only network arrangement" data-testid="button-net-reset-arrangement">Reset arrangement{ovr.current.size ? ` (${ovr.current.size})` : ""}</button>
        {[
          { l: "Zoom out", i: <Minus size={15} />, f: () => zoom(0.8), t: "zoom-out" },
          { l: "Zoom in", i: <Plus size={15} />, f: () => zoom(1.25), t: "zoom-in" },
          { l: "Fit to screen", i: <Maximize2 size={14} />, f: () => fitPts([...layout.ents, ...layout.marks.map((m) => ({ x: m.x, y: m.y, r: NODE_R + 20 }))]), t: "fit" },
        ].map((b) => (
          <button key={b.t} aria-label={b.l} title={b.l} onClick={b.f} data-testid={`button-net-${b.t}`} className="grid h-9 w-9 place-items-center hover:bg-muted active:bg-secondary">{b.i}</button>
        ))}
      </div>
      <div className="mono pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 rounded-md border border-border bg-card/90 px-2.5 py-1 text-[10.5px] text-muted-foreground backdrop-blur xl:block" role="status" data-testid="text-network-stats">
        {drill === null
          ? `${layout.ents.length.toLocaleString()} groups shown${layout.hidden ? `, ${layout.hidden} hidden by filters` : ""} / ${layout.edges.length.toLocaleString()} links drawn`
          : `${layout.marks.length} of ${members.length.toLocaleString()} nodes on this page / ${layout.inner.length.toLocaleString()} edges among them${layout.extMore ? ` / ${layout.extMore} more linked groups not drawn` : ""}`}
      </div>
    </div>
  );
});
