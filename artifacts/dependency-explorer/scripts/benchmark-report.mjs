import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve("generated-artifacts/graph-benchmarks");
const data = JSON.parse(await readFile(path.join(dir, "results.json"), "utf8"));
const before = await readFile(path.join(dir, "before.json"), "utf8").then(JSON.parse).catch(() => null);
const num = value => Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—";
const esc = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const setup = c => ["jsonParse", "validate", "index", "analysis", "positions", "spatial"].reduce((sum, phase) => sum + c.phases[phase].median, 0);
const successful = data.cases.filter(c => !c.error);
const comparisons = before ? successful.map(c => {
  const b = before.cases.find(b => b.nodes === c.nodes && b.requestedEdgesPerNode === c.requestedEdgesPerNode);
  if (!b || b.error) return "";
  return `<tr data-density="${c.requestedEdgesPerNode}"><th>${num(c.nodes)} / ~${c.requestedEdgesPerNode}</th>
    <td>${num(b.views.overview.panRequestToRafMs.median)}</td><td>${num(c.views.overview.panRequestToRafMs.median)}</td>
    <td>${num(b.views.overview.dragRequestToRafMs.median)}</td><td>${num(c.views.overview.dragRequestToRafMs.median)}</td>
    <td>${num(b.views.zoomed.panRequestToRafMs.median)}</td><td>${num(c.views.zoomed.panRequestToRafMs.median)}</td>
    <td>${num(c.views.overview.stats?.edges)} / ${num(c.views.overview.stats?.edgeCandidates)}</td>
    <td>${num(c.views.overview.stats?.nodes)} / ${num(c.views.overview.stats?.nodeCandidates)}</td></tr>`;
}).join("") : "";
const profiles = successful.map(c => {
  const b = before?.cases.find(b => b.nodes === c.nodes && b.requestedEdgesPerNode === c.requestedEdgesPerNode);
  const p = c.views.overview.panProfile, bp = b?.views?.overview?.panProfile;
  return `<tr><th>${num(c.nodes)} / ~${c.requestedEdgesPerNode}</th>
    <td>${num(bp?.edges?.median)}</td><td>${num(p?.edges?.median)}</td>
    <td>${num(bp?.canvasSubmit?.median)}</td><td>${num(p?.canvasSubmit?.median)}</td>
    <td>${num(bp?.drawMinimap?.median)}</td><td>${num(p?.drawMinimap?.median)}</td></tr>`;
}).join("");
const gpu = data.system.gpu;
const rows = successful.map(c => `<tr data-density="${c.requestedEdgesPerNode}">
  <th scope="row">${num(c.nodes)}</th><td>${num(c.edges)}</td><td>~${c.requestedEdgesPerNode}</td>
  <td>${num(setup(c))}</td>
  <td>${num(c.views.overview.panRequestToRafMs.median)}<small>p95 ${num(c.views.overview.panRequestToRafMs.p95)}</small></td>
  <td>${num(c.views.zoomed.panRequestToRafMs.median)}<small>p95 ${num(c.views.zoomed.panRequestToRafMs.p95)}</small></td>
  <td>${num(c.views.overview.panDrawMs.median)}</td><td>${num(c.views.zoomed.panDrawMs.median)}</td>
</tr>`).join("");
const interactions = successful.map(c => `<tr><th scope="row">${num(c.nodes)} / ~${c.requestedEdgesPerNode}</th>
  <td>${num(c.views.overview.zoomRequestToRafMs.median)}</td><td>${num(c.views.overview.dragRequestToRafMs.median)}</td>
  <td>${num(c.views.zoomed.zoomRequestToRafMs.median)}</td><td>${num(c.views.zoomed.dragRequestToRafMs.median)}</td>
  <td>${num(c.views.zoomed.stats?.nodes)}</td><td>${num(c.views.zoomed.stats?.edges)}</td>
</tr>`).join("");
const phases = successful.map(c => `<tr><th scope="row">${num(c.nodes)} / ~${c.requestedEdgesPerNode}</th>${["jsonParse", "validate", "index", "analysis", "positions", "spatial", "dependencies", "dependents"].map(p => `<td>${num(c.phases[p].median)}</td>`).join("")}<td>${num(c.heapMiB)}</td></tr>`).join("");
const errors = data.cases.filter(c => c.error).map(c => `<p class="warning">${num(c.nodes)} nodes / degree ${c.requestedEdgesPerNode}: ${esc(c.error)}</p>`).join("");
const json = JSON.stringify({ ...data, before }).replaceAll("<", "\\u003c");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dependency Explorer · measured scale report</title>
<style>
:root{color-scheme:light;font-family:system-ui,sans-serif;color:#172b36;background:#f6f4ee}
body{max-width:1250px;margin:0 auto;padding:40px 24px 70px}h1{font-size:clamp(28px,4vw,44px);line-height:1.15;margin:12px 0}
h2{margin-top:34px}p,li{line-height:1.6}small{display:block;color:#52636c;font-size:11px;margin-top:3px}
.eyebrow{font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#1e6b73;font-weight:750}
.warning{background:#fff2cf;border:1px solid #ddbc72;padding:15px;border-radius:8px}
.scroll{overflow:auto;border:1px solid #d4d8d6;border-radius:8px;background:#fff}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
th,td{padding:12px 14px;text-align:right;border-bottom:1px solid #e7eae7}th:first-child{text-align:left}
thead th{background:#15313c;color:white;font-weight:600}tbody tr:last-child td,tbody tr:last-child th{border-bottom:0}
.tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0}
button,select{font:inherit;border:1px solid #8caaa9;border-radius:6px;padding:8px 12px;background:white;color:#163c43;cursor:pointer}
details{margin:20px 0;padding:18px;background:#ecefe8;border-radius:8px}summary{font-weight:700;cursor:pointer}
code{font-size:12px;overflow-wrap:anywhere}footer{margin-top:32px;color:#52636c;font-size:13px}
</style></head><body>
<div class="eyebrow">Dependency Explorer · reproducible browser benchmark</div>
<h1>Measured scale, not a promised node limit</h1>
<p>Actual TypeScript model and shipped Canvas renderer; 1,000, 10,000 and 50,000 nodes with approximately 2, 5 and 20 outgoing edges per node.</p>
<p class="warning"><strong>Environment:</strong> ${esc(data.browser.product)} headless on ${esc(data.machine.cpu)} (${data.machine.logicalCpus} logical CPUs, ${num(data.machine.ramGiB)} GiB RAM), using <strong>software Canvas/compositing</strong>. This is not a hardware-accelerated laptop/mobile benchmark and excludes React panel rendering, external icon downloads, layout algorithms and physical input-to-display latency.</p>
<div class="tools"><label for="density">Show density</label><select id="density"><option value="all">All densities</option><option value="2">~2 edges/node</option><option value="5">~5 edges/node</option><option value="20">~20 edges/node</option></select><button id="download">Download raw results JSON</button></div>
<h2>Overview versus zoomed-in interaction</h2>
<p>All timings are milliseconds. Pan latency measures a redraw request through the next animation-frame callback after drawing. Draw time measures JavaScript submission of Canvas commands, not completed pixel rendering. Setup is the sum of phase medians, not a separately measured total.</p>
<div class="scroll"><table><thead><tr><th>Nodes</th><th>Edges</th><th>Degree</th><th>Setup sum</th><th>Overview pan</th><th>Zoomed pan</th><th>Overview draw</th><th>Zoomed draw</th></tr></thead><tbody>${rows}</tbody></table></div>
${errors}
${before ? `<h2>Equivalent before / after</h2>
<p>Fresh instrumented runs with the same fixtures, viewport, software rendering, sample counts and pointer actions. Before started ${esc(before.startedAt)}; after started ${esc(data.startedAt)}. All values are milliseconds. Samples are short and descriptive, not guaranteed FPS.</p>
<div class="scroll"><table><thead><tr><th>Nodes / degree</th><th>Before overview pan</th><th>After overview pan</th><th>Before overview drag</th><th>After overview drag</th><th>Before zoomed pan</th><th>After zoomed pan</th><th>Overview edge paths / candidates</th><th>Overview node marks / candidates</th></tr></thead><tbody>${comparisons}</tbody></table></div>` : ""}
<h2>Overview rendering profile</h2>
<p>Instance-local timers wrap the shipped edge pass and minimap. Edge pass includes path construction or cache lookup and stroke/fill submission. Submit is a subset of the edge pass; it does not include deferred raster completion. The larger request-to-rAF values above expose scheduling and deferred software raster/compositing workload, but do not isolate raster time. Medians should not be subtracted as if they were paired samples.</p>
<div class="scroll"><table><thead><tr><th>Nodes / degree</th><th>Before edge pass</th><th>After edge pass</th><th>Before edge submit</th><th>After edge submit</th><th>Before minimap</th><th>After minimap</th></tr></thead><tbody>${profiles}</tbody></table></div>
<h2>Rendering tradeoffs</h2>
<ul><li>Crowded overviews (scale below 0.3 and more than 4,000 base edge candidates) use 1,800 evenly spaced base-edge representatives. Other views above 12,000 base edges use 4,000. Cyclic-to-cyclic edges and edges incident to selection/hover are additional, not capped. Directional highlighted edges are always kept, including arrowheads; a huge highlighted neighborhood can still be expensive.</li>
<li>Below scale 0.3 with more than 4,000 visible nodes, ordinary nodes share 6-pixel density cells by faded state, colored by a representative kind. Highlighted, matching, selected, hovered, cyclic and pinned nodes stay individual. Counts and a visible notice identify reduced detail; zoom or focus to inspect relationships. Density cells are visual summaries, not selectable replacement graph nodes.</li>
<li>Edge paths are reused on translation-only pans while the incident-node set and geometry are unchanged. Drag, scene updates and zoom invalidate paths. The minimap copies a cached static layer on pan; while dragging it overlays the moving node and recomputes bounds at release. Cold cache rebuilds and zoom still cost more than warm pans.</li>
<li>The model, picking index and graph analysis remain exact. Icons return at their existing zoom thresholds. No force layout or model truncation is introduced. Import and analysis stalls are outside this rendering change.</li></ul>
<h2>Zoom, dragging and visible workload</h2>
<p>Same renderer handlers, with synthetic pointer events. OS event delivery and React selection/hover state updates are excluded. Candidate edges include incident off-screen edges and may be skipped when endpoints visually overlap. Workload counts are the final stats after each view's zoom and drag samples, not pixel coverage or all model relationships.</p>
<div class="scroll"><table><thead><tr><th>Nodes / degree</th><th>Overview zoom</th><th>Overview drag</th><th>Zoomed zoom</th><th>Zoomed drag</th><th>Zoomed node marks</th><th>Zoomed edge paths</th></tr></thead><tbody>${interactions}</tbody></table></div>
<h2>Model costs and sampled heap</h2>
<p>Each phase has three measurements. Reachability traverses the complete chain from either end. Heap is a post-case sample including fixture, JSON and benchmark allocation overhead—not steady-state viewer memory or total process memory.</p>
<div class="scroll"><table><thead><tr><th>Nodes / degree</th><th>JSON parse</th><th>Validate</th><th>Index</th><th>SCC + components</th><th>Positions</th><th>Spatial index</th><th>Dependencies</th><th>Dependents</th><th>Heap MiB</th></tr></thead><tbody>${phases}</tbody></table></div>
<details><summary>Methodology and how to interpret the results</summary>
<ul>
<li>Canvas viewport: 1000×700 CSS pixels at DPR 1; minimap 180×120 enabled. Five built-in vector icons and zoom-dependent labels; no external images.</li>
<li>Topology: fixed 68-unit grid, a backward chain plus seeded random backward dependencies, and a reverse dependency every 200 nodes. Density is out-degree, not an all-to-all graph.</li>
<li>Three model passes per case. Rendering uses two warm-up pans, then 12 pan, 6 zoom and 8 drag samples per view. Medians use the empirical upper middle sample; p95 is descriptive and is the maximum for these small samples.</li>
<li>Overview fits all nodes; zoomed view uses scale 1 centered on the middle node. The number of visible nodes/edges differs by graph size. At low zoom the renderer omits arrows and icons, so overview and zoomed drawing cost are not identical per edge.</li>
<li>Each case navigates to a fresh benchmark page and triggers garbage collection before setup. JIT warmup, scheduling, raster work and garbage collection can affect results. No confidence interval or sustained stress endurance test is claimed.</li>
<li>Timing stops at the animation-frame callback following draw submission. It does not prove pixels reached a physical display or establish real user FPS. Hardware-accelerated browsers may behave differently.</li>
<li>Renderer-only results exclude React list/details updates, persistence and JSON file reading. Layout is deliberately not measured.</li>
<li>GPU reported: ${esc(gpu.devices.map(d => d.deviceString).join("; "))}. Canvas status: ${esc(gpu.featureStatus["2d_canvas"])}; compositing: ${esc(gpu.featureStatus.gpu_compositing)}.</li>
</ul>
<p><strong>Reproduce:</strong> start the managed web workflow, then run <code>node artifacts/dependency-explorer/scripts/benchmark.mjs</code> and <code>node artifacts/dependency-explorer/scripts/benchmark-report.mjs</code>. The developer benchmark entry is not included in the production build.</p>
</details>
<footer>Run started ${esc(data.startedAt)}; completed ${esc(data.finishedAt || "incomplete")}. Raw metrics are embedded in this self-contained report.</footer>
<script>const results=${json};document.getElementById('density').addEventListener('change',e=>document.querySelectorAll('[data-density]').forEach(row=>row.hidden=e.target.value!=='all'&&row.dataset.density!==e.target.value));document.getElementById('download').addEventListener('click',()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(results,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='dependency-explorer-benchmark.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)});</script>
</body></html>`;
await writeFile(path.join(dir, "report.html"), html);
console.log("Wrote generated-artifacts/graph-benchmarks/report.html");
