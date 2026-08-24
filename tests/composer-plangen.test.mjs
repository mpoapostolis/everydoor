// PROCEDURAL FLOOR PLANS (plans/generate.ts): constrained growth (house / shop), corridor strips (school / hospital /
// prison), courtyard ring (castle). 200 seeds × six needs: every candidate validates (checkPlan, parsePlanRows);
// rooms ≥ 3×3 (≥ 4×4 unless service / tower / hall); corridors ≥ 3 wide; the hub touches ≥ 60% of rooms in grown plans;
// no two picked plans identical across 20 consecutive seeds; deterministic; ≤ 15 ms per generatePlan.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { generatePlan, pickPlan, rankPlans, scorePlan, checkPlan, parsePlanRows, renderPlan, methodFor, MIN_CORRIDOR_W } from '../packages/core/src/composer/plans/generate.ts';
import { ARCHETYPES } from '../packages/core/src/composer/archetypes/index.ts';
import { cpuMs } from './cpu-clock.mjs';   // CPU time, not wall: the suite runs files in parallel

const SEEDS = Array.from({ length: 200 }, (_, i) => 1 + i * 7919);
const NEEDS = {
  house: { entrance: 'foyer', hub: 'living', boss: 'garage', rooms: [
    { id: 'foyer', kind: 'foyer', area: [12, 16] }, { id: 'living', kind: 'living', area: [36, 64] },
    { id: 'kitchen', kind: 'kitchen', area: [16, 25] }, { id: 'dining', kind: 'dining', area: [16, 25] }, { id: 'bed1', kind: 'bedroom', area: [16, 25] },
    { id: 'bed2', kind: 'bedroom', area: [16, 25], tags: ['single'] }, { id: 'bath', kind: 'bath', area: [9, 12], tags: ['service'] }, { id: 'study', kind: 'study', area: [16, 20] },
    { id: 'garage', kind: 'garage', area: [25, 36] }, { id: 'attic', kind: 'attic', area: [9, 16], tags: ['secret'] }],
    prefer: [['kitchen', 'dining'], ['bed1', 'bath'], ['living', 'foyer']] },
  shop: { entrance: 'front', hub: 'front', boss: 'delivery', rooms: [
    { id: 'front', kind: 'storefront', area: [36, 64] }, { id: 'counter', kind: 'counter', area: [16, 25] }, { id: 'kitchen', kind: 'kitchen', area: [16, 25] },
    { id: 'storage', kind: 'storage', area: [9, 16], tags: ['service'] }, { id: 'office', kind: 'office', area: [16, 16], tags: ['single'] }, { id: 'delivery', kind: 'delivery', area: [25, 36] },
    { id: 'store', kind: 'store', area: [16, 25] }, { id: 'yard', kind: 'yard', area: [16, 25], tags: ['sky'] }],
    prefer: [['front', 'counter'], ['counter', 'kitchen'], ['kitchen', 'storage'], ['delivery', 'yard']] },
  school: { entrance: 'lobby', boss: 'gym', rooms: [
    { id: 'lobby', kind: 'lobby', area: [16, 25] }, { id: 'gym', kind: 'gym', area: [49, 100] },
    { id: 'c1', kind: 'classroom', area: [16, 25] }, { id: 'c2', kind: 'classroom', area: [16, 25] }, { id: 'c3', kind: 'classroom', area: [16, 25] },
    { id: 'caf', kind: 'cafeteria', area: [25, 49] }, { id: 'lib', kind: 'library', area: [16, 36] }, { id: 'office', kind: 'office', area: [12, 16], tags: ['single'] },
    { id: 'bath', kind: 'bathroom', area: [9, 12], tags: ['service'] }, { id: 'jan', kind: 'janitor', area: [9, 9], tags: ['secret', 'service'] }, { id: 'lock', kind: 'locker_hall', area: [16, 36] }],
    prefer: [['lobby', 'lock'], ['caf', 'c1'], ['lib', 'c2']] },
  hospital: { entrance: 'rec', boss: 'cont', rooms: [
    { id: 'rec', kind: 'reception', area: [16, 25] }, { id: 'cont', kind: 'containment', area: [36, 64] },
    { id: 'w1', kind: 'ward', area: [16, 36] }, { id: 'w2', kind: 'ward', area: [16, 36] }, { id: 'w3', kind: 'ward', area: [16, 36] }, { id: 'surg', kind: 'surgery', area: [16, 25] },
    { id: 'lab', kind: 'lab', area: [16, 25], tags: ['single'] }, { id: 'store', kind: 'storage', area: [9, 12], tags: ['service'] }, { id: 'morgue', kind: 'morgue', area: [12, 16], tags: ['secret'] },
    { id: 'ctrl', kind: 'control', area: [12, 16] }, { id: 'w4', kind: 'ward', area: [16, 36] }, { id: 'store2', kind: 'storage', area: [9, 12], tags: ['service'] }],
    prefer: [['surg', 'cont'], ['lab', 'store'], ['ctrl', 'cont']] },
  prison: { entrance: 'gate', boss: 'warden', hub: 'block', rooms: [
    { id: 'gate', kind: 'gate', area: [16, 25] }, { id: 'warden', kind: 'warden', area: [25, 36] }, { id: 'block', kind: 'cell_block', area: [49, 81] },
    { id: 'yard', kind: 'yard', area: [36, 64], tags: ['sky'] }, { id: 'caf', kind: 'cafeteria', area: [25, 49] }, { id: 'ctrl', kind: 'control', area: [16, 25], tags: ['single'] },
    { id: 'gate2', kind: 'main_gate', area: [16, 25], tags: ['single'] }, { id: 'vents', kind: 'vents', area: [9, 9], tags: ['secret', 'service'] }, { id: 'tower', kind: 'watchtower', area: [9, 16] }],
    prefer: [['block', 'caf'], ['block', 'yard'], ['yard', 'tower']] },
  castle: { entrance: 'gate', hub: 'court', boss: 'throne', rooms: [
    { id: 'gate', kind: 'gatehouse', area: [9, 16] }, { id: 'court', kind: 'courtyard', area: [49, 81] }, { id: 'throne', kind: 'throne', area: [36, 64] },
    { id: 'hall', kind: 'great_hall', area: [25, 49] }, { id: 'kitchen', kind: 'kitchen', area: [16, 25] }, { id: 'armoury', kind: 'armoury', area: [16, 25], tags: ['single'] }, { id: 'cells', kind: 'cells', area: [16, 25] },
    { id: 'chapel', kind: 'chapel', area: [16, 25] }, { id: 'secret', kind: 'cells', area: [9, 12], tags: ['secret'] }, { id: 't1', kind: 'tower', area: [9, 9], tags: ['tower'] }],
    prefer: [['hall', 'throne'], ['hall', 'kitchen'], ['armoury', 'cells']] },
};
const EXPECT_METHOD = { house: 'growth', shop: 'growth', school: 'corridor', hospital: 'corridor', prison: 'corridor', castle: 'ring' };
const rectsOf = (plan) => { const r = {}; plan.rows.forEach((row, z) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch === '.') continue; const q = r[ch]; if (!q) r[ch] = { x0: x, z0: z, x1: x, z1: z }; else { q.x0 = Math.min(q.x0, x); q.x1 = Math.max(q.x1, x); q.z0 = Math.min(q.z0, z); q.z1 = Math.max(q.z1, z); } } }); return r; };
const tagsOf = (plan, ch) => plan.rooms[ch].tags ?? [];
const pairsOf = (plan) => { const door = new Set(), open = new Set(); for (const s of plan.doors) { const m = /^(.)-(.)(?:@\d+)?([!~]?)$/.exec(s); if (!m) continue; const k = m[1] < m[2] ? m[1] + m[2] : m[2] + m[1]; door.add(k); if (m[3] === '~') open.add(k); } return { door, open }; };
const pk = (a, b) => (a < b ? a + b : b + a);

for (const [id, needs] of Object.entries(NEEDS)) {
  const arch = ARCHETYPES[id];
  test(`${id}: ${EXPECT_METHOD[id]} — every candidate validates, sizes, corridors, hub, variety, speed`, () => {
    assert.equal(methodFor(arch, needs), EXPECT_METHOD[id]);
    let ms = 0; const recent = [];
    for (const seed of SEEDS) {
      const t0 = cpuMs(); const cands = generatePlan(arch, needs, seed); ms += cpuMs() - t0;
      const w = `${id} seed ${seed}`;
      assert.ok(cands.length >= 8, `${w}: only ${cands.length} candidates`);
      for (const plan of cands) {
        assert.deepEqual(checkPlan(plan), [], `${w}: ${plan.id} invalid\n${renderPlan(plan)}`);
        const parsed = parsePlanRows(plan);
        assert.equal(parsed.doors.filter((d) => d.exterior).length, 1);
        for (const d of parsed.doors) if (!d.exterior) assert.ok(parsed.adjacency[d.a].includes(d.b));
        const rects = rectsOf(plan);
        const ids = new Set(needs.rooms.map((r) => r.id));
        const needChars = Object.keys(plan.rooms).filter((ch) => tagsOf(plan, ch).some((t) => t.startsWith('need:')));
        assert.equal(needChars.length, needs.rooms.length, `${w}: ${plan.id} places ${needChars.length} of ${needs.rooms.length} rooms`);
        for (const ch of Object.keys(rects)) {
          const r = rects[ch], wd = r.x1 - r.x0 + 1, dp = r.z1 - r.z0 + 1, tags = tagsOf(plan, ch);
          if (tags.includes('corridor')) assert.ok(Math.min(wd, dp) >= MIN_CORRIDOR_W, `${w}: ${plan.id} corridor ${ch} is ${wd}×${dp}`);
          else if (tags.includes('hall')) assert.ok(Math.min(wd, dp) >= 1);
          else assert.ok(Math.min(wd, dp) >= (tags.includes('service') || tags.includes('tower') ? 3 : 4), `${w}: ${plan.id} room ${ch} (${plan.rooms[ch].kind}) is ${wd}×${dp}\n${renderPlan(plan)}`);
          if (tags.includes('single') || tags.includes('secret') || tags.includes('boss')) assert.equal(parsed.adjacency[ch].length, 1, `${w}: ${plan.id} single room ${ch} has ${parsed.adjacency[ch].length} doors`);
          if (tags.includes('secret')) assert.ok(parsed.doors.some((d) => d.secret && (d.a === ch || d.b === ch)), `${w}: secret room ${ch} without a secret door`);
        }
        assert.ok(ids.size);
        // the hub touches ≥ 60% of the rooms (grown plans); corridor plans: every room opens on a corridor
        const { door, open } = pairsOf(plan);
        const chars = Object.keys(rects);
        const region = new Set(chars.filter((ch) => tagsOf(plan, ch).includes('hub') || tagsOf(plan, ch).includes('corridor')));
        let grew = true; while (grew) { grew = false; for (const ch of chars) if (!region.has(ch) && tagsOf(plan, ch).includes('hall') && [...region].some((h) => open.has(pk(ch, h)))) { region.add(ch); grew = true; } }
        const rooms = chars.filter((ch) => !region.has(ch) && !tagsOf(plan, ch).includes('hall'));
        const touching = rooms.filter((ch) => [...region].some((h) => door.has(pk(ch, h)))).length;
        if (plan.source === 'grown') assert.ok(touching / rooms.length >= 0.6 - 1e-9, `${w}: ${plan.id} hub touches ${touching}/${rooms.length}\n${renderPlan(plan)}`);
        if (plan.source === 'corridor') assert.ok(touching >= rooms.length - 1, `${w}: ${plan.id} ${rooms.length - touching} rooms off the corridor`);
      }
      // the pick is deterministic and differs from the previous 20 picks
      const score = (p) => scorePlan(p, arch, needs);
      const best = pickPlan(cands, score, seed);
      assert.equal(rankPlans(cands, score, seed)[0], best);
      assert.equal(pickPlan(cands, score), rankPlans(cands, score)[0]);
      assert.deepEqual(generatePlan(arch, needs, seed), cands, `${w}: generatePlan not deterministic`);
      const sig = best.rows.join('/') + '|' + best.doors.join(' ');
      assert.ok(!recent.includes(sig), `${w}: the picked plan repeats one of the last 20 seeds`);
      recent.push(sig); if (recent.length > 20) recent.shift();
    }
    const avg = ms / SEEDS.length;
    console.log(`  ${id.padEnd(9)} avg ${avg.toFixed(2)} ms/generatePlan`);
    assert.ok(avg < 15, `${id}: ${avg.toFixed(1)} ms per generatePlan ≥ 15 ms`);
  });
}

test('needs without a hub or entrance still produce plans (the generator picks them)', () => {
  const needs = { rooms: [{ kind: 'ward', area: [16, 25] }, { kind: 'ward', area: [16, 25] }, { kind: 'lab', area: [16, 25] }, { kind: 'storage', area: [9, 9], tags: ['service'] }] };
  for (const seed of SEEDS.slice(0, 20)) { const c = generatePlan(ARCHETYPES.hospital, needs, seed, 8); assert.ok(c.length >= 1, `seed ${seed}`); for (const p of c) assert.deepEqual(checkPlan(p), []); }
  const grown = { method: 'growth', rooms: [{ kind: 'bedroom', area: [16, 25] }, { kind: 'kitchen', area: [16, 25] }, { kind: 'dining', area: [16, 25] }, { kind: 'bath', area: [9, 9], tags: ['service'] }] };
  for (const seed of SEEDS.slice(0, 20)) { const c = generatePlan(ARCHETYPES.house, grown, seed, 8); assert.ok(c.length >= 1, `seed ${seed}`); for (const p of c) assert.deepEqual(checkPlan(p), []); }
});

test('checkPlan catches broken plans', () => {
  const ok = { id: 't', archetype: 'house', rows: ['AAAABBBB', 'AAAABBBB', 'AAAABBBB', 'AAAABBBB'], rooms: { A: { kind: 'foyer' }, B: { kind: 'living' } }, doors: ['B-A', 'A>'], entrance: 'A' };
  assert.deepEqual(checkPlan(ok), []);
  assert.ok(checkPlan({ ...ok, rows: ['AAAABBBB', 'AAAABBBB', 'AAABBBBB', 'AAAABBBB'] }).some((p) => /rectangle/.test(p)));
  assert.ok(checkPlan({ ...ok, doors: ['A>'] }).some((p) => /unreachable/.test(p)));
  assert.ok(checkPlan({ ...ok, doors: ['B-A'] }).some((p) => /entrances/.test(p)));
  assert.ok(checkPlan({ ...ok, rows: ['AAAABBBB', 'AAAABBBB', 'AAAABBBB', 'AAAACCCC'], rooms: { ...ok.rooms, C: { kind: 'bath' } } }).some((p) => /rectangle|unreachable/.test(p)));
});
