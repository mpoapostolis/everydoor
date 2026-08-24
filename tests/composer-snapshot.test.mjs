// DETERMINISM — 3 seeds × every archetype serialise (canonical JSON, Maps as sorted arrays) to exactly
// the bytes recorded in tests/fixtures/composer-snapshots.json, under tsx (this process) AND under bun
// (a child process running scripts/composer-snapshot.mjs --check). Regenerate the fixture only on a
// deliberate plan change: `bunx tsx scripts/composer-snapshot.mjs --write`.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ARCHETYPES, compose } from '../packages/core/src/composer/index.ts';
import { CASES, canonical, diffFixture, readFixture, snapshotAll } from '../scripts/composer-snapshot.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('fixture covers 3 seeds × every registered archetype', () => {
  const fx = readFixture();
  assert.equal(fx.entries.length, CASES.length);
  for (const id of Object.keys(ARCHETYPES)) assert.equal(fx.entries.filter((e) => e.archetype === id).length, 3, `${id} has 3 snapshots`);
  for (const e of fx.entries) { assert.match(e.sha256, /^[0-9a-f]{64}$/); assert.ok(e.bytes > 1000); assert.equal(e.fallback, false, `${e.archetype}/${e.seed} snapshot is not a fallback`); }
});

test('tsx: every snapshot is byte-identical to the fixture', () => {
  const diff = diffFixture(snapshotAll());
  assert.deepEqual(diff, [], 'composer snapshot drift:\n  ' + diff.join('\n  '));
});

test('canonical JSON is stable across two composes of the same seed and differs across seeds', () => {
  const a = canonical(compose(0x5eed0001, ARCHETYPES.house, [], 'easy'));
  const b = canonical(compose(0x5eed0001, ARCHETYPES.house, [], 'easy'));
  const c = canonical(compose(0x5eed0002, ARCHETYPES.house, [], 'easy'));
  assert.equal(a, b); assert.notEqual(a, c);
  assert.ok(a.includes('"colliderCells":[['), 'Maps serialise as entry arrays');
});

test('bun: scripts/composer-snapshot.mjs --check passes (same bytes under the other runtime)', () => {
  const r = spawnSync('bun', [join(ROOT, 'scripts', 'composer-snapshot.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });
  if (r.error && r.error.code === 'ENOENT') { console.log('  (bun not on PATH — skipped)'); return; }
  assert.equal(r.status, 0, `bun --check failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /snapshots identical \(bun\)/);
});
