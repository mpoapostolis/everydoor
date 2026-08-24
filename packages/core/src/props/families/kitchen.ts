// src/engine/props/families/kitchen.ts
// ============================================================================
// KITCHEN — the 12 props a kitchen, diner or restaurant is furnished with: counter,
// stove, fridge, sink, pantry cabinet, dining table (+4 seats), booth, pizza oven,
// register, tray, bin, menu board. Same DSL as core.ts: 1 voxel = 0.35 u, props stand
// on y=0 centred on x=z=0, wall props face +z. Counter top y=12, table top y=10.
// surfaces are prop-local u from the MIN corner (x = -w/2 for a centred top), like home/school.
// Materials only — the same counter is tile-and-steel in the lab and oak in the cottage.
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

/** Base cabinet shared by counter / sink / register: dark plinth + wooden carcass, w × 8 deep, 11 tall. */
const CARCASS = (w: number): VoxelOp[] => [
  { box: [-w / 2 + 0.5, 0, -3.5, w - 1, 1, 7], mat: 'dark' },                // plinth (recessed toe-kick)
  { box: [-w / 2, 1, -4, w, 10, 8], mat: 'wood' },                           // carcass
];

export const KITCHEN: PropDef[] = [
  {
    // Kitchen counter: base cabinet with two doors + a drawer, stone top at y=12 · offers its top as a surface
    id: 'kitchen_counter', family: 'kitchen', tags: ['surface', 'workstation'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0 },
    surfaces: [{ x: -2.8, z: -1.4, w: 5.6, d: 2.8, y: 4.2, max: 3 }],
    voxels: [
      ...CARCASS(16),
      { box: [-8.5, 11, -4.5, 17, 1, 9], mat: 'stone' },                     // worktop (slight overhang)
      { mirror: 'x', ops: [
        { box: [0.8, 1.5, 4, 6.4, 5, 0.4], mat: 'dark' },                    // door panel
        { box: [0.8, 7.5, 4, 6.4, 2.5, 0.4], mat: 'dark' },                  // drawer front
        { box: [2.5, 8.3, 4.4, 3, 0.6, 0.4], mat: 'accent' },                // drawer pull
      ] },
    ],
  },
  {
    // Stove: steel range with oven door + window, control panel with knobs, four glowing burners on top
    id: 'kitchen_stove', family: 'kitchen', tags: ['workstation', 'light'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0 },
    voxels: [
      { box: [-7.5, 0, -3.5, 15, 1, 7], mat: 'dark' },                       // plinth
      { box: [-8, 1, -4, 16, 10, 8], mat: 'metal' },                         // range body
      { box: [-8, 11, -4, 16, 1, 8], mat: 'dark' },                          // hob top
      { box: [-6.5, 2, 4, 13, 7, 0.4], mat: 'dark' },                        // oven door
      { box: [-5, 3.5, 4.4, 10, 4, 0.3], mat: 'glass' },                     // oven window
      { box: [-6.5, 9.5, 4.4, 13, 0.8, 0.8], mat: 'metal' },                 // door handle bar
      { box: [-8, 12, -4, 16, 3, 1.2], mat: 'metal' },                         // rear control panel (z -4..-2.8)
      { repeat: { n: 4, dx: 4 }, ops: [{ box: [-6.5, 12.8, -2.8, 1.5, 1.5, 0.5], mat: 'accent' }] },   // knobs on the panel face
      { mirror: 'x', ops: [{ mirror: 'z', ops: [{ cyl: [4, 12, 1.2, 1.6, 0.5], mat: 'glow', emissive: true, sides: 8 }] }] },   // burners (rear pair end at z -2.8, clear of the panel)
    ],
  },
  {
    // Fridge: tall steel cabinet, freezer door over fridge door, two vertical handles
    id: 'kitchen_fridge', family: 'kitchen', tags: ['storage'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0 },
    voxels: [
      { box: [-5.5, 0, -3.5, 11, 1, 7], mat: 'dark' },                       // plinth
      { box: [-6, 1, -4, 12, 23, 8], mat: 'metal' },                         // body
      { box: [-6, 16, 4, 12, 0.8, 0.3], mat: 'dark' },                       // door split line
      { box: [4, 4, 4, 1, 9, 0.8], mat: 'accent' },                          // fridge handle
      { box: [4, 18, 4, 1, 4, 0.8], mat: 'accent' },                         // freezer handle
    ],
  },
  {
    // Sink: base cabinet with a recessed steel basin and a tap · offers the two worktop strips beside the basin as surfaces
    id: 'kitchen_sink', family: 'kitchen', tags: ['surface', 'workstation'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0 },
    surfaces: [{ x: -2.9, z: -1.4, w: 1.1, d: 2.8, y: 4.2, max: 2 }, { x: 1.8, z: -1.4, w: 1.1, d: 2.8, y: 4.2, max: 2 }],
    voxels: [
      ...CARCASS(16),
      { mirror: 'x', ops: [{ box: [5, 11, -4.5, 3.5, 1, 9], mat: 'stone' }] },   // worktop strips either side
      { box: [-5, 11, -4.5, 10, 1, 2], mat: 'stone' },                       // rear strip
      { box: [-5, 11, 2.5, 10, 1, 2], mat: 'stone' },                        // front strip
      { box: [-4.8, 10.5, -2.3, 9.6, 0.6, 4.6], mat: 'metal' },              // basin floor at y=11.1, 0.9 below the rim; proud of the carcass top so no coplanar faces
      { box: [-6.5, 1.5, 4, 13, 8, 0.4], mat: 'dark' },                      // cupboard doors
      { box: [-0.5, 12, -3.5, 1, 4, 1], mat: 'metal' },                      // tap column
      { box: [-0.5, 15, -3.5, 1, 1, 4.5], mat: 'metal' },                    // spout
      { box: [-1.5, 16, -3.5, 3, 0.8, 1], mat: 'accent' },                   // lever handle
    ],
  },
  {
    // Pantry cabinet: tall wooden larder with upper + lower doors and a cornice · hiding place
    id: 'kitchen_cabinet', family: 'kitchen', tags: ['hide', 'storage'], place: 'wall', facing: 'room', blocking: true, hide: true,
    clearance: { front: 2, sides: 0 },
    voxels: [
      { box: [-6.5, 0, -3, 13, 1, 6], mat: 'dark' },                         // plinth
      { box: [-7, 1, -3.5, 14, 25, 7], mat: 'wood' },                        // carcass
      { box: [-7.5, 26, -4, 15, 1, 8], mat: 'wood' },                        // cornice
      { mirror: 'x', ops: [
        { box: [0.4, 2, 3.5, 6.2, 12, 0.4], mat: 'dark' },                   // lower door
        { box: [0.4, 15, 3.5, 6.2, 10, 0.4], mat: 'dark' },                  // upper door
        { box: [1, 7, 3.9, 0.8, 3, 0.4], mat: 'accent' },                    // lower handle
        { box: [1, 19, 3.9, 0.8, 3, 0.4], mat: 'accent' },                   // upper handle
      ] },
    ],
  },
  {
    // Dining table: wooden four-leg table, top at y=10 · surface on top · 4 seat satellites, one per side
    id: 'kitchen_dining_table', family: 'kitchen', tags: ['surface'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 1, sides: 1, back: 1 },
    surfaces: [{ x: -3.5, z: -2.45, w: 7, d: 4.9, y: 3.5, max: 3 }],
    satellites: [
      { tag: 'seat', dx: 0, dz: 3.9, rot: 2, p: 0.9 },                    // half depth 2.45 + chair half 1.4
      { tag: 'seat', dx: 0, dz: -3.9, rot: 0, p: 0.9 },
      { tag: 'seat', dx: 4.9, dz: 0, rot: 1, p: 0.7 },                    // half width 3.5 + chair half 1.4
      { tag: 'seat', dx: -4.9, dz: 0, rot: 3, p: 0.7 },
    ],
    voxels: [
      { box: [-10, 9, -7, 20, 1, 14], mat: 'wood' },                         // top
      { box: [-9, 8, -6, 18, 1, 12], mat: 'dark' },                          // apron
      { mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [7.5, 0, 4.5, 1.5, 8, 1.5], mat: 'wood' }] }] },   // legs
    ],
  },
  {
    // Restaurant booth: two facing upholstered benches with a pedestal table between · seat · surface on the table
    id: 'kitchen_booth', family: 'kitchen', tags: ['seat', 'surface'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 0.5, sides: 1.5, back: 0.5 },
    surfaces: [{ x: -2.45, z: -1.05, w: 4.9, d: 2.1, y: 3.5, max: 2 }],
    voxels: [
      { mirror: 'z', ops: [
        { box: [-8, 1, 6, 16, 5, 5], mat: 'fabric' },                        // bench seat (y 1..6, on the base)
        { box: [-8, 6, 9.5, 16, 9, 1.5], mat: 'fabric' },                    // backrest
        { box: [-8, 15, 9.5, 16, 1, 1.5], mat: 'accent' },                   // piped top rail
        { box: [-8, 0, 6, 16, 1, 5], mat: 'dark' },                          // bench base
      ] },
      { cyl: [0, 0, 0, 1.5, 9], mat: 'metal', sides: 8 },                    // pedestal
      { box: [-7, 9, -3, 14, 1, 6], mat: 'wood' },                           // table top
    ],
  },
  {
    // Pizza oven: stone block with a domed brick oven, glowing mouth, chimney, wood alcove below · light source
    id: 'kitchen_pizza_oven', family: 'kitchen', tags: ['light', 'workstation', 'focal'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { box: [-9, 0, -8, 18, 10, 16], mat: 'stone' },                        // hearth block
      { box: [-5, 1, 8, 10, 5, 0.4], mat: 'dark' },                          // wood alcove
      { cyl: [0, 10, 0, 7.5, 6], mat: 'stone', sides: 12 },                  // dome
      { cyl: [0, 16, 0, 4.5, 3], mat: 'stone', sides: 12 },                  // dome cap
      { box: [-1.5, 19, -4, 3, 5, 3], mat: 'metal' },                        // chimney
      { box: [-4.5, 10, 3, 9, 6, 5], mat: 'dark' },                          // oven mouth surround
      { box: [-3, 10.5, 7.6, 6, 4, 0.6], mat: 'glow', emissive: true },      // fire
    ],
  },
  {
    // Register: shop counter with a till and lit screen on top · sell point · surfaces either side of the till
    id: 'kitchen_register', family: 'kitchen', tags: ['surface', 'workstation', 'sell'], place: 'floor', facing: 'room', blocking: true, interact: 'sell',
    clearance: { front: 2, sides: 0.5, back: 1.5 },
    surfaces: [{ x: -2.55, z: -1.4, w: 1.5, d: 2.8, y: 4.2, max: 2 }, { x: 1.05, z: -1.4, w: 1.5, d: 2.8, y: 4.2, max: 2 }],
    voxels: [
      ...CARCASS(14),
      { box: [-7.5, 11, -4.5, 15, 1, 9], mat: 'stone' },                     // counter top
      { box: [-7, 5, 4, 14, 1.5, 0.4], mat: 'accent' },                      // front trim stripe
      { box: [-3, 12, -2, 6, 3, 5], mat: 'metal' },                          // till body / cash drawer
      { box: [-3, 12.6, 3, 6, 0.5, 0.3], mat: 'dark' },                      // drawer seam
      { box: [-3, 15, -2, 6, 3, 1], mat: 'dark' },                           // screen back
      { box: [-2.5, 15.5, -1, 5, 2, 0.3], mat: 'glow', emissive: true },     // lit screen
    ],
  },
  {
    // Serving tray: steel tray with a plate and a cup — clutter for counters and tables
    id: 'kitchen_tray', family: 'kitchen', tags: ['item'], place: 'surface', facing: 'any', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-4, 0, -3, 8, 0.6, 6], mat: 'metal' },                         // tray
      { mirror: 'x', ops: [{ box: [3.5, 0.6, -3, 0.5, 0.6, 6], mat: 'metal' }] },   // rims
      { box: [-2.5, 0.6, -1.5, 4, 0.5, 3], mat: 'accent' },                  // plate
      { box: [2, 0.6, -1, 1.5, 2, 1.5], mat: 'glass' },                      // cup
    ],
  },
  {
    // Bin: steel pedal bin with a dark lid
    id: 'kitchen_bin', family: 'kitchen', tags: ['clutter'], place: 'floor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 3, 9], mat: 'metal', sides: 8 },                      // body
      { cyl: [0, 9, 0, 3.3, 1], mat: 'dark', sides: 8 },                     // lid
      { box: [-1, 10, -1, 2, 0.8, 2], mat: 'accent' },                       // lid knob
      { box: [-1.5, 0, 3, 3, 0.8, 1.5], mat: 'metal' },                      // foot pedal
    ],
  },
  {
    // Menu board: framed chalkboard on two posts, three accent chalk lines — non-blocking wall dressing
    id: 'kitchen_menu_board', family: 'kitchen', tags: ['sign'], place: 'wall', facing: 'room', blocking: false,
    voxels: [
      { mirror: 'x', ops: [{ box: [6.5, 0, -0.5, 1, 20, 1], mat: 'wood' }] },   // posts
      { box: [-7.5, 20, -0.5, 15, 1, 1], mat: 'wood' },                      // top rail
      { box: [-6.5, 8, 0, 13, 12, 0.5], mat: 'dark' },                       // board (between the posts, not through them)
      { repeat: { n: 3, dy: 3 }, ops: [{ box: [-5, 10, 0.5, 7, 0.6, 0.2], mat: 'accent' }] },   // chalk lines
    ],
  },
];
