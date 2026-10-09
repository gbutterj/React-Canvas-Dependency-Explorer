/**
 * Domain convention: an edge source -> target means "source depends on target".
 * Positions belong to a separate view, never to the node entity.
 */
export const NODE_KINDS = ["service", "package", "database", "queue", "external"] as const;
export type NodeKind = typeof NODE_KINDS[number];
export const EDGE_KINDS = ["runtime", "build", "data", "optional"] as const;
export type EdgeKind = typeof EDGE_KINDS[number];
export type Direction = "dependencies" | "dependents";
export interface DependencyNode {
  id: string;
  label: string;
  kind: NodeKind;
  description?: string;
  owner?: string;
  version?: string;
  tags?: string[];
  /** Optional URL. The viewer otherwise uses a type-specific vector icon. */
  icon?: string;
}
export interface DependencyEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
}
export interface Point { x: number; y: number }
export interface GraphView {
  positions: Record<string, Point>;
  pinned?: string[];
}
export interface GraphDocument {
  schemaVersion: 1;
  name: string;
  description?: string;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  view?: GraphView;
}
export interface GraphIndex {
  nodes: ReadonlyMap<string, DependencyNode>;
  edges: ReadonlyMap<string, DependencyEdge>;
  outgoing: ReadonlyMap<string, readonly string[]>;
  incoming: ReadonlyMap<string, readonly string[]>;
}
export interface GraphAnalysis {
  cycles: string[][];
  cycleNodeIds: Set<string>;
  components: string[][];
  orphanIds: string[];
  maxFanIn: number;
  maxFanOut: number;
}
/** Plug-in boundary for a future CoSE/fCoSE/worker implementation. */
export interface LayoutAdapter {
  name: string;
  compute(
    graph: GraphIndex,
    initial: ReadonlyMap<string, Point>,
    pinned: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<Map<string, Point>>;
}
