// src/engine/composer/plans/index.ts — the authored floor-plan registry (one file per archetype).
// Every plan is single storey, rooms are rectangles sharing walls around corridors/halls; see types.ts.
import type { ArchetypeId } from '../types';
import type { FloorPlan } from './types';
import { HOUSE_PLANS } from './house';
import { HAUNTED_PLANS } from './haunted';
import { SCHOOL_PLANS } from './school';
import { SHOP_PLANS } from './shop';
import { OFFICE_PLANS } from './office';
import { HOSPITAL_PLANS } from './hospital';
import { PRISON_PLANS } from './prison';
import { CASTLE_PLANS } from './castle';
import { DUNGEON_PLANS } from './dungeon';

export { HOUSE_PLANS, HAUNTED_PLANS, SCHOOL_PLANS, SHOP_PLANS, OFFICE_PLANS, HOSPITAL_PLANS, PRISON_PLANS, CASTLE_PLANS, DUNGEON_PLANS };

/** Authored plans per archetype; archetypes without authored plans map to []. */
export const PLANS: Record<ArchetypeId, FloorPlan[]> = {
  house: HOUSE_PLANS, haunted: HAUNTED_PLANS, school: SCHOOL_PLANS, shop: SHOP_PLANS, office: OFFICE_PLANS,
  hospital: HOSPITAL_PLANS, prison: PRISON_PLANS, castle: CASTLE_PLANS, dungeon: DUNGEON_PLANS,
  spacestation: [], lab: [], base: [], arena: [], obby: [], village: [], farm: [], pirate: [], camp: [], fair: [], city: [],
};

export const plansFor = (id: ArchetypeId): FloorPlan[] => PLANS[id] ?? [];
export const planById = (id: string): FloorPlan | undefined => ALL_PLANS.find(p => p.id === id);
export const ALL_PLANS: FloorPlan[] = Object.values(PLANS).flat();
