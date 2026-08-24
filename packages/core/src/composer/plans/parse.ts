// src/engine/composer/plans/parse.ts — FloorPlan (ASCII rows + door strings) → ParsedPlan.
// Rooms are rectangles of one char; doors sit centred on the shared boundary segment of the two
// rooms they name; exactly one exterior entrance. parsePlan THROWS on a malformed plan (the char
// and the offending cell are in the message); validatePlan returns the soft problems as strings.
// Plan-only: integer cells, no trig, no Math.random, no DOM.
import type { FloorPlan, ParsedPlan, PlanDoor, PlanRect } from './types';
import type { Rng } from '../rng';

export class PlanError extends Error { constructor(msg: string, readonly planId?: string) { super((planId ? `plan ${planId}: ` : '') + msg); } }

/** A maximal shared boundary between two cell rects: the wall LINE (cell-line coordinate) and the
 *  inclusive cell range along it. `along: 'z'` = the wall is an x = line column (opening runs along z). */
export interface Segment { along: 'x' | 'z'; line: number; lo: number; hi: number }
export const segLen = (s: Segment): number => s.hi - s.lo + 1;

/** The one segment two abutting rectangles share (rectangles touch on at most one side), else null. */
export function sharedSegment(a: PlanRect, b: PlanRect): Segment | null {
  if (a.x1 + 1 === b.x0 || b.x1 + 1 === a.x0) {
    const lo = Math.max(a.z0, b.z0), hi = Math.min(a.z1, b.z1);
    if (hi >= lo) return { along: 'z', line: a.x1 + 1 === b.x0 ? b.x0 : a.x0, lo, hi };
  }
  if (a.z1 + 1 === b.z0 || b.z1 + 1 === a.z0) {
    const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1);
    if (hi >= lo) return { along: 'x', line: a.z1 + 1 === b.z0 ? b.z0 : a.z0, lo, hi };
  }
  return null;
}

/** Stable identity of a door (locks / secrets refer to doors by this). */
export const doorKey = (d: PlanDoor): string => `${d.a}-${d.b}@${d.x},${d.z}`;

/** Door-centre line coordinate for a 2-cell opening inside [lo, hi]: slot n (1-based, from lo) or centred. */
function doorCentre(lo: number, hi: number, slot?: number): number {
  const L = hi - lo + 1;
  const start = slot ? lo + (slot - 1) * 2 : lo + Math.floor((L - 2) / 2);
  if (start + 1 > hi) throw new PlanError(`door slot @${slot} is off the end of a ${L}-cell boundary`);
  return start + 1;
}

const charAt = (rows: string[], x: number, z: number): string => (z >= 0 && z < rows.length && x >= 0 && x < rows[z].length ? rows[z][x] : '.');

export function parsePlan(plan: FloorPlan): ParsedPlan {
  const rows = plan.rows;
  const d = rows.length, w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (!d || !w) throw new PlanError('empty rows', plan.id);
  // --- rooms: bbox per char; rectangular ⇔ every bbox cell is that char ------------------------
  const box: Record<string, PlanRect> = {};
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const c = charAt(rows, x, z); if (c === '.') continue;
    if (/\s/.test(c)) throw new PlanError(`whitespace at cell (${x},${z})`, plan.id);
    const b = box[c];
    if (!b) box[c] = { x0: x, z0: z, x1: x, z1: z };
    else { b.x0 = Math.min(b.x0, x); b.z0 = Math.min(b.z0, z); b.x1 = Math.max(b.x1, x); b.z1 = Math.max(b.z1, z); }
  }
  const rects: Record<string, PlanRect> = {};
  for (const c of Object.keys(box).sort()) {
    const b = box[c];
    for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) if (charAt(rows, x, z) !== c) throw new PlanError(`room '${c}' is not a rectangle: cell (${x},${z}) is '${charAt(rows, x, z)}'`, plan.id);
    if (!plan.rooms[c]) throw new PlanError(`room '${c}' drawn but not declared in rooms`, plan.id);
    rects[c] = b;
  }
  for (const c of Object.keys(plan.rooms)) if (!rects[c]) throw new PlanError(`room '${c}' declared but not drawn`, plan.id);
  if (!rects[plan.entrance]) throw new PlanError(`entrance '${plan.entrance}' is not a room`, plan.id);

  // --- doors ----------------------------------------------------------------------------------
  const doors: PlanDoor[] = [];
  const seen = new Set<string>();
  let exterior = 0;
  for (const s of plan.doors) {
    const m = /^(\S)(?:(>)|-(\S)([!~])?(?:@(\d+))?)$/.exec(s.trim());
    if (!m) throw new PlanError(`bad door '${s}'`, plan.id);
    const a = m[1]; if (!rects[a]) throw new PlanError(`door '${s}' names unknown room '${a}'`, plan.id);
    if (m[2]) {
      if (a !== plan.entrance) throw new PlanError(`exterior entrance '${s}' is not on the entrance room '${plan.entrance}'`, plan.id);
      if (++exterior > 1) throw new PlanError(`more than one exterior entrance ('${s}')`, plan.id);
      doors.push(exteriorDoor(rows, rects[a], a, plan.id));
      continue;
    }
    const b = m[3]; if (!rects[b]) throw new PlanError(`door '${s}' names unknown room '${b}'`, plan.id);
    if (a === b) throw new PlanError(`door '${s}' joins a room to itself`, plan.id);
    const seg = sharedSegment(rects[a], rects[b]);
    if (!seg || segLen(seg) < 2) throw new PlanError(`door '${s}': rooms '${a}' and '${b}' do not share ≥ 2 cells of wall`, plan.id);
    const open = m[4] === '~', secret = m[4] === '!';
    const slot = m[5] ? Number(m[5]) : undefined;
    let c: number;
    try { c = open ? seg.lo + segLen(seg) / 2 : doorCentre(seg.lo, seg.hi, slot); } catch (e) { throw new PlanError(`door '${s}': ${(e as Error).message}`, plan.id); }
    const door: PlanDoor = seg.along === 'z' ? { a, b, x: seg.line, z: c, along: 'z' } : { a, b, x: c, z: seg.line, along: 'x' };
    if (secret) door.secret = true; if (open) door.open = true;
    const k = doorKey(door); if (seen.has(k)) throw new PlanError(`duplicate door '${s}'`, plan.id); seen.add(k);
    doors.push(door);
  }
  if (exterior !== 1) throw new PlanError(`expected exactly one exterior entrance ('${plan.entrance}>'), found ${exterior}`, plan.id);

  // --- adjacency (solid doors + open joins; never the exterior) ---------------------------------
  const adjacency: Record<string, string[]> = {};
  for (const c of Object.keys(rects)) adjacency[c] = [];
  for (const dd of doors) if (!dd.exterior) { if (!adjacency[dd.a].includes(dd.b)) adjacency[dd.a].push(dd.b); if (!adjacency[dd.b].includes(dd.a)) adjacency[dd.b].push(dd.a); }
  for (const c of Object.keys(adjacency)) adjacency[c].sort();
  return { plan, w, d, rects, doors, adjacency };
}

/** The entrance: centred on the room's longest run of exterior wall (sides tried south, north, west, east). */
function exteriorDoor(rows: string[], r: PlanRect, a: string, id: string): PlanDoor {
  let best: { along: 'x' | 'z'; line: number; lo: number; hi: number } | null = null;
  const consider = (along: 'x' | 'z', line: number, lo: number, hi: number, outside: (t: number) => boolean) => {
    let s = lo;
    while (s <= hi) {
      if (!outside(s)) { s++; continue; }
      let t = s; while (t + 1 <= hi && outside(t + 1)) t++;
      if (!best || t - s > best.hi - best.lo) best = { along, line, lo: s, hi: t };
      s = t + 1;
    }
  };
  consider('x', r.z1 + 1, r.x0, r.x1, (x) => charAt(rows, x, r.z1 + 1) === '.');
  consider('x', r.z0, r.x0, r.x1, (x) => charAt(rows, x, r.z0 - 1) === '.');
  consider('z', r.x0, r.z0, r.z1, (z) => charAt(rows, r.x0 - 1, z) === '.');
  consider('z', r.x1 + 1, r.z0, r.z1, (z) => charAt(rows, r.x1 + 1, z) === '.');
  const b = best as { along: 'x' | 'z'; line: number; lo: number; hi: number } | null;
  if (!b || b.hi - b.lo + 1 < 2) throw new PlanError(`entrance room '${a}' has no ≥ 2-cell wall on the outside`, id);
  const c = doorCentre(b.lo, b.hi);
  return b.along === 'z' ? { a, b: '.', x: b.line, z: c, along: 'z', exterior: true } : { a, b: '.', x: c, z: b.line, along: 'x', exterior: true };
}

/** Which side of its room an exterior door sits on, as the inward (dx, dz) unit step. */
export function inwardOf(d: PlanDoor, r: PlanRect): [number, number] {
  if (d.along === 'z') return [d.x === r.x0 ? 1 : -1, 0];
  return [0, d.z === r.z0 ? 1 : -1];
}

/** Kinds that must be ≥ 3 cells wide on their short side. */
const WIDE_KINDS = new Set(['corridor', 'hall', 'hallway', 'concourse', 'gallery', 'nave']);
const MIN_ROOM = 3;

/** Soft checks — [] means fine. */
export function validatePlan(p: ParsedPlan): string[] {
  const out: string[] = [];
  const chars = Object.keys(p.rects);
  for (const c of chars) {
    const r = p.rects[c]; const sw = r.x1 - r.x0 + 1, sd = r.z1 - r.z0 + 1, side = Math.min(sw, sd);
    if (side < MIN_ROOM) out.push(`room '${c}' is ${sw}×${sd}, under ${MIN_ROOM}×${MIN_ROOM}`);
    if (WIDE_KINDS.has(p.plan.rooms[c].kind) && side < 3) out.push(`${p.plan.rooms[c].kind} '${c}' is only ${side} wide`);
  }
  // reachability from the entrance over doors + open joins
  const seen = new Set([p.plan.entrance]); const q = [p.plan.entrance];
  while (q.length) { const c = q.shift()!; for (const n of p.adjacency[c]) if (!seen.has(n)) { seen.add(n); q.push(n); } }
  for (const c of chars) if (!seen.has(c)) out.push(`room '${c}' unreachable from the entrance`);
  // enclosed '.' holes: outside cells not reachable from the border
  const rows = p.plan.rows; const out4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const key = (x: number, z: number) => z * (p.w + 2) + x; const ext = new Set<number>(); const q2: [number, number][] = [];
  const push = (x: number, z: number) => { if (x < -1 || z < -1 || x > p.w || z > p.d) return; if (charAt(rows, x, z) !== '.') return; const k = key(x + 1, z + 1); if (ext.has(k)) return; ext.add(k); q2.push([x, z]); };
  push(-1, -1);
  while (q2.length) { const [x, z] = q2.shift()!; for (const [dx, dz] of out4) push(x + dx, z + dz); }
  for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) if (charAt(rows, x, z) === '.' && !ext.has(key(x + 1, z + 1))) { out.push(`enclosed hole at (${x},${z})`); z = p.d; break; }
  return out;
}

/** parsePlan + validatePlan; throws PlanError when either objects. */
export function parseAndValidate(plan: FloorPlan): ParsedPlan {
  const p = parsePlan(plan);
  const probs = validatePlan(p);
  if (probs.length) throw new PlanError(probs.join('; '), plan.id);
  return p;
}

/** Seeded variants: mirror / rotate the rows (doors are names, they survive) and swap kinds. Returns a new plan. */
export function applyVariants(plan: FloorPlan, rng: Rng): FloorPlan {
  const v = plan.variants; if (!v) return plan;
  const w = plan.rows.reduce((m, r) => Math.max(m, r.length), 0);
  let rows = plan.rows.map((r) => r.padEnd(w, '.'));
  if (v.mirrorX && rng.chance(0.5)) rows = rows.map((r) => r.split('').reverse().join(''));
  if (v.mirrorZ && rng.chance(0.5)) rows = rows.slice().reverse();
  if (v.rotate && rng.chance(0.5)) {
    // 90° clockwise: new row j = old column j read from the bottom up
    const d = rows.length; const out: string[] = [];
    for (let x = 0; x < w; x++) { let s = ''; for (let z = d - 1; z >= 0; z--) s += rows[z][x]; out.push(s); }
    rows = out;
  }
  const rooms: FloorPlan['rooms'] = {};
  for (const c of Object.keys(plan.rooms)) {
    const pool = v.swapKinds?.[c];
    rooms[c] = pool && pool.length ? { ...plan.rooms[c], kind: rng.pick(pool) } : { ...plan.rooms[c] };
  }
  return { ...plan, rows, rooms };
}
