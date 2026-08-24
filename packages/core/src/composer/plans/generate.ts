// src/engine/composer/plans/generate.ts — PROCEDURAL FLOOR PLANS. Three published approaches, each a
// generator of FloorPlan candidates (single storey, rectangular rooms that SHARE WALLS, doors centred
// on the shared wall), and a scorer that picks the best of a batch:
//   (a) CONSTRAINED GROWTH — Lopes, Tutenel, Smelik, de Kraker, Bidarra 2010 ("A constrained growth
//       method for procedural floor plan generation"): houses / haunted / shops. Rectangular footprint,
//       zoned seeds (public front, private back, service beside what it serves), rooms grow as rects in
//       turns until blocked; leftover cells become halls open-joined to the hub (an L-shaped hub region).
//   (b) CORRIDOR / SQUARIFIED STRIPS — Marson & Musse 2010 ("Automatic real-time generation of floor
//       plans based on squarified treemaps"), adapted: schools / hospitals / offices / prisons / labs.
//       A 3–4 cell corridor (I, L or U), room strips both sides split proportionally to target areas,
//       the lobby capping the start, the boss capping the far end, service rooms clustered.
//   (c) RING / COURTYARD — castles: curtain-wall square, sky courtyard hub, gatehouse south, three wings
//       of rooms, the keep centred in the north wing, four corner towers, a secret room behind the chapel.
// Plan-only: integer cells, seeded Rng, no trig, no Math.random, no DOM. Byte-deterministic per seed.
// Coordinate with plans/parse.ts when it lands: parsePlanRows / checkPlan here are the minimal
// equivalents of parsePlan / validatePlan and share the ParsedPlan contract of plans/types.ts.
import type { Archetype, Role } from '../types';
import type { FloorPlan, ParsedPlan, PlanDoor, PlanRect, PlanRoom } from './types';
import { Rng, sub } from '../rng';

// ---------------------------------------------------------------------------
// Needs (what the caller asks the plan to contain) — exported types of this lane
// ---------------------------------------------------------------------------
export type PlanMethod = 'growth' | 'corridor' | 'ring';
/** One room the plan must hold. `area` in cells (inclusive range); tags steer placement:
 *  'entrance' | 'hub' | 'boss' | 'single' (exactly one door) | 'secret' | 'service' (3×3 allowed) | 'sky' | 'public' | 'private' | 'tower'. */
export interface RoomNeed { id?: string; kind: string; area: [number, number]; tags?: string[]; role?: Role }
export interface PlanNeeds {
  rooms: RoomNeed[];
  hub?: string; entrance?: string; boss?: string;          // RoomNeed ids
  prefer?: [string, string][];                              // need ids that should share a door when they abut
  method?: PlanMethod;                                      // override the archetype's default generator
}
export type PlanScore = (plan: FloorPlan) => number;

/** Doors are 2 cells (14 u); a corridor is at least 3 cells wide; rooms at least 4×4 (service 3×3). */
export const DOOR_CELLS = 2, MIN_CORRIDOR_W = 3, MIN_ROOM = 4, MIN_SERVICE = 3, MAX_SIDE = 40;
/** A room you stand in, in cells: no side past MAX_ROOM_SIDE and no slab past MAX_ROOM_ASPECT. 10 cells is
 *  70 u — the widest side any archetype recipe asks for (gym, yard, courtyard, throne). Past that a "room"
 *  reads as a hall you walk down, so it should BE a hall. Sky grounds and corridors are exempt. */
export const MAX_ROOM_SIDE = 10, MAX_ROOM_ASPECT = 2.5;
export const aspectOf = (r: PlanRect): number => Math.max(rw(r), rd(r)) / Math.min(rw(r), rd(r));
/** Does this rect still read as a room for `it`? Sky grounds (yards, fields, courtyards) are open land, not
 *  rooms, so they may sprawl; a boss arena may exceed the band by its own minimum side. */
const roomShaped = (r: PlanRect, it: Item): boolean =>
  it.sky || (Math.max(rw(r), rd(r)) <= Math.max(MAX_ROOM_SIDE, it.minW) && aspectOf(r) <= MAX_ROOM_ASPECT);
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Why the last generator attempt returned null (diagnostics only). */
export let lastFail = '';
/** Failure reasons seen since the last reset (diagnostics only; reset by clearing the map). */
export const failCounts = new Map<string, number>();
const fail = (why: string): null => { lastFail = why; failCounts.set(why, (failCounts.get(why) ?? 0) + 1); return null; };

/** Kinds that are public / private / service in a dwelling (zoning of the growth method). Tags override. */
const ZONING: Record<string, 'public' | 'private' | 'service'> = {
  foyer: 'public', living: 'public', dining: 'public', kitchen: 'public', storefront: 'public', counter: 'public', ballroom: 'public', lobby: 'public', hall: 'public', concourse: 'public', food_court: 'public', store: 'public', reception: 'public', gate: 'public',
  bedroom: 'private', study: 'private', suite: 'private', office: 'private', library: 'private', attic: 'private', basement: 'private', garage: 'private', yard: 'private', passage: 'private',
  bath: 'service', bathroom: 'service', pantry: 'service', storage: 'service', closet: 'service', janitor: 'service', vents: 'service', delivery: 'service', stairs: 'service',
};
export const SERVICE_KINDS = new Set(Object.keys(ZONING).filter((k) => ZONING[k] === 'service'));

// ---------------------------------------------------------------------------
// Draft: the generators' working form (local cells), rendered to a FloorPlan at the end
// ---------------------------------------------------------------------------
interface Item {
  idx: number; id: string; kind: string; lo: number; hi: number; mid: number; tags: string[]; role?: Role;
  zoning: 'public' | 'private' | 'service'; service: boolean; single: boolean; secret: boolean; sky: boolean;
  entrance: boolean; hub: boolean; boss: boolean; tower: boolean; minW: number;
}
interface DRoom { ch: string; kind: string; rect: PlanRect; need?: number; role?: Role; tags: string[]; sky?: boolean; single: boolean }
interface DDoor { a: string; b: string; secret?: boolean; open?: boolean }
interface Draft { rooms: DRoom[]; doors: DDoor[]; entrance: string; source: NonNullable<FloorPlan['source']>; bends: number; hub: Set<string>; notes?: string; mirrorX?: boolean }

const rw = (r: PlanRect) => r.x1 - r.x0 + 1, rd = (r: PlanRect) => r.z1 - r.z0 + 1, areaOf = (r: PlanRect) => rw(r) * rd(r);
/** Shared wall between two rects: the line and the span (cells), or null. */
export function sharedWall(A: PlanRect, B: PlanRect): { along: 'x' | 'z'; line: number; lo: number; hi: number; len: number } | null {
  if (A.x1 + 1 === B.x0 || B.x1 + 1 === A.x0) { const lo = Math.max(A.z0, B.z0), hi = Math.min(A.z1, B.z1); if (hi >= lo) return { along: 'z', line: A.x1 + 1 === B.x0 ? B.x0 : A.x0, lo, hi, len: hi - lo + 1 }; }
  if (A.z1 + 1 === B.z0 || B.z1 + 1 === A.z0) { const lo = Math.max(A.x0, B.x0), hi = Math.min(A.x1, B.x1); if (hi >= lo) return { along: 'x', line: A.z1 + 1 === B.z0 ? B.z0 : A.z0, lo, hi, len: hi - lo + 1 }; }
  return null;
}
const sharedLen = (A: PlanRect, B: PlanRect): number => sharedWall(A, B)?.len ?? 0;
const bbox = (rooms: { rect: PlanRect }[]) => { const x0 = Math.min(...rooms.map((r) => r.rect.x0)), x1 = Math.max(...rooms.map((r) => r.rect.x1)), z0 = Math.min(...rooms.map((r) => r.rect.z0)), z1 = Math.max(...rooms.map((r) => r.rect.z1)); return { w: x1 - x0 + 1, d: z1 - z0 + 1 }; };
const overlaps = (a: PlanRect, b: PlanRect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;

function itemsOf(needs: PlanNeeds, arch: Archetype): Item[] {
  const corrKind = arch.roleMap.corridor?.[0] ?? 'corridor';
  return needs.rooms.map((r, idx) => {
    const tags = r.tags ?? [];
    const id = r.id ?? `need${idx}`;
    const recipe = arch.kinds[r.kind];
    const service = tags.includes('service') || SERVICE_KINDS.has(r.kind) || r.kind === corrKind;
    const zoning = tags.includes('public') ? 'public' : tags.includes('private') ? 'private' : tags.includes('service') ? 'service' : ZONING[r.kind] ?? (service ? 'service' : 'private');
    const entrance = needs.entrance === id || tags.includes('entrance'), hub = needs.hub === id || tags.includes('hub'), boss = needs.boss === id || tags.includes('boss');
    const lo = Math.max((service ? MIN_SERVICE : MIN_ROOM) ** 2, r.area[0]), hi = Math.max(lo, r.area[1]);
    // a boss arena must reach its full side, a hub at least 6; other rooms may shrink to the floor (4×4, service 3×3) when the footprint is tight
    const minW = boss ? Math.min(10, Math.max(MIN_ROOM, Math.ceil(Math.sqrt(lo) - 1e-9))) : hub ? Math.min(6, Math.max(MIN_ROOM, Math.ceil(Math.sqrt(lo) - 1e-9))) : service ? MIN_SERVICE : MIN_ROOM;
    return {
      idx, id, kind: r.kind, lo, hi, mid: Math.round((lo + hi) / 2), tags, role: r.role, zoning, service, minW,
      single: tags.includes('single') || tags.includes('secret') || boss, secret: tags.includes('secret'), sky: tags.includes('sky') || recipe?.ceil === null,
      entrance, hub, boss, tower: tags.includes('tower') || r.kind === 'tower',
    };
  });
}
const roomTags = (it: Item, extra: string[] = []): string[] => {
  const t = [`need:${it.idx}`, ...it.tags.filter((x) => !x.startsWith('need:')), ...extra];
  if (it.entrance && !t.includes('entrance')) t.push('entrance');
  if (it.hub && !t.includes('hub')) t.push('hub');
  if (it.boss && !t.includes('boss')) t.push('boss');
  if (it.single && !t.includes('single')) t.push('single');
  if (it.service && !t.includes('service')) t.push('service');
  if (it.sky && !t.includes('sky')) t.push('sky');
  return [...new Set(t)];
};

/** Preferred pairs as need indices: mission edges (by id) plus the archetype's kind preferences. */
function preferPairs(items: Item[], needs: PlanNeeds, arch: Archetype): [number, number][] {
  const out: [number, number][] = []; const seen = new Set<string>();
  const add = (a: number, b: number) => { if (a === b) return; const k = a < b ? a + '|' + b : b + '|' + a; if (!seen.has(k)) { seen.add(k); out.push([a, b]); } };
  const byId = new Map(items.map((it) => [it.id, it.idx]));
  for (const [a, b] of needs.prefer ?? []) { const ia = byId.get(a), ib = byId.get(b); if (ia !== undefined && ib !== undefined) add(ia, ib); }
  for (const [ka, kb] of arch.adjacency.prefer) for (const a of items) if (a.kind === ka) for (const b of items) if (b.kind === kb) add(a.idx, b.idx);
  return out;
}

// ---------------------------------------------------------------------------
// Draft → FloorPlan, FloorPlan → ParsedPlan, checks, render
// ---------------------------------------------------------------------------
function toFloorPlan(draft: Draft, arch: Archetype, id: string): FloorPlan {
  const rs = draft.rooms;
  const x0 = Math.min(...rs.map((r) => r.rect.x0)), z0 = Math.min(...rs.map((r) => r.rect.z0));
  const x1 = Math.max(...rs.map((r) => r.rect.x1)), z1 = Math.max(...rs.map((r) => r.rect.z1));
  const W = x1 - x0 + 1, D = z1 - z0 + 1;
  const grid: string[][] = Array.from({ length: D }, () => Array(W).fill('.'));
  const rooms: Record<string, PlanRoom> = {};
  for (const r of rs) {
    for (let z = r.rect.z0; z <= r.rect.z1; z++) for (let x = r.rect.x0; x <= r.rect.x1; x++) grid[z - z0][x - x0] = r.ch;
    rooms[r.ch] = { kind: r.kind, role: r.role, sky: r.sky || undefined, tags: r.tags.slice() };
  }
  const doors = draft.doors.map((d) => `${d.a}-${d.b}${d.open ? '~' : d.secret ? '!' : ''}`);
  doors.push(`${draft.entrance}>`);
  const rows = grid.map((row) => (draft.mirrorX ? row.reverse() : row).join(''));   // a mirrored twin is a different building
  return { id, archetype: arch.id, rows, rooms, doors, entrance: draft.entrance, source: draft.source, notes: draft.notes };
}

/** Minimal parser (plans/parse.ts's parsePlan will replace it): rects per char, doors resolved to wall-line coordinates. */
export function parsePlanRows(plan: FloorPlan): ParsedPlan {
  const problems = checkPlan(plan);
  if (problems.length) throw new Error('floor plan invalid: ' + problems.join('; '));
  const rects = rectsOf(plan);
  const doors: PlanDoor[] = [];
  for (const s of plan.doors) {
    const m = /^(.)-(.)(?:@(\d+))?([!~]?)$/.exec(s);
    if (!m) { const e = /^(.)>$/.exec(s); if (e) doors.push(exteriorDoor(e[1], rects[e[1]], plan)); continue; }
    const [, a, b, , flag] = m; const sw = sharedWall(rects[a], rects[b])!;
    const open = flag === '~';
    const lo = open ? sw.lo : sw.lo + Math.floor((sw.len - DOOR_CELLS) / 2);
    const centre = open ? sw.lo + sw.len / 2 : lo + 1;
    doors.push(sw.along === 'z' ? { a, b, x: sw.line, z: centre, along: 'z', secret: flag === '!' || undefined, open: open || undefined } : { a, b, x: centre, z: sw.line, along: 'x', secret: flag === '!' || undefined, open: open || undefined });
  }
  const adjacency: Record<string, string[]> = {};
  for (const ch of Object.keys(rects)) adjacency[ch] = [];
  for (const d of doors) { if (d.exterior) continue; adjacency[d.a].push(d.b); adjacency[d.b].push(d.a); }
  return { plan, w: plan.rows[0].length, d: plan.rows.length, rects, doors, adjacency };
}
function exteriorDoor(ch: string, r: PlanRect, plan: FloorPlan): PlanDoor {
  // the entrance opens on its longest exterior edge (south preferred): centre of that edge
  const W = plan.rows[0].length, D = plan.rows.length;
  const out = (x: number, z: number) => x < 0 || z < 0 || x >= W || z >= D || plan.rows[z][x] === '.';
  const edges: { along: 'x' | 'z'; x: number; z: number; n: number }[] = [];
  let n = 0; for (let x = r.x0; x <= r.x1; x++) if (out(x, r.z1 + 1)) n++; edges.push({ along: 'x', x: (r.x0 + r.x1 + 1) / 2, z: r.z1 + 1, n });
  n = 0; for (let x = r.x0; x <= r.x1; x++) if (out(x, r.z0 - 1)) n++; edges.push({ along: 'x', x: (r.x0 + r.x1 + 1) / 2, z: r.z0, n });
  n = 0; for (let z = r.z0; z <= r.z1; z++) if (out(r.x0 - 1, z)) n++; edges.push({ along: 'z', x: r.x0, z: (r.z0 + r.z1 + 1) / 2, n });
  n = 0; for (let z = r.z0; z <= r.z1; z++) if (out(r.x1 + 1, z)) n++; edges.push({ along: 'z', x: r.x1 + 1, z: (r.z0 + r.z1 + 1) / 2, n });
  const best = edges.reduce((p, q) => (q.n > p.n ? q : p));
  return { a: ch, b: '', x: best.x, z: best.z, along: best.along, exterior: true };
}
function rectsOf(plan: FloorPlan): Record<string, PlanRect> {
  const rects: Record<string, PlanRect> = {};
  plan.rows.forEach((row, z) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch === '.') continue; const r = rects[ch]; if (!r) rects[ch] = { x0: x, z0: z, x1: x, z1: z }; else { r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.z0 = Math.min(r.z0, z); r.z1 = Math.max(r.z1, z); } } });
  return rects;
}

/** Problems with a FloorPlan (empty = valid): rectangular rooms, doors on shared walls ≥ 2 cells (open joins ≥ 1), one entrance on the exterior, every room reachable over doors. */
export function checkPlan(plan: FloorPlan): string[] {
  const out: string[] = [];
  const rows = plan.rows; if (!rows.length || !rows[0].length) return ['empty plan'];
  const W = rows[0].length;
  if (rows.some((r) => r.length !== W)) out.push('ragged rows');
  const rects = rectsOf(plan);
  const counts: Record<string, number> = {};
  for (const row of rows) for (const ch of row) if (ch !== '.') counts[ch] = (counts[ch] ?? 0) + 1;
  for (const ch of Object.keys(rects)) {
    if (counts[ch] !== areaOf(rects[ch])) out.push(`room ${ch} is not a rectangle`);
    if (!plan.rooms[ch]) out.push(`room ${ch} has no entry in rooms`);
  }
  for (const ch of Object.keys(plan.rooms)) if (!rects[ch]) out.push(`rooms[${ch}] is not drawn`);
  const adj = new Map<string, Set<string>>(); for (const ch of Object.keys(rects)) adj.set(ch, new Set());
  const pairs = new Set<string>();
  let entrances = 0;
  for (const s of plan.doors) {
    const e = /^(.)>$/.exec(s);
    if (e) { entrances++; if (!rects[e[1]]) out.push(`entrance ${s} names an unknown room`); else if (e[1] !== plan.entrance) out.push(`entrance ${s} disagrees with plan.entrance`); continue; }
    const m = /^(.)-(.)(?:@(\d+))?([!~]?)$/.exec(s);
    if (!m) { out.push(`bad door ${s}`); continue; }
    const [, a, b, , flag] = m;
    if (!rects[a] || !rects[b]) { out.push(`door ${s} names an unknown room`); continue; }
    if (a === b) { out.push(`self door ${s}`); continue; }
    const sw = sharedWall(rects[a], rects[b]);
    if (!sw) { out.push(`door ${s}: rooms do not abut`); continue; }
    if (sw.len < (flag === '~' ? 1 : DOOR_CELLS)) { out.push(`door ${s}: shared wall only ${sw.len} cells`); continue; }
    const k = a < b ? a + b : b + a; if (pairs.has(k)) out.push(`duplicate door ${s}`); pairs.add(k);
    adj.get(a)!.add(b); adj.get(b)!.add(a);
  }
  if (entrances !== 1) out.push(`${entrances} entrances`);
  const er = rects[plan.entrance];
  if (!er) out.push('entrance room missing');
  else {
    const outside = (x: number, z: number) => x < 0 || z < 0 || x >= W || z >= rows.length || rows[z][x] === '.';
    let touches = false;
    for (let x = er.x0; x <= er.x1 && !touches; x++) if (outside(x, er.z0 - 1) || outside(x, er.z1 + 1)) touches = true;
    for (let z = er.z0; z <= er.z1 && !touches; z++) if (outside(er.x0 - 1, z) || outside(er.x1 + 1, z)) touches = true;
    if (!touches) out.push('entrance room is not on the exterior');
    const seen = new Set([plan.entrance]); const q = [plan.entrance];
    while (q.length) { const c = q.shift()!; for (const n of adj.get(c) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); } }
    for (const ch of Object.keys(rects)) if (!seen.has(ch)) out.push(`room ${ch} (${plan.rooms[ch]?.kind}) unreachable over doors`);
  }
  for (const ch of Object.keys(rects)) { const r = rects[ch]; if (Math.min(rw(r), rd(r)) < 1) out.push(`room ${ch} degenerate`); }
  return out;
}

/** ASCII of a plan with its door list — for reports and tests. */
export function renderPlan(plan: FloorPlan): string {
  const legend = Object.entries(plan.rooms).map(([ch, r]) => `${ch}=${r.kind}${r.tags?.includes('hub') ? '*' : ''}${r.tags?.includes('entrance') ? '>' : ''}${r.tags?.includes('boss') ? '!' : ''}`).join(' ');
  return plan.rows.join('\n') + '\n' + legend + '\ndoors: ' + plan.doors.join(' ');
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------
/** Higher is better: preferred adjacencies with a door, no forbidden abutments, no wasted cells inside the footprint,
 *  no room beyond aspect 2.5, ≤ 1 corridor bend, hub connectivity, entrance on the long front edge, size variety. */
export function scorePlan(plan: FloorPlan, arch: Archetype, needs?: PlanNeeds): number {
  const rects = rectsOf(plan); const chars = Object.keys(rects);
  const kind = (ch: string) => plan.rooms[ch]?.kind ?? '';
  const tags = (ch: string) => plan.rooms[ch]?.tags ?? [];
  const isHall = (ch: string) => tags(ch).includes('hall') || tags(ch).includes('corridor');
  const doorPairs = new Set<string>(); const openPairs = new Set<string>();
  for (const s of plan.doors) { const m = /^(.)-(.)(?:@\d+)?([!~]?)$/.exec(s); if (!m) continue; const k = m[1] < m[2] ? m[1] + m[2] : m[2] + m[1]; doorPairs.add(k); if (m[3] === '~') openPairs.add(k); }
  const pk = (a: string, b: string) => (a < b ? a + b : b + a);
  let score = 0;
  // adjacency preferences / forbids (by kind)
  const needById = new Map<string, string>();   // need id → char
  for (const ch of chars) { const t = tags(ch).find((x) => x.startsWith('need:')); if (t && needs) { const r = needs.rooms[Number(t.slice(5))]; if (r?.id) needById.set(r.id, ch); } }
  for (const [ka, kb] of arch.adjacency.prefer) for (const a of chars) if (kind(a) === ka) for (const b of chars) if (b !== a && kind(b) === kb && doorPairs.has(pk(a, b))) score += 2;
  for (const [ia, ib] of needs?.prefer ?? []) { const a = needById.get(ia), b = needById.get(ib); if (a && b && doorPairs.has(pk(a, b))) score += 1.5; }
  for (const [ka, kb] of arch.adjacency.forbid) for (const a of chars) if (kind(a) === ka) for (const b of chars) if (b !== a && kind(b) === kb && sharedLen(rects[a], rects[b]) > 0) score -= 3;
  // wasted cells: '.' enclosed on all four sides within the footprint
  const rows = plan.rows, W = rows[0].length, D = rows.length;
  let waste = 0;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (rows[z][x] !== '.') continue;
    let l = false, r = false, u = false, d = false;
    for (let i = x - 1; i >= 0 && !l; i--) if (rows[z][i] !== '.') l = true;
    for (let i = x + 1; i < W && !r; i++) if (rows[z][i] !== '.') r = true;
    for (let i = z - 1; i >= 0 && !u; i--) if (rows[i][x] !== '.') u = true;
    for (let i = z + 1; i < D && !d; i++) if (rows[i][x] !== '.') d = true;
    if (l && r && u && d) waste++;
  }
  score -= waste * 1.5;
  // room shapes: aspect > 2.5 is a slab; 1-cell-wide halls are slivers
  for (const ch of chars) {
    const r = rects[ch], a = Math.max(rw(r), rd(r)) / Math.min(rw(r), rd(r));
    if (a > 2.5 && !isHall(ch)) score -= 2;
    if (isHall(ch) && Math.min(rw(r), rd(r)) < 2) score -= 3;
    if (isHall(ch) && !tags(ch).includes('corridor')) score -= 0.5;
  }
  // corridor bends beyond 1; a corridor plan standing in for a dwelling (the growth method's fallback) is second choice
  const bends = Number((plan.notes ?? '').match(/bends=(\d+)/)?.[1] ?? 0);
  if (bends > 1) score -= 2 * (bends - 1);
  if (plan.source === 'corridor' && methodFor(arch, needs) === 'growth') score -= 3;
  // hub connectivity: rooms with a door straight into the hub region (hub + open-joined halls + corridors)
  const hubRegion = new Set<string>(chars.filter((ch) => tags(ch).includes('hub') || tags(ch).includes('corridor')));
  let grew = true; while (grew) { grew = false; for (const ch of chars) if (!hubRegion.has(ch) && isHall(ch) && [...hubRegion].some((h) => openPairs.has(pk(ch, h)))) { hubRegion.add(ch); grew = true; } }
  const rooms = chars.filter((ch) => !hubRegion.has(ch) && !isHall(ch));
  if (rooms.length) { const n = rooms.filter((ch) => [...hubRegion].some((h) => doorPairs.has(pk(ch, h)))).length; score += 10 * (n / rooms.length); }
  // entrance on the long front edge: its exterior wall runs along the long axis of the footprint
  const er = rects[plan.entrance];
  if (er) {
    const outside = (x: number, z: number) => x < 0 || z < 0 || x >= W || z >= D || rows[z][x] === '.';
    let horiz = 0, vert = 0;
    for (let x = er.x0; x <= er.x1; x++) { if (outside(x, er.z1 + 1)) horiz++; if (outside(x, er.z0 - 1)) horiz++; }
    for (let z = er.z0; z <= er.z1; z++) { if (outside(er.x0 - 1, z)) vert++; if (outside(er.x1 + 1, z)) vert++; }
    if ((W >= D && horiz >= 2) || (D > W && vert >= 2)) score += 2;
  }
  // size variety: distinct room areas
  const areas = new Set(rooms.map((ch) => areaOf(rects[ch])));
  score += Math.min(4, areas.size * 0.5);
  return score;
}

// ---------------------------------------------------------------------------
// (a) CONSTRAINED GROWTH
// ---------------------------------------------------------------------------
function growth(arch: Archetype, needs: PlanNeeds, items: Item[], rng: Rng): Draft | null {
  const corrKind = arch.roleMap.corridor?.[0] ?? 'corridor';
  const rooms = items.filter((it) => !it.tower);
  if (!rooms.length) return fail('growth: no rooms');
  const total = rooms.reduce((s, it) => s + it.mid, 0);
  // the footprint must hold every seed block with a gap plus the two fixed rooms at their full size
  const fixed = rooms.filter((it) => it.entrance || it.hub);
  const blocks = rooms.reduce((a, it) => a + (fixed.includes(it) ? it.mid * 1.2 : (it.minW + 1) * (it.minW + 1)), 0);
  const area = Math.max(total * (1.15 + rng.next() * 0.15), blocks * 1.15), aspect = 1.1 + rng.next() * 0.5;
  let W = Math.round(Math.sqrt(area * aspect)), D = Math.round(area / Math.max(1, W));
  W = Math.max(8, Math.min(MAX_SIDE, W)); D = Math.max(6, Math.min(MAX_SIDE, D));
  if (D > W) [W, D] = [D, W];
  const owner = new Int16Array(W * D).fill(-1);
  const at = (x: number, z: number) => owner[z * W + x];
  const rects: (PlanRect | null)[] = items.map(() => null);
  const place = (idx: number, r: PlanRect) => { rects[idx] = r; for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) owner[z * W + x] = idx; };
  const freeRect = (r: PlanRect) => { if (r.x0 < 0 || r.z0 < 0 || r.x1 >= W || r.z1 >= D) return false; for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) if (owner[z * W + x] !== -1) return false; return true; };
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // entrance fixed on the front (south) edge; hub fixed right behind it, overlapping ≥ 2 cells so they share a door
  const entrance = rooms.find((it) => it.entrance) ?? rooms.find((it) => it.zoning === 'public' && !it.hub) ?? rooms[0];
  const hub = rooms.find((it) => it.hub && it !== entrance);
  const entranceIsHub = !hub && entrance.hub;
  // an entrance that is also the hub (a storefront) spans most of the front so the other rooms can line its back wall
  const eW = entranceIsHub ? clamp(Math.round(W * (0.55 + rng.next() * 0.25)), entrance.minW, W) : clamp(Math.round(Math.sqrt(entrance.mid * (1 + rng.next() * 0.4))), entrance.minW, W);
  const band = (it: Item) => Math.max(MAX_ROOM_SIDE, it.minW);   // the two fixed rooms are placed at full size, so clamp them here
  const eD = clamp(Math.round(entrance.mid / eW), entrance.minW, Math.min(entranceIsHub ? D : band(entrance), Math.max(entrance.minW, D - 4)));
  const ex0 = clamp(Math.round(W / 2 - eW / 2 + (rng.next() - 0.5) * W * 0.5), 0, W - eW);
  place(entrance.idx, { x0: ex0, z0: D - eD, x1: ex0 + eW - 1, z1: D - 1 });
  let hubIdx = entranceIsHub ? entrance.idx : -1;
  if (hub) {
    const hW = clamp(Math.round(Math.sqrt(hub.mid * (1 + rng.next() * 0.5))), hub.minW, Math.min(band(hub), W));
    const hD = clamp(Math.round(hub.mid / hW), 4, Math.min(band(hub), Math.max(4, D - eD)));
    const hx0 = clamp(rng.int(ex0 - hW + 2, ex0 + eW - 2), 0, W - hW);
    const r = { x0: hx0, z0: D - eD - hD, x1: hx0 + hW - 1, z1: D - eD - 1 };
    if (!freeRect(r)) return fail('growth: hub does not fit');
    place(hub.idx, r); hubIdx = hub.idx;
  }
  // seeds: a minW×minW block each — public in the front half, private at the back, sky at the back edge,
  // service beside what it serves; blocks keep a 1-cell gap while there is room, then pack
  const prefer = preferPairs(items, needs, arch);
  const order = rooms.filter((it) => it !== entrance && it !== hub).sort((a, b) => (a.zoning === 'service' ? 1 : 0) - (b.zoning === 'service' ? 1 : 0) || (a.zoning === 'public' ? 0 : 1) - (b.zoning === 'public' ? 0 : 1) || b.mid - a.mid);
  const blockFree = (r: PlanRect, gap: number): boolean => { if (!freeRect(r)) return false; if (!gap) return true; for (let z = r.z0 - gap; z <= r.z1 + gap; z++) for (let x = r.x0 - gap; x <= r.x1 + gap; x++) if (x >= 0 && z >= 0 && x < W && z < D && owner[z * W + x] !== -1 && owner[z * W + x] !== entrance.idx && owner[z * W + x] !== hubIdx) return false; return true; };
  for (const it of order) {
    let got: PlanRect | undefined;
    const m = it.minW;
    const partner = it.zoning === 'service' ? prefer.filter(([a, b]) => a === it.idx || b === it.idx).map(([a, b]) => (a === it.idx ? b : a)).find((p) => !!rects[p]) : undefined;
    for (let gap = 1; gap >= 0 && !got; gap--) {
      for (let t = 0; t < 60 && !got; t++) {
        let x: number, z: number;
        if (partner !== undefined) {
          const pr = rects[partner]!; const side = rng.int(0, 3);
          x = side === 0 ? pr.x1 + 1 + gap : side === 1 ? pr.x0 - m - gap : rng.int(pr.x0 - m + 1, pr.x1);
          z = side === 2 ? pr.z1 + 1 + gap : side === 3 ? pr.z0 - m - gap : rng.int(pr.z0 - m + 1, pr.z1);
        } else if (entranceIsHub) { const er = rects[entrance.idx]!; const side = rng.int(0, 4); x = side === 0 ? er.x0 - m - gap : side === 1 ? er.x1 + 1 + gap : rng.int(er.x0 - m + 1, er.x1); z = side <= 1 ? rng.int(Math.max(0, er.z0 - m), D - m) : er.z0 - m - gap; }
        else if (it.sky) { x = rng.int(0, W - m); z = rng.chance(0.6) ? 0 : rng.int(0, Math.max(0, Math.floor(D / 3) - m)); }
        else if (it.zoning === 'public') { x = rng.int(0, W - m); z = rng.int(Math.floor(D * 0.4), D - m); }
        else { x = rng.int(0, W - m); z = rng.int(0, Math.max(0, Math.floor(D * 0.6) - m)); }
        x = clamp(x, 0, W - m); z = clamp(z, 0, D - m);
        const r: PlanRect = { x0: x, z0: z, x1: x + m - 1, z1: z + m - 1 };
        if (blockFree(r, gap)) got = r;
      }
    }
    if (!got) {
      // exhaustive scan before giving up
      for (let z = 0; z <= D - m && !got; z++) for (let x = 0; x <= W - m && !got; x++) { const r: PlanRect = { x0: x, z0: z, x1: x + m - 1, z1: z + m - 1 }; if (freeRect(r)) got = r; }
    }
    if (!got) return fail('growth: no seed block for ' + it.kind);
    place(it.idx, got);
  }
  // growth in turns: the room with the most remaining target area grows one strip, squarest direction first
  const growable = new Set(order.map((it) => it.idx));
  const tryGrow = (it: Item, cap: number, maxAspect: number): boolean => {
    const r = rects[it.idx]!; if (areaOf(r) >= cap) return false;
    const w = rw(r), d = rd(r);
    const dirs: { dx: number; dz: number; s: number }[] = [
      { dx: 1, dz: 0, s: (w <= d ? 2 : 0) + rng.next() }, { dx: -1, dz: 0, s: (w <= d ? 2 : 0) + rng.next() },
      { dx: 0, dz: 1, s: (d <= w ? 2 : 0) + rng.next() }, { dx: 0, dz: -1, s: (d <= w ? 2 : 0) + rng.next() },
    ].sort((a, b) => b.s - a.s);
    for (const { dx, dz } of dirs) {
      const nr: PlanRect = { x0: r.x0 + (dx < 0 ? -1 : 0), x1: r.x1 + (dx > 0 ? 1 : 0), z0: r.z0 + (dz < 0 ? -1 : 0), z1: r.z1 + (dz > 0 ? 1 : 0) };
      const nw = rw(nr), nd = rd(nr); if (Math.max(nw, nd) / Math.min(nw, nd) > maxAspect) continue;
      if (!it.sky && Math.max(nw, nd) > Math.max(MAX_ROOM_SIDE, it.minW)) continue;   // area alone let a room grow into a 5×12 slab
      const strip: PlanRect = dx > 0 ? { x0: r.x1 + 1, x1: r.x1 + 1, z0: r.z0, z1: r.z1 } : dx < 0 ? { x0: r.x0 - 1, x1: r.x0 - 1, z0: r.z0, z1: r.z1 } : dz > 0 ? { x0: r.x0, x1: r.x1, z0: r.z1 + 1, z1: r.z1 + 1 } : { x0: r.x0, x1: r.x1, z0: r.z0 - 1, z1: r.z0 - 1 };
      if (!freeRect(strip)) continue;
      place(it.idx, nr); return true;
    }
    return false;
  };
  for (let round = 0; round < 400; round++) {
    const cands = order.filter((it) => growable.has(it.idx)).sort((a, b) => (b.mid - areaOf(rects[b.idx]!)) - (a.mid - areaOf(rects[a.idx]!)) || a.idx - b.idx);
    let grew = false;
    for (const it of cands) { if (tryGrow(it, it.hi, 2.2)) grew = true; else if (areaOf(rects[it.idx]!) >= it.hi) growable.delete(it.idx); }
    if (!grew) break;
  }
  // absorb pass: rooms may pass their target to soak up leftovers (least overshoot first)
  for (let round = 0; round < 200; round++) {
    const cands = order.slice().sort((a, b) => areaOf(rects[a.idx]!) / a.hi - areaOf(rects[b.idx]!) / b.hi || a.idx - b.idx);
    let grew = false;
    for (const it of cands) if (tryGrow(it, it.hi * 1.6, 2.5)) { grew = true; break; }
    if (!grew) break;
  }
  // rooms below their minimum side are dropped back: a room that could not reach minW×minW makes this candidate invalid
  for (const it of rooms) { const r = rects[it.idx]!; if (Math.min(rw(r), rd(r)) < it.minW) return fail('growth: ' + it.kind + ' below its minimum side'); }

  // leftover → maximal rects: merged into a room that keeps its rectangle, else halls
  const halls: PlanRect[] = [];
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (at(x, z) !== -1) continue;
    let x1 = x; while (x1 + 1 < W && at(x1 + 1, z) === -1) x1++;
    let z1 = z; for (;;) { let ok = z1 + 1 < D; for (let xx = x; xx <= x1 && ok; xx++) if (at(xx, z1 + 1) !== -1) ok = false; if (!ok) break; z1++; }
    const r: PlanRect = { x0: x, z0: z, x1, z1 };
    // A leftover merges into a room only while the ROOM STAYS A ROOM. The two grow passes above respect
    // MAX_ROOM_SIDE / aspect; absorbing a full-width strip here used to ignore both, which is how a 5×6
    // bedroom became a 5×14 slab and a kitchen an 11×4 corridor. Hosts that would break the band are
    // skipped and the leftover becomes a hall instead; among legal hosts the squarest result wins.
    const merged = (q: PlanRect): PlanRect => ({ x0: Math.min(q.x0, r.x0), z0: Math.min(q.z0, r.z0), x1: Math.max(q.x1, r.x1), z1: Math.max(q.z1, r.z1) });
    const host = rooms
      .filter((it) => { const q = rects[it.idx]!; const sw = sharedWall(q, r); return !!sw && sw.len === (sw.along === 'x' ? rw(q) : rd(q)) && sw.len === (sw.along === 'x' ? rw(r) : rd(r)); })
      .filter((it) => roomShaped(merged(rects[it.idx]!), it))
      .sort((a, b) => aspectOf(merged(rects[a.idx]!)) - aspectOf(merged(rects[b.idx]!)) || a.idx - b.idx)[0];
    if (host) { place(host.idx, merged(rects[host.idx]!)); }
    else { for (let zz = z; zz <= z1; zz++) for (let xx = x; xx <= x1; xx++) owner[zz * W + xx] = -2 - halls.length; halls.push(r); }
  }

  // draft rooms
  const draftRooms: DRoom[] = [];
  const chOf = new Map<number, string>();
  let ci = 0;
  // When the entrance IS the hub (a shop's storefront, a house's living room) it was sized at 55–80 % of the
  // footprint above, because every other room opens off it — circulation, so 'cross' exempts it from the band.
  for (const it of rooms) { const ch = CHARS[ci++]; chOf.set(it.idx, ch); draftRooms.push({ ch, kind: it.kind, rect: rects[it.idx]!, need: it.idx, role: it.role, tags: roomTags(it, entranceIsHub && it === entrance ? ['cross'] : []), sky: it.sky, single: it.single }); }
  const hallRooms: DRoom[] = halls.map((r) => { const ch = CHARS[ci++]; const dr: DRoom = { ch, kind: corrKind, rect: r, role: 'corridor', tags: ['hall'], single: false }; draftRooms.push(dr); return dr; });
  const hubCh = hubIdx >= 0 ? chOf.get(hubIdx)! : undefined;
  const doors: DDoor[] = []; const pairs = new Set<string>();
  const pk = (a: string, b: string) => (a < b ? a + b : b + a);
  const addDoor = (a: string, b: string, flags: Partial<DDoor> = {}): boolean => { const k = pk(a, b); if (pairs.has(k)) return false; pairs.add(k); doors.push({ a, b, ...flags }); return true; };
  const byCh = new Map(draftRooms.map((r) => [r.ch, r]));
  // hub region: the hub plus halls chained to it by open joins (≥ 1 shared cell)
  const region = new Set<string>();
  if (hubCh) region.add(hubCh);
  let grew = true;
  while (grew) {
    grew = false;
    for (const h of hallRooms) {
      if (region.has(h.ch)) continue;
      const host = [...region].map((ch) => byCh.get(ch)!).filter((m) => sharedLen(m.rect, h.rect) >= 1).sort((p, q) => sharedLen(q.rect, h.rect) - sharedLen(p.rect, h.rect))[0];
      if (host) { addDoor(h.ch, host.ch, { open: true }); region.add(h.ch); grew = true; }
    }
  }
  // halls off the region: open-join to each other, else become a walk-in off a neighbour room
  for (const h of hallRooms) {
    if (region.has(h.ch)) continue;
    const other = hallRooms.find((o) => o !== h && !region.has(o.ch) && sharedLen(o.rect, h.rect) >= 1 && pairs.has(pk(o.ch, h.ch)));
    if (other) continue;
    const host = draftRooms.filter((r) => r !== h && !r.single && !r.tags.includes('hall') && sharedLen(r.rect, h.rect) >= DOOR_CELLS).sort((p, q) => sharedLen(q.rect, h.rect) - sharedLen(p.rect, h.rect))[0];
    if (!host) return fail('growth: stranded hall');
    addDoor(h.ch, host.ch);
  }
  if (!region.size) { // no hub room: the halls are the hub region; if there are none, the biggest public room is
    if (hallRooms.length) { region.add(hallRooms[0].ch); for (const h of hallRooms.slice(1)) if (sharedLen(h.rect, hallRooms[0].rect) >= 1) { addDoor(h.ch, hallRooms[0].ch, { open: true }); region.add(h.ch); } }
    else { const big = draftRooms.filter((r) => r.need !== undefined && r.need !== entrance.idx && !r.single).sort((p, q) => areaOf(q.rect) - areaOf(p.rect))[0] ?? draftRooms[0]; region.add(big.ch); big.tags.push('hub'); }
  }
  // doors: every room onto the region (longest shared wall), else chained through a doored, non-single neighbour
  const doored = new Set<string>(region);
  const plain = draftRooms.filter((r) => !region.has(r.ch) && !r.tags.includes('hall'));
  let directHub = 0;
  for (const r of plain) {
    const host = [...region].map((ch) => byCh.get(ch)!).filter((m) => sharedLen(m.rect, r.rect) >= DOOR_CELLS).sort((p, q) => sharedLen(q.rect, r.rect) - sharedLen(p.rect, r.rect))[0];
    if (host) { addDoor(r.ch, host.ch, { secret: r.tags.includes('secret') || undefined }); doored.add(r.ch); directHub++; }
  }
  for (let round = 0; round < plain.length + 1; round++) {
    let changed = false;
    for (const r of plain) {
      if (doored.has(r.ch)) continue;
      const host = draftRooms.filter((m) => m !== r && doored.has(m.ch) && !m.single && sharedLen(m.rect, r.rect) >= DOOR_CELLS).sort((p, q) => sharedLen(q.rect, r.rect) - sharedLen(p.rect, r.rect))[0];
      if (host) { addDoor(r.ch, host.ch, { secret: r.tags.includes('secret') || undefined }); doored.add(r.ch); changed = true; }
    }
    if (!changed) break;
  }
  if (plain.some((r) => !doored.has(r.ch))) return fail('growth: room without a door');
  if (plain.length && directHub / plain.length < 0.6) return fail('growth: hub touches ' + directHub + '/' + plain.length);
  // preferred adjacencies get a second door when both rooms are open (not single) and abut
  for (const [a, b] of prefer) {
    const ra = chOf.get(a), rb = chOf.get(b); if (!ra || !rb) continue;
    const A = byCh.get(ra)!, B = byCh.get(rb)!;
    if (A.single || B.single || pairs.has(pk(ra, rb)) || sharedLen(A.rect, B.rect) < DOOR_CELLS) continue;
    if (rng.chance(0.75)) addDoor(ra, rb);
  }
  return { rooms: draftRooms, doors, entrance: chOf.get(entrance.idx)!, source: 'grown', bends: 0, hub: region, notes: 'bends=0' };
}

// ---------------------------------------------------------------------------
// (b) CORRIDOR / SQUARIFIED STRIPS
// ---------------------------------------------------------------------------
interface Band { name: string; items: Item[]; depth: number; widths: number[]; len: number }
function corridor(arch: Archetype, needs: PlanNeeds, items: Item[], rng: Rng): Draft | null {
  const corrKind = arch.roleMap.corridor?.[0] ?? 'corridor';
  const rooms = items.filter((it) => !it.tower);
  if (rooms.length < 2) return fail('corridor: fewer than 2 rooms');
  const entrance = rooms.find((it) => it.entrance) ?? rooms[0];
  const endCap = rooms.find((it) => it.boss && it !== entrance) ?? rooms.find((it) => it.hub && it !== entrance) ?? rooms.filter((it) => it !== entrance).sort((a, b) => b.mid - a.mid)[0];
  const others = rooms.filter((it) => it !== entrance && it !== endCap);
  const n = others.length;
  const shape: 'I' | 'L' | 'U' = n >= 14 ? (rng.chance(0.6) ? 'U' : 'L') : n >= 10 && rng.chance(0.35) ? 'U' : n >= 6 && rng.chance(0.5) ? 'L' : 'I';
  const cw = rng.int(MIN_CORRIDOR_W, 4);
  const bandNames = shape === 'I' ? ['Ao', 'Ai'] : shape === 'L' ? ['Ao', 'Ai', 'Bo', 'Bi'] : ['Ao', 'Ai', 'Bo', 'Bi', 'Co', 'Ci'];
  const bands: Band[] = bandNames.map((name) => ({ name, items: [], depth: 0, widths: [], len: 0 }));
  // items: services clustered into one run; largest first into the least-filled band; every band gets ≥ 1 room when possible
  const services = others.filter((it) => it.service), big = rng.shuffle(others.filter((it) => !it.service)).sort((a, b) => b.mid - a.mid);
  const groups: Item[][] = big.map((it) => [it]); if (services.length) groups.push(services);
  const fill = (b: Band) => b.items.reduce((s, it) => s + Math.max(it.minW, Math.round(it.mid / 5)), 0);
  const firstPass = groups.splice(0, Math.min(groups.length, bands.length));
  firstPass.forEach((grp, i) => bands[i].items.push(...grp));
  for (const grp of groups) { let best = bands[0]; for (const b of bands) if (fill(b) < fill(best)) best = b; best.items.push(...grp); }
  const arrange = (b: Band) => { if (!b.items.length) return; const svc = b.items.filter((it) => it.service), open = rng.shuffle(b.items.filter((it) => !it.service)); b.items = rng.chance(0.5) ? [...open, ...svc] : [...svc, ...open]; };
  for (const b of bands) arrange(b);
  // depth per band from its biggest room (3 for an all-service band); widths ∝ area (scaled down when the footprint would overflow)
  let scale = 1;
  const layout = (): boolean => {
    for (const b of bands) {
      if (!b.items.length) { b.depth = 0; b.widths = []; b.len = 0; continue; }
      const maxMid = Math.max(...b.items.map((it) => it.mid));
      b.depth = b.depth || Math.max(b.items.every((it) => it.service) ? MIN_SERVICE : MIN_ROOM, Math.min(7, Math.round(Math.sqrt(maxMid)) + (rng.chance(0.35) ? 1 : 0)));
      // width ∝ area, but never past the room band — a gym with a 75-cell target and a 6-deep band asked for 13.
      // Whatever the clamp holds back becomes band slack, which the pad pass below spreads over its neighbours.
      b.widths = b.items.map((it) => { const w = Math.max(it.minW, Math.round((it.mid * scale) / b.depth)); return it.sky ? w : Math.min(w, Math.max(MAX_ROOM_SIDE, it.minW)); });
      b.len = b.widths.reduce((s, w) => s + w, 0);
    }
    return true;
  };
  layout();
  const B = (n: string) => bands.find((b) => b.name === n)!;
  const dAo = () => B('Ao').depth, dAi = () => B('Ai').depth, dBo = () => (shape === 'I' ? 0 : B('Bo').depth), dBi = () => (shape === 'I' ? 0 : B('Bi').depth), dCo = () => (shape === 'U' ? B('Co').depth : 0), dCi = () => (shape === 'U' ? B('Ci').depth : 0);
  // segment lengths from the bands they carry
  let LA = 0, LB = 0, LC = 0;
  const lengths = () => {
    // the corner room of a wrapped band still meets the corridor over ≥ 2 cells past the corner
    if (shape !== 'I') for (const name of shape === 'U' ? ['Ao', 'Co'] : ['Ao']) { const b = B(name); if (b.items.length) { const k = b.widths.length - 1; b.widths[k] = Math.max(b.widths[k], dBo() + DOOR_CELLS); b.len = b.widths.reduce((s, w) => s + w, 0); } }
    LA = Math.max(B('Ao').len - dBo(), B('Ai').len + (shape === 'I' ? 0 : cw), cw + MIN_ROOM);
    if (shape === 'I') { LB = 0; LC = 0; return; }
    LB = Math.max(B('Bo').len - (shape === 'U' ? 2 * cw : cw), B('Bi').len + dAi() + dCi(), dAi() + dCi() + (B('Bi').items.length ? MIN_ROOM : 0), 1);
    if (shape === 'U') { LC = Math.max(B('Co').len - dBo(), B('Ci').len + cw, cw + MIN_ROOM); if (LC > LA) LA = LC; }
  };
  lengths();
  // re-balance: a band with ≥ a room of slack takes the smallest room of a band that drives its segment's length
  const spanOf = (b: Band): number => {
    switch (b.name) {
      case 'Ao': return LA + dBo(); case 'Ai': return shape === 'I' ? LA : LA - cw;
      case 'Bo': return cw + LB + (shape === 'U' ? cw : 0); case 'Bi': return LB - dAi() - dCi();
      case 'Co': return LC + dBo(); default: return LC - cw;
    }
  };
  const rebalance = (): void => {
    for (let iter = 0; iter < 8; iter++) {
      const slackOf = (b: Band) => (b.items.length ? spanOf(b) - b.len : 0);
      const sink = bands.filter((b) => b.items.length).sort((p, q) => slackOf(q) - slackOf(p))[0];
      if (!sink || slackOf(sink) < MIN_ROOM + 1) break;
      const donors = bands.filter((b) => b !== sink && b.items.length >= 2 && slackOf(b) === 0);
      let moved = false;
      for (const d of donors) {
        const i = d.widths.indexOf(Math.min(...d.widths)); const it = d.items[i];
        if (it.service && d.items.some((o) => o !== it && o.service)) continue;           // keep the service cluster together
        if (d.widths[i] > slackOf(sink)) continue;
        d.items.splice(i, 1); sink.items.push(it); moved = true; break;
      }
      if (!moved) break;
      layout(); lengths();
    }
  };
  rebalance();
  // the end cap must be at least the boss arena; footprint aspect ≤ 2: deepen the longest band, re-layout
  const capW = () => (shape === 'I' ? dAo() + cw + dAi() : shape === 'L' ? dBi() + cw + dBo() : dCi() + cw + dCo());
  const capMin = Math.ceil(Math.sqrt(endCap.lo));
  const entW = () => dAo() + cw + dAi();
  let eD = 0, hD = 0;
  const eJit = rng.int(0, 1), hJit = rng.int(0, 1);
  const bay = entrance.mid < entW() * 3 && rng.chance(0.6);
  const dims = () => {
    const ew = bay ? cw + 2 : entW();
    eD = Math.max(entrance.minW, Math.min(8, Math.round(entrance.mid / ew) + eJit));
    hD = Math.max(3, capMin, Math.min(10, Math.round(endCap.mid / Math.max(1, capW())) + hJit));
    const w = shape === 'I' ? eD + LA + hD : shape === 'L' ? eD + LA + dBo() : Math.max(eD, hD + LA - LC) + LA + dBo();
    const d = shape === 'I' ? entW() : shape === 'L' ? dAo() + cw + LB + hD : dAo() + cw + LB + cw + dCo();
    return { w, d };
  };
  for (let iter = 0; iter < 14; iter++) {
    const { w, d } = dims();
    const ratio = Math.max(w, d) / Math.min(w, d);
    if (ratio <= 2 && w <= MAX_SIDE && d <= MAX_SIDE) break;
    if ((w > MAX_SIDE || d > MAX_SIDE) && scale > 0.5) { scale *= 0.85; layout(); lengths(); continue; }   // overflow: smaller rooms
    // too long along the corridor → deepen the band that drives the length; too wide the other way is rare
    const long = w > d;
    const cands = bands.filter((b) => b.items.length && b.depth < 9 && (long ? ['Ao', 'Ai', 'Co', 'Ci'].includes(b.name) : ['Bo', 'Bi'].includes(b.name)));
    if (!cands.length) return fail(`corridor: cannot deepen ${w}×${d} scale ${scale.toFixed(2)} ` + bands.map((b) => b.name + b.depth + ":" + b.len).join(" "));
    const b = cands.sort((p, q) => q.len - p.len)[0]; b.depth++;
    layout(); lengths(); rebalance();
  }
  { const { w, d } = dims(); if (Math.max(w, d) / Math.min(w, d) > 2.001 || w > MAX_SIDE || d > MAX_SIDE) return fail(`corridor: footprint ${w}×${d}`); }
  if (capW() < capMin) return fail('corridor: cap narrower than the arena');
  // pad each band to its segment span (largest non-service rooms first)
  const span = spanOf;
  for (const b of bands) {
    if (!b.items.length) continue;
    let extra = span(b) - b.len; if (extra < 0) return fail('corridor: band overflow');
    const order = b.items.map((_, i) => i).sort((i, j) => (b.items[i].service ? 1 : 0) - (b.items[j].service ? 1 : 0) || b.widths[j] - b.widths[i]);
    const grow = order.filter((i) => !b.items[i].service).length ? order.filter((i) => !b.items[i].service) : order;
    // Round-robin so the slack spreads evenly, but never past MAX_ROOM_SIDE: a band with one big room and a
    // long segment used to hand it every spare cell, which is how a 7-cell-deep gym came out 18 cells wide.
    // When every room in the band is capped the slack has nowhere honest to go — reject this candidate and let
    // rankPlans take one of the other 11 rather than tile the segment with a slab.
    const capOf = (i: number) => (b.items[i].sky ? Infinity : Math.max(MAX_ROOM_SIDE, b.items[i].minW));
    for (let k = rng.int(0, grow.length - 1), stall = 0; extra > 0; k = (k + 1) % grow.length) {
      if (b.widths[grow[k]] >= capOf(grow[k])) { if (++stall >= grow.length) return fail('corridor: band slack exceeds the room band'); continue; }
      b.widths[grow[k]]++; extra--; stall = 0;
    }
    b.len = span(b);
  }
  // corner rooms of wrapped bands must still meet the corridor over ≥ 2 cells
  const wrapOk = (b: Band, wrap: number): boolean => { if (!b.items.length || !wrap) return true; const lastW = b.widths[b.widths.length - 1]; return lastW - wrap >= DOOR_CELLS || b.widths.length === 1 && lastW - wrap >= DOOR_CELLS; };
  if (!wrapOk(B('Ao'), dBo())) return fail('corridor: corner room too narrow');
  if (shape === 'U' && !wrapOk(B('Co'), dBo())) return fail('corridor: corner room too narrow');

  // --- cells (local): A heads +x from x = 0 at z = dAo; B heads +z down the east end; C heads −x along the bottom
  const zA = dAo();
  const draftRooms: DRoom[] = []; let ci = 0;
  const chOf = new Map<number, string>();
  const put = (it: Item | undefined, kind: string, rect: PlanRect, tags: string[], role?: Role): DRoom => { const ch = CHARS[ci++]; const r: DRoom = { ch, kind, rect, need: it?.idx, role: it?.role ?? role, tags: it ? roomTags(it, tags) : tags, sky: it?.sky, single: it?.single ?? false }; if (it) chOf.set(it.idx, ch); draftRooms.push(r); return r; };
  const corr: DRoom[] = [];
  corr.push(put(undefined, corrKind, { x0: 0, z0: zA, x1: LA - 1, z1: zA + cw - 1 }, ['corridor'], 'corridor'));
  const zB0 = zA + cw, zB1 = zB0 + LB - 1;
  if (shape !== 'I') corr.push(put(undefined, corrKind, { x0: LA - cw, z0: zB0, x1: LA - 1, z1: zB1 }, ['corridor'], 'corridor'));
  const zC0 = zB1 + 1, zC1 = zC0 + cw - 1;
  if (shape === 'U') corr.push(put(undefined, corrKind, { x0: LA - LC, z0: zC0, x1: LA - 1, z1: zC1 }, ['corridor'], 'corridor'));
  const bandRooms = new Map<string, DRoom[]>();
  const lay = (b: Band, start: [number, number], dir: [number, number], across: [number, number]): void => {
    const list: DRoom[] = []; let [x, z] = start;
    b.items.forEach((it, i) => {
      const w = b.widths[i];
      const x0 = dir[0] >= 0 ? x : x - w + 1, x1 = dir[0] >= 0 ? x + w - 1 : x;
      const z0 = dir[1] >= 0 ? z : z - w + 1, z1 = dir[1] >= 0 ? z + w - 1 : z;
      const rect: PlanRect = dir[0] ? { x0, x1, z0: across[0], z1: across[1] } : { x0: across[0], x1: across[1], z0, z1 };
      list.push(put(it, it.kind, rect, []));
      x += dir[0] * w; z += dir[1] * w;
    });
    bandRooms.set(b.name, list);
  };
  lay(B('Ao'), [0, 0], [1, 0], [zA - dAo(), zA - 1]);
  lay(B('Ai'), [0, 0], [1, 0], [zA + cw, zA + cw + dAi() - 1]);
  if (shape !== 'I') {
    lay(B('Bo'), [0, zA], [0, 1], [LA, LA + dBo() - 1]);
    lay(B('Bi'), [0, zB0 + dAi()], [0, 1], [LA - cw - dBi(), LA - cw - 1]);
  }
  if (shape === 'U') {
    lay(B('Co'), [LA - LC, 0], [1, 0], [zC1 + 1, zC1 + dCo()]);
    lay(B('Ci'), [LA - LC, 0], [1, 0], [zC0 - dCi(), zC0 - 1]);
  }
  // caps
  // The two caps close the ends of the spine, so they span its whole cross-section (entrance hall in front,
  // gym / great room at the far end). That width is set by the corridor, not by the room's recipe — 'cross'
  // says so, and exempts them from the room size band. A 'bay' entrance is a small porch and stays a room.
  const ent = put(entrance, entrance.kind, bay ? { x0: -eD, x1: -1, z0: zA - 1, z1: zA + cw } : { x0: -eD, x1: -1, z0: zA - dAo(), z1: zA + cw + dAi() - 1 }, bay ? ['entrance'] : ['entrance', 'cross']);
  const cap = shape === 'I' ? put(endCap, endCap.kind, { x0: LA, x1: LA + hD - 1, z0: zA - dAo(), z1: zA + cw + dAi() - 1 }, ['cross'])
    : shape === 'L' ? put(endCap, endCap.kind, { x0: LA - cw - dBi(), x1: LA + dBo() - 1, z0: zB1 + 1, z1: zB1 + hD }, ['cross'])
    : put(endCap, endCap.kind, { x0: LA - LC - hD, x1: LA - LC - 1, z0: zC0 - dCi(), z1: zC1 + dCo() }, ['cross']);
  // the U's inner well becomes a sky yard with a door off its longest neighbour
  if (shape === 'U') {
    const well: PlanRect = { x0: LA - LC, x1: LA - cw - dBi() - 1, z0: zB0 + dAi(), z1: zC0 - dCi() - 1 };
    if (rw(well) >= 1 && rd(well) >= 1) {
      if (Math.min(rw(well), rd(well)) < MIN_SERVICE) return fail('corridor: light well too thin');
      const skyKind = Object.keys(arch.kinds).find((k) => arch.kinds[k].ceil === null) ?? corrKind;
      put(undefined, skyKind, well, ['yard', 'sky', 'service'], 'plain').sky = true;
    }
  }
  for (let i = 0; i < draftRooms.length; i++) for (let j = i + 1; j < draftRooms.length; j++) if (overlaps(draftRooms[i].rect, draftRooms[j].rect)) return fail('corridor: overlap ' + draftRooms[i].kind + '/' + draftRooms[j].kind);
  { const bb = bbox(draftRooms); if (Math.max(bb.w, bb.d) / Math.min(bb.w, bb.d) > 2.001 || bb.w > MAX_SIDE || bb.d > MAX_SIDE) return fail(`corridor: built ${bb.w}×${bb.d}`); }

  // --- doors
  const doors: DDoor[] = []; const pairs = new Set<string>();
  const pk = (a: string, b: string) => (a < b ? a + b : b + a);
  const addDoor = (a: string, b: string, flags: Partial<DDoor> = {}): boolean => { const k = pk(a, b); if (pairs.has(k)) return false; pairs.add(k); doors.push({ a, b, ...flags }); return true; };
  for (let i = 1; i < corr.length; i++) addDoor(corr[i].ch, corr[i - 1].ch, { open: true });
  const intoCorridor = (r: DRoom): boolean => {
    const host = corr.filter((c) => sharedLen(c.rect, r.rect) >= DOOR_CELLS).sort((p, q) => sharedLen(q.rect, r.rect) - sharedLen(p.rect, r.rect))[0];
    if (!host) return false;
    return addDoor(r.ch, host.ch, { secret: r.tags.includes('secret') || undefined });
  };
  for (const list of bandRooms.values()) for (const r of list) if (!intoCorridor(r)) return fail('corridor: ' + r.kind + ' off the corridor');
  if (!intoCorridor(ent) || !intoCorridor(cap)) return fail('corridor: cap off the corridor');
  const well = draftRooms.find((r) => r.tags.includes('yard') && r.need === undefined);
  if (well) {
    const host = draftRooms.filter((r) => r !== well && r.need !== undefined && !r.single && sharedLen(r.rect, well.rect) >= DOOR_CELLS).sort((p, q) => sharedLen(q.rect, well.rect) - sharedLen(p.rect, well.rect))[0];
    if (!host) return fail('corridor: well has no host');
    addDoor(well.ch, host.ch);
  }
  // preferred pairs that abut share a door (never into a single-door room)
  const byCh = new Map(draftRooms.map((r) => [r.ch, r]));
  for (const [a, b] of preferPairs(items, needs, arch)) {
    const ra = chOf.get(a), rb = chOf.get(b); if (!ra || !rb) continue;
    const A = byCh.get(ra)!, Bq = byCh.get(rb)!;
    if (A.single || Bq.single || pairs.has(pk(ra, rb)) || sharedLen(A.rect, Bq.rect) < DOOR_CELLS) continue;
    if (rng.chance(0.7)) addDoor(ra, rb);
  }
  const bends = shape === 'I' ? 0 : shape === 'L' ? 1 : 2;
  return { rooms: draftRooms, doors, entrance: ent.ch, source: 'corridor', bends, hub: new Set(corr.map((c) => c.ch)), notes: `bends=${bends} shape=${shape} cw=${cw}` };
}

// ---------------------------------------------------------------------------
// (c) RING / COURTYARD
// ---------------------------------------------------------------------------
export const TOWER = 3;
/** A castle may run a little past MAX_SIDE (towers and the gatehouse protrude); the grid holds 70. */
export const RING_MAX = MAX_SIDE + 4;
/** Curtain-wall square: the west and east wings run the full height (the corner towers hang off their end rooms),
 *  the north wing sits between them with the keep centred and protruding north, the sky courtyard fills the middle
 *  and meets the south curtain wall where the gatehouse protrudes. */
function ring(arch: Archetype, needs: PlanNeeds, items: Item[], rng: Rng): Draft | null {
  const corrKind = arch.roleMap.corridor?.[0] ?? 'corridor';
  const entrance = items.find((it) => it.entrance) ?? items[0];
  const hub = items.find((it) => it.hub && it !== entrance);
  const towerItems = items.filter((it) => it.tower && it !== entrance && it !== hub).slice(0, 4);
  const wing = items.filter((it) => it !== entrance && it !== hub && !towerItems.includes(it));
  const keep = wing.find((it) => it.boss) ?? wing.slice().sort((a, b) => b.mid - a.mid)[0];
  if (!keep) return fail('ring: no keep');
  const secret = wing.find((it) => it.secret && it !== keep);
  const rest = wing.filter((it) => it !== keep && it !== secret);
  const openItem = (it: Item) => !it.single && !it.secret;
  // secret room sits behind (beside, along the wing) its host: a chapel, else the open room whose wing has the most room
  const hostCands = secret ? (rest.some((it) => it.kind === 'chapel' && openItem(it)) ? rest.filter((it) => it.kind === 'chapel' && openItem(it)) : rest.filter((it) => openItem(it) && !it.service).length ? rest.filter((it) => openItem(it) && !it.service) : rest.filter(openItem)) : [];
  let host: Item | undefined;
  // wing depths, keep dims
  const bigSide = rest.length ? Math.max(...rest.map((it) => Math.sqrt(it.mid))) : 4;
  const wingD = () => Math.max(4, Math.min(6, Math.round(bigSide * (0.6 + rng.next() * 0.4))));
  const dn = wingD(), dw = wingD(), de = wingD();
  const kw = Math.max(Math.ceil(Math.sqrt(keep.lo)), Math.min(10, Math.round(Math.sqrt(keep.mid * (1 + rng.next() * 0.3)))));
  const dk = Math.max(kw, dn, Math.min(dn + 4, Math.round(keep.mid / kw) + rng.int(0, 1)));   // the keep protrudes ≤ 4 cells past the north wall
  // segments: NL, NR (north wing either side of the keep), W, E (full height); the segment that keeps the bailey squarest
  type Seg = 'NL' | 'NR' | 'W' | 'E';
  const seg: Record<Seg, Item[]> = { NL: [], NR: [], W: [], E: [] };
  const depthOf = (s: Seg) => (s === 'W' ? dw : s === 'E' ? de : dn);
  const lenOf = (it: Item, s: Seg) => Math.max(it.minW, Math.min(9, Math.round(it.mid / depthOf(s))));
  const demand = (s: Seg) => seg[s].reduce((a, it) => a + lenOf(it, s), 0);
  const courtW0 = Math.max(rng.int(7, 10), kw + 4);
  const extent = (s: Seg, add: number): number => {
    const nl = demand('NL') + (s === 'NL' ? add : 0), nr = demand('NR') + (s === 'NR' ? add : 0), w = demand('W') + (s === 'W' ? add : 0), e = demand('E') + (s === 'E' ? add : 0);
    return Math.max(dw + de + kw + 2 * Math.max(nl, nr, Math.ceil((courtW0 - kw) / 2)), Math.max(w, e, dn + 7));
  };
  const prefer = preferPairs(items, needs, arch);
  const placed = new Set<number>();
  const order = rng.shuffle(rest).sort((a, b) => b.mid - a.mid);
  const SEGS: Seg[] = ['NL', 'NR', 'W', 'E'];
  for (const it of order) {
    if (placed.has(it.idx)) continue;
    let best: Seg = SEGS[0], bestV = Infinity;
    for (const s of SEGS) { const v = extent(s, lenOf(it, s)) + seg[s].length * 0.01; if (v < bestV) { bestV = v; best = s; } }
    seg[best].push(it); placed.add(it.idx);
    // a preferred partner follows it in the same segment when that costs at most 2 cells
    const partner = prefer.filter(([a, b]) => a === it.idx || b === it.idx).map(([a, b]) => (a === it.idx ? b : a)).map((i) => rest.find((r) => r.idx === i)).find((r) => r && !placed.has(r.idx));
    if (partner) {
      const here = extent(best, lenOf(partner, best)); let elsewhere = Infinity; for (const s of SEGS) if (s !== best) elsewhere = Math.min(elsewhere, extent(s, lenOf(partner, s)));
      if (here <= elsewhere + 2) { seg[best].push(partner); placed.add(partner.idx); }
    }
  }
  if (secret) {
    let bestV = Infinity;
    for (const h of hostCands) { const s = SEGS.find((x) => seg[x].includes(h))!; const v = extent(s, lenOf(secret, s)); if (v < bestV) { bestV = v; host = h; } }
    if (host) { const s = SEGS.find((x) => seg[x].includes(host!))!; seg[s].splice(seg[s].indexOf(host) + 1, 0, secret); }
    else { let best: Seg = 'W', bv = Infinity; for (const s of SEGS) { const v = extent(s, lenOf(secret, s)); if (v < bv) { bv = v; best = s; } } seg[best].push(secret); }
  }
  // every segment holds a room: a gallery fills an empty one
  const fillers: Item[] = [];
  const filler = (): Item => { const f: Item = { idx: -1 - fillers.length, id: 'gallery' + fillers.length, kind: corrKind, lo: 12, hi: 16, mid: 14, tags: [], zoning: 'service', service: true, single: false, secret: false, sky: false, entrance: false, hub: false, boss: false, tower: false, minW: 3 }; fillers.push(f); return f; };
  for (const s of SEGS) if (!seg[s].length) seg[s].push(filler());
  for (const s of SEGS) { if (seg[s].length < 2) continue; const keepPair = host && secret && seg[s].includes(host); const list = rng.shuffle(seg[s].filter((it) => it !== secret)); if (keepPair) list.splice(list.indexOf(host!) + 1, 0, secret!); else if (seg[s].includes(secret!)) list.push(secret!); seg[s] = list; }
  // tower ends (both ends of W and E) must be open rooms: swap a single / secret room inward, else add a gallery
  const fixEnd = (s: Seg, atStart: boolean) => {
    const list = seg[s]; const endOf = () => (atStart ? 0 : list.length - 1);
    if (openItem(list[endOf()])) return;
    const otherEnd = atStart ? list.length - 1 : 0;
    const j = list.findIndex((it, i) => i !== endOf() && i !== otherEnd && openItem(it) && it !== host && it !== secret);
    if (j >= 0) {
      const endI = endOf(); const t = list[endI]; list[endI] = list[j]; list[j] = t;
      if (host && secret && list.includes(secret)) { list.splice(list.indexOf(secret), 1); list.splice(list.indexOf(host) + 1, 0, secret); }
    }
    if (openItem(list[endOf()])) return;
    const f = filler(); if (atStart) list.unshift(f); else list.push(f);
  };
  fixEnd('W', true); fixEnd('W', false); fixEnd('E', true); fixEnd('E', false);
  // lengths: north halves equal, side wings equal (they run the full height)
  const lens: Record<Seg, number[]> = { NL: seg.NL.map((it) => lenOf(it, 'NL')), NR: seg.NR.map((it) => lenOf(it, 'NR')), W: seg.W.map((it) => lenOf(it, 'W')), E: seg.E.map((it) => lenOf(it, 'E')) };
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const half = Math.max(sum(lens.NL), sum(lens.NR), Math.ceil((courtW0 - kw) / 2), 3) + rng.int(0, 2);
  const gdMax = 5;
  const Dz = Math.max(rng.int(7, 10) + dn, sum(lens.W), sum(lens.E), dn + kw, dn + 2 * TOWER + 1) + rng.int(0, 2);
  const S = dw + kw + 2 * half + de;
  if (S + 2 * TOWER > RING_MAX || (dk - dn) + Dz + gdMax > RING_MAX) return fail(`ring: bailey ${S}×${Dz}`);
  const fit = (s: Seg, L: number) => { let extra = L - sum(lens[s]); const idx = lens[s].map((_, i) => i).filter((i) => !seg[s][i].service && !seg[s][i].secret); const grow = idx.length ? idx : lens[s].map((_, i) => i); for (let k = rng.int(0, grow.length - 1); extra > 0; k = (k + 1) % grow.length, extra--) lens[s][grow[k]]++; };
  fit('NL', half); fit('NR', half); fit('W', Dz); fit('E', Dz);
  // --- cells (local; towers protrude at negative x / beyond S, the gatehouse below Dz, the keep above 0)
  const draftRooms: DRoom[] = []; let ci = 0;
  const chOf = new Map<number, string>();
  const put = (it: Item | undefined, kind: string, rect: PlanRect, tags: string[], role?: Role): DRoom => { const ch = CHARS[ci++]; const r: DRoom = { ch, kind, rect, need: it && it.idx >= 0 ? it.idx : undefined, role: it?.role ?? role, tags: it && it.idx >= 0 ? roomTags(it, tags) : it ? [...tags, 'filler', 'service'] : tags, sky: it?.sky, single: it?.single ?? false }; if (it) chOf.set(it.idx, ch); draftRooms.push(r); return r; };
  const cx0 = dw, cx1 = S - 1 - de, cz0 = dn, cz1 = Dz - 1;
  const courtKind = hub?.kind ?? (arch.roleMap.hub?.find((k) => arch.kinds[k]?.ceil === null) ?? 'courtyard');
  const court = put(hub, courtKind, { x0: cx0, z0: cz0, x1: cx1, z1: cz1 }, hub ? ['hub'] : ['hub', 'sky'], 'hub'); court.sky = true;
  const gw = Math.max(3, Math.min(5, Math.round(Math.sqrt(entrance.mid)))), gd = Math.max(3, Math.min(gdMax, Math.round(entrance.mid / gw)));
  const gx0 = cx0 + Math.floor((cx1 - cx0 + 1 - gw) / 2);
  const gate = put(entrance, entrance.kind, { x0: gx0, z0: Dz, x1: gx0 + gw - 1, z1: Dz + gd - 1 }, ['entrance']);
  const placedRooms = new Map<Item, DRoom>();
  let x = cx0; seg.NL.forEach((it, i) => { placedRooms.set(it, put(it, it.kind, { x0: x, z0: 0, x1: x + lens.NL[i] - 1, z1: dn - 1 }, [])); x += lens.NL[i]; });
  const keepRoom = put(keep, keep.kind, { x0: x, z0: dn - dk, x1: x + kw - 1, z1: dn - 1 }, ['boss']); x += kw;
  seg.NR.forEach((it, i) => { placedRooms.set(it, put(it, it.kind, { x0: x, z0: 0, x1: x + lens.NR[i] - 1, z1: dn - 1 }, [])); x += lens.NR[i]; });
  let z = 0; seg.W.forEach((it, i) => { placedRooms.set(it, put(it, it.kind, { x0: 0, z0: z, x1: dw - 1, z1: z + lens.W[i] - 1 }, [])); z += lens.W[i]; });
  z = 0; seg.E.forEach((it, i) => { placedRooms.set(it, put(it, it.kind, { x0: S - de, z0: z, x1: S - 1, z1: z + lens.E[i] - 1 }, [])); z += lens.E[i]; });
  const towerKind = arch.kinds['tower'] ? 'tower' : corrKind;
  const corners: { rect: PlanRect; end: DRoom }[] = [
    { rect: { x0: -TOWER, z0: 0, x1: -1, z1: TOWER - 1 }, end: placedRooms.get(seg.W[0])! },
    { rect: { x0: S, z0: 0, x1: S + TOWER - 1, z1: TOWER - 1 }, end: placedRooms.get(seg.E[0])! },
    { rect: { x0: -TOWER, z0: Dz - TOWER, x1: -1, z1: Dz - 1 }, end: placedRooms.get(seg.W[seg.W.length - 1])! },
    { rect: { x0: S, z0: Dz - TOWER, x1: S + TOWER - 1, z1: Dz - 1 }, end: placedRooms.get(seg.E[seg.E.length - 1])! },
  ];
  const towers = corners.map((c, i) => { const it = towerItems[i]; return { room: put(it, it?.kind ?? towerKind, c.rect, ['tower'], it ? undefined : 'plain'), end: c.end }; });
  for (let i = 0; i < draftRooms.length; i++) for (let j = i + 1; j < draftRooms.length; j++) if (overlaps(draftRooms[i].rect, draftRooms[j].rect)) return fail('ring: overlap ' + draftRooms[i].kind + '/' + draftRooms[j].kind);

  // --- doors: gatehouse → courtyard; wing rooms → courtyard; keep → courtyard (or the great hall beside it); towers → wing ends; secret ← host
  const doors: DDoor[] = []; const pairs = new Set<string>();
  const pk = (a: string, b: string) => (a < b ? a + b : b + a);
  const byCh = new Map(draftRooms.map((r) => [r.ch, r]));
  const addDoor = (a: string, b: string, flags: Partial<DDoor> = {}): boolean => { const k = pk(a, b); if (pairs.has(k)) return false; if (sharedLen(byCh.get(a)!.rect, byCh.get(b)!.rect) < DOOR_CELLS) return false; pairs.add(k); doors.push({ a, b, ...flags }); return true; };
  if (!addDoor(gate.ch, court.ch)) return fail('ring: gate door');
  for (const [it, r] of placedRooms) {
    if (it === secret) { if (!host || !addDoor(r.ch, placedRooms.get(host)!.ch, { secret: true })) return fail('ring: secret door'); continue; }
    if (addDoor(r.ch, court.ch)) continue;
    // a side-wing room beside the north wing (above the courtyard) opens on the north room it abuts, else on its wing neighbour
    const nb = [...placedRooms.values()].filter((o) => o !== r && !o.single && !o.tags.includes('secret') && sharedLen(o.rect, r.rect) >= DOOR_CELLS).sort((p, q) => sharedLen(q.rect, r.rect) - sharedLen(p.rect, r.rect))[0];
    if (!nb || !addDoor(r.ch, nb.ch)) return fail('ring: no door for ' + it.kind);
  }
  const hall = rest.find((it) => it.kind === 'great_hall' && openItem(it));
  const hallRoom = hall ? placedRooms.get(hall) : undefined;
  if (hallRoom && sharedLen(hallRoom.rect, keepRoom.rect) >= DOOR_CELLS && rng.chance(0.6)) addDoor(keepRoom.ch, hallRoom.ch);
  else if (!addDoor(keepRoom.ch, court.ch)) return fail('ring: keep door');
  for (const t of towers) { if (t.end.single) return fail("ring: tower on a single-door room"); if (!addDoor(t.room.ch, t.end.ch)) return fail('ring: tower door'); }
  for (const [a, b] of prefer) {
    const ra = chOf.get(a), rb = chOf.get(b); if (!ra || !rb) continue;
    const A = byCh.get(ra)!, Bq = byCh.get(rb)!;
    if (A.single || Bq.single || pairs.has(pk(ra, rb)) || sharedLen(A.rect, Bq.rect) < DOOR_CELLS) continue;
    if (rng.chance(0.6)) addDoor(ra, rb);
  }
  return { rooms: draftRooms, doors, entrance: gate.ch, source: 'ring', bends: 0, hub: new Set([court.ch]), notes: 'bends=0 ring' };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
export function methodFor(arch: Archetype, needs?: PlanNeeds): PlanMethod {
  if (needs?.method) return needs.method;
  if (arch.layout === 'castle' || arch.id === 'castle') return 'ring';
  if (arch.id === 'house' || arch.id === 'haunted' || arch.id === 'shop') return 'growth';
  return 'corridor';
}

/** `n` candidate plans for the needs (each validated by checkPlan); candidates that fail their own invariants are
 *  regenerated from the next sub-seed, so a non-empty list comes back whenever the needs are satisfiable at all. */
export function generatePlan(arch: Archetype, needs: PlanNeeds, seed: number, n = 24): FloorPlan[] {
  const base = itemsOf(needs, arch);
  const method = methodFor(arch, needs);
  const gen = method === 'ring' ? ring : method === 'growth' ? growth : corridor;
  const out: FloorPlan[] = [];
  for (let i = 0, tries = 0; out.length < n && tries < n * 3; tries++) {
    const rng = sub(seed, 'plangen', method, tries);
    // every candidate draws its own target area per room inside the need's range — the main source of variety
    const items = base.map((it) => ({ ...it, mid: rng.int(it.lo, it.hi) }));
    let draft = gen(arch, needs, items, rng);
    // the growth method falls back to a corridor plan for needs it cannot seed (many rooms, tiny footprint)
    if (!draft && method === 'growth' && tries >= n * 2) draft = corridor(arch, needs, items, sub(seed, 'plangen', 'corridor', tries));
    if (!draft) continue;
    draft.mirrorX = rng.chance(0.5);
    const plan = toFloorPlan(draft, arch, `${arch.id}:${seed}:${i}`);
    if (checkPlan(plan).length) continue;
    out.push(plan); i++;
  }
  return out;
}

/** The candidates sorted best-first (stable on index for ties). With a `seed`, a seeded jitter below `jitter` points
 *  breaks ties between near-equal candidates so the same needs on neighbouring seeds do not always pick the same plan. */
export function rankPlans(cands: FloorPlan[], score: PlanScore, seed?: number, jitter = 4): FloorPlan[] {
  const j = seed === undefined ? undefined : sub(seed, 'pick');
  return cands.map((p, i) => ({ p, i, s: score(p) + (j ? j.next() * jitter : 0) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
}
/** The best candidate (see rankPlans for `seed`). */
export function pickPlan(cands: FloorPlan[], score: PlanScore, seed?: number): FloorPlan | undefined {
  return rankPlans(cands, score, seed)[0];
}
