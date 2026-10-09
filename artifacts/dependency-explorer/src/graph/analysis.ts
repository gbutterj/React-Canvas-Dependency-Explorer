import type { GraphAnalysis, GraphIndex } from "./types";

/** Iterative Kosaraju: avoid recursion limits on long dependency chains. */
export function stronglyConnectedComponents(graph: GraphIndex): string[][] {
  const visited = new Set<string>();
  const finish: string[] = [];
  for (const root of graph.nodes.keys()) {
    if (visited.has(root)) continue;
    visited.add(root);
    const stack = [{ id: root, edge: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const edgeIds = graph.outgoing.get(frame.id)!;
      if (frame.edge >= edgeIds.length) {
        finish.push(frame.id);
        stack.pop();
        continue;
      }
      const target = graph.edges.get(edgeIds[frame.edge++]!)!.target;
      if (!visited.has(target)) {
        visited.add(target);
        stack.push({ id: target, edge: 0 });
      }
    }
  }
  visited.clear();
  const components: string[][] = [];
  for (let i = finish.length - 1; i >= 0; i--) {
    const root = finish[i]!;
    if (visited.has(root)) continue;
    const group: string[] = [];
    const stack = [root];
    visited.add(root);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(id);
      for (const edgeId of graph.incoming.get(id)!) {
        const source = graph.edges.get(edgeId)!.source;
        if (visited.has(source)) continue;
        visited.add(source);
        stack.push(source);
      }
    }
    components.push(group);
  }
  return components;
}

export function weaklyConnectedComponents(graph: GraphIndex): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const root of graph.nodes.keys()) {
    if (seen.has(root)) continue;
    const queue = [root];
    seen.add(root);
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head]!;
      for (const edgeId of graph.outgoing.get(id)!) {
        const target = graph.edges.get(edgeId)!.target;
        if (!seen.has(target)) { seen.add(target); queue.push(target); }
      }
      for (const edgeId of graph.incoming.get(id)!) {
        const source = graph.edges.get(edgeId)!.source;
        if (!seen.has(source)) { seen.add(source); queue.push(source); }
      }
    }
    components.push(queue);
  }
  return components;
}

export function analyzeGraph(graph: GraphIndex): GraphAnalysis {
  // "Cycles" means cyclic SCC groups, not enumeration of all simple cycles.
  // Enumerating all simple cycles can produce exponentially many results.
  const selfLoops = new Set<string>();
  for (const edge of graph.edges.values()) if (edge.source === edge.target) selfLoops.add(edge.source);
  const cycles = stronglyConnectedComponents(graph)
    .filter(group => group.length > 1 || selfLoops.has(group[0]!));
  const cycleNodeIds = new Set(cycles.flat());
  const orphanIds: string[] = [];
  let maxFanIn = 0;
  let maxFanOut = 0;
  for (const id of graph.nodes.keys()) {
    const incoming = graph.incoming.get(id)!.length;
    const outgoing = graph.outgoing.get(id)!.length;
    if (!incoming && !outgoing) orphanIds.push(id);
    maxFanIn = Math.max(maxFanIn, incoming);
    maxFanOut = Math.max(maxFanOut, outgoing);
  }
  return { cycles, cycleNodeIds, components: weaklyConnectedComponents(graph), orphanIds, maxFanIn, maxFanOut };
}
