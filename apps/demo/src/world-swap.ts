// apps/demo/src/world-swap.ts — the door, and what is behind it.
//
// THE WHOLE DEMO IS THIS FILE. A city is a streamed grid of buildings, and every building with a
// street door is a LOT: an id, a kind, a doorway and the archetype it opens onto. Walking into one
// swaps the world underneath the player for a composed interior; walking back out through the
// entrance rebuilds the city exactly as it was, at that same doorstep.
//
// NOTHING IS SAVED. The interior is re-derived every time from `lotSeed(citySeed, lot.id)`, so the
// bakery on this corner has the same rooms tomorrow, on any machine, with no state anywhere. That
// identity is the reason the swap can be this brutal: tear the scene down, build the other one.
import * as THREE from 'three';
import {
  createCity, createInterior, cityLots, lotSeed, hash32,
  CITY_THEMES, DIR16_YAW, nearestStandable,
  type CityKind, type CityLot, type CityWorld, type ComposedWorld, type World, type WorldScript,
} from '@everydoor/core';
import { spawnPeople, type Extra } from './people';

export type Place =
  | { kind: 'city'; world: CityWorld; theme: CityKind }
  | { kind: 'interior'; world: ComposedWorld; lot: CityLot | null; archetype: string };

export interface SwapEvents {
  onCity(theme: CityKind, world: CityWorld): void;
  onInterior(world: ComposedWorld): void;
}

/** Free every buffer and texture a torn-down world left behind. Three keeps no ownership graph,
 *  so a swap that only detaches the group leaks the whole city into GPU memory.
 *
 *  TWO THINGS MUST SURVIVE. The prop library's materials are module-level and shared by every
 *  building ever composed — they carry `userData.__hullShared` and disposing one blanks the props
 *  of every world after this. And an InstancedMesh keeps `instanceMatrix` / `instanceColor` GPU
 *  buffers alive past `geometry.dispose()`, so the mesh itself has to be disposed too or a city's
 *  street furniture leaks across every swap. Everything else here is per-world and dies with it.  */
function disposeTree(root: THREE.Object3D): void {
  const seen = new Set<object>();                                  // chunks share buffers — free each once
  root.traverse((o) => {
    const m = o as THREE.Mesh & { isInstancedMesh?: boolean; dispose?: () => void };
    if (m.geometry && !seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.dispose(); }
    if (m.isInstancedMesh) m.dispose?.();
    const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    for (const one of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (one.userData?.__hullShared || seen.has(one)) continue;    // the prop library owns the shared ones
      seen.add(one);
      const tex = one as unknown as { map?: THREE.Texture; emissiveMap?: THREE.Texture };
      tex.map?.dispose();
      tex.emissiveMap?.dispose();
      one.dispose();
    }
  });
  root.clear();
}

/** How many streaming passes a fresh world gets before the player is allowed to look at it.
 *  NOT the whole world: building every chunk up front is what a swap used to cost, and most of it
 *  is scenery you have your back to. Both generators queue nearest-first, so these passes lay down
 *  the ground you are standing on and the walls around it; the loop fills the rest in over the next
 *  handful of frames, which are frames that actually render. */
const WARM_PASSES = 4;
const warm = (world: World, x: number, z: number): void => {
  for (let i = 0; i < WARM_PASSES; i++) world.streamAround(x, z);
};

export class WorldSwap {
  readonly root = new THREE.Group();
  place!: Place;
  extras: Extra[] = [];
  /** The city we walked in from — rebuilt exactly on the way out, seed and flavour included. */
  private from: { seed: number; theme: CityKind; lot: CityLot } | null = null;

  constructor(scene: THREE.Scene, private readonly ev: SwapEvents, public seed = 1337, public theme: CityKind = 'day') {
    scene.add(this.root);
  }

  get world(): World { return this.place.world; }

  // -- city ----------------------------------------------------------------------------------

  /** Build (or rebuild) the street. Returns the spot the player should stand on. */
  city(seed = this.seed, theme = this.theme): { x: number; z: number; yaw: number } {
    this.reset();
    this.seed = seed >>> 0; this.theme = theme;
    const world = createCity(this.root, this.seed, CITY_THEMES[theme]);
    this.place = { kind: 'city', world, theme };
    const start = world.playerStart();
    warm(world, start.x, start.z);
    const spot = nearestStandable(world, start.x, start.z);
    this.ev.onCity(theme, world);
    return { ...spot, yaw: 0 };
  }

  // -- interiors -----------------------------------------------------------------------------

  /** Walk into a street door of the city we are standing in. */
  enterLot(lot: CityLot, script?: WorldScript, style?: string): { x: number; z: number; yaw: number } {
    return this.enterFrom(this.seed, this.theme, lot, script, style);
  }

  /** Walk into a door of a NAMED city — which we may never have built. See `randomize`. */
  private enterFrom(seed: number, theme: CityKind, lot: CityLot, script?: WorldScript, style?: string) {
    this.reset();
    const world = createInterior(this.root, { seed: lotSeed(seed, lot.id), archetype: lot.archetype, script, style });
    this.seed = seed; this.theme = theme;
    this.from = { seed, theme, lot };
    return this.settle(world, lot, lot.archetype);
  }

  /** Compose an interior on its own, with no city behind it (the panel's archetype jump). */
  standalone(archetype: string, seed = this.seed, script?: WorldScript, style?: string): { x: number; z: number; yaw: number } {
    this.reset();
    const world = createInterior(this.root, { seed: seed >>> 0, archetype, script, style: style || undefined });
    this.from = null;
    return this.settle(world, null, archetype);
  }

  /** EVERYTHING, FROM SCRATCH: a new seed redeals the whole city — its streets, its buildings and
   *  the lot table — and then this walks you through one of its doors. The door is picked FROM THE
   *  SEED, not from a die, so typing that seed back reproduces the entire trip: same city, same
   *  flavour, same building, same rooms. `pick` is the story to furnish the chosen archetype with. */
  randomize(
    seed: number,
    theme: CityKind,
    pick: (archetype: string) => WorldScript | undefined,
    opts: { style?: string; archetype?: string } = {},
  ): { x: number; z: number; yaw: number } {
    // THE LOT TABLE IS A PURE FUNCTION. `cityLots` deals the doors from the seed with no geometry
    // behind it, so picking one costs a fraction of a millisecond — this used to build the entire
    // city (a 7×7 ring of chunks) just to read the table and then throw it away one line later.
    // The street is built for real on the way OUT, when you actually have to stand on it.
    const lots = cityLots(seed, theme);
    // an archetype was asked for: enter a door of the new city that actually opens onto it, so the
    // street behind you is real. `castle` and `dungeon` are nobody's front door — those compose
    // standalone, and "↩ street" drops you into this seed's city anyway.
    const named = opts.archetype ? lots.filter((l) => l.archetype === opts.archetype) : [];
    if (opts.archetype && !named.length) {
      this.seed = seed; this.theme = theme;
      return this.standalone(opts.archetype, seed, pick(opts.archetype), opts.style);
    }
    // otherwise prefer a civic door: the deliberately varied ones (a school, a hospital, a precinct)
    const civic = lots.filter((l) => l.civic);
    const pool = named.length ? named : civic.length ? civic : lots;
    const lot = pool[hash32(seed, 'door') % pool.length];
    return this.enterFrom(seed, theme, lot, pick(lot.archetype), opts.style);
  }

  /** Back out onto the pavement, in front of the building we just left, facing the street. */
  exitLot(): { x: number; z: number; yaw: number } | null {
    const from = this.from;
    if (!from) return null;
    this.city(from.seed, from.theme);
    const { lot } = from;
    // step OUT along the lot's own facing normal, so we land on the pavement and not in the wall
    const x = lot.door.x + lot.face[0] * 3.2, z = lot.door.z + lot.face[1] * 3.2;
    const w = this.place.world as CityWorld;
    w.streamAround(x, z, true);
    const spot = nearestStandable(w, x, z);
    return { ...spot, yaw: Math.atan2(lot.face[0], lot.face[1]) };
  }

  /** The seed the current lot's rooms were derived from — shown in the panel, and the whole
   *  reason a door is reproducible. */
  currentLotSeed(): number | null {
    return this.place.kind === 'interior' && this.place.lot ? lotSeed(this.from?.seed ?? this.seed, this.place.lot.id) : null;
  }

  /** How far the player is from the way out: the interior's entrance (or the city, which has none). */
  exitDistance(x: number, z: number): number {
    if (this.place.kind !== 'interior') return Infinity;
    const s = this.place.world.map.start;
    return Math.hypot(s.x - x, s.z - z);
  }

  private settle(world: ComposedWorld, lot: CityLot | null, archetype: string): { x: number; z: number; yaw: number } {
    this.place = { kind: 'interior', world, lot, archetype };
    const s = world.map.start;
    warm(world, s.x, s.z);
    this.extras = spawnPeople(this.root, world.map);
    this.ev.onInterior(world);
    const spot = nearestStandable(world, s.x, s.z);
    // face INTO the rooms: the entrance spot's yaw points the way the plan wants you to walk
    return { ...spot, yaw: DIR16_YAW[s.yaw] ?? 0 };
  }

  private reset(): void {
    disposeTree(this.root);
    this.extras = [];
  }
}
