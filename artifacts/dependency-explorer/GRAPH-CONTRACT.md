# Graph core contract

Parent agent owns `src/graph/` and will implement these functions in parallel.
Do not edit that directory. All core modules are pure TypeScript with no React dependency.

Import entity types from `@/graph/types`.
Domain direction: source depends on target. Incoming = dependents (impact); outgoing = dependencies.
Cycles are valid. Edge IDs allow parallel typed relations.

`@/graph/model` exports:
- `parseGraphDocument(input: unknown): GraphDocument` — throws human-readable validation errors for malformed input, duplicates, dangling references, unknown kinds and invalid positions.
- `buildGraphIndex(document: GraphDocument): GraphIndex`
- `neighbors(index: GraphIndex, id: string, direction: Direction): DependencyNode[]` — distinct neighbors.
- `reachable(index: GraphIndex, id: string, direction: Direction, maxDepth?: number): Set<string>` — excludes starting node even for cycles; default transitive closure for that one node.
- `neighborhood(index: GraphIndex, id: string, direction: Direction | "both", depth?: number): Set<string>` — includes root; default depth 1.
- `shortestPath(index: GraphIndex, source: string, target: string): string[] | null`

`@/graph/analysis` exports:
- `analyzeGraph(index: GraphIndex): GraphAnalysis` — iterative O(V+E) SCC + weak components, cycles incl self-loops, orphans and max fan degrees.

`@/graph/fixtures` exports:
- `createDemoDocument(): GraphDocument` — synthetic "Atlas commerce" system, ~70 nodes with positions already supplied in `document.view.positions`, a few cycles and useful metadata.
- `createStressDocument(count?: number): GraphDocument` — deterministic synthetic 10,000-node fixture by default; positions supplied, about 2 edges per node, clearly labeled synthetic benchmark. This is not a performance guarantee.

`@/graph/spatial` exports:
- `class SpatialIndex { constructor(positions: ReadonlyMap<string, Point>, cellSize?: number); update(id: string, point: Point): void; nearest(point: Point, radius: number): string | null; query(minX: number, minY: number, maxX: number, maxY: number): string[]; }`
  For picking and viewport culling; call update after dragging.

No backend/auth/database needed. Import/export JSON and local view persistence. Canvas is mandatory; do not substitute SVG graph rendering or Sigma. A renderer can use Canvas paths for type icons (no emojis), cached URL images when available. Positions are static supplied data, dragging changes only view state. No force engine in this scope; provide layout adapter boundary and explain it plainly in UI.
