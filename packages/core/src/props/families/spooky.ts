// src/engine/props/families/spooky.ts
// ============================================================================
// SPOOKY — haunted houses, crypts and graveyards. Conventions as in core.ts:
// 1 voxel = 0.35 u · props stand on y=0, centred on x=z=0 · wall props face +z (their
// back is the −z face) · materials only (no colours) · ≤ 300 tris (dressing ≤ 60).
// Anything that glows (candle flames, pumpkin faces, ritual runes) is a 'glow' emissive box.
// Tris: one box = 12, one 8-sided cylinder = 32 — so ≤ 25 boxes, or ≤ 5 for dressing.
// ============================================================================
import type { PropDef, VoxelOp } from '../types';

/** A candle: wax stick with a flame on top. x/z = centre, y = base. */
const candle = (x: number, y: number, z: number, h: number): VoxelOp[] => [
  { box: [x - 0.5, y, z - 0.5, 1, h, 1], mat: 'fabric' },
  { box: [x - 0.5, y + h, z - 0.5, 1, 1.5, 1], mat: 'glow', emissive: true },
];

export const SPOOKY: PropDef[] = [
  {
    // Coffin: a tapered wooden box with a dark lid seam and accent handles, lying on the floor. A hiding place.
    id: 'spooky_coffin', family: 'spooky', tags: ['hide', 'cover', 'decor'], place: 'floor', facing: 'room', blocking: true, hide: true,
    clearance: { front: 1.5, sides: 0.5 },
    voxels: [
      { box: [-5, 0, -12, 10, 5, 24], mat: 'wood' },                       // body
      { mirror: 'x', ops: [{ box: [5, 0, -4, 2, 5, 10], mat: 'wood' }] },  // shoulders (the taper)
      { box: [-5.5, 5, -12.5, 11, 1, 25], mat: 'dark' },                   // lid
      { mirror: 'x', ops: [{ box: [5, 5, -4.5, 2.5, 1, 11], mat: 'dark' }] },
      { box: [-4, 6, -11, 8, 0.4, 22], mat: 'wood' },                      // lid panel
      { mirror: 'x', ops: [{ box: [6.5, 2, -2, 0.8, 1, 4], mat: 'accent' }] },   // handles
    ],
  },
  {
    // Gravestone: a rounded stone slab on a base with a dark inscription. Outdoor dressing.
    id: 'spooky_gravestone', family: 'spooky', tags: ['decor', 'outdoor', 'cover'], place: 'outdoor', facing: 'room', blocking: true, lod: 'dressing',
    clearance: { front: 1, sides: 0.5 },
    voxels: [
      { box: [-4, 0, -2, 8, 1, 4], mat: 'stone' },                         // base
      { box: [-3, 1, -1, 6, 7, 2], mat: 'stone' },                         // slab
      { cyl: [0, 8, 0, 3, 1], mat: 'stone', sides: 6 },                    // rounded top (a flat 6-gon, 24 tris)
      { box: [-2, 3, 1, 4, 3, 0.3], mat: 'dark' },                         // inscription
    ],
  },
  {
    // Cross gravestone: a stone cross on a stepped base. Outdoor dressing.
    id: 'spooky_gravestone_cross', family: 'spooky', tags: ['decor', 'outdoor', 'cover'], place: 'outdoor', facing: 'room', blocking: true, lod: 'dressing',
    clearance: { front: 1, sides: 0.5 },
    voxels: [
      { box: [-4, 0, -3, 8, 1, 6], mat: 'stone' },                         // base
      { box: [-2, 1, -1.5, 4, 2, 3], mat: 'stone' },                       // step
      { box: [-1, 3, -1, 2, 10, 2], mat: 'stone' },                        // upright
      { box: [-4, 8, -1, 8, 2, 2], mat: 'stone' },                         // arms
    ],
  },
  {
    // Cobweb: a translucent glass triangle strung across a corner with two dark threads.
    id: 'spooky_cobweb', family: 'spooky', tags: ['corner', 'wall', 'decor', 'clutter'], place: 'corner', facing: 'room', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-6, 4, -6, 12, 8, 0.4], mat: 'glass' },                      // web sheet on the back wall
      { box: [-6, 6, -6, 0.4, 6, 12], mat: 'glass' },                      // web sheet on the side wall
      { box: [-6, 0, -6, 8, 4, 8], mat: 'glass' },                         // the sag into the corner (reaches y=0)
      { box: [-6, 11.5, -6, 12, 0.3, 0.3], mat: 'dark' },                  // top thread
      { box: [-6, 0, -6, 0.3, 12, 0.3], mat: 'dark' },                     // corner thread
    ],
  },
  {
    // Candles: two candles of different heights in a puddle of wax. A light, sits on a surface or the floor.
    id: 'spooky_candles', family: 'spooky', tags: ['light', 'fire', 'decor', 'clutter'], place: 'surface', facing: 'any', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-3, 0, -3, 6, 0.5, 6], mat: 'fabric' },                      // wax puddle
      ...candle(-1, 0.5, 0.5, 4),
      ...candle(1.5, 0.5, -1.5, 2.5),
    ],
  },
  {
    // Portrait: a gilt frame, a dark canvas, a pale face with two glowing eyes that watch you.
    id: 'spooky_portrait', family: 'spooky', tags: ['wall', 'decor'], place: 'wall', facing: 'room', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-6, 0, 0, 12, 16, 0.8], mat: 'accent' },                     // frame (stands on y=0; hang at eye height)
      { box: [-5, 1, 0.8, 10, 14, 0.3], mat: 'dark' },                     // canvas
      { box: [-2, 6, 1.1, 4, 5, 0.3], mat: 'fabric' },                     // face
      { box: [-1.5, 9, 1.4, 1, 0.8, 0.3], mat: 'glow', emissive: true },   // eyes
      { box: [0.5, 9, 1.4, 1, 0.8, 0.3], mat: 'glow', emissive: true },
    ],
  },
  {
    // Grandfather clock: tall wooden case, a glass door over a pendulum, a face that glows faintly.
    id: 'spooky_clock', family: 'spooky', tags: ['focal', 'decor', 'tall'], place: 'wall', facing: 'room', blocking: true,
    clearance: { front: 1, sides: 0.3 },
    voxels: [
      { box: [-5, 0, -3, 10, 1, 6], mat: 'dark' },                         // plinth
      { box: [-4, 1, -2.5, 8, 30, 5], mat: 'wood' },                       // case
      { box: [-5, 31, -3, 10, 2, 6], mat: 'dark' },                        // cornice
      { box: [-2, 34, -0.5, 4, 2, 1], mat: 'accent' },                     // finial
      { box: [-3, 4, 2.5, 6, 16, 0.5], mat: 'glass' },                     // door
      { box: [-0.4, 10, 2, 0.8, 9, 0.3], mat: 'metal' },                   // pendulum rod
      { box: [-1.5, 7, 2, 3, 3, 0.4], mat: 'accent' },                     // pendulum bob
      { box: [-3, 22, 2.5, 6, 6, 0.5], mat: 'glow', emissive: true },      // face
      { box: [-0.3, 24.5, 3, 0.6, 3, 0.3], mat: 'dark' }, { box: [-0.3, 24.5, 3, 2.5, 0.6, 0.3], mat: 'dark' },   // hands
    ],
  },
  {
    // Boarded window: a dark window hole with three nailed planks across it.
    id: 'spooky_window_boarded', family: 'spooky', tags: ['wall', 'decor', 'window'], place: 'wall', facing: 'room', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-7, 0, 0, 14, 16, 0.5], mat: 'dark' },                       // the hole / night beyond
      { box: [-8, 0, 0.5, 16, 1, 0.8], mat: 'wood' },                      // sill
      { box: [-8, 3, 0.5, 16, 2.5, 0.8], mat: 'wood' },                    // planks
      { box: [-8, 8, 0.5, 16, 2.5, 0.8], mat: 'wood' },
      { box: [-8, 13, 0.5, 16, 2.5, 0.8], mat: 'wood' },
    ],
  },
  {
    // Jack-o'-lantern: an accent pumpkin with a stem and a glowing carved face.
    id: 'spooky_pumpkin', family: 'spooky', tags: ['light', 'decor', 'clutter', 'item'], place: 'floor', facing: 'room', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-3, 0, -3, 6, 5, 6], mat: 'accent' },                        // body
      { box: [-0.7, 5, -0.7, 1.4, 1.5, 1.4], mat: 'foliage' },             // stem
      { box: [-2, 3, 3, 1.2, 1, 0.3], mat: 'glow', emissive: true },       // eyes
      { box: [0.8, 3, 3, 1.2, 1, 0.3], mat: 'glow', emissive: true },
      { box: [-1.5, 1, 3, 3, 0.8, 0.3], mat: 'glow', emissive: true },     // grin
    ],
  },
  {
    // Hanging cage: an iron cage on a short chain, standing on its base ring. Dungeon cover.
    id: 'spooky_cage', family: 'spooky', tags: ['cover', 'decor', 'hide'], place: 'floor', facing: 'any', blocking: true, hide: true,
    clearance: { front: 1, sides: 0.5 },
    voxels: [
      { cyl: [0, 0, 0, 4, 1], mat: 'metal', sides: 8 },                    // base ring
      { cyl: [0, 14, 0, 4, 1], mat: 'metal', sides: 8 },                   // top ring
      { cyl: [0, 15, 0, 1.5, 2], mat: 'metal', sides: 6 },                 // cap
      { box: [-0.4, 17, -0.4, 0.8, 3, 0.8], mat: 'dark' },                 // chain stub
      { mirror: 'x', ops: [{ mirror: 'z', ops: [{ box: [2.5, 1, 2.5, 0.8, 13, 0.8], mat: 'dark' }] }] },   // four diagonal bars
      { mirror: 'x', ops: [{ box: [3.5, 1, -0.4, 0.8, 13, 0.8], mat: 'dark' }] },   // side bars
      { mirror: 'z', ops: [{ box: [-0.4, 1, 3.5, 0.8, 13, 0.8], mat: 'dark' }] },
      { box: [-1.5, 1, -1, 3, 2, 2], mat: 'fabric' },                      // something left inside
    ],
  },
  {
    // Ritual circle: a dark floor disc with glowing runes and a five-point star of glow lines.
    id: 'spooky_ritual_circle', family: 'spooky', tags: ['floor', 'focal', 'light', 'decor'], place: 'floor', facing: 'any', blocking: false, outline: false,
    voxels: [
      { cyl: [0, 0, 0, 10, 0.4], mat: 'dark', sides: 12 },                 // disc
      { cyl: [0, 0.4, 0, 9, 0.3], mat: 'glow', emissive: true, sides: 12 },   // outer ring
      { cyl: [0, 0.7, 0, 8, 0.3], mat: 'dark', sides: 12 },                // inner fill
      { box: [-8, 1, -0.5, 16, 0.3, 1], mat: 'glow', emissive: true },     // star lines (a cross + diagonals)
      { box: [-0.5, 1, -8, 1, 0.3, 16], mat: 'glow', emissive: true },
      { box: [-1.5, 1.3, -1.5, 3, 0.5, 3], mat: 'glow', emissive: true },  // centre rune
      ...candle(7, 1, 0, 2), ...candle(-7, 1, 0, 2), ...candle(0, 1, 7, 2), ...candle(0, 1, -7, 2),
    ],
  },
  {
    // Flickering lamp: an iron oil lamp on a stand with a glass chimney and a glow that reads as unsteady.
    id: 'spooky_lamp_flicker', family: 'spooky', tags: ['light', 'decor'], place: 'floor', facing: 'any', blocking: true,
    clearance: { front: 0.5, sides: 0.5 },
    voxels: [
      { box: [-2.5, 0, -2.5, 5, 1, 5], mat: 'dark' },                      // foot
      { cyl: [0, 1, 0, 0.7, 12], mat: 'metal', sides: 6 },                 // stand
      { cyl: [0, 13, 0, 2.5, 2], mat: 'metal', sides: 8 },                 // oil font
      { box: [-1, 15, -1, 2, 2, 2], mat: 'glow', emissive: true },         // flame
      { cyl: [0, 15, 0, 1.8, 6], mat: 'glass', sides: 8 },                 // chimney
      { cyl: [0, 21, 0, 2.5, 0.6], mat: 'dark', sides: 8 },                // cap
    ],
  },
  {
    // Cobwebbed chandelier: a castle-style iron ring chandelier with cold flames and a glass cobweb veil;
    // authored hanging DOWN from y=0 (the ceiling).
    id: 'spooky_chandelier_cobwebbed', family: 'spooky', tags: ['light', 'ceiling', 'decor'], place: 'ceiling', facing: 'any', blocking: false, outline: false,
    voxels: [
      { ref: 'castle_chandelier', at: [0, 0, 0] },
      { box: [-6, -8.5, -6, 12, 0.3, 6], mat: 'glass' },                   // web sheets draped off the ring
      { box: [-5, -6, 2, 0.3, 6, 4], mat: 'glass' },
    ],
  },
  {
    // Skull pile: a heap of bone-coloured cubes with dark eye sockets. Dressing.
    id: 'spooky_skull_pile', family: 'spooky', tags: ['decor', 'clutter', 'floor'], place: 'floor', facing: 'any', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-4, 0, -3, 8, 3, 6], mat: 'fabric' },                        // bottom row of skulls, read as one lump
      { box: [-2, 3, -1.5, 4, 3, 3], mat: 'fabric' },                      // top skull
      { box: [-1.5, 4, 1.5, 1, 1, 0.3], mat: 'dark' }, { box: [0.5, 4, 1.5, 1, 1, 0.3], mat: 'dark' },   // its eye sockets
      { box: [-3, 1, 3, 1, 1, 0.3], mat: 'dark' },                         // a socket on the pile
    ],
  },
  {
    // Suit of armour: a standing knight on a plinth with a halberd, visor glowing faintly. Cover — or is it?
    id: 'spooky_armour_suit', family: 'spooky', tags: ['decor', 'cover', 'focal'], place: 'floor', facing: 'room', blocking: true,
    clearance: { front: 1, sides: 0.5 },
    voxels: [
      { box: [-5, 0, -4, 10, 1, 8], mat: 'stone' },                        // plinth
      { mirror: 'x', ops: [
        { box: [0.5, 1, -1.5, 2, 7, 3], mat: 'metal' },                    // legs
        { box: [3.5, 9, -1.5, 2, 6, 3], mat: 'metal' },                    // arms
        { box: [3, 15, -2, 3, 2, 4], mat: 'metal' },                       // pauldrons
      ] },
      { box: [-3, 8, -2, 6, 8, 4], mat: 'metal' },                         // torso
      { box: [-2.5, 17, -2.5, 5, 5, 5], mat: 'metal' },                    // helm
      { box: [-1.5, 19, 2.5, 3, 0.8, 0.3], mat: 'glow', emissive: true },  // visor glow
      { box: [-0.5, 22, -1, 1, 2, 3], mat: 'fabric' },                     // plume
      { box: [5.5, 1, -0.5, 1, 24, 1], mat: 'wood' },                      // halberd shaft (+x hand)
      { box: [4.5, 20, -0.5, 3, 5, 1], mat: 'metal' },                     // halberd head
    ],
  },
  {
    // Cracked mirror: an ornate frame, a glass pane, dark crack lines and one accent shard missing.
    id: 'spooky_mirror_cracked', family: 'spooky', tags: ['wall', 'decor'], place: 'wall', facing: 'room', blocking: false, lod: 'dressing', outline: false,
    voxels: [
      { box: [-6, 0, 0, 12, 18, 0.8], mat: 'accent' },                     // frame
      { box: [-5, 1, 0.8, 10, 16, 0.3], mat: 'glass' },                    // mirror
      { box: [-0.3, 3, 1.1, 0.6, 12, 0.2], mat: 'dark' },                  // crack
      { box: [-4, 9, 1.1, 7, 0.5, 0.2], mat: 'dark' },
      { box: [2, 12, 0.8, 3, 4, 0.3], mat: 'dark' },                       // missing shard
    ],
  },
];
