// COMPOSING A PLACE IS NOT ALLOWED TO TAKE A SECOND.
//
// compose() runs on the client, in front of a child waiting for a world, so its cost is a budget and
// not an observation. Measured 2026-08-23 over nine archetypes × 20 seeds, the first cut spent 80 ms
// on an average place and 146 ms on a castle, with a worst single compose of 242 ms — nearly all of it
// inside furnish(), which rebuilt a summed-area table for every slot scan, re-ran the lane's distance
// transform for every one of the K candidates, and re-walked every lane cell against every placement
// for every spot query. The same nine archetypes now cost 33 / 51 / 82 ms.
//
// This file pins the budget (design §9) and — more importantly — pins the thing that makes the budget
// affordable: furnish() and validate() cache work that is provably a function of the zone rather than
// of the furnishing, in caches that outlive a single candidate. A cache keyed one field too loosely
// would not fail loudly; it would quietly hand one room another room's lane. So the second test
// composes the same cases twice, once cold and once with every other archetype in between, and demands
// the very bytes. (Byte-level drift against the recorded fixture is tests/composer-snapshot.test.mjs.)
//
// Run: bunx tsx --test tests/composer-perf.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ARCHETYPES, compose } from '../packages/core/src/composer/index.ts';
import { canonical } from '../scripts/composer-snapshot.mjs';
import { cpuMs } from './cpu-clock.mjs';   // CPU time: the suite runs files in parallel, the wall clock measures the scheduler

const ARCHES = Object.keys(ARCHETYPES);
const SEEDS = Array.from({ length: 8 }, (_, i) => (0x5eed0000 + i * 7919) >>> 0);
const tierOf = (i) => (i % 2 ? 'hard' : 'easy');

// ---------------------------------------------------------------- the budget
// Deliberately loose against the measurement (2.7× on the mean, 1.8× on the worst archetype), because a
// CI box is slower than a laptop — but tight enough that the pre-optimisation composer fails both.
const MAX_MEAN_MS = 75;        // averaged over every archetype
const MAX_ARCH_MEAN_MS = 90;   // any single archetype
const MAX_ONE_MS = 150;        // any single compose

test('compose() stays inside its time budget on every archetype', () => {
  for (const id of ARCHES) compose(1234, ARCHETYPES[id], [], 'easy');          // warm the JIT and the prop library
  const means = [];
  let worst = 0, worstAt = '';
  for (const id of ARCHES) {
    let best = Infinity;
    // Per SEED, the cheapest of the rounds — the SAME best-of-3 the mean gets, for the same stated
    // reason. This used to read `if (round === 0 …)`: the mean was shielded from a GC pause while the
    // worst-case number was one unprotected sample, so the strictest assertion in the file rested on
    // the least reliable measurement. It failed at 152.4 ms on castle/1592598255 during a full-suite
    // run (the files run in parallel, so the box is loaded); that same case composes in 61 ms measured
    // on its own, and the slowest of all 72 cases is ~77 ms — half the budget. Only the sampling was
    // wrong, so the budget below is unchanged.
    const bestOf = new Array(SEEDS.length).fill(Infinity);
    for (let round = 0; round < 3; round++) {                                   // best of 3: a GC pause is not a regression
      let total = 0;
      for (const [i, seed] of SEEDS.entries()) {
        const t = cpuMs();
        compose(seed, ARCHETYPES[id], [], tierOf(i));
        const dt = cpuMs() - t;
        total += dt;
        if (dt < bestOf[i]) bestOf[i] = dt;
      }
      best = Math.min(best, total / SEEDS.length);
    }
    bestOf.forEach((dt, i) => { if (dt > worst) { worst = dt; worstAt = `${id}/${SEEDS[i]}`; } });
    means.push([id, best]);
    assert.ok(best <= MAX_ARCH_MEAN_MS, `${id} composes in ${best.toFixed(1)} ms on average (budget ${MAX_ARCH_MEAN_MS} ms)`);
  }
  const mean = means.reduce((a, [, m]) => a + m, 0) / means.length;
  assert.ok(mean <= MAX_MEAN_MS, `${mean.toFixed(1)} ms per compose across the archetypes (budget ${MAX_MEAN_MS} ms)\n  ` + means.map(([id, m]) => `${id} ${m.toFixed(1)}`).join(', '));
  assert.ok(worst <= MAX_ONE_MS, `slowest single compose ${worst.toFixed(1)} ms at ${worstAt} (budget ${MAX_ONE_MS} ms)`);
});

// ---------------------------------------------------------------- the caches those numbers rest on
test('a place composes to the same bytes whatever was composed before it', () => {
  const cases = [];
  for (const id of ARCHES) for (const [i, seed] of SEEDS.slice(0, 3).entries()) cases.push([id, seed, tierOf(i)]);
  const alone = cases.map(([id, seed, tier]) => canonical(compose(seed, ARCHETYPES[id], [], tier)));
  // the same cases in the opposite order, with an unrelated place composed between every pair: any cache
  // that outlives one compose (the per-zone share, the lane distance transform, the raster scratch buffers)
  // is now warm with someone else's zone when the case runs
  const mixed = new Map();
  for (const [id, seed, tier] of [...cases].reverse()) {
    compose(0xc0ffee, ARCHETYPES.castle, [], 'hard');
    mixed.set(`${id}/${seed}/${tier}`, canonical(compose(seed, ARCHETYPES[id], [], tier)));
  }
  cases.forEach(([id, seed, tier], i) => assert.equal(mixed.get(`${id}/${seed}/${tier}`), alone[i], `${id}/${seed}/${tier} depends on what was composed before it`));
});

test('composing the same seed twice in a row is the same place', () => {
  for (const id of ARCHES) {
    const a = canonical(compose(0x5eed0001, ARCHETYPES[id], [], 'easy'));
    const b = canonical(compose(0x5eed0001, ARCHETYPES[id], [], 'easy'));
    assert.equal(a, b, `${id} is not idempotent`);
  }
});
