// src/engine/composer/embedSpine.ts — the SPINE embedder (design §4.3 "spine"): houses, schools,
// shops, haunted houses and every lot interior. A corridor spine runs along +x; mission nodes become
// rooms hung off it as ribs (both sides or alternating), the entrance caps the start, the hub/boss
// caps the end. Rooms keep a 1-cell SOLID margin from everything; doors are the 2 DOOR cells carved
// into that margin, so every door cell touches both zones it names. Nodes on floor ≠ 0 get a 2×4
// 'stairs' rib on floor 0 whose top cell lies inside their rect on grid[floor].
// Plan-only: integer cells, rational u, no trig, no Math.random. Byte-deterministic from the seed.
import type { AABB, Archetype, Dir16, Door, EmbeddedLayout, MissionGraph, MissionNode, Role, RoomKind, RoomRecipe, Spot, WallRun, Zone } from './types';
import { CELL, GRID } from './types';
import { CellGrid, DOOR, FLOOR, STAIRS } from './grid';
import { sub } from './rng';

/** Height of one floor above the last (u). Attic = +1, basement = −1. */
export const FLOOR_H = 3.5;
/** Cells per stairs rib: 2 wide (along the spine) × 4 deep (away from it). */
export const STAIRS_W = 2, STAIRS_D = 4;
/** 40-u streaming chunk. */
const CHUNK = 40;

/** Cell rect (inclusive) on one floor. */
export interface CellRect { x0: number; z0: number; x1: number; z1: number }

const DIR_POS_X: Dir16 = 4, DIR_NEG_X: Dir16 = 12, DIR_POS_Z: Dir16 = 0, DIR_NEG_Z: Dir16 = 8;

/** Cell → u along one axis (design: x = (cx − GRID/2) * CELL). */
export const cellU = (c: number): number => (c - GRID / 2) * CELL;

interface Room { node?: MissionNode; kind: RoomKind; role: Role; depth: number; floor: number; cells: CellRect; recipe?: RoomRecipe; side?: -1 | 1; stairs?: { to: number; top: CellRect } ; tags: string[] }
interface DoorPlan { cells: CellRect; floor: number; a: number; b: number; yaw: Dir16; lock?: string; secret?: boolean }

export function embedSpine(g: MissionGraph, seed: number, arch: Archetype): EmbeddedLayout | null {
  const rng = sub(seed, 'embedSpine');
  const sp = arch.spine ?? { len: [4, 6] as [number, number], ribs: [1, 2] as [number, number], hubAtEnd: true };
  const W = sp.concourse ? 3 : 2;
  const nodes = g.nodes;
  if (!nodes.length) return null;
  const byId = new Map<string, MissionNode>(); for (const n of nodes) byId.set(n.id, n);

  // kind-less nodes draw a kind from the role's pool once (typeAndName keeps it), so size, recipe and name agree
  const drawnKind = new Map<string, RoomKind>();
  const kindOf = (n: MissionNode): RoomKind => {
    if (n.kind) return n.kind;
    let k = drawnKind.get(n.id);
    if (!k) { const pool = arch.roleMap[n.role]; k = pool && pool.length ? rng.pick(pool) : Object.keys(arch.kinds)[0]; drawnKind.set(n.id, k); }
    return k;
  };
  const recipeOf = (kind: RoomKind): RoomRecipe | undefined => arch.kinds[kind];

  // --- who caps which end ---------------------------------------------------------------------
  const entrance = nodes.find((n) => n.role === 'entrance') ?? byId.get(g.criticalPath[0]) ?? nodes[0];
  const pickHub = (): MissionNode | undefined => {
    const cp = g.criticalPath.map((id) => byId.get(id)).filter((n): n is MissionNode => !!n && n !== entrance);
    for (const role of ['boss', 'exit', 'hub'] as Role[]) { const n = [...cp].reverse().find((m) => m.role === role && (m.floor ?? 0) === 0) ?? nodes.find((m) => m.role === role && m !== entrance && (m.floor ?? 0) === 0); if (n) return n; }
    return cp.length ? cp[cp.length - 1] : undefined;
  };
  const hub = sp.hubAtEnd ? pickHub() : undefined;

  // --- sizes (drawn once, in node order, so the plan is stable) ---------------------------------
  const sizes = new Map<string, number>();
  const drawSize = (n: MissionNode, min: boolean): number => {
    const r = recipeOf(kindOf(n)); let s = r ? (min ? r.size[0] : rng.int(r.size[0], r.size[1])) : 3;
    if (n.role === 'boss') s = Math.max(s, arch.bossArena.minCells);
    return Math.max(2, s);
  };
  for (const n of nodes) sizes.set(n.id, drawSize(n, false));
  const lenPick = rng.int(sp.len[0], sp.len[1]);

  // --- lay ribs along the spine; returns null if the grid cannot hold it -------------------------
  const ribNodes = nodes.filter((n) => n !== entrance && n !== hub);
  const attempt = (minSizes: boolean): { rooms: Room[]; spine: CellRect; spineX0: number; corridorIdx: number } | null => {
    const size = (n: MissionNode) => minSizes ? drawSizeMin(n) : sizes.get(n.id)!;
    const drawSizeMin = (n: MissionNode) => { const r = recipeOf(kindOf(n)); let s = r ? r.size[0] : 3; if (n.role === 'boss') s = Math.max(s, arch.bossArena.minCells); return Math.max(2, s); };
    // footprint along x per rib (stairs ribs reserve the upper room's width)
    const widths = ribNodes.map((n) => ((n.floor ?? 0) !== 0 ? Math.max(STAIRS_W, size(n)) : size(n)));
    const cursor: [number, number] = [0, 0]; const at: number[] = []; const sideOf: (-1 | 1)[] = [];
    for (let i = 0; i < ribNodes.length; i++) {
      const side: -1 | 1 = i % 2 === 0 ? -1 : 1;                 // −1 = north (−z), +1 = south (+z)
      const c = sp.doubleLoaded ? (side === -1 ? 0 : 1) : 0;     // per-side cursors when double-loaded, one shared cursor when alternating
      const x = sp.doubleLoaded ? cursor[c] : Math.max(cursor[0], cursor[1]);
      at.push(x); sideOf.push(side);
      if (sp.doubleLoaded) cursor[c] = x + widths[i] + 1; else cursor[0] = cursor[1] = x + widths[i] + 1;
    }
    const need = Math.max(cursor[0], cursor[1]) - 1;
    const L = Math.max(lenPick, need, 2);
    const sE = size(entrance), sH = hub ? size(hub) : 0;
    const total = sE + 1 + L + (hub ? 1 + sH : 0);
    if (total + 2 > GRID) return null;
    const startX = Math.floor((GRID - total) / 2);
    const spineX0 = startX + sE + 1, spineX1 = spineX0 + L - 1;
    const zs0 = Math.floor(GRID / 2) - Math.floor(W / 2);
    const spine: CellRect = { x0: spineX0, z0: zs0, x1: spineX1, z1: zs0 + W - 1 };
    const rooms: Room[] = [];
    // corridor first (index 0), then entrance, then ribs in node order, hub last
    const corridorKind = sp.oneBigRoom && hub ? kindOf(hub) : (arch.roleMap.corridor?.[0] ?? 'corridor');
    const corridorRole: Role = sp.oneBigRoom && hub ? hub.role : 'corridor';
    rooms.push({ node: sp.oneBigRoom && hub ? hub : undefined, kind: corridorKind, role: corridorRole, depth: 1, floor: 0, cells: spine, recipe: recipeOf(corridorKind), tags: ['spine'] });
    const centred = (s: number): CellRect => { const z0 = zs0 - Math.floor((s - W) / 2); return { x0: 0, z0, x1: 0, z1: z0 + s - 1 }; };
    const eRect = centred(sE); eRect.x0 = startX; eRect.x1 = startX + sE - 1;
    rooms.push({ node: entrance, kind: kindOf(entrance), role: entrance.role, depth: entrance.depth, floor: 0, cells: eRect, recipe: recipeOf(kindOf(entrance)), tags: [] });
    for (let i = 0; i < ribNodes.length; i++) {
      const n = ribNodes[i], side = sideOf[i], s = size(n), x0 = spineX0 + at[i], f = n.floor ?? 0;
      if (f !== 0) {
        // 2×4 stairs rib on floor 0; the node's room sits on grid[f] with the stairs' top cell inside it, extending away from the spine
        const z1 = side === -1 ? zs0 - 2 : zs0 + W + 1 + STAIRS_D - 1;
        const z0 = z1 - STAIRS_D + 1;
        const sc: CellRect = { x0, z0, x1: x0 + STAIRS_W - 1, z1 };
        const topZ = side === -1 ? z0 : z1;
        const top: CellRect = { x0, z0: topZ, x1: x0 + STAIRS_W - 1, z1: topZ };
        const rz0 = side === -1 ? topZ - s + 1 : topZ, rz1 = rz0 + s - 1;
        const room: CellRect = { x0, z0: rz0, x1: x0 + s - 1, z1: rz1 };
        const stairsKind = arch.roleMap.stairs?.[0] ?? 'stairs';
        rooms.push({ kind: stairsKind, role: 'stairs', depth: n.depth, floor: 0, cells: sc, recipe: recipeOf(stairsKind), side, stairs: { to: f, top }, tags: ['stairs'] });
        rooms.push({ node: n, kind: kindOf(n), role: n.role, depth: n.depth, floor: f, cells: room, recipe: recipeOf(kindOf(n)), tags: [] });
      } else {
        const z1 = side === -1 ? zs0 - 2 : zs0 + W + s;
        const z0 = z1 - s + 1;
        rooms.push({ node: n, kind: kindOf(n), role: n.role, depth: n.depth, floor: 0, cells: { x0, z0, x1: x0 + s - 1, z1 }, recipe: recipeOf(kindOf(n)), side, tags: [] });
      }
    }
    if (hub && !sp.oneBigRoom) { const h = centred(sH); h.x0 = spineX1 + 2; h.x1 = h.x0 + sH - 1; rooms.push({ node: hub, kind: kindOf(hub), role: hub.role, depth: hub.depth, floor: 0, cells: h, recipe: recipeOf(kindOf(hub)), tags: [] }); }
    else if (hub && sp.oneBigRoom) { /* the spine zone IS the hub; its node maps to index 0 */ }
    for (const r of rooms) if (r.cells.x0 < 1 || r.cells.z0 < 1 || r.cells.x1 > GRID - 2 || r.cells.z1 > GRID - 2) return null;
    return { rooms, spine, spineX0, corridorIdx: 0 };
  };
  const plan = attempt(false) ?? attempt(true);
  if (!plan) return null;
  const { rooms } = plan;

  // --- grids -----------------------------------------------------------------------------------
  const grids: Record<number, CellGrid> = {};
  const gridOf = (f: number): CellGrid => (grids[f] ??= new CellGrid(GRID));
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i], gr = gridOf(r.floor);
    if (!gr.free(r.cells.x0, r.cells.z0, r.cells.x1, r.cells.z1, 1)) return null;
    gr.fill(r.cells.x0, r.cells.z0, r.cells.x1, r.cells.z1, r.stairs ? STAIRS : FLOOR, i);
  }

  // --- doors -----------------------------------------------------------------------------------
  const doors: DoorPlan[] = [];
  const roomOfNode = new Map<string, number>();
  for (let i = 0; i < rooms.length; i++) if (rooms[i].node) roomOfNode.set(rooms[i].node!.id, i);
  const spineDoor = new Map<number, number>();           // room index → door index of its door onto the spine
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i]; if (r.floor !== 0) continue;      // upper rooms connect via their stairs rib
    const c = r.cells, sp0 = plan.spine;
    let cells: CellRect, yaw: Dir16;
    if (r.side === -1) { cells = { x0: c.x0, z0: c.z1 + 1, x1: Math.min(c.x0 + 1, c.x1), z1: c.z1 + 1 }; yaw = DIR_NEG_Z; }
    else if (r.side === 1) { cells = { x0: c.x0, z0: c.z0 - 1, x1: Math.min(c.x0 + 1, c.x1), z1: c.z0 - 1 }; yaw = DIR_POS_Z; }
    else if (c.x1 < sp0.x0) { cells = { x0: c.x1 + 1, z0: sp0.z0, x1: c.x1 + 1, z1: sp0.z0 + 1 }; yaw = DIR_NEG_X; }   // entrance
    else { cells = { x0: c.x0 - 1, z0: sp0.z0, x1: c.x0 - 1, z1: sp0.z0 + 1 }; yaw = DIR_POS_X; }                         // hub at end
    spineDoor.set(i, doors.length);
    doors.push({ cells, floor: 0, a: i, b: 0, yaw });
  }
  // mission edges: side-by-side ribs get a shared door; locks / secrets land on the deeper room's spine door
  const deeper = (a: MissionNode, b: MissionNode) => (b.depth >= a.depth ? b : a);
  for (const e of g.edges) {
    const na = byId.get(e.a), nb = byId.get(e.b); if (!na || !nb) continue;
    const ia = roomOfNode.get(na.id), ib = roomOfNode.get(nb.id); if (ia === undefined || ib === undefined) continue;
    const ra = rooms[ia], rb = rooms[ib];
    const deep = deeper(na, nb); const id = roomOfNode.get(deep.id)!;
    const stairsFor = (ri: number) => rooms.findIndex((r) => r.stairs && r.stairs.to === rooms[ri].floor && r.cells.x0 === rooms[ri].cells.x0);
    const lockTarget = rooms[id].floor === 0 ? id : stairsFor(id);
    if (e.lock) { const d = spineDoor.get(lockTarget); if (d !== undefined) doors[d].lock = e.lock; }
    if (e.secret && deep.role === 'secret') { const d = spineDoor.get(lockTarget); if (d !== undefined) doors[d].secret = true; }
    if (e.lock) continue;
    const sideBySide = ra.floor === 0 && rb.floor === 0 && ra.side !== undefined && ra.side === rb.side && !ra.stairs && !rb.stairs;
    if (!sideBySide) continue;
    const [l, r] = ra.cells.x0 < rb.cells.x0 ? [ra, rb] : [rb, ra];
    if (r.cells.x0 !== l.cells.x1 + 2) continue;
    const zLo = Math.max(l.cells.z0, r.cells.z0), zHi = Math.min(l.cells.z1, r.cells.z1); if (zLo > zHi) continue;
    // two rows nearest the spine
    const rows: [number, number] = ra.side === -1 ? [Math.max(zLo, zHi - 1), zHi] : [zLo, Math.min(zHi, zLo + 1)];
    const x = l.cells.x1 + 1;
    doors.push({ cells: { x0: x, z0: rows[0], x1: x, z1: rows[1] }, floor: 0, a: ra.cells.x0 < rb.cells.x0 ? ib : ia, b: ra.cells.x0 < rb.cells.x0 ? ia : ib, yaw: rooms[id] === r ? DIR_POS_X : DIR_NEG_X, secret: e.secret || undefined });
  }
  for (let i = 0; i < doors.length; i++) { const d = doors[i]; gridOf(d.floor).fill(d.cells.x0, d.cells.z0, d.cells.x1, d.cells.z1, DOOR, i); }

  // --- zones -----------------------------------------------------------------------------------
  const ordinal = new Map<string, number>();
  const zones: Zone[] = rooms.map((r) => {
    const n = (ordinal.get(r.kind) ?? 0) + 1; ordinal.set(r.kind, n);
    const floorY = r.floor * FLOOR_H;
    const ceil = r.recipe?.ceil; const ceilY = ceil === null ? undefined : floorY + (ceil ?? 14);
    const rect = { x0: cellU(r.cells.x0), z0: cellU(r.cells.z0), x1: cellU(r.cells.x1 + 1), z1: cellU(r.cells.z1 + 1) };
    const center: Spot = { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2, yaw: 0, floor: r.floor };
    const chunks: [number, number][] = [];
    for (let cz = Math.floor(rect.z0 / CHUNK); cz <= Math.floor((rect.z1 - 1) / CHUNK); cz++) for (let cx = Math.floor(rect.x0 / CHUNK); cx <= Math.floor((rect.x1 - 1) / CHUNK); cx++) chunks.push([cx, cz]);
    const z: Zone = {
      id: `${arch.id}.${r.kind}#${n}`, name: '', kind: r.kind, role: r.role, depth: r.depth,
      rect, cells: { ...r.cells }, floor: r.floor, floorY, ceilY, doors: [],
      spots: { center, npc: [], loot: [], hide: [] }, chunks, tags: r.tags.slice(),
    };
    if (r.stairs) {
      const dir = r.stairs.to > 0 ? 1 : -1; const n = STAIRS_D - 1;
      const steps: { x0: number; z0: number; x1: number; z1: number; y: number }[] = [];
      for (let k = 0; k <= n; k++) {
        const row = r.side === -1 ? r.cells.z1 - k : r.cells.z0 + k;      // from the spine side up to the top
        steps.push({ x0: rect.x0, z0: cellU(row), x1: rect.x1, z1: cellU(row + 1), y: k === 0 ? 0 : (dir * FLOOR_H * k) / n });
      }
      z.stairs = { from: 0, to: r.stairs.to, steps };
    }
    return z;
  });
  const nodeZone: Record<string, string> = {};
  for (const [nid, ri] of roomOfNode) nodeZone[nid] = zones[ri].id;

  // --- door records, walls, colliders ----------------------------------------------------------
  const outDoors: Door[] = doors.map((d, i) => {
    const horizontal = d.cells.z0 === d.cells.z1;   // door cells in a row → passage along z
    const ux0 = cellU(d.cells.x0), ux1 = cellU(d.cells.x1 + 1), uz0 = cellU(d.cells.z0), uz1 = cellU(d.cells.z1 + 1);
    const x = (ux0 + ux1) / 2, z = (uz0 + uz1) / 2;
    const w = horizontal ? ux1 - ux0 : uz1 - uz0;
    const collider: AABB = horizontal ? { x0: ux0, z0: z - 0.5, x1: ux1, z1: z + 0.5, floor: d.floor } : { x0: x - 0.5, z0: uz0, x1: x + 0.5, z1: uz1, floor: d.floor };
    const id = `door#${i}`; collider.id = id;
    zones[d.a].doors.push(id); zones[d.b].doors.push(id);
    return { id, x, z, yaw: d.yaw, w, between: [zones[d.a].id, zones[d.b].id], lock: d.lock, secret: d.secret, collider, floor: d.floor };
  });
  const walls: WallRun[] = []; const colliders: AABB[] = [];
  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi], c = z.cells, h = arch.wallH, y = z.floorY, f = z.floor;
    const near = doors.filter((d) => d.floor === f && (d.a === zi || d.b === zi));
    const edges: { horiz: boolean; at: number; lo: number; hi: number; row: number }[] = [
      { horiz: true, at: c.z0, lo: c.x0, hi: c.x1, row: c.z0 - 1 }, { horiz: true, at: c.z1 + 1, lo: c.x0, hi: c.x1, row: c.z1 + 1 },
      { horiz: false, at: c.x0, lo: c.z0, hi: c.z1, row: c.x0 - 1 }, { horiz: false, at: c.x1 + 1, lo: c.z0, hi: c.z1, row: c.x1 + 1 },
    ];
    for (const e of edges) {
      const len = e.hi - e.lo + 1;
      const gapsC: [number, number][] = [];
      for (const d of near) {
        const dc = d.cells;
        if (e.horiz ? (dc.z0 === e.row && dc.z1 === e.row) : (dc.x0 === e.row && dc.x1 === e.row)) {
          const g0 = Math.max(e.lo, e.horiz ? dc.x0 : dc.z0), g1 = Math.min(e.hi, e.horiz ? dc.x1 : dc.z1);
          if (g0 <= g1) gapsC.push([g0, g1 + 1]);
        }
      }
      gapsC.sort((a, b) => a[0] - b[0]);
      const gaps: [number, number][] = gapsC.map(([g0, g1]) => [(g0 - e.lo) / len, (g1 - e.lo) / len]);
      const a = cellU(e.at), u0 = cellU(e.lo), u1 = cellU(e.hi + 1);
      walls.push(e.horiz ? { x0: u0, z0: a, x1: u1, z1: a, h, y, floor: f, gaps } : { x0: a, z0: u0, x1: a, z1: u1, h, y, floor: f, gaps });
      let cur = e.lo;
      const seg = (s0: number, s1: number) => { if (s1 <= s0) return; const p0 = cellU(s0), p1 = cellU(s1); colliders.push(e.horiz ? { x0: p0, z0: a - 0.5, x1: p1, z1: a + 0.5, floor: f } : { x0: a - 0.5, z0: p0, x1: a + 0.5, z1: p1, floor: f }); };
      for (const [g0, g1] of gapsC) { seg(cur, g0); cur = g1; }
      seg(cur, e.hi + 1);
    }
  }
  for (const d of outDoors) if (d.lock) colliders.push({ ...d.collider });

  // --- start / exit ----------------------------------------------------------------------------
  const ez = zones[1];
  const start: Spot = { x: ez.rect.x1 - CELL / 2, z: cellU(plan.spine.z0 + 1), yaw: DIR_POS_X, floor: 0 };
  const lastId = [...g.criticalPath].reverse().map((id) => nodeZone[id]).find((zid) => zid !== undefined);
  const exitZone = lastId ? zones.find((z) => z.id === lastId) : undefined;
  const last = hub ? zones[roomOfNode.get(hub.id)!] : (exitZone ?? zones[zones.length - 1]);
  const exit: Spot = { ...last.spots.center };

  return { grids, zones, doors: outDoors, walls, colliders, start, exit, nodeZone };
}
