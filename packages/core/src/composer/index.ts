// src/engine/composer/index.ts — the DRIVER (design §4.1) and finalize (§4.6).
// compose(seed, arch, reqs, tier): an 8-step re-seed ladder over mission → embed (plan-first: choosePlan →
// parsePlan → applyVariants → mapMission → planToLayout) → typeAndName → furnish → validate → repair, then the
// always-valid fallback (linearMission + anchorsOnly) which still goes through validate; ComposerInvariant only
// when even that fails. SINGLE STOREY: every zone is on floor 0. Plan-only: no three.js, no DOM, no Math.random,
// no trig — everything derives from the seed.
import type {
  AABB, Archetype, EmbeddedLayout, FurnishResult, Layout, MissionGraph, PlaceReq, Placement, Problem, Role, SemanticMap, Spot, Tier, Zone,
} from './types';
import { CELL, GRID, ComposerInvariant, cellKey, isPassageZone } from './types';
import { buildMission, linearMission } from './mission';
import { embedSpine } from './embedSpine';
import { embedGrid } from './embedGrid';
import { embedPlan } from './plans/embedPlan';
import { typeAndName } from './typeAndName';
import { furnish } from './furnish';
import { validate } from './validate';
import type { StoryBrief } from './story';
import '../props/index';                                  // registers every prop family (furnish reads the library)

export type { SemanticMap, Problem } from './types';
export { validate } from './validate';
export { ARCHETYPES, archetypeIds, archetypeOf } from './archetypes/index';

/** compose() plus the intermediate stages a test or dev tool wants to inspect. */
export interface ComposeResult { map: SemanticMap; graph: MissionGraph; layout: EmbeddedLayout; problems: Problem[]; attempts: number; log: string[] }

type Embedder = (g: MissionGraph, seed: number, arch: Archetype) => EmbeddedLayout | null;
const EMBED: Partial<Record<Layout, Embedder>> = {
  // FloorPlan-first: authored + generated plans with shared walls (plans/embedPlan — choosePlan → parse → variants →
  // mapMission → planToLayout). Legacy spine / graph-grid stay for archetypes that still declare them.
  plan: embedPlan, spine: embedSpine, 'graph-grid': embedGrid,
};
const embedderFor = (arch: Archetype): Embedder => {
  const e = EMBED[arch.layout];
  if (!e) throw new Error(`composer: layout '${arch.layout}' (archetype '${arch.id}') is not yet implemented — only spine and graph-grid embed`);
  return e;
};

const MAX_LIGHTS = 6, MAX_LANDMARKS = 24;
const nextSeed = (s: number): number => (Math.imul(s, 9301) + 49297) >>> 0;
const fatal = (ps: Problem[]): Problem[] => ps.filter((p) => p.fatal);

/** `brief` (story.ts) is optional: without it the plan is byte-identical to before the story lanes existed. */
export function compose(seed: number, arch: Archetype, reqs: PlaceReq[] = [], tier: Tier = 'easy', brief?: StoryBrief): SemanticMap {
  return composeDetailed(seed, arch, reqs, tier, brief).map;
}

/** zone id → the PlaceReqs the mission bound there (what the dressing / people hooks read). */
function reqZonesOf(layout: EmbeddedLayout, g: MissionGraph): Record<string, PlaceReq[]> {
  const out: Record<string, PlaceReq[]> = {};
  for (const n of g.nodes) { if (!n.req) continue; const zid = n.zoneId ?? layout.nodeZone[n.id]; if (zid) (out[zid] ??= []).push(n.req); }
  return out;
}

export function composeDetailed(seed: number, arch: Archetype, reqs: PlaceReq[] = [], tier: Tier = 'easy', brief?: StoryBrief): ComposeResult {
  const embed = embedderFor(arch);
  let attempts = 0; const log: string[] = [];
  for (let s = seed, i = 0; i < 8; i++, s = nextSeed(s)) {
    attempts++;
    const g = buildMission(s, arch, reqs, tier); if (!g) { log.push(`#${i} mission: pacing rejected`); continue; }   // pacing asserts may reject
    const layout = embed(g, s, arch); if (!layout) { log.push(`#${i} embed: null`); continue; }
    const aliases = typeAndName(layout, g, arch, s, reqs);
    const fr = furnish(layout, arch, s, brief ? { brief, reqZones: reqZonesOf(layout, g) } : {});
    const map = assemble(layout, fr, g, arch, aliases, seed, false);
    let probs = validate(map, g, arch);
    if (fatal(probs).length && repair(map, probs)) probs = validate(map, g, arch);
    if (!fatal(probs).length) return { map: finalize(map, layout, g, arch), graph: g, layout, problems: probs, attempts, log };
    for (const p of fatal(probs)) log.push(`#${i} ${p.check}: ${p.msg}`);
  }
  // Fallback: entrance→hall→fight→landing→locked→rest→boss (+ every request bound) — furnished anchorsOnly, still validated.
  let last: Problem[] = [{ check: 'fallback', msg: 'no embedding for the linear mission', fatal: true }];
  for (let s = seed, i = 0; i < 8; i++, s = nextSeed(s)) {
    attempts++;
    const g = linearMission(s, arch, reqs);
    const layout = embed(g, s, arch); if (!layout) continue;
    const aliases = typeAndName(layout, g, arch, s, reqs);
    const fr = furnish(layout, arch, s, brief ? { anchorsOnly: true, brief, reqZones: reqZonesOf(layout, g) } : { anchorsOnly: true });
    const map = assemble(layout, fr, g, arch, aliases, seed, true);
    let probs = validate(map, g, arch);
    if (fatal(probs).length && repair(map, probs)) probs = validate(map, g, arch);
    if (!fatal(probs).length) return { map: finalize(map, layout, g, arch), graph: g, layout, problems: probs, attempts, log };
    for (const p of fatal(probs)) log.push(`fallback#${i} ${p.check}: ${p.msg}`);
    last = probs;
  }
  throw new ComposerInvariant(fatal(last));
}

// ---------------------------------------------------------------------------
// assemble: layout + furnish result → a SemanticMap (pre-finalize; validate reads this)
// ---------------------------------------------------------------------------
function assemble(layout: EmbeddedLayout, fr: FurnishResult, g: MissionGraph, arch: Archetype, aliases: Record<string, string>, seed: number, fallback: boolean): SemanticMap {
  const colliders: AABB[] = layout.colliders.concat(fr.colliders);
  let ci = 0; for (const p of fr.placements) if (p.collide) PROP_COLLIDER.set(p, fr.colliders[ci++]);
  const zoneOf = (id: string): Zone | undefined => layout.zones.find((z) => z.id === id);
  // keys: furnish places the pedestal; the mission graph says what each key opens
  const keys: SemanticMap['keys'] = fr.keys.map((k) => ({ ...k, opens: '' }));   // furnish only guesses `opens`; the graph knows
  for (const k of g.keys) {
    const zid = layout.nodeZone[k.node]; if (!zid) continue;
    const have = keys.find((x) => x.zone === zid && (x.opens === '' || x.opens === k.opens));
    if (have) { have.opens = k.opens; have.item = k.item || have.item; continue; }
    const z = zoneOf(zid); if (!z) continue;
    const spot: Spot = z.spots.loot[0] ?? z.spots.npc[0] ?? z.spots.center;
    keys.push({ id: zid + ':' + k.id, item: k.item || arch.lockKit.key, spot: { ...spot }, opens: k.opens, zone: zid });
  }
  // a pedestal no lock asked for carries no key; a key must open a Door.lock id (the renderer unlocks by that id)
  const lockIds = new Set(layout.doors.filter((d) => d.lock).map((d) => d.lock!));
  for (let i = keys.length - 1; i >= 0; i--) if (!keys[i].opens || !lockIds.has(keys[i].opens)) keys.splice(i, 1);
  const byRole: Partial<Record<Role, string[]>> = {};
  for (const z of layout.zones) (byRole[z.role] ??= []).push(z.id);
  const criticalPath = g.criticalPath.map((id) => layout.nodeZone[id]).filter((x): x is string => !!x);
  return {
    archetype: arch.id, seed, style: arch.style, worldType: arch.worldType,
    zones: layout.zones, doors: layout.doors, placements: fr.placements, colliders, walls: layout.walls,
    colliderCells: new Map(), lights: fr.lights.slice(), keys, people: fr.people,
    start: layout.start, exit: layout.exit, ceilingY: undefined,
    criticalPath, weenieZone: '', landmarks: [], aliases, byRole, fallback,
  };
}

// ---------------------------------------------------------------------------
// repair: drop clutter in offending zones / globally; anything structural re-seeds
// ---------------------------------------------------------------------------
const DROPPABLE = new Set(['clutter', 'surface', 'wall']);
/** Blocking placement → its collider (furnish emits both in the same order). */
const PROP_COLLIDER = new WeakMap<Placement, AABB>();
function dropDecor(map: SemanticMap, zone?: string): boolean {
  const before = map.placements.length;
  const gone = new Set<AABB>();
  map.placements = map.placements.filter((p) => { const drop = DROPPABLE.has(p.role) && (!zone || p.zone === zone); if (drop) { const c = PROP_COLLIDER.get(p); if (c) gone.add(c); } return !drop; });
  if (gone.size) map.colliders = map.colliders.filter((c) => !gone.has(c));
  return map.placements.length !== before;
}
function repair(map: SemanticMap, probs: Problem[]): boolean {
  let changed = false;
  for (const p of probs) {
    if (!p.fatal) continue;
    if ((p.check === 'standable' || p.check === 'spawnSafe') && p.zone) changed = dropDecor(map, p.zone) || changed;
    else if (p.check === 'caps' && /placements/.test(p.msg)) changed = dropDecor(map) || changed;
    else return false;                                   // connectivity / locks / adjacency / pacing → re-seed
  }
  return changed;
}

// ---------------------------------------------------------------------------
// finalize (§4.6)
// ---------------------------------------------------------------------------
function finalize(map: SemanticMap, layout: EmbeddedLayout, g: MissionGraph, arch: Archetype): SemanticMap {
  const zones = map.zones;
  const byId = new Map(zones.map((z) => [z.id, z]));
  const entrance = zones.find((z) => z.role === 'entrance') ?? zones[0];
  map.ceilingY = entrance?.ceilY;
  map.weenieZone = weenieZone(map, arch);
  // lights: ≤ 6 by priority (stable on insertion order)
  map.lights = map.lights.map((l, i) => [l, i] as const).sort((a, b) => b[0].priority - a[0].priority || a[1] - b[1]).slice(0, MAX_LIGHTS).map(([l]) => l);
  // landmarks: zone centres (2), then key / chest / npc / vantage spots (1); cap 24, place (req) landmarks exempt
  const reqZones = new Set(g.nodes.filter((n) => n.req && n.zoneId).map((n) => n.zoneId!));
  const lm: SemanticMap['landmarks'] = [];
  for (const z of zones) if (z.role !== 'corridor') lm.push({ x: z.spots.center.x, z: z.spots.center.z, kind: z.kind, zone: z.id, priority: 2 });
  for (const k of map.keys) lm.push({ x: k.spot.x, z: k.spot.z, kind: 'key', zone: k.zone, priority: 1 });
  for (const z of zones) {
    if (z.spots.loot[0]) lm.push({ x: z.spots.loot[0].x, z: z.spots.loot[0].z, kind: 'chest', zone: z.id, priority: 1 });
    if (z.spots.npc[0] && z.role === 'npc') lm.push({ x: z.spots.npc[0].x, z: z.spots.npc[0].z, kind: 'npc', zone: z.id, priority: 1 });
    if (z.spots.vantage) lm.push({ x: z.spots.vantage.x, z: z.spots.vantage.z, kind: 'vantage', zone: z.id, priority: 1 });
  }
  const exempt = (l: SemanticMap['landmarks'][number]) => l.priority === 2 && reqZones.has(l.zone);
  while (lm.length > MAX_LANDMARKS) {
    let victim = -1;
    for (let i = lm.length - 1; i >= 0; i--) if (!exempt(lm[i]) && (victim < 0 || lm[i].priority < lm[victim].priority)) victim = i;
    if (victim < 0) break;
    lm.splice(victim, 1);
  }
  map.landmarks = lm;
  // colliderCells: cellKey(floor, cx, cz) → collider indices
  const cc = new Map<number, number[]>();
  const cellOf = (u: number): number => Math.floor(u / CELL + GRID / 2);
  map.colliders.forEach((c, i) => {
    const x0 = cellOf(c.x0 + 1e-6), x1 = cellOf(c.x1 - 1e-6), z0 = cellOf(c.z0 + 1e-6), z1 = cellOf(c.z1 - 1e-6);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const k = cellKey(c.floor, x, z); const l = cc.get(k); if (l) l.push(i); else cc.set(k, [i]); }
  });
  map.colliderCells = cc;
  // criticalPath in zone ids (dedupe consecutive repeats from oneBigRoom spines)
  map.criticalPath = map.criticalPath.filter((id, i, a) => byId.has(id) && a[i - 1] !== id);
  if (!map.exit) { const last = byId.get(map.criticalPath[map.criticalPath.length - 1]); if (last) map.exit = { ...last.spots.center }; }
  return map;
}

/** Roles a topological weenie may land on: the keep, the hall, the arena — not the cells, the closet or a corridor. */
const WEENIE_ROLES = new Set<Role>(['boss', 'hub', 'lock', 'combat', 'elite', 'plain', 'treasure', 'exit', 'finish', 'puzzle', 'work']);
/** Topological weenie (§4.6): the first open-sky zone adjacent to the entrance, then the zone on its long axis; else the boss zone. */
function weenieZone(map: SemanticMap, arch: Archetype): string {
  const zones = map.zones;
  const byRole = (r: Role): Zone | undefined => zones.find((z) => z.role === r);
  const entrance = byRole('entrance');
  // a prop weenie (shop sign, steeple) sits over the centre of the place: boss, else hub, else the entrance room
  if (typeof arch.weenie === 'string') return (byRole('boss') ?? byRole('hub') ?? entrance ?? zones[0])?.id ?? '';
  // A weenie is a DESTINATION you can see and walk to, so every candidate here is filtered the same way the
  // ray-cast below filters: a passage never qualifies. (An 'exit' or 'hub' role often lands on the corridor —
  // house.suburban tags its 15×3 hallway 'exit' — and picking it aimed the player down a hallway at nothing.)
  const destination = (z: Zone | undefined): Zone | undefined => (z && !isPassageZone(z, arch) ? z : undefined);
  const boss = destination(byRole('boss')) ?? destination(byRole('finish')) ?? destination(byRole('exit'))
    ?? destination(byRole('hub')) ?? [...zones].reverse().find((z) => !isPassageZone(z, arch)) ?? zones[zones.length - 1];
  if (!entrance) return boss?.id ?? '';
  const adj = (a: Zone): Zone[] => map.doors.filter((d) => d.between.includes(a.id)).map((d) => zones.find((z) => z.id === (d.between[0] === a.id ? d.between[1] : d.between[0]))!).filter(Boolean);
  const court = adj(entrance).find((z) => z.ceilY === undefined);
  if (court) {
    const r = court.rect, w = r.x1 - r.x0, d = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, ex = entrance.spots.center.x, ez = entrance.spots.center.z;
    // continue the axis of approach away from the entrance (the longer axis when the entrance sits on a corner); the first zone whose rect the ray enters
    const ax = Math.abs(cx - ex), az = Math.abs(cz - ez);
    const alongX = ax === az ? w >= d : ax > az;
    const [dx, dz] = alongX ? [cx >= ex ? 1 : -1, 0] : [0, cz >= ez ? 1 : -1];
    let best: Zone | undefined, bestT = Infinity;
    for (const z of zones) {
      if (z === court || z === entrance || !WEENIE_ROLES.has(z.role) || isPassageZone(z, arch)) continue;   // a weenie is a destination room, never a passage or a side closet
      const zr = z.rect;
      const t = dx ? (dx > 0 ? zr.x0 - cx : cx - zr.x1) : (dz > 0 ? zr.z0 - cz : cz - zr.z1);
      const inLane = dx ? cz >= zr.z0 && cz <= zr.z1 : cx >= zr.x0 && cx <= zr.x1;
      if (t >= 0 && inLane && t < bestT) { bestT = t; best = z; }
    }
    if (best) return best.id;
  }
  return boss?.id ?? '';
}

// ---------------------------------------------------------------------------
// composeSummary: a compact text description for dev tooling
// ---------------------------------------------------------------------------
export function composeSummary(map: SemanticMap): string {
  const out: string[] = [];
  const locks = map.doors.filter((d) => d.lock);
  out.push(`${map.archetype} seed=${map.seed} style=${map.style} zones=${map.zones.length} doors=${map.doors.length} (${locks.length} locked) placements=${map.placements.length} people=${map.people.length} keys=${map.keys.length}${map.fallback ? ' FALLBACK' : ''}`);
  out.push(`start (${map.start.x}, ${map.start.z}) f${map.start.floor} yaw ${map.start.yaw}; weenie ${map.weenieZone}; path ${map.criticalPath.join(' → ')}`);
  for (const z of map.zones) {
    const ds = z.doors.map((id) => { const d = map.doors.find((x) => x.id === id); if (!d) return id; const other = d.between[0] === z.id ? d.between[1] : d.between[0]; return other + (d.lock ? ' [' + d.lock + ']' : '') + (d.secret ? ' (secret)' : ''); });
    const n = map.people.filter((p) => p.zone === z.id).length;
    out.push(`  ${z.id} "${z.name}" ${z.role} d${z.depth} f${z.floor} ${z.cells.x1 - z.cells.x0 + 1}×${z.cells.z1 - z.cells.z0 + 1}${z.stairs ? ' stairs→' + z.stairs.to : ''}${n ? ' people=' + n : ''} doors: ${ds.join(', ') || '-'}`);
  }
  for (const k of map.keys) out.push(`  key ${k.item} in ${k.zone} opens ${k.opens || '?'}`);
  return out.join('\n');
}
