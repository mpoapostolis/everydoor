// src/engine/composer/archetypes/index.ts — the archetype registry (docs/design §6).
// Every interior archetype is single storey (layout 'plan'); finishes live on each kind (finishes.ts).
import type { Archetype, ArchetypeId } from '../types';
import { HOUSE } from './house';
import { SCHOOL } from './school';
import { SHOP } from './shop';
import { OFFICE } from './office';
import { HAUNTED } from './haunted';
import { CASTLE } from './castle';
import { DUNGEON } from './dungeon';
import { PRISON } from './prison';
import { HOSPITAL } from './hospital';

export const ARCHETYPES: Partial<Record<ArchetypeId, Archetype>> = {
  house: HOUSE, school: SCHOOL, shop: SHOP, office: OFFICE, haunted: HAUNTED, castle: CASTLE, dungeon: DUNGEON, prison: PRISON, hospital: HOSPITAL,
};
export const archetypeIds = (): ArchetypeId[] => Object.keys(ARCHETYPES) as ArchetypeId[];
export const archetypeOf = (id: string): Archetype | undefined => ARCHETYPES[id as ArchetypeId];
export { FINISH } from './finishes';
export type { FinishPreset } from './finishes';
