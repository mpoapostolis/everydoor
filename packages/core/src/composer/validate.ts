// src/engine/composer/validate.ts — VALIDATION (design §4.6). validate(map, g, arch) checks the map's own
// zones / doors / colliders (never the embedder's private state) and returns Problems; `fatal` ones make
// the driver repair or re-seed, the rest are warnings. SINGLE STOREY (owner decision 2026-08-22): every
// zone is on floor 0 — no stairs, no portals, no floor seal.
//
// Connectivity and sealing run on a 1-u PASSABILITY RASTER: a point is passable when it lies inside a
// zone rect or a door opening and inside no wall collider (lock colliders count only when locks are
// solid). That is the same test for shared-wall plans (walls ON the boundary line, doors as gaps) and
// for the margin-based legacy grids (walls in the 1-cell ring, doors as cells). Plan-only: integer
// rasters, squared distances, no trig, no Math.random.
import type { AABB, Archetype, MissionGraph, Problem, SemanticMap, Spot, Zone } from './types';
import { CELL, GRID } from './types';
import { CellGrid, DOOR, FLOOR, N4 } from './grid';
import { pacingProblems } from './mission';
import { DIR16 } from './lut';

const NPC_R = 2.2, HIDE_R = 1.4;
const MAX_ZONES = 24, MAX_LIGHTS = 6, MAX_PLACEMENTS = 900, MAX_LANDMARKS = 24;
const SPAWN_CLEAR = 10;
/** The boss arena's minimum side in cells for shared-wall plans (authored rooms are 5×5 and up; generic arenas ask for more). */
const PLAN_ARENA_MIN = 5;

/** World u → cell index (design: x = (cx − GRID/2) · CELL). */
export const cellOf = (u: number): number => Math.floor(u / CELL + GRID / 2);
const cellsOf = (a: { x0: number; z0: number; x1: number; z1: number }) => ({ x0: cellOf(a.x0 + 1e-6), z0: cellOf(a.z0 + 1e-6), x1: cellOf(a.x1 - 1e-6), z1: cellOf(a.z1 - 1e-6) });

function dist2ToRect(x: number, z: number, r: { x0: number; z0: number; x1: number; z1: number }): number {
  const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
  const dz = z < r.z0 ? r.z0 - z : z > r.z1 ? z - r.z1 : 0;
  return dx * dx + dz * dz;
}
interface Rect { x0: number; z0: number; x1: number; z1: number }
const inRect = (x: number, z: number, r: Rect, pad = 0): boolean => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;

/** The grids a SemanticMap implies (legacy cell layouts): FLOOR cells owned by zone index, DOOR cells owned by door index. */
export function gridsOf(map: SemanticMap): Record<number, CellGrid> {
  const grids: Record<number, CellGrid> = {};
  const gridOf = (f: number): CellGrid => (grids[f] ??= new CellGrid(GRID));
  map.zones.forEach((z, i) => gridOf(z.floor).fill(z.cells.x0, z.cells.z0, z.cells.x1, z.cells.z1, FLOOR, i));
  map.doors.forEach((d, i) => { const c = cellsOf(d.collider); gridOf(d.floor).fill(c.x0, c.z0, c.x1, c.z1, DOOR, i); });
  return grids;
}

/** Blocking collider within r of (x, z) on this floor (shell walls included) — the linear form, for callers
 *  with a handful of colliders; validate() itself asks the RectIndex below the same question. */
export function blockedAt(colliders: AABB[], x: number, z: number, r: number, floor: number): AABB | undefined {
  const r2 = r * r;
  for (const c of colliders) if (c.floor === floor && dist2ToRect(x, z, c) < r2) return c;
  return undefined;
}

/** A uniform bucket grid over rectangles, so the point queries below stop walking every collider in the map.
 *  Each rect goes into every bucket its `pad`-grown box touches, in array order, so scanning the one bucket a
 *  point falls in visits exactly the rects that could match — and visits them in the order the array had, which
 *  keeps `find`-style answers (and the problem messages that name them) identical to the linear scan. */
const BUCKET = 8;                                        // u per bucket
class RectIndex<T extends Rect & { floor?: number }> {
  private readonly b = new Map<number, T[]>();
  constructor(items: readonly T[], pad: number) {
    for (const it of items) {
      const bx0 = Math.floor((it.x0 - pad) / BUCKET), bx1 = Math.floor((it.x1 + pad) / BUCKET);
      const bz0 = Math.floor((it.z0 - pad) / BUCKET), bz1 = Math.floor((it.z1 + pad) / BUCKET);
      for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) {
        const k = bx * 65_537 + bz; const l = this.b.get(k); if (l) l.push(it); else this.b.set(k, [it]);
      }
    }
  }
  /** The rects that can be within `pad` of (x, z), in array order (empty array when none). */
  at(x: number, z: number): readonly T[] {
    return this.b.get(Math.floor(x / BUCKET) * 65_537 + Math.floor(z / BUCKET)) ?? EMPTY;
  }
}
const EMPTY: readonly never[] = [];

/** The opening a Door record claims: its width along the wall, a cell and a bit across it. */
export const doorRect = (d: { x: number; z: number; w: number; yaw: number }): Rect => {
  const alongX = d.yaw === 0 || d.yaw === 8; const hw = d.w / 2, hd = CELL / 2 + 1;
  return alongX ? { x0: d.x - hw, z0: d.z - hd, x1: d.x + hw, z1: d.z + hd } : { x0: d.x - hd, z0: d.z - hw, x1: d.x + hd, z1: d.z + hw };
};

/** Passability raster at 1 u: open = inside a zone rect (0.5 u in) or a door opening, not inside a wall collider. */
class Raster {
  readonly bx0: number; readonly bz0: number; readonly W: number; readonly D: number;
  readonly open: Uint8Array;
  constructor(map: SemanticMap, locksSolid: boolean, lockIds: Set<string>) {
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const z of map.zones) { bx0 = Math.min(bx0, z.rect.x0); bz0 = Math.min(bz0, z.rect.z0); bx1 = Math.max(bx1, z.rect.x1); bz1 = Math.max(bz1, z.rect.z1); }
    this.bx0 = Math.floor(bx0) - 2; this.bz0 = Math.floor(bz0) - 2; bx1 = Math.ceil(bx1) + 2; bz1 = Math.ceil(bz1) + 2;
    this.W = bx1 - this.bx0 + 1; this.D = bz1 - this.bz0 + 1;
    this.open = new Uint8Array(this.W * this.D);
    for (const z of map.zones) this.mark({ x0: z.rect.x0 + 0.5, z0: z.rect.z0 + 0.5, x1: z.rect.x1 - 0.5, z1: z.rect.z1 - 0.5 }, 1);
    for (const d of map.doors) this.mark(doorRect(d), 1);
    for (const c of map.colliders) { if (c.id && lockIds.has(c.id) && !locksSolid) continue; this.mark({ x0: c.x0 - 0.49, z0: c.z0 - 0.49, x1: c.x1 + 0.49, z1: c.z1 + 0.49 }, 0); }
  }
  idx(x: number, z: number): number { return (z - this.bz0) * this.W + (x - this.bx0); }
  inside(x: number, z: number): boolean { return x >= this.bx0 && z >= this.bz0 && x < this.bx0 + this.W && z < this.bz0 + this.D; }
  private mark(r: Rect, v: number): void {
    const z0 = Math.max(this.bz0, Math.ceil(r.z0 - 1e-6)), z1 = Math.min(this.bz0 + this.D - 1, Math.floor(r.z1 + 1e-6));
    const x0 = Math.max(this.bx0, Math.ceil(r.x0 - 1e-6)), x1 = Math.min(this.bx0 + this.W - 1, Math.floor(r.x1 + 1e-6));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.open[this.idx(x, z)] = v;
  }
  /** Flood from a point; returns the visited flags. */
  flood(from: Spot): Uint8Array {
    const seen = new Uint8Array(this.W * this.D); const q: number[] = [];
    const sx = Math.round(from.x), sz = Math.round(from.z);
    if (this.inside(sx, sz) && this.open[this.idx(sx, sz)]) { seen[this.idx(sx, sz)] = 1; q.push(this.idx(sx, sz)); }
    let qh = 0;
    while (qh < q.length) {
      const i = q[qh++]; const x = (i % this.W) + this.bx0, z = ((i / this.W) | 0) + this.bz0;
      for (const [dx, dz] of N4) { const nx = x + dx, nz = z + dz; if (!this.inside(nx, nz)) continue; const j = this.idx(nx, nz); if (seen[j] || !this.open[j]) continue; seen[j] = 1; q.push(j); }
    }
    return seen;
  }
  anySeen(seen: Uint8Array, r: Rect): boolean {
    for (let z = Math.ceil(r.z0); z <= Math.floor(r.z1); z++) for (let x = Math.ceil(r.x0); x <= Math.floor(r.x1); x++) if (this.inside(x, z) && seen[this.idx(x, z)]) return true;
    return false;
  }
}

export function validate(map: SemanticMap, g: MissionGraph, arch: Archetype): Problem[] {
  const out: Problem[] = [];
  const P = (check: string, msg: string, fatal: boolean, zone?: string) => out.push({ check, msg, fatal, zone });
  const zones = map.zones;
  const zoneIdx = new Map(zones.map((z, i) => [z.id, i]));
  const byId = (id: string): Zone | undefined => zones[zoneIdx.get(id) ?? -1];
  if (!zones.length) { P('connected', 'no zones', true); return out; }
  const shared = arch.layout === 'plan';
  const lockIds = new Set(map.doors.filter((d) => d.lock).map((d) => d.lock!));
  // one bucket grid over the colliders (and one over the door openings) for every point query below —
  // the seal sweep alone used to walk all ~200 colliders per 0.5 u sample of every shared boundary
  const colIdx = new RectIndex(map.colliders, NPC_R);
  const doorRects = map.doors.map(doorRect);
  const doorIdx = new RectIndex(doorRects, 0);
  const blocked = (x: number, z: number, r: number, floor: number): AABB | undefined => {
    const r2 = r * r; const near = colIdx.at(x, z);
    for (let i = 0; i < near.length; i++) { const c = near[i]; if (c.floor === floor && dist2ToRect(x, z, c) < r2) return c; }
    return undefined;
  };

  // ---- uniqueness / naming / single storey ----------------------------------------------------
  { const seen = new Set<string>(); for (const z of zones) { if (!z.name) P('naming', `${z.id} has no name`, true, z.id); if (seen.has(z.id)) P('naming', `duplicate zone id ${z.id}`, true, z.id); seen.add(z.id); } }
  for (const d of map.doors) for (const id of d.between) if (!zoneIdx.has(id)) P('adjacency', `door ${d.id} names unknown zone ${id}`, true);
  for (const z of zones) if (z.floor !== 0 || z.stairs) P('storey', `${z.id} is not on the ground floor (single storey)`, true, z.id);

  // ---- connectivity on the passability raster ---------------------------------------------------
  const reach = (from: Spot, locksSolid: boolean): { zones: Set<string>; doors: Set<string> } => {
    const R = new Raster(map, locksSolid, lockIds); const seen = R.flood(from);
    const zr = new Set<string>(), dr = new Set<string>();
    for (const z of zones) if (R.anySeen(seen, z.rect)) zr.add(z.id);
    for (let i = 0; i < map.doors.length; i++) if (R.anySeen(seen, doorRects[i])) dr.add(map.doors[i].id);
    return { zones: zr, doors: dr };
  };
  const all = reach(map.start, false);
  if (!all.zones.size) P('connected', 'start point is not passable', true);
  for (const z of zones) if (!all.zones.has(z.id)) P('connected', `zone ${z.id} unreachable from start`, true, z.id);
  for (const d of map.doors) if (!all.doors.has(d.id)) P('connected', `door ${d.id} unreachable from start`, true);

  // ---- adjacency: every door is a free opening touching both its zones; every shared boundary is sealed --------
  const pairKey = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);
  const derived = new Map<string, string>();                              // pair → how
  const doorPairs = new Set(map.doors.map((d) => pairKey(d.between[0], d.between[1])));
  const isWall = (c: AABB) => !(c.id && lockIds.has(c.id));
  for (const d of map.doors) {
    const alongX = d.yaw === 0 || d.yaw === 8; const hw = d.w / 2;
    for (let t = -hw + 0.6; t <= hw - 0.6; t += 1) {
      const px = alongX ? d.x + t : d.x, pz = alongX ? d.z : d.z + t;
      let wall: AABB | undefined; { const near = colIdx.at(px, pz); for (let n = 0; n < near.length; n++) if (isWall(near[n]) && inRect(px, pz, near[n])) { wall = near[n]; break; } }
      if (wall) { P('adjacency', `door ${d.id} opening is covered by wall ${wall.id ?? '?'}`, true); break; }
    }
    for (const id of d.between) { const z = byId(id); if (z && !inRect(d.x, d.z, z.rect, shared ? 1.2 : CELL + 1.2)) P('adjacency', `door ${d.id} does not touch ${id}`, true, id); }
    derived.set(pairKey(d.between[0], d.between[1]), 'door');
  }
  const corr = (zz: Zone) => zz.role === 'corridor';
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    const a = zones[i], b = zones[j];
    const vert = Math.abs(a.rect.x1 - b.rect.x0) < 0.05 || Math.abs(b.rect.x1 - a.rect.x0) < 0.05;
    const horz = Math.abs(a.rect.z1 - b.rect.z0) < 0.05 || Math.abs(b.rect.z1 - a.rect.z0) < 0.05;
    if (!vert && !horz) continue;
    const line = vert ? (Math.abs(a.rect.x1 - b.rect.x0) < 0.05 ? a.rect.x1 : b.rect.x1) : (Math.abs(a.rect.z1 - b.rect.z0) < 0.05 ? a.rect.z1 : b.rect.z1);
    const lo = vert ? Math.max(a.rect.z0, b.rect.z0) : Math.max(a.rect.x0, b.rect.x0), hi = vert ? Math.min(a.rect.z1, b.rect.z1) : Math.min(a.rect.x1, b.rect.x1);
    if (hi - lo < 0.5) continue;
    if (corr(a) && corr(b)) { derived.set(pairKey(a.id, b.id), 'touch'); continue; }   // corridor runs join without a door
    let holes = 0;
    for (let t = lo + 0.25; t < hi; t += 0.5) {
      const px = vert ? line : t, pz = vert ? t : line;
      const covered = colIdx.at(px, pz).some((c) => inRect(px, pz, c, 0.05)) || doorIdx.at(px, pz).some((d) => inRect(px, pz, d));
      if (!covered) holes++;
    }
    if (holes) P('seal', `${a.id}|${b.id} share ${holes * 0.5} u of boundary that is neither wall nor door`, true, a.id);
  }
  for (const k of doorPairs) if (!derived.has(k)) P('adjacency', `doors name pair ${k} that the layout does not join`, true);
  const neighbours = (id: string): Set<string> => { const s = new Set<string>(); for (const k of derived.keys()) { const [a, b] = k.split('|'); if (a === id) s.add(b); else if (b === id) s.add(a); } return s; };
  const bossZones = zones.filter((z) => z.role === 'boss');
  for (const boss of bossZones) {
    const deg = neighbours(boss.id).size;
    if (deg !== 1) P('adjacency', `boss ${boss.id} has degree ${deg} (expected 1)`, arch.layout === 'graph-grid' && !(arch.spine?.oneBigRoom), boss.id);
  }

  // ---- lockKeySim on the zone graph ---------------------------------------------------------
  {
    const entrance = zones.find((z) => z.role === 'entrance') ?? zones[0];
    const inv = new Set<string>(); const reached = new Set<string>([entrance.id]);
    const keysIn = (zid: string) => map.keys.filter((k) => k.zone === zid).map((k) => k.opens);
    for (const k of keysIn(entrance.id)) inv.add(k);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of map.doors) {
        const [a, b] = d.between; const open = !d.lock || inv.has(d.lock);
        if (!open) continue;
        for (const [from, to] of [[a, b], [b, a]]) if (reached.has(from) && !reached.has(to)) { reached.add(to); for (const k of keysIn(to)) inv.add(k); grew = true; }
      }
      for (const k of derived.keys()) { const how = derived.get(k); if (how === 'door') continue; const [a, b] = k.split('|'); for (const [from, to] of [[a, b], [b, a]]) if (reached.has(from) && !reached.has(to)) { reached.add(to); for (const kk of keysIn(to)) inv.add(kk); grew = true; } }
    }
    for (const z of zones) if (!reached.has(z.id) && (z.role === 'boss' || z.role === 'exit' || z.role === 'finish')) P('lockKeySim', `${z.role} ${z.id} not reachable with the keys in play`, true, z.id);
    for (const d of map.doors) if (d.lock && !map.keys.some((k) => k.opens === d.lock)) P('lockKeySim', `locked door ${d.id} (${d.lock}) has no key`, true);
    for (const k of map.keys) if (!lockIds.has(k.opens)) P('lockKeySim', `key ${k.id} opens ${k.opens || '?'}, which no door carries`, true, k.zone);
  }

  // ---- reachability on the raster with locked doors SOLID -------------------------------------
  {
    const locked = map.doors.filter((d) => d.lock);
    if (locked.length) {
      const seen = reach(map.start, true);
      for (const d of locked) {
        const keys = map.keys.filter((k) => k.opens === d.lock);
        for (const k of keys) { const kz = byId(k.zone); if (kz && !seen.zones.has(kz.id)) P('reachability', `key for ${d.lock} in ${k.zone} is behind its own lock`, true, k.zone); }
        // the zone behind the lock (the deeper mission node of the locked edge): on a tree lock it must be sealed;
        // on a cycle lock (lock-and-key shortcut) it is legitimately reachable around the loop, so only warn
        const e = g.edges.find((x) => x.lock === d.lock);
        const na = e && g.nodes.find((n) => n.id === e.a), nb = e && g.nodes.find((n) => n.id === e.b);
        const farNode = na && nb ? (nb.depth >= na.depth ? nb : na) : undefined;
        const far = farNode?.zoneId ? byId(farNode.zoneId) : undefined;
        const onLoop = !!e && g.loops.some((l) => l.includes(e.a) && l.includes(e.b));
        if (far && seen.zones.has(far.id) && !keys.some((k) => k.zone === far.id)) P('reachability', `locked zone ${far.id} reachable without key ${d.lock}`, !onLoop, far.id);
      }
    }
  }

  // ---- pacing on the mission graph (plan layouts re-derive their edges from the plan's doors) ----
  for (const msg of (shared ? [] : pacingProblems(g))) P('pacing', msg, true);

  // ---- spawnSafe --------------------------------------------------------------------------
  {
    const s = map.start; const sz = zones.find((z) => s.x >= z.rect.x0 && s.x <= z.rect.x1 && s.z >= z.rect.z0 && s.z <= z.rect.z1);
    if (!sz) P('spawnSafe', 'start is not inside a zone', true);
    else {
      if (sz.role !== 'entrance') P('spawnSafe', `start is in ${sz.id} (${sz.role}), not the entrance`, false, sz.id);
      const hit = map.placements.find((p) => p.collide && p.zone === sz.id && (p.x - s.x) ** 2 + (p.z - s.z) ** 2 < SPAWN_CLEAR * SPAWN_CLEAR);
      if (hit) P('spawnSafe', `blocking ${hit.prop} within ${SPAWN_CLEAR} u of start`, false, sz.id);
      const near = blocked(s.x, s.z, NPC_R, s.floor);
      if (near) P('spawnSafe', `start is not standable (collider ${near.id ?? '?'})`, true, sz.id);
      const first = map.doors.find((d) => d.id === sz.doors[0]);
      if (first) { const [fx, fz] = DIR16[s.yaw]; if (fx * (first.x - s.x) + fz * (first.z - s.z) <= 0) P('spawnSafe', 'start does not face its first door', false, sz.id); }
      const nextZ = map.criticalPath.length > 1 ? byId(map.criticalPath[1]) : undefined;
      if (nextZ && (nextZ.role === 'combat' || nextZ.role === 'elite')) P('spawnSafe', `first zone past the entrance is ${nextZ.role}`, false, nextZ.id);
    }
  }

  // ---- arena ------------------------------------------------------------------------------
  const arenaMin = shared ? Math.min(arch.bossArena.minCells, PLAN_ARENA_MIN) : arch.bossArena.minCells;
  for (const boss of bossZones) {
    const side = Math.min(boss.cells.x1 - boss.cells.x0 + 1, boss.cells.z1 - boss.cells.z0 + 1);
    if (side < arenaMin) P('arena', `boss ${boss.id} side ${side} < ${arenaMin} cells`, true, boss.id);
    if (!boss.spots.arena) P('arena', `boss ${boss.id} has no arena disc`, false, boss.id);
    if (arch.bossArena.pillars > 0 && !map.placements.some((p) => p.zone === boss.id && p.role === 'quest')) P('arena', `boss ${boss.id} has no cover`, false, boss.id);
    if (boss.doors.length !== 1) P('arena', `boss ${boss.id} has ${boss.doors.length} doors`, false, boss.id);
  }

  // ---- standable ----------------------------------------------------------------------------
  const check = (z: Zone, s: Spot, r: number, what: string) => {
    const c = blocked(s.x, s.z, r, s.floor);
    if (c) P('standable', `${what} spot (${s.x}, ${s.z}) in ${z.id} blocked by ${c.id ?? 'wall'} at r ${r}`, true, z.id);
    if (s.x < z.rect.x0 || s.x > z.rect.x1 || s.z < z.rect.z0 || s.z > z.rect.z1) P('standable', `${what} spot (${s.x}, ${s.z}) outside ${z.id}`, true, z.id);
  };
  for (const z of zones) {
    for (const s of z.spots.npc) check(z, s, NPC_R, 'npc');
    for (const s of z.spots.loot) check(z, s, NPC_R, 'loot');
    for (const s of z.spots.hide) check(z, s, HIDE_R, 'hide');
    for (const s of z.spots.work ?? []) check(z, s, NPC_R, 'work');
    for (const s of z.spots.claim ?? []) check(z, s, NPC_R, 'claim');
  }
  for (const k of map.keys) { const z = byId(k.zone); if (z) check(z, k.spot, HIDE_R, 'key'); }
  for (const p of map.people) {
    const z = byId(p.zone);
    if (!z) { P('standable', `person ${p.id} in unknown zone`, true); continue; }
    if (blocked(p.spot.x, p.spot.z, NPC_R, p.spot.floor)) P('standable', `person ${p.id} spot blocked`, true, z.id);
    for (const r of p.route) if (blocked(r.x, r.z, NPC_R, r.floor)) P('standable', `person ${p.id} route point (${r.x}, ${r.z}) blocked`, true, z.id);
  }

  // ---- weenie -----------------------------------------------------------------------------
  if (map.weenieZone && !zoneIdx.has(map.weenieZone)) P('weenie', `weenie zone ${map.weenieZone} unknown`, false);

  // ---- caps -------------------------------------------------------------------------------
  const rooms = zones.filter((z) => z.role !== 'corridor').length;
  if (rooms > MAX_ZONES) P('caps', `${rooms} rooms > ${MAX_ZONES}`, true);
  if (zones.length > 2 * MAX_ZONES) P('caps', `${zones.length} zones (rooms + corridor runs) > ${2 * MAX_ZONES}`, false);
  if (map.lights.length > MAX_LIGHTS) P('caps', `${map.lights.length} lights > ${MAX_LIGHTS} (finalize trims by priority)`, false);
  if (map.placements.length > MAX_PLACEMENTS) P('caps', `${map.placements.length} placements > ${MAX_PLACEMENTS}`, true);
  if (map.landmarks.length > MAX_LANDMARKS) P('caps', `${map.landmarks.length} landmarks > ${MAX_LANDMARKS}`, true);
  return out;
}
