// src/engine/props/families/vignettes.ts
// ============================================================================
// VIGNETTES — "props of props": a few library props composed with { ref, at, rot }
// (plus at most a couple of boxes for a dais / rug / nightstand) so the composer can
// drop a whole READABLE CORNER in one placement. Same rules as every prop: stands on
// y=0, centred on x=z=0 (union of parts), ≤ 300 tris — and since a vignette's cost is
// the SUM of its parts, parts are chosen small (bench over a second chair, box braziers
// over a second campfire). Coordinates are voxels (1 voxel = 0.35 u); surfaces /
// satellites are world units like everywhere else.
// ============================================================================
import type { PropDef } from '../types';

export const VIGNETTES: PropDef[] = [
  {
    // Two counters back to back (one a sink) with a tray on the worktop — a kitchen island.
    id: 'vig_kitchen_island', family: 'vignette', tags: ['surface', 'workstation'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 2, sides: 2, back: 2 },
    surfaces: [{ x: 0.5, z: -3.1, w: 2.4, d: 3.1, y: 4.2, max: 1 }],
    voxels: [
      { ref: 'kitchen_counter', at: [0, 0, -4.5], rot: 2 },                // 108, doors face −z (outward)
      { ref: 'kitchen_sink', at: [0, 0, 4.5], rot: 0 },                    // 132, doors face +z (outward); tap in the seam
      { ref: 'kitchen_tray', at: [-3, 12, -4.5], rot: 1 },                 //  60, on the counter top (left half)
    ],
  },
  {
    // Armchair on a rug with a standing lamp beside it.
    id: 'vig_reading_nook', family: 'vignette', tags: ['seat', 'light'], place: 'corner', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { ref: 'home_rug', at: [0, 0, 0], rot: 0 },                          //  60
      { ref: 'home_armchair', at: [-1, 0, 0], rot: 0 },                    // 108
      { ref: 'home_lamp', at: [8, 0, 0], rot: 0 },                         //  92
    ],
  },
  {
    // Bed against the wall, dresser beside the headboard, nightstand with a little lamp.
    id: 'vig_bed_set', family: 'vignette', tags: ['sleep', 'light'], place: 'wall', facing: 'room', blocking: true, interact: 'bed',
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { ref: 'home_bed', at: [-12, 0, 0], rot: 0 },                        //  84, x −25..1, headboard on the wall (−z)
      { box: [2, 0, -15, 6, 7, 6], mat: 'wood' },                          // nightstand beside the pillow, x 2..8
      { box: [4.5, 7, -12.5, 1, 1.5, 1], mat: 'dark' },                    // lamp stem
      { box: [3.5, 8.5, -13.5, 3, 2.5, 3], mat: 'glow', emissive: true },  // bedside lamp shade
      { ref: 'home_dresser', at: [16.5, 0, -11], rot: 0 },                 // 144, x 8..25 flush with the wall
    ],
  },
  {
    // Dining table, a chair on one side, a bench on the other.
    id: 'vig_dining_set', family: 'vignette', tags: ['surface', 'seat'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 1, sides: 1, back: 1 },
    surfaces: [{ x: -3, z: -2, w: 6, d: 4, y: 3.5, max: 3 }],
    voxels: [
      { ref: 'kitchen_dining_table', at: [0, 0, 0], rot: 0 },              //  72
      { ref: 'home_chair', at: [0, 0, 11], rot: 2 },                       // 120, facing the table
      { ref: 'school_bench', at: [0, 0, -10], rot: 0 },                    //  60
    ],
  },
  {
    // Desk with a monitor and the chair pulled up to it.
    id: 'vig_desk_set', family: 'vignette', tags: ['surface', 'seat', 'workstation'], place: 'wall', facing: 'room', blocking: true, interact: 'workstation',
    clearance: { front: 2, sides: 0.5 },
    surfaces: [{ x: 1.2, z: -2.8, w: 2.2, d: 2.6, y: 3.5, max: 1 }],
    voxels: [
      { ref: 'home_desk', at: [0, 0, -4], rot: 0 },                        // 120, top at y=10
      { ref: 'home_chair', at: [0, 0, 6], rot: 2 },                        // 120, facing the desk, in the knee hole
      { box: [-1.5, 10, -7, 3, 1, 1.5], mat: 'dark' },                     // monitor stand on the desk top
      { box: [-4, 11, -7, 8, 5, 1], mat: 'dark' },                         // monitor
      { box: [-3.5, 11.5, -6, 7, 4, 0.3], mat: 'glow', emissive: true },   // screen, faces the chair (+z)
    ],
  },
  {
    // Key pedestal on a stone slab ringed by four candles.
    id: 'vig_altar_candles', family: 'vignette', tags: ['loot', 'focal', 'light'], place: 'floor', facing: 'any', blocking: true, interact: 'keyPedestal',
    clearance: { front: 2, sides: 1 },
    voxels: [
      { box: [-10, 0, -8, 20, 1, 16], mat: 'stone' },                      // slab
      { ref: 'core_key_pedestal', at: [0, 1, 0], rot: 0 },                 // 148
      { mirror: 'x', ops: [{ mirror: 'z', ops: [                           // 4 candles × 2 boxes
        { box: [7, 1, 5, 2, 4, 2], mat: 'fabric' },
        { box: [7.5, 5, 5.5, 1, 1.5, 1], mat: 'glow', emissive: true },
      ] }] },
    ],
  },
  {
    // Armchair on a two-step stone dais, tall back panel, a brazier at each side.
    id: 'vig_boss_throne', family: 'vignette', tags: ['seat', 'focal', 'weenie', 'light'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 3, sides: 1 },
    voxels: [
      { box: [-11, 0, -10, 22, 2, 18], mat: 'stone' },                     // dais
      { box: [-13, 0, 8, 26, 1, 4], mat: 'stone' },                        // step
      { box: [-5, 2, -8, 10, 18, 2], mat: 'wood' },                        // throne back
      { box: [-6, 20, -8.5, 12, 2, 3], mat: 'accent' },                    // crest
      { ref: 'home_armchair', at: [0, 2, -1], rot: 0 },                    // 108, back rest flush against the throne back
      { mirror: 'x', ops: [                                                // braziers beside the dais
        { box: [12, 0, -8, 4, 6, 4], mat: 'metal' },
        { box: [12.5, 6, -7.5, 3, 3, 3], mat: 'glow', emissive: true },
      ] },
    ],
  },
  {
    // Campfire with two log seats, a stump and a rock.
    id: 'vig_campfire_ring', family: 'vignette', tags: ['seat', 'light', 'focal'], place: 'outdoor', facing: 'any', blocking: true, interact: 'campfire',
    clearance: { front: 2, sides: 2, back: 2 },
    voxels: [
      { ref: 'core_campfire', at: [0, 0, 0], rot: 0 },                     // 132
      { ref: 'nature_log', at: [0, 0, -11], rot: 0 },                      //  60
      { ref: 'nature_log', at: [0, 0, 11], rot: 0 },                       //  60
      { box: [9, 0, -2, 4, 5, 4], mat: 'wood' },                           // stump
      { box: [-13, 0, -2, 4, 3, 4], mat: 'stone' },                        // rock
    ],
  },
  {
    // Two crate stacks and a chest huddled together — somewhere to hide (and to loot).
    id: 'vig_crate_cluster', family: 'vignette', tags: ['hide', 'loot', 'cover'], place: 'corner', facing: 'room', blocking: true, hide: true, loot: true, interact: 'chest',
    clearance: { front: 1, sides: 0.5 },
    voxels: [
      { ref: 'shop_crate_stack', at: [-5, 0, -5], rot: 0 },                //  84
      { ref: 'shop_crate_stack', at: [8, 0, 0], rot: 1 },                  //  84
      { ref: 'core_chest', at: [-6, 0, 4], rot: 0 },                       //  60
    ],
  },
  {
    // Market stall with a crate stack and a produce crate out front.
    id: 'vig_market_stall', family: 'vignette', tags: ['surface', 'workstation', 'weenie'], place: 'floor', facing: 'room', blocking: true, interact: 'sell',
    clearance: { front: 3, sides: 1 },
    surfaces: [{ x: -3, z: -1.7, w: 7.5, d: 1.9, y: 4.2, max: 3 }],      // free front strip of the stall top
    voxels: [
      { ref: 'shop_stall', at: [2, 0, -5], rot: 0 },                       // 156
      { ref: 'shop_crate_stack', at: [-7, 0, 7], rot: 0 },                 //  84
      { box: [3, 0, 4, 8, 5, 6], mat: 'wood' },                            // produce crate
      { box: [3.5, 5, 4.5, 7, 2, 5], mat: 'accent' },                      // produce
    ],
  },
  // -------------------------------------------------------------------------------------------
  // 2026-08-23 — ten more readable corners for the generated places (worlds survey §3). Built from
  // existing refs + boxes only, so every one of them resolves today; the castle / spooky / medical /
  // prison / office families may later swap boxes for their own ids without changing a recipe.
  // TAGS ARE DELIBERATELY NARROW (family words, not 'sleep' / 'focal' / 'workstation'): the anchor tag
  // pools are global, and a furnished cell tagged 'sleep' would land in a cozy house bedroom. These are
  // reached by ID from RoomRecipe.vignettes (castle throne, hospital ward, prison cell block …), which is
  // the step furnish.ts still has to wire; vig_library_wall keeps 'storage' because a bookshelf bleeds nowhere wrong.
  // -------------------------------------------------------------------------------------------
  {
    // Throne on a two-step dais under a gold crest, a red banner hanging each side, a brazier at each foot.
    id: 'vig_throne_dais', family: 'vignette', tags: ['castle', 'throne'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 3, sides: 1 },
    voxels: [
      { box: [-14, 0, -10, 28, 2, 18], mat: 'stone' },                     // dais
      { box: [-16, 0, 8, 32, 1, 4], mat: 'stone' },                        // step
      { box: [-5, 2, -8, 10, 18, 2], mat: 'wood' },                        // throne back
      { box: [-6, 20, -8.5, 12, 2, 3], mat: 'accent' },                    // crest
      { ref: 'home_armchair', at: [0, 2, -1], rot: 0 },                    // 108, on the dais
      { mirror: 'x', ops: [
        { box: [9, 6, -9.5, 6, 22, 1], mat: 'fabric' },                    // banner, y 6..28
        { box: [8.5, 28, -10, 7, 1, 2], mat: 'wood' },                     // banner pole
        { box: [15, 0, -6, 4, 6, 4], mat: 'metal' },                       // brazier bowl
        { box: [15.5, 6, -5.5, 3, 3, 3], mat: 'glow', emissive: true },    // brazier flame
      ] },
    ],
  },
  {
    // Stocks, a brazier, chains on the wall, a bucket and a skull — the dungeon corner nobody sits in.
    id: 'vig_torture_corner', family: 'vignette', tags: ['castle', 'spooky'], place: 'corner', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.5 },
    voxels: [
      { box: [-12, 0, -6, 2, 14, 2], mat: 'wood' },                        // stocks posts
      { box: [-4, 0, -6, 2, 14, 2], mat: 'wood' },
      { box: [-13, 10, -6.5, 12, 4, 3], mat: 'wood' },                     // stocks board
      { box: [-10, 11, -5, 2, 2, 1], mat: 'dark' },                        // the holes
      { box: [-6, 11, -5, 2, 2, 1], mat: 'dark' },
      { box: [4, 0, -8, 4, 6, 4], mat: 'metal' },                          // brazier
      { box: [4.5, 6, -7.5, 3, 3, 3], mat: 'glow', emissive: true },
      { box: [10, 0, -4, 4, 4, 4], mat: 'wood' },                          // bucket
      { box: [2, 18, -9, 1, 12, 1], mat: 'dark' },                         // chains on the wall
      { box: [9, 16, -9, 1, 14, 1], mat: 'dark' },
      { box: [1, 30, -9.5, 9, 1, 1.5], mat: 'metal' },                     // the bar they hang from
      { box: [-2, 0, 4, 3, 2, 2], mat: 'stone' },                          // skull
      { box: [-3, 0, 7, 5, 1, 1], mat: 'stone' },                          // bone
    ],
  },
  {
    // Hospital bed with a drawn curtain on one side, an IV stand and a bedside cabinet with a monitor.
    id: 'vig_ward_bay', family: 'vignette', tags: ['medical'], place: 'wall', facing: 'room', blocking: true, interact: 'bed',
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { ref: 'home_bed', at: [-4, 0, 0], rot: 0 },                         //  84, headboard on the wall (−z), x −17..9
      { box: [10, 0, -12, 6, 7, 6], mat: 'metal' },                        // bedside cabinet
      { box: [10.5, 7, -11.5, 5, 4, 1], mat: 'dark' },                     // monitor
      { box: [11, 7.5, -11.2, 4, 3, 0.4], mat: 'glow', emissive: true },   // its screen
      { box: [12, 0, -4, 3, 1, 3], mat: 'metal' },                         // IV stand base
      { box: [13, 1, -3, 1, 16, 1], mat: 'metal' },                        // IV pole
      { box: [12, 14, -4, 3, 4, 1.5], mat: 'glass' },                      // the bag
      { box: [-21, 30, -14, 40, 1, 1], mat: 'metal' },                     // curtain rail
      { box: [-21, 4, -14, 2, 26, 22], mat: 'fabric' },                    // curtain drawn along the left
    ],
  },
  {
    // Nurses' / reception counter: a long desk with a lit front edge, a chair behind it, a monitor and a clipboard.
    id: 'vig_nurse_station', family: 'vignette', tags: ['medical', 'reception'], place: 'wall', facing: 'room', blocking: true, interact: 'workstation',
    clearance: { front: 2.5, sides: 0.5 },
    surfaces: [{ x: -4.5, z: 0.05, w: 9, d: 2.2, y: 4.55, max: 2 }],       // the free counter top
    voxels: [
      { box: [-14, 0, 1, 28, 12, 6], mat: 'metal' },                      // counter body, front face at z 0
      { box: [-15, 12, 0, 30, 1, 8], mat: 'glass' },                      // counter top
      { box: [-14, 9, 7, 28, 1.5, 0.5], mat: 'glow', emissive: true },     // light strip along the front
      { ref: 'home_chair', at: [0, 0, -4], rot: 0 },                      // 120, behind the counter facing the room
      { box: [-10, 13, 4, 5, 4, 1], mat: 'dark' },                        // monitor
      { box: [-9.5, 13.5, 4.2, 4, 3, 0.4], mat: 'glow', emissive: true },
      { box: [5, 13, 3, 4, 0.5, 3], mat: 'accent' },                      // clipboard
    ],
  },
  {
    // A furnished cell: two-tier bunk, toilet and sink, a shelf, bars along the front with a gap to walk through.
    id: 'vig_cell_furnished', family: 'vignette', tags: ['prison'], place: 'wall', facing: 'room', blocking: true, interact: 'bed',
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { box: [-13.5, 0, -7, 14, 3, 8], mat: 'metal' },                      // lower bunk frame
      { box: [-13.5, 3, -7, 14, 2, 8], mat: 'fabric' },                     // mattress
      { box: [-12.5, 5, -6, 4, 1.5, 6], mat: 'stone' },                     // pillow
      { box: [-13.5, 12, -7, 14, 2, 8], mat: 'metal' },                     // upper bunk
      { box: [-13.5, 14, -7, 14, 2, 8], mat: 'fabric' },
      { box: [6.5, 0, -7, 5, 5, 5], mat: 'stone' },                         // toilet
      { box: [7.5, 5, -6, 3, 1, 3], mat: 'dark' },
      { box: [6.5, 0, 0, 5, 8, 4], mat: 'metal' },                          // sink
      { box: [7, 8, 0.5, 4, 1, 3], mat: 'glass' },
      { box: [-7.5, 18, -8, 8, 1, 3], mat: 'wood' },                        // shelf
      { repeat: { n: 5, dx: 3 }, ops: [{ box: [-13.5, 0, 7, 1, 30, 1], mat: 'dark' }] },   // bars x −14..−2
      { repeat: { n: 3, dx: 3 }, ops: [{ box: [6.5, 0, 7, 1, 30, 1], mat: 'dark' }] },     // bars x 6..12 (gap −1..6)
      { box: [-13.5, 30, 7, 27, 1, 1], mat: 'metal' },                       // top rail
    ],
  },
  {
    // Guard booth in a corner: counter with a monitor, the guard's chair, a striped barrier arm and a lamp post.
    id: 'vig_guard_post', family: 'vignette', tags: ['prison', 'security'], place: 'corner', facing: 'room', blocking: true, interact: 'workstation',
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { box: [-15.25, 0, 1, 14, 11, 5], mat: 'metal' },                      // booth counter
      { box: [-16.25, 11, 0, 16, 1, 7], mat: 'glass' },                      // its top
      { ref: 'home_chair', at: [-8.25, 0, -3], rot: 0 },                     // 120, behind the counter
      { box: [-11.25, 12, 3, 5, 4, 1], mat: 'dark' },                         // monitor
      { box: [-10.75, 12.5, 3.2, 4, 3, 0.4], mat: 'glow', emissive: true },
      { box: [2.75, 0, 3, 2, 2, 2], mat: 'metal' },                          // barrier post
      { box: [3.25, 2, 3.5, 1, 10, 1], mat: 'metal' },
      { box: [3.75, 9, 3.5, 16, 1.5, 1], mat: 'accent' },                    // barrier arm
      { box: [-19.25, 0, -3, 3, 3, 3], mat: 'dark' },                        // lamp post base
      { box: [-18.25, 3, -2, 1, 22, 1], mat: 'metal' },
      { box: [-19.75, 25, -3.5, 4, 3, 4], mat: 'glow', emissive: true },   // lamp head
    ],
  },
  {
    // Four desks in a pod, monitors facing a low partition, a stool at each — the open-plan floor in one drop.
    id: 'vig_desk_cluster', family: 'vignette', tags: ['office'], place: 'floor', facing: 'any', blocking: true, interact: 'workstation',
    clearance: { front: 1.5, sides: 1.5, back: 1.5 },
    surfaces: [
      { x: -7, z: 2.2, w: 5.6, d: 1.2, y: 3.5, max: 1 }, { x: 1.4, z: 2.2, w: 5.6, d: 1.2, y: 3.5, max: 1 },
      { x: -7, z: -3.4, w: 5.6, d: 1.2, y: 3.5, max: 1 }, { x: 1.4, z: -3.4, w: 5.6, d: 1.2, y: 3.5, max: 1 },
    ],
    voxels: [
      { mirror: 'x', ops: [{ mirror: 'z', ops: [
        { box: [1, 9, 1, 20, 1, 10], mat: 'wood' },                        // desk top
        { box: [15, 0, 2, 5, 9, 8], mat: 'metal' },                        // drawer pedestal
        { box: [8, 10, 2, 6, 4, 1], mat: 'dark' },                         // monitor against the partition
        { box: [8.5, 10.5, 3, 5, 3, 0.4], mat: 'glow', emissive: true },
        { box: [8, 0, 14, 6, 6, 6], mat: 'fabric' },                       // stool
      ] }] },
      { box: [-0.5, 0, -12, 1, 16, 24], mat: 'fabric' },                   // partition along z
      { box: [-22, 0, -0.5, 44, 16, 1], mat: 'fabric' },                   // partition along x
    ],
  },
  {
    // Boardroom table with six chairs and a screen on a stand at its head.
    id: 'vig_meeting_set', family: 'vignette', tags: ['office', 'meeting'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 1.5, sides: 1.5, back: 1.5 },
    surfaces: [{ x: -5.6, z: -1.4, w: 11, d: 2.8, y: 3.7, max: 3 }],
    voxels: [
      { box: [-18, 9, -6, 36, 1.5, 12], mat: 'wood' },                     // table top
      { box: [-14, 0, -3, 4, 9, 6], mat: 'metal' },                        // pedestal legs
      { box: [10, 0, -3, 4, 9, 6], mat: 'metal' },
      { mirror: 'z', ops: [{ repeat: { n: 3, dx: 12 }, ops: [
        { box: [-15, 0, 7, 6, 6, 6], mat: 'fabric' },                      // chair seat
        { box: [-15, 6, 12, 6, 8, 1.5], mat: 'fabric' },                   // chair back
      ] }] },
      { box: [21, 0, -1, 2, 12, 2], mat: 'metal' },                        // screen stand
      { box: [21, 12, -6, 1, 9, 12], mat: 'dark' },                        // screen
      { box: [20.6, 12.5, -5.5, 0.4, 8, 11], mat: 'glow', emissive: true },
    ],
  },
  {
    // Ritual altar: cloth-draped slab with a skull and a book, a chalk ring on the floor, candles at the corners.
    id: 'vig_altar_spooky', family: 'vignette', tags: ['spooky', 'ritual'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 2, sides: 1, back: 1 },
    voxels: [
      { box: [-8, 0, -4, 16, 6, 8], mat: 'stone' },                        // altar
      { box: [-8.5, 6, -4.5, 17, 0.5, 9], mat: 'fabric' },                 // cloth
      { box: [-2, 6.5, -2, 4, 3, 4], mat: 'stone' },                       // skull
      { box: [4, 6.5, -2, 4, 1, 3], mat: 'dark' },                         // the book
      { box: [-14, 0, -14, 28, 0.3, 1], mat: 'accent' },                   // chalk ring (a square, voxels do not bend)
      { box: [-14, 0, 13, 28, 0.3, 1], mat: 'accent' },
      { box: [-14, 0, -14, 1, 0.3, 28], mat: 'accent' },
      { box: [13, 0, -14, 1, 0.3, 28], mat: 'accent' },
      { mirror: 'x', ops: [{ mirror: 'z', ops: [
        { box: [11, 0, 11, 2, 4, 2], mat: 'fabric' },                      // corner candle
        { box: [11.5, 4, 11.5, 1, 1.5, 1], mat: 'glow', emissive: true },
      ] }] },
      { mirror: 'x', ops: [
        { box: [10, 0, -2, 2, 10, 2], mat: 'metal' },                      // tall candle stand
        { box: [9.5, 10, -2.5, 3, 2, 3], mat: 'glow', emissive: true },
      ] },
    ],
  },
  {
    // A wall of books: four shelves of spines under a cornice with a rolling ladder — the library in one placement.
    id: 'vig_library_wall', family: 'vignette', tags: ['storage', 'tall'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.5 },
    voxels: [
      { box: [-18, 0, -3, 36, 28, 1], mat: 'wood' },                       // back panel
      { box: [-18, 0, -2, 1, 28, 6], mat: 'wood' },                        // sides
      { box: [17, 0, -2, 1, 28, 6], mat: 'wood' },
      { repeat: { n: 4, dy: 7 }, ops: [
        { box: [-17, 0, -2, 34, 1, 6], mat: 'wood' },                      // shelf
        { box: [-16, 1, -1.5, 15, 5, 4], mat: 'fabric' },                  // books, left run
        { box: [1, 1, -1.5, 15, 5, 4], mat: 'accent' },                    // books, right run
      ] },
      { box: [-19, 28, -3.5, 38, 1.5, 7], mat: 'wood' },                   // cornice
      { box: [-17, 26, 3, 34, 1, 1], mat: 'metal' },                       // ladder rail
      { box: [6, 0, 2.5, 1, 26, 1], mat: 'wood' },                         // ladder
      { box: [10, 0, 2.5, 1, 26, 1], mat: 'wood' },
      { repeat: { n: 5, dy: 5 }, ops: [{ box: [6, 3, 2.5, 5, 1, 1], mat: 'wood' }] },
    ],
  },
  // -------------------------------------------------------------------------------------------
  // The nine vignettes the archetypes named before anyone built them (survey §3). Same rule:
  // existing refs + boxes, narrow tags, reached by id from RoomRecipe.vignettes.
  // -------------------------------------------------------------------------------------------
  {
    // Weapon rack against the wall: three spears, two shields, an axe on pegs.
    id: 'vig_armoury_wall', family: 'vignette', tags: ['castle', 'armoury'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1.5, sides: 0.5 },
    voxels: [
      { box: [-14, 0, -3, 28, 2, 5], mat: 'wood' },                        // rack base
      { box: [-14, 2, -3, 28, 22, 1], mat: 'wood' },                       // rack back
      { box: [-14, 12, -2, 28, 1, 2], mat: 'wood' },                       // peg rail
      { repeat: { n: 3, dx: 4 }, ops: [
        { box: [-12, 2, -1.5, 1, 24, 1], mat: 'wood' },                    // spear shaft
        { box: [-12.5, 26, -1.7, 2, 4, 1.5], mat: 'metal' },               // spear head
      ] },
      { box: [1, 8, -1.5, 6, 8, 1], mat: 'accent' },                       // round-ish shield
      { box: [2, 6, -1.3, 4, 12, 0.8], mat: 'fabric' },                    // its stripe
      { box: [8, 8, -1.5, 5, 9, 1], mat: 'metal' },                        // kite shield
      { box: [10, 2, -1.5, 1, 18, 1], mat: 'wood' },                       // axe handle
      { box: [8, 18, -1.7, 5, 4, 1.5], mat: 'metal' },                     // axe head
    ],
  },
  {
    // A checkpoint: striped barrier across two crate stacks with a lamp on a post.
    id: 'vig_checkpoint_gate', family: 'vignette', tags: ['castle', 'prison', 'gate'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 2.5, sides: 1, back: 1 },
    voxels: [
      { ref: 'shop_crate_stack', at: [-14, 0, 0], rot: 0 },                //  84
      { ref: 'shop_crate_stack', at: [14, 0, 0], rot: 1 },                 //  84
      { box: [-7, 0, -1, 2, 2, 2], mat: 'metal' },                         // barrier post
      { box: [-6.5, 2, -0.5, 1, 8, 1], mat: 'metal' },
      { box: [-6, 8, -0.7, 14, 1.5, 1.4], mat: 'accent' },                 // the arm
      { box: [-2, 8.2, -0.5, 2, 1.1, 1], mat: 'dark' },                    // stripes
      { box: [3, 8.2, -0.5, 2, 1.1, 1], mat: 'dark' },
      { box: [7, 0, -6, 1, 20, 1], mat: 'metal' },                         // lamp post behind the arm
      { box: [6, 20, -7, 3, 2, 3], mat: 'glow', emissive: true },
    ],
  },
  {
    // Two rows of three pupils' desks with their chairs, all facing the same way (−z, toward the board).
    id: 'vig_classroom_row', family: 'vignette', tags: ['school', 'classroom'], place: 'floor', facing: 'room', blocking: true, interact: 'workstation',
    clearance: { front: 2, sides: 1, back: 1.5 },
    surfaces: [{ x: -4.2, z: -4.2, w: 2.4, d: 1.2, y: 3.5, max: 1 }, { x: 1.6, z: -4.2, w: 2.4, d: 1.2, y: 3.5, max: 1 }],
    voxels: [
      { repeat: { n: 3, dx: 12 }, ops: [{ repeat: { n: 2, dz: 14 }, ops: [
        { box: [-17, 9, -14, 10, 1, 6], mat: 'wood' },                     // desk top
        { box: [-16, 0, -12, 8, 9, 3], mat: 'metal' },                     // modesty panel + legs
        { box: [-15, 0, -6, 6, 6, 6], mat: 'fabric' },                     // chair seat, behind the desk
        { box: [-15, 6, -1, 6, 7, 1.5], mat: 'fabric' },                   // chair back
      ] }] },
    ],
  },
  {
    // Two angled consoles under a bank of screens with the operator's chair between them.
    id: 'vig_control_bridge', family: 'vignette', tags: ['prison', 'medical', 'security'], place: 'wall', facing: 'room', blocking: true, interact: 'workstation',
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { mirror: 'x', ops: [
        { box: [3, 0, -2.5, 12, 8, 6], mat: 'metal' },                       // console body
        { box: [3, 8, -2.5, 12, 2, 6], mat: 'dark' },                        // sloped top (a step, voxels do not slope)
        { box: [4, 10, -0.5, 10, 0.5, 3], mat: 'glow', emissive: true },     // its lit panel
      ] },
      { ref: 'home_chair', at: [0, 0, 3.5], rot: 0 },                       // 120, between the consoles
      { box: [-16, 10, -7.5, 32, 12, 1], mat: 'dark' },                     // screen bank
      { box: [-15, 11, -6.7, 14, 10, 0.4], mat: 'glow', emissive: true },
      { box: [1, 11, -6.7, 14, 10, 0.4], mat: 'glow', emissive: true },
    ],
  },
  {
    // Lab bench: a counter with flasks, a microscope and a shelf of glassware over it.
    id: 'vig_lab_station', family: 'vignette', tags: ['medical', 'lab'], place: 'wall', facing: 'room', blocking: true, interact: 'workstation',
    clearance: { front: 2, sides: 0.5 },
    surfaces: [{ x: 0.2, z: -1.6, w: 2.4, d: 1.6, y: 4.2, max: 1 }],
    voxels: [
      { ref: 'kitchen_counter', at: [0, 0, 0], rot: 0 },                   // 108, top at y 12
      { box: [-7, 12, -3, 2, 5, 2], mat: 'glass' },                        // flasks
      { box: [-4, 12, -2, 2, 3, 2], mat: 'glass' },
      { box: [-4.5, 15, -2.5, 3, 1, 3], mat: 'glow', emissive: true },     // the one that glows
      { box: [-1, 12, -3, 1.5, 7, 1.5], mat: 'glass' },
      { box: [5, 12, -3, 3, 1, 3], mat: 'metal' },                         // microscope base
      { box: [6, 13, -2.5, 1, 6, 1], mat: 'dark' },                        // microscope arm
      { box: [-8, 24, -4, 18, 1, 3], mat: 'metal' },                       // shelf over the bench
      { box: [-6, 25, -3.5, 3, 4, 2], mat: 'glass' },                      // glassware on it
      { box: [0, 25, -3.5, 2, 3, 2], mat: 'glass' },
      { box: [4, 25, -3.5, 3, 2, 2], mat: 'accent' },
    ],
  },
  {
    // A run of lockers with a bench in front and a bin at the end.
    id: 'vig_locker_wall', family: 'vignette', tags: ['school'], place: 'wall', facing: 'room', blocking: true, hide: true,
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { ref: 'school_locker_row', at: [-4, 0, -4], rot: 0 },               // 168, flush with the wall
      { ref: 'school_bench', at: [-4, 0, 6], rot: 0 },                     //  60, in front
      { box: [10, 0, -6, 4, 6, 4], mat: 'metal' },                         // bin
      { box: [10.5, 6, -5.5, 3, 1, 3], mat: 'dark' },
      { box: [11, 10, -6.5, 3, 4, 0.5], mat: 'accent' },                   // poster above it
    ],
  },
  {
    // Reception: a till counter with a waiting bench and a potted plant beside it.
    id: 'vig_reception_set', family: 'vignette', tags: ['office', 'reception'], place: 'wall', facing: 'room', blocking: true, interact: 'workstation',
    clearance: { front: 2.5, sides: 0.5 },
    voxels: [
      { ref: 'shop_register', at: [-6.5, 0, 0], rot: 0 },                   // 108
      { ref: 'school_bench', at: [11.5, 0, -1], rot: 0 },                    //  60, along the wall beside it
      { box: [-19.5, 0, -2, 4, 4, 4], mat: 'accent' },                       // plant pot
      { box: [-18.5, 4, -1, 2, 6, 2], mat: 'wood' },                         // stem
      { box: [-20.5, 8, -3, 6, 5, 6], mat: 'foliage' },                      // leaves
    ],
  },
  {
    // A small shrine: a hooded figure on a plinth, an offering bowl, candles and two hanging cloths.
    id: 'vig_shrine', family: 'vignette', tags: ['castle', 'shrine'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 2, sides: 0.5 },
    voxels: [
      { box: [-6, 0, -6, 12, 4, 8], mat: 'stone' },                        // plinth
      { box: [-3, 4, -5, 6, 12, 5], mat: 'stone' },                        // robed figure
      { box: [-2, 16, -4.5, 4, 4, 4], mat: 'stone' },                      // hood
      { box: [-2, 0, 3, 4, 1.5, 4], mat: 'metal' },                        // offering bowl
      { box: [-1.5, 1.5, 3.5, 3, 1, 3], mat: 'accent' },                   // coins in it
      { mirror: 'x', ops: [
        { box: [8, 0, -4, 2, 5, 2], mat: 'fabric' },                       // candle
        { box: [8.5, 5, -3.5, 1, 1.5, 1], mat: 'glow', emissive: true },
        { box: [9, 8, -7.5, 5, 18, 1], mat: 'fabric' },                    // hanging cloth
      ] },
    ],
  },
  {
    // The hoard: a stepped mound of gold with an open chest sunk into it, a goblet and a crown on top.
    id: 'vig_treasure_pile', family: 'vignette', tags: ['castle', 'hoard'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 1.5, sides: 1, back: 1 },
    voxels: [
      { box: [-12, 0, -10, 24, 2, 20], mat: 'accent' },                    // gold, bottom tier
      { box: [-9, 2, -7, 18, 2, 14], mat: 'accent' },
      { box: [-6, 4, -4, 12, 2, 8], mat: 'accent' },
      { box: [-3, 6, -2, 6, 1.5, 4], mat: 'accent' },
      { ref: 'core_chest', at: [7, 2, 5], rot: 3 },                        //  60, sunk into the pile
      { box: [-9, 4, 4, 3, 4, 3], mat: 'glow', emissive: true },           // a gem that catches the light
      { box: [-2, 7.5, -1, 4, 1, 2], mat: 'metal' },                       // crown band
      { box: [-1.5, 8.5, -0.5, 3, 1.5, 1], mat: 'glow', emissive: true },  // its jewel
      { box: [4, 6, -6, 2, 3, 2], mat: 'metal' },                          // goblet
      { box: [-10, 2, -9, 2, 1, 2], mat: 'accent' },                       // spilled coins
      { box: [9, 2, -8, 2, 1, 2], mat: 'accent' },
    ],
  },
];
