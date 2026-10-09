import type { DependencyEdge } from "@/graph/types";

/** A rendering budget, never a graph/model limit. Highlights bypass this policy. */
export function edgeBudget(scale: number, candidates: number): number {
  return scale < 0.3 && candidates > 4000 ? 1800 : candidates > 12000 ? 4000 : candidates;
}

/**
 * Evenly spaced deterministic representatives (not the first N edges). Important
 * edges are additional to the budget, so selection and cycle information survives.
 * This is sampling, not a claim that omitted relationships are represented.
 */
export function sampleEdges(
  edges: DependencyEdge[], budget: number, important: (edge: DependencyEdge) => boolean,
): DependencyEdge[] {
  if (edges.length <= budget) return edges;
  const result: DependencyEdge[] = [];
  for (let i = 0; i < edges.length; i++) {
    if (Math.floor(i * budget / edges.length) !== Math.floor((i + 1) * budget / edges.length) || important(edges[i]!))
      result.push(edges[i]!);
  }
  return result;
}
