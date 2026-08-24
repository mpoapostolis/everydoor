// src/engine/composedWorld.ts
// ============================================================================
// ComposedWorld — renders a composer SemanticMap (src/engine/composer) through the World
// interface the Game already speaks. The PLAN is the truth: colliders, heights, ceilings,
// places, spots and locks all come from the map and answer identically before and after
// any chunk is built. Chunks are VISUAL ONLY: per 40-u chunk, one merged shell mesh (floor
// slabs, ceilings, wall runs clipped to the chunk, door frames), one merged mesh per finish
// MATERIAL, one merged mesh per prop part kind (solid / glass / glow), and the locked-door
// leaves that unlock() removes. Lights are placed once from the map (top priority, capped).
// Design: docs/design/2026-08-22-world-composer.md §8 "ComposedWorld contract".
//
// ---------------------------------------------------------------------------------------
// WHY A CHUNK IS A HANDFUL OF MESHES (2026-08-23 batching pass)
//
// Nothing in a composed world animates: the shell is static and so is every prop on it. The
// first cut still paid a Group of 1–3 Meshes for each prop, because the instancing rule was
// "≥ 8 copies of this id IN THIS CHUNK" and the composer's 7-u cell almost never puts 8 of
// anything inside one 40-u chunk. Measured on nine archetypes: 23–39 mesh children per chunk
// and 158–240 across the nine busiest — against a budget (design §9) of 12 and 60.
//
// So props are BAKED instead. Every non-instanced prop part is transformed into chunk space
// and merged into one buffer per part kind, and the shell's own glass (window panes) and glow
// (bulbs, flames) ride the SAME two buffers because they already share PROP_MATERIALS. What
// is left per chunk is: shell 1 + one per finish material + props solid 1 + glass 1 + glow 1,
// plus one inverted-hull child on each of the two outline-eligible meshes.
//
// The bake is cheap because the only per-copy work is a translate: the yaw-rotated vertex and
// normal arrays of (prop, style, part, yaw) are cached (16 yaws, so the second copy of a chair
// is a memcpy), and the uniform scale folds into the same loop. InstancedMesh survives only
// where a prop genuinely repeats — merging N copies costs N × the vertices, one draw call
// costs one draw call, and the crossover measured here is ~24 copies of a small prop.
// ---------------------------------------------------------------------------------------
// ============================================================================
import * as THREE from 'three';
import type { World } from './world';
import type { SemanticMap, Place, AABB, Zone, Door, WallRun, Placement } from './composer/types';
import { CELL } from './composer/types';
import { DIR16, DIR16_YAW } from './composer/lut';
import { archetypeOf } from './composer/archetypes/index';
import { buildProp, propMesh, propDef, PROP_MATERIALS, styleOf } from './props/index';
import type { PropPart, Style } from './props/types';
import { bakeBoxAO } from './blockyKit';
import { withCutout } from './cameraCutout';
import { finishMaterial, finishTint, FINISH_SCALE, type Finish } from './props/surfaces';

const CHUNK = 40;          // u per visual chunk (matches zone.chunks from the composer)
const VIEW = 3;            // chunk ring radius
const WALL_T = 1.0;        // wall thickness (u)
const MAX_LIGHTS = 6;
const DOOR_H = 10.5;       // tall doorways (owner): 2× the hero; the 8.2-u roomWorld door read squat under 20-u ceilings
/** Copies of ONE prop id in ONE chunk at which an InstancedMesh starts to beat baking it.
 *  Below it, merging trades N × the vertices for a draw call we then never make; above it the
 *  bytes win (a small prop is ~200 verts ≈ 7 KB baked, against 64 B of instance matrix).
 *  These two guards are for a future denser furnisher, not for today: measured 2026-08-23 over
 *  nine archetypes × 3 seeds, the most any prop id repeats inside one 40-u chunk is SIX, the
 *  biggest prop in the library is 600 vertices, and the worst (chunk, prop) bake is 1,888
 *  vertices — an order of magnitude under both lines. Everything bakes, which is the point. */
const INSTANCE_MIN = 24;
/** …and no prop id bakes more than this many vertices into one chunk whatever its count, so a
 *  big prop (a vignette, a machine) reaches the byte crossover well before the 24th copy. */
const MERGE_VERT_CAP = 9000;
const WIN_W = 7.4, WIN_SILL = 4.2, WIN_HEAD = 12.6;   // roomWorld window: a real hole with a sill board + head casing

/** Rendering options — the dev page cuts the roofs off to look inside; the game keeps them. */
export interface ComposedWorldOpts { ceilings?: boolean; wallCap?: number; windows?: boolean }

/** The shell palette of a style: what walls, trims, floors and ceilings are made of. */
interface ShellPal { wall: number; wallLow: number; trim: number; trimLight: number; ceilTrim: number; floor: number; floorEdge: number; ceil: number; beam?: number; glass: number; glow: number; sconce: number }
function shellPalette(st: Style): ShellPal {
  const t = st.tones;
  const stony = st.trim === 'flagstone' || st.trim === 'dirt';
  const paneled = st.trim === 'panel';
  return {
    wall: stony ? t.stone[0] : paneled ? t.metal[2] : t.stone[2],
    wallLow: stony ? t.stone[1] : paneled ? t.metal[0] : t.stone[0],          // wainscot band
    trim: stony ? t.stone[1] : paneled ? t.metal[1] : t.dark[2],
    trimLight: stony ? t.stone[0] : paneled ? t.metal[2] : t.wood[2],
    ceilTrim: stony ? t.stone[1] : paneled ? t.metal[1] : t.wood[1],
    floor: st.trim === 'plank' ? t.wood[0] : st.trim === 'tile' ? t.stone[2] : paneled ? t.metal[0] : st.trim === 'sand' ? t.accent[2] : t.stone[1],
    floorEdge: st.trim === 'plank' ? t.wood[1] : st.trim === 'tile' ? t.stone[0] : paneled ? t.metal[1] : t.stone[1],
    ceil: stony ? t.dark[2] : paneled ? t.metal[1] : t.stone[2],
    beam: st.trim === 'plank' ? t.wood[1] : undefined,
    glass: t.glass[0], glow: t.glow[2], sconce: stony ? t.metal[1] : t.metal[0],
  };
}

// ============================================================================
// THE COMPOSED LIGHT RIG — one budget for all nine styles.
//
// Composed worlds render at a FORCED renderer exposure of 1.0 (game.ts: the dungeon's 1.3
// lift would blow a white school out), so every difference between styles has to live in
// the lights themselves. Two rules came out of the 2026-08-23 darkness audit:
//
//  1. The ambient tint is NOT the style's wall albedo. `tones.stone[2]` ran from 0x7b7977
//     (dungeon, luminance 0.48) to 0xf4f1ea (shop, 0.95), so a dark style was punished
//     twice — a low `lighting.ambient` AND a dark light — and the nine styles spanned 2.2×
//     in delivered fill (dungeon 0.96 … school 2.10). The tint is now a light neutral
//     nudged toward the style's own glow colour: mood without darkness.
//  2. `lighting.exposure` is the style's MOOD multiplier, not a renderer setting (nothing
//     else in the repo reads it). haunted 0.95 renders dimmer than school 1.05 — on purpose,
//     and by a bounded amount.
//
// Delivered fill (ambient·lum + hemi·lum·½, the metric tests/lighting-interiors.test.mjs
// uses) now spans 1.56 … 2.01 across the nine styles — inside what the legacy interiors
// actually deliver once their own exposure is folded in (lab 1.49 … tower 2.15).
// ============================================================================
export interface ComposedRig {
  /** the style's place in the band: (0.9 + ½·lighting.ambient) · lighting.exposure. */
  mood: number;
  ambient: { c: number; i: number };
  hemi: { s: number; g: number; i: number };
  /** the lamp that rides the eye, so the room you stand in is never the dark one. */
  follow: { c: number; i: number; d: number };
  /** only when the map has an open-sky zone (courtyard / yard / field). */
  sun: { c: number; i: number } | null;
}
/** Ambient base tint — a light neutral, never a wall albedo. */
const RIG_AMBIENT = 0xd8dbe2;
/** Hemisphere sky base — daylight through the windows / the lit ceiling plane. */
const RIG_SKY = 0xd8e4f2;
/** Warm daylight for the key over open-air zones. */
const RIG_SUN = 0xffe9c4;
/** Fill is pulled back by this much when a sun joins, so interiors stay inside the band. */
const SUN_TRADE = 0.85;
/** Room heights the fixture rig is calibrated for (u): a broom cupboard is not a 42-u hall. */
const clampCeil = (h: number) => Math.min(48, Math.max(10, h));

function rigLerp(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t));
  const g = Math.round(((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t));
  const bl = Math.round((a & 255) + (((b & 255) - (a & 255)) * t));
  return (r << 16) | (g << 8) | bl;
}

/** The whole ambient/hemisphere/sun budget of one style. Pure — the test calls it directly. */
export function composedRig(style: Style, openSky = false): ComposedRig {
  const L = style.lighting, t = style.tones;
  const mood = (0.9 + 0.5 * L.ambient) * L.exposure;          // 1.026 (haunted) … 1.286 (school)
  const trade = openSky ? SUN_TRADE : 1;
  return {
    mood,
    ambient: { c: rigLerp(RIG_AMBIENT, t.glow[0], 0.22), i: 1.26 * mood * trade },
    hemi: { s: rigLerp(RIG_SKY, t.glow[2], 0.18), g: rigLerp(t.wood[1], 0x4a443c, 0.3), i: 0.98 * mood * trade },
    follow: { c: 0xfff0dc, i: 15 + 3 * (mood - 1), d: 48 },
    sun: openSky ? { c: RIG_SUN, i: 0.55 * mood } : null,
  };
}

/** One light fixture's pool, sized for the ceiling it hangs under (u above the zone floor). */
export function composedPool(style: Style, ceilY: number): { i: number; d: number; y: number } {
  const h = clampCeil(ceilY);
  return {
    i: Math.min(26, (11 + 0.3 * h) * style.glow),   // a 28-u hall needs more than a 14-u room
    d: Math.max(40, h * 1.9),                       // …and the pool has to REACH the floor
    y: Math.max(9, h * 0.62),                       // hung under the ceiling, not clamped to 12 u
  };
}

interface ChunkRec {
  group: THREE.Group;
  /** Geometry this chunk ALLOCATED (never the prop library's cached parts) — disposed on unload. */
  owned: THREE.BufferGeometry[];
  /** Entries this chunk pushed into wallMeshes — spliced back out on unload, or the list leaks. */
  walls: THREE.Object3D[];
  doorLeaves: Map<string, THREE.Object3D>;
}

const _c = new THREE.Color();
/** A box with the shared AO bake, tinted by one colour (vertex colours × hex). */
function tintedBox(w: number, h: number, d: number, hex: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  bakeBoxAO(g, 0.78, 1.06);
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  _c.setHex(hex);
  for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * _c.r, col.getY(i) * _c.g, col.getZ(i) * _c.b);
  return g;
}

/** World-space UVs so a finish tiles continuously across every box it covers (u,v = world coords / scale). */
function worldUV(g: THREE.BufferGeometry, scale: number, swapTop = false): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute, nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (ny > 0.5) { if (swapTop) { uv[i * 2] = z / scale; uv[i * 2 + 1] = x / scale; } else { uv[i * 2] = x / scale; uv[i * 2 + 1] = z / scale; } }
    else if (nx > 0.5) { uv[i * 2] = z / scale; uv[i * 2 + 1] = y / scale; }
    else { uv[i * 2] = x / scale; uv[i * 2 + 1] = y / scale; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const WET = /kitchen|bath|cafeteria|surgery|ward|reception|morgue|storage|garage|locker|lab\b|laundry|pantry|food|toilet|shower|sink/;
const SOFT = /bedroom|suite|living|study|library|office|lounge|attic|nursery|quarters|boss_office|meeting|reading/;
const OPEN = /yard|courtyard|field|garden|playground|park|training/;
const CELLAR = /basement|cellar|cells|dungeon|crypt|oubliette|vault|morgue|tunnel|sewer/;
/** What a room's floor is made of, by its kind and the style's world. */
function floorFinish(kind: string, st: Style): Finish {
  const k = kind.toLowerCase();
  if (OPEN.test(k)) return st.trim === 'sand' ? 'dirt' : 'grass';
  if (st.trim === 'flagstone' || st.trim === 'dirt') return CELLAR.test(k) ? 'dirt' : 'flagstone';
  if (st.trim === 'panel') return WET.test(k) ? 'tile' : 'panel';
  if (CELLAR.test(k)) return 'flagstone';
  if (WET.test(k)) return 'tile';
  if (SOFT.test(k)) return st.id.startsWith('house') || st.id === 'haunted' ? 'carpet' : 'plank';
  if (st.id === 'shop' || st.id === 'school') return /storefront|store|concourse|mall|lobby|gym|classroom|hall/.test(k) ? 'tile' : 'plank';
  return 'plank';
}
/** What a room's walls are finished with, seen from inside that room. */
function wallFinish(kind: string, st: Style): Finish {
  const k = kind.toLowerCase();
  if (st.trim === 'flagstone' || st.trim === 'dirt') return 'flagstone';
  if (st.trim === 'panel') return 'panel';
  if (CELLAR.test(k)) return 'flagstone';
  if (WET.test(k)) return 'tile';
  if (SOFT.test(k)) return 'wallpaper';
  if (st.id === 'haunted') return 'wallpaper';
  return 'plaster';
}
/** The outside of an exterior wall. */
function exteriorFinish(st: Style): Finish { return st.trim === 'flagstone' || st.trim === 'dirt' ? 'flagstone' : st.trim === 'panel' ? 'panel' : st.id === 'school' || st.id === 'shop' ? 'brick' : 'plaster'; }

export class ComposedWorld implements World {
  readonly wallMeshes: THREE.Object3D[] = [];
  /** The player's current floor index (0 = ground). Set on stairs; consulted by every query. */
  floor = 0;
  private readonly style: Style;
  private readonly chunks = new Map<string, ChunkRec>();
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly zoneChunks = new Map<string, number[]>();        // "cx,cz" → zone indices
  private readonly unlocked = new Set<string>();
  private readonly buckets = new Map<number, number[]>();           // my own 5-u buckets over map.colliders
  private readonly masks = new Map<number, { x0: number; z0: number; w: number; d: number; bits: Uint8Array }>();   // per-floor passability
  private readonly shellMat: THREE.MeshStandardMaterial;
  private lightsBuilt = false;
  private followLight: THREE.PointLight | null = null;
  private _ring = 0;
  private readonly lightRoot = new THREE.Group();

  private readonly opts: Required<ComposedWorldOpts>;
  private readonly pal: ShellPal;
  constructor(private readonly scene: THREE.Object3D, readonly map: SemanticMap, styleId?: string, private readonly onChunkBuilt?: (g: THREE.Group) => void, opts: ComposedWorldOpts = {}) {
    this.style = styleOf(styleId ?? map.style);
    this.opts = { ceilings: opts.ceilings ?? true, wallCap: opts.wallCap ?? Infinity, windows: opts.windows ?? true };
    this.pal = shellPalette(this.style);
    this.shellMat = withCutout(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    map.zones.forEach((z, i) => { for (const [cx, cz] of z.chunks) { const k = `${cx},${cz}`; let a = this.zoneChunks.get(k); if (!a) this.zoneChunks.set(k, (a = [])); a.push(i); } });
    map.colliders.forEach((c, i) => {
      for (let cx = Math.floor(c.x0 / CELL); cx <= Math.floor(c.x1 / CELL); cx++)
        for (let cz = Math.floor(c.z0 / CELL); cz <= Math.floor(c.z1 / CELL); cz++) {
          const k = this.bkey(c.floor, cx, cz); let a = this.buckets.get(k); if (!a) this.buckets.set(k, (a = [])); a.push(i);
        }
    });
    this.buildMasks();
    this.lightRoot.name = 'composed-lights';
    scene.add(this.lightRoot);
  }

  // ---------------------------------------------------------------- plan queries
  private bkey(floor: number, cx: number, cz: number): number { return ((floor + 8) & 15) * 4_000_000 + (cx + 1000) * 2000 + (cz + 1000); }

  /** Per-floor 1-u passability mask = union of zone rects and door rects; everything else is solid rock. */
  private buildMasks(): void {
    const floors = new Set<number>(this.map.zones.map((z) => z.floor));
    for (const f of floors) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const z of this.map.zones) if (z.floor === f) { x0 = Math.min(x0, z.rect.x0); z0 = Math.min(z0, z.rect.z0); x1 = Math.max(x1, z.rect.x1); z1 = Math.max(z1, z.rect.z1); }
      x0 = Math.floor(x0) - 6; z0 = Math.floor(z0) - 6; x1 = Math.ceil(x1) + 6; z1 = Math.ceil(z1) + 6;
      const w = x1 - x0 + 1, d = z1 - z0 + 1, bits = new Uint8Array(w * d);
      const mark = (ax: number, az: number, bx: number, bz: number) => {
        for (let z = Math.max(z0, Math.floor(az)); z <= Math.min(z1, Math.ceil(bz)); z++)
          for (let x = Math.max(x0, Math.floor(ax)); x <= Math.min(x1, Math.ceil(bx)); x++) bits[(z - z0) * w + (x - x0)] = 1;
      };
      for (const z of this.map.zones) if (z.floor === f) mark(z.rect.x0, z.rect.z0, z.rect.x1, z.rect.z1);
      for (const dr of this.map.doors) if (dr.floor === f) {
        const alongX = dr.yaw === 0 || dr.yaw === 8;          // door faces ±z → the opening runs along x
        const hw = dr.w / 2, hd = CELL / 2 + 1;
        if (alongX) mark(dr.x - hw, dr.z - hd, dr.x + hw, dr.z + hd); else mark(dr.x - hd, dr.z - hw, dr.x + hd, dr.z + hw);
      }
      this.masks.set(f, { x0, z0, w, d, bits });
    }
  }
  private passable(x: number, z: number, floor = this.floor): boolean {
    const m = this.masks.get(floor); if (!m) return false;
    const ix = Math.round(x) - m.x0, iz = Math.round(z) - m.z0;
    if (ix < 0 || iz < 0 || ix >= m.w || iz >= m.d) return false;
    return m.bits[iz * m.w + ix] === 1;
  }

  private zoneAt(x: number, z: number, floor = this.floor): Zone | undefined {
    for (const zn of this.map.zones) if (zn.floor === floor && x >= zn.rect.x0 && x <= zn.rect.x1 && z >= zn.rect.z0 && z <= zn.rect.z1) return zn;
    return undefined;
  }

  heightAt(x: number, z: number): number {
    const zn = this.zoneAt(x, z);
    if (!zn) return 0;
    if (zn.stairs) for (const s of zn.stairs.steps) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s.y;
    if (zn.platforms) { let best = zn.floorY; for (const p of zn.platforms) if (x >= p.x - p.w / 2 && x <= p.x + p.w / 2 && z >= p.z - p.d / 2 && z <= p.z + p.d / 2) best = Math.max(best, p.y); return best; }
    return zn.floorY;
  }
  /** Absolute lid over (x,z) on the current floor; undefined in open-sky zones / outside. */
  ceilingYAt(x: number, z: number): number | undefined { return this.zoneAt(x, z)?.ceilY; }
  get ceilingY(): number | undefined { return this.map.ceilingY; }
  floorAt(x: number, z: number): number { return this.zoneAt(x, z)?.floor ?? this.floor; }

  blocked(x: number, z: number, r = 1.6): boolean {
    const pts: [number, number][] = [[x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r], [x, z]];
    for (const [px, pz] of pts) if (!this.passable(px, pz)) return true;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = this.buckets.get(this.bkey(this.floor, cx + dx, cz + dz)); if (!list) continue;
      for (const i of list) {
        const c = this.map.colliders[i];
        if (c.id && this.unlocked.has(c.id)) continue;
        if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
      }
    }
    return false;
  }
  /** Strict superset of blocked(): door fans, boss discs and kill rects are bad places to DROP anything. */
  spawnBlocked(x: number, z: number, r = 1.6): boolean {
    if (this.blocked(x, z, r)) return true;
    for (const d of this.map.doors) if (d.floor === this.floor && (d.x - x) ** 2 + (d.z - z) ** 2 < (3 + r) ** 2) return true;
    const zn = this.zoneAt(x, z);
    if (zn?.spots.arena) { const a = zn.spots.arena; if ((a.cx - x) ** 2 + (a.cz - z) ** 2 < a.r * a.r) return true; }
    if (zn?.kill) for (const k of zn.kill) if (x >= k.x0 - r && x <= k.x1 + r && z >= k.z0 - r && z <= k.z1 + r) return true;
    return false;
  }

  /** Deterministic: the nearest standable plan spots (npc stands, zone centres) in a rotating order — no Math.random. */
  spawnRing(cx: number, cz: number): { x: number; z: number } {
    const cands: { x: number; z: number; d: number }[] = [];
    for (const zn of this.map.zones) {
      if (zn.floor !== this.floor) continue;
      for (const s of [...zn.spots.npc, zn.spots.center]) { const d = (s.x - cx) ** 2 + (s.z - cz) ** 2; if (d > 8 * 8 && d < 90 * 90 && !this.blocked(s.x, s.z, 2.1)) cands.push({ x: s.x, z: s.z, d }); }
    }
    if (!cands.length) return { x: this.map.start.x, z: this.map.start.z };
    cands.sort((a, b) => a.d - b.d);
    const pick = cands[this._ring++ % Math.min(cands.length, 12)];
    return { x: pick.x, z: pick.z };
  }
  playerStart(): { x: number; z: number } { return { x: this.map.start.x, z: this.map.start.z }; }
  landmarks(cx: number, cz: number, radius: number): { x: number; z: number; kind: string }[] {
    const r2 = radius * radius;
    const out = this.map.landmarks.filter((m) => (m.x - cx) ** 2 + (m.z - cz) ** 2 <= r2).sort((a, b) => b.priority - a.priority || ((a.x - cx) ** 2 + (a.z - cz) ** 2) - ((b.x - cx) ** 2 + (b.z - cz) ** 2));
    return out.slice(0, 24).map((m) => ({ x: m.x, z: m.z, kind: m.kind }));
  }
  places(): Place[] { return this.map.zones; }
  inside(zoneId: string, x: number, z: number): boolean { const zn = this.map.zones.find((q) => q.id === zoneId); return !!zn && x >= zn.rect.x0 && x <= zn.rect.x1 && z >= zn.rect.z0 && z <= zn.rect.z1; }
  unlock(id: string): void { this.unlocked.add(id); for (const rec of this.chunks.values()) { const leaf = rec.doorLeaves.get(id); if (leaf) { rec.group.remove(leaf); rec.doorLeaves.delete(id); const i = this.wallMeshes.indexOf(leaf); if (i >= 0) this.wallMeshes.splice(i, 1); } } }
  lock(id: string): void { this.unlocked.delete(id); for (const [key, rec] of this.chunks) { if (!rec.doorLeaves.has(id)) { const d = this.map.doors.find((q) => q.id === id); if (d && this.chunkOf(d.x, d.z) === key) this.addDoorLeaf(rec, d); } } }
  isUnlocked(id: string): boolean { return this.unlocked.has(id); }

  // ---------------------------------------------------------------- streaming
  private chunkOf(x: number, z: number): string { return `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`; }
  streamAround(px: number, pz: number, immediate = false): boolean {
    if (!this.lightsBuilt) { this.lightsBuilt = true; this.buildLights(); }
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    for (let dx = -VIEW; dx <= VIEW; dx++) for (let dz = -VIEW; dz <= VIEW; dz++) {
      const key = `${ccx + dx},${ccz + dz}`;
      if (!this.zoneChunks.has(key) || this.chunks.has(key) || this.queued.has(key)) continue;
      this.queue.push(key); this.queued.add(key);
    }
    for (const [key, rec] of this.chunks) {
      const [kx, kz] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - ccx), Math.abs(kz - ccz)) > VIEW + 1) {
        this.scene.remove(rec.group);
        this.disposeChunk(rec);
        this.chunks.delete(key);
      }
    }
    let built = false, budget = immediate ? Infinity : 2;
    while (this.queue.length && budget > 0) {
      const key = this.queue.shift()!; this.queued.delete(key);
      if (this.chunks.has(key)) continue;
      const [kx, kz] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - ccx), Math.abs(kz - ccz)) > VIEW) continue;
      this.buildChunk(kx, kz); built = true; budget--;
    }
    return built;
  }
  get liveChunks(): number { return this.chunks.size; }

  /** Give back everything ONE chunk owns: its merged buffers and its seats in wallMeshes.
   *  The prop library's cached part geometry is NOT ours to dispose — it is shared. */
  private disposeChunk(rec: ChunkRec): void {
    for (const g of rec.owned) g.dispose();
    rec.owned.length = 0;
    for (const o of rec.walls) { const i = this.wallMeshes.indexOf(o); if (i >= 0) this.wallMeshes.splice(i, 1); }
    rec.walls.length = 0;
    for (const leaf of rec.doorLeaves.values()) { const i = this.wallMeshes.indexOf(leaf); if (i >= 0) this.wallMeshes.splice(i, 1); }
  }

  /** True when the far side of a wall (1.5 u past its face) lies outside every zone on that floor → an exterior wall. */
  private exteriorSide(alongX: boolean, fixed: number, a: number, floor: number): -1 | 1 | 0 {
    const test = (s: number) => { const x = alongX ? a : fixed + s * 1.5, z = alongX ? fixed + s * 1.5 : a; return !this.map.zones.some((zn) => zn.floor === floor && x >= zn.rect.x0 - 0.2 && x <= zn.rect.x1 + 0.2 && z >= zn.rect.z0 - 0.2 && z <= zn.rect.z1 + 0.2); };
    const out = test(1) ? 1 : test(-1) ? -1 : 0;
    return out as -1 | 1 | 0;
  }

  private buildChunk(kx: number, kz: number): void {
    const key = `${kx},${kz}`;
    const x0 = kx * CHUNK, z0 = kz * CHUNK, x1 = x0 + CHUNK, z1 = z0 + CHUNK;
    const group = new THREE.Group(); group.name = `composed:${key}`;
    const rec: ChunkRec = { group, owned: [], walls: [], doorLeaves: new Map() };
    const P = this.pal, cap = this.opts.wallCap;
    /** Boxes this chunk builds only to bake into a merged buffer — disposed the moment they are in it. */
    const scratch: THREE.BufferGeometry[] = [];
    // the shell's panes and bulbs already use PROP_MATERIALS.glass / .glow, so they share the
    // props' two buffers instead of paying two more draw calls of their own
    const shell: MergeItem[] = [], glass: MergeItem[] = [], glow: MergeItem[] = [];
    const clip = (a0: number, a1: number, lo: number, hi: number): [number, number] | null => { const s = Math.max(a0, lo), e = Math.min(a1, hi); return e - s > 0.05 ? [s, e] : null; };
    const inChunk = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < z1;
    /** axis-aligned box by centre (cx, cy, cz) and size (w, h, d) — roomWorld's at() */
    const at = (list: MergeItem[], cx: number, cy: number, cz: number, w: number, h: number, d: number, hex: number) => { const g = tintedBox(w, h, d, hex); g.translate(cx, cy, cz); list.push({ geo: g }); scratch.push(g); };
    /** a box along a wall: `a` runs along the wall axis, `n` across it (wall normal) */
    const wallBox = (list: MergeItem[], alongX: boolean, a: number, fixed: number, y: number, len: number, h: number, thick: number, hex: number, nOff = 0) =>
      alongX ? at(list, a, y, fixed + nOff, len, h, thick, hex) : at(list, fixed + nOff, y, a, thick, h, len, hex);
    // textured FINISH boxes: one merged mesh per finish MATERIAL per chunk (two finishes that
    // resolve to the same shared material — headless, where nothing carries a map — are one
    // mesh, not two), world-space UVs
    const fin = new Map<THREE.Material, MergeItem[]>();
    const finBox = (f: Finish, cx: number, cy: number, cz: number, w: number, h: number, d: number, swapTop = false) => {
      const mat = finishMaterial(f, this.style);
      const g = tintedBox(w, h, d, mat.map ? 0xffffff : finishTint(f, this.style)); g.translate(cx, cy, cz); worldUV(g, FINISH_SCALE[f], swapTop);
      let l = fin.get(mat); if (!l) fin.set(mat, (l = [])); l.push({ geo: g }); scratch.push(g);
    };
    const floorOf = (zn: Zone): Finish => zn.finish?.floor ?? floorFinish(zn.kind, this.style);
    const wallOf = (zn: Zone): Finish => zn.finish?.wall ?? wallFinish(zn.kind, this.style);
    /** planks run along the room's long axis unless the data says otherwise */
    const plankSwap = (zn: Zone): boolean => { const ax = zn.finish?.plankAxis ?? 'long'; const longZ = (zn.rect.z1 - zn.rect.z0) > (zn.rect.x1 - zn.rect.x0); return ax === 'z' || (ax === 'long' && longZ); };
    const zoneBeside = (alongX: boolean, fixed: number, a: number, side: number, floor: number): Zone | undefined =>
      alongX ? this.zoneAt(a, fixed + side * 1.0, floor) : this.zoneAt(fixed + side * 1.0, a, floor);
    /** a wall body as TWO half-walls, each finished for the room it faces (exterior finish when it faces nothing) */
    const halfWall = (alongX: boolean, a: number, fixed: number, y: number, len: number, h: number, floor: number) => {
      for (const side of [-1, 1]) {
        const zn = zoneBeside(alongX, fixed, a, side, floor);
        const f = zn ? wallOf(zn) : exteriorFinish(this.style);
        const off = side * WALL_T / 4;
        if (alongX) finBox(f, a, y, fixed + off, len, h, WALL_T / 2); else finBox(f, fixed + off, y, a, WALL_T / 2, h, len);
      }
    };

    // ---- floors, floor inlay border, ceilings, beams, stairs, platforms -------------------
    for (const zi of this.zoneChunks.get(key) ?? []) {
      const zn = this.map.zones[zi];
      const cx = clip(zn.rect.x0, zn.rect.x1, x0, x1), cz = clip(zn.rect.z0, zn.rect.z1, z0, z1);
      if (!cx || !cz) continue;
      const w = cx[1] - cx[0], d = cz[1] - cz[0], mx = (cx[0] + cx[1]) / 2, mz = (cz[0] + cz[1]) / 2;
      finBox(floorOf(zn), mx, zn.floorY - 0.5, mz, w, 1, d, plankSwap(zn));
      // inlay border 1.2 u in from each wall of the zone (only the edges that fall in this chunk)
      const B = 1.2, ft = 0.06;
      if (zn.rect.x0 >= x0 && zn.rect.x0 < x1) at(shell, zn.rect.x0 + B / 2, zn.floorY + ft / 2, mz, B, ft, d, P.floorEdge);
      if (zn.rect.x1 >= x0 && zn.rect.x1 < x1) at(shell, zn.rect.x1 - B / 2, zn.floorY + ft / 2, mz, B, ft, d, P.floorEdge);
      if (zn.rect.z0 >= z0 && zn.rect.z0 < z1) at(shell, mx, zn.floorY + ft / 2, zn.rect.z0 + B / 2, w, ft, B, P.floorEdge);
      if (zn.rect.z1 >= z0 && zn.rect.z1 < z1) at(shell, mx, zn.floorY + ft / 2, zn.rect.z1 - B / 2, w, ft, B, P.floorEdge);
      if (zn.ceilY != null && this.opts.ceilings && zn.finish?.ceil !== 'none') {
        // one-sided lid facing DOWN (roomWorld parity): from above it culls away, so a camera pushed up
        // against the roof sees the room, never a slab filling the frame
        { const g = new THREE.PlaneGeometry(w, d); g.rotateX(Math.PI / 2); g.translate(mx, zn.ceilY, mz); const col = new Float32Array(g.getAttribute('position').count * 3); _c.setHex(P.ceil); for (let i = 0; i < col.length; i += 3) { col[i] = _c.r; col[i + 1] = _c.g; col[i + 2] = _c.b; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); shell.push({ geo: g }); scratch.push(g); }
        // …and a ROOF on top: the lid was a one-sided ceiling, so from outside or from above every
        // building stood open to the sky. A tinted slab in the SHELL batch (clay on houses, slate on
        // stone, panels on labs) — no material of its own, so the draw-call budget holds.
        at(shell, mx, zn.ceilY + 0.6, mz, w + 0.2, 0.6, d + 0.2, finishTint('roof', this.style));
        if (P.beam != null) {   // plank ceilings carry beams across the short axis every 5 u
          const longX = (zn.rect.x1 - zn.rect.x0) >= (zn.rect.z1 - zn.rect.z0);
          for (let a = (longX ? zn.rect.x0 : zn.rect.z0) + 2.5; a < (longX ? zn.rect.x1 : zn.rect.z1); a += 5) {
            if (longX ? (a < x0 || a >= x1) : (a < z0 || a >= z1)) continue;
            if (longX) at(shell, a, zn.ceilY - 0.28, mz, 0.6, 0.5, d, P.beam); else at(shell, mx, zn.ceilY - 0.28, a, w, 0.5, 0.6, P.beam);
          }
        }
      }
      if (zn.stairs) for (const s of zn.stairs.steps) { if (!inChunk((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2)) continue; const sw = s.x1 - s.x0, sd = s.z1 - s.z0; const hh = Math.max(0.4, s.y - zn.floorY + 0.4); at(shell, (s.x0 + s.x1) / 2, s.y - hh / 2, (s.z0 + s.z1) / 2, sw, hh, sd, P.floorEdge); }
      if (zn.platforms) for (const p of zn.platforms) { if (!inChunk(p.x, p.z)) continue; at(shell, p.x, p.y - 0.5, p.z, p.w, 1, p.d, this.style.tones.accent[0]); }
    }

    // ---- walls: segments between gaps, baseboard + wainscot + cornice, windows on exterior runs ----
    for (const run of this.map.walls) {
      const alongX = Math.abs(run.x1 - run.x0) >= Math.abs(run.z1 - run.z0);
      const a0 = alongX ? Math.min(run.x0, run.x1) : Math.min(run.z0, run.z1), a1 = alongX ? Math.max(run.x0, run.x1) : Math.max(run.z0, run.z1);
      const fixed = alongX ? run.z0 : run.x0;
      if (alongX ? (fixed < z0 - 1 || fixed >= z1 + 1) : (fixed < x0 - 1 || fixed >= x1 + 1)) continue;
      const len = a1 - a0; if (len <= 0) continue;
      const H = Math.min(run.h, cap);
      const segs: [number, number][] = [];
      let cur = a0;
      for (const [t0, t1] of [...run.gaps].sort((p, q) => p[0] - q[0])) { const g0 = a0 + t0 * len, g1 = a0 + t1 * len; if (g0 > cur) segs.push([cur, g0]); cur = Math.max(cur, g1); }
      if (cur < a1) segs.push([cur, a1]);
      for (let [s0, s1] of segs) {
        // corners: runs along z butt against runs along x (shrunk by half a wall at the RUN ends, never at door gaps) — no overlapping boxes, no flicker
        if (!alongX) { if (s0 === a0) s0 += WALL_T / 2; if (s1 === a1) s1 -= WALL_T / 2; if (s1 - s0 < 0.1) continue; }
        const c = clip(s0, s1, alongX ? x0 : z0, alongX ? x1 : z1); if (!c) continue;
        const L = c[1] - c[0], mid = (c[0] + c[1]) / 2;
        const ext = this.opts.windows && H >= WIN_HEAD + 1 ? this.exteriorSide(alongX, fixed, mid, run.floor) : 0;
        // windows: one every ~10 u on exterior segments long enough to hold a hole with margins
        const wins: number[] = [];
        if (ext !== 0 && s1 - s0 >= WIN_W + 4) { const n = Math.max(1, Math.floor((s1 - s0) / 10)); const step = (s1 - s0) / n; for (let i = 0; i < n; i++) { const wc = s0 + step * (i + 0.5); if (wc - WIN_W / 2 >= c[0] - 0.01 && wc + WIN_W / 2 <= c[1] + 0.01) wins.push(wc); } }
        if (!wins.length) halfWall(alongX, mid, fixed, run.y + H / 2, L, H, run.floor);
        else {
          // solid pieces between the holes, then each hole: under-sill, over-head, sill board, head casing, side casings, pane
          let p0 = c[0];
          for (const wc of wins) { const h0 = wc - WIN_W / 2, h1 = wc + WIN_W / 2; if (h0 > p0) halfWall(alongX, (p0 + h0) / 2, fixed, run.y + H / 2, h0 - p0, H, run.floor); p0 = h1; }
          if (p0 < c[1]) halfWall(alongX, (p0 + c[1]) / 2, fixed, run.y + H / 2, c[1] - p0, H, run.floor);
          for (const wc of wins) {
            halfWall(alongX, wc, fixed, run.y + WIN_SILL / 2, WIN_W, WIN_SILL, run.floor);
            halfWall(alongX, wc, fixed, run.y + WIN_HEAD + (H - WIN_HEAD) / 2, WIN_W, H - WIN_HEAD, run.floor);
            wallBox(shell, alongX, wc, fixed, run.y + WIN_SILL + 0.15, WIN_W + 1.2, 0.3, WALL_T + 0.8, P.trimLight);
            wallBox(shell, alongX, wc, fixed, run.y + WIN_HEAD - 0.21, WIN_W + 1.2, 0.42, WALL_T + 0.5, P.trim);
            for (const sgn of [-1, 1]) wallBox(shell, alongX, wc + sgn * (WIN_W / 2 + 0.2), fixed, run.y + (WIN_SILL + WIN_HEAD) / 2, 0.6, WIN_HEAD - WIN_SILL, WALL_T + 0.5, P.trim);   // 0.1 u into the hole: no face shares the wall's end plane
            wallBox(shell, alongX, wc, fixed, run.y + (WIN_SILL + WIN_HEAD) / 2, 0.32, WIN_HEAD - WIN_SILL, WALL_T * 0.62, P.trim);   // mullion
            wallBox(glass, alongX, wc, fixed, run.y + (WIN_SILL + WIN_HEAD) / 2, WIN_W, WIN_HEAD - WIN_SILL, 0.12, P.glass);
          }
        }
        const tl = alongX ? L : Math.max(0.1, L - 0.3), tm = mid;                                            // z-run trims stop short of the x-run trims
        wallBox(shell, alongX, tm, fixed, run.y + 0.24, tl, 0.48, WALL_T + 0.26, P.trim);                // baseboard
        if (this.style.trim === 'plank' || this.style.trim === 'tile') wallBox(shell, alongX, tm, fixed, run.y + 2.0, tl, 0.18, WALL_T + 0.18, P.trimLight);   // chair rail
        if (H >= run.h) wallBox(shell, alongX, tm, fixed, run.y + H - 0.22, tl, 0.28, WALL_T + 0.2, P.ceilTrim);   // cornice (full walls only)
      }
    }

    // ---- doors: casings INSIDE the wall's real opening, lintel + over-panel above (+ the locked leaf) ----
    /** The wall gap a door sits in, from the WallRun on that line (never from door.w — a mismatch put casings inside the wall). */
    const gapFor = (d: Door, alongX: boolean): [number, number] => {
      const line = alongX ? d.z : d.x, a = alongX ? d.x : d.z;
      for (const run of this.map.walls) {
        if (run.floor !== d.floor) continue;
        const runX = Math.abs(run.x1 - run.x0) >= Math.abs(run.z1 - run.z0);
        if (runX !== alongX || Math.abs((alongX ? run.z0 : run.x0) - line) > 0.6) continue;
        const a0 = alongX ? Math.min(run.x0, run.x1) : Math.min(run.z0, run.z1), len = Math.abs(alongX ? run.x1 - run.x0 : run.z1 - run.z0);
        for (const [t0, t1] of run.gaps) { const g0 = a0 + t0 * len, g1 = a0 + t1 * len; if (a >= g0 - 0.3 && a <= g1 + 0.3) return [g0, g1]; }
      }
      return [a - d.w / 2, a + d.w / 2];
    };
    for (const d of this.map.doors) {
      if (this.chunkOf(d.x, d.z) !== key) continue;
      const alongX = d.yaw === 0 || d.yaw === 8;     // door faces ±z → the opening runs along x
      const zn = this.map.zones.find((q) => q.id === d.between[0]);
      const y = zn?.floorY ?? 0, wallH = Math.min(zn?.ceilY != null ? zn.ceilY - y : this.style.wallH, cap);
      const fixed = alongX ? d.z : d.x;
      const [g0, g1] = gapFor(d, alongX);
      const gw = g1 - g0, gc = (g0 + g1) / 2;
      const full = wallH > DOOR_H + 0.5;
      if (full) {
        if (wallH - DOOR_H - 0.5 > 0.1) halfWall(alongX, gc, fixed, y + DOOR_H + 0.5 + (wallH - DOOR_H - 0.5) / 2, gw, wallH - DOOR_H - 0.5, d.floor);   // over-panel sits ON the lintel (bottoms never share a plane)
        wallBox(shell, alongX, gc, fixed, y + DOOR_H + 0.25, gw + 0.6, 0.5, WALL_T + 0.3, P.trim);                      // lintel
      }
      const ph = Math.min(DOOR_H, wallH), pw = 0.5;
      wallBox(shell, alongX, g0 + pw / 2, fixed, y + ph / 2, pw, ph, WALL_T + 0.3, P.trim);                              // casings flush INSIDE the opening
      wallBox(shell, alongX, g1 - pw / 2, fixed, y + ph / 2, pw, ph, WALL_T + 0.3, P.trim);
      wallBox(shell, alongX, gc, fixed, y + 0.09, gw, 0.12, WALL_T + 0.6, P.trimLight);                                  // threshold (bottom 0.03 above the floor)
      if (d.lock && !this.unlocked.has(d.lock)) this.addDoorLeaf(rec, d);
    }

    // ---- door throats: when the two zones do not touch (dungeon margins), build the passage between them ----
    for (const d of this.map.doors) {
      if (this.chunkOf(d.x, d.z) !== key) continue;
      const A = this.map.zones.find((q) => q.id === d.between[0]), B = this.map.zones.find((q) => q.id === d.between[1]);
      if (!A || !B) continue;
      const alongX = d.yaw === 0 || d.yaw === 8;         // opening runs along x → the throat runs along z
      const gap = alongX ? Math.max(A.rect.z0, B.rect.z0) - Math.min(A.rect.z1, B.rect.z1) : Math.max(A.rect.x0, B.rect.x0) - Math.min(A.rect.x1, B.rect.x1);
      if (gap <= 1.2) continue;
      const y = A.floorY, len = gap, f = floorFinish('corridor', this.style);
      const lid = A.ceilY != null && B.ceilY != null ? Math.min(A.ceilY, B.ceilY) : undefined;
      const H = Math.min(lid != null ? lid - y : this.style.wallH, cap);
      if (alongX) {
        finBox(f, d.x, y - 0.5, d.z, d.w + 1.2, 1, len);
        for (const sgn of [-1, 1]) { const wx = d.x + sgn * (d.w / 2 + 0.5); finBox(wallFinish('corridor', this.style), wx, y + H / 2, d.z, WALL_T, H, len); at(shell, wx, y + 0.24, d.z, WALL_T + 0.26, 0.48, len, P.trim); }
        if (lid != null && this.opts.ceilings) at(shell, d.x, lid + 0.3, d.z, d.w + 2, 0.6, len, P.ceil);
      } else {
        finBox(f, d.x, y - 0.5, d.z, len, 1, d.w + 1.2);
        for (const sgn of [-1, 1]) { const wz = d.z + sgn * (d.w / 2 + 0.5); finBox(wallFinish('corridor', this.style), d.x, y + H / 2, wz, len, H, WALL_T); at(shell, d.x, y + 0.24, wz, len, 0.48, WALL_T + 0.26, P.trim); }
        if (lid != null && this.opts.ceilings) at(shell, d.x, lid + 0.3, d.z, len, 0.6, d.w + 2, P.ceil);
      }
    }

    // ---- light fixtures: a sconce on the nearest wall, or a hanging lamp ------------------
    for (const l of this.map.lights) {
      if (!inChunk(l.x, l.z)) continue;
      const zn = this.zoneAt(l.x, l.z, l.floor);
      const lid = zn?.ceilY;
      const nearWall = zn ? Math.min(l.x - zn.rect.x0, zn.rect.x1 - l.x, l.z - zn.rect.z0, zn.rect.z1 - l.z) < 2.5 : false;
      if (nearWall || lid == null || !this.opts.ceilings) {
        at(shell, l.x, l.y - 0.6, l.z, 0.9, 1.2, 0.9, P.sconce);            // bracket
        at(glow, l.x, l.y + 0.3, l.z, 1.1, 1.0, 1.1, P.glow);               // flame / bulb
      } else {
        at(shell, l.x, (lid + l.y) / 2, l.z, 0.16, Math.max(0.2, lid - l.y), 0.16, P.trim);   // cord
        at(shell, l.x, l.y + 0.5, l.z, 1.8, 0.4, 1.8, P.sconce);           // shade
        at(glow, l.x, l.y - 0.2, l.z, 1.2, 0.9, 1.2, P.glow);               // bulb
      }
    }

    // ---- props: InstancedMesh only where a prop really repeats; everything else is BAKED ----
    const byProp = new Map<string, Placement[]>();
    // the KEY itself is a pickable item the game spawns at map.keys[].spot — never a static prop on the pedestal
    const keyProps = new Set(['core_key', 'core_keycard']);
    for (const p of this.map.placements) { if (this.chunkOf(p.x, p.z) !== key) continue; if (keyProps.has(p.prop) && this.map.keys.length) continue; let a = byProp.get(p.prop); if (!a) byProp.set(p.prop, (a = [])); a.push(p); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3();
    const solid: MergeItem[] = [];
    const bucketOf = (kind: PropPart['kind']): MergeItem[] => (kind === 'solid' ? solid : kind === 'glass' ? glass : glow);
    let bakedCollides = false;
    for (const [id, list] of byProp) {
      let geo; try { geo = buildProp(id, this.style); } catch { continue; }   // a pending family id must never kill a chunk
      const def = propDef(id);
      const onWall = def?.place === 'wall';
      const pos = (p: Placement): [number, number, number] => { const [fx, fz] = DIR16[p.yaw]; const k = onWall ? 0.08 : 0; return [p.x + fx * k, p.y + 0.02, p.z + fz * k]; };   // 0.02 u off the floor, wall props 0.08 u off the wall: no face ever shares a plane with the shell
      let verts = 0; for (const part of geo.parts) verts += part.geo.getAttribute('position').count;
      if (list.length >= (def?.minInstances ?? INSTANCE_MIN) || list.length * verts > MERGE_VERT_CAP) {
        for (const part of geo.parts) {
          const im = new THREE.InstancedMesh(part.geo, PROP_MATERIALS[part.kind], list.length);
          list.forEach((p, i) => { q.setFromAxisAngle(UP, DIR16_YAW[p.yaw]); v.set(...pos(p)); s3.setScalar(p.scale || 1); im.setMatrixAt(i, m4.compose(v, q, s3)); });
          im.instanceMatrix.needsUpdate = true; im.castShadow = im.receiveShadow = part.kind === 'solid'; if (part.kind !== 'solid') im.userData.noOutline = true; group.add(im);
          if (part.kind === 'solid' && list.some((p) => p.collide)) { this.wallMeshes.push(im); rec.walls.push(im); }
        }
      } else {
        for (const p of list) {
          const [px, py, pz] = pos(p), sc = p.scale || 1;
          for (let i = 0; i < geo.parts.length; i++) {
            const part = geo.parts[i];
            const t = yawTemplate(id, this.style.id, i, part.geo, p.yaw);
            bucketOf(part.kind).push({ geo: part.geo, pos: t.pos, nrm: t.nrm, s: sc, ox: px, oy: py, oz: pz });
          }
          if (p.collide) bakedCollides = true;
        }
      }
    }

    const addMerged = (items: MergeItem[], mat: THREE.Material, outline: boolean, solidMesh: boolean, blocker = solidMesh, uvs = false) => {
      if (!items.length) return;
      const merged = mergeGeos(items, uvs); if (!merged) return;
      const m = new THREE.Mesh(merged, mat); m.castShadow = m.receiveShadow = solidMesh; if (!outline) m.userData.noOutline = true;
      group.add(m); rec.owned.push(merged); if (blocker) { this.wallMeshes.push(m); rec.walls.push(m); }
    };
    addMerged(shell, this.shellMat, true, true);
    // finishes are HALF-walls (0.5 u): an inverted-hull outline on them pokes through the other half as
    // dark hatching — so no ink on finishes; the trims (baseboard, casings, cornice) carry the line work
    for (const [mat, list] of fin) addMerged(list, mat, false, true, true, true);   // the only buffers that carry UVs: their material samples a finish map
    addMerged(solid, PROP_MATERIALS.solid, true, true, bakedCollides);   // one hull for every baked prop in the chunk
    addMerged(glass, PROP_MATERIALS.glass, false, false);
    addMerged(glow, PROP_MATERIALS.glow, false, false);
    for (const g of scratch) g.dispose();   // the merge copied every byte out; the boxes themselves are litter

    this.scene.add(group);
    this.chunks.set(key, rec);
    this.onChunkBuilt?.(group);
  }

  private addDoorLeaf(rec: ChunkRec, d: Door): void {
    const arch = archetypeOf(this.map.archetype);
    const id = arch?.lockKit.door ?? 'core_door_locked';
    let leaf: THREE.Object3D;
    try { leaf = propMesh(id, this.style); } catch { leaf = propMesh('core_door_locked', this.style); }
    const zn = this.map.zones.find((q) => q.id === d.between[0]);
    leaf.position.set(d.x, zn?.floorY ?? 0, d.z);
    leaf.rotation.y = DIR16_YAW[d.yaw];
    const lw = (leaf.userData.aabb?.[0] as number | undefined) ?? 9.1, lh = (leaf.userData.aabb?.[1] as number | undefined) ?? 8.8;   // the leaf fills the opening whatever the cell size / door height
    if (lw > 0 && Math.abs(d.w - lw) > 0.2) leaf.scale.x = d.w / lw;
    if (lh > 0 && Math.abs(DOOR_H - lh) > 0.2) leaf.scale.y = DOOR_H / lh;
    leaf.userData.doorId = d.lock;
    rec.group.add(leaf); rec.doorLeaves.set(d.lock!, leaf); this.wallMeshes.push(leaf);
  }

  // ---------------------------------------------------------------- lights
  /** Room height (u) the fixture rig is sized for when a zone has no ceiling of its own. */
  private ceilRef(): number {
    let sum = 0, n = 0;
    for (const z of this.map.zones) { if (z.ceilY === undefined) continue; sum += z.ceilY - z.floorY; n++; }
    return n ? clampCeil(sum / n) : this.style.wallH;
  }
  private buildLights(): void {
    // ONE calibrated rig for every style — composedRig() below is the whole budget, and
    // tests/lighting-budget.test.mjs pins each style to it. Fixture pools are sized from the
    // ceiling they hang under (composedPool), because a 20-u clamp cannot light a 28-u hall.
    const openSky = this.map.zones.some((z) => z.ceilY === undefined);
    const rig = composedRig(this.style, openSky);
    this.lightRoot.add(new THREE.AmbientLight(rig.ambient.c, rig.ambient.i));
    this.lightRoot.add(new THREE.HemisphereLight(rig.hemi.s, rig.hemi.g, rig.hemi.i));
    if (rig.sun) {
      // A courtyard / yard / sports field is OUTSIDE: without a key it renders as a flat grey
      // pool of ambient with no shape at all. No shadow map (the composed shell is static and
      // game.ts only re-renders shadows for the outdoor sun), so the fill is pulled back by
      // the same factor the key adds — the interiors stay inside the band either way.
      const sun = new THREE.DirectionalLight(rig.sun.c, rig.sun.i);
      sun.position.set(-140, 230, 110); sun.castShadow = false;
      this.lightRoot.add(sun, sun.target);
    }
    const L = this.style.lighting;
    const picked = [...this.map.lights].sort((a, b) => b.priority - a.priority).slice(0, Math.min(MAX_LIGHTS, Math.max(3, L.pointLights)));
    const ref = this.ceilRef();
    for (const l of picked) {
      const zn = this.zoneAt(l.x, l.z, l.floor);
      const base = zn?.floorY ?? 0;
      const h = zn?.ceilY !== undefined ? clampCeil(zn.ceilY - base) : ref;
      const p = composedPool(this.style, h);
      const pl = new THREE.PointLight(l.color, p.i, Math.min(120, Math.max(p.d, l.r * 2.5)), 1.4);   // a pool, never a floodlight across the map
      pl.position.set(l.x, Math.min(l.y, base + p.y), l.z);
      this.lightRoot.add(pl);
    }
    this.followLight = new THREE.PointLight(rig.follow.c, rig.follow.i, rig.follow.d, 1.4);   // rides the eye: the room you are in is always lit
    this.lightRoot.add(this.followLight);
  }
  onFrame(camera: THREE.PerspectiveCamera, eye?: THREE.Vector3): void {
    if (this.followLight) this.followLight.position.copy(eye ?? camera.position);
    const f = this.floorAt(camera.position.x, camera.position.z);
    if (f !== this.floor && this.zoneAt(camera.position.x, camera.position.z)?.kind === 'stairs') this.floor = f;
  }
  dispose(): void {
    for (const [, rec] of this.chunks) { this.scene.remove(rec.group); this.disposeChunk(rec); }
    this.chunks.clear(); this.wallMeshes.length = 0; this.scene.remove(this.lightRoot); this.shellMat.dispose();
  }
}
const UP = new THREE.Vector3(0, 1, 0);

// ============================================================================
// STATIC BATCHING
// ============================================================================

/** One geometry to bake into a chunk's merged buffer. `pos` / `nrm` stand in for the source
 *  attributes (the cached yaw-rotated copy of a prop part); `s` scales about the prop origin
 *  and `ox/oy/oz` move it into chunk space. All four are absent for a shell box, which is
 *  already built where it stands — that case is a straight typed-array copy. */
export interface MergeItem { geo: THREE.BufferGeometry; pos?: Float32Array; nrm?: Float32Array; s?: number; ox?: number; oy?: number; oz?: number }

/** Merge geometries that all carry indexed position/normal/color (+ optional uv) into ONE
 *  buffer — the whole point of the chunk: a draw call per material instead of per object.
 *  Vertex colours and UVs come across untouched, so the finish textures still tile and the
 *  camera-cutout / reveal shaders (which key off the MATERIAL) are none the wiser. */
export function mergeGeos(items: MergeItem[], uvs = true): THREE.BufferGeometry | null {
  let verts = 0, idx = 0;
  for (const it of items) { verts += it.geo.getAttribute('position').count; idx += it.geo.index!.count; }
  if (!verts) return null;
  const pos = new Float32Array(verts * 3), nrm = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
  const uv = uvs ? new Float32Array(verts * 2) : null;   // only the FINISH buffers sample a map; 8 B/vertex nobody reads is 8 B wasted
  const index = verts > 65536 ? new Uint32Array(idx) : new Uint16Array(idx);   // a chunk that fits in 16 bits pays half the index bytes
  let vo = 0, io = 0;
  for (const it of items) {
    const g = it.geo;
    const pa = g.getAttribute('position') as THREE.BufferAttribute, count = pa.count;
    const p = it.pos ?? (pa.array as Float32Array), n = it.nrm ?? ((g.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array);
    const s = it.s ?? 1, ox = it.ox ?? 0, oy = it.oy ?? 0, oz = it.oz ?? 0;
    if (s === 1 && ox === 0 && oy === 0 && oz === 0) pos.set(p, vo * 3);
    else for (let i = 0, o = vo * 3; i < count; i++, o += 3) { pos[o] = p[i * 3] * s + ox; pos[o + 1] = p[i * 3 + 1] * s + oy; pos[o + 2] = p[i * 3 + 2] * s + oz; }
    nrm.set(n, vo * 3);   // uniform scale + yaw: the rotated normals are already unit length
    const c = g.getAttribute('color') as THREE.BufferAttribute | undefined; if (c) col.set(c.array as Float32Array, vo * 3);
    if (uv) { const t = g.getAttribute('uv') as THREE.BufferAttribute | undefined; if (t) uv.set(t.array as Float32Array, vo * 2); }
    const ix = g.index!.array; for (let i = 0; i < ix.length; i++) index[io + i] = ix[i] + vo;
    vo += count; io += ix.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** (prop, style, part, yaw) → that part's vertices and normals turned about +y ONCE. There are
 *  16 yaws, so the second chair of a chunk — and every chair of every later chunk — is a memcpy.
 *
 *  SIZED BY MEASUREMENT, and the measurement is humbling: sweeping this cap from 0 (no cache at
 *  all) to 8 MB over nine archetypes × 3 seeds moved chunk build time 0.41 → 0.46 ms — i.e. not
 *  at all. Six multiplies a vertex disappear next to the copy that has to happen either way. So
 *  the cache stays SMALL: big enough for the case that could bite (one prop id at one yaw filling
 *  a chunk, just under the instancing threshold), far too small to compete with the 4 MB geometry
 *  budget. Bounded by BYTES, not entries — templates run 2–14 KB each, so an entry count would let
 *  a world tour hold tens of MB. FIFO past the cap: the oldest rotation is the one no live chunk
 *  is asking for. */
const TPL_BYTES_MAX = 512 << 10;
const tplCache = new Map<string, { pos: Float32Array; nrm: Float32Array }>();
let tplBytes = 0;
const NO_TPL: { pos?: Float32Array; nrm?: Float32Array } = {};
export function yawTemplate(id: string, styleId: string, part: number, geo: THREE.BufferGeometry, yaw: number): { pos?: Float32Array; nrm?: Float32Array } {
  const a = DIR16_YAW[yaw];
  if (!a) return NO_TPL;                                   // yaw 0: the part's own arrays already are the template
  const key = `${id}|${styleId}|${part}|${yaw}`;
  let hit = tplCache.get(key);
  if (!hit) {
    const sp = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const sn = (geo.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
    const c = Math.cos(a), s = Math.sin(a);
    const pos = new Float32Array(sp.length), nrm = new Float32Array(sn.length);
    for (let i = 0; i < sp.length; i += 3) { pos[i] = c * sp[i] + s * sp[i + 2]; pos[i + 1] = sp[i + 1]; pos[i + 2] = -s * sp[i] + c * sp[i + 2]; }
    for (let i = 0; i < sn.length; i += 3) { nrm[i] = c * sn[i] + s * sn[i + 2]; nrm[i + 1] = sn[i + 1]; nrm[i + 2] = -s * sn[i] + c * sn[i + 2]; }
    hit = { pos, nrm };
    tplCache.set(key, hit);
    tplBytes += pos.byteLength + nrm.byteLength;
    while (tplBytes > TPL_BYTES_MAX && tplCache.size > 1) {
      const oldest = tplCache.keys().next().value!;
      const drop = tplCache.get(oldest)!;
      tplBytes -= drop.pos.byteLength + drop.nrm.byteLength;
      tplCache.delete(oldest);
    }
  }
  return hit;
}
/** Bytes the rotation cache holds right now — the perf test pins it under its cap. */
export const yawTemplateBytes = (): number => tplBytes;
/** Drop every cached rotation (a hard world teardown; a test that wants a cold measurement). */
export function clearYawTemplates(): void { tplCache.clear(); tplBytes = 0; }
