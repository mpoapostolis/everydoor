// Mission graph stage (composer/mission.ts + cycles.ts): pacing invariants on every non-null
// graph, every request bound, the linear fallback always valid, byte-determinism from the seed.
//   bunx tsx --test tests/composer-mission.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildMission, linearMission, pacingProblems } from '../packages/core/src/composer/mission.ts';
import { genericArchetype } from '../packages/core/src/composer/archetypes/generic.ts';
import { hash32, Rng } from '../packages/core/src/composer/rng.ts';
import { KID_SAFE_CYCLES } from '../packages/core/src/composer/types.ts';

const arch = genericArchetype('castle', 'dungeon', 'graph-grid');
const hardArch = { ...arch, cycles: [...KID_SAFE_CYCLES.hard] };
const TIERS = ['easy', 'hard'];

const checkInvariants = (g, label) => {
  const probs = pacingProblems(g);
  assert.deepEqual(probs, [], `${label}: ${probs.join('; ')}`);
  assert.ok(g.criticalPath.length >= 5 && g.criticalPath.length <= 9, `${label}: critical path`);
  assert.equal(g.nodes.find((n) => n.id === g.criticalPath[0]).role, 'entrance', `${label}: path starts at entrance`);
  assert.equal(g.nodes.find((n) => n.id === g.criticalPath[g.criticalPath.length - 1]).role, 'boss', `${label}: path ends at boss`);
  for (const k of g.keys) {
    assert.ok(g.nodes.some((n) => n.id === k.node), `${label}: key ${k.id} in a node`);
    assert.ok(g.edges.some((e) => e.lock === k.opens), `${label}: key ${k.id} opens an existing lock`);
    assert.ok(k.item, `${label}: key has an item`);
  }
  for (const e of g.edges) if (e.lock) assert.ok(g.keys.some((k) => k.opens === e.lock), `${label}: lock ${e.lock} has a key`);
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.equal(ids.size, g.nodes.length, `${label}: unique ids`);
  for (const e of g.edges) assert.ok(ids.has(e.a) && ids.has(e.b), `${label}: dangling edge`);
};

test('1000 seeds × both tiers: pacing holds on every non-null graph, null rate < 40%', () => {
  for (const tier of TIERS) for (const a of [arch, hardArch]) {
    let nulls = 0;
    for (let s = 0; s < 1000; s++) {
      const g = buildMission(s * 7919 + 13, a, [], tier);
      if (!g) { nulls++; continue; }
      checkInvariants(g, `seed ${s} ${tier} ${a.cycles.length}`);
    }
    assert.ok(nulls / 1000 < 0.4, `${tier}: null rate ${nulls / 1000}`);
  }
});

const ROLES = ['combat', 'elite', 'puzzle', 'key', 'lock', 'treasure', 'secret', 'npc', 'rest', 'vantage', 'boss', 'plain', 'work', 'plot', 'course', 'hub', 'exit', 'stairs', 'entrance', 'checkpoint'];
const KINDS = Object.keys(arch.kinds);
const ALIASES = Object.keys(arch.aliases);
const fuzzReqs = (seed) => {
  const r = new Rng(hash32(seed, 'fuzz'));
  const n = r.int(1, 6);
  const reqs = [];
  for (let i = 0; i < n; i++) {
    const req = { alias: r.chance(0.5) ? r.pick(ALIASES) : 'place' + i };
    if (r.chance(0.6)) req.role = r.pick(ROLES);
    if (r.chance(0.5)) req.kind = r.pick(KINDS);
    if (r.chance(0.15)) req.item = 'item' + i;
    if (r.chance(0.1)) req.boss = 'Ogre';
    reqs.push(req);
  }
  return reqs;
};

test('200 fuzzed request lists: every request is bound (buildMission or the linear fallback)', () => {
  let nulls = 0;
  for (let s = 0; s < 200; s++) {
    const reqs = fuzzReqs(s);
    const tier = s % 2 ? 'hard' : 'easy';
    let g = buildMission(s, hardArch, reqs, tier);
    if (!g) { nulls++; g = linearMission(s, hardArch, reqs); }
    checkInvariants(g, `fuzz ${s}`);
    for (const req of reqs) assert.ok(g.nodes.some((n) => n.req === req), `fuzz ${s}: unbound ${JSON.stringify(req)}`);
    for (const n of g.nodes) if (n.req?.item && n.role === 'key') assert.ok(g.keys.some((k) => k.node === n.id && k.item === n.req.item), `fuzz ${s}: key item carried`);
  }
  assert.ok(nulls < 200, 'buildMission binds some fuzzed lists without falling back');
});

test('linearMission never fails pacing and binds every request', () => {
  for (let s = 0; s < 300; s++) {
    const reqs = s % 3 === 0 ? [] : fuzzReqs(s + 5000);
    const g = linearMission(s, arch, reqs);
    checkInvariants(g, `linear ${s}`);
    for (const req of reqs) assert.ok(g.nodes.some((n) => n.req === req), `linear ${s}: unbound ${req.alias}`);
  }
});

test('determinism: same seed → deep-equal graph; different seed → different flow or shape somewhere', () => {
  const reqs = [{ role: 'key', alias: 'key', item: 'brass key' }, { kind: 'vault', alias: 'vault' }, { role: 'npc', alias: 'guard' }];
  const seen = new Set();
  for (let s = 0; s < 50; s++) {
    const a = buildMission(s, hardArch, reqs, 'hard'), b = buildMission(s, hardArch, reqs, 'hard');
    assert.deepEqual(a, b, `seed ${s}`);
    assert.deepEqual(linearMission(s, arch, reqs), linearMission(s, arch, reqs));
    if (a) seen.add(JSON.stringify(a));
  }
  assert.ok(seen.size > 1, 'seeds produce different graphs');
});

test('lock requests lock a real door and a reorder records a warning', () => {
  let warned = false;
  for (let s = 0; s < 200; s++) {
    const g = buildMission(s, hardArch, [{ role: 'lock', alias: 'gate' }, { role: 'key', alias: 'key' }], 'hard') ?? linearMission(s, hardArch, [{ role: 'lock', alias: 'gate' }]);
    const lockNode = g.nodes.find((n) => n.req?.alias === 'gate');
    assert.ok(lockNode && g.edges.some((e) => e.lock && (e.a === lockNode.id || e.b === lockNode.id)), `seed ${s}: gate has a locked door`);
    if (g.warnings.length) warned = true;
  }
  for (let s = 0; s < 200 && !warned; s++) { const g = buildMission(s, hardArch, fuzzReqs(s), 'hard'); if (g?.warnings.some((w) => w.startsWith('Moved "'))) warned = true; }
  assert.ok(warned, 'some seed needed a reorder and recorded the "Moved … so the key comes first" warning');
});

test('slots expand (combat+ 1..3 with calm rooms between, store+ 4..8 siblings) and the graph stays valid', () => {
  const slotArch = { ...hardArch, flows: [{ id: 'slots', tier: 'easy',
    nodes: [{ id: 'n0', role: 'entrance' }, { id: 'n1', role: 'hub' }, { id: 'c', role: 'combat', slot: 'combat+' }, { id: 'st', role: 'work', kind: 'store', slot: 'store+' }, { id: 'r', role: 'rest' }, { id: 'b', role: 'boss' }],
    edges: [['n0', 'n1'], ['n1', 'c'], ['n1', 'st'], ['c', 'r'], ['r', 'b']], loops: [] }] };
  const stores = new Set(), fights = new Set();
  for (let s = 0; s < 200; s++) {
    const g = buildMission(s, slotArch, [], 'easy');
    assert.ok(g, `seed ${s}: slot flow rejected`);
    checkInvariants(g, `slots ${s}`);
    stores.add(g.nodes.filter((n) => n.kind === 'store').length);
    fights.add(g.nodes.filter((n) => n.role === 'combat').length);
  }
  assert.deepEqual([...stores].sort(), [4, 5, 6, 7, 8]);
  assert.deepEqual([...fights].sort(), [1, 2, 3]);
});

test('hard tier uses the hard-only cycle patterns on some seed', () => {
  const tags = new Set();
  for (let s = 0; s < 200; s++) { const g = buildMission(s, hardArch, [], 'hard'); if (g) for (const n of g.nodes) for (const t of n.tags) if (t.startsWith('cycle:')) tags.add(t); }
  for (const p of ['patrol', 'dangerous-route', 'blocked-retreat', 'foreshadow', 'two-keys']) assert.ok(tags.has('cycle:' + p), p);
  for (let s = 0; s < 200; s++) { const g = buildMission(s, hardArch, [], 'easy'); if (g) for (const n of g.nodes) for (const t of n.tags) assert.ok(!['cycle:patrol', 'cycle:dangerous-route', 'cycle:blocked-retreat'].includes(t), 'easy stays kid-safe'); }
});
