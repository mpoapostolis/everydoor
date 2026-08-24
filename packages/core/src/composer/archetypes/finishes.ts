// src/engine/composer/archetypes/finishes.ts — the finish presets every archetype's kinds pick from.
// The renderer reads zone.finish verbatim (typeAndName copies RoomRecipe.finish onto the zone), so a
// kind without one of these falls back to the style's defaults — every kind in every archetype sets one.
// Finish ids come from ../../props/surfaces (plank | tile | flagstone | plaster | wallpaper | carpet | panel | grass | dirt | brick).
import type { RoomFinish } from '../plans/types';

export type FinishPreset =
  | 'hall' | 'wet' | 'bedroom' | 'stone' | 'cell' | 'clinic' | 'grass' | 'dirt' | 'shop' | 'office' | 'classroom' | 'cellar' | 'workshop' | 'loft' | 'parlour'
  | 'throne' | 'ward' | 'concrete' | 'gym' | 'crypt' | 'lobby' | 'courtyard' | 'yard';

export const FINISH: Record<FinishPreset, RoomFinish> = {
  hall: { floor: 'plank', wall: 'plaster', plankAxis: 'long', trim: 'wood' },            // corridors, halls, lobbies, foyers
  wet: { floor: 'tile', wall: 'tile', trim: 'none' },                                     // kitchens, baths, cafeterias, surgeries, labs
  bedroom: { floor: 'carpet', wall: 'wallpaper', trim: 'wood' },                          // bedrooms, suites, studies, libraries
  parlour: { floor: 'plank', wall: 'wallpaper', plankAxis: 'long', trim: 'wood' },        // living / dining / ballroom
  stone: { floor: 'flagstone', wall: 'flagstone', trim: 'stone' },                        // castle and dungeon rooms
  cell: { floor: 'dirt', wall: 'flagstone', trim: 'stone' },                              // cells
  clinic: { floor: 'tile', wall: 'panel', trim: 'metal' },                                // hospital / prison / lab
  grass: { floor: 'grass', wall: 'brick', ceil: 'none', trim: 'none' },                   // yards, fields
  dirt: { floor: 'dirt', wall: 'brick', ceil: 'none', trim: 'none' },                     // courtyards, prison yards, lots
  shop: { floor: 'tile', wall: 'plaster', trim: 'none' },                                 // storefront, concourse, stores
  office: { floor: 'carpet', wall: 'plaster', trim: 'none' },                             // open plan, meeting rooms, offices
  classroom: { floor: 'plank', wall: 'plaster', plankAxis: 'x', trim: 'wood' },           // classrooms
  cellar: { floor: 'flagstone', wall: 'flagstone', trim: 'stone' },                           // cellars, storage under stone
  workshop: { floor: 'tile', wall: 'plaster', trim: 'metal' },                              // garage, loading bay, server room
  loft: { floor: 'plank', wall: 'plank', plankAxis: 'z', trim: 'wood' },                  // lofts, box rooms, attic-style storage on the ground plan
  // 2026-08-23 (worlds survey): presets that let a room read at a glance, so archetypes stop spelling finishes inline.
  throne: { floor: 'carpet', wall: 'flagstone', trim: 'stone' },                          // throne rooms, boss halls under stone — a red runner on grey
  ward: { floor: 'tile', wall: 'plaster', trim: 'metal' },                                // wards, reception: softer than the clinic panel
  concrete: { floor: 'tile', wall: 'brick', trim: 'metal' },                              // cell blocks, sally ports, guard posts
  gym: { floor: 'plank', wall: 'plaster', plankAxis: 'long', trim: 'none' },              // gym, bleachers, ballrooms that dance
  crypt: { floor: 'flagstone', wall: 'brick', trim: 'stone' },                            // treasuries, crypt chambers, the kitchens of a castle
  lobby: { floor: 'tile', wall: 'plaster', plankAxis: 'long', trim: 'none' },             // hospital hallways, mall concourses
  courtyard: { floor: 'flagstone', wall: 'flagstone', ceil: 'none', trim: 'stone' },      // the castle bailey, a course under the sky
  yard: { floor: 'tile', wall: 'brick', ceil: 'none', trim: 'metal' },                    // the prison guard post, a hospital evac route
};
