---
name: Measured scale limits
description: Empirical renderer and worker measurements and interpretation constraints for future performance work.
---

The 2026-10-09 baseline found that overview interaction, not just graph storage, limits scale. With 10,000 nodes and approximately 50,000 edges, pan/redraw latency was about 98 ms in the full overview versus 16 ms zoomed in. At 50,000 nodes and approximately 250,000 edges, these rose to about 572 ms and 46 ms respectively. A roughly million-edge overview exceeded 2 seconds per redraw.

**Why:** these are measurements of the shipped renderer in headless Chromium using software Canvas/compositing, without React panels or external image downloads. They are not user-device limits. Main-thread model setup also reached seconds at the largest density, showing a separate responsiveness issue.

**How to apply:** prioritize dense-overview workload reduction and asynchronous analysis before claiming support for tens of thousands of nodes. Compare optimizations using equivalent graph density, viewport and rendering mode. Do not convert JavaScript draw-submission time into a claim of real FPS or physical input-to-display latency. Re-run the reproducible benchmark for fresh results rather than assuming this baseline remains current.

Cached-path stroke/fill timers can fall below clock resolution while end-to-frame latency stays in the tens of milliseconds. Profile the whole rendering pipeline as well as geometry and minimap phases; do not infer that near-zero submission timers mean raster work is free.

**Why:** software Canvas can defer or synchronize raster work outside the timed stroke call. Warm-pan measurements also exclude cold adjacency/cache rebuilds and may substantially understate zoom, filter, selection and large-highlight costs.

**How to apply:** keep equivalent before/after instrumentation, distinguish warm-cache pans from geometry-changing interactions, report sampling/aggregation explicitly, and never derive exact raster time by subtracting independent phase medians.

Worker import benchmarks must measure responsiveness separately from total loading time and memory. The 2026-10-09 complete setup matrix improved the 50,000-node / roughly million-edge median maximum timer gap from about 3.07 seconds to 84 ms, but wall time increased from about 3.07 to 6.47 seconds and retained JS heap increased.

**Why:** moving algorithms off-thread still requires receiving data, constructing renderer-facing indexes and garbage collection. Small messages without producer backpressure can flood the main-thread queue; a worker is not proof that delivery is responsive.

**How to apply:** benchmark the actual client/worker pipeline, include separate main/worker JS heaps and backing buffers, and distinguish post-GC retained memory from replacement peaks (old + candidate graphs). Keep synthetic Blob construction outside file-import timing, since file input already supplies a Blob. Qualify timer gaps as scheduling measurements, not physical input latency or device support guarantees.
