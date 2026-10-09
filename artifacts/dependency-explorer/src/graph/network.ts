import type { DependencyNode, GraphIndex, Point } from "./types";
import type { Role } from "@/lib/renderer";

/** Pure projection of a graph into owner groups and aggregated, directed group-to-group links. No model state is changed. */
export const UNASSIGNED = "Unassigned (no owner)";
export const PAGE_SIZE = 120;
export const MAX_LINKS = 700;

export interface Group {
  id: number; label: string; members: string[]; cx: number; cy: number; r: number;
  kinds: Record<string, number>; cycle: number; fallback: boolean; synthetic: boolean;
}
export interface GroupModel {
  groups: Group[]; groupOf: Map<string, number>; layout: "supplied" | "grid"; unassigned: number;
}
export interface Aggregate {
  /** One entry per ordered group pair a -> b ("a depends on b"). a->b and b->a are separate. */
  pairs: { a: number; b: number; count: number }[];
  internal: number[]; vis: number[]; cross: number; internalTotal: number;
}
export interface Emphasis {
  pairs: Map<number, { dep: number; dpn: number }>;
  groups: Map<number, { dep: number; dpn: number; root: boolean }>;
}

export function buildGroupModel(nodes: DependencyNode[], supplied: Map<string, Point>, cycleIds: ReadonlySet<string>): GroupModel {
  const by = new Map<string, DependencyNode[]>();
  for (const n of nodes) {
    const k = n.owner?.trim() ?? "";
    const arr = by.get(k);
    if (arr) arr.push(n); else by.set(k, [n]);
  }
  const keys = [...by.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  const groups: Group[] = [];
  const groupOf = new Map<string, number>();
  for (const k of keys) {
    const ns = by.get(k)!;
    const g: Group = {
      id: groups.length, label: k || UNASSIGNED, members: ns.map((n) => n.id), cx: 0, cy: 0,
      r: Math.min(90, 34 + 5 * Math.sqrt(ns.length)), kinds: {}, cycle: 0, fallback: k === "", synthetic: /^Team \d+$/.test(k),
    };
    let sx = 0, sy = 0, c = 0;
    for (const n of ns) {
      groupOf.set(n.id, g.id);
      g.kinds[n.kind] = (g.kinds[n.kind] ?? 0) + 1;
      if (cycleIds.has(n.id)) g.cycle++;
      const p = supplied.get(n.id);
      if (p) { sx += p.x; sy += p.y; c++; }
    }
    g.cx = c ? sx / c : 0; g.cy = c ? sy / c : 0;
    groups.push(g);
  }
  let layout: GroupModel["layout"] = "supplied";
  if (groups.length > 40) layout = "grid";
  else {
    outer: for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i]!, b = groups[j]!;
      if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r + 30) { layout = "grid"; break outer; }
    }
  }
  if (layout === "grid") {
    const maxR = groups.reduce((m, g) => Math.max(m, g.r), 20);
    const cell = 2 * maxR + 56;
    const cols = Math.max(1, Math.ceil(Math.sqrt(groups.length)));
    groups.forEach((g, i) => { g.cx = (i % cols) * cell; g.cy = Math.floor(i / cols) * cell; });
  }
  return { groups, groupOf, layout, unassigned: by.get("")?.length ?? 0 };
}

export function aggregate(index: GraphIndex, model: GroupModel, visible: Set<string> | null): Aggregate {
  const G = model.groups.length;
  const m = new Map<number, number>();
  const internal = new Array<number>(G).fill(0);
  const vis = new Array<number>(G).fill(0);
  if (visible) for (const id of visible) { const g = model.groupOf.get(id); if (g !== undefined) vis[g]!++; }
  else model.groups.forEach((g) => { vis[g.id] = g.members.length; });
  let cross = 0, internalTotal = 0;
  for (const e of index.edges.values()) {
    if (visible && !(visible.has(e.source) && visible.has(e.target))) continue;
    const a = model.groupOf.get(e.source), b = model.groupOf.get(e.target);
    if (a === undefined || b === undefined) continue;
    if (a === b) { internal[a]!++; internalTotal++; continue; }
    cross++;
    const k = a * G + b;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const pairs = [...m].map(([k, count]) => ({ a: Math.floor(k / G), b: k % G, count }));
  return { pairs, internal, vis, cross, internalTotal };
}

export function emphasis(index: GraphIndex, model: GroupModel, highlight: Map<string, Role> | null): Emphasis | null {
  if (!highlight) return null;
  const G = model.groups.length;
  const pairs = new Map<number, { dep: number; dpn: number }>();
  const groups = new Map<number, { dep: number; dpn: number; root: boolean }>();
  for (const [id, r] of highlight) {
    const g = model.groupOf.get(id);
    if (g === undefined) continue;
    const s = groups.get(g) ?? { dep: 0, dpn: 0, root: false };
    if (r === "root") s.root = true;
    if (r === "dependency" || r === "both") s.dep++;
    if (r === "dependent" || r === "both") s.dpn++;
    groups.set(g, s);
    for (const eid of index.outgoing.get(id) ?? []) {
      const e = index.edges.get(eid);
      const rv = e ? highlight.get(e.target) : undefined;
      const gv = e ? model.groupOf.get(e.target) : undefined;
      if (!e || !rv || gv === undefined || gv === g) continue;
      const dep = r !== "dependent" && rv !== "dependent";
      const dpn = r !== "dependency" && rv !== "dependency";
      if (!dep && !dpn) continue;
      const k = g * G + gv;
      const p = pairs.get(k) ?? { dep: 0, dpn: 0 };
      if (dep) p.dep++;
      if (dpn) p.dpn++;
      pairs.set(k, p);
    }
  }
  return { pairs, groups };
}

export function drillMembers(
  model: GroupModel, g: number, index: GraphIndex, visible: Set<string> | null,
  highlight: Map<string, Role> | null, neighOnly: boolean,
): string[] {
  const grp = model.groups[g];
  if (!grp) return [];
  const out = grp.members.filter((id) => (!visible || visible.has(id)) && (!neighOnly || !highlight || highlight.has(id)));
  const label = (id: string) => index.nodes.get(id)?.label ?? id;
  return out.sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }));
}
