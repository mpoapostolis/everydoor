// src/engine/composer/plans/render.ts — ASCII pictures of plans and layouts for tests / debugging.
// Doubled grid: cells at odd (2x+1, 2z+1), walls on even rows / columns. '|' '-' walls, '+' doors,
// '#' locked, '!' secret, '~' open joins, 'S' start, 'E' the exterior entrance.
import type { EmbeddedLayout } from '../types';
import { CELL, GRID } from '../types';
import type { ParsedPlan, PlanDoor } from './types';
import { doorKey, sharedSegment } from './parse';

export interface RenderOpts { assign?: Record<string, string>; locks?: Record<string, PlanDoor>; secrets?: PlanDoor[]; start?: { x: number; z: number } }

class Canvas {
  readonly g: string[][];
  constructor(readonly w: number, readonly d: number) { this.g = Array.from({ length: 2 * d + 1 }, () => Array(2 * w + 1).fill(' ')); }
  put(gx: number, gz: number, ch: string): void { if (gz >= 0 && gz < this.g.length && gx >= 0 && gx < this.g[0].length) this.g[gz][gx] = ch; }
  at(gx: number, gz: number): string { return this.g[gz]?.[gx] ?? ' '; }
  cell(x: number, z: number, ch: string): void { this.put(2 * x + 1, 2 * z + 1, ch); }
  /** Wall on the line between cell c-1 and c (column when `vert`), covering cell range lo..hi. */
  wall(vert: boolean, line: number, lo: number, hi: number): void { for (let t = lo; t <= hi; t++) vert ? this.put(2 * line, 2 * t + 1, '|') : this.put(2 * t + 1, 2 * line, '-'); }
  corners(): void {
    for (let gz = 0; gz < this.g.length; gz += 2) for (let gx = 0; gx < this.g[0].length; gx += 2) {
      const h = this.at(gx - 1, gz) !== ' ' || this.at(gx + 1, gz) !== ' ', v = this.at(gx, gz - 1) !== ' ' || this.at(gx, gz + 1) !== ' ';
      if (h || v) this.put(gx, gz, h ? '-' : '|');      // never '+': that glyph is a door
    }
  }
  toString(): string { return this.g.map((r) => r.join('').replace(/\s+$/, '')).join('\n'); }
}

export function renderPlanAscii(p: ParsedPlan, opts: RenderOpts = {}): string {
  const cv = new Canvas(p.w, p.d);
  const chars = Object.keys(p.rects).sort();
  const at = (x: number, z: number) => chars.find((c) => { const r = p.rects[c]; return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; });
  for (const c of chars) { const r = p.rects[c]; for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) cv.cell(x, z, c); }
  // walls wherever two neighbouring cells differ (outside counts)
  for (let z = 0; z <= p.d; z++) for (let x = 0; x <= p.w; x++) {
    const here = at(x, z);
    if (x < p.w && z < p.d || true) {
      if (z < p.d && at(x - 1, z) !== here) cv.wall(true, x, z, z);
      if (x < p.w && at(x, z - 1) !== here) cv.wall(false, z, x, x);
    }
  }
  cv.corners();
  const lockKeys = new Set(Object.values(opts.locks ?? {}).map(doorKey)); const secretKeys = new Set((opts.secrets ?? []).map(doorKey));
  for (const d of p.doors) {
    const k = doorKey(d);
    const ch = d.exterior ? 'E' : d.open ? '~' : lockKeys.has(k) ? '#' : d.secret || secretKeys.has(k) ? '!' : '+';
    if (d.open) {
      const s = sharedSegment(p.rects[d.a], p.rects[d.b])!;
      for (let t = s.lo; t <= s.hi; t++) s.along === 'z' ? cv.put(2 * s.line, 2 * t + 1, ch) : cv.put(2 * t + 1, 2 * s.line, ch);
    } else if (d.along === 'z') { cv.put(2 * d.x, 2 * (d.z - 1) + 1, ch); cv.put(2 * d.x, 2 * d.z + 1, ch); }
    else { cv.put(2 * (d.x - 1) + 1, 2 * d.z, ch); cv.put(2 * d.x + 1, 2 * d.z, ch); }
  }
  if (opts.start) cv.cell(opts.start.x, opts.start.z, 'S');
  const legend = chars.map((c) => {
    const room = p.plan.rooms[c]; const r = p.rects[c];
    const node = opts.assign ? Object.entries(opts.assign).find(([, ch]) => ch === c)?.[0] : undefined;
    return `${c} ${room.kind} ${r.x1 - r.x0 + 1}×${r.z1 - r.z0 + 1}${room.tags?.length ? ' [' + room.tags.join(',') + ']' : ''}${node ? ' ← ' + node : ''}`;
  });
  return cv.toString() + '\n' + legend.join('\n');
}

/** Any EmbeddedLayout (floor 0) as ASCII: zones lettered by index, walls from the runs, doors from the records. */
export function renderLayoutAscii(L: EmbeddedLayout): string {
  const zs = L.zones.filter((z) => z.floor === 0);
  if (!zs.length) return '(no zones on floor 0)';
  const x0 = Math.min(...zs.map((z) => z.cells.x0)), z0 = Math.min(...zs.map((z) => z.cells.z0));
  const x1 = Math.max(...zs.map((z) => z.cells.x1)), z1 = Math.max(...zs.map((z) => z.cells.z1));
  const cv = new Canvas(x1 - x0 + 1, z1 - z0 + 1);
  const letter = (i: number) => String.fromCharCode(i < 26 ? 65 + i : 97 + ((i - 26) % 26));
  zs.forEach((z) => { const i = L.zones.indexOf(z); for (let cz = z.cells.z0; cz <= z.cells.z1; cz++) for (let cx = z.cells.x0; cx <= z.cells.x1; cx++) cv.cell(cx - x0, cz - z0, letter(i)); });
  const cellOf = (u: number) => Math.round(u / CELL + GRID / 2);
  for (const w of L.walls) {
    if (w.floor !== 0) continue;
    const vert = w.x0 === w.x1;
    const line = cellOf(vert ? w.x0 : w.z0) - (vert ? x0 : z0), lo = cellOf(vert ? w.z0 : w.x0) - (vert ? z0 : x0), hi = cellOf(vert ? w.z1 : w.x1) - (vert ? z0 : x0) - 1;
    const len = hi - lo + 1;
    for (let t = lo; t <= hi; t++) {
      const f = (t - lo + 0.5) / len;
      if (w.gaps.some(([g0, g1]) => f > g0 && f < g1)) continue;
      cv.wall(vert, line, t, t);
    }
  }
  cv.corners();
  const lockIds = new Set(L.colliders.map((c) => c.id));
  for (const d of L.doors) {
    if (d.floor !== 0) continue;
    const ch = d.secret === false && !d.lock ? '~' : d.lock && lockIds.has(d.lock) ? '#' : d.secret ? '!' : '+';
    const vert = d.yaw === 4 || d.yaw === 12;
    const line = cellOf(vert ? d.x : d.z) - (vert ? x0 : z0);
    const c = d.collider; const lo = cellOf(vert ? c.z0 : c.x0) - (vert ? z0 : x0), hi = cellOf(vert ? c.z1 : c.x1) - (vert ? z0 : x0) - 1;
    for (let t = lo; t <= hi; t++) vert ? cv.put(2 * line, 2 * t + 1, ch) : cv.put(2 * t + 1, 2 * line, ch);
  }
  if (L.start.floor === 0) cv.cell(Math.floor(L.start.x / CELL + GRID / 2) - x0, Math.floor(L.start.z / CELL + GRID / 2) - z0, 'S');
  const legend = zs.map((z) => `${letter(L.zones.indexOf(z))} ${z.id} ${z.role}${z.depth < 99 ? ' d' + z.depth : ''} ${z.cells.x1 - z.cells.x0 + 1}×${z.cells.z1 - z.cells.z0 + 1}`);
  return cv.toString() + '\n' + legend.join('\n');
}
