# Dependency Explorer

A React + TypeScript dependency-analysis workbench with a custom Canvas 2D viewer. No backend, graph visualization library or force-layout engine is required.

## Run

```sh
PORT=18439 BASE_PATH=/ pnpm --filter @workspace/dependency-explorer dev
pnpm --filter @workspace/dependency-explorer exec tsc --noEmit
PORT=18439 BASE_PATH=/ pnpm --filter @workspace/dependency-explorer build
```

The managed workflow supplies `PORT` and `BASE_PATH`.

## Use

- Select a node on the canvas or in the searchable list.
- Compare dependencies with dependents, and direct with transitive relationships.
- Focus a local neighborhood, then expand by another hop.
- Drag unpinned nodes, pan, wheel/pinch zoom, or navigate through the minimap.
- Hover for metadata; on touch, select a node and open Details.
- Import versioned JSON, export the full graph or focused subgraph, and save moved positions/pins in the browser.
- Switch to the clearly labeled 10,000-node synthetic dataset to explore scaling behavior. This is not a validated performance limit.

## Data contract

An edge `source → target` means **source depends on target**.

```json
{
  "schemaVersion": 1,
  "name": "My dependency graph",
  "nodes": [
    { "id": "checkout", "label": "Checkout API", "kind": "service", "owner": "Commerce" },
    { "id": "orders-db", "label": "Orders", "kind": "database" }
  ],
  "edges": [
    { "id": "checkout-orders", "source": "checkout", "target": "orders-db", "kind": "data" }
  ],
  "view": {
    "positions": {
      "checkout": { "x": 0, "y": 0 },
      "orders-db": { "x": 240, "y": 0 }
    },
    "pinned": []
  }
}
```

Node kinds: `service`, `package`, `database`, `queue`, `external`.
Edge kinds: `runtime`, `build`, `data`, `optional`.
Nodes can include `description`, `version`, `tags` and an image `icon` URL.

IDs must be unique within their collection; edges must reference existing nodes. Parallel edges and self-loops are valid. Invalid imports show explicit errors.

## Architecture

- `src/graph/`: pure types, validation, adjacency indexes, traversal, iterative component analysis and spatial index.
- `src/hooks/use-workbench.ts`: view/selection state, dataset loading and browser-local persistence.
- `src/lib/renderer.ts`: Canvas drawing, camera and pointer interaction.
- `src/pages/workbench.tsx`: React controls and analysis panels.
- `LayoutAdapter` is an interface only. Future layout implementations should compute coordinates without changing graph identity.

See [the research and design report](docs/graph-design-research.md) for algorithm complexity, source references and current limits.

## Reproducible scale benchmarks

With the managed web workflow running:

```sh
node artifacts/dependency-explorer/scripts/benchmark.mjs
node artifacts/dependency-explorer/scripts/benchmark-report.mjs
```

Run from the workspace root. Requires Node 24's native WebSocket client and Chromium (available in this environment). The browser URL defaults to the proxied development domain; `BENCHMARK_URL` can point to the developer benchmark page on another machine.

The matrix covers 1,000 / 10,000 / 50,000 nodes at approximately 2 / 5 / 20 outgoing edges per node. Results and a self-contained downloadable HTML report are written to `generated-artifacts/graph-benchmarks/`, excluded from Git and deployment.

The `benchmark.html` developer entry imports the real model and renderer but does not run the React panels. It is not a production build entry. Timings distinguish model costs, Canvas command submission and redraw-request-to-animation-frame latency. They do not measure physical input-to-display latency or establish a guaranteed node limit. See the report for hardware, browser rendering mode, sample counts and workload details.

Crowded views explicitly show **Reduced detail**: ordinary edges are sampled and ordinary nodes can share density cells. Highlights, hovered/selected incident edges, cycle indicators and pins retain individual treatment; the model and picking stay exact. Zoom in or focus to inspect relationships. Huge highlights and cold cache rebuilds can still be expensive.

See [measured rendering performance](docs/renderer-performance.md) for the complete before/after matrix, caching rules, tradeoffs and regression-check commands.

Imports, synthetic dataset generation, cycle analysis and selected-node impact now run in a typed Web Worker. A failed or cancelled import keeps the current graph and layout; stage labels and pending impact counts reflect real work. File input is read in the worker rather than copied into the text editor. Dataset and selection changes invalidate stale results.

See [background processing and setup benchmarks](docs/background-processing.md) for cancellation/serialization design, total setup time, responsiveness, memory qualifications, regression commands and the work that still runs synchronously. To run the setup matrix without overwriting renderer results:

```sh
SETUP_ONLY=1 node artifacts/dependency-explorer/scripts/benchmark.mjs
```
