// src/engine/props/families/nature.ts
// ============================================================================
// NATURE — the outdoor set: pines, leafy trees, a dead tree, a palm, bush, rocks,
// a fallen log, a mushroom and an ice shard. Same DSL as core.ts:
//   • 1 voxel = 0.35 u. Props stand on y=0, centred on x=z=0, place 'outdoor'.
//   • Tree footprints are derived from the canopy (the audit requires fp to match the built aabb).
//   • Materials, never colours: foliage for leaves, wood for trunks, stone for rock,
//     dark for dead wood, glass + glow for ice. 'accent' is the single pop detail.
// ============================================================================
import type { PropDef } from '../types';

export const NATURE: PropDef[] = [
  // --- Pines: trunk + stacked foliage tiers shrinking upward (18 / 28 / 40 voxels tall) ---
  {
    id: 'nature_pine_s', family: 'nature', tags: ['tree', 'tall'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 1.5, 6], mat: 'wood', sides: 6 },                               // trunk
      { box: [-5, 4, -5, 10, 5, 10], mat: 'foliage' },                                 // bottom tier
      { box: [-4, 8, -4, 8, 4, 8], mat: 'foliage' },
      { box: [-3, 11, -3, 6, 4, 6], mat: 'foliage' },
      { box: [-1.5, 14, -1.5, 3, 4, 3], mat: 'foliage' },                              // tip
    ],
  },
  {
    id: 'nature_pine_m', family: 'nature', tags: ['tree', 'tall'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 2, 9], mat: 'wood', sides: 6 },
      { box: [-8, 6, -8, 16, 7, 16], mat: 'foliage' },
      { box: [-6, 12, -6, 12, 6, 12], mat: 'foliage' },
      { box: [-4, 17, -4, 8, 6, 8], mat: 'foliage' },
      { box: [-2, 22, -2, 4, 6, 4], mat: 'foliage' },
    ],
  },
  {
    id: 'nature_pine_l', family: 'nature', tags: ['tree', 'tall', 'weenie'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 2.5, 12], mat: 'wood', sides: 8 },
      { box: [-11, 8, -11, 22, 9, 22], mat: 'foliage' },
      { box: [-9, 16, -9, 18, 8, 18], mat: 'foliage' },
      { box: [-6, 23, -6, 12, 8, 12], mat: 'foliage' },
      { box: [-3.5, 30, -3.5, 7, 7, 7], mat: 'foliage' },
      { box: [-1.5, 36, -1.5, 3, 4, 3], mat: 'foliage' },
    ],
  },

  // --- Leafy trees: trunk + blocky rounded canopy (a core block, side lobes, a cap) ---
  {
    id: 'nature_leafy_s', family: 'nature', tags: ['tree', 'tall'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 1.5, 8], mat: 'wood', sides: 6 },
      { box: [-5, 6, -5, 10, 7, 10], mat: 'foliage' },                                 // canopy core
      { mirror: 'x', ops: [{ box: [4, 8, -3, 3, 4, 6], mat: 'foliage' }] },            // side lobes
      { mirror: 'z', ops: [{ box: [-3, 8, 4, 6, 4, 3], mat: 'foliage' }] },
      { box: [-3, 13, -3, 6, 3, 6], mat: 'foliage' },                                  // cap
    ],
  },
  {
    id: 'nature_leafy_m', family: 'nature', tags: ['tree', 'tall'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 2, 11], mat: 'wood', sides: 6 },
      { box: [-8, 9, -8, 16, 11, 16], mat: 'foliage' },
      { mirror: 'x', ops: [{ box: [7, 11, -5, 4, 7, 10], mat: 'foliage' }] },
      { mirror: 'z', ops: [{ box: [-5, 11, 7, 10, 7, 4], mat: 'foliage' }] },
      { box: [-6, 20, -6, 12, 4, 12], mat: 'foliage' },
      { box: [-3, 24, -3, 6, 2, 6], mat: 'foliage' },
    ],
  },
  {
    id: 'nature_leafy_l', family: 'nature', tags: ['tree', 'tall', 'weenie'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 3, 15], mat: 'wood', sides: 8 },
      { box: [-12, 12, -12, 24, 15, 24], mat: 'foliage' },
      { mirror: 'x', ops: [{ box: [11, 15, -7, 5, 10, 14], mat: 'foliage' }] },
      { mirror: 'z', ops: [{ box: [-7, 15, 11, 14, 10, 5], mat: 'foliage' }] },
      { box: [-9, 27, -9, 18, 6, 18], mat: 'foliage' },
      { box: [-4, 33, -4, 8, 5, 8], mat: 'foliage' },
    ],
  },

  // --- Dead tree: bare dark trunk with three stubby branches (haunted / dungeon yards) ---
  {
    id: 'nature_tree_dead', family: 'nature', tags: ['tree', 'tall', 'spooky'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 1.5, 20], mat: 'dark', sides: 6 },                              // trunk
      { box: [-1, 20, -1, 2, 3, 2], mat: 'dark' },                                     // split top
      { box: [1, 12, -0.75, 8, 1.5, 1.5], mat: 'dark' },                               // branch +x
      { box: [-8, 15, -0.75, 8, 1.5, 1.5], mat: 'dark' },                              // branch −x
      { box: [-0.75, 18, 1, 1.5, 1.5, 5], mat: 'dark' },                               // branch +z
      { box: [-0.75, 10, -6, 1.5, 1.5, 5], mat: 'dark' },                              // branch −z (low)
      { box: [7, 13.5, -0.5, 1, 3, 1], mat: 'dark' },                                  // upturned twig
    ],
  },

  // --- Palm: three offset trunk cylinders lean −x→+x (balanced about the origin), crown + four fronds sit on the top cylinder ---
  {
    id: 'nature_palm', family: 'nature', tags: ['tree', 'tall'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [-1, 0, 0, 2, 8], mat: 'wood', sides: 6 },                                // trunk base
      { cyl: [0, 7, 0, 1.8, 8], mat: 'wood', sides: 6 },
      { cyl: [1, 14, 0, 1.6, 8], mat: 'wood', sides: 6 },                              // top cylinder, centre (1, 0)
      { box: [-5, 21, -6, 12, 2, 12], mat: 'foliage' },                                // crown, centred on the trunk top
      { box: [-11, 20, -1.5, 8, 1.5, 3], mat: 'foliage' },                             // fronds (four arms from (1, 0))
      { box: [5, 20, -1.5, 8, 1.5, 3], mat: 'foliage' },
      { box: [-0.5, 20, -12, 3, 1.5, 8], mat: 'foliage' },
      { box: [-0.5, 20, 4, 3, 1.5, 8], mat: 'foliage' },
      { box: [2.5, 19, -1, 2, 2, 2], mat: 'accent' },                                  // coconuts, hanging beside the trunk under the crown
    ],
  },

  // --- Bush: three overlapping foliage lumps, walk-through; a hiding spot (the planner pulls 'hide') ---
  {
    id: 'nature_bush', family: 'nature', tags: ['bush', 'cover', 'hide'], place: 'outdoor', facing: 'any', blocking: false, hide: true,
    voxels: [
      { box: [-5, 0, -3, 10, 5, 7], mat: 'foliage' },
      { box: [-3, 2, -4, 6, 4, 8], mat: 'foliage' },
      { box: [-6, 0, -1, 4, 3, 5], mat: 'foliage' },
    ],
  },

  // --- Rocks: offset stone blocks; S is dressing clutter, L is a boulder you hide behind ---
  {
    id: 'nature_rock_s', family: 'nature', tags: ['rock'], place: 'outdoor', facing: 'any', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-3, 0, -2, 6, 3, 4], mat: 'stone' },
      { box: [-1, 1, -1, 4, 3, 3], mat: 'stone' },
      { box: [0, 0, 0, 3, 2, 3], mat: 'stone' },
    ],
  },
  {
    id: 'nature_rock_m', family: 'nature', tags: ['rock'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-6, 0, -4, 12, 5, 8], mat: 'stone' },                                    // body
      { box: [-3, 3, -2, 7, 4, 5], mat: 'stone' },                                     // crown
      { box: [-7, 0, 0, 4, 3, 5], mat: 'stone' },                                      // shoulder
      { box: [2, 0, -6, 4, 3, 4], mat: 'stone' },                                      // toe
    ],
  },
  {
    id: 'nature_rock_l', family: 'nature', tags: ['rock', 'cover'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-10, 0, -7, 20, 8, 14], mat: 'stone' },                                  // boulder body
      { box: [-5, 6, -4, 11, 6, 8], mat: 'stone' },                                    // upper mass
      { box: [-12, 0, -2, 5, 5, 7], mat: 'stone' },                                    // west shoulder
      { box: [4, 0, -10, 6, 4, 5], mat: 'stone' },                                     // north toe
      { box: [-2, 11, -1, 5, 3, 4], mat: 'stone' },                                    // peak
    ],
  },

  // --- Fallen log: a long box with darker cut ends and a stub branch; sit-height top ---
  {
    id: 'nature_log', family: 'nature', tags: ['log', 'seat'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-9, 0, -2.5, 18, 6, 5], mat: 'wood' },                                   // trunk, top at seat height y=6
      { box: [-10, 0.5, -2, 1, 5, 4], mat: 'dark' },                                   // cut ends
      { box: [9, 0.5, -2, 1, 5, 4], mat: 'dark' },
      { box: [-3, 6, -1, 2, 2, 2], mat: 'wood' },                                      // stub branch
      { box: [2, 5.5, -1.5, 5, 0.6, 3], mat: 'foliage' },                              // moss patch
    ],
  },

  // --- Mushroom: pale stem, accent cap with a pale spot; dressing clutter at tree feet ---
  {
    id: 'nature_mushroom', family: 'nature', tags: ['mushroom'], place: 'outdoor', facing: 'any', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-1, 0, -1, 2, 3, 2], mat: 'fabric' },                                    // stem
      { box: [-3, 3, -3, 6, 2, 6], mat: 'accent' },                                    // cap
      { box: [-2, 5, -2, 4, 1, 4], mat: 'accent' },                                    // cap dome
      { box: [-1, 6, -1, 2, 0.4, 2], mat: 'fabric' },                                  // spot
    ],
  },

  // --- Ice shard: stacked glass crystal with a glowing tip and two side splinters ---
  {
    id: 'nature_ice', family: 'nature', tags: ['ice', 'light', 'focal'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { box: [-4, 0, -4, 8, 4, 8], mat: 'glass' },                                     // base block
      { box: [-3, 4, -3, 6, 6, 6], mat: 'glass' },
      { box: [-2, 10, -2, 4, 5, 4], mat: 'glass' },
      { box: [-1, 15, -1, 2, 3, 2], mat: 'glow', emissive: true },                     // tip
      { box: [-6, 0, -1, 3, 5, 3], mat: 'glass' },                                     // splinters
      { box: [3, 0, 1, 3, 3, 3], mat: 'glass' },
    ],
  },
];
