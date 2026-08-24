// src/engine/props/families/obby.ts
// ============================================================================
// OBBY — the parkour / obstacle-course kit: platforms, hazards, pads, a spinner,
// a launcher, a conveyor, the finish line and a cover block. Every piece is flat,
// chunky and readable from 30 u so a course can be parsed at a glance mid-jump.
// A standard platform is a 6 u square (17 voxels); the moving variant carries rails.
// Conventions as in core.ts: 1 voxel = 0.35 u, stand on y=0, centred on x=z=0,
// materials not colours, emissive:true for glowing parts.
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

/** The 6 u square slab shared by the platforms: stone slab, dark underside skirt, accent corner studs. */
const SLAB: VoxelOp[] = [
  { box: [-8.5, 0.6, -8.5, 17, 1.4, 17], mat: 'stone' },                              // slab (top at y = 2)
  { box: [-8, 0, -8, 16, 0.6, 16], mat: 'dark' },                                     // inset shadow skirt under the slab (reads as depth)
  { mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [6.5, 2, 6.5, 1.5, 0.4, 1.5], mat: 'accent' }] }] },   // corner studs
];

export const OBBY: PropDef[] = [
  {
    // Static platform — a flat 6 u stone slab; surface offered on top (y = 0.7 u) for standing / clutter.
    id: 'obby_platform', family: 'obby', tags: ['platform', 'surface'], place: 'floor', facing: 'any', blocking: true,
    surfaces: [{ x: -3, z: -3, w: 6, d: 6, y: 0.7, max: 4 }],
    voxels: [...SLAB],
  },
  {
    // Moving platform — the same slab on a dark track carriage, with accent side rails that read as "this one travels".
    id: 'obby_platform_moving', family: 'obby', tags: ['platform', 'moving', 'surface'], place: 'floor', facing: 'any', blocking: true,
    surfaces: [{ x: -3, z: -3, w: 6, d: 6, y: 0.7, max: 4 }],
    voxels: [
      ...SLAB,
      { mirror: 'x', ops: [
        { box: [7.5, 2, -8.5, 1, 2.5, 17], mat: 'accent' },                           // side rails
        { box: [8.5, 0, -8.5, 1.5, 2, 17], mat: 'metal' },                            // carriage runners, outboard of the slab edge
      ] },
    ],
  },
  {
    // Kill brick — a flat dark slab with a glowing top face; touching it resets the run.
    id: 'obby_kill_brick', family: 'obby', tags: ['hazard', 'kill', 'light'], place: 'floor', facing: 'any', blocking: false, interact: 'kill',
    voxels: [
      { box: [-8.5, 0, -8.5, 17, 1.5, 17], mat: 'dark' },                             // body
      { box: [-8, 1.5, -8, 16, 0.5, 16], mat: 'glow', emissive: true },               // glowing top
      { mirror: 'x', ops: [{ box: [8, 1.2, -8.5, 0.5, 1, 17], mat: 'accent', emissive: true }] },   // hot edge lines
      { mirror: 'z', ops: [{ box: [-8.5, 1.2, 8, 17, 1, 0.5], mat: 'accent', emissive: true }] },
    ],
  },
  {
    // Spinner — a metal hub with two opposite arms sweeping at shin height; arm tips are accent so the sweep reads.
    id: 'obby_spinner', family: 'obby', tags: ['hazard', 'moving'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 2, sides: 2, back: 2 },
    voxels: [
      { cyl: [0, 0, 0, 4, 1], mat: 'dark', sides: 8 },                                // base plate
      { cyl: [0, 1, 0, 2.5, 4], mat: 'metal', sides: 8 },                             // hub
      { cyl: [0, 5, 0, 1.5, 0.8], mat: 'glow', emissive: true, sides: 8 },            // hub light
      { mirror: 'x', ops: [
        { box: [2.5, 2, -1, 12, 1.5, 2], mat: 'metal' },                              // arm
        { box: [14.5, 1.5, -1.5, 2.5, 2.5, 3], mat: 'accent' },                       // arm tip
      ] },
    ],
  },
  {
    // Jump pad — a low metal dish with a glowing disc; stepping on it launches the hero upward.
    id: 'obby_jump_pad', family: 'obby', tags: ['pad', 'light'], place: 'floor', facing: 'any', blocking: false,
    voxels: [
      { cyl: [0, 0, 0, 6.5, 0.8], mat: 'metal', sides: 12 },                          // dish
      { cyl: [0, 0.8, 0, 5.5, 0.4], mat: 'dark', sides: 12 },                         // rubber ring
      { cyl: [0, 0.8, 0, 4, 1], mat: 'glow', emissive: true, sides: 12 },             // glowing disc
      { cyl: [0, 1.8, 0, 1.5, 0.6], mat: 'accent', emissive: true, sides: 8 },        // centre stud
    ],
  },
  {
    // Speed pad — a long low dark strip with three glowing chevrons pointing +z (the run direction).
    id: 'obby_speed_pad', family: 'obby', tags: ['pad', 'light'], place: 'floor', facing: 'room', blocking: false,
    voxels: [
      { box: [-6, 0, -8.5, 12, 0.6, 17], mat: 'dark' },                               // strip
      { mirror: 'x', ops: [{ box: [5.5, 0.6, -8.5, 0.5, 0.4, 17], mat: 'metal' }] },  // edge rails
      { repeat: { n: 3, dz: 5 }, ops: [
        { mirror: 'x', ops: [
          { box: [0, 0.6, -5.5, 2, 0.5, 1.5], mat: 'glow', emissive: true },          // chevron point
          { box: [2, 0.6, -7, 2, 0.5, 1.5], mat: 'glow', emissive: true },            // chevron wing
        ] },
      ] },
    ],
  },
  {
    // Launcher — a stone base holding a short cannon barrel angled toward +z, muzzle glowing; fires the hero across a gap.
    id: 'obby_launcher', family: 'obby', tags: ['pad', 'focal', 'light'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 3, sides: 1 },
    voxels: [
      { box: [-6, 0, -6, 12, 2, 12], mat: 'stone' },                                  // base
      { mirror: 'x', ops: [{ box: [3, 2, -4, 1.5, 6, 6], mat: 'metal' }] },           // cradle cheeks
      { box: [-3, 2, -6, 6, 6, 8], mat: 'metal' },                                    // breech, seated on the base
      { box: [-2.5, 5, 1, 5, 5, 5], mat: 'metal' },                                   // barrel rising forward
      { box: [-3, 5.5, 5, 6, 5, 1.5], mat: 'dark' },                                  // muzzle ring
      { box: [-2, 6.5, 6.5, 4, 3, 0.6], mat: 'glow', emissive: true },                // muzzle glow
      { box: [-1, 8, -3, 2, 1, 3], mat: 'accent' },                                   // sight / trigger
    ],
  },
  {
    // Conveyor — a long low belt between metal frames with dark rollers showing through; accent arrow marks the direction (+z).
    id: 'obby_conveyor', family: 'obby', tags: ['moving', 'surface'], place: 'floor', facing: 'room', blocking: false,
    surfaces: [{ x: -1.4, z: -4.5, w: 2.8, d: 9, y: 0.7, max: 3 }],
    voxels: [
      { mirror: 'x', ops: [{ box: [4, 0, -14, 1.5, 2.5, 28], mat: 'metal' }] },       // side frames
      { box: [-4, 0, -14, 8, 1, 28], mat: 'dark' },                                   // under-pan
      { box: [-4, 1, -14, 8, 1, 28], mat: 'fabric' },                                 // belt
      { repeat: { n: 7, dz: 4 }, ops: [{ box: [-4, 1.6, -13, 8, 0.6, 1.5], mat: 'dark' }] },   // rollers
      { box: [-1, 2, 2, 2, 0.4, 5], mat: 'accent' },                                  // arrow shaft
      { box: [-2.5, 2, 7, 5, 0.4, 1.5], mat: 'accent' },                              // arrow head
    ],
  },
  {
    // Finish line — two metal posts carrying a chequered accent banner; crossing it ends the run.
    id: 'obby_finish_line', family: 'obby', tags: ['finish', 'focal', 'weenie'], place: 'floor', facing: 'any', blocking: false, interact: 'finish',
    clearance: { front: 2, sides: 0.5, back: 2 },
    voxels: [
      { mirror: 'x', ops: [
        { cyl: [10, 0, 0, 2, 1], mat: 'dark', sides: 8 },                              // post foot
        { cyl: [10, 1, 0, 1, 24], mat: 'metal', sides: 6 },                            // post
        { box: [9, 25, -1, 2, 2, 2], mat: 'accent' },                                  // finial
      ] },
      { box: [-9, 18, -0.5, 18, 6, 1], mat: 'fabric' },                                // banner
      { repeat: { n: 3, dx: 6 }, ops: [{ box: [-9, 21, 0.5, 3, 3, 0.3], mat: 'dark' }, { box: [-6, 18, 0.5, 3, 3, 0.3], mat: 'dark' }] },   // chequer
      { box: [-9, 17, -0.5, 18, 1, 1], mat: 'accent' },                                // hem
    ],
  },
  {
    // Cover pillar — a chest-high solid stone block to crouch behind; tagged 'cover' for combat layouts.
    id: 'obby_cover_pillar', family: 'obby', tags: ['cover', 'barricade'], place: 'floor', facing: 'any', blocking: true,
    voxels: [
      { box: [-4, 0, -4, 8, 10, 8], mat: 'stone' },                                    // block
      { box: [-4.5, 0, -4.5, 9, 1, 9], mat: 'dark' },                                  // plinth
      { box: [-4.5, 10, -4.5, 9, 1, 9], mat: 'stone' },                                // cap
      { box: [-4.2, 5, -4.2, 8.4, 1, 8.4], mat: 'accent' },                            // band
    ],
  },
];
