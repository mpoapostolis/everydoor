// src/engine/props/families/prison.ts
// ============================================================================
// PRISON — cell blocks, yards, checkpoints and the guards' side of the glass. Conventions
// as in core.ts: 1 voxel = 0.35 u · props stand on y=0, centred on x=z=0 · wall props face
// +z (back at −z) · materials only · ≤ 300 tris (dressing ≤ 60).
// Palette intent: 'metal' = bars and steel furniture, 'stone' = concrete, 'dark' = grilles
// and rubber, 'accent' = the warning colour (stripes, jumpsuit orange), 'glow' = consoles,
// searchlights and camera LEDs. Seats y=6, table top y=10, bunk tops y=7 / 20.
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

/** A run of vertical bars: n bars, `gap` voxels apart, from x0, between y0 and y0+h. */
const bars = (n: number, gap: number, x0: number, y0: number, h: number, z = -0.5): VoxelOp => ({
  repeat: { n, dx: gap }, ops: [{ box: [x0, y0, z, 1, h, 1], mat: 'metal' }],
});

export const PRISON: PropDef[] = [
  {
    // Barred cell door in a steel frame for the 26 × 23 opening; a door you can walk through.
    id: 'prison_cell_door', family: 'prison', tags: ['door', 'bars', 'prison'], place: 'wall', facing: 'any', blocking: false, interact: 'door',
    clearance: { front: 3, sides: 0.5, back: 3 },
    voxels: [
      { mirror: 'x', ops: [{ box: [13, 0, -1.5, 2, 25, 3], mat: 'metal' }] },          // posts
      { box: [-13, 23, -1.5, 26, 2, 3], mat: 'metal' },                                 // lintel
      { box: [-12, 0, -0.5, 24, 1, 1], mat: 'dark' },                                   // sill
      { box: [-12, 21, -0.5, 24, 1, 1], mat: 'dark' },                                  // top rail
      { box: [-12, 10, -0.5, 24, 1, 1], mat: 'dark' },                                  // mid rail
      bars(8, 3.2, -11.5, 1, 20),
      { box: [8, 9, -1, 3, 4, 2], mat: 'dark' },                                        // lock box
      { box: [9, 10.5, 1, 1.5, 1, 0.6], mat: 'accent' },                                // keyhole plate
    ],
  },
  {
    // Stacked steel bunk: two thin mattresses bolted to a wall frame, a ladder on +x; sleep.
    id: 'prison_bunk', family: 'prison', tags: ['sleep', 'prison'], place: 'wall', facing: 'room', blocking: true, interact: 'bed',
    clearance: { front: 1.5, sides: 0.5 },
    voxels: [
      { mirror: 'x', ops: [{ box: [12, 0, -4, 1.5, 24, 1.5], mat: 'metal' }, { box: [12, 0, 4, 1.5, 24, 1.5], mat: 'metal' }] },   // posts
      { repeat: { n: 2, dy: 13 }, ops: [
        { box: [-12, 4, -4.5, 24, 1.5, 10], mat: 'metal' },                             // frame
        { box: [-11.5, 5.5, -4, 23, 1.5, 9], mat: 'fabric' },                           // mattress
        { box: [-11.5, 7, 0, 23, 0.5, 5], mat: 'accent' },                              // blanket
        { box: [9, 7, -3.5, 2.5, 0.8, 8], mat: 'stone' },                               // pillow (along the wall side)
      ] },
      { box: [-13.5, 17, -4.5, 1, 4, 10], mat: 'metal' },                               // upper guard rail (−x end)
      { repeat: { n: 4, dy: 4 }, ops: [{ box: [12.5, 2, -2, 0.6, 0.6, 4], mat: 'metal' }] },   // ladder rungs on the +x post
    ],
  },
  {
    // Steel toilet with the sink moulded into the tank — the one-piece cell fixture; decor.
    id: 'prison_toilet', family: 'prison', tags: ['decor', 'prison'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { box: [-3, 0, -3, 6, 8, 6], mat: 'metal' },                                      // tank / sink block
      { box: [-3.5, 8, -3.5, 7, 1, 7], mat: 'metal' },                                  // sink rim
      { box: [-2.5, 8.5, -2.5, 5, 0.8, 5], mat: 'dark' },                               // basin
      { box: [-0.5, 9, -3.2, 1, 3, 1], mat: 'metal' },                                  // tap
      { box: [-2.5, 0, 3, 5, 5, 5], mat: 'metal' },                                     // bowl
      { box: [-3, 5, 2.5, 6, 1, 6], mat: 'metal' },                                     // seat rim
      { box: [-2, 5.5, 3.5, 4, 0.6, 4], mat: 'dark' },                                  // bowl opening
      { box: [2, 3, -2, 1.2, 1.2, 0.6], mat: 'accent' },                                // flush button
    ],
  },
  {
    // Shackles: a wall plate with two short chains and open iron cuffs; a dungeon-cell dressing.
    id: 'prison_shackles', family: 'prison', tags: ['decor', 'prison', 'dressing'], place: 'wall', facing: 'room', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-4, 0, 0, 8, 21, 0.5], mat: 'dark' },                                     // wall strip (floor to plate) — also the plate's backing
      { mirror: 'x', ops: [{ box: [2, 11, 0.5, 0.8, 7, 0.8], mat: 'metal' }] },         // chains from the plate
      { mirror: 'x', ops: [{ box: [1, 9, 0.4, 3, 2, 1.5], mat: 'metal' }] },            // open cuffs
    ],
  },
  {
    // Sliding bar gate: heavy steel frame, bars, a diagonal brace and a keypad that glows; locked.
    id: 'prison_gate', family: 'prison', tags: ['door', 'lock', 'bars', 'prison'], place: 'wall', facing: 'any', blocking: true, interact: 'lockedDoor',
    clearance: { front: 3, sides: 0.5, back: 3 },
    voxels: [
      { mirror: 'x', ops: [{ box: [13, 0, -2, 3, 25, 4], mat: 'stone' }] },             // concrete jambs
      { box: [-13, 23, -1.5, 26, 2, 3], mat: 'metal' },                                 // head beam
      { box: [-13, 0, -1, 26, 1.5, 2], mat: 'metal' },                                  // track
      { box: [-13, 19, -0.6, 26, 1.5, 1.2], mat: 'metal' },                             // top rail
      { box: [-13, 9, -0.6, 26, 1.5, 1.2], mat: 'metal' },                              // mid rail
      bars(7, 4, -12, 1.5, 18),
      { repeat: { n: 2, dx: 4 }, ops: [{ box: [-12, 1.5, -0.5, 1, 18, 1], mat: 'accent' }] },   // warning-painted leading bars (−x edge; +x pair below)
      { repeat: { n: 2, dx: 4 }, ops: [{ box: [7, 1.5, -0.5, 1, 18, 1], mat: 'accent' }] },
      { box: [13.5, 10, 2, 2, 4, 1], mat: 'dark' },                                     // keypad box
      { box: [14, 11, 3, 1, 2, 0.4], mat: 'glow', emissive: true },                     // keypad light
    ],
  },
  {
    // Guard console: a long desk of screens and switch panels; workstation with light, seat satellite behind.
    id: 'prison_console', family: 'prison', tags: ['workstation', 'light', 'focal', 'prison'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1, sides: 0.5, back: 2.5 },
    satellites: [{ tag: 'seat', dx: 0, dz: -4, rot: 2, p: 0.7 }],
    voxels: [
      { box: [-13, 0, -4, 26, 1, 8], mat: 'dark' },                                     // plinth
      { box: [-13, 1, -4, 26, 9, 8], mat: 'metal' },                                    // desk body
      { box: [-13.5, 10, -4.5, 27, 1, 9], mat: 'dark' },                                // top
      { box: [-12, 11, 1, 24, 8, 3], mat: 'metal' },                                    // angled screen bank
      { repeat: { n: 3, dx: 8 }, ops: [{ box: [-11.5, 12, 0.8, 7, 6, 0.3], mat: 'glow', emissive: true }] },   // three screens (face −z, toward the seat)
      { box: [-10, 11, -3.5, 20, 1, 3], mat: 'dark' },                                  // switch panel
      { repeat: { n: 5, dx: 4 }, ops: [{ box: [-9, 12, -2.5, 1.5, 0.6, 1], mat: 'accent', emissive: true }] },   // lamps
      { box: [-2, 11, -3, 4, 1.5, 1.5], mat: 'accent' },                                // big red button
    ],
  },
  {
    // Watchtower (tall, outdoor): four concrete legs, a braced platform, a cabin with a glass band and a lamp on the roof.
    id: 'prison_watchtower', family: 'prison', tags: ['weenie', 'tall', 'vantage', 'light', 'focal', 'prison'], place: 'outdoor', facing: 'any', blocking: true,
    clearance: { front: 3, sides: 3 },
    voxels: [
      { box: [-10, 0, -10, 20, 2, 20], mat: 'stone' },                                  // slab
      { mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [6, 2, 6, 3, 40, 3], mat: 'stone' }] }] },   // legs
      { repeat: { n: 2, dy: 16 }, ops: [{ box: [-9, 12, -9, 18, 1.5, 1.5], mat: 'metal' }, { box: [-9, 12, 7.5, 18, 1.5, 1.5], mat: 'metal' }] },   // braces (z faces)
      { repeat: { n: 2, dy: 16 }, ops: [{ box: [-9, 12, -7.5, 1.5, 1.5, 15], mat: 'metal' }, { box: [7.5, 12, -7.5, 1.5, 1.5, 15], mat: 'metal' }] }, // braces (x faces)
      { box: [-12, 42, -12, 24, 2, 24], mat: 'stone' },                                 // platform
      { box: [-11, 44, -11, 22, 1, 22], mat: 'dark' },                                  // cabin floor
      { box: [-11, 45, -11, 22, 7, 22], mat: 'stone' },                                 // cabin parapet
      { box: [-10.5, 52, -10.5, 21, 7, 21], mat: 'glass' },                             // glass band
      { mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [9, 52, 9, 2, 7, 2], mat: 'metal' }] }] },   // window posts
      { box: [-12.5, 59, -12.5, 25, 2, 25], mat: 'dark' },                              // roof
      { box: [-3, 61, -3, 6, 4, 6], mat: 'metal' },                                     // lamp housing
      { box: [-2.5, 62, -3.2, 5, 2.5, 0.6], mat: 'glow', emissive: true },              // lamp face
    ],
  },
  {
    // Chain-link fence panel with razor wire on top: posts, rails, a lattice of thin bars; outdoor wall.
    id: 'prison_fence', family: 'prison', tags: ['wall', 'fence', 'cover', 'prison'], place: 'outdoor', facing: 'any', blocking: true,
    voxels: [
      { mirror: 'x', ops: [{ box: [13, 0, -1, 2, 26, 2], mat: 'metal' }] },             // posts
      { box: [-13, 24, -0.5, 26, 1, 1], mat: 'metal' },                                 // top rail
      { box: [-13, 0, -0.5, 26, 1, 1], mat: 'dark' },                                   // bottom rail
      { repeat: { n: 6, dx: 4.4 }, ops: [{ box: [-11, 1, -0.2, 0.5, 23, 0.4], mat: 'metal' }] },   // verticals
      { repeat: { n: 4, dy: 5.5 }, ops: [{ box: [-13, 3, -0.2, 26, 0.5, 0.4], mat: 'metal' }] },   // horizontals
      { mirror: 'x', ops: [{ box: [13, 26, -0.5, 1, 4, 1], mat: 'metal' }] },           // wire arms
      { box: [-14, 29, -1.5, 28, 1, 3], mat: 'metal' },                                 // razor coil (flattened ring)
      { box: [-14, 28, -0.4, 28, 3, 0.8], mat: 'dark' },                                // coil core
      { repeat: { n: 4, dx: 8 }, ops: [{ box: [-12, 2, 0.3, 4, 4, 0.3], mat: 'accent' }] },   // warning tags
    ],
  },
  {
    // Searchlight on a tripod: steel legs, a pivoting drum with a glowing lens; a light + focal.
    id: 'prison_searchlight', family: 'prison', tags: ['light', 'focal', 'prison'], place: 'outdoor', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 1 },
    voxels: [
      { box: [-1.5, 0, -1.5, 3, 14, 3], mat: 'metal' },                                 // column
      { mirror: 'x', ops: [{ box: [2, 0, -1, 4, 1.5, 2], mat: 'dark' }] },              // feet (x)
      { mirror: 'z', ops: [{ box: [-1, 0, 2, 2, 1.5, 4], mat: 'dark' }] },              // feet (z)
      { mirror: 'x', ops: [{ box: [3.5, 13, -1, 1, 6, 2], mat: 'metal' }] },            // yoke
      { box: [-4, 14, -3, 8, 7, 7], mat: 'metal' },                                     // drum
      { box: [-4.5, 13.5, 4, 9, 8, 1], mat: 'dark' },                                   // bezel
      { box: [-3.5, 14.5, 5, 7, 6, 0.6], mat: 'glow', emissive: true },                 // lens
      { box: [-1, 21, -1, 2, 1, 2], mat: 'accent' },                                    // top handle
    ],
  },
  {
    // Bolted mess table: a steel top on a centre pedestal with four round stools fixed to it; surface + seats.
    id: 'prison_tray_table', family: 'prison', tags: ['surface', 'seat', 'prison'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 1.5, sides: 1.5 },
    surfaces: [{ x: -2.5, z: -1.5, w: 5, d: 3, y: 3.85, max: 2 }],
    voxels: [
      { box: [-3, 0, -3, 6, 1, 6], mat: 'dark' },                                       // floor plate
      { box: [-1.5, 1, -1.5, 3, 9, 3], mat: 'metal' },                                  // pedestal
      { box: [-9, 10, -6, 18, 1, 12], mat: 'metal' },                                   // table top
      { mirror: 'x', ops: [{ mirror: 'z', ops: [
        { box: [5, 3, 7, 2, 1, 2], mat: 'metal' },                                      // stool arm (to the table)
        { box: [3.5, 5, 7, 5, 1, 5], mat: 'dark' },                                     // stool seat
        { box: [5, 1, 8, 2, 4, 2], mat: 'metal' },                                      // stool stem
      ] }] },
      { box: [-3, 11, -2, 6, 0.6, 4], mat: 'accent' },                                  // a tray left behind
    ],
  },
  {
    // Folding cot: a thin mattress on a low steel frame with cross-legs; sleep.
    id: 'prison_cot', family: 'prison', tags: ['sleep', 'prison'], place: 'floor', facing: 'room', blocking: true, interact: 'bed',
    clearance: { front: 1.5, sides: 1 },
    voxels: [
      { mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [7, 0, 12, 1.5, 5, 1.5], mat: 'metal' }] }] },   // legs
      { mirror: 'x', ops: [{ box: [7, 2, -12, 1, 1, 24], mat: 'metal' }] },             // side rails
      { box: [-8, 5, -13, 16, 1, 26], mat: 'metal' },                                   // frame
      { box: [-7.5, 6, -12.5, 15, 1.5, 25], mat: 'fabric' },                            // mattress
      { box: [-7.5, 7.5, -4, 15, 0.5, 16], mat: 'accent' },                             // blanket
      { box: [-5, 7.5, -12, 10, 1, 5], mat: 'stone' },                                  // pillow
    ],
  },
  {
    // Riveted steel crate with a lid and a stencil band; a hiding place.
    id: 'prison_crate', family: 'prison', tags: ['hide', 'storage', 'cover', 'prison'], place: 'floor', facing: 'any', blocking: true, hide: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { box: [-7, 0, -6, 14, 1, 12], mat: 'dark' },                                     // skids
      { box: [-7.5, 1, -6.5, 15, 12, 13], mat: 'metal' },                               // body
      { mirror: 'x', ops: [{ box: [7.5, 1, -7, 0.5, 12, 14], mat: 'dark' }] },          // corner rails (x)
      { mirror: 'z', ops: [{ box: [-8, 1, 6.5, 16, 12, 0.5], mat: 'dark' }] },          // corner rails (z)
      { box: [-8, 13, -7, 16, 1.5, 14], mat: 'dark' },                                  // lid
      { box: [-5, 5, 6.6, 10, 3, 0.5], mat: 'accent' },                                 // stencil band
    ],
  },
  {
    // Steel slat bench bolted to the floor; a seat facing +z.
    id: 'prison_bench', family: 'prison', tags: ['seat', 'prison'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { mirror: 'x', ops: [{ box: [9, 0, -3, 2, 6, 6], mat: 'dark' }] },                // end supports
      { repeat: { n: 3, dz: 2.2 }, ops: [{ box: [-11, 6, -3, 22, 1, 1.6], mat: 'metal' }] },   // seat slats
      { box: [-11, 0, -2, 22, 1, 4], mat: 'dark' },                                     // floor bolt plate
    ],
  },
  {
    // Tall steel locker with louvre vents and a padlock hasp; a hiding place.
    id: 'prison_locker', family: 'prison', tags: ['hide', 'storage', 'prison'], place: 'wall', facing: 'room', blocking: true, hide: true,
    clearance: { front: 1.5, sides: 0.2 },
    voxels: [
      { box: [-5, 0, -4, 10, 1, 8], mat: 'dark' },                                      // plinth
      { box: [-5, 1, -4, 10, 24, 8], mat: 'metal' },                                    // body
      { box: [-4.5, 2, 4, 9, 22, 0.4], mat: 'dark' },                                   // door (recessed)
      { repeat: { n: 3, dy: 1.5 }, ops: [{ box: [-3, 18, 4.4, 6, 0.6, 0.3], mat: 'metal' }] },   // louvres
      { box: [3, 11, 4.4, 1, 2.5, 0.6], mat: 'accent' },                                // hasp
      { box: [-5.5, 25, -4.5, 11, 0.6, 9], mat: 'dark' },                               // cap
    ],
  },
  {
    // Security camera on a wall conduit: bracket, housing, lens hood and a glowing red recording dot; dressing.
    id: 'prison_camera', family: 'prison', tags: ['light', 'decor', 'prison', 'dressing'], place: 'wall', facing: 'room', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-0.8, 0, 0, 1.6, 27, 0.6], mat: 'dark' },                                 // conduit from the floor
      { box: [-1.5, 27, 0, 3, 3, 3], mat: 'metal' },                                    // bracket
      { box: [-2.5, 26, 0.6, 5, 3.5, 3.4], mat: 'dark' },                               // housing (points into the room)
      { box: [-1.5, 26.5, 4, 3, 2.5, 0.5], mat: 'glass' },                              // lens
      { box: [1.4, 28.5, 3.9, 0.8, 0.8, 0.4], mat: 'glow', emissive: true },            // recording dot
    ],
  },
];
