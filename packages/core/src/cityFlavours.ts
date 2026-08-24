import * as THREE from 'three';
import type { CityTheme, CityKind, CityProfile } from './cityWorld';

// ============================================================================
// cityFlavours — the URBAN FLAVOUR PACK for CityWorld.
//
// CityWorld ships two clean modern looks (day / night). This module adds the
// three INDUSTRIAL flavours a Midgar-style scenario is written in, as pure
// DATA + CANVAS PAINTING (no scene machinery — that all stays in cityWorld.ts):
//
//   SLUMS — the district under the plate: corrugated shacks, scrap fences, junk
//           heaps, washing lines, oil-drum fires, cables strung overhead and a
//           permanent brown dusk under an iron CEILING (see plate*).
//   RUINS — a bombed-out block: snapped towers, leaning slabs, rubble mounds,
//           bent rebar, burnt car husks, scorch marks, dust and silence.
//   NEON  — a rain-slick entertainment strip: wall-to-wall signage, glyph
//           boards, lantern strings, vending machines, puddles that catch the
//           colour. Denser and louder than city-night, not a re-skin of it.
//
// EVERY flavour reuses cityWorld's existing machinery (per-chunk InstancedMesh,
// the shared box/cone/car geometries, the AABB collider list, the deterministic
// per-cell hash streams). Nothing here allocates per frame and nothing here is
// touched after the chunk that used it is frozen.
//
// The day/night entries in CITY_PROFILES restate cityWorld's ORIGINAL constants
// verbatim — they exist so the generator can read one table instead of five
// ternaries, and they must never drift (tests/scratch harness diff the built
// chunk plan against the pre-flavour generator).
// ============================================================================

/** deterministic PRNG (shared with cityWorld so both draw the same stream). */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** lighten/darken a #rrggbb hex by `amt` (in 0..255 channel units). */
export function shadeHex(hex: string, amt: number): string {
  const v = parseInt(hex.slice(1), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  const r = clamp(((v >> 16) & 255) + amt);
  const g = clamp(((v >> 8) & 255) + amt);
  const b = clamp((v & 255) + amt);
  return `rgb(${r},${g},${b})`;
}

function canvas2d(size: number): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, x: c.getContext('2d')! };
}

function tile(c: HTMLCanvasElement, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/** A radial fade sprite (light pool / scorch / puddle), painted WHITE so a
 *  per-instance colour can tint it. `stops` are [offset, alpha] pairs. */
function radialSprite(size: number, stops: Array<[number, number]>, inner = 0.04): THREE.CanvasTexture {
  const { c, x } = canvas2d(size);
  const g = x.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size * 0.5);
  for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// THEMES
// ---------------------------------------------------------------------------

/** SLUMS — Midgar under the plate. Everything is scavenged: the palette is
 *  rust, tarp and dirt lit by a permanent ember-orange dusk leaking in under
 *  an iron ceiling. `plateY` gives the world a real CEILING (CityWorld reports
 *  it as `ceilingY`, so the camera and the jump arc respect it). */
export const SLUMS_THEME: CityTheme = {
  name: 'slums',
  night: true,
  // no sky to speak of — a smoggy ember band under the plate's shadow
  sky: ['#150e0a', '#241408', '#4a2410', '#8a4718'],
  fog: 0x3d2413,
  fogDensity: 0.0072,          // d50 ≈ 116u: the far end of the sector is a silhouette, not a wall (0.0088 hid the street)
  concrete: 0xe4d7c6,          // near-neutral: the shack paint rides instanceColor
  glass: 0xb9c2bd,             // tarp / plastic sheeting patches
  brick: 0x6d4a33,             // painted plank walls
  // the dirt must stay DARKER than the shacks or the floor out-shines the
  // whole sector and the silhouettes stop reading against it
  asphalt: 0x9c9184,           // × roadBase -> packed dirt (~0x2b1f15)
  roadBase: '#463424',
  roadBlock: '#4f3b28',
  roadLine: '#5c4630',
  curb: '#6b5a45',
  park: 0x5a4835,              // bare dirt lot
  foliage: [0x4c5a3a, 0x566043, 0x404f31],   // scrub weeds (lots only)
  trunk: 0x3a2c20,
  window: 0xffb469,            // warm bulbs behind sheet-metal walls
  windowEmissive: 1.0,
  struct: 0x4a4038,            // plate pillars + girders: rusted structural steel
  scrap: 0xb5a48e,             // corrugated sheet (roofs, fences, lean-tos)
  junk: [0x6a5a42, 0x8a4f32, 0x3a6a8a, 0x94724a, 0x3f7a72],   // rust, steel, TARP BLUE, ochre, faded teal — two cool notes so the sector is not one brown
  glow: [0xff7a2a, 0xffa447, 0xff5f1e],      // oil-drum fire
  plateY: 52,
  plateColor: 0x2a2622,
  plateLamp: 0xffb257,
};

/** RUINS — a district that got hit. Colour is drained out of it: ash grey
 *  concrete, burnt metal, and a warm dust haze that eats the distance. */
export const RUINS_THEME: CityTheme = {
  name: 'ruins',
  night: false,
  sky: ['#6a6152', '#8a7c68', '#a8967c', '#c4b092'],   // sun behind a dust ceiling
  fog: 0x9a8f7a,
  fogDensity: 0.0055,          // d50 ≈ 150u — grey-on-grey needs DISTANCE to show shape
  concrete: 0xd8d2c8,
  glass: 0x8f9089,
  brick: 0x6f574a,             // scorched masonry — a bright brick box reads as untouched
  // the street must sit in the same dust family as the fog, or the ground
  // turns into a black hole under a pale sky
  asphalt: 0xcfc7ba,
  roadBase: '#5a554d',
  roadBlock: '#565149',
  roadLine: '#6a6358',
  curb: '#8a8378',
  park: 0x6f6a5e,
  foliage: [0x6a7a44, 0x7a8a50, 0x5a6a3c],   // weeds through the rubble — the one LIVE colour in the grey
  trunk: 0x4a4038,
  window: 0x2a2620,
  windowEmissive: 0,
  struct: 0x6a6055,
  scrap: 0x8a8074,
  junk: [0x9a9184, 0x8a8071, 0xa39a8a, 0x6f675c, 0x7d6d5a],
  glow: [0xff8a3c, 0xffc060, 0xff5a24],   // fires in three heats, not one orange
};

/** NEON — the strip at 2am in the rain. Near-black architecture so the signage
 *  is the ONLY colour, and a wet street that throws it all back up at you. */
export const NEON_THEME: CityTheme = {
  name: 'neon',
  night: true,
  sky: ['#04030a', '#0a0614', '#180a26', '#2e0e34'],   // light pollution bruise
  fog: 0x241434,
  fogDensity: 0.0055,
  concrete: 0x5f6478,
  glass: 0x565f80,
  brick: 0x4a4562,             // the unlit blocks must still SEPARATE, not be holes
  asphalt: 0x7d8298,           // wet: the road stays dark but takes a sheen
  roadBase: '#22222f',
  roadBlock: '#282838',
  roadLine: '#3a3550',
  curb: '#2b2b3a',
  park: 0x1e2436,
  foliage: [0x203020, 0x25381f, 0x2c4028],
  trunk: 0x241c18,
  window: 0xfff0d0,
  windowEmissive: 1.0,         // the rig lights the street now; windows are accents, not the only light
  struct: 0x1a1a24,
  scrap: 0x30303f,
  junk: [0x2a2a38, 0x33333f, 0x24242e],
  glow: [0x22d3ee, 0xff2d8a, 0xa855f7, 0xffd23f, 0x2dff9a, 0xff5722],
};

/** Generator tuning per flavour. day/night restate the ORIGINAL cityWorld
 *  constants — changing them changes the shipped city, so don't. */
export const CITY_PROFILES: Record<CityKind, CityProfile> = {
  day: {
    view: 3, lotChance: 0.22, cThresh: 0.78,
    bw: 12, bwSpan: 7, bd: 12, bdSpan: 7, bhBase: 22, bhSpan: 70, jitter: 2, yaw: 0,
    carEvery: 7, crosswalks: true, lampPool: false,
    facadeRough: 0.62, facadeMetal: 0.12, glassRough: 0.18, glassMetal: 0.5,
    groundRough: 0.92, groundMetal: 0.04,
  },
  night: {
    view: 2, lotChance: 0.1, cThresh: 0.55,
    bw: 12, bwSpan: 7, bd: 12, bdSpan: 7, bhBase: 22, bhSpan: 70, jitter: 2, yaw: 0,
    carEvery: 7, crosswalks: true, lampPool: true,
    facadeRough: 0.6, facadeMetal: 0.12, glassRough: 0.45, glassMetal: 0.3,
    groundRough: 0.92, groundMetal: 0.04,
  },
  // shacks: LOW, crooked and packed shoulder to shoulder — a 30u cell holding
  // a 16-24u footprint leaves an ALLEY, not a plaza, which is the whole feel
  slums: {
    view: 2, lotChance: 0.15, cThresh: 0.82,
    bw: 16, bwSpan: 8, bd: 16, bdSpan: 8, bhBase: 8, bhSpan: 14, jitter: 3, yaw: 0.14,
    carEvery: 11, crosswalks: false, lampPool: true,
    facadeRough: 0.95, facadeMetal: 0.28, glassRough: 0.9, glassMetal: 0.1,
    groundRough: 0.96, groundMetal: 0.02,
  },
  // snapped stumps + the odd tower that survived; lots of open blown-out ground
  ruins: {
    view: 2, lotChance: 0.26, cThresh: 0.88,
    bw: 12, bwSpan: 8, bd: 12, bdSpan: 8, bhBase: 7, bhSpan: 34, jitter: 2.5, yaw: 0.09,
    carEvery: 9, crosswalks: false, lampPool: false,
    facadeRough: 0.98, facadeMetal: 0.02, glassRough: 0.96, glassMetal: 0.02,
    groundRough: 0.97, groundMetal: 0.02,
  },
  // a canyon of mid-rises: barely any jitter, almost no gaps, no parks
  neon: {
    view: 2, lotChance: 0.04, cThresh: 0.6,
    bw: 15, bwSpan: 7, bd: 15, bdSpan: 7, bhBase: 26, bhSpan: 58, jitter: 1.2, yaw: 0,
    carEvery: 5, crosswalks: true, lampPool: true,
    facadeRough: 0.5, facadeMetal: 0.2, glassRough: 0.35, glassMetal: 0.45,
    groundRough: 0.3, groundMetal: 0.55,   // WET: the strip mirrors its own signs
  },
};

// ---------------------------------------------------------------------------
// FACADE TEXTURES (one per flavour) — same contract as cityWorld.facadeTexture:
// a tiling albedo + an optional emissive mask for the lit bits.
// ---------------------------------------------------------------------------

/** SLUMS — corrugated iron sheeting: vertical ribs, horizontal sheet joints,
 *  rivets, rust blooms and a couple of small warm windows. Painted NEUTRAL so
 *  the per-shack instanceColor (rust / tarp / faded paint) reads true. */
export function slumFacadeTexture(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const S = 256, { c, x } = canvas2d(S);
  const { c: ec, x: ex } = canvas2d(S);
  const rnd = mulberry32(0x51ab5);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);

  // 1) corrugated ribs — a hard light/dark saw pattern across U (16px pitch)
  const RIB = 16;
  for (let i = 0; i < S; i += RIB) {
    const g = x.createLinearGradient(i, 0, i + RIB, 0);
    g.addColorStop(0, '#7c7266');
    g.addColorStop(0.45, '#bcb1a0');
    g.addColorStop(0.6, '#cdc2b0');
    g.addColorStop(1, '#8a8073');
    x.fillStyle = g; x.fillRect(i, 0, RIB, S);
  }
  // 2) sheet joints — sheets are only so big, so they overlap in bands
  for (let y = 0; y < S; y += 64) {
    x.fillStyle = 'rgba(40,32,24,0.45)'; x.fillRect(0, y, S, 3);
    x.fillStyle = 'rgba(255,244,225,0.10)'; x.fillRect(0, y + 3, S, 2);
    for (let i = 8; i < S; i += 32) { x.fillStyle = 'rgba(30,24,18,0.5)'; x.fillRect(i, y + 6, 3, 3); } // rivets
  }
  // 3) rust blooms — warm blotches eating up from the joints
  for (let i = 0; i < 26; i++) {
    const bx = rnd() * S, by = rnd() * S, r = 6 + rnd() * 22;
    const g = x.createRadialGradient(bx, by, 1, bx, by, r);
    g.addColorStop(0, `rgba(126,68,30,${0.28 + rnd() * 0.3})`);
    g.addColorStop(1, 'rgba(126,68,30,0)');
    x.fillStyle = g; x.fillRect(bx - r, by - r, r * 2, r * 2);
  }
  // 4) two small punched windows per sheet — most of them lit from inside
  for (const [wx, wy] of [[38, 150], [166, 66]] as Array<[number, number]>) {
    x.fillStyle = '#20191a'; x.fillRect(wx, wy, 52, 44);
    x.fillStyle = 'rgba(20,14,10,0.6)'; x.fillRect(wx - 3, wy - 3, 58, 4);   // lintel shadow
    x.fillStyle = '#ffb469'; x.fillRect(wx + 5, wy + 5, 42, 34);
    ex.fillStyle = 'rgba(255,150,70,0.30)'; ex.fillRect(wx - 6, wy - 6, 64, 56);
    ex.fillStyle = '#ffbe7a'; ex.fillRect(wx + 5, wy + 5, 42, 34);
  }
  return { map: tile(c), emissive: tile(ec) };
}

/** RUINS — blast-cracked concrete: soot fans over blown-OUT window holes (no
 *  glass left), spalled patches showing aggregate, and long stress cracks. */
export function ruinFacadeTexture(): { map: THREE.CanvasTexture; emissive: null } {
  const S = 256, { c, x } = canvas2d(S);
  const rnd = mulberry32(0x21b5);

  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#b3aca1');
  g.addColorStop(1, '#8d867c');
  x.fillStyle = g; x.fillRect(0, 0, S, S);

  // spalled patches — the render blew off and left darker aggregate
  for (let i = 0; i < 34; i++) {
    const px = rnd() * S, py = rnd() * S, w = 10 + rnd() * 46, h = 8 + rnd() * 34;
    x.fillStyle = `rgba(96,88,78,${0.18 + rnd() * 0.26})`;
    x.fillRect(px, py, w, h);
    x.fillStyle = 'rgba(232,226,214,0.12)';
    x.fillRect(px, py, w, 2);
  }
  // blown-out window holes: black voids, sooted lintels, a broken sill
  const COLS = 4, ROWS = 5, cw = S / COLS, ch = S / ROWS;
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const wx = Math.round(cc * cw + cw * 0.28), wy = Math.round(r * ch + ch * 0.26);
    const ww = Math.round(cw * 0.44), wh = Math.round(ch * 0.42);
    x.fillStyle = rnd() < 0.75 ? '#14120f' : '#3a352c';   // most are empty holes
    x.fillRect(wx, wy, ww, wh);
    // soot fan licking up the wall above the opening
    const sg = x.createLinearGradient(0, wy, 0, wy - ch * 0.42);
    sg.addColorStop(0, 'rgba(24,20,16,0.55)');
    sg.addColorStop(1, 'rgba(24,20,16,0)');
    x.fillStyle = sg; x.fillRect(wx - 4, wy - ch * 0.42, ww + 8, ch * 0.42);
    x.fillStyle = 'rgba(226,220,208,0.5)'; x.fillRect(wx - 3, wy + wh, ww + 6, 3); // sill
  }
  // stress cracks — jagged polylines running down the slab
  x.strokeStyle = 'rgba(38,33,28,0.6)';
  for (let i = 0; i < 7; i++) {
    let cx0 = rnd() * S, cy0 = rnd() * S * 0.4;
    x.lineWidth = 1 + rnd() * 2;
    x.beginPath(); x.moveTo(cx0, cy0);
    for (let s = 0; s < 6; s++) { cx0 += (rnd() - 0.5) * 34; cy0 += 12 + rnd() * 26; x.lineTo(cx0, cy0); }
    x.stroke();
  }
  return { map: tile(c), emissive: null };
}

/** NEON — the strip's towers are mostly WINDOW: a dense grid where ~4 in 5
 *  panes burn, in sign colours rather than office white, plus two horizontal
 *  light bands (floor strips) that make the buildings themselves glow. */
export function neonFacadeTexture(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const S = 256, { c, x } = canvas2d(S);
  const { c: ec, x: ex } = canvas2d(S);
  const rnd = mulberry32(0x9e0);
  x.fillStyle = '#2a2e3f'; x.fillRect(0, 0, S, S);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);

  const COLS = 6, ROWS = 8, cw = S / COLS, chh = S / ROWS;
  // saturated sign colours, not office white — and a real share of DARK panes
  // so the grid breaks up instead of reading as one lit spreadsheet
  const LIT = ['#5eeaff', '#ff5fae', '#ffd166', '#b98cff', '#7dffc4', '#fff4e0', '#ff8a4a'];
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) {
    const wx = Math.round(cc * cw + cw * 0.18), wy = Math.round(r * chh + chh * 0.2);
    const ww = Math.round(cw * 0.64), wh = Math.round(chh * 0.6);
    x.fillStyle = '#161a28'; x.fillRect(wx, wy, ww, wh);
    if (rnd() < 0.66) {
      const col = LIT[(rnd() * LIT.length) | 0];
      x.fillStyle = col; x.fillRect(wx, wy, ww, wh);
      ex.fillStyle = 'rgba(190,220,255,0.22)'; ex.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      ex.fillStyle = col; ex.fillRect(wx, wy, ww, wh);
    }
  }
  // floor light-bands: two bright horizontal strips wrapping the tower
  for (const by of [Math.round(chh * 2.9), Math.round(chh * 6.9)]) {
    x.fillStyle = '#d8f6ff'; x.fillRect(0, by, S, 4);
    ex.fillStyle = 'rgba(120,220,255,0.55)'; ex.fillRect(0, by - 3, S, 10);
    ex.fillStyle = '#bff0ff'; ex.fillRect(0, by, S, 4);
  }
  // mullion grid, dark so the lit panes separate
  x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 2;
  for (let r = 0; r <= ROWS; r++) { const yy = Math.round(r * chh); x.beginPath(); x.moveTo(0, yy + 0.5); x.lineTo(S, yy + 0.5); x.stroke(); }
  for (let cc = 0; cc <= COLS; cc++) { const xx = Math.round(cc * cw); x.beginPath(); x.moveTo(xx + 0.5, 0); x.lineTo(xx + 0.5, S); x.stroke(); }
  return { map: tile(c), emissive: tile(ec) };
}

// ---------------------------------------------------------------------------
// GROUND TEXTURES — same contract as cityWorld.roadTexture: ONE fine tile
// (~15 world units) of plain surface, no lane art (it would checkerboard).
// ---------------------------------------------------------------------------

export function slumGroundTexture(): THREE.CanvasTexture {
  const S = 256, { c, x } = canvas2d(S);
  const rnd = mulberry32(0x51d17);
  x.fillStyle = '#4a3826'; x.fillRect(0, 0, S, S);
  // trodden dirt: broad damp patches, then grit and dropped scrap
  for (let i = 0; i < 40; i++) {
    const px = rnd() * S, py = rnd() * S, r = 12 + rnd() * 40;
    const g = x.createRadialGradient(px, py, 1, px, py, r);
    g.addColorStop(0, `rgba(30,22,14,${0.10 + rnd() * 0.16})`);
    g.addColorStop(1, 'rgba(30,22,14,0)');
    x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  for (let i = 0; i < 1500; i++) {
    const v = 70 + rnd() * 60;
    x.fillStyle = `rgba(${v},${v * 0.82},${v * 0.6},${0.05 + rnd() * 0.12})`;
    x.fillRect(rnd() * S, rnd() * S, 1 + (rnd() < 0.25 ? 2 : 0), 1 + (rnd() < 0.2 ? 1 : 0));
  }
  return tile(c);
}

export function ruinGroundTexture(): THREE.CanvasTexture {
  const S = 256, { c, x } = canvas2d(S);
  const rnd = mulberry32(0x21b7);
  x.fillStyle = '#4e4a43'; x.fillRect(0, 0, S, S);
  // dust drifts over broken asphalt + a web of cracks with rubble in them
  for (let i = 0; i < 30; i++) {
    const px = rnd() * S, py = rnd() * S, r = 14 + rnd() * 46;
    const g = x.createRadialGradient(px, py, 1, px, py, r);
    g.addColorStop(0, `rgba(186,172,150,${0.10 + rnd() * 0.18})`);
    g.addColorStop(1, 'rgba(186,172,150,0)');
    x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  // hairline cracks only: at ~15 world units per tile a long crack would read
  // as a canyon, and every tile would show the same one
  x.strokeStyle = 'rgba(34,31,26,0.32)';
  for (let i = 0; i < 14; i++) {
    let px = rnd() * S, py = rnd() * S;
    x.lineWidth = 1 + rnd();
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 4; s++) { px += (rnd() - 0.5) * 26; py += (rnd() - 0.5) * 26; x.lineTo(px, py); }
    x.stroke();
  }
  for (let i = 0; i < 700; i++) {
    const v = 96 + rnd() * 70;
    x.fillStyle = `rgba(${v},${v * 0.96},${v * 0.88},${0.06 + rnd() * 0.14})`;
    x.fillRect(rnd() * S, rnd() * S, 1 + (rnd() < 0.3 ? 2 : 0), 1 + (rnd() < 0.3 ? 1 : 0));
  }
  return tile(c);
}

export function neonGroundTexture(): THREE.CanvasTexture {
  const S = 256, { c, x } = canvas2d(S);
  const rnd = mulberry32(0x9e07);
  x.fillStyle = '#191924'; x.fillRect(0, 0, S, S);
  // WET asphalt: long smeared highlights (the strip's signs, running downhill)
  for (let i = 0; i < 22; i++) {
    const px = rnd() * S, w = 3 + rnd() * 10, h = 40 + rnd() * 140;
    const g = x.createLinearGradient(0, rnd() * S, 0, 0);
    const tint = rnd();
    const col = tint < 0.4 ? '120,220,255' : tint < 0.75 ? '255,90,170' : '255,210,120';
    g.addColorStop(0, `rgba(${col},0)`);
    g.addColorStop(0.5, `rgba(${col},${0.05 + rnd() * 0.08})`);
    g.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = g; x.fillRect(px, rnd() * S, w, h);
  }
  for (let i = 0; i < 900; i++) {
    const v = 40 + rnd() * 40;
    x.fillStyle = `rgba(${v},${v},${v + 14},${0.05 + rnd() * 0.1})`;
    x.fillRect(rnd() * S, rnd() * S, 1 + (rnd() < 0.25 ? 1 : 0), 1);
  }
  return tile(c);
}

// ---------------------------------------------------------------------------
// FLAVOUR-ONLY SPRITES + PANELS
// ---------------------------------------------------------------------------

/** SLUMS — the underside of the PLATE: riveted iron panels, deep girder ribs
 *  and, every few panels, a caged service lamp that still works. The emissive
 *  mask carries only the lamps, so the ceiling glows in patches. */
export function plateTexture(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const S = 256, { c, x } = canvas2d(S);
  const { c: ec, x: ex } = canvas2d(S);
  const rnd = mulberry32(0x91a7e);
  x.fillStyle = '#2b2724'; x.fillRect(0, 0, S, S);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);

  // panel field: 4x4 riveted plates, slightly different shades
  const P = S / 4;
  for (let r = 0; r < 4; r++) for (let cc = 0; cc < 4; cc++) {
    x.fillStyle = shadeHex('#2b2724', -6 + Math.round(rnd() * 14));
    x.fillRect(cc * P + 1, r * P + 1, P - 2, P - 2);
    x.fillStyle = 'rgba(12,10,9,0.8)';
    for (let i = 6; i < P - 4; i += 14) {
      x.fillRect(cc * P + i, r * P + 3, 3, 3);
      x.fillRect(cc * P + 3, r * P + i, 3, 3);
    }
  }
  // girders: two deep ribs crossing the whole panel field
  x.fillStyle = '#191614'; x.fillRect(0, S / 2 - 9, S, 18); x.fillRect(S / 2 - 9, 0, 18, S);
  x.fillStyle = 'rgba(96,84,70,0.35)'; x.fillRect(0, S / 2 - 9, S, 2); x.fillRect(S / 2 - 9, 0, 2, S);
  // rust weeping down the seams
  for (let i = 0; i < 16; i++) {
    const px = rnd() * S, py = rnd() * S, r = 8 + rnd() * 24;
    const g = x.createRadialGradient(px, py, 1, px, py, r);
    g.addColorStop(0, `rgba(110,60,26,${0.16 + rnd() * 0.2})`);
    g.addColorStop(1, 'rgba(110,60,26,0)');
    x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  // two caged service lamps, painted into BOTH maps so they read as lit
  for (const [lx, ly] of [[P * 0.5, P * 2.5], [P * 2.5, P * 0.5]] as Array<[number, number]>) {
    x.fillStyle = '#0e0c0a'; x.fillRect(lx - 13, ly - 9, 26, 18);
    x.fillStyle = '#ffcf8a'; x.fillRect(lx - 9, ly - 5, 18, 10);
    ex.fillStyle = 'rgba(255,170,90,0.30)'; ex.fillRect(lx - 22, ly - 18, 44, 36);
    ex.fillStyle = '#ffd79a'; ex.fillRect(lx - 9, ly - 5, 18, 10);
  }
  return { map: tile(c, 2), emissive: tile(ec, 2) };
}

/** NEON — a sign BOARD: an unlit dark panel carrying bright blocky "glyph"
 *  marks (abstract — never real writing). Painted WHITE-on-black so the
 *  per-instance colour picks the sign's neon, one material for every sign. */
export function signGlyphTexture(): THREE.CanvasTexture {
  const S = 128, { c, x } = canvas2d(S);
  const rnd = mulberry32(0x516);
  x.fillStyle = '#0b0b14'; x.fillRect(0, 0, S, S);
  x.fillStyle = '#ffffff';
  x.fillRect(3, 3, S - 6, 2); x.fillRect(3, S - 5, S - 6, 2);      // bright frame rails
  // three stacked glyph rows: each glyph is a few strokes in a 24px box
  for (let row = 0; row < 3; row++) {
    const gy = 14 + row * 38;
    for (let g = 0; g < 3; g++) {
      const gx = 12 + g * 38;
      const strokes = 2 + ((rnd() * 3) | 0);
      for (let s = 0; s < strokes; s++) {
        if (rnd() < 0.5) x.fillRect(gx + (rnd() * 14) | 0, gy + ((rnd() * 22) | 0), 3 + rnd() * 18, 4);
        else x.fillRect(gx + ((rnd() * 22) | 0), gy + ((rnd() * 12) | 0), 4, 6 + rnd() * 18);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/** Warm light pool cast on the ground by a fire / lamp (white, tinted per
 *  instance). Softer + tighter than the night city's streetlight pool. */
export function poolSprite(): THREE.CanvasTexture {
  return radialSprite(128, [[0, 0.5], [0.45, 0.2], [1, 0]]);
}

/** NEON — a rain puddle: a soft blob with a couple of bright streaks so it
 *  reads as a REFLECTION rather than a wet stain. Tinted per instance. */
export function puddleSprite(): THREE.CanvasTexture {
  const S = 128, { c, x } = canvas2d(S);
  const rnd = mulberry32(0x9dd);
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.06, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.34)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.13)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 5; i++) {
    const sy = 24 + rnd() * 80, h = 3 + rnd() * 5;
    const lg = x.createLinearGradient(0, 0, S, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, `rgba(255,255,255,${0.22 + rnd() * 0.25})`);
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = lg; x.fillRect(0, sy, S, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}
