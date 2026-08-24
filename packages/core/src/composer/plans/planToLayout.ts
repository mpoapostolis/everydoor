// src/engine/composer/plans/planToLayout.ts — ParsedPlan + mission assignment → EmbeddedLayout
// under the SHARED-WALL CONTRACT: rooms abut, one WallRun per boundary segment ON the line, gaps at
// doors, colliders 1 u thick per solid piece plus one per locked door (id = lock id), Door records
// on the line with yaw INTO between[0], open joins as wall-less Door records spanning the segment.
// Single storey: every zone is floor 0, floorY 0. Plan-only: no trig, no Math.random.
import type { AABB, Archetype, Dir16, Door, EmbeddedLayout, Role, Spot, WallRun, Zone } from '../types';
import { CELL, GRID } from '../types';
import type { MissionGraph } from '../types';
import { CellGrid, FLOOR } from '../grid';
import { dirOf } from '../lut';
import type { ParsedPlan, PlanDoor, PlanRect } from './types';
import { doorKey, inwardOf, sharedSegment } from './parse';

const CHUNK = 40;
export const DOOR_W = 2 * CELL;
export const cellU = (c: number): number => (c - GRID / 2) * CELL;

export interface PlanLayoutOpts {
  /** Depth / role per node (from the mission graph) — zones of unassigned rooms fall back to the room's role. */
  graph?: MissionGraph;
  /** Doors the mapper marked secret (beyond the '!' ones). */
  secrets?: PlanDoor[];
}

export function planToLayout(p: ParsedPlan, assign: Record<string, string>, locks: Record<string, PlanDoor>, arch: Archetype, seed: number, opts: PlanLayoutOpts = {}): EmbeddedLayout {
  void seed;
  const chars = Object.keys(p.rects).sort();
  const ox = Math.floor((GRID - p.w) / 2), oz = Math.floor((GRID - p.d) / 2);
  const cellsOf = (r: PlanRect) => ({ x0: r.x0 + ox, z0: r.z0 + oz, x1: r.x1 + ox, z1: r.z1 + oz });
  const nodeOfRoom = new Map<string, string>(); for (const [n, c] of Object.entries(assign)) nodeOfRoom.set(c, n);
  const gnode = (id: string | undefined) => (id && opts.graph ? opts.graph.nodes.find((n) => n.id === id) : undefined);
  const lockOf = new Map<string, string>(); for (const [id, d] of Object.entries(locks)) lockOf.set(doorKey(d), id);
  const secretKeys = new Set((opts.secrets ?? []).map(doorKey));

  // --- zones ----------------------------------------------------------------------------------
  const ordinal = new Map<string, number>();
  const zoneIdx = new Map<string, number>();
  const zones: Zone[] = chars.map((c, i) => {
    const room = p.plan.rooms[c]; const kind = room.kind;
    const n = (ordinal.get(kind) ?? 0) + 1; ordinal.set(kind, n);
    const node = gnode(nodeOfRoom.get(c));
    const role: Role = node?.role ?? room.role ?? (kind === 'corridor' || kind === 'hall' ? 'corridor' : 'plain');
    const cells = cellsOf(p.rects[c]);
    const rect = { x0: cellU(cells.x0), z0: cellU(cells.z0), x1: cellU(cells.x1 + 1), z1: cellU(cells.z1 + 1) };
    const center: Spot = { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2, yaw: 0, floor: 0 };
    const chunks: [number, number][] = [];
    for (let cz = Math.floor(rect.z0 / CHUNK); cz <= Math.floor((rect.z1 - 1) / CHUNK); cz++) for (let cx = Math.floor(rect.x0 / CHUNK); cx <= Math.floor((rect.x1 - 1) / CHUNK); cx++) chunks.push([cx, cz]);
    zoneIdx.set(c, i);
    const z: Zone = {
      id: `${arch.id}.${kind}#${n}`, name: '', kind, role, depth: node?.depth ?? 99,
      rect, cells, floor: 0, floorY: 0, ceilY: room.sky ? undefined : arch.wallH, doors: [],
      spots: { center, npc: [], loot: [], hide: [] }, chunks, tags: (room.tags ?? []).slice(),
    };
    const finish = arch.kinds[kind]?.finish; if (finish) z.finish = finish;
    return z;
  });
  const nodeZone: Record<string, string> = {};
  for (const [n, c] of Object.entries(assign)) nodeZone[n] = zones[zoneIdx.get(c)!].id;

  // --- grid -----------------------------------------------------------------------------------
  const grid = new CellGrid(GRID);
  zones.forEach((z, i) => grid.fill(z.cells.x0, z.cells.z0, z.cells.x1, z.cells.z1, FLOOR, i));

  // --- doors ----------------------------------------------------------------------------------
  interface DoorPlan { d: PlanDoor; horiz: boolean; line: number; lo: number; hi: number; a: number; b: number }
  const plans: DoorPlan[] = [];
  for (const d of p.doors) {
    if (d.exterior) continue;
    const a = zoneIdx.get(d.a)!, b = zoneIdx.get(d.b)!;
    const horiz = d.along === 'x';
    if (d.open) {
      const seg = sharedSegment(p.rects[d.a], p.rects[d.b])!;
      plans.push({ d, horiz, line: seg.line + (horiz ? oz : ox), lo: seg.lo + (horiz ? ox : oz), hi: seg.hi + 1 + (horiz ? ox : oz), a, b });
    } else {
      const c = horiz ? d.x : d.z; const line = horiz ? d.z + oz : d.x + ox; const lo = c - 1 + (horiz ? ox : oz);
      plans.push({ d, horiz, line, lo, hi: lo + 2, a, b });
    }
  }
  const doors: Door[] = plans.map((pl, i) => {
    const za = zones[pl.a], zb = zones[pl.b];
    const lineU = cellU(pl.line), lo = cellU(pl.lo), hi = cellU(pl.hi);
    const x = pl.horiz ? (lo + hi) / 2 : lineU, z = pl.horiz ? lineU : (lo + hi) / 2;
    // yaw INTO between[0] (za): za lies on the + side of the line when its low cell edge is the line
    const yaw: Dir16 = pl.horiz ? (za.cells.z0 === pl.line ? 0 : 8) : (za.cells.x0 === pl.line ? 4 : 12);
    const id = `door#${i}`;
    const collider: AABB = pl.horiz ? { x0: lo, z0: lineU - 0.5, x1: hi, z1: lineU + 0.5, floor: 0, id } : { x0: lineU - 0.5, z0: lo, x1: lineU + 0.5, z1: hi, floor: 0, id };
    za.doors.push(id); zb.doors.push(id);
    const k = doorKey(pl.d);
    const door: Door = { id, x, z, yaw, w: hi - lo, between: [za.id, zb.id], collider, floor: 0 };
    if (pl.d.open) door.secret = false;
    else { const lock = lockOf.get(k); if (lock) door.lock = lock; if (pl.d.secret || secretKeys.has(k)) door.secret = true; }
    return door;
  });

  // --- walls + colliders: one run per boundary segment (deduped), gaps at doors, none on open joins ----
  const walls: WallRun[] = []; const colliders: AABB[] = [];
  const seen = new Set<string>();
  for (let zi = 0; zi < zones.length; zi++) {
    const zn = zones[zi], c = zn.cells;
    const edges: { horiz: boolean; line: number; lo: number; hi: number; nb: (t: number) => number }[] = [
      { horiz: true, line: c.z0, lo: c.x0, hi: c.x1, nb: (x) => grid.ownerAt(x, c.z0 - 1) },
      { horiz: true, line: c.z1 + 1, lo: c.x0, hi: c.x1, nb: (x) => grid.ownerAt(x, c.z1 + 1) },
      { horiz: false, line: c.x0, lo: c.z0, hi: c.z1, nb: (z) => grid.ownerAt(c.x0 - 1, z) },
      { horiz: false, line: c.x1 + 1, lo: c.z0, hi: c.z1, nb: (z) => grid.ownerAt(c.x1 + 1, z) },
    ];
    for (const e of edges) {
      let s = e.lo;
      while (s <= e.hi) {
        const o = e.nb(s); let t = s; while (t + 1 <= e.hi && e.nb(t + 1) === o) t++;
        const key = `${e.horiz ? 'h' : 'v'}|${e.line}|${s}|${t}`;
        if (!seen.has(key)) {
          seen.add(key);
          const onSeg = plans.filter((d) => d.horiz === e.horiz && d.line === e.line && d.lo >= s && d.hi - 1 <= t && ((d.a === zi && d.b === o) || (d.a === o && d.b === zi)));
          if (!onSeg.some((d) => d.d.open)) {
            const len = t - s + 1;
            const gapsC: [number, number][] = onSeg.map((d) => [d.lo, d.hi] as [number, number]).sort((p, q) => p[0] - q[0]);
            const gaps: [number, number][] = gapsC.map(([g0, g1]) => [(g0 - s) / len, (g1 - s) / len]);
            const a = cellU(e.line), u0 = cellU(s), u1 = cellU(t + 1), h = arch.wallH;
            walls.push(e.horiz ? { x0: u0, z0: a, x1: u1, z1: a, h, y: 0, floor: 0, gaps } : { x0: a, z0: u0, x1: a, z1: u1, h, y: 0, floor: 0, gaps });
            let cur = s;
            const seg = (s0: number, s1: number) => { if (s1 <= s0) return; const p0 = cellU(s0), p1 = cellU(s1); colliders.push(e.horiz ? { x0: p0, z0: a - 0.5, x1: p1, z1: a + 0.5, floor: 0, id: zn.id + ':wall' } : { x0: a - 0.5, z0: p0, x1: a + 0.5, z1: p1, floor: 0, id: zn.id + ':wall' }); };
            for (const [g0, g1] of gapsC) { seg(cur, g0); cur = g1; }
            seg(cur, t + 1);
          }
        }
        s = t + 1;
      }
    }
  }
  for (const d of doors) if (d.lock) colliders.push({ ...d.collider, id: d.lock });

  // --- start: 2.5 u inside the exterior entrance, facing the room's first inward door ------------
  const ent = p.doors.find((d) => d.exterior)!; const er = p.rects[ent.a]; const ez = zones[zoneIdx.get(ent.a)!];
  const [ix, iz] = inwardOf(ent, er);
  const ex = ent.along === 'z' ? cellU(ent.x + ox) : cellU(ent.x + ox), ezz = ent.along === 'x' ? cellU(ent.z + oz) : cellU(ent.z + oz);
  const start: Spot = { x: ex + ix * 2.5, z: ezz + iz * 2.5, yaw: dirOf(ix, iz), floor: 0 };
  const inward = doors.filter((d) => d.between.includes(ez.id) && !d.lock).sort((a, b) => (b.secret ? 0 : 1) - (a.secret ? 0 : 1))[0] ?? doors.find((d) => d.between.includes(ez.id));
  if (inward) { const dx = inward.x - start.x, dz = inward.z - start.z; if (dx !== 0 || dz !== 0) start.yaw = dirOf(dx, dz); }

  // --- exit: the boss room's centre -------------------------------------------------------------
  const bossNode = opts.graph?.nodes.find((n) => n.role === 'boss');
  const bossZone = bossNode && nodeZone[bossNode.id] ? zones.find((z) => z.id === nodeZone[bossNode.id]) : zones.find((z) => z.role === 'boss' || z.tags.includes('boss'));
  const exit: Spot | undefined = bossZone ? { ...bossZone.spots.center } : undefined;

  return { grids: { 0: grid }, zones, doors, walls, colliders, start, exit, nodeZone };
}
