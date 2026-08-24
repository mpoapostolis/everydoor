# everydoor — the design

**Date:** 2026-08-24
**Status:** implemented

## The ask

A separate repo holding the city generator and the procedural room composer from `vxlverse-edu`,
as a reusable library plus a playable demo. A clean fork: the source repo is not modified and the
two drift apart from here.

## What comes across

The dependency closure of `cityWorld.ts`, `composedWorld.ts`, `composer/index.ts`, `cityLots.ts`
and `blocky.ts` is 74 files and its only external dependency is `three`. That is the fork.

- **city** — `cityWorld.ts` (the streamed grid, 5 flavours), `cityLots.ts` (the lot table and the
  words a script may call a building by), `cityFlavours.ts`
- **composer** — the whole directory: mission graph, plan generation and the authored plans, the
  three embedders, `furnish`, `dressing`, `people`, `validate`, `story`
- **props** — the voxel prop library, 15 families
- **rendering** — `composedWorld.ts`, `blocky.ts` / `blockyKit.ts`, `cameraCutout.ts`, `world.ts`

Explicitly **not** coming across: `game.ts` (13.7k lines of quests, HUD, saves, Colyseus,
PocketBase), `terrainWorld`, `industrialWorld`, `dungeonWorld`, `roomWorld`, the VXLScript DSL, the
Astro site.

## The two seams that had to be cut

**i18n.** `cityWorld.ts` is the only file in the closure that imports `lib/uiText`, but it calls
`tt()` on every user-visible string. Upstream that reached a runtime dictionary loaded through a
Vite glob. Here it is a ten-line interpolate-and-return-English function at
`packages/core/src/lib/uiText.ts`. Call sites unchanged; one file to replace to localise.

**The script type.** `composer/story.ts` imported `GameDefinition` — 988 lines of weapons, HUD,
netcode, save slots — and read twelve fields of it: `title`, `subtitle`, `story`, `npcs`, `items`,
`enemies`, `quests`, `winItem`, `winItems`, `winNpcs`, `endings`, `world`. Those twelve fields are
now `WorldScript` in `packages/core/src/types.ts`, and it is the library's public contract: *the
script the world reads*. `storyBrief` takes a `WorldScript`; nothing else changed.

`worldFactory.ts` did not come across either — its useful half (turning a script's `place:` words
into `PlaceReq`s, and the `NEAREST_KIND` fallback table) is now `packages/core/src/placeReqs.ts`,
and its studio-cursor half was left behind.

## Structure

Bun workspaces. `packages/core` is source, not a build artifact: the demo aliases straight at
`index.ts`, so there is one HMR graph and stack traces point at real generator lines.

The public API is four functions and the data behind them — `createCity`, `createInterior`,
`createLotInterior`, `planInterior`, plus `lotSeed`, `ARCHETYPES`, `CITY_THEMES`, `storyBrief`,
`placeReqsOf`. `planInterior` is the headless one: a semantic map with no scene and no GL.

## The demo

Written fresh (~700 lines), nothing lifted from `game.ts`:

- `player.ts` — WASD, sprint, jump, capsule collision against `world.blocked()`, a third-person
  lens with the dithered see-through cutout
- `world-swap.ts` — the door: enter a lot, compose its interior, walk back out onto the same
  doorstep. The only module that knows a city and an interior are different kinds of thing.
- `people.ts` — renders the extras `compose()` already cast, with name plates
- `lighting.ts` — the city theme's own sky/fog/sun outdoors; a fixed budget of point lights
  chasing the player through the map's own lamp list indoors
- `script.ts` — one demo story per archetype, so the rooms have a reason to exist
- `panel.ts` — seed, flavour, archetype: every knob is a generator input

## Testing

Twenty inherited test files come across unchanged (path rewrite only), including the byte-level
`composer-snapshots.json` fixture — which passes, so the fork is provably bit-identical to
upstream. They run under `tsx`, not `bun`: the fixture is byte-level and the two runtimes do not
agree to the last bit on trigonometry.

Two new files cover what is new:

- `tests/core-api.test.mjs` — every archetype plans a standable building; an unknown archetype
  throws instead of returning an empty map; a script's place words all bind; the key room is
  locked; the brief is seeded by the story and not the layout; lot seeds are stable and distinct;
  every lot kind opens onto a plan the composer knows; a lot word never becomes a room request.
- `tests/demo-doors.test.mjs` — the swap end to end, headless (real three geometry, no GL): enter,
  land in a room, leave, land on the pavement by the door you used, and re-enter to the same
  building. It also asserts the teardown frees per-world buffers **and leaves the prop library's
  shared materials alone** — the first draft disposed them, which would have blanked every prop in
  every building composed after the first swap.

187 tests, all passing.
