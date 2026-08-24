// scripts/test.mjs — `bun run test`: the whole suite, with the time budgets measured on a quiet box.
//
// node's test runner puts every file on its own core at once. That is right for assertions and wrong
// for the three that assert a TIME: composer-perf (compose ≤ 90 ms per archetype), composer-embed
// (≤ 90 ms per compose) and composer-plangen (≤ 15 ms per generatePlan). Measured alone the castle
// composes in 55 ms; measured while the rest of the suite contends for the cores it reads 90–120 ms,
// and the budget failed on whichever archetype lost the draw. The budgets are the contract and stay
// as written; this runs the timing files AFTER the parallel batch, one at a time.
//
// tsx, not bun: the snapshot fixture is byte-level, and the two runtimes do not agree to the last
// bit on trigonometry. The fixture is generated under tsx and checked under tsx.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const TIMED = ['composer-perf', 'composer-embed', 'composer-plangen'].map((n) => `tests/${n}.test.mjs`);
const all = readdirSync('tests').filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `tests/${f}`);
const rest = all.filter((f) => !TIMED.includes(f));

const run = (label, args) => {
  console.log(`\n== ${label}\n`);
  return spawnSync('node_modules/.bin/tsx', ['--test', ...args], { stdio: 'inherit' }).status ?? 1;
};
const a = run(`${rest.length} files in parallel`, rest);
const b = run(`${TIMED.length} timed files, one at a time`, ['--test-concurrency=1', ...TIMED]);
process.exit(a || b ? 1 : 0);
