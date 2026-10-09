# Dependency Explorer

A React/TypeScript workbench for understanding dependency relationships, cycles and possible change impact using a custom Canvas viewer.

## Run & Operate

- `pnpm --filter @workspace/dependency-explorer run dev` — run the web workbench (managed workflow supplies PORT and BASE_PATH)
- `pnpm --filter @workspace/mockup-sandbox run dev` — run isolated canvas design previews
- `pnpm --filter @workspace/dependency-explorer exec tsc --noEmit` — typecheck the workbench
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- The workbench does not need an API server, database or secrets. The monorepo's API/database packages are unused scaffolds.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- React, TypeScript, Vite, Tailwind and lucide-react
- Custom Canvas 2D renderer, independent of React's per-node rendering
- Pure TypeScript graph validation/traversal/component analysis

## Where things live

- `artifacts/dependency-explorer/README.md` — usage and import format
- `artifacts/dependency-explorer/docs/graph-design-research.md` — research, complexity, sources and limits
- `artifacts/dependency-explorer/src/graph/` — authoritative graph contracts and algorithms
- `artifacts/dependency-explorer/src/pages/workbench.tsx` — workbench interface
- `artifacts/mockup-sandbox/src/components/mockups/dependency-explorer/` — isolated previews extracted from the real app

## Architecture decisions

- Source depends on target. Incoming traversal represents possible downstream impact, not a guarantee of breakage.
- Cyclic groups mean strongly connected regions, not enumeration of every simple cycle.
- Domain identities and relationships are separate from view positions and pins.
- Layout is deliberately separate: supplied coordinates/manual dragging now, a layout adapter for future algorithms.

## Product

Search, type/cycle filters, direct/transitive dependency highlighting, progressive neighborhood focus, hover metadata, touch details, node dragging/pinning, minimap, JSON import/export and browser-local layout saving.

## User preferences

The user wants a React-native web architecture and custom Canvas dependency viewer for potentially tens of thousands of nodes, each with an icon and hover card. Focus on graph design/data model; layout is a separate issue. Show design progress on the canvas.

## Gotchas

- Demo and stress datasets are synthetic and must remain labeled. The 10,000-node dataset is not a measured performance guarantee.
- Browser-local layout saves are not shared persistence. Export JSON to transfer graph data and coordinates.
- Do not iframe the main app on the canvas; use extracted sandbox preview components.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
