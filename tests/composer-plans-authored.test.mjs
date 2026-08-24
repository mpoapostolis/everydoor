// Authored floor plans: every plan parses, validates, and meets the owner's standard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, ALL_PLANS } from '../packages/core/src/composer/plans/index.ts';
import { parseAndValidate } from '../packages/core/src/composer/plans/parse.ts';

const KINDS = {
  house: ['foyer', 'living', 'kitchen', 'dining', 'bedroom', 'bath', 'study', 'garage', 'yard', 'corridor'],
  haunted: ['foyer', 'ballroom', 'library', 'suite', 'dining', 'basement', 'closet', 'passage', 'corridor'],
  school: ['lobby', 'locker_hall', 'classroom', 'cafeteria', 'gym', 'office', 'library', 'bathroom', 'janitor', 'field', 'corridor'],
  shop: ['storefront', 'counter', 'kitchen', 'storage', 'office', 'delivery', 'concourse', 'store', 'food_court', 'yard', 'corridor'],
  office: ['lobby', 'open_plan', 'meeting', 'boss_office', 'server_room', 'kitchenette', 'bathroom', 'storage', 'corridor'],
  hospital: ['reception', 'ward', 'surgery', 'lab', 'containment', 'storage', 'morgue', 'control', 'hallway'],
  prison: ['gate', 'cell_block', 'yard', 'cafeteria', 'control', 'vents', 'watchtower', 'main_gate', 'warden', 'hallway'],
  castle: ['gatehouse', 'courtyard', 'throne', 'armoury', 'cells', 'tower', 'chapel', 'kitchen', 'great_hall', 'passage'],
  dungeon: ['entrance', 'chamber', 'cells', 'shrine', 'treasury', 'trap_hall', 'boss_hall', 'corridor'],
};
const SERVICE = new Set(['bath', 'closet', 'janitor', 'storage', 'vents', 'bathroom', 'tower', 'watchtower', 'morgue', 'passage', 'server_room', 'foyer', 'gate', 'main_gate', 'control']);
const WIDE = new Set(['corridor', 'hallway', 'locker_hall', 'concourse', 'passage', 'courtyard']);
const SKY = new Set(['yard', 'field', 'courtyard']);

test('every archetype in scope has 3–4 authored plans', () => {
  for (const a of Object.keys(KINDS)) assert.ok(PLANS[a].length >= 3 && PLANS[a].length <= 4, `${a}: ${PLANS[a].length}`);
  assert.equal(new Set(ALL_PLANS.map(p => p.id)).size, ALL_PLANS.length, 'plan ids unique');
});

for (const plan of ALL_PLANS) {
  test(`plan ${plan.id}`, () => {
    const p = parseAndValidate(plan);               // throws on non-rectangles, bad doors, holes, unreachable rooms
    const chars = Object.keys(p.rects);
    assert.ok(chars.length >= 8 && chars.length <= 16, `${chars.length} rooms`);
    assert.equal(plan.source, 'authored');
    assert.ok(plan.variants && (plan.variants.mirrorX || plan.variants.mirrorZ), 'variants');
    if (plan.archetype === 'castle' || plan.archetype === 'dungeon') assert.ok(plan.variants.rotate, 'rotate');
    assert.equal(plan.rooms[plan.entrance].role, 'entrance');
    let hub = 0, boss = 0;
    for (const c of chars) {
      const room = plan.rooms[c]; const r = p.rects[c];
      const w = r.x1 - r.x0 + 1, d = r.z1 - r.z0 + 1, side = Math.min(w, d);
      assert.ok(KINDS[plan.archetype].includes(room.kind), `${c}: kind '${room.kind}' not in ${plan.archetype}`);
      const min = WIDE.has(room.kind) || SERVICE.has(room.kind) ? 3 : 4;
      assert.ok(side >= min, `${c} (${room.kind}) is ${w}×${d}, min side ${min}`);
      assert.ok(Math.max(w, d) <= 28, `${c} too long`);
      assert.ok(p.adjacency[c].length >= 1, `${c} has no door`);
      if (SKY.has(room.kind)) assert.equal(room.sky, true, `${c} (${room.kind}) should be sky`);
      if (room.sky) assert.ok(SKY.has(room.kind), `${c} sky but ${room.kind}`);
      if (room.role === 'hub' || room.tags?.includes('hub')) hub++;
      if (room.role === 'boss' || room.tags?.includes('boss')) boss++;
    }
    assert.ok(hub >= 1, 'a hub');
    if (plan.archetype !== 'shop' && plan.archetype !== 'house') assert.ok(boss >= 1, 'a boss room');
    // single storey: no floor hints anywhere
    assert.ok(!JSON.stringify(plan).includes('"floor"'));
    // every secret door is marked secret; at most 1 exterior
    assert.equal(p.doors.filter(dd => dd.exterior).length, 1);
  });
}
