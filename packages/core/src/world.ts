import * as THREE from 'three';

// ============================================================================
// The World interface every environment implements. The Game orchestrator only
// talks to a world through this — so adding a new world (city, snow, forest,
// cemetery, dungeon…) never touches game.ts beyond the factory.
// ============================================================================
export interface World {
  /** Stream chunks around a world position (cheap when the player stays put).
   *  Building is AMORTIZED: a crossing enqueues the new ring and only a couple of
   *  chunks are built per call, so a new grid never stalls a frame. Pass
   *  immediate=true (initial load / teleport) to build the whole ring at once.
   *  Returns true when at least one chunk was built this call (so the caller can
   *  pre-warm GPU pipelines for the freshly added geometry). */
  streamAround(px: number, pz: number, immediate?: boolean): boolean;
  /** Ground height at (x,z). Flat worlds return a constant (e.g. 0). */
  heightAt(x: number, z: number): number;
  /** True if (x,z) (with player radius r) is inside a solid collider. */
  blocked(x: number, z: number, r?: number): boolean;
  /** True if (x,z) is a BAD place to DROP an entity — inside a collider OR under a
   *  wide prop the movement collider ignores (a tree canopy, palm fronds, a bush).
   *  Stricter than blocked(): trees keep a small trunk collider so you can walk up
   *  to them, but nothing should ever SPAWN inside the leaves. Worlds without soft
   *  props omit this and callers fall back to blocked(). */
  spawnBlocked?(x: number, z: number, r?: number): boolean;
  /** A player-relative spawn point on the navigable area around (cx,cz). */
  spawnRing(cx: number, cz: number): { x: number; z: number };
  /** Notable PROCEDURAL spots within `radius` of (cx,cz) — a rock formation, a
   *  palm cluster, the shore line, a street corner, a chamber center… So an
   *  authored NPC wish ("she's by the north rocks") can be SNAPPED to the most
   *  interesting nearby place instead of standing on featureless ground.
   *
   *  Contract:
   *   - Best-effort and CHEAP: read whatever the generator ALREADY placed
   *     (loaded chunks / the layout plan); never draw new randoms (determinism
   *     stays untouched) and never allocate beyond the returned array.
   *   - Each spot SHOULD be standable/clear, but the caller re-validates anyway
   *     (blocked / underwater), so a near-miss is fine.
   *   - Deterministic per seed: the same (cx,cz,radius) yields the same spots.
   *   - Cap the output (~24) so the caller's nearest-search stays cheap.
   *  `kind` is a short tag (e.g. 'rock', 'palm', 'shore', 'corner', 'chamber')
   *  for debug/verification. Worlds without notable spots omit this. */
  landmarks?(cx: number, cz: number, radius: number): { x: number; z: number; kind: string }[];
  /** Optional fixed player START spot, clear of geometry (e.g. the house's
   *  entrance room). Worlds without one spawn the player at the origin. */
  playerStart?(): { x: number; z: number };
  /** Meshes that block hitscan shots (buildings / rocks / gravestones…). */
  readonly wallMeshes: THREE.Object3D[];
  /** Live streamed chunk count (for debug/verification). */
  readonly liveChunks: number;
  /** Indoor ceiling plane height, when the world HAS one — the third-person
   *  camera clamps just below it (above it, the ceiling backface-culls and
   *  you see the void). Outdoor worlds omit it. */
  readonly ceilingY?: number;
  /** Sea surface height for worlds with water (beach) — spawn placement
   *  treats ground at/below it as unsuitable. */
  readonly seaLevel?: number;
  /** Optional per-frame hook (e.g. the dungeon's flashlight follows the camera).
   *  `camera` is the PLAYER ANCHOR (at eye height, inside the hero's head in third
   *  person) — use it for the look DIRECTION and for anything that should track the
   *  player. `eye` is where the shot is actually taken from (behind + above the hero,
   *  or the cinematic camera during a scene); a camera-follow light belongs THERE, or
   *  it sits inside the character and blows them out. Falls back to the anchor. */
  onFrame?(camera: THREE.PerspectiveCamera, eye?: THREE.Vector3): void;
}

/** NEAREST STANDING ROOM to (cx,cz) for a body of radius `r` — a deterministic
 *  golden-angle spiral outward, no randomness, so the same request always answers the
 *  same. Returns (cx,cz) unchanged when it is already clear, and (cx,cz) unchanged when
 *  the point is boxed in everywhere inside `maxR` (the caller decides what to do then).
 *
 *  ONE definition of "where a body may stand", shared by every placement path: the
 *  player's start (safeStart), a co-op respawn, and a CONTINUE that restores a saved
 *  position. Save restore used to skip the check entirely and could seal the player
 *  inside solid geometry with no way out — movement is a pure destination test, so a
 *  body that starts inside a collider can never leave one. */
export function nearestStandable(
  world: Pick<World, 'blocked'>, cx: number, cz: number, r = 1.3, maxR = 40,
): { x: number; z: number } {
  if (!world.blocked(cx, cz, r)) return { x: cx, z: cz };
  for (let i = 1; i <= 96; i++) {
    const ang = i * 2.39996323;                        // golden angle — even coverage, no clumping
    const rad = Math.min(maxR, 1.5 + i * 0.45);
    const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
    if (!world.blocked(x, z, r)) return { x, z };
  }
  return { x: cx, z: cz };                             // boxed in everywhere — the caller falls back
}

/** WHERE A RESUME MAY STAND. A saved coordinate is a wish, not a fact: the layout is
 *  seeded from the game's TITLE while the save slot is keyed by the record id, so renaming
 *  a game regenerates the map under an unchanged save; an author's edit can retarget or
 *  delete the world the slot names, leaving a coordinate that belongs to a different map;
 *  and a slot can always be hand-edited. Restoring such a coordinate raw sealed the player
 *  inside solid geometry — movement is a pure destination test with no depenetration, so a
 *  body that starts inside a collider can never leave one, and the autosave then wrote the
 *  frozen spot back to the slot, breaking CONTINUE for good.
 *
 *  So: a coordinate from a world we are NOT standing in is discarded outright; anything else
 *  is nudged to the nearest standing room; and a spot walled in on every side falls back to
 *  the opening spot a fresh run uses. `moved` is false only when the exact saved spot was
 *  kept — the caller may then restore the saved height (a ledge, a jump) as well. */
export function resumeSpot(
  world: Pick<World, 'blocked' | 'playerStart'>,
  savedWorld: string, currentWorld: string,
  x: number, z: number, r = 1.3,
): { x: number; z: number; moved: boolean } {
  const ps = world.playerStart?.() ?? { x: 0, z: 0 };
  const start = nearestStandable(world, ps.x, ps.z, r);
  let spot = savedWorld === currentWorld ? nearestStandable(world, x, z, r) : start;
  if (world.blocked(spot.x, spot.z, r)) spot = start;   // boxed in everywhere — a fresh start beats a tomb
  return { x: spot.x, z: spot.z, moved: spot.x !== x || spot.z !== z };
}
