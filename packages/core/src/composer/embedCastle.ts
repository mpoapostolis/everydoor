// src/engine/composer/embedCastle.ts — the CASTLE embedder (layout 'castle'): a COURTYARD RING, floor-plan first.
// The mission graph becomes room needs (needsOf in embedBuilding.ts), plans/generate.ts's RING generator lays
// a curtain-wall square: an open-sky courtyard hub in the middle, a gatehouse protruding south (the entrance),
// three wings of rooms (north / west / east) partitioned squarified along the wing, the keep centred in the
// north wing and deeper than it (the boss, single door), four 3×3 corner towers flanking the bailey, and a
// secret room behind the chapel; planToLayout turns the best-scoring candidate into the EmbeddedLayout.
// SINGLE STOREY (owner decision): no tower tops, no cells under the wings — every zone is on floor 0; nodes
// that asked for a floor are placed on the ground (a 'tower' kind takes a corner tower).
// Curtain walls: exterior WallRuns at h = wallH × 1.3 (the renderer adds battlements).
// Plan-only: integer cells, seeded Rng, no trig, no Math.random. Byte-deterministic.
import type { Archetype, EmbeddedLayout, MissionGraph } from './types';
import { CELL } from './types';
import { embedWithNeeds, needsOf, lastFail as buildingFail } from './embedBuilding';
import { TOWER as PLAN_TOWER, sharedWall } from './plans/generate';
import type { PlanRect } from './plans/types';

export const TOWER = PLAN_TOWER;        // cells per tower side
export const DOOR_W = 2 * CELL;         // 10 u
export const CURTAIN_H = 1.3;           // exterior wall height × wallH
export { cellU } from './embedBuilding';

/** Why the last embedCastle call returned null ('' after a success). */
export let lastFail = '';

export function embedCastle(g: MissionGraph, seed: number, arch: Archetype): EmbeddedLayout | null {
  lastFail = '';
  if (!g.nodes.length) { lastFail = 'no nodes'; return null; }
  const mn = needsOf(g, seed, arch);
  mn.needs.method = 'ring';
  const L = embedWithNeeds(g, seed, arch, mn, { exteriorH: arch.wallH * CURTAIN_H });
  if (!L) lastFail = buildingFail || 'no ring plan satisfied the mission';
  return L;
}

/** Two cell rects share a wall segment of ≥ 2 cells (they abut along x or along z). */
export function sharesWall(A: PlanRect, B: PlanRect): boolean { return (sharedWall(A, B)?.len ?? 0) >= 2; }
