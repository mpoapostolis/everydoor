// src/engine/composer/types.ts
// ============================================================================
// THE PLAN CONTRACT. The composer is PLAN-ONLY: it turns (seed, archetype, place requests)
// into a SemanticMap — zones with names and roles, doors (some locked), prop placements,
// colliders, lights, spots for NPCs / loot / hiding / bosses, a start, a critical path.
// No three.js here: ComposedWorld (src/engine/composedWorld.ts) renders a map; game.ts
// reads places from it. Design: docs/design/2026-08-22-world-composer.md §3–4.
// Units: WORLD UNITS unless a field says cells. One cell = CELL u (7). A hero is 5.2 u tall,
// a door 10.5 u wide; room walls are 20 u (castle / dungeon 28 — see each archetype's wallH).
// Yaw is a Dir16 index (lut.ts), never radians.
// ============================================================================
import type { WorldType } from '../types';
import type { Place as PropPlace } from '../props/types';

export const CELL = 7;                 // u per layout cell (was 5: rooms read cramped behind a 10-u third-person camera)
export const GRID = 72;                // cells per side per floor (360 u)

export type Dir16 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
export type Tier = 'easy' | 'hard';
/** 'building' = footprint subdivision (rooms share walls around a corridor/hall — houses, schools, shops, offices, hospitals, prisons);
 *  'castle' = courtyard ring inside a curtain wall (gatehouse, wings, keep, corner towers); 'graph-grid' = rooms + tidy corridors (dungeons);
 *  'spine' = the legacy rib layout (kept for reference). */
export type Layout = 'graph-grid' | 'spine' | 'building' | 'castle' | 'plan' | 'settlement' | 'flat' | 'city';   // 'plan' = FloorPlan-first (plans/)

export type ArchetypeId =
  | 'house' | 'castle' | 'dungeon' | 'haunted' | 'school' | 'shop' | 'office' | 'spacestation' | 'prison' | 'hospital' | 'lab' | 'base'
  | 'arena' | 'obby' | 'village' | 'farm' | 'pirate' | 'camp' | 'fair' | 'city';

export type Role =
  | 'entrance' | 'hub' | 'corridor' | 'combat' | 'elite' | 'puzzle' | 'key' | 'lock' | 'treasure' | 'secret'
  | 'npc' | 'rest' | 'vantage' | 'boss' | 'exit' | 'plain' | 'work' | 'checkpoint' | 'finish' | 'plot' | 'course' | 'base' | 'safehouse' | 'stairs';
/** A calm role: what may follow combat and where specials hang off. */
export const CALM_ROLES: readonly Role[] = ['rest', 'npc', 'puzzle', 'treasure', 'plain', 'work', 'plot', 'hub', 'entrance'];

export type RoomKind = string;         // archetype-local ('throne', 'cells') plus the GENERIC kinds below
export const GENERIC_KINDS: readonly RoomKind[] = ['course', 'plot', 'teams_base', 'safehouse', 'stairs', 'yard'];

export type CyclePattern =
  | 'lock-and-key' | 'two-keys' | 'hidden-shortcut' | 'foreshadow' | 'false-goal' | 'two-paths' | 'dangerous-route' | 'blocked-retreat' | 'patrol';
export const KID_SAFE_CYCLES: Record<Tier, readonly CyclePattern[]> = {
  easy: ['lock-and-key', 'two-keys', 'hidden-shortcut', 'foreshadow', 'false-goal', 'two-paths'],
  hard: ['lock-and-key', 'two-keys', 'hidden-shortcut', 'foreshadow', 'false-goal', 'two-paths', 'dangerous-route', 'blocked-retreat', 'patrol'],
};

/** What a script asked the world to contain ("the throne room", "a key in the cells", "the boss").
 *  `kind` = the archetype kind the alias implies (the planner makes the kitchen a kitchen); `step` = the
 *  story-chain order (0 = first thing the player does; the last step binds deepest); `item` = the key-like
 *  item that lives here (its name — tryUnlockWith matches it); `boss` = the boss that waits here;
 *  `label` = the author's own words for the room ('Throne Room', "Mira's bedroom") — the bound zone's
 *  displayed name (zone.name) becomes this, so the HUD and the key names speak the script's language. */
export interface PlaceReq { role?: Role; kind?: RoomKind; alias: string; step?: number; item?: string; boss?: string; count?: number; label?: string }

// ---------------------------------------------------------------------------
// Archetype data (src/engine/composer/archetypes/*.ts)
// ---------------------------------------------------------------------------
export interface RoomRecipe {
  kind: RoomKind;
  size: [minCells: number, maxCells: number];       // side length in cells
  floorY?: number; floor?: number;
  ceil?: number | null;                             // u above floorY; null = open sky
  anchors: { tag: string; n: [number, number]; place: PropPlace; focal?: boolean }[];   // big props pulled by TAG from the library
  wallItems: { tags: string[]; density: number };   // per 10 u of free wall
  clutter: { tags: string[]; perCell: number; minDoorDist: number };
  surfaceFill?: { tags: string[]; p: number };
  vignettes?: { id: string; p: number }[];
  symmetric?: boolean;
  light: 'torch' | 'lamp' | 'panel' | 'candle' | 'none';
  hideMin: number; lootMin: number; npcStand: boolean;
  /** Default NPC presence for this kind: how many ambient people stand/walk here and what they are. */
  people?: { n: [number, number]; roles: string[] };
  /** Finishes the renderer applies to this kind of room (floor / wall / ceiling / trim). Falls back to the style's defaults. */
  finish?: import('./plans/types').RoomFinish;
  course?: { len: [number, number]; checkpointEvery: [number, number]; killP: number; vertical?: boolean };
}
export interface FlowNode { id: string; role: Role; kind?: RoomKind; slot?: string; floor?: number }
export interface Flow {
  id: string; tier: Tier;
  nodes: FlowNode[];
  edges: [string, string][];
  loops: string[][];                                // node-id cycles that cycle patterns apply to
  symmetric?: boolean;
}
export interface Injection { id: string; role: Role; kind?: RoomKind; p: number; off: Role[] }   // attach a degree-1 node off a node of these roles
export interface Archetype {
  id: ArchetypeId;
  worldType: WorldType;                             // the EXISTING WorldType it rides on (house / dungeon / lab / …)
  keywords: string[];                               // deaccented EN + EL + Greeklish, scored by resolveWorld
  layout: Layout;
  style: string; styleVariants: Record<string, string>;
  indoor: boolean; wallH: number; cell: number;
  weenie: string | { topological: true };
  roleMap: Partial<Record<Role, RoomKind[]>>;
  kinds: Record<RoomKind, RoomRecipe>;
  flows: Flow[]; cycles: CyclePattern[]; injections: Injection[];
  adjacency: { prefer: [RoomKind, RoomKind][]; forbid: [RoomKind, RoomKind][] };
  naming: Record<RoomKind, string[]>;               // display names per kind (index = ordinal); tt() keys live in names.ts
  aliases: Record<string, RoomKind | '*door' | '*boss' | '*key' | '*vantage' | '*course' | '*plot'>;
  bossArena: { minCells: number; pillars: number; ceilMul: number };
  lockKit: { key: string; door: string };          // prop ids
  /** Ambient speech for default NPCs of this archetype (tt() keys in names.ts); composer picks per npc. */
  chatter: string[];
  spine?: { len: [number, number]; ribs: [number, number]; hubAtEnd?: boolean; doubleLoaded?: boolean; oneBigRoom?: boolean; concourse?: boolean };
  outdoor?: { groundStyle: string; terrainThemes: WorldType[]; defaultTheme: WorldType };
}

// ---------------------------------------------------------------------------
// Mission graph (output of mission.ts)
// ---------------------------------------------------------------------------
export interface MissionNode extends FlowNode { depth: number; kind?: RoomKind; name?: string; zoneId?: string; tags: string[]; req?: PlaceReq }
export interface MissionEdge { a: string; b: string; lock?: string; secret?: boolean; oneWay?: boolean }
export interface MissionGraph {
  nodes: MissionNode[]; edges: MissionEdge[]; loops: string[][];
  keys: { id: string; item: string; node: string; opens: string }[];       // key lives in `node`, opens the lock id
  criticalPath: string[];                                                   // entrance … boss/exit node ids
  symmetric?: boolean;
  flowId: string;
}

// ---------------------------------------------------------------------------
// Layout → SemanticMap
// ---------------------------------------------------------------------------
export interface Spot { x: number; z: number; yaw: Dir16; floor: number }
export interface AABB { x0: number; z0: number; x1: number; z1: number; floor: number; id?: string }
export interface Door {
  id: string; x: number; z: number; yaw: Dir16; w: number;
  between: [string, string]; lock?: string; secret?: boolean;
  collider: AABB; floor: number;
}
export interface WallRun { x0: number; z0: number; x1: number; z1: number; h: number; y: number; floor: number; gaps: [t0: number, t1: number][] }
export interface Zone {
  id: string;                                       // 'castle.throne#1' — stable per seed
  name: string; kind: RoomKind; role: Role; depth: number;
  rect: { x0: number; z0: number; x1: number; z1: number };   // u, inclusive of the inner floor
  cells: { x0: number; z0: number; x1: number; z1: number };  // cell coords (inclusive)
  floor: number; floorY: number; ceilY?: number;    // ceilY absolute; undefined = open sky
  doors: string[];
  spots: {
    center: Spot; npc: Spot[]; loot: Spot[]; hide: Spot[]; vantage?: Spot;
    arena?: { cx: number; cz: number; r: number }; work?: Spot[]; checkpoint?: Spot[]; claim?: Spot[]; flag?: Spot; barricade?: Spot[];
    /** Ambient NPC walk loops inside the zone (each a closed polyline of standable points). */
    routes?: Spot[][];
  };
  chunks: [cx: number, cz: number][];
  tags: string[];
  /** Copied from the RoomRecipe at typeAndName time — the renderer reads THIS, never the kind name. */
  finish?: import('./plans/types').RoomFinish;
  kill?: { x0: number; z0: number; x1: number; z1: number }[];
  platforms?: { x: number; y: number; z: number; w: number; d: number }[];
  stairs?: { from: number; to: number; steps: { x0: number; z0: number; x1: number; z1: number; y: number }[] };
  owner?: string;
}
export interface Placement {
  prop: string; x: number; y: number; z: number; yaw: Dir16; scale: number;
  zone: string; floor: number; tint?: number; collide: boolean;
  role: 'anchor' | 'satellite' | 'wall' | 'surface' | 'clutter' | 'quest' | 'shell';
}
/** A default inhabitant the composer asks the engine to spawn (not authored by the script).
 *  `lines` are tt() keys (English strings); with `vars` a line may be a template with {name}-style holes
 *  that the engine fills through tt(line, vars) — the story's own nouns in the extras' mouths. */
export interface Person { id: string; zone: string; role: string; spot: Spot; route: Spot[]; lines: string[]; vars?: Record<string, string> }
export interface SemanticMap {
  archetype: ArchetypeId; seed: number; style: string; worldType: WorldType;
  zones: Zone[]; doors: Door[]; placements: Placement[];
  colliders: AABB[]; walls: WallRun[];
  colliderCells: Map<number, number[]>;             // cellKey(floor, cx, cz) → collider indices
  lights: { x: number; y: number; z: number; color: number; r: number; priority: number; floor: number }[];
  keys: { id: string; item: string; spot: Spot; opens: string; zone: string }[];
  people: Person[];
  start: Spot; exit?: Spot; ceilingY?: number;
  criticalPath: string[]; weenieZone: string;
  landmarks: { x: number; z: number; kind: string; zone: string; priority: number }[];
  aliases: Record<string, string>;                  // deaccented alias → zone id
  byRole: Partial<Record<Role, string[]>>;
  fallback: boolean;
}
export type Place = Pick<Zone, 'id' | 'name' | 'kind' | 'role' | 'rect' | 'spots' | 'doors' | 'floor' | 'floorY' | 'ceilY' | 'tags'>;
export interface CourseData { platforms: NonNullable<Zone['platforms']>; kill: NonNullable<Zone['kill']>; checkpoints: Spot[]; floorY: number }

/** A validation problem; `fatal` problems trigger repair / re-seed, others are warnings in tests. */
export interface Problem { check: string; zone?: string; msg: string; fatal: boolean }
export class ComposerInvariant extends Error { constructor(public problems: Problem[]) { super('composer invariant: ' + problems.map((p) => p.check + ': ' + p.msg).join('; ')); } }

/** Collider bucket key — one number per (floor, cell). */
export const cellKey = (floor: number, cx: number, cz: number): number => ((floor + 8) & 15) * 1_000_000 + (cx + 500) * 1000 + (cz + 500);

/** The kind an archetype names its corridors: 'corridor' for most, 'passage' (castle), 'hallway' (prison / hospital).
 *  Every caller that used to hard-code 'corridor' must ask this, or castle passages and prison hallways read as rooms. */
export const corridorKindOf = (arch: Pick<Archetype, 'roleMap'>): RoomKind => arch.roleMap.corridor?.[0] ?? 'corridor';

/** True when a zone is circulation, not a destination: the corridor / stairs ROLE, or the archetype's corridor KIND.
 *  Room rules (size bands, furnishing minima, the weenie) apply to destinations only — passages are shaped by traffic. */
export function isPassageZone(z: Pick<Zone, 'role' | 'kind'>, arch: Pick<Archetype, 'roleMap'>): boolean {
  return z.role === 'corridor' || z.role === 'stairs' || z.kind === 'stairs' || z.kind === corridorKindOf(arch);
}

// ---------------------------------------------------------------------------
// Stage contracts (the lanes agree on these signatures; see README.md)
// ---------------------------------------------------------------------------
import type { CellGrid } from './grid';
/** Output of an embedder: cells claimed per floor, zones with geometry (names/kinds may still be empty), doors, walls, colliders. */
export interface EmbeddedLayout {
  grids: Record<number, CellGrid>;                  // floor → grid
  zones: Zone[];                                    // zone.id/name/kind filled by typeAndName; spots arrays start empty
  doors: Door[];
  walls: WallRun[];
  colliders: AABB[];                                // shell colliders (walls, locked doors) — furnish appends prop colliders
  start: Spot;
  exit?: Spot;
  nodeZone: Record<string, string>;                 // mission node id → zone id
}
export interface FurnishResult { placements: Placement[]; lights: SemanticMap['lights']; people: Person[]; keys: SemanticMap['keys']; colliders: AABB[] }
export interface FurnishOpts {
  anchorsOnly?: boolean;
  /** The story brief (story.ts) — when present the dressing / casting hooks (dressing.ts, people.ts) see it.
   *  Absent ⇒ furnish is byte-identical to a brief-less compose (the snapshot fixture). */
  brief?: import('./story').StoryBrief;
  /** zone id → the PlaceReqs bound to that zone (index.ts derives it from the mission graph). */
  reqZones?: Record<string, PlaceReq[]>;
}
/*
  mission.ts     buildMission(seed, arch, reqs, tier): MissionGraph | null        (null = pacing rejected → caller re-seeds)
  cycles.ts      applyCycle(g, loop, pattern, rng): void
  embedSpine.ts  embedSpine(g, seed, arch): EmbeddedLayout | null
  embedGrid.ts   embedGrid(g, seed, arch): EmbeddedLayout | null
  typeAndName.ts typeAndName(layout, g, arch, seed, reqs): Record<string, string>   (fills zone.id/kind/name/role/depth; returns aliases)
  furnish.ts     furnish(layout, arch, seed, opts?): FurnishResult                   (fills zone.spots, appends prop colliders; opts.brief → dressing / people hooks)
  story.ts       storyBrief(def): StoryBrief                                         (pure: theme, mood, cast, items, threats, chain, nouns, story seed)
  dressing.ts    dressRooms(ctx: DressContext): void                                 (story sets per zone — after anchors, before clutter)
  people.ts      castPeople(ctx: CastContext): Person[]                              (the extras: who stands where and what they say)
  validate.ts    validate(map, g, arch): Problem[]
  index.ts       compose(seed, arch, reqs, tier, brief?): SemanticMap               (driver + finalize + fallbackLinear)
*/
