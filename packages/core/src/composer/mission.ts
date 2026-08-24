// src/engine/composer/mission.ts — the MISSION GRAPH stage (design §4.2).
// buildMission(seed, arch, reqs, tier) turns an authored Flow into a MissionGraph: slots expanded,
// one cycle pattern per loop, injections, every PlaceReq bound to a node, depths from the entrance,
// then the PACING asserts (null when any fails → the caller re-seeds or takes linearMission).
// Plan-only: integer hashing via rng.ts; no trig, no Math.random, no DOM.
import type { Archetype, Flow, MissionEdge, MissionGraph, MissionNode, PlaceReq, Role, RoomKind, Tier } from './types';
import { KID_SAFE_CYCLES } from './types';
import { sub, type Rng } from './rng';
import {
  SPECIAL_ROLES, isCalm, isCombat, nodeOf, neighbors, degree, edgeBetween, edgeId, edgeById, depthOf, assignDepth,
  addLeaf, removeNode, tag, lockEdge, loopArcs, arcOf, arcOfEdge, fresh, applyCycle,
} from './cycles';

/** MissionGraph plus the reorder warnings bindReq emitted (types.ts has no slot for them). */
export interface MissionGraphReport extends MissionGraph { warnings: string[] }

const SLOT_RANGES: Record<string, [number, number]> = { 'combat+': [1, 3], 'live+': [2, 5], 'store+': [4, 8], course: [1, 2] };
/** Roles that may only appear once; a second request for one becomes the mapped role. */
const UNIQUE_OVERFLOW: Partial<Record<Role, Role>> = { entrance: 'plain', boss: 'elite', secret: 'treasure', exit: 'plain' };
const ROLE_PRIORITY: readonly Role[] = ['plain', 'npc', 'rest', 'work', 'puzzle', 'hub', 'combat', 'elite', 'treasure', 'key', 'lock', 'secret', 'vantage', 'boss', 'entrance', 'exit', 'corridor', 'stairs', 'course', 'plot', 'checkpoint', 'finish', 'base', 'safehouse'];

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------
const deaccent = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/** Archetype-local kind a request names (explicit kind, else its alias through arch.aliases). */
export function reqKind(arch: Archetype, req: PlaceReq): RoomKind | undefined {
  if (req.kind && arch.kinds[req.kind]) return req.kind;
  const a = arch.aliases[deaccent(req.alias)];
  return a && !a.startsWith('*') ? a : req.kind;
}
/** The role a request needs: explicit, else from its alias (*boss, *key …), else the kind's role via roleMap, else plain. */
export function reqRole(arch: Archetype, req: PlaceReq): Role {
  if (req.role) return req.role;
  if (req.boss) return 'boss';
  const a = arch.aliases[deaccent(req.alias)];
  if (a === '*boss') return 'boss';
  if (a === '*key') return 'key';
  if (a === '*door') return 'lock';
  if (a === '*vantage') return 'vantage';
  if (a === '*course') return 'course';
  if (a === '*plot') return 'plot';
  if (req.item) return 'key';
  const kind = reqKind(arch, req);
  if (kind) for (const r of ROLE_PRIORITY) if (arch.roleMap[r]?.includes(kind)) return r;
  return 'plain';
}

// ---------------------------------------------------------------------------
// Flow → graph
// ---------------------------------------------------------------------------
function fromFlow(flow: Flow): MissionGraphReport {
  return {
    nodes: flow.nodes.map((n) => ({ ...n, depth: 99, tags: [] })),
    edges: flow.edges.map(([a, b]) => ({ a, b })),
    loops: flow.loops.map((l) => l.slice()),
    keys: [], criticalPath: [], symmetric: flow.symmetric, flowId: flow.id, warnings: [],
  };
}

/** 'combat+' → 1..3 combat rooms (calm rooms between them), 'live+' → 2..5 and 'store+' → 4..8 siblings, 'course' → 1..2. */
export function expandSlots(g: MissionGraph, rng: Rng): void {
  for (const n of g.nodes.slice()) {
    if (!n.slot) continue;
    const range = SLOT_RANGES[n.slot] ?? (n.slot.endsWith('+') ? [1, 2] : undefined);
    if (!range) continue;
    const count = rng.int(range[0], range[1]);
    if (count <= 1) continue;
    const nb = neighbors(g, n.id);
    if (isCombat(n.role) || n.role === 'course') {
      // Chain: n – (calm) – n_2 – (calm) – n_3 … ; edges that left n in authored order move to the chain's end.
      const chain: string[] = [];
      let last = n.id;
      for (let i = 2; i <= count; i++) {
        if (isCombat(n.role)) { const calm = fresh(g, n.id + '_calm' + i); g.nodes.push({ id: calm, role: 'plain', depth: 99, tags: ['slot:' + n.slot] }); g.edges.push({ a: last, b: calm }); chain.push(calm); last = calm; }
        const id = fresh(g, n.id + '_' + i);
        g.nodes.push({ id, role: n.role, kind: n.kind, floor: n.floor, depth: 99, tags: ['slot:' + n.slot] });
        g.edges.push({ a: last, b: id }); chain.push(id); last = id;
      }
      for (const e of g.edges) if (e.a === n.id && nb.includes(e.b)) e.a = last;
      g.loops = g.loops.map((l) => l.flatMap((x) => (x === n.id ? [n.id, ...chain] : [x])));
    } else {
      // Siblings: each copy hangs off the same neighbours as the original.
      for (let i = 2; i <= count; i++) {
        const id = fresh(g, n.id + '_' + i);
        g.nodes.push({ id, role: n.role, kind: n.kind, floor: n.floor, depth: 99, tags: ['slot:' + n.slot] });
        for (const m of nb) g.edges.push({ a: m, b: id });
      }
    }
  }
}

/** Drop roles a request may not duplicate (only one entrance / boss / secret / exit per graph). */
function overflowRole(g: MissionGraph, role: Role): Role {
  const alt = UNIQUE_OVERFLOW[role];
  if (alt && g.nodes.some((n) => n.role === role && n.req)) return alt;
  return role;
}

/** A calm anchor at depth ≥ 2 (then ≥ 1, then anything that is not boss/exit/special). Deterministic by depth, then node order. */
function calmAnchor(g: MissionGraph, rng: Rng, filter: (n: MissionNode) => boolean = () => true): string {
  const ok = (n: MissionNode) => !isCombat(n.role) && !SPECIAL_ROLES.includes(n.role) && n.role !== 'boss' && n.role !== 'exit' && n.role !== 'finish' && filter(n);
  for (const minDepth of [2, 1, 0]) {
    const calm = g.nodes.filter((n) => n.depth >= minDepth && n.depth < 99 && isCalm(n.role) && n.role !== 'entrance' && ok(n));
    if (calm.length) return rng.pick(calm).id;
    const any = g.nodes.filter((n) => n.depth >= minDepth && n.depth < 99 && ok(n));
    if (any.length) return rng.pick(any).id;
  }
  return g.nodes[0].id;
}

function loopOfNode(g: MissionGraph, id: string): string[] | undefined { return g.loops.find((l) => l.includes(id)); }

/** Lock an edge incident to `L` so that the lock sits deeper than `keyNode`; prefers the edge into L from the arc the key is not on. */
function lockFor(g: MissionGraph, L: string, keyNode: string, item: string): boolean {
  const kd = depthOf(g, keyNode);
  const keyAnchor = neighbors(g, keyNode)[0] ?? keyNode;
  const cands = g.edges.filter((e) => (e.a === L || e.b === L) && !e.lock && !e.secret && !SPECIAL_ROLES.includes(nodeOf(g, e.a === L ? e.b : e.a).role) && Math.max(depthOf(g, e.a), depthOf(g, e.b)) > kd);
  if (!cands.length) return false;
  const loop = loopOfNode(g, L);
  const arcs = loop ? loopArcs(g, loop) : null;
  const score = (e: MissionEdge): number => {
    const other = e.a === L ? e.b : e.a;
    let s = depthOf(g, other) < depthOf(g, L) ? 0 : 10;          // incoming first
    if (arcs) { const ea = arcOfEdge(arcs, e), ka = arcOf(arcs, keyAnchor) ?? arcOf(arcs, keyNode); if (ea && ka && ea === ka) s += 100; }
    return s;
  };
  let best = cands[0];
  for (const e of cands) if (score(e) < score(best)) best = e;
  lockEdge(g, best, keyNode, item);
  return true;
}

/** Requests in STORY ORDER: the ones with a chain step first (ascending), the rest after in authored order.
 *  Identity when no request carries a step, so brief-less worlds bind exactly as before. */
export function orderReqs(reqs: PlaceReq[]): PlaceReq[] {
  if (!reqs.some((r) => r.step !== undefined)) return reqs;
  return reqs.map((r, i) => [r, i] as const).sort((a, b) => (a[0].step ?? 1e9) - (b[0].step ?? 1e9) || a[1] - b[1]).map(([r]) => r);
}
/** The depth a stepped request wants: step 0 near the entrance, the last step as deep as the graph goes. */
function targetDepth(g: MissionGraph, req: PlaceReq, maxStep: number): number | undefined {
  if (req.step === undefined) return undefined;
  let maxDepth = 0; for (const n of g.nodes) if (n.depth < 99 && n.depth > maxDepth) maxDepth = n.depth;
  if (maxStep <= 0) return maxDepth;
  return 1 + Math.round((Math.min(req.step, maxStep) / maxStep) * Math.max(0, maxDepth - 1));
}
/** Among candidates, the one closest to the target depth (ties: the deeper for the last step, else node order). */
function closest(cands: MissionNode[], target: number, last: boolean): MissionNode | undefined {
  let best: MissionNode | undefined;
  for (const n of cands) {
    if (!best) { best = n; continue; }
    const d = Math.abs(n.depth - target), bd = Math.abs(best.depth - target);
    if (d < bd || (d === bd && last && n.depth > best.depth)) best = n;
  }
  return best;
}

/** Bind one request: to an existing node of that role/kind, else inject a node for it.
 *  `maxStep` (the chain's last step) makes a stepped request prefer the node whose depth matches its place in the story. */
export function bindReq(g: MissionGraphReport, arch: Archetype, req: PlaceReq, rng: Rng, maxStep = -1): void {
  assignDepth(g);
  const kind = reqKind(arch, req);
  const role = overflowRole(g, reqRole(arch, req));
  const free = (n: MissionNode) => !n.req;
  const item = req.item ?? arch.lockKit.key;
  const target = maxStep >= 0 ? targetDepth(g, req, maxStep) : undefined;
  const last = target !== undefined && req.step === maxStep;
  const byStep = (pick: (n: MissionNode) => boolean): MissionNode | undefined =>
    target === undefined ? g.nodes.find(pick) : closest(g.nodes.filter(pick), target, last);

  // 1. an existing node of that kind, else of that role (shallowest first, in node order; by story depth when stepped)
  let node = (kind && byStep((n) => free(n) && n.kind === kind)) || undefined;
  if (!node && role === 'vantage') node = g.nodes.find((n) => free(n) && n.tags.includes('vantage'));
  if (!node) node = byStep((n) => free(n) && n.role === role && (!kind || !n.kind || n.kind === kind));
  if (node) {
    node.req = req; if (kind) node.kind = kind;
    if (role === 'lock' && !g.edges.some((e) => e.lock && (e.a === node!.id || e.b === node!.id))) ensureLockAt(g, node.id, item, rng);
    if (role === 'key' && !g.keys.some((k) => k.node === node!.id)) ensureKeyHasLock(g, node.id, item, rng);
    return;
  }

  // 2. inject
  switch (role) {
    case 'boss': {
      const boss = g.nodes.find((n) => n.role === 'boss');
      if (boss) { boss.req = req; if (kind) boss.kind = kind; return; }
      const rest = g.nodes.find((n) => n.role === 'rest' && !n.req) ?? nodeOf(g, calmAnchor(g, rng));
      const b = addLeaf(g, rest.id, { id: fresh(g, 'boss'), role: 'boss', kind, req });
      if (rest.role !== 'rest') { const r = addLeaf(g, rest.id, { id: fresh(g, 'rest'), role: 'rest' }); g.edges = g.edges.filter((e) => !(e.a === rest.id && e.b === b.id)); g.edges.push({ a: r.id, b: b.id }); }
      return;
    }
    case 'vantage': {
      const loop = g.loops[0];
      let at: string;
      if (loop) { const arcs = loopArcs(g, loop); const side = arcs.b.length > arcs.a.length ? arcs.b : arcs.a; at = side.length ? side[side.length >> 1] : arcs.far; }
      else { const cand = g.nodes.filter((n) => isCalm(n.role) && n.role !== 'entrance' && !n.req); at = (cand.length ? cand.reduce((p, c) => (c.depth > p.depth ? c : p)) : g.nodes[1] ?? g.nodes[0]).id; }
      tag(g, at, 'vantage'); const n = nodeOf(g, at); if (!n.req) n.req = req; else addLeaf(g, at, { id: fresh(g, 'vantage'), role: 'vantage', kind, req, tags: ['vantage'] });
      return;
    }
    case 'lock': {
      // the deepest non-boss room gets the locked door into it
      const cands = g.nodes.filter((n) => !n.req && n.depth < 99 && n.role !== 'boss' && n.role !== 'entrance' && n.role !== 'exit' && !SPECIAL_ROLES.includes(n.role) && !g.edges.some((e) => e.lock && (e.a === n.id || e.b === n.id)));
      const D = cands.length ? cands.reduce((p, c) => (c.depth > p.depth ? c : p)) : nodeOf(g, calmAnchor(g, rng));
      D.req = req; if (kind) D.kind = kind; if (D.role === 'plain' || D.role === 'corridor') D.role = 'lock';
      ensureLockAt(g, D.id, item, rng);
      return;
    }
    case 'secret': {
      const anchor = calmAnchor(g, rng, (n) => (g.loops.length ? !!loopOfNode(g, n.id) : true) && n.role !== 'entrance');
      addLeaf(g, anchor, { id: fresh(g, 'secret'), role: 'secret', kind, req });
      return;
    }
    default: {
      // a stepped request hangs off the calm room nearest its story depth; an unstepped one off a random calm anchor
      let anchor = calmAnchor(g, rng);
      if (target !== undefined) {
        const ok = (n: MissionNode) => n.depth < 99 && isCalm(n.role) && n.role !== 'entrance' && !SPECIAL_ROLES.includes(n.role) && n.role !== 'boss' && n.role !== 'exit' && n.role !== 'finish';
        const best = closest(g.nodes.filter(ok), Math.max(1, target - 1), last);
        if (best) anchor = best.id;
      }
      const n = addLeaf(g, anchor, { id: fresh(g, 'req_' + role), role, kind, req });
      if (role === 'key') ensureKeyHasLock(g, n.id, item, rng);
      return;
    }
  }
}

/** A key for the locked door into L: an existing unpaired key, else a new key leaf on another arc at depth ≤ depth(L) − 2. */
function ensureLockAt(g: MissionGraphReport, L: string, item: string, rng: Rng): void {
  assignDepth(g);
  const dl = depthOf(g, L);
  const loop = loopOfNode(g, L); const arcs = loop ? loopArcs(g, loop) : null; const larc = arcs ? arcOf(arcs, L) : null;
  const unpaired = g.nodes.filter((n) => n.role === 'key' && !g.keys.some((k) => k.node === n.id) && n.depth < dl);
  let key = unpaired[0];
  if (!key) {
    const anchor = calmAnchor(g, rng, (n) => n.depth <= dl - 2 && n.id !== L && !(arcs && larc && arcOf(arcs, n.id) === larc));
    key = addLeaf(g, anchor, { id: fresh(g, 'key_' + L), role: 'key' });
  }
  if (!lockFor(g, L, key.id, item)) reorder(g, key.id, L, item, rng);
}

/** A lock for a key node: the deepest lockable room below it, else REORDER the key shallower. */
function ensureKeyHasLock(g: MissionGraphReport, keyId: string, item: string, rng: Rng): void {
  assignDepth(g);
  const kd = depthOf(g, keyId);
  const cands = g.nodes.filter((n) => n.depth > kd && n.depth < 99 && n.role !== 'boss' && n.role !== 'entrance' && !SPECIAL_ROLES.includes(n.role) && n.id !== keyId)
    .sort((p, q) => q.depth - p.depth);
  for (const L of cands) if (lockFor(g, L.id, keyId, item)) return;
  const deepest = g.nodes.filter((n) => n.role !== 'boss' && n.role !== 'entrance' && !SPECIAL_ROLES.includes(n.role) && n.depth < 99).reduce((p, c) => (c.depth > p.depth ? c : p));
  reorder(g, keyId, deepest.id, item, rng);
}

/**
 * REORDER: the key would be deeper than its lock, so swap the key's payload with a shallower room's
 * (the key moves before the lock) and lock the door into L. Records a warning string on the graph.
 */
function reorder(g: MissionGraphReport, keyId: string, L: string, item: string, rng: Rng): void {
  assignDepth(g);
  const dl = depthOf(g, L);
  const key = nodeOf(g, keyId);
  // never the hub: swapping its payload into a key leaf turns the courtyard / cell block into a dead-end closet
  const swapWith = g.nodes.filter((n) => n.id !== keyId && n.id !== L && n.role !== 'entrance' && n.role !== 'boss' && n.role !== 'exit' && n.role !== 'hub' && !SPECIAL_ROLES.includes(n.role) && !n.req && n.depth < 99
    && (degree(g, n.id) === 1 ? n.depth <= dl - 1 : n.depth <= dl - 2))
    .sort((p, q) => p.depth - q.depth || degree(g, p.id) - degree(g, q.id));
  const keyName = key.req?.alias ?? key.kind ?? 'key';
  const lockName = nodeOf(g, L).req?.alias ?? nodeOf(g, L).kind ?? L;
  if (swapWith.length) {
    const other = swapWith[0];
    const payload = (n: MissionNode) => ({ role: n.role, kind: n.kind, req: n.req, tags: n.tags, name: n.name });
    const pk = payload(key), po = payload(other);
    const mark = 'moved:' + keyId;
    pk.tags = [...pk.tags, mark];
    Object.assign(key, po); Object.assign(other, pk);
    g.warnings.push(`Moved "${keyName}" before "${lockName}" so the key comes first`);
    hoistSpecials(g);
    assignDepth(g);
    const moved = g.nodes.find((n) => n.tags.includes(mark)) ?? other;
    if (lockFor(g, L, moved.id, item)) return;
    keyId = moved.id;
  } else {
    // no room to swap with: re-anchor the key leaf on the entrance's first calm neighbour
    const entrance = g.nodes.find((n) => n.role === 'entrance') ?? g.nodes[0];
    const anchor = neighbors(g, entrance.id).find((id) => isCalm(nodeOf(g, id).role) && id !== L) ?? entrance.id;
    g.edges = g.edges.filter((e) => !(e.a === keyId || e.b === keyId));
    g.edges.push({ a: anchor, b: keyId });
    g.warnings.push(`Moved "${keyName}" before "${lockName}" so the key comes first`);
    assignDepth(g);
    if (lockFor(g, L, keyId, item)) return;
  }
  // last resort: lock the edge into L from its shallowest neighbour regardless (pacing will judge it)
  const into = g.edges.filter((e) => (e.a === L || e.b === L) && !e.lock).sort((p, q) => Math.max(depthOf(g, p.a), depthOf(g, p.b)) - Math.max(depthOf(g, q.a), depthOf(g, q.b)))[0];
  if (into) lockEdge(g, into, keyId, item);
}

/** Specials (treasure, secret, npc, key, vantage) must be degree-1: a special sitting on a path becomes a plain room with the special hanging off its shallowest neighbour. */
export function hoistSpecials(g: MissionGraph): void {
  assignDepth(g);
  for (const n of g.nodes.slice()) {
    if (!SPECIAL_ROLES.includes(n.role) || degree(g, n.id) <= 1) continue;
    const nb = neighbors(g, n.id).filter((id) => nodeOf(g, id).role !== 'entrance' && nodeOf(g, id).role !== 'boss');
    const anchor = nb.length ? nb.reduce((p, c) => (depthOf(g, c) < depthOf(g, p) ? c : p)) : n.id;
    // the loop room keeps its 'vantage' tag (foreshadow lives on the arc, not in the closet); everything else moves with the special
    const payload = { role: n.role, kind: n.kind, req: n.req, tags: n.tags.filter((t) => t !== 'vantage'), name: n.name };
    n.role = 'plain'; n.req = undefined; n.kind = undefined; n.name = undefined;
    const leaf = addLeaf(g, anchor, { id: fresh(g, n.id + '_' + payload.role), ...payload });
    for (const k of g.keys) if (k.node === n.id) k.node = leaf.id;
  }
  assignDepth(g);
}

/** Exactly one secret, hanging off a loop node (when the graph has loops) that is neither entrance nor boss. */
function ensureSecret(g: MissionGraph, rng: Rng): void {
  assignDepth(g);
  const secrets = g.nodes.filter((n) => n.role === 'secret');
  for (const s of secrets.slice(1)) { if (s.req) { s.role = 'treasure'; tag(g, s.id, 'hidden'); } else removeNode(g, s.id); }
  const onLoop = (id: string) => (g.loops.length ? g.loops.some((l) => l.includes(id)) : true);
  const okAnchor = (id: string) => { const r = nodeOf(g, id).role; return r !== 'entrance' && r !== 'boss' && onLoop(id); };
  const s = g.nodes.find((n) => n.role === 'secret');
  if (s) {
    const a = neighbors(g, s.id)[0];
    if (a && okAnchor(a)) return;
    g.edges = g.edges.filter((e) => e.a !== s.id && e.b !== s.id);
    g.edges.push({ a: calmAnchor(g, rng, (n) => okAnchor(n.id)), b: s.id });
    return;
  }
  addLeaf(g, calmAnchor(g, rng, (n) => okAnchor(n.id)), { id: fresh(g, 'secret'), role: 'secret' });
}

/** A rest room adjacent to the boss: convert the boss's predecessor when it is plain, else insert one before the boss. */
function ensureRestBeforeBoss(g: MissionGraph): void {
  const boss = g.nodes.find((n) => n.role === 'boss');
  if (!boss) return;
  const nb = neighbors(g, boss.id);
  if (nb.some((id) => nodeOf(g, id).role === 'rest')) return;
  const pred = nb.map((id) => nodeOf(g, id)).filter((n) => n.role !== 'exit').sort((p, q) => p.depth - q.depth)[0];
  if (!pred) return;
  if ((pred.role === 'plain' || pred.role === 'corridor') && !pred.req && !g.edges.some((e) => e.lock && (e.a === pred.id || e.b === pred.id))) { pred.role = 'rest'; return; }
  const e = edgeBetween(g, pred.id, boss.id)!;
  const r = fresh(g, 'rest');
  g.nodes.push({ id: r, role: 'rest', depth: 99, tags: [] });
  if (e.a === boss.id) { e.a = r; g.edges.push({ a: pred.id, b: r }); } else { e.b = r; g.edges.push({ a: r, b: boss.id }); }
  g.loops = g.loops.map((l) => l.flatMap((x) => (x === boss.id ? [r, boss.id] : [x])));
}

/** Every lock-role node gets a locked door (paired with a key); every key node gets a lock. */
function resolveLocks(g: MissionGraphReport, arch: Archetype, rng: Rng): void {
  assignDepth(g);
  for (const n of g.nodes.slice()) if (n.role === 'lock' && !g.edges.some((e) => e.lock && (e.a === n.id || e.b === n.id))) ensureLockAt(g, n.id, n.req?.item ?? arch.lockKit.key, rng);
  for (const n of g.nodes.slice()) if (n.role === 'key' && !g.keys.some((k) => k.node === n.id)) ensureKeyHasLock(g, n.id, n.req?.item ?? arch.lockKit.key, rng);
  for (const k of g.keys) { const n = nodeOf(g, k.node); if (n.req?.item) k.item = n.req.item; else if (k.item.startsWith('key:')) k.item = arch.lockKit.key; }
}

/** Shortest entrance → boss (else finish / exit / deepest) path; oneWay respected. */
export function criticalPath(g: MissionGraph): string[] {
  const start = g.nodes.find((n) => n.role === 'entrance') ?? g.nodes[0];
  const goal = g.nodes.find((n) => n.role === 'boss') ?? g.nodes.find((n) => n.role === 'finish') ?? g.nodes.find((n) => n.role === 'exit')
    ?? g.nodes.reduce((p, c) => (c.depth > p.depth && c.depth < 99 ? c : p));
  if (!start || !goal) return [];
  const prev = new Map<string, string>(); const seen = new Set([start.id]); const q = [start.id];
  while (q.length) {
    const id = q.shift()!;
    if (id === goal.id) break;
    for (const nb of neighbors(g, id, true)) if (!seen.has(nb)) { seen.add(nb); prev.set(nb, id); q.push(nb); }
  }
  if (!seen.has(goal.id)) return [];
  const path = [goal.id]; while (path[0] !== start.id) path.unshift(prev.get(path[0])!);
  return path;
}

// ---------------------------------------------------------------------------
// PACING (design §4.2) — every assert, each returning a reason string
// ---------------------------------------------------------------------------
export function pacingProblems(g: MissionGraph): string[] {
  const out: string[] = [];
  const role = (id: string) => nodeOf(g, id).role;
  const entrance = g.nodes.find((n) => n.role === 'entrance');
  if (!entrance) return ['no entrance'];
  const path = g.criticalPath.length ? g.criticalPath : criticalPath(g);
  // course nodes count as one
  let len = 0; for (let i = 0; i < path.length; i++) if (!(role(path[i]) === 'course' && i > 0 && role(path[i - 1]) === 'course')) len++;
  if (len < 5 || len > 9) out.push(`critical path ${len} not in 5..9`);
  for (const nb of neighbors(g, entrance.id)) if (isCombat(role(nb))) out.push('combat right after entrance');
  for (const n of g.nodes) {
    if (!isCombat(n.role)) continue;
    const deeper = neighbors(g, n.id).filter((id) => depthOf(g, id) > n.depth);
    const calmAfter = deeper.some((id) => isCalm(role(id))) || (deeper.length === 0 && neighbors(g, n.id).some((id) => isCalm(role(id))));
    if (!calmAfter) out.push(`combat ${n.id} not followed by a calm room`);
    for (const m of deeper) if (isCombat(role(m))) for (const o of neighbors(g, m)) if (depthOf(g, o) > depthOf(g, m) && isCombat(role(o))) out.push(`3 combats in a row at ${n.id}`);
  }
  for (const k of g.keys) {
    const e = g.edges.find((x) => x.lock === k.opens);
    if (!e) { out.push(`key ${k.id} opens unknown lock ${k.opens}`); continue; }
    const kd = depthOf(g, k.node), ld = Math.max(depthOf(g, e.a), depthOf(g, e.b));
    if (!(kd < ld)) out.push(`key ${k.node} (depth ${kd}) not before lock ${k.opens} (depth ${ld})`);
    for (const loop of g.loops) {
      if (!loop.includes(e.a) || !loop.includes(e.b)) continue;
      const arcs = loopArcs(g, loop);
      const anchor = loop.includes(k.node) ? k.node : neighbors(g, k.node).find((id) => loop.includes(id));
      if (!anchor) continue;
      const ea = arcOfEdge(arcs, e), ka = arcOf(arcs, anchor);
      if (ea && ka && ea === ka) out.push(`key ${k.node} and lock ${k.opens} on the same arc`);
    }
  }
  const boss = g.nodes.find((n) => n.role === 'boss');
  if (boss) {
    const nb = neighbors(g, boss.id);
    const leaf = nb.length === 1 || (nb.length === 2 && nb.some((id) => role(id) === 'exit'));
    if (!leaf) out.push('boss is not a leaf');
    if (!nb.some((id) => role(id) === 'rest')) out.push('no rest adjacent to boss');
    if (path.length && path[path.length - 1] !== boss.id) out.push('boss is not the end of the critical path');
  } else if (!g.nodes.some((n) => n.role === 'finish' || n.role === 'exit')) out.push('no boss, finish or exit');
  for (const n of g.nodes) if (SPECIAL_ROLES.includes(n.role) && degree(g, n.id) !== 1) out.push(`special ${n.id} has degree ${degree(g, n.id)}`);
  const secrets = g.nodes.filter((n) => n.role === 'secret');
  if (secrets.length !== 1) out.push(`${secrets.length} secrets`);
  else {
    const a = neighbors(g, secrets[0].id)[0];
    if (!a || role(a) === 'entrance' || role(a) === 'boss') out.push('secret off entrance/boss');
    else if (g.loops.length && !g.loops.some((l) => l.includes(a))) out.push('secret not on a loop node');
  }
  for (const loop of g.loops) {
    if (!loop.every((id) => nodeOf(g, id).tags.includes('cycle:foreshadow'))) continue;
    const arcs = loopArcs(g, loop); const side = arcs.b.length > arcs.a.length ? arcs.b : arcs.a;
    if (!side.some((id) => nodeOf(g, id).tags.includes('vantage'))) out.push('foreshadow loop without vantage on the long arc');
  }
  if (g.symmetric) {
    const bases = g.nodes.filter((n) => n.role === 'base');
    if (bases.length === 2) {
      if (bases[0].depth !== bases[1].depth) out.push('team bases at unequal depth');
      const shared = neighbors(g, bases[0].id).filter((id) => neighbors(g, bases[1].id).includes(id));
      if (shared.length !== 1 || role(shared[0]) !== 'hub') out.push('team bases do not share exactly the mid hub');
    }
  }
  for (const n of g.nodes) if (n.depth >= 99) out.push(`${n.id} unreachable`);
  return out;
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------
function finish(g: MissionGraphReport, arch: Archetype, rng: Rng): MissionGraphReport {
  hoistSpecials(g);
  ensureSecret(g, rng);
  ensureRestBeforeBoss(g);
  resolveLocks(g, arch, rng);
  hoistSpecials(g);
  assignDepth(g, 'entrance');
  g.criticalPath = criticalPath(g);
  return g;
}

/** Flows usable at this tier that already contain the roles the requests need (else every tier-eligible flow). */
function eligibleFlows(arch: Archetype, reqs: PlaceReq[], tier: Tier): Flow[] {
  const byTier = arch.flows.filter((f) => f.tier === 'easy' || tier === 'hard');
  const need = new Set(reqs.map((r) => reqRole(arch, r)));
  const fits = byTier.filter((f) => [...need].every((r) => f.nodes.some((n) => n.role === r) || INJECTABLE.includes(r)));
  return fits.length ? fits : byTier.length ? byTier : arch.flows;
}
const INJECTABLE: readonly Role[] = ['key', 'treasure', 'npc', 'work', 'plot', 'course', 'secret', 'lock', 'vantage', 'boss', 'plain', 'rest', 'puzzle', 'elite', 'combat', 'stairs', 'checkpoint', 'finish', 'exit', 'hub', 'corridor', 'base', 'safehouse'];

export function buildMission(seed: number, arch: Archetype, reqs: PlaceReq[], tier: Tier): MissionGraphReport | null {
  const r = buildMissionReport(seed, arch, reqs, tier);
  return r && !r.problems.length ? r.graph : null;
}
/** buildMission without the null: the graph plus the pacing problems that would reject it (for diagnostics / tests). */
export function buildMissionReport(seed: number, arch: Archetype, reqs: PlaceReq[], tier: Tier): { graph: MissionGraphReport; problems: string[] } | null {
  if (!arch.flows.length) return null;
  const rng = sub(seed, 'mission');
  const flow = rng.pick(eligibleFlows(arch, reqs, tier));
  const g = fromFlow(flow);
  expandSlots(g, rng);
  assignDepth(g, 'entrance');
  const patterns = arch.cycles.filter((c) => KID_SAFE_CYCLES[tier].includes(c));
  for (const loop of g.loops.slice()) if (patterns.length) applyCycle(g, loop, rng.pick(patterns), rng);
  for (const inj of arch.injections) {
    if (inj.role === 'secret' && g.nodes.some((n) => n.role === 'secret')) continue;
    if (inj.role === 'course' && !reqs.some((r) => reqRole(arch, r) === 'course')) continue;
    if (!rng.chance(inj.p)) continue;
    assignDepth(g, 'entrance');
    const cands = g.nodes.filter((n) => inj.off.includes(n.role) && n.depth < 99 && (inj.role !== 'secret' || !g.loops.length || g.loops.some((l) => l.includes(n.id))));
    if (!cands.length) continue;
    addLeaf(g, rng.pick(cands).id, { id: fresh(g, 'inj_' + inj.id), role: inj.role, kind: inj.kind, tags: ['injected'] });
  }
  const ordered = orderReqs(reqs); const maxStep = Math.max(-1, ...reqs.map((r) => r.step ?? -1));
  for (const req of ordered) bindReq(g, arch, req, rng, maxStep);
  finish(g, arch, rng);
  return { graph: g, problems: pacingProblems(g) };
}

/** The always-valid fallback: entrance → plain → combat → plain → lock → rest → boss, key and secret as leaves, every request bound. */
export function linearMission(seed: number, arch: Archetype, reqs: PlaceReq[]): MissionGraphReport {
  const rng = sub(seed, 'mission', 'linear');
  const g: MissionGraphReport = {
    nodes: [
      { id: 'entrance', role: 'entrance', depth: 0, tags: [] }, { id: 'hall', role: 'plain', depth: 1, tags: [] },
      { id: 'fight', role: 'combat', depth: 2, tags: [] }, { id: 'landing', role: 'plain', depth: 3, tags: [] },
      { id: 'locked', role: 'lock', depth: 4, tags: [] }, { id: 'rest', role: 'rest', depth: 5, tags: [] },
      { id: 'boss', role: 'boss', depth: 6, tags: [] }, { id: 'key', role: 'key', depth: 2, tags: [] }, { id: 'secret', role: 'secret', depth: 4, tags: [] },
    ],
    edges: [{ a: 'entrance', b: 'hall' }, { a: 'hall', b: 'fight' }, { a: 'fight', b: 'landing' }, { a: 'landing', b: 'locked', lock: 'lock_1' }, { a: 'locked', b: 'rest' }, { a: 'rest', b: 'boss' }, { a: 'hall', b: 'key' }, { a: 'landing', b: 'secret' }],
    loops: [], keys: [{ id: 'key_1', item: arch.lockKit.key, node: 'key', opens: 'lock_1' }], criticalPath: [], flowId: 'linear', warnings: [],
  };
  const ordered = orderReqs(reqs); const maxStep = Math.max(-1, ...reqs.map((r) => r.step ?? -1));
  for (const req of ordered) bindReq(g, arch, req, rng, maxStep);
  finish(g, arch, rng);
  return g;
}

export { assignDepth, applyCycle, edgeId, edgeById };
