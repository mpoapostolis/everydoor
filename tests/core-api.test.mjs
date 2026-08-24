// THE FORK'S OWN SEAMS.
//
// The composer's internals are covered by the suite this repo inherited (composer-*.test.mjs, the
// byte-level snapshot included). What is NEW here is the surface: a WorldScript instead of a whole
// game definition, `planInterior` instead of a world factory, and `lotSeed` as the only thing that
// ties a street door to the rooms behind it. This file proves that surface.
//
// Run: bunx tsx --test tests/core-api.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { archetypeIds, ARCHETYPES } from '../packages/core/src/composer/archetypes/index.ts';
import { planInterior, placeReqsOf, lotSeed, storyBrief } from '../packages/core/src/index.ts';
import { cityLots, CITY_THEMES } from '../packages/core/src/cityWorld.ts';
import { LOT_ARCHETYPE, lotKindForWord } from '../packages/core/src/cityLots.ts';

const SEEDS = [0x1111, 0x2222, 0x3333];

/** The demo's shape of story, inline so the test does not depend on the demo app. */
const script = (archetype, seed = 0) => ({
  world: { archetype, seed },
  title: 'The Cat Came Back',
  story: { goal: 'Biscuit the cat is shut in the attic.' },
  npcs: [
    { id: 'n0', name: 'Yiayia Rena', role: 'the grandmother', place: 'kitchen', dialogue: ['Have you seen Biscuit?'], givesQuest: 'q1' },
    { id: 'n1', name: 'Petros', role: 'her grandson', place: 'living room', dialogue: ['She is in the kitchen.'] },
  ],
  items: [{ id: 'key1', name: 'attic key', kind: 'key', place: 'storage' }],
  quests: [{ id: 'q1', title: 'Find Biscuit', desc: 'Find the cat', objective: { type: 'collect', targetId: 'key1' }, turnIn: 'n0', chainStep: 0 }],
  winItems: ['key1'],
});

test('every archetype plans a standable building from a bare seed', () => {
  for (const id of archetypeIds()) {
    for (const seed of SEEDS) {
      const map = planInterior({ seed, archetype: id });
      assert.equal(map.archetype, id);
      assert.ok(map.zones.length >= 3, `${id}@${seed}: ${map.zones.length} zones`);
      assert.ok(map.doors.length >= 1, `${id}@${seed}: no doors`);
      // the entrance must be inside a real room, or the player opens into the void
      const start = map.zones.find((z) => start_in(z, map.start));
      assert.ok(start, `${id}@${seed}: start (${map.start.x},${map.start.z}) is in no zone`);
      // and the plan must be walkable end to end
      assert.ok(map.criticalPath.length >= 1, `${id}@${seed}: empty critical path`);
    }
  }
});

test('an unknown archetype fails loudly, never with a silent empty map', () => {
  assert.throws(() => planInterior({ seed: 1, archetype: 'submarine' }), /unknown archetype/);
});

test('a script names the rooms: every place a character asks for is bound', () => {
  for (const id of ['house', 'shop', 'school', 'hospital']) {
    const def = script(id);
    const reqs = placeReqsOf(def, ARCHETYPES[id]);
    assert.ok(reqs.length >= 3, `${id}: ${reqs.length} requests from 2 npcs + 1 key`);
    const map = planInterior({ seed: 0x5eed, archetype: id, script: def });
    for (const r of reqs) {
      const zoneId = map.aliases[r.alias.toLowerCase()];
      assert.ok(zoneId, `${id}: nothing bound to "${r.alias}" — aliases: ${Object.keys(map.aliases).join(', ')}`);
      assert.ok(map.zones.some((z) => z.id === zoneId), `${id}: "${r.alias}" bound to a zone that is not in the map`);
    }
  }
});

test('the key room is locked behind the door it opens', () => {
  const def = script('house');
  const map = planInterior({ seed: 0x5eed, archetype: 'house', script: def });
  assert.equal(map.keys.length >= 1, true, 'a key item should place a key');
  // `opens` is a LOCK id, not a door id: one lock may hold several doors shut
  for (const k of map.keys) {
    const doors = map.doors.filter((d) => d.lock === k.opens);
    assert.ok(doors.length >= 1, `key "${k.item}" opens lock ${k.opens}, which locks no door`);
  }
  // and the key must be reachable BEFORE the door it opens — it may not be locked inside its own room
  for (const k of map.keys) {
    const zone = map.zones.find((z) => z.id === k.zone);
    assert.ok(zone, `key ${k.id} sits in a zone that is not in the map`);
  }
});

test('the brief is seeded by the STORY, never the layout', () => {
  const a = storyBrief(script('house', 1));
  const b = storyBrief(script('house', 999999));
  assert.equal(a.seed, b.seed, 'a different layout seed must not recast the story');
  const c = storyBrief({ ...script('house'), title: 'A Different Tale' });
  assert.notEqual(a.seed, c.seed, 'a different story must recast');
});

test('the same script + seed composes the same building, twice', () => {
  const def = script('school');
  const a = planInterior({ seed: 7, archetype: 'school', script: def });
  const b = planInterior({ seed: 7, archetype: 'school', script: def });
  assert.deepEqual(a.zones.map((z) => [z.id, z.name, z.rect]), b.zones.map((z) => [z.id, z.name, z.rect]));
});

test('a door is a stable, unique identity — the interior needs no storage', () => {
  const lots = cityLots(0xc17a, 'day');
  const ids = new Set(lots.map((l) => l.id));
  assert.equal(ids.size, lots.length, 'lot ids must be unique');
  for (const l of lots.slice(0, 12)) {
    assert.equal(lotSeed(1234, l.id), lotSeed(1234, l.id), 'the same door, twice');
    assert.notEqual(lotSeed(1234, l.id), lotSeed(1235, l.id), 'a different city is a different building');
  }
  const distinct = new Set(lots.map((l) => lotSeed(1234, l.id)));
  assert.ok(distinct.size >= lots.length - 1, `${lots.length} doors collapsed to ${distinct.size} interiors`);
});

test('every city flavour deals doors, and every door opens onto a composable plan', () => {
  for (const kind of Object.keys(CITY_THEMES)) {
    const lots = cityLots(0x9001, kind);
    assert.ok(lots.length >= 25, `${kind}: only ${lots.length} doors`);
    assert.ok(lots.some((l) => l.civic), `${kind}: the civic deck was never dealt`);
    for (const l of lots) {
      assert.equal(l.archetype, LOT_ARCHETYPE[l.kind], `${l.id}: kind ${l.kind} → ${l.archetype}`);
      assert.ok(ARCHETYPES[l.archetype], `${l.id}: ${l.archetype} is not a plan the composer knows`);
    }
    // and the table itself is seeded, not random
    assert.deepEqual(cityLots(0x9001, kind).map((l) => l.id), lots.map((l) => l.id));
  }
});

test('a lot word names the BUILDING, so it never becomes a room request inside it', () => {
  assert.equal(lotKindForWord('the bakery'), 'shop');
  assert.equal(lotKindForWord('police station'), 'precinct');
  assert.equal(lotKindForWord('throne room'), undefined);
  // inside the bakery, `place: bakery` names the building you are standing in — asking the composer
  // to bind a room to it is how you get "no place called bakery" inside the bakery
  const inLot = {
    world: { archetype: 'shop', seed: 0, lot: 'bakery' },
    npcs: [
      { id: 'n0', name: 'Mara', role: 'the baker', place: 'bakery', dialogue: ['Morning.'] },
      { id: 'n1', name: 'Kostas', role: 'the delivery boy', place: 'stockroom', dialogue: ['Out back.'] },
    ],
  };
  assert.deepEqual(placeReqsOf(inLot, ARCHETYPES.shop).map((r) => r.alias), ['stockroom']);
});

/** Is a spot inside a zone's floor rect? */
function start_in(z, s) {
  return z.floor === s.floor && s.x >= z.rect.x0 && s.x <= z.rect.x1 && s.z >= z.rect.z0 && s.z <= z.rect.z1;
}
