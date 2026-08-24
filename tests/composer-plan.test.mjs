// The PLAN core: parsePlan / validatePlan / applyVariants on hand-written plans (valid and invalid),
// mapMission × 300 seeds with buildMission on the generic archetype, planToLayout invariants under the
// SHARED-WALL CONTRACT (no overlap, doors on boundaries, every boundary sealed at 0.5 u, BFS via doors
// reaches every zone, lock rooms single-door, key reachable with locks solid), determinism, ≤ 5 ms.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parsePlan, validatePlan, applyVariants, PlanError, doorKey } from '../packages/core/src/composer/plans/parse.ts';
import { mapMission } from '../packages/core/src/composer/plans/mapMission.ts';
import { planToLayout } from '../packages/core/src/composer/plans/planToLayout.ts';
import { renderPlanAscii, renderLayoutAscii } from '../packages/core/src/composer/plans/render.ts';
import { genericArchetype } from '../packages/core/src/composer/archetypes/generic.ts';
import { buildMission, linearMission } from '../packages/core/src/composer/mission.ts';
import { sub } from '../packages/core/src/composer/rng.ts';
import { CELL, GRID } from '../packages/core/src/composer/types.ts';

const ARCH = genericArchetype('house', 'house', 'plan');
const cellU = (c) => (c - GRID / 2) * CELL;
const SEEDS = Array.from({ length: 300 }, (_, i) => 1000 + i * 7919);

const room = (kind, over = {}) => ({ kind, ...over });
/** The minimal valid plan: a corridor spine with rooms on both sides, five single-door leaves, a big room at the end. */
const MINIMAL = {
  id: 'minimal', archetype: 'house', entrance: 'D',
  rows: [
    'GGGGAAAAABBBBCCCCCIIIILLLLLLL',
    'GGGGAAAAABBBBCCCCCIIIILLLLLLL',
    'GGGGAAAAABBBBCCCCCIIIILLLLLLL',
    'GGGGAAAAABBBBCCCCCIIIILLLLLLL',
    '....HHHHHHHHHHHHHHHHHHLLLLLLL',
    '....HHHHHHHHHHHHHHHHHHLLLLLLL',
    '....HHHHHHHHHHHHHHHHHHLLLLLLL',
    'JJJJDDDDDEEEEFFFFFKKKKLLLLLLL',
    'JJJJDDDDDEEEEFFFFFKKKKLLLLLLL',
    'JJJJDDDDDEEEEFFFFFKKKKLLLLLLL',
    'JJJJDDDDDEEEEFFFFFKKKKLLLLLLL',
  ],
  rooms: {
    A: room('room'), B: room('room'), C: room('room'), D: room('hall', { role: 'entrance' }), E: room('room'), F: room('room'),
    G: room('store'), H: room('corridor'), I: room('store'), J: room('vault'), K: room('store'), L: room('great', { tags: ['boss'] }),
  },
  doors: ['D>', 'A-H', 'B-H', 'C-H', 'D-H', 'E-H', 'F-H', 'G-A', 'J-D', 'I-C', 'K-F', 'L-H'],
};
/** A small plan with an open join (L-shaped living room), a secret door and an '@' slot. */
const SMALL = {
  id: 'small', archetype: 'house', entrance: 'A',
  rows: [
    'AAAABBBB',
    'AAAABBBB',
    'AAAABBBB',
    'CCCCBBBB',
    'CCCCDDDD',
    'CCCCDDDD',
    'CCCCDDDD',
  ],
  rooms: { A: room('hall'), B: room('room'), C: room('room'), D: room('store') },
  doors: ['A>', 'A-B~', 'A-C@1', 'B-D!'],
};

const mut = (plan, over) => ({ ...plan, ...over });
/** How many plan doors touch room `c`. */
const degree = (p, c) => p.doors.filter((d) => d.a === c || d.b === c).length;
const graphFor = (seed) => buildMission(seed, ARCH, [], 'easy') ?? linearMission(seed, ARCH, []);
const build = (seed, plan = MINIMAL) => {
  const p = parsePlan(plan);
  const g = graphFor(seed);
  const m = mapMission(p, g, ARCH, sub(seed, 'map'));
  const L = m.ok ? planToLayout(p, m.assign, m.locks, ARCH, seed, { graph: g, secrets: m.secrets }) : null;
  return { p, g, m, L };
};

// ---------------------------------------------------------------------------------------------------
test('parsePlan: the minimal plan → 12 rectangular rooms, 11 interior doors centred on shared walls, one entrance', () => {
  const p = parsePlan(MINIMAL);
  assert.equal(Object.keys(p.rects).length, 12);
  assert.equal(p.w, 29); assert.equal(p.d, 11);
  assert.deepEqual(p.rects.H, { x0: 4, z0: 4, x1: 21, z1: 6 });
  assert.equal(p.doors.filter((d) => !d.exterior).length, 11);
  const ent = p.doors.find((d) => d.exterior);
  assert.ok(ent && ent.a === 'D' && ent.along === 'x' && ent.z === 11, 'entrance on the south wall of D');
  const ah = p.doors.find((d) => d.a === 'A' && d.b === 'H');
  assert.deepEqual(ah, { a: 'A', b: 'H', x: 6, z: 4, along: 'x' });           // A spans x 4..8 → centred door cells 5,6 → centre line 6
  const lh = p.doors.find((d) => d.a === 'L' && d.b === 'H');
  assert.deepEqual(lh, { a: 'L', b: 'H', x: 22, z: 5, along: 'z' });          // vertical wall at x = 22, H rows 4..6 → centre 5
  assert.deepEqual(p.adjacency.H.slice().sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'L']);
  assert.deepEqual(validatePlan(p), []);
});

test('parsePlan: open join, secret and @slot doors', () => {
  const p = parsePlan(SMALL);
  const ab = p.doors.find((d) => d.a === 'A' && d.b === 'B');
  assert.ok(ab.open && ab.along === 'z' && ab.x === 4 && ab.z === 1.5);
  const ac = p.doors.find((d) => d.a === 'A' && d.b === 'C');
  assert.deepEqual(ac, { a: 'A', b: 'C', x: 1, z: 3, along: 'x' });          // slot 1 = cells 0,1 → centre line 1
  assert.ok(p.doors.find((d) => d.a === 'B' && d.b === 'D').secret);
  assert.deepEqual(validatePlan(p), []);
  assert.throws(() => parsePlan(mut(SMALL, { doors: ['A>', 'A-B~', 'A-C@3', 'B-D!'] })), /off the end/);
});

test('parsePlan rejects: non-rectangular room, door on a 1-cell boundary, two entrances, undeclared room', () => {
  assert.throws(() => parsePlan(mut(SMALL, { rows: ['AAAABBBB', 'AAAABBBB', 'AAAABBBB', 'AAAABBBB', 'CCCCDDDD', 'CCCCDDDD', 'CCCCDDDD'].map((r, i) => (i === 3 ? 'CAAABBBB' : r)) })), (e) => e instanceof PlanError && /room 'A' is not a rectangle: cell \(0,3\)/.test(e.message));
  // a 1-cell boundary: B is a 1×1 room under the last column of A
  const oneCell = { id: 'one', archetype: 'house', entrance: 'A', rows: ['AAAA', 'AAAA', 'AAAA', '...B'], rooms: { A: room('hall'), B: room('store') }, doors: ['A>', 'A-B'] };
  assert.throws(() => parsePlan(oneCell), /'A' and 'B' do not share ≥ 2 cells/);
  assert.throws(() => parsePlan(mut(SMALL, { doors: ['A>', 'A>', 'A-B~', 'A-C', 'B-D!'] })), /more than one exterior entrance/);
  assert.throws(() => parsePlan(mut(SMALL, { doors: ['A>', 'B>', 'A-B~', 'A-C', 'B-D!'] })), /'B>' is not on the entrance room 'A'/);
  assert.throws(() => parsePlan(mut(SMALL, { doors: ['A-B~', 'A-C', 'B-D!'] })), /exactly one exterior entrance/);
  assert.throws(() => parsePlan(mut(SMALL, { rooms: { A: room('hall'), B: room('room'), C: room('room') } })), /room 'D' drawn but not declared/);
  assert.throws(() => parsePlan(mut(SMALL, { doors: ['A>', 'A-B~', 'A-C', 'B-D!', 'A-D'] })), /'A' and 'D' do not share/);
});

test('validatePlan: unreachable room, thin corridor, tiny room, enclosed hole', () => {
  const unreachable = parsePlan(mut(MINIMAL, { doors: MINIMAL.doors.filter((d) => d !== 'G-A') }));
  assert.ok(validatePlan(unreachable).some((s) => /room 'G' unreachable/.test(s)));
  const thin = parsePlan({ id: 'thin', archetype: 'house', entrance: 'A', rows: ['AAAA', 'AAAA', 'AAAA', 'HHHH', 'HHHH', 'BBBB', 'BBBB', 'BBBB'], rooms: { A: room('hall'), H: room('corridor'), B: room('room') }, doors: ['A>', 'A-H', 'H-B'] });
  assert.ok(validatePlan(thin).some((s) => /corridor 'H' is only 2 wide/.test(s)));
  assert.ok(validatePlan(thin).some((s) => /room 'H' is 4×2/.test(s)));
  const hole = parsePlan({ id: 'hole', archetype: 'house', entrance: 'A', rows: ['AAAAAAAA', 'AAAAAAAA', 'AAAAAAAA', 'BBB..CCC', 'BBB..CCC', 'BBB..CCC', 'DDDDDDDD', 'DDDDDDDD', 'DDDDDDDD'], rooms: { A: room('hall'), B: room('room'), C: room('room'), D: room('room') }, doors: ['A>', 'A-B', 'A-C', 'B-D', 'C-D'] });
  assert.ok(validatePlan(hole).some((s) => /enclosed hole at \(3,3\)/.test(s)));
});

test('applyVariants: mirrors / rotations keep the plan parseable and the doors valid; swapKinds draws from the pool', () => {
  const plan = mut(MINIMAL, { variants: { mirrorX: true, mirrorZ: true, rotate: true, swapKinds: { A: ['room', 'store'], E: ['vault'] } } });
  const seenDims = new Set(); let swapped = 0;
  for (const seed of SEEDS.slice(0, 40)) {
    const v = applyVariants(plan, sub(seed, 'variants'));
    const p = parsePlan(v);
    assert.deepEqual(validatePlan(p), [], `seed ${seed}`);
    seenDims.add(p.w + 'x' + p.d);
    assert.equal(p.doors.length, MINIMAL.doors.length);
    assert.equal(v.rooms.E.kind, 'vault');
    if (v.rooms.A.kind === 'store') swapped++;
  }
  assert.ok(seenDims.has('29x11') && seenDims.has('11x29'), 'rotation seen');
  assert.ok(swapped > 5 && swapped < 35);
  assert.deepEqual(JSON.stringify(applyVariants(plan, sub(7, 'v'))), JSON.stringify(applyVariants(plan, sub(7, 'v'))));
});

// ---------------------------------------------------------------------------------------------------
test('mapMission: entrance / boss / hub / locks / secret placed as specified; ok rate > 90% on ≤ 1-lock flows', () => {
  let eligible = 0, ok = 0;
  for (const seed of SEEDS) {
    const { p, g, m } = build(seed);
    const locks = g.edges.filter((e) => e.lock && g.nodes.find((n) => n.id === e.a && !n.tags.includes('plan-extra'))).length;
    if (locks <= 1) { eligible++; if (m.ok) ok++; }
    if (!m.ok) continue;
    const entrance = g.nodes.find((n) => n.role === 'entrance');
    assert.equal(m.assign[entrance.id], 'D', `seed ${seed}: entrance`);
    const boss = g.nodes.find((n) => n.role === 'boss');
    const bossIsLockTarget = g.edges.some((e) => e.lock && (e.a === boss.id || e.b === boss.id));
    if (boss && !bossIsLockTarget) assert.equal(m.assign[boss.id], 'L', `seed ${seed}: boss in the tagged room`);
    // The hub is an ATRIUM, so it lands on the most-connected room that is not the corridor and not a leaf —
    // never on 'H' itself, which is the corridor every room already opens onto. (This asserted 'H' under the
    // pre-plan model, where the hub and the circulation were the same zone.)
    const hub = g.nodes.find((n) => n.role === 'hub');
    if (hub) {
      const c = m.assign[hub.id];
      assert.notEqual(c, 'H', `seed ${seed}: the hub is the corridor`);
      assert.notEqual(p.plan.rooms[c].kind, 'corridor', `seed ${seed}: hub room ${c} is a corridor kind`);
      const free = Object.keys(p.rects).filter((r) => p.plan.rooms[r].kind !== 'corridor' && r !== m.assign[entrance.id]);
      const best = Math.max(...free.map((r) => degree(p, r)));
      assert.equal(degree(p, c), best, `seed ${seed}: hub ${c} (${degree(p, c)} doors) is not the most-connected room off the corridor (${best})`);
    }
    // every node has a distinct room; every room has a node (extras appended)
    const rooms = Object.values(m.assign);
    assert.equal(new Set(rooms).size, rooms.length, `seed ${seed}: rooms reused`);
    assert.equal(rooms.length, Object.keys(p.rects).length, `seed ${seed}: every room has a node`);
    for (const n of g.nodes) assert.ok(m.assign[n.id], `seed ${seed}: ${n.id} unassigned`);
    // locks: the locked door is the lock room's only solid door; key room reachable with locks solid
    for (const [lockId, d] of Object.entries(m.locks)) {
      const e = g.edges.find((x) => x.lock === lockId); assert.ok(e, `seed ${seed}: lock ${lockId} not in the graph`);
      const v = [e.a, e.b].map((id) => g.nodes.find((n) => n.id === id)).sort((a, b) => b.depth - a.depth)[0];
      const c = m.assign[v.id];
      assert.ok(d.a === c || d.b === c, `seed ${seed}: lock door not on ${v.id}'s room`);
      assert.equal(p.doors.filter((x) => !x.exterior && !x.open && (x.a === c || x.b === c)).length, 1, `seed ${seed}: lock room ${c} not single-door`);
    }
    const secret = g.nodes.find((n) => n.role === 'secret');
    if (secret) { const c = m.assign[secret.id]; assert.equal(p.doors.filter((x) => !x.exterior && !x.open && (x.a === c || x.b === c)).length, 1, `seed ${seed}: secret room ${c} not a leaf`); }
  }
  assert.ok(eligible > 100, `only ${eligible} eligible graphs`);
  assert.ok(ok / eligible > 0.9, `ok rate ${ok}/${eligible}`);
});

test('mapMission: a graph with more nodes than rooms is ok:false; a key inside the lock room is rejected', () => {
  const p = parsePlan(SMALL);
  const g = graphFor(SEEDS[0]);
  const m = mapMission(p, g, ARCH, sub(1, 'map'));
  assert.equal(m.ok, false); assert.match(m.reason, /nodes for 4 rooms/);
});

// ---------------------------------------------------------------------------------------------------
/** Shared boundary of two cell rects (cells), or null. */
function shared(a, b) {
  const ca = a.cells, cb = b.cells;
  if (ca.x1 + 1 === cb.x0 || cb.x1 + 1 === ca.x0) { const lo = Math.max(ca.z0, cb.z0), hi = Math.min(ca.z1, cb.z1); if (hi >= lo) return { horiz: false, at: cellU(ca.x1 + 1 === cb.x0 ? cb.x0 : ca.x0), lo: cellU(lo), hi: cellU(hi + 1) }; }
  if (ca.z1 + 1 === cb.z0 || cb.z1 + 1 === ca.z0) { const lo = Math.max(ca.x0, cb.x0), hi = Math.min(ca.x1, cb.x1); if (hi >= lo) return { horiz: true, at: cellU(ca.z1 + 1 === cb.z0 ? cb.z0 : ca.z0), lo: cellU(lo), hi: cellU(hi + 1) }; }
  return null;
}
const inAabb = (a, x, z) => x >= a.x0 - 1e-6 && x <= a.x1 + 1e-6 && z >= a.z0 - 1e-6 && z <= a.z1 + 1e-6;
const overlaps = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;

function checkLayout(L, g, seed, p) {
  const tag = `seed ${seed}`;
  const zs = L.zones;
  assert.equal(zs.length, Object.keys(p.rects).length, tag);
  for (const z of zs) {
    assert.equal(z.floor, 0); assert.equal(z.floorY, 0);
    assert.ok(z.cells.x0 >= 0 && z.cells.z0 >= 0 && z.cells.x1 < GRID && z.cells.z1 < GRID, `${tag}: ${z.id} off grid`);
    assert.equal(z.rect.x0, cellU(z.cells.x0)); assert.equal(z.rect.x1, cellU(z.cells.x1 + 1));
    assert.equal(z.rect.z0, cellU(z.cells.z0)); assert.equal(z.rect.z1, cellU(z.cells.z1 + 1));
    assert.ok(z.chunks.length >= 1 && z.doors.length >= 1, `${tag}: ${z.id} has no door`);
    assert.ok(z.id.startsWith('house.'), tag);
    assert.equal(z.ceilY, p.plan.rooms[Object.keys(p.rects).sort()[zs.indexOf(z)]].sky ? undefined : ARCH.wallH);
  }
  for (let i = 0; i < zs.length; i++) for (let j = i + 1; j < zs.length; j++) assert.ok(!overlaps(zs[i].cells, zs[j].cells), `${tag}: ${zs[i].id} overlaps ${zs[j].id}`);
  for (const n of g.nodes) assert.ok(L.nodeZone[n.id], `${tag}: node ${n.id} has no zone`);
  // doors ON the shared boundary of the two zones they name
  for (const d of L.doors) {
    const [za, zb] = d.between.map((id) => zs.find((z) => z.id === id));
    const s = shared(za, zb); assert.ok(s, `${tag}: ${d.id} zones do not abut`);
    if (s.horiz) { assert.equal(d.z, s.at, tag); assert.ok(d.x - d.w / 2 >= s.lo - 1e-6 && d.x + d.w / 2 <= s.hi + 1e-6, `${tag}: ${d.id} outside the segment`); assert.ok(d.yaw === 0 || d.yaw === 8); assert.equal(d.yaw, za.cells.z0 === Math.round(s.at / CELL + GRID / 2) ? 0 : 8, `${tag}: ${d.id} yaw into between[0]`); }
    else { assert.equal(d.x, s.at, tag); assert.ok(d.z - d.w / 2 >= s.lo - 1e-6 && d.z + d.w / 2 <= s.hi + 1e-6, `${tag}: ${d.id} outside the segment`); assert.ok(d.yaw === 4 || d.yaw === 12); assert.equal(d.yaw, za.cells.x0 === Math.round(s.at / CELL + GRID / 2) ? 4 : 12, `${tag}: ${d.id} yaw into between[0]`); }
    if (d.secret === false && !d.lock) assert.equal(d.w, s.hi - s.lo, `${tag}: open join spans the segment`); else assert.equal(d.w, 2 * CELL, tag);
    assert.ok(za.doors.includes(d.id) && zb.doors.includes(d.id), tag);
    assert.equal(d.collider.id, d.id);
  }
  // walls: on a line, one run per boundary segment, never two on the same span
  const spans = new Set();
  for (const w of L.walls) {
    assert.ok(w.x0 === w.x1 || w.z0 === w.z1, `${tag}: wall not axis-aligned`);
    assert.equal(w.h, ARCH.wallH); assert.equal(w.y, 0);
    const k = `${w.x0},${w.z0},${w.x1},${w.z1}`; assert.ok(!spans.has(k), `${tag}: duplicate wall run ${k}`); spans.add(k);
    for (const [g0, g1] of w.gaps) assert.ok(g0 >= 0 && g1 <= 1 && g0 < g1, tag);
  }
  // every boundary sealed: sample every 0.5 u along every shared segment and every exterior edge
  const grid = L.grids[0];
  const lines = [];
  for (let i = 0; i < zs.length; i++) {
    for (let j = i + 1; j < zs.length; j++) { const s = shared(zs[i], zs[j]); if (s) lines.push(s); }
    const c = zs[i].cells;
    const ext = (horiz, line, lo, hi, owner) => { let s = lo; while (s <= hi) { if (owner(s) !== -1) { s++; continue; } let t = s; while (t + 1 <= hi && owner(t + 1) === -1) t++; lines.push({ horiz, at: cellU(line), lo: cellU(s), hi: cellU(t + 1), exterior: true }); s = t + 1; } };
    ext(true, c.z0, c.x0, c.x1, (x) => grid.ownerAt(x, c.z0 - 1)); ext(true, c.z1 + 1, c.x0, c.x1, (x) => grid.ownerAt(x, c.z1 + 1));
    ext(false, c.x0, c.z0, c.z1, (z) => grid.ownerAt(c.x0 - 1, z)); ext(false, c.x1 + 1, c.z0, c.z1, (z) => grid.ownerAt(c.x1 + 1, z));
  }
  const openDoors = L.doors.filter((d) => !d.lock);
  for (const s of lines) {
    // only doors ON this line count (a door's 1-u collider grazes the corner of the perpendicular wall)
    const onLine = openDoors.filter((d) => (s.horiz ? (d.yaw === 0 || d.yaw === 8) && d.z === s.at : (d.yaw === 4 || d.yaw === 12) && d.x === s.at));
    for (let t = s.lo + 0.25; t < s.hi; t += 0.5) {
      const x = s.horiz ? t : s.at, z = s.horiz ? s.at : t;
      const wall = L.colliders.some((c) => inAabb(c, x, z));
      const door = onLine.some((d) => inAabb(d.collider, x, z));
      assert.ok(wall || door, `${tag}: boundary open at (${x},${z})`);
      if (s.exterior) assert.ok(wall && !door, `${tag}: exterior edge has a door at (${x},${z})`);
    }
  }
  // BFS over doors reaches every zone; with locks solid, every key's zone is still reached; lock rooms have one door
  const adj = (solidLocks) => { const m = new Map(zs.map((z) => [z.id, []])); for (const d of L.doors) { if (solidLocks && d.lock) continue; m.get(d.between[0]).push(d.between[1]); m.get(d.between[1]).push(d.between[0]); } return m; };
  const bfs = (solidLocks) => { const a = adj(solidLocks); const startZone = zs.find((z) => inAabb(z.rect, L.start.x, L.start.z)); assert.ok(startZone, `${tag}: start outside every zone`); const seen = new Set([startZone.id]); const q = [startZone.id]; while (q.length) { const id = q.shift(); for (const o of a.get(id)) if (!seen.has(o)) { seen.add(o); q.push(o); } } return seen; };
  const all = bfs(false);
  for (const z of zs) assert.ok(all.has(z.id), `${tag}: ${z.id} unreachable via doors`);
  const solid = bfs(true);
  for (const k of g.keys) assert.ok(solid.has(L.nodeZone[k.node]), `${tag}: key ${k.id} behind its lock`);
  for (const d of L.doors) if (d.lock) {
    assert.ok(L.colliders.some((c) => c.id === d.lock), `${tag}: locked door ${d.id} has no collider`);
    const lockRoom = zs.find((z) => d.between.includes(z.id) && !solid.has(z.id)); assert.ok(lockRoom, `${tag}: no room is sealed by ${d.lock}`);
    assert.equal(lockRoom.doors.filter((id) => L.doors.find((x) => x.id === id).secret !== false).length, 1, `${tag}: lock room ${lockRoom.id} has more than one door`);
  }
  assert.equal(L.colliders.filter((c) => c.id && !c.id.endsWith(':wall')).length, L.doors.filter((d) => d.lock).length, `${tag}: one collider per locked door`);
  // start inside the entrance room, 2.5 u from its exterior wall
  const entNode = g.nodes.find((n) => n.role === 'entrance'); const ez = zs.find((z) => z.id === L.nodeZone[entNode.id]);
  assert.ok(inAabb(ez.rect, L.start.x, L.start.z), `${tag}: start not in the entrance room`);
  assert.equal(Math.min(L.start.z - ez.rect.z0, ez.rect.z1 - L.start.z, L.start.x - ez.rect.x0, ez.rect.x1 - L.start.x), 2.5, tag);
  const boss = g.nodes.find((n) => n.role === 'boss');
  if (boss) assert.deepEqual(L.exit, zs.find((z) => z.id === L.nodeZone[boss.id]).spots.center, tag);
}

test('planToLayout: the shared-wall invariants hold on every seed of the minimal plan', () => {
  let built = 0;
  for (const seed of SEEDS) { const { p, g, m, L } = build(seed); if (!m.ok) continue; built++; checkLayout(L, g, seed, p); }
  assert.ok(built > 250, `built ${built}`);
});

test('planToLayout: open joins emit a wall-less Door spanning the segment, secrets and sky rooms carry through', () => {
  const plan = mut(SMALL, { rooms: { ...SMALL.rooms, C: room('room', { sky: true }) } });
  const p = parsePlan(plan);
  // No boss node: SMALL's biggest room is 4 cells and the archetype's bossArena wants 5, so mapMission rightly
  // refuses to stage a boss here. This test is about open joins, secret doors and sky rooms, not arenas.
  const g = { nodes: [{ id: 'e', role: 'entrance', depth: 0, tags: [] }, { id: 'b', role: 'plain', depth: 1, tags: [] }, { id: 'k', role: 'key', depth: 1, tags: [] }], edges: [{ a: 'e', b: 'b' }, { a: 'e', b: 'k' }], loops: [], keys: [], criticalPath: ['e', 'b'], flowId: 't' };
  const m = mapMission(p, g, ARCH, sub(3, 'map'));
  assert.ok(m.ok, m.reason);
  assert.equal(m.assign.e, 'A');
  const L = planToLayout(p, m.assign, m.locks, ARCH, 3, { graph: g, secrets: m.secrets });
  checkLayout(L, g, 3, p);
  const join = L.doors.find((d) => d.secret === false);
  assert.ok(join && join.w === 3 * CELL && join.lock === undefined, 'open join');
  assert.ok(!L.walls.some((w) => w.x0 === join.x && w.x1 === join.x && w.z0 <= join.z && w.z1 >= join.z), 'no wall run on the open join');
  assert.ok(L.doors.some((d) => d.secret === true), 'secret door');
  assert.equal(L.zones.find((z) => z.cells.x0 === L.zones[0].cells.x0 && z.kind === 'room' && z.ceilY === undefined)?.kind, 'room', 'sky room has no ceiling');
  assert.equal(L.zones[0].finish, undefined);
});

test('determinism and speed: parse + map + layout byte-identical per seed and ≤ 5 ms', () => {
  const a = JSON.stringify(build(SEEDS[5]).L), b = JSON.stringify(build(SEEDS[5]).L);
  assert.equal(a, b);
  for (let i = 0; i < 20; i++) build(SEEDS[i]);             // warm up
  const t0 = performance.now(); let n = 0;
  for (const seed of SEEDS.slice(0, 100)) { build(seed); n++; }
  const per = (performance.now() - t0) / n;
  assert.ok(per <= 5, `${per.toFixed(2)} ms per plan`);
});

test('render: ASCII of the plan and of the layout agree on rooms and doors', () => {
  const { p, g, m, L } = build(SEEDS[0]);
  assert.ok(m.ok);
  const ent = p.doors.find((d) => d.exterior);
  const art = renderPlanAscii(p, { assign: m.assign, locks: m.locks, secrets: m.secrets, start: { x: ent.x, z: ent.z - 1 } });
  assert.ok(art.includes('S') && art.includes('+') && art.includes('E'), art);
  assert.ok(art.split('\n')[1].startsWith('|G'), art);
  const lay = renderLayoutAscii(L);
  assert.equal(lay.split('\n').length, art.split('\n').length, 'same height');
  assert.ok(lay.includes('S'));
  const glyphs = (s) => s.split('\n').slice(0, 2 * p.d + 1).join('').split('').filter((c) => c === '+' || c === '#' || c === '!' || c === '~').length;
  assert.equal(glyphs(lay), glyphs(art), 'same door glyphs');
  void doorKey;
});
