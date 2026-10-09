# Background import and impact processing

## What runs where

`src/graph/graph.worker.ts` reads a selected File/Blob, parses JSON, invokes the same graph validator, constructs adjacency, runs iterative SCC/weak-component analysis, generates synthetic samples, and prepares supplied/grid/saved positions. Saved layouts use the same view validator without revalidating or copying the entire graph.

The main thread only reads the browser-local storage string. The worker validates it before applying anything; invalid/blocked storage produces a warning and preserves supplied positions. The renderer still receives its existing `GraphIndex`, mutable positions and `SpatialIndex` interfaces.

Nodes arrive in batches of 512 and edges in batches of 2,048. Each batch is acknowledged in a **new main-thread task** before the worker may send another. This both bounds queued clone memory and gives input, timers and paint scheduling an opportunity between batches. Just making messages small is not sufficient: an unrestricted producer can still flood the consumer's event queue.

The viewer builds its maps, position maps and spatial picking index incrementally from those batches. Document arrays and index maps refer to the same entity objects, and edge endpoints reuse canonical node ID strings. Full adjacency maps are not sent or retained a second time. The worker retains only node IDs/ordinals and compact numeric incoming/outgoing CSR arrays after delivery; the numeric arrays occupy `8E + 8(V+1)` bytes. The worker temporarily needs the full object graph for validation and SCC setup. Memory peaks are therefore higher than final retained memory.

`compactReachable` computes both transitive directions, yields every 8,192 inspected edges (including inside a single large fan-out), and checks cancellation after yielding. Queries return distinct direct neighbors and transitive sets, not a full graph or another adjacency copy. Source depends on target: outgoing = dependencies; incoming = possible dependents/impact. Direct self-loop neighbors include the selected node; transitive reachability excludes the root, even in cycles. Cycles remain SCC groups, not an enumeration of every simple cycle.

## Transactions, stale responses and errors

- A candidate worker is separate from the active graph/worker. Import success is committed only after all batches and analysis have been received and viewer indexes have been constructed.
- Failed/cancelled imports leave the existing graph, selection, moved coordinates, pins, filters and analysis worker intact. A successful import resets the view as before.
- A new dataset/import terminates the previous candidate immediately. Explicit Cancel and unmount do the same. Generation checks ignore already-queued messages and prevent late state commits.
- Selection requests have monotonically increasing IDs. The main thread rejects stale results; the worker cooperatively cancels outdated traversals. Switching graphs replaces the active worker and invalidates its queries.
- Worker creation, runtime and message errors are visible rather than silently reverting to synchronous work. A failed active worker reports that impact is unavailable until reloading the dataset.
- Loading text names actual stages, not an invented completion percentage. Pending impact counts show `…`, never the previous node's counts or a false zero. The graph only highlights the selected root until its new result arrives.
- File contents are not copied into the textarea or read on the main thread. Pasted JSON still has the browser/React text-input cost and string-message copying cost; those are not removed by workers.

## Remaining main-thread work

This is **not** a claim that workers remove all loading cost. Entity deserialization, bounded map/spatial construction, final analysis-result deserialization, localStorage reads and garbage collection still use the main thread. Batch sizes bound entity count, not metadata byte size or GC duration. Pathological huge labels/icons/metadata and very large component result payloads can exceed a small-task budget.

After committing a graph, React still scans/sorts nodes for search/filter/list data and combines returned highlight roles. The grouped Network view's group-model construction, relationship aggregation, emphasis and drill-down member preparation are also synchronous and are not included in the core setup benchmark. Neighborhood focus/expansion is still synchronous. Renderer scene changes, cold geometry/minimap/bounds rebuilds, huge highlighted neighborhoods, restore-supplied positions, JSON export and layout saving also remain synchronous. Hardware/viewport and huge-highlight work are separate deliverables. Imports can take longer overall because they include worker startup, compact-adjacency setup, message copying, acknowledgement scheduling and a second, incremental renderer-facing index build.

Staged replacement deliberately holds old and candidate graphs simultaneously so invalid imports cannot discard a usable workspace. This peak is not represented by a post-GC snapshot with only the latest viewer retained.

## Reproduction

With the managed web workflow running, from the workspace root:

```sh
# Actual Web Worker and client assertions, no renderer run
BACKGROUND_CHECKS_ONLY=1 node artifacts/dependency-explorer/scripts/benchmark.mjs

# All nine existing seeded node/degree cases, synchronous vs worker, three repeats
SETUP_ONLY=1 node artifacts/dependency-explorer/scripts/benchmark.mjs

# Optional focused measurement
SETUP_ONLY=1 COUNTS=50000 DEGREES=5,20 node artifacts/dependency-explorer/scripts/benchmark.mjs
```

The same developer benchmark entry and Chromium/CDP runner are used as for the renderer benchmark. Setup results are saved separately to `generated-artifacts/graph-benchmarks/setup-results.json`, so the existing renderer report is not overwritten. `BENCHMARK_URL` can select another development benchmark URL. The developer entry is not shipped in the production bundle.

Setup measures real total wall time, maximum gaps between a 16-ms main-thread timer and observed long tasks, excluding fixture generation, JSON serialization and synthetic Blob construction. The worker reads a pre-existing Blob (as file input does); the synchronous baseline consumes prepared JSON text (as the previous submit handler did). Subtract 16 ms from a timer gap only as a rough scheduling-delay interpretation, not physical input latency. Worker phase timers and viewer batch CPU timers exclude some startup, deserialization and scheduling costs; they should not be substituted for the total.

Memory uses CDP `Runtime.getHeapUsage` after requested garbage collection, separately for the main page and the live worker, with the latest viewer retained. `usedSize` is the JS heap; `backingStorageSize` separately exposes buffers/external storage. These snapshots include development modules and instrumentation, exclude native browser/Canvas memory, and do not measure setup/replacement peaks or total process memory.

Assertions cover validation messages, malformed JSON, directional direct/transitive results, parallel edges, self-loops, SCC/cycle membership, weak components, orphans, shared document/index identities, spatial picking, saved-view restoration/warnings, latest-selection and latest-dataset guards, failed-import preservation, explicit cancellation and cancellation during streamed delivery.

The focused UI pass additionally confirmed malformed-import preservation of selection/pins without hot reload, valid file import, rapid selection, graph switching, exact export data and save/reload pins. The tester's browser observations arrived after successful completion in the cancellation attempts, so those attempts could not exercise cancellation; the actual worker/client cancellation assertions exercise startup and mid-delivery cancellation directly.

## Measured results (2026-10-09)

Final complete run: 23:14:59–23:16:15 UTC, Chrome 152.0.7977.64 headless on Intel Xeon Platinum 8581C @ 2.30 GHz, Linux, four logical CPUs exposed, 7.78 GiB RAM, no CPU throttling. Same seeded fixtures as the renderer benchmark, but **no React panels, Canvas drawing or external icons**. These are core import/setup measurements, not a laptop/device support guarantee.

Each time column is the median of three repetitions. “Timer gap” is the **median of each repetition's maximum gap** between 16-ms timer callbacks, not a frame rate, p95 or physical interaction latency. Wall times include all stages, startup and delivery. JS heap columns are one final post-GC snapshot per case, not medians or peak memory.

| Nodes | Degree | Edges | Setup wall ms: sync → worker | Max timer gap ms: sync → worker | Main JS heap MiB: sync → worker | Worker JS heap MiB |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2 | 2,001 | 9.8 → 71.5 | 17.9 → 16.8 | 2.2 → 2.6 | 0.6 |
| 1,000 | 5 | 4,989 | 16.0 → 81.3 | 20.2 → 17.0 | 2.4 → 3.2 | 0.6 |
| 1,000 | 20 | 19,794 | 37.4 → 143.8 | 41.4 → 18.0 | 3.7 → 5.8 | 0.6 |
| 10,000 | 2 | 20,046 | 109.1 → 242.5 | 113.6 → 19.0 | 9.9 → 15.7 | 1.0 |
| 10,000 | 5 | 50,034 | 139.0 → 368.0 | 143.4 → 20.4 | 12.0 → 20.4 | 1.0 |
| 10,000 | 20 | 199,839 | 501.2 → 1,188.7 | 505.6 → 31.1 | 24.5 → 47.2 | 1.0 |
| 50,000 | 2 | 100,246 | 464.0 → 1,332.4 | 468.4 → 37.0 | 43.4 → 71.6 | 2.7 |
| 50,000 | 5 | 250,234 | 830.5 → 1,930.0 | 834.7 → 36.8 | 54.3 → 96.1 | 2.7 |
| 50,000 | 20 | 1,000,039 | 3,065.2 → 6,467.9 | 3,069.6 → 83.6 | 152.2 → 229.5 | 2.7 |

Worker external/backing storage was separately 1.25 / 2.40 / 8.12 MiB for the three 50,000-node cases. CSR alone was 1,201,976 / 2,401,880 / 8,400,320 bytes respectively; the rest includes script/other backing storage. Main external/backing storage was about 0.59 MiB. Heap numbers should not be advertised as total browser memory. Retained main-thread heap is materially higher than the synchronous baseline despite sharing document/index entities: incremental structured cloning and string/object representation have costs too. This implementation prioritizes responsiveness and preservation of the existing graph, not a reduction in every memory or wall-time measure.

For 50,000 nodes / 250,234 edges, selected-node impact wall time was 67.7 → 139.0 ms while the maximum timer gap was 68.0 → 26.8 ms. At roughly one million edges it was 181.7 → 532.9 ms, with timer gaps 182.2 → 20.9 ms. This query uses the final node's full outgoing closure (49,999 other nodes) and an empty incoming closure; arbitrary graph shapes can differ.

The final setup run observed no main-thread tasks of 50 ms or more in the worker cases except the million-edge case's first repetition (60 and 55 ms). That largest case's per-repetition maximum timer gaps were 74.6, 93.4 and 83.6 ms; its largest measured viewer batch CPU times were 60.0, 19.3 and 28.6 ms. GC, clone reception and scheduling can still cause pauses even with bounded delivery. All nine cases completed, and all **27 actual worker/client regression assertions passed**. Workbench typechecking and the production Vite build passed; the emitted module worker is a separate production asset.

The initial experiments showed why both bounding and backpressure are required: queued delivery caused longer pauses and higher transient allocations than the acknowledged pipeline. Constructing a synthetic Blob inside the timing window also introduced main-thread work that a real file picker does not perform. The final matrix corrects both measurement/design issues. Intermediate browser runs interrupted by live changes were not used for this table.
