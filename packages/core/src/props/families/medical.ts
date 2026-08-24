// src/engine/props/families/medical.ts
// ============================================================================
// MEDICAL — hospital wards, theatres, labs and containment. Conventions as in core.ts:
// 1 voxel = 0.35 u · props stand on y=0, centred on x=z=0 · wall props face +z (their
// back is the −z face) · materials only (no colours) · ≤ 300 tris (dressing ≤ 60).
// Palette intent: 'metal' = steel frames, 'stone' = white enamel / laminate, 'glass' =
// cabinet doors / tanks, 'accent' = the ward colour (curtains, blankets), 'glow' = screens,
// specimen tanks and the hazard symbol. Seats y=6, bed top y≈9, counter top y=12.
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

/** Four castor wheels under a (2hw × 2hd) frame — authored once, mirrored on both axes. */
const castors = (hw: number, hd: number): VoxelOp => ({
  mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [hw - 2, 0, hd - 2, 1.5, 1.5, 1.5], mat: 'dark' }] }],
});

export const MEDICAL: PropDef[] = [
  {
    // Hospital bed (20 × 31): steel frame on castors, raised head section, side rails, accent blanket; sleep.
    id: 'med_bed', family: 'medical', tags: ['sleep', 'medical'], place: 'floor', facing: 'room', blocking: true, interact: 'bed',
    clearance: { front: 1.5, sides: 1.5 },
    voxels: [
      castors(10, 15),
      { box: [-9, 1.5, -14, 18, 2, 28], mat: 'metal' },                       // chassis
      { box: [-10, 3.5, -15.5, 20, 2, 31], mat: 'metal' },                    // frame deck
      { box: [-9.5, 5.5, -15, 19, 2.5, 30], mat: 'stone' },                   // mattress
      { box: [-9.5, 8, -5, 19, 1, 19], mat: 'accent' },                       // blanket
      { box: [-9.5, 8, -14, 19, 3, 8], mat: 'fabric' },                       // raised head section
      { box: [-4, 11, -13, 8, 1.5, 5], mat: 'stone' },                        // pillow
      { mirror: 'z', ops: [{ box: [-10, 0, 14.5, 20, 12, 1.5], mat: 'metal' }] },   // head + foot boards
      { mirror: 'x', ops: [{ box: [9.5, 8, -10, 1, 4, 20], mat: 'metal' }] },      // side rails
    ],
  },
  {
    // IV stand: weighted base, pole, hook bar and a hanging bag with glowing fluid; dressing beside a bed.
    id: 'med_iv', family: 'medical', tags: ['decor', 'medical', 'dressing'], place: 'floor', facing: 'any', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-3, 0, -3, 6, 1, 6], mat: 'dark' },                             // base
      { box: [-0.5, 1, -0.5, 1, 30, 1], mat: 'metal' },                       // pole
      { box: [-4, 31, -0.5, 8, 0.8, 1], mat: 'metal' },                       // hook bar
      { box: [2, 25, -1, 2.5, 6, 2], mat: 'glass' },                          // bag
      { box: [2.3, 25.3, -0.7, 1.9, 3.5, 1.4], mat: 'glow', emissive: true }, // fluid
    ],
  },
  {
    // Wheelchair: fabric seat and back between two big spoked wheels, small front castors, footrest; a seat facing +z.
    id: 'med_wheelchair', family: 'medical', tags: ['seat', 'medical', 'movable'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.5 },
    voxels: [
      { mirror: 'x', ops: [{ box: [5, 0, -5.5, 1, 9, 9], mat: 'dark' }] },                 // big rear wheels (thin upright boxes)
      { mirror: 'x', ops: [{ box: [6, 3.5, -2.5, 0.4, 2, 3], mat: 'metal' }] },             // hubs
      { mirror: 'x', ops: [{ box: [4.5, 0, 4, 1.5, 1.5, 1.5], mat: 'dark' }] },           // front castors
      { mirror: 'x', ops: [{ box: [4, 1, -4, 1, 7, 9], mat: 'metal' }] },                 // side frames
      { box: [-4, 6, -3, 8, 1.5, 8], mat: 'fabric' },                                     // seat
      { box: [-4, 7.5, -4, 8, 9, 1.5], mat: 'fabric' },                                   // back
      { mirror: 'x', ops: [{ box: [4, 8, -3, 1, 1, 7], mat: 'metal' }] },                 // armrests
      { mirror: 'x', ops: [{ box: [1.5, 0, 5, 2, 0.8, 3], mat: 'metal' }] },              // footplates
      { mirror: 'x', ops: [{ box: [4.5, 16, -4.5, 1, 1.5, 2.5], mat: 'metal' }] },        // push handles
    ],
  },
  {
    // Reception desk: high counter with a glass sneeze screen and a terminal; surfaces either side, seat satellite behind.
    id: 'med_reception', family: 'medical', tags: ['surface', 'workstation', 'focal', 'medical'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 2.5, sides: 0.5, back: 2.5 },
    surfaces: [
      { x: -4.5, z: -2.0, w: 3.0, d: 3.5, y: 4.55, max: 2 },
      { x: 1.5, z: -2.0, w: 3.0, d: 3.5, y: 4.55, max: 2 },
    ],
    satellites: [{ tag: 'seat', dx: 0, dz: -4, rot: 2, p: 0.6 }],
    voxels: [
      { box: [-12, 0, -5, 24, 1, 10], mat: 'dark' },                          // kick plinth
      { box: [-12, 1, -5, 24, 11, 10], mat: 'stone' },                        // counter body
      { box: [-13, 12, -6, 26, 1, 12], mat: 'metal' },                        // top
      { box: [-12, 7, 5, 24, 2, 0.5], mat: 'accent' },                        // front stripe
      { box: [-11, 13, 4.5, 22, 10, 0.4], mat: 'glass' },                     // sneeze screen
      { box: [-3, 13, -3, 6, 0.8, 4], mat: 'dark' },                          // keyboard
      { box: [-3.5, 13, -5, 7, 5, 1], mat: 'dark' },                          // monitor
      { box: [-3, 13.5, -4, 6, 4, 0.4], mat: 'glow', emissive: true },        // screen
    ],
  },
  {
    // Glass-fronted medicine cabinet on a steel body — shelves of bottles behind the doors; a hiding place.
    id: 'med_cabinet', family: 'medical', tags: ['hide', 'storage', 'medical'], place: 'wall', facing: 'room', blocking: true, hide: true,
    clearance: { front: 2, sides: 0.3 },
    voxels: [
      { box: [-10, 0, -4, 20, 1, 8], mat: 'dark' },                           // plinth
      { box: [-10, 1, -4, 20, 22, 8], mat: 'metal' },                         // body
      { box: [-9, 2, 4, 18, 20, 0.4], mat: 'glass' },                         // glass doors
      { box: [-0.3, 2, 4.4, 0.6, 20, 0.3], mat: 'dark' },                     // door split
      { repeat: { n: 3, dy: 6 }, ops: [
        { box: [-9, 4, -3, 18, 0.6, 7], mat: 'stone' },                       // shelf
        { box: [-7, 4.6, 0, 3, 3, 2], mat: 'accent' },                        // bottle
        { box: [-2, 4.6, 0, 4, 2, 2], mat: 'stone' },                         // box
        { box: [4, 4.6, 0, 3, 3.5, 2], mat: 'glass' },                        // jar
      ] },
      { box: [-10.5, 23, -4.5, 21, 1, 9], mat: 'stone' },                     // cap
    ],
  },
  {
    // Operating table: steel pedestal, padded table with accent sheet, and an overhead lamp arm with a glowing dome; focal.
    id: 'med_op_table', family: 'medical', tags: ['surface', 'focal', 'workstation', 'light', 'medical'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 2, sides: 2 },
    surfaces: [{ x: -1.5, z: 2.5, w: 3, d: 2, y: 3.85, max: 1 }],
    voxels: [
      { box: [-4, 0, -4, 8, 1, 8], mat: 'dark' },                             // base
      { box: [-2.5, 1, -2.5, 5, 7, 5], mat: 'metal' },                        // pedestal
      { box: [-8, 8, -13, 16, 1.5, 26], mat: 'metal' },                       // table deck
      { box: [-7.5, 9.5, -12.5, 15, 1.5, 25], mat: 'fabric' },                // pad
      { box: [-7.5, 11, -4, 15, 0.6, 16], mat: 'accent' },                    // sheet
      { mirror: 'x', ops: [{ box: [7.5, 8, -6, 1, 4, 12], mat: 'metal' }] },  // side rails
      { box: [10, 0, 8, 3, 1, 3], mat: 'dark' },                              // lamp foot
      { box: [11, 1, 9, 1, 30, 1], mat: 'metal' },                            // lamp post
      { box: [-6, 30, 8.5, 18, 1, 1.5], mat: 'metal' },                       // boom
      { box: [-6, 26, 6, 8, 4, 8], mat: 'metal' },                            // lamp housing
      { box: [-5.5, 25.5, 6.5, 7, 0.8, 7], mat: 'glow', emissive: true },     // lamp face
    ],
  },
  {
    // Patient monitor on a small stand: lit screen with a pulse trace; a surface item.
    id: 'med_monitor', family: 'medical', tags: ['item', 'decor', 'light', 'medical', 'dressing'], place: 'surface', facing: 'any', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-2.5, 0, -1.5, 5, 0.6, 3], mat: 'dark' },                       // foot
      { box: [-0.6, 0.6, -0.5, 1.2, 1.5, 1], mat: 'metal' },                  // neck
      { box: [-3.5, 2, -1, 7, 5, 1.2], mat: 'dark' },                         // body
      { box: [-3, 2.5, 0.2, 6, 4, 0.3], mat: 'glow', emissive: true },        // screen
      { box: [-2.5, 4.2, 0.5, 5, 0.4, 0.2], mat: 'accent', emissive: true },  // pulse trace
    ],
  },
  {
    // Lab bench: steel-legged laminate top with an under-bench cupboard, a sink well and a gas tap; surface + workstation.
    id: 'med_lab_bench', family: 'medical', tags: ['surface', 'workstation', 'medical'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.3 },
    surfaces: [
      { x: -4.2, z: -1.4, w: 4.0, d: 2.8, y: 4.2, max: 2 },
      { x: 1.2, z: -1.4, w: 3.0, d: 2.8, y: 4.2, max: 2 },
    ],
    voxels: [
      { mirror: 'x', ops: [{ box: [10.5, 0, -4, 1.5, 11, 1.5], mat: 'metal' }, { box: [10.5, 0, 2.5, 1.5, 11, 1.5], mat: 'metal' }] },   // legs
      { box: [-5, 0, -4, 10, 11, 8], mat: 'stone' },                          // under-bench cupboard
      { box: [-4, 4, 4, 3.5, 6, 0.4], mat: 'dark' },                          // cupboard door
      { box: [0.5, 4, 4, 3.5, 6, 0.4], mat: 'dark' },
      { box: [-12, 11, -5, 24, 1, 10], mat: 'metal' },                        // top
      { box: [-11.5, 11.2, -4.5, 23, 0.5, 9], mat: 'stone' },                 // laminate
      { box: [5, 11.7, -3.5, 5, 0.4, 6], mat: 'dark' },                       // sink well
      { box: [8.5, 12, -4.5, 1, 4, 1], mat: 'metal' },                        // tap
      { box: [-10, 12, -4.5, 1, 3, 1], mat: 'accent' },                       // gas tap
      { box: [-12, 11, -5.5, 24, 2, 0.6], mat: 'accent' },                    // back splash strip
    ],
  },
  {
    // Rack of three flasks on a stand; the middle one glows — a dressing item for bench tops.
    id: 'med_flasks', family: 'medical', tags: ['item', 'decor', 'light', 'medical', 'dressing'], place: 'surface', facing: 'any', blocking: false, lod: 'dressing',
    voxels: [
      { box: [-4, 0, -1.5, 8, 0.6, 3], mat: 'metal' },                        // tray
      { box: [-3.5, 0.6, -1, 2, 4, 2], mat: 'glass' },                        // flask (tall)
      { box: [-0.8, 0.6, -1, 1.6, 2.5, 2], mat: 'glow', emissive: true },     // flask (glowing)
      { box: [1.5, 0.6, -1, 2, 3, 2], mat: 'glass' },                         // flask (short)
      { box: [1.8, 0.8, -0.7, 1.4, 1.2, 1.4], mat: 'accent' },                // its contents
    ],
  },
  {
    // Specimen tank: glass cylinder between steel caps on a glowing base, a dark shape suspended inside; hide + light + focal.
    id: 'med_tank', family: 'medical', tags: ['hide', 'light', 'focal', 'medical'], place: 'floor', facing: 'any', blocking: true, hide: true,
    clearance: { front: 2, sides: 1 },
    voxels: [
      { cyl: [0, 0, 0, 7, 3], mat: 'metal', sides: 12 },                      // base
      { cyl: [0, 3, 0, 6, 1], mat: 'glow', sides: 12, emissive: true },       // lit ring
      { cyl: [0, 4, 0, 5.5, 26], mat: 'glass', sides: 12 },                   // tank
      { box: [-2, 9, -2, 4, 10, 4], mat: 'dark' },                            // specimen
      { box: [-1, 19, -1, 2, 3, 2], mat: 'dark' },
      { cyl: [0, 30, 0, 7, 3], mat: 'metal', sides: 12 },                     // cap
      { box: [-1, 33, -1, 2, 4, 2], mat: 'metal' },                           // pipe stub
      { mirror: 'x', ops: [{ box: [6, 4, -1, 1.5, 26, 2], mat: 'metal' }] },  // side struts
    ],
  },
  {
    // Wall terminal: steel cabinet with a big lit screen and a keyboard ledge; a workstation with light.
    id: 'med_terminal', family: 'medical', tags: ['workstation', 'light', 'medical'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.3 },
    voxels: [
      { box: [-7, 0, -3, 14, 1, 6], mat: 'dark' },                            // plinth
      { box: [-7, 1, -3, 14, 24, 6], mat: 'metal' },                          // cabinet
      { box: [-6, 14, 3, 12, 9, 0.4], mat: 'glow', emissive: true },          // screen
      { box: [-6, 11.5, 3, 12, 2, 1.5], mat: 'dark' },                        // keyboard ledge
      { box: [-5, 4, 3, 10, 5, 0.4], mat: 'dark' },                           // lower panel
      { repeat: { n: 3, dx: 3 }, ops: [{ box: [-4, 6, 3.4, 1.5, 1, 0.3], mat: 'accent', emissive: true }] },   // status lamps
    ],
  },
  {
    // Hazard barrel: steel drum with an accent band and a glowing symbol; cover.
    id: 'med_barrel_hazard', family: 'medical', tags: ['cover', 'clutter', 'light', 'medical'], place: 'floor', facing: 'any', blocking: true,
    voxels: [
      { cyl: [0, 0, 0, 4.5, 12], mat: 'metal', sides: 8 },                    // drum
      { cyl: [0, 4, 0, 4.7, 1], mat: 'dark', sides: 8 },                      // hoops
      { cyl: [0, 8, 0, 4.7, 1], mat: 'dark', sides: 8 },
      { box: [-3, 5, 4.2, 6, 3, 0.5], mat: 'accent' },                        // label
      { box: [-1.5, 5.7, 4.7, 3, 1.6, 0.3], mat: 'glow', emissive: true },    // symbol
      { cyl: [0, 12, 0, 4, 0.6], mat: 'dark', sides: 8 },                     // lid
    ],
  },
  {
    // Gurney: stretcher pad on a folding steel frame with castors; movable cover.
    id: 'med_gurney', family: 'medical', tags: ['cover', 'movable', 'medical'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 1, sides: 1 },
    voxels: [
      castors(7, 13),
      { box: [-6, 1.5, -12, 12, 1, 24], mat: 'metal' },                       // lower frame
      { mirror: 'x', ops: [{ box: [5, 2.5, -6, 1, 7, 1], mat: 'metal' }, { box: [5, 2.5, 5, 1, 7, 1], mat: 'metal' }] },   // uprights
      { box: [-7, 9.5, -13, 14, 1, 26], mat: 'metal' },                       // deck
      { box: [-6.5, 10.5, -12.5, 13, 2, 25], mat: 'fabric' },                 // pad
      { box: [-6.5, 12.5, -12, 13, 0.5, 6], mat: 'stone' },                   // pillow
      { mirror: 'z', ops: [{ box: [-7, 10.5, 13, 14, 3, 0.8], mat: 'metal' }] },   // end rails
    ],
  },
  {
    // X-ray viewing board: a lit panel on the wall showing a dark ribcage; mounted over a short conduit; light + decor.
    id: 'med_xray_board', family: 'medical', tags: ['light', 'decor', 'medical'], place: 'wall', facing: 'room', blocking: false,
    voxels: [
      { box: [-1, 0, 0, 2, 12, 0.6], mat: 'metal' },                          // conduit from the floor
      { box: [-9, 12, 0, 18, 14, 0.8], mat: 'metal' },                        // frame
      { box: [-8, 13, 0.8, 16, 12, 0.4], mat: 'glow', emissive: true },       // lit panel
      { box: [-0.6, 14, 1.2, 1.2, 10, 0.2], mat: 'dark' },                    // spine
      { repeat: { n: 4, dy: 2 }, ops: [{ box: [-4, 15, 1.2, 8, 0.8, 0.2], mat: 'dark' }] },   // ribs
      { box: [-6, 26, 0.8, 4, 0.5, 0.4], mat: 'accent' },                     // switch strip
    ],
  },
  {
    // Curtain rail: a ceiling-height rail on two posts with a drawn accent curtain — cover between beds.
    id: 'med_curtain_rail', family: 'medical', tags: ['cover', 'decor', 'medical'], place: 'wall', facing: 'room', blocking: false,
    voxels: [
      { mirror: 'x', ops: [{ box: [12, 0, -0.5, 1, 28, 1], mat: 'metal' }] }, // posts
      { box: [-13, 28, -0.7, 26, 0.8, 1.4], mat: 'metal' },                   // rail
      { box: [-11, 3, -0.4, 16, 25, 0.8], mat: 'accent' },                    // curtain (drawn to −x)
      { repeat: { n: 4, dx: 4 }, ops: [{ box: [-10, 3, 0.4, 1, 25, 0.3], mat: 'fabric' }] },   // folds
      { box: [-11, 27, -0.6, 16, 1.2, 1.2], mat: 'dark' },                    // hook strip
    ],
  },
  {
    // Wall sink: enamel basin on a pedestal, steel tap, a glass mirror above with a small lit strip.
    id: 'med_sink', family: 'medical', tags: ['decor', 'medical'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { box: [-2.5, 0, -2, 5, 10, 4], mat: 'stone' },                         // pedestal
      { box: [-6, 10, -3, 12, 3, 8], mat: 'stone' },                          // basin
      { box: [-5, 12, -2, 10, 1.2, 6], mat: 'dark' },                         // bowl (recess)
      { box: [-0.8, 13, -2.6, 1.6, 3, 1.2], mat: 'metal' },                   // tap
      { box: [-0.8, 15.5, -2.6, 1.6, 0.8, 3], mat: 'metal' },                 // spout
      { box: [-5, 17, -3, 10, 12, 0.5], mat: 'metal' },                       // mirror frame
      { box: [-4.5, 17.5, -2.5, 9, 11, 0.3], mat: 'glass' },                  // mirror
      { box: [-4, 29.5, -2.8, 8, 0.8, 0.6], mat: 'glow', emissive: true },    // strip light
    ],
  },
];
