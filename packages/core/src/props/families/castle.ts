// src/engine/props/families/castle.ts
// ============================================================================
// CASTLE — throne room, great hall, armoury, courtyard and cells. Conventions as in
// core.ts: 1 voxel = 0.35 u · props stand on y=0, centred on x=z=0 · wall props face +z
// (their back is the −z face) · materials only (no colours) · ≤ 300 tris (dressing ≤ 60).
// Seats: seat y=6. Surfaces: table top y=10. Fire = 'glow' emissive boxes.
// Tris: one box = 12, one 8-sided cylinder = 32 — so ≤ 25 boxes, or ≤ 5 for dressing.
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

const U = 0.35;   // world units per voxel

/** Three-box flame: fat base, narrower middle, bright tip. x/z = centre, y = base. */
const flame = (x: number, y: number, z: number, s = 1): VoxelOp[] => [
  { box: [x - 1.5 * s, y, z - 1.5 * s, 3 * s, 2 * s, 3 * s], mat: 'glow', emissive: true },
  { box: [x - s, y + 2 * s, z - s, 2 * s, 2 * s, 2 * s], mat: 'glow', emissive: true },
  { box: [x - 0.5 * s, y + 4 * s, z - 0.5 * s, s, 1.5 * s, s], mat: 'accent', emissive: true },
];

export const CASTLE: PropDef[] = [
  {
    // Throne: stone dais, high wooden back with accent cushion, armrests, gold finials. Focal seat facing +z.
    id: 'castle_throne', family: 'castle', tags: ['seat', 'focal', 'weenie'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 3, sides: 1.5 },
    voxels: [
      { box: [-10, 0, -8, 20, 2, 16], mat: 'stone' },                      // dais
      { box: [-8, 2, -6, 16, 1, 12], mat: 'accent' },                      // carpet on the dais
      { box: [-6, 3, -5, 12, 3, 9], mat: 'wood' },                         // seat box
      { box: [-5, 6, -4, 10, 1, 7], mat: 'fabric' },                       // cushion
      { box: [-6, 3, -6, 12, 22, 2], mat: 'wood' },                        // high back
      { box: [-4, 8, -4, 8, 12, 1], mat: 'fabric' },                       // back padding
      { mirror: 'x', ops: [
        { box: [5, 6, -5, 2, 4, 9], mat: 'wood' },                         // armrests
        { box: [5, 25, -6, 2, 3, 2], mat: 'accent' },                      // finials
      ] },
      { box: [-2, 25, -6, 4, 4, 2], mat: 'accent' },                       // crown on the back
    ],
  },
  {
    // Banner: a pole bracketed off the wall, a long fabric drop with an accent emblem and a dark hem.
    id: 'castle_banner', family: 'castle', tags: ['wall', 'decor'], place: 'wall', facing: 'room', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-5, 22, 0, 10, 1, 1], mat: 'wood' },                         // pole
      { box: [-4, 4, 0.3, 8, 18, 0.6], mat: 'fabric' },                    // drop
      { box: [-2, 10, 0.9, 4, 5, 0.3], mat: 'accent' },                    // emblem
      { box: [-4, 2, 0.3, 8, 2, 0.6], mat: 'dark' },                       // hem
      { box: [-1, 0, 0.3, 2, 2, 0.6], mat: 'dark' },                       // point (reaches y=0)
    ],
  },
  {
    // Wall torch: iron bracket, wooden shaft, an emissive flame. A light fixture for stepLights.
    id: 'castle_torch', family: 'castle', tags: ['light', 'wall', 'fire'], place: 'wall', facing: 'room', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-1, 0, 0, 2, 6, 1], mat: 'metal' },                          // bracket (stands on y=0 so the audit holds; place at sconce height)
      { box: [-0.7, 6, 0.5, 1.4, 6, 1.4], mat: 'wood' },                   // shaft
      ...flame(0, 12, 1.2, 1),
    ],
  },
  {
    // Brazier: iron bowl on three legs, coals and a fire. Free-standing light.
    id: 'castle_brazier', family: 'castle', tags: ['light', 'fire', 'focal'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 1.5, sides: 1.5, back: 1.5 },
    voxels: [
      { box: [-3, 0, -3, 6, 1, 6], mat: 'dark' },                          // foot plate
      { cyl: [0, 1, 0, 1.2, 7], mat: 'metal', sides: 6 },                  // stem
      { cyl: [0, 8, 0, 5, 3], mat: 'metal', sides: 8 },                    // bowl
      { cyl: [0, 11, 0, 4, 0.6], mat: 'dark', sides: 8 },                  // coals
      ...flame(0, 11.6, 0, 1.3),
    ],
  },
  {
    // Weapon rack: wooden frame against the wall holding two spears, a sword and an axe.
    id: 'castle_weapon_rack', family: 'castle', tags: ['wall', 'storage', 'decor'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1, sides: 0.3 },
    voxels: [
      { box: [-8, 0, 0, 16, 2, 3], mat: 'wood' },                          // base rail
      { box: [-8, 14, 0, 16, 2, 2], mat: 'wood' },                         // top rail
      { mirror: 'x', ops: [{ box: [7, 2, 0, 1, 12, 2], mat: 'wood' }] },   // uprights
      { box: [-5, 2, 1, 1, 20, 1], mat: 'wood' },  { box: [-5.5, 22, 1, 2, 3, 1], mat: 'metal' },     // spear
      { box: [-2, 2, 1, 1, 19, 1], mat: 'wood' },  { box: [-2.5, 21, 1, 2, 3, 1], mat: 'metal' },     // spear
      { box: [1, 2, 1, 1, 14, 1], mat: 'metal' },  { box: [-0.5, 4, 1, 4, 1, 1], mat: 'accent' },     // sword blade + guard
      { box: [5, 2, 1, 1, 16, 1], mat: 'wood' },   { box: [4, 14, 1, 4, 4, 1], mat: 'metal' },        // axe haft + head
    ],
  },
  {
    // Armour stand: plinth, a post, breastplate, pauldrons and a helmet — knight-shaped cover.
    id: 'castle_armor_stand', family: 'castle', tags: ['decor', 'cover'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1, sides: 0.5 },
    voxels: [
      { box: [-4, 0, -4, 8, 1, 8], mat: 'wood' },                          // plinth
      { box: [-1, 1, -1, 2, 8, 2], mat: 'wood' },                          // post
      { box: [-3, 9, -2, 6, 8, 4], mat: 'metal' },                         // breastplate
      { box: [-1, 11, 2, 2, 3, 0.5], mat: 'accent' },                      // crest
      { mirror: 'x', ops: [{ box: [3, 15, -2, 3, 2, 4], mat: 'metal' }] },   // pauldrons
      { box: [-2.5, 17, -2.5, 5, 5, 5], mat: 'metal' },                    // helmet
      { box: [-1.5, 19, 2.5, 3, 1, 0.3], mat: 'dark' },                    // visor slit
      { box: [-0.5, 22, -1, 1, 3, 3], mat: 'fabric' },                     // plume
    ],
  },
  {
    // Long table: a feast board 30 × 10 on two trestles, top at y=10 · a surface · bench seats on both sides.
    id: 'castle_long_table', family: 'castle', tags: ['surface', 'focal'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 2.5, sides: 2.5, back: 2.5 },
    surfaces: [{ x: -5, z: -1.7, w: 10, d: 3.4, y: 10 * U, max: 6 }],
    satellites: [
      { tag: 'seat', dx: -3, dz: 3.4, rot: 2, p: 0.9 }, { tag: 'seat', dx: 3, dz: 3.4, rot: 2, p: 0.9 },
      { tag: 'seat', dx: -3, dz: -3.4, rot: 0, p: 0.9 }, { tag: 'seat', dx: 3, dz: -3.4, rot: 0, p: 0.9 },
    ],
    voxels: [
      { box: [-15, 9, -5, 30, 1, 10], mat: 'wood' },                       // top
      { box: [-15, 8, -5, 30, 1, 1], mat: 'dark' }, { box: [-15, 8, 4, 30, 1, 1], mat: 'dark' },   // skirt
      { mirror: 'x', ops: [
        { box: [10, 0, -4, 2, 8, 8], mat: 'wood' },                        // trestle
        { box: [9, 0, -4.5, 4, 1, 9], mat: 'dark' },                       // trestle foot
      ] },
      { box: [-13, 1, -0.5, 26, 1, 1], mat: 'wood' },                      // stretcher
      { box: [-12, 10, -3, 24, 0.4, 6], mat: 'fabric' },                   // runner
      { cyl: [-8, 10.4, 0, 1.5, 1], mat: 'metal', sides: 6 },              // platters
      { cyl: [8, 10.4, 0, 1.5, 1], mat: 'metal', sides: 6 },
      { cyl: [0, 10.4, 0, 1, 2.5], mat: 'accent', sides: 6 },              // goblet
    ],
  },
  {
    // Barrel: wooden staves bound by two iron hoops. A hiding place / storage.
    id: 'castle_barrel', family: 'castle', tags: ['hide', 'storage', 'cover'], place: 'floor', facing: 'any', blocking: true, hide: true,
    clearance: { front: 1, sides: 0.3 },
    voxels: [
      { cyl: [0, 0, 0, 3.5, 9], mat: 'wood', sides: 8 },                   // body
      { cyl: [0, 1, 0, 3.7, 1], mat: 'metal', sides: 8 },                  // lower hoop
      { cyl: [0, 7, 0, 3.7, 1], mat: 'metal', sides: 8 },                  // upper hoop
      { cyl: [0, 9, 0, 3, 0.6], mat: 'dark', sides: 8 },                   // lid
    ],
  },
  {
    // Well: round stone wall, two posts, a little roof and a crank with a bucket. A courtyard weenie.
    id: 'castle_well', family: 'castle', tags: ['weenie', 'focal', 'outdoor'], place: 'outdoor', facing: 'any', blocking: true,
    clearance: { front: 2, sides: 2, back: 2 },
    voxels: [
      { cyl: [0, 0, 0, 6, 6], mat: 'stone', sides: 8 },                    // ring
      { cyl: [0, 6, 0, 4.5, 0.5], mat: 'dark', sides: 8 },                 // water/shadow
      { mirror: 'x', ops: [{ box: [5, 6, -1, 1.5, 14, 2], mat: 'wood' }] },   // posts
      { box: [-6, 20, -1, 12, 1, 2], mat: 'wood' },                        // beam
      { box: [-8, 21, -5, 16, 1, 10], mat: 'wood' },                       // roof slab
      { box: [-6, 22, -3, 12, 1, 6], mat: 'accent' },                      // roof ridge
      { cyl: [0, 13, 0, 1, 1], mat: 'metal', sides: 6 },                   // axle hint
      { box: [-1.5, 9, -1.5, 3, 3, 3], mat: 'metal' },                     // bucket
      { box: [-0.3, 12, -0.3, 0.6, 8, 0.6], mat: 'dark' },                 // rope
    ],
  },
  {
    // Hay: a loose pile of straw, three overlapping lumps. Dressing for stables and cells.
    id: 'castle_hay', family: 'castle', tags: ['floor', 'decor', 'clutter'], place: 'floor', facing: 'any', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-7, 0, -5, 14, 2, 10], mat: 'accent' },
      { box: [-5, 2, -3, 9, 2, 7], mat: 'accent' },
      { box: [-2, 4, -1, 5, 1, 4], mat: 'accent' },
      { box: [3, 0, 3, 4, 1, 4], mat: 'accent' },
    ],
  },
  {
    // Anvil on a tree-stump block, with a hammer resting on it. A smith's workstation.
    id: 'castle_anvil', family: 'castle', tags: ['workstation', 'decor'], place: 'floor', facing: 'room', blocking: true, interact: 'workstation',
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { cyl: [0, 0, 0, 4, 6], mat: 'wood', sides: 8 },                     // stump
      { box: [-3, 6, -2, 6, 2, 4], mat: 'metal' },                         // foot
      { box: [-2, 8, -1.5, 4, 2, 3], mat: 'metal' },                       // waist
      { box: [-6, 10, -2, 12, 2, 4], mat: 'metal' },                       // face
      { box: [6, 10.5, -1, 3, 1, 2], mat: 'metal' },                       // horn
      { box: [-2, 12, 0, 1, 4, 1], mat: 'wood' }, { box: [-3, 15, -0.5, 3, 2, 2], mat: 'metal' },   // hammer
    ],
  },
  {
    // Cell bars: an iron grille that closes a cell opening, 26 wide × 23 tall (a door-width wall piece).
    id: 'castle_cell_bars', family: 'castle', tags: ['wall', 'bars'], place: 'wall', facing: 'any', blocking: true,
    clearance: { front: 0.5, sides: 0.3, back: 0.5 },
    voxels: [
      { box: [-13, 0, -0.5, 26, 1, 1], mat: 'metal' },                     // sill
      { box: [-13, 22, -0.5, 26, 1, 1], mat: 'metal' },                    // top rail
      { box: [-13, 10, -0.5, 26, 1, 1], mat: 'metal' },                    // mid rail
      { repeat: { n: 8, dx: 3.5 }, ops: [{ box: [-12.5, 1, -0.5, 1, 21, 1], mat: 'dark' }] },   // bars
    ],
  },
  {
    // Chandelier: an iron ring with candles hung on a chain; authored hanging DOWN from y=0 (the ceiling).
    id: 'castle_chandelier', family: 'castle', tags: ['light', 'ceiling', 'fire'], place: 'ceiling', facing: 'any', blocking: false, outline: false,
    voxels: [
      { box: [-0.5, -6, -0.5, 1, 6, 1], mat: 'dark' },                     // chain
      { box: [-6, -8, -1, 12, 1.5, 2], mat: 'metal' },                     // ring (two crossed bars)
      { box: [-1, -8, -6, 2, 1.5, 12], mat: 'metal' },
      { box: [-5, -7, -5, 10, 1, 1], mat: 'metal' }, { box: [-5, -7, 4, 10, 1, 1], mat: 'metal' },   // rim
      { box: [-5, -7, -5, 1, 1, 10], mat: 'metal' }, { box: [4, -7, -5, 1, 1, 10], mat: 'metal' },
      { mirror: 'x', ops: [{ mirror: 'z', ops: [
        { box: [4, -6.5, 4, 1, 2, 1], mat: 'fabric' },                     // candle
        { box: [4, -4.5, 4, 1, 1.5, 1], mat: 'glow', emissive: true },     // flame
      ] }] },
      { box: [-0.5, -6.5, -0.5, 1, 2.5, 1], mat: 'fabric' },               // centre candle
      { box: [-0.5, -4, -0.5, 1, 1.5, 1], mat: 'glow', emissive: true },
    ],
  },
  {
    // Tapestry: a wide fabric hanging on a rod with an embroidered accent scene and dark border.
    id: 'castle_tapestry', family: 'castle', tags: ['wall', 'decor'], place: 'wall', facing: 'room', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-11, 22, 0, 22, 1, 1], mat: 'wood' },                        // rod
      { box: [-10, 4, 0.3, 20, 18, 0.6], mat: 'fabric' },                  // cloth
      { box: [-8, 7, 0.9, 16, 12, 0.3], mat: 'accent' },                   // scene
      { box: [-10, 0, 0.3, 20, 4, 0.6], mat: 'dark' },                     // fringe (reaches y=0)
    ],
  },
  {
    // Shield wall: two crossed swords behind a kite shield, mounted on a dark plaque.
    id: 'castle_shield_wall', family: 'castle', tags: ['wall', 'decor'], place: 'wall', facing: 'room', blocking: false, outline: false,
    voxels: [
      { box: [-6, 0, 0, 12, 14, 0.6], mat: 'dark' },                       // plaque
      { box: [-5, 3, 0.6, 10, 1, 0.6], mat: 'metal' }, { box: [-1, 1, 0.6, 2, 12, 0.6], mat: 'metal' },   // crossed swords (as a + for tris)
      { box: [-4, 2, 1.2, 8, 9, 0.8], mat: 'accent' },                     // shield
      { box: [-3, 11, 1.2, 6, 2, 0.8], mat: 'accent' },                    // shield top
      { box: [-0.5, 3, 2, 1, 9, 0.3], mat: 'metal' },                      // shield boss line
      { box: [-4, 7, 2, 8, 1, 0.3], mat: 'metal' },
    ],
  },
  {
    // Candle stand: an iron tripod with three candles. Free-standing light.
    id: 'castle_candle_stand', family: 'castle', tags: ['light', 'fire', 'decor'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 0.5, sides: 0.5 },
    voxels: [
      { box: [-3, 0, -3, 6, 1, 6], mat: 'dark' },                          // foot
      { cyl: [0, 1, 0, 0.8, 14], mat: 'metal', sides: 6 },                 // stem
      { box: [-4, 15, -0.5, 8, 1, 1], mat: 'metal' },                      // arm
      { repeat: { n: 3, dx: 3 }, ops: [
        { box: [-3.5, 16, -0.5, 1, 3, 1], mat: 'fabric' },                 // candles
        { box: [-3.5, 19, -0.5, 1, 1.5, 1], mat: 'glow', emissive: true }, // flames
      ] },
    ],
  },
  {
    // Stocks: two posts holding a hinged board with three holes. Courtyard dressing / cover.
    id: 'castle_stocks', family: 'castle', tags: ['decor', 'cover', 'outdoor'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { mirror: 'x', ops: [{ box: [7, 0, -1, 2, 14, 2], mat: 'wood' }] },  // posts
      { box: [-8, 8, -0.5, 16, 2, 1.5], mat: 'wood' },                     // lower board
      { box: [-8, 11, -0.5, 16, 2, 1.5], mat: 'wood' },                    // upper board
      { repeat: { n: 3, dx: 5 }, ops: [{ box: [-6, 10, -0.6, 2, 1, 1.7], mat: 'dark' }] },   // holes
      { box: [-1, 13, -1.5, 2, 1, 3], mat: 'metal' },                      // hinge/lock
    ],
  },
  {
    // Cauldron: iron pot on three legs over a fire, with a glowing brew. Witches' kitchens and keeps.
    id: 'castle_cauldron', family: 'castle', tags: ['light', 'fire', 'workstation', 'decor'], place: 'floor', facing: 'any', blocking: true, interact: 'workstation',
    clearance: { front: 1.5, sides: 1 },
    voxels: [
      { box: [-5, 0, -1, 10, 1.5, 2], mat: 'dark' }, { box: [-1, 0, -5, 2, 1.5, 10], mat: 'dark' },   // logs
      { box: [-2, 1.5, -2, 4, 2, 4], mat: 'glow', emissive: true },       // fire
      { mirror: 'x', ops: [{ box: [3, 0, -0.5, 1, 5, 1], mat: 'metal' }] },   // legs
      { box: [-0.5, 0, 3, 1, 5, 1], mat: 'metal' },
      { cyl: [0, 4, 0, 5, 6], mat: 'metal', sides: 8 },                    // pot
      { cyl: [0, 10, 0, 5.5, 1], mat: 'dark', sides: 8 },                  // rim
      { cyl: [0, 10.2, 0, 4.5, 1], mat: 'glow', emissive: true, sides: 8 },   // brew
      { box: [-3, 11, -0.5, 1, 6, 1], mat: 'wood' },                       // ladle
    ],
  },
];
