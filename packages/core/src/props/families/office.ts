// src/engine/props/families/office.ts
// ============================================================================
// OFFICE — open-plan floors, meeting rooms, reception and the server room. Conventions as in
// core.ts: 1 voxel = 0.35 u · props stand on y=0, centred on x=z=0 · wall props face +z
// (back at −z) · materials only · ≤ 300 tris (dressing ≤ 60).
// Palette intent: 'wood' = laminate desks, 'metal' = frames and racks, 'fabric' = chairs
// and sofas, 'stone' = whiteboards / paper, 'accent' = the brand colour, 'glow' = screens
// and rack LEDs. Seat y=6, desk top y=10, meeting table top y=10.
// ============================================================================
import type { PropDef, PropFamily, VoxelOp } from '../types';

const OFFICE_FAMILY: PropFamily = 'office';

/** A five-point star base on a stem — the office-chair foot, authored once. */
const starBase = (): VoxelOp[] => [
  { box: [-0.8, 1.5, -0.8, 1.6, 4, 1.6], mat: 'metal' },                                  // gas stem
  { box: [-4, 0, -0.8, 8, 1.5, 1.6], mat: 'dark' },                                       // spokes (x)
  { box: [-0.8, 0, -4, 1.6, 1.5, 8], mat: 'dark' },                                       // spokes (z)
];

export const OFFICE: PropDef[] = [
  {
    // Work desk: laminate top on a steel frame with a drawer pedestal, a monitor and keyboard; workstation + surface, seat satellite behind.
    id: 'office_desk', family: OFFICE_FAMILY, tags: ['surface', 'workstation', 'office'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1, sides: 0.5, back: 2.5 },
    surfaces: [{ x: -6.5, z: -2.0, w: 3.5, d: 3.5, y: 3.85, max: 2 }],
    satellites: [{ tag: 'seat', dx: 0, dz: -3.5, rot: 2, p: 0.8 }],
    voxels: [
      { mirror: 'x', ops: [{ box: [9.5, 0, -4, 1.2, 10, 1.2], mat: 'metal' }, { box: [9.5, 0, 3, 1.2, 10, 1.2], mat: 'metal' }] },   // legs
      { box: [3, 0, -4, 7, 10, 8], mat: 'wood' },                                         // drawer pedestal
      { repeat: { n: 3, dy: 3 }, ops: [{ box: [4, 1, -4.4, 5, 0.6, 0.4], mat: 'accent' }] },   // drawer handles (facing −z, the sitter's side)
      { box: [-11, 10, -5, 22, 1, 10], mat: 'wood' },                                     // top
      { box: [-11, 9.4, 4.5, 22, 0.6, 0.5], mat: 'dark' },                                // modesty panel edge
      { box: [-2, 11, 2, 6, 0.6, 3], mat: 'dark' },                                       // monitor foot
      { box: [-0.8, 11.6, 3, 1.6, 2, 1], mat: 'dark' },                                   // neck
      { box: [-5, 13.5, 2.8, 10, 7, 0.8], mat: 'dark' },                                  // monitor
      { box: [-4.5, 14, 2.4, 9, 6, 0.4], mat: 'glow', emissive: true },                   // screen (faces −z, toward the seat)
      { box: [-4, 11, -2.5, 8, 0.5, 3], mat: 'metal' },                                   // keyboard
    ],
  },
  {
    // Swivel office chair: star base, padded seat, tall back, two arms; a seat facing +z.
    id: 'office_chair', family: OFFICE_FAMILY, tags: ['seat', 'office'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      ...starBase(),
      { box: [-4, 5.5, -3.5, 8, 1.5, 7], mat: 'fabric' },                                 // seat
      { box: [-3.5, 7, -4.2, 7, 10, 1.2], mat: 'fabric' },                                // back
      { box: [-2, 15, -4.5, 4, 2, 1], mat: 'accent' },                                    // headrest band
      { mirror: 'x', ops: [{ box: [4, 7, -2, 1, 3, 5], mat: 'dark' }] },                  // arms
    ],
  },
  {
    // Standalone monitor with a lit screen: a surface item for desks and counters.
    id: 'office_monitor', family: OFFICE_FAMILY, tags: ['item', 'decor', 'light', 'office', 'dressing'], place: 'surface', facing: 'any', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-3, 0, -1.5, 6, 0.6, 3], mat: 'dark' },                                     // foot
      { box: [-0.8, 0.6, -0.3, 1.6, 2, 0.8], mat: 'dark' },                               // neck
      { box: [-5, 2.5, -0.3, 10, 6.5, 0.8], mat: 'dark' },                                // bezel
      { box: [-4.5, 3, 0.5, 9, 5.5, 0.3], mat: 'glow', emissive: true },                  // screen
    ],
  },
  {
    // Potted plant: a ceramic pot with a layered foliage crown; decor that softens a corner.
    id: 'office_plant', family: OFFICE_FAMILY, tags: ['decor', 'clutter', 'office'], place: 'corner', facing: 'any', blocking: true,
    voxels: [
      { box: [-3.5, 0, -3.5, 7, 7, 7], mat: 'stone' },                                    // pot
      { box: [-4, 7, -4, 8, 1, 8], mat: 'accent' },                                       // rim
      { box: [-3, 8, -3, 6, 0.5, 6], mat: 'dark' },                                       // soil
      { box: [-0.8, 8, -0.8, 1.6, 8, 1.6], mat: 'wood' },                                 // stem
      { box: [-5, 12, -5, 10, 5, 10], mat: 'foliage' },                                   // lower crown
      { box: [-3.5, 17, -3.5, 7, 4, 7], mat: 'foliage' },                                 // upper crown
      { mirror: 'x', ops: [{ box: [4.5, 13.5, -1.5, 3, 1.5, 3], mat: 'foliage' }] },      // side leaves
    ],
  },
  {
    // Whiteboard on the wall with a pen tray and a few accent scribbles; workstation + focal.
    id: 'office_whiteboard', family: OFFICE_FAMILY, tags: ['focal', 'workstation', 'office'], place: 'wall', facing: 'room', blocking: false,
    voxels: [
      { box: [-14, 1, 0, 28, 16, 0.6], mat: 'metal' },                                    // frame
      { box: [-13, 2, 0.6, 26, 14, 0.3], mat: 'stone' },                                  // board
      { box: [-13, 2, 0.9, 26, 14, 0.2], mat: 'glass' },                                  // gloss
      { box: [-14, 0, 0, 28, 1, 2], mat: 'metal' },                                       // pen tray
      { box: [-10, 11, 1.1, 8, 0.6, 0.2], mat: 'accent' },                                // scribble
      { box: [-10, 8, 1.1, 12, 0.6, 0.2], mat: 'dark' },
      { box: [2, 6, 1.1, 6, 5, 0.2], mat: 'accent' },                                     // a box diagram
      { box: [-6, 1, 1, 3, 0.6, 0.8], mat: 'accent' },                                    // marker
    ],
  },
  {
    // Floor-standing printer / copier: a big body with a paper tray, an output shelf and a lit status panel.
    id: 'office_printer', family: OFFICE_FAMILY, tags: ['decor', 'clutter', 'office'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { box: [-6, 0, -4, 12, 1, 8], mat: 'dark' },                                        // base
      { box: [-6, 1, -4, 12, 9, 8], mat: 'stone' },                                       // lower body (paper drawers)
      { repeat: { n: 2, dy: 4 }, ops: [{ box: [-5, 2, 4, 10, 3, 0.4], mat: 'dark' }] },   // drawer fronts
      { box: [-6.5, 10, -4.5, 13, 6, 9], mat: 'metal' },                                  // print engine
      { box: [-5, 11, 4.3, 10, 0.6, 2], mat: 'stone' },                                   // output tray with paper
      { box: [-6, 16, -4, 12, 1.2, 8], mat: 'dark' },                                     // scanner lid
      { box: [2, 14, 4.5, 3.5, 1.5, 0.4], mat: 'glow', emissive: true },                  // status screen
    ],
  },
  {
    // Four-drawer filing cabinet; a hiding place (a person can crouch behind it) and storage.
    id: 'office_filing', family: OFFICE_FAMILY, tags: ['hide', 'storage', 'office'], place: 'wall', facing: 'room', blocking: true, hide: true,
    clearance: { front: 1.5, sides: 0.2 },
    voxels: [
      { box: [-5, 0, -4, 10, 1, 8], mat: 'dark' },                                        // plinth
      { box: [-5, 1, -4, 10, 22, 8], mat: 'metal' },                                      // body
      { repeat: { n: 4, dy: 5 }, ops: [
        { box: [-4.5, 2, 4, 9, 4.2, 0.4], mat: 'dark' },                                  // drawer front
        { box: [-2, 4.5, 4.4, 4, 0.8, 0.4], mat: 'accent' },                              // handle
      ] },
      { box: [-5.5, 23, -4.5, 11, 0.6, 9], mat: 'dark' },                                 // cap
    ],
  },
  {
    // Water cooler: a base cabinet with taps and a glass bottle on top; decor people gather around.
    id: 'office_water_cooler', family: OFFICE_FAMILY, tags: ['decor', 'clutter', 'office'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { box: [-3.5, 0, -3.5, 7, 1, 7], mat: 'dark' },                                     // base
      { box: [-3.5, 1, -3.5, 7, 18, 7], mat: 'stone' },                                   // cabinet
      { box: [-2.5, 12, 3.5, 5, 3, 1], mat: 'dark' },                                     // drip tray recess
      { box: [-1.8, 15, 3.5, 1.2, 1.2, 1.2], mat: 'accent' },                             // hot tap
      { box: [0.6, 15, 3.5, 1.2, 1.2, 1.2], mat: 'metal' },                               // cold tap
      { box: [-3, 19, -3, 6, 9, 6], mat: 'glass' },                                       // bottle
      { box: [-1.5, 28, -1.5, 3, 1.5, 3], mat: 'glass' },                                 // bottle neck
      { box: [-2, 5, 3.5, 4, 4, 0.4], mat: 'metal' },                                     // cup holder
    ],
  },
  {
    // Two-seat reception sofa on a chrome frame with a single back cushion bar; seat facing +z.
    id: 'office_sofa', family: OFFICE_FAMILY, tags: ['seat', 'office'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { mirror: 'x', ops: [{ box: [8, 0, -4, 1, 3, 8], mat: 'metal' }] },                 // chrome sled legs
      { box: [-9, 3, -4.5, 18, 3, 9], mat: 'fabric' },                                    // base
      { box: [-9, 6, -4.5, 18, 6, 2.5], mat: 'fabric' },                                  // back
      { repeat: { n: 2, dx: 9 }, ops: [{ box: [-8.5, 6, -2, 8, 1, 6], mat: 'accent' }] },   // seat cushions
      { box: [-0.25, 6, -2, 0.5, 1, 6], mat: 'dark' },                                    // cushion seam
      { mirror: 'x', ops: [{ box: [8, 6, -4.5, 1, 3, 9], mat: 'metal' }] },               // chrome arms
    ],
  },
  {
    // Meeting table: a long laminate top on two pedestal legs with a cable box; surface + six seat satellites.
    id: 'office_meeting_table', family: OFFICE_FAMILY, tags: ['surface', 'focal', 'office'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 3, sides: 3 },
    surfaces: [
      { x: -5.5, z: -1.5, w: 3.5, d: 3, y: 3.85, max: 2 },
      { x: 2, z: -1.5, w: 3.5, d: 3, y: 3.85, max: 2 },
    ],
    satellites: [
      { tag: 'seat', dx: -4.5, dz: 4, rot: 2, p: 0.8 }, { tag: 'seat', dx: 0, dz: 4, rot: 2, p: 0.8 }, { tag: 'seat', dx: 4.5, dz: 4, rot: 2, p: 0.8 },
      { tag: 'seat', dx: -4.5, dz: -4, rot: 0, p: 0.8 }, { tag: 'seat', dx: 0, dz: -4, rot: 0, p: 0.8 }, { tag: 'seat', dx: 4.5, dz: -4, rot: 0, p: 0.8 },
    ],
    voxels: [
      { mirror: 'x', ops: [{ box: [11, 0, -4, 4, 1, 8], mat: 'dark' }, { box: [11.5, 1, -2, 3, 9, 4], mat: 'metal' }] },   // pedestal feet + columns
      { box: [-10, 4, -1, 20, 1, 2], mat: 'metal' },                                      // under-beam
      { box: [-20, 10, -8, 40, 1, 16], mat: 'wood' },                                     // top
      { box: [-3, 11, -1.5, 6, 0.8, 3], mat: 'dark' },                                    // cable box
      { box: [-1, 11.8, -0.5, 2, 0.3, 1], mat: 'glow', emissive: true },                  // its power LED
    ],
  },
  {
    // Server rack: a dark steel cabinet with a glass door, blade slots and rows of blinking LEDs; light + storage.
    id: 'office_server_rack', family: OFFICE_FAMILY, tags: ['storage', 'light', 'cover', 'office'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.2 },
    voxels: [
      { box: [-6, 0, -5, 12, 1, 10], mat: 'dark' },                                       // plinth
      { box: [-6, 1, -5, 12, 30, 10], mat: 'metal' },                                     // cabinet
      { repeat: { n: 7, dy: 4 }, ops: [
        { box: [-5, 3, 4.6, 10, 3, 0.3], mat: 'dark' },                                   // blade face
        { box: [-4, 4, 4.9, 2.5, 0.7, 0.2], mat: 'glow', emissive: true },                // LED row
      ] },
      { box: [-5.5, 2, 5.2, 11, 28, 0.3], mat: 'glass' },                                 // glass door
      { box: [4, 14, 5.5, 0.8, 4, 0.4], mat: 'accent' },                                  // door handle
      { box: [-6.5, 31, -5.5, 13, 0.8, 11], mat: 'dark' },                                // cap
    ],
  },
  {
    // Coffee machine: a small bean-to-cup unit with a cup under the spout and a lit display; a surface item.
    id: 'office_coffee_machine', family: OFFICE_FAMILY, tags: ['item', 'decor', 'office', 'dressing'], place: 'surface', facing: 'room', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-3, 0, -2.5, 6, 7, 5], mat: 'dark' },                                       // body
      { box: [-2.5, 7, -2, 5, 1.5, 4], mat: 'metal' },                                    // bean hopper lid
      { box: [-1.5, 3, 2.5, 3, 2, 1], mat: 'metal' },                                     // spout block
      { box: [-1, 0, 2.5, 2, 2, 2], mat: 'stone' },                                       // cup
      { box: [1, 4.5, 2.5, 1.5, 1.5, 0.3], mat: 'glow', emissive: true },                 // display
    ],
  },
  {
    // Arched floor lamp: a weighted base, a tall curved stem and a drum shade with a glowing bulb; light.
    id: 'office_lamp', family: OFFICE_FAMILY, tags: ['light', 'decor', 'office'], place: 'corner', facing: 'any', blocking: true,
    voxels: [
      { box: [-3.5, 0, -3.5, 7, 1.5, 7], mat: 'stone' },                                  // base
      { box: [-0.8, 1.5, -0.8, 1.6, 22, 1.6], mat: 'metal' },                             // stem
      { box: [-0.8, 23, -0.8, 5, 1.2, 1.6], mat: 'metal' },                               // arm out (+x)
      { box: [0.5, 20, -3.5, 7, 6, 7], mat: 'fabric' },                                   // drum shade
      { box: [1.5, 19.5, -2.5, 5, 0.6, 5], mat: 'glow', emissive: true },                 // bulb glow under the shade
      { box: [1, 26, -3, 6, 0.4, 6], mat: 'dark' },                                       // shade top ring
    ],
  },
];
