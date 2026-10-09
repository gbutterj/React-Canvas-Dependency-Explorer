import type { DependencyEdge, DependencyNode, GraphAnalysis, GraphDocument, GraphIndex, Point } from "./types";
import type { SampleKind, ScaleDensity } from "./scale-fixtures";

export type LoadInput = { kind: "sample"; sample: SampleKind; density: ScaleDensity }
  | { kind: "import"; text: string | Blob; name: string };
export interface PreparedGraph {
  doc: GraphDocument;
  index: GraphIndex;
  analysis: GraphAnalysis;
  original: Map<string, Point>;
  positions: Map<string, Point>;
  pinned: Set<string>;
  moved: Set<string>;
  storageKey: string;
  gridPlaced: number;
  storageWarning: string | null;
}
export interface ImpactResult {
  root: string;
  dependencies: Set<string>;
  dependents: Set<string>;
  directDependencies: Set<string>;
  directDependents: Set<string>;
}
export type WorkerRequest =
  | { type: "load"; input: LoadInput }
  | { type: "layout"; raw: string | null; warning: string | null }
  | { type: "continue" }
  | { type: "impact"; request: number; root: string | null };
export type WorkerResponse =
  | { type: "progress"; phase: string }
  | { type: "storage"; key: string }
  | { type: "nodes"; nodes: DependencyNode[]; original: Point[]; positions: Point[];
      supplied: (Point | null)[]; pinned: boolean[]; moved: boolean[] }
  | { type: "edges"; edges: DependencyEdge[] }
  | { type: "ready"; metadata: Omit<GraphDocument, "nodes" | "edges" | "view">;
      hasView: boolean; viewPinned?: string[]; analysis: GraphAnalysis;
      storageKey: string; gridPlaced: number; storageWarning: string | null;
      timings: Record<string, number>; adjacencyBytes: number }
  | { type: "impact"; request: number; result: ImpactResult }
  | { type: "error"; message: string; request?: number };
