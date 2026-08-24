// src/engine/composer/grid.ts — the per-floor cell grid shared by every embedder, with the
// two graph searches the design needs: A* corridor carving with per-state costs and BFS
// reachability. Integer cells only; no trig, no Math.random.
import { GRID } from './types';

export const SOLID = 0, FLOOR = 1, DOOR = 2, STAIRS = 3;
export type CellState = typeof SOLID | typeof FLOOR | typeof DOOR | typeof STAIRS;

export class CellGrid {
  readonly n: number;
  readonly state: Uint8Array;
  readonly owner: Int16Array;          // zone index (−1 = none) for FLOOR/STAIRS cells; door index for DOOR cells
  constructor(n = GRID) { this.n = n; this.state = new Uint8Array(n * n); this.owner = new Int16Array(n * n).fill(-1); }
  idx(x: number, z: number): number { return z * this.n + x; }
  inside(x: number, z: number): boolean { return x >= 0 && z >= 0 && x < this.n && z < this.n; }
  get(x: number, z: number): CellState { return this.inside(x, z) ? (this.state[this.idx(x, z)] as CellState) : SOLID; }
  set(x: number, z: number, s: CellState, owner = -1): void { if (!this.inside(x, z)) return; const i = this.idx(x, z); this.state[i] = s; this.owner[i] = owner; }
  ownerAt(x: number, z: number): number { return this.inside(x, z) ? this.owner[this.idx(x, z)] : -1; }
  /** True if the rect (inclusive) plus a `margin` ring is entirely SOLID and inside the grid. */
  free(x0: number, z0: number, x1: number, z1: number, margin = 1): boolean {
    if (x0 - margin < 0 || z0 - margin < 0 || x1 + margin >= this.n || z1 + margin >= this.n) return false;
    for (let z = z0 - margin; z <= z1 + margin; z++) for (let x = x0 - margin; x <= x1 + margin; x++) if (this.state[this.idx(x, z)] !== SOLID) return false;
    return true;
  }
  fill(x0: number, z0: number, x1: number, z1: number, s: CellState, owner = -1): void { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, z, s, owner); }
  /** 4-neighbour BFS over passable cells from a start; returns the visited index set. */
  reach(sx: number, sz: number, passable: (x: number, z: number) => boolean): Set<number> {
    const seen = new Set<number>(); const q: number[] = [this.idx(sx, sz)]; seen.add(q[0]);
    while (q.length) {
      const i = q.shift()!; const x = i % this.n, z = (i / this.n) | 0;
      for (const [dx, dz] of N4) { const nx = x + dx, nz = z + dz; if (!this.inside(nx, nz)) continue; const j = this.idx(nx, nz); if (seen.has(j) || !passable(nx, nz)) continue; seen.add(j); q.push(j); }
    }
    return seen;
  }
}
export const N4: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** A* on the grid with a caller-supplied step cost (Infinity = impassable). Returns the cell path
 *  (inclusive of both ends) or null. Deterministic: ties break by insertion order. */
export function astar(g: CellGrid, sx: number, sz: number, tx: number, tz: number, cost: (x: number, z: number) => number, maxNodes = 40_000): [number, number][] | null {
  const n = g.n; const start = g.idx(sx, sz), goal = g.idx(tx, tz);
  const gScore = new Float64Array(n * n).fill(Infinity); gScore[start] = 0;
  const came = new Int32Array(n * n).fill(-1);
  const h = (i: number) => Math.abs((i % n) - tx) + Math.abs(((i / n) | 0) - tz);
  // binary heap of [f, order, idx]
  const heap: [number, number, number][] = []; let order = 0;
  const push = (f: number, i: number) => { heap.push([f, order++, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (less(heap[k], heap[p])) { [heap[k], heap[p]] = [heap[p], heap[k]]; k = p; } else break; } };
  const less = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === k) break; [heap[k], heap[m]] = [heap[m], heap[k]]; k = m; } } return top; };
  push(h(start), start);
  let expanded = 0;
  while (heap.length) {
    const [, , i] = pop();
    if (i === goal) { const path: [number, number][] = []; for (let c = goal; c !== -1; c = came[c]) path.push([c % n, (c / n) | 0]); return path.reverse(); }
    if (++expanded > maxNodes) return null;
    const x = i % n, z = (i / n) | 0;
    for (const [dx, dz] of N4) {
      const nx = x + dx, nz = z + dz; if (!g.inside(nx, nz)) continue;
      const c = cost(nx, nz); if (!isFinite(c)) continue;
      const j = g.idx(nx, nz); const ng = gScore[i] + c;
      if (ng < gScore[j]) { gScore[j] = ng; came[j] = i; push(ng + h(j), j); }
    }
  }
  return null;
}
