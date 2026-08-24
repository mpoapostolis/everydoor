// src/engine/props/families/structure.ts
// ============================================================================
// STRUCTURE — the building kit the composer stacks outdoors: wall / corner / window
// segments (14 u tall = 40 voxels, 5 u wide = 14 voxels, 1 u thick = 3 voxels), roofs,
// round tower drum + top, battlements, stairs, bridges, a pier and a tent.
// Conventions as in core.ts: 1 voxel = 0.35 u, stand on y=0, centred on x=z=0,
// materials only. Wall segments face +z (their "room" side) with the back at z≈−1.5.
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

const W = 14;   // segment width (5 u)
const H = 40;   // room wall height (14 u)
const T = 3;    // wall thickness (1 u)

/** Shared plinth + coping for the 14-wide stone segments. */
const TRIM: VoxelOp[] = [
  { box: [-W / 2, 0, -T / 2 - 0.5, W, 3, T + 1], mat: 'dark' },        // plinth course
  { box: [-W / 2, H - 2, -T / 2 - 0.5, W, 2, T + 1], mat: 'dark' },    // coping course
];

export const STRUCTURE: PropDef[] = [
  {
    // Plain stone wall segment, 5 u wide × 14 u tall × 1 u thick.
    id: 'struct_wall', family: 'structure', tags: ['wall', 'tall'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-W / 2, 0, -T / 2, W, H, T], mat: 'stone' },
      ...TRIM,
    ],
  },
  {
    // L-shaped corner piece: two 5 u legs meeting at right angles, 14 u tall.
    id: 'struct_corner', family: 'structure', tags: ['wall', 'corner', 'tall'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-7, 0, -7, W, H, T], mat: 'stone' },                         // leg along x (back edge)
      { box: [-7, 0, -4, T, H, 11], mat: 'stone' },                        // leg along z (left edge)
      { box: [-7.5, 0, -7.5, W + 1, 3, T + 1], mat: 'dark' },              // plinth along x
      { box: [-7.5, 0, -4, T + 1, 3, 11.5], mat: 'dark' },                 // plinth along z
      { box: [-7.5, H - 2, -7.5, W + 1, 2, T + 1], mat: 'dark' },          // coping along x
      { box: [-7.5, H - 2, -4, T + 1, 2, 11.5], mat: 'dark' },             // coping along z
      { box: [-8, 0, -8, 4, H, 4], mat: 'stone' },                         // quoin post at the corner
    ],
  },
  {
    // Wall segment with a tall glazed window, crossed mullions and an accent sill.
    id: 'struct_window', family: 'structure', tags: ['wall', 'window', 'tall'], place: 'outdoor', facing: 'room', blocking: true,
    voxels: [
      { box: [-W / 2, 0, -T / 2, W, 14, T], mat: 'stone' },                // below the window
      { box: [-W / 2, 28, -T / 2, W, 12, T], mat: 'stone' },               // above the window
      { mirror: 'x', ops: [{ box: [4, 14, -T / 2, 3, 14, T], mat: 'stone' }] },   // jambs
      { box: [-4, 14, -0.5, 8, 14, 1], mat: 'glass' },                     // pane
      { box: [-0.5, 14, -0.7, 1, 14, 1.4], mat: 'dark' },                  // vertical mullion
      { box: [-4, 20.5, -0.7, 8, 1, 1.4], mat: 'dark' },                   // transom
      { box: [-5, 13, 0.5, 10, 1, 2], mat: 'accent' },                     // sill
      ...TRIM,
    ],
  },
  {
    // Gable roof slice, 5 u wide: two stair slopes meeting at a ridge beam along x.
    id: 'struct_roof_gable', family: 'structure', tags: ['roof'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { stairs: [-W / 2, 0, -10, W, 10, 10], mat: 'wood', dir: 0 },        // back slope, rises toward the ridge
      { stairs: [-W / 2, 0, 0, W, 10, 10], mat: 'wood', dir: 2 },          // front slope
      { box: [-W / 2, 10, -1, W, 1.5, 2], mat: 'dark' },                   // ridge beam
      { mirror: 'z', ops: [{ box: [-W / 2, 0, 9.5, W, 1.5, 1], mat: 'dark' }] },   // eaves boards
    ],
  },
  {
    // Flat roof slab with a low parapet all round.
    id: 'struct_roof_flat', family: 'structure', tags: ['roof'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-7, 0, -7, W, 2, W], mat: 'stone' },                         // slab
      { mirror: 'x', ops: [{ box: [6, 2, -7, 1, 3, W], mat: 'stone' }] },  // parapet (x sides)
      { mirror: 'z', ops: [{ box: [-7, 2, 6, W, 3, 1], mat: 'stone' }] },  // parapet (z sides)
      { box: [-6, 2, -6, 12, 0.5, 12], mat: 'dark' },                      // tar deck
    ],
  },
  {
    // Conical tower roof from stacked shrinking cylinders, accent finial.
    id: 'struct_roof_cone', family: 'structure', tags: ['roof'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 9, 1.5], mat: 'dark', sides: 8 },                   // eave ring
      { cyl: [0, 1.5, 0, 8, 4], mat: 'wood', sides: 8 },
      { cyl: [0, 5.5, 0, 6.5, 4], mat: 'wood', sides: 8 },
      { cyl: [0, 9.5, 0, 5, 4], mat: 'wood', sides: 8 },
      { cyl: [0, 13.5, 0, 3.5, 4], mat: 'wood', sides: 8 },
      { cyl: [0, 17.5, 0, 2, 4], mat: 'wood', sides: 8 },
      { cyl: [0, 21.5, 0, 0.8, 4], mat: 'dark', sides: 6 },                // spire
      { box: [-1, 25.5, -1, 2, 2, 2], mat: 'accent' },                     // finial
    ],
  },
  {
    // Round tower segment: 12-sided drum, 14 u tall, with plinth and string course.
    id: 'struct_tower_drum', family: 'structure', tags: ['wall', 'tower', 'tall'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 9, 3], mat: 'dark', sides: 12 },                    // plinth
      { cyl: [0, 3, 0, 8, H - 5], mat: 'stone', sides: 12 },               // drum
      { cyl: [0, H - 2, 0, 8.5, 2], mat: 'dark', sides: 12 },              // string course
      { box: [-2, 20, 7.5, 4, 6, 1.2], mat: 'dark' },                      // arrow slit on the +z face
    ],
  },
  {
    // Battlemented round tower top: corbelled ring, walkway and eight merlons.
    id: 'struct_tower_top', family: 'structure', tags: ['roof', 'tower'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 9.5, 3], mat: 'stone', sides: 12 },                 // corbel ring
      { cyl: [0, 3, 0, 8, 0.6], mat: 'dark', sides: 12 },                  // walkway
      { mirror: 'x', ops: [
        { box: [7, 3, -1.5, 3, 4, 3], mat: 'stone' },                      // ±x merlons
        { box: [4.5, 3, 4.5, 3, 4, 3], mat: 'stone' },                     // diagonal merlons
        { box: [4.5, 3, -7.5, 3, 4, 3], mat: 'stone' },
      ] },
      { mirror: 'z', ops: [{ box: [-1.5, 3, 7, 3, 4, 3], mat: 'stone' }] },   // ±z merlons
    ],
  },
  {
    // Crenellated wall top: low stone strip with three merlons (sits on a struct_wall).
    id: 'struct_battlement', family: 'structure', tags: ['wall', 'roof'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-W / 2, 0, -T / 2 - 0.5, W, 3, T + 1], mat: 'stone' },       // walkway course
      { repeat: { n: 3, dx: 5.5 }, ops: [{ box: [-7, 3, -T / 2, 3, 5, T], mat: 'stone' }] },   // merlons
      { repeat: { n: 3, dx: 5.5 }, ops: [{ box: [-7, 8, -T / 2 - 0.3, 3, 0.6, T + 0.6], mat: 'dark' }] },   // merlon caps
    ],
  },
  {
    // Decorative stone stairs, 5 u wide, rising toward +z, with side cheeks.
    id: 'struct_stairs', family: 'structure', tags: ['stairs'], place: 'outdoor', facing: 'room', blocking: true,
    voxels: [
      { stairs: [-6, 0, -6, 12, 10, 12], mat: 'stone', dir: 0 },
      { mirror: 'x', ops: [{ box: [6, 0, -6, 1, 11, 12], mat: 'dark' }] }, // cheek walls
      { box: [-6, 10, 4, 12, 0.5, 2], mat: 'accent' },                     // top landing nosing
    ],
  },
  {
    // Plank bridge, 12 u long along x, with posts and rails both sides.
    id: 'struct_bridge_12', family: 'structure', tags: ['bridge', 'walkway'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-17, 2, -5, 34, 1, 10], mat: 'wood' },                       // deck
      { mirror: 'z', ops: [{ box: [-17, 0, 4, 34, 2, 1], mat: 'dark' }] }, // stringers
      { repeat: { n: 6, dx: 6 }, ops: [{ box: [-15.25, 3, -5, 0.5, 0.3, 10], mat: 'dark' }] },   // plank gaps (symmetric about x=0)
      { mirror: 'z', ops: [
        { repeat: { n: 4, dx: 11 }, ops: [{ box: [-17, 3, 4, 1, 6, 1], mat: 'wood' }] },      // posts
        { box: [-17, 8, 4, 34, 1, 1], mat: 'accent' },                     // rail
      ] },
    ],
  },
  {
    // Plank bridge, 24 u long along x, with posts and rails both sides.
    id: 'struct_bridge_24', family: 'structure', tags: ['bridge', 'walkway'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-34, 2, -5, 68, 1, 10], mat: 'wood' },                       // deck
      { mirror: 'z', ops: [{ box: [-34, 0, 4, 68, 2, 1], mat: 'dark' }] }, // stringers
      { repeat: { n: 5, dx: 13 }, ops: [{ box: [-26.25, 3, -5, 0.5, 0.3, 10], mat: 'dark' }] },   // plank gaps (symmetric about x=0)
      { mirror: 'z', ops: [
        { repeat: { n: 7, dx: 11 }, ops: [{ box: [-34, 3, 4, 2, 6, 1], mat: 'wood' }] },      // posts (2 wide: -34..-32 … 32..34, integer pitch)
        { box: [-34, 8, 4, 68, 1, 1], mat: 'accent' },                     // rail
      ] },
    ],
  },
  {
    // Wooden pier segment: plank deck on six posts, edge beams and an accent bollard.
    id: 'struct_pier', family: 'structure', tags: ['walkway', 'dock'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-10, 5, -5, 20, 1, 10], mat: 'wood' },                       // deck
      { mirror: 'z', ops: [{ box: [-10, 4, 4, 20, 1, 1], mat: 'dark' }] }, // edge beams
      { mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [7, 0, 3, 2, 5, 2], mat: 'dark' }] }] },   // corner posts
      { mirror: 'z', ops: [{ box: [-1, 0, 3, 2, 5, 2], mat: 'dark' }] },   // middle posts
      { repeat: { n: 3, dx: 6 }, ops: [{ box: [-6.25, 6, -5, 0.5, 0.3, 10], mat: 'dark' }] },   // plank gaps (symmetric about x=0)
      { box: [8, 6, 3, 1.5, 3, 1.5], mat: 'accent' },                      // bollard
    ],
  },
  {
    // Canvas ridge tent: two fabric slopes on a ridge pole with a dark doorway at the +x end.
    // (The −x end is already closed by the solid slope ends — no separate flap needed.)
    id: 'struct_tent', family: 'structure', tags: ['shelter', 'rest'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { stairs: [-7, 0, -9, W, 9, 9], mat: 'fabric', dir: 0 },             // back slope
      { stairs: [-7, 0, 0, W, 9, 9], mat: 'fabric', dir: 2 },              // front slope
      { box: [-7.5, 9, -0.5, 15, 1, 1], mat: 'dark' },                     // ridge pole
      { mirror: 'x', ops: [{ box: [7, 0, -0.5, 0.6, 9.5, 1], mat: 'wood' }] },   // end poles
      { box: [6.8, 0, -2.5, 0.5, 6, 5], mat: 'dark' },                     // doorway opening (+x end)
    ],
  },
];
