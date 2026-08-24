// src/engine/composer/embedGrid.ts — the GRAPH-GRID embedder (design §4.3 "graph-grid" + "Floors").
// Castles, dungeons, prisons, hospitals, labs, space stations: a mission graph becomes rooms on a
// 72×72 cell grid per floor, joined by door cells and carved corridors, with stairs zones between
// floors. PLAN-ONLY: integer cells, seeded Rng, Dir16 yaws — no three.js, no Math.random, no trig.
//
// Model (every invariant the tests pin):
// - Rooms are cell rects with a 1-cell SOLID ring (margin). Two rooms never touch; adjacency exists
//   ONLY through DOOR cells (1 or 2 cells wide) that sit in the gap between a room and either another
//   room (direct door) or a corridor.
// - Corridors are TIDY: one corridor joins exactly two doors with a 2-cell-wide lane that is straight
//   or has one bend (an L), never runs past either door cell, and touches nothing but those two doors
//   (no room, stairs, other corridor or foreign door anywhere along it). Each straight leg is one zone
//   (kind 'corridor'); an L's legs abut on a 2-cell wall-less edge recorded as a joint Door (w = 2 cells,
//   no DOOR cells) so the door graph sees the pair. A link with no tidy lane re-rolls the room; a loop
//   whose closure cannot be tidy re-rolls the loop.
// - floor f sits at floorY = f * FLOOR_H. A 'stairs' zone (2×4 cells, STAIRS state) lives on the
//   lower grid; its rows ramp +1.5 u per cell so the top row is at the upper floorY, and the top
//   row's XZ lies inside the upper zone's rect on grid[upper].
// - FLOOR SEAL: any 4-neighbour pair of non-SOLID cells with |ΔfloorY| > 1.5 that is not inside one
//   stairs zone gets a collider across the shared edge.
import { CELL, GRID } from './types';
import type { AABB, Archetype, Door, EmbeddedLayout, MissionEdge, MissionGraph, MissionNode, Role, RoomKind, Spot, WallRun, Zone } from './types';
import { CellGrid, DOOR, FLOOR, N4, SOLID, STAIRS } from './grid';
import { sub } from './rng';
import { dirOf } from './lut';

/** Vertical distance between consecutive floors (u). Matches the design's `tower_top` at `floorY +6`. */
export const FLOOR_H = 6;
/** Rise per stairs cell (u); the floor-seal threshold. */
export const STAIR_STEP = 1.5;
export const STAIRS_LEN = 4, STAIRS_W = 2;
const WALL_T = 1;            // u, wall collider thickness (outside the rect)
const CHUNK = 40;            // u per visual chunk (composedWorld.ts)
const MAX_FLOOR_DIFF = 1;    // one stairs zone per edge
/** Longest carved corridor (cells between its two doors; design §4.3: 4–30). Longer = the layout sprawled → re-seed. */
const MAX_CORRIDOR = 30;
/** Candidate rects a room may try (each with its door/corridor join) before the size is re-rolled. */
const MAX_JOIN_TRIES = 40;
const ORIGIN = (GRID / 2) * CELL;
const u0 = (c: number): number => c * CELL - ORIGIN;    // cell → world u (cell's low edge)

/** Zones whose floor cells corridors must not touch (everything but corridors). */
const isRoomKind = (k: RoomKind): boolean => k !== 'corridor';

interface ZInfo {
  zi: number; floor: number; kind: RoomKind; role: Role;
  x0: number; z0: number; x1: number; z1: number;           // cells, inclusive
  floorY: number;
  node?: MissionNode;
  stairs?: { dir: number; rowY: number[]; from: number; to: number };   // dir: N4 index from bottom row to top row
}
interface Link { a: number; b: number; edge?: MissionEdge; stairsFor?: [string, string] }

type Side = 0 | 1 | 2 | 3;   // N4 index: +x, −x, +z, −z

/** Why the last embedGrid call returned null ('' after a success) — a diagnostic for tests and the driver. */
export let lastFail = '';
const fail = (why: string): null => { lastFail = why; return null; };

// ---------------------------------------------------------------------------
export function embedGrid(g: MissionGraph, seed: number, arch: Archetype): EmbeddedLayout | null {
  const rng = sub(seed, 'embedGrid');
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, MissionEdge[]>();
  for (const n of g.nodes) adj.set(n.id, []);
  for (const e of g.edges) { adj.get(e.a)?.push(e); adj.get(e.b)?.push(e); }
  const entrance = g.nodes.find((n) => n.role === 'entrance') ?? g.nodes[0];
  if (!entrance) return null;
  for (const n of g.nodes) if ((n.floor ?? 0) < 0) return null;

  const grids: Record<number, CellGrid> = {};
  const grid = (f: number): CellGrid => (grids[f] ??= new CellGrid(GRID));
  const zones: Zone[] = []; const infos: ZInfo[] = [];
  const ordinal = new Map<string, number>();
  const nodeZone: Record<string, number> = {};
  const links: Link[] = [];

  const recipe = (kind: RoomKind) => arch.kinds[kind];
  // kind-less nodes draw a kind from the role's pool once (typeAndName keeps it), so size, recipe and name agree
  const drawnKind = new Map<string, RoomKind>();
  const kindOf = (n: MissionNode): RoomKind => {
    if (n.kind) return n.kind;
    let k = drawnKind.get(n.id);
    if (!k) { const pool = arch.roleMap[n.role]; k = pool && pool.length ? rng.pick(pool) : Object.keys(arch.kinds)[0] ?? 'room'; drawnKind.set(n.id, k); }
    return k;
  };
  const sideLen = (n: MissionNode, kind: RoomKind): [number, number] => {
    const r = recipe(kind); const [lo, hi] = r?.size ?? [3, 5];
    // hubs: a square at least 6 cells (30 u) so 4–6 rooms can hang off it, sized by the recipe above that (a 2-cell hallway recipe still becomes an atrium, not a 50-u box)
    if (n.role === 'hub') { const s = rng.int(Math.max(lo, 6), Math.max(hi, 8)); return [s, s]; }
    if (kind === 'corridor' || n.role === 'corridor') return [2, rng.int(Math.max(3, lo), Math.max(4, hi * 2))];
    let w = rng.int(lo, hi), h = rng.int(lo, hi);
    if (n.role === 'boss') { const m = arch.bossArena.minCells; w = Math.max(w, m); h = Math.max(h, m); }
    return [w, h];
  };

  const addZone = (kind: RoomKind, role: Role, floor: number, x0: number, z0: number, x1: number, z1: number, node?: MissionNode, state: typeof FLOOR | typeof STAIRS = FLOOR): ZInfo => {
    const zi = zones.length;
    const ord = (ordinal.get(kind) ?? 0) + 1; ordinal.set(kind, ord);
    const floorY = floor * FLOOR_H;
    const r = recipe(kind);
    let ceilY: number | undefined = floorY + (r?.ceil ?? arch.wallH);
    if (r && r.ceil === null) ceilY = undefined;
    else if (role === 'boss' && ceilY !== undefined) ceilY = floorY + (ceilY - floorY) * arch.bossArena.ceilMul;
    const rect = { x0: u0(x0), z0: u0(z0), x1: u0(x1 + 1), z1: u0(z1 + 1) };
    const center: Spot = { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2, yaw: 0, floor };
    const chunks: [number, number][] = [];
    for (let cz = Math.floor(rect.z0 / CHUNK); cz <= Math.floor((rect.z1 - 0.01) / CHUNK); cz++)
      for (let cx = Math.floor(rect.x0 / CHUNK); cx <= Math.floor((rect.x1 - 0.01) / CHUNK); cx++) chunks.push([cx, cz]);
    zones.push({
      id: `${arch.id}.${kind}#${ord}`, name: kind, kind, role, depth: node?.depth ?? 0,
      rect, cells: { x0, z0, x1, z1 }, floor, floorY, ceilY, doors: [],
      spots: { center, npc: [], loot: [], hide: [] }, chunks, tags: node?.tags ? node.tags.slice() : [],
    });
    const info: ZInfo = { zi, floor, kind, role, x0, z0, x1, z1, floorY, node };
    infos.push(info);
    grid(floor).fill(x0, z0, x1, z1, state, zi);
    if (node) nodeZone[node.id] = zi;
    return info;
  };
  const removeZonesFrom = (n: number): void => {
    while (zones.length > n) {
      const info = infos.pop()!; zones.pop();
      ordinal.set(info.kind, (ordinal.get(info.kind) ?? 1) - 1);
      grid(info.floor).fill(info.x0, info.z0, info.x1, info.z1, SOLID, -1);
      if (info.node) delete nodeZone[info.node.id];
    }
  };

  /** A rect is placeable when its 1-cell ring is SOLID and nothing but the parent P lies within 2 cells —
   *  so a corridor (door, cell, door) can always thread between two rooms that are not linked. */
  const roomFree = (gf: CellGrid, x0: number, z0: number, x1: number, z1: number, P?: { x0: number; z0: number; x1: number; z1: number }): boolean => {
    if (!gf.free(x0, z0, x1, z1, 1)) return false;
    for (let z = z0 - 2; z <= z1 + 2; z++) for (let x = x0 - 2; x <= x1 + 2; x++) {
      if (z > z0 - 2 && z < z1 + 2 && x > x0 - 2 && x < x1 + 2) continue;
      if (!gf.inside(x, z)) return false;
      if (gf.get(x, z) === SOLID) continue;
      if (P && x >= P.x0 && x <= P.x1 && z >= P.z0 && z <= P.z1) continue;
      return false;
    }
    return true;
  };

  // --- placement of one room next to a parent on the same grid (gap 1, overlap ≥ 2) ---------
  /** Rect of size (w,h) on `side` of parent P with the given offset along the wall; null if out of grid. */
  const rectBeside = (P: { x0: number; z0: number; x1: number; z1: number }, side: Side, w: number, h: number, off: number) => {
    let x0: number, z0: number;
    if (side === 0) { x0 = P.x1 + 2; z0 = off; } else if (side === 1) { x0 = P.x0 - 1 - w; z0 = off; }
    else if (side === 2) { z0 = P.z1 + 2; x0 = off; } else { z0 = P.z0 - 1 - h; x0 = off; }
    return { x0, z0, x1: x0 + w - 1, z1: z0 + h - 1 };
  };
  const offsetRange = (P: { x0: number; z0: number; x1: number; z1: number }, side: Side, w: number, h: number): [number, number] =>
    side <= 1 ? [P.z0 - (h - 2), P.z1 - 1] : [P.x0 - (w - 2), P.x1 - 1];

  function* besideCands(gf: CellGrid, P: { x0: number; z0: number; x1: number; z1: number }, w: number, h: number, sides: Side[]): Generator<{ x0: number; z0: number; x1: number; z1: number; side: Side }> {
    for (const side of sides) {
      const [lo, hi] = offsetRange(P, side, w, h);
      const offs: number[] = []; for (let o = lo; o <= hi; o++) offs.push(o);
      for (const off of rng.shuffle(offs)) {
        const r = rectBeside(P, side, w, h, off);
        if (roomFree(gf, r.x0, r.z0, r.x1, r.z1, P)) yield { ...r, side };
      }
    }
  }
  const tryPlaceBeside = (gf: CellGrid, P: { x0: number; z0: number; x1: number; z1: number }, w: number, h: number, sides: Side[]): { x0: number; z0: number; x1: number; z1: number; side: Side } | null => {
    for (const r of besideCands(gf, P, w, h, sides)) return r;
    return null;
  };

  /** Fallback for a boxed-in parent: a free rect 2–9 cells away from P, FACING it (spans overlap ≥ 2 cells) so a
   *  straight 2-wide corridor between the facing walls is the natural join; wide of P (an L) only when facing fails. */
  function* nearCands(gf: CellGrid, P: { x0: number; z0: number; x1: number; z1: number }, w: number, h: number, sides: Side[]): Generator<{ x0: number; z0: number; x1: number; z1: number }> {
    for (const facing of [true, false]) for (let gap = 2; gap <= 9; gap++) for (const side of sides) {
      const [lo, hi] = facing ? offsetRange(P, side, w, h) : side <= 1 ? [P.z0 - h - 2, P.z1 + 3] : [P.x0 - w - 2, P.x1 + 3];
      const offs: number[] = []; for (let o = lo; o <= hi; o++) if (facing || o < offsetRange(P, side, w, h)[0] || o > offsetRange(P, side, w, h)[1]) offs.push(o);
      for (const off of rng.shuffle(offs)) {
        let x0: number, z0: number;
        if (side === 0) { x0 = P.x1 + 1 + gap; z0 = off; } else if (side === 1) { x0 = P.x0 - gap - w; z0 = off; }
        else if (side === 2) { z0 = P.z1 + 1 + gap; x0 = off; } else { z0 = P.z0 - gap - h; x0 = off; }
        if (roomFree(gf, x0, z0, x0 + w - 1, z0 + h - 1)) yield { x0, z0, x1: x0 + w - 1, z1: z0 + h - 1 };
      }
    }
  }
  const tryPlaceNear = (gf: CellGrid, P: { x0: number; z0: number; x1: number; z1: number }, w: number, h: number): { x0: number; z0: number; x1: number; z1: number } | null => {
    for (const r of nearCands(gf, P, w, h, rng.shuffle([0, 1, 2, 3] as Side[]))) return r;
    return null;
  };

  /** Place `node` attached to placed node `parent`. Returns false if no placement was found (≤ 3 attempts).
   *  `toward` (a placed node) orders the candidate sides so the room grows in its direction — loop arms grow
   *  towards each other, so the corridor that closes the loop stays short instead of wrapping round the map. */
  const placeNode = (node: MissionNode, parent: MissionNode, toward?: MissionNode): boolean => {
    const P = infos[nodeZone[parent.id]];
    const fc = node.floor ?? 0, fp = P.floor;
    const kind = kindOf(node);
    const sidesFor = (): Side[] => {
      const all = rng.shuffle([0, 1, 2, 3] as Side[]);
      const ti = toward ? nodeZone[toward.id] : undefined;
      if (ti === undefined || infos[ti].floor !== fp) return all;
      const T = infos[ti];
      const dx = (T.x0 + T.x1) - (P.x0 + P.x1), dz = (T.z0 + T.z1) - (P.z0 + P.z1);
      const xFirst = Math.abs(dx) >= Math.abs(dz);
      const sx: Side = dx >= 0 ? 0 : 1, sz: Side = dz >= 0 ? 2 : 3;
      const first = xFirst ? sx : sz, second = xFirst ? sz : sx;
      return [first, second, ...all.filter((s) => s !== first && s !== second)];
    };
    if (fc === fp) {
      // beside the parent first (a direct door), then facing it across a gap (a straight lane), then wide of it (an L);
      // a candidate rect that no tidy lane can reach is rolled back and the next one tried
      const e = edgeBetween(parent.id, node.id);
      for (let attempt = 0; attempt < 3; attempt++) {
        const [w, h] = sideLen(node, kind);
        const sides = sidesFor();
        let tries = 0;
        const cands = (function* () { yield* besideCands(grid(fc), P, w, h, sides); yield* nearCands(grid(fc), P, w, h, sides); })();
        for (const r of cands) {
          const mark = zones.length, dmark = doors.length;
          const z = addZone(kind, node.role, fc, r.x0, r.z0, r.x1, r.z1, node);
          if (join(P, z, e)) { if (e) realized.add(e); return true; }
          removeZonesFrom(mark); removeDoorsFrom(dmark);
          if (++tries >= MAX_JOIN_TRIES) break;
        }
      }
      return false;
    }
    if (Math.abs(fc - fp) !== MAX_FLOOR_DIFF) return false;
    if (fc === fp + 1) {
      // stairs beside the parent on grid[fp], upper room over the stairs' top row on grid[fc].
      const tryStairs = (r: { x0: number; z0: number; x1: number; z1: number }, dir: Side): boolean => {
        const mark = zones.length, dmark = doors.length;
        const st = addStairs(fp, r, dir);
        const [rw, rh] = sideLen(node, kind);
        const up = placeOver(grid(fc), topRow(st), rw, rh);
        if (!up) { removeZonesFrom(mark); return false; }
        addZone(kind, node.role, fc, up.x0, up.z0, up.x1, up.z1, node);
        const e = edgeBetween(parent.id, node.id);
        if (!join(P, st, e)) { removeZonesFrom(mark); removeDoorsFrom(dmark); return false; }
        if (e) realized.add(e);
        return true;
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        for (const side of rng.shuffle([0, 1, 2, 3] as Side[])) {
          const w = side <= 1 ? STAIRS_LEN : STAIRS_W, h = side <= 1 ? STAIRS_W : STAIRS_LEN;
          const r = tryPlaceBeside(grid(fp), P, w, h, [side]);
          if (r && tryStairs(r, side)) return true;
        }
      }
      // boxed-in parent: stairs a few cells away, bottom row facing the parent; the link becomes a short corridor into that row
      for (let t = 0; t < 6; t++) {
        const along = rng.chance(0.5);
        const r = tryPlaceNear(grid(fp), P, along ? STAIRS_LEN : STAIRS_W, along ? STAIRS_W : STAIRS_LEN);
        if (!r) continue;
        const dir: Side = r.x0 > P.x1 ? 0 : r.x1 < P.x0 ? 1 : r.z0 > P.z1 ? 2 : 3;
        if ((dir <= 1) !== along) continue;
        if (tryStairs(r, dir)) return true;
      }
      return false;
    }
    // fc === fp − 1: stairs on grid[fc] whose top row lies inside the parent's rect; child beside the stairs' bottom.
    for (let attempt = 0; attempt < 3; attempt++) {
      const mark = zones.length, dmark = doors.length;
      const st = placeStairsUnder(fc, P);
      if (!st) continue;
      const [w, h] = sideLen(node, kind);
      const bottomSide = opp(st.stairs!.dir) as Side;    // child sits beyond the bottom row
      const r = tryPlaceBeside(grid(fc), st, w, h, [bottomSide]);
      if (!r) { removeZonesFrom(mark); continue; }
      const z = addZone(kind, node.role, fc, r.x0, r.z0, r.x1, r.z1, node);
      const e = edgeBetween(node.id, parent.id);
      if (!join(z, st, e)) { removeZonesFrom(mark); removeDoorsFrom(dmark); continue; }
      if (e) realized.add(e);
      return true;
    }
    return false;
  };
  const opp = (d: number): number => (d === 0 ? 1 : d === 1 ? 0 : d === 2 ? 3 : 2);
  const edgeBetween = (a: string, b: string): MissionEdge | undefined => g.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

  /** A stairs zone on grid[f] in rect r, rising away from `side`'s parent (bottom row nearest the parent). */
  const addStairs = (f: number, r: { x0: number; z0: number; x1: number; z1: number }, side: Side): ZInfo => {
    const st = addZone('stairs', 'stairs', f, r.x0, r.z0, r.x1, r.z1, undefined, STAIRS);
    const rowY: number[] = []; for (let i = 0; i < STAIRS_LEN; i++) rowY.push(st.floorY + STAIR_STEP * (i + 1));
    st.stairs = { dir: side, rowY, from: f, to: f + 1 };
    finishStairs(st);
    return st;
  };
  const finishStairs = (st: ZInfo): void => {
    const s = st.stairs!; const steps: { x0: number; z0: number; x1: number; z1: number; y: number }[] = [];
    for (let i = 0; i < STAIRS_LEN; i++) {
      const c = rowCells(st, i);
      const xs = c.map((p) => p[0]), zs = c.map((p) => p[1]);
      steps.push({ x0: u0(Math.min(...xs)), z0: u0(Math.min(...zs)), x1: u0(Math.max(...xs) + 1), z1: u0(Math.max(...zs) + 1), y: s.rowY[i] });
    }
    zones[st.zi].stairs = { from: s.from, to: s.to, steps };
  };
  /** Cells of row i (0 = bottom, STAIRS_LEN−1 = top). */
  const rowCells = (st: ZInfo, i: number): [number, number][] => {
    const d = st.stairs!.dir; const out: [number, number][] = [];
    if (d === 0) for (let z = st.z0; z <= st.z1; z++) out.push([st.x0 + i, z]);
    else if (d === 1) for (let z = st.z0; z <= st.z1; z++) out.push([st.x1 - i, z]);
    else if (d === 2) for (let x = st.x0; x <= st.x1; x++) out.push([x, st.z0 + i]);
    else for (let x = st.x0; x <= st.x1; x++) out.push([x, st.z1 - i]);
    return out;
  };
  const topRow = (st: ZInfo) => rowCells(st, STAIRS_LEN - 1);
  const rowOf = (st: ZInfo, x: number, z: number): number => {
    const d = st.stairs!.dir;
    return d === 0 ? x - st.x0 : d === 1 ? st.x1 - x : d === 2 ? z - st.z0 : st.z1 - z;
  };
  /** A (w,h) rect on `gf` containing every cell of `top`, free with margin; random offsets, ≤ 6 tries. */
  const placeOver = (gf: CellGrid, top: [number, number][], w: number, h: number) => {
    const tx0 = Math.min(...top.map((p) => p[0])), tx1 = Math.max(...top.map((p) => p[0]));
    const tz0 = Math.min(...top.map((p) => p[1])), tz1 = Math.max(...top.map((p) => p[1]));
    for (let t = 0; t < 6; t++) {
      const x0 = rng.int(tx1 - w + 1, tx0), z0 = rng.int(tz1 - h + 1, tz0);
      if (roomFree(gf, x0, z0, x0 + w - 1, z0 + h - 1)) return { x0, z0, x1: x0 + w - 1, z1: z0 + h - 1 };
    }
    return null;
  };
  /** Stairs on grid[f] (f = P.floor − 1) whose TOP row lies inside P's rect; ≤ 6 random tries. */
  const placeStairsUnder = (f: number, P: ZInfo): ZInfo | null => {
    const gf = grid(f);
    for (let t = 0; t < 6; t++) {
      const dir = rng.int(0, 3) as Side;          // bottom → top direction
      // top row: 2 cells perpendicular to dir inside P
      let x0: number, z0: number, x1: number, z1: number;
      if (dir <= 1) {
        if (P.z1 - P.z0 + 1 < STAIRS_W) continue;
        const z = rng.int(P.z0, P.z1 - 1), tx = rng.int(P.x0, P.x1);
        z0 = z; z1 = z + 1; if (dir === 0) { x1 = tx; x0 = tx - (STAIRS_LEN - 1); } else { x0 = tx; x1 = tx + STAIRS_LEN - 1; }
      } else {
        if (P.x1 - P.x0 + 1 < STAIRS_W) continue;
        const x = rng.int(P.x0, P.x1 - 1), tz = rng.int(P.z0, P.z1);
        x0 = x; x1 = x + 1; if (dir === 2) { z1 = tz; z0 = tz - (STAIRS_LEN - 1); } else { z0 = tz; z1 = tz + STAIRS_LEN - 1; }
      }
      if (!roomFree(gf, x0, z0, x1, z1)) continue;
      return addStairs(f, { x0, z0, x1, z1 }, dir);
    }
    return null;
  };

  // --- doors + corridors (defined before placement: a loop closure is carved as soon as its loop is placed, so later rooms cannot block it) ---
  const doors: Door[] = [];
  const realized = new Set<MissionEdge>();
  const zoneKindAt = (gf: CellGrid, x: number, z: number): RoomKind | null => { const o = gf.ownerAt(x, z); const s = gf.get(x, z); return (s === FLOOR || s === STAIRS) && o >= 0 ? infos[o].kind : null; };
  const touchesRoomOrDoor = (gf: CellGrid, x: number, z: number, skip: Set<number>): boolean => {
    for (const [dx, dz] of N4) {
      const nx = x + dx, nz = z + dz; if (!gf.inside(nx, nz)) continue;
      if (skip.has(gf.idx(nx, nz))) continue;
      const s = gf.get(nx, nz);
      if (s === DOOR || s === STAIRS) return true;
      const o = gf.ownerAt(nx, nz);
      if (s === FLOOR && o >= 0 && isRoomKind(infos[o].kind)) return true;
    }
    return false;
  };
  const adjacentTo = (Z: ZInfo, x: number, z: number): boolean => {
    for (const [dx, dz] of N4) { const nx = x + dx, nz = z + dz; if (nx >= Z.x0 && nx <= Z.x1 && nz >= Z.z0 && nz <= Z.z1) return true; }
    return false;
  };
  /** Outward side index of a cell adjacent to Z (the N4 dir from the room to the cell). */
  const outwardOf = (Z: ZInfo, x: number, z: number): Side => (x > Z.x1 ? 0 : x < Z.x0 ? 1 : z > Z.z1 ? 2 : 3);
  /** A gap cell may become a door if it is SOLID and touches no zone floor except `allowed` zones. */
  const doorable = (gf: CellGrid, x: number, z: number, allowed: number[]): boolean => {
    if (gf.get(x, z) !== SOLID) return false;
    for (const [dx, dz] of N4) {
      const nx = x + dx, nz = z + dz; if (!gf.inside(nx, nz)) return false;
      const s = gf.get(nx, nz); if (s === SOLID || s === DOOR) continue;
      if (!allowed.includes(gf.ownerAt(nx, nz))) return false;
    }
    return true;
  };
  const makeDoor = (from: ZInfo, to: ZInfo, cells: [number, number][], edge?: MissionEdge): void => {
    const gf = grid(from.floor); const di = doors.length;
    for (const [x, z] of cells) gf.set(x, z, DOOR, di);
    const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
    const x0 = u0(Math.min(...xs)), z0 = u0(Math.min(...zs)), x1 = u0(Math.max(...xs) + 1), z1 = u0(Math.max(...zs) + 1);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // yaw INTO `to`: the door sits on one of to's walls, so the normal is a quarter direction
    const side = outwardOf(to, cells[0][0], cells[0][1]);
    const yaw = dirOf(-N4[side][0], -N4[side][1]);
    const d: Door = {
      id: `door#${di + 1}`, x: cx, z: cz, yaw, w: cells.length * CELL, between: [zones[from.zi].id, zones[to.zi].id],
      collider: { x0, z0, x1, z1, floor: from.floor, id: `door#${di + 1}` }, floor: from.floor,
    };
    if (edge?.lock) d.lock = edge.lock;
    if (edge?.secret) d.secret = true;
    doors.push(d);
    zones[from.zi].doors.push(d.id); zones[to.zi].doors.push(d.id);
  };
  /** Direct door between two rects 1 cell apart with overlap ≥ 1 (2 cells wide when the overlap allows). */
  const directDoor = (A: ZInfo, B: ZInfo, edge?: MissionEdge): boolean => {
    const gf = grid(A.floor);
    const cands: [number, number][] = [];
    if (A.x1 + 2 === B.x0 || B.x1 + 2 === A.x0) { const x = A.x1 + 2 === B.x0 ? A.x1 + 1 : B.x1 + 1; for (let z = Math.max(A.z0, B.z0); z <= Math.min(A.z1, B.z1); z++) cands.push([x, z]); }
    else if (A.z1 + 2 === B.z0 || B.z1 + 2 === A.z0) { const z = A.z1 + 2 === B.z0 ? A.z1 + 1 : B.z1 + 1; for (let x = Math.max(A.x0, B.x0); x <= Math.min(A.x1, B.x1); x++) cands.push([x, z]); }
    const ok = cands.filter(([x, z]) => doorable(gf, x, z, [A.zi, B.zi]));
    if (!ok.length) return false;
    // prefer a 2-wide pair
    const pairs: [number, number][][] = [];
    for (let i = 0; i + 1 < ok.length; i++) { const [a, b] = [ok[i], ok[i + 1]]; if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1) pairs.push([a, b]); }
    const cells = pairs.length ? rng.pick(pairs) : [rng.pick(ok)];
    makeDoor(A, B, cells, edge);
    return true;
  };

  /** TIDY CORRIDORS. A corridor joins exactly two doors — one cell on S's ring, one on T's ring — with a lane
   *  that is straight or has ONE bend (an L), 2 cells wide, and begins/ends flush with its door cells (never a
   *  cell past them). Every lane cell is fresh SOLID whose four neighbours are all SOLID: a lane never overlaps
   *  or brushes a room, a stairs zone, another corridor or a foreign door, so a corridor can touch nothing but
   *  its own two doors (pairs that cannot be joined that way are rejected and the driver re-rolls). Each straight
   *  leg is one corridor zone; an L's two legs abut on a 2-cell edge with NO wall between them, and a joint
   *  Door record (w = 2 cells, no DOOR cells) tells validate's door graph that the pair is adjacent. */
  interface Leg { x0: number; z0: number; x1: number; z1: number }
  interface Lane { s: [number, number]; t: [number, number]; legs: Leg[]; joint?: [number, number][]; score: number }
  const cellsOf = (Z: ZInfo): number[] => { const gf = grid(Z.floor); const o: number[] = []; for (let z = Z.z0; z <= Z.z1; z++) for (let x = Z.x0; x <= Z.x1; x++) o.push(gf.idx(x, z)); return o; };
  /** A cell may carry corridor floor when it is SOLID, 1 cell in from the grid border, and all four neighbours are SOLID. */
  const laneOk = (gf: CellGrid, x: number, z: number): boolean => {
    if (x < 1 || z < 1 || x > GRID - 2 || z > GRID - 2 || gf.get(x, z) !== SOLID) return false;
    for (const [dx, dz] of N4) if (gf.get(x + dx, z + dz) !== SOLID) return false;
    return true;
  };
  const legOf = (cells: [number, number][]): Leg => ({ x0: Math.min(...cells.map((c) => c[0])), z0: Math.min(...cells.map((c) => c[1])), x1: Math.max(...cells.map((c) => c[0])), z1: Math.max(...cells.map((c) => c[1])) });
  const legCells = (L: Leg): [number, number][] => { const o: [number, number][] = []; for (let z = L.z0; z <= L.z1; z++) for (let x = L.x0; x <= L.x1; x++) o.push([x, z]); return o; };
  const axisCells = (a: [number, number], b: [number, number]): [number, number][] => {
    const out: [number, number][] = []; const dx = Math.sign(b[0] - a[0]), dz = Math.sign(b[1] - a[1]);
    for (let x = a[0], z = a[1]; ; x += dx, z += dz) { out.push([x, z]); if (x === b[0] && z === b[1]) break; }
    return out;
  };
  /** Lane plans between door cells s (outward os) and t (outward ot): every straight / single-bend 2-wide lane whose cells all pass laneOk. */
  const planLanes = (gf: CellGrid, s: [number, number], os: [number, number], t: [number, number], ot: [number, number]): Lane[] => {
    const a: [number, number] = [s[0] + os[0], s[1] + os[1]], b: [number, number] = [t[0] + ot[0], t[1] + ot[1]];
    const out: Lane[] = [];
    const near = (p: [number, number], q: [number, number]): boolean => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) === 1;
    const valid = (legs: Leg[]): boolean => {
      const seen = new Set<number>();
      for (const L of legs) for (const cell of legCells(L)) {
        const i = gf.idx(cell[0], cell[1]); if (seen.has(i) || !laneOk(gf, cell[0], cell[1])) return false; seen.add(i);
        // only the entry cell may sit beside door s, only the exit cell beside door t — a door opens onto one leg, at its end
        if (near(cell, s) && (cell[0] !== a[0] || cell[1] !== a[1])) return false;
        if (near(cell, t) && (cell[0] !== b[0] || cell[1] !== b[1])) return false;
      }
      return true;
    };
    const same = a[0] === b[0] && a[1] === b[1];
    if (a[0] === b[0] || a[1] === b[1]) {
      // one straight leg (the doors sit at its ends or on its long side); widen on either perpendicular side
      const axis = axisCells(a, b);
      if (axis.length > MAX_CORRIDOR) return out;
      const along = same ? (os[0] !== 0 ? [0, 1] : [1, 0]) : [Math.abs(Math.sign(b[0] - a[0])), Math.abs(Math.sign(b[1] - a[1]))];
      const perps: [number, number][] = along[0] ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      for (const p of perps) {
        const leg = legOf([...axis, ...axis.map(([x, z]) => [x + p[0], z + p[1]] as [number, number])]);
        if (valid([leg])) out.push({ s, t, legs: [leg], score: axis.length });
      }
      return out;
    }
    // an L: corner at (a.x, b.z) or (b.x, a.z); leg 1 runs a→corner, leg 2 corner→b; leg 2 widens towards leg 1's start so the shared edge is 2 cells
    for (const c of [[a[0], b[1]], [b[0], a[1]]] as [number, number][]) {
      const d1: [number, number] = [Math.sign(c[0] - a[0]), Math.sign(c[1] - a[1])], d2: [number, number] = [Math.sign(b[0] - c[0]), Math.sign(b[1] - c[1])];
      const axis1 = axisCells(a, c);
      const n = axis1.length + Math.abs(b[0] - c[0]) + Math.abs(b[1] - c[1]);
      if (n > MAX_CORRIDOR) continue;
      for (const p1 of [[-d2[0], -d2[1]], [d2[0], d2[1]]] as [number, number][]) {
        const leg1 = legOf([...axis1, ...axis1.map(([x, z]) => [x + p1[0], z + p1[1]] as [number, number])]);
        // leg 2 starts at the first axis cell outside leg 1
        let start: [number, number] = [c[0] + d2[0], c[1] + d2[1]];
        if (start[0] >= leg1.x0 && start[0] <= leg1.x1 && start[1] >= leg1.z0 && start[1] <= leg1.z1) start = [start[0] + d2[0], start[1] + d2[1]];
        const past = (start[0] - b[0]) * d2[0] + (start[1] - b[1]) * d2[1] > 0;
        if (past) { if (valid([leg1])) out.push({ s, t, legs: [leg1], score: n + 2 }); continue; }
        const axis2 = axisCells(start, b); const p2: [number, number] = [-d1[0], -d1[1]];
        // a leg one cell long is not a leg, it is the corner: the 2-cell joint would sit on one side of it and a
        // pinched 1-cell door on the other. Skip the candidate and let a straight lane or the other corner win.
        if (axis2.length < 2) continue;
        const leg2 = legOf([...axis2, ...axis2.map(([x, z]) => [x + p2[0], z + p2[1]] as [number, number])]);
        if (!valid([leg1, leg2])) continue;
        // the shared edge: leg 2's first row/column, 2 cells, flush with leg 1
        const joint: [number, number][] = [start, [start[0] + p2[0], start[1] + p2[1]]];
        out.push({ s, t, legs: [leg1, leg2], joint, score: n + 3 });
      }
    }
    return out;
  };
  const carve = (S: ZInfo, T: ZInfo, edge?: MissionEdge): boolean => {
    const gf = grid(S.floor);
    const own = new Set([...cellsOf(S), ...cellsOf(T)]);
    const ring = (Z: ZInfo): [number, number, number, number][] => {
      const cells: [number, number, number, number][] = [];   // x, z, ox, oz
      if (Z.stairs) {
        const [ox, oz] = N4[Z.stairs.dir];   // a stairs zone is entered only through its bottom row
        for (const [x, z] of rowCells(Z, 0)) cells.push([x - ox, z - oz, -ox, -oz]);
      } else {
        for (let x = Z.x0; x <= Z.x1; x++) { cells.push([x, Z.z0 - 1, 0, -1]); cells.push([x, Z.z1 + 1, 0, 1]); }
        for (let z = Z.z0; z <= Z.z1; z++) { cells.push([Z.x0 - 1, z, -1, 0]); cells.push([Z.x1 + 1, z, 1, 0]); }
      }
      return cells.filter(([x, z]) => gf.inside(x, z) && doorable(gf, x, z, [Z.zi]) && !touchesRoomOrDoor(gf, x, z, own));
    };
    const candS = ring(S), candT = ring(T);
    if (!candS.length || !candT.length) return false;
    let best: Lane | null = null;
    for (const [sx, sz, sox, soz] of candS) for (const [tx, tz, tox, toz] of candT) {
      for (const lane of planLanes(gf, [sx, sz], [sox, soz], [tx, tz], [tox, toz])) if (!best || lane.score < best.score) best = lane;
    }
    if (!best) return false;
    materialize(S, T, best, edge);
    return true;
  };

  /** A lane becomes corridor zones (one per leg), the two room doors, and — for an L — the joint door between its legs. */
  const materialize = (S: ZInfo, T: ZInfo, lane: Lane, edge?: MissionEdge): void => {
    const gf = grid(S.floor);
    const legZones: ZInfo[] = [];
    for (const L of lane.legs) {
      const z = addZone('corridor', 'corridor', S.floor, L.x0, L.z0, L.x1, L.z1, undefined);
      zones[z.zi].depth = S.node?.depth ?? 0;
      legZones.push(z);
    }
    const zoneAt = (c: [number, number]): number => gf.ownerAt(c[0], c[1]);
    const touching = (Z: ZInfo, c: [number, number]): ZInfo => {   // the corridor zone a door cell opens onto (its outward lane cell)
      const o = N4[outwardOf(Z, c[0], c[1])]; return infos[zoneAt([c[0] + o[0], c[1] + o[1]])];
    };
    /** A 1-cell door widens to 2 when the lateral ring cell also opens straight onto the same corridor zone. */
    const widen = (Z: ZInfo, c: [number, number], C: ZInfo): [number, number][] => {
      const out = N4[outwardOf(Z, c[0], c[1])];
      const perps = out[0] !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      for (const [px, pz] of perps) {
        const lx = c[0] + px, lz = c[1] + pz;
        if (!adjacentTo(Z, lx, lz) || !doorable(gf, lx, lz, [Z.zi, C.zi])) continue;
        if (gf.get(lx + out[0], lz + out[1]) !== FLOOR || zoneAt([lx + out[0], lz + out[1]]) !== C.zi) continue;
        if (gf.get(lx + px, lz + pz) !== SOLID) continue;
        return [c, [lx, lz]];
      }
      return [c];
    };
    const CS = touching(S, lane.s), CT = touching(T, lane.t);
    makeDoor(S, CS, widen(S, lane.s, CS), undefined);
    if (lane.joint) makeJoint(legZones[0], legZones[1], lane.joint);
    makeDoor(CT, T, widen(T, lane.t, CT), edge);
  };
  /** The wall-less joint of an L: a Door record on the shared edge between two corridor legs (no DOOR cells, w = 2 cells). */
  const makeJoint = (A: ZInfo, B: ZInfo, cells: [number, number][]): void => {
    const di = doors.length;
    // `cells` lie in B; the shared line is B's edge facing A
    const horizontal = cells[0][1] === cells[1][1];          // the two cells sit side by side along x → the shared line is a z = const line
    const lo = Math.min(cells[0][0], cells[1][0]), loZ = Math.min(cells[0][1], cells[1][1]);
    let x0: number, z0: number, x1: number, z1: number, yaw: number;
    if (horizontal) {
      const line = A.z1 < B.z0 ? u0(B.z0) : u0(B.z1 + 1);
      x0 = u0(lo); x1 = u0(lo + 2); z0 = line - 0.5; z1 = line + 0.5; yaw = A.z1 < B.z0 ? 0 : 8;   // into B, as makeDoor points into `to`
    } else {
      const line = A.x1 < B.x0 ? u0(B.x0) : u0(B.x1 + 1);
      z0 = u0(loZ); z1 = u0(loZ + 2); x0 = line - 0.5; x1 = line + 0.5; yaw = A.x1 < B.x0 ? 4 : 12;
    }
    const d: Door = {
      id: `door#${di + 1}`, x: (x0 + x1) / 2, z: (z0 + z1) / 2, yaw: yaw as Door['yaw'], w: 2 * CELL, between: [zones[A.zi].id, zones[B.zi].id],
      collider: { x0, z0, x1, z1, floor: A.floor, id: `door#${di + 1}` }, floor: A.floor,
    };
    doors.push(d);
    zones[A.zi].doors.push(d.id); zones[B.zi].doors.push(d.id);
  };
  /** Realize one link: a direct door when the rects are a cell apart, else a tidy corridor. */
  const join = (A: ZInfo, B: ZInfo, edge?: MissionEdge): boolean => directDoor(A, B, edge) || carve(A, B, edge);

  // --- chain decomposition + placement ---------------------------------------------------
  const placed = new Set<string>([entrance.id]);
  {
    const kind = kindOf(entrance); const [w, h] = sideLen(entrance, kind);
    const x0 = (GRID >> 1) - (w >> 1), z0 = (GRID >> 1) - (h >> 1);
    addZone(kind, entrance.role, 0, x0, z0, x0 + w - 1, z0 + h - 1, entrance);
  }
  type Op = [node: MissionNode, parent: MissionNode, toward?: MissionNode];
  /** Undo doors made after the n-th (their DOOR cells go back to SOLID, their ids leave the zones' door lists). */
  const removeDoorsFrom = (n: number): void => {
    while (doors.length > n) {
      const d = doors.pop()!; const gf = grid(d.floor); const c = d.collider;
      const cx0 = Math.round((c.x0 + ORIGIN) / CELL), cx1 = Math.round((c.x1 + ORIGIN) / CELL), cz0 = Math.round((c.z0 + ORIGIN) / CELL), cz1 = Math.round((c.z1 + ORIGIN) / CELL);
      for (let z = cz0; z < cz1; z++) for (let x = cx0; x < cx1; x++) if (gf.get(x, z) === DOOR) gf.set(x, z, SOLID, -1);
      for (const zn of zones) { const i = zn.doors.indexOf(d.id); if (i >= 0) zn.doors.splice(i, 1); }
    }
  };
  /** Place a chain of ops (≤ 3 attempts); `accept` may reject a fully placed chain (a loop whose closure cannot be carved short) to re-roll it. */
  const placeChain = (ops: Op[], accept?: () => boolean): boolean => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const mark = zones.length, lmark = links.length, dmark = doors.length; let ok = true;
      for (const [n, p, t] of ops) if (!placeNode(n, p, t)) { ok = false; lastFail = `place ${n.id} (${n.role}, floor ${n.floor ?? 0}) off ${p.id}`; break; }
      if (ok && accept && !accept()) { ok = false; lastFail = 'loop closure'; }
      if (ok) { for (const [n] of ops) placed.add(n.id); return true; }
      removeZonesFrom(mark); removeDoorsFrom(dmark); links.length = lmark;
    }
    return false;
  };
  /** Close a loop between its two arm ends right away (direct door or a short corridor), before later rooms can sit in the way. */
  const closeLoop = (a: MissionNode, b: MissionNode): boolean => {
    if (gapBetween(a, b) > MAX_CLOSURE) return false;
    const e = edgeBetween(a.id, b.id); if (!e) return true;
    const A = infos[nodeZone[a.id]], B = infos[nodeZone[b.id]]; if (!A || !B) return false;
    if (!(directDoor(A, B, e) || carve(A, B, e))) return false;
    realized.add(e);
    return true;
  };
  /** Cells of SOLID between two placed nodes' rects along x plus along z — the length of the corridor that would join them. */
  const gapBetween = (a: MissionNode, b: MissionNode): number => {
    const A = infos[nodeZone[a.id]], B = infos[nodeZone[b.id]]; if (!A || !B) return Infinity;
    return Math.max(0, B.x0 - A.x1 - 1, A.x0 - B.x1 - 1) + Math.max(0, B.z0 - A.z1 - 1, A.z0 - B.z1 - 1);
  };
  const MAX_CLOSURE = MAX_CORRIDOR >> 1;
  /** Degree-1 neighbours of a loop node that are not on the loop: placed right after it, while its sides are still open,
   *  so the loop's closing corridor routes around them instead of sealing them out. */
  const leafOps = (n: MissionNode, loop: string[]): Op[] =>
    adj.get(n.id)!.map((e) => (e.a === n.id ? e.b : e.a))
      .filter((o) => byId.has(o) && !placed.has(o) && !loop.includes(o) && adj.get(o)!.length === 1)
      .map((o) => [byId.get(o)!, n] as Op);
  const loops = g.loops.slice().sort((a, b) => a.length - b.length);
  const doneLoops = new Set<number>();
  const tryLoops = (): boolean => {
    for (let li = 0; li < loops.length; li++) {
      if (doneLoops.has(li)) continue;
      const loop = loops[li].filter((id) => byId.has(id));
      if (!loop.some((id) => placed.has(id))) {
        // seed the loop from outside it (the hub off the entrance): the loop node with a placed neighbour
        let seeded = false;
        for (const id of loop) {
          const nb = adj.get(id)!.map((e) => (e.a === id ? e.b : e.a)).find((o) => placed.has(o));
          if (nb === undefined) continue;
          if (!placeChain([[byId.get(id)!, byId.get(nb)!]])) return false;
          seeded = true; break;
        }
        if (!seeded) continue;
      }
      doneLoops.add(li);
      // every maximal run of unplaced nodes, grown from both anchored ends
      const L = loop.length;
      const seen = new Set<number>();
      for (let i = 0; i < L; i++) {
        if (placed.has(loop[i]) || seen.has(i)) continue;
        let s = i; while (!placed.has(loop[(s - 1 + L) % L]) && (s - 1 + L) % L !== i) s = (s - 1 + L) % L;
        const run: string[] = []; for (let k = s; !placed.has(loop[k]) && run.length < L; k = (k + 1) % L) { run.push(loop[k]); seen.add(k); }
        const a1 = byId.get(loop[(s - 1 + L) % L])!, a2 = byId.get(loop[(s + run.length) % L])!;
        const ops: Op[] = []; let lo = 0, hi = run.length - 1; let pl = a1, pr = a2;
        while (lo <= hi) {                                   // each arm grows towards the other arm's latest room
          const nl = byId.get(run[lo])!; ops.push([nl, pl, pr]); pl = nl; lo++;
          if (lo > hi) break;
          const nr = byId.get(run[hi])!; ops.push([nr, pr, pl]); pr = nr; hi--;
        }
        // the two arm ends are loop neighbours; close the loop now, and re-roll the arms when that cannot be done short
        // …then the loop's degree-1 leaves (secret rooms, vantage towers) hang off their loop node in the same chain, so a
        // loop whose closure walls a leaf out is re-rolled as a whole instead of failing the tree pass later
        const endL = pl, endR = pr; const extra: string[] = [];
        const leaves = (): boolean => {
          extra.length = 0;
          for (const id of run) for (const [leaf, par] of leafOps(byId.get(id)!, loop)) { if (!placeNode(leaf, par)) { lastFail = `leaf ${leaf.id} off ${par.id}`; return false; } extra.push(leaf.id); }
          return true;
        };
        if (!placeChain(ops, () => closeLoop(endL, endR) && leaves())) return false;
        for (const id of extra) placed.add(id);
      }
    }
    return true;
  };
  const growTrees = (): boolean => {
    // DFS branches from placed nodes; each branch (until a node with >1 unplaced neighbours) is one chain
    for (;;) {
      let progressed = false;
      for (const n of g.nodes) {
        if (!placed.has(n.id)) continue;
        for (const e of adj.get(n.id)!) {
          const other = e.a === n.id ? e.b : e.a; if (placed.has(other) || !byId.has(other)) continue;
          const ops: Op[] = []; let cur = byId.get(other)!, par = n;
          for (;;) {
            ops.push([cur, par]);
            const next = adj.get(cur.id)!.map((x) => (x.a === cur.id ? x.b : x.a)).filter((id) => !placed.has(id) && byId.has(id) && !ops.some((o) => o[0].id === id));
            if (next.length !== 1) break;
            par = cur; cur = byId.get(next[0])!;
          }
          if (!placeChain(ops)) return false;
          progressed = true;
        }
      }
      if (!progressed) return true;
    }
  };
  lastFail = '';
  if (!tryLoops()) return fail('loop chain: ' + lastFail);
  if (!growTrees()) return fail('tree chain: ' + lastFail);
  if (!tryLoops()) return fail('late loop: ' + lastFail);
  if (placed.size !== g.nodes.length) return fail('unreached nodes');

  // --- doors + corridors for the edges placement did not realize (loop closures it skipped, cross-floor edges) ---
  for (const e of g.edges) {
    if (realized.has(e)) continue;
    const A = infos[nodeZone[e.a]], B = infos[nodeZone[e.b]];
    if (!A || !B) return fail('edge to unknown node');
    if (A.floor === B.floor) { links.push({ a: A.zi, b: B.zi, edge: e }); continue; }
    const [lo, up] = A.floor < B.floor ? [A, B] : [B, A];
    if (up.floor - lo.floor !== 1) return fail('floor gap > 1');
    const st = placeStairsUnder(lo.floor, up);
    if (!st) return fail('stairs for cross-floor edge');
    links.push({ a: lo.zi, b: st.zi, edge: e, stairsFor: [lo.node!.id, up.node!.id] });
  }


  for (const l of links) {
    const A = infos[l.a], B = infos[l.b];
    if (!join(A, B, l.edge)) return fail(`corridor ${zones[A.zi].id}→${zones[B.zi].id}`);
  }

  // --- walls, colliders, floor seal ----------------------------------------------------
  const walls: WallRun[] = []; const colliders: AABB[] = [];
  for (const d of doors) if (d.lock) colliders.push({ ...d.collider });
  const sideOpen = (Z: ZInfo, gf: CellGrid, x: number, z: number): boolean => {
    const s = gf.get(x, z); if (s === DOOR) return true;
    if (s === FLOOR && Z.kind === 'corridor') { const o = gf.ownerAt(x, z); return o >= 0 && infos[o].kind === 'corridor'; }
    return false;
  };
  for (const Z of infos) {
    const gf = grid(Z.floor); const zn = zones[Z.zi];
    const sides: { x0: number; z0: number; x1: number; z1: number; cells: [number, number][]; out: [number, number] }[] = [
      { x0: u0(Z.x0), z0: u0(Z.z0), x1: u0(Z.x1 + 1), z1: u0(Z.z0), cells: range(Z.x0, Z.x1).map((x) => [x, Z.z0 - 1]), out: [0, -1] },   // north (−z)
      { x0: u0(Z.x0), z0: u0(Z.z1 + 1), x1: u0(Z.x1 + 1), z1: u0(Z.z1 + 1), cells: range(Z.x0, Z.x1).map((x) => [x, Z.z1 + 1]), out: [0, 1] },   // south (+z)
      { x0: u0(Z.x0), z0: u0(Z.z0), x1: u0(Z.x0), z1: u0(Z.z1 + 1), cells: range(Z.z0, Z.z1).map((z) => [Z.x0 - 1, z]), out: [-1, 0] },   // west
      { x0: u0(Z.x1 + 1), z0: u0(Z.z0), x1: u0(Z.x1 + 1), z1: u0(Z.z1 + 1), cells: range(Z.z0, Z.z1).map((z) => [Z.x1 + 1, z]), out: [1, 0] },   // east
    ];
    for (const sd of sides) {
      const gaps: [number, number][] = []; const solid: [number, number][] = [];
      let i = 0;
      while (i < sd.cells.length) {
        const open = sideOpen(Z, gf, sd.cells[i][0], sd.cells[i][1]);
        let j = i; while (j < sd.cells.length && sideOpen(Z, gf, sd.cells[j][0], sd.cells[j][1]) === open) j++;
        (open ? gaps : solid).push([i * CELL, j * CELL]); i = j;
      }
      // a side that is all opening (the wall-less joint of an L corridor) is no wall at all: the other leg owns that line
      if (solid.length) walls.push({ x0: sd.x0, z0: sd.z0, x1: sd.x1, z1: sd.z1, h: arch.wallH, y: zn.floorY, floor: Z.floor, gaps });
      for (const [t0, t1] of solid) {
        const horizontal = sd.z0 === sd.z1;
        const ax0 = horizontal ? sd.x0 + t0 : sd.x0 + (sd.out[0] < 0 ? -WALL_T : 0);
        const ax1 = horizontal ? sd.x0 + t1 : sd.x0 + (sd.out[0] < 0 ? 0 : WALL_T);
        const az0 = horizontal ? sd.z0 + (sd.out[1] < 0 ? -WALL_T : 0) : sd.z0 + t0;
        const az1 = horizontal ? sd.z0 + (sd.out[1] < 0 ? 0 : WALL_T) : sd.z0 + t1;
        colliders.push({ x0: ax0, z0: az0, x1: ax1, z1: az1, floor: Z.floor, id: zn.id + ':wall' });
      }
    }
  }
  // floor seal
  const yAt = (gf: CellGrid, x: number, z: number): number => {
    const s = gf.get(x, z); const o = gf.ownerAt(x, z);
    if (s === STAIRS) { const st = infos[o]; return st.stairs!.rowY[rowOf(st, x, z)]; }
    if (s === FLOOR) return infos[o].floorY;
    const d = doors[o]; const za = infos.find((i) => zones[i.zi].id === d.between[0])!;
    return za.floorY;
  };
  for (const fk of Object.keys(grids)) {
    const f = Number(fk), gf = grids[f];
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      if (gf.get(x, z) === SOLID) continue;
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        const nx = x + dx, nz = z + dz; if (gf.get(nx, nz) === SOLID) continue;
        if (gf.get(x, z) === STAIRS && gf.get(nx, nz) === STAIRS && gf.ownerAt(x, z) === gf.ownerAt(nx, nz)) continue;
        if (Math.abs(yAt(gf, x, z) - yAt(gf, nx, nz)) <= STAIR_STEP) continue;
        const ex = u0(nx), ez = u0(nz);
        colliders.push(dx ? { x0: ex - 0.25, z0: u0(z), x1: ex + 0.25, z1: u0(z + 1), floor: f, id: 'seal' } : { x0: u0(x), z0: ez - 0.25, x1: u0(x + 1), z1: ez + 0.25, floor: f, id: 'seal' });
      }
    }
  }

  // --- start / exit / nodeZone ----------------------------------------------------------
  const E = infos[nodeZone[entrance.id]]; const ez = zones[E.zi];
  let start: Spot = { ...ez.spots.center };
  if (ez.doors.length) {
    const d = doors.find((x) => x.id === ez.doors[0])!;
    const dc = [Math.floor((d.x + ORIGIN) / CELL), Math.floor((d.z + ORIGIN) / CELL)];
    const side = outwardOf(E, dc[0], dc[1]); const o = N4[side];
    const ix = Math.min(E.x1, Math.max(E.x0, dc[0] - o[0])), iz = Math.min(E.z1, Math.max(E.z0, dc[1] - o[1]));
    const sx = u0(ix) + CELL / 2, sz = u0(iz) + CELL / 2;
    start = { x: sx, z: sz, yaw: dirOf(d.x - sx, d.z - sz), floor: 0 };
  }
  const exitNode = g.nodes.find((n) => n.role === 'exit');
  const exit = exitNode ? { ...zones[nodeZone[exitNode.id]].spots.center } : undefined;
  const nz: Record<string, string> = {};
  for (const id of Object.keys(nodeZone)) nz[id] = zones[nodeZone[id]].id;
  return { grids, zones, doors, walls, colliders, start, exit, nodeZone: nz };
}

const range = (a: number, b: number): number[] => { const o: number[] = []; for (let i = a; i <= b; i++) o.push(i); return o; };
