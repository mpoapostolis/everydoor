// src/engine/composer/cycles.ts — cycle patterns (design §4.2) plus the small graph toolkit
// mission.ts shares with them. A "loop" is an ordered ring of node ids authored in the flow;
// each pattern edits the loop's edges / locks / tags in place. Plan-only: no trig, no Math.random.
import type { CyclePattern, MissionEdge, MissionGraph, MissionNode, Role } from './types';
import { CALM_ROLES } from './types';
import type { Rng } from './rng';

export const SPECIAL_ROLES: readonly Role[] = ['treasure', 'secret', 'npc', 'key', 'vantage'];
export const isCombat = (r: Role): boolean => r === 'combat' || r === 'elite';
export const isCalm = (r: Role): boolean => CALM_ROLES.includes(r);

// ---------------------------------------------------------------------------
// Graph toolkit
// ---------------------------------------------------------------------------
export const nodeOf = (g: MissionGraph, id: string): MissionNode => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new Error('mission: unknown node ' + id);
  return n;
};
export const hasNode = (g: MissionGraph, id: string): boolean => g.nodes.some((x) => x.id === id);
/** Neighbour ids in edge order (both directions; oneWay edges only a→b). */
export function neighbors(g: MissionGraph, id: string, respectOneWay = false): string[] {
  const out: string[] = [];
  for (const e of g.edges) {
    if (e.a === id) out.push(e.b);
    else if (e.b === id && !(respectOneWay && e.oneWay)) out.push(e.a);
  }
  return out;
}
export const degree = (g: MissionGraph, id: string): number => neighbors(g, id).length;
export const edgeBetween = (g: MissionGraph, a: string, b: string): MissionEdge | undefined =>
  g.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
export const edgeId = (e: MissionEdge): string => e.a + '>' + e.b;
export const edgeById = (g: MissionGraph, id: string): MissionEdge | undefined => g.edges.find((e) => edgeId(e) === id);
export const depthOf = (g: MissionGraph, id: string): number => nodeOf(g, id).depth;

/** BFS hop depth from the entrance (oneWay edges traversed a→b only). Unreachable nodes get 99. */
export function assignDepth(g: MissionGraph, from = 'entrance'): void {
  const start = g.nodes.find((n) => n.role === from) ?? g.nodes.find((n) => n.id === from) ?? g.nodes[0];
  for (const n of g.nodes) n.depth = 99;
  if (!start) return;
  start.depth = 0;
  const q = [start.id];
  while (q.length) {
    const id = q.shift()!; const d = depthOf(g, id);
    for (const nb of neighbors(g, id, true)) { const m = nodeOf(g, nb); if (m.depth > d + 1) { m.depth = d + 1; q.push(nb); } }
  }
}

export function addNode(g: MissionGraph, node: Omit<MissionNode, 'depth' | 'tags'> & { depth?: number; tags?: string[] }): MissionNode {
  const n: MissionNode = { depth: 99, tags: [], ...node };
  g.nodes.push(n);
  return n;
}
/** A degree-1 node hanging off `anchor`. */
export function addLeaf(g: MissionGraph, anchor: string, node: Omit<MissionNode, 'depth' | 'tags'> & { tags?: string[] }): MissionNode {
  const n = addNode(g, node);
  g.edges.push({ a: anchor, b: n.id });
  n.depth = depthOf(g, anchor) + 1;
  return n;
}
export function removeNode(g: MissionGraph, id: string): void {
  g.nodes = g.nodes.filter((n) => n.id !== id);
  g.edges = g.edges.filter((e) => e.a !== id && e.b !== id);
  g.loops = g.loops.map((l) => l.filter((x) => x !== id)).filter((l) => l.length >= 3);
  g.keys = g.keys.filter((k) => k.node !== id);
}
export function tag(g: MissionGraph, id: string, t: string): void { const n = nodeOf(g, id); if (!n.tags.includes(t)) n.tags.push(t); }

/** Lock an edge with a fresh lock id and register a key living in `keyNode`. Returns the lock id. */
export function lockEdge(g: MissionGraph, e: MissionEdge, keyNode: string, item = ''): string {
  const lockId = e.lock ?? 'lock_' + (g.edges.filter((x) => x.lock).length + 1);
  e.lock = lockId;
  g.keys.push({ id: 'key_' + (g.keys.length + 1), item: item || 'key:' + lockId, node: keyNode, opens: lockId });
  return lockId;
}

/** Entry = shallowest loop node, far = deepest; arcs a/b = the loop nodes strictly between them, each way round. */
export interface LoopArcs { entry: string; far: string; a: string[]; b: string[] }
export function loopArcs(g: MissionGraph, loop: string[]): LoopArcs {
  let ei = 0;
  for (let i = 1; i < loop.length; i++) if (depthOf(g, loop[i]) < depthOf(g, loop[ei])) ei = i;
  let fi = (ei + (loop.length >> 1)) % loop.length;
  for (let i = 0; i < loop.length; i++) if (i !== ei && depthOf(g, loop[i]) > depthOf(g, loop[fi])) fi = i;
  const a: string[] = [], b: string[] = [];
  for (let i = (ei + 1) % loop.length; i !== fi; i = (i + 1) % loop.length) a.push(loop[i]);
  for (let i = (ei + loop.length - 1) % loop.length; i !== fi; i = (i + loop.length - 1) % loop.length) b.push(loop[i]);
  return { entry: loop[ei], far: loop[fi], a, b };
}
/** Which arc ('a' | 'b' | null) a node sits on; entry/far are on neither. */
export const arcOf = (arcs: LoopArcs, id: string): 'a' | 'b' | null => (arcs.a.includes(id) ? 'a' : arcs.b.includes(id) ? 'b' : null);
/** Arc of an edge that lies on the loop: the arc of its non-entry/far endpoint (entry–far direct edge counts as 'b'). */
export const arcOfEdge = (arcs: LoopArcs, e: MissionEdge): 'a' | 'b' | null => arcOf(arcs, e.a) ?? arcOf(arcs, e.b) ?? (isLoopEnd(arcs, e.a) && isLoopEnd(arcs, e.b) ? 'b' : null);
const isLoopEnd = (arcs: LoopArcs, id: string) => id === arcs.entry || id === arcs.far;
/** The loop edge that enters `far` from the given arc (or from entry when the arc is empty). */
export function edgeIntoFar(g: MissionGraph, arcs: LoopArcs, arc: 'a' | 'b'): MissionEdge | undefined {
  const side = arc === 'a' ? arcs.a : arcs.b;
  const from = side.length ? side[side.length - 1] : arcs.entry;
  return edgeBetween(g, from, arcs.far);
}
/** The loop node (or its degree-1 child) that carries role `r`, if any. */
const loopNodeWithRole = (g: MissionGraph, loop: string[], r: Role): string | undefined => loop.find((id) => nodeOf(g, id).role === r);

/** A key anchor on the given arc: a calm node, else any arc node, else the entry. */
function keyAnchorOn(g: MissionGraph, arcs: LoopArcs, arc: 'a' | 'b', rng: Rng): string {
  const side = arc === 'a' ? arcs.a : arcs.b;
  const calm = side.filter((id) => isCalm(nodeOf(g, id).role));
  if (calm.length) return rng.pick(calm);
  if (side.length) return rng.pick(side);
  return arcs.entry;
}
/** A node id not yet in the graph: base, base_2, base_3 … (graph-derived, so deterministic). */
export const fresh = (g: MissionGraph, base: string): string => { let id = base; for (let i = 2; hasNode(g, id); i++) id = base + '_' + i; return id; };

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------
/**
 * Apply one cycle pattern to a loop. Depths must be assigned (assignDepth) before calling; the
 * pattern may add degree-1 nodes, lock / hide / one-way edges and tag loop nodes `cycle:<pattern>`.
 */
export function applyCycle(g: MissionGraph, loop: string[], pattern: CyclePattern, rng: Rng): void {
  if (loop.length < 3) return;
  assignDepth(g);
  const arcs = loopArcs(g, loop);
  for (const id of loop) tag(g, id, 'cycle:' + pattern);
  const long: 'a' | 'b' = arcs.b.length > arcs.a.length ? 'b' : 'a';
  const short: 'a' | 'b' = long === 'a' ? 'b' : 'a';

  switch (pattern) {
    case 'lock-and-key': {
      const K = loopNodeWithRole(g, loop, 'key');
      const L = loopNodeWithRole(g, loop, 'lock') ?? arcs.far;
      const keyArc: 'a' | 'b' = K ? (arcOf(arcs, K) ?? long) : long;
      const lockArc: 'a' | 'b' = keyArc === 'a' ? 'b' : 'a';
      // Lock the loop edge into L that comes from the side the key is not on.
      let e: MissionEdge | undefined;
      if (L === arcs.far) e = edgeIntoFar(g, arcs, lockArc);
      else {
        const i = loop.indexOf(L);
        const cand = [loop[(i + 1) % loop.length], loop[(i + loop.length - 1) % loop.length]].filter((x) => x !== K && arcOf(arcs, x) !== keyArc);
        e = cand.length ? edgeBetween(g, L, cand[0]) : undefined;
      }
      if (!e) e = edgeIntoFar(g, arcs, lockArc) ?? edgeBetween(g, loop[0], loop[1])!;
      if (e.lock) break;
      const keyNode = K ?? addLeaf(g, keyAnchorOn(g, arcs, keyArc, rng), { id: fresh(g, 'key_' + arcs.entry), role: 'key', tags: ['cycle:' + pattern] }).id;
      lockEdge(g, e, keyNode);
      break;
    }
    case 'two-keys': {
      const e = edgeIntoFar(g, arcs, short);
      if (!e || e.lock) break;
      const far = depthOf(g, arcs.far);
      const anchors = (long === 'a' ? arcs.a : arcs.b).filter((id) => depthOf(g, id) <= far - 2);   // keys strictly before the lock
      const a1 = anchors.length ? anchors[0] : arcs.entry;
      const a2 = anchors.length > 1 ? anchors[anchors.length - 1] : a1;
      const k1 = addLeaf(g, a1, { id: fresh(g, 'key_' + arcs.entry + '_1'), role: 'key', tags: ['cycle:' + pattern] });
      const k2 = addLeaf(g, a2, { id: fresh(g, 'key_' + arcs.entry + '_2'), role: 'key', tags: ['cycle:' + pattern] });
      const lockId = lockEdge(g, e, k1.id);
      g.keys.push({ id: 'key_' + (g.keys.length + 1), item: 'key:' + lockId + ':2', node: k2.id, opens: lockId });
      break;
    }
    case 'hidden-shortcut': {
      const e = edgeIntoFar(g, arcs, short);
      if (e && !e.lock) e.secret = true;
      break;
    }
    case 'foreshadow': {
      const side = long === 'a' ? arcs.a : arcs.b;
      const mid = side.length ? side[side.length >> 1] : arcs.entry;
      tag(g, mid, 'vantage');
      tag(g, arcs.far, 'foreshadowed');
      break;
    }
    case 'false-goal': {
      const side = short === 'a' ? arcs.a : arcs.b;
      const anchor = side.length ? side[side.length - 1] : arcs.entry;
      addLeaf(g, anchor, { id: fresh(g, 'decoy_' + arcs.entry), role: 'treasure', tags: ['false-goal', 'cycle:' + pattern] });
      tag(g, arcs.far, 'true-goal');
      break;
    }
    case 'two-paths': {
      for (const id of arcs.a) tag(g, id, 'path:a');
      for (const id of arcs.b) tag(g, id, 'path:b');
      break;
    }
    case 'dangerous-route': {
      const side = short === 'a' ? arcs.a : arcs.b;
      for (const id of side) tag(g, id, 'dangerous');
      // Turn one plain room on the short arc into combat when the next room toward `far` is calm.
      for (let i = 0; i < side.length; i++) {
        const n = nodeOf(g, side[i]);
        const next = i + 1 < side.length ? nodeOf(g, side[i + 1]) : nodeOf(g, arcs.far);
        if (n.role === 'plain' && isCalm(next.role) && !isCombat(nodeOf(g, arcs.entry).role)) { n.role = 'combat'; break; }
      }
      break;
    }
    case 'blocked-retreat': {
      const side = long === 'a' ? arcs.a : arcs.b;
      const from = side.length ? side[side.length - 1] : arcs.entry;
      const e = edgeBetween(g, from, arcs.far);
      if (e && !e.lock) { if (e.a !== from) { const t = e.a; e.a = e.b; e.b = t; } e.oneWay = true; tag(g, arcs.far, 'no-retreat'); }
      break;
    }
    case 'patrol': {
      for (const id of loop) tag(g, id, 'patrol');
      break;
    }
  }
  assignDepth(g);
}
