// The BUILDING / CASTLE embedder contract (SHARED-WALL, SINGLE STOREY): 300 seeds × house / school / shop / haunted /
// hospital / prison (embedBuilding) and castle (embedCastle) with graphs from buildMission (linearMission when pacing
// rejects). Every node has a zone; every zone is on floor 0 with no stairs; no two zone rects overlap; every room has a
// door; every door lies ON the shared boundary of the zones it names (2 cells = 10 u centred on the shared wall, or an
// open join spanning the whole segment); one WallRun per boundary segment, none on open joins, never overlapping;
// colliders + door gaps seal every boundary; BFS over doors from the entrance reaches every zone; lock rooms have
// exactly one door; THE OWNER'S STANDARD — rooms ≥ 4×4 (service 3×3), corridors ≥ 3 wide, footprint aspect ≤ 2,
// every building different from the last; determinism; ≤ 15 ms per embed.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { embedBuilding, DOOR_W, lastFail } from '../packages/core/src/composer/embedBuilding.ts';
import { embedCastle, lastFail as castleFail } from '../packages/core/src/composer/embedCastle.ts';
import { ARCHETYPES } from '../packages/core/src/composer/archetypes/index.ts';
import { buildMission, linearMission } from '../packages/core/src/composer/mission.ts';
import { CELL, GRID } from '../packages/core/src/composer/types.ts';

const IDS = ['house', 'school', 'shop', 'haunted', 'hospital', 'prison', 'castle'];
const SEEDS = Array.from({ length: 300 }, (_, i) => 1000 + i * 7919);
const cellU = (c) => (c - GRID / 2) * CELL;
const graphFor = (seed, arch) => buildMission(seed, arch, [], seed % 2 ? 'hard' : 'easy') ?? linearMission(seed, arch, []);
const embed = (id, g, seed, arch) => (id === 'castle' ? embedCastle(g, seed, arch) : embedBuilding(g, seed, arch));
const failOf = (id) => (id === 'castle' ? castleFail : lastFail);
const overlaps = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;
const near = (a, b) => Math.abs(a - b) < 1e-6;
const isHall = (z) => z.role === 'corridor' || z.tags.includes('hall') || z.tags.includes('corridor');
const isOpen = (d) => d.secret === false;                      // an open join: no wall, the door spans the whole shared segment
const lineOf = (w) => (near(w.z0, w.z1) ? { horiz: true, at: w.z0, lo: w.x0, hi: w.x1 } : { horiz: false, at: w.x0, lo: w.z0, hi: w.z1 });
const DXZ = { 0: [0, 1], 4: [1, 0], 8: [0, -1], 12: [-1, 0] };

/** Shared cell edge length between two cell rects, and the boundary line (u). */
function shared(a, b) {
  const ca = a.cells, cb = b.cells;
  if (ca.x1 + 1 === cb.x0 || cb.x1 + 1 === ca.x0) { const lo = Math.max(ca.z0, cb.z0), hi = Math.min(ca.z1, cb.z1); if (hi >= lo) return { horiz: false, at: cellU(ca.x1 + 1 === cb.x0 ? cb.x0 : ca.x0), lo: cellU(lo), hi: cellU(hi + 1), cells: hi - lo + 1 }; }
  if (ca.z1 + 1 === cb.z0 || cb.z1 + 1 === ca.z0) { const lo = Math.max(ca.x0, cb.x0), hi = Math.min(ca.x1, cb.x1); if (hi >= lo) return { horiz: true, at: cellU(ca.z1 + 1 === cb.z0 ? cb.z0 : ca.z0), lo: cellU(lo), hi: cellU(hi + 1), cells: hi - lo + 1 }; }
  return null;
}
/** Zone graph reachability over doors from the entrance. */
function reach(L) {
  const adj = new Map(L.zones.map((z) => [z.id, new Set()]));
  for (const d of L.doors) { adj.get(d.between[0]).add(d.between[1]); adj.get(d.between[1]).add(d.between[0]); }
  const entrance = L.zones.find((z) => z.role === 'entrance');
  const seen = new Set([entrance.id]); const q = [entrance.id];
  while (q.length) { const id = q.shift(); for (const n of adj.get(id)) if (!seen.has(n)) { seen.add(n); q.push(n); } }
  return seen;
}
// a door's opening runs along x when its yaw is ±z (0 / 8): it sits on a horizontal (z = const) line
const doorHoriz = (d) => d.yaw === 0 || d.yaw === 8;
const doorCovers = (d, e, hi) => doorHoriz(d) === e.horiz && (e.horiz ? near(d.z, e.at) && d.x - d.w / 2 <= e.lo + 1e-6 && d.x + d.w / 2 >= hi - 1e-6 : near(d.x, e.at) && d.z - d.w / 2 <= e.lo + 1e-6 && d.z + d.w / 2 >= hi - 1e-6);

for (const id of IDS) {
  const arch = ARCHETYPES[id];
  test(`${id}: every seed embeds — single storey, rects, doors on shared walls, the owner's sizes`, () => {
    for (const seed of SEEDS) {
      const g = graphFor(seed, arch); const w = `${id} seed ${seed} (${g.flowId})`;
      const L = embed(id, g, seed, arch);
      assert.ok(L, `${w}: embed returned null (${failOf(id)})`);
      for (const n of g.nodes) assert.ok(L.nodeZone[n.id] && L.zones.some((z) => z.id === L.nodeZone[n.id]), `${w}: node ${n.id} (${n.role}) has no zone`);
      const byId = new Map(L.zones.map((z) => [z.id, z]));
      assert.deepEqual(Object.keys(L.grids), ['0'], `${w}: more than one floor`);
      for (const z of L.zones) {
        assert.equal(z.floor, 0); assert.equal(z.floorY, 0); assert.ok(!z.stairs, `${w}: ${z.id} has stairs`);
        assert.ok(z.cells.x0 >= 1 && z.cells.z0 >= 1 && z.cells.x1 <= GRID - 2 && z.cells.z1 <= GRID - 2, `${w}: ${z.id} outside the grid margin`);
        assert.equal(z.rect.x0, cellU(z.cells.x0)); assert.equal(z.rect.x1, cellU(z.cells.x1 + 1)); assert.equal(z.rect.z0, cellU(z.cells.z0)); assert.equal(z.rect.z1, cellU(z.cells.z1 + 1));
        assert.ok(z.chunks.length >= 1);
        const wd = z.cells.x1 - z.cells.x0 + 1, dp = z.cells.z1 - z.cells.z0 + 1;
        assert.ok(wd <= 40 && dp <= 40, `${w}: ${z.id} too big`);
        // the owner's standard: corridors ≥ 3 wide; rooms ≥ 4×4, service rooms / towers 3×3
        if (z.tags.includes('corridor')) assert.ok(Math.min(wd, dp) >= 3, `${w}: corridor ${z.id} is ${wd}×${dp}`);
        else if (!z.tags.includes('hall')) assert.ok(Math.min(wd, dp) >= (z.tags.includes('service') || z.tags.includes('tower') ? 3 : 4), `${w}: ${z.id} (${z.role}) is ${wd}×${dp}`);
        if (isHall(z)) continue;
        assert.ok(z.doors.length >= 1, `${w}: ${z.id} (${z.role}) has no door`);
      }
      for (let i = 0; i < L.zones.length; i++) for (let j = i + 1; j < L.zones.length; j++) assert.ok(!overlaps(L.zones[i].cells, L.zones[j].cells), `${w}: ${L.zones[i].id} overlaps ${L.zones[j].id}`);
      // doors: on the shared boundary line of the two zones, within both extents, w = 10 (or the whole segment), yaw into between[0]
      for (const d of L.doors) {
        const a = byId.get(d.between[0]), b = byId.get(d.between[1]);
        assert.ok(a && b && a !== b, `${w}: door ${d.id} names ${d.between}`);
        assert.equal(d.floor, 0);
        const s = shared(a, b); assert.ok(s, `${w}: door ${d.id} between ${a.id} and ${b.id} which do not abut`);
        if (isOpen(d)) { assert.ok(near(d.w, s.hi - s.lo), `${w}: open join ${d.id} does not span its segment`); assert.ok(!d.lock && d.secret === false); }
        else { assert.equal(d.w, DOOR_W); assert.ok(s.cells >= 2, `${w}: door ${d.id} on a ${s.cells}-cell wall`); }
        if (s.horiz) { assert.ok(near(d.z, s.at) && d.x - d.w / 2 >= s.lo - 1e-6 && d.x + d.w / 2 <= s.hi + 1e-6, `${w}: door ${d.id} off its wall`); assert.ok(d.yaw === (a.rect.z1 === s.at ? 8 : 0), `${w}: door ${d.id} yaw ${d.yaw}`); }
        else { assert.ok(near(d.x, s.at) && d.z - d.w / 2 >= s.lo - 1e-6 && d.z + d.w / 2 <= s.hi + 1e-6, `${w}: door ${d.id} off its wall`); assert.ok(d.yaw === (a.rect.x1 === s.at ? 12 : 4), `${w}: door ${d.id} yaw ${d.yaw}`); }
        // centred on the shared wall (within half a cell)
        if (!isOpen(d)) { const c = s.horiz ? d.x : d.z; assert.ok(Math.abs(c - (s.lo + s.hi) / 2) <= CELL / 2 + 1e-6, `${w}: door ${d.id} not centred on its wall`); }
        assert.ok(a.doors.includes(d.id) && b.doors.includes(d.id));
        assert.equal(d.collider.floor, 0);
        if (d.lock) assert.ok(L.colliders.some((c) => c.id === d.lock && c.x0 === d.collider.x0 && c.z0 === d.collider.z0), `${w}: locked door ${d.id} has no lock collider`);
      }
      assert.ok(!L.doors.some((d) => d.between[0] === d.between[1]), `${w}: self-door`);
      // entrance: tagged, start inside it ≥ 2.5 u from its walls, facing its first door
      const ez = L.zones.find((z) => z.role === 'entrance');
      assert.ok(ez && ez.tags.includes('entrance'), `${w}: entrance tag`);
      const s = L.start;
      assert.ok(s.x >= ez.rect.x0 + 2.5 && s.x <= ez.rect.x1 - 2.5 && s.z >= ez.rect.z0 + 2.5 && s.z <= ez.rect.z1 - 2.5 && s.floor === 0, `${w}: start (${s.x}, ${s.z}) not inside the entrance ${JSON.stringify(ez.rect)}`);
      const ed = L.doors.find((d) => d.id === ez.doors[0]); const [fx, fz] = DXZ[s.yaw];
      assert.ok(ed && fx * (ed.x - s.x) + fz * (ed.z - s.z) > 0, `${w}: start does not face its first door`);
    }
  });

  test(`${id}: walls — one run per boundary segment, none on open joins, no overlaps, colliders + gaps seal every boundary`, () => {
    for (const seed of SEEDS) {
      const g = graphFor(seed, arch); const w = `${id} seed ${seed} (${g.flowId})`;
      const L = embed(id, g, seed, arch);
      const runs = L.walls.map((r) => ({ ...lineOf(r), r }));
      for (const r of runs) assert.ok(r.hi > r.lo && r.r.h >= arch.wallH && r.r.y === 0 && r.r.floor === 0, `${w}: degenerate run`);
      for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i], b = runs[j];
        if (a.horiz !== b.horiz || !near(a.at, b.at)) continue;
        assert.ok(a.hi <= b.lo + 1e-6 || b.hi <= a.lo + 1e-6, `${w}: runs overlap on ${a.horiz ? 'z' : 'x'}=${a.at}: [${a.lo},${a.hi}] [${b.lo},${b.hi}]`);
      }
      const wallCols = L.colliders.filter((c) => c.id && c.id.endsWith(':wall'));
      for (const z of L.zones) {
        const c = z.cells; const edges = [];
        for (let x = c.x0; x <= c.x1; x++) { edges.push({ horiz: true, at: cellU(c.z0), lo: cellU(x) }); edges.push({ horiz: true, at: cellU(c.z1 + 1), lo: cellU(x) }); }
        for (let zz = c.z0; zz <= c.z1; zz++) { edges.push({ horiz: false, at: cellU(c.x0), lo: cellU(zz) }); edges.push({ horiz: false, at: cellU(c.x1 + 1), lo: cellU(zz) }); }
        for (const e of edges) {
          const hi = e.lo + CELL;
          const covering = runs.filter((r) => r.horiz === e.horiz && near(r.at, e.at) && r.lo <= e.lo + 1e-6 && r.hi >= hi - 1e-6);
          const solid = wallCols.some((k) => (e.horiz ? near(k.z0, e.at - 0.5) && k.x0 <= e.lo + 1e-6 && k.x1 >= hi - 1e-6 : near(k.x0, e.at - 0.5) && k.z0 <= e.lo + 1e-6 && k.z1 >= hi - 1e-6));
          const doors = L.doors.filter((d) => doorCovers(d, e, hi));
          const openJoin = doors.some(isOpen), open = doors.length > 0;
          if (openJoin) { assert.equal(covering.length, 0, `${w}: ${z.id} open join at ${e.horiz ? 'z' : 'x'}=${e.at} has a wall run`); assert.ok(!solid, `${w}: ${z.id} open join is walled`); continue; }
          assert.equal(covering.length, 1, `${w}: ${z.id} edge ${e.horiz ? 'z' : 'x'}=${e.at} [${e.lo},${hi}] covered by ${covering.length} runs`);
          assert.ok(solid !== open, `${w}: ${z.id} edge ${e.horiz ? 'z' : 'x'}=${e.at} [${e.lo},${hi}] is ${solid ? 'walled AND a door' : 'neither wall nor door'}`);
          const run = covering[0]; const len = run.hi - run.lo;
          const inGap = run.r.gaps.some(([t0, t1]) => run.lo + t0 * len <= e.lo + 1e-6 && run.lo + t1 * len >= hi - 1e-6);
          assert.equal(inGap, open, `${w}: ${z.id} run gap mismatch at ${e.horiz ? 'z' : 'x'}=${e.at} [${e.lo},${hi}]`);
        }
      }
      for (const k of wallCols) assert.ok(near(k.x1 - k.x0, 1) || near(k.z1 - k.z0, 1), `${w}: wall collider not 1 u thick`);
    }
  });

  test(`${id}: connectivity, locks, secrets, determinism, variety, speed`, () => {
    let ms = 0; let lastSig = '';
    for (const seed of SEEDS) {
      const g = graphFor(seed, arch); const w = `${id} seed ${seed} (${g.flowId})`;
      const t0 = performance.now(); const L = embed(id, g, seed, arch); ms += performance.now() - t0;
      const seen = reach(L);
      for (const z of L.zones) assert.ok(seen.has(z.id), `${w}: ${z.id} (${z.role}) unreachable over doors`);
      // locks: a lock edge lands on exactly one door and the room behind it has only that door; a second lock into a
      // room that already carries one (two locked edges into one node) stays unplaced — its key opens nothing
      const lockEdges = g.edges.filter((e) => e.lock);
      const byId = new Map(L.zones.map((z) => [z.id, z]));
      for (const e of lockEdges) {
        const ds = L.doors.filter((d) => d.lock === e.lock);
        const a = g.nodes.find((n) => n.id === e.a), b = g.nodes.find((n) => n.id === e.b);
        const deep = b.depth >= a.depth ? b : a; const dz = byId.get(L.nodeZone[deep.id]);
        if (isHall(dz)) continue;                                   // a lock into the hall itself has nowhere to go
        if (!ds.length) { const other = dz.doors.map((id) => L.doors.find((d) => d.id === id)).find((d) => d.lock && d.lock !== e.lock); assert.ok(other, `${w}: lock ${e.lock} on 0 doors and ${dz.id} carries no other lock`); continue; }
        assert.equal(ds.length, 1, `${w}: lock ${e.lock} on ${ds.length} doors`);
        const room = byId.get(ds[0].between[0]);
        assert.equal(room.id, dz.id, `${w}: lock ${e.lock} enters ${room.id}, not ${dz.id}`);
        assert.equal(room.doors.length, 1, `${w}: locked room ${room.id} has ${room.doors.length} doors`);
      }
      for (const d of L.doors) if (d.lock) assert.ok(lockEdges.some((e) => e.lock === d.lock), `${w}: stray lock ${d.lock}`);
      const secret = g.nodes.find((n) => n.role === 'secret');
      if (secret) { const sz = byId.get(L.nodeZone[secret.id]); assert.equal(sz.doors.length, 1, `${w}: secret ${sz.id} has ${sz.doors.length} doors`); assert.ok(L.doors.find((d) => d.id === sz.doors[0]).secret, `${w}: secret door not flagged`); }
      const boss = g.nodes.find((n) => n.role === 'boss');
      if (boss) { const bz = byId.get(L.nodeZone[boss.id]); if (!isHall(bz)) { assert.equal(bz.doors.length, 1, `${w}: boss ${bz.id} has ${bz.doors.length} doors`); const side = Math.min(bz.cells.x1 - bz.cells.x0 + 1, bz.cells.z1 - bz.cells.z0 + 1); assert.ok(side >= arch.bossArena.minCells, `${w}: boss side ${side} < ${arch.bossArena.minCells}`); } }
      // the exit: the exit node's room, else the boss
      const exitNode = g.nodes.find((n) => n.role === 'exit') ?? boss;
      if (exitNode) { const xz = byId.get(L.nodeZone[exitNode.id]); assert.ok(L.exit && L.exit.x === xz.spots.center.x && L.exit.z === xz.spots.center.z, `${w}: exit is not in ${xz.id}`); }
      // determinism
      const again = embed(id, graphFor(seed, arch), seed, arch);
      const key = (X) => JSON.stringify({ z: X.zones, d: X.doors, w: X.walls, c: X.colliders, s: X.start, e: X.exit, n: X.nodeZone });
      assert.equal(key(again), key(L), `${w}: not deterministic`);
      // every building different from the last
      const sig = L.zones.map((z) => `${z.kind}:${z.cells.x0},${z.cells.z0},${z.cells.x1},${z.cells.z1}`).join('|');
      assert.notEqual(sig, lastSig, `${w}: identical to the previous seed`); lastSig = sig;
    }
    const avg = ms / SEEDS.length;
    console.log(`  ${id.padEnd(9)} avg ${avg.toFixed(2)} ms/embed`);
    assert.ok(avg < 15, `${id}: ${avg.toFixed(1)} ms per embed ≥ 15 ms`);
  });
}

test('footprint: aspect ≤ 2, ≤ 40 cells a side (castles 44 with towers), centred, corridors along the long axis', () => {
  for (const id of IDS) for (const seed of SEEDS.slice(0, 80)) {
    const arch = ARCHETYPES[id]; const g = graphFor(seed, arch); const L = embed(id, g, seed, arch);
    const x0 = Math.min(...L.zones.map((z) => z.cells.x0)), x1 = Math.max(...L.zones.map((z) => z.cells.x1));
    const z0 = Math.min(...L.zones.map((z) => z.cells.z0)), z1 = Math.max(...L.zones.map((z) => z.cells.z1));
    const T = x1 - x0 + 1, W = z1 - z0 + 1;
    assert.ok(Math.max(T, W) <= (id === 'castle' ? 44 : 40), `${id} ${seed}: ${T}×${W}`);
    assert.ok(Math.max(T, W) / Math.min(T, W) <= 2 + 1e-9, `${id} ${seed}: aspect ${(T / W).toFixed(2)} (${T}×${W})`);
    assert.ok(Math.abs((x0 + x1) / 2 - GRID / 2) <= 1.5 && Math.abs((z0 + z1) / 2 - GRID / 2) <= 1.5, `${id} ${seed}: not centred`);
    const corridors = L.zones.filter((z) => z.tags.includes('corridor'));
    for (const c of corridors) assert.ok(Math.min(c.cells.x1 - c.cells.x0 + 1, c.cells.z1 - c.cells.z0 + 1) >= 3, `${id} ${seed}: corridor ${c.id} narrower than 3`);
  }
});
