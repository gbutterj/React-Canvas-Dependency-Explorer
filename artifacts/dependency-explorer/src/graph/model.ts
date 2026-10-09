import {
  EDGE_KINDS, NODE_KINDS,
  type DependencyEdge, type DependencyNode, type Direction,
  type GraphDocument, type GraphIndex, type GraphView, type Point,
} from "./types";

function object(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${at} must be an object.`);
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, at: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${at} must be a non-empty string.`);
  return value;
}
function optionalText(value: unknown, at: string): string | undefined {
  return value === undefined ? undefined : text(value, at);
}
function array(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at} must be an array.`);
  return value;
}
function finite(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${at} must be a finite number.`);
  return value;
}

/** Normalize external input at the boundary, never silently drop invalid edges. */
export function parseGraphDocument(input: unknown): GraphDocument {
  const raw = object(input, "Graph");
  if (raw.schemaVersion !== 1) throw new Error("schemaVersion must be 1.");
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nodes = array(raw.nodes, "nodes").map((value, i): DependencyNode => {
    const node = object(value, `nodes[${i}]`);
    const id = text(node.id, `nodes[${i}].id`);
    if (nodeIds.has(id)) throw new Error(`Duplicate node ID "${id}".`);
    nodeIds.add(id);
    if (!NODE_KINDS.includes(node.kind as DependencyNode["kind"])) {
      throw new Error(`Node "${id}" kind must be one of: ${NODE_KINDS.join(", ")}.`);
    }
    return {
      id, label: text(node.label, `Node "${id}" label`), kind: node.kind as DependencyNode["kind"],
      description: optionalText(node.description, `Node "${id}" description`),
      owner: optionalText(node.owner, `Node "${id}" owner`),
      version: optionalText(node.version, `Node "${id}" version`),
      icon: optionalText(node.icon, `Node "${id}" icon`),
      tags: node.tags === undefined ? undefined : array(node.tags, `Node "${id}" tags`)
        .map((tag, j) => text(tag, `Node "${id}" tags[${j}]`)),
    };
  });
  const edges = array(raw.edges, "edges").map((value, i): DependencyEdge => {
    const edge = object(value, `edges[${i}]`);
    const id = text(edge.id, `edges[${i}].id`);
    if (edgeIds.has(id)) throw new Error(`Duplicate edge ID "${id}".`);
    edgeIds.add(id);
    const source = text(edge.source, `Edge "${id}" source`);
    const target = text(edge.target, `Edge "${id}" target`);
    if (!nodeIds.has(source) || !nodeIds.has(target)) throw new Error(`Edge "${id}" references a missing node: ${!nodeIds.has(source) ? source : target}.`);
    if (!EDGE_KINDS.includes(edge.kind as DependencyEdge["kind"])) {
      throw new Error(`Edge "${id}" kind must be one of: ${EDGE_KINDS.join(", ")}.`);
    }
    return { id, source, target, kind: edge.kind as DependencyEdge["kind"], label: optionalText(edge.label, `Edge "${id}" label`) };
  });
  const doc: GraphDocument = {
    schemaVersion: 1, name: text(raw.name, "name"),
    description: optionalText(raw.description, "description"), nodes, edges,
  };
  if (raw.view !== undefined) {
    doc.view = parseGraphView(raw.view, nodeIds);
  }
  return doc;
}

/** Validate saved view data without re-normalizing an already validated graph. */
export function parseGraphView(input: unknown, nodeIds: Pick<ReadonlySet<string>, "has">): GraphView {
  const view = object(input, "view");
  const positions = object(view.positions, "view.positions");
  const normalized: Record<string, Point> = Object.create(null) as Record<string, Point>;
  for (const [id, value] of Object.entries(positions)) {
    if (!nodeIds.has(id)) throw new Error(`Position references missing node "${id}".`);
    const point = object(value, `Position "${id}"`);
    normalized[id] = { x: finite(point.x, `Position "${id}".x`), y: finite(point.y, `Position "${id}".y`) };
  }
  const pinned = view.pinned === undefined ? undefined : array(view.pinned, "view.pinned").map((value, i) => {
    const id = text(value, `view.pinned[${i}]`);
    if (!nodeIds.has(id)) throw new Error(`Pinned node "${id}" does not exist.`);
    return id;
  });
  return { positions: normalized, pinned: pinned ? [...new Set(pinned)] : undefined };
}

/** O(V+E) adjacency indexes; supports typed parallel edges and self loops. */
export function buildGraphIndex(document: GraphDocument): GraphIndex {
  const nodes = new Map<string, DependencyNode>();
  const edges = new Map<string, DependencyEdge>();
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of document.nodes) {
    if (nodes.has(node.id)) throw new Error(`Duplicate node ID "${node.id}".`);
    nodes.set(node.id, node);
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of document.edges) {
    if (edges.has(edge.id)) throw new Error(`Duplicate edge ID "${edge.id}".`);
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) throw new Error(`Edge "${edge.id}" references a missing node.`);
    edges.set(edge.id, edge);
    outgoing.get(edge.source)!.push(edge.id);
    incoming.get(edge.target)!.push(edge.id);
  }
  return { nodes, edges, incoming, outgoing };
}

function adjacent(index: GraphIndex, id: string, direction: Direction): string[] {
  const edgeIds = (direction === "dependencies" ? index.outgoing : index.incoming).get(id) ?? [];
  return edgeIds.map(edgeId => {
    const edge = index.edges.get(edgeId)!;
    return direction === "dependencies" ? edge.target : edge.source;
  });
}
export function neighbors(index: GraphIndex, id: string, direction: Direction): DependencyNode[] {
  return [...new Set(adjacent(index, id, direction))].map(nodeId => index.nodes.get(nodeId)!);
}

function checkDepth(depth: number) {
  if (depth !== Infinity && (!Number.isInteger(depth) || depth < 0)) throw new Error("Traversal depth must be a non-negative integer or Infinity.");
}
function traverse(index: GraphIndex, start: string, direction: Direction | "both", depth: number): Set<string> {
  checkDepth(depth);
  const visited = new Set<string>();
  if (!index.nodes.has(start)) return visited;
  visited.add(start);
  const queue: { id: string; depth: number }[] = [{ id: start, depth: 0 }];
  for (let head = 0; head < queue.length; head++) {
    const item = queue[head]!;
    if (item.depth >= depth) continue;
    const candidates = direction === "both"
      ? [...adjacent(index, item.id, "dependencies"), ...adjacent(index, item.id, "dependents")]
      : adjacent(index, item.id, direction);
    for (const id of candidates) {
      if (visited.has(id)) continue;
      visited.add(id);
      queue.push({ id, depth: item.depth + 1 });
    }
  }
  return visited;
}
export function reachable(index: GraphIndex, id: string, direction: Direction, maxDepth = Infinity): Set<string> {
  const result = traverse(index, id, direction, maxDepth);
  result.delete(id);
  return result;
}
export function neighborhood(index: GraphIndex, id: string, direction: Direction | "both", depth = 1): Set<string> {
  return traverse(index, id, direction, depth);
}
/** Unweighted shortest directed dependency path; O(V+E) worst case. */
export function shortestPath(index: GraphIndex, source: string, target: string): string[] | null {
  if (!index.nodes.has(source) || !index.nodes.has(target)) return null;
  if (source === target) return [source];
  const previous = new Map<string, string | null>([[source, null]]);
  const queue = [source];
  for (let head = 0; head < queue.length; head++) {
    for (const neighbor of adjacent(index, queue[head]!, "dependencies")) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, queue[head]!);
      if (neighbor === target) {
        const path = [target];
        let node = target;
        while (previous.get(node) !== null) {
          node = previous.get(node)!;
          path.push(node);
        }
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }
  return null;
}
