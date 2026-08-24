// @voxel-city/core — a voxel city you can walk, with a procedurally composed interior behind every door.
//
// TWO GENERATORS, ONE CONTRACT. Both return a `World`: an object that streams its own chunks around
// the player, answers `heightAt` / `blocked`, and hands out wall meshes. Nothing above this line
// knows how a street or a room is made.
//
//   createCity(scene, seed, 'night')      → a streamed city grid; every building with a door is a LOT
//   createInterior(scene, { … })          → the SemanticMap of one building, rendered
//
// The seam between them is `lotSeed(citySeed, lot.id)`: the same door always opens onto the same
// rooms, on every machine and every visit, with nothing stored.
import * as THREE from 'three';
import { CityWorld, CITY_THEMES, type CityKind, type CityTheme, type CityLot } from './cityWorld';
import { ComposedWorld } from './composedWorld';
import { compose, composeDetailed, composeSummary } from './composer/index';
import { ARCHETYPES, archetypeOf, archetypeIds } from './composer/archetypes/index';
import { LOT_ARCHETYPE, lotKindForWord, type CityLotKind } from './cityLots';
import { hash32 } from './composer/rng';
import { storyBrief, type StoryBrief } from './composer/story';
import { placeReqsOf } from './placeReqs';
import type { ArchetypeId, SemanticMap, Tier } from './composer/types';
import type { WorldScript } from './types';

// ---------------------------------------------------------------------------
// The city
// ---------------------------------------------------------------------------

/** A streamed city. `theme` is a flavour name ('day' | 'night' | 'slums' | 'ruins' | 'neon') or a
 *  CityTheme you built yourself. The returned world also answers `lots()` and `lotAt()` — the doors. */
export function createCity(
  scene: THREE.Object3D,
  seed: number,
  theme: CityKind | CityTheme = 'day',
  onChunkBuilt?: (g: THREE.Group) => void,
): CityWorld {
  const t = typeof theme === 'string' ? CITY_THEMES[theme] : theme;
  return new CityWorld(scene, seed >>> 0, t, onChunkBuilt);
}

/** THE DOOR'S IDENTITY. An interior is not stored anywhere — it is re-derived from the city seed and
 *  the lot id, so the bakery on this corner has the same rooms tomorrow, and on your friend's screen. */
export function lotSeed(citySeed: number, lotId: string): number {
  return hash32(citySeed >>> 0, lotId);
}

// ---------------------------------------------------------------------------
// The interior
// ---------------------------------------------------------------------------

export interface InteriorOptions {
  /** The layout die. For a city door: `lotSeed(citySeed, lot.id)`. */
  seed: number;
  /** Which plan to compose ('house' | 'shop' | 'school' | 'office' | 'hospital' | 'prison' | 'haunted' | …). */
  archetype: ArchetypeId | string;
  /** The story the rooms should arrange themselves around. Omit for a layout with no plot. */
  script?: WorldScript;
  /** Material style override (defaults to the archetype's own). */
  style?: string;
  /** Difficulty knob the mission graph reads. */
  tier?: Tier;
  onChunkBuilt?: (g: THREE.Group) => void;
}

/** PLAN a building without rendering it — the SemanticMap is the truth (zones, doors, locks, props,
 *  people, the critical path). Useful for tests, minimaps and anything headless. */
export function planInterior(opts: Omit<InteriorOptions, 'onChunkBuilt'>): SemanticMap {
  const arch = archetypeOf(opts.archetype);
  if (!arch) throw new Error(`unknown archetype "${opts.archetype}" — known: ${archetypeIds().join(', ')}`);
  const brief = opts.script ? storyBrief(opts.script) : undefined;
  const reqs = opts.script ? placeReqsOf(opts.script, arch, brief) : [];
  return compose(opts.seed >>> 0, arch, reqs, opts.tier ?? 'easy', brief);
}

/** Plan a building AND render it. `world.map` is the SemanticMap it was built from. */
export function createInterior(scene: THREE.Object3D, opts: InteriorOptions): ComposedWorld {
  const map = planInterior(opts);
  return new ComposedWorld(scene, map, opts.style, opts.onChunkBuilt);
}

/** The interior behind a city door, seeded off the city it stands in. */
export function createLotInterior(
  scene: THREE.Object3D,
  citySeed: number,
  lot: CityLot,
  script?: WorldScript,
  onChunkBuilt?: (g: THREE.Group) => void,
): ComposedWorld {
  return createInterior(scene, { seed: lotSeed(citySeed, lot.id), archetype: lot.archetype, script, onChunkBuilt });
}

// ---------------------------------------------------------------------------
// Re-exports — the pieces a consumer builds on
// ---------------------------------------------------------------------------
export { CityWorld, CityLayout, CITY_THEMES, cityLots, LOT_COLORS } from './cityWorld';
export type { CityKind, CityTheme, CityLot, CityProfile, AABB } from './cityWorld';
export { LOT_ARCHETYPE, lotKindForWord };
export type { CityLotKind };
export { ComposedWorld } from './composedWorld';
export { compose, composeDetailed, composeSummary };
export { ARCHETYPES, archetypeOf, archetypeIds };
export { storyBrief, kindOfPlace, roleWordOf } from './composer/story';
export type { StoryBrief };
export { placeReqsOf, nearestKind } from './placeReqs';
export { hash32, Rng, sub } from './composer/rng';
export * from './types';
export type { World } from './world';
export type { SemanticMap, Zone, Door, Place, Placement, Person, PlaceReq, Archetype, ArchetypeId, RoomKind, Tier } from './composer/types';
export { CELL, GRID } from './composer/types';
export type { Dir16, Spot } from './composer/types';
export { DIR16, DIR16_YAW, dirOf, opposite } from './composer/lut';
export { nearestStandable, resumeSpot } from './world';
export { buildProp, propMesh, propDef, propIds, allProps, styleOf, STYLES } from './props/index';
export { buildBlocky, buildCharacter, seededLook, lookSeed, randomLook } from './blocky';
export type { Blocky, BlockyLook, BlockyOpts, CreatureKind } from './blocky';
export { withCutout, dressCutout, updateCutout, disableCutout, CUT } from './cameraCutout';
export { bakeBoxAO } from './blockyKit';
