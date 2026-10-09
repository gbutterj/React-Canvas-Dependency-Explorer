import type { DependencyEdge, DependencyNode, GraphDocument, NodeKind, Point } from "./types";

interface Cluster {
  owner: string;
  kind: NodeKind;
  center: Point;
  labels: string[];
}

/** Supplied presentation coordinates, not a layout algorithm. All data is synthetic. */
export function createDemoDocument(): GraphDocument {
  const clusters: Cluster[] = [
    { owner: "Commerce", kind: "service", center: { x: 0, y: 0 }, labels: [
      "checkout-api", "cart-api", "pricing-api", "promotion-engine", "orders-api",
      "inventory-api", "catalog-api", "shipping-api", "returns-api", "tax-service",
    ] },
    { owner: "Platform", kind: "service", center: { x: -450, y: -270 }, labels: [
      "api-gateway", "identity-service", "session-service", "feature-flags", "config-service",
      "audit-service", "rate-limiter", "tenant-service",
    ] },
    { owner: "Experience", kind: "service", center: { x: -460, y: 290 }, labels: [
      "storefront-web", "mobile-bff", "admin-console", "search-api", "recommendation-api", "content-api", "customer-api",
    ] },
    { owner: "Data engineering", kind: "database", center: { x: 450, y: 310 }, labels: [
      "orders-postgres", "catalog-postgres", "customers-postgres", "session-redis", "cart-redis", "search-index", "analytics-warehouse",
    ] },
    { owner: "Integrations", kind: "external", center: { x: 470, y: -280 }, labels: [
      "payment-provider", "shipping-provider", "tax-provider", "email-provider", "fraud-provider", "cdn-provider",
    ] },
    { owner: "Developer experience", kind: "package", center: { x: 10, y: -480 }, labels: [
      "shared-types", "http-client", "auth-sdk", "logger", "metrics", "config-sdk", "validation",
      "data-contracts", "event-schema", "database-client", "cache-client", "ui-components",
      "currency-utils", "date-utils", "test-utils", "tracing", "retry-policy", "error-types",
    ] },
    { owner: "Infrastructure", kind: "queue", center: { x: 10, y: 470 }, labels: [
      "order-events", "payment-events", "inventory-events", "notification-worker",
      "fulfillment-worker", "analytics-worker", "dead-letter-queue", "scheduler",
    ] },
  ];
  const nodes: DependencyNode[] = [];
  const positions: Record<string, Point> = Object.create(null) as Record<string, Point>;
  for (const cluster of clusters) {
    cluster.labels.forEach((id, i) => {
      const angle = (i / cluster.labels.length) * Math.PI * 2 - Math.PI / 2;
      const radius = cluster.labels.length > 12 ? 160 : 126;
      positions[id] = { x: cluster.center.x + Math.cos(angle) * radius, y: cluster.center.y + Math.sin(angle) * radius };
      nodes.push({
        id, label: id, kind: cluster.kind, owner: cluster.owner,
        description: cluster.kind === "package"
          ? `Shared ${id.replaceAll("-", " ")} module used across Atlas commerce.`
          : `${id.replaceAll("-", " ")} in the Atlas commerce reference system.`,
        version: cluster.kind === "external" ? undefined : `2.${i % 9}.${(i * 3) % 12}`,
        tags: [cluster.owner.toLowerCase().replaceAll(" ", "-"), cluster.kind === "service" ? "production" : "shared"],
      });
    });
  }
  // More descriptive examples make inspector and hover details useful.
  const checkout = nodes.find(node => node.id === "checkout-api")!;
  checkout.description = "Orchestrates checkout, validates the cart, authorizes payment, and creates customer orders.";
  checkout.version = "3.8.2";
  const pricing = nodes.find(node => node.id === "pricing-api")!;
  pricing.description = "Resolves prices and promotions. Part of a circular dependency with cart-api and promotion-engine.";
  const edges: DependencyEdge[] = [];
  const add = (source: string, target: string, kind: DependencyEdge["kind"] = "runtime") => {
    edges.push({ id: `${source}:${target}:${kind}`, source, target, kind });
  };
  const dependencies: Record<string, string[]> = {
    "checkout-api": ["cart-api", "pricing-api", "orders-api", "inventory-api", "tax-service", "payment-provider", "fraud-provider", "order-events"],
    "cart-api": ["pricing-api", "cart-redis", "catalog-api"],
    "pricing-api": ["promotion-engine", "currency-utils"],
    "promotion-engine": ["cart-api", "feature-flags"],
    "orders-api": ["orders-postgres", "payment-events", "shipping-api"],
    "inventory-api": ["catalog-postgres", "inventory-events"],
    "catalog-api": ["catalog-postgres", "search-index", "cdn-provider"],
    "shipping-api": ["shipping-provider", "order-events"],
    "returns-api": ["orders-api", "payment-provider"],
    "tax-service": ["tax-provider", "currency-utils"],
    "api-gateway": ["checkout-api", "catalog-api", "identity-service", "search-api", "rate-limiter"],
    "identity-service": ["customers-postgres", "session-service", "audit-service"],
    "session-service": ["session-redis"],
    "feature-flags": ["config-service"],
    "config-service": ["config-sdk"],
    "audit-service": ["analytics-warehouse"],
    "rate-limiter": ["session-redis"],
    "tenant-service": ["identity-service", "customers-postgres"],
    "storefront-web": ["api-gateway", "ui-components", "auth-sdk", "content-api"],
    "mobile-bff": ["api-gateway", "customer-api", "recommendation-api"],
    "admin-console": ["api-gateway", "tenant-service", "audit-service", "ui-components"],
    "search-api": ["search-index", "catalog-api"],
    "recommendation-api": ["analytics-warehouse", "catalog-api"],
    "content-api": ["cdn-provider", "config-service"],
    "customer-api": ["customers-postgres", "identity-service"],
    "order-events": ["notification-worker", "event-schema"],
    "payment-events": ["analytics-worker", "event-schema"],
    "inventory-events": ["fulfillment-worker", "event-schema"],
    "notification-worker": ["order-events", "email-provider", "dead-letter-queue"],
    "fulfillment-worker": ["shipping-api", "orders-api", "dead-letter-queue"],
    "analytics-worker": ["analytics-warehouse", "dead-letter-queue"],
    "scheduler": ["fulfillment-worker", "notification-worker"],
    "http-client": ["retry-policy", "error-types", "tracing"],
    "auth-sdk": ["http-client", "shared-types"],
    "validation": ["shared-types"],
    "data-contracts": ["event-schema", "shared-types"],
    "event-schema": ["shared-types", "validation"],
    "database-client": ["logger", "metrics"],
    "cache-client": ["logger", "retry-policy"],
    "ui-components": ["shared-types", "date-utils"],
    "config-sdk": ["http-client", "validation"],
    "tracing": ["logger", "metrics"],
    "retry-policy": ["error-types"],
    "currency-utils": ["shared-types"],
  };
  for (const [source, targets] of Object.entries(dependencies)) {
    for (const target of targets) {
      const targetNode = nodes.find(node => node.id === target)!;
      add(source, target, targetNode.kind === "database" ? "data" : targetNode.kind === "package" ? "build" : "runtime");
    }
  }
  for (const node of nodes.filter(node => node.kind === "service")) {
    if (node.id !== "config-service") add(node.id, "logger", "build");
    if (node.id === "checkout-api" || node.id === "api-gateway" || node.id === "orders-api") add(node.id, "tracing", "optional");
  }
  return {
    schemaVersion: 1, name: "Atlas commerce",
    description: "Synthetic reference system — services, packages, storage, events, and integrations. Not connected to live infrastructure.",
    nodes, edges, view: { positions, pinned: [] },
  };
}

export function createStressDocument(count = 10_000): GraphDocument {
  if (!Number.isInteger(count) || count < 1 || count > 100_000) throw new Error("Synthetic node count must be an integer between 1 and 100,000.");
  const nodes: DependencyNode[] = [];
  const edges: DependencyEdge[] = [];
  const positions: Record<string, Point> = Object.create(null) as Record<string, Point>;
  const width = Math.ceil(Math.sqrt(count));
  const kinds: NodeKind[] = ["service", "package", "database", "queue", "external"];
  const nodeId = (i: number) => `node-${i.toString().padStart(5, "0")}`;
  for (let i = 0; i < count; i++) {
    const id = nodeId(i);
    nodes.push({
      id, label: `module-${i.toString().padStart(5, "0")}`, kind: kinds[i % kinds.length]!,
      owner: `Team ${Math.floor(i / 200) + 1}`, version: "1.0.0",
      description: "Deterministic synthetic node for exploring renderer and model behavior at scale.",
      tags: ["synthetic", "stress-fixture"],
    });
    positions[id] = { x: (i % width) * 68, y: Math.floor(i / width) * 68 };
    if (i > 0) edges.push({ id: `e-${i}-chain`, source: id, target: nodeId(i - 1), kind: "runtime" });
    if (i > 2) edges.push({ id: `e-${i}-parent`, source: id, target: nodeId(Math.floor(i / 3)), kind: "build" });
    if (i > 0 && i % 200 === 0) edges.push({ id: `e-${i}-cycle`, source: nodeId(i - 1), target: id, kind: "runtime" });
  }
  return {
    schemaVersion: 1, name: `${count.toLocaleString("en-US")}-node synthetic graph`,
    description: "Synthetic stress fixture, not a benchmark guarantee. Device, density, icons, and visible edge count determine performance.",
    nodes, edges, view: { positions, pinned: [] },
  };
}
