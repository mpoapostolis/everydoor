# composer/ — plan-only world generation

Pipeline (docs/design/2026-08-22-world-composer.md §4): `compose(seed, archetype, reqs, tier)` →
`mission.ts` (graph + cycles + pacing) → `embedSpine.ts` | `embedGrid.ts` (cells, doors, stairs) →
`typeAndName.ts` (kinds, names, aliases) → `furnish.ts` (placements + spots + people) →
`validate.ts` (connectivity, key-before-lock, spawn safety, caps) → `finalize` in `index.ts`.

Rules that every file in here follows:
- **No three.js, no DOM, no `Math.random`, no trig** — integer hashing via `rng.ts`, directions via `lut.ts`.
  The plan must be byte-identical under bun and node (tests snapshot it).
- Units are world units; cells are `CELL` (5 u). Yaw is `Dir16`.
- Prop sizes come from `propMeta(id)` in `../props/library` (pure, computed from the voxel ops).
- Zone ids are `${archetype}.${kind}#${ordinal}` and stable per seed.
- One file = one owner when authored in parallel; `types.ts`, `rng.ts`, `lut.ts`, `grid.ts` are the shared contract.
