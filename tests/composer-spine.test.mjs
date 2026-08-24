// The SPINE embedder contract: 300 seeds × the generic house archetype with an inline mission
// builder. Every zone inside the grid, no overlaps, every mission edge realised by a door or the
// corridor, BFS from start reaches every zone (across floors via stairs), door cells touch both
// zones they name, wall gaps line up with door cells, determinism.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { embedSpine, FLOOR_H } from '../packages/core/src/composer/embedSpine.ts';
import { genericArchetype } from '../packages/core/src/composer/archetypes/generic.ts';
import { CELL, GRID } from '../packages/core/src/composer/types.ts';
import { FLOOR, DOOR, STAIRS } from '../packages/core/src/composer/grid.ts';
import { sub } from '../packages/core/src/composer/rng.ts';

const ARCH = genericArchetype('house', 'house', 'spine');

/** Tiny mission builder: a generic flow, BFS depths, a lock on the edge into the lock node,
 *  a secret leaf, and (by seed) an attic and/or basement node. */
function mission(seed, arch = ARCH) {
  const rng = sub(seed, 'mission');
  const flow = rng.pick(arch.flows);
  const nodes = flow.nodes.map((n) => ({ ...n, depth: 0, tags: [] }));
  const edges = flow.edges.map(([a, b]) => ({ a, b }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (rng.chance(0.7)) { const off = nodes.find((n) => n.role === 'plain'); nodes.push({ id: 'sec', role: 'secret', depth: 0, tags: [] }); edges.push({ a: off.id, b: 'sec', secret: true }); }
  if (rng.chance(0.5)) { const off = nodes.find((n) => n.role === 'hub') ?? nodes.find((n) => n.role === 'rest'); nodes.push({ id: 'npc', role: 'npc', depth: 0, tags: [] }); edges.push({ a: off.id, b: 'npc' }); }
  // depths by BFS from the entrance
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
  const seen = new Set(['n0']); const q = ['n0']; const prev = new Map();
  while (q.length) { const id = q.shift(); for (const o of adj.get(id)) if (!seen.has(o)) { seen.add(o); prev.set(o, id); byId.set(o, nodes.find((n) => n.id === o)); nodes.find((n) => n.id === o).depth = nodes.find((n) => n.id === id).depth + 1; q.push(o); } }
  const lockNode = nodes.find((n) => n.role === 'lock');
  for (const e of edges) if (e.b === lockNode.id && e.a === prev.get(lockNode.id)) e.lock = 'lock#1';
  if (seed % 2 === 0) nodes.find((n) => n.role === 'rest').floor = 1;
  if (seed % 3 === 0) nodes.find((n) => n.role === 'key').floor = -1;
  const boss = nodes.find((n) => n.role === 'boss');
  const criticalPath = []; for (let id = boss.id; id; id = prev.get(id)) criticalPath.unshift(id);
  return { nodes, edges, loops: flow.loops, keys: [{ id: 'k1', item: 'core_key', node: nodes.find((n) => n.role === 'key').id, opens: 'lock#1' }], criticalPath, flowId: flow.id };
}

const SEEDS = Array.from({ length: 300 }, (_, i) => 1000 + i * 7919);

const overlaps = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;
const inRect = (c, x, z) => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1;
const touches = (c, x, z) => (x >= c.x0 && x <= c.x1 && (z === c.z0 - 1 || z === c.z1 + 1)) || (z >= c.z0 && z <= c.z1 && (x === c.x0 - 1 || x === c.x1 + 1));

test('spine embeds every seed: rects inside the grid, no overlaps, all doors touch both zones', () => {
  for (const seed of SEEDS) {
    const g = mission(seed);
    const L = embedSpine(g, seed, ARCH);
    assert.ok(L, `seed ${seed}: embed returned null`);
    for (const z of L.zones) {
      assert.ok(z.cells.x0 >= 0 && z.cells.z0 >= 0 && z.cells.x1 < GRID && z.cells.z1 < GRID, `seed ${seed}: ${z.id} outside grid`);
      assert.equal(z.rect.x0, (z.cells.x0 - GRID / 2) * CELL);
      assert.equal(z.rect.x1, (z.cells.x1 + 1 - GRID / 2) * CELL);
      assert.equal(z.floorY, z.floor * FLOOR_H);
      assert.equal(z.ceilY, z.floorY + 14);
      assert.ok(z.chunks.length >= 1 && z.doors.length + (z.floor !== 0 ? 1 : 0) >= 1, `seed ${seed}: ${z.id} has no door`);
      assert.ok(z.id.startsWith('house.'));
    }
    for (let i = 0; i < L.zones.length; i++) for (let j = i + 1; j < L.zones.length; j++) {
      const a = L.zones[i], b = L.zones[j]; if (a.floor !== b.floor) continue;
      assert.ok(!overlaps(a.cells, b.cells), `seed ${seed}: ${a.id} overlaps ${b.id}`);
    }
    for (const n of g.nodes) assert.ok(L.nodeZone[n.id], `seed ${seed}: node ${n.id} has no zone`);
    for (const d of L.doors) {
      const [za, zb] = d.between.map((id) => L.zones.find((z) => z.id === id));
      assert.ok(za && zb, `seed ${seed}: door ${d.id} names unknown zones`);
      const grid = L.grids[d.floor]; const di = Number(d.id.slice(5));
      let cells = 0;
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) if (grid.get(x, z) === DOOR && grid.ownerAt(x, z) === di) {
        cells++;
        assert.ok(touches(za.cells, x, z) && touches(zb.cells, x, z), `seed ${seed}: door cell (${x},${z}) of ${d.id} not adjacent to both ${za.id} and ${zb.id}`);
      }
      assert.equal(cells, 2, `seed ${seed}: ${d.id} has ${cells} cells`);
      assert.equal(d.w, 2 * CELL);
      assert.ok(za.doors.includes(d.id) && zb.doors.includes(d.id));
    }
    // every room has exactly one door onto the spine (zones[0]); extra doors only between side-by-side ribs
    const corridor = L.zones[0];
    for (const z of L.zones.slice(1)) { if (z.floor !== 0) continue; assert.equal(L.doors.filter((d) => d.between[0] === z.id && d.between[1] === corridor.id).length, 1, `seed ${seed}: ${z.id} spine doors`); }
  }
});

test('mission edges are realised, locks land on doors, floors connect through stairs', () => {
  for (const seed of SEEDS) {
    const g = mission(seed);
    const L = embedSpine(g, seed, ARCH);
    const corridor = L.zones[0];
    const zoneOf = (id) => L.zones.find((z) => z.id === L.nodeZone[id]);
    const stairsInto = (z) => L.zones.find((s) => s.stairs && s.stairs.to === z.floor && inRect(z.rect, (s.stairs.steps[3].x0 + s.stairs.steps[3].x1) / 2, (s.stairs.steps[3].z0 + s.stairs.steps[3].z1) / 2));
    const onCorridor = (z) => z === corridor || L.doors.some((d) => d.between.includes(z.id) && d.between.includes(corridor.id)) || (z.floor !== 0 && onCorridor(stairsInto(z)));
    for (const e of g.edges) {
      const a = zoneOf(e.a), b = zoneOf(e.b);
      const direct = L.doors.find((d) => d.between.includes(a.id) && d.between.includes(b.id));
      assert.ok(direct || (onCorridor(a) && onCorridor(b)), `seed ${seed}: edge ${e.a}-${e.b} unrealised`);
      if (e.lock) {
        const deep = a.depth >= b.depth && a !== b ? a : b;
        const target = deep.floor === 0 ? deep : stairsInto(deep);
        const door = L.doors.find((d) => d.lock === e.lock);
        assert.ok(door && door.between[0] === target.id, `seed ${seed}: lock not on ${target.id}'s door`);
        assert.ok(L.colliders.some((c) => c.id === door.id), `seed ${seed}: locked door has no collider`);
      }
    }
    for (const z of L.zones) if (z.floor !== 0) {
      const s = stairsInto(z);
      assert.ok(s, `seed ${seed}: ${z.id} on floor ${z.floor} has no stairs`);
      assert.equal(s.stairs.steps[0].y, 0); assert.equal(s.stairs.steps[3].y, z.floorY);
      for (let k = 1; k < 4; k++) assert.ok(Math.abs(s.stairs.steps[k].y - s.stairs.steps[k - 1].y) <= 1.5);
      assert.ok(L.grids[z.floor].get(s.cells.x0, s.stairs.to > 0 ? s.cells.z0 : s.cells.z0) !== undefined);
    }
    assert.ok(L.doors.some((d) => d.secret) === g.edges.some((e) => e.secret), `seed ${seed}: secret flag`);
  }
});

test('BFS over FLOOR/DOOR/STAIRS cells from start reaches every zone, across floors', () => {
  for (const seed of SEEDS) {
    const g = mission(seed);
    const L = embedSpine(g, seed, ARCH);
    const sx = Math.floor(L.start.x / CELL) + GRID / 2, sz = Math.floor(L.start.z / CELL) + GRID / 2;
    assert.equal(L.grids[0].get(sx, sz), FLOOR, `seed ${seed}: start not on a floor cell`);
    assert.equal(L.grids[0].ownerAt(sx, sz), 1);
    const key = (f, x, z) => `${f},${x},${z}`;
    const seen = new Set([key(0, sx, sz)]); const q = [[0, sx, sz]]; const reached = new Set([1]);
    while (q.length) {
      const [f, x, z] = q.shift(); const grid = L.grids[f];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, st = grid.get(nx, nz);
        if (st !== FLOOR && st !== DOOR && st !== STAIRS) continue;
        const k = key(f, nx, nz); if (seen.has(k)) continue; seen.add(k); q.push([f, nx, nz]);
        if (st !== DOOR) reached.add(grid.ownerAt(nx, nz));
        if (st === STAIRS) {
          const zone = L.zones[grid.ownerAt(nx, nz)]; const to = zone.stairs.to;
          if (L.grids[to]?.get(nx, nz) === FLOOR) { const k2 = key(to, nx, nz); if (!seen.has(k2)) { seen.add(k2); q.push([to, nx, nz]); reached.add(L.grids[to].ownerAt(nx, nz)); } }
        }
      }
    }
    for (let i = 0; i < L.zones.length; i++) assert.ok(reached.has(i), `seed ${seed}: ${L.zones[i].id} unreachable`);
    // exit sits in the hub (hubAtEnd), which is the last critical-path node
    const hub = L.zones.find((z) => z.id === L.nodeZone[g.criticalPath.at(-1)]);
    assert.deepEqual(L.exit, hub.spots.center);
    assert.equal(L.start.yaw, 4);
  }
});

test('wall gaps line up with door cells and colliders cover every non-gap segment', () => {
  for (const seed of SEEDS) {
    const g = mission(seed);
    const L = embedSpine(g, seed, ARCH);
    assert.equal(L.walls.length, L.zones.length * 4);
    for (const w of L.walls) {
      assert.equal(w.h, ARCH.wallH);
      const horiz = w.z0 === w.z1; const len = horiz ? w.x1 - w.x0 : w.z1 - w.z0;
      for (const [t0, t1] of w.gaps) {
        assert.ok(t0 >= 0 && t1 <= 1 && t1 > t0);
        const u0 = (horiz ? w.x0 : w.z0) + t0 * len, u1 = (horiz ? w.x0 : w.z0) + t1 * len;
        assert.ok(Math.abs(u1 - u0 - 2 * CELL) < 1e-9, `seed ${seed}: gap ${u1 - u0} u`);
        // gap → door cells on the far side of this wall line
        const grid = L.grids[w.floor];
        const c0 = Math.round(u0 / CELL) + GRID / 2, line = Math.round((horiz ? w.z0 : w.x0) / CELL) + GRID / 2;
        const hasDoor = [line - 1, line].some((row) => grid.get(horiz ? c0 : row, horiz ? row : c0) === DOOR);
        assert.ok(hasDoor, `seed ${seed}: wall gap without a door cell`);
      }
    }
    // each door with 2 zones produced exactly 2 gaps (one per zone wall)
    const gaps = L.walls.reduce((n, w) => n + w.gaps.length, 0);
    assert.equal(gaps, L.doors.length * 2, `seed ${seed}: gaps ${gaps} vs doors ${L.doors.length}`);
    for (const c of L.colliders) { assert.ok(c.x1 > c.x0 && c.z1 > c.z0); assert.ok(Math.abs((c.x1 - c.x0) - 1) < 1e-9 || Math.abs((c.z1 - c.z0) - 1) < 1e-9, 'collider 1 u thick'); }
    const expected = L.walls.reduce((n, w) => n + w.gaps.length + 1 - (w.gaps[0]?.[0] === 0 ? 1 : 0) - (w.gaps.at(-1)?.[1] === 1 ? 1 : 0), 0) + L.doors.filter((d) => d.lock).length;
    assert.equal(L.colliders.length, expected, `seed ${seed}: colliders`);
  }
});

test('byte-deterministic per seed, different across seeds', () => {
  const a = JSON.stringify(embedSpine(mission(42), 42, ARCH), (k, v) => (v instanceof Uint8Array || v instanceof Int16Array ? Array.from(v) : v));
  const b = JSON.stringify(embedSpine(mission(42), 42, ARCH), (k, v) => (v instanceof Uint8Array || v instanceof Int16Array ? Array.from(v) : v));
  assert.equal(a, b);
  const c = JSON.stringify(embedSpine(mission(43), 43, ARCH), (k, v) => (v instanceof Uint8Array || v instanceof Int16Array ? Array.from(v) : v));
  assert.notEqual(a, c);
});

test('spine variants: doubleLoaded, concourse, oneBigRoom, no hubAtEnd', () => {
  const variants = [
    { len: [4, 6], ribs: [1, 2], hubAtEnd: true, doubleLoaded: true },
    { len: [6, 8], ribs: [1, 2], hubAtEnd: true, concourse: true, doubleLoaded: true },
    { len: [4, 6], ribs: [1, 2], hubAtEnd: true, oneBigRoom: true },
    { len: [4, 6], ribs: [1, 2] },
  ];
  for (const spine of variants) {
    const arch = { ...genericArchetype('shop', 'house', 'spine'), spine };
    for (const seed of SEEDS.slice(0, 40)) {
      const g = mission(seed, arch); const L = embedSpine(g, seed, arch);
      assert.ok(L, `variant ${JSON.stringify(spine)} seed ${seed} null`);
      for (let i = 0; i < L.zones.length; i++) for (let j = i + 1; j < L.zones.length; j++) if (L.zones[i].floor === L.zones[j].floor) assert.ok(!overlaps(L.zones[i].cells, L.zones[j].cells));
      if (spine.concourse) assert.equal(L.zones[0].cells.z1 - L.zones[0].cells.z0 + 1, 3);
      if (spine.oneBigRoom) assert.equal(L.zones[0].role, 'boss');
      for (const n of g.nodes) assert.ok(L.nodeZone[n.id]);
    }
  }
});
