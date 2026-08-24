// src/engine/props/surfaces.ts
// ============================================================================
// Canvas-painted SURFACE FINISHES for composed interiors — planks, tiles, flagstones,
// plaster, wallpaper, carpet, metal panels, grass — coloured from a Style's tones so a
// castle's flagstones and a candy castle's flagstones are the same drawing, different ink.
// Deterministic value noise (no Math.random), seamless (modular), cached. Headless-safe:
// without a DOM the material has no map and the vertex tint carries the colour, so tests
// and render-checks run under bun.
//
// MEMORY (2026-08-23 audit). The first version painted every (finish, style) at 256² RGBA:
// 10 finishes × 6 live styles × 256 KiB = 15 MB, against a 4 MB budget. Three things fixed it,
// none of them visible:
//   • SIZE PER FINISH (FINISH_SIZE) — measured, not guessed. The measure is DETAIL LOST UNDER
//     MAGNIFICATION: paint the candidate, magnify it back to a 512² ground truth the way the
//     GPU does when you stand on the floor, and take the worst RMSE over all nine styles.
//     128² is the ceiling the 4 MB budget allows for 10 finishes × 6 styles, and it costs
//     1–7/255 more than the old 256² did (plank 4.1 → 5.7, flagstone 5.5 → 6.2, panel 2.8 →
//     4.2, brick 14.7 → 17.6, tile 7.5 → 14.8 — tile the only one you could argue about, and
//     its pattern is flat colour between grout lines that the mip chain eats anyway).
//     A finish drops the extra step to 64² only when doing so stays under ~1.5/255, i.e. below
//     an 8-bit channel's own noise floor: plaster 0.4, dirt 0.8, grass 1.2, carpet 1.4 — the
//     four that are pure value noise with nothing at that frequency to lose. Every patterned
//     finish scores 4–18/255 at 64² and keeps 128²; scripts in the audit reproduce the table.
//   • SUPERSAMPLING (OVERSAMPLE) — halving a size without it would have been a downgrade: the
//     thin grout lines, board seams and rivets are 1–3 texels wide and used to flicker in and
//     out of the texel grid. Painting 2×2 samples per texel and averaging fixes that, and it
//     over-repays the size cut: measured against the correct area downsample, worst of all nine
//     styles, the shipped textures ALIAS LESS THAN THE OLD 256² ONES DID — plank 3.13 → 2.22,
//     flagstone 3.23 → 2.28, wallpaper 2.51 → 1.52, panel 2.03 → 1.45, brick 8.84 → 6.23, and
//     tile 14.98 → 0.10 against its own un-sampled 128². Generating a style's ten finishes also
//     got cheaper, 555 ms → 306 ms, because the texel counts fell further than the sample rate
//     rose. (2× is where the curve flattens; 4× moves nothing — the test pins that.)
//   • SHARING BY COLOUR (finishSignature) — the cache key is the finish plus the tones its
//     painter actually reads, quantised to ~2/255. Two styles that ink a finish the same way
//     get one texture; a style cloned under a new id (world tours do this) costs nothing.
// Live signatures are bounded by MAX_STYLES = 6, the same LRU bound as the geometry library,
// so a 10-world tour evicts instead of accumulating. tests/props.test.mjs pins all of it.
// ============================================================================
import * as THREE from 'three';
import type { Style } from './types';
import { withCutout } from '../cameraCutout';

export type Finish = 'plank' | 'tile' | 'flagstone' | 'plaster' | 'wallpaper' | 'carpet' | 'panel' | 'grass' | 'dirt' | 'brick' | 'roof';
export const FINISHES: readonly Finish[] = ['plank', 'tile', 'flagstone', 'plaster', 'wallpaper', 'carpet', 'panel', 'grass', 'dirt', 'brick', 'roof'];
/** World units per texture repeat — the UV generator in composedWorld divides by this. */
export const FINISH_SCALE: Record<Finish, number> = { plank: 5, tile: 4, flagstone: 6, plaster: 8, wallpaper: 4, carpet: 5, panel: 5, grass: 8, dirt: 8, brick: 4, roof: 4 };
/** Texels per side. 128 is the budget ceiling; 64 only for the noise-only finishes (see header). */
export const FINISH_SIZE: Record<Finish, number> = { plank: 128, tile: 128, flagstone: 128, plaster: 64, wallpaper: 128, carpet: 64, panel: 128, grass: 64, dirt: 64, brick: 128, roof: 128 };
/** Samples per texel side. Every finish is painted at OVERSAMPLE× its size and box-filtered down. */
export const OVERSAMPLE = 2;

function hash2(x: number, y: number): number { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
const sm = (t: number) => t * t * (3 - 2 * t);
/** Modular value noise so the tile wraps at `period`. */
function vnoise(x: number, y: number, period: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const w = (a: number) => ((a % period) + period) % period;
  const tl = hash2(w(xi), w(yi)), tr = hash2(w(xi + 1), w(yi)), bl = hash2(w(xi), w(yi + 1)), br = hash2(w(xi + 1), w(yi + 1));
  const u = sm(xf), v = sm(yf);
  return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
}
function fbm(x: number, y: number, period: number, oct = 4): number { let a = 0.5, f = 1, s = 0, n = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, period * f); n += a; a *= 0.5; f *= 2; } return s / n; }

/** Raw sRGB channels — NOT through THREE.Color (which would convert to linear and paint everything 2–4× too dark). */
function rgb(hex: number): [number, number, number] { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

type Painter = (u: number, v: number) => [number, number, number];   // u,v in [0,1)

function painterFor(finish: Finish, st: Style): Painter {
  const t = st.tones;
  const P = 4;   // noise period per tile (keeps it seamless)
  switch (finish) {
    case 'plank': { const base = rgb(t.wood[0]), dark = rgb(t.wood[1]), light = rgb(t.wood[2]); const BOARDS = 5;
      return (u, v) => { const b = Math.floor(v * BOARDS); const off = hash2(b, 3) * 0.5; const seamV = (v * BOARDS) % 1; const seamU = ((u + off) * 2) % 1;
        let c = mix(base, light, (hash2(b, 9) - 0.5) * 0.5 + 0.25); const grain = fbm((u + off) * 14, v * 70, P * 14, 3); c = mix(c, dark, (grain - 0.5) * 0.5);
        if (seamV < 0.05 || seamU < 0.012) c = mix(c, dark, 0.8); return c; }; }
    case 'tile': { const a = rgb(t.stone[2]), b = rgb(t.stone[0]), grout = rgb(t.dark[2]); return (u, v) => { const gu = (u * 2) % 1, gv = (v * 2) % 1; if (gu < 0.04 || gv < 0.04) return grout; const chk = (Math.floor(u * 2) + Math.floor(v * 2)) & 1; const n = (fbm(u * 8, v * 8, P * 8, 2) - 0.5) * 0.15; return mix(chk ? a : b, a, 0.5 + n); }; }
    case 'flagstone': { const a = rgb(t.stone[0]), l = rgb(t.stone[2]), grout = rgb(t.stone[1]); const ROWS = 3;
      return (u, v) => { const r = Math.floor(v * ROWS); const uu = (u + (r & 1) * 0.5) * 2; const cu = uu % 1, cv = (v * ROWS) % 1; const id = hash2(Math.floor(uu) % 4, r);
        if (cu < 0.05 || cv < 0.07) return grout; const n = fbm(u * 10 + id, v * 10, P * 10, 3); return mix(mix(a, l, 0.35 + id * 0.4), l, (n - 0.5) * 0.4); }; }
    case 'brick': { const a = rgb(t.accent[0]), d = rgb(t.accent[1]), grout = rgb(t.stone[2]); const ROWS = 6;
      return (u, v) => { const r = Math.floor(v * ROWS); const uu = (u + (r & 1) * 0.5) * 3; const cu = uu % 1, cv = (v * ROWS) % 1; if (cu < 0.05 || cv < 0.12) return grout; const id = hash2(Math.floor(uu) % 6, r); return mix(a, d, id * 0.35); }; }
    case 'plaster': { const a = rgb(t.stone[2]), d = rgb(t.stone[0]); return (u, v) => { const n = fbm(u * 6, v * 6, P * 6, 4); const streak = fbm(u * 12, v * 1.5, P * 12, 2); return mix(a, d, (n - 0.5) * 0.35 + Math.max(0, streak - 0.62) * 0.8); }; }
    case 'wallpaper': { const base = rgb(t.fabric[2]), light = mix(rgb(t.fabric[2]), [255, 255, 255], 0.55), dark = rgb(t.fabric[0]);
      return (u, v) => { const stripe = ((u * 6) % 1) < 0.5 ? 0 : 1; const dia = Math.abs(((u * 12) % 1) - 0.5) + Math.abs(((v * 12) % 1) - 0.5) < 0.18 ? 1 : 0; let c = mix(light, base, stripe * 0.35); if (dia) c = mix(c, dark, 0.35); const n = (fbm(u * 10, v * 10, P * 10, 2) - 0.5) * 0.1; return mix(c, dark, n + 0.05); }; }
    case 'carpet': { const a = rgb(t.fabric[0]), d = rgb(t.fabric[1]), l = rgb(t.fabric[2]); return (u, v) => { const n = fbm(u * 30, v * 30, P * 30, 3); const weave = (Math.floor(u * 96) + Math.floor(v * 96)) & 1 ? 0.04 : 0; return mix(mix(a, l, (n - 0.5) * 0.5 + 0.2), d, weave); }; }
    case 'panel': { const a = rgb(t.metal[0]), d = rgb(t.metal[1]), l = rgb(t.metal[2]); return (u, v) => { const gu = (u * 2) % 1, gv = (v * 2) % 1; if (gu < 0.03 || gv < 0.03) return d; const rivet = (Math.abs(gu - 0.08) < 0.03 || Math.abs(gu - 0.92) < 0.03) && (Math.abs(gv - 0.08) < 0.03 || Math.abs(gv - 0.92) < 0.03); if (rivet) return l; const n = fbm(u * 5, v * 5, P * 5, 3); return mix(a, l, (n - 0.5) * 0.25 + 0.1); }; }
    case 'grass': { const a = rgb(t.foliage[0]), d = rgb(t.foliage[1]), l = rgb(t.foliage[2]); return (u, v) => { const n = fbm(u * 12, v * 12, P * 12, 4); const f = fbm(u * 40, v * 40, P * 40, 2); return mix(mix(d, l, n), a, 0.4 + (f - 0.5) * 0.5); }; }
    case 'roof': {   // slate rows — the same trio in every style, so the colour signature below is exact
      const a = rgb(t.stone[1]), l = rgb(t.stone[0]), d = rgb(t.dark[1]); const ROWS = 6;
      return (u, v) => { const r = Math.floor(v * ROWS); const uu = (u + (r & 1) * 0.5) * 4; const cu = uu % 1, cv = (v * ROWS) % 1;
        if (cv < 0.1) return mix(d, a, 0.35); if (cu < 0.05) return mix(a, d, 0.45);
        const id = hash2(Math.floor(uu) % 4, r); const n = fbm(u * 12, v * 12, P * 12, 2); return mix(mix(a, l, id * 0.5), l, (n - 0.5) * 0.4 + cv * 0.25); }; }
    case 'dirt': { const a = rgb(t.wood[0]), d = rgb(t.wood[1]), l = rgb(t.wood[2]); return (u, v) => { const n = fbm(u * 9, v * 9, P * 9, 4); const f = fbm(u * 35, v * 35, P * 35, 2); return mix(mix(d, l, n), a, 0.5 + (f - 0.5) * 0.4); }; }
  }
}

// ---------------------------------------------------------------------------
// Colour signature — the cache key. NOT the style id.
// ---------------------------------------------------------------------------
/** Exactly the tones each painter above reads. Keep in step with painterFor(); a test perturbs
 *  every listed tone (must change the paint) and every unlisted one (must not). */
const FINISH_TONES: Record<Finish, (t: Style['tones']) => number[]> = {
  plank: (t) => [t.wood[0], t.wood[1], t.wood[2]],
  tile: (t) => [t.stone[2], t.stone[0], t.dark[2]],
  flagstone: (t) => [t.stone[0], t.stone[1], t.stone[2]],
  brick: (t) => [t.accent[0], t.accent[1], t.stone[2]],
  plaster: (t) => [t.stone[2], t.stone[0]],
  wallpaper: (t) => [t.fabric[2], t.fabric[0]],
  carpet: (t) => [t.fabric[0], t.fabric[1], t.fabric[2]],
  panel: (t) => [t.metal[0], t.metal[1], t.metal[2]],
  grass: (t) => [t.foliage[0], t.foliage[1], t.foliage[2]],
  dirt: (t) => [t.wood[0], t.wood[1], t.wood[2]],
  roof: (t) => [t.stone[1], t.stone[0], t.dark[1]],
};
/** Channels are bucketed in steps of QUANT/255 — a difference no eye finds on a noisy voxel wall.
 *  Bucketing is one-sided by nature: two palettes inside a bucket share, two straddling its edge
 *  do not. That costs at most one extra texture and can never share the WRONG one, which is the
 *  direction that matters — tests/props.test.mjs pins it as "signatures equal ⇒ paints equal". */
const QUANT = 2;
const qHex = (hex: number): string => {
  const q = (c: number) => Math.floor(c / QUANT).toString(36);
  return q((hex >> 16) & 255) + '.' + q((hex >> 8) & 255) + '.' + q(hex & 255);
};
/** The identity of a painted finish: its drawing plus its ink. Two styles sharing one share a texture. */
export function finishSignature(finish: Finish, st: Style): string {
  return finish + '|' + FINISH_TONES[finish](st.tones).map(qHex).join('/');
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------
/** Pure pixel paint (RGBA, size×size), `ss`×`ss` samples per texel averaged — testable headless. */
export function paintFinish(finish: Finish, st: Style, size = 256, ss = 1): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4); const paint = painterFor(finish, st);
  const inv = 1 / (size * ss), n = ss * ss;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const [pr, pg, pb] = paint((x * ss + sx + 0.5) * inv, (y * ss + sy + 0.5) * inv);
      r += pr; g += pg; b += pb;
    }
    const i = (y * size + x) * 4; data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n; data[i + 3] = 255;
  }
  return data;
}
/** Mean brightness 0..255 of a finish in a style (audit: nothing may paint black). */
export function finishBrightness(finish: Finish, st: Style): number {
  const d = paintFinish(finish, st, 64); let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4);
}
/** Bytes one finish occupies on the GPU, mip chain included (a full chain is 4/3 of level 0). */
export const finishBytes = (finish: Finish): number => Math.round(FINISH_SIZE[finish] ** 2 * 4 * (4 / 3));

// ---------------------------------------------------------------------------
// Bounded, colour-keyed cache — one texture + one material per signature.
// ---------------------------------------------------------------------------
// `refs` counts LIVE STYLES holding a signature, not meshes: two styles that ink a finish the
// same way keep one texture alive between them, and it goes when the second of them is evicted.
// Same policy and same bound as library.ts — one world is on screen at a time and asking for a
// style makes it the most recent, so the LRU only ever reaches worlds you have navigated away
// from. Anything that keeps two worlds in more than six distinct styles alive at once must raise
// MAX_STYLES in both files rather than assume a material it is still drawing with survives.
const MAX_STYLES = 6;                                   // mirrors library.ts; a 7th style evicts the LRU one
interface Live { finish: Finish; tex: THREE.Texture | null; mat?: THREE.MeshStandardMaterial; refs: number }
const live = new Map<string, Live>();
const styleSigs = new Map<string, Set<string>>();       // style id → signatures it has asked for
const styleLru: string[] = [];

function evictStyle(styleId: string): void {
  const sigs = styleSigs.get(styleId); if (!sigs) return;
  styleSigs.delete(styleId);
  for (const sig of sigs) {
    const e = live.get(sig); if (!e) continue;
    if (--e.refs > 0) continue;
    e.tex?.dispose(); e.mat?.dispose(); live.delete(sig);
  }
}
/** Note that `styleId` is using `sig` right now, and keep at most MAX_STYLES styles alive. */
function touch(styleId: string, sig: string): void {
  const i = styleLru.indexOf(styleId);
  if (i >= 0) styleLru.splice(i, 1);
  styleLru.push(styleId);
  let sigs = styleSigs.get(styleId);
  if (!sigs) { sigs = new Set(); styleSigs.set(styleId, sigs); }
  if (!sigs.has(sig)) { sigs.add(sig); const e = live.get(sig); if (e) e.refs++; }
  while (styleLru.length > MAX_STYLES) evictStyle(styleLru.shift()!);
}
function entry(finish: Finish, st: Style): Live {
  const sig = finishSignature(finish, st);
  let e = live.get(sig);
  if (!e) {
    e = { finish, tex: null, refs: 0 };
    if (typeof document !== 'undefined') {
      const size = FINISH_SIZE[finish];
      const c = document.createElement('canvas'); c.width = c.height = size;
      const ctx = c.getContext('2d')!; const img = ctx.createImageData(size, size);
      img.data.set(paintFinish(finish, st, size, OVERSAMPLE));
      ctx.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      // Floors and walls are seen at grazing angles all the time, so the mip chain is not optional:
      // without it a 128² tile shimmers down a corridor. 4× aniso keeps the far end readable and is
      // free in memory; more buys nothing at these texel counts.
      tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 4; tex.needsUpdate = true;
      e.tex = tex;
    }
    live.set(sig, e);
  }
  touch(st.id, sig);
  return e;
}

/** A seamless canvas texture for (finish, style); null headless. Shared by colour, not by style id. */
export function finishTexture(finish: Finish, st: Style): THREE.Texture | null { return entry(finish, st).tex; }

/** Shared material per painted finish: textured when a DOM exists, tinted otherwise. Vertex colours carry the AO bake. */
export function finishMaterial(finish: Finish, st: Style): THREE.MeshStandardMaterial {
  const e = entry(finish, st);
  if (!e.mat) {
    e.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: finish === 'tile' || finish === 'panel' ? 0.55 : 0.95, metalness: finish === 'panel' ? 0.25 : 0, ...(e.tex ? { map: e.tex } : {}) });
    e.mat.userData.__hullShared = true;
    withCutout(e.mat);
  }
  return e.mat;
}
/** Fallback tint when no texture can be painted (headless) — the finish's dominant tone. */
export function finishTint(finish: Finish, st: Style): number {
  const t = st.tones;
  switch (finish) { case 'plank': return t.wood[0]; case 'tile': return t.stone[2]; case 'flagstone': return t.stone[0]; case 'brick': return t.accent[1]; case 'plaster': return t.stone[2]; case 'wallpaper': return t.fabric[2]; case 'carpet': return t.fabric[0]; case 'panel': return t.metal[0]; case 'grass': return t.foliage[0]; case 'dirt': return t.wood[1]; case 'roof': return t.accent[1]; }
}

// --- cache introspection (the audit surface tests/props.test.mjs asserts on) ----------------
/** Distinct painted finishes held right now (signatures, not style×finish pairs). */
export const finishCacheSize = (): number => live.size;
/** GPU bytes the live finish textures occupy, mip chains included. Counts a shared texture once. */
export function finishTextureBytes(): number { let b = 0; for (const e of live.values()) b += finishBytes(e.finish); return b; }
/** What a set of styles WOULD cost with every finish painted — pure, so it runs headless. */
export function finishAtlasBytes(styles: Style[], finishes: readonly Finish[] = FINISHES): number {
  const seen = new Set<string>(); let b = 0;
  for (const st of styles) for (const f of finishes) { const sig = finishSignature(f, st); if (seen.has(sig)) continue; seen.add(sig); b += finishBytes(f); }
  return b;
}
export function disposeFinishes(): void {
  for (const e of live.values()) { e.tex?.dispose(); e.mat?.dispose(); }
  live.clear(); styleSigs.clear(); styleLru.length = 0;
}
