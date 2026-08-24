// src/engine/composer/plans/mapMission.ts — mission nodes → plan rooms.
// Entrance → entrance room; boss → tagged/role 'boss' else the farthest (big) room; hub → tagged/role
// 'hub' else the most-connected room that is NOT the corridor and not a leaf (an atrium opens OFF the
// circulation, it is not the circulation); lock targets → single-door leaf rooms (that door gets the lock,
// the key's room must stay reachable with every lock solid); secret → the '!' room else the smallest
// leaf; the rest paired by depth with a kind preference. Extra rooms become nodes appended to the
// graph (role 'corridor' for corridor kinds, else 'plain') hung off a neighbouring room's node.
// Plan-only: no trig, no Math.random.
import type { Archetype, MissionGraph, MissionNode } from '../types';
import type { ParsedPlan, PlanDoor } from './types';
import type { Rng } from '../rng';
import { doorKey } from './parse';

export interface MissionMap {
  assign: Record<string, string>;       // node id → room char
  locks: Record<string, PlanDoor>;      // lock id → the door that carries it
  secrets: PlanDoor[];                  // doors marked secret by the mapper (the '!' doors are secret already)
  ok: boolean;
  reason?: string;
}

const MAX_TRIES = 12;

interface RoomInfo { c: string; kind: string; area: number; side: number; depth: number; solid: PlanDoor[]; degree: number; leaf: boolean }
const isCorrKind = (r: RoomInfo): boolean => r.kind === 'corridor' || r.kind === 'hall' || r.kind === 'hallway';

/** Door-graph BFS depth from the entrance with some doors treated solid. */
function roomDepths(p: ParsedPlan, solid: Set<string>): Record<string, number> {
  const depth: Record<string, number> = { [p.plan.entrance]: 0 }; const q = [p.plan.entrance];
  while (q.length) {
    const c = q.shift()!;
    for (const d of p.doors) {
      if (d.exterior || (d.a !== c && d.b !== c) || solid.has(doorKey(d))) continue;
      const o = d.a === c ? d.b : d.a;
      if (depth[o] === undefined) { depth[o] = depth[c] + 1; q.push(o); }
    }
  }
  return depth;
}

function roomInfos(p: ParsedPlan): RoomInfo[] {
  const depth = roomDepths(p, new Set());
  return Object.keys(p.rects).sort().map((c) => {
    const r = p.rects[c];
    const solid = p.doors.filter((d) => !d.exterior && !d.open && (d.a === c || d.b === c));
    const open = p.doors.some((d) => d.open && (d.a === c || d.b === c));
    return { c, kind: p.plan.rooms[c].kind, area: (r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1), side: Math.min(r.x1 - r.x0 + 1, r.z1 - r.z0 + 1), depth: depth[c] ?? 99, solid, degree: p.adjacency[c].length, leaf: solid.length === 1 && !open };
  });
}

/** `hints`: node id → room char a generator reserved for that node (plans/generate tags rooms `need:<i>`); a hint is
 *  honoured when the room is free and satisfies the node's constraint, else the general rule applies. */
export function mapMission(p: ParsedPlan, g: MissionGraph, arch: Archetype, rng: Rng, hints?: Record<string, string>): MissionMap {
  const rooms = roomInfos(p);
  const bossSide = Math.min(arch.bossArena.minCells, 5);   // validate's arena rule for shared-wall plans
  const byChar = new Map(rooms.map((r) => [r.c, r]));
  const nodes = g.nodes;
  if (nodes.length > rooms.length) return { assign: {}, locks: {}, secrets: [], ok: false, reason: `${nodes.length} nodes for ${rooms.length} rooms` };
  const entrance = nodes.find((n) => n.role === 'entrance') ?? nodes.find((n) => n.id === g.criticalPath[0]) ?? nodes[0];
  const boss = nodes.find((n) => n.role === 'boss');
  const hub = nodes.find((n) => n.role === 'hub');
  const secret = nodes.find((n) => n.role === 'secret');
  // lock edges: v = the deeper endpoint; its key node via g.keys
  const lockEdges = g.edges.filter((e) => e.lock).map((e) => {
    const na = nodes.find((n) => n.id === e.a)!, nb = nodes.find((n) => n.id === e.b)!;
    const v = nb.depth >= na.depth ? nb : na;
    return { lock: e.lock!, v, key: g.keys.find((k) => k.opens === e.lock)?.node };
  });
  const lockTargets = new Set(lockEdges.map((l) => l.v.id));
  const tagged = (t: string) => rooms.filter((r) => p.plan.rooms[r.c].tags?.includes(t) || p.plan.rooms[r.c].role === t);
  const want = (n: MissionNode) => n.kind;

  let last: MissionMap = { assign: {}, locks: {}, secrets: [], ok: false, reason: 'no attempt' };
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const jitter = attempt === 0 ? () => 0 : () => rng.int(0, 2);
    const assign: Record<string, string> = {};
    const used = new Set<string>();
    const take = (n: MissionNode, r: RoomInfo) => { assign[n.id] = r.c; used.add(r.c); };
    const free = (f: (r: RoomInfo) => boolean = () => true) => rooms.filter((r) => !used.has(r.c) && f(r));
    const hinted = (n: MissionNode, f: (r: RoomInfo) => boolean = () => true): RoomInfo | undefined => { const c = hints?.[n.id]; const r = c ? byChar.get(c) : undefined; return r && !used.has(r.c) && f(r) ? r : undefined; };
    let fail: string | undefined;

    take(entrance, byChar.get(p.plan.entrance)!);
    // boss
    if (boss) {
      const leafOnly = lockTargets.has(boss.id);
      const fits = (r: RoomInfo) => r.side >= bossSide && !isCorrKind(r) && (!leafOnly || r.leaf);
      const h = hinted(boss, fits);
      let cands = h ? [h] : tagged('boss').filter((r) => !used.has(r.c) && fits(r));
      if (!cands.length) cands = free(fits);
      if (!cands.length) { fail = `no room ≥ ${bossSide} cells for the boss`; }
      else {
        cands.sort((a, b) => (b.depth - jitter()) - (a.depth - jitter()) || b.area - a.area || (a.c < b.c ? -1 : 1));
        take(boss, cands[0]);
      }
    }
    // hub
    if (hub && !fail) {
      const h = hinted(hub);
      let cands = h ? [h] : tagged('hub').filter((r) => !used.has(r.c));
      if (!cands.length) cands = free((r) => !r.leaf && !isCorrKind(r));   // the hub is a room off the corridor, not the corridor
      if (!cands.length) cands = free((r) => !r.leaf);
      if (!cands.length) cands = free();
      cands.sort((a, b) => (b.degree + jitter()) - (a.degree + jitter()) || b.area - a.area || (a.c < b.c ? -1 : 1));
      take(hub, cands[0]);
    }
    // lock targets: one single-door room each
    const locks: Record<string, PlanDoor> = {};
    for (const l of lockEdges) {
      if (fail) break;
      if (assign[l.v.id]) { const r = byChar.get(assign[l.v.id])!; if (!r.leaf) { fail = `lock room for ${l.v.id} is not single-door`; break; } locks[l.lock] = r.solid[0]; continue; }
      const cands = free((r) => r.leaf && (!p.plan.rooms[r.c].tags?.includes('boss')));
      if (!cands.length) { fail = `no single-door room for lock ${l.lock}`; break; }
      const h = hinted(l.v, (r) => r.leaf);
      const pref = h ? [h] : cands.filter((r) => want(l.v) && r.kind === want(l.v));
      const pool = pref.length ? pref : cands;
      const pick = attempt === 0 ? pool.sort((a, b) => b.depth - a.depth || (a.c < b.c ? -1 : 1))[0] : rng.pick(pool);
      take(l.v, pick); locks[l.lock] = pick.solid[0];
    }
    // secret
    const secrets: PlanDoor[] = [];
    if (secret && !fail && !assign[secret.id]) {
      const bang = free((r) => r.leaf && !!r.solid[0].secret);
      const h = hinted(secret, (r) => r.leaf);
      if (h) { take(secret, h); if (!h.solid[0].secret) secrets.push(h.solid[0]); }
      else if (bang.length) take(secret, bang[0]);
      else {
        const leaves = free((r) => r.leaf && r.c !== assign[boss?.id ?? '']).sort((a, b) => a.area - b.area || (a.c < b.c ? -1 : 1));
        if (leaves.length) { take(secret, leaves[0]); secrets.push(leaves[0].solid[0]); }
        else fail = 'no leaf room for the secret';
      }
    }
    // the rest: by mission depth ↔ door-graph depth, kind preferred
    if (!fail) {
      const rest = nodes.filter((n) => !assign[n.id]).sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1));
      const pool = free().sort((a, b) => a.depth - b.depth || (a.c < b.c ? -1 : 1));
      for (const n of rest) {
        const k = want(n);
        const h = hinted(n);
        let i = h ? pool.indexOf(h) : k ? pool.findIndex((r) => r.kind === k) : -1;
        // corridors / halls only take a node that asks for them (a key in the corridor is no key at all)
        if (i < 0) { const j = attempt === 0 ? 0 : Math.min(pool.length - 1, jitter()); const isCorr = (r: RoomInfo) => r.kind === 'corridor' || r.kind === 'hall'; i = n.role === 'corridor' || !pool.some((r) => !isCorr(r)) ? j : pool.findIndex((r, q) => q >= j && !isCorr(r)); if (i < 0) i = pool.findIndex((r) => !isCorr(r)); }
        if (i < 0 || !pool.length) { fail = `no room for ${n.id}`; break; }
        take(n, pool.splice(i, 1)[0]);
      }
    }
    // lock check: every key's room reachable with all locks solid; every lock room is a leaf (by construction)
    if (!fail && lockEdges.length) {
      const solid = new Set(Object.values(locks).map(doorKey));
      const depth = roomDepths(p, solid);
      for (const l of lockEdges) {
        const keyRoom = l.key ? assign[l.key] : undefined;
        if (keyRoom && depth[keyRoom] === undefined) { fail = `key ${l.key} behind lock ${l.lock}`; break; }
        if (keyRoom && keyRoom === assign[l.v.id]) { fail = `key ${l.key} inside its own lock room`; break; }
      }
      // everything that is not a lock room stays reachable with locks solid
      if (!fail) for (const n of nodes) if (!lockTargets.has(n.id) && depth[assign[n.id]] === undefined) { fail = `${n.id} behind a lock`; break; }
    }
    last = { assign, locks, secrets, ok: !fail, reason: fail };
    if (!fail) break;
  }
  if (!last.ok) return last;

  // extra rooms → nodes hung off a neighbour's node
  const roomNode = new Map(Object.entries(last.assign).map(([n, c]) => [c, n]));
  const pending = rooms.filter((r) => !roomNode.has(r.c)).sort((a, b) => a.depth - b.depth || (a.c < b.c ? -1 : 1));
  for (const r of pending) {
    const nb = p.adjacency[r.c].map((c) => roomNode.get(c)).filter((x): x is string => !!x);
    const anchor = nb.map((id) => nodes.find((n) => n.id === id)!).sort((a, b) => a.depth - b.depth)[0];
    const isCorr = r.kind === 'corridor' || r.kind === 'hall';
    let id = 'room_' + r.c; while (nodes.some((n) => n.id === id)) id += '_';
    const node: MissionNode = { id, role: isCorr ? 'corridor' : 'plain', kind: r.kind, depth: anchor ? anchor.depth + 1 : 99, tags: ['plan-extra'] };
    nodes.push(node);
    if (anchor) g.edges.push({ a: anchor.id, b: id });
    last.assign[id] = r.c; roomNode.set(r.c, id);
  }
  void arch;
  return last;
}
