# voxel-city

A voxel city you can walk, with a **procedurally composed interior behind every door**.

Two generators and one seam between them:

| | what it makes |
|---|---|
| **the city** | a streamed grid of streets, blocks, parks and buildings in five flavours — day, night, slums, ruins, neon. Every building with a street door is a **lot**: an id, a doorway, and the kind of place it is. |
| **the composer** | one building's floor plan, as a *semantic map* — rooms with names, kinds and depths; doors, some of them locked; the key that opens each lock; the props on the floor; the people standing in them; the critical path through it all. |

The seam is `lotSeed(citySeed, lot.id)`. **Nothing is stored.** The bakery on this corner has the
same rooms tomorrow, on any machine, because they are re-derived from the door's identity every
time. That is what lets the demo tear the whole world down and rebuild the other one whenever you
step through a doorway.

```bash
bun install
bun run dev        # http://localhost:5180 — walk, press E at a door
bun run test       # 187 tests, including a byte-level determinism fixture
bun run typecheck
```

## Layout

```
packages/core/     @voxel-city/core — the generators. Peer dep: three. No DOM beyond a 2D canvas.
  cityWorld.ts       the streamed city + its lot table
  cityLots.ts        the lot kinds, the archetype each opens onto, the words a script may call one
  composer/          the plan: mission graph → layout → rooms → props → people → validation
  props/             the voxel prop library (15 families, cached per style)
  composedWorld.ts   renders a semantic map into streamed, batched chunks
  types.ts           WorldScript — the twelve fields the generator reads of a story
  index.ts           createCity · createInterior · planInterior · lotSeed
apps/demo/         the walkable showcase: a body, a lens, a door, and a debug panel
tests/             the inherited composer suite + this fork's own seams
```

## The API

```ts
import { createCity, createLotInterior, planInterior, lotSeed } from '@voxel-city/core';

const city = createCity(scene, 1337, 'night');        // a World: streamAround / heightAt / blocked
const lot  = city.lotAt(player.x, player.z, 3);       // the door you are standing in, or null
const shop = createLotInterior(scene, 1337, lot);     // the rooms behind it — same rooms every time

planInterior({ seed: 7, archetype: 'hospital' });     // the semantic map alone, no scene, no GL
```

### The story shapes the building

A `WorldScript` is optional, and it is what makes one house different from another house. The
composer reads it (`composer/story.ts`) and plans the building **around** it: the rooms your cast
names are the rooms that exist, in the order the story is played, with the key item's room locked
behind the door that key opens.

```ts
planInterior({
  seed: 7,
  archetype: 'house',
  script: {
    world: { archetype: 'house', seed: 7 },
    title: 'The Cat Came Back',
    npcs: [{ id: 'n0', name: 'Yiayia Rena', role: 'the grandmother', place: 'kitchen', dialogue: ['Have you seen Biscuit?'] }],
    items: [{ id: 'k', name: 'attic key', kind: 'key', place: 'storage' }],
    winItems: ['k'],
  },
});
// → a house whose kitchen is where Rena stands, whose attic is locked, and whose
//   storage room holds the key — on every seed, in that order.
```

Room words are free text and resolved by meaning, not by an enum: `"Mira's bedroom"`, `"the vault"`,
`"κουζινα"` and `"room 13"` all land somewhere sensible, and a word this archetype has no room for
falls back to the nearest kind it does have.

## Provenance

The generators are forked from the world layer of an educational game engine, where they shipped
behind a 13k-line game orchestrator. Two things changed in the move, and only two:

- **i18n → a hole.** `lib/uiText.ts` is a ten-line `tt()` that interpolates `{holes}` and returns
  English. The 104 call sites are untouched; replace that one file to localise.
- **`GameDefinition` → `WorldScript`.** Upstream passed a 988-line type carrying weapons, HUD,
  netcode and save slots; the composer read twelve fields of it. Twelve fields is the contract, so
  twelve fields is the type.

Everything else is byte-identical, and the inherited determinism fixture proves it.
