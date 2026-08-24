// packages/core/src/types.ts — THE SCRIPT THE WORLD READS.
//
// The generator does not need a game. It needs to know what the story is ABOUT, because that is what
// decides which rooms exist, what they are called, in what order they chain and who stands in them
// (composer/story.ts turns this into a StoryBrief; the layout seed only decides where the walls go).
//
// This is deliberately a SUBSET. The upstream project this was forked from passed its whole
// GameDefinition — weapons, HUD, netcode, save slots, quests-as-played — and the composer read
// twelve fields of it. Twelve fields is the contract, so twelve fields is the type.
// Everything here is optional except ids and names: a bare `{ world: { archetype: 'house', seed: 1 } }`
// composes a perfectly good house, it just has no story to arrange itself around.

/** The environment an archetype rides on — chooses the light rig, the fog and the sky. */
export type WorldType =
  | 'desert' | 'snow' | 'forest' | 'cemetery'
  | 'volcano' | 'swamp' | 'canyon' | 'tundra' | 'jungle' | 'autumn' | 'mushroom' | 'savanna' | 'badlands' | 'crystal' | 'beach'
  | 'moon' | 'candy' | 'reef'
  | 'sakura' | 'meadow' | 'twilight'
  | 'wasteland' | 'junkyard' | 'highlands' | 'ruins'
  | 'city-day' | 'city-night' | 'city-slums' | 'city-ruins' | 'city-neon' | 'dungeon' | 'house'
  | 'reactor' | 'lab' | 'tower';

/** A branching dialogue choice: [label, effect]. The composer only ever reads the effect, and only
 *  to spot `f:win` — the beat that ends the story sits deepest in the building. */
export type DlgChoice = [string, string];

/** One dialogue node. `need` gates it (`item:brass_key`), `c` are the choices, `end` ends the run. */
export interface DlgNode { t: string[]; c?: DlgChoice[]; need?: string; end?: string }

/** Someone in the story. `place` is the room they should be in — a free-text word ("the throne room",
 *  "Mira's bedroom", "κουζινα") that the composer binds to a real zone. */
export interface NpcDef {
  id: string;
  name: string;
  /** Legacy linear lines (auto-wrapped to one node) OR a branching node list. */
  dialogue?: string[] | DlgNode[];
  /** one-line who-they-are ("the night nurse") — also how a role word is found when the name has none */
  role?: string;
  /** quest id offered on talk — chains the building's rooms in the order the story is played */
  givesQuest?: string;
  place?: string;
}

/** Something to pick up. A key-ish item (`kind: 'key'`, or a name/id that reads as one) makes its
 *  room the key room, and the composer locks the door it opens. */
export interface ItemDef { id: string; name: string; kind?: string; desc?: string; place?: string }

/** Something that fights. `bossPattern` marks the boss — its room sits at the end of the chain. */
export interface EnemyDef { id: string; name?: string; bossPattern?: string; place?: string }

export interface QuestObjective { type: 'kill' | 'collect' | 'talk'; targetId?: string }

/** A step of the story. `chainStep` orders them; `turnIn` is the character you report back to. */
export interface QuestDef { id: string; title: string; desc: string; objective: QuestObjective; turnIn?: string; chainStep?: number }

/** The prose around the game — read only for THEME words (a "haunted" corpus dresses rooms differently). */
export interface StoryText { intro?: string[]; outro?: string; goal?: string }

/** What world to build. `archetype` names a composer plan; `lot` marks an interior entered from a
 *  city door (its word names the BUILDING, not a room inside it). */
export interface WorldSpec { type?: WorldType; archetype?: string; seed: number; style?: string; lot?: string }

/** THE SCRIPT. Everything the generator reads to plan a building around a story. */
export interface WorldScript {
  world: WorldSpec;
  title?: string;
  subtitle?: string;
  story?: StoryText;
  npcs?: NpcDef[];
  items?: ItemDef[];
  enemies?: EnemyDef[];
  quests?: QuestDef[];
  /** win rules — the beats that must land, and land LAST */
  winItem?: string;
  winItems?: string[];
  winNpcs?: string[];
  endings?: Record<string, string>;
}

/** An empty script: composes a layout with no story to arrange itself around. */
export const blankScript = (seed: number, archetype?: string): WorldScript => ({ world: { seed, archetype } });

/** The weapon models `blocky.ts` can put in a character's hand. Not gameplay — geometry. */
export type WeaponKind = 'pistol' | 'smg' | 'shotgun' | 'crossbow' | 'blaster' | 'dagger' | 'sword' | 'hammer';
