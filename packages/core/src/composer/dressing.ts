// src/engine/composer/dressing.ts — STORY SETS (the hook furnish.ts calls per zone, between anchors and clutter).
//
// THE CONTRACT. furnish.ts builds every zone in steps: doors/lane → quest props → recipe anchors → hide/loot
// minima → [dressRooms] → wall packing → surfaces → clutter → spots. dressRooms runs AFTER the anchors (the
// room still reads as its kind: a kitchen has its counter before the story adds the poisoned cup) and BEFORE
// the generic clutter (a story set wins the floor space; clutter fills what is left). It is invoked once per
// zone per furnish candidate (K = 3 per zone) with `ctx.zone` = the room being dressed and `ctx.zones` = the
// whole building for context; `ctx.rng` is seeded from brief.seed + zone.id, never from the layout seed, so
// the same script dresses the same room the same way on every seed. Everything placed through ctx.place goes
// through furnish's own occupancy grid: never overlaps, respects the start keep-out, the door fans and the lane.
//
// WHAT A SET IS. storySet() turns the brief into a ROOM SET: an ordered list of pieces (each a prop TAG query
// with alternatives, a placement rule and a purpose) for every room the story touches —
//   · a room holding a story ITEM gets a KEEPER (the loot-flagged chest / crate cluster whose front IS the loot
//     spot the engine drops the item at — furnish derives zone.spots.loot from loot props, so the keeper is how
//     an item "sits somewhere" rather than at the room's centre);
//   · a named CHARACTER gets the props of their role word (queen → throne dais + banners, nurse → station +
//     cabinet, chef → stove + cauldron, detective → desk + filing + pushed-back chair…) and a reserved stand
//     strip in front of the first one, so clutter never crowds where they work;
//   · a THREAT room gets its arena edge (braziers / banners / crates by family);
//   · the KEY room gets a visible keeper for the key (cabinet + crates);
//   · the rooms the CHAIN points at (where the first and the last beat happen) get one THEME vignette — the
//     crime's pushed-back chair and papers, the heist's crates and vent, the party's tables in a row, the
//     exam's rows of desks, the haunting's candles and portraits, the siege's barricade at the door…
// The set is a PURE function of the story (brief + the room's story content + the archetype family) — never of
// the layout seed, the room's rect or its kind — so the same script dresses the same set on every load; only the
// positions adapt. Generic clutter is damped in story rooms so the set reads. Budget: ≤ MAX_PIECES props per room.
//
// THE LIBRARY'S TAG VOCABULARY (src/engine/props/): ctx.place selects by tag union, filtered by placement kind
// (wall / floor), then tries candidates in furnish's rng order. Family-pure tags ('castle', 'medical', 'prison',
// 'office', 'school', 'fire', 'throne', 'hoard', 'shrine', 'ritual', 'armoury', 'classroom', 'secret', 'sell',
// 'movable', 'sleep', 'treasure') are preferred; the shared tags ('seat', 'surface', 'workstation', 'storage',
// 'hide', 'cover') come last as fallbacks because their unions cross families.
import type { Archetype, PlaceReq, Placement, Role, RoomKind, RoomRecipe, Spot } from './types';
import type { Rng } from './rng';
import { DIR16 } from './lut';
import { propMeta } from '../props/library';
import type { BriefCast, BriefItem, BriefThreat, StoryBrief, Theme } from './story';

/** One room as the dressing / casting hooks see it. */
export interface DressZone {
  id: string; kind: RoomKind; name: string;
  /** The author's words for the room when a PlaceReq labelled it ('Throne Room', "Mira's bedroom"). */
  label?: string;
  rect: { x0: number; z0: number; x1: number; z1: number };
  floor: number;
  /** The player's start is inside this room. */
  isStart: boolean;
  /** Single-door room (a dead end — where a story puts the thing to find). */
  isLeaf: boolean;
  /** The PlaceReqs the mission bound here (empty for rooms the script never named). */
  reqs: PlaceReq[];
  /** The story entities standing here (by their authored `place` resolving to this zone). */
  cast: BriefCast[]; items: BriefItem[]; threats: BriefThreat[];
  /** The zone's mission role when furnish passes it (optional: a 'boss' / 'combat' room gets its arena edge even
   *  when the enemy has no `at:` — see the patch noted in the dressing lane's report). */
  role?: Role;
}

export interface PlaceOpts {
  /** The zone to place in — must be `ctx.zone` (the hook runs per zone); any other zone → undefined. */
  zone: string;
  /** 'wall' = against a wall facing in · 'free' = anywhere on the floor, tucked away · 'center' = on the floor
   *  near the room's lane / centre (visible) · 'nearDoor' = on the lane, near a door · 'corner' = a corner. */
  against?: 'wall' | 'free' | 'center' | 'nearDoor' | 'corner';
  /** Prefer slots close to this spot (a chair by the bed, the cup by the throne). */
  near?: Spot;
  /** Keep at least this far (u) from every door. */
  minDoorDist?: number;
  /** Place up to this many (default 1); the first placement is returned. */
  count?: number;
  /** Placement role: 'anchor' (default — repair() may drop it last, after clutter / wall / surface) or 'quest'
   *  (never dropped — use for the one prop the story cannot do without). */
  role?: 'anchor' | 'quest';
  /** Optional: let the footprint stand on the boss arena's disc (like furnish's cover pillars) — an item keeper in
   *  a small boss room has no floor outside it. Ignored until furnish honours it. */
  allow?: 'arena';
}

export interface DressContext {
  brief: StoryBrief;
  arch: Archetype;
  /** The prop-library style id the world renders with (arch.style or the script's `style:`). */
  style: string;
  /** Seeded from brief.seed + zone.id — the story's die, not the layout's. */
  rng: Rng;
  /** The room being dressed now. */
  zone: DressZone;
  /** Every room of the building (including `zone`), in layout order. */
  zones: DressZone[];
  /** Place one prop from the library by tag(s) (first tag list hit that fits, in rng order) through furnish's
   *  occupancy grid. undefined when nothing fits — never overlaps, never blocks a door or the start. */
  place(tag: string | string[], opts: PlaceOpts): Placement | undefined;
  /** Keep generic wall packing / clutter out of this rect (world units, inside the zone rect). */
  reserve(zone: string, rect: { x0: number; z0: number; x1: number; z1: number }): void;
  /** Scale the zone's recipe clutter density (0 = none, 1 = the recipe's own) for this candidate. */
  dampClutter(zone: string, factor: number): void;
}

// ---------------------------------------------------------------------------
// The set vocabulary
// ---------------------------------------------------------------------------
/** Props a story room may take on top of its recipe (composed-perf: ≤ 12 meshes per chunk, ≤ 60 near the player). */
export const MAX_PIECES = 8;
/** Clutter density left in a story room (1 = the recipe's own): the set must read, not drown. */
const STORY_CLUTTER = 0.35, VIGNETTE_CLUTTER = 0.25;
/** A stand strip reserved in front of a role prop: a hero (r 2.2) plus slack, ≥ 4.6 u wide. */
const STAND_DEPTH = 2.8, STAND_MIN_W = 4.6;

export type Against = NonNullable<PlaceOpts['against']>;
/** One way a piece may be realised: a tag union and where it goes. */
export interface SetAlt { tags: string[]; against: Against }
export interface SetPiece {
  /** What the piece is for: 'item:<id>' · 'cast:<id>:<n>' · 'threat' · 'key' · 'theme:<theme>:<n>'. */
  id: string;
  /** Alternatives in preference order — the first whose tag union has a prop that fits wins. */
  alts: SetAlt[];
  count?: number;
  role?: 'anchor' | 'quest';
  minDoorDist?: number;
  /** Passed to ctx.place as `allow` for the LAST alternative only (a keeper may stand on the arena edge). */
  allow?: 'arena';
  /** Prefer slots near the room's centre (role props face where the character stands). */
  nearCentre?: boolean;
  /** Reserve a stand strip in front (the character's own spot). */
  stand?: boolean;
  /** The story cannot do without it — the tests check that it landed. */
  must?: boolean;
}
export interface RoomSet {
  zone: string;
  /** Why this room is a story room: 'item' · 'cast' · 'threat' · 'key' · 'chain-first' · 'chain-last'. */
  reasons: string[];
  pieces: SetPiece[];
  /** Clutter factor handed to ctx.dampClutter. */
  clutter: number;
}

/** The prop family the world dresses in — what the archetype is, unless the style says haunted / castle. */
export type Family = 'castle' | 'spooky' | 'medical' | 'prison' | 'office' | 'school' | 'shop' | 'home';
export function familyOf(arch: Pick<Archetype, 'id'>, style: string): Family {
  if (style === 'haunted') return 'spooky';
  if (style === 'castle' || style === 'castle.winter' || style === 'dungeon') return 'castle';
  switch (arch.id) {
    case 'hospital': case 'lab': return 'medical';
    case 'prison': return 'prison';
    case 'office': return 'office';
    case 'school': return 'school';
    case 'shop': return 'shop';
    case 'castle': case 'dungeon': return 'castle';
    case 'haunted': return 'spooky';
    default: return 'home';
  }
}

/** Per-family tag palettes: the family-pure tag first, the shared tag as the fallback. */
interface Palette { wall: SetAlt[]; light: SetAlt[]; crates: SetAlt[]; cabinet: SetAlt[]; seat: SetAlt[]; table: SetAlt[]; desk: SetAlt[]; bed: SetAlt[] }
const A = (tags: string[], against: Against): SetAlt => ({ tags, against });
const SHARED: Palette = {
  wall: [A(['tall'], 'wall')], light: [], crates: [A(['storage'], 'corner')], cabinet: [A(['hide'], 'wall'), A(['storage'], 'wall')],
  seat: [A(['seat'], 'free')], table: [A(['surface'], 'center')], desk: [A(['workstation'], 'center')], bed: [A(['sleep'], 'wall'), A(['sleep'], 'free')],
};
const PALETTES: Record<Family, Palette> = {
  castle: { ...SHARED, wall: [A(['wall'], 'wall')], light: [A(['fire'], 'free')], crates: [A(['storage'], 'corner'), A(['hide'], 'corner')] },
  spooky: { ...SHARED, wall: [A(['wall'], 'wall')], light: [A(['fire'], 'free')], crates: [A(['hide'], 'corner'), A(['storage'], 'corner')] },
  medical: { ...SHARED, wall: [A(['medical'], 'wall')], light: [A(['medical'], 'free')], cabinet: [A(['medical'], 'wall'), A(['hide'], 'wall')], desk: [A(['reception'], 'wall'), A(['medical'], 'center'), A(['workstation'], 'center')] },
  prison: { ...SHARED, wall: [A(['prison'], 'wall')], cabinet: [A(['prison'], 'wall'), A(['hide'], 'wall')], desk: [A(['security'], 'corner'), A(['workstation'], 'center')] },
  office: { ...SHARED, wall: [A(['office'], 'wall')], cabinet: [A(['office'], 'wall'), A(['storage'], 'wall')], seat: [A(['office'], 'free'), A(['seat'], 'free')], table: [A(['meeting'], 'center'), A(['surface'], 'center')], desk: [A(['office'], 'center'), A(['workstation'], 'center')] },
  school: { ...SHARED, wall: [A(['school'], 'wall'), A(['focal'], 'wall')], desk: [A(['classroom'], 'center'), A(['workstation'], 'center')] },
  shop: { ...SHARED, wall: [A(['sign'], 'wall'), A(['storage'], 'wall')], cabinet: [A(['storage'], 'wall')], desk: [A(['sell'], 'center'), A(['workstation'], 'center')] },
  home: SHARED,
};

// ---------------------------------------------------------------------------
// Role words → props
// ---------------------------------------------------------------------------
type PieceSpec = Pick<SetPiece, 'alts' | 'count' | 'nearCentre' | 'stand' | 'minDoorDist'>;
const piece = (alts: SetAlt[], extra: Partial<PieceSpec> = {}): PieceSpec => ({ alts, ...extra });
const THRONE: SetAlt[] = [A(['throne'], 'wall'), A(['weenie'], 'center'), A(['seat'], 'center')];

/** The props of a role word, best first (the first piece carries the stand strip). */
function rolePieces(role: string | undefined, fam: Family, P: Palette): PieceSpec[] {
  const deskSet = () => [piece(P.desk, { nearCentre: true, stand: true }), piece(P.cabinet), piece(P.seat)];
  switch (role) {
    case 'queen': case 'king': case 'noble':
      return [piece(THRONE, { nearCentre: true, stand: true }), piece(P.wall, { count: 2 }), ...(P.light.length ? [piece(P.light)] : [])];
    case 'steward': case 'detective': case 'warden': case 'principal': case 'merchant':
      return fam === 'shop' ? [piece([A(['sell'], 'center'), A(['workstation'], 'center')], { nearCentre: true, stand: true }), piece(P.cabinet), piece(P.crates)] : deskSet();
    case 'priest':
      return fam === 'castle' ? [piece([A(['shrine'], 'wall'), A(['ritual'], 'center')], { nearCentre: true, stand: true }), piece(P.light, { count: 2 }), piece(P.seat)]
        : fam === 'spooky' ? [piece([A(['ritual'], 'center'), A(['shrine'], 'wall')], { nearCentre: true, stand: true }), piece(P.light, { count: 2 }), piece(P.wall)]
        : [piece(P.table, { nearCentre: true, stand: true }), piece(P.seat, { count: 2 })];
    case 'captain': case 'soldier': case 'guard':
      return fam === 'castle' ? [piece([A(['armoury'], 'wall'), A(['wall'], 'wall')], { nearCentre: true, stand: true }), piece(P.light), piece(P.crates)]
        : fam === 'prison' || fam === 'medical' ? [piece([A(['security'], 'corner'), A(['security'], 'wall'), A(['hide'], 'wall')], { stand: true }), piece(P.crates), piece(P.wall)]
        : [piece(P.cabinet, { stand: true }), piece(P.crates, { count: 2 })];
    case 'chef':
      return [piece([A(['workstation'], 'wall'), A(['surface'], 'wall')], { stand: true }), ...(fam === 'castle' || fam === 'spooky' ? [piece([A(['fire'], 'free')])] : [piece(P.table, { nearCentre: true })]), piece(P.crates)];
    case 'nurse': case 'doctor':
      return fam === 'medical' ? [piece([A(['reception'], 'wall'), A(['medical'], 'wall')], { nearCentre: true, stand: true }), piece([A(['medical'], 'wall')]), piece([A(['medical'], 'free')])] : deskSet();
    case 'patient':
      return [piece(P.bed, { stand: true }), ...(fam === 'medical' ? [piece([A(['medical'], 'free')])] : [piece(P.seat)])];
    case 'prisoner':
      return [piece([A(['prison'], 'wall'), ...P.bed], { stand: true }), piece(P.crates), piece(P.seat)];
    case 'librarian': case 'teacher':
      return [piece([A(['tall'], 'wall')], { stand: true }), piece(P.desk, { nearCentre: true }), ...(fam === 'school' ? [piece([A(['focal'], 'wall')])] : [piece(P.seat)])];
    case 'janitor':
      return [piece(P.cabinet, { stand: true }), piece(P.crates), piece([A(['movable'], 'free')])];
    case 'scientist':
      return fam === 'medical' ? [piece([A(['lab'], 'wall'), A(['medical'], 'wall')], { stand: true }), piece([A(['medical'], 'free')]), piece(P.cabinet)] : deskSet();
    case 'ghost':
      return [piece([A(['ritual'], 'center'), A(['hide'], 'corner')], { nearCentre: true, stand: true }), piece(fam === 'castle' || fam === 'spooky' ? P.light : P.wall, { count: 2 }), piece(P.wall)];
    case 'wizard':
      return [piece([A(['ritual'], 'center'), A(['tall'], 'wall')], { nearCentre: true, stand: true }), piece(P.light), piece([A(['tall'], 'wall')])];
    case 'pupil':
      return [piece(P.desk, { nearCentre: true, stand: true }), piece(P.seat)];
    case 'courier': case 'waiter':
      return [piece([A(['movable'], 'free'), ...P.table], { stand: true }), piece(P.table, { nearCentre: true })];
    case 'farmer':
      return [piece(P.crates, { count: 2, stand: true }), piece(P.seat)];
    default:   // elder, parent, a name with no title: a homely set — somewhere to sit, something to sit at
      return [piece(P.seat, { nearCentre: true, stand: true }), piece(P.table), ...(P.light.length ? [piece(P.light)] : [])];
  }
}

// ---------------------------------------------------------------------------
// Themes → vignettes
// ---------------------------------------------------------------------------
function themePieces(theme: Theme, fam: Family, P: Palette): PieceSpec[] {
  const lit = P.light.length ? [piece(P.light)] : [];
  switch (theme) {
    case 'crime':    return [piece(P.desk, { nearCentre: true }), piece(P.seat), piece(P.wall)];
    case 'heist':    return [piece(P.crates, { count: 2 }), piece([A(['secret'], 'wall')]), piece(P.cabinet)];
    case 'missing':  return [piece(P.seat), piece(P.cabinet), piece(P.crates)];
    case 'party': case 'wedding': return [piece(P.table, { count: 2, nearCentre: true }), piece(P.seat, { count: 2 }), piece(P.wall, { count: 2 })];
    case 'exam':     return fam === 'school' ? [piece([A(['classroom'], 'center')]), piece(P.wall)] : [piece(P.desk, { count: 3 }), piece(P.wall)];
    case 'ghost':    return [...(P.light.length ? [piece(P.light, { count: 2 })] : []), piece(P.wall, { count: 2 }), piece([A(['hide'], 'corner')])];   // 'spooky' would pull the dead tree indoors
    case 'siege':    return [piece([A(['armoury'], 'wall'), ...P.wall]), piece(P.crates.map((a) => A(a.tags, 'nearDoor')), { count: 2 }), ...lit];
    case 'escape':   return [piece([A(['secret'], 'wall')]), piece([A(['bars'], 'wall'), ...P.wall]), piece(P.crates), piece(P.seat)];
    case 'illness':  return fam === 'medical' ? [piece([A(['medical'], 'free')], { count: 2 }), piece([A(['medical'], 'wall')])] : [piece(P.bed), piece(P.cabinet)];
    case 'market':   return [piece([A(['sell'], 'center'), ...P.table], { nearCentre: true }), piece(P.crates, { count: 2 }), piece([A(['sign'], 'wall'), ...P.wall])];
    case 'trial':    return [piece(P.table, { nearCentre: true }), piece(P.seat, { count: 3 }), piece(P.wall)];
    case 'treasure': return [piece([A(['hoard'], 'center'), A(['treasure'], 'center')], { nearCentre: true }), piece([A(['treasure'], 'free')], { count: 2 }), ...(fam === 'castle' ? [piece([A(['shrine'], 'wall')])] : [])];
    case 'romance':  return [piece(P.table, { nearCentre: true }), piece(P.seat, { count: 2 }), ...lit];
    case 'sports':   return [piece([A(['seat'], 'wall')]), piece(P.seat, { count: 2 }), piece([A(['focal'], 'wall')])];
    case 'rescue':   return [piece([A(['movable'], 'nearDoor')]), piece(P.crates.map((a) => A(a.tags, 'nearDoor'))), ...lit];
  }
}

/** The arena's edge — what a fight is fought among, by family. */
function threatPieces(fam: Family, P: Palette, boss: boolean): PieceSpec[] {
  const n = boss ? 2 : 1;
  if (fam === 'castle' || fam === 'spooky') return [piece(P.light, { count: n }), piece(P.wall, { count: n }), piece(P.crates)];
  if (fam === 'medical' || fam === 'prison') return [piece(P.crates, { count: n + 1 }), piece(P.wall)];
  return [piece(P.crates, { count: n + 1 }), piece(P.cabinet)];
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------
/** The story content of a room the set is a function of (a subset of DressZone — never the rect, kind or flags). */
export type StoryView = Pick<DressZone, 'id' | 'reqs' | 'cast' | 'items' | 'threats' | 'role'>;

/** The zones the chain's first and last beats happen in (by the entity the beat targets). */
export function chainRooms(brief: StoryBrief, zones: readonly StoryView[]): { first?: string; last?: string } {
  const holds = (z: StoryView, id: string) => z.cast.some((c) => c.id === id) || z.items.some((i) => i.id === id) || z.threats.some((t) => t.id === id);
  const zoneOf = (id: string | undefined) => (id ? zones.find((z) => holds(z, id))?.id : undefined);
  const steps = brief.chain;
  if (!steps.length) return {};
  let first: string | undefined, last: string | undefined;
  for (const s of steps) { first = zoneOf(s.targetId); if (first) break; }
  for (let i = steps.length - 1; i >= 0; i--) { last = zoneOf(steps[i].targetId); if (last) break; }
  return { first, last };
}

const isKeyReq = (r: PlaceReq) => r.role === 'key' || !!r.item;
const isThreatReq = (r: PlaceReq) => r.role === 'boss' || r.role === 'combat' || !!r.boss;

/** The set for one room, or null when the story never touches it. Pure: brief + the room's story content + family. */
export function storySet(brief: StoryBrief, arch: Pick<Archetype, 'id'>, style: string, zone: StoryView, zones: readonly StoryView[]): RoomSet | null {
  const fam = familyOf(arch, style), P = PALETTES[fam];
  const chain = chainRooms(brief, zones);
  const reasons: string[] = [];
  if (zone.items.length) reasons.push('item');
  if (zone.cast.length) reasons.push('cast');
  if (zone.threats.length || zone.reqs.some(isThreatReq) || zone.role === 'boss' || zone.role === 'combat') reasons.push('threat');
  if (zone.items.some((i) => i.isKey) || zone.reqs.some(isKeyReq)) reasons.push('key');
  if (chain.first === zone.id) reasons.push('chain-first');
  if (chain.last === zone.id) reasons.push('chain-last');
  if (!reasons.length) return null;

  const pieces: SetPiece[] = [];
  const add = (id: string, spec: PieceSpec, extra: Partial<SetPiece> = {}) => pieces.push({ id, ...spec, ...extra });
  // 1. keepers: one loot prop per story item (its front becomes zone.spots.loot[i]); the key-like item gets a chest
  //    (visible near the centre first; a boss arena or a cramped room pushes it to a corner or wherever it fits)
  for (const it of zone.items.slice(0, 2)) {
    const treasure = brief.theme.includes('treasure') || it.isKey;
    const keeper = treasure ? ['treasure', 'loot'] : ['loot', 'treasure'];
    const alts = [A([keeper[0]], 'center'), A([keeper[1]], 'center'), A(['loot'], 'corner'), A(['loot', 'treasure'], 'free')];
    add('item:' + it.id, piece(alts, { nearCentre: true }), { role: 'quest', must: true, minDoorDist: 3, allow: 'arena' });
  }
  // 2. the cast's role props (two characters at most; the first piece of each carries the stand strip)
  for (const c of zone.cast.slice(0, 2)) rolePieces(c.roleWord, fam, P).forEach((spec, pi) => add(`cast:${c.id}:${pi}`, spec, pi === 0 ? { must: true } : {}));
  // 3. the arena edge
  if (reasons.includes('threat')) {
    const boss = zone.threats.some((t) => t.boss) || zone.reqs.some((r) => r.role === 'boss' || !!r.boss) || zone.role === 'boss';
    threatPieces(fam, P, boss).forEach((spec, pi) => add(`threat:${pi}`, spec, pi === 0 ? { must: true } : {}));
  }
  // 4. the key's keeper
  if (reasons.includes('key')) { add('key:0', piece(P.cabinet, { nearCentre: true }), { must: true }); add('key:1', piece(P.crates)); }
  // 5. the theme vignette, where the chain starts and ends (the strongest theme, the second where both beats share a room)
  const themeAt = (which: 'first' | 'last'): Theme | undefined => {
    if (chain[which] !== zone.id) return undefined;
    if (which === 'last' && chain.first === zone.id) return brief.theme[1];
    return brief.theme[0];
  };
  for (const th of [themeAt('first'), themeAt('last')]) {
    if (!th) continue;
    themePieces(th, fam, P).forEach((spec, pi) => add(`theme:${th}:${pi}`, spec, pi === 0 ? { must: true } : {}));
  }
  // budget: the pieces that matter come first; trim the counts of the last pieces before dropping any
  const total = () => pieces.reduce((s, p) => s + (p.count ?? 1), 0);
  for (;;) {
    if (total() <= MAX_PIECES) break;
    let i = pieces.length - 1; while (i >= 0 && (pieces[i].count ?? 1) <= 1) i--;
    if (i >= 0) pieces[i].count = (pieces[i].count ?? 1) - 1; else pieces.pop();
  }
  const vignette = reasons.includes('chain-first') || reasons.includes('chain-last');
  return { zone: zone.id, reasons, pieces, clutter: vignette ? VIGNETTE_CLUTTER : STORY_CLUTTER };
}

/** A recipe that already guarantees a loot prop (its chest is the item's keeper; no twin needed). */
export const recipeHasLoot = (recipe: RoomRecipe | undefined): boolean => !!recipe && recipe.anchors.some((a) => a.tag === 'loot' && a.n[0] >= 1);

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------
/** The strip a hero stands in to use a prop: in front of its face, STAND_DEPTH deep, ≥ STAND_MIN_W wide, clipped to the room. */
function standRect(p: Placement, rect: DressZone['rect']): { x0: number; z0: number; x1: number; z1: number } {
  const m = propMeta(p.prop); const [fx, fz] = DIR16[p.yaw] ?? [0, 1];
  const along = m.d, across = Math.max(m.w, STAND_MIN_W);
  const ax = p.x + fx * (along / 2 + STAND_DEPTH / 2), az = p.z + fz * (along / 2 + STAND_DEPTH / 2);
  const ex = fx === 0 ? across / 2 : STAND_DEPTH / 2, ez = fz === 0 ? across / 2 : STAND_DEPTH / 2;
  return { x0: Math.max(rect.x0, ax - ex), z0: Math.max(rect.z0, az - ez), x1: Math.min(rect.x1, ax + ex), z1: Math.min(rect.z1, az + ez) };
}

/** Dress one room for the story: compute its set and put every piece through furnish's grid. */
export function dressRooms(ctx: DressContext): void {
  const zone = ctx.zone;
  const set = storySet(ctx.brief, ctx.arch, ctx.style, zone, ctx.zones);
  if (!set) return;
  ctx.dampClutter(zone.id, set.clutter);
  const r = zone.rect;
  const centre: Spot = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, yaw: 0, floor: zone.floor };
  const keeperDone = recipeHasLoot(ctx.arch.kinds[zone.kind]);
  let placed = 0;
  for (const p of set.pieces) {
    if (placed >= MAX_PIECES) break;
    if (p.id.startsWith('item:') && keeperDone) continue;          // the recipe's own chest already fronts the loot spot
    const n = p.count ?? 1;
    for (let i = 0; i < n && placed < MAX_PIECES; i++) {
      let got: Placement | undefined;
      for (const [ai, alt] of p.alts.entries()) {
        const last = ai === p.alts.length - 1;
        got = ctx.place(alt.tags, { zone: zone.id, against: alt.against, near: p.nearCentre ? centre : undefined, minDoorDist: p.minDoorDist, role: p.role, allow: last ? p.allow : undefined });
        if (got) break;
      }
      if (!got) break;
      placed++;
      if (p.stand && i === 0) ctx.reserve(zone.id, standRect(got, r));
    }
  }
}
