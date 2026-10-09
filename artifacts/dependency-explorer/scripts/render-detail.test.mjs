import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeBudget, sampleEdges } from "../src/lib/render-detail.ts";

test("detail budgets depend on scale and workload, not model size", () => {
  assert.equal(edgeBudget(0.1, 4000), 4000);
  assert.equal(edgeBudget(0.1, 4001), 1800);
  assert.equal(edgeBudget(1, 12000), 12000);
  assert.equal(edgeBudget(1, 12001), 4000);
});
test("sampling is deterministic, distributed, and preserves important edges", () => {
  const edges = Array.from({ length: 10000 }, (_, i) => ({ id: `${i}`, source: `${i}`, target: "root" }));
  const sampled = sampleEdges(edges, 100, e => e.id === "0");
  assert.equal(sampled.length, 101);
  assert.equal(sampled[0], edges[0]);
  assert.equal(sampled.at(-1), edges.at(-1));
  assert.deepEqual(sampled, sampleEdges(edges, 100, e => e.id === "0"));
  assert.equal(new Set(sampled).size, sampled.length);
  assert.equal(sampleEdges(edges, edges.length, () => false), edges);
});
