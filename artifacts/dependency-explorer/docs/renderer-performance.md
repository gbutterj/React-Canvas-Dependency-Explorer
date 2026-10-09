# Rendering performance: measured before and after

Measured 2026-10-09 using the actual model and Canvas renderer, **not** the React panels. Headless Chrome 152.0.7977.64 on Intel Xeon Platinum 8581C @ 2.30 GHz, Linux, software Canvas/compositing; 1000 × 700 CSS pixels, DPR 1, 180 × 120 minimap. No CPU throttling or external image downloads. Synthetic fixed grid, seeded backward dependencies and small cycles; the graph model and layout are unchanged.

These are short-sample median redraw-request-to-next-animation-frame latencies in milliseconds, **not physical input-to-display latency or guaranteed FPS**. Each case uses a fresh page, three model passes, two warm-up pans, 12 measured pans, six zooms and eight synthetic drag moves. Raster/compositing, scheduling, garbage collection and JIT warm-up affect the readings.

| Nodes | Approx. outgoing degree | Actual edges | Overview pan before → after | Overview drag before → after | Zoomed pan before → after |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2 | 2,001 | 16.7 → 16.9 | 16.1 → 15.9 | 16.6 → 16.7 |
| 1,000 | 5 | 4,989 | 19.9 → 16.4 | 21.3 → 16.2 | 18.4 → 16.6 |
| 1,000 | 20 | 19,794 | 52.8 → 16.6 | 51.2 → 15.6 | 125.5 → 30.8 |
| 10,000 | 2 | 20,046 | 40.1 → 17.6 | 42.5 → 18.2 | 16.7 → 16.6 |
| 10,000 | 5 | 50,034 | 106.4 → 17.8 | 115.1 → 21.9 | 16.7 → 16.6 |
| 10,000 | 20 | 199,839 | 462.8 → 18.3 | 489.1 → 22.0 | 51.7 → 15.9 |
| 50,000 | 2 | 100,246 | 212.4 → 42.6 | 216.5 → 41.8 | 35.6 → 16.6 |
| 50,000 | 5 | 250,234 | 587.6 → 42.4 | 605.3 → 47.3 | 47.0 → 16.7 |
| 50,000 | 20 | 1,000,039 | 2,478.6 → 41.5 | 2,512.2 → 50.2 | 177.7 → 33.3 |

## What the profile says

For 50,000 nodes / 250,234 edges, the before-run overview edge pass had a 64.8 ms median, including 5.0 ms stroke/fill command submission; minimap drawing was 24.8 ms. Afterward, warm-pan edge-pass and minimap timers were approximately 0–0.1 ms, below or near clock resolution. Overall draw submission dropped from 581.3 to 24.2 ms.

The edge pass covers geometry construction/cache lookup and submission, not completed raster work. It is unsafe to subtract independently calculated medians to claim exact construction or raster time. Large paths also cause deferred software raster work and synchronization elsewhere in the frame; the profile does not isolate that time. Caching paths alone would leave a large raster workload. Limiting ordinary edge paths and node marks reduces both construction and drawn geometry. Warm pans still query all in-view IDs and build node density cells, so costs are not constant with node count.

The complete report includes p95, draw timings, phase profiles, setup costs, memory qualifications and browser/GPU metadata. Raw before/after results are embedded in the self-contained HTML.

## Policy and tradeoffs

- Below scale 0.3, views with more than 4,000 base edge candidates sample 1,800 evenly spaced representatives. At other scales more than 12,000 base candidates use 4,000 representatives. This is explicitly **sampling**, not edge bundling and not a summary of every relationship.
- Hovered/selected incident edges and cyclic-to-cyclic edges are additional to that budget. Both directional highlighted edge groups retain every candidate and their arrowheads. Consequently huge highlighted neighborhoods or cyclic regions can remain expensive.
- At scale below 0.3 and more than 4,000 in-view nodes, ordinary nodes share 6-pixel cells by faded state. Cell color uses a representative node kind, not a claim that every member has that kind. Selected, hovered, dragged, highlighted, matching, cyclic and pinned nodes remain individual. Detailed zoom retains existing icon and label thresholds.
- The notice is visible on small screens too. Stats distinguish in-view nodes, submitted marks, edge candidates and submitted edge paths; overlapping endpoints can skip paths even in full-detail mode.
- Picking, hover cards, graph identity, filters, traversal, pins and exports use the complete model. Clicking a density cell picks an actual nearby node through the unchanged spatial index; no replacement graph nodes are created.
- Translation-only pans reuse edge paths when the padded viewport's ID set is unchanged. Zoom, drag and scene updates invalidate geometry as appropriate. The minimap caches its static bitmap and overlays the moving node while dragging; bounds are recomputed on release. Filters, highlight changes, restored positions, resize and DPR changes rebuild the bitmap. Cold rebuilds still scan the graph; those costs are not covered by warm-pan medians.
- Import and analysis were synchronous at the time of this renderer comparison. They now have a separate [background-processing pipeline and setup benchmark](background-processing.md). No force layout, graph truncation or graph-model replacement was introduced.

## Reproduction and checks

Run from the workspace root with the managed web workflow running:

```sh
node --test artifacts/dependency-explorer/scripts/render-detail.test.mjs
CHECKS_ONLY=1 node artifacts/dependency-explorer/scripts/benchmark.mjs
node artifacts/dependency-explorer/scripts/benchmark.mjs
node artifacts/dependency-explorer/scripts/benchmark-report.mjs
```

For a new comparison, retain the original run's `results.json` as `before.json` in `generated-artifacts/graph-benchmarks/` before benchmarking the changed renderer. Keep instrumentation, fixture and environment identical. The report generator uses `before.json` when present. Generated output is excluded from Git and deployment; this document preserves the measured summary.

Regression assertions exercise real Canvas methods and synthetic renderer pointer handlers: sampling, density reduction, translation reuse, zoom invalidation, exact picking/hover, activation, coordinate/spatial updates on drag, pin protection, directional colors/arrowheads, cycle markers, vector/custom image icons, minimap resize/outlying drag bounds, filters and empty scenes. They do not exercise OS event delivery, React state or browser-local saving. Broader device/clustered-layout tests are still needed before making user-device capacity claims.
