# Dependency graph: research and design decisions

## Goal and scope

A React/TypeScript workbench for examining dependencies and the potential impact of changing a node. Canvas draws the graph; React owns application controls, the node list and details. Graph structure is independent of presentation.

This implementation deliberately does **not** run a force layout. Supplied coordinates and manual dragging are supported. Missing coordinates receive deterministic grid placement, explicitly labeled in the UI. `LayoutAdapter` is the boundary for a future CoSE/fCoSE or another positioning algorithm.

## 1. Model a directed multigraph, not a tree

The convention is **source depends on target**. For `checkout → payment`, payment is a dependency of checkout, and checkout is a dependent of payment. Incoming traversal answers “what could be affected?”; outgoing traversal answers “what does this need?”

Nodes have stable IDs distinct from labels. They carry kind, description, owner, version, tags and an optional icon URL. Edges have independent IDs and typed relationships: runtime, build, data or optional. Parallel relationships and self-dependencies are valid. Cycles must not make imports fail.

Versioned JSON documents validate unique IDs, endpoint references, kind values, finite coordinates and pinned-node references. Unknown optional fields are not retained. Coordinates and pins live under `view`, not inside domain entities. Internal adjacency maps contain edge IDs, preserving parallel relationships without copying full edge objects.

**Important:** graph reachability indicates a *possible* impact, not proof that a change breaks every dependent. Build, runtime and optional dependencies have different operational meaning; compatibility checks, deployment state and actual traffic are not modeled.

## 2. Choose algorithms for the question being asked

| Question | Technique | Cost / interpretation |
| --- | --- | --- |
| What directly depends on this node? | Incoming adjacency | O(in-degree); distinct neighbor IDs for UI counts |
| What does this node directly require? | Outgoing adjacency | O(out-degree) |
| What is the possible transitive impact? | Iterative BFS on incoming edges | O(V+E) worst case; compute on selection, not all pairs |
| What are the transitive requirements? | Iterative BFS on outgoing edges | O(V+E) worst case |
| What is a local neighborhood? | Depth-limited BFS in one or both directions | Includes the selected root; visited set prevents cycle loops |
| Which regions are mutually dependent? | Iterative Kosaraju SCC analysis | O(V+E); avoids JavaScript recursion limits |
| Which systems are disconnected? | Weak-component traversal, ignoring edge direction | O(V+E) |
| What is a shortest chain? | Unweighted directed BFS with predecessor map | O(V+E), available as a pure model function |

The UI's “cyclic groups” are strongly connected components containing multiple nodes, or a singleton with a self-loop. They are **not the number of all simple cycles**. Enumerating every cycle can be exponential and is usually the wrong default for dependency exploration.

Collapsing each SCC produces an acyclic condensation graph. This is a useful future way to summarize complex systems, but automatic SCC collapsing is not implemented in this version. A topological order is valid on that condensation graph, not on arbitrary raw dependency graphs.

We intentionally avoid materializing an all-pairs reachability matrix: even a sparse graph can have O(V²) reachable pairs. For example, a long dependency chain is cheap to store but can have quadratically many transitive relationships.

## 3. Interaction design

The information-seeking sequence is **overview → zoom/filter → details on demand**. The workbench makes these concrete:

- A full-system overview, minimap and fit-to-screen control.
- Type and cycle filters, searchable node list, direction and depth controls.
- One-hop highlighting by default; transitive exploration is explicit.
- Selection details explaining direct versus transitive counts.
- Hover cards on pointer devices and a selection/details path on touch.
- Focus on a neighborhood and progressively expand by another hop.
- Cycle rings and textual warnings, not just color.
- Keyboard node selection through real DOM buttons rather than inaccessible Canvas-only picking.
- Imported JSON and synthetic fixtures are clearly distinguished; counts come from data.

The supplied demo positions are illustrations, not evidence that the graph has a good automatic layout. The 10,000-node fixture is a stress dataset, not a benchmark result or a promised performance ceiling.

## 4. Canvas and scale

The viewer avoids a React/DOM component for each graph node. React coordinates the screen; an imperative renderer uses `requestAnimationFrame` for drawing and animation. Dragging updates positions and a spatial grid without rebuilding the graph.

Implemented techniques:

- Uniform-grid spatial indexing for hit-testing and viewport node queries.
- Rendering edges incident to viewport nodes rather than scanning every edge on every frame.
- Cached `Path2D` icons and imported image objects.
- Zoom-dependent node/icon/label detail; less detail when zoomed out.
- Batched edge paths, on-demand redraw, device-pixel-ratio sizing.
- Respect for reduced-motion preferences.

Limits worth measuring before production:

- A zoomed-out view containing everything still processes O(V+E) primitives; culling is not a solution when the entire graph is visible.
- The minimap draws all visible nodes. High-DPI screens increase pixel fill cost.
- An edge whose two endpoints are both outside the viewport is omitted even if it crosses the viewport.
- Parallel edges are retained in the model but are not assigned individual curve lanes.
- The list shows at most 300 matches; search is the access path for larger datasets.
- SCC analysis, import parsing/validation and selected-node direct/transitive impact now run in a typed worker. Bounded, acknowledged delivery preserves renderer access without another full worker-owned adjacency copy. Neighborhood focus, renderer rebuilds and several view/export operations remain synchronous; see [background processing measurements](background-processing.md).
- Very dense graphs may require aggregation or a WebGL renderer. Canvas is a deliberate implementation choice, not a claim that it outscales WebGL.
- External icons depend on their host being reachable and appropriate privacy policies. Failed images fall back to type icons.

There is no defensible universal “maximum nodes” figure. Measure frame time, pointer latency, import time and memory across node count, edge count, graph density, icon variety, zoom level, device and display resolution.

The project now includes a reproducible browser benchmark matrix at 1,000, 10,000 and 50,000 nodes with approximately 2, 5 and 20 outgoing edges per node. It tests the actual model and renderer separately from React panels. See the README's benchmark instructions and the generated report for measured results and environment qualifications; do not infer a production node limit from the fixture size.

## 5. Extension boundaries

The pure graph modules have no React or Canvas dependency. A future layout worker can return positions through `LayoutAdapter`; another renderer can reuse the same index and traversals. Future persistence or collectors should produce versioned `GraphDocument` data, rather than coupling database records to Canvas objects.

Browser-local saves contain moved coordinates and pins. Exported JSON is the portable source for restoring the entire graph and view. Camera, filters and selection are transient and are not included in exports.

## Sources

1. [NetworkX: ancestors](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.dag.ancestors.html) — nodes with a path to the selected node.
2. [NetworkX: descendants](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.dag.descendants.html) — nodes reachable from the selected node.
3. [NetworkX: component algorithms](https://networkx.org/documentation/stable/reference/algorithms/component.html) — strong versus weak connectivity.
4. [NetworkX: condensation](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.components.condensation.html) — SCC contraction yields a DAG.
5. [Ben Shneiderman, The Eyes Have It (1996)](https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf) — overview, zoom/filter, details on demand.
6. [MDN: Optimizing Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) — caching, batching, text cost, DPR and requestAnimationFrame.

These sources inform concepts; the application implements its own TypeScript algorithms and Canvas renderer and does not depend on Python/NetworkX.
