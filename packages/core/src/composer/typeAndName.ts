// src/engine/composer/typeAndName.ts — the TYPING AND NAMING stage (docs/design §4.4).
// Takes an embedded layout whose zones carry provisional ids and gives every zone its final
// kind, ordinal, display name and stable id `${arch.id}.${kind}#${ordinal}`; rewrites every
// reference to the old ids (doors, nodeZone, collider ids); builds the alias map a script
// resolves place words through. Plan-only: seeded rng, no trig, no Math.random.
import type { Archetype, EmbeddedLayout, MissionGraph, PlaceReq, Role, RoomKind, Zone } from './types';
import { sub } from './rng';

/** Lower-case, accents stripped (Greek tonos included), whitespace collapsed. */
export const deaccent = (s: string): string => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim();

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
/** Words a script may use for a role, beyond the kind's own aliases. */
const ROLE_WORDS: Partial<Record<Role, string[]>> = {
  entrance: ['entrance', 'start', 'spawn', 'the start', 'the entrance', 'arxi', 'αρχη', 'eisodos', 'εισοδος'],
  hub: ['hub', 'the hub', 'centre', 'center', 'the middle', 'kentro', 'κεντρο'],
  boss: ['boss', 'boss room', 'the boss room', 'boss arena', 'arena', 'the arena', 'afentiko', 'αφεντικο'],
  treasure: ['treasure', 'the treasure', 'vault', 'the vault', 'treasure room', 'thisavros', 'θησαυρος'],
  secret: ['secret', 'the secret', 'secret room', 'hidden room', 'the secret room', 'mystiko', 'μυστικο', 'kryfo domatio', 'κρυφο δωματιο'],
  key: ['key room', 'the key room', 'where the key is', 'kleidi', 'κλειδι'],
  lock: ['locked room', 'the locked room', 'locked door', 'the locked door', 'kleidomeno', 'κλειδωμενο'],
  exit: ['exit', 'the exit', 'the end', 'way out', 'exodos', 'εξοδος'],
  finish: ['finish', 'the finish', 'finish line', 'goal', 'termatismos', 'τερματισμος'],
  vantage: ['vantage', 'vantage point', 'lookout', 'the lookout', 'high ground'],
  rest: ['rest', 'rest room', 'safe room', 'the safe room', 'resting place'],
  course: ['course', 'the course', 'obby', 'parkour', 'obstacle course', 'the run'],
  npc: ['npc room', 'the people'],
  plot: ['plot', 'the plot', 'plots', 'garden plot'],
  base: ['base', 'the base', 'our base'],
  safehouse: ['safehouse', 'safe house', 'the safehouse'],
  work: ['workshop', 'work room', 'workstation', 'the job'],
  puzzle: ['puzzle', 'puzzle room', 'the puzzle'],
  combat: ['fight', 'fight room', 'battle'],
  elite: ['elite', 'elite room', 'champion'],
  checkpoint: ['checkpoint', 'the checkpoint'],
  stairs: ['stairs', 'the stairs', 'staircase', 'skala', 'σκαλα'],
  corridor: ['corridor', 'the corridor', 'hallway', 'diadromos', 'διαδρομος'],
};
const WILDCARD_ROLE: Record<string, Role> = { '*boss': 'boss', '*key': 'key', '*door': 'lock', '*vantage': 'vantage', '*course': 'course', '*plot': 'plot' };

const displayName = (arch: Archetype, kind: RoomKind, i: number): string => {
  const list = arch.naming[kind];
  if (!list || !list.length) {
    const base = kind.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
    return i === 1 ? base : `${base} ${ROMAN[Math.min(i - 1, ROMAN.length - 1)] || i}`;
  }
  const wrap = Math.floor((i - 1) / list.length);
  const base = list[(i - 1) % list.length];
  return wrap === 0 ? base : `${base} ${ROMAN[Math.min(wrap, ROMAN.length - 1)] || wrap + 1}`;
};

/** Rewrite one zone's identity; returns the new id. The kind's finish is copied onto the zone here —
 *  the renderer reads zone.finish verbatim and never guesses from the kind name. */
function assign(zone: Zone, arch: Archetype, kind: RoomKind, i: number, role: Role, depth: number): string {
  zone.kind = kind; zone.name = displayName(arch, kind, i); zone.id = `${arch.id}.${kind}#${i}`; zone.role = role; zone.depth = depth;
  const finish = arch.kinds[kind]?.finish;
  if (finish) zone.finish = { ...finish };
  return zone.id;
}

/** Zones reachable from the start with every locked door solid (the rooms a key may safely live in). */
function openZones(layout: EmbeddedLayout): Set<string> {
  const st = layout.start;
  const startZone = layout.zones.find((z) => z.floor === st.floor && st.x >= z.rect.x0 && st.x <= z.rect.x1 && st.z >= z.rect.z0 && st.z <= z.rect.z1) ?? layout.zones[0];
  const seen = new Set<string>(); if (!startZone) return seen;
  const q = [startZone.id]; seen.add(startZone.id);
  while (q.length) {
    const id = q.shift()!;
    for (const d of layout.doors) { if (d.lock || !d.between.includes(id)) continue; const o = d.between[0] === id ? d.between[1] : d.between[0]; if (!seen.has(o)) { seen.add(o); q.push(o); } }
  }
  return seen;
}

/** THE ROOM THE SCRIPT MEANT. A plan-first embed maps a node to a room by depth with only a soft kind preference, so
 *  "the chapel" may land in a tower while the plan's real chapel goes to a kind-less plain node. When that happens and
 *  the swap is safe — the other node is plain, unrequested, neither touches a locked door, both rooms are on the open
 *  side of every lock — the two nodes trade rooms, so the kitchen IS the kitchen and the label sits on the right door. */
const SWAPPABLE = new Set<Role>(['plain', 'rest', 'work', 'puzzle', 'npc', 'treasure']);
function claimKindRooms(layout: EmbeddedLayout, g: MissionGraph): void {
  if (layout.zones.some((z) => z.floor !== 0)) return;   // single-storey plans only
  const byOld = new Map<string, Zone>(layout.zones.map((z) => [z.id, z]));
  const lockedNode = new Set<string>(); for (const e of g.edges) if (e.lock) { lockedNode.add(e.a); lockedNode.add(e.b); }
  const open = openZones(layout);
  const taken = (zid: string) => g.nodes.some((n) => layout.nodeZone[n.id] === zid && n.req?.kind);
  for (const n of g.nodes) {
    const want = n.req?.kind; if (!want) continue;
    const zid = layout.nodeZone[n.id]; const z = zid ? byOld.get(zid) : undefined;
    if (!z || z.kind === want || lockedNode.has(n.id) || n.role === 'boss' || n.role === 'entrance' || n.role === 'hub' || n.role === 'secret' || n.role === 'exit') continue;
    if (!open.has(z.id)) continue;
    const other = g.nodes.find((m) => m !== n && !m.req && SWAPPABLE.has(m.role) && !lockedNode.has(m.id) && layout.nodeZone[m.id] !== undefined
      && byOld.get(layout.nodeZone[m.id])?.kind === want && open.has(layout.nodeZone[m.id]) && !taken(layout.nodeZone[m.id]));
    if (!other) continue;
    const oz = layout.nodeZone[other.id];
    layout.nodeZone[n.id] = oz; layout.nodeZone[other.id] = z.id;
    other.kind = z.kind;                                  // the plain node now owns the room the request left
  }
}

export function typeAndName(layout: EmbeddedLayout, g: MissionGraph, arch: Archetype, seed: number, reqs: PlaceReq[]): Record<string, string> {
  const rng = sub(seed, 'names');
  const used: Record<string, number> = {};
  const rename: Record<string, string> = {};            // old zone id → new zone id
  const done = new Set<Zone>();
  if (arch.layout === 'plan' && reqs.some((r) => r.kind)) claimKindRooms(layout, g);
  const byOld = new Map<string, Zone>(layout.zones.map((z) => [z.id, z]));
  const ordinal = new Map<string, number>();             // new zone id → ordinal
  const firstKinds = Object.keys(arch.kinds);
  const labelled = new Set<Zone>();

  // 1. Mission nodes, in graph order (deterministic ordinals).
  for (const n of g.nodes) {
    const oldId = layout.nodeZone[n.id];
    const zone = oldId !== undefined ? byOld.get(oldId) : undefined;
    if (!zone || done.has(zone)) continue;
    done.add(zone);
    const pool = arch.roleMap[n.role];
    let kind: RoomKind | undefined = n.kind;
    if (arch.layout === 'plan' && zone.kind && arch.kinds[zone.kind]) kind = zone.kind;   // PLAN-FIRST: the plan's room IS the kind (a throne node on the courtyard becomes a courtyard node, never an open-sky throne)
    // a kind-less node keeps the kind the embedder sized it for (when that kind fits the role) — a room sized as a throne must not be furnished as a kitchen
    if ((!kind || !arch.kinds[kind]) && zone.kind && arch.kinds[zone.kind] && pool?.includes(zone.kind)) kind = zone.kind;
    if (!kind || !arch.kinds[kind]) kind = pool && pool.length ? rng.pick(pool) : undefined;
    if (!kind || !arch.kinds[kind]) kind = (zone.kind && arch.kinds[zone.kind]) ? zone.kind : firstKinds[0];
    const i = (used[kind] = (used[kind] ?? 0) + 1);
    const id = assign(zone, arch, kind, i, n.role, n.depth);
    // THE AUTHOR'S WORDS: a request that labelled its room names the zone ("Mira's bedroom", not "Small Bedroom") —
    // zone.name is what the HUD and the key names show, so the building speaks the script's language
    if (n.req?.label) { zone.name = n.req.label; labelled.add(zone); }
    n.kind = kind; n.name = zone.name; n.zoneId = id;
    rename[oldId] = id; ordinal.set(id, i);
  }
  // 2. Everything the embedder added on its own (corridors, stair shafts) — in layout order.
  for (const z of layout.zones) {
    if (done.has(z)) continue;
    done.add(z);
    const oldId = z.id;
    const kind: RoomKind = z.kind && z.kind !== 'corridor' && arch.kinds[z.kind] ? z.kind : 'corridor';
    const i = (used[kind] = (used[kind] ?? 0) + 1);
    const role: Role = kind === 'stairs' ? 'stairs' : 'corridor';
    const id = assign(z, arch, kind, i, role, z.depth ?? 0);   // no naming entry → 'Corridor', 'Corridor II', …
    rename[oldId] = id; ordinal.set(id, i);
  }

  // 2b. A label is the script's word for ONE room: a generic name that collides with it moves on to the next name of its kind.
  if (labelled.size) {
    const names = new Set([...labelled].map((z) => deaccent(z.name)));
    for (const z of layout.zones) {
      if (labelled.has(z)) continue;
      let guard = 0;
      while (names.has(deaccent(z.name)) && guard++ < 24) z.name = displayName(arch, z.kind, (used[z.kind] = (used[z.kind] ?? 0) + 1));
      names.add(deaccent(z.name));
    }
  }

  // 3. Rewrite references: doors, nodeZone, colliders, zone.doors lists.
  const map = (id: string): string => rename[id] ?? id;
  for (const d of layout.doors) d.between = [map(d.between[0]), map(d.between[1])];
  for (const k of Object.keys(layout.nodeZone)) layout.nodeZone[k] = map(layout.nodeZone[k]);
  for (const c of layout.colliders) if (c.id !== undefined && rename[c.id] !== undefined) c.id = rename[c.id];
  for (const z of layout.zones) {
    const seen = new Set(z.doors);
    for (const d of layout.doors) if ((d.between[0] === z.id || d.between[1] === z.id) && !seen.has(d.id)) { z.doors.push(d.id); seen.add(d.id); }
  }
  if (g.criticalPath) g.criticalPath = g.criticalPath.map((p) => (byOld.has(p) ? map(p) : p));

  // 4. Aliases. First binding wins (lowest ordinal / shallowest node); script reqs override.
  const aliases: Record<string, string> = {};
  const put = (word: string, id: string, force = false) => { const w = deaccent(word); if (!w) return; if (force || aliases[w] === undefined) aliases[w] = id; };
  const zonesInOrder = layout.zones.slice().sort((a, b) => (ordinal.get(a.id)! - ordinal.get(b.id)!) || (a.depth - b.depth));
  const wordsForKind = new Map<RoomKind, string[]>();
  for (const [w, k] of Object.entries(arch.aliases)) { if (k.startsWith('*')) continue; const l = wordsForKind.get(k) ?? []; l.push(w); wordsForKind.set(k, l); }
  const kindWord = (k: RoomKind) => k.replace(/_/g, ' ');
  for (const z of zonesInOrder) {
    const i = ordinal.get(z.id) ?? 1;
    put(z.name, z.id); put(`the ${z.name}`, z.id);
    put(kindWord(z.kind), z.id); put(`the ${kindWord(z.kind)}`, z.id);
    put(`${kindWord(z.kind)} ${i}`, z.id); put(`${kindWord(z.kind)} #${i}`, z.id);
    const ord = ORDINALS[i - 1];
    if (ord) { put(`${ord} ${kindWord(z.kind)}`, z.id); put(`the ${ord} ${kindWord(z.kind)}`, z.id); }
    for (const w of wordsForKind.get(z.kind) ?? []) { put(w, z.id); put(`the ${w}`, z.id); if (ord) put(`${ord} ${w}`, z.id); put(`${w} ${i}`, z.id); }
  }
  // role words — by depth order so 'the boss room' is the shallowest boss, 'entrance' the real start
  const byDepth = layout.zones.slice().sort((a, b) => a.depth - b.depth || (ordinal.get(a.id)! - ordinal.get(b.id)!));
  for (const z of byDepth) {
    if (z.role === 'corridor' && z.kind === 'corridor') continue;
    put(z.role, z.id); put(`${z.role} room`, z.id); put(`the ${z.role} room`, z.id);
    for (const w of ROLE_WORDS[z.role] ?? []) put(w, z.id);
  }
  for (const [w, k] of Object.entries(arch.aliases)) {
    if (!k.startsWith('*')) continue;
    const role = WILDCARD_ROLE[k]; if (!role) continue;
    const z = byDepth.find((zz) => zz.role === role);
    if (z) { put(w, z.id); put(`the ${w}`, z.id); }
  }
  // script requests — bound to the zone of their node, else to the first zone matching kind/role
  const bindReq = (r: PlaceReq): string | undefined => {
    const n = g.nodes.find((nn) => nn.req === r) ?? g.nodes.find((nn) => nn.req?.alias === r.alias);
    if (n?.zoneId) return n.zoneId;
    const direct = aliases[deaccent(r.alias)]; if (direct) return direct;
    if (r.kind) { const k = arch.aliases[deaccent(r.kind)] ?? r.kind; const z = zonesInOrder.find((zz) => zz.kind === k); if (z) return z.id; }
    if (r.role) { const z = byDepth.find((zz) => zz.role === r.role); if (z) return z.id; }
    return undefined;
  };
  for (const n of g.nodes) if (n.req?.alias && n.zoneId) { put(n.req.alias, n.zoneId, true); put(`the ${n.req.alias}`, n.zoneId, true); }
  for (const r of reqs) { if (!r.alias) continue; const id = bindReq(r); if (id) { put(r.alias, id, true); put(`the ${r.alias}`, id, true); } }
  return aliases;
}
