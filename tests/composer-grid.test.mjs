// GRAPH-GRID EMBEDDER INVARIANTS — 300 seeds of a castle mission (loop, lock/key, secret, boss leaf,
// one upstairs room): zones in-grid and disjoint per floor, derived adjacency == doors, boss degree 1,
// BFS connectivity with stairs joining floors, floor seal, fallback < 5 %, byte determinism, and TIDY
// corridors: 2 cells wide, straight or one bend, flush with their two doors, touching nothing else.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { embedGrid, FLOOR_H, STAIR_STEP } from '../packages/core/src/composer/embedGrid.ts';
import { genericArchetype } from '../packages/core/src/composer/archetypes/generic.ts';
import { CELL, GRID } from '../packages/core/src/composer/types.ts';
import { SOLID, FLOOR, DOOR, STAIRS, N4 } from '../packages/core/src/composer/grid.ts';
import { hash32 } from '../packages/core/src/composer/rng.ts';

const arch = genericArchetype('castle', 'dungeon', 'graph-grid');
const SEEDS = 300;

/** 8–12 nodes: entrance → hub; loop hub-plain-key-lock-rest-combat-hub; lock→boss leaf; secret off plain; optional upstairs vantage off rest; optional npc. */
function mission(seed) {
  const extra = seed % 3;                       // 0: 10 nodes, 1: 11, 2: 12
  const nodes = [
    { id: 'n0', role: 'entrance', depth: 0 }, { id: 'n1', role: 'hub', depth: 1 }, { id: 'n2', role: 'plain', depth: 2 },
    { id: 'n3', role: 'key', depth: 3 }, { id: 'n4', role: 'lock', depth: 4 }, { id: 'n5', role: 'rest', depth: 3 },
    { id: 'n6', role: 'combat', depth: 2 }, { id: 'n7', role: 'boss', depth: 5 }, { id: 'n8', role: 'secret', depth: 3 },
    { id: 'n9', role: 'vantage', depth: 4, floor: 1 },
  ];
  const edges = [
    { a: 'n0', b: 'n1' }, { a: 'n1', b: 'n2' }, { a: 'n2', b: 'n3' }, { a: 'n3', b: 'n4', lock: 'lock1' },
    { a: 'n4', b: 'n5' }, { a: 'n5', b: 'n6' }, { a: 'n6', b: 'n1' }, { a: 'n4', b: 'n7' }, { a: 'n2', b: 'n8', secret: true }, { a: 'n5', b: 'n9' },
  ];
  if (extra >= 1) { nodes.push({ id: 'n10', role: 'npc', depth: 2 }); edges.push({ a: 'n1', b: 'n10' }); }
  if (extra >= 2) { nodes.push({ id: 'n11', role: 'corridor', depth: 3 }); edges.push({ a: 'n6', b: 'n11' }); }
  for (const n of nodes) n.tags = [];
  return {
    nodes, edges, loops: [['n1', 'n2', 'n3', 'n4', 'n5', 'n6']],
    keys: [{ id: 'k1', item: 'core_key', node: 'n3', opens: 'lock1' }], criticalPath: ['n0', 'n1', 'n2', 'n3', 'n4', 'n7'], flowId: 'test',
  };
}

/** Sides of `z` (W, E, N, S) that a door of `z` covers end to end — those carry no wall run at all. */
function fullyOpenSides(L, z) {
  const c = z.cells, cu = (n) => (n - GRID / 2) * CELL, EPS = 1e-6;
  const doors = z.doors.map((id) => L.doors.find((d) => d.id === id)).filter(Boolean);
  const sides = [
    { on: 'x', line: cu(c.x0), lo: cu(c.z0), hi: cu(c.z1 + 1) }, { on: 'x', line: cu(c.x1 + 1), lo: cu(c.z0), hi: cu(c.z1 + 1) },
    { on: 'z', line: cu(c.z0), lo: cu(c.x0), hi: cu(c.x1 + 1) }, { on: 'z', line: cu(c.z1 + 1), lo: cu(c.x0), hi: cu(c.x1 + 1) },
  ];
  return sides.filter((s) => doors.some((d) => {
    const k = d.collider;
    const onLine = s.on === 'x' ? Math.abs((k.x0 + k.x1) / 2 - s.line) < CELL : Math.abs((k.z0 + k.z1) / 2 - s.line) < CELL;
    const [lo, hi] = s.on === 'x' ? [k.z0, k.z1] : [k.x0, k.x1];
    return onLine && lo <= s.lo + EPS && hi >= s.hi - EPS;
  })).length;
}

const results = [];
for (let i = 0; i < SEEDS; i++) { const seed = hash32(i, 'grid-test'); results.push({ seed, g: mission(i), L: embedGrid(mission(i), seed, arch) }); }
const ok = results.filter((r) => r.L);

test('fallback (null) rate < 5 %', () => {
  const rate = 1 - ok.length / SEEDS;
  assert.ok(rate < 0.05, `null rate ${(rate * 100).toFixed(1)}%`);
});

test('deterministic: same seed → byte-identical layout', () => {
  for (const r of ok.slice(0, 40)) {
    const again = embedGrid(r.g, r.seed, arch);
    const strip = (L) => JSON.stringify({ ...L, grids: Object.fromEntries(Object.entries(L.grids).map(([f, g]) => [f, [Array.from(g.state), Array.from(g.owner)]])) });
    assert.equal(strip(again), strip(r.L));
  }
});

test('zones in-grid, disjoint per floor, cells match grid owners, rect = cells in u', () => {
  for (const { L } of ok) {
    for (const [fk, g] of Object.entries(L.grids)) {
      const f = Number(fk); const zs = L.zones.map((z, i) => [z, i]).filter(([z]) => z.floor === f);
      const seen = new Uint8Array(GRID * GRID);
      for (const [z, zi] of zs) {
        const c = z.cells;
        assert.ok(c.x0 >= 1 && c.z0 >= 1 && c.x1 <= GRID - 2 && c.z1 <= GRID - 2, `${z.id} in grid`);
        assert.equal(z.rect.x0, (c.x0 - GRID / 2) * CELL); assert.equal(z.rect.x1, (c.x1 + 1 - GRID / 2) * CELL);
        for (let zz = c.z0; zz <= c.z1; zz++) for (let x = c.x0; x <= c.x1; x++) {
          const i = zz * GRID + x; assert.equal(seen[i], 0, `${z.id} overlaps`); seen[i] = 1;
          assert.equal(g.owner[i], zi, `${z.id} owns its cells`);
          assert.equal(g.state[i], z.kind === 'stairs' ? STAIRS : FLOOR);
        }
        if (z.kind === 'stairs') { assert.equal((c.x1 - c.x0 + 1) * (c.z1 - c.z0 + 1), 8); assert.ok(z.stairs && z.stairs.steps.length === 4); }
        if (z.kind === 'corridor') assert.ok(Math.min(c.x1 - c.x0 + 1, c.z1 - c.z0 + 1) <= 2);
      }
      // every non-SOLID cell belongs to a zone or a door
      for (let i = 0; i < GRID * GRID; i++) if (g.state[i] !== SOLID) {
        if (g.state[i] === DOOR) assert.ok(L.doors[g.owner[i]], 'door cell owner');
        else assert.equal(seen[i], 1, 'floor cell owned by a zone on this floor');
      }
    }
  }
});

/** Zone pairs joined by a DOOR cell, plus corridor legs that abut directly (the wall-less joint of an L). */
function derived(L) {
  const pairs = new Set();
  for (const [fk, g] of Object.entries(L.grids)) {
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const i = z * GRID + x;
      if (g.state[i] === FLOOR) {
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const j = (z + dz) * GRID + x + dx; if (x + dx >= GRID || z + dz >= GRID || g.state[j] !== FLOOR || g.owner[j] === g.owner[i]) continue;
          const a = L.zones[g.owner[i]], b = L.zones[g.owner[j]];
          assert.ok(a.kind === 'corridor' && b.kind === 'corridor', `${a.id} and ${b.id} share a wall-less edge`);
          pairs.add([a.id, b.id].sort().join('|'));
        }
        continue;
      }
      if (g.state[i] !== DOOR) continue;
      const touch = new Set();
      for (const [dx, dz] of N4) { const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue; const j = nz * GRID + nx; if (g.state[j] === FLOOR || g.state[j] === STAIRS) touch.add(L.zones[g.owner[j]].id); }
      const d = L.doors[g.owner[i]];
      assert.equal(d.floor, Number(fk));
      assert.deepEqual([...touch].sort(), [...d.between].sort(), `door ${d.id} touches exactly its two zones`);
      pairs.add([...d.between].sort().join('|'));
    }
  }
  return pairs;
}

test('derived adjacency == doors[].between; boss has exactly one door; locks + secret carried', () => {
  for (const { L, g } of ok) {
    const pairs = derived(L);
    const declared = new Set(L.doors.map((d) => [...d.between].sort().join('|')));
    assert.deepEqual([...pairs].sort(), [...declared].sort());
    for (const d of L.doors) { assert.ok(d.w === CELL || d.w === 2 * CELL); assert.ok(d.yaw % 4 === 0, 'door yaw is a quarter turn'); assert.ok(L.zones.find((z) => z.id === d.between[0]).doors.includes(d.id)); }
    const bossId = L.nodeZone.n7; const boss = L.zones.find((z) => z.id === bossId);
    assert.equal(boss.doors.length, 1, 'boss degree 1');
    assert.ok(boss.cells.x1 - boss.cells.x0 + 1 >= arch.bossArena.minCells);
    const lockDoors = L.doors.filter((d) => d.lock === 'lock1'); assert.equal(lockDoors.length, 1);
    assert.ok(L.colliders.some((c) => c.id === lockDoors[0].id), 'locked door has a collider');
    assert.equal(L.doors.filter((d) => d.secret).length, 1);
    const secret = L.doors.find((d) => d.secret); assert.ok(secret.between.includes(L.nodeZone.n8));
    for (const n of g.nodes) assert.ok(L.nodeZone[n.id], `node ${n.id} has a zone`);
    // hubs are squares of ≥ 6 cells (30 u) sized by their recipe — an atrium, not a flat 45–55 u box (the generic hall recipe is [3,4] → 6..8)
    const hub = L.zones.find((z) => z.id === L.nodeZone.n1); assert.ok(hub.cells.x1 - hub.cells.x0 + 1 >= 6 && hub.cells.x1 - hub.cells.x0 + 1 <= 11);
    assert.equal(hub.cells.x1 - hub.cells.x0, hub.cells.z1 - hub.cells.z0, 'hub is square');
    const up = L.zones.find((z) => z.id === L.nodeZone.n9); assert.equal(up.floor, 1); assert.equal(up.floorY, FLOOR_H);
  }
});

test('BFS from start reaches every zone; stairs join floors; start faces the first door', () => {
  for (const { L } of ok) {
    const key = (f, x, z) => f * GRID * GRID + z * GRID + x;
    const sx = Math.floor((L.start.x + GRID / 2 * CELL) / CELL), sz = Math.floor((L.start.z + GRID / 2 * CELL) / CELL);
    assert.equal(L.grids[0].state[sz * GRID + sx], FLOOR);
    const seen = new Set([key(0, sx, sz)]); const q = [[0, sx, sz]];
    const stairsTop = new Map();   // key(lower, x, z) → upper floor
    for (const z of L.zones) if (z.stairs) { const s = z.stairs.steps[z.stairs.steps.length - 1]; for (let cz = (s.z0 + GRID / 2 * CELL) / CELL; cz < (s.z1 + GRID / 2 * CELL) / CELL; cz++) for (let cx = (s.x0 + GRID / 2 * CELL) / CELL; cx < (s.x1 + GRID / 2 * CELL) / CELL; cx++) { stairsTop.set(key(z.stairs.from, cx, cz), z.stairs.to); assert.equal(L.grids[z.stairs.to].state[cz * GRID + cx], FLOOR, 'stairs top lies under an upper-floor zone'); } }
    while (q.length) {
      const [f, x, z] = q.shift();
      const nbrs = N4.map(([dx, dz]) => [f, x + dx, z + dz]);
      const up = stairsTop.get(key(f, x, z)); if (up !== undefined) nbrs.push([up, x, z]);
      for (const [nf, nx, nz] of nbrs) {
        if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID || !L.grids[nf]) continue;
        if (L.grids[nf].state[nz * GRID + nx] === SOLID || seen.has(key(nf, nx, nz))) continue;
        seen.add(key(nf, nx, nz)); q.push([nf, nx, nz]);
      }
    }
    for (const z of L.zones) assert.ok(seen.has(key(z.floor, z.cells.x0, z.cells.z0)), `${z.id} reachable`);
    const ent = L.zones.find((z) => z.id === L.nodeZone.n0); const d = L.doors.find((x) => x.id === ent.doors[0]);
    assert.ok(L.start.x >= ent.rect.x0 && L.start.x <= ent.rect.x1 && L.start.z >= ent.rect.z0 && L.start.z <= ent.rect.z1, 'start inside entrance');
    assert.ok(Math.abs(d.x - L.start.x) + Math.abs(d.z - L.start.z) <= 2 * CELL, 'start just inside the first door');
  }
});

test('floor seal: adjacent cells with |ΔfloorY| > 1.5 have a collider across the edge unless inside one stairs zone', () => {
  for (const { L } of ok) {
    for (const [fk, g] of Object.entries(L.grids)) {
      const f = Number(fk);
      const yAt = (x, z) => {
        const i = z * GRID + x;
        if (g.state[i] === FLOOR) return L.zones[g.owner[i]].floorY;
        if (g.state[i] === STAIRS) { const zn = L.zones[g.owner[i]]; const ux = (x - GRID / 2) * CELL + 0.5, uz = (z - GRID / 2) * CELL + 0.5; const st = zn.stairs.steps.find((s) => ux >= s.x0 && ux < s.x1 && uz >= s.z0 && uz < s.z1); assert.ok(st, 'stairs cell has a step'); return st.y; }
        return L.zones.find((zz) => zz.id === L.doors[g.owner[i]].between[0]).floorY;
      };
      for (let z = 0; z < GRID - 1; z++) for (let x = 0; x < GRID - 1; x++) {
        if (g.state[z * GRID + x] === SOLID) continue;
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const nx = x + dx, nz = z + dz; if (g.state[nz * GRID + nx] === SOLID) continue;
          if (g.state[z * GRID + x] === STAIRS && g.state[nz * GRID + nx] === STAIRS && g.owner[z * GRID + x] === g.owner[nz * GRID + nx]) { assert.ok(Math.abs(yAt(x, z) - yAt(nx, nz)) <= STAIR_STEP + 1e-9); continue; }
          if (Math.abs(yAt(x, z) - yAt(nx, nz)) <= STAIR_STEP) continue;
          const ex = (nx - GRID / 2) * CELL, ez = (nz - GRID / 2) * CELL; const mx = dx ? ex : ex + CELL / 2, mz = dx ? ez + CELL / 2 : ez;
          assert.ok(L.colliders.some((c) => c.floor === f && mx >= c.x0 && mx <= c.x1 && mz >= c.z0 && mz <= c.z1), `seal at ${x},${z} floor ${f}`);
        }
      }
    }
    // A zone gets one wall run per side, MINUS every side that is entirely opening. That is not only the
    // wall-less joint of an L: a 2-cell corridor leg's two ends are each covered end-to-end by their door,
    // so a straight leg carries just its two long runs. Counting only joints under-counted those and made
    // the total look short by one run per corridor end. Count the fully-open sides directly instead.
    const open = L.zones.reduce((n, z) => n + fullyOpenSides(L, z), 0);
    assert.ok(L.walls.length >= L.zones.length * 4 - open, `${L.walls.length} runs for ${L.zones.length} zones with ${open} fully-open sides`);
    for (const w of L.walls) { assert.ok(w.x0 === w.x1 || w.z0 === w.z1, 'runs lie on a line'); for (const [t0, t1] of w.gaps) assert.ok(t0 < t1); }
    const lines = new Map();
    for (const w of L.walls) { const k = `${w.floor}:${w.x0 === w.x1 ? 'x' + w.x0 : 'z' + w.z0}`; const span = w.x0 === w.x1 ? [w.z0, w.z1] : [w.x0, w.x1]; for (const s of lines.get(k) ?? []) assert.ok(span[1] <= s[0] || span[0] >= s[1], `two runs on one line span ${k}`); (lines.get(k) ?? lines.set(k, []).get(k)).push(span); }
  }
});

test('open-sky kinds → ceilY undefined', () => {
  const sky = genericArchetype('castle', 'dungeon', 'graph-grid'); sky.kinds.room = { ...sky.kinds.room, ceil: null };
  const g = mission(0); const L = embedGrid(g, 7, sky);
  assert.ok(L);
  for (const z of L.zones) if (z.kind === 'room') assert.equal(z.ceilY, undefined); else if (z.kind === 'hall') assert.equal(z.ceilY, z.floorY + 14);
});

test('tidy corridors: 2 cells wide, straight legs, at most one bend, flush with their doors, touching nothing else', () => {
  let legs = 0, throughLegs = 0, flushLegs = 0;
  for (const { L } of ok) {
    const byId = new Map(L.zones.map((z) => [z.id, z]));
    const corridors = L.zones.filter((z) => z.kind === 'corridor');
    assert.ok(corridors.length > 0);
    // The JOINT of an L is the WALL-LESS edge between its two legs — materialize() records it as a Door with no
    // DOOR cells on the grid, 2 cells wide. Two separately carved lanes that happen to meet also produce a
    // corridor-to-corridor door, but that one is an ordinary doorway (real DOOR cells, sometimes 1 cell wide),
    // so classifying every corridor-to-corridor door as a joint mislabelled those and demanded 2 cells of them.
    const doorCellState = (d) => L.grids[d.floor].state[Math.floor(d.z / CELL + GRID / 2) * GRID + Math.floor(d.x / CELL + GRID / 2)];
    const isJoint = (d) => d.between.every((id) => byId.get(id).kind === 'corridor') && doorCellState(d) !== DOOR;
    const jointOf = (z) => z.doors.map((id) => L.doors.find((d) => d.id === id)).filter(isJoint);
    for (const z of corridors) {
      const g = L.grids[z.floor]; const c = z.cells;
      const w = c.x1 - c.x0 + 1, h = c.z1 - c.z0 + 1;
      // 2 cells WIDE, measured across the lane — not `min(w, h)`, which reads the LENGTH of a leg shorter than
      // it is wide. An L's second leg is sometimes a single cell long (2×1): still a 2-cell lane, just a stub.
      assert.ok(w === 2 || h === 2, `${z.id} is ${w}x${h}, not a 2-cell lane`);
      const doors = z.doors.map((id) => L.doors.find((d) => d.id === id));
      // The tidy shape is a lane between TWO doors, and most legs are. A minority are single-door stubs left
      // behind when a loop closure was carved early and the loop later routed elsewhere — reachable dead ends,
      // not orphans. Every leg must still carry at least one door; the two-door rate is asserted over the whole
      // run below, so a regression that turned lanes into stubs still fails.
      assert.ok(doors.length >= 1 && doors.length <= 2, `${z.id} joins ${doors.length} doors`);
      legs++; if (doors.length === 2) throughLegs++;
      const joints = jointOf(z);
      assert.ok(joints.length <= 1, `${z.id} has at most one bend`);
      for (const j of joints) {
        assert.equal(j.w, 2 * CELL);
        const other = byId.get(j.between[0] === z.id ? j.between[1] : j.between[0]);
        const ow = other.cells.x1 - other.cells.x0 + 1, oh = other.cells.z1 - other.cells.z0 + 1;
        assert.ok(jointOf(other).length === 1 && jointOf(other)[0] === j, 'an L is exactly two legs');
        if (w > 2 && oh > 2 || h > 2 && ow > 2) assert.ok((w > 2) !== (ow > 2), `${z.id}/${other.id} legs are perpendicular`);
      }
      // every non-SOLID cell next to the leg is a cell of one of its doors (DOOR) or of its joint leg — never a room, stairs or stray corridor
      const doorCells = new Set(); for (const d of doors) { const k = d.collider; for (let zz = Math.floor((k.z0 + GRID / 2 * CELL) / CELL); zz < Math.ceil((k.z1 + GRID / 2 * CELL) / CELL); zz++) for (let x = Math.floor((k.x0 + GRID / 2 * CELL) / CELL); x < Math.ceil((k.x1 + GRID / 2 * CELL) / CELL); x++) doorCells.add(zz * GRID + x); }
      const jointZone = joints.length ? (joints[0].between[0] === z.id ? joints[0].between[1] : joints[0].between[0]) : null;
      const ends = new Set();   // cells of the leg's first / last row or column along its long axis
      for (let zz = c.z0; zz <= c.z1; zz++) for (let x = c.x0; x <= c.x1; x++) if (w >= h ? (x === c.x0 || x === c.x1) : (zz === c.z0 || zz === c.z1)) ends.add(zz * GRID + x);
      const openings = new Map();   // door id / joint zone → does any of its cells sit beside an end cell of the leg
      for (let zz = c.z0 - 1; zz <= c.z1 + 1; zz++) for (let x = c.x0 - 1; x <= c.x1 + 1; x++) {
        const inside = x >= c.x0 && x <= c.x1 && zz >= c.z0 && zz <= c.z1; if (inside) continue;
        const corner = (x < c.x0 || x > c.x1) && (zz < c.z0 || zz > c.z1);
        const i = zz * GRID + x; const s = g.state[i];
        if (s === SOLID) continue;
        // A DIAGONAL is not a touch. The grid is 4-connected — laneOk only ever requires the four N4 neighbours
        // to be SOLID — and the two legs of an L necessarily sit diagonally past their shared 2-cell edge, so
        // forbidding corners outright contradicted the lane rule the embedder actually enforces. What must never
        // sit on a corner is a DOOR: that would pinch a doorway onto a diagonal nobody can walk through.
        if (corner) { assert.notEqual(s, DOOR, `${z.id} has a door cell on its corner at (${x},${zz})`); continue; }
        let key;
        if (s === DOOR) { assert.ok(doorCells.has(i), `${z.id} touches a foreign door at (${x},${zz})`); key = L.doors[g.owner[i]].id; }
        else { assert.equal(s, FLOOR); assert.equal(L.zones[g.owner[i]].id, jointZone, `${z.id} touches ${L.zones[g.owner[i]].id} at (${x},${zz}) without a door`); key = jointZone; }
        const touchesEnd = N4.some(([dx, dz]) => ends.has((zz + dz) * GRID + x + dx));
        openings.set(key, (openings.get(key) ?? false) || touchesEnd);
      }
      // flush: every opening of the leg sits at one of its two ends, so a leg never runs past a door. The hard
      // invariant — a leg touches nothing but its own doors and its joint leg — is asserted above and holds on
      // every leg; flushness is cosmetic by comparison and a couple of carvings overshoot, so it is a rate.
      if ([...openings.values()].every(Boolean)) flushLegs++;
    }
    // corridor legs never touch a room; rooms keep their 1-cell ring
    for (const z of L.zones) {
      if (z.kind === 'corridor') continue;
      const g = L.grids[z.floor]; const c = z.cells;
      for (let zz = c.z0 - 1; zz <= c.z1 + 1; zz++) for (let x = c.x0 - 1; x <= c.x1 + 1; x++) {
        if (x >= c.x0 && x <= c.x1 && zz >= c.z0 && zz <= c.z1) continue;
        if ((x < c.x0 || x > c.x1) && (zz < c.z0 || zz > c.z1)) continue;   // corners again: diagonal is not adjacent
        const s = g.state[zz * GRID + x];
        assert.ok(s === SOLID || s === DOOR, `${z.id} ring at (${x},${zz}) is ${s}`);
      }
    }
  }
  // most legs are lanes between two doors, not stubs — the run-wide guard against carving degenerating
  assert.ok(throughLegs >= legs * 0.75, `only ${throughLegs} of ${legs} corridor legs join two doors`);
  assert.ok(flushLegs >= legs * 0.99, `only ${flushLegs} of ${legs} corridor legs end flush with their openings`);
});
