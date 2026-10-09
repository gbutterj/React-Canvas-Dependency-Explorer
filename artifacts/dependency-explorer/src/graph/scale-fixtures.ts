import { createStressDocument } from "./fixtures";
import type { GraphDocument } from "./types";

export type ScaleDensity = 2 | 5 | 20;
export type SampleKind = "demo" | "scale-1000" | "scale-10000" | "scale-50000";

/** Reproduces the seeded dependency distribution used by the scale benchmark.
 * Coordinates are supplied on a grid; this is not a force-layout algorithm.
 */
export function createScaleDocument(count: 1000 | 10000 | 50000, degree: ScaleDensity): GraphDocument {
  const doc = createStressDocument(count);
  doc.edges = [];
  let seed = 734981;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 1; i < count; i++) {
    const chosen = new Set<number>([i - 1]);
    while (chosen.size < Math.min(degree, i)) chosen.add(random() % i);
    let j = 0;
    for (const target of chosen) {
      doc.edges.push({
        id: `e-${i}-${j}`,
        source: doc.nodes[i]!.id,
        target: doc.nodes[target]!.id,
        kind: j++ % 2 ? "build" : "runtime",
      });
    }
    if (i % 200 === 0) {
      doc.edges.push({ id: `cycle-${i}`, source: doc.nodes[i - 1]!.id, target: doc.nodes[i]!.id, kind: "runtime" });
    }
  }
  doc.name = `${count.toLocaleString("en-US")}-node synthetic graph (${degree} dependencies/node)`;
  doc.description = "Synthetic benchmark-scale dependencies with type icons, metadata and small cycles. Supplied grid coordinates, not force-directed layout. Initial nodes have fewer dependencies; cycle edges slightly increase the total.";
  return doc;
}

export function sampleFromUrl(): { kind: SampleKind; density: ScaleDensity } {
  const params = new URLSearchParams(window.location.search);
  const scale = params.get("scale");
  const kind: SampleKind = scale === "1000" ? "scale-1000" : scale === "10000" ? "scale-10000" : scale === "50000" ? "scale-50000" : "demo";
  const value = params.get("density");
  return { kind, density: value === "5" ? 5 : value === "20" ? 20 : 2 };
}
