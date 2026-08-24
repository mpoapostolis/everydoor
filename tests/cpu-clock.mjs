// tests/cpu-clock.mjs — the clock the composer's time budgets are measured on.
//
// The budgets (composer-perf, composer-embed, composer-plangen) are about what compose() COSTS, not about
// how long the test runner's scheduler made it wait. `bun run test` runs every file in parallel, so a
// wall clock taken in the middle of the suite reads 2–2.5× what the same compose takes on its own
// (house: 39 ms alone, 96–123 ms with the rest of the suite contending for the cores) and the budget
// fails on whichever archetype lost the draw that run. CPU time charged to this process does not move
// with sibling processes; best-of-N still shields it from a GC pause. Milliseconds, monotonic.
export const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
