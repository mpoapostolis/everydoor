// src/engine/props/families/core.ts
// ============================================================================
// CORE — the 16 props every archetype needs for PLAY: doors, locks, keys, chest,
// switches, checkpoints, spawn pad, ladder, vent, campfire. Also the worked example
// of the VoxelOp DSL for every other family:
//   • 1 voxel = 0.35 u. Door opening 26 × 23. Hero 15 tall. Props stand on y=0, centred on x=z=0.
//   • box: [x, y, z, w, h, d] from the MIN corner. cyl: [cx, y, cz, r, h] from the base centre.
//   • mirror:'x' builds the right half and reflects it — author symmetric things once.
//   • Name MATERIALS, never colours: wood/stone/metal/fabric/foliage/glass/accent/glow/dark.
//   • emissive:true puts a box in the unlit 'glow' part (lamps, flames, screens, runes).
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

/** Door frame shared by door / locked door: two posts + lintel around a 26 × 23 opening. */
const FRAME: VoxelOp[] = [
  { mirror: 'x', ops: [{ box: [13, 0, -1, 2, 25, 3], mat: 'dark' }] },     // posts (x 13..15 and −15..−13)
  { box: [-15, 23, -1, 30, 2, 3], mat: 'dark' },                            // lintel
];

export const CORE: PropDef[] = [
  {
    id: 'core_door', family: 'core', tags: ['door'], place: 'wall', facing: 'room', blocking: false, interact: 'door',
    clearance: { front: 3, sides: 0.5, back: 3 },
    voxels: [
      ...FRAME,
      { box: [-13, 0, 0, 26, 23, 1], mat: 'wood' },                        // leaf
      { mirror: 'x', ops: [{ box: [2, 3, 1, 9, 8, 0.5], mat: 'dark' }, { box: [2, 13, 1, 9, 7, 0.5], mat: 'dark' }] },   // recessed panels
      { box: [8, 11, 1, 3, 1, 1], mat: 'accent' },                         // handle
    ],
  },
  {
    id: 'core_door_locked', family: 'core', tags: ['door', 'lock'], place: 'wall', facing: 'room', blocking: true, interact: 'lockedDoor',
    clearance: { front: 3, sides: 0.5, back: 3 },
    voxels: [
      ...FRAME,
      { box: [-13, 0, 0, 26, 23, 1], mat: 'wood' },
      { repeat: { n: 3, dy: 8 }, ops: [{ box: [-13, 3, 1, 26, 2, 0.5], mat: 'metal' }] },   // iron bands
      { box: [-3, 9, 1, 6, 6, 1], mat: 'metal' },                          // lock plate
      { box: [-1.5, 10.5, 2, 3, 3, 0.5], mat: 'accent' },                  // padlock body
      { box: [-1, 13.5, 2, 2, 1, 0.5], mat: 'accent' },                    // shackle
    ],
  },
  {
    id: 'core_gate', family: 'core', tags: ['door', 'lock', 'bars'], place: 'wall', facing: 'any', blocking: true, interact: 'lockedDoor',
    clearance: { front: 3, sides: 0.5, back: 3 },
    voxels: [
      { mirror: 'x', ops: [{ box: [13, 0, -1.5, 3, 25, 3], mat: 'stone' }] },          // posts
      { box: [-13, 0, -0.5, 26, 1, 1], mat: 'metal' },                                  // sill
      { box: [-13, 21, -0.5, 26, 1, 1], mat: 'metal' },                                 // top rail
      { box: [-13, 11, -0.5, 26, 1, 1], mat: 'metal' },                                 // mid rail
      { repeat: { n: 9, dx: 3 }, ops: [{ box: [-12.5, 1, -0.5, 1, 20, 1], mat: 'metal' }] },   // bars
      { repeat: { n: 9, dx: 3 }, ops: [{ box: [-12.5, 22, -0.5, 1, 2, 1], mat: 'dark' }] },    // spikes
    ],
  },
  {
    id: 'core_portcullis', family: 'core', tags: ['door', 'lock', 'bars'], place: 'wall', facing: 'any', blocking: true, interact: 'lockedDoor',
    clearance: { front: 3, sides: 0.5, back: 3 },
    voxels: [
      { repeat: { n: 7, dx: 4 }, ops: [{ box: [-12.5, 0, -0.5, 1, 24, 1], mat: 'metal' }] },   // uprights
      { repeat: { n: 6, dy: 4 }, ops: [{ box: [-13, 2, -0.5, 26, 1, 1], mat: 'dark' }] },      // lattice rows
      { repeat: { n: 7, dx: 4 }, ops: [{ box: [-12.5, -1, -0.5, 1, 1, 1], mat: 'dark' }] },    // teeth below the sill line
    ],
  },
  {
    id: 'core_key', family: 'core', tags: ['loot', 'key', 'item'], place: 'surface', facing: 'any', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-5, 0, -2, 4, 1, 4], mat: 'accent' },                                                // bow
      { box: [-4, 1, -1, 2, 0.4, 2], mat: 'dark' },                                                 // bow hole (inset)
      { box: [-1, 0, -0.5, 7, 1, 1], mat: 'accent' },                                              // shaft
      { box: [4, 0, 0.5, 1, 1, 1.5], mat: 'accent' }, { box: [2, 0, 0.5, 1, 1, 1], mat: 'accent' },  // teeth
    ],
  },
  {
    id: 'core_keycard', family: 'core', tags: ['loot', 'key', 'item'], place: 'surface', facing: 'any', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-3, 0, -2, 6, 0.6, 4], mat: 'glass' },
      { box: [-3, 0.6, -1.5, 6, 0.3, 1], mat: 'dark' },                     // magnetic stripe
      { box: [-2, 0.6, 0.5, 2, 0.3, 1], mat: 'accent' },                    // chip
    ],
  },
  {
    id: 'core_key_pedestal', family: 'core', tags: ['loot', 'focal', 'light'], place: 'floor', facing: 'any', blocking: true, interact: 'keyPedestal',
    clearance: { front: 2, sides: 1 },
    voxels: [
      { box: [-5, 0, -5, 10, 1, 10], mat: 'stone' },                        // plinth
      { cyl: [0, 1, 0, 3, 9], mat: 'stone', sides: 8 },                     // column
      { box: [-5, 10, -5, 10, 1, 10], mat: 'stone' },                       // cap slab
      { cyl: [0, 11, 0, 3, 0.6], mat: 'glow', emissive: true },             // glowing disc
      { ref: 'core_key', at: [0, 11.6, 0], rot: 1 },
    ],
  },
  {
    id: 'core_chest', family: 'core', tags: ['loot', 'treasure'], place: 'floor', facing: 'room', blocking: true, loot: true, interact: 'chest',
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { box: [-6, 0, -4, 12, 6, 8], mat: 'wood' },                          // body
      { box: [-6, 6, -4, 12, 3, 8], mat: 'wood' },                          // lid
      { mirror: 'x', ops: [{ box: [3, 0, -4.5, 2, 9, 9], mat: 'metal' }] }, // straps
      { box: [-1.5, 4, 4, 3, 3, 0.6], mat: 'accent' },                      // clasp
    ],
  },
  {
    id: 'core_lever', family: 'core', tags: ['switch'], place: 'floor', facing: 'room', blocking: true, interact: 'lever',
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { box: [-3, 0, -2, 6, 2, 4], mat: 'stone' },                          // base
      { box: [-1, 2, -1, 2, 2, 2], mat: 'metal' },                          // pivot
      { box: [-0.5, 4, 1, 1, 7, 1], mat: 'metal' },                         // arm (leaning forward)
      { box: [-1, 11, 0.5, 2, 2, 2], mat: 'accent' },                       // knob
    ],
  },
  {
    id: 'core_button', family: 'core', tags: ['switch'], place: 'floor', facing: 'any', blocking: false, interact: 'button',
    voxels: [
      { box: [-4, 0, -4, 8, 2, 8], mat: 'stone' },
      { cyl: [0, 2, 0, 2.5, 1], mat: 'glow', emissive: true, sides: 8 },
    ],
  },
  {
    id: 'core_plate', family: 'core', tags: ['switch'], place: 'floor', facing: 'any', blocking: false, interact: 'plate',
    voxels: [
      { box: [-5, 0, -5, 10, 0.8, 10], mat: 'metal' },
      { mirror: 'x', ops: [{ box: [4, 0.8, -5, 1, 0.4, 10], mat: 'accent' }] },
      { mirror: 'z', ops: [{ box: [-5, 0.8, 4, 10, 0.4, 1], mat: 'accent' }] },
    ],
  },
  {
    id: 'core_checkpoint', family: 'core', tags: ['checkpoint', 'focal'], place: 'floor', facing: 'any', blocking: false, interact: 'checkpoint',
    voxels: [
      { cyl: [-3, 0, 0, 3, 1], mat: 'stone', sides: 8 },                    // base
      { cyl: [-3, 1, 0, 0.7, 22], mat: 'metal', sides: 6 },                 // pole
      { box: [-2.5, 15, -0.4, 9, 6, 0.8], mat: 'accent' },                  // flag (balances the prop on x=0)
      { box: [-4, 23, -1, 2, 2, 2], mat: 'glow', emissive: true },          // finial
    ],
  },
  {
    id: 'core_pad_spawn', family: 'core', tags: ['spawn', 'claim'], place: 'floor', facing: 'any', blocking: false, interact: 'claim',
    voxels: [
      { cyl: [0, 0, 0, 7, 0.8], mat: 'metal', sides: 12 },
      { cyl: [0, 0.8, 0, 6, 0.4], mat: 'dark', sides: 12 },
      { cyl: [0, 0.8, 0, 4, 0.6], mat: 'glow', emissive: true, sides: 12 },
    ],
  },
  {
    id: 'core_ladder', family: 'core', tags: ['climb'], place: 'wall', facing: 'room', blocking: false,
    voxels: [
      { mirror: 'x', ops: [{ box: [3, 0, 0, 1, 36, 1], mat: 'metal' }] },   // rails
      { repeat: { n: 11, dy: 3.3 }, ops: [{ box: [-3, 1.5, 0, 6, 0.8, 1], mat: 'metal' }] },   // rungs
    ],
  },
  {
    id: 'core_vent', family: 'core', tags: ['secret', 'hide'], place: 'wall', facing: 'room', blocking: false, hide: true,
    voxels: [
      { box: [-5, 0, 0, 10, 10, 0.6], mat: 'dark' },
      { box: [-5, 0, 0.6, 10, 1, 0.6], mat: 'metal' }, { box: [-5, 9, 0.6, 10, 1, 0.6], mat: 'metal' },
      { mirror: 'x', ops: [{ box: [4, 0, 0.6, 1, 10, 0.6], mat: 'metal' }] },
      { repeat: { n: 4, dy: 2 }, ops: [{ box: [-4, 1.5, 0.6, 8, 0.8, 0.6], mat: 'metal' }] },   // slats
    ],
  },
  {
    id: 'core_campfire', family: 'core', tags: ['light', 'rest', 'focal'], place: 'outdoor', facing: 'any', blocking: true, interact: 'campfire',
    clearance: { front: 2, sides: 2 },
    voxels: [
      { box: [-6, 0, -1, 12, 2, 2], mat: 'dark' }, { box: [-1, 0, -6, 2, 2, 12], mat: 'dark' },   // crossed logs
      { box: [-7, 0, -7, 3, 2, 3], mat: 'stone' }, { box: [4, 0, -7, 3, 2, 3], mat: 'stone' },    // ring stones
      { box: [-7, 0, 4, 3, 2, 3], mat: 'stone' }, { box: [4, 0, 4, 3, 2, 3], mat: 'stone' },
      { box: [-7, 0, -1.5, 2, 2, 3], mat: 'stone' }, { box: [5, 0, -1.5, 2, 2, 3], mat: 'stone' },
      { box: [-2, 2, -2, 4, 3, 4], mat: 'glow', emissive: true },                                 // flame
      { box: [-1, 5, -1, 2, 3, 2], mat: 'glow', emissive: true },
      { box: [-0.5, 8, -0.5, 1, 2, 1], mat: 'accent', emissive: true },                           // tip
    ],
  },
];
