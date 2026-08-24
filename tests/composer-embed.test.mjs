// END-TO-END COMPOSER — every archetype in archetypes/index.ts × 100 seeds × both tiers:
// compose() never throws, fallback rate < 5 %, validate() re-run on the returned map finds no fatal
// problem, every zone is named with a unique id, there is at least one default person, every person
// route point and npc/loot/hide spot is standable against the map's colliders, every locked door has a
// key whose zone is reachable without passing that lock, and planning stays under BUDGET_MS per compose.
// The budget is 90 ms, not the old 60: plan-first tries authored plans AND 12 generated candidates through
// mapMission before it settles, and the castle's ring generator is the most expensive of them. Still one
// frame's worth of work at load time, and it buys floor plans that read as buildings.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ARCHETYPES, composeDetailed, validate, composeSummary } from '../packages/core/src/composer/index.ts';
import { cpuMs } from './cpu-clock.mjs';   // CPU time, not wall: the suite runs files in parallel

const BUDGET_MS = 90;                  // per compose, averaged over the seeds below
const SEEDS = 100;
const NPC_R = 2.2, HIDE_R = 1.4;
const seedAt = (i) => (Math.imul(i + 1, 0x9e3779b1) ^ 0x2545f491) >>> 0;

const d2 = (x, z, r) => { const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0; const dz = z < r.z0 ? r.z0 - z : z > r.z1 ? z - r.z1 : 0; return dx * dx + dz * dz; };
const blocked = (map, s, r) => map.colliders.find((c) => c.floor === s.floor && d2(s.x, s.z, c) < r * r);
const inRect = (s, r) => s.x >= r.x0 - 0.01 && s.x <= r.x1 + 0.01 && s.z >= r.z0 - 0.01 && s.z <= r.z1 + 0.01;
/** First collider within r of the straight leg a→b (sampled every ≤ 0.5 u), or undefined. */
const legHit = (map, a, b, r) => { const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) / 0.5)); for (let i = 0; i <= n; i++) { const c = blocked(map, { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n, floor: a.floor }, r); if (c) return c; } return undefined; };

/** Zone graph: doors (optionally skipping one lock) + stairs (stairs zone ↔ the zone over its top step). */
function reach(map, skipLock) {
  const adj = new Map(map.zones.map((z) => [z.id, new Set()]));
  const link = (a, b) => { adj.get(a).add(b); adj.get(b).add(a); };
  for (const d of map.doors) if (!(skipLock && d.lock === skipLock)) link(d.between[0], d.between[1]);
  // corridor runs (and stairs shafts) touch each other without a door
  const bare = (z) => z.role === 'corridor' || z.role === 'stairs';
  const touch = (a, b) => a.floor === b.floor && ((a.cells.x0 <= b.cells.x1 && b.cells.x0 <= a.cells.x1 && (a.cells.z1 + 1 === b.cells.z0 || b.cells.z1 + 1 === a.cells.z0))
    || (a.cells.z0 <= b.cells.z1 && b.cells.z0 <= a.cells.z1 && (a.cells.x1 + 1 === b.cells.x0 || b.cells.x1 + 1 === a.cells.x0)));
  for (const a of map.zones) if (bare(a)) for (const b of map.zones) if (a !== b && (bare(b) || b.stairs) && touch(a, b)) link(a.id, b.id);
  for (const z of map.zones) {
    if (!z.stairs) continue;
    const top = z.stairs.steps[z.stairs.steps.length - 1]; const cx = (top.x0 + top.x1) / 2, cz = (top.z0 + top.z1) / 2;
    for (const u of map.zones) if (u.floor === z.stairs.to && cx > u.rect.x0 && cx < u.rect.x1 && cz > u.rect.z0 && cz < u.rect.z1) link(z.id, u.id);
  }
  const entrance = map.zones.find((z) => z.role === 'entrance') ?? map.zones[0];
  const seen = new Set([entrance.id]); const q = [entrance.id];
  while (q.length) { const id = q.shift(); for (const n of adj.get(id)) if (!seen.has(n)) { seen.add(n); q.push(n); } }
  return seen;
}

// warm the JIT once so the timing below measures planning, not compilation
composeDetailed(1, ARCHETYPES.castle, [], 'easy'); composeDetailed(2, ARCHETYPES.house, [], 'hard');

for (const [id, arch] of Object.entries(ARCHETYPES)) {
  test(`${id}: ${SEEDS} seeds × both tiers compose, validate, stand, unlock — and stay under ${BUDGET_MS} ms`, () => {
    let fallbacks = 0, ms = 0, n = 0;
    for (const tier of ['easy', 'hard']) for (let i = 0; i < SEEDS; i++) {
      const seed = seedAt(i);
      const t0 = cpuMs();
      let r;
      try { r = composeDetailed(seed, arch, [], tier); } catch (e) { assert.fail(`${id} seed ${seed} ${tier} threw: ${e.message}`); }
      ms += cpuMs() - t0; n++;
      const { map, graph } = r;
      const where = `${id} seed ${seed} ${tier} (${graph.flowId})`;
      if (map.fallback) fallbacks++;

      // the finished map passes its own validation (fatal-free)
      const fatal = validate(map, graph, arch).filter((p) => p.fatal);
      assert.equal(fatal.length, 0, `${where}: ${fatal.map((p) => p.check + ': ' + p.msg).join('; ')}\n${composeSummary(map)}`);

      // identity: names, unique ids, stable id shape
      const ids = new Set();
      for (const z of map.zones) {
        assert.ok(z.name && z.name.length, `${where}: zone ${z.id} has no name`);
        assert.ok(!ids.has(z.id), `${where}: duplicate zone id ${z.id}`); ids.add(z.id);
        assert.match(z.id, new RegExp(`^${id}\\.[a-z_]+#\\d+$`), `${where}: odd zone id ${z.id}`);
      }
      assert.equal(map.archetype, id); assert.equal(map.seed, seed);
      assert.ok(map.criticalPath.length >= 2 && map.criticalPath.every((z) => ids.has(z)), `${where}: critical path ${map.criticalPath}`);
      assert.ok(ids.has(map.weenieZone), `${where}: weenie zone ${map.weenieZone}`);
      assert.ok(map.landmarks.length <= 24 && map.lights.length <= 6, `${where}: caps`);
      for (const [alias, zid] of Object.entries(map.aliases)) assert.ok(ids.has(zid), `${where}: alias '${alias}' → unknown ${zid}`);

      // people: at least one, every route point standable
      assert.ok(map.people.length >= 1, `${where}: no people`);
      for (const p of map.people) {
        assert.ok(ids.has(p.zone), `${where}: person ${p.id} in unknown zone`);
        assert.ok(p.route.length >= 3 && p.lines.length >= 1, `${where}: person ${p.id} route/lines`);
        for (const s of [p.spot, ...p.route]) { const c = blocked(map, s, NPC_R); assert.ok(!c, `${where}: person ${p.id} point (${s.x}, ${s.z}) blocked by ${c?.id ?? 'wall'}`); }
        // regression: every straight leg of the loop (the closing leg too) stays clear at NPC_R — a walker never clips a
        // chest between two standable points, and a door excursion retraces the corridor instead of cutting back through the wall
        const pz = map.zones.find((z) => z.id === p.zone);
        for (let i = 0; i < p.route.length; i++) {
          const a = p.route[i], b = p.route[(i + 1) % p.route.length]; const c = legHit(map, a, b, NPC_R);
          assert.ok(!c, `${where}: person ${p.id} leg ${i} (${a.x}, ${a.z})→(${b.x}, ${b.z}) crosses ${c?.id ?? 'wall'}`);
        }
        // regression: a route point is inside its zone, or inside an adjoining corridor reached through an unlocked door — never a foreign room
        for (const s of p.route) {
          if (inRect(s, pz.rect)) continue;
          const corr = map.zones.find((u) => (u.role === 'corridor' || u.kind === 'corridor') && u.floor === s.floor && inRect(s, u.rect)
            && map.doors.some((d) => !d.lock && d.between.includes(u.id) && d.between.includes(pz.id)));
          const cell = map.doors.find((d) => !d.lock && d.floor === s.floor && d.between.includes(pz.id) && Math.abs(d.x - s.x) <= 2.5 && Math.abs(d.z - s.z) <= 2.5);
          assert.ok(corr || cell, `${where}: person ${p.id} route point (${s.x}, ${s.z}) is outside ${pz.id} and not in an adjoining corridor or its door cell`);
        }
      }
      // spots: npc / loot at 2.2 u, hide at 1.4 u, all on their floor
      for (const z of map.zones) {
        for (const s of z.spots.npc) { assert.equal(s.floor, z.floor); const c = blocked(map, s, NPC_R); assert.ok(!c, `${where}: npc spot in ${z.id} blocked by ${c?.id ?? 'wall'}`); }
        for (const s of z.spots.loot) { const c = blocked(map, s, NPC_R); assert.ok(!c, `${where}: loot spot in ${z.id} blocked by ${c?.id ?? 'wall'}`); }
        for (const s of z.spots.hide) { const c = blocked(map, s, HIDE_R); assert.ok(!c, `${where}: hide spot in ${z.id} blocked by ${c?.id ?? 'wall'}`); }
      }
      // locks: every locked door has a key in a zone reachable without passing that lock
      for (const d of map.doors.filter((x) => x.lock)) {
        const keys = map.keys.filter((k) => k.opens === d.lock);
        assert.ok(keys.length, `${where}: locked door ${d.id} (${d.lock}) has no key`);
        const ok = reach(map, d.lock);
        assert.ok(keys.some((k) => ok.has(k.zone)), `${where}: key for ${d.lock} is only reachable through its own lock\n${composeSummary(map)}`);
        assert.ok(map.colliders.some((c) => c.id === d.id || (c.x0 === d.collider.x0 && c.z0 === d.collider.z0 && c.floor === d.floor)), `${where}: locked door ${d.id} has no collider`);
      }
      for (const k of map.keys) assert.ok(ids.has(k.zone) && k.item, `${where}: key ${k.id}`);
      // colliderCells index every collider
      const indexed = new Set(); for (const l of map.colliderCells.values()) for (const i of l) indexed.add(i);
      assert.equal(indexed.size, map.colliders.length, `${where}: colliderCells indexes ${indexed.size}/${map.colliders.length}`);
    }
    const rate = fallbacks / n, avg = ms / n;
    console.log(`  ${id.padEnd(9)} fallback ${(100 * rate).toFixed(1)}%  avg ${avg.toFixed(1)} ms/compose`);
    assert.ok(rate < 0.05, `${id}: fallback rate ${(100 * rate).toFixed(1)}% ≥ 5%`);
    assert.ok(avg < BUDGET_MS, `${id}: ${avg.toFixed(1)} ms per compose ≥ ${BUDGET_MS} ms`);
  });
}

test('forced fallback (no usable flow) × every archetype: linearMission + anchorsOnly still validates, never throws', () => {
  for (const [id, arch] of Object.entries(ARCHETYPES)) {
    const broken = { ...arch, flows: [] };                      // buildMission → null on all 8 rungs
    for (const tier of ['easy', 'hard']) for (let i = 0; i < 25; i++) {
      const seed = seedAt(1000 + i);
      const { map, graph } = composeDetailed(seed, broken, [{ alias: 'the vault', role: 'treasure' }], tier);
      assert.equal(map.fallback, true, `${id} ${seed}: fallback flag`);
      assert.equal(graph.flowId, 'linear');
      const fatal = validate(map, graph, arch).filter((p) => p.fatal);
      assert.equal(fatal.length, 0, `${id} ${seed} ${tier}: ${fatal.map((p) => p.check + ': ' + p.msg).join('; ')}`);
      assert.ok(map.people.length >= 1 && map.zones.some((z) => z.role === 'boss') && map.keys.length >= 1, `${id} ${seed}: fallback content`);
      assert.ok(map.aliases['the vault'], `${id} ${seed}: request bound in the fallback`);
    }
  }
});

test('unsupported layouts throw a clear "not yet" error, never a silent map', () => {
  const arch = { ...ARCHETYPES.house, layout: 'settlement' };
  assert.throws(() => composeDetailed(1, arch, [], 'easy'), /not yet implemented/);
});

test('requests bind to aliases and the boss request renames the boss zone', () => {
  const reqs = [{ alias: 'the throne room', kind: 'throne', role: 'boss' }, { alias: 'armoury key', role: 'key', item: 'core_key' }];
  const { map } = composeDetailed(77, ARCHETYPES.castle, reqs, 'hard');
  const boss = map.zones.find((z) => z.role === 'boss');
  assert.ok(boss && boss.kind === 'throne', 'boss is the throne');
  assert.equal(map.aliases['the throne room'], boss.id);
  assert.ok(map.aliases['armoury key'] && map.zones.find((z) => z.id === map.aliases['armoury key']).role === 'key');
  assert.ok(map.keys.some((k) => k.item === 'core_key' && k.zone === map.aliases['armoury key']));
});

test('composeSummary is a compact, readable digest', () => {
  const { map } = composeDetailed(5, ARCHETYPES.school, [], 'easy');
  const s = composeSummary(map);
  assert.match(s, /^school seed=5 /); assert.ok(s.split('\n').length >= map.zones.length + 2);
  for (const z of map.zones) assert.ok(s.includes(z.id));
});
