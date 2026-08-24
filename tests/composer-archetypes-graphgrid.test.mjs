// tests/composer-archetypes-graphgrid.test.mjs — data integrity of the STONE / INSTITUTION plan
// archetypes (castle / dungeon / prison / hospital). Single storey by owner decision: no floors,
// no stairs. Run: bunx tsx --test tests/composer-archetypes-graphgrid.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASTLE } from '../packages/core/src/composer/archetypes/castle.ts';
import { DUNGEON } from '../packages/core/src/composer/archetypes/dungeon.ts';
import { PRISON } from '../packages/core/src/composer/archetypes/prison.ts';
import { HOSPITAL } from '../packages/core/src/composer/archetypes/hospital.ts';
import { ARCHETYPES, archetypeIds, archetypeOf } from '../packages/core/src/composer/archetypes/index.ts';
import { CELL } from '../packages/core/src/composer/types.ts';

const PHASE0_TAGS = new Set(['seat', 'surface', 'hide', 'loot', 'light', 'cover', 'workstation', 'focal', 'weenie', 'storage', 'sleep']);
const ROLES = new Set(['entrance', 'hub', 'corridor', 'combat', 'elite', 'puzzle', 'key', 'lock', 'treasure', 'secret', 'npc', 'rest', 'vantage', 'boss', 'exit', 'plain', 'work', 'checkpoint', 'finish', 'plot', 'course', 'base', 'safehouse']);
const FINISHES = new Set(['plank', 'tile', 'flagstone', 'plaster', 'wallpaper', 'carpet', 'panel', 'grass', 'dirt', 'brick']);

const REQUIRED = {
  castle: { worldType: 'dungeon', style: 'castle', kinds: ['gatehouse', 'courtyard', 'throne', 'armoury', 'cells', 'tower', 'chapel', 'kitchen', 'great_hall', 'passage'], flows: ['linear-6', 'hub-3-keys', 'loop-lock-key', 'loop-shortcut', 'two-wings', 'keep-march'], lockKit: ['core_key', 'core_gate'], open: ['courtyard'], boss: 'throne', people: ['guards', 'cook', 'courtier', 'prisoner'] },
  dungeon: { worldType: 'dungeon', style: 'dungeon', kinds: ['entrance', 'chamber', 'cells', 'shrine', 'treasury', 'trap_hall', 'boss_hall', 'corridor'], flows: ['crypt-linear', 'loop-lock-key', 'trap-route', 'two-keys'], lockKit: ['core_key', 'core_gate'], open: [], boss: 'boss_hall', people: ['prisoners', 'lost adventurer', 'cultist'] },
  prison: { worldType: 'lab', style: 'lab', kinds: ['gate', 'cell_block', 'yard', 'cafeteria', 'control', 'vents', 'watchtower', 'main_gate', 'warden', 'hallway'], flows: ['lights-out', 'vent-crawl', 'yard-riot', 'watchtower-post', 'two-blocks'], lockKit: ['core_keycard', 'core_door_locked'], open: ['yard', 'watchtower'], boss: 'warden', people: ['guards', 'inmates', 'warden'] },
  hospital: { worldType: 'lab', style: 'lab', kinds: ['reception', 'ward', 'surgery', 'lab', 'containment', 'storage', 'morgue', 'control', 'hallway'], flows: ['outbreak-linear', 'ward-rounds', 'quarantine-loop', 'morgue-shortcut', 'two-wings', 'isolation-wing'], lockKit: ['core_keycard', 'core_door_locked'], open: [], boss: 'containment', people: ['nurse', 'doctor', 'patient', 'receptionist'] },
};

for (const arch of [CASTLE, DUNGEON, PRISON, HOSPITAL]) {
  const req = REQUIRED[arch.id];
  test(`${arch.id}: identity, keywords, kit`, () => {
    assert.equal(arch.layout, 'plan');
    assert.equal(arch.worldType, req.worldType);
    assert.equal(arch.style, req.style);
    // Scale moved with the third-person camera (types.ts CELL 5 → 7) and walls with it: 20 u for a building,
    // 28 for the stone archetypes whose halls want the height. `cell` must BE the CELL constant — it used to
    // say 5 while the layout ran at 7, so anything that trusted it measured rooms 40 % small.
    assert.equal(arch.cell, CELL);
    assert.equal(arch.wallH, arch.id === 'castle' || arch.id === 'dungeon' ? 28 : 20, `${arch.id} wallH`);
    assert.ok(arch.keywords.includes(arch.id));
    assert.ok(arch.keywords.some((k) => /[α-ω]/.test(k)), 'has a Greek keyword');
    assert.deepEqual([arch.lockKit.key, arch.lockKit.door], req.lockKit);
    assert.ok(arch.chatter.length >= 12, `chatter ${arch.chatter.length} >= 12`);
    assert.ok(Object.keys(arch.styleVariants).length >= 3);
    assert.ok(arch.cycles.length >= 3);
  });

  test(`${arch.id}: every §6 kind exists with a sane recipe, a finish, and on the ground`, () => {
    for (const k of req.kinds) assert.ok(arch.kinds[k], `kind ${k}`);
    for (const [k, r] of Object.entries(arch.kinds)) {
      assert.equal(r.kind, k);
      assert.ok(r.size[0] >= 3 && r.size[1] >= r.size[0], `${k} size`);
      assert.ok(arch.naming[k] && arch.naming[k].length >= 2, `${k} has >= 2 names`);
      for (const a of r.anchors) assert.ok(PHASE0_TAGS.has(a.tag), `${k} anchor tag ${a.tag} is a phase-0 tag`);
      assert.ok(['torch', 'lamp', 'panel', 'candle', 'none'].includes(r.light));
      assert.ok(!r.floor, `${k} is on floor 0`);
      assert.ok(r.finish && FINISHES.has(r.finish.floor) && FINISHES.has(r.finish.wall), `${k} has a finish`);
    }
    assert.ok(!arch.kinds.stairs && !arch.kinds.tower_top && !arch.kinds.basement && !arch.kinds.attic, 'no upper / lower storey kinds');
    for (const k of req.open) { assert.equal(arch.kinds[k].ceil, null, `${k} is open sky`); assert.equal(arch.kinds[k].finish.ceil, 'none', `${k} ceil finish none`); }
    const boss = arch.kinds[req.boss];
    assert.ok(boss.size[0] >= arch.bossArena.minCells, `boss kind ${req.boss} >= bossArena.minCells`);
    const people = new Set(Object.values(arch.kinds).flatMap((r) => r.people?.roles ?? []));
    for (const p of req.people) assert.ok(people.has(p), `people role ${p}`);
  });

  test(`${arch.id}: roleMap / injections / adjacency / aliases reference real kinds`, () => {
    for (const [role, ks] of Object.entries(arch.roleMap)) {
      assert.ok(ROLES.has(role), `role ${role}`);
      for (const k of ks) assert.ok(arch.kinds[k], `roleMap ${role} -> ${k}`);
    }
    for (const inj of arch.injections) { assert.ok(ROLES.has(inj.role)); if (inj.kind) assert.ok(arch.kinds[inj.kind], `injection ${inj.id} kind ${inj.kind}`); for (const r of inj.off) assert.ok(ROLES.has(r)); }
    for (const [a, b] of [...arch.adjacency.prefer, ...arch.adjacency.forbid]) { assert.ok(arch.kinds[a], `adjacency ${a}`); assert.ok(arch.kinds[b], `adjacency ${b}`); }
    for (const [alias, target] of Object.entries(arch.aliases)) {
      if (target.startsWith('*')) continue;
      assert.ok(arch.kinds[target], `alias ${alias} -> ${target}`);
    }
    assert.ok(Object.keys(arch.aliases).some((a) => /[α-ω]/.test(a)), 'Greek alias present');
    assert.ok(Object.keys(arch.naming).every((k) => arch.kinds[k]), 'naming keys are kinds');
  });

  test(`${arch.id}: flows are well-formed and single storey`, () => {
    assert.ok(arch.flows.length >= 4, `flows ${arch.flows.length} >= 4`);
    for (const f of req.flows) assert.ok(arch.flows.some((x) => x.id === f), `flow ${f}`);
    const seen = new Set();
    for (const f of arch.flows) {
      assert.ok(!seen.has(f.id), `duplicate flow ${f.id}`); seen.add(f.id);
      assert.ok(f.nodes.length <= 12, `${f.id} <= 12 nodes`);
      const ids = new Set(f.nodes.map((n) => n.id));
      assert.equal(ids.size, f.nodes.length, `${f.id} unique node ids`);
      assert.equal(f.nodes.filter((n) => n.role === 'entrance').length, 1, `${f.id} one entrance`);
      assert.ok(f.nodes.some((n) => n.role === 'boss' || n.role === 'exit'), `${f.id} ends in boss/exit`);
      for (const n of f.nodes) {
        assert.ok(ROLES.has(n.role), `${f.id} role ${n.role}`);
        if (n.kind) assert.ok(arch.kinds[n.kind], `${f.id} ${n.id} kind ${n.kind}`);
        assert.ok(!n.floor, `${f.id} ${n.id} is on floor 0`);
      }
      const keys = f.nodes.filter((n) => n.role === 'key').length, locks = f.nodes.filter((n) => n.role === 'lock').length;
      assert.ok(locks === 0 || keys >= 1, `${f.id} has a key for its lock`);
      // edges reference nodes; graph is connected
      const adj = new Map([...ids].map((i) => [i, []]));
      for (const [a, b] of f.edges) { assert.ok(ids.has(a) && ids.has(b), `${f.id} edge ${a}-${b}`); assert.notEqual(a, b); adj.get(a).push(b); adj.get(b).push(a); }
      const stack = [f.nodes[0].id], vis = new Set(stack);
      while (stack.length) for (const m of adj.get(stack.pop())) if (!vis.has(m)) { vis.add(m); stack.push(m); }
      assert.equal(vis.size, ids.size, `${f.id} connected`);
      // loops are real cycles over existing edges
      const has = (a, b) => adj.get(a).includes(b);
      for (const loop of f.loops) {
        assert.ok(loop.length >= 3, `${f.id} loop length`);
        for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; assert.ok(ids.has(a), `${f.id} loop node ${a}`); assert.ok(has(a, b), `${f.id} loop edge ${a}-${b}`); }
      }
    }
  });
}

test('castle: the tower is a ground-level vantage room; the throne is the boss; stone finishes, dirt cells', () => {
  assert.equal(CASTLE.kinds.tower.floor, undefined);
  for (const f of CASTLE.flows) for (const n of f.nodes) if (n.kind === 'tower') assert.equal(n.role, 'vantage', `${f.id} tower is vantage`);
  const march = CASTLE.flows.find((x) => x.id === 'keep-march');
  assert.equal(march.nodes.find((n) => n.role === 'boss').kind, 'throne');
  assert.deepEqual(CASTLE.kinds.armoury.finish, { floor: 'flagstone', wall: 'flagstone', trim: 'stone' });
  assert.equal(CASTLE.kinds.cells.finish.floor, 'dirt');
  assert.equal(CASTLE.kinds.courtyard.finish.ceil, 'none');
  assert.equal(CASTLE.aliases.battlements, 'tower');
});

test('dungeon: boss_hall is always the boss, cells hold keys or secrets, four+ flows, lock-and-key loop', () => {
  for (const f of DUNGEON.flows) for (const n of f.nodes) {
    if (n.kind === 'boss_hall') assert.equal(n.role, 'boss', `${f.id}`);
    if (n.kind === 'cells') assert.ok(['key', 'secret'].includes(n.role), `${f.id} cells`);
    if (n.kind === 'treasury') assert.equal(n.role, 'lock', `${f.id} treasury is the lock`);
  }
  assert.ok(DUNGEON.flows.some((f) => f.loops.length && f.nodes.some((n) => n.role === 'key') && f.nodes.some((n) => n.role === 'lock')));
  assert.ok(DUNGEON.flows.some((f) => f.nodes.some((n) => n.kind === 'trap_hall')));
  assert.equal(DUNGEON.kinds.cells.finish.floor, 'dirt');
  assert.deepEqual(DUNGEON.kinds.chamber.finish, { floor: 'flagstone', wall: 'flagstone', trim: 'stone' });
  for (const k of ['dungeon', 'boudroumi', 'μπουντρουμι', 'labyrinth', 'κρυπτη']) assert.ok(DUNGEON.keywords.includes(k), `dungeon keyword ${k}`);
  assert.equal(DUNGEON.aliases['θησαυρος'], 'treasury'); assert.equal(DUNGEON.aliases['keli'], 'cells');
});

test('prison: main_gate is the lock, control is the key, vents secret, watchtower a ground-level open post', () => {
  for (const f of PRISON.flows) {
    for (const n of f.nodes) {
      if (n.kind === 'main_gate') assert.equal(n.role, 'lock', `${f.id} main_gate is lock`);
      if (n.kind === 'vents') assert.equal(n.role, 'secret', `${f.id} vents is secret`);
      if (n.kind === 'watchtower') assert.equal(n.role, 'vantage', `${f.id} watchtower is vantage`);
    }
  }
  assert.equal(PRISON.kinds.watchtower.floor, undefined);
  assert.equal(PRISON.kinds.watchtower.ceil, null);
  assert.equal(PRISON.kinds.cafeteria.finish.floor, 'tile');
  assert.equal(PRISON.kinds.yard.finish.floor, 'dirt');
});

test('hospital: containment is always the boss, morgue the secret, wet rooms tiled', () => {
  for (const f of HOSPITAL.flows) for (const n of f.nodes) {
    if (n.kind === 'containment') assert.equal(n.role, 'boss', `${f.id}`);
    if (n.kind === 'morgue') assert.equal(n.role, 'secret', `${f.id}`);
  }
  const wardFlows = HOSPITAL.flows.filter((f) => f.nodes.filter((n) => n.kind === 'ward').length >= 2);
  assert.ok(wardFlows.length >= 3, 'most flows carry ward x2');
  assert.deepEqual(HOSPITAL.kinds.surgery.finish, { floor: 'tile', wall: 'tile', trim: 'none' });
  assert.equal(HOSPITAL.kinds.ward.finish.wall, 'panel');
  assert.equal(HOSPITAL.kinds.hallway.finish.plankAxis, 'long');
});

test('registry: nine archetypes, dungeon and office included, looked up by id', () => {
  const ids = archetypeIds();
  for (const id of ['house', 'school', 'shop', 'office', 'haunted', 'castle', 'dungeon', 'prison', 'hospital']) assert.ok(ids.includes(id), `registered ${id}`);
  assert.equal(archetypeOf('dungeon'), DUNGEON);
  assert.equal(archetypeOf('nope'), undefined);
  for (const a of Object.values(ARCHETYPES)) assert.equal(a.layout, 'plan', `${a.id} is a plan archetype`);
});

test('determinism: archetype data is plain JSON (no functions, no NaN)', () => {
  for (const arch of Object.values(ARCHETYPES)) {
    const json = JSON.stringify(arch);
    assert.deepEqual(JSON.parse(json), arch, `${arch.id} round-trips through JSON`);
    assert.ok(!/NaN|Infinity/.test(json));
  }
});
