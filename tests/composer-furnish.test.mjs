// furnish(): per-zone furnishing, spots and default people over a hand-built EmbeddedLayout.
// 200 seeds: blocking AABBs never overlap, never sit in a door keep-out, every spot is standable,
// doors reach each other on the dilated grid, hide/loot minima hold, people have routes, and the
// plan is byte-deterministic from the seed.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import '../packages/core/src/props/index.ts';                       // registers every prop family
import { furnish } from '../packages/core/src/composer/furnish.ts';
import { genericArchetype } from '../packages/core/src/composer/archetypes/generic.ts';
import { CellGrid, FLOOR, DOOR } from '../packages/core/src/composer/grid.ts';

const ARCH = genericArchetype('house', 'house', 'spine');
const RES = 0.5;

/** 4 rooms (15–30 u) + a 10 u corridor, 4 doors, one floor. */
function makeLayout() {
  const zone = (id, kind, role, rect, doors) => ({
    id, name: kind, kind, role, depth: 0, rect,
    cells: { x0: rect.x0 / 5, z0: rect.z0 / 5, x1: rect.x1 / 5 - 1, z1: rect.z1 / 5 - 1 },
    floor: 0, floorY: 0, ceilY: 14, doors,
    spots: { center: { x: 0, z: 0, yaw: 0, floor: 0 }, npc: [], loot: [], hide: [] },
    chunks: [], tags: [],
  });
  const door = (id, x, z, yaw, between) => ({ id, x, z, yaw, w: 9, between, floor: 0, collider: { x0: x - 0.5, z0: z - 0.5, x1: x + 0.5, z1: z + 0.5, floor: 0 } });
  const zones = [
    zone('house.hall#1', 'hall', 'entrance', { x0: 0, z0: 0, x1: 20, z1: 20 }, ['d1', 'd3']),
    zone('house.corridor#1', 'corridor', 'corridor', { x0: 20, z0: 5, x1: 30, z1: 15 }, ['d1', 'd2']),
    zone('house.store#1', 'store', 'key', { x0: 30, z0: 0, x1: 50, z1: 25 }, ['d2']),
    zone('house.great#1', 'great', 'boss', { x0: 0, z0: 20, x1: 30, z1: 50 }, ['d3', 'd4']),
    zone('house.room#1', 'room', 'npc', { x0: 30, z0: 25, x1: 50, z1: 45 }, ['d4']),
  ];
  const doors = [
    door('d1', 20, 10, 4, ['house.hall#1', 'house.corridor#1']),
    door('d2', 30, 10, 4, ['house.corridor#1', 'house.store#1']),
    door('d3', 10, 20, 0, ['house.hall#1', 'house.great#1']),
    door('d4', 30, 35, 4, ['house.great#1', 'house.room#1']),
  ];
  const g = new CellGrid();
  zones.forEach((z, i) => g.fill(z.cells.x0, z.cells.z0, z.cells.x1, z.cells.z1, FLOOR, i));
  doors.forEach((d, i) => g.set(Math.floor(d.x / 5), Math.floor(d.z / 5), DOOR, i));
  return { grids: { 0: g }, zones, doors, walls: [], colliders: [], start: { x: 10, z: 5, yaw: 0, floor: 0 }, nodeZone: {} };
}

const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const d2 = (x, z, r) => { const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0; const dz = z < r.z0 ? r.z0 - z : z > r.z1 ? z - r.z1 : 0; return dx * dx + dz * dz; };
const inRect = (p, r, m = 0) => p.x >= r.x0 - m && p.x <= r.x1 + m && p.z >= r.z0 - m && p.z <= r.z1 + m;

/** Door centre, inward unit normal and the point just inside the zone. */
function doorSide(zone, door) {
  const r = zone.rect;
  const dist = [Math.abs(door.z - r.z0), Math.abs(door.x - r.x1), Math.abs(door.z - r.z1), Math.abs(door.x - r.x0)];
  let wall = 0; for (let k = 1; k < 4; k++) if (dist[k] < dist[wall]) wall = k;
  const [ix, iz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][wall];
  return { px: door.x, pz: door.z, ix, iz, inner: [door.x + ix * 1, door.z + iz * 1] };
}
function doorGapRect(zone, door) {
  const s = doorSide(zone, door); const w = door.w / 2;
  return s.ix !== 0
    ? { x0: Math.min(s.px, s.px + s.ix * 3), x1: Math.max(s.px, s.px + s.ix * 3), z0: s.pz - w, z1: s.pz + w }
    : { z0: Math.min(s.pz, s.pz + s.iz * 3), z1: Math.max(s.pz, s.pz + s.iz * 3), x0: s.px - w, x1: s.px + w };
}

/** Independent dilated BFS: a 0.5 u cell is passable iff no blocked cell centre lies within 1.5 u. */
function reaches(zone, boxes, from, to) {
  const r = zone.rect; const W = Math.round((r.x1 - r.x0) / RES), H = Math.round((r.z1 - r.z0) / RES);
  const blocked = new Uint8Array(W * H), pass = new Uint8Array(W * H).fill(1);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = r.x0 + (i + 0.5) * RES, z = r.z0 + (j + 0.5) * RES;
    if (boxes.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) blocked[j * W + i] = 1;
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (blocked[j * W + i]) for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
    if (di * di + dj * dj > 9) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; pass[nj * W + ni] = 0;
  }
  const cell = ([x, z]) => [Math.min(W - 1, Math.max(0, Math.floor((x - r.x0) / RES))), Math.min(H - 1, Math.max(0, Math.floor((z - r.z0) / RES)))];
  const [si, sj] = cell(from), [ti, tj] = cell(to);
  const seen = new Uint8Array(W * H); const q = [sj * W + si]; seen[q[0]] = 1;
  if (!pass[q[0]]) return false;
  for (let h = 0; h < q.length; h++) {
    const k = q[h], i = k % W, j = (k / W) | 0;
    if (i === ti && j === tj) return true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const nk = nj * W + ni; if (seen[nk] || !pass[nk]) continue; seen[nk] = 1; q.push(nk); }
  }
  return false;
}

function run(seed, opts) { const layout = makeLayout(); const res = furnish(layout, ARCH, seed, opts); return { layout, res }; }

test('200 seeds: placements, keep-outs, spots, connectivity, minima and people', () => {
  let totalPlacements = 0, totalPeople = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { layout, res } = run(seed);
    totalPlacements += res.placements.length; totalPeople += res.people.length;
    const corridor = layout.zones.find((z) => z.kind === 'corridor');
    for (const zone of layout.zones) {
      const tag = `seed ${seed} ${zone.id}`;
      const recipe = ARCH.kinds[zone.kind];
      const boxes = res.colliders.filter((c) => c.id.startsWith(zone.id + ':'));
      const zonePl = res.placements.filter((p) => p.zone === zone.id);
      assert.equal(boxes.length, zonePl.filter((p) => p.collide).length, `${tag}: one collider per blocking placement`);
      for (const p of zonePl) assert.ok(inRect(p, zone.rect), `${tag}: placement ${p.prop} outside the zone`);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlaps(boxes[i], boxes[j]), `${tag}: ${boxes[i].id} overlaps ${boxes[j].id}`);
      for (const id of zone.doors) {
        const door = layout.doors.find((d) => d.id === id); const s = doorSide(zone, door); const gap = doorGapRect(zone, door);
        for (const b of boxes) {
          assert.ok(d2(s.px, s.pz, b) >= 4 - 1e-9, `${tag}: ${b.id} inside the r 2 fan of ${id}`);
          assert.ok(!overlaps(gap, b), `${tag}: ${b.id} inside the 3 u gap of ${id}`);
        }
      }
      const S = zone.spots;
      const standable = (s, r) => inRect(s, zone.rect) && boxes.every((b) => d2(s.x, s.z, b) >= r * r - 1e-9);
      for (const s of [...S.npc, ...S.loot, ...(S.work ?? []), ...(S.checkpoint ?? []), ...(S.claim ?? [])]) assert.ok(standable(s, 2.2), `${tag}: spot ${JSON.stringify(s)} not standable at 2.2`);
      for (const s of S.hide) assert.ok(standable(s, 1.4), `${tag}: hide spot ${JSON.stringify(s)} not standable at 1.4`);
      // door-to-door on the dilated grid, and every door reaches every spot
      const inners = zone.doors.map((id) => doorSide(zone, layout.doors.find((d) => d.id === id)).inner);
      for (let i = 0; i < inners.length; i++) for (let j = i + 1; j < inners.length; j++) assert.ok(reaches(zone, boxes, inners[i], inners[j]), `${tag}: doors ${i}→${j} disconnected`);
      for (const s of [...S.npc, ...S.loot, ...S.hide]) assert.ok(reaches(zone, boxes, inners[0], [s.x, s.z]), `${tag}: spot ${JSON.stringify(s)} unreachable from the door`);
      assert.ok(S.hide.length >= recipe.hideMin, `${tag}: hide ${S.hide.length} < ${recipe.hideMin}`);
      assert.ok(S.loot.length >= recipe.lootMin, `${tag}: loot ${S.loot.length} < ${recipe.lootMin}`);
      if (recipe.npcStand) assert.ok(S.npc.length >= 1, `${tag}: no npc spot`);
      if (zone.role === 'boss') { assert.ok(S.arena && S.arena.r >= 3, `${tag}: no arena`); assert.ok(zonePl.some((p) => p.role === 'quest' && p.collide), `${tag}: no cover pillar`); }
      const people = res.people.filter((p) => p.zone === zone.id);
      if (!recipe.npcStand && zone.role !== 'entrance') assert.equal(people.length, 0, `${tag}: people in a no-stand zone`);
      for (const p of people) {
        assert.ok(p.route.length >= 3 && p.route.length <= 6, `${tag}: ${p.id} route ${p.route.length}`);
        assert.ok(standable(p.spot, 2.2), `${tag}: ${p.id} spot not standable`);
        for (const pt of p.route) assert.ok(inRect(pt, zone.rect) || (corridor && inRect(pt, corridor.rect)), `${tag}: ${p.id} route point ${JSON.stringify(pt)} outside zone/corridor`);
        assert.ok(p.lines.length >= 2 && p.lines.every((l) => ARCH.chatter.includes(l)), `${tag}: ${p.id} lines`);
      }
      assert.deepEqual(S.routes, people.map((p) => p.route), `${tag}: zone.spots.routes mirror people`);
    }
    assert.ok(res.people.some((p) => p.zone === 'house.hall#1'), `seed ${seed}: the entrance has an inhabitant`);
    const key = res.keys.find((k) => k.zone === 'house.store#1');
    assert.ok(key && key.item === ARCH.lockKit.key, `seed ${seed}: key zone yields the lock kit key`);
    assert.ok(res.lights.length >= 3, `seed ${seed}: lights ${res.lights.length}`);
    for (const l of res.lights) assert.ok(l.y > 0 && l.priority >= 1, `seed ${seed}: light ${JSON.stringify(l)}`);
  }
  assert.ok(totalPlacements / 200 >= 8, `avg placements ${totalPlacements / 200}`);
  assert.ok(totalPeople / 200 >= 1, `avg people ${totalPeople / 200}`);
});

test('deterministic from the seed; different seeds differ', () => {
  const a = run(7), b = run(7), c = run(8);
  assert.equal(JSON.stringify(a.res), JSON.stringify(b.res));
  assert.equal(JSON.stringify(a.layout.zones.map((z) => z.spots)), JSON.stringify(b.layout.zones.map((z) => z.spots)));
  assert.notEqual(JSON.stringify(a.res.placements), JSON.stringify(c.res.placements));
});

test('anchorsOnly skips wall packing, surfaces and clutter but keeps guarantees', () => {
  const { layout, res } = run(3, { anchorsOnly: true });
  assert.ok(res.placements.every((p) => p.role !== 'wall' && p.role !== 'surface' && p.role !== 'clutter'));
  for (const z of layout.zones) { const r = ARCH.kinds[z.kind]; assert.ok(z.spots.hide.length >= r.hideMin && z.spots.loot.length >= r.lootMin, z.id); }
});

test('no trig or Math.random in furnish.ts', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../packages/core/src/composer/furnish.ts', import.meta.url), 'utf8');
  for (const bad of ['Math.random', 'Math.sin', 'Math.cos', 'Math.atan2', 'Math.sqrt', 'Math.hypot', 'from \'three\'']) assert.ok(!src.includes(bad), bad);
});

// ARRIVAL ROOM. A player who enters a building through a lot door lands on map.start with the
// exit portal behind them (Game.lotExitSpot hunts 3.6–7 u to the rear). The owner was boxed in by
// furniture on arrival — "I come out of the portal and cannot go anywhere". Every layout must keep
// the landing standable at 2.2 u AND leave at least one standable exit spot behind the start.
import * as THREE3 from 'three';
import { compose as composeAll, ARCHETYPES as ARCHS, archetypeIds as archIds } from '../packages/core/src/composer/index.ts';
import { ComposedWorld as CW } from '../packages/core/src/composedWorld.ts';
import { DIR16_YAW as YAW } from '../packages/core/src/composer/lut.ts';
test('every arrival spot is standable with an exit spot behind it', () => {
  for (const id of archIds()) for (let s = 1; s <= 12; s++) {
    const map = composeAll(s, ARCHS[id], [], 'easy'); const w = new CW(new THREE3.Group(), map); const st = map.start;
    assert.ok(!w.blocked(st.x, st.z, 2.2), `${id}/${s}: the landing is not standable`);
    const back = YAW[(st.yaw + 8) % 16]; let exit = false;
    for (const dist of [5.5, 4.5, 7, 3.6]) for (const a of [back, back + Math.PI / 2, back - Math.PI / 2, back + Math.PI]) { if (!w.spawnBlocked(st.x + Math.sin(a) * dist, st.z + Math.cos(a) * dist, 2.2)) { exit = true; break; } }
    assert.ok(exit, `${id}/${s}: no standable exit spot behind the start`);
  }
});
