// src/engine/props/families/shop.ts
// ============================================================================
// SHOP — the 11 props that furnish a store, a market and a high street: stocked
// shelves, a register counter, a display case, a mannequin, a cart, a vending
// machine, an ATM, an outdoor stall, an ice-cream cart, a crate stack to hide
// in and a lit sign. Same DSL as core.ts: 1 voxel = 0.35 u, props stand on y=0
// centred on x=z=0, wall props face +z with their back at z≈0. Materials only.
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

/** One 8 × 8 × 8 wooden crate with a dark mid band (min corner at x,y,z). */
const crate = (x: number, y: number, z: number): VoxelOp[] => [
  { box: [x, y, z, 8, 8, 8], mat: 'wood' },
  { box: [x - 0.2, y + 3.5, z - 0.2, 8.4, 1, 8.4], mat: 'dark' },
];

export const SHOP: PropDef[] = [
  {
    // Wall shelving unit, 4 shelves stocked with coloured goods. Back on the wall, 8.4 u wide, 10.9 u tall.
    // Storage only: every shelf is already full and the top cap (10.9 u) is far above eye height, so no surfaces.
    id: 'shop_shelf', family: 'shop', tags: ['storage'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { box: [-12, 0, -4, 24, 30, 1], mat: 'wood' },                                   // back panel
      { mirror: 'x', ops: [{ box: [11, 0, -3, 1, 30, 7], mat: 'wood' }] },             // uprights
      { box: [-12, 30, -4, 24, 1, 8], mat: 'wood' },                                   // top cap
      { repeat: { n: 4, dy: 8 }, ops: [
        { box: [-11, 1, -3, 22, 1, 7], mat: 'wood' },                                  // shelf board (y 1, 9, 17, 25)
        { box: [-10, 2, -2, 6, 4, 5], mat: 'accent' },                                 // goods: boxes, bottles, bolts
        { box: [-3, 2, -2, 7, 5, 5], mat: 'fabric' },
        { box: [5, 2, -2, 5, 3, 5], mat: 'glass' },
      ] },
    ],
  },
  {
    // Checkout counter with a till on top. Surface: the free counter top either side and in front of the till. Satellite: a seat behind it.
    id: 'shop_register', family: 'shop', tags: ['workstation', 'surface', 'focal'], place: 'floor', facing: 'room', blocking: true, interact: 'sell',
    clearance: { front: 2.5, sides: 0.5, back: 2.5 },
    // Surfaces are min-corner + extent in u (as in home/school): two 3 × 4 u pads flanking the 2.8 u till on the 13-voxel top.
    surfaces: [
      { x: -4.5, z: -2.0, w: 3.0, d: 4.0, y: 4.55, max: 2 },
      { x: 1.5, z: -2.0, w: 3.0, d: 4.0, y: 4.55, max: 2 },
    ],
    satellites: [{ tag: 'seat', dx: 0, dz: -4, rot: 2, p: 0.6 }],                     // counter back is at z=−2.1 u; a 3.5 u-deep chair clears it at −4
    voxels: [
      { box: [-12, 0, -5, 24, 1, 10], mat: 'dark' },                                  // kick plinth
      { box: [-12, 1, -5, 24, 11, 10], mat: 'wood' },                                 // counter body
      { box: [-13, 12, -6, 26, 1, 12], mat: 'wood' },                                 // overhanging top
      { box: [-12, 6, 5, 24, 2, 0.5], mat: 'accent' },                                // front trim band
      { box: [-4, 13, -4, 8, 4, 6], mat: 'metal' },                                   // till body
      { box: [-4, 13.5, 2, 8, 2, 0.5], mat: 'dark' },                                 // cash drawer face
      { box: [-3, 17, -1, 6, 0.6, 3], mat: 'dark' },                                  // keypad
      { box: [-4, 17, -4, 8, 4, 1], mat: 'dark' },                                    // screen housing
      { box: [-3, 17.5, -3, 6, 3, 0.4], mat: 'glow', emissive: true },                // screen
    ],
  },
  {
    // Glass display case on a wooden base with goods inside. Surface: the metal top for small items.
    id: 'shop_display_case', family: 'shop', tags: ['surface', 'storage'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    surfaces: [{ x: -2.25, z: -1.25, w: 4.5, d: 2.5, y: 6.65, max: 2 }],
    voxels: [
      { box: [-7.5, 0, -4.5, 15, 1, 9], mat: 'dark' },                                // recessed kick plinth
      { box: [-8, 1, -5, 16, 7, 10], mat: 'wood' },                                   // base cabinet (starts above the plinth — no coplanar faces)
      { box: [-7.5, 8, -4.5, 15, 10, 9], mat: 'glass' },                              // glass box
      { mirror: 'x', ops: [{ box: [7, 8, -5, 1, 10, 1], mat: 'metal' }, { box: [7, 8, 4, 1, 10, 1], mat: 'metal' }] },   // corner posts
      { box: [-8, 18, -5, 16, 1, 10], mat: 'metal' },                                 // top cap
      { box: [-5, 8, -2, 3, 3, 3], mat: 'accent' },                                   // goods on the shelf
      { box: [1, 8, -2, 4, 2, 4], mat: 'accent' },
      { box: [-1.5, 8, 1.5, 3, 5, 2], mat: 'fabric' },
    ],
  },
  {
    // Dressed mannequin on a metal stand, hero height.
    id: 'shop_mannequin', family: 'shop', tags: ['decor'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1, sides: 0.5 },
    voxels: [
      { cyl: [0, 0, 0, 3, 1], mat: 'metal', sides: 8 },                               // base disc
      { cyl: [0, 1, 0, 0.5, 2], mat: 'metal', sides: 6 },                             // stand pole
      { box: [-2.5, 3, -1.5, 5, 3, 3], mat: 'dark' },                                 // trousers
      { box: [-3, 6, -1.5, 6, 6, 3], mat: 'accent' },                                 // shirt / dress
      { mirror: 'x', ops: [{ box: [3, 7, -1, 1, 5, 2], mat: 'accent' }] },            // sleeves
      { box: [-0.5, 12, -0.5, 1, 0.5, 1], mat: 'fabric' },                            // neck
      { cyl: [0, 12.5, 0, 1.5, 2.5], mat: 'fabric', sides: 8 },                       // head
    ],
  },
  {
    // Shopping trolley: wire basket on a frame with 4 wheels, handle at the back (−z). Blocking.
    id: 'shop_cart', family: 'shop', tags: ['cover', 'movable'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1, sides: 0.5 },
    voxels: [
      { mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [3.5, 0, 4, 1.5, 1.5, 1.5], mat: 'dark' }] }] },   // 4 wheels
      { mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [3.5, 1.5, 4.5, 1, 2.5, 1], mat: 'metal' }] }] },  // 4 legs
      { box: [-4.5, 4, -6, 9, 0.6, 12], mat: 'metal' },                               // basket floor
      { mirror: 'x', ops: [{ box: [4, 4.6, -6, 0.5, 5, 12], mat: 'metal' }] },        // basket sides
      { box: [-4.5, 4.6, 5.5, 9, 4, 0.5], mat: 'metal' },                             // basket front (lower)
      { box: [-4.5, 4.6, -6, 9, 5, 0.5], mat: 'metal' },                              // basket back
      { box: [-3, 4.6, -3, 6, 3, 6], mat: 'accent' },                                 // shopping inside
      { mirror: 'x', ops: [{ box: [4, 9.6, -6.5, 0.6, 1.5, 0.6], mat: 'metal' }] },   // handle posts
      { box: [-4.6, 11, -6.8, 9.2, 1, 1.2], mat: 'accent' },                          // handle grip
    ],
  },
  {
    // Vending machine against a wall: metal cabinet, glowing product window, button column, dispense slot.
    id: 'shop_vending', family: 'shop', tags: ['light', 'workstation', 'sell'], place: 'wall', facing: 'room', blocking: true, interact: 'sell',
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { box: [-5, 0, -3, 10, 1.5, 6], mat: 'dark' },                                     // recessed kick plinth
      { box: [-5.5, 1.5, -3.5, 11, 18.5, 7], mat: 'metal' },                             // cabinet (sits on the plinth)
      { box: [-5, 18, 3, 10, 1.5, 0.8], mat: 'accent' },                            // header strip
      { box: [-4.5, 8, 3.5, 7, 10, 0.4], mat: 'glow', emissive: true },                 // lit product window
      { repeat: { n: 3, dy: 3 }, ops: [{ box: [-4.5, 9.5, 3.8, 7, 0.4, 0.3], mat: 'dark' }] },   // shelf lines in the window
      { box: [3, 9, 3.5, 2, 8, 0.4], mat: 'dark' },                                     // selection panel
      { repeat: { n: 3, dy: 2 }, ops: [{ box: [3.5, 10, 3.9, 1, 1, 0.3], mat: 'accent' }] },      // buttons
      { box: [-4, 2.5, 3.5, 8, 3, 0.4], mat: 'dark' },                                  // dispense slot
    ],
  },
  {
    // Cash machine against a wall: metal box, glowing screen, keypad, card and cash slots, branded header.
    id: 'shop_atm', family: 'shop', tags: ['light', 'workstation'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.3 },
    voxels: [
      { box: [-3.5, 0, -2.5, 7, 1.5, 5], mat: 'dark' },                                // recessed kick plinth
      { box: [-4, 1.5, -3, 8, 12.5, 6], mat: 'metal' },                                // body (sits on the plinth)
      { box: [-4, 12.5, 2, 8, 1.5, 1.4], mat: 'accent' },                             // header
      { box: [-3, 8.5, 3, 6, 3.5, 0.4], mat: 'glow', emissive: true },                // screen
      { box: [-2.5, 6, 3, 5, 2, 0.5], mat: 'dark' },                                  // keypad
      { box: [-2, 4.5, 3, 4, 0.7, 0.5], mat: 'accent' },                              // card slot
      { box: [-3, 2.5, 3, 6, 1, 0.5], mat: 'dark' },                                  // cash slot
    ],
  },
  {
    // Outdoor market stall: counter with a cloth skirt, 4 posts, fabric awning. Surface: the front half of the counter top.
    id: 'shop_stall', family: 'shop', tags: ['surface', 'workstation', 'focal'], place: 'outdoor', facing: 'room', blocking: true, interact: 'sell',
    clearance: { front: 2.5, sides: 0.5, back: 2 },
    surfaces: [{ x: -3.5, z: 0.4, w: 7, d: 1.6, y: 4.2, max: 3 }],                     // min-corner: the free strip in front of the goods (goods end at z=0)
    satellites: [{ tag: 'seat', dx: 0, dz: -4, rot: 2, p: 0.4 }],
    voxels: [
      { box: [-11, 0, -5, 22, 11, 10], mat: 'wood' },                                 // counter body
      { box: [-12, 11, -6, 24, 1, 12], mat: 'wood' },                                 // counter top
      { box: [-11, 1, 5, 22, 10, 0.5], mat: 'fabric' },                               // draped cloth skirt
      { mirror: 'x', ops: [{ box: [10.5, 12, -5.5, 1, 12, 1], mat: 'wood' }, { box: [10.5, 12, 4.5, 1, 12, 1], mat: 'wood' }] },   // 4 posts
      { box: [-12.5, 24, -6.5, 25, 1, 13.5], mat: 'fabric' },                         // awning
      { box: [-12.5, 25, -6.5, 25, 1, 6], mat: 'fabric' },                            // awning rear step (slope)
      { box: [-12.5, 22.5, 6.5, 25, 1.5, 0.6], mat: 'accent' },                       // scalloped valance
      { box: [-9, 12, -4, 6, 3, 4], mat: 'accent' },                                  // goods at the back
      { box: [-2, 12, -4.5, 6, 3, 4], mat: 'foliage' },                               // produce
      { box: [5, 12, -4, 5, 2, 4], mat: 'accent' },
    ],
  },
  {
    // Outdoor ice-cream cart: two-wheeled freezer box, push handle at the back, round fabric umbrella.
    id: 'shop_icecream_cart', family: 'shop', tags: ['focal', 'workstation'], place: 'outdoor', facing: 'room', blocking: true, interact: 'sell',
    clearance: { front: 2, sides: 1, back: 1.5 },
    voxels: [
      { mirror: 'x', ops: [{ box: [7, 0, -2, 1, 4, 4], mat: 'dark' }] },              // wheels (the only parts on the ground besides the prop leg)
      { box: [-6, 1, -3, 12, 2, 6], mat: 'metal' },                                   // undercarriage, lifted 1 voxel off the floor
      { box: [-0.75, 0, 2, 1.5, 1, 1], mat: 'metal' },                                // front prop leg
      { box: [-7, 3, -4, 14, 9, 8], mat: 'metal' },                                   // freezer box
      { box: [-5, 5, 4, 10, 5, 0.4], mat: 'accent' },                                 // front menu panel
      { box: [-7, 12, -4, 14, 1, 8], mat: 'accent' },                                 // lid
      { mirror: 'x', ops: [{ box: [5, 9, -5, 1, 8, 1], mat: 'metal' }] },             // handle posts, bolted to the back of the freezer box
      { box: [-6, 17, -5.5, 12, 1, 1], mat: 'wood' },                                 // handle bar
      { cyl: [0, 13, 0, 0.5, 12], mat: 'metal', sides: 6 },                           // umbrella pole
      { cyl: [0, 24, 0, 11, 1.5], mat: 'fabric', sides: 8 },                          // canopy
      { box: [-0.8, 25.5, -0.8, 1.6, 1.5, 1.6], mat: 'accent' },                      // finial
    ],
  },
  {
    // Three stacked crates — two below, one on top. A hiding place.
    id: 'shop_crate_stack', family: 'shop', tags: ['hide', 'storage', 'cover'], place: 'floor', facing: 'any', blocking: true, hide: true,
    clearance: { front: 1, sides: 0.3 },
    voxels: [
      ...crate(-8, 0, -4),
      ...crate(0, 0, -4),
      ...crate(-4, 8, -4),
      { box: [-2, 16, -2, 4, 0.4, 4], mat: 'accent' },                                // shipping label on top
    ],
  },
  {
    // Lit shop sign: wooden board on the wall with a strip of glowing letters. Not blocking.
    id: 'shop_sign', family: 'shop', tags: ['light', 'decor', 'sign'], place: 'wall', facing: 'room', blocking: false,
    voxels: [
      { box: [-13, 0, -1, 26, 8, 1.2], mat: 'wood' },                                 // board frame (centred on z like every other wall prop)
      { box: [-12, 1, 0.2, 24, 6, 0.4], mat: 'dark' },                                // sign face
      { repeat: { n: 5, dx: 4.5 }, ops: [{ box: [-10.5, 2.5, 0.6, 3, 3, 0.4], mat: 'glow', emissive: true }] },   // letters
    ],
  },
];
