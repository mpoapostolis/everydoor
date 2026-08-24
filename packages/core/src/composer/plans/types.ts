// src/engine/composer/plans/types.ts
// ============================================================================
// THE FLOOR PLAN — the single source of truth for every interior. Authored (ASCII, like a
// real building) or generated (planGrow.ts), every plan is the same shape; planToLayout.ts
// turns it into the EmbeddedLayout the rest of the composer consumes (shared walls, doors on
// boundaries, colliders). Single storey by owner decision (2026-08-22): no floors, no stairs.
// Cells are CELL (7 u) squares; rows[0] is north (−z); columns run along +x.
// ============================================================================
import type { ArchetypeId, Role, Tier } from '../types';
import type { Finish } from '../../props/surfaces';

export interface PlanRoom {
  kind: string;                 // archetype kind ('kitchen', 'throne', 'corridor', 'hall', 'courtyard' …)
  role?: Role;                  // fixed role when the building dictates it ('entrance', 'hub', 'boss')
  sky?: boolean;                // open to the sky (courtyard, yard)
  /** 'hub' | 'boss' | 'key' | 'service' — placement hints for the mission mapper — plus 'cross': a room
   *  sized by CIRCULATION rather than by its kind's recipe, because it spans the plan's cross-section (a mall
   *  concourse, the entrance hall and end hall that cap a corridor plan). The room size band does not apply. */
  tags?: string[];
}
export interface FloorPlan {
  id: string;
  archetype: ArchetypeId;
  tier?: Tier;
  rows: string[];               // one char per cell; same char = same room; '.' = outside. Rooms are RECTANGLES.
  rooms: Record<string, PlanRoom>;
  /** 'A-B' = door centred on the shared wall; 'A-B@n' = on the n-th shared segment; 'A-B!' = secret door;
   *  'A-B~' = OPEN join (no wall between — an L-shaped room made of two rects); 'A>' = the exterior entrance on A (exactly one). */
  doors: string[];
  entrance: string;             // char of the entrance room
  variants?: { mirrorX?: boolean; mirrorZ?: boolean; rotate?: boolean; swapKinds?: Record<string, string[]> };
  source?: 'authored' | 'grown' | 'corridor' | 'ring';
  notes?: string;
}

/** A parsed, validated plan: rooms as cell rects, boundaries, door positions. */
export interface PlanRect { x0: number; z0: number; x1: number; z1: number }   // cells, inclusive
export interface PlanDoor { a: string; b: string; x: number; z: number; along: 'x' | 'z'; secret?: boolean; open?: boolean; exterior?: boolean }
//   x,z = the cell-grid LINE coordinate of the door centre (along 'x' means the opening runs along x, the wall is a z = const line)
export interface ParsedPlan {
  plan: FloorPlan;
  w: number; d: number;
  rects: Record<string, PlanRect>;
  doors: PlanDoor[];
  adjacency: Record<string, string[]>;            // via doors (open joins included)
}

/** Room finishes the renderer applies verbatim (no guessing from names). */
export interface RoomFinish { floor: Finish; wall: Finish; ceil?: Finish | 'none'; trim?: 'wood' | 'stone' | 'metal' | 'none'; plankAxis?: 'long' | 'x' | 'z' }
