// The five HOUSE-family plan archetypes (house, school, shop, office, haunted) are self-consistent
// data, and typeAndName gives zones stable ids / names / aliases / finishes from the seed alone.
// Run: bunx tsx --test tests/composer-spine-archetypes.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { HOUSE } from '../packages/core/src/composer/archetypes/house.ts';
import { SCHOOL } from '../packages/core/src/composer/archetypes/school.ts';
import { SHOP } from '../packages/core/src/composer/archetypes/shop.ts';
import { OFFICE } from '../packages/core/src/composer/archetypes/office.ts';
import { HAUNTED } from '../packages/core/src/composer/archetypes/haunted.ts';
import { ARCHETYPES } from '../packages/core/src/composer/archetypes/index.ts';
import { CELL } from '../packages/core/src/composer/types.ts';
import { typeAndName, deaccent } from '../packages/core/src/composer/typeAndName.ts';

const ARCHES = { house: HOUSE, school: SCHOOL, shop: SHOP, office: OFFICE, haunted: HAUNTED };
const REQUIRED = {
  house: ['foyer', 'kitchen', 'living', 'bedroom', 'bath', 'study', 'dining', 'storage', 'cellar', 'garage', 'yard', 'corridor'],
  school: ['lobby', 'locker_hall', 'classroom', 'cafeteria', 'gym', 'office', 'library', 'bathroom', 'janitor', 'field', 'bleachers', 'corridor'],
  shop: ['storefront', 'counter', 'kitchen', 'storage', 'office', 'delivery', 'concourse', 'store', 'food_court', 'yard', 'corridor'],
  office: ['lobby', 'open_plan', 'meeting', 'boss_office', 'server_room', 'kitchenette', 'bathroom', 'storage', 'corridor'],
  haunted: ['foyer', 'corridor', 'library', 'suite', 'dining', 'cellar', 'loft', 'closet', 'passage', 'ballroom'],
};
const STYLE_IDS = new Set(['house.cozy', 'house.modern', 'castle', 'haunted', 'school', 'shop', 'dungeon', 'lab']);
const TAGS = new Set(['seat', 'surface', 'hide', 'loot', 'light', 'cover', 'workstation', 'focal', 'sleep', 'storage']);
const FINISHES = new Set(['plank', 'tile', 'flagstone', 'plaster', 'wallpaper', 'carpet', 'panel', 'grass', 'dirt', 'brick']);
/** Service rooms may be 3×3; everything else is a real room (≥ 4 cells a side). */
const SERVICE = new Set(['bath', 'bathroom', 'closet', 'storage', 'vents', 'janitor', 'passage', 'corridor', 'hallway']);

for (const [id, a] of Object.entries(ARCHES)) {
  test(`${id}: every referenced kind exists and every flow is well-formed`, () => {
    assert.equal(a.id, id); assert.equal(a.layout, 'plan'); assert.equal(a.cell, CELL);
    for (const k of REQUIRED[id]) assert.ok(a.kinds[k], `${id} lacks guaranteed kind ${k}`);
    for (const [role, kinds] of Object.entries(a.roleMap)) for (const k of kinds) assert.ok(a.kinds[k], `${id}.roleMap.${role} → missing kind ${k}`);
    for (const k of Object.keys(a.naming)) assert.ok(a.kinds[k], `${id}.naming has unknown kind ${k}`);
    for (const k of Object.keys(a.kinds)) { assert.ok(a.naming[k]?.length >= 2, `${id}.naming.${k} needs 2+ names`); assert.equal(a.kinds[k].kind, k); }
    for (const [w, k] of Object.entries(a.aliases)) { assert.equal(w, deaccent(w), `${id} alias '${w}' must be deaccented lower-case`); if (!k.startsWith('*')) assert.ok(a.kinds[k], `${id}.aliases.${w} → missing kind ${k}`); }
    for (const w of ['*door', '*boss', '*key', '*vantage', '*course']) assert.ok(Object.values(a.aliases).includes(w), `${id} lacks ${w} alias`);
    for (const inj of a.injections) if (inj.kind) assert.ok(a.kinds[inj.kind], `${id}.injections.${inj.id} → missing kind`);
    for (const pair of [...a.adjacency.prefer, ...a.adjacency.forbid]) for (const k of pair) assert.ok(a.kinds[k], `${id}.adjacency → missing kind ${k}`);
    assert.ok(STYLE_IDS.has(a.style)); for (const s of Object.values(a.styleVariants)) assert.ok(STYLE_IDS.has(s), `${id} style variant ${s}`);
    for (const r of Object.values(a.kinds)) for (const an of r.anchors) assert.ok(TAGS.has(an.tag), `${id}.${r.kind} anchor tag ${an.tag}`);
    assert.ok(a.flows.length >= 4);
    assert.ok(a.flows.some((f) => f.nodes.some((n) => n.role === 'course')), `${id} needs a course flow`);
    assert.ok(a.flows.some((f) => f.loops.length && f.nodes.some((n) => n.role === 'key') && f.nodes.some((n) => n.role === 'lock')), `${id} needs a lock-and-key loop`);
    for (const f of a.flows) {
      assert.ok(f.nodes.length <= 12, `${id}.${f.id} > 12 nodes`);
      const ids = new Set(f.nodes.map((n) => n.id)); assert.equal(ids.size, f.nodes.length, `${id}.${f.id} duplicate node ids`);
      for (const n of f.nodes) assert.ok(!n.kind || a.kinds[n.kind], `${id}.${f.id}.${n.id} kind ${n.kind}`);
      for (const [x, y] of f.edges) assert.ok(ids.has(x) && ids.has(y), `${id}.${f.id} edge ${x}-${y} references unknown node`);
      for (const loop of f.loops) for (const n of loop) assert.ok(ids.has(n), `${id}.${f.id} loop references unknown ${n}`);
      assert.equal(f.nodes.filter((n) => n.role === 'entrance').length, 1, `${id}.${f.id} needs exactly one entrance`);
    }
    assert.ok(a.chatter.length >= 14, `${id} chatter < 14`);
    assert.ok(a.keywords.some((k) => /[α-ω]/.test(k)), `${id} needs Greek keywords`);
    assert.ok(Object.keys(a.aliases).some((k) => /[α-ω]/.test(k)), `${id} needs Greek aliases`);
  });
}

test('office: keywords, people and the lock-and-key loop the brief asked for', () => {
  for (const k of ['office', 'grafeio', 'γραφειο', 'company', 'startup', 'hq']) assert.ok(OFFICE.keywords.includes(k), `office keyword ${k}`);
  assert.equal(OFFICE.worldType, 'house'); assert.equal(OFFICE.style, 'house.modern');
  const people = new Set(Object.values(OFFICE.kinds).flatMap((r) => r.people?.roles ?? []));
  for (const p of ['receptionist', 'developer', 'manager', 'intern']) assert.ok(people.has(p), `office people ${p}`);
  const loop = OFFICE.flows.find((f) => f.id === 'loop-lock-key');
  assert.ok(loop.loops.length >= 1);
  assert.ok(loop.nodes.some((n) => n.role === 'key') && loop.nodes.some((n) => n.role === 'lock' && n.kind === 'server_room'));
});

// ---------------------------------------------------------------------------
// THE SINGLE-STOREY + FINISH CONTRACT, over every registered archetype (office / dungeon included)
// ---------------------------------------------------------------------------
test('every registered archetype: plan layout, every kind has a finish, no floor ≠ 0 anywhere, no stairs', () => {
  const all = Object.values(ARCHETYPES);
  assert.ok(all.length >= 9, `${all.length} archetypes registered`);
  for (const a of all) {
    assert.equal(a.layout, 'plan', `${a.id} layout`);
    assert.equal(a.cell, CELL, `${a.id} cell`);   // the archetype must quote the real CELL, never a stale copy
    assert.ok(!a.kinds.stairs && !a.roleMap.stairs, `${a.id} has no stairs kind / role`);
    for (const [k, r] of Object.entries(a.kinds)) {
      assert.ok(r.finish, `${a.id}.${k} has a finish`);
      assert.ok(FINISHES.has(r.finish.floor), `${a.id}.${k} floor finish ${r.finish.floor}`);
      assert.ok(FINISHES.has(r.finish.wall), `${a.id}.${k} wall finish ${r.finish.wall}`);
      if (r.finish.ceil !== undefined) assert.ok(r.finish.ceil === 'none' || FINISHES.has(r.finish.ceil), `${a.id}.${k} ceil finish`);
      if (r.finish.plankAxis !== undefined) assert.ok(['long', 'x', 'z'].includes(r.finish.plankAxis), `${a.id}.${k} plankAxis`);
      if (r.ceil === null) assert.equal(r.finish.ceil, 'none', `${a.id}.${k} is open sky → ceil finish 'none'`);
      assert.ok(!r.floor, `${a.id}.${k} sits on floor 0`);
      assert.ok(!/attic|basement|tower_top|stairs/.test(k), `${a.id}.${k} is a ground-level kind`);
      // sizes: service rooms may be 3×3; ordinary rooms ≥ 4 cells; nothing wider than 12
      assert.ok(r.size[0] >= 3 && r.size[1] >= r.size[0] && r.size[1] <= 12, `${a.id}.${k} size ${r.size}`);
      if (!SERVICE.has(k)) assert.ok(r.size[0] >= 4, `${a.id}.${k} is an ordinary room → ≥ 4 cells (got ${r.size[0]})`);
    }
    for (const f of a.flows) for (const n of f.nodes) {
      assert.ok(!n.floor, `${a.id}.${f.id}.${n.id} floor ${n.floor}`);
      assert.notEqual(n.role, 'stairs', `${a.id}.${f.id}.${n.id} stairs role`);
    }
    // the boss kind is at least the arena minimum
    const bossKinds = a.roleMap.boss ?? [];
    assert.ok(bossKinds.some((k) => a.kinds[k].size[1] >= a.bossArena.minCells), `${a.id} has a boss kind that can hold the arena`);
  }
});

/** A fake embedded layout from a flow: one zone per node plus one corridor, provisional ids. */
function fakeLayout(a, flow) {
  const zone = (id, i) => ({ id, name: '', kind: '', role: 'plain', depth: i, rect: { x0: 0, z0: 0, x1: 10, z1: 10 }, cells: { x0: 0, z0: 0, x1: 1, z1: 1 }, floor: 0, floorY: 0, doors: [], spots: { center: { x: 0, z: 0, yaw: 0, floor: 0 }, npc: [], loot: [], hide: [] }, chunks: [], tags: [] });
  const zones = flow.nodes.map((n, i) => zone(`z${i}`, i)); zones.push(zone('corr', 1));
  const nodeZone = Object.fromEntries(flow.nodes.map((n, i) => [n.id, `z${i}`]));
  const doors = flow.edges.map(([x, y], i) => ({ id: `d${i}`, x: 0, z: 0, yaw: 0, w: 10, between: [nodeZone[x], nodeZone[y]], collider: { x0: 0, z0: 0, x1: 1, z1: 1, floor: 0 }, floor: 0 }));
  doors.push({ id: 'dc', x: 0, z: 0, yaw: 0, w: 10, between: ['z0', 'corr'], collider: { x0: 0, z0: 0, x1: 1, z1: 1, floor: 0 }, floor: 0 });
  const g = { nodes: flow.nodes.map((n, i) => ({ ...n, depth: i, tags: [] })), edges: flow.edges.map(([x, y]) => ({ a: x, b: y })), loops: flow.loops, keys: [], criticalPath: [], flowId: flow.id };
  return { layout: { grids: {}, zones, doors, walls: [], colliders: [{ x0: 0, z0: 0, x1: 1, z1: 1, floor: 0, id: 'z0' }], start: { x: 0, z: 0, yaw: 0, floor: 0 }, nodeZone }, g };
}

test('typeAndName: ids, ordinals, names, references, aliases and finishes', () => {
  const flow = SCHOOL.flows.find((f) => f.id === 'school-day');
  const { layout, g } = fakeLayout(SCHOOL, flow);
  g.nodes[2].req = { alias: 'Mrs Papas room', role: 'npc' };
  const aliases = typeAndName(layout, g, SCHOOL, 42, [g.nodes[2].req, { alias: 'Η Βιβλιοθήκη', kind: 'library' }, { alias: 'the big gym', role: 'hub' }]);
  const ids = layout.zones.map((z) => z.id);
  assert.ok(ids.includes('school.lobby#1') && ids.includes('school.classroom#1') && ids.includes('school.classroom#2') && ids.includes('school.corridor#1'));
  assert.equal(layout.zones.find((z) => z.id === 'school.classroom#2').name, 'Classroom 2B');
  assert.equal(layout.zones.find((z) => z.id === 'school.corridor#1').name, 'Corridor');
  assert.equal(layout.zones.find((z) => z.id === 'school.office#1').role, 'lock');
  for (const d of layout.doors) for (const s of d.between) assert.ok(ids.includes(s), `door ${d.id} references stale ${s}`);
  for (const v of Object.values(layout.nodeZone)) assert.ok(ids.includes(v));
  assert.equal(layout.colliders[0].id, 'school.lobby#1');
  for (const z of layout.zones) for (const d of z.doors) assert.ok(layout.doors.find((dd) => dd.id === d && dd.between.includes(z.id)));
  assert.equal(g.nodes[0].zoneId, 'school.lobby#1');
  assert.equal(aliases['library'], 'school.library#1');
  assert.equal(aliases['βιβλιοθηκη'], 'school.library#1');
  assert.equal(aliases['η βιβλιοθηκη'], 'school.library#1');
  assert.equal(aliases['second classroom'], 'school.classroom#2');
  assert.equal(aliases['classroom 2b'], 'school.classroom#2');
  assert.equal(aliases['the locked room'], 'school.office#1');
  assert.equal(aliases['key'], 'school.library#1');
  assert.equal(aliases['door'], 'school.office#1');
  assert.equal(aliases['mrs papas room'], 'school.classroom#1');
  assert.equal(aliases['the big gym'], 'school.gym#1');
  assert.equal(aliases['entrance'], 'school.lobby#1');
  // finishes: copied from the kind onto the zone (a copy, not the shared object), corridors included
  for (const z of layout.zones) {
    assert.deepEqual(z.finish, SCHOOL.kinds[z.kind].finish, `${z.id} finish`);
    assert.notEqual(z.finish, SCHOOL.kinds[z.kind].finish, `${z.id} finish is a copy`);
  }
  assert.deepEqual(layout.zones.find((z) => z.id === 'school.cafeteria#1').finish, { floor: 'tile', wall: 'tile', trim: 'none' });
  assert.equal(layout.zones.find((z) => z.id === 'school.field#1').finish.ceil, 'none');
  assert.equal(layout.zones.find((z) => z.id === 'school.corridor#1').finish.plankAxis, 'long');
});

test('typeAndName: names wrap with roman numerals and the result is seed-deterministic', () => {
  const flow = { id: 'many', tier: 'easy', nodes: [{ id: 'n0', role: 'entrance' }, { id: 'n1', role: 'plain' }, { id: 'n2', role: 'plain' }, { id: 'n3', role: 'plain' }, { id: 'n4', role: 'plain' }, { id: 'n5', role: 'plain' }, { id: 'n6', role: 'boss' }], edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4'], ['n4', 'n5'], ['n5', 'n6']], loops: [] };
  const run = (seed) => { const { layout, g } = fakeLayout(HOUSE, flow); const al = typeAndName(layout, g, HOUSE, seed, []); return { ids: layout.zones.map((z) => z.id + '=' + z.name), al }; };
  assert.deepEqual(run(7), run(7));
  const r = run(7);
  for (const s of r.ids) assert.match(s, /^house\.[a-z_]+#\d+=.+/);
  // bath has 3 names: a 4th bath would read 'Bathroom II'
  const { layout, g } = fakeLayout(HOUSE, { ...flow, nodes: flow.nodes.map((n, i) => (i > 0 && i < 6 ? { ...n, kind: 'bath' } : n)) });
  typeAndName(layout, g, HOUSE, 1, []);
  assert.equal(layout.zones.find((z) => z.id === 'house.bath#4').name, 'Bathroom II');
  assert.equal(layout.zones.find((z) => z.id === 'house.bath#5').name, 'Guest Bathroom II');
});

test('house aliases: the old attic / basement words still resolve (to the ground-level storage / cellar)', () => {
  assert.equal(HOUSE.aliases.attic, 'storage'); assert.equal(HOUSE.aliases['σοφιτα'], 'storage');
  assert.equal(HOUSE.aliases.basement, 'cellar'); assert.equal(HOUSE.aliases['υπογειο'], 'cellar');
  assert.equal(HAUNTED.aliases.attic, 'loft'); assert.equal(HAUNTED.aliases.basement, 'cellar');
});
