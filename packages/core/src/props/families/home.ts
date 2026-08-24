// src/engine/props/families/home.ts
// ============================================================================
// HOME — living room, bedroom, study and bathroom furniture. Conventions as in core.ts:
// 1 voxel = 0.35 u · props stand on y=0, centred on x=z=0 · wall props face +z (their
// back is the −z face) · materials only (no colours) · ≤ 300 tris (dressing ≤ 60).
// Seats: chair seat y=6. Surfaces: desk / table top y=10, dresser top y=13.
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

const U = 0.35;   // world units per voxel

/** Four straight wood legs at the corners of a (2hw × 2hd) top, authored once and mirrored. */
const legs = (hw: number, hd: number, h: number, t = 1.5): VoxelOp => ({
  mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [hw - t, 0, hd - t, t, h, t], mat: 'wood' }] }],
});

export const HOME: PropDef[] = [
  {
    // Three-seat sofa: fabric base and back, padded arms, three cushions; a seat facing +z (back to the wall).
    id: 'home_sofa', family: 'home', tags: ['seat'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { mirror: 'x', ops: [{ box: [10, 0, -4, 1, 1, 1], mat: 'dark' }, { box: [10, 0, 3, 1, 1, 1], mat: 'dark' }] },   // feet
      { box: [-12, 1, -5, 24, 4, 10], mat: 'fabric' },                     // base
      { box: [-12, 5, -5, 24, 5, 3], mat: 'fabric' },                      // back rest
      { mirror: 'x', ops: [{ box: [10, 5, -2, 2, 3, 7], mat: 'fabric' }] },  // arms
      { repeat: { n: 3, dx: 7 }, ops: [{ box: [-10, 5, -2, 6, 1, 7], mat: 'accent' }] },   // seat cushions
      { repeat: { n: 2, dx: 7 }, ops: [{ box: [-3.5, 5, -2, 0.5, 1, 7], mat: 'dark' }] },  // cushion seams
    ],
  },
  {
    // Armchair: one fabric seat with a high back and wide arms; faces +z.
    id: 'home_armchair', family: 'home', tags: ['seat'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.5 },
    voxels: [
      { mirror: 'x', ops: [{ box: [4, 0, -4, 1, 1, 1], mat: 'dark' }, { box: [4, 0, 3, 1, 1, 1], mat: 'dark' }] },   // feet
      { box: [-6, 1, -5, 12, 4, 10], mat: 'fabric' },                      // base
      { box: [-6, 5, -5, 12, 6, 3], mat: 'fabric' },                       // back rest
      { mirror: 'x', ops: [{ box: [4, 5, -2, 2, 3, 7], mat: 'fabric' }] },   // arms
      { box: [-4, 5, -2, 8, 1, 7], mat: 'accent' },                        // cushion
    ],
  },
  {
    // Double bed (26 × 31): wood frame and headboard (−z), mattress, blanket, two pillows; sleep + bed interaction.
    id: 'home_bed', family: 'home', tags: ['sleep'], place: 'floor', facing: 'room', blocking: true, interact: 'bed',
    clearance: { front: 1.5, sides: 1.5 },
    voxels: [
      { box: [-12, 0, -14, 24, 2, 28], mat: 'dark' },                      // plinth
      { box: [-13, 2, -15, 26, 3, 31], mat: 'wood' },                      // frame
      { box: [-13, 0, -15.5, 26, 14, 1.5], mat: 'wood' },                  // headboard
      { box: [-12, 5, -14, 24, 3, 29], mat: 'fabric' },                    // mattress
      { box: [-12, 8, -5, 24, 1.5, 20], mat: 'accent' },                   // blanket
      { mirror: 'x', ops: [{ box: [2, 8, -13, 9, 2, 6], mat: 'fabric' }] },  // pillows
    ],
  },
  {
    // Bunk bed: two stacked single beds on four posts, guard rail and a ladder on the +x side; sleep.
    id: 'home_bed_bunk', family: 'home', tags: ['sleep'], place: 'floor', facing: 'room', blocking: true, interact: 'bed',
    clearance: { front: 1.5, sides: 1.5 },
    voxels: [
      { mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [8.5, 0, 14, 1.5, 26, 1.5], mat: 'wood' }] }] },   // posts
      { repeat: { n: 2, dy: 13 }, ops: [
        { box: [-10, 3, -15.5, 20, 2, 31], mat: 'wood' },                  // frame
        { box: [-9.5, 5, -15, 19, 2.5, 30], mat: 'fabric' },               // mattress
        { box: [-9.5, 7.5, -5, 19, 1, 19], mat: 'accent' },                // blanket
        { box: [-4, 7.5, -14, 8, 1.5, 5], mat: 'fabric' },                 // pillow
      ] },
      { box: [-10.5, 21, -12, 1, 3, 24], mat: 'wood' },                    // upper guard rail (−x)
      { mirror: 'z', ops: [{ box: [10, 0, 3, 0.8, 20, 0.8], mat: 'wood' }] },   // ladder rails
      { repeat: { n: 5, dy: 4 }, ops: [{ box: [10, 2, -3, 0.8, 0.8, 6], mat: 'wood' }] },   // ladder rungs
    ],
  },
  {
    // Wardrobe (20 × 8 × 23): two wood doors with a dark gap and accent handles; a hiding place.
    id: 'home_wardrobe', family: 'home', tags: ['hide'], place: 'wall', facing: 'room', blocking: true, hide: true,
    clearance: { front: 2, sides: 0.3 },
    voxels: [
      { box: [-10, 0, -4, 20, 23, 8], mat: 'wood' },                       // body
      { box: [-10.5, 23, -4.5, 21, 1, 9], mat: 'dark' },                   // cornice
      { box: [-10.5, 0, -4.5, 21, 1, 9], mat: 'dark' },                    // plinth
      { box: [-0.4, 1, 4, 0.8, 22, 0.3], mat: 'dark' },                    // door gap
      { mirror: 'x', ops: [{ box: [1, 10, 4.2, 1, 3, 0.5], mat: 'accent' }] },   // handles
    ],
  },
  {
    // Dresser: chest of three drawers; offers its top (y=13) as a surface.
    id: 'home_dresser', family: 'home', tags: ['surface'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    surfaces: [{ x: -2.8, z: -1.4, w: 5.6, d: 2.8, y: 13 * U, max: 3 }],
    voxels: [
      { box: [-7, 0, -3, 14, 1, 6], mat: 'dark' },                         // plinth
      { box: [-8, 1, -4, 16, 11, 8], mat: 'wood' },                        // body
      { box: [-8.5, 12, -4.5, 17, 1, 9], mat: 'wood' },                    // top
      { repeat: { n: 3, dy: 3.5 }, ops: [
        { box: [-7, 1.5, 4, 14, 2.5, 0.4], mat: 'dark' },                  // drawer fronts
        { mirror: 'x', ops: [{ box: [2.5, 2.4, 4.4, 1, 0.8, 0.4], mat: 'accent' }] },   // knobs
      ] },
    ],
  },
  {
    // Bookshelf: tall open wood case with five shelves of books against the wall (no free surface: shelves are full).
    id: 'home_bookshelf', family: 'home', tags: ['storage', 'tall'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { mirror: 'x', ops: [{ box: [7, 0, -3, 1, 26, 6], mat: 'wood' }] },    // sides
      { box: [-7, 0, -3, 14, 26, 0.6], mat: 'wood' },                      // back panel
      { repeat: { n: 5, dy: 6 }, ops: [{ box: [-7, 0, -3, 14, 1, 6], mat: 'wood' }] },   // shelves (y 0, 6, 12, 18, 24)
      { box: [-8, 25, -3.5, 16, 1, 7], mat: 'wood' },                      // top board
      { repeat: { n: 4, dy: 6 }, ops: [
        { box: [-7, 1, -2.5, 5, 4.5, 4.5], mat: 'accent' },                // book rows
        { box: [-1.5, 1, -2.5, 4, 4, 4.5], mat: 'fabric' },
        { box: [3, 1, -2.5, 3.5, 5, 4.5], mat: 'dark' },
      ] },
    ],
  },
  {
    // Writing desk: wood top (y=10) on a drawer pedestal (+x) and two legs; offers a seat in front (+z) and a surface.
    id: 'home_desk', family: 'home', tags: ['surface', 'workstation'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.5 },
    satellites: [{ tag: 'seat', dx: -1, dz: 3.4, rot: 2, p: 0.9 }],
    surfaces: [{ x: -3.5, z: -1.7, w: 7, d: 3.4, y: 10 * U, max: 4 }],
    voxels: [
      { box: [-10, 9, -5, 20, 1, 10], mat: 'wood' },                       // top
      { box: [3, 0, -4, 7, 9, 8], mat: 'wood' },                           // drawer pedestal
      { repeat: { n: 2, dy: 4 }, ops: [
        { box: [3.5, 1, 4, 6, 3, 0.4], mat: 'dark' },                      // drawer fronts
        { box: [6, 2.2, 4.4, 1, 0.8, 0.4], mat: 'accent' },                // knobs
      ] },
      { box: [-10, 0, -4, 1.5, 9, 1.5], mat: 'wood' },                     // legs (−x)
      { box: [-10, 0, 2.5, 1.5, 9, 1.5], mat: 'wood' },
      { box: [-9, 2, -4, 12, 7, 0.8], mat: 'wood' },                       // modesty panel
      { box: [-7, 10, -2, 5, 0.5, 4], mat: 'accent' },                     // notebook
    ],
  },
  {
    // Dining table: wood top (y=10) on an apron and four legs; offers a surface and four seats (two each side).
    id: 'home_table', family: 'home', tags: ['surface'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 2.5, sides: 2.5, back: 2.5 },
    satellites: [
      { tag: 'seat', dx: -2, dz: 4.2, rot: 2, p: 0.9 }, { tag: 'seat', dx: 2, dz: 4.2, rot: 2, p: 0.9 },
      { tag: 'seat', dx: -2, dz: -4.2, rot: 0, p: 0.9 }, { tag: 'seat', dx: 2, dz: -4.2, rot: 0, p: 0.9 },
    ],
    surfaces: [{ x: -4.2, z: -2.8, w: 8.4, d: 5.6, y: 10 * U, max: 6 }],
    voxels: [
      legs(12, 8, 7, 2),
      { box: [-11, 7, -7, 22, 2, 14], mat: 'wood' },                       // apron
      { box: [-12, 9, -8, 24, 1, 16], mat: 'wood' },                       // top
      { box: [-3, 10, -9.5, 6, 0.4, 19], mat: 'accent' },                  // runner
    ],
  },
  {
    // Dining chair: wood seat (y=6), four legs, slatted back on the −z side; a seat facing +z.
    id: 'home_chair', family: 'home', tags: ['seat'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1, sides: 0.3 },
    voxels: [
      legs(4, 4, 5, 1),
      { box: [-4, 5, -4, 8, 1, 8], mat: 'wood' },                          // seat
      { box: [-3.5, 6, -3, 7, 0.5, 6], mat: 'accent' },                    // cushion
      { mirror: 'x', ops: [{ box: [3, 6, -4, 1, 9, 1], mat: 'wood' }] },     // back posts
      { box: [-4, 13, -4, 8, 2, 1], mat: 'wood' },                         // top rail
      { box: [-3, 9, -4, 6, 1.5, 1], mat: 'wood' },                        // mid slat
    ],
  },
  {
    // Television on a low media console: dark panel with an emissive screen facing +z; stands against the wall.
    id: 'home_tv', family: 'home', tags: ['light', 'focal'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 3, sides: 0.3 },
    voxels: [
      { box: [-12, 0, -3, 24, 6, 6], mat: 'wood' },                        // console
      { mirror: 'x', ops: [{ box: [1, 1, 3, 10, 4, 0.4], mat: 'dark' }] },   // console doors
      { box: [-3, 6, -1.5, 6, 0.6, 3], mat: 'dark' },                      // tv foot
      { box: [-1, 6, -0.5, 2, 2, 1], mat: 'dark' },                        // neck
      { box: [-11, 8, -0.5, 22, 12, 0.8], mat: 'dark' },                   // panel
      { box: [-10.5, 8.5, 0.3, 21, 11, 0.4], mat: 'glow', emissive: true },   // screen
    ],
  },
  {
    // Floor lamp: metal base and pole with a fabric shade; the bulb glows (light).
    id: 'home_lamp', family: 'home', tags: ['light'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 0.5, sides: 0.5 },
    voxels: [
      { cyl: [0, 0, 0, 3, 0.8], mat: 'metal', sides: 8 },                  // base
      { cyl: [0, 0.8, 0, 0.5, 19.2], mat: 'metal', sides: 6 },             // pole
      { box: [-2.5, 19, -2.5, 5, 1.5, 5], mat: 'glow', emissive: true },   // bulb
      { box: [-3.5, 20, -3.5, 7, 5, 7], mat: 'fabric' },                   // shade
      { box: [-3, 25, -3, 6, 0.4, 6], mat: 'dark' },                       // shade top ring
    ],
  },
  {
    // Area rug: flat fabric with an accent border; walkable floor dressing.
    id: 'home_rug', family: 'home', tags: ['floor', 'decor'], place: 'floor', facing: 'any', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-10, 0, -7, 20, 0.4, 14], mat: 'fabric' },
      { mirror: 'z', ops: [{ box: [-10, 0.4, 6, 20, 0.1, 1], mat: 'accent' }] },   // long borders
      { mirror: 'x', ops: [{ box: [9, 0.4, -7, 1, 0.1, 14], mat: 'accent' }] },    // short borders
    ],
  },
  {
    // Bathroom set: bathtub (−x), toilet (centre) and pedestal sink with mirror (+x) as one wall run.
    id: 'home_bath_set', family: 'home', tags: ['decor'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.3 },
    voxels: [
      { box: [-15, 0, -4, 13, 2, 8], mat: 'stone' },                       // tub floor
      { box: [-15, 2, -4, 13, 4, 1], mat: 'stone' },                       // tub walls (back, front, ends)
      { box: [-15, 2, 3, 13, 4, 1], mat: 'stone' },
      { box: [-15, 2, -3, 1, 4, 6], mat: 'stone' },
      { box: [-3, 2, -3, 1, 4, 6], mat: 'stone' },
      { box: [-14, 2, -3, 11, 3, 6], mat: 'glass' },                       // water (rim 1 above it)
      { box: [-13, 6, 2, 4, 0.6, 3], mat: 'accent' },                      // towel on the rim
      { box: [-4, 6, -3.5, 1, 2, 1], mat: 'metal' },                       // tub tap
      { box: [-1, 5, -4, 5, 8, 2], mat: 'stone' },                         // cistern
      { box: [-0.5, 0, -2, 4, 5, 5], mat: 'stone' },                       // toilet base
      { box: [-1, 5, -2, 5, 2, 6], mat: 'stone' },                         // bowl
      { box: [-1, 7, -2, 5, 0.4, 6], mat: 'dark' },                        // seat
      { box: [8, 0, -2, 4, 8, 4], mat: 'stone' },                          // sink pedestal
      { box: [6, 8, -4, 9, 2, 7], mat: 'stone' },                          // basin
      { box: [10, 10, -3.5, 1, 2, 1], mat: 'metal' },                      // sink tap
      { box: [6, 13, -4, 9, 8, 0.5], mat: 'glass' },                       // mirror
    ],
  },
];
