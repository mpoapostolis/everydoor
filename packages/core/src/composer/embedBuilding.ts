// src/engine/composer/embedBuilding.ts — the BUILDING embedder (layout 'building' / 'plan'): houses, schools,
// shops, offices, hospitals, prisons, haunted houses. FLOOR-PLAN FIRST: the mission graph becomes a list of
// room NEEDS (kind, target area, placement tags, preferred neighbours), plans/generate.ts grows 24 candidate
// FloorPlans for them (constrained growth for dwellings, corridor strips for institutions), the best-scoring
// one is parsed and turned into the EmbeddedLayout by planToLayout() — shared walls, doors centred on the
// shared wall, one WallRun per boundary segment, colliders, the start inside the entrance facing its door.
// SINGLE STOREY (owner decision 2026-08-22): every zone is on floor 0; node floors and stairs roles are ignored
// (stairs / corridor nodes map onto the corridor or hub zone).
//
// SHARED-WALL CONTRACT (types.ts / README): rooms ABUT (A.cells.x1 === B.cells.x0 − 1); zone.rect in u with
// x1 = cellU(cx1 + 1); one WallRun per boundary segment ON the line, gaps = door openings as fractions, exterior
// edges get runs too; colliders = one 1-u AABB per solid wall piece plus one per locked door (id = lock id);
// Door.x/z = opening centre ON the line, w = 10 (an open join spans the whole segment), yaw INTO between[0];
// grids hold FLOOR cells owned by zone index only — doors live on lines, never in cells.
// Plan-only: integer cells, seeded Rng, Dir16 yaws — no three.js, no Math.random, no trig.
import type { AABB, Archetype, Dir16, Door, EmbeddedLayout, MissionGraph, MissionNode, Role, RoomKind, Spot, WallRun, Zone } from './types';
import { CELL, GRID } from './types';
import { CellGrid, FLOOR, SOLID } from './grid';
import { sub } from './rng';
import type { FloorPlan, ParsedPlan } from './plans/types';
import { generatePlan, methodFor, parsePlanRows, rankPlans, scorePlan, sharedWall, SERVICE_KINDS, MIN_ROOM, type PlanNeeds, type RoomNeed } from './plans/generate';

/** Kept for callers that read it: every zone sits on floor 0 (single storey), so floorY = 0 everywhere. */
export const FLOOR_H = 0;
/** Door opening: 2 cells = 10 u. */
export const DOOR_CELLS = 2, DOOR_W = DOOR_CELLS * CELL;
/** Candidates per embed and how many of the best are tried against the mission's lock constraints. */
export const CANDIDATES = 20, TRY_BEST = 4;
const CHUNK = 40;
const DIR_POS_X: Dir16 = 4, DIR_NEG_X: Dir16 = 12, DIR_POS_Z: Dir16 = 0, DIR_NEG_Z: Dir16 = 8;
const QUARTER_DXZ: Record<number, [number, number]> = { 0: [0, 1], 4: [1, 0], 8: [0, -1], 12: [-1, 0] };

export interface CellRect { x0: number; z0: number; x1: number; z1: number }
/** Cell → u along one axis (design: x = (cx − GRID/2) * CELL). */
export const cellU = (c: number): number => (c - GRID / 2) * CELL;

/** Why the last embed returned null ('' after a success). */
export let lastFail = '';
const fail = (why: string): null => { lastFail = why; return null; };

/** The mission graph as plan needs, plus what planToLayout needs to map the plan back onto the graph. */
export interface MissionNeeds {
  needs: PlanNeeds;
  nodeOfNeed: MissionNode[];                       // need index → node
  corridorNodes: MissionNode[];                    // corridor / stairs / hallway-kind nodes: they ride on the corridor zone
  locks: { lock: string; deep: MissionNode; shallow: MissionNode }[];
  entrance: MissionNode;
}

/** Mission nodes → room needs: kinds drawn once per node (typeAndName keeps them), areas from the recipes
 *  (rooms ≥ 4×4, service rooms 3×3, the hub ≥ 6×6, the boss ≥ its arena), tags for placement, mission edges as preferences. */
export function needsOf(g: MissionGraph, seed: number, arch: Archetype): MissionNeeds {
  const rng = sub(seed, 'embedBuilding');
  const nodes = g.nodes;
  const byId = new Map<string, MissionNode>(); for (const n of nodes) byId.set(n.id, n);
  const corrKind: RoomKind = arch.roleMap.corridor?.[0] ?? 'corridor';
  const drawnKind = new Map<string, RoomKind>();
  const kindOf = (n: MissionNode): RoomKind => {
    if (n.kind && arch.kinds[n.kind]) return n.kind;
    let k = drawnKind.get(n.id);
    if (!k) { const pool = (arch.roleMap[n.role] ?? []).filter((p) => arch.kinds[p]); k = pool.length ? rng.pick(pool) : Object.keys(arch.kinds)[0]; drawnKind.set(n.id, k); }
    return k;
  };
  const entrance = nodes.find((n) => n.role === 'entrance') ?? byId.get(g.criticalPath[0]) ?? nodes[0];
  // a node rides on the corridor when it IS one (corridor / stairs role) or when a passage-ish role drew the corridor kind;
  // a secret / lock / key / boss / treasure node that drew the corridor kind is still a room (the pool just had nothing better)
  const CORRIDOR_ROLES = new Set<Role>(['corridor', 'stairs', 'hub', 'plain', 'rest', 'npc', 'checkpoint', 'work', 'vantage', 'exit', 'combat', 'elite', 'puzzle']);
  const locks: MissionNeeds['locks'] = [];
  for (const e of g.edges) { if (!e.lock) continue; const a = byId.get(e.a), b = byId.get(e.b); if (!a || !b) continue; const deep = b.depth >= a.depth ? b : a; locks.push({ lock: e.lock, deep, shallow: deep === a ? b : a }); }
  const lockDeep = new Set(locks.map((l) => l.deep.id));
  // the room behind a lock is always a room (a dead end with one door), never the corridor
  const isCorr = (n: MissionNode) => n !== entrance && !lockDeep.has(n.id) && (n.role === 'corridor' || n.role === 'stairs' || ((kindOf(n) === corrKind || kindOf(n) === 'stairs') && CORRIDOR_ROLES.has(n.role)));
  const corridorNodes = nodes.filter(isCorr);
  const roomNodes = nodes.filter((n) => !isCorr(n));
  const boss = roomNodes.find((n) => n.role === 'boss' && n !== entrance);
  const hub = roomNodes.find((n) => n.role === 'hub' && n !== entrance && n !== boss);
  const rooms: RoomNeed[] = roomNodes.map((n) => {
    const kind = kindOf(n); const recipe = arch.kinds[kind];
    const service = SERVICE_KINDS.has(kind) || (!!recipe && recipe.size[1] <= 3 && n !== entrance && n !== hub && n !== boss);
    let [lo, hi] = recipe ? recipe.size : [4, 5];
    if (!service) lo = Math.max(lo, MIN_ROOM);
    if (n === hub) { lo = Math.max(lo, 6); hi = Math.max(hi, 8); }
    if (n === boss) { lo = Math.max(lo, arch.bossArena.minCells); hi = Math.max(hi, lo + 1); }
    hi = Math.max(hi, lo);
    const tags: string[] = [];
    if (n === entrance) tags.push('entrance'); if (n === hub) tags.push('hub'); if (n === boss) tags.push('boss');
    if (n === boss || n.role === 'secret' || n.role === 'lock' || lockDeep.has(n.id)) tags.push('single');
    if (n.role === 'secret') tags.push('secret');
    if (service) tags.push('service');
    if (recipe?.ceil === null) tags.push('sky');
    if (kind === 'tower') tags.push('tower');
    return { id: n.id, kind, area: [lo * lo, hi * hi], tags, role: n.role };
  });
  const roomIds = new Set(roomNodes.map((n) => n.id));
  const prefer: [string, string][] = g.edges.filter((e) => roomIds.has(e.a) && roomIds.has(e.b) && !e.lock).map((e) => [e.a, e.b]);
  // no hub node: a grown plan (house / shop) makes the entrance the hub (a storefront the rooms open on); corridor plans have the corridor
  const hubId = hub?.id ?? (methodFor(arch) === 'growth' ? entrance.id : undefined);
  return { needs: { rooms, entrance: entrance.id, hub: hubId, boss: boss?.id, prefer }, nodeOfNeed: roomNodes, corridorNodes, locks, entrance };
}

// ---------------------------------------------------------------------------
// planToLayout: a parsed FloorPlan (+ the mission mapping) → EmbeddedLayout
// ---------------------------------------------------------------------------
export interface PlanToLayoutOpts { exteriorH?: number }
export function planToLayout(parsed: ParsedPlan, g: MissionGraph, arch: Archetype, mn: MissionNeeds, opts: PlanToLayoutOpts = {}): EmbeddedLayout | null {
  const plan = parsed.plan;
  const W = parsed.w, D = parsed.d;
  if (W + 2 > GRID || D + 2 > GRID) return fail(`plan ${W}×${D} exceeds the grid`);
  const ox = Math.floor((GRID - W) / 2), oz = Math.floor((GRID - D) / 2);
  const chars = Object.keys(parsed.rects).sort((a, b) => charOrder(a) - charOrder(b));
  const needOf = (ch: string): number | undefined => { const t = plan.rooms[ch]?.tags?.find((x) => x.startsWith('need:')); return t ? Number(t.slice(5)) : undefined; };
  const nodeOf = (ch: string): MissionNode | undefined => { const i = needOf(ch); return i === undefined ? undefined : mn.nodeOfNeed[i]; };
  // plan depth from the entrance over the door graph (for zones the plan added on its own)
  const planDepth = new Map<string, number>([[plan.entrance, 0]]);
  { const q = [plan.entrance]; while (q.length) { const c = q.shift()!; for (const n of parsed.adjacency[c] ?? []) if (!planDepth.has(n)) { planDepth.set(n, planDepth.get(c)! + 1); q.push(n); } } }

  // --- zones ------------------------------------------------------------------------------------
  const ordinal = new Map<string, number>();
  const zoneOfChar = new Map<string, number>();
  const zones: Zone[] = [];
  for (const ch of chars) {
    const pr = plan.rooms[ch]; const node = nodeOf(ch);
    const kind: RoomKind = node?.kind && arch.kinds[node.kind] ? node.kind : pr.kind;
    const recipe = arch.kinds[kind];
    const ptags = (pr.tags ?? []).filter((t) => !t.startsWith('need:'));
    const isHall = ptags.includes('hall') || ptags.includes('corridor');
    const role: Role = node?.role ?? pr.role ?? (isHall ? 'corridor' : 'plain');
    const depth = node?.depth ?? planDepth.get(ch) ?? 1;
    const n = (ordinal.get(kind) ?? 0) + 1; ordinal.set(kind, n);
    const r = parsed.rects[ch];
    const cells: CellRect = { x0: r.x0 + ox, z0: r.z0 + oz, x1: r.x1 + ox, z1: r.z1 + oz };
    const rect = { x0: cellU(cells.x0), z0: cellU(cells.z0), x1: cellU(cells.x1 + 1), z1: cellU(cells.z1 + 1) };
    const sky = !!pr.sky || ptags.includes('sky') || recipe?.ceil === null;
    let ceilY: number | undefined = sky ? undefined : (recipe?.ceil ?? arch.wallH);
    if (ceilY !== undefined && role === 'boss') ceilY *= arch.bossArena.ceilMul;
    const center: Spot = { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2, yaw: 0, floor: 0 };
    const chunks: [number, number][] = [];
    for (let cz = Math.floor(rect.z0 / CHUNK); cz <= Math.floor((rect.z1 - 0.01) / CHUNK); cz++) for (let cx = Math.floor(rect.x0 / CHUNK); cx <= Math.floor((rect.x1 - 0.01) / CHUNK); cx++) chunks.push([cx, cz]);
    const tags = [...new Set([...(node ? node.tags : []), ...ptags])];
    zoneOfChar.set(ch, zones.length);
    zones.push({ id: `${arch.id}.${kind}#${n}`, name: '', kind, role, depth, rect, cells, floor: 0, floorY: 0, ceilY, doors: [], spots: { center, npc: [], loot: [], hide: [] }, chunks, tags });
  }
  const grid = new CellGrid(GRID);
  for (let i = 0; i < zones.length; i++) {
    const c = zones[i].cells;
    if (c.x0 < 1 || c.z0 < 1 || c.x1 > GRID - 2 || c.z1 > GRID - 2) return fail('zone outside the grid margin');
    for (let z = c.z0; z <= c.z1; z++) for (let x = c.x0; x <= c.x1; x++) if (grid.get(x, z) !== SOLID) return fail('zones overlap');
    grid.fill(c.x0, c.z0, c.x1, c.z1, FLOOR, i);
  }

  // --- doors: on the shared line, 2 cells centred (open joins span the segment), yaw into the deeper room -------
  const outDoors: Door[] = [];
  const doorPair = new Map<string, Door>();
  const pk = (a: number, b: number) => (a < b ? a + '|' + b : b + '|' + a);
  for (const pd of parsed.doors) {
    if (pd.exterior) continue;
    const ia = zoneOfChar.get(pd.a)!, ib = zoneOfChar.get(pd.b)!;
    const deeper = (planDepth.get(pd.b) ?? 0) > (planDepth.get(pd.a) ?? 0) ? [ib, ia] : [ia, ib];
    const [ea, eb] = deeper;                                                   // ea = the room entered
    const A = zones[ea].cells, B = zones[eb].cells;
    const sw = sharedWall(A, B); if (!sw) return fail('door between rooms that do not abut');
    const lo = pd.open ? sw.lo : sw.lo + Math.floor((sw.len - DOOR_CELLS) / 2), len = pd.open ? sw.len : DOOR_CELLS;
    const u0 = cellU(lo), u1 = cellU(lo + len), mid = (u0 + u1) / 2, line = cellU(sw.line);
    const id = `door#${outDoors.length}`;
    let x: number, z: number, yaw: Dir16, collider: AABB;
    if (sw.along === 'z') { x = line; z = mid; yaw = A.x0 === sw.line ? DIR_POS_X : DIR_NEG_X; collider = { x0: line - 0.5, z0: u0, x1: line + 0.5, z1: u1, floor: 0, id }; }
    else { x = mid; z = line; yaw = A.z0 === sw.line ? DIR_POS_Z : DIR_NEG_Z; collider = { x0: u0, z0: line - 0.5, x1: u1, z1: line + 0.5, floor: 0, id }; }
    const d: Door = { id, x, z, yaw, w: u1 - u0, between: [zones[ea].id, zones[eb].id], lock: undefined, secret: pd.open ? false : pd.secret || undefined, collider, floor: 0 };
    outDoors.push(d); doorPair.set(pk(ea, eb), d);
    zones[ea].doors.push(id); zones[eb].doors.push(id);
  }
  // --- mission mapping: node → zone; corridor nodes ride on the corridor (else a hall, the hub, the entrance) -----
  const nodeZone: Record<string, string> = {};
  for (const ch of chars) { const n = nodeOf(ch); if (n) nodeZone[n.id] = zones[zoneOfChar.get(ch)!].id; }
  const corridorZone = zones.find((z) => z.tags.includes('corridor')) ?? zones.find((z) => z.tags.includes('hall')) ?? zones.find((z) => z.tags.includes('hub')) ?? zones[zoneOfChar.get(plan.entrance)!];
  for (const n of mn.corridorNodes) if (!nodeZone[n.id]) nodeZone[n.id] = corridorZone.id;
  for (const n of g.nodes) if (!nodeZone[n.id]) return fail(`node ${n.id} (${n.role}) has no zone`);
  // --- locks: the deep node's room has one door (the generator made it single); that door carries the lock --------
  const zoneIdx = new Map(zones.map((z, i) => [z.id, i]));
  for (const l of mn.locks) {
    const zi = zoneIdx.get(nodeZone[l.deep.id]); if (zi === undefined) continue;
    const zn = zones[zi]; if (zn.tags.includes('corridor') || zn.tags.includes('hall')) continue;
    const all = zn.doors.map((id) => outDoors.find((d) => d.id === id)!);
    const ds = all.filter((d) => !d.lock);
    if (!ds.length) { if (all.some((d) => d.lock)) continue; return fail(`lock ${l.lock}: ${zn.id} has no door`); }   // a second lock on an already-locked room stays unplaced (its key opens nothing)
    const shallowId = nodeZone[l.shallow.id];
    const d = ds.find((x) => x.between.includes(shallowId)) ?? ds[0];
    d.lock = l.lock;
    // the locked door is entered INTO the locked room
    if (d.between[0] !== zn.id) { d.between = [zn.id, d.between[0] === zn.id ? d.between[1] : d.between[0]]; d.yaw = ((d.yaw + 8) % 16) as Dir16; }
  }

  // --- walls straight from the grid: one run per maximal (left | right) owner span; gaps where doors sit; open joins have no run ---
  const walls: WallRun[] = []; const colliders: AABB[] = [];
  const own = (x: number, z: number): number => (grid.get(x, z) === SOLID ? -1 : grid.ownerAt(x, z));
  const emit = (vertical: boolean, line: number, lo: number, hi: number, a: number, b: number): void => {
    const door = a >= 0 && b >= 0 ? doorPair.get(pk(a, b)) : undefined;
    if (door && door.secret === false) return;                                    // open join: no wall on this segment
    const exterior = a < 0 || b < 0;
    const h = exterior ? opts.exteriorH ?? arch.wallH : arch.wallH;
    const u0 = cellU(lo), u1 = cellU(hi + 1), at = cellU(line), len = u1 - u0;
    const gaps: [number, number][] = [];
    if (door) {
      const c = vertical ? door.z : door.x;
      if (c - DOOR_W / 2 >= u0 - 1e-9 && c + DOOR_W / 2 <= u1 + 1e-9 && (vertical ? door.x === at : door.z === at)) gaps.push([(c - DOOR_W / 2 - u0) / len, (c + DOOR_W / 2 - u0) / len]);
    }
    walls.push(vertical ? { x0: at, z0: u0, x1: at, z1: u1, h, y: 0, floor: 0, gaps } : { x0: u0, z0: at, x1: u1, z1: at, h, y: 0, floor: 0, gaps });
    const zid = zones[a >= 0 ? a : b].id + ':wall';
    let cur = 0;
    const piece = (t0: number, t1: number) => { if (t1 - t0 < 1e-9) return; const p0 = u0 + t0 * len, p1 = u0 + t1 * len; colliders.push(vertical ? { x0: at - 0.5, z0: p0, x1: at + 0.5, z1: p1, floor: 0, id: zid } : { x0: p0, z0: at - 0.5, x1: p1, z1: at + 0.5, floor: 0, id: zid }); };
    for (const [g0, g1] of gaps) { piece(cur, g0); cur = g1; }
    piece(cur, 1);
  };
  for (let line = 1; line < GRID; line++) {
    let runA = -2, runB = -2, runLo = 0;
    for (let zz = 0; zz <= GRID; zz++) {
      const a = zz < GRID ? own(line - 1, zz) : -1, b = zz < GRID ? own(line, zz) : -1;
      const wall = zz < GRID && a !== b;
      if (wall && a === runA && b === runB) continue;
      if (runA !== -2) emit(true, line, runLo, zz - 1, runA, runB);
      if (wall) { runA = a; runB = b; runLo = zz; } else { runA = -2; runB = -2; }
    }
    runA = -2; runB = -2; runLo = 0;
    for (let xx = 0; xx <= GRID; xx++) {
      const a = xx < GRID ? own(xx, line - 1) : -1, b = xx < GRID ? own(xx, line) : -1;
      const wall = xx < GRID && a !== b;
      if (wall && a === runA && b === runB) continue;
      if (runA !== -2) emit(false, line, runLo, xx - 1, runA, runB);
      if (wall) { runA = a; runB = b; runLo = xx; } else { runA = -2; runB = -2; }
    }
  }
  for (const d of outDoors) if (d.lock) colliders.push({ ...d.collider, id: d.lock });

  // --- start: one cell inside the entrance behind its first door, facing it; exit: the exit node's room, else the boss ---
  const ez = zones[zoneOfChar.get(plan.entrance)!];
  const firstDoor = outDoors.find((d) => d.id === ez.doors[0]);
  if (!firstDoor) return fail('entrance has no door');
  const into = firstDoor.between[0] === ez.id;                                   // yaw points into the entrance?
  const [dx, dz] = QUARTER_DXZ[firstDoor.yaw];
  const sgn = into ? 1 : -1;
  const start: Spot = { x: firstDoor.x + sgn * dx * CELL, z: firstDoor.z + sgn * dz * CELL, yaw: (into ? (firstDoor.yaw + 8) % 16 : firstDoor.yaw) as Dir16, floor: 0 };
  const exitNode = g.nodes.find((n) => n.role === 'exit') ?? g.nodes.find((n) => n.role === 'boss');
  const exitZone = exitNode ? zones.find((z) => z.id === nodeZone[exitNode.id]) : undefined;
  const exit: Spot | undefined = exitZone ? { ...exitZone.spots.center } : undefined;
  lastFail = '';
  return { grids: { 0: grid }, zones, doors: outDoors, walls, colliders, start, exit, nodeZone };
}
const charOrder = (ch: string): number => { const c = ch.charCodeAt(0); return c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? 26 + c - 97 : 52 + c; };

// ---------------------------------------------------------------------------
// embedBuilding: needs → candidate plans → best that satisfies the mission → layout
// ---------------------------------------------------------------------------
export function embedBuilding(g: MissionGraph, seed: number, arch: Archetype): EmbeddedLayout | null {
  if (!g.nodes.length) return fail('no nodes');
  const mn = needsOf(g, seed, arch);
  return embedWithNeeds(g, seed, arch, mn);
}
/** Shared by embedBuilding and embedCastle: rank the candidates, try the best few against the mission. */
export function embedWithNeeds(g: MissionGraph, seed: number, arch: Archetype, mn: MissionNeeds, opts: PlanToLayoutOpts = {}): EmbeddedLayout | null {
  const cands = generatePlan(arch, mn.needs, seed, CANDIDATES);
  if (!cands.length) return fail('no plan candidates');
  const ranked = rankPlans(cands, (p) => scorePlan(p, arch, mn.needs), seed);   // seeded tie-break: equal graphs on neighbouring seeds still differ
  for (const plan of ranked.slice(0, TRY_BEST)) {
    const L = planToLayout(parsePlanRows(plan), g, arch, mn, opts);
    if (L) { lastPlan = plan; return L; }
  }
  return null;
}
/** The FloorPlan behind the last successful embed (dev tooling / tests). */
export let lastPlan: FloorPlan | undefined;
