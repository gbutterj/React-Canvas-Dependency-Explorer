import type { Point } from "./types";

/** Incremental world-space uniform grid. No per-node DOM or full scan for picking. */
export class SpatialIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly positions = new Map<string, Point>();
  private readonly cellSize: number;
  constructor(positions: ReadonlyMap<string, Point>, cellSize = 96) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new Error("Spatial cell size must be finite and positive.");
    this.cellSize = cellSize;
    for (const [id, point] of positions) this.update(id, point);
  }
  private cell(point: Point): string {
    return `${Math.floor(point.x / this.cellSize)},${Math.floor(point.y / this.cellSize)}`;
  }
  update(id: string, point: Point): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Spatial coordinates must be finite.");
    const old = this.positions.get(id);
    const key = this.cell(point);
    if (old) {
      const oldKey = this.cell(old);
      if (oldKey !== key) {
        const cell = this.cells.get(oldKey)!;
        cell.delete(id);
        if (!cell.size) this.cells.delete(oldKey);
      }
    }
    if (!this.cells.has(key)) this.cells.set(key, new Set());
    this.cells.get(key)!.add(id);
    this.positions.set(id, { ...point });
  }
  query(minX: number, minY: number, maxX: number, maxY: number): string[] {
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error("Query bounds must be finite.");
    if (minX > maxX || minY > maxY) return [];
    const left = Math.floor(minX / this.cellSize);
    const right = Math.floor(maxX / this.cellSize);
    const top = Math.floor(minY / this.cellSize);
    const bottom = Math.floor(maxY / this.cellSize);
    const result: string[] = [];
    const include = (ids: Set<string>) => {
      for (const id of ids) {
        const p = this.positions.get(id)!;
        if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) result.push(id);
      }
    };
    // At far zoom-out, iterate populated cells instead of millions of empty ones.
    if ((right - left + 1) * (bottom - top + 1) > this.cells.size * 2) {
      for (const ids of this.cells.values()) include(ids);
    } else {
      for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) {
        const ids = this.cells.get(`${x},${y}`);
        if (ids) include(ids);
      }
    }
    return result;
  }
  nearest(point: Point, radius: number): string | null {
    if (!Number.isFinite(radius) || radius < 0) throw new Error("Picking radius must be finite and non-negative.");
    let best: string | null = null;
    let distance = radius * radius;
    for (const id of this.query(point.x - radius, point.y - radius, point.x + radius, point.y + radius)) {
      const candidate = this.positions.get(id)!;
      const d = (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2;
      if (d <= distance) { distance = d; best = id; }
    }
    return best;
  }
}
