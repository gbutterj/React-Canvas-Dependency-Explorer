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
