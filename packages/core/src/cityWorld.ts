import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bakeBoxAO } from './blockyKit';
import { withCutout } from './cameraCutout';
import { tt } from './lib/uiText';
import type { World } from './world';
import {
  CITY_PROFILES, SLUMS_THEME, RUINS_THEME, NEON_THEME, mulberry32, shadeHex,
  slumFacadeTexture, ruinFacadeTexture, neonFacadeTexture,
  slumGroundTexture, ruinGroundTexture, neonGroundTexture,
  plateTexture, signGlyphTexture, poolSprite, puddleSprite,
} from './cityFlavours';

// ============================================================================
// CityWorld — infinite, chunk-streamed GRID city.
// Ported from the verified infinite-city games:
//   - index.html (daytime: concrete/glass buildings, road ground, parks, trees,
//     street props) — bright palette + window CanvasTexture.
//   - city.html  (night: per-chunk InstancedMesh towers with emissive-lit
//     windows, dark palette, low moonlit feel).
// The grid is mathematically endless: each GLOBAL cell is decided
// deterministically from its (globalCellX, globalCellZ). A cell is a ROAD when
// (gcx % ROAD_EVERY === 0 || gcz % ROAD_EVERY === 0) so avenues line up across
// chunk seams; every other cell is, seeded per global cell, a BUILDING (most)
// or a PARK with trees. We stream square chunks of G×G cells around the player,
// building ahead and disposing behind -> constant memory.
// The ground is FLAT: heightAt() === 0.
// ============================================================================

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number; }

/** Which CITY we are building. day/night are the clean modern city; slums,
 *  ruins and neon are the industrial flavours (see cityFlavours.ts). Every
 *  behavioural difference between them is data — CITY_PROFILES below — so the
 *  chunk builder stays ONE code path with one set of contracts. */
export type CityKind = 'day' | 'night' | 'slums' | 'ruins' | 'neon';

/** The knobs a flavour turns on the SHARED chunk builder. Colours live in the
 *  CityTheme; anything that changes the LAYOUT or the material feel lives here.
 *  day/night restate the original constants (see cityFlavours.CITY_PROFILES). */
export interface CityProfile {
  /** chunk radius kept loaded around the player (fog hides the rest). */
  view: number;
  /** chance a non-road cell is an open lot (park lawn / junk yard / crater). */
  lotChance: number;
  /** below this roll a building is a windowed facade, above it glass, 0.92+ brick. */
  cThresh: number;
  /** footprint + height profile: base + u*span (height uses u*u -> few tall ones). */
  bw: number; bwSpan: number; bd: number; bdSpan: number; bhBase: number; bhSpan: number;
  /** ± position wobble off the grid node, and ± yaw wobble (crooked shacks). */
  jitter: number; yaw: number;
  /** a kerbside vehicle on every Nth road cell (hash-picked, not rnd). */
  carEvery: number;
  /** painted zebra crossings at intersections (a bombed sector has none). */
  crosswalks: boolean;
  /** ground light-pools under the streetlights. */
  lampPool: boolean;
  facadeRough: number; facadeMetal: number;
  glassRough: number; glassMetal: number;
  groundRough: number; groundMetal: number;
}

export interface CityTheme {
  /** display key + the generator's flavour discriminator */
  name: CityKind;
  /** dark cities light their windows via emissive; day cities don't. */
  night: boolean;
  /** background sky gradient stops (top -> bottom). */
  sky: [string, string, string, string];
  /** exponential fog colour + density. */
  fog: number;
  fogDensity: number;
  /** concrete/office building base colour. */
  concrete: number;
  /** glass tower base colour. */
  glass: number;
  /** brick/accent building colour. */
  brick: number;
  /** road / asphalt ground colour tint (multiplies the road CanvasTexture). */
  asphalt: number;
  /** dark asphalt base painted into the road CanvasTexture. */
  roadBase: string;
  /** lighter asphalt block (between markings) painted into the road texture. */
  roadBlock: string;
  /** lane / centre-line marking colour painted into the road texture. */
  roadLine: string;
  /** sidewalk / curb strip colour painted into the road texture. */
  curb: string;
  /** park grass colour. */
  park: number;
  /** tree foliage colours. */
  foliage: [number, number, number];
  /** tree trunk colour. */
  trunk: number;
  /** lit-window tint (used as emissive colour at night, glass glint by day). */
  window: number;
  /** emissive strength for windows (0 by day). */
  windowEmissive: number;

  // ---- FLAVOUR-ONLY (day/night leave these undefined and build none of it) ----
  /** structural steel: plate pillars, girders, vending cabinets. */
  struct?: number;
  /** corrugated sheet: shack roofs, scrap fences, lean-to walls, ruin slabs. */
  scrap?: number;
  /** per-instance palette for junk heaps / rubble mounds. */
  junk?: number[];
  /** per-instance palette for the UNLIT-bright props: fires, strips, signs. */
  glow?: number[];
  /** SLUMS: height of the plate overhead. Reported as World.ceilingY, so the
   *  camera and the jump arc stop under it — the sector really is roofed. */
  plateY?: number;
  /** plate underside tint + its caged service-lamp colour. */
  plateColor?: number;
  plateLamp?: number;
}

export const CITY_THEMES: Record<CityKind, CityTheme> = {
  day: {
    name: 'day',
    night: false,
    // SUNNY comic town: saturated blue zenith falling into a warm cream
    // horizon; the fog is a light WARM haze (not washed grey) so the warm
    // plaster facades pop against it instead of dissolving into it.
    sky: ['#5f9ce8', '#93c4ee', '#cfe2ec', '#f5eedb'],
    fog: 0xe8e5d2,
    fogDensity: 0.0036,
    // near-white: the warm plaster/brick TOWN palette is applied PER BUILDING
    // via instanceColor (see dayFacade in the ctor) so the shared material
    // stays neutral and one pipeline serves every paint job.
    concrete: 0xfdfaf2,
    glass: 0xa9cade,
    brick: 0xc96f4a,
    // sun-bleached asphalt: lighter + warmer than the old charcoal so streets
    // read as daylight pavement, not night roads under a blue sky.
    asphalt: 0x9b9a92,
    roadBase: '#494c52',
    roadBlock: '#54575d',
    roadLine: '#e9cf6a',
    curb: '#c4bca6',
    park: 0x55a04e,
    foliage: [0x3f8f2e, 0x55a83c, 0x6cbf4e],
    trunk: 0x7a5238,
    window: 0xdff0ff,
    windowEmissive: 0.0,
  },
  night: {
    name: 'night',
    night: true,
    sky: ['#070b16', '#0e1626', '#141d30', '#1b2336'],
    // blue-PURPLE veil (lighting audit 2026-08-23): the whole night palette was lifted
    // ~×1.7 — road albedo sat at 0.01 and facades at 0.02, so no amount of light read as
    // anything but black with floating lamp pools. Still a night city, now a readable one.
    fog: 0x2c2c50,
    fogDensity: 0.0055,
    // NOTE: concrete/glass MULTIPLY the night facade texture (base ~#525c70,
    // see facadeTexture). Effective facade albedo lands in the requested deep
    // blue-charcoal band (~0x1c2230..0x232a3c), so silhouettes separate from
    // the sky, the street and each other — they are NOT pitch-black slabs.
    concrete: 0x9aa8c4,
    glass: 0x8a98b8,
    brick: 0x2c3142,   // rare matte towers join the blue-charcoal family
    // street reads as a corridor: asphalt × roadBase ≈ 0x191d2b albedo, but the
    // ground faces the sky light head-on so it renders a touch LIGHTER than
    // the facades; curb pads are lighter still so sidewalks pop.
    asphalt: 0xb8c0d0,
    roadBase: '#4a5270',
    roadBlock: '#565d72',
    roadLine: '#7a6326',
    curb: '#363c4c',
    park: 0x223c29,
    foliage: [0x1f3a25, 0x24452b, 0x2c5232],
    trunk: 0x2b2018,
    window: 0xffe9c4,
    windowEmissive: 1.15,
  },
  // ---- the industrial flavours (data + canvas art live in cityFlavours.ts) ----
  slums: SLUMS_THEME,
  ruins: RUINS_THEME,
  neon: NEON_THEME,
};

function hash2(cx: number, cz: number): number {
  let h = (cx * 73856093) ^ (cz * 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return h >>> 0;
}

/** A notable spot inside a chunk (park center, street corner, lamp post…). */
interface Landmark { x: number; z: number; kind: string; name?: string }
interface Chunk { group: THREE.Group; cols: AABB[]; walls: THREE.Object3D[]; landmarks: Landmark[]; }

/** reused in the per-building tint maths (never mutated). */
const WHITE = new THREE.Color(0xffffff);

// ============================================================================
// CITY LAYOUT — the pure grid maths of a city: which global cell is road, block,
// plaza, green square or downtown, where the kid starts, and (new) which buildings
// along the home boulevard are LOTS you can walk into. Seed-only and allocation-
// free: no scene, no canvas, no chunk — so the lot table can be asked for by the
// game BEFORE a chunk exists (a save resuming inside the hospital, a script that
// sends the Baker to the bakery, a friend joining mid-run) and by a test without
// building anything. CityWorld owns one and delegates; buildChunk reads it.
// ============================================================================

/** Grid constants — one set, shared by the layout and the chunk builder. */
const SPACING = 30;        // world size of one grid cell
const G = 7;               // cells per chunk side
const ROAD_EVERY = 5;      // every Nth global cell line is a clear avenue
const BLV_EVERY = 3;       // every Nth avenue is a boulevard (two carriageways)
const BLV = ROAD_EVERY * BLV_EVERY;   // cell period of the boulevard / downtown lattice
const DISTRICT = BLV * SPACING;       // world period of that lattice (450u = 3 city blocks)

export { LOT_ARCHETYPE, lotKindForWord, type CityLotKind } from './cityLots';
import { LOT_ARCHETYPE, type CityLotKind } from './cityLots';

/** Kid-facing sign text of the CIVIC kinds — the landmarks a story names ("at the hospital").
 *  Read through tt() at table-build time so a Greek city has a Νοσοκομείο over its door. */
const LOT_NAMES: Record<CityLotKind, () => string> = {
  house: () => tt('House'), shop: () => tt('Bakery'), school: () => tt('School'), office: () => tt('Office'),
  hospital: () => tt('Hospital'), precinct: () => tt('Police Station'), hotel: () => tt('Hotel'),
};
/** Awning / sign colour per kind — the one visual that says what a door is from down the street. */
export const LOT_COLORS: Record<CityLotKind, number> = {
  house: 0x5fae5a, shop: 0xd9453b, school: 0xf2c037, office: 0x6f8aa6, hospital: 0xf2f2f2, precinct: 0x3a6fd8, hotel: 0x8a4fb8,
};
/** One enterable building. `rect` is the building footprint (a collider); `door` is the standing
 *  spot on the pavement in front of the doorway with `yaw` facing the street; `cell` the global
 *  grid cell; `face` the outward unit step from the cell centre to the street it fronts. */
export interface CityLot {
  id: string; kind: CityLotKind; archetype: string; name: string;
  door: { x: number; z: number; yaw: number };
  rect: AABB;
  cell: [gcx: number, gcz: number];
  face: [ox: number, oz: number];
  /** footprint side (the lot building is square and un-jittered so the door is pure maths) */
  size: number;
  /** a CIVIC lot (school, hospital, precinct, …): dealt from LOT_DECK on the home boulevard and
   *  recorded as a landmark a story can name. An ordinary door (Flat 12, Corner Shop) is not. */
  civic?: boolean;
}

/** The deck of CIVIC kinds, in the order the table deals them: a 6-lot street still has two
 *  houses, a bakery, a school, a hospital and a precinct; a 9-lot street adds an office, a hotel,
 *  a house. Every OTHER street door is an ordinary lot, typed by the building's look. */
const LOT_DECK: CityLotKind[] = ['house', 'shop', 'school', 'hospital', 'precinct', 'house', 'office', 'hotel', 'house'];

/** How many cells either side of the spawn plaza the lot TABLE lists (lotAt / lotForCell work
 *  anywhere — this only bounds what `lots()` enumerates for scripts, saves and tests). */
const LOT_TABLE_REACH = 11;

/** The sign over an ORDINARY door: what the building reads as from the street. Templates are
 *  tt() literals so the i18n check sees every one; `h` is the cell hash (stable per seed). */
function ordinaryLotName(kind: CityLotKind, city: CityKind, corner: boolean, h: number): string {
  const n = 1 + ((h >>> 20) % 48);
  const pick = (arr: (() => string)[]) => arr[((h >>> 4) & 255) % arr.length]();
  switch (kind) {
    case 'house':
      if (corner) return tt('Corner House');
      if (city === 'slums') return pick([() => tt('Shack {n}', { n }), () => tt('Flat {n}', { n })]);
      if (city === 'ruins') return pick([() => tt('Old House'), () => tt('Flat {n}', { n })]);
      return pick([() => tt('Flat {n}', { n }), () => tt('House {n}', { n }), () => tt('Home {n}', { n })]);
    case 'shop':
      if (corner) return tt('Corner Shop');
      if (city === 'neon') return pick([() => tt('Night Market'), () => tt('Noodle Bar'), () => tt('Arcade'), () => tt('Neon Cafe')]);
      if (city === 'slums') return pick([() => tt('Scrap Shop'), () => tt('Corner Store'), () => tt('Tin Cafe')]);
      return pick([() => tt('Bakery'), () => tt('Pizzeria'), () => tt('Cafe'), () => tt('Market'), () => tt('Toy Shop'), () => tt('Book Shop')]);
    case 'office':
      if (city === 'night' || city === 'neon') return pick([() => tt('Night Office'), () => tt('Tower Office'), () => tt('Data Office')]);
      return pick([() => tt('Office {n}', { n }), () => tt('Bank'), () => tt('Post Office')]);
    case 'hotel':
      if (city === 'ruins') return pick([() => tt('Haunted House'), () => tt('Dead Hotel'), () => tt('Ghost House')]);
      return tt('Hotel {n}', { n });
    default:
      return LOT_NAMES[kind]();
  }
}

export class CityLayout {
  readonly SPACING = SPACING; readonly G = G; readonly CHUNK = G * SPACING;
  readonly ROAD_EVERY = ROAD_EVERY; readonly BLV_EVERY = BLV_EVERY; readonly BLV = BLV; readonly DISTRICT = DISTRICT;
  private _lots: CityLot[] | null = null;
  private _civic: Map<number, CityLot> | null = null;
  /** per-cell lot memo (null = this cell has no door); bounded so an endless walk stays bounded */
  private readonly _cells = new Map<number, CityLot | null>();
  constructor(readonly seed: number, readonly kind: CityKind, private readonly prof: CityProfile = CITY_PROFILES[kind]) {}

  mod(n: number, m: number): number { return ((n % m) + m) % m; }

  /** Is this global cell INDEX (either axis) street rather than block? Every
   *  ROAD_EVERY-th index is an avenue; every BLV_EVERY-th avenue also owns the
   *  index just after it — that second carriageway is what makes a boulevard. */
  isLane(g: number): boolean {
    return this.mod(g, this.ROAD_EVERY) === 0 || this.mod(g, this.BLV) === 1;
  }

  isRoadCell(gcx: number, gcz: number): boolean {
    return this.isLane(gcx) || this.isLane(gcz);
  }

  /** For a BLOCK cell: the direction toward the street it fronts, (0,0) when the
   *  cell is buried inside the block. Reads the ACTUAL road pattern (not a fixed
   *  `% ROAD_EVERY === 1`), so kerb dressing stays correct beside a boulevard. */
  outward(gcx: number, gcz: number): [number, number] {
    if (this.isLane(gcx - 1)) return [-1, 0];
    if (this.isLane(gcx + 1)) return [1, 0];
    if (this.isLane(gcz - 1)) return [0, -1];
    if (this.isLane(gcz + 1)) return [0, 1];
    return [0, 0];
  }

  /** A real STREET CORNER: a block cell with road on an X side AND a Z side.
   *  ("meet me at the corner" has to mean one of a handful of places, not the
   *  four hundred kerbs an avenue-facing test returns.) */
  isCorner(gcx: number, gcz: number): boolean {
    return (this.isLane(gcx - 1) || this.isLane(gcx + 1)) && (this.isLane(gcz - 1) || this.isLane(gcz + 1));
  }

  /** nearest avenue world coord (road lines sit where globalCell % ROAD_EVERY === 0). */
  snapToAvenue(v: number): number {
    const cell = Math.round(v / this.SPACING);
    const lane = Math.round(cell / this.ROAD_EVERY) * this.ROAD_EVERY;
    return lane * this.SPACING;
  }

  // ---- DOWNTOWN: the one thing that stops an endless grid reading as noise ---
  // Building heights used to be rolled per cell, independently, forever: every
  // direction from every spawn held the same random comb of towers, so there was
  // never anything to walk TOWARD. Now height is a product of a global field —
  // cores on the boulevard lattice — so the city has a middle and an edge, the
  // skyline differs by compass direction, and the widest street points at it.

  /** The downtown seeded at boulevard crossing (ix,iz), or null when that
   *  crossing grew none (one in four stays low-rise, so the cores don't tile).
   *  It is centred on its PLAZA — the open block just off the crossing — so the
   *  tallest towers ring the square, and both boulevards run through the mass
   *  and past the monument rather than skirting the edge of it. */
  coreAt(ix: number, iz: number): { x: number; z: number; r: number; s: number } | null {
    const h = (hash2(ix * 7919 + 13, iz * 7919 - 29) ^ this.seed) >>> 0;
    if ((h & 3) === 0) return null;
    return {
      x: (ix * this.BLV + 3) * this.SPACING,   // = the plaza's centre cell
      z: (iz * this.BLV + 3) * this.SPACING,
      r: this.DISTRICT * (0.44 + ((h >>> 8) & 255) / 255 * 0.14),   // 198..261u: the outer edge
      s: 0.72 + ((h >>> 16) & 255) / 255 * 0.28,                    // not every downtown is as big
    };
  }

  /** 0 = low-rise outskirts, 1 = downtown. FLAT-TOPPED on purpose: the blocks
   *  that ring the crossing are all full height (a downtown is a plateau, not a
   *  spike), and the fall to low-rise happens over the outer half of the radius
   *  so you can watch the buildings come down as you walk out of it.
   *  Nine cheap distance tests per cell; nothing allocated, nothing per-frame. */
  districtAt(x: number, z: number): number {
    const D = this.DISTRICT, H = 3 * this.SPACING;   // cores sit on their plaza cell
    const bx = Math.round((x - H) / D), bz = Math.round((z - H) / D);
    let best = 0;
    for (let ix = bx - 1; ix <= bx + 1; ix++) {
      for (let iz = bz - 1; iz <= bz + 1; iz++) {
        const c = this.coreAt(ix, iz); if (!c) continue;
        const d = Math.hypot(x - c.x, z - c.z);
        if (d >= c.r) continue;
        const r0 = c.r * 0.5;                              // the plateau
        const t = d <= r0 ? 1 : (c.r - d) / (c.r - r0);
        const f = t * t * (3 - 2 * t) * c.s;               // smoothstep -> no ring seam
        if (f > best) best = f;
      }
    }
    return best;
  }

  /** The 3x3-cell PLAZA on the far corner of a downtown crossing: paved, open,
   *  90u across, a monument in the middle and the tallest towers in the world
   *  standing round it. Visible straight down both boulevards. */
  plazaAt(gcx: number, gcz: number): { centre: boolean } | null {
    const mx = this.mod(gcx, this.BLV), mz = this.mod(gcz, this.BLV);
    if (mx < 2 || mx > 4 || mz < 2 || mz > 4) return null;
    if (!this.coreAt(Math.floor(gcx / this.BLV), Math.floor(gcz / this.BLV))) return null;
    return { centre: mx === 3 && mz === 3 };
  }

  /** A whole BLOCK given over to a green square: trees round the rim, open lawn
   *  in the middle. Decided per BLOCK, never per cell — a per-cell roll produces
   *  lawn confetti nobody can see, a block produces a space you can cross. */
  isGreenBlock(bx: number, bz: number): boolean {
    const h = (hash2(bx * 2749 + 71, bz * 2749 - 37) ^ this.seed) >>> 0;
    const cx = (bx * this.ROAD_EVERY + 2.5) * this.SPACING;
    const cz = (bz * this.ROAD_EVERY + 2.5) * this.SPACING;
    // common out in the low-rise, rare downtown (land is expensive by the towers)
    return (h >>> 8) / 16777216 < 0.20 - 0.16 * this.districtAt(cx, cz);
  }

  /** Where the kid starts: the plaza of the nearest downtown, standing south of
   *  the monument so the default -Z view is monument, towers and boulevard —
   *  a place worth opening a story in instead of an anonymous crossroads. */
  playerStart(): { x: number; z: number } {
    const c = this.homeCore();
    return c ? { x: (c.ix * this.BLV + 3) * this.SPACING, z: (c.iz * this.BLV + 3) * this.SPACING + 26 } : { x: 0, z: 0 };
  }

  // ---- LOTS: the buildings you can walk into --------------------------------------------
  // EVERY street door is a door. A block cell that fronts a street is a LOT unless the city
  // left it vacant (a park / junk yard), and each lot is pure per-cell maths: a hash of the
  // cell and the seed picks its footprint, its kind (by the building's look — a small front
  // is a house, a storefront a shop, a downtown block an office, a ruin a haunted house) and
  // the name on its sign. Nothing is built until the player walks in, so an endless city of
  // doors costs exactly what an endless city of walls did. The CIVIC lots (school, hospital,
  // precinct, hotel, …) are dealt from LOT_DECK onto the home boulevard as before and stay
  // the landmarks a story names; the ordinary doors are not landmarks.

  /** The downtown the kid spawns in (the same pick as playerStart), or null when none grew. */
  homeCore(): { ix: number; iz: number } | null {
    let best: { ix: number; iz: number } | null = null, bd = Infinity;
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      if (!this.coreAt(ix, iz)) continue;
      const x = (ix * this.BLV + 3) * this.SPACING, z = (iz * this.BLV + 3) * this.SPACING;
      const d = x * x + z * z;
      if (d < bd) { bd = d; best = { ix, iz }; }
    }
    return best;
  }

  /** Footprint side of a civic lot building: inside the profile's span so it reads as one of the
   *  street, capped so the pavement in front of the door is always walkable (cell 30u, pad 28.2u). */
  lotSize(): number { return Math.min(24, Math.max(14, this.prof.bw + this.prof.bwSpan * 0.6)); }

  /** Is this block cell a STREET FRONTAGE a door can open onto: not a lane, not the plaza, not a
   *  green square, not the plate pillar's cell, and touching a street. Returns the face. */
  frontage(gcx: number, gcz: number): [number, number] | null {
    if (this.isLane(gcx) || this.isLane(gcz)) return null;
    if (this.plazaAt(gcx, gcz)) return null;
    if (this.isGreenBlock(Math.floor(gcx / this.ROAD_EVERY), Math.floor(gcz / this.ROAD_EVERY))) return null;
    if (this.mod(gcx, this.BLV) === 8 && this.mod(gcz, this.BLV) === 8) return null;   // plate pillar owns that cell
    const o = this.outward(gcx, gcz);
    return o[0] || o[1] ? o : null;
  }

  private makeLot(gcx: number, gcz: number, face: [number, number], size: number, along: number, kind: CityLotKind, id: string, name: string, civic: boolean): CityLot {
    const SP = this.SPACING, [ox, oz] = face;
    const px = gcx * SP, pz = gcz * SP, half = size / 2;
    const dx = ox !== 0 ? ox * (half + 2.6) : along, dz = oz !== 0 ? oz * (half + 2.6) : along;
    const lot: CityLot = {
      id, kind, archetype: LOT_ARCHETYPE[kind], name,
      door: { x: px + dx, z: pz + dz, yaw: Math.atan2(ox, oz) },
      rect: { minX: px - half, maxX: px + half, minZ: pz - half, maxZ: pz + half },
      cell: [gcx, gcz], face: [ox, oz], size,
    };
    if (civic) lot.civic = true;
    return lot;
  }

  /** The CIVIC table: 6–9 buildings on the block cells that front the home boulevard (the wide
   *  north–south street through the spawn plaza), picked nearest the plaza first from a seeded
   *  shuffle, each dealt a kind from LOT_DECK. Keyed by cell. */
  private civicLots(): Map<number, CityLot> {
    if (this._civic) return this._civic;
    const out = new Map<number, CityLot>();
    const core = this.homeCore();
    if (core) {
      const SP = this.SPACING, size = this.lotSize();
      const cx = core.ix * this.BLV, cz = core.iz * this.BLV;   // the boulevard's first carriageway cell line
      const plazaX = (cx + 3) * SP, plazaZ = (cz + 3) * SP;
      // frontage columns: east side (cell 2, faces the lane at 1 → outward -X) and west side (cell -1, outward +X)
      const cands: { gcx: number; gcz: number; d: number }[] = [];
      for (const gcx of [cx + 2, cx - 1]) {
        for (let k = -8; k <= 10; k++) {
          const gcz = cz + k;
          if (!this.frontage(gcx, gcz)) continue;
          const x = gcx * SP, z = gcz * SP;
          cands.push({ gcx, gcz, d: (x - plazaX) ** 2 + (z - plazaZ) ** 2 });
        }
      }
      cands.sort((a, b) => a.d - b.d || a.gcx - b.gcx || a.gcz - b.gcz);
      const rnd = mulberry32((hash2(0x1075, 0x5e4d) ^ this.seed) >>> 0);
      const n = Math.min(cands.length, 6 + ((rnd() * 4) | 0));   // 6..9
      // the nearest 12 frontages, shuffled, so the street reads differently per seed but the
      // lots stay within a block or two of the plaza
      const pool = cands.slice(0, Math.min(cands.length, Math.max(n, 12)));
      for (let i = pool.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      const counts: Partial<Record<CityLotKind, number>> = {};
      for (let i = 0; i < n; i++) {
        const c = pool[i], kind = LOT_DECK[i];
        const face = this.outward(c.gcx, c.gcz);
        // the door sits off-centre along the facade (never under the streetlight on the centre line)
        const along = (rnd() < 0.5 ? -1 : 1) * size * 0.3;
        const idx = (counts[kind] = (counts[kind] ?? 0) + 1);
        const base = LOT_NAMES[kind]();
        out.set(c.gcx * 100003 + c.gcz, this.makeLot(c.gcx, c.gcz, face, size, along, kind, `${kind}#${idx}`, idx > 1 ? `${base} ${idx}` : base, true));
      }
    }
    this._civic = out;
    return out;
  }

  /** What an ordinary street building READS AS, from its footprint, its district and the city's
   *  flavour: small fronts are homes, storefronts shops, downtown blocks offices; a slum is homes
   *  and corner stores, a ruin is haunted houses and old flats, a neon strip is bars and offices. */
  private lookKind(size: number, dens: number, r: number): CityLotKind {
    switch (this.kind) {
      case 'slums': return r < 0.62 ? 'house' : 'shop';
      case 'ruins': return r < 0.45 ? 'hotel' : 'house';
      case 'neon': return r < 0.55 ? 'shop' : 'office';
      default:
        if (dens > 0.5) return r < 0.62 ? 'office' : 'shop';
        if (size < 17.5) return r < 0.72 ? 'house' : 'shop';
        return r < 0.55 ? 'shop' : 'office';
    }
  }

  /** The ordinary lot on a frontage cell, or null when the city left the cell vacant. */
  private ordinaryLot(gcx: number, gcz: number): CityLot | null {
    const face = this.frontage(gcx, gcz);
    if (!face) return null;
    const SP = this.SPACING, px = gcx * SP, pz = gcz * SP;
    const dens = this.districtAt(px, pz);
    // the seed goes in well mixed: a plain `^ seed` left seeds 1 and 3 with the same street
    const h = (hash2(gcx * 31 + 5, gcz * 31 - 11) ^ hash2(this.seed, 0x10c5)) >>> 0;
    // the vacancy roll buildChunk used to make per chunk, now per cell so the door table and the
    // built street agree: a vacant frontage is a park (or a junk yard), not a building
    if ((h & 255) / 255 < this.prof.lotChance * (0.72 - 0.55 * dens)) return null;
    const u = ((h >>> 8) & 255) / 255, r = ((h >>> 16) & 255) / 255;
    const size = Math.min(24, Math.max(14, this.prof.bw + u * this.prof.bwSpan));
    const kind = this.lookKind(size, dens, r);
    const along = ((h >>> 24) & 1 ? 1 : -1) * size * 0.3;
    return this.makeLot(gcx, gcz, face, size, along, kind, `${kind}@${gcx},${gcz}`, ordinaryLotName(kind, this.kind, this.isCorner(gcx, gcz), h), false);
  }

  /** The lot whose building stands on this global cell — civic or ordinary — or null. O(1) after
   *  the first ask (memoised per cell); the chunk builder and lotAt read the street through this. */
  lotForCell(gcx: number, gcz: number): CityLot | null {
    const key = gcx * 100003 + gcz;
    const hit = this._cells.get(key);
    if (hit !== undefined) return hit;
    const lot = this.civicLots().get(key) ?? this.ordinaryLot(gcx, gcz);
    if (this._cells.size > 50000) this._cells.clear();   // an endless walk must not grow an endless memo
    this._cells.set(key, lot);
    return lot;
  }

  /** The LOT TABLE a script, a save or a test enumerates: the civic lots first (nearest the plaza
   *  first, as dealt), then every ordinary door within LOT_TABLE_REACH cells of the spawn plaza,
   *  nearest first. lotAt / lotForCell work beyond it — this is the named neighbourhood. */
  lots(): CityLot[] {
    if (this._lots) return this._lots;
    const out: CityLot[] = [...this.civicLots().values()];
    const core = this.homeCore();
    const cx = (core ? core.ix * this.BLV : 0) + 3, cz = (core ? core.iz * this.BLV : 0) + 3;
    const ord: { l: CityLot; d: number }[] = [];
    for (let gx = cx - LOT_TABLE_REACH; gx <= cx + LOT_TABLE_REACH; gx++) {
      for (let gz = cz - LOT_TABLE_REACH; gz <= cz + LOT_TABLE_REACH; gz++) {
        const l = this.lotForCell(gx, gz);
        if (l && !l.civic) ord.push({ l, d: (gx - cx) ** 2 + (gz - cz) ** 2 });
      }
    }
    ord.sort((a, b) => a.d - b.d || a.l.cell[0] - b.l.cell[0] || a.l.cell[1] - b.l.cell[1]);
    for (const o of ord) out.push(o.l);
    this._lots = out;
    return out;
  }

  /** The lot whose door is within `r` u of (x,z), nearest first. A door never leaves its own cell,
   *  so only the 3×3 cells round the point are asked — O(9) whatever the city's size. */
  lotAt(x: number, z: number, r = 2.4): CityLot | null {
    const SP = this.SPACING, gx = Math.round(x / SP), gz = Math.round(z / SP);
    let best: CityLot | null = null, bd = r * r;
    const reach = Math.ceil(r / SP);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const l = this.lotForCell(gx + dx, gz + dz);
        if (!l) continue;
        const d = (l.door.x - x) ** 2 + (l.door.z - z) ** 2;
        if (d < bd) { bd = d; best = l; }
      }
    }
    return best;
  }
  /** A lot by id: `kind#n` is civic (the dealt table), `kind@gcx,gcz` an ordinary door — decoded
   *  straight back to its cell, so a save inside "Flat 12" resumes without enumerating the city. */
  lotById(id: string): CityLot | undefined {
    const m = /^[a-z]+@(-?\d+),(-?\d+)$/.exec(id);
    if (m) { const l = this.lotForCell(+m[1], +m[2]); return l && l.id === id ? l : undefined; }
    for (const l of this.civicLots().values()) if (l.id === id) return l;
    return undefined;
  }
}

/** The lot table of a city, without building one: `cityLots(seed, 'day')`. */
export function cityLots(seed: number, kind: CityKind): CityLot[] { return new CityLayout(seed >>> 0, kind).lots(); }

export class CityWorld implements World {
  readonly colliders: AABB[] = [];
  readonly wallMeshes: THREE.Object3D[] = [];

  private readonly scene: THREE.Object3D; // a worldRoot Group (so it's disposable on swap)
  private readonly seed: number;
  private readonly theme: CityTheme;
  /** flavour discriminator + its layout knobs (see CityProfile). */
  private readonly kind: CityKind;
  private readonly prof: CityProfile;
  /** true for the industrial flavours — day/night NEVER enter a `fl` branch,
   *  which is what keeps the shipped city bit-for-bit as it was. */
  private readonly fl: boolean;
  /** SLUMS: the plate overhead is a real ceiling (camera + jump clamp to it). */
  readonly ceilingY?: number;

  // grid / streaming layout (avenues line up across chunks because every
  // SPACING-sized cell maps to a fixed global cell index)
  private readonly SPACING = SPACING;   // world size of one grid cell
  private readonly G = G;               // cells per chunk side
  private readonly CHUNK = G * SPACING;
  private VIEW = 3;                // chunk radius kept around the player (set per theme in ctor)
  private readonly ROAD_EVERY = ROAD_EVERY; // every Nth global cell line is a clear avenue
  /** Every BLV_EVERY-th avenue is a BOULEVARD: a SECOND carriageway in the cell
   *  line just after it, with a planted median down the seam. 60u of road
   *  instead of 30u, running dead straight through a downtown crossing — so the
   *  widest street in sight is always the one that leads somewhere. */
  private readonly BLV_EVERY = BLV_EVERY;
  /** cell period of the boulevard grid (and of the downtown lattice). */
  private readonly BLV = BLV;
  /** world period of the boulevard/downtown lattice (450u = 3 city blocks). */
  private readonly DISTRICT = DISTRICT;
  /** the pure grid maths + the lot table (see CityLayout) */
  private readonly L: CityLayout;

  private loaded = new Map<string, Chunk>();
  private lastPC: [number, number] | null = null;
  private buildQueue: Array<[number, number]> = []; // chunks waiting to be built (amortized)
  private queued = new Set<string>();

  // ground plane that re-centres on the player so the street never runs out
  private ground: THREE.Mesh;
  private roadTex: THREE.CanvasTexture;
  private GROUND_SIZE = 0;  // side length of the re-centring ground plane
  private WORLD_TILE = 0;   // world size of ONE road-texture tile (FINE: ~15u)
  private TEX_REPEAT = 0;   // how many tiles the plane spans (GROUND_SIZE / WORLD_TILE)

  // shared materials (reused by every chunk -> light)
  // A few clean facade SHADE VARIANTS give buildings subtle variety without
  // per-pixel noise. concreteMats[0] / glassMats[0] are the canonical
  // buildingMat / glassMat referenced elsewhere.
  private concreteMats: THREE.MeshStandardMaterial[] = []; // concrete/office (windowed) variants
  private glassMats: THREE.MeshStandardMaterial[] = [];    // glass tower variants
  private buildingMat: THREE.MeshStandardMaterial;     // concrete/office (windowed) — variant 0
  private glassMat: THREE.MeshStandardMaterial;        // glass towers — variant 0
  private brickMat: THREE.MeshStandardMaterial;        // rare matte block — ONE material…
  private brickColors: THREE.Color[] = [];             // …3 shades via instanceColor
  private roofPropMat: THREE.MeshStandardMaterial;     // AC units / antennas on rooftops
  private bandMat: THREE.MeshStandardMaterial;         // entrance bands at street level
  private sidewalkMat: THREE.MeshStandardMaterial;     // pavement / curb slabs (one shared mat -> one pipeline)
  private parkMat: THREE.MeshStandardMaterial;
  private trunkMat: THREE.MeshStandardMaterial;
  private foliageMat: THREE.MeshStandardMaterial;      // ONE canopy material…
  private foliageColors: THREE.Color[] = [];           // …the theme's 3 greens via instanceColor
  private bushMat: THREE.MeshStandardMaterial;         // ONE shrub material…
  private bushColor = new THREE.Color();               // …park shrub green
  private planterBushColor = new THREE.Color(0x4f9d3a);// …and the clipped planter green
  // street-life materials (streetlights, parked cars, crosswalks, benches, bins)
  private poleMat: THREE.MeshStandardMaterial;     // streetlight pole — dark metal
  private lampHeadMat: THREE.MeshStandardMaterial; // streetlight head — emissive (warm at night)
  private carMat: THREE.MeshStandardMaterial;      // parked cars — vertexColors × instanceColor paint
  private crosswalkMat: THREE.MeshStandardMaterial; // zebra stripes (slight glow at night)
  private benchMat: THREE.MeshStandardMaterial;
  private binMat: THREE.MeshStandardMaterial;
  /** parked-car paint palette, applied per instance via setColorAt. */
  private carColors: THREE.Color[];
  // NIGHT-ONLY (empty/null by day): emissive neon strip/sign materials (one
  // per palette color — NO PointLights) + the radial light-pool decal that
  // sits on the asphalt under each streetlight head.
  private neonMats: THREE.MeshStandardMaterial[] = [];
  private lampPoolMat: THREE.MeshBasicMaterial | null = null;
  private poolGeo: THREE.PlaneGeometry | null = null;
  // DAY-ONLY (empty/null at night — the night pass builds none of this):
  // warm facade palette + storefront/furniture dressing for the sunny town.
  private dayFacade: THREE.Color[] = [];          // plaster/brick paint per building (instanceColor)
  private awningMats: THREE.MeshStandardMaterial[] = []; // striped/solid canvas, one mat per tone (night-neon pattern)
  private dayPropMat: THREE.MeshStandardMaterial | null = null; // ONE white instanceColor'd mat: bands/doors/signs/planters/flowers
  private hydrantMat: THREE.MeshStandardMaterial | null = null;
  /** LOT DOORS (every flavour): ONE white instanceColor'd material for the doorway frame, the
   *  leaf, the step and the kind-coloured sign board — one InstancedMesh per chunk that has lots. */
  private lotMat: THREE.MeshStandardMaterial;
  private hydrantGeo: THREE.CylinderGeometry | null = null;
  private signColors: THREE.Color[] = [];
  private flowerColors: THREE.Color[] = [];
  private readonly dayShopGlass = new THREE.Color(0xbcd6e8); // display-window band
  private readonly dayDoor = new THREE.Color(0x7a4a32);      // storefront door slot
  private readonly dayPlanter = new THREE.Color(0xb5613f);   // terracotta planter box

  // ---- FLAVOUR-ONLY (all null/empty for day + night) -----------------------
  // Six materials cover EVERY new prop, so a slums/ruins/neon chunk costs the
  // same handful of extra draw calls the day town already pays for its
  // storefronts. Anything "glowing" is MeshBasic: unlit, no PointLight, and
  // outline.ts skips it (a black hull around a neon sign looks dead).
  private structMat: THREE.MeshStandardMaterial | null = null;  // plate pillars, girders, vending cabinets
  private scrapMat: THREE.MeshStandardMaterial | null = null;   // corrugated roofs / fences / leaning slabs
  private pileMat: THREE.MeshStandardMaterial | null = null;    // junk heaps + rubble mounds (instanceColor)
  private rigMat: THREE.MeshStandardMaterial | null = null;     // cables, washing, rebar (instanceColor)
  private glowMat: THREE.MeshBasicMaterial | null = null;       // fires, light strips, panels (instanceColor)
  private signMat: THREE.MeshBasicMaterial | null = null;       // NEON glyph boards (instanceColor)
  private decalMat: THREE.MeshBasicMaterial | null = null;      // ground light-pools / fire pools / scorch
  private puddleMat: THREE.MeshBasicMaterial | null = null;     // NEON rain puddles (additive)
  private pileGeo: THREE.BufferGeometry | null = null;          // junk heap (slums) / rubble mound (ruins)
  private drumGeo: THREE.CylinderGeometry | null = null;        // oil drum
  private junkColors: THREE.Color[] = [];
  private glowColors: THREE.Color[] = [];
  private readonly rustColor = new THREE.Color(0x6a4a32);       // rebar / cable / wire
  private readonly clothColors = [0xd8d2c4, 0x8fb3c9, 0xc98a7a, 0xd9c07a, 0x9db58a].map((c) => new THREE.Color(c));
  // SLUMS: the plate — a second re-centring plane, high overhead, with its own
  // (coarser) world-anchored tiling. One draw call for the whole ceiling.
  private plate: THREE.Mesh | null = null;
  private plateTex: THREE.CanvasTexture | null = null;
  private plateEmis: THREE.CanvasTexture | null = null;
  private PLATE_TILE = 0;
  private PLATE_REPEAT = 0;

  // shared geometries (NEVER disposed on unload)
  private boxGeo: THREE.BoxGeometry;
  private facadeGeos: THREE.BoxGeometry[] = []; // 3 UV-bucket geometries for height-bucketed buildings
  private parkGeo: THREE.PlaneGeometry;
  private trunkGeo: THREE.CylinderGeometry;
  private foliageGeo: THREE.ConeGeometry;
  private bushGeo: THREE.SphereGeometry;
  private carGeo: THREE.BufferGeometry;   // merged body+cabin+wheels (one mesh per chunk)
  private benchGeo: THREE.BufferGeometry; // merged seat+backrest+legs
  private binGeo: THREE.CylinderGeometry;
  private sharedGeo: Set<THREE.BufferGeometry>;

  // shared facade window / emissive textures (one entry per shade variant)
  private windowTex: THREE.CanvasTexture;              // canonical facade (variant 0)
  private emissiveTex: THREE.CanvasTexture | null;     // canonical night-lit mask (variant 0)
  private facadeTextures: THREE.CanvasTexture[] = [];
  private facadeEmissives: (THREE.CanvasTexture | null)[] = [];
  private onChunkBuilt?: (g: THREE.Group) => void;   // toon-outline hook (per streamed chunk)

  constructor(scene: THREE.Object3D, seed = 1, theme: CityTheme = CITY_THEMES.day, onChunkBuilt?: (g: THREE.Group) => void) {
    this.scene = scene;
    this.seed = seed >>> 0;
    this.theme = theme;
    this.kind = theme.name;
    const P = this.prof = CITY_PROFILES[theme.name];
    this.L = new CityLayout(this.seed, this.kind, P);
    this.lotMat = withCutout(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.05 }));
    this.fl = theme.name !== 'day' && theme.name !== 'night';
    if (theme.plateY) this.ceilingY = theme.plateY;
    this.onChunkBuilt = onChunkBuilt;
    // the city paints its own sky/fog — apply to the real Scene (scene may be a
    // worldRoot Group added under it, so walk up to find the actual THREE.Scene).
    const scn = ((scene as any).isScene ? scene : (scene.parent ?? scene)) as THREE.Scene;
    // Night fog is much denser, so a closer view ring is fully hidden -> stream
    // fewer chunks at night (49 -> 25) for a big draw-call + overdraw cut. Day
    // keeps VIEW=3 because its lighter fog would reveal a popping edge at VIEW=2.
    // (The flavours are all fog-heavy -> they ride at VIEW=2 too.)
    this.VIEW = P.view;

    // sky + fog tuned by theme
    scn.background = this.skyTexture(theme.sky);
    scn.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);

    // clean facade textures: ONE canonical facade variant (shade variety is now
    // achieved via per-instance color jitter instead of multiple textures/mats).
    // concreteMats[0] / glassMats[0] are the canonical materials used by all
    // height-bucket InstancedMeshes — arrays kept for forward-compat.
    const VARIANTS = 1;
    for (let v = 0; v < VARIANTS; v++) {
      const ft = this.facadeTexture(theme, v);
      this.facadeTextures.push(ft.map);
      this.facadeEmissives.push(ft.emissive);
    }
    this.windowTex = this.facadeTextures[0];
    this.emissiveTex = this.facadeEmissives[0];

    // shared materials — one concrete + one glass material PER facade variant,
    // so each chunk can pick a variant and still draw via per-chunk InstancedMesh.
    for (let v = 0; v < VARIANTS; v++) {
      const cm = new THREE.MeshStandardMaterial({
        map: this.facadeTextures[v],
        color: theme.concrete,
        roughness: P.facadeRough,
        metalness: P.facadeMetal, // night used to be 0.3 — metallic-dark facades read as voids
      });
      const em = this.facadeEmissives[v];
      if (em) {
        cm.emissiveMap = em;
        cm.emissive = new THREE.Color(theme.window);
        cm.emissiveIntensity = theme.windowEmissive;
      }
      this.concreteMats.push(cm);

      const gm = new THREE.MeshStandardMaterial({
        map: this.facadeTextures[v],
        color: theme.glass,
        roughness: P.glassRough,
        metalness: P.glassMetal, // less metal at night -> diffuse blue shows; day stays bright, not mirror-dark
      });
      if (em) {
        gm.emissiveMap = em;
        gm.emissive = new THREE.Color(theme.window);
        gm.emissiveIntensity = theme.windowEmissive * 0.8;
      }
      this.glassMats.push(gm);
    }
    this.buildingMat = this.concreteMats[0];
    this.glassMat = this.glassMats[0];
    // brick shade variants: day uses a warm brick-red/terracotta/ochre trio so
    // the rare matte towers join the town palette instead of being one flat
    // orange box; every OTHER theme (night + the flavours) spreads its own
    // theme.brick into three shades — night's blue-charcoal family unchanged.
    if (this.kind === 'day') {
      this.brickColors = [0xa84b38, 0xc96f4a, 0xd9a441].map((c) => new THREE.Color(c));
    } else {
      const brickBase = new THREE.Color(theme.brick);
      this.brickColors = [0, -0.05, 0.06].map((dl) => brickBase.clone().offsetHSL(0, 0, dl));
    }
    this.brickMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.8, metalness: 0.05,   // white: the shade rides instanceColor
      // the flavours' rare matte block keeps the facade map — an untextured
      // slab in a bombed street reads as the one building that wasn't hit
      ...(this.fl ? { map: this.facadeTextures[0] } : {}),
    });
    // rooftop props (AC units, antennas) + entrance bands — night values stay
    // in the blue-charcoal family (darker than facades, never a black void);
    // day values are warm stone so street level reads sunny, not grim. The
    // flavours put their structural steel up there instead (water tanks, vents).
    const structCol = new THREE.Color(theme.struct ?? 0x555555);
    this.roofPropMat = new THREE.MeshStandardMaterial({ color: this.fl ? structCol.clone() : new THREE.Color(theme.night ? 0x2a3040 : 0xa39d90), roughness: 0.9 });
    this.bandMat = new THREE.MeshStandardMaterial({ color: this.fl ? structCol.clone().multiplyScalar(0.62) : new THREE.Color(theme.night ? 0x161b29 : 0x9a9080), roughness: 0.85 });
    // Pavement / curb slab — one shared material (= one pipeline) for every
    // sidewalk in the city. Tinted from the theme's curb colour.
    this.sidewalkMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.curb), roughness: 0.95, metalness: 0.02,
    });
    this.parkMat = new THREE.MeshStandardMaterial({ color: theme.park, roughness: 0.95, metalness: 0 });
    // TOON OUTLINE tags (consumed by outline.ts qualifies):
    //  - buildings carry emissive window maps at night -> force the outline anyway
    //    (they're big structures, not glowing props).
    //  - flat pavement / crosswalks / park lawn -> no hull (a plane's hull is its
    //    rim -> ugly seam grid). The re-centring ground plane lives outside chunks.
    for (const m of [...this.concreteMats, ...this.glassMats, this.brickMat]) (m.userData = m.userData || {}).forceOutline = true;
    (this.sidewalkMat.userData = this.sidewalkMat.userData || {}).noOutline = true;
    (this.parkMat.userData = this.parkMat.userData || {}).noOutline = true;
    this.trunkMat = new THREE.MeshStandardMaterial({ color: theme.trunk, roughness: 0.95, metalness: 0 });
    this.foliageColors = theme.foliage.map((c) => new THREE.Color(c));
    this.foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    this.bushColor.setHex(theme.foliage[0]);
    this.bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });

    // ---- street-life materials (shared by every chunk -> few pipelines) ----
    // streetlight pole: dark metal; head: emissive box — off-white whisper by
    // day, warm sodium glow at night (NO real PointLights — emissive only).
    // The flavours re-dress the SAME fixtures: a slum bulb burns hotter and
    // oranger, a bombed lamp is dead glass on a bent pole, a neon strip lamp
    // is a cold white tube. No new meshes, just paint.
    const K = this.kind;
    this.poleMat = new THREE.MeshStandardMaterial({
      color: K === 'day' ? 0x3d5a46 : K === 'slums' ? 0x2f2721 : K === 'ruins' ? 0x534f4c : K === 'neon' ? 0x14141e : 0x191d28,
      roughness: K === 'slums' || K === 'ruins' ? 0.9 : 0.55, metalness: 0.6,
    }); // day: classic town-green posts
    this.lampHeadMat = new THREE.MeshStandardMaterial({
      color: K === 'day' ? 0xe9e6da : K === 'ruins' ? 0x2e2a24 : 0x23252b,
      emissive: K === 'day' ? 0xfff8e6 : K === 'slums' ? 0xffa24a : K === 'neon' ? 0xdff2ff : K === 'ruins' ? 0x000000 : 0xffd98f,
      emissiveIntensity: K === 'day' ? 0.05 : K === 'ruins' ? 0 : K === 'neon' ? 1.8 : 1.6, // reads as the light source above its pool — an accent now the street is lit by the rig, not a blown white dot
      roughness: 0.5, metalness: 0.3,
    });
    // parked cars: vertex colors paint the PARTS (white body so the instance
    // color shows through, glassy cabin, near-black wheel strip); per-instance
    // setColorAt multiplies the paint job on top. Night dims every body.
    // SLUMS/RUINS reuse the same body as WRECKS — rust and burnt shells.
    this.carMat = new THREE.MeshStandardMaterial({
      color: K === 'day' ? 0xffffff : K === 'neon' ? 0x8a90a4 : K === 'night' ? 0x767b86 : 0x6e6a64,
      vertexColors: true, roughness: K === 'day' || K === 'night' || K === 'neon' ? 0.5 : 0.95,
      metalness: K === 'day' || K === 'night' || K === 'neon' ? 0.35 : 0.15,
    });
    this.carColors = (K === 'day'
      ? [0xe0584a, 0x3f8fd2, 0xf2c14e, 0x58b368, 0xe886b4, 0x8a6fd1, 0xf4f6f8, 0xef8a3c] // day: cheerful comic paint jobs (coral/sky/sun/mint/pink/violet/white/tangerine)
      : K === 'slums'
        ? [0x8a6a4a, 0x6f5f52, 0x7a4a38, 0x5f6a5a, 0x8a7a5a, 0x6a5a4a, 0x7d6a58, 0x5a5450]  // slums: rusted-out, sun-bleached wrecks
        : K === 'ruins'
          ? [0x3a352f, 0x2e2a26, 0x4a423a, 0x33302b, 0x3f3830, 0x2a2724, 0x453d34, 0x38332d] // ruins: burnt husks, no paint left
          : K === 'neon'
            ? [0xff4d8d, 0x33e0ff, 0xffd23f, 0xffffff, 0x9a6dff, 0x2dff9a, 0xff6b3d, 0xc8d0e0] // neon: lacquered showcase paint under the signs
            : [0xb5443c, 0x3e62a8, 0x9aa1ab, 0xe8eaee, 0x4a5160, 0xd9b13b, 0x3f6e52, 0x7a4a96]) // night: UNCHANGED muted set (near-black read as a void in shadow)
      .map((c) => new THREE.Color(c));
    this.crosswalkMat = new THREE.MeshStandardMaterial({
      color: K === 'day' ? 0xe6e8ea : K === 'neon' ? 0xd8e6f0 : 0xb9bdc6, roughness: 0.9, metalness: 0,
      emissive: 0xffffff, emissiveIntensity: K === 'day' ? 0 : K === 'neon' ? 0.3 : 0.15, // faint night glow so crossings read
    });
    (this.crosswalkMat.userData = this.crosswalkMat.userData || {}).noOutline = true; // flat road decal -> no hull
    this.benchMat = new THREE.MeshStandardMaterial({ color: K === 'day' ? 0x7a5a3a : K === 'slums' ? 0x4a3a28 : 0x241c12, roughness: 0.9, metalness: 0.05 });
    this.binMat = new THREE.MeshStandardMaterial({ color: K === 'day' ? 0x3f6e52 : K === 'neon' ? 0x1e2030 : 0x1b202b, roughness: 0.8, metalness: 0.4 }); // day: park-green town bins

    // CAMERA SEE-THROUGH — every STANDING thing in the city joins the cutout, so a facade,
    // a street tree (the owner's park trees), a lamp post, a parked car or a bench between the
    // lens and the subject dissolves instead of hiding them. The flat road decals, the light
    // pools and the asphalt plane are tagged noCut below/where they're made: they lie ON the
    // ground, and dithering a depthWrite:false sheet only makes it flicker.
    for (const m of [
      ...this.concreteMats, ...this.glassMats, this.brickMat, this.roofPropMat, this.bandMat,
      this.trunkMat, this.foliageMat, this.bushMat, this.poleMat, this.lampHeadMat,
      this.carMat, this.benchMat, this.binMat,
    ]) withCutout(m);
    for (const m of [this.sidewalkMat, this.parkMat, this.crosswalkMat]) (m.userData = m.userData || {}).noCut = true;

    // shared geometries
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.parkGeo = new THREE.PlaneGeometry(1, 1);
    this.trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 1, 6);
    this.foliageGeo = new THREE.ConeGeometry(1, 1, 7);
    this.bushGeo = new THREE.SphereGeometry(1, 6, 5);
    this.sharedGeo = new Set([this.boxGeo, this.parkGeo, this.trunkGeo, this.foliageGeo, this.bushGeo]);

    // 3 façade UV buckets: V is pre-scaled so window ROWS stay world-sized on
    // short/mid/tall towers (one box stretched its 6 rows over 90 units).
    // Top/bottom face UVs are pinned to a tiny plain patch of the texture so
    // roofs stop showing windows — zero extra materials or draw types.
    // UV pin (0.04, 0.96): pixel (10, 10) — between the 2px border stroke and
    // mullX≈15px window start; confirmed plain base gradient. Using (0.04, 0.96).
    this.facadeGeos = [1, 2, 3].map((rep) => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        if (f === 2 || f === 3) uv.setXY(k, 0.04, 0.96);   // roof/underside: plain mullion-margin corner of the texture
        else uv.setXY(k, uv.getX(k), uv.getY(k) * rep);
      }
      uv.needsUpdate = true;
      this.sharedGeo.add(g);
      return g;
    });

    // ---- street-life geometries (shared, NEVER disposed) ----
    // Parked car: body + cabin + wheel strip merged into ONE BufferGeometry so
    // a whole chunk's cars stay a single InstancedMesh (1 draw call).
    const tintGeo = (g: THREE.BoxGeometry, r: number, gn: number, b: number): THREE.BoxGeometry => {
      const cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { col[i * 3] = r; col[i * 3 + 1] = gn; col[i * 3 + 2] = b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    };
    const carParts = [
      tintGeo(new THREE.BoxGeometry(1.9, 0.72, 4.5), 1, 1, 1).translate(0, 0.74, 0),            // body (takes the instance paint)
      tintGeo(new THREE.BoxGeometry(1.68, 0.56, 2.3), 0.5, 0.55, 0.62).translate(0, 1.3, -0.3), // glassy cabin
      tintGeo(new THREE.BoxGeometry(1.95, 0.4, 4.0), 0.07, 0.07, 0.08).translate(0, 0.22, 0),   // dark wheel strip
    ];
    this.carGeo = mergeGeometries(carParts) ?? carParts[0];
    for (const g of carParts) if (g !== this.carGeo) g.dispose();
    // park bench: seat + backrest + leg block merged -> one geometry
    const benchParts = [
      new THREE.BoxGeometry(2.6, 0.16, 0.62).translate(0, 0.5, 0),    // seat
      new THREE.BoxGeometry(2.6, 0.5, 0.09).translate(0, 0.86, -0.3), // backrest
      new THREE.BoxGeometry(2.3, 0.44, 0.5).translate(0, 0.22, 0),    // leg block
    ];
    this.benchGeo = mergeGeometries(benchParts) ?? benchParts[0];
    for (const g of benchParts) if (g !== this.benchGeo) g.dispose();
    this.binGeo = new THREE.CylinderGeometry(0.34, 0.3, 0.8, 8);
    this.binGeo.translate(0, 0.4, 0); // base at y=0 -> sits flush on the pad
    this.sharedGeo.add(this.carGeo); this.sharedGeo.add(this.benchGeo); this.sharedGeo.add(this.binGeo);

    // ---- NIGHT-ONLY neon + lamp light-pools (day builds none of this) ----
    if (this.kind === 'night') {
      // classic cyber palette (cyan / magenta / violet / yellow) — emissive-only
      // boxes, echoing landingScene's mBuilding neon strips. NO PointLights.
      for (const c of [0x22d3ee, 0xec4899, 0x8b5cf6, 0xfacc15])
        this.neonMats.push(withCutout(new THREE.MeshStandardMaterial({
          color: 0x10131c, emissive: c, emissiveIntensity: 1.6, roughness: 0.5, metalness: 0.1,
        })));
      // soft radial light-pool decal under each streetlight head — the same
      // radial-fade canvas trick as blockyKit's blob shadow, inverted to warm
      // light. One shared texture/material/geometry, instanced per chunk.
      const PS = 128;
      const pc = document.createElement('canvas'); pc.width = pc.height = PS;
      const pcx2 = pc.getContext('2d')!;
      const pg = pcx2.createRadialGradient(PS / 2, PS / 2, PS * 0.04, PS / 2, PS / 2, PS * 0.5);
      pg.addColorStop(0, 'rgba(255,206,130,0.42)');
      pg.addColorStop(0.55, 'rgba(255,176,96,0.16)');
      pg.addColorStop(1, 'rgba(255,176,96,0)');
      pcx2.fillStyle = pg; pcx2.fillRect(0, 0, PS, PS);
      this.lampPoolMat = new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(pc), transparent: true, depthWrite: false,
      });
      this.lampPoolMat.userData.noCut = true;   // a light pool painted on the road
      this.poolGeo = new THREE.PlaneGeometry(1, 1);
      this.poolGeo.rotateX(-Math.PI / 2); // lies flat -> instances need no per-instance rotation
      this.sharedGeo.add(this.poolGeo);
    }

    // ---- DAY-ONLY town dressing (night builds none of this) ----
    if (this.kind === 'day') {
      // warm plaster/brick facade family — picked PER BUILDING from a salted
      // per-cell hash in buildChunk and applied via instanceColor, so the one
      // shared concrete material/pipeline serves the whole painted town.
      // cream / warm white / terracotta / brick red / ochre / dusty blue /
      // sage / dusty pink.
      this.dayFacade = [0xe8dcc0, 0xf0ece0, 0xc96f4a, 0xa84b38, 0xd9a441, 0x7c98b8, 0x9ab48a, 0xc99a8a]
        .map((c) => new THREE.Color(c));
      // storefront awnings: canvas in 4 cheerful tones — striped red & blue,
      // solid green & amber. One material per tone, batched per chunk into an
      // InstancedMesh per tone that appears — EXACTLY the night-neon pattern.
      const AW: Array<[string, boolean]> = [['#d9534f', true], ['#3f8f5f', false], ['#4a7fc1', true], ['#e3b73f', false]];
      for (const [c, striped] of AW)
        this.awningMats.push(withCutout(new THREE.MeshStandardMaterial({ map: this.awningTexture(c, striped), roughness: 0.92, metalness: 0 })));
      // ONE white instanceColor'd material covers display bands, door slots,
      // sign boards, planter boxes AND park flowers -> a single extra pipeline
      // and a single extra draw call per chunk for all of them together.
      this.dayPropMat = withCutout(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.06 }));
      this.signColors = [0xe05a4e, 0x3f8f5f, 0x4a7fc1, 0xe3b73f, 0xf2ede0, 0x9a6ad8].map((c) => new THREE.Color(c));
      this.flowerColors = [0xe85d8a, 0xf2cf4a, 0xfdfdfb, 0xe8703a, 0x9a6ad8].map((c) => new THREE.Color(c));
      this.hydrantMat = withCutout(new THREE.MeshStandardMaterial({ color: 0xd23c2e, roughness: 0.55, metalness: 0.2 }));
      this.hydrantGeo = new THREE.CylinderGeometry(0.24, 0.3, 0.95, 8);
      this.hydrantGeo.translate(0, 0.475, 0); // base at y=0 -> sits flush on the pad
      this.sharedGeo.add(this.hydrantGeo);
    }

    // ---- FLAVOUR-ONLY kit (slums / ruins / neon; day+night build none of it) ----
    // SIX materials and TWO extra geometries carry every new prop. Everything
    // that glows is MeshBasic (unlit, no light, no outline hull); everything
    // solid is one shared MeshStandard with per-instance colour, so a whole
    // chunk's junk/cables/signs cost ONE draw call each.
    if (this.fl) {
      this.structMat = new THREE.MeshStandardMaterial({ color: theme.struct ?? 0x555555, roughness: 0.82, metalness: 0.45 });
      this.scrapMat = new THREE.MeshStandardMaterial({
        color: theme.scrap ?? 0x999999,
        // slums roofs ARE the wall sheeting -> reuse the corrugated facade map
        map: this.kind === 'slums' ? this.facadeTextures[0] : null,
        roughness: 0.94, metalness: this.kind === 'slums' ? 0.3 : 0.05,
      });
      this.pileMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0.08 });
      this.rigMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.25 });
      this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.junkColors = (theme.junk ?? [0x808080]).map((c) => new THREE.Color(c));
      this.glowColors = (theme.glow ?? [0xffffff]).map((c) => new THREE.Color(c));
      // flat ground decals (light pools, fire pools, scorch marks) — ONE mesh
      // per chunk, tinted per instance. Same trick as the night lamp pools.
      this.poolGeo = new THREE.PlaneGeometry(1, 1);
      this.poolGeo.rotateX(-Math.PI / 2); // lies flat -> no per-instance rotation
      this.sharedGeo.add(this.poolGeo);
      this.decalMat = new THREE.MeshBasicMaterial({ map: poolSprite(), transparent: true, depthWrite: false });
      // ONE debris geometry serves the slums' junk heaps AND the ruins' rubble
      // mounds (the instance colour and the scale do the rest): a HEAP, not a
      // crate — a wide sprawl of tipped boxes and sheets that steps down to
      // nothing at the edges, so it never reads as cargo. (A cone was tried
      // for the rubble and reads as a tent.) Baked AO gives it depth with no
      // texture, and instanceColor repaints it per pile.
      {
        const jp = [
          new THREE.BoxGeometry(2.2, 0.7, 1.8).rotateY(0.2).translate(0, 0.35, 0),
          new THREE.BoxGeometry(1.5, 0.55, 1.3).rotateY(0.9).rotateZ(0.16).translate(0.85, 0.85, 0.35),
          new THREE.BoxGeometry(1.7, 0.3, 1.4).rotateZ(0.45).rotateY(-0.4).translate(-0.75, 0.8, -0.25),
          new THREE.BoxGeometry(1.1, 0.45, 0.9).rotateY(1.3).translate(-0.2, 1.25, 0.5),
          new THREE.BoxGeometry(2.4, 0.14, 1.0).rotateY(-0.8).rotateX(0.2).translate(0.5, 0.22, -0.9),
        ];
        this.pileGeo = bakeBoxAO(mergeGeometries(jp) ?? jp[0], 0.68, 1.12);
        for (const g of jp) if (g !== this.pileGeo) g.dispose();
      }
      this.sharedGeo.add(this.pileGeo);
      if (this.kind === 'slums') {
        this.drumGeo = new THREE.CylinderGeometry(1.0, 1.05, 2.7, 8);
        this.drumGeo.translate(0, 1.35, 0);   // base at y=0 -> stands on the dirt
        this.sharedGeo.add(this.drumGeo);
      }
      if (this.kind === 'neon') {
        // every sign in the district is ONE material: a dark board carrying
        // white glyph marks that the per-instance colour turns into neon.
        this.signMat = new THREE.MeshBasicMaterial({ map: signGlyphTexture() });
        this.puddleMat = new THREE.MeshBasicMaterial({
          map: puddleSprite(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });
      }
      // decals are flat -> never hull them (a plane's hull is an ugly rim)
      for (const m of [this.decalMat, this.puddleMat]) if (m) (m.userData = m.userData || {}).noOutline = true;
      // shanties, rubble heaps, cable rigs, fires and signs all STAND — they join the cutout;
      // the two ground decals never do (they lie flat and don't write depth).
      for (const m of [this.structMat, this.scrapMat, this.pileMat, this.rigMat, this.glowMat, this.signMat]) if (m) withCutout(m);
      for (const m of [this.decalMat, this.puddleMat]) if (m) (m.userData = m.userData || {}).noCut = true;
    }

    // ---- SLUMS: the PLATE ----
    // A second re-centring plane far overhead, tiled at a COARSE world scale
    // and world-anchored exactly like the ground (snap + UV cancel), so the
    // sector is genuinely roofed for ONE draw call. Its caged service lamps
    // ride an emissive map, so the ceiling glows in patches with no lights.
    if (theme.plateY) {
      const pt = plateTexture();
      this.plateTex = pt.map; this.plateEmis = pt.emissive;
      const plateMat = new THREE.MeshStandardMaterial({
        map: pt.map, emissiveMap: pt.emissive, color: theme.plateColor ?? 0x2a2622,
        emissive: new THREE.Color(theme.plateLamp ?? 0xffb257), emissiveIntensity: 1.5,
        roughness: 0.95, metalness: 0.5, side: THREE.FrontSide,
      });
      (plateMat.userData = plateMat.userData || {}).noOutline = true;
      withCutout(plateMat);   // the slums' overhead plate IS a ceiling — it hides the shot like any roof
      const PSIZE = Math.ceil((2 * this.VIEW * this.CHUNK + 60) / 60) * 60;
      this.PLATE_REPEAT = Math.max(1, Math.round(PSIZE / 60));
      this.PLATE_TILE = PSIZE / this.PLATE_REPEAT;   // exact -> seamless wrap
      pt.map.repeat.set(this.PLATE_REPEAT, this.PLATE_REPEAT);
      pt.emissive.repeat.set(this.PLATE_REPEAT, this.PLATE_REPEAT);
      this.plate = new THREE.Mesh(new THREE.PlaneGeometry(PSIZE, PSIZE), plateMat);
      this.plate.rotation.x = Math.PI / 2;  // faces DOWN at the player
      this.plate.position.y = theme.plateY;
      this.plate.castShadow = this.plate.receiveShadow = false;
      this.positionPlate(0, 0);
      scene.add(this.plate);
    }

    // one big road-textured ground tile that re-centres on the player.
    // The asphalt texture now tiles at a FINE scale (one tile ~= 15 world
    // units) so the ground reads as normal crisp asphalt instead of one giant
    // stretched block. We repeat the tile many times across the plane and slide
    // its UV offset to compensate for the plane's world position -> the painted
    // asphalt stays WORLD-ANCHORED (does not swim) as the ground follows you.
    this.roadTex = this.roadTexture(theme);
    // FINE tile size: ~15 world units per asphalt tile (crisp, not giant).
    this.WORLD_TILE = 15;
    // Make the plane span a WHOLE number of road tiles so the texture wraps
    // seamlessly and snapping the plane by one tile is invisible.
    const TILES = Math.ceil((2 * this.VIEW * this.CHUNK + 60) / this.WORLD_TILE); // tight margin: the fog wall hides the edge, so don't pay for huge off-screen ground
    const GROUND_SIZE = TILES * this.WORLD_TILE;
    this.GROUND_SIZE = GROUND_SIZE;
    this.TEX_REPEAT = Math.round(GROUND_SIZE / this.WORLD_TILE); // integer tile count
    this.roadTex.repeat.set(this.TEX_REPEAT, this.TEX_REPEAT);
    const groundMat = new THREE.MeshStandardMaterial({
      map: this.roadTex, color: theme.asphalt, roughness: P.groundRough, metalness: P.groundMetal,
    });
    groundMat.userData.noCut = true;   // the street is the floor — cutting it opens a hole into the fog
    // (no ground emissive — keep the asphalt matte; the lit windows give the night glow)
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true; // building shadows fall on the street (cheap on WebGL)
    this.positionGround(0, 0);
    scene.add(this.ground);
  }

  /**
   * Re-centre the ground plane on the player WITHOUT letting the painted road
   * swim. Two cooperating tricks keep the asphalt + lane markings WORLD-ANCHORED:
   *
   *  1) SNAP the plane's world position to a whole multiple of WORLD_TILE
   *     (= the road texture's world tile size). Because the texture wraps every
   *     WORLD_TILE, a plane that only ever sits on tile boundaries shows the
   *     exact same painted streets in the exact same world spots every frame.
   *
   *  2) Set the texture map.offset each frame so the UV at any world point
   *     resolves to that point's fixed world tile coordinate. The plane is a
   *     PlaneGeometry rotated -90° about X, so its local +Y maps to world -Z;
   *     hence the V offset uses +planeZ (sign flip), while U uses -planeX.
   *     The constant +0.5*repeat just keeps offsets near zero (cosmetic).
   *
   * With the plane snapped to tile boundaries, the fractional part of the
   * offset is always 0 — so even if a renderer rounded UVs the road would not
   * shift. The two mechanisms together make the painted lines stay put in the
   * world while the player walks over them.
   */
  private positionGround(px: number, pz: number): void {
    const tile = this.WORLD_TILE;
    // 1) snap plane centre to a whole-tile multiple of the player position
    const gx = Math.round(px / tile) * tile;
    const gz = Math.round(pz / tile) * tile;
    this.ground.position.set(gx, 0, gz);

    // 2) cancel the plane's world offset in the texture UV so the painted
    //    streets resolve to fixed world tile coordinates (world-anchored).
    const halfR = this.TEX_REPEAT / 2;
    this.roadTex.offset.set(
      gx / tile - halfR,    // U axis runs WITH world +X  -> cancel with -gx
      -gz / tile + halfR,   // V axis runs OPPOSITE world +Z (plane rotated -90° X) -> cancel with +gz
    );
  }

  /** SLUMS plate: the ceiling follows the player using the SAME snap + UV-cancel
   *  pair as positionGround, on its own coarser tile grid. The plate is rotated
   *  +90° about X (it faces DOWN), which flips the V axis relative to the
   *  ground plane — hence the sign flip on the V term. */
  private positionPlate(px: number, pz: number): void {
    if (!this.plate || !this.plateTex) return;
    const tile = this.PLATE_TILE;
    const gx = Math.round(px / tile) * tile;
    const gz = Math.round(pz / tile) * tile;
    this.plate.position.x = gx; this.plate.position.z = gz;
    const halfR = this.PLATE_REPEAT / 2;
    const u = gx / tile - halfR, v = gz / tile - halfR;
    this.plateTex.offset.set(u, v);
    this.plateEmis?.offset.set(u, v);
  }

  // -------------------------------------------------------------------------
  // World interface
  // -------------------------------------------------------------------------

  /** FLAT city — ground height is constant. */
  heightAt(_x: number, _z: number): number { return 0; }

  /** AABB collision against currently-loaded chunk colliders (no world bounds). */
  blocked(x: number, z: number, r = 1.4): boolean {
    for (const c of this.colliders)
      if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
    return false;
  }

  /** Player-relative ring spawn snapped so enemies land on a clear ROAD lane. */
  spawnRing(cx: number, cz: number): { x: number; z: number } {
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2, d = 46 + Math.random() * 46;
      let x = cx + Math.cos(a) * d;
      let z = cz + Math.sin(a) * d;
      // snap one axis onto an avenue lane -> enemy stands on a clear road
      if (Math.random() < 0.5) x = this.snapToAvenue(x); else z = this.snapToAvenue(z);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > 40 * 40 && !this.blocked(x, z)) return { x, z };
    }
    const a = Math.random() * Math.PI * 2;
    return { x: cx + Math.cos(a) * 55, z: cz + Math.sin(a) * 55 };
  }

  /** Notable spots within `radius` of (cx,cz): park centres, lamp posts and
   *  street corners, read from the already-loaded chunks' recorded lists (built
   *  from the deterministic chunk plan — no new randoms). Capped at 24,
   *  nearest-first so the caller scans from closest out. */
  landmarks(cx: number, cz: number, radius: number): { x: number; z: number; kind: string; name?: string }[] {
    const r2 = radius * radius;
    const out: { x: number; z: number; kind: string; name?: string; d: number }[] = [];
    for (const ch of this.loaded.values()) {
      for (const m of ch.landmarks) {
        const dx = m.x - cx, dz = m.z - cz, d = dx * dx + dz * dz;
        if (d <= r2) out.push({ x: m.x, z: m.z, kind: m.kind, name: m.name, d });
      }
    }
    out.sort((a, b) => a.d - b.d);
    if (out.length > 24) out.length = 24;
    return out.map((m) => (m.name ? { x: m.x, z: m.z, kind: m.kind, name: m.name } : { x: m.x, z: m.z, kind: m.kind }));
  }

  /** Stream chunks around a world position + keep the ground tile centred.
   *  AMORTIZED: a crossing enqueues the new ring (nearest-first) and only a couple
   *  of chunks are built per frame, so a new grid never stalls. immediate=true
   *  builds the whole ring at once (initial load / teleport). */
  streamAround(px: number, pz: number, immediate = false): boolean {
    // keep the one big road plane under the player so the street never runs out,
    // snapped to whole road-tile increments + UV-cancelled so the painted
    // streets stay WORLD-ANCHORED (they do NOT swim/follow the camera).
    this.positionGround(px, pz);
    this.positionPlate(px, pz);   // SLUMS: the ceiling rides along the same way

    const pcx = Math.floor(px / this.CHUNK), pcz = Math.floor(pz / this.CHUNK);
    if (!this.lastPC || this.lastPC[0] !== pcx || this.lastPC[1] !== pcz) {
      this.lastPC = [pcx, pcz];
      const want: Array<[number, number]> = [];
      for (let dz = -this.VIEW; dz <= this.VIEW; dz++)
        for (let dx = -this.VIEW; dx <= this.VIEW; dx++) {
          const cx = pcx + dx, cz = pcz + dz, key = cx + ',' + cz;
          if (!this.loaded.has(key) && !this.queued.has(key)) want.push([cx, cz]);
        }
      want.sort((a, b) => (Math.abs(a[0] - pcx) + Math.abs(a[1] - pcz)) - (Math.abs(b[0] - pcx) + Math.abs(b[1] - pcz)));
      for (const c of want) { this.queued.add(c[0] + ',' + c[1]); this.buildQueue.push(c); }
      for (const key of [...this.loaded.keys()]) {
        const p = key.split(','), kx = +p[0], kz = +p[1];
        if (Math.abs(kx - pcx) > this.VIEW || Math.abs(kz - pcz) > this.VIEW) this.unloadChunk(key);
      }
      if (this.buildQueue.length) this.buildQueue = this.buildQueue.filter(([cx, cz]) => {
        const ok = Math.abs(cx - pcx) <= this.VIEW && Math.abs(cz - pcz) <= this.VIEW;
        if (!ok) this.queued.delete(cx + ',' + cz);
        return ok;
      });
    }
    const budget = immediate ? this.buildQueue.length : 1;
    let built = 0;
    for (let i = 0; i < budget && this.buildQueue.length; i++) {
      const [cx, cz] = this.buildQueue.shift()!;
      this.queued.delete(cx + ',' + cz);
      this.buildChunk(cx, cz); built++;
    }
    if (built) this.refreshColliders();
    return built > 0;
  }

  get liveChunks(): number { return this.loaded.size; }

  // -------------------------------------------------------------------------
  // grid helpers (global, shared by all chunks so seams line up) — the maths lives
  // in CityLayout (pure, seed-only) so the LOT TABLE and the tests can ask the same
  // questions without a scene or a canvas; these stay as one-line delegates so the
  // chunk builder reads exactly as it did.
  // -------------------------------------------------------------------------

  private mod(n: number, m: number): number { return this.L.mod(n, m); }
  private isLane(g: number): boolean { return this.L.isLane(g); }
  private isRoadCell(gcx: number, gcz: number): boolean { return this.L.isRoadCell(gcx, gcz); }
  private outward(gcx: number, gcz: number): [number, number] { return this.L.outward(gcx, gcz); }
  private isCorner(gcx: number, gcz: number): boolean { return this.L.isCorner(gcx, gcz); }
  private snapToAvenue(v: number): number { return this.L.snapToAvenue(v); }
  private coreAt(ix: number, iz: number): { x: number; z: number; r: number; s: number } | null { return this.L.coreAt(ix, iz); }
  private districtAt(x: number, z: number): number { return this.L.districtAt(x, z); }
  private plazaAt(gcx: number, gcz: number): { centre: boolean } | null { return this.L.plazaAt(gcx, gcz); }
  private isGreenBlock(bx: number, bz: number): boolean { return this.L.isGreenBlock(bx, bz); }

  /** Where the kid starts: the plaza of the nearest downtown (see CityLayout.playerStart). */
  playerStart(): { x: number; z: number } { return this.L.playerStart(); }

  /** The ENTERABLE LOTS of this city — every street door round the spawn plaza (the civic ones
   *  first; see CityLayout.lots / cityLots — lotAt answers for doors beyond the table too). `door` is where a body STANDS
   *  to go in (on the pavement, in front of the doorway) and `yaw` faces the STREET — what
   *  you look at when you walk back out. Pure per seed: identical before and after any chunk
   *  builds, identical on every client. */
  lots(): CityLot[] { return this.L.lots(); }

  /** The lot whose door is within `r` u of (x,z), nearest first — the walk-in trigger. */
  lotAt(x: number, z: number, r = 2.4): CityLot | null { return this.L.lotAt(x, z, r); }

  // -------------------------------------------------------------------------
  // procedural textures
  // -------------------------------------------------------------------------

  private skyTexture(stops: [string, string, string, string]): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = 16; c.height = 256;
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, stops[0]);
    g.addColorStop(0.45, stops[1]);
    g.addColorStop(0.78, stops[2]);
    g.addColorStop(1.0, stops[3]);
    x.fillStyle = g; x.fillRect(0, 0, 16, 256);
    return new THREE.CanvasTexture(c);
  }

  /**
   * CLEAN procedural building facade (+ matching emissive mask for night).
   *
   * A calm concrete/glass base with a neat, evenly-spaced grid of LARGE windows
   * separated by clear mullions/gaps — no per-pixel noise. `variant` (0..n)
   * shifts the base shade and the lit-window pattern slightly so neighbouring
   * buildings differ without the texture looking busy. The grid is a whole
   * number of cells across/down so it tiles seamlessly with RepeatWrapping.
   *
   *  - day  : bright clean facade, soft glass glint, NO emissive map.
   *  - night: dark facade, a tidy scatter of lit windows, emissive map glows.
   */
  private facadeTexture(theme: CityTheme, variant: number): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture | null } {
    // the flavours paint their OWN walls (corrugated iron / blast-cracked
    // concrete / a wall of lit windows) — see cityFlavours.ts.
    if (theme.name === 'slums') return slumFacadeTexture();
    if (theme.name === 'ruins') return ruinFacadeTexture();
    if (theme.name === 'neon') return neonFacadeTexture();
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d')!;
    const n = theme.night;

    // deterministic per-variant pseudo-random so the layout is calm & repeatable
    const rnd = mulberry32(((variant + 1) * 0x9e3779b1) >>> 0);

    // window grid: few, large windows in neat rows/columns (tiles seamlessly)
    const COLS = 5, ROWS = 6;
    const cellW = S / COLS, cellH = S / ROWS;
    const mullX = Math.round(cellW * 0.30);   // gap (mullion) left/right of each window
    const mullY = Math.round(cellH * 0.28);   // gap (spandrel) above/below each window
    const winW = Math.round(cellW - mullX * 2);
    const winH = Math.round(cellH - mullY * 2);

    // 1) calm base — a gentle vertical gradient, shade nudged per variant.
    // NIGHT base is a mid blue-grey: it MULTIPLIES theme.concrete/glass to an
    // effective deep blue-charcoal (~0x232a3c top / ~0x161e2e at street) so
    // night facades separate from sky + asphalt instead of going pitch black.
    // DAY base is warm near-white plaster: it multiplies the near-white
    // theme.concrete and the per-building dayFacade instanceColor, so the
    // painted town palette reads TRUE instead of being muddied by grey.
    const shade = (n ? -8 : -10) + variant * (n ? 6 : 9);
    const baseTop = shadeHex(n ? '#525c70' : '#f2ecdd', shade + (n ? 6 : 8));
    const baseBot = shadeHex(n ? '#3e4757' : '#e3dac5', shade);
    const grad = x.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, baseTop);
    grad.addColorStop(1, baseBot);
    x.fillStyle = grad; x.fillRect(0, 0, S, S);

    // 2) structural frame — thin mullion lines so the grid reads architecturally
    // (day mullions are a darker WARM tone so window grids read in daylight)
    x.strokeStyle = n ? 'rgba(0,0,0,0.55)' : 'rgba(92,78,58,0.55)';
    x.lineWidth = 2;
    for (let r = 0; r <= ROWS; r++) { const yy = Math.round(r * cellH); x.beginPath(); x.moveTo(0, yy + 0.5); x.lineTo(S, yy + 0.5); x.stroke(); }
    for (let cc = 0; cc <= COLS; cc++) { const xx = Math.round(cc * cellW); x.beginPath(); x.moveTo(xx + 0.5, 0); x.lineTo(xx + 0.5, S); x.stroke(); }

    // night emissive mask (lit windows only)
    let ex: CanvasRenderingContext2D | null = null;
    let ec: HTMLCanvasElement | null = null;
    if (n) {
      ec = document.createElement('canvas'); ec.width = ec.height = S;
      ex = ec.getContext('2d')!;
      ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);
    }

    // 3) the windows themselves — large, evenly spaced, with a clean glass fill
    for (let r = 0; r < ROWS; r++) {
      for (let cc = 0; cc < COLS; cc++) {
        const wx = Math.round(cc * cellW + mullX);
        const wy = Math.round(r * cellH + mullY);
        if (n) {
          // dark glass pane first — a step darker than the facade base, but
          // still in the blue family so unlit windows read as glass, not holes
          x.fillStyle = shadeHex('#2a3140', shade);
          x.fillRect(wx, wy, winW, winH);
          // a tidy ~45% of windows lit, warm-dominant with a rare cool pane
          if (rnd() > 0.55) {
            const t = rnd();
            const col = t > 0.85 ? '#cfe0ff' : (t > 0.5 ? '#ffd98f' : '#f0bf6e');
            x.fillStyle = col; x.fillRect(wx, wy, winW, winH);
            if (ex) {
              ex.fillStyle = 'rgba(255,205,135,0.28)'; ex.fillRect(wx - 3, wy - 3, winW + 6, winH + 6); // soft halo
              ex.fillStyle = col; ex.fillRect(wx, wy, winW, winH);                                       // bright core
            }
          }
        } else {
          // day: light SKY-TINTED glass (0xbcd6e8 family) — noticeably bluer
          // than the warm plaster base so panes survive the warm-palette
          // multiply and the window grid reads clearly in daylight.
          const t = rnd();
          const glass = t < 0.6 ? '#b9d8ee' : (t < 0.85 ? '#a6c8e2' : '#cbe4f6');
          x.fillStyle = glass; x.fillRect(wx, wy, winW, winH);
          // soft diagonal sky reflection across the top of each pane (calm, not noisy)
          const gg = x.createLinearGradient(wx, wy, wx + winW, wy + winH);
          gg.addColorStop(0, 'rgba(255,255,255,0.32)');
          gg.addColorStop(0.4, 'rgba(255,255,255,0.05)');
          gg.addColorStop(1, 'rgba(255,255,255,0.0)');
          x.fillStyle = gg; x.fillRect(wx, wy, winW, winH);
          // thin warm sill shadow under each window for depth
          x.fillStyle = 'rgba(86,70,52,0.35)'; x.fillRect(wx, wy + winH - 2, winW, 2);
        }
      }
    }

    const map = new THREE.CanvasTexture(c);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 4;
    map.needsUpdate = true;
    let emissive: THREE.CanvasTexture | null = null;
    if (ec) {
      emissive = new THREE.CanvasTexture(ec);
      emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
      emissive.needsUpdate = true;
    }
    return { map, emissive };
  }

  /**
   * Procedural FINE-SCALE asphalt tile (one tile ~= WORLD_TILE = 15 world
   * units). Because the tile now repeats every ~15u rather than once per
   * ~150u block, it is painted as PLAIN clean dark asphalt with subtle fine
   * grain only — NO avenue lane lines (those would now repeat every ~15u and
   * look like a checkerboard). Tiled seamlessly with RepeatWrapping; the
   * colour is further tinted per-theme via material.color (theme.asphalt).
   */
  private roadTexture(theme: CityTheme): THREE.CanvasTexture {
    // the flavours pave their streets differently: trodden dirt, blasted
    // asphalt under dust, or rain-slick tarmac smeared with sign light.
    if (theme.name === 'slums') return slumGroundTexture();
    if (theme.name === 'ruins') return ruinGroundTexture();
    if (theme.name === 'neon') return neonGroundTexture();
    // Clean, uniform dark ASPHALT with fine grain. No lane lines, no bright
    // "block" interiors, no glow, no checkerboard — at the fine tile scale the
    // texture must read as plain crisp asphalt at every repeat.
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d')!;
    const n = theme.night;

    // uniform asphalt base
    x.fillStyle = theme.roadBase; x.fillRect(0, 0, S, S);

    // subtle fine grain so it isn't perfectly flat (low contrast, dense speckle)
    // night speckle tracks the lifted #2c3140 base (dark pits would read as
    // noise); day speckle tracks the lighter sun-bleached #494c52 base.
    for (let i = 0; i < 1400; i++) {
      const g = (n ? 20 : 58) + Math.random() * (n ? 14 : 24);
      x.fillStyle = `rgba(${g},${g},${g + 2},${0.05 + Math.random() * 0.09})`;
      const s = 1 + (Math.random() < 0.3 ? 1 : 0);
      x.fillRect(Math.random() * S, Math.random() * S, s, s);
    }

    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4; // crisp road at grazing angle (cheap on WebGL)
    t.needsUpdate = true;
    return t;
  }

  /**
   * DAY-ONLY storefront awning canvas: a cheerful colour, either with warm
   * white stripes (classic comic canvas) or solid, plus a darker valance line
   * along the bottom edge so the fabric reads. One tiny texture per tone,
   * shared by every awning of that tone in the city.
   */
  private awningTexture(color: string, striped: boolean): THREE.CanvasTexture {
    const S = 64;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d')!;
    x.fillStyle = color; x.fillRect(0, 0, S, S);
    if (striped) {
      x.fillStyle = '#f6f1e4';
      for (let i = 0; i < S; i += 16) x.fillRect(i + 8, 0, 8, S);
    }
    x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, S - 6, S, 6); // valance shade line
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }

  // -------------------------------------------------------------------------
  // FLAVOUR placement (slums / ruins / neon) — called from the cell loop below.
  //
  // Every helper takes the caller's `dummy` Object3D and appends CLONED
  // matrices to the per-material lists, so a whole chunk of new props still
  // collapses into one InstancedMesh per material. They draw ONLY from the
  // salted per-cell stream `xr` — never the chunk rnd — which is what keeps the
  // shipped day/night city bit-for-bit identical.
  // -------------------------------------------------------------------------

  /** Dressing for one AVENUE cell: what the flavour leaves lying in the road.
   *  `alongZ` is true when the avenue runs north-south through this cell. */
  private roadCellFlavour(
    px: number, pz: number, alongZ: boolean, xr: () => number, d: THREE.Object3D,
    o: {
      rigT: { m: THREE.Matrix4; c: THREE.Color }[];
      glowT: { m: THREE.Matrix4; c: THREE.Color }[];
      puddleT: { x: number; z: number; s: number; c: THREE.Color }[];
      pileT: { m: THREE.Matrix4; c: THREE.Color }[];
      decalT: { x: number; z: number; s: number; c: THREE.Color }[];
      drumSpots: { x: number; z: number }[];
    },
  ): void {
    const SP = this.SPACING;
    const glow = (i: number) => this.glowColors[i % this.glowColors.length];
    if (this.kind === 'slums') {
      // CABLES: the sector's power, strung across the street from roof to roof.
      // Two segments meeting in a shallow sag read as a hanging line for the
      // price of two boxes; a couple of these per street is all it takes to
      // make every view feel roofed-in and improvised.
      const nC = xr() < 0.6 ? 1 + ((xr() * 2) | 0) : 0;
      for (let i = 0; i < nC; i++) {
        const y = 13 + xr() * 7, sag = 0.9 + xr() * 1.4, half = SP * 0.8;
        for (const s of [-1, 1]) {
          const tilt = s * Math.atan2(sag, half);
          d.position.set(
            px + (alongZ ? s * half * 0.5 : 0),
            y - sag * 0.5,
            pz + (alongZ ? 0 : s * half * 0.5),
          );
          d.rotation.set(alongZ ? 0 : tilt, 0, alongZ ? -tilt : 0);
          d.scale.set(alongZ ? half : 0.16, 0.16, alongZ ? 0.16 : half);
          d.updateMatrix();
          o.rigT.push({ m: d.matrix.clone(), c: this.rustColor });
        }
      }
      // a barrel fire out on the road edge — the only warm light down here
      if (xr() < 0.15) {
        const bx = px + (xr() - 0.5) * 14, bz = pz + (xr() - 0.5) * 14;
        o.drumSpots.push({ x: bx, z: bz });
        d.rotation.set(0, xr() * 3, 0);
        d.position.set(bx, 3.4, bz); d.scale.set(1.9, 2.6, 1.9); d.updateMatrix();
        o.glowT.push({ m: d.matrix.clone(), c: glow(0) });
        o.decalT.push({ x: bx, z: bz, s: 17, c: glow(1) });
      }
      // junk that never got cleared, shoved against the kerb. Nobody sweeps
      // down here, so the road itself has to carry clutter — an empty street
      // in a slum reads as a car park.
      const nJ = 1 + ((xr() * 2) | 0);
      for (let i = 0; i < nJ; i++) {
        const jxp = px + (xr() - 0.5) * 24, jzp = pz + (xr() - 0.5) * 24, s = 0.9 + xr() * 0.9;
        d.position.set(jxp, 0.02, jzp); d.rotation.set(0, xr() * 6, 0);
        d.scale.set(s * (1.2 + xr()), s, s * (1.2 + xr()));
        d.updateMatrix();
        o.pileT.push({ m: d.matrix.clone(), c: this.junkColors[(xr() * this.junkColors.length) | 0] });
      }
    } else if (this.kind === 'ruins') {
      // blast debris thrown clear of the buildings + the odd scorch
      const nD = (xr() * 3) | 0;
      for (let i = 0; i < nD; i++) {
        // knee-to-waist against the 5.4u hero: debris you step over, not
        // boulders the size of the building it fell off
        const rx = px + (xr() - 0.5) * 22, rz = pz + (xr() - 0.5) * 22, s = 0.9 + xr() * 1.2;
        d.position.set(rx, 0.02, rz); d.rotation.set(0, xr() * 6, 0); d.scale.set(s * (1.4 + xr()), s * 1.1, s * (1.4 + xr()));
        d.updateMatrix();
        o.pileT.push({ m: d.matrix.clone(), c: this.junkColors[(xr() * this.junkColors.length) | 0] });
      }
      if (xr() < 0.3) o.decalT.push({ x: px + (xr() - 0.5) * 18, z: pz + (xr() - 0.5) * 18, s: 12 + xr() * 10, c: new THREE.Color(0x14110e) });
    } else {
      // NEON: it has been raining all night. Puddles pick up whatever sign is
      // above them, which is what actually sells "wet" on a flat street.
      const nP = 2 + ((xr() * 4) | 0);
      for (let i = 0; i < nP; i++)
        o.puddleT.push({
          x: px + (xr() - 0.5) * 26, z: pz + (xr() - 0.5) * 26,
          s: 5 + xr() * 11, c: glow((xr() * this.glowColors.length) | 0),
        });
      // a lantern string swagged across the strip, lamps hanging off the wire
      if (xr() < 0.45) {
        const y = 11 + xr() * 5, half = SP * 0.8;
        d.position.set(px, y, pz);
        d.rotation.set(0, 0, 0);
        d.scale.set(alongZ ? half * 2 : 0.14, 0.14, alongZ ? 0.14 : half * 2);
        d.updateMatrix();
        o.rigT.push({ m: d.matrix.clone(), c: this.rustColor });
        const c = glow((xr() * this.glowColors.length) | 0);
        for (let i = 0; i < 7; i++) {
          const t = (i - 3) * (half * 2 / 7);
          d.position.set(px + (alongZ ? t : 0), y - 0.9, pz + (alongZ ? 0 : t));
          d.scale.set(0.75, 1.0, 0.75); d.updateMatrix();
          o.glowT.push({ m: d.matrix.clone(), c });
        }
      }
    }
    d.rotation.set(0, 0, 0);   // leave the shared dummy clean for the caller
  }

  /** Dressing for one BLOCK cell. (ex,ez) is the outward direction toward the
   *  adjacent avenue, or (0,0) for an interior cell. Props hug that kerb so the
   *  block interior stays walkable and doorways never get walled in. */
  private blockCellFlavour(
    px: number, pz: number, ex: number, ez: number, xr: () => number, d: THREE.Object3D,
    o: {
      scrapT: THREE.Matrix4[];
      pileT: { m: THREE.Matrix4; c: THREE.Color }[];
      rigT: { m: THREE.Matrix4; c: THREE.Color }[];
      glowT: { m: THREE.Matrix4; c: THREE.Color }[];
      signT: { m: THREE.Matrix4; c: THREE.Color }[];
      structT: THREE.Matrix4[];
      decalT: { x: number; z: number; s: number; c: THREE.Color }[];
      drumSpots: { x: number; z: number }[];
      cols: AABB[];
    },
    door?: { x: number; z: number },
  ): void {
    const SP = this.SPACING;
    // nothing solid on the threshold of a lot door (the rolls are still drawn, only the push is skipped)
    // (a box test against the prop's collider + the 1.6 u a standing body needs round the door)
    const clear = (x: number, z: number, hx: number, hz: number) => !door || !(door.x > x - hx - 1.6 && door.x < x + hx + 1.6 && door.z > z - hz - 1.6 && door.z < z + hz + 1.6);
    const edge = SP * 0.47 - 1.2;
    const kerbX = ex !== 0 ? px + ex * edge : px;
    const kerbZ = ez !== 0 ? pz + ez * edge : pz;
    const alongZ = ex !== 0;   // the kerb line runs north-south
    const glow = (i: number) => this.glowColors[i % this.glowColors.length];

    if (this.kind === 'slums') {
      // SCRAP FENCE: three short corrugated panels with a gap you can walk
      // through, leaning at slightly different angles like they were nailed up
      // by different people on different days.
      if ((ex || ez) && xr() < 0.45) {
        for (let i = 0; i < 3; i++) {
          if (xr() < 0.25) continue;          // a missing panel = the way in
          const slide = (i - 1) * 8 + (xr() - 0.5) * 2;
          const hh = 3.2 + xr() * 2.2, lean = (xr() - 0.5) * 0.18;
          const fx = kerbX + (alongZ ? 0 : slide), fz = kerbZ + (alongZ ? slide : 0);
          d.position.set(fx, hh / 2, fz);
          d.rotation.set(alongZ ? lean : 0, 0, alongZ ? 0 : lean);
          d.scale.set(alongZ ? 0.4 : 7, hh, alongZ ? 7 : 0.4);
          d.updateMatrix();
          const hx = alongZ ? 1.0 : 3.6, hz = alongZ ? 3.6 : 1.0;
          if (!clear(fx, fz, hx, hz)) continue;
          o.scrapT.push(d.matrix.clone());
          o.cols.push({ minX: fx - hx, maxX: fx + hx, minZ: fz - hz, maxZ: fz + hz });
        }
      }
      // WASHING LINE strung along the kerb, shirts hanging in the dead air
      if (xr() < 0.4) {
        const y = 7.5 + xr() * 2.5, span = 15;
        d.position.set(kerbX, y, kerbZ);
        d.rotation.set(0, 0, 0);
        d.scale.set(alongZ ? 0.12 : span, 0.12, alongZ ? span : 0.12);
        d.updateMatrix(); o.rigT.push({ m: d.matrix.clone(), c: this.rustColor });
        const nW = 3 + ((xr() * 3) | 0);
        for (let i = 0; i < nW; i++) {
          const t = (i - (nW - 1) / 2) * (span / (nW + 1));
          const ch = 1.8 + xr() * 1.6;
          d.position.set(kerbX + (alongZ ? 0 : t), y - ch / 2 - 0.2, kerbZ + (alongZ ? t : 0));
          d.scale.set(alongZ ? 0.2 : 1.6, ch, alongZ ? 1.6 : 0.2);
          d.updateMatrix();
          o.rigT.push({ m: d.matrix.clone(), c: this.clothColors[(xr() * this.clothColors.length) | 0] });
        }
      }
      // a fire barrel on the kerb + the pool of light it throws
      if (xr() < 0.12) {
        const bx = kerbX + (alongZ ? 0 : (xr() - 0.5) * 10), bz = kerbZ + (alongZ ? (xr() - 0.5) * 10 : 0);
        d.rotation.set(0, xr() * 3, 0);
        d.position.set(bx, 3.5, bz); d.scale.set(1.9, 2.7, 1.9); d.updateMatrix();
        if (clear(bx, bz, 1.3, 1.3)) {
          o.drumSpots.push({ x: bx, z: bz });
          o.glowT.push({ m: d.matrix.clone(), c: glow(0) });
          o.decalT.push({ x: bx, z: bz, s: 18, c: glow(1) });
          o.cols.push({ minX: bx - 1.3, maxX: bx + 1.3, minZ: bz - 1.3, maxZ: bz + 1.3 });
        }
      }
    } else if (this.kind === 'ruins') {
      // bent rebar clawing out of the broken kerb — no colliders, they're thin
      if (xr() < 0.4) {
        const nB = 2 + ((xr() * 3) | 0);
        for (let i = 0; i < nB; i++) {
          const rx = kerbX + (xr() - 0.5) * 10, rz = kerbZ + (xr() - 0.5) * 10;
          d.position.set(rx, 1.4 + xr(), rz);
          d.rotation.set((xr() - 0.5) * 0.8, xr() * 3, (xr() - 0.5) * 0.8);
          d.scale.set(0.2, 2.6 + xr() * 2.4, 0.2);
          d.updateMatrix(); o.rigT.push({ m: d.matrix.clone(), c: this.rustColor });
        }
      }
      if (xr() < 0.22) o.decalT.push({ x: kerbX, z: kerbZ, s: 10 + xr() * 8, c: new THREE.Color(0x14110e) });
    } else if (this.kind === 'neon') {
      // VENDING MACHINES: a dark cabinet with a glowing front, the classic
      // pool of light on a wet pavement. Cabinet + face are two instances of
      // two already-batched materials, so they cost nothing extra to draw.
      if ((ex || ez) && xr() < 0.42) {
        const n = 1 + ((xr() * 2) | 0);
        for (let i = 0; i < n; i++) {
          const slide = (i - (n - 1) / 2) * 5 + (xr() - 0.5) * 3;
          const vx = kerbX + (alongZ ? 0 : slide), vz = kerbZ + (alongZ ? slide : 0);
          d.rotation.set(0, 0, 0);
          d.position.set(vx, 2.6, vz);
          d.scale.set(alongZ ? 1.6 : 4.0, 5.2, alongZ ? 4.0 : 1.6);
          d.updateMatrix();
          const ok = clear(vx, vz, 2.1, 2.1);
          if (ok) o.structT.push(d.matrix.clone());
          // the lit face points OUT at the street (ex/ez is the kerb's outward
          // direction) — a machine glowing into the wall behind it is worthless
          d.position.set(vx + (alongZ ? ex * 0.9 : 0), 3.0, vz + (alongZ ? 0 : ez * 0.9));
          d.scale.set(alongZ ? 0.3 : 3.2, 3.4, alongZ ? 3.2 : 0.3);
          d.updateMatrix();
          const faceC = glow((xr() * this.glowColors.length) | 0), poolC = glow((xr() * this.glowColors.length) | 0);
          if (!ok) continue;
          o.glowT.push({ m: d.matrix.clone(), c: faceC });
          o.cols.push({ minX: vx - 2.1, maxX: vx + 2.1, minZ: vz - 2.1, maxZ: vz + 2.1 });
          o.decalT.push({ x: vx, z: vz, s: 8, c: poolC });
        }
      }
      // a low sign board propped at the kerb, facing the traffic
      if ((ex || ez) && xr() < 0.3) {
        d.rotation.set(0, 0, 0);
        d.position.set(kerbX, 2.2, kerbZ);
        d.scale.set(alongZ ? 0.3 : 3.4, 3.4, alongZ ? 3.4 : 0.3);
        d.updateMatrix();
        o.signT.push({ m: d.matrix.clone(), c: glow((xr() * this.glowColors.length) | 0) });
      }
    }
    d.rotation.set(0, 0, 0);
  }

  /** SLUMS: one of the columns holding the plate up. Deliberately oversized —
   *  it is the landmark that tells you which way is "towards the pillar", and
   *  the thing that makes the ceiling read as WEIGHT rather than a lid. */
  private plateColumn(px: number, pz: number, plateY: number, d: THREE.Object3D, structT: THREE.Matrix4[], cols: AABB[]): void {
    const R = 7;                      // half-width of the shaft
    d.rotation.set(0, 0, 0);
    d.position.set(px, plateY / 2, pz); d.scale.set(R * 2, plateY, R * 2);
    d.updateMatrix(); structT.push(d.matrix.clone());
    // flared base + a collar under the plate: the column reads as engineered
    d.position.set(px, 2.2, pz); d.scale.set(R * 2.9, 4.4, R * 2.9);
    d.updateMatrix(); structT.push(d.matrix.clone());
    d.position.set(px, plateY - 3, pz); d.scale.set(R * 2.5, 6, R * 2.5);
    d.updateMatrix(); structT.push(d.matrix.clone());
    // four diagonal braces kicking out to the ground
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const dx = Math.cos(a), dz = Math.sin(a);
      d.position.set(px + dx * (R + 2.6), plateY * 0.2, pz + dz * (R + 2.6));
      d.rotation.set(dz * 0.3, -a, -dx * 0.3);
      d.scale.set(2.4, plateY * 0.46, 2.4);   // a BUTTRESS at the base, not a strut in mid-air
      d.updateMatrix(); structT.push(d.matrix.clone());
    }
    d.rotation.set(0, 0, 0);
    const CR = R * 1.5;
    cols.push({ minX: px - CR, maxX: px + CR, minZ: pz - CR, maxZ: pz + CR });
  }

  /** The MONUMENT in the middle of a downtown plaza: three stone tiers, a
   *  tapered shaft and a lit beacon on top — ~26u, five hero heights, small
   *  against the towers that ring the square but the tallest thing INSIDE it.
   *  It is the one object in the whole city there is exactly one of within
   *  450u, which is what makes "meet me at the monument" mean something.
   *  Six boxes on the shared box geometry: one instanced draw, one hull. */
  private monument(px: number, pz: number, d: THREE.Object3D, monT: THREE.Matrix4[], beaconT: THREE.Matrix4[], cols: AABB[]): void {
    d.rotation.set(0, 0, 0);
    const broken = this.kind === 'ruins';   // a shelled district keeps its stump
    const tiers: Array<[number, number, number]> = [
      [14.0, 1.6, 0.8],    // [width, height, centre Y]
      [10.0, 1.4, 2.3],
      [6.4, 1.2, 3.6],
      [4.2, broken ? 9.0 : 15.0, broken ? 8.7 : 11.7],   // the shaft
    ];
    if (!broken) tiers.push([2.6, 5.0, 21.7]);           // the taper
    for (const [w, h, y] of tiers) {
      d.position.set(px, y, pz); d.scale.set(w, h, w);
      d.updateMatrix(); monT.push(d.matrix.clone());
    }
    cols.push({ minX: px - 7, maxX: px + 7, minZ: pz - 7, maxZ: pz + 7 });
    if (broken) {   // the top of it lying across the steps
      d.position.set(px + 6.5, 2.2, pz - 2.4); d.rotation.set(0, 0.7, Math.PI / 2 - 0.25);
      d.scale.set(3.4, 11.0, 3.4);
      d.updateMatrix(); monT.push(d.matrix.clone());
      d.rotation.set(0, 0, 0);
      return;   // no beacon on a dead monument
    }
    // Four light strips up the shaft + the beacon on top, all on the streetlight
    // material: a pale stone inlay by day, a lit marker after dark, and the ONE
    // thing in a neon district that is still legible when the signage isn't.
    for (const [ox, oz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as Array<[number, number]>) {
      d.position.set(px + ox * 2.1, 11.7, pz + oz * 2.1);   // the CORNERS: two thin lines from any angle
      d.scale.set(0.5, 13.0, 0.5);
      d.updateMatrix(); beaconT.push(d.matrix.clone());
    }
    d.position.set(px, 25.2, pz); d.scale.set(2.4, 2.4, 2.4);
    d.updateMatrix(); beaconT.push(d.matrix.clone());
  }

  /** NEON: bury one building under signage. This is the flavour's whole point,
   *  so it is deliberately LOUD — 3-7 pieces per building against city-night's
   *  0-2: stacked glyph boards up the corners, horizontal light strips, a
   *  rooftop crown and a lit shopfront band at street level. Two materials
   *  (glyph board + plain glow), so it is still 2 draw calls for the chunk. */
  private neonSignage(
    jx: number, jz: number, w: number, dep: number, h: number, xr: () => number, d: THREE.Object3D,
    signT: { m: THREE.Matrix4; c: THREE.Color }[], glowT: { m: THREE.Matrix4; c: THREE.Color }[],
    decalT: { x: number; z: number; s: number; c: THREE.Color }[],
  ): void {
    const glow = () => this.glowColors[(xr() * this.glowColors.length) | 0];
    d.rotation.set(0, 0, 0);
    // 1) a stack of vertical glyph boards climbing one corner
    const face = (xr() * 4) | 0;                 // 0:+Z 1:-Z 2:+X 3:-X
    const fdx = face === 2 ? 1 : face === 3 ? -1 : 0;
    const fdz = face === 0 ? 1 : face === 1 ? -1 : 0;
    const half = (fdz !== 0 ? dep : w) / 2;
    const along = fdz !== 0 ? w : dep;
    const nBoards = 2 + ((xr() * 3) | 0);
    const bw = 3.4 + xr() * 1.6;
    const cornerOff = (xr() < 0.5 ? -1 : 1) * along * 0.33;
    for (let i = 0; i < nBoards; i++) {
      const by = h * 0.28 + i * (bw * 1.7);
      if (by > h - 2) break;
      d.position.set(jx + fdx * (half + 0.7) + (fdz !== 0 ? cornerOff : 0), by, jz + fdz * (half + 0.7) + (fdx !== 0 ? cornerOff : 0));
      d.scale.set(fdz !== 0 ? bw : 0.4, bw * 1.5, fdz !== 0 ? 0.4 : bw);
      d.updateMatrix(); signT.push({ m: d.matrix.clone(), c: glow() });
    }
    // 2) horizontal light strips wrapping the other faces
    const nStrips = 2 + ((xr() * 3) | 0);
    for (let i = 0; i < nStrips; i++) {
      const f2 = (xr() * 4) | 0;
      const gx = f2 === 2 ? 1 : f2 === 3 ? -1 : 0;
      const gz = f2 === 0 ? 1 : f2 === 1 ? -1 : 0;
      const hf = (gz !== 0 ? dep : w) / 2, al = gz !== 0 ? w : dep;
      const y = h * (0.2 + xr() * 0.7);
      d.position.set(jx + gx * (hf + 0.35), y, jz + gz * (hf + 0.35));
      d.scale.set(gz !== 0 ? al * (0.6 + xr() * 0.35) : 0.24, 0.5 + xr() * 0.5, gz !== 0 ? 0.24 : al * (0.6 + xr() * 0.35));
      d.updateMatrix(); glowT.push({ m: d.matrix.clone(), c: glow() });
    }
    // 3) a rooftop crown board — the skyline is signage all the way up
    if (xr() < 0.55) {
      const cw2 = w * (0.5 + xr() * 0.4);
      d.position.set(jx, h + 2.6 + xr() * 2, jz);
      d.scale.set(cw2, 4 + xr() * 3, 0.5);
      d.updateMatrix(); signT.push({ m: d.matrix.clone(), c: glow() });
    }
    // 4) shopfront light band at street level, on the avenue side, PLUS the
    //    spill it throws on the wet pavement — without that the strip is a
    //    glowing skyline standing on a black floor.
    const sf = (xr() * 4) | 0;
    const sx = sf === 2 ? 1 : sf === 3 ? -1 : 0;
    const sz = sf === 0 ? 1 : sf === 1 ? -1 : 0;
    const shf = (sz !== 0 ? dep : w) / 2, sal = sz !== 0 ? w : dep;
    const bandC = glow();
    d.position.set(jx + sx * (shf + 0.4), 4.4, jz + sz * (shf + 0.4));
    d.scale.set(sz !== 0 ? sal * 0.9 : 0.28, 1.1, sz !== 0 ? 0.28 : sal * 0.9);
    d.updateMatrix(); glowT.push({ m: d.matrix.clone(), c: bandC });
    decalT.push({ x: jx + sx * (shf + 3.5), z: jz + sz * (shf + 3.5), s: 13, c: bandC });
  }

  // -------------------------------------------------------------------------
  // chunk lifecycle
  // -------------------------------------------------------------------------

  private buildChunk(cx: number, cz: number): void {
    const key = cx + ',' + cz; if (this.loaded.has(key)) return;
    const rnd = mulberry32((hash2(cx, cz) ^ this.seed) >>> 0);
    const G = this.G, SP = this.SPACING;
    const baseGX = cx * G, baseGZ = cz * G;
    const group = new THREE.Group();
    const cols: AABB[] = [];

    // ---- buildings: per-chunk InstancedMesh per HEIGHT BUCKET ----
    // 3 UV-bucket geometries keep window rows world-sized regardless of tower
    // height. Per-instance color jitter (setColorAt) replaces the old 2-variant
    // texture system — same draw-call budget, more visual variety.
    const maxB = G * G;
    const nBuck = this.facadeGeos.length;
    // the flavours add EXTRA boxes to the same instanced meshes (a stacked
    // shanty, a collapsed upper floor), so they need headroom past one per cell.
    const capB = this.fl ? maxB * 2 : maxB;
    const concreteMeshes = this.facadeGeos.map((g) => {
      const im = new THREE.InstancedMesh(g, this.concreteMats[0], capB);
      im.castShadow = im.receiveShadow = true; return im;
    });
    const glassMeshes = this.facadeGeos.map((g) => {
      const im = new THREE.InstancedMesh(g, this.glassMats[0], capB);
      im.castShadow = im.receiveShadow = true; return im;
    });
    const concreteCounts = new Array(nBuck).fill(0);
    const glassCounts = new Array(nBuck).fill(0);
    const tint = new THREE.Color();
    const dummy = new THREE.Object3D();

    // rooftop props (AC units, antenna masts) + entrance bands
    const roofProps = new THREE.InstancedMesh(this.boxGeo, this.roofPropMat, maxB * 2);
    const bands = new THREE.InstancedMesh(this.boxGeo, this.bandMat, maxB);
    let roofCount = 0, bandCount = 0;

    const parkSpots: { x: number; z: number }[] = [];
    const treeSpots: { x: number; z: number }[] = [];
    // sidewalk pad per block cell + the boulevard medians (same slab, same mesh)
    const padSpots: { x: number; z: number; s: number }[] = [];
    const medianSpots: { x: number; z: number; alongZ: boolean }[] = [];
    // every patch of grass in the chunk — squares, lots, plaza planting — as ONE
    // instanced sheet. (335 separate park Meshes per view was the single biggest
    // draw-call group in the whole city; this is the same grass for one call.)
    const lawnSpots: { x: number; z: number; s: number }[] = [];
    // the monument at a downtown plaza: stone tiers + a lit beacon on top
    const monT: THREE.Matrix4[] = [];
    const beaconT: THREE.Matrix4[] = [];
    // every shrub in the chunk — park bushes and clipped planter tops — on one
    // shared sphere mesh, tinted per instance
    const bushT: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    // the rare matte-brick blocks, batched (one material, shade per instance)
    const brickT: THREE.Matrix4[] = [];
    const brickC: THREE.Color[] = [];
    // benches: park kerbs, plaza rims and (by day) the sidewalk furniture
    const benchSpots: { x: number; z: number; rot: number }[] = [];
    // named spots an author can send a character to (filled as the plan is laid
    // out, so nothing is re-derived afterwards)
    const marks: Landmark[] = [];
    // street-life spots — decided per cell from coordinate HASHES, NOT the
    // chunk rnd stream: placement stays deterministic + seam-stable AND the
    // existing building/park rnd draw order is provably untouched (the safest
    // possible form of the "branch-independent rnd order" rule).
    const lampSpots: { x: number; z: number; dx: number; dz: number }[] = [];
    const carSpots: { x: number; z: number; vert: boolean; flip: boolean; ci: number }[] = [];
    const stripeSpots: { x: number; z: number; alongZ: boolean }[] = [];
    const binSpots: { x: number; z: number }[] = [];
    // NIGHT-ONLY neon strip/sign transforms, one matrix list per palette color
    // (neonMats is empty by day -> this stays a zero-length array, zero cost).
    const neonByColor: THREE.Matrix4[][] = this.neonMats.map(() => []);
    // DAY-ONLY town dressing, all decided from SALTED per-cell hash streams
    // (never the chunk rnd) so night chunks are bit-identical to before:
    //  - dayBoxes: storefront display bands, door slots, sign boards, planter
    //    boxes and park flowers -> ONE instanceColor'd box InstancedMesh.
    //  - awningByColor: canvas awnings, one matrix list per awning material
    //    (exactly the night-neon per-color batching pattern).
    const dayBoxes: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    // LOT DOORS — the doorway frame + leaf + step + sign of every enterable building in this
    // chunk (all flavours), one instanceColor'd box mesh. Positions come from the pure lot
    // table, so the door the game triggers on is exactly the door you see.
    const lotBoxes: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const awningByColor: THREE.Matrix4[][] = this.awningMats.map(() => []);
    const hydrantSpots: { x: number; z: number }[] = [];
    const planterSpots: { x: number; z: number; alongZ: boolean }[] = [];
    const walkBenchSpots: { x: number; z: number; rot: number }[] = [];
    const flowerSpots: { x: number; z: number; ci: number }[] = [];
    // ---- FLAVOUR-ONLY plan (empty arrays for day/night -> zero cost) --------
    // One array per MATERIAL, not per prop: a slum chunk's roof sheets, fence
    // panels and lean-to walls all land in `scrap`, its cables + washing + wires
    // all land in `rig`, its fires + neon + panel glow all land in `glow`. Each
    // array becomes exactly ONE InstancedMesh at the bottom of this function.
    const P = this.prof, fl = this.fl;
    const scrapT: THREE.Matrix4[] = [];                          // corrugated sheet (roofs / fences / slabs)
    const pileT: { m: THREE.Matrix4; c: THREE.Color }[] = [];    // junk heaps + rubble mounds
    const rigT: { m: THREE.Matrix4; c: THREE.Color }[] = [];     // cables, washing lines, rebar
    const glowT: { m: THREE.Matrix4; c: THREE.Color }[] = [];    // flames, light strips, lit panels
    const signT: { m: THREE.Matrix4; c: THREE.Color }[] = [];    // NEON glyph boards
    const structT: THREE.Matrix4[] = [];                         // plate pillars, vending cabinets
    const decalT: { x: number; z: number; s: number; c: THREE.Color }[] = [];   // pools / scorch
    const puddleT: { x: number; z: number; s: number; c: THREE.Color }[] = [];  // NEON rain puddles
    const drumSpots: { x: number; z: number }[] = [];
    const lotSpots: { x: number; z: number; s: number }[] = [];   // dirt yard / crater floor
    const dark = new THREE.Color(0x120f0c);   // scorch tint for the decal sheet

    // A block spans a chunk seam, so the green-square decision has to come from
    // the BLOCK, not the chunk — memoised here because the nine cells of a block
    // all ask the same question.
    const greenMemo = new Map<number, boolean>();
    const greenBlock = (bx: number, bz: number): boolean => {
      const k = (bx & 0xffff) * 65536 + (bz & 0xffff);
      let v = greenMemo.get(k);
      if (v === undefined) { v = this.isGreenBlock(bx, bz); greenMemo.set(k, v); }
      return v;
    };
    /** a flavour square grows wreckage where the town grows trees */
    const squareJunk = (tx: number, tz: number, xr: (() => number) | null) => {
      const r = xr ? xr() : 0.5, r2 = xr ? xr() : 0.5, r3 = xr ? xr() : 0.5;
      const s = 1.0 + r * 1.1;
      dummy.rotation.set(0, r2 * Math.PI * 2, 0);
      dummy.position.set(tx, 0.12, tz);
      dummy.scale.set(s * (1.3 + r3 * 0.9), s * (this.kind === 'ruins' ? 1.5 : 1.1), s * (1.3 + r3 * 0.9));
      dummy.updateMatrix();
      pileT.push({ m: dummy.matrix.clone(), c: this.junkColors[(r3 * this.junkColors.length) | 0] });
      cols.push({ minX: tx - s, maxX: tx + s, minZ: tz - s, maxZ: tz + s });
      dummy.rotation.set(0, 0, 0);
    };

    for (let lx = 0; lx < G; lx++) {
      for (let lz = 0; lz < G; lz++) {
        const gcx = baseGX + lx, gcz = baseGZ + lz;
        const px = gcx * SP, pz = gcz * SP;
        const ph = (hash2(gcx + 0x9e37, gcz - 0x79b9) ^ this.seed) >>> 0; // per-cell street-prop hash
        const mx = this.mod(gcx, this.ROAD_EVERY), mz = this.mod(gcz, this.ROAD_EVERY);
        // FLAVOUR stream: one more SALTED per-cell hash, drawn only by slums /
        // ruins / neon. Because it is seeded from the cell (never from the chunk
        // rnd) it is seam-stable, and day/night never touch it at all.
        const xr = fl ? mulberry32((hash2(gcx * 17 + 0x51, gcz * 17 - 0x2f) ^ this.seed) >>> 0) : null;
        const laneX = this.isLane(gcx), laneZ = this.isLane(gcz);
        if (laneX || laneZ) {
          // MEDIAN: the raised planted strip down the seam of a boulevard's two
          // carriageways. Emitted from the FIRST of the pair (mod BLV === 0) and
          // never across a crossing, so the junction stays open. It costs one
          // more instance in the pavement sheet and a tree in the tree sheet —
          // and it is what turns "a wide road" into a route you can follow.
          const bmX = this.mod(gcx, this.BLV) === 0 && !laneZ;
          const bmZ = this.mod(gcz, this.BLV) === 0 && !laneX;
          if (bmX || bmZ) {
            const mxw = bmX ? px + SP / 2 : px, mzw = bmZ ? pz + SP / 2 : pz;
            medianSpots.push({ x: mxw, z: mzw, alongZ: bmX });
            // a tree every other cell — a line of them reads as an avenue of
            // trees from a long way off, which is the whole point of the median.
            // Nobody plants trees in a shanty sector or a bombed street: those
            // get the same rhythm in fly-tipped heaps instead.
            if (((ph >>> 5) & 1) === 0) {
              const tx = mxw + (bmZ ? (((ph >>> 9) & 15) - 7.5) : 0);
              const tz = mzw + (bmX ? (((ph >>> 9) & 15) - 7.5) : 0);
              if (this.kind === 'slums' || this.kind === 'ruins') squareJunk(tx, tz, xr);
              else treeSpots.push({ x: tx, z: tz });
            }
          }
          if (laneX && laneZ) {
            if (P.crosswalks) {
              // INTERSECTION: zebra crosswalk on ONE hash-picked side, 6 stripes
              // flush with the asphalt (a 7×7 chunk holds 1-4 intersections).
              const side = ph & 3; // 0=N 1=S 2=W 3=E
              for (let s = 0; s < 6; s++) {
                const lane = (s - 2.5) * 4.0;
                if (side === 0) stripeSpots.push({ x: px + lane, z: pz - 11.4, alongZ: true });
                else if (side === 1) stripeSpots.push({ x: px + lane, z: pz + 11.4, alongZ: true });
                else if (side === 2) stripeSpots.push({ x: px - 11.4, z: pz + lane, alongZ: false });
                else stripeSpots.push({ x: px + 11.4, z: pz + lane, alongZ: false });
              }
            } else if (this.kind === 'ruins' && mx === 0 && mz === 0) {
              // a shell landed in the crossing: scorch ring + a rubble spill
              decalT.push({ x: px, z: pz, s: 26 + (ph & 7), c: dark });
              // (>>> everywhere: a signed shift on a uint32 hash goes NEGATIVE,
              //  which would index the palette out of bounds)
              for (let s = 0; s < 3; s++) {
                dummy.position.set(px + ((ph >>> (s * 3)) % 16) - 8, 0.4, pz + ((ph >>> (s * 3 + 4)) % 16) - 8);
                dummy.rotation.set(0, (ph >>> s) % 6, 0);
                dummy.scale.set(3 + (s % 2), 1.5, 3 + (s % 2));
                dummy.updateMatrix();
                pileT.push({ m: dummy.matrix.clone(), c: this.junkColors[(ph >>> s) % this.junkColors.length] });
              }
            }
          } else if (ph % P.carEvery === 3) {
            // PARKED CAR hugging the kerb, parallel to the street (~1-3 / chunk)
            // (slums park RUSTED HULKS here, ruins burnt husks — same mesh.)
            const vert = laneX;   // this street runs along Z here, along X otherwise
            const bm = this.mod(vert ? gcx : gcz, this.BLV);
            // on a boulevard, park against the OUTER kerb — the inner one is the
            // median, and a car parked in the planting reads as a crash
            const side = bm === 0 ? -1 : bm === 1 ? 1 : ((ph >> 3) & 1 ? 1 : -1);
            const slide = (((ph >>> 8) & 255) / 255 - 0.5) * 12; // jitter along the kerb
            const flip = ((ph >> 4) & 1) === 1, ci = (ph >>> 12) % this.carColors.length;
            if (vert) carSpots.push({ x: px + side * 11.4, z: pz + slide, vert, flip, ci });
            else carSpots.push({ x: px + slide, z: pz + side * 11.4, vert, flip, ci });
          }
          if (xr) this.roadCellFlavour(px, pz, laneX, xr, dummy, { rigT, glowT, puddleT, pileT, decalT, drumSpots });
          continue; // clear avenue
        }
        // ---- BLOCK cell ------------------------------------------------------
        const [oX, oZ] = this.outward(gcx, gcz);   // which street this cell fronts
        // an ENTERABLE LOT owns this cell: fixed square footprint, no jitter, no yaw, no
        // pavement furniture in front of its door (the lamp would stand on the threshold)
        const lot = this.L.lotForCell(gcx, gcz);
        // pavement furniture keeps off the threshold: anything within 3.8 u of a door is not placed
        const doorClear = (x: number, z: number) => !lot || (lot.door.x - x) ** 2 + (lot.door.z - z) ** 2 > 3.8 * 3.8;
        const plaza = this.plazaAt(gcx, gcz);
        const green = !plaza && greenBlock(Math.floor(gcx / this.ROAD_EVERY), Math.floor(gcz / this.ROAD_EVERY));
        // full-cell pavement under a plaza or a green square, so their cells
        // MEET and read as one 90u/120u space; an ordinary block cell keeps the
        // inset pad, whose rim is what reads as a kerb.
        padSpots.push({ x: px, z: pz, s: plaza || green ? SP : SP * 0.94 });
        // STREETLIGHT on pad edges that face an avenue (~2-4 / chunk); the side
        // alternates naturally with whichever avenue the pad touches.
        if (ph % 8 === 1 && (oX || oZ) && !plaza) {   // the plaza lights itself, below
          const edge = SP * 0.47 - 0.9; // just inside the pad rim
          if (doorClear(px + oX * edge, pz + oZ * edge)) lampSpots.push({ x: px + oX * edge, z: pz + oZ * edge, dx: oX, dz: oZ });
        }
        // TRASH BIN tucked near a pad corner (sparse, ~2-3 / chunk)
        if (ph % 12 === 5) {
          const co = SP * 0.47 - 1.4;
          const bx = px + ((ph >> 6) & 1 ? co : -co), bz = pz + ((ph >> 7) & 1 ? co : -co);
          if (doorClear(bx, bz)) binSpots.push({ x: bx, z: bz });
        }
        // DAY-ONLY sidewalk furniture: fire hydrants, planter boxes and extra
        // street benches on avenue-facing pad edges. Decided from a SALTED
        // per-cell hash (a separate stream from ph) -> deterministic and
        // seam-stable, and the chunk rnd / night layout are provably untouched.
        if (this.kind === 'day') {
          const fh = (hash2(gcx * 13 + 5, gcz * 13 - 9) ^ this.seed) >>> 0;
          const ex = oX, ez = oZ; // outward dir toward the adjacent street (if any)
          if (ex !== 0 || ez !== 0) {
            const fEdge = SP * 0.47 - 1.2; // just inside the pad rim
            const sl = (b: number) => ((((fh >>> b) & 255) / 255) - 0.5) * SP * 0.55; // slide along the kerb
            if (fh % 9 === 2) {
              const s = sl(5);
              const hx = px + (ex !== 0 ? ex * fEdge : s), hz = pz + (ez !== 0 ? ez * fEdge : s);
              if (doorClear(hx, hz)) hydrantSpots.push({ x: hx, z: hz });
            }
            if (fh % 6 === 1) {
              const s = sl(13);
              const qx = px + (ex !== 0 ? ex * fEdge : s), qz = pz + (ez !== 0 ? ez * fEdge : s);
              if (doorClear(qx, qz)) planterSpots.push({ x: qx, z: qz, alongZ: ex !== 0 });
            }
            if (fh % 10 === 3) {
              const s = sl(21);
              if (doorClear(px + (ex !== 0 ? ex * fEdge : s), pz + (ez !== 0 ? ez * fEdge : s))) walkBenchSpots.push({
                x: px + (ex !== 0 ? ex * fEdge : s), z: pz + (ez !== 0 ? ez * fEdge : s),
                rot: ez === 1 ? 0 : ez === -1 ? Math.PI : ex === 1 ? Math.PI / 2 : -Math.PI / 2, // seat faces the avenue
              });
            }
          }
        }

        // FLAVOUR block-cell dressing: scrap fences, washing lines, cables, a
        // fire barrel, junk. All from the salted `xr` stream (never the chunk
        // rnd), on the pad EDGE that faces an avenue so the block interior and
        // the doorways stay walkable.
        if (xr && !plaza) this.blockCellFlavour(px, pz, oX, oZ, xr, dummy, { scrapT, pileT, rigT, glowT, signT, structT, decalT, drumSpots, cols }, lot?.door);
        // PLATE PILLAR: a column the size of a building carrying the sector roof.
        // On the BLV lattice (never a lane index, so it is always a block cell)
        // it stands one block off the boulevard crossing — visible straight down
        // both streets instead of buried inside a block. Rare, enormous,
        // unmissable: the one silhouette that says "you are UNDER something".
        if (this.theme.plateY && this.mod(gcx, this.BLV) === 8 && this.mod(gcz, this.BLV) === 8) {
          this.plateColumn(px, pz, this.theme.plateY, dummy, structT, cols);
          marks.push({ x: px + 12, z: pz + 12, kind: 'pillar' });
          continue;   // the pillar OWNS this cell — no shack under it
        }

        // ---- PLAZA: the destination at the heart of a downtown ---------------
        // Nine paved cells, open, with the monument in the middle and the
        // tallest towers in the world standing round the rim. This is the spot
        // an author can name, the spot a kid spawns on, and the only place in a
        // 450u lattice where the city stops and lets you stand still.
        if (plaza) {
          if (plaza.centre) {
            // under the plate the square's centrepiece is one of the columns
            // holding the sky up — the same role, a bigger silhouette
            if (this.theme.plateY) this.plateColumn(px, pz, this.theme.plateY, dummy, structT, cols);
            else this.monument(px, pz, dummy, monT, beaconT, cols);
            marks.push({ x: px, z: pz + (this.theme.plateY ? 16 : 14), kind: this.theme.plateY ? 'pillar' : 'monument' });
            marks.push({ x: px + 26, z: pz - 26, kind: 'plaza' });
          } else {
            // Rim dressing. A LAMP on every rim cell (not the usual 1-in-8):
            // eight of them ring the square, so the plaza is a lit room at
            // night in every flavour instead of a hole in the city.
            if (oX || oZ) lampSpots.push({ x: px + oX * (SP * 0.47 - 0.9), z: pz + oZ * (SP * 0.47 - 0.9), dx: -oX, dz: -oZ });
            const cor = Math.abs(this.mod(gcx, this.BLV) - 3) === 1 && Math.abs(this.mod(gcz, this.BLV) - 3) === 1;
            if (cor) {
              if (!fl) treeSpots.push({ x: px + (oX || 0) * 2, z: pz + (oZ || 0) * 2 });
              benchSpots.push({
                x: px + (this.mod(gcx, this.BLV) < 3 ? 9 : -9), z: pz + (this.mod(gcz, this.BLV) < 3 ? 9 : -9),
                rot: (ph & 1) ? Math.PI / 2 : 0,
              });
            }
          }
          continue;   // no building, no lawn — the plaza is the empty space
        }

        // ---- GREEN SQUARE: a whole block of open ground ----------------------
        // The old per-cell lot roll scattered 30u lawn patches through the block
        // interiors where nobody ever sees them. A block-level decision gives a
        // 120u square you can read from the avenue: trees round the rim, open
        // grass in the middle, benches on the kerb.
        if (green) {
          if (fl) lotSpots.push({ x: px, z: pz, s: SP });
          else lawnSpots.push({ x: px, z: pz, s: SP });
          if (oX || oZ) {
            // the RIM plants; the middle of the square stays open on purpose
            const nT = 1 + (ph & 1);
            for (let t = 0; t < nT; t++) {
              const tx = px + (((ph >>> (4 + t * 5)) & 31) / 31 - 0.5) * SP * 0.7;
              const tz = pz + (((ph >>> (9 + t * 5)) & 31) / 31 - 0.5) * SP * 0.7;
              if (fl) { squareJunk(tx, tz, xr); continue; }
              treeSpots.push({ x: tx, z: tz });
            }
            if ((ph & 7) === 3) benchSpots.push({ x: px + oX * (SP * 0.44), z: pz + oZ * (SP * 0.44), rot: oZ === 1 ? Math.PI : oZ === -1 ? 0 : oX === 1 ? -Math.PI / 2 : Math.PI / 2 });
          }
          if (this.mod(gcx, this.ROAD_EVERY) === 2 && this.mod(gcz, this.ROAD_EVERY) === 2) marks.push({ x: px, z: pz, kind: fl ? 'yard' : 'square' });
          continue;
        }

        // an occasional single vacant LOT inside an ordinary block — much rarer
        // now that the open ground is gathered into squares, and rarer still
        // downtown, where the towers close ranks.
        const dens = this.districtAt(px, pz);
        // A street FRONTAGE is vacant exactly when the layout dealt it no door (a per-cell hash, so
        // the door table and the built street agree); a buried cell keeps the chunk roll. The roll
        // is drawn either way so the rnd stream keeps its order.
        const vacantRoll = rnd() < P.lotChance * (0.72 - 0.55 * dens);
        if (this.L.frontage(gcx, gcz) ? !lot : vacantRoll) {
          if (fl) lotSpots.push({ x: px, z: pz, s: SP * 0.72 });
          else { parkSpots.push({ x: px, z: pz }); lawnSpots.push({ x: px, z: pz, s: SP * 0.72 }); }
          // slightly fewer trees per park (2..4) trims per-chunk instance/draw
          // cost a touch -> smoother camera turns, with no visible loss.
          // (A flavour lot grows JUNK where the town grows trees: the very same
          // 2..4 spots, spent on heaps of scrap or blast rubble instead.)
          const nT = 2 + ((rnd() * 3) | 0);
          for (let t = 0; t < nT; t++) {
            const tx = px + (rnd() - 0.5) * SP * 0.6, tz = pz + (rnd() - 0.5) * SP * 0.6;
            if (!fl) { treeSpots.push({ x: tx, z: tz }); continue; }
            // waist-to-chest high against the 5.4u hero, and NEVER radially
            // symmetric — an even cone reads as a sand pile, not as wreckage
            const s = 1.0 + (xr ? xr() : 0.5) * 1.1;
            dummy.rotation.set(0, (xr ? xr() : 0) * Math.PI * 2, 0);
            dummy.position.set(tx, 0.12, tz);
            dummy.scale.set(s * (1.3 + (xr ? xr() : 0) * 0.9), s * (this.kind === 'ruins' ? 1.5 : 1.1), s * (1.3 + (xr ? xr() : 0) * 0.9));
            dummy.updateMatrix();
            pileT.push({ m: dummy.matrix.clone(), c: this.junkColors[((xr ? xr() : 0) * this.junkColors.length) | 0] });
            cols.push({ minX: tx - s, maxX: tx + s, minZ: tz - s, maxZ: tz + s });
          }
          // DAY-ONLY flower sprinkle: tiny bright cubes on the lawn, from a
          // salted per-cell stream (chunk rnd untouched -> night identical).
          if (this.kind === 'day') {
            const frnd = mulberry32((hash2(gcx * 23 + 7, gcz * 23 - 3) ^ this.seed) >>> 0);
            const nF = 6 + ((frnd() * 8) | 0);
            for (let f = 0; f < nF; f++)
              flowerSpots.push({
                x: px + (frnd() - 0.5) * SP * 0.6, z: pz + (frnd() - 0.5) * SP * 0.6,
                ci: (frnd() * this.flowerColors.length) | 0,
              });
          }
          continue;
        }

        // BUILDING — vary footprint + height; quadratic falloff -> a few tall towers.
        // The SIX uniforms are drawn in a fixed order for every theme and only
        // then mapped through the profile, so day/night keep their exact
        // skyline while a slum shack and a neon block get their own shape.
        const uW = rnd(), uD = rnd(), uHa = rnd(), uHb = rnd(), uJx = rnd(), uJz = rnd();
        const w = lot ? lot.size : uW * P.bwSpan + P.bw, dep = lot ? lot.size : uD * P.bdSpan + P.bd;
        // HEIGHT IS A PLACE, NOT A DIE ROLL. The old `uHa*uHb*span + base` was
        // rolled per cell, independently, forever: tall and short interleaved at
        // random in every direction, so no view differed from any other and
        // nothing was worth walking to. Now the same two uniforms are read
        // through the district field: out in the low-rise they stay quadratic
        // (a townscape with the odd taller block), downtown they get a high
        // floor and a linear span (a massing). The peak is unchanged, so the
        // facade UV buckets still size window rows correctly.
        const hLow = P.bhBase * 0.50 + uHa * uHb * P.bhSpan * 0.38;
        const hCore = P.bhBase * 0.95 + (0.30 + uHa * 0.70) * P.bhSpan * 0.95;
        const h = hLow + (hCore - hLow) * dens;
        const jx = lot ? px : px + (uJx * 2 - 1) * P.jitter, jz = lot ? pz : pz + (uJz * 2 - 1) * P.jitter;
        // crooked shacks / settled ruins: a few degrees of yaw off the grid (a lot stands
        // square to its street — the roll is still drawn so the xr stream keeps its order).
        const yawRoll = P.yaw && xr ? (xr() - 0.5) * 2 * P.yaw : 0;
        const yaw = lot ? 0 : yawRoll;
        dummy.position.set(jx, h / 2, jz);
        dummy.scale.set(w, h, dep);
        dummy.rotation.set(0, yaw, 0);
        dummy.updateMatrix();
        const bucket = h < 38 ? 0 : h < 62 ? 1 : 2;  // window rows stay world-sized
        const r = rnd();
        // subtle per-building shade variety via instanceColor (replaces the old
        // 2-texture-variant system at the same draw-call budget). Night gets a
        // WIDER lightness spread so neighbouring facades separate — the rnd
        // draw COUNT is identical either way, so the day city stays exact.
        const hj = rnd() - 0.5, lj = rnd() - 0.5;
        tint.setHSL(0, 0, 1).offsetHSL(hj * 0.015, 0, lj * (this.theme.night ? 0.16 : 0.10));
        const brickVariant = (rnd() * this.brickColors.length) | 0; // drawn unconditionally so the rnd stream is branch-independent
        // DAY-ONLY town stream: a SALTED per-cell hash (mirrors the night
        // neon's nrnd) drives the warm facade palette pick + the storefront
        // dressing below. The chunk rnd sequence above is untouched -> heights,
        // footprints and colliders are bit-identical, and the night city
        // (which never enters these branches) renders exactly as before.
        const drnd = this.kind === 'day' ? mulberry32((hash2(gcx * 11 + 29, gcz * 11 - 17) ^ this.seed) >>> 0) : null;
        // day reads as a TOWN: more windowed plaster fronts, fewer glass
        // towers. Same single r draw either way (night keeps its exact mix).
        const cThresh = P.cThresh;
        // SLUMS repaint every shack from the junk palette (rust, tarp, faded
        // green) so no two sheets of scrap match — same instanceColor slot the
        // day town uses for its plaster.
        if (fl && this.junkColors.length && xr && this.kind === 'slums')
          tint.copy(this.junkColors[(xr() * this.junkColors.length) | 0]).offsetHSL(hj * 0.03, 0, lj * 0.18);
        // NEON gives each tower a faint colour CAST from the sign palette, so a
        // wall of lit windows doesn't read as one repeated spreadsheet grid.
        if (this.kind === 'neon' && xr && this.glowColors.length)
          tint.copy(this.glowColors[(xr() * this.glowColors.length) | 0]).lerp(WHITE, 0.74).offsetHSL(0, 0, lj * 0.12);
        if (r < cThresh) {
          // day: warm plaster/brick paint per building, gently jittered
          if (drnd) tint.copy(this.dayFacade[(drnd() * this.dayFacade.length) | 0]).offsetHSL(hj * 0.02, 0, lj * 0.06);
          const i = concreteCounts[bucket]++; concreteMeshes[bucket].setMatrixAt(i, dummy.matrix); concreteMeshes[bucket].setColorAt(i, tint);
        }
        else if (r < 0.92) { const i = glassCounts[bucket]++; glassMeshes[bucket].setMatrixAt(i, dummy.matrix); glassMeshes[bucket].setColorAt(i, tint); }
        else {
          // rare matte brick: the SAME three shades, but carried on one shared
          // material as per-instance colour, so a chunk's brick blocks cost one
          // draw + one outline hull instead of two per building.
          brickT.push(dummy.matrix.clone());
          brickC.push(this.brickColors[brickVariant]);
        }
        // a yawed box needs a slightly fatter AABB or you clip its corners
        const cw = yaw ? (w * Math.cos(yaw) + dep * Math.sin(Math.abs(yaw))) : w;
        const cd = yaw ? (dep * Math.cos(yaw) + w * Math.sin(Math.abs(yaw))) : dep;
        cols.push({ minX: jx - cw / 2, maxX: jx + cw / 2, minZ: jz - cd / 2, maxZ: jz + cd / 2 });

        // ---- FLAVOUR building extras (day/night never enter this) ----
        // SLUMS: an overhanging corrugated roof, sometimes a second shanty
        // stacked on top. RUINS: the top floors sheared off into a leaning slab
        // with a rubble skirt. NEON: the facade disappears under signage.
        if (xr) {
          const buildExtra = (i: number, bucketIdx: number, glass: boolean) => {
            const mesh = glass ? glassMeshes[bucketIdx] : concreteMeshes[bucketIdx];
            mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, tint);
          };
          if (this.kind === 'slums') {
            // roof sheet: wider than the shack, tilted so rain runs off
            const tilt = (xr() - 0.5) * 0.34;
            dummy.position.set(jx, h + 0.5, jz);
            dummy.rotation.set(tilt, yaw, 0);
            dummy.scale.set(w + 3.4, 0.55, dep + 3.4);
            dummy.updateMatrix(); scrapT.push(dummy.matrix.clone());
            // stacked shanty: a smaller box perched on one side of the roof
            if (xr() < 0.42 && concreteCounts[0] < capB) {
              const sw = w * (0.5 + xr() * 0.25), sd = dep * (0.5 + xr() * 0.25), sh = 5 + xr() * 6;
              const ox = (xr() - 0.5) * w * 0.4, oz = (xr() - 0.5) * dep * 0.4;
              dummy.position.set(jx + ox, h + 1 + sh / 2, jz + oz);
              dummy.rotation.set(0, yaw + (xr() - 0.5) * 0.3, 0);
              dummy.scale.set(sw, sh, sd);
              dummy.updateMatrix();
              buildExtra(concreteCounts[0]++, 0, false);
              dummy.position.set(jx + ox, h + 1 + sh + 0.3, jz + oz);
              dummy.rotation.set((xr() - 0.5) * 0.3, yaw, 0);
              dummy.scale.set(sw + 2.4, 0.5, sd + 2.4);
              dummy.updateMatrix(); scrapT.push(dummy.matrix.clone());
            }
          } else if (this.kind === 'ruins') {
            // SNAPPED TOP: the corner of the last floor still standing on one
            // side of the stump. A plain box silhouette reads as an intact
            // building however many window holes you paint on it — the broken
            // outline is what says "this was hit".
            if (xr() < 0.62 && concreteCounts[0] < capB) {
              const fw = w * (0.35 + xr() * 0.3), fd = dep * (0.35 + xr() * 0.3), fh = 4 + xr() * 9;
              const ox = (xr() - 0.5) * (w - fw), oz = (xr() - 0.5) * (dep - fd);
              dummy.position.set(jx + ox, h + fh / 2 - 0.4, jz + oz);
              dummy.rotation.set(0, yaw, 0);
              dummy.scale.set(fw, fh, fd);
              dummy.updateMatrix();
              const i = concreteCounts[0]++;
              concreteMeshes[0].setMatrixAt(i, dummy.matrix); concreteMeshes[0].setColorAt(i, tint);
            }
            // the floor slab that came down, leaning against the stump
            if (xr() < 0.6) {
              const lean = 0.4 + xr() * 0.5, side = xr() < 0.5 ? 1 : -1;
              dummy.position.set(jx + side * (w * 0.55 + 2), h * 0.42, jz + (xr() - 0.5) * dep * 0.5);
              dummy.rotation.set(0, yaw, side * lean);
              dummy.scale.set(w * 0.8, 0.9, dep * 0.7);
              dummy.updateMatrix(); scrapT.push(dummy.matrix.clone());
            }
            // rubble skirt piled against the base
            const nR = 1 + ((xr() * 3) | 0);
            for (let i = 0; i < nR; i++) {
              const a = xr() * Math.PI * 2, rr = w * 0.5 + 1 + xr() * 3;
              const rx = jx + Math.cos(a) * rr, rz = jz + Math.sin(a) * rr, s = 1.2 + xr() * 1.5;
              dummy.position.set(rx, 0.12, rz);
              dummy.rotation.set(0, xr() * Math.PI * 2, 0);
              dummy.scale.set(s * (1.4 + xr() * 0.8), s * 1.3, s * (1.4 + xr() * 0.8));
              dummy.updateMatrix();
              pileT.push({ m: dummy.matrix.clone(), c: this.junkColors[(xr() * this.junkColors.length) | 0] });
            }
            // bent rebar sticking out of the snapped top
            const nB = 2 + ((xr() * 4) | 0);
            for (let i = 0; i < nB; i++) {
              dummy.position.set(jx + (xr() - 0.5) * w * 0.8, h + 1.4 + xr() * 1.6, jz + (xr() - 0.5) * dep * 0.8);
              dummy.rotation.set((xr() - 0.5) * 0.9, xr() * 3, (xr() - 0.5) * 0.9);
              dummy.scale.set(0.22, 3 + xr() * 3, 0.22);
              dummy.updateMatrix(); rigT.push({ m: dummy.matrix.clone(), c: this.rustColor });
            }
          } else if (this.kind === 'neon') {
            this.neonSignage(jx, jz, w, dep, h, xr, dummy, signT, glowT, decalT);
          }
          dummy.rotation.set(0, 0, 0); // IMPORTANT: clear the tilt for later dummy users
        }

        // rooftop props + entrance bands — rnd() calls happen UNCONDITIONALLY
        // for ALL building types to keep the deterministic sequence stable.
        if (rnd() < 0.45) {           // AC unit / stair bulkhead on the roof
          dummy.position.set(jx + (rnd() - 0.5) * w * 0.4, h + 1.1, jz + (rnd() - 0.5) * dep * 0.4);
          dummy.scale.set(2.2 + rnd() * 2, 2.2, 2.2 + rnd() * 1.6);
          dummy.updateMatrix(); roofProps.setMatrixAt(roofCount++, dummy.matrix);
        }
        if (rnd() < 0.18) {           // antenna mast
          dummy.position.set(jx + (rnd() - 0.5) * w * 0.3, h + 3.2, jz + (rnd() - 0.5) * dep * 0.3);
          dummy.scale.set(0.35, 6.4, 0.35);
          dummy.updateMatrix(); roofProps.setMatrixAt(roofCount++, dummy.matrix);
        }
        if (rnd() < 0.32) {           // darker 2-floor entrance band at street level
          dummy.position.set(jx, 3.0, jz);
          dummy.scale.set(w + 0.5, 6.0, dep + 0.5);
          dummy.updateMatrix(); bands.setMatrixAt(bandCount++, dummy.matrix);
        }

        // NEON accents (night only): 1-2 emissive strips on SOME tall towers
        // plus a rare door-level sign board — tasteful, not Vegas soup. All
        // decisions come from a SALTED per-cell hash stream (like the street
        // props' `ph`), so the chunk rnd sequence — and therefore the day city
        // AND the existing night layout — is provably untouched.
        if (this.kind === 'night') {
          const nrnd = mulberry32((hash2(gcx * 5 + 3, gcz * 5 - 7) ^ this.seed) >>> 0);
          const tall = h >= 40;
          const nStrips = tall && nrnd() < 0.55 ? (nrnd() < 0.35 ? 2 : 1) : 0;
          for (let s = 0; s < nStrips; s++) {
            const ci = (nrnd() * this.neonMats.length) | 0;
            const face = (nrnd() * 4) | 0;        // 0:+Z 1:-Z 2:+X 3:-X
            const vert = nrnd() < 0.62;
            const along = face < 2 ? w : dep;     // facade width on that face
            const len = vert ? h * (0.40 + nrnd() * 0.25) : along * (0.45 + nrnd() * 0.25);
            const off = vert ? (nrnd() - 0.5) * along * 0.55 : 0;
            const yC = vert ? h * (0.34 + nrnd() * 0.28) : h * (0.45 + nrnd() * 0.4);
            const po = 0.33;                      // proud of the facade AND the 0.25 entrance band
            dummy.rotation.set(0, 0, 0);
            if (face < 2) {
              dummy.position.set(jx + off, yC, jz + (face === 0 ? dep / 2 + po : -dep / 2 - po));
              dummy.scale.set(vert ? 0.45 : len, vert ? len : 0.6, 0.22);
            } else {
              dummy.position.set(jx + (face === 2 ? w / 2 + po : -w / 2 - po), yC, jz + off);
              dummy.scale.set(0.22, vert ? len : 0.6, vert ? 0.45 : len);
            }
            dummy.updateMatrix();
            neonByColor[ci].push(dummy.matrix.clone());
          }
          if (nrnd() < (tall ? 0.16 : 0.08)) {    // door-level sign board
            const ci = (nrnd() * this.neonMats.length) | 0;
            const face = (nrnd() * 4) | 0;
            const sw = 3.2 + nrnd() * 2.2;
            const so = 0.55;                      // proud of the entrance band
            dummy.rotation.set(0, 0, 0);
            if (face < 2) { dummy.position.set(jx, 4.8, jz + (face === 0 ? dep / 2 + so : -dep / 2 - so)); dummy.scale.set(sw, 1.5, 0.3); }
            else { dummy.position.set(jx + (face === 2 ? w / 2 + so : -w / 2 - so), 4.8, jz); dummy.scale.set(0.3, 1.5, sw); }
            dummy.updateMatrix();
            neonByColor[ci].push(dummy.matrix.clone());
          }
        }

        // STOREFRONTS (day only) — the heart of the "town": a colored canvas
        // awning tilted over a sky-glass display-window band + a door slot,
        // plus an occasional flat sign board (no text). All decisions come
        // from the salted per-cell drnd stream; awnings batch per color like
        // the night neon, every other piece joins the single dayBoxes mesh.
        // Pieces only PROTRUDE from the existing footprint (max ~3u, all above
        // or inside the building AABB+player radius) -> colliders unchanged.
        if (lot) {
          // THE DOOR: a dark recessed frame proud of the facade, a warm leaf inside it, a step
          // slab at its foot and the kind-coloured sign board over the lintel. Everything sits
          // within 1.2 u of the facade — inside the building AABB + player radius — so the
          // colliders are untouched and the standing spot 2.6 u out is always clear.
          const [fx, fz] = lot.face;
          const doorX = lot.door.x - fx * 2.6, doorZ = lot.door.z - fz * 2.6;   // the facade point under the door
          const alongX = fz !== 0;   // the facade runs along X when the door faces ±Z
          const piece = (out: number, y: number, wAlong: number, h: number, thick: number, c: THREE.Color) => {
            dummy.rotation.set(0, 0, 0);
            dummy.position.set(doorX + fx * out, y, doorZ + fz * out);
            dummy.scale.set(alongX ? wAlong : thick, h, alongX ? thick : wAlong);
            dummy.updateMatrix(); lotBoxes.push({ m: dummy.matrix.clone(), c });
          };
          const frame = new THREE.Color(0x2a2623), leaf = new THREE.Color(0x8a5a3a), step = new THREE.Color(0x9c9890);
          const sign = new THREE.Color(LOT_COLORS[lot.kind]);
          piece(0.35, 3.6, 5.2, 7.2, 0.7, frame);          // recessed frame
          piece(0.55, 3.0, 3.2, 6.0, 0.3, leaf);           // the leaf
          piece(1.3, 0.15, 5.6, 0.3, 2.4, step);           // the step
          piece(0.7, 8.6, 6.4, 1.6, 0.5, sign);            // sign board over the lintel
          piece(1.2, 7.9, 6.8, 0.25, 1.6, sign);           // a little awning lip under it
          dummy.rotation.set(0, 0, 0);
          // the landmark an author can name: "at the hospital" — pushed FIRST so the 40-cap
          // below never crowds it out
          if (lot.civic) marks.push({ x: lot.door.x, z: lot.door.z, kind: 'lot:' + lot.archetype, name: lot.name });
        }
        if (drnd && !lot) {
          const touchesAve = oX !== 0 || oZ !== 0;
          if (drnd() < (touchesAve ? 0.62 : 0.3)) {
            let face: number; // 0:+Z 1:-Z 2:+X 3:-X — prefer the street-facing side
            if (oZ === -1) face = 1;
            else if (oZ === 1) face = 0;
            else if (oX === -1) face = 3;
            else if (oX === 1) face = 2;
            else face = (drnd() * 4) | 0;
            const fdx = face === 2 ? 1 : face === 3 ? -1 : 0;
            const fdz = face === 0 ? 1 : face === 1 ? -1 : 0;
            const half = (face < 2 ? dep : w) / 2;
            const along = face < 2 ? w : dep;
            // display-window band: light sky glass across the ground floor
            dummy.rotation.set(0, 0, 0);
            dummy.position.set(jx + fdx * (half + 0.34), 2.55, jz + fdz * (half + 0.34));
            dummy.scale.set(fdz !== 0 ? along * 0.84 : 0.3, 4.7, fdz !== 0 ? 0.3 : along * 0.84);
            dummy.updateMatrix();
            dayBoxes.push({ m: dummy.matrix.clone(), c: this.dayShopGlass });
            // door slot near one end of the band
            const doorOff = (drnd() < 0.5 ? -1 : 1) * along * 0.27;
            dummy.position.set(
              jx + fdx * (half + 0.55) + (fdz !== 0 ? doorOff : 0), 2.9,
              jz + fdz * (half + 0.55) + (fdx !== 0 ? doorOff : 0));
            dummy.scale.set(fdz !== 0 ? 3.2 : 0.24, 5.6, fdz !== 0 ? 0.24 : 3.2);
            dummy.updateMatrix();
            dayBoxes.push({ m: dummy.matrix.clone(), c: this.dayDoor });
            // awning: striped/solid canvas, tilted down over the sidewalk
            const ai = (drnd() * this.awningMats.length) | 0;
            dummy.position.set(jx + fdx * (half + 1.45), 6.6, jz + fdz * (half + 1.45));
            if (fdz !== 0) { dummy.scale.set(along * 0.9, 0.3, 3.0); dummy.rotation.set(fdz * 0.3, 0, 0); }
            else { dummy.scale.set(3.0, 0.3, along * 0.9); dummy.rotation.set(0, 0, -fdx * 0.3); }
            dummy.updateMatrix();
            if (this.awningMats.length) awningByColor[ai].push(dummy.matrix.clone());
            dummy.rotation.set(0, 0, 0); // IMPORTANT: clear the tilt for later dummy users
            // occasional flat colored sign board above the awning (no text)
            if (drnd() < 0.5) {
              dummy.position.set(jx + fdx * (half + 0.5), 9.6, jz + fdz * (half + 0.5));
              dummy.scale.set(fdz !== 0 ? along * 0.45 : 0.26, 2.0, fdz !== 0 ? 0.26 : along * 0.45);
              dummy.updateMatrix();
              dayBoxes.push({ m: dummy.matrix.clone(), c: this.signColors[(drnd() * this.signColors.length) | 0] });
            }
          }
        }
      }
    }

    const walls: THREE.Object3D[] = [];
    for (let bucket = 0; bucket < nBuck; bucket++) {
      const cm = concreteMeshes[bucket];
      cm.count = concreteCounts[bucket];
      if (concreteCounts[bucket] > 0) { cm.computeBoundingSphere(); if (cm.instanceColor) cm.instanceColor.needsUpdate = true; group.add(cm); walls.push(cm); }
      else cm.dispose();
      const gm = glassMeshes[bucket];
      gm.count = glassCounts[bucket];
      if (glassCounts[bucket] > 0) { gm.computeBoundingSphere(); if (gm.instanceColor) gm.instanceColor.needsUpdate = true; group.add(gm); walls.push(gm); }
      else gm.dispose();
    }
    // finalize rooftop props + entrance bands (no colliders — above/inside towers)
    roofProps.castShadow = false; roofProps.receiveShadow = true;
    roofProps.count = roofCount;
    if (roofCount > 0) { roofProps.computeBoundingSphere(); group.add(roofProps); }
    else roofProps.dispose();
    bands.castShadow = false; bands.receiveShadow = true;
    bands.count = bandCount;
    if (bandCount > 0) { bands.computeBoundingSphere(); group.add(bands); }
    else bands.dispose();
    // rare matte brick blocks: ONE instanced draw for the chunk (was one Mesh +
    // one outline hull per building — ~100 draw calls a view on its own).
    if (brickT.length) {
      const bricks = new THREE.InstancedMesh(this.boxGeo, this.brickMat, brickT.length);
      bricks.castShadow = false; bricks.receiveShadow = true;   // towers carry the shadow silhouette
      for (let i = 0; i < brickT.length; i++) { bricks.setMatrixAt(i, brickT[i]); bricks.setColorAt(i, brickC[i]); }
      if (bricks.instanceColor) bricks.instanceColor.needsUpdate = true;
      bricks.computeBoundingSphere(); group.add(bricks); walls.push(bricks);
    }

    // ---- sidewalks: a raised curb pad under every block cell ----
    // Each non-road cell gets one pavement slab; the avenues stay bare asphalt.
    // The slab top sits ~0.12u above the road so its edge reads as a real curb,
    // and buildings/parks sit ON it -> a clean sidewalk wraps every building and
    // park. The BOULEVARD MEDIANS ride the same mesh — a kerbed planting strip
    // is the same slab, just narrow and long. One shared InstancedMesh
    // (boxGeo + sidewalkMat) = 1 draw call / 1 pipeline for all of it.
    if (padSpots.length || medianSpots.length) {
      const pads = new THREE.InstancedMesh(this.boxGeo, this.sidewalkMat, padSpots.length + medianSpots.length);
      pads.receiveShadow = true; // catches building shadows; thin slab doesn't cast
      const pd = new THREE.Object3D();
      let pc = 0;
      for (const s of padSpots) {
        pd.position.set(s.x, 0.06, s.z);
        pd.scale.set(s.s, 0.12, s.s);
        pd.updateMatrix();
        pads.setMatrixAt(pc++, pd.matrix);
      }
      for (const m of medianSpots) {
        pd.position.set(m.x, 0.18, m.z);        // a kerb you can see over the traffic
        pd.scale.set(m.alongZ ? 7 : SP, 0.36, m.alongZ ? SP : 7);
        pd.updateMatrix();
        pads.setMatrixAt(pc++, pd.matrix);
      }
      pads.count = pc;
      pads.computeBoundingSphere();
      group.add(pads);
    }

    // ---- grass: every lawn in the chunk as ONE instanced sheet ----
    // Squares, vacant lots and (in the flavours) dirt yards all share the tile.
    // This used to be one plain Mesh per patch — 335 draw calls a view in the
    // day city, the single biggest group in the whole world.
    const groundTiles = fl ? lotSpots : lawnSpots;
    if (groundTiles.length) {
      const tiles = new THREE.InstancedMesh(this.parkGeo, this.parkMat, groundTiles.length);
      tiles.castShadow = false; tiles.receiveShadow = true;
      const ld = new THREE.Object3D();
      ld.rotation.x = -Math.PI / 2;
      for (let i = 0; i < groundTiles.length; i++) {
        const t = groundTiles[i];
        ld.position.set(t.x, 0.14, t.z);        // on top of the 0.12 curb pad
        ld.scale.set(t.s, t.s, 1);              // full-cell on a square (the tiles meet), inset on a lone lot (the curb ring shows)
        ld.updateMatrix(); tiles.setMatrixAt(i, ld.matrix);
      }
      tiles.computeBoundingSphere(); group.add(tiles);
    }

    // ---- the MONUMENT at a downtown plaza (at most one per 450u lattice) ----
    if (monT.length) {
      const mon = new THREE.InstancedMesh(this.boxGeo, this.roofPropMat, monT.length);
      mon.castShadow = true; mon.receiveShadow = true;   // a landmark that casts no shadow reads as pasted on
      for (let i = 0; i < monT.length; i++) mon.setMatrixAt(i, monT[i]);
      mon.computeBoundingSphere(); group.add(mon); walls.push(mon);
    }
    if (beaconT.length) {
      const bc = new THREE.InstancedMesh(this.boxGeo, this.lampHeadMat, beaconT.length);
      bc.castShadow = false; bc.receiveShadow = false;
      for (let i = 0; i < beaconT.length; i++) bc.setMatrixAt(i, beaconT[i]);
      bc.computeBoundingSphere(); group.add(bc);
    }

    // ---- trees: per-chunk instanced trunks + foliage + bushes ----
    const TC = treeSpots.length;
    if (TC > 0) {
      const trunkMesh = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, TC);
      // The theme's THREE foliage greens used to be three materials, so a chunk
      // paid three canopy draws (plus three outline hulls) for one row of trees.
      // Same three greens, now per-instance colour on one shared material: one
      // draw, one hull, identical palette.
      const folMesh = new THREE.InstancedMesh(this.foliageGeo, this.foliageMat, TC);
      // trees don't cast shadows (keeps the shadow pass cheap); buildings do.
      trunkMesh.castShadow = false; trunkMesh.receiveShadow = true;
      folMesh.castShadow = false; folMesh.receiveShadow = true;
      const td = new THREE.Object3D();
      for (let i = 0; i < TC; i++) {
        const s = treeSpots[i];
        const th = 7.0 + rnd() * 4.0, fr = 3.3 + rnd() * 2.0, fh = th * 1.15;   // sized against the 5.4-unit hero (street trees tower over people)
        td.rotation.set(0, 0, 0);
        td.position.set(s.x, th * 0.5, s.z); td.scale.set(1, th, 1); td.updateMatrix();
        trunkMesh.setMatrixAt(i, td.matrix);
        const fm = (rnd() * this.foliageColors.length) | 0;
        td.position.set(s.x, th + fh * 0.35, s.z); td.scale.set(fr, fh, fr);
        td.rotation.set(0, rnd() * Math.PI, 0); td.updateMatrix();
        folMesh.setMatrixAt(i, td.matrix); folMesh.setColorAt(i, this.foliageColors[fm]);
        cols.push({ minX: s.x - 1.1, maxX: s.x + 1.1, minZ: s.z - 1.1, maxZ: s.z + 1.1 });
      }
      trunkMesh.count = TC; trunkMesh.computeBoundingSphere(); group.add(trunkMesh);
      folMesh.count = TC;
      if (folMesh.instanceColor) folMesh.instanceColor.needsUpdate = true;
      folMesh.computeBoundingSphere(); group.add(folMesh);

      // bushes near trees (capped lower to keep chunks light). They join the
      // planter tops in ONE shared sphere mesh at the bottom of the chunk —
      // two near-identical greens were costing two draws and two hulls.
      const BC = Math.min(12, TC * 2);
      for (let i = 0; i < BC; i++) {
        const s = treeSpots[i % TC];
        const bx = s.x + (rnd() - 0.5) * 7, bz = s.z + (rnd() - 0.5) * 7, br = 1.1 + rnd() * 1.1;
        td.rotation.set(0, 0, 0); td.position.set(bx, br * 0.6, bz);
        td.scale.set(br * 1.4, br, br * 1.4); td.updateMatrix();
        bushT.push({ m: td.matrix.clone(), c: this.bushColor });
      }
    }

    // ---- street life: lamps, parked cars, crosswalks, benches, bins ----
    // Everything below is a per-chunk InstancedMesh sized to its exact spot
    // count (same pattern as the trees) — at most 6 extra draw calls per chunk
    // and NEVER per-prop plain Meshes (that anti-pattern melts the frame).
    const sd = new THREE.Object3D();

    // streetlights: TWO instanced meshes (dark pole + emissive head). The head
    // arm leans over the kerb; emissive does the lighting — no PointLights.
    if (lampSpots.length) {
      const poles = new THREE.InstancedMesh(this.boxGeo, this.poleMat, lampSpots.length);
      const heads = new THREE.InstancedMesh(this.boxGeo, this.lampHeadMat, lampSpots.length);
      poles.castShadow = false; poles.receiveShadow = true;
      heads.castShadow = false; heads.receiveShadow = false;
      for (let i = 0; i < lampSpots.length; i++) {
        const s = lampSpots[i];
        sd.rotation.set(0, 0, 0);
        sd.position.set(s.x, 0.12 + 5.75, s.z); sd.scale.set(0.28, 11.5, 0.28); sd.updateMatrix();
        poles.setMatrixAt(i, sd.matrix);
        sd.position.set(s.x + s.dx * 1.1, 0.12 + 11.45, s.z + s.dz * 1.1);
        sd.scale.set(s.dx !== 0 ? 2.2 : 0.7, 0.42, s.dx !== 0 ? 0.7 : 2.2);
        sd.updateMatrix();
        heads.setMatrixAt(i, sd.matrix);
      }
      poles.computeBoundingSphere(); group.add(poles);
      heads.computeBoundingSphere(); group.add(heads);
    }

    // parked cars: ONE merged-geometry InstancedMesh with per-instance paint.
    // Cars BLOCK movement and shots: each adds an AABB collider and the mesh
    // joins the walls list so raycast shots stop on it.
    if (carSpots.length) {
      const cars = new THREE.InstancedMesh(this.carGeo, this.carMat, carSpots.length);
      cars.castShadow = false; cars.receiveShadow = true;
      for (let i = 0; i < carSpots.length; i++) {
        const s = carSpots[i];
        sd.position.set(s.x, 0.01, s.z);
        sd.rotation.set(0, s.vert ? (s.flip ? 0 : Math.PI) : (s.flip ? Math.PI / 2 : -Math.PI / 2), 0);
        sd.scale.set(2.6, 2.6, 2.6); sd.updateMatrix();   // hero is 5.4 'meters-ish' tall — cars reach his chest, not his knee
        cars.setMatrixAt(i, sd.matrix);
        cars.setColorAt(i, this.carColors[s.ci]);
        // parked parallel to the avenue -> the AABB stays axis-aligned
        const hx = s.vert ? 2.7 : 6.0, hz = s.vert ? 6.0 : 2.7;   // matches the 2.6x instance scale
        cols.push({ minX: s.x - hx, maxX: s.x + hx, minZ: s.z - hz, maxZ: s.z + hz });
      }
      cars.computeBoundingSphere();
      if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
      group.add(cars); walls.push(cars);
    }

    // crosswalk zebra stripes — thin boxes flush with the road (y≈0.04)
    if (stripeSpots.length) {
      const stripes = new THREE.InstancedMesh(this.boxGeo, this.crosswalkMat, stripeSpots.length);
      stripes.castShadow = false; stripes.receiveShadow = true;
      sd.rotation.set(0, 0, 0);
      for (let i = 0; i < stripeSpots.length; i++) {
        const s = stripeSpots[i];
        sd.position.set(s.x, 0.04, s.z);
        sd.scale.set(s.alongZ ? 2.8 : 5.0, 0.07, s.alongZ ? 5.0 : 2.8); // long axis parallel to traffic
        sd.updateMatrix(); stripes.setMatrixAt(i, sd.matrix);
      }
      stripes.computeBoundingSphere(); group.add(stripes);
    }

    // benches: on the curb ring of park cells, facing the lawn (1-2 / chunk).
    // (Plaza rims and green-square kerbs already pushed theirs while the block
    // plan was laid out — they all share this one instanced mesh.)
    for (let i = 0; i < Math.min(parkSpots.length, 2); i++) {
      const p = parkSpots[i];
      const bh = (hash2(Math.round(p.x / SP) * 3 + 1, Math.round(p.z / SP) * 3 + 2) ^ this.seed) >>> 0;
      const off = SP * 0.4; // outside the grass (±10.8), inside the pad (±14.1)
      const side = bh & 3;
      if (side === 0) benchSpots.push({ x: p.x, z: p.z - off, rot: 0 });
      else if (side === 1) benchSpots.push({ x: p.x, z: p.z + off, rot: Math.PI });
      else if (side === 2) benchSpots.push({ x: p.x - off, z: p.z, rot: Math.PI / 2 });
      else benchSpots.push({ x: p.x + off, z: p.z, rot: -Math.PI / 2 });
    }
    // day sidewalk benches join the SAME instanced mesh -> zero extra draws
    for (const s of walkBenchSpots) benchSpots.push(s);
    if (benchSpots.length) {
      const benches = new THREE.InstancedMesh(this.benchGeo, this.benchMat, benchSpots.length);
      benches.castShadow = false; benches.receiveShadow = true;
      for (let i = 0; i < benchSpots.length; i++) {
        const s = benchSpots[i];
        sd.position.set(s.x, 0.12, s.z); sd.rotation.set(0, s.rot, 0); sd.scale.set(1.9, 1.9, 1.9);
        sd.updateMatrix(); benches.setMatrixAt(i, sd.matrix);
      }
      benches.computeBoundingSphere(); group.add(benches);
    }

    // trash bins near pad corners (in the slums / the ruins nobody collects
    // anything — those chunks turn the same spots into heaps further down)
    if (binSpots.length && this.kind !== 'slums' && this.kind !== 'ruins') {
      const bins = new THREE.InstancedMesh(this.binGeo, this.binMat, binSpots.length);
      bins.castShadow = false; bins.receiveShadow = true;
      sd.rotation.set(0, 0, 0); sd.scale.set(2.3, 2.3, 2.3);
      for (let i = 0; i < binSpots.length; i++) {
        sd.position.set(binSpots[i].x, 0.12, binSpots[i].z);
        sd.updateMatrix(); bins.setMatrixAt(i, sd.matrix);
      }
      bins.computeBoundingSphere(); group.add(bins);
    }

    // ---- LOT DOORS (every flavour): one instanced draw for the chunk ----
    if (lotBoxes.length) {
      const lb = new THREE.InstancedMesh(this.boxGeo, this.lotMat, lotBoxes.length);
      lb.castShadow = false; lb.receiveShadow = true;
      for (let i = 0; i < lotBoxes.length; i++) { lb.setMatrixAt(i, lotBoxes[i].m); lb.setColorAt(i, lotBoxes[i].c); }
      if (lb.instanceColor) lb.instanceColor.needsUpdate = true;
      lb.computeBoundingSphere(); group.add(lb);
    }
    // ---- DAY-ONLY: storefronts, furniture and flowers ----
    // Planters drop their terracotta box into dayBoxes and grow a bush top;
    // park flowers are tiny bright cubes; every box-shaped piece shares ONE
    // instanceColor'd InstancedMesh; awnings batch per color exactly like the
    // night neon. ≤7 extra draws per chunk, all frozen + disposed with it.
    if (this.kind === 'day') {
      for (const p of planterSpots) {
        sd.rotation.set(0, 0, 0);
        sd.position.set(p.x, 0.72, p.z);
        sd.scale.set(p.alongZ ? 1.4 : 3.6, 1.2, p.alongZ ? 3.6 : 1.4); // long axis runs along the kerb
        sd.updateMatrix();
        dayBoxes.push({ m: sd.matrix.clone(), c: this.dayPlanter });
      }
      for (const f of flowerSpots) {
        sd.rotation.set(0, 0, 0);
        sd.position.set(f.x, 0.38, f.z); sd.scale.set(0.5, 0.5, 0.5); sd.updateMatrix();
        dayBoxes.push({ m: sd.matrix.clone(), c: this.flowerColors[f.ci] });
      }
      if (dayBoxes.length && this.dayPropMat) {
        const db = new THREE.InstancedMesh(this.boxGeo, this.dayPropMat, dayBoxes.length);
        db.castShadow = false; db.receiveShadow = true;
        for (let i = 0; i < dayBoxes.length; i++) { db.setMatrixAt(i, dayBoxes[i].m); db.setColorAt(i, dayBoxes[i].c); }
        if (db.instanceColor) db.instanceColor.needsUpdate = true;
        db.computeBoundingSphere(); group.add(db);
      }
      for (let ai = 0; ai < awningByColor.length; ai++) {
        const list = awningByColor[ai];
        if (!list.length) continue;
        const aw = new THREE.InstancedMesh(this.boxGeo, this.awningMats[ai], list.length);
        aw.castShadow = false; aw.receiveShadow = true;
        for (let i = 0; i < list.length; i++) aw.setMatrixAt(i, list[i]);
        aw.computeBoundingSphere(); group.add(aw);
      }
      for (const p of planterSpots) {
        sd.rotation.set(0, 0, 0);
        sd.position.set(p.x, 1.55, p.z);
        sd.scale.set(p.alongZ ? 0.95 : 1.6, 0.8, p.alongZ ? 1.6 : 0.95);
        sd.updateMatrix();
        bushT.push({ m: sd.matrix.clone(), c: this.planterBushColor });
      }
      if (hydrantSpots.length && this.hydrantGeo && this.hydrantMat) {
        const hyd = new THREE.InstancedMesh(this.hydrantGeo, this.hydrantMat, hydrantSpots.length);
        hyd.castShadow = false; hyd.receiveShadow = true;
        sd.rotation.set(0, 0, 0); sd.scale.set(1.7, 1.7, 1.7); // ~1.6u — comic-bright kerbside red
        for (let i = 0; i < hydrantSpots.length; i++) {
          sd.position.set(hydrantSpots[i].x, 0.12, hydrantSpots[i].z);
          sd.updateMatrix(); hyd.setMatrixAt(i, sd.matrix);
        }
        hyd.computeBoundingSphere(); group.add(hyd);
      }
    }

    // ---- NIGHT-ONLY: neon strips/signs + lamp light-pool decals ----
    // One InstancedMesh per neon color that actually appears (≤4) + one pool
    // sheet (≤1) per chunk — emissive boxes and an unlit radial-fade quad,
    // NO dynamic lights, all frozen with the rest of the chunk below.
    for (let ci = 0; ci < neonByColor.length; ci++) {
      const list = neonByColor[ci];
      if (!list.length) continue;
      const neon = new THREE.InstancedMesh(this.boxGeo, this.neonMats[ci], list.length);
      neon.castShadow = false; neon.receiveShadow = false;
      for (let i = 0; i < list.length; i++) neon.setMatrixAt(i, list[i]);
      neon.computeBoundingSphere(); group.add(neon);
    }
    if (this.poolGeo && this.lampPoolMat && lampSpots.length) {
      const pools = new THREE.InstancedMesh(this.poolGeo, this.lampPoolMat, lampSpots.length);
      pools.castShadow = false; pools.receiveShadow = false;
      sd.rotation.set(0, 0, 0);
      for (let i = 0; i < lampSpots.length; i++) {
        const s = lampSpots[i];
        // centred just past the leaning lamp head, floating 0.17 over the
        // road (clears the 0.12 curb pad + 0.14 park lawns -> no z-fighting)
        sd.position.set(s.x + s.dx * 1.6, 0.17, s.z + s.dz * 1.6);
        sd.scale.set(10.5, 1, 10.5);
        sd.updateMatrix(); pools.setMatrixAt(i, sd.matrix);
      }
      pools.computeBoundingSphere(); group.add(pools);
    }

    // ---- FLAVOUR-ONLY finalize: ONE InstancedMesh per material ----
    // Seven meshes cover a whole slums/ruins/neon chunk (scrap, piles, rig,
    // glow, signs, struct, decals) and each is sized to its exact spot count,
    // exactly like the trees + street life above. Everything is frozen and
    // disposed with the chunk; the geometries are shared and survive.
    if (fl) {
      // slums/ruins: the "bin" spots become fly-tipped heaps instead
      if (this.kind === 'slums' || this.kind === 'ruins') {
        for (const b of binSpots) {
          const bh2 = (hash2(Math.round(b.x), Math.round(b.z)) ^ this.seed) >>> 0;
          const s = 1.6 + (bh2 & 7) * 0.18;
          sd.position.set(b.x, 0.12, b.z);
          sd.rotation.set(0, (bh2 % 628) / 100, 0);
          sd.scale.set(s * 1.4, s, s * 1.4);
          sd.updateMatrix();
          pileT.push({ m: sd.matrix.clone(), c: this.junkColors[bh2 % this.junkColors.length] });
          cols.push({ minX: b.x - s, maxX: b.x + s, minZ: b.z - s, maxZ: b.z + s });
        }
      }
      // streetlights throw pools here too (the night city has its own sheet)
      if (P.lampPool && this.kind !== 'night') {
        const lampTint = new THREE.Color(this.kind === 'neon' ? 0x9fd8ff : 0xffb877);
        for (const s of lampSpots) decalT.push({ x: s.x + s.dx * 1.6, z: s.z + s.dz * 1.6, s: 10.5, c: lampTint });
      }
      const addInst = (
        geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[],
        colors: THREE.Color[] | null, shadow: boolean, wall: boolean,
      ) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        im.castShadow = shadow; im.receiveShadow = shadow;
        for (let i = 0; i < list.length; i++) {
          im.setMatrixAt(i, list[i]);
          if (colors) im.setColorAt(i, colors[i]);
        }
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere(); group.add(im);
        if (wall) walls.push(im);
      };
      if (this.scrapMat) addInst(this.boxGeo, this.scrapMat, scrapT, null, true, true);
      // heaps get COLLIDERS but never join `walls`: you can shoot over knee-high
      // rubble, and it keeps the hitscan raycast list the size it already was
      if (this.pileGeo && this.pileMat) addInst(this.pileGeo, this.pileMat, pileT.map((p) => p.m), pileT.map((p) => p.c), true, false);
      if (this.rigMat) addInst(this.boxGeo, this.rigMat, rigT.map((p) => p.m), rigT.map((p) => p.c), false, false);
      if (this.glowMat) addInst(this.boxGeo, this.glowMat, glowT.map((p) => p.m), glowT.map((p) => p.c), false, false);
      if (this.signMat) addInst(this.boxGeo, this.signMat, signT.map((p) => p.m), signT.map((p) => p.c), false, false);
      if (this.structMat) addInst(this.boxGeo, this.structMat, structT, null, true, true);
      // oil drums: one cylinder mesh + a flame box that joins the glow sheet
      if (drumSpots.length && this.drumGeo && this.structMat) {
        const drums = new THREE.InstancedMesh(this.drumGeo, this.structMat, drumSpots.length);
        drums.castShadow = false; drums.receiveShadow = true;
        sd.rotation.set(0, 0, 0); sd.scale.set(1, 1, 1);
        for (let i = 0; i < drumSpots.length; i++) {
          sd.position.set(drumSpots[i].x, 0.12, drumSpots[i].z);
          sd.updateMatrix(); drums.setMatrixAt(i, sd.matrix);
        }
        drums.computeBoundingSphere(); group.add(drums); walls.push(drums);
      }
      // flat ground decals (light pools, fire pools, scorch) — ONE tinted sheet
      if (decalT.length && this.poolGeo && this.decalMat) {
        const dec = new THREE.InstancedMesh(this.poolGeo, this.decalMat, decalT.length);
        dec.castShadow = false; dec.receiveShadow = false;
        sd.rotation.set(0, 0, 0);
        for (let i = 0; i < decalT.length; i++) {
          const d = decalT[i];
          sd.position.set(d.x, 0.17, d.z);   // clears the 0.12 pad + 0.14 lot tiles
          sd.scale.set(d.s, 1, d.s);
          sd.updateMatrix(); dec.setMatrixAt(i, sd.matrix); dec.setColorAt(i, d.c);
        }
        if (dec.instanceColor) dec.instanceColor.needsUpdate = true;
        dec.computeBoundingSphere(); group.add(dec);
      }
      // NEON: additive rain puddles, each tinted by whatever sign it catches
      if (puddleT.length && this.poolGeo && this.puddleMat) {
        const pud = new THREE.InstancedMesh(this.poolGeo, this.puddleMat, puddleT.length);
        pud.castShadow = false; pud.receiveShadow = false;
        sd.rotation.set(0, 0, 0);
        for (let i = 0; i < puddleT.length; i++) {
          const p = puddleT[i];
          sd.position.set(p.x, 0.05, p.z);   // on the asphalt, under the light pools
          sd.scale.set(p.s, 1, p.s * 0.7);
          sd.updateMatrix(); pud.setMatrixAt(i, sd.matrix); pud.setColorAt(i, p.c);
        }
        if (pud.instanceColor) pud.instanceColor.needsUpdate = true;
        pud.computeBoundingSphere(); group.add(pud);
      }
    }

    // ---- shrubs: park bushes + planter tops, ONE sphere mesh for the chunk ----
    if (bushT.length) {
      const bushes = new THREE.InstancedMesh(this.bushGeo, this.bushMat, bushT.length);
      bushes.castShadow = false; bushes.receiveShadow = true;
      for (let i = 0; i < bushT.length; i++) { bushes.setMatrixAt(i, bushT[i].m); bushes.setColorAt(i, bushT[i].c); }
      if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
      bushes.computeBoundingSphere(); group.add(bushes);
    }

    // ---- NPC landmark spots: read straight from the chunk plan above ----
    // Ordered MOST DISTINCTIVE FIRST, because the cap is what an author gets:
    // the monument, the plaza and the squares are places you can actually name,
    // and they used to be crowded out by two hundred interchangeable "corner"s
    // (every avenue-facing kerb in the chunk qualified). A corner is now only a
    // REAL corner — a block cell with street on an X side AND a Z side.
    const MARK_CAP = 40;
    const mark = (mkx: number, mkz: number, kind: string) => { if (marks.length < MARK_CAP) marks.push({ x: mkx, z: mkz, kind }); };
    for (const p of parkSpots) mark(p.x, p.z, 'park');                 // "in the park"
    // flavour spots an author can actually name: "meet me at the barrel fire",
    // "under the pillar", "the empty lot". Read straight off the built plan.
    for (const d of drumSpots) mark(d.x + 3.2, d.z, 'fire');
    for (const p of lotSpots) mark(p.x, p.z, this.kind === 'ruins' ? 'crater' : 'lot');
    // lamp post: stand on the road side of the leaning head (clear avenue lane)
    for (const s of lampSpots) mark(s.x + s.dx * 2.2, s.z + s.dz * 2.2, 'lamp');
    // street corner: the kerb of a block cell that fronts two streets
    for (const p of padSpots) {
      const gx = Math.round(p.x / SP), gz = Math.round(p.z / SP);
      if (!this.isCorner(gx, gz)) continue;
      const [ex, ez] = this.outward(gx, gz);
      const edge = SP * 0.47 - 1.2;
      mark(p.x + ex * edge, p.z + ez * edge, 'corner');
    }

    // toon outline: attach black inverted-hull shells before the matrix freeze.
    this.onChunkBuilt?.(group);

    this.scene.add(group);
    // FREEZE the static chunk: bake world matrices once and stop per-frame
    // matrix recomputation (nothing in a city chunk moves). The ground plane +
    // sky + entities live outside these groups, so they still animate.
    group.updateMatrixWorld(true);
    group.traverse((o) => { o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; });
    this.loaded.set(key, { group, cols, walls, landmarks: marks });
  }

  private unloadChunk(key: string): void {
    const ch = this.loaded.get(key); if (!ch) return;
    this.scene.remove(ch.group);
    ch.group.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !this.sharedGeo.has(m.geometry)) m.geometry.dispose();
      const im = o as unknown as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.dispose();
    });
    this.loaded.delete(key);
  }

  private refreshColliders(): void {
    this.colliders.length = 0; this.wallMeshes.length = 0;
    for (const ch of this.loaded.values()) {
      for (const c of ch.cols) this.colliders.push(c);
      for (const w of ch.walls) this.wallMeshes.push(w);
    }
  }
}
