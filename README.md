# everydoor

**A voxel city where every door opens onto a procedurally composed interior.**

The city and composer power [VXLVERSE](https://vxlverse.com), a 3D story-game maker in the browser.

Walk down the street, press <kbd>E</kbd> at any building, and the world under your feet becomes
that building's rooms — a floor plan with named rooms, locked doors, the key that opens each lock,
furniture on the floor and people standing in it. Walk back out and you are on the same doorstep.

Two generators and one seam between them:

|  | what it makes |
|---|---|
| **the city** | a streamed grid of streets, blocks, parks and buildings in five flavours — day, night, slums, ruins, neon. Every building with a street door is a **lot**: an id, a doorway, and the kind of place it is. |
| **the composer** | one building's floor plan as a *semantic map* — rooms with names, kinds and depths; doors, some locked; keys; props; people; and the critical path through it all. |

The seam is `lotSeed(citySeed, lot.id)`. **Nothing is stored.** The bakery on this corner has the
same rooms tomorrow, on any machine, because they are re-derived from the door's identity every
time. That is what lets a game tear the whole world down and rebuild the other one whenever a
player steps through a doorway — no save file, no server, no sync.

## Try it

```bash
git clone https://github.com/mpoapostolis/everydoor
cd everydoor
bun install
bun run dev            # http://localhost:5180
```

<kbd>WASD</kbd> move · <kbd>shift</kbd> run · <kbd>space</kbd> jump · drag to look · arrows turn ·
<kbd>E</kbd> at a door · <kbd>T</kbd> for top-down.

The panel on the left is live — seed, city flavour, prop style, or compose any archetype on its own
— and **🎲 everything, from scratch** is the one to press first: a new seed, a new city flavour, a
new archetype and a new material style, all at once. The seed redeals the whole city, which redeals
the lot table, which re-derives every interior behind every door, and then it walks you through a
door that opens onto the archetype it rolled. Every knob shows what it landed on, so a world you
liked can be typed back in.

**⌖ top-down** (or <kbd>T</kbd>) lifts the lens straight up and takes the roof off — the same
see-through that keeps a wall from hiding your character, opened to the whole frame. You get the
furnished building from above while still walking around in it.

The panel on the right is the **floorplan**, drawn from the same semantic map the walls were built
from — rooms and their names, doors, locks, secret passages, the key, where the story starts, who is
standing where, and you. Indoors it is the building's plan for the storey you are on; outdoors it is
the street, with every door you can walk into. If the plan says a door is locked and the world shows
it open, the bug is in the renderer.

npm and pnpm work too (`npm install && npm run dev`).

## Deploy it

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmpoapostolis%2Feverydoor)

`vercel.json` already carries the settings, so importing the repo needs no clicking: Vercel runs
`bun install` and `bun run build` and serves `apps/demo/dist`. It is a static build — no server, no
runtime, no environment variables. The hashed asset bundle is served `immutable`, `index.html` is not.

From the CLI:

```bash
npx vercel        # preview
npx vercel --prod
```

Any static host works the same way: build, then serve `apps/demo/dist`.

## Use it

```ts
import { createCity, createLotInterior, planInterior } from '@everydoor/core';

const city = createCity(scene, 1337, 'night');     // a World: streamAround / heightAt / blocked
const lot  = city.lotAt(player.x, player.z, 3);    // the door you are standing in, or null
const shop = createLotInterior(scene, 1337, lot);  // the rooms behind it — the same rooms every time

planInterior({ seed: 7, archetype: 'hospital' });  // the plan alone: no scene, no GL, no DOM
```

Everything talks through one small interface. A `World` streams its own chunks around a position and
answers `heightAt(x, z)`, `blocked(x, z, r)` and `ceilingY` — so your player controller never learns
whether it is standing on a street or in a morgue.

### The story shapes the building

A script is optional, and it is what makes one house different from another house. Give the
composer one and it plans the building **around** it: the rooms your characters name are the rooms
that exist, in the order the story is played, with the key item's room locked behind the door that
key opens.

```ts
planInterior({
  seed: 7,
  archetype: 'house',
  script: {
    world: { archetype: 'house', seed: 7 },
    title: 'The Cat Came Back',
    npcs: [{ id: 'n0', name: 'Rena', role: 'the grandmother', place: 'kitchen', dialogue: ['Have you seen Biscuit?'] }],
    items: [{ id: 'k', name: 'attic key', kind: 'key', place: 'storage' }],
    winItems: ['k'],
  },
});
// → a house whose kitchen is where Rena stands, whose attic is locked,
//   and whose storage room holds the key. On every seed, in that order.
```

Room words are free text, resolved by meaning rather than by an enum: `"Mira's bedroom"`,
`"the vault"`, `"room 13"` and `"κουζινα"` all land somewhere sensible, and a word this archetype
has no room for falls back to the nearest kind it does have. A request always binds — the composer
never answers "no place called that".

### What is in the box

**Archetypes** — `house` · `shop` · `school` · `office` · `hospital` · `prison` · `haunted` ·
`castle` · `dungeon`. Each carries its own room vocabulary, flow (growth / corridor / ring), lock
kit and prop palette.

**City flavours** — `day` · `night` · `slums` (roofed under a metal plate) · `ruins` · `neon`.

**Props** — a voxel library of 15 families, cached per material style.

## API

| | |
|---|---|
| `createCity(scene, seed, flavour)` | the streamed city. Also answers `lots()` and `lotAt(x, z, r)`. |
| `createInterior(scene, { seed, archetype, script? })` | plan a building and render it. `world.map` is the plan. |
| `createLotInterior(scene, citySeed, lot, script?)` | the interior behind a city door. |
| `planInterior({ seed, archetype, script? })` | the plan alone — headless, for tests, minimaps and servers. |
| `lotSeed(citySeed, lotId)` | a door's identity. |
| `storyBrief(script)` / `placeReqsOf(script, arch)` | what the composer reads out of a story. |

## Layout

```
packages/core/     @everydoor/core — the generators. Peer dep: three. No DOM beyond a 2D canvas.
  cityWorld.ts       the streamed city + its lot table
  cityLots.ts        the lot kinds and the archetype each opens onto
  composer/          mission graph → layout → rooms → props → people → validation
  props/             the voxel prop library
  composedWorld.ts   renders a plan into streamed, batched chunks
  types.ts           WorldScript — the twelve fields the generator reads of a story
apps/demo/         the walkable showcase: a body, a lens, a door, a debug panel
tests/             the composer suite + the public API + the door, end to end
```

## Development

```bash
bun run test         # 187 tests, including a byte-level determinism fixture
bun run typecheck
bun run build
```

The suite runs under `tsx` rather than `bun`: the snapshot fixture is byte-level and the two
runtimes do not agree to the last bit on trigonometry. If you change the generator and the snapshot
fails, that is the point — regenerate it deliberately with
`bunx tsx scripts/composer-snapshot.mjs --write` and say so in the commit.

The demo is not a game engine and is not trying to be one: it is ~800 lines whose only job is to
put a body in these worlds so you can see them. Take the core, keep your own engine.

## Provenance

These generators grew inside an educational game engine, where they shipped behind a 13k-line game
orchestrator. Two things changed on the way out, and only two: the i18n dictionary became a ten-line
`tt()` that returns English, and the composer now takes a twelve-field `WorldScript` instead of the
engine's whole game definition. Everything else came across untouched — and the inherited
byte-level fixture still passes, so it is provably the same generator.

## License

MIT © mpoapostolis
