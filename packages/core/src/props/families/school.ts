// src/engine/props/families/school.ts
// ============================================================================
// SCHOOL — classroom, hallway, cafeteria and gym furniture. Conventions as in core.ts:
// 1 voxel = 0.35 u · props stand on y=0, centred on x=z=0 · wall props face +z with
// their back at z≈0 · materials only (no colours) · ≤ 300 tris (dressing ≤ 60).
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

const U = 0.35;   // world units per voxel

/** Four straight legs at the corners of a (w × d) top, authored once and mirrored. */
const legs = (hw: number, hd: number, h: number, t = 1): VoxelOp => ({
  mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [hw - t, 0, hd - t, t, h, t], mat: 'metal' }] }],
});

export const SCHOOL: PropDef[] = [
  {
    // Single pupil desk: metal frame, wood top (y=10) with a book shelf underneath; offers a seat satellite in front (+z).
    id: 'school_desk', family: 'school', tags: ['surface', 'workstation'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.5 },
    satellites: [{ tag: 'seat', dx: 0, dz: 3.2, rot: 2, p: 0.9 }],
    surfaces: [{ x: -1.7, z: -1.4, w: 3.4, d: 2.8, y: 10 * U, max: 2 }],
    voxels: [
      legs(5, 4, 9),
      { box: [-5, 9, -4, 10, 1, 8], mat: 'wood' },                         // top
      { box: [-4.5, 6, -3.5, 9, 0.6, 6], mat: 'metal' },                   // book shelf
      { mirror: 'x', ops: [{ box: [-5, 6, -4, 1, 3, 8], mat: 'metal' }] },   // shelf side rails
      { box: [-3, 10, -1, 4, 0.5, 3], mat: 'accent' },                     // notebook on top
    ],
  },
  {
    // Teacher's desk: wide wood desk with a drawer pedestal; offers a bigger top (y=10) and a seat behind it (−z).
    id: 'school_desk_teacher', family: 'school', tags: ['surface', 'workstation'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.5, back: 2.5 },
    satellites: [{ tag: 'seat', dx: 0, dz: -3.4, rot: 0, p: 0.9 }],
    surfaces: [{ x: -3.3, z: -1.7, w: 6.6, d: 3.4, y: 10 * U, max: 4 }],
    voxels: [
      { box: [-10, 9, -5, 20, 1, 10], mat: 'wood' },                        // top
      { box: [-10, 0, -4, 6, 9, 8], mat: 'wood' },                          // drawer pedestal (left)
      { box: [4, 0, -4, 6, 9, 8], mat: 'wood' },                            // drawer pedestal (right)
      { box: [-10, 1, 3, 20, 8, 1], mat: 'wood' },                          // modesty panel on the pupils' side
      { mirror: 'x', ops: [{ repeat: { n: 3, dy: 3 }, ops: [{ box: [6, 1, -4.4, 2, 0.6, 0.5], mat: 'accent' }] }] },   // drawer handles on the teacher's (−z) face of both pedestals
      { box: [-1, 10, -1, 3, 1, 2], mat: 'accent' },                        // apple / mug
    ],
  },
  {
    // Pupil chair: moulded seat shell (y=6) and back on four metal legs; the seat satellite the desks pull.
    id: 'school_chair', family: 'school', tags: ['seat'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1, sides: 0.3 },
    voxels: [
      legs(3, 3, 5),
      { box: [-3, 5, -3, 6, 1, 6], mat: 'accent' },                          // seat shell (top y=6)
      { box: [-3, 6, -3, 6, 6, 1], mat: 'accent' },                          // back rest (−z side, pupil faces +z)
      { mirror: 'x', ops: [{ box: [2, 6, -2.6, 0.6, 5, 0.6], mat: 'metal' }] },   // back struts
    ],
  },
  {
    // Whiteboard: framed opaque panel (glass gloss over a light face) with a pen tray; stands on y=0 like every wall prop.
    id: 'school_whiteboard', family: 'school', tags: ['focal', 'workstation'], place: 'wall', facing: 'room', blocking: false,
    voxels: [
      { box: [-14, 1, 0, 28, 16, 0.6], mat: 'metal' },                       // frame
      { box: [-13, 2, 0.6, 26, 14, 0.3], mat: 'stone' },                     // opaque board face
      { box: [-13, 2, 0.9, 26, 14, 0.2], mat: 'glass' },                     // gloss over the board
      { box: [-14, 0, 0, 28, 1, 2], mat: 'metal' },                          // pen tray
      { box: [-8, 1, 1, 3, 0.6, 0.8], mat: 'accent' },                       // marker
      { box: [4, 1, 1, 4, 0.8, 1], mat: 'dark' },                            // eraser
    ],
  },
  {
    // Row of 4 metal lockers against a wall — a hiding place (hide), back at z=0, doors toward +z.
    id: 'school_locker_row', family: 'school', tags: ['hide', 'storage'], place: 'wall', facing: 'room', blocking: true, hide: true,
    clearance: { front: 2, sides: 0.3 },
    voxels: [
      { box: [-12, 0, -1, 24, 22, 5], mat: 'metal' },                        // body
      { box: [-12, 0, 4, 24, 22, 0.4], mat: 'dark' },                        // door seam plane
      { repeat: { n: 4, dx: 6 }, ops: [
        { box: [-11.5, 1, 4.4, 5, 20, 0.5], mat: 'metal' },                 // door leaf
        { box: [-9.5, 17, 4.9, 2, 2, 0.3], mat: 'dark' },                   // vent slot
        { box: [-7.5, 10, 4.9, 0.6, 2, 0.6], mat: 'accent' },               // handle / latch
      ] },
    ],
  },
  {
    // Cafeteria table: long top (y=10) with attached bench seats (y=6) on both long sides — the benches ARE the seats, no satellites.
    id: 'school_cafeteria_table', family: 'school', tags: ['surface', 'seat'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 1, sides: 1, back: 1 },
    surfaces: [{ x: -4.6, z: -1.4, w: 9.2, d: 2.8, y: 10 * U, max: 6 }],
    voxels: [
      { box: [-14, 9, -4, 28, 1, 8], mat: 'wood' },                          // table top
      { mirror: 'z', ops: [{ box: [-14, 5, 6, 28, 1, 4], mat: 'wood' }] },   // bench seats (z 6..10 and −10..−6)
      { mirror: 'x', ops: [
        { box: [10, 0, -1, 2, 9, 2], mat: 'metal' },                         // table leg post
        { box: [10, 0, -9, 2, 1, 18], mat: 'metal' },                        // floor foot spanning to the benches
        { mirror: 'z', ops: [{ box: [10, 1, 7, 2, 4, 2], mat: 'metal' }] },  // bench leg stubs
      ] },
    ],
  },
  {
    // Desk globe: small dressing item that sits on a surface; accent sphere on a dark stand.
    id: 'school_globe', family: 'school', tags: ['item'], place: 'surface', facing: 'any', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-2, 0, -2, 4, 0.6, 4], mat: 'dark' },                          // base
      { box: [-0.4, 0.6, -0.4, 0.8, 2, 0.8], mat: 'metal' },                 // stem
      { box: [-2, 2.4, -2, 4, 4, 4], mat: 'accent' },                        // globe
      { box: [-1, 2.4, 2, 2, 4, 0.4], mat: 'foliage' },                      // continent patch
    ],
  },
  {
    // Gym bleachers: 3 stepped tiers (4 voxels rise × 4 deep), centred on z, pupils sit facing +z.
    id: 'school_bleachers', family: 'school', tags: ['seat', 'cover'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { box: [-14, 0, -6, 28, 4, 12], mat: 'metal' },                        // tier 1 (z −6..6, top y=4)
      { box: [-14, 4, -6, 28, 4, 8], mat: 'metal' },                         // tier 2 (z −6..2, top y=8)
      { box: [-14, 8, -6, 28, 4, 4], mat: 'metal' },                         // tier 3 (z −6..−2, top y=12)
      { repeat: { n: 3, dy: 4, dz: -4 }, ops: [{ box: [-14, 4, 2, 28, 0.6, 4], mat: 'wood' }] },   // seat planks on each tier top
      { mirror: 'x', ops: [{ box: [13, 0, -6, 1, 14, 12], mat: 'metal' }] }, // side rails
      { box: [-14, 13, -6, 28, 1, 1], mat: 'accent' },                       // back safety rail
    ],
  },
  {
    // Basketball hoop: tall pole, backboard and accent ring — a hero-height gym landmark.
    id: 'school_hoop', family: 'school', tags: ['focal', 'weenie'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 4, sides: 1 },
    voxels: [
      { box: [-3, 0, -5, 6, 1, 6], mat: 'metal' },                           // base plate
      { box: [-1, 1, -3, 2, 27, 2], mat: 'metal' },                          // pole
      { box: [-1, 26, -1, 2, 1, 4], mat: 'metal' },                          // arm
      { box: [-6, 24, 3, 12, 8, 0.6], mat: 'glass' },                        // backboard
      { box: [-0.5, 24, 3.6, 1, 3, 2.5], mat: 'dark' },                      // ring bracket
      { cyl: [0, 24, 5.5, 2.5, 0.6], mat: 'accent', sides: 8 },              // rim
    ],
  },
  {
    // Hallway bench: wood slat seat on two metal pedestals; seat height y=6.
    id: 'school_bench', family: 'school', tags: ['seat'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.5 },
    voxels: [
      { mirror: 'x', ops: [{ box: [6, 0, -2, 2, 5, 4], mat: 'metal' }] },    // pedestals
      { box: [-9, 5, -3, 18, 1, 6], mat: 'wood' },                            // seat
      { box: [-9, 6, -3, 18, 0.3, 0.6], mat: 'dark' }, { box: [-9, 6, 2.4, 18, 0.3, 0.6], mat: 'dark' },   // slat grooves
    ],
  },
  {
    // Drinking fountain: wall-backed pedestal with a metal basin at hero chest height with an accent push button.
    id: 'school_fountain', family: 'school', tags: ['decor'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { box: [-3, 0, 0, 6, 10, 3], mat: 'metal' },                            // pedestal body
      { box: [-4, 10, 0, 8, 1.4, 5], mat: 'metal' },                          // basin floor
      { mirror: 'x', ops: [{ box: [3.4, 11.4, 0, 0.6, 0.6, 5], mat: 'metal' }] },   // basin side rims
      { box: [-4, 11.4, 4.4, 8, 0.6, 0.6], mat: 'metal' },                    // basin front rim
      { box: [-3.4, 11.4, 0, 6.8, 0.4, 4.4], mat: 'glass' },                  // water, recessed in the basin
      { box: [-0.5, 11.8, 0.5, 1, 1.5, 1], mat: 'accent' },                   // spout at the back of the basin
      { box: [2.5, 10.5, 5, 1, 1, 0.6], mat: 'dark' },                        // push button on the basin's front face
    ],
  },
  {
    // Trophy case: wall cabinet with a glass front and lit accent trophies on two shelves.
    id: 'school_trophy_case', family: 'school', tags: ['focal', 'light'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { box: [-8, 0, 0, 16, 4, 5], mat: 'wood' },                             // plinth
      { box: [-8, 4, 0, 16, 16, 1], mat: 'dark' },                            // back panel
      { mirror: 'x', ops: [{ box: [7, 4, 0, 1, 16, 5], mat: 'wood' }] },      // sides
      { box: [-8, 20, 0, 16, 1, 5], mat: 'wood' },                            // top
      { box: [-7, 12, 1, 14, 0.5, 3.5], mat: 'wood' },                        // middle shelf
      { box: [-7, 4, 4.5, 14, 16, 0.4], mat: 'glass' },                       // glass front
      { box: [-7, 19.2, 1, 14, 0.6, 3], mat: 'glow', emissive: true },        // strip light
      { repeat: { n: 3, dx: 5 }, ops: [{ box: [-6, 4.2, 2, 2, 4, 2], mat: 'accent' }] },     // lower trophies
      { repeat: { n: 2, dx: 8 }, ops: [{ box: [-5, 12.7, 2, 2, 4, 2], mat: 'accent' }] },    // upper trophies (x −5..−3 and 3..5)
    ],
  },
];
