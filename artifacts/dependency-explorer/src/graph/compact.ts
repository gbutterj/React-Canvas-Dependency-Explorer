import type { GraphIndex } from "./types";

/** Worker-owned CSR: two numeric neighbor arrays, not duplicate edge objects/maps. */
export function compactGraph(index: GraphIndex) {
  const ids = [...index.nodes.keys()];
  const ordinal = new Map(ids.map((id, i) => [id, i]));
  const outgoingOffsets = new Uint32Array(ids.length + 1);
  const incomingOffsets = new Uint32Array(ids.length + 1);
  for (let i = 0; i < ids.length; i++) {
    outgoingOffsets[i + 1] = outgoingOffsets[i]! + index.outgoing.get(ids[i]!)!.length;
    incomingOffsets[i + 1] = incomingOffsets[i]! + index.incoming.get(ids[i]!)!.length;
  }
  const outgoing = new Uint32Array(index.edges.size);
  const incoming = new Uint32Array(index.edges.size);
  for (let i = 0; i < ids.length; i++) {
    let at = outgoingOffsets[i]!;
    for (const edge of index.outgoing.get(ids[i]!)!) outgoing[at++] = ordinal.get(index.edges.get(edge)!.target)!;
    at = incomingOffsets[i]!;
    for (const edge of index.incoming.get(ids[i]!)!) incoming[at++] = ordinal.get(index.edges.get(edge)!.source)!;
  }
  return { ids, ordinal, outgoingOffsets, incomingOffsets, outgoing, incoming };
}
export type CompactGraph = ReturnType<typeof compactGraph>;

/** Distinct immediate neighbors include the root for a self-loop, like neighbors(). */
export function compactNeighbors(graph: CompactGraph, root: string, incoming: boolean): Set<string> {
  const result = new Set<string>(), start = graph.ordinal.get(root);
  if (start === undefined) return result;
  const offsets = incoming ? graph.incomingOffsets : graph.outgoingOffsets;
  const neighbors = incoming ? graph.incoming : graph.outgoing;
  for (let at = offsets[start]!; at < offsets[start + 1]!; at++) result.add(graph.ids[neighbors[at]!]!);
  return result;
}

/** Yield even on one huge fan-out, so newer selections can cancel traversal. */
export async function compactReachable(
  graph: CompactGraph, root: string, incoming: boolean, depth: number, cancelled: () => boolean,
): Promise<Set<string> | null> {
  const start = graph.ordinal.get(root);
  if (start === undefined) return new Set();
  const seen = new Uint8Array(graph.ids.length);
  const queue = new Uint32Array(graph.ids.length);
  const levels = new Uint32Array(graph.ids.length);
  seen[start] = 1;
  queue[0] = start;
  let tail = 1, work = 0;
  const offsets = incoming ? graph.incomingOffsets : graph.outgoingOffsets;
  const neighbors = incoming ? graph.incoming : graph.outgoing;
  for (let head = 0; head < tail; head++) {
    const node = queue[head]!;
    if (levels[head]! >= depth) continue;
    for (let at = offsets[node]!; at < offsets[node + 1]!; at++) {
      const target = neighbors[at]!;
      if (!seen[target]) {
        seen[target] = 1;
        levels[tail] = levels[head]! + 1;
        queue[tail++] = target;
      }
      if (++work % 8192 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (cancelled()) return null;
      }
    }
  }
  if (cancelled()) return null;
  const result = new Set<string>();
  for (let i = 1; i < tail; i++) result.add(graph.ids[queue[i]!]!);
  return result;
}
