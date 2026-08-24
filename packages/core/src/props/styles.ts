// src/engine/props/styles.ts
// ============================================================================
// Styles: a 9-material × 3-tone palette (+ glow, lighting, composer hints). Any style
// applies to any prop and any archetype — "candy school", "space prison" — so every
// material MUST be toned in every style (scripts/prop-audit.mjs enforces it).
// Tones are sRGB hex [base, dark, light]: side / underside / top.
//
// LIGHTING is read by exactly one place: composedRig() / composedPool() in
// src/engine/composedWorld.ts, pinned per style by tests/lighting-budget.test.mjs.
//   ambient      0.34 (dungeon) … 0.65 (school) — how much flat fill the style wants
//   exposure     the style's MOOD multiplier, NOT a renderer setting: composed worlds render
//                at a forced toneMappingExposure of 1.0, so 0.95 means "renders dimmer".
//   pointLights  fixture budget (the rig caps at 6); ibl / fog are not read by anything yet.
// ============================================================================
import type { Style, Tones } from './types';

const T = (base: number, dark: number, light: number): Tones => [base, dark, light];

export const STYLES: Record<string, Style> = {
  'house.cozy': {
    id: 'house.cozy', glow: 1.2, wallH: 14, cell: 5, trim: 'plank', cute: true,
    lighting: { ambient: 0.55, pointLights: 3, exposure: 1.0, ibl: true },
    tones: {
      wood: T(0xb07a45, 0x7a4e2a, 0xd29a62), stone: T(0x9a9590, 0x6d6862, 0xb8b3ad), metal: T(0x8a9099, 0x5a6068, 0xb0b6be),
      fabric: T(0xc85a5a, 0x8f3c3c, 0xe07878), foliage: T(0x5fa84a, 0x3d7530, 0x86c76a), glass: T(0x9ad6e8, 0x6aa8bb, 0xc8eef8),
      accent: T(0xf0b33c, 0xb7811f, 0xffd06a), glow: T(0xffe9a8, 0xffd070, 0xfff6d8), dark: T(0x2b2520, 0x1a1512, 0x3d342c),
    },
  },
  'house.modern': {
    id: 'house.modern', glow: 1.0, wallH: 14, cell: 5, trim: 'tile',
    lighting: { ambient: 0.6, pointLights: 3, exposure: 1.05, ibl: true },
    tones: {
      wood: T(0xd6b48a, 0xa6845c, 0xeed2ae), stone: T(0xb9b7b2, 0x8a8884, 0xd6d4cf), metal: T(0xb8bcc2, 0x80858c, 0xdadde2),
      fabric: T(0x5b7fa6, 0x3a5675, 0x82a5c9), foliage: T(0x6cb36a, 0x477a46, 0x93d290), glass: T(0xa9dff0, 0x79b3c7, 0xd6f3fb),
      accent: T(0x2fb6a6, 0x1f7d72, 0x62d6c8), glow: T(0xf7fbff, 0xcfe2f5, 0xffffff), dark: T(0x2e3136, 0x1b1d20, 0x44484e),
    },
  },
  castle: {
    id: 'castle', glow: 1.4, wallH: 18, cell: 5, trim: 'flagstone',
    lighting: { ambient: 0.4, pointLights: 6, exposure: 1.0, ibl: false, fog: [0x2a2420, 0.004] },
    // warm torchlight on grey stone, red banners, gold crests (2026-08-23 worlds survey): the stone leans a
    // touch warm so the orange pools read as firelight on it rather than as a tint over blue-grey.
    tones: {
      wood: T(0x7a4f2c, 0x4f3119, 0x9c6c42), stone: T(0x8f8a80, 0x625d54, 0xaea79b), metal: T(0x6d7178, 0x45484e, 0x959aa2),
      fabric: T(0xa8262e, 0x6f161c, 0xd04a52), foliage: T(0x4f8a3e, 0x335c28, 0x74ad62), glass: T(0x7fb2d6, 0x5583a3, 0xaad1ea),
      accent: T(0xd9a92e, 0x9c7718, 0xf3cb5a), glow: T(0xffb347, 0xff8c1a, 0xffd9a0), dark: T(0x24221f, 0x141311, 0x36332f),
    },
  },
  haunted: {
    id: 'haunted', glow: 1.5, wallH: 16, cell: 5, trim: 'plank',
    // ambient 0.25 → 0.36 and mood 0.9 → 0.95 (2026-08-23 darkness audit): the haunted house
    // delivered the second-darkest fill of the nine styles and its far wall was unreadable.
    // The mood stays in the TINT (hard pools from 6 lights), not in the murk.
    // 2026-08-23 worlds survey: dust, candles, purple-grey. The glow went from ghost-cyan to candle amber so the
    // candelabra / sconce fixtures agree with the 'candle' light colour the composer already emits; the ghost
    // green stays on `accent` (ectoplasm, the portraits' eyes) and the stone carries the purple.
    lighting: { ambient: 0.36, pointLights: 6, exposure: 0.95, ibl: false, fog: [0x0f0c16, 0.008] },
    tones: {
      wood: T(0x5c4a5a, 0x3a2d39, 0x7d687a), stone: T(0x6e6878, 0x47424f, 0x8e889a), metal: T(0x6e5a4a, 0x47392e, 0x907a66),
      fabric: T(0x5a3570, 0x39204a, 0x7d4f98), foliage: T(0x6b7a4a, 0x46512f, 0x8c9d66), glass: T(0x8aa0b0, 0x5f7280, 0xb0c4d2),
      accent: T(0x8fd64a, 0x5f9a2a, 0xb8ee7a), glow: T(0xffd27a, 0xe0a040, 0xfff0c0), dark: T(0x15121a, 0x0a080d, 0x241f2b),
    },
  },
  school: {
    id: 'school', glow: 1.0, wallH: 14, cell: 5, trim: 'tile', cute: true,
    lighting: { ambient: 0.65, pointLights: 3, exposure: 1.05, ibl: true },
    tones: {
      wood: T(0xc79a62, 0x956f42, 0xe0b886), stone: T(0xd9d4c8, 0xa9a498, 0xefebe2), metal: T(0x9aa3b0, 0x6b7482, 0xbcc4ce),
      fabric: T(0x3b82d6, 0x255a9c, 0x6aa6ea), foliage: T(0x62b552, 0x3f7d35, 0x8bd07c), glass: T(0x9fd4ea, 0x6ea6bd, 0xcdebf7),
      accent: T(0xf04e4e, 0xb02f2f, 0xf78080), glow: T(0xf4f9ff, 0xcfe0f0, 0xffffff), dark: T(0x2a2e35, 0x17191d, 0x3e444c),
    },
  },
  shop: {
    id: 'shop', glow: 1.3, wallH: 14, cell: 5, trim: 'tile', cute: true,
    lighting: { ambient: 0.6, pointLights: 3, exposure: 1.05, ibl: true },
    tones: {
      wood: T(0xc08a4e, 0x8d6133, 0xdaa86e), stone: T(0xe6e2d8, 0xb4b0a6, 0xf4f1ea), metal: T(0xaeb6c0, 0x7a828c, 0xd0d6de),
      fabric: T(0xe8573d, 0xae3a26, 0xf48269), foliage: T(0x5cb85c, 0x3c803c, 0x84d284), glass: T(0xa4dcee, 0x73adc0, 0xd2f0f9),
      accent: T(0x3ccf9a, 0x27906a, 0x6fe2bb), glow: T(0xff6ad5, 0xd23fa8, 0xffa8ea), dark: T(0x26282e, 0x151619, 0x3a3d45),
    },
  },
  dungeon: {
    id: 'dungeon', glow: 1.5, wallH: 16, cell: 5, trim: 'flagstone',
    // ambient 0.22 → 0.34 (2026-08-23 darkness audit): the darkest style of the nine, and the
    // only one whose rooms were genuinely black. It stays the darkest — 6 hard orange pools
    // over a low cool fill — it just no longer hides the walls.
    lighting: { ambient: 0.34, pointLights: 6, exposure: 1.0, ibl: false, fog: [0x0b0a0c, 0.01] },
    tones: {
      wood: T(0x5a3d26, 0x372314, 0x7a5638), stone: T(0x5d5b5a, 0x3b3a39, 0x7b7977), metal: T(0x585c62, 0x35383d, 0x7c8188),
      fabric: T(0x6b1f28, 0x44121a, 0x8f3642), foliage: T(0x4a6a3a, 0x2f4625, 0x6a8c58), glass: T(0x6f93ad, 0x4a6a80, 0x98b8cc),
      accent: T(0xb8902c, 0x7f6218, 0xd9b14e), glow: T(0xff9a3c, 0xe0681a, 0xffc98a), dark: T(0x1a1816, 0x0d0c0b, 0x2a2724),
    },
  },
  lab: {
    id: 'lab', glow: 1.3, wallH: 14, cell: 5, trim: 'panel',
    lighting: { ambient: 0.55, pointLights: 3, exposure: 1.0, ibl: true },
    // cool white-green (2026-08-23 worlds survey): the hospital rides this style, so the stone is a clinical
    // mint-white and the fabric a scrub teal — curtains, chairs and the ward beds read as one place.
    tones: {
      wood: T(0xb8a78e, 0x8a7c68, 0xd3c6b2), stone: T(0xd2dcd8, 0x9faaa6, 0xe8efec), metal: T(0x9ea6b0, 0x6e757e, 0xc2c9d1),
      fabric: T(0x4aa08c, 0x317063, 0x72c2ad), foliage: T(0x58a86a, 0x3a7348, 0x80c890), glass: T(0xa6e0ef, 0x74b2c4, 0xd4f3fa),
      accent: T(0xf2a93b, 0xb87a1e, 0xffc870), glow: T(0x7df0ff, 0x3ccbe0, 0xc8fbff), dark: T(0x23272c, 0x121417, 0x363b42),
    },
  },
  prison: {
    id: 'prison', glow: 1.1, wallH: 14, cell: 5, trim: 'tile',
    lighting: { ambient: 0.5, pointLights: 3, exposure: 1.0, ibl: true },
    // concrete + orange accents: poured grey with a green-grey cast, jumpsuit orange on `accent`.
    tones: {
      wood: T(0x8d7a62, 0x5f5242, 0xa89680), stone: T(0x999c96, 0x6b6e6a, 0xbabdb7), metal: T(0x7c838b, 0x50555b, 0xa0a7ae),
      fabric: T(0x5d6b7a, 0x3d4852, 0x8093a4), foliage: T(0x5f8f55, 0x3f6138, 0x83b078), glass: T(0x9cc2d2, 0x6d93a3, 0xc4e0ea),
      accent: T(0xf08a2e, 0xb5601a, 0xffae63), glow: T(0xf2f6f0, 0xcdd6cb, 0xffffff), dark: T(0x26292c, 0x141617, 0x3a3e42),
    },
  },
  'castle.winter': {
    id: 'castle.winter', glow: 1.3, wallH: 18, cell: 5, trim: 'flagstone',
    lighting: { ambient: 0.5, pointLights: 6, exposure: 1.0, ibl: false, fog: [0x34404c, 0.004] },
    tones: {
      wood: T(0x6e5540, 0x463525, 0x8f7358), stone: T(0xa8b0b8, 0x717a84, 0xd2d9e0), metal: T(0x7a838c, 0x4f565e, 0xa4adb6),
      fabric: T(0x2f5f9a, 0x1f3f68, 0x5a8ac4), foliage: T(0x5f7f62, 0x3e5540, 0x8aa88c), glass: T(0xbfe2f2, 0x86b2c8, 0xe6f6fc),
      accent: T(0xd9a92e, 0x9c7718, 0xf3cb5a), glow: T(0xffc98a, 0xff9a3c, 0xffe4c0), dark: T(0x2a2e33, 0x15181b, 0x3f454b),
    },
  },
  candy: {
    id: 'candy', glow: 1.3, wallH: 14, cell: 5, trim: 'tile', cute: true,
    lighting: { ambient: 0.65, pointLights: 3, exposure: 1.05, ibl: true },   // = school: the brightest the composed rig allows (fill ≤ 2.95, exposure ±5%)
    tones: {
      wood: T(0xf2b8c6, 0xc7889a, 0xfbd3dc), stone: T(0xf0dde4, 0xe0c2cc, 0xf5ecf0),   // stone ≤ 245 mean brightness as plaster/flagstone (tests/props)
      metal: T(0xb9d6ff, 0x86a9d6, 0xd9e9ff),
      fabric: T(0xff6fa3, 0xc94b7c, 0xffa3c6), foliage: T(0x8fe08a, 0x5fae5c, 0xb8f0b3), glass: T(0xc6f0ff, 0x94c8de, 0xe6f9ff),
      accent: T(0xffd23f, 0xd9a91a, 0xffe88a), glow: T(0xfff6b0, 0xffd870, 0xfffbe0), dark: T(0x5a3a4a, 0x3a2430, 0x7a556a),
    },
  },
  space: {
    id: 'space', glow: 1.4, wallH: 14, cell: 5, trim: 'panel',
    lighting: { ambient: 0.5, pointLights: 3, exposure: 1.0, ibl: true, fog: [0x0b0f1a, 0.003] },
    tones: {
      wood: T(0x8a8f99, 0x5e636c, 0xaab0ba), stone: T(0xb7bec9, 0x848c98, 0xd6dce5), metal: T(0x9aa4b4, 0x68717f, 0xc3ccd8),
      fabric: T(0x3b7dd8, 0x2857a0, 0x6fa3ec), foliage: T(0x4fc0a8, 0x348070, 0x86dcc8), glass: T(0x9fdcff, 0x6fb0d6, 0xd4f1ff),
      accent: T(0xff7a3c, 0xc2521f, 0xffa274), glow: T(0x7df0ff, 0x3ccbe0, 0xc8fbff), dark: T(0x1c2230, 0x0f131c, 0x2c3446),
    },
  },
  reef: {
    id: 'reef', glow: 1.3, wallH: 14, cell: 5, trim: 'sand',
    lighting: { ambient: 0.55, pointLights: 3, exposure: 1.0, ibl: true, fog: [0x1d5c6e, 0.005] },
    tones: {
      wood: T(0xb08a5e, 0x7e613f, 0xcfa97c), stone: T(0xc9b89a, 0x968769, 0xe3d6bc), metal: T(0x7fa6ad, 0x567a80, 0xa8c9ce),
      fabric: T(0xff8a5c, 0xc76140, 0xffb08e), foliage: T(0x44c1a0, 0x2d8a70, 0x7fe0c4), glass: T(0xa5e8ef, 0x73b9c2, 0xd6f7fa),
      accent: T(0xff5fa2, 0xc63f78, 0xff9ac6), glow: T(0xbffcff, 0x7fe3f0, 0xe6feff), dark: T(0x1c3a44, 0x10252c, 0x2d5560),
    },
  },
};

export const DEFAULT_STYLE = STYLES['house.cozy'];
export const styleIds = (): string[] => Object.keys(STYLES);
/** A style by id; unknown ids fall back to the cozy house (never throws — a kid's typo must still render). */
export function styleOf(id: string | undefined): Style { return (id && STYLES[id]) || DEFAULT_STYLE; }
