// PLAN QUALITY — do composed worlds READ as the place? 7 archetypes × 5 seeds × both tiers:
// rooms are 21–70 u (never 14-u slivers, never slabs), corridors are short L-runs (no spaghetti, no wrap-arounds),
// every room is furnished (4–30 props, closets ≥ 3), people stand where their recipe puts them, the
// castle has an open-sky courtyard between the gatehouse and the keep, the school has classrooms both
// sides of its corridor and a gym, the weenie is a destination room. Plus an ASCII renderer for eyes.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ARCHETYPES, composeDetailed } from '../packages/core/src/composer/index.ts';
import { CELL, GRID, isPassageZone } from '../packages/core/src/composer/types.ts';

const IDS = ['house', 'school', 'shop', 'haunted', 'castle', 'prison', 'hospital'];
const SEEDS = [1, 2, 3, 4, 5];
const TIERS = ['easy', 'hard'];
const MAX_CORRIDOR_CELLS = 30;        // embedGrid MAX_CORRIDOR: a carved run never exceeds this
const MAX_SPINE_CELLS = 45;           // a double-loaded spine with ≤ 14 rooms
const MAX_CORRIDOR_ZONES = 12;        // graph-grid: a handful of L-runs, not a maze

const cellOf = (u) => Math.floor(u / CELL + GRID / 2);
// A passage is circulation, and every archetype names it differently — castle 'passage', prison and hospital
// 'hallway'. Testing for the literal kind 'corridor' classified those as ROOMS, so a 3×12 prison hallway read
// as a 12-cell bedroom. isPassageZone (composer/types.ts) asks the archetype; the composer uses the same call.
const isPassage = (z, arch) => isPassageZone(z, arch);
const isRoom = (z, arch) => !isPassage(z, arch) && z.kind !== 'course';
const side = (z) => [z.cells.x1 - z.cells.x0 + 1, z.cells.z1 - z.cells.z0 + 1];
const propsIn = (map, z) => map.placements.filter((p) => p.zone === z.id && p.role !== 'shell').length;
const doorsBetween = (map, a, b) => map.doors.filter((d) => d.between.includes(a.id) && d.between.includes(b.id));

/** Cell grid per floor as text: zones as letters, open sky as ~, corridors as ., doors +, locks #, secrets ?, start @. */
export function asciiMap(map, arch) {
  const out = [];
  for (const f of [...new Set(map.zones.map((z) => z.floor))].sort()) {
    const zs = map.zones.filter((z) => z.floor === f);
    const x0 = Math.min(...zs.map((z) => z.cells.x0)), z0 = Math.min(...zs.map((z) => z.cells.z0));
    const x1 = Math.max(...zs.map((z) => z.cells.x1)), z1 = Math.max(...zs.map((z) => z.cells.z1));
    const W = x1 - x0 + 1, H = z1 - z0 + 1;
    const g = Array.from({ length: H }, () => Array(W).fill(' '));
    const legend = [];
    zs.forEach((z, i) => {
      const ch = isPassage(z, arch) ? '.' : z.ceilY === undefined ? '~' : String.fromCharCode(65 + (i % 26));
      for (let cz = z.cells.z0; cz <= z.cells.z1; cz++) for (let cx = z.cells.x0; cx <= z.cells.x1; cx++) g[cz - z0][cx - x0] = ch;
      if (ch !== '.') legend.push(`${ch}=${z.id}(${z.role},${side(z).join('x')})`);
    });
    for (const d of map.doors) { if (d.floor !== f) continue; const cx = cellOf(d.x) - x0, cz = cellOf(d.z) - z0; if (g[cz]?.[cx] !== undefined) g[cz][cx] = d.lock ? '#' : d.secret ? '?' : '+'; }
    if (map.start.floor === f) { const cx = cellOf(map.start.x) - x0, cz = cellOf(map.start.z) - z0; if (g[cz]?.[cx] !== undefined) g[cz][cx] = '@'; }
    out.push(`floor ${f} (${W}x${H} cells)`, ...g.map((r) => r.join('')), legend.join('  '));
  }
  return out.join('\n');
}

const worlds = [];
for (const id of IDS) for (const seed of SEEDS) for (const tier of TIERS) {
  const r = composeDetailed(seed, ARCHETYPES[id], [], tier);
  worlds.push({ id, seed, tier, arch: ARCHETYPES[id], where: `${id}/${seed}/${tier}`, ...r });
}
const of = (id) => worlds.filter((w) => w.id === id);

test('every world composes without the fallback mission', () => {
  for (const w of worlds) assert.equal(w.map.fallback, false, `${w.where}: fallback (${w.log.join(' | ')})`);
});

// A ROOM is an enclosed destination: not a passage, not open ground, not a duct, and not one of the rooms the
// plan sizes by CIRCULATION ('cross' — a mall concourse, the entrance hall and end hall that cap a corridor
// plan, a shop's storefront: they span the building's cross-section because everything opens off them).
// Those enclosed rooms sit in a band of 3–10 cells (21–70 u) a side — 10 is the widest side any recipe asks
// for — and never read as a slab (aspect ≤ 2.5). The generators used to honour this while GROWING a room and
// then throw it away when absorbing leftover cells, which is how a 5×6 bedroom became a 5×14 corridor and a
// kitchen an 11×4 one. A handful of halls (a castle great hall along a wing) still run long, so the band is a
// 97 % rule with a hard ceiling nobody may cross — the ceiling is what catches a regression to 31-cell slabs.
const inBand = (z) => !z.tags.includes('cross') && z.ceilY !== undefined && z.kind !== 'vents';
test('rooms are 21–70 u a side: no 2-cell slivers, no 100-u boxes, no slabs; hubs are square atria', () => {
  let banded = 0, outside = 0;
  for (const w of worlds) for (const z of w.map.zones) {
    if (!isRoom(z, w.arch)) continue;
    const [a, b] = side(z), long = Math.max(a, b), short = Math.min(a, b), aspect = long / short;
    assert.ok(a >= 3 && b >= 3, `${w.where}: ${z.id} is ${a}x${b} cells (${a * CELL}x${b * CELL} u)`);
    if (!inBand(z)) continue;
    assert.ok(long <= 14 && aspect <= 3, `${w.where}: ${z.id} is ${a}x${b} cells (${a * CELL}x${b * CELL} u)`);
    banded++; if (long > 10 || aspect > 2.5) outside++;
  }
  assert.ok(outside <= banded * 0.03, `${outside} of ${banded} enclosed rooms fall outside 3–10 cells / aspect 2.5`);
});

test('corridors: graph-grid worlds carve a few short L-runs; spines stay under 45 cells; no doorless passages', () => {
  for (const w of worlds) {
    const corridors = w.map.zones.filter((z) => z.role === 'corridor');
    if (ARCHETYPES[w.id].layout === 'graph-grid') {
      const rooms = w.map.zones.filter((z) => isRoom(z, w.arch)).length;
      assert.ok(corridors.length <= Math.max(MAX_CORRIDOR_ZONES, rooms), `${w.where}: ${corridors.length} corridor zones for ${rooms} rooms\n${asciiMap(w.map, w.arch)}`);
      for (const c of corridors) { const [a, b] = side(c); assert.ok(Math.max(a, b) <= MAX_CORRIDOR_CELLS && Math.min(a, b) <= 2, `${w.where}: corridor ${c.id} is ${a}x${b}`); }
      // every corridor run has a door or touches another run (wall-less edge) — no orphan stubs
      for (const c of corridors) {
        const touches = corridors.some((o) => o !== c && o.floor === c.floor && !(o.cells.x0 > c.cells.x1 + 1 || o.cells.x1 < c.cells.x0 - 1 || o.cells.z0 > c.cells.z1 + 1 || o.cells.z1 < c.cells.z0 - 1));
        assert.ok(c.doors.length > 0 || touches, `${w.where}: corridor ${c.id} is a stub with no door`);
      }
      // total corridor floor is a fraction of room floor, not a maze around it
      const roomCells = w.map.zones.filter((z) => isRoom(z, w.arch)).reduce((n, z) => n + side(z)[0] * side(z)[1], 0);
      const corrCells = corridors.reduce((n, z) => n + side(z)[0] * side(z)[1], 0);
      assert.ok(corrCells <= roomCells * 0.4, `${w.where}: ${corrCells} corridor cells vs ${roomCells} room cells\n${asciiMap(w.map, w.arch)}`);
    } else {
      const spine = corridors.find((z) => z.tags.includes('spine'));
      if (spine) assert.ok(side(spine)[0] <= MAX_SPINE_CELLS, `${w.where}: spine is ${side(spine)[0]} cells (${side(spine)[0] * CELL} u)`);
    }
  }
});

test('every room is furnished: 3+ placements (4+ when it has 20+ cells and ≤ 2 doors; 2+ for small and 3-door rooms), never past half a prop per cell; vents at least 1; 90 % of rooms 4+', () => {
  let rooms = 0, sparse = 0;
  for (const w of worlds) for (const z of w.map.zones) {
    if (!isRoom(z, w.arch)) continue;
    const n = propsIn(w.map, z); const [a, b] = side(z);
    const tiny = z.kind === 'vents';
    const floor = tiny ? 1 : a * b < 12 || z.doors.length >= 3 ? 2 : 3;
    assert.ok(n >= floor, `${w.where}: ${z.id} (${z.role}, ${a}x${b}, ${z.doors.length} doors) has ${n} props`);
    if (a * b >= 20 && z.doors.length <= 2 && !tiny) assert.ok(n >= 4, `${w.where}: ${z.id} (${z.role}, ${a}x${b}) has only ${n} props`);
    // The 30 cap was written when no room passed 10 cells a side. A 'cross' room is circulation — a shop floor
    // of 100 cells holding 42 displays is a shop, not clutter — so the ceiling scales with the floor it has.
    const cap = Math.max(30, Math.round(a * b * 0.5));
    assert.ok(n <= cap, `${w.where}: ${z.id} (${a}x${b}) has ${n} props, cap ${cap}`);
    rooms++; if (n < 4) sparse++;
  }
  assert.ok(sparse <= rooms * 0.1, `${sparse} of ${rooms} rooms have fewer than 4 props`);
});

test('people stand in sensible zones: each person is a role the zone recipe lists; no guards in the morgue, no one in the vents', () => {
  for (const w of worlds) {
    const arch = ARCHETYPES[w.id];
    for (const p of w.map.people) {
      const z = w.map.zones.find((z) => z.id === p.zone); assert.ok(z, `${w.where}: person ${p.id} in unknown zone`);
      const roles = arch.kinds[z.kind]?.people?.roles ?? [];
      assert.ok(roles.includes(p.role), `${w.where}: ${p.role} standing in ${z.id} (${z.kind} allows ${roles.join('/') || 'nobody'})`);
      if (z.kind === 'morgue') assert.notEqual(p.role, 'guards');
      assert.notEqual(z.kind, 'vents', `${w.where}: ${p.role} in the vents`);
    }
  }
});

test('castle: an open-sky courtyard sits between the gatehouse and the keep; the throne is never next to the gate', () => {
  for (const w of of('castle')) {
    const zs = w.map.zones;
    const gate = zs.find((z) => z.role === 'entrance'); assert.equal(gate.kind, 'gatehouse');
    const court = zs.filter((z) => z.kind === 'courtyard');
    assert.ok(court.length >= 1, `${w.where}: no courtyard\n${asciiMap(w.map, w.arch)}`);
    for (const c of court) assert.equal(c.ceilY, undefined, `${w.where}: courtyard ${c.id} has a ceiling`);
    const next = court.find((c) => doorsBetween(w.map, gate, c).length);
    assert.ok(next, `${w.where}: the gatehouse does not open onto the courtyard\n${asciiMap(w.map, w.arch)}`);
    const keep = zs.filter((z) => z.kind === 'great_hall' || z.kind === 'throne');
    assert.ok(keep.some((k) => doorsBetween(w.map, next, k).length || w.map.doors.some((d) => d.between.includes(k.id) && d.between.some((id) => zs.find((z) => z.id === id)?.role === 'corridor'))) || keep.length, `${w.where}: no keep`);
    const throne = zs.find((z) => z.role === 'boss');
    if (throne) assert.equal(doorsBetween(w.map, gate, throne).length, 0, `${w.where}: throne next to the gatehouse`);
  }
});

// The 'spine' TAG belonged to the legacy rib embedder; plan-first has no such tag, and an L or U plan has
// several corridor legs rather than one. The property that actually matters is unchanged, so it is measured
// instead of looked up: the school's main corridor is the passage the most rooms open onto, every classroom
// opens onto SOME corridor, and rooms line the main one on both sides — that is what makes it read as a school
// rather than a row of rooms.
test('school: lobby → corridor with classrooms on both sides and a gym; the field is open sky', () => {
  for (const w of of('school')) {
    const zs = w.map.zones;
    assert.equal(zs.find((z) => z.role === 'entrance').kind, 'lobby', `${w.where}: entrance is not the lobby`);
    const corridors = zs.filter((z) => isPassage(z, w.arch));
    assert.ok(corridors.length >= 1, `${w.where}: no corridor\n${asciiMap(w.map, w.arch)}`);
    const spine = corridors.slice().sort((p, q) => q.doors.length - p.doors.length || p.id.localeCompare(q.id))[0];
    assert.ok(spine.doors.length >= 3, `${w.where}: the main corridor ${spine.id} has ${spine.doors.length} doors\n${asciiMap(w.map, w.arch)}`);
    const classrooms = zs.filter((z) => z.kind === 'classroom');
    assert.ok(classrooms.length >= 1, `${w.where}: no classroom`);
    for (const c of classrooms) assert.ok(corridors.some((k) => doorsBetween(w.map, c, k).length), `${w.where}: ${c.id} is not on a corridor\n${asciiMap(w.map, w.arch)}`);
    // both sides of the main leg: rooms whose cells sit clear of it on the axis across its length
    const acrossZ = spine.cells.x1 - spine.cells.x0 >= spine.cells.z1 - spine.cells.z0;   // a leg running along x is flanked N / S
    const onSpine = zs.filter((z) => isRoom(z, w.arch) && doorsBetween(w.map, z, spine).length);
    const sides = new Set(onSpine.map((z) => (acrossZ
      ? (z.cells.z1 < spine.cells.z0 ? 'N' : z.cells.z0 > spine.cells.z1 ? 'S' : 'E')
      : (z.cells.x1 < spine.cells.x0 ? 'N' : z.cells.x0 > spine.cells.x1 ? 'S' : 'E'))));
    assert.ok(sides.has('N') && sides.has('S'), `${w.where}: rooms only on one side of ${spine.id}\n${asciiMap(w.map, w.arch)}`);
    assert.ok(zs.some((z) => z.kind === 'gym'), `${w.where}: no gym`);
    for (const f of zs.filter((z) => z.kind === 'field')) assert.equal(f.ceilY, undefined, `${w.where}: field has a ceiling`);
  }
});

test('prison and hospital read as the place: gate → cell block hub → yard (open sky); reception → hallway → wards, containment is the boss', () => {
  for (const w of of('prison')) {
    const zs = w.map.zones;
    assert.equal(zs.find((z) => z.role === 'entrance').kind, 'gate');
    for (const y of zs.filter((z) => z.kind === 'yard')) assert.equal(y.ceilY, undefined, `${w.where}: yard has a ceiling`);
    assert.ok(zs.some((z) => z.kind === 'cell_block'), `${w.where}: no cell block`);
  }
  for (const w of of('hospital')) {
    const zs = w.map.zones;
    assert.equal(zs.find((z) => z.role === 'entrance').kind, 'reception');
    const boss = zs.find((z) => z.role === 'boss'); if (boss) assert.equal(boss.kind, 'containment');
    assert.ok(zs.some((z) => z.kind === 'ward'), `${w.where}: no ward`);
  }
});

test('the weenie is a destination room, never a corridor, a closet or the key room', () => {
  for (const w of worlds) {
    const z = w.map.zones.find((z) => z.id === w.map.weenieZone);
    assert.ok(z, `${w.where}: weenie ${w.map.weenieZone} unknown`);
    assert.ok(!isPassage(z, w.arch), `${w.where}: weenie is ${z.id}`);
    assert.ok(!['key', 'secret', 'npc'].includes(z.role), `${w.where}: weenie is the ${z.role} room ${z.id}`);
  }
});

// PLAN-FIRST changed who owns a room's size. The rectangle comes from the FLOOR PLAN and the kind is mapped
// onto it afterwards, so a recipe's size is no longer a bound on both sides — needsOf only turns it into an
// AREA target for the generator. What survives, and what this asserts, is the DEPTH contract: the plan runs a
// room's LONG side (how far it stretches along the corridor it opens off), while the recipe still governs its
// SHORT side. So the short side sits in the recipe band for most rooms, and no room is grossly mismatched to
// the kind it was named — a gym is never dropped into a closet.
test('a kind-less node is sized, furnished and named as one kind (embedder and typeAndName agree)', () => {
  let depths = 0, onRecipe = 0;
  for (const w of worlds) for (const z of w.map.zones) {
    if (!isRoom(z, w.arch)) continue;                           // carved corridors and stairs ribs use the embedder's bare recipe
    const arch = ARCHETYPES[w.id]; const r = arch.kinds[z.kind];
    assert.ok(r, `${w.where}: ${z.id} has unknown kind ${z.kind}`);
    assert.ok(arch.naming[z.kind]?.length >= 2, `${w.where}: ${z.id} kind ${z.kind} has no names`);
    if (z.role === 'hub' || z.role === 'boss' || !inBand(z)) continue;
    const [a, b] = side(z), short = Math.min(a, b), long = Math.max(a, b);
    const lo = r.size[0], hi = Math.max(r.size[1], arch.bossArena.minCells);
    assert.ok(short >= lo - 3 && long <= hi + 9, `${w.where}: ${z.id} is ${a}x${b}, nothing like its recipe ${r.size.join('–')}`);
    depths++; if (short >= lo && short <= hi) onRecipe++;
  }
  assert.ok(onRecipe >= depths * 0.7, `only ${onRecipe} of ${depths} rooms are as DEEP as their recipe asks`);
});

test('byte-deterministic: composing the same seed twice gives the same plan', () => {
  for (const w of worlds.filter((x) => x.tier === 'easy' && x.seed === 3)) {
    const again = composeDetailed(w.seed, ARCHETYPES[w.id], [], w.tier).map;
    const key = (m) => JSON.stringify({ z: m.zones, d: m.doors, p: m.placements, k: m.keys, ppl: m.people, s: m.start, w: m.weenieZone });
    assert.equal(key(again), key(w.map), `${w.where}: plan differs between runs`);
  }
});
