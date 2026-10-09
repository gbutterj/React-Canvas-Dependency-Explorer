---
name: Measured scale limits
description: Empirical baseline and interpretation constraints for future performance work.
---

The 2026-10-09 baseline found that overview interaction, not just graph storage, limits scale. With 10,000 nodes and approximately 50,000 edges, pan/redraw latency was about 98 ms in the full overview versus 16 ms zoomed in. At 50,000 nodes and approximately 250,000 edges, these rose to about 572 ms and 46 ms respectively. A roughly million-edge overview exceeded 2 seconds per redraw.

**Why:** these are measurements of the shipped renderer in headless Chromium using software Canvas/compositing, without React panels or external image downloads. They are not user-device limits. Main-thread model setup also reached seconds at the largest density, showing a separate responsiveness issue.

**How to apply:** prioritize dense-overview workload reduction and asynchronous analysis before claiming support for tens of thousands of nodes. Compare optimizations using equivalent graph density, viewport and rendering mode. Do not convert JavaScript draw-submission time into a claim of real FPS or physical input-to-display latency. Re-run the reproducible benchmark for fresh results rather than assuming this baseline remains current.
