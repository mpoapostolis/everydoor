// THE DOOR, END TO END — headless.
//
// The demo's one interesting behaviour is the swap: stand in a street doorway, walk in, and the
// world under your feet becomes a composed interior; walk back out through the entrance and the
// city is rebuilt exactly as it was, at that same doorstep. This drives world-swap.ts for real
// (three geometry, real colliders, no GL) and proves:
//   • entering yields a ComposedWorld of the LOT'S archetype, with the player standing in a room;
//   • the rooms are derived, not stored: the same door twice is the same building, byte for byte;
//   • leaving lands you back on the street, on your feet, within a few units of the door you used;
//   • a different door in the same city is a different building.
//
// Run: bunx tsx --test tests/demo-doors.test.mjs
import './dom-stub.mjs';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import { WorldSwap } from '../apps/demo/src/world-swap.ts';
import { demoScript } from '../apps/demo/src/script.ts';

const CITY_SEED = 0xbeef;

function swapFor(seed = CITY_SEED, theme = 'day') {
  const scene = new THREE.Scene();
  const events = { onCity() {}, onInterior() {} };
  const swap = new WorldSwap(scene, events, seed, theme);
  const start = swap.city();
  return { swap, start };
}

/** A stable fingerprint of a composed building — every room, where it is and what it is called. */
const fingerprint = (map) => JSON.stringify([map.archetype, map.seed, map.zones.map((z) => [z.id, z.name, z.rect, z.floorY])]);

test('a street door opens onto that lot\'s own archetype, and you stand in a room', () => {
  const { swap } = swapFor();
  const lots = swap.place.world.lots();
  assert.ok(lots.length >= 25, `only ${lots.length} doors on this street`);

  for (const lot of lots.slice(0, 8)) {
    const spot = swap.enterLot(lot, demoScript(lot.archetype));
    assert.equal(swap.place.kind, 'interior');
    const map = swap.place.world.map;
    assert.equal(map.archetype, lot.archetype, `${lot.name} (${lot.kind}) opened onto ${map.archetype}`);
    assert.equal(swap.world.blocked(spot.x, spot.z, 1.3), false, `${lot.name}: the entrance spot is inside a collider`);
    const room = map.zones.find((z) => swap.place.world.inside(z.id, spot.x, spot.z));
    assert.ok(room, `${lot.name}: you land in no room at all`);
    // back to the street before the next door
    const out = swap.exitLot();
    assert.ok(out, 'a lot entered from a city must remember its city');
  }
});

test('the interior is DERIVED, not stored: the same door is the same building', () => {
  const { swap } = swapFor();
  const lot = swap.place.world.lots().find((l) => l.civic);
  assert.ok(lot, 'the civic deck was never dealt');

  swap.enterLot(lot, demoScript(lot.archetype));
  const first = fingerprint(swap.place.world.map);
  const lotSeed = swap.currentLotSeed();
  swap.exitLot();
  swap.enterLot(lot, demoScript(lot.archetype));
  assert.equal(fingerprint(swap.place.world.map), first, 'the same door gave different rooms');
  assert.equal(swap.currentLotSeed(), lotSeed, 'the door\'s identity moved under it');
});

test('two different doors are two different buildings', () => {
  const { swap } = swapFor();
  const lots = swap.place.world.lots().filter((l) => l.kind === 'house').slice(0, 2);
  assert.equal(lots.length, 2, 'a street should have at least two houses');
  const prints = lots.map((l) => { swap.enterLot(l); const p = fingerprint(swap.place.world.map); swap.exitLot(); return p; });
  assert.notEqual(prints[0], prints[1], 'two different doors composed the same house');
});

test('walking out puts you back on the street, on your feet, at the door you used', () => {
  const { swap } = swapFor();
  const lot = swap.place.world.lots().find((l) => l.civic);
  swap.enterLot(lot, demoScript(lot.archetype));
  const out = swap.exitLot();
  assert.equal(swap.place.kind, 'city');
  assert.equal(swap.place.theme, 'day');
  assert.equal(swap.seed, CITY_SEED, 'the city we came back to is not the city we left');
  const d = Math.hypot(out.x - lot.door.x, out.z - lot.door.z);
  assert.ok(d <= 8, `landed ${d.toFixed(1)} u from the door`);
  assert.equal(swap.world.blocked(out.x, out.z, 1.3), false, 'you came out inside a wall');
});

test('a standalone interior still leaves — it just has no street to remember', () => {
  const { swap } = swapFor();
  const spot = swap.standalone('haunted', 42, demoScript('haunted'));
  assert.equal(swap.place.kind, 'interior');
  assert.equal(swap.place.world.map.archetype, 'haunted');
  assert.equal(swap.world.blocked(spot.x, spot.z, 1.3), false);
  assert.equal(swap.currentLotSeed(), null);
  assert.equal(swap.exitLot(), null, 'there was no city behind it to go back to');
});

test('the extras the composer cast are actually in the scene, in their rooms', () => {
  const { swap } = swapFor();
  swap.standalone('school', 7, demoScript('school'));
  const map = swap.place.world.map;
  assert.equal(swap.extras.length, map.people.length);
  assert.ok(map.people.length > 0, 'the school cast nobody');
  for (const e of swap.extras) {
    const zone = map.zones.find((z) => z.id === e.person.zone);
    assert.ok(zone, `${e.person.role} stands in a zone that is not in the map`);
    assert.ok(e.rig.position.x >= zone.rect.x0 - 1 && e.rig.position.x <= zone.rect.x1 + 1, `${e.person.role} stands outside ${zone.name}`);
    assert.ok(e.rig.position.z >= zone.rect.z0 - 1 && e.rig.position.z <= zone.rect.z1 + 1, `${e.person.role} stands outside ${zone.name}`);
  }
});

test('a swap frees what it tore down', () => {
  const { swap } = swapFor();
  const lot = swap.place.world.lots()[0];
  swap.enterLot(lot, demoScript(lot.archetype));
  const oldChildren = [...swap.root.children];
  assert.ok(oldChildren.length > 0, 'the interior put nothing in the scene');
  // three announces a release with a 'dispose' event and keeps no flag, so watch the events. One
  // listener per UNIQUE resource: chunks share geometry, and dispose() fires every listener on it.
  const owned = new Set(), shared = new Set();
  for (const c of oldChildren) c.traverse((o) => {
    if (o.geometry) owned.add(o.geometry);
    for (const m of [o.material].flat()) { if (m) (m.userData?.__hullShared ? shared : owned).add(m); }
  });
  assert.ok(owned.size > 0);
  let freed = 0, sharedFreed = 0;
  for (const r of owned) r.addEventListener('dispose', () => freed++);
  for (const r of shared) r.addEventListener('dispose', () => sharedFreed++);

  swap.exitLot();
  for (const c of oldChildren) assert.equal(swap.root.children.includes(c), false, 'a torn-down group is still attached');
  assert.equal(freed, owned.size, `${owned.size - freed} of ${owned.size} per-world resources leaked across the swap`);
  // the prop library's materials are module-level: disposing one blanks the props of every world after
  assert.equal(sharedFreed, 0, 'a swap disposed a material the prop library owns');
  assert.equal(swap.extras.length, 0, 'the extras from the interior are still in the scene');
});

test('everything, from scratch: one seed decides the city, the flavour AND the door', () => {
  const { swap } = swapFor();
  const a = swap.randomize(0xfeed, 'neon', demoScript);
  assert.equal(swap.place.kind, 'interior', 'randomize should land you inside a building');
  const first = fingerprint(swap.place.world.map);
  const lot = swap.place.lot;
  assert.ok(lot, 'randomize should walk you through a real city door');
  assert.equal(swap.world.blocked(a.x, a.z, 1.3), false);

  // the whole trip is reproducible: type the seed back and you get the same building
  const { swap: other } = swapFor(1, 'day');
  const b = other.randomize(0xfeed, 'neon', demoScript);
  assert.equal(fingerprint(other.place.world.map), first);
  assert.equal(other.place.lot.id, lot.id, 'a different door on the same seed');
  assert.deepEqual([b.x, b.z], [a.x, a.z]);

  // and a different seed is a different everything
  const { swap: third } = swapFor();
  third.randomize(0xfeee, 'neon', demoScript);
  assert.notEqual(fingerprint(third.place.world.map), first);
});

test('the floorplan draws both worlds from the plan, not from the scene', async () => {
  const { Floorplan } = await import('../apps/demo/src/floorplan.ts');
  const host = { innerHTML: '', classList: { toggle() {} }, querySelector: (sel) => {
    if (sel === '#fp-canvas') return { width: 760, height: 760, getContext: () => document.createElement('canvas').getContext('2d') };
    return { textContent: '', innerHTML: '', addEventListener() {} };
  } };
  const fp = new Floorplan(host);

  const { swap } = swapFor();
  fp.city(swap.place.world, 0, 0, 0);                       // the street map
  swap.standalone('hospital', 3, demoScript('hospital'));
  const map = swap.place.world.map;
  for (const floor of new Set(map.zones.map((z) => z.floor))) fp.interior(map, map.start.x, map.start.z, 0, floor);
  assert.ok(map.zones.length > 0);
});
