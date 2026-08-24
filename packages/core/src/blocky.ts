// ============================================================================
// Blocky character builder — SHARED by the game engine and the selfie page.
// A Roblox/Minecraft-style box character with hip/shoulder pivots so limbs swing,
// an optional selfie texture on the head's front face, an optional sword, and a
// bold black toon outline. Configurable (male/female, skirt, hair, colours).
// ============================================================================
import * as THREE from 'three';
import { aoBox, addOutline, attachBlobShadow } from './blockyKit';
import { withCutout } from './cameraCutout';
import type { WeaponKind } from './types';
export { addOutline } from './blockyKit';

// look palettes — every NPC/enemy gets a random combo so the crowd varies.
const LOOK_SHIRTS = [0x8a3a3a, 0x355f8a, 0x3f7a3a, 0x6a4a8a, 0x8a6a2a, 0x2a6f6a, 0x7a3a5a, 0x474d55, 0xa05a2a, 0x4a4a8a, 0xb04848, 0x2f5a3a];
const LOOK_SKINS = [0xf0c9a0, 0xe0a878, 0xc88c58, 0xa06a40, 0x7a4a2a, 0xd8a878];
const LOOK_HAIRS = [0x221a12, 0x4a3018, 0x6a4628, 0x101012, 0x8a6a3a, 0x5a3a2a, 0xa8a8a8, 0x2a1a3a];
const LOOK_PANTS = [0x2a2a32, 0x33425a, 0x3a2a1a, 0x222226, 0x4a3a2a, 0x2f3a2a, 0x3a3a44];
const LOOK_SHOES = [0x17171b, 0x2a1a12, 0x3a2414, 0x222226, 0x4a2a2a, 0x101012];
const LOOK_SKIRTS = [0x8a3a5a, 0x355f8a, 0x6a4a8a, 0x2a6f6a, 0xb04848, 0x3f6a8a, 0x7a3a7a, 0x9a5a2a, 0xc06a8a, 0x3f7a5a];
const rpick = <T,>(a: T[]): T => a[(Math.random() * a.length) | 0];

export interface BlockyLook {
  skin?: number; hair?: number; shirt?: number; pants?: number; shoes?: number; skirt?: number;
  female?: boolean; longHair?: boolean;
}
export interface BlockyOpts extends BlockyLook {
  faceTex?: THREE.Texture | null;
  /** Held weapon model (any WeaponKind). `null`/omitted = bare hands. */
  weapon?: WeaponKind | null;
  /** @deprecated alias for `weapon: 'sword'` (kept for old callers). */
  withSword?: boolean;
  tintShirt?: number; zombie?: boolean;
  /** Keep this rig OUT of the camera see-through (the hero: the lens's own subject must
   *  never dither itself away). Everyone else is cut, so a body in the way stops blocking. */
  noCut?: boolean;
}
export interface Blocky {
  rig: THREE.Group;
  limbs: { legL: THREE.Group; legR: THREE.Group; armL: THREE.Group; armR: THREE.Group };
  mats: THREE.MeshStandardMaterial[];   // for the red hit-flash (emissive)
  refHeight?: number;                   // natural model height (for enemy scaling); humans ~5.4
}
export type CreatureKind = 'raider' | 'zombie' | 'skeleton' | 'dog' | 'mummy' | 'drone' | 'slime' | 'bat' | 'spider' | 'ghost' | 'wolf' | 'robot' | 'wyrm' | 'golem';

// Fixed-dimension geometries shared across ALL rigs (like blockyKit's aoBox cache) —
// never disposed; disposeRig assumes body geometry is cache-owned.
const SKIRT_GEO = new THREE.CylinderGeometry(0.64, 1.2, 1.5, 8);
const SELFIE_HEAD_GEO = new THREE.BoxGeometry(1.4, 1.4, 1.4);
const ROTOR_DISC_GEO = new THREE.CylinderGeometry(0.55, 0.55, 0.06, 12);

// DEATH-DISSOLVE — every character material carries a dormant noise-dissolve (uDis 0 = free):
// a corpse animates uDis 0→1 and the body crumbles bottom-up with a glowing tinted edge,
// the same visual language as the world-reveal. One shader variant, compiled on first spawn.
export function armDissolve(m: THREE.MeshStandardMaterial): void {
  const dis = { value: 0 }, tint = { value: new THREE.Color(0xff6a3c) }, base = { value: 0 }, hgt = { value: 5.4 };
  m.userData._dis = dis; m.userData._disTint = tint; m.userData._disBase = base; m.userData._disH = hgt;
  // PROGRAM CACHE KEY. three keys a built-in material's program on customProgramCacheKey(),
  // whose default is onBeforeCompile.toString() — and this closure stringifies identically for
  // every rig. That was harmless while nothing else injected; the moment the camera cutout wraps
  // one of these (withCutout keeps the previous key, and an un-cut twin keeps this one) two
  // materials with DIFFERENT GLSL would otherwise share one compiled program and the dissolve
  // would silently stop discarding. Name the injection instead of hashing the closure text.
  const prevKey = m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
  m.customProgramCacheKey = () => 'dissolve:' + (prevKey ? prevKey() : '');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDis = dis; sh.uniforms.uDisTint = tint; sh.uniforms.uDisBase = base; sh.uniforms.uDisH = hgt;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDisW;')
      .replace('#include <project_vertex>', `vec4 _dw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          _dw = instanceMatrix * _dw;
        #endif
        vDisW = (modelMatrix * _dw).xyz;
        #include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDisW;
        uniform float uDis; uniform vec3 uDisTint; uniform float uDisBase; uniform float uDisH;
        float _dhash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
        float _dnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          float a=_dhash(i), b=_dhash(i+vec2(1.,0.)), c=_dhash(i+vec2(0.,1.)), d=_dhash(i+vec2(1.,1.));
          return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }`)
      .replace('#include <dithering_fragment>', `
        if (uDis > 0.001) {   // bottom-up noisy crumble with a hot tinted rim
          float hn = clamp((vDisW.y - uDisBase) / max(0.001, uDisH), 0.0, 1.0);
          float n = _dnoise(vDisW.xz * 1.7 + vDisW.y * 0.9);
          float edge = (hn * 0.55 + n * 0.6) - uDis * 1.35;
          if (edge < 0.0) discard;
          if (edge < 0.14) gl_FragColor.rgb += uDisTint * 2.6 * (1.0 - edge / 0.14);
        }
        #include <dithering_fragment>`);
  };
}

// shared box-character helpers (one emissive-tracked material list)
function rig0(cut = true) {
  const mats: THREE.MeshStandardMaterial[] = [];
  const mk = (color: number, rough = 0.85, metal = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: 0xff2614, emissiveIntensity: 0, vertexColors: true }); armDissolve(m); if (cut) withCutout(m); mats.push(m); return m; };
  const B = (mat: any, w: number, h: number, d: number, y: number, z = 0, x = 0) => { const m = new THREE.Mesh(aoBox(w, h, d), mat); m.position.set(x, y, z); return m; };
  return { mats, mk, B, rig: new THREE.Group() };
}

// hash a string (character id / enemy kind) → a stable 32-bit seed
export function lookSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < (s || '').length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}
/** A STABLE look derived purely from a seed — same seed → same look on every replay, and
 *  NEVER a random gender. Used for characters/foes the kid didn't dress, so they stop flickering
 *  random. The kid's own gender()/hair()/etc. override these field-by-field at the call site. */
export function seededLook(seed: number): BlockyLook {
  let s = (seed >>> 0) || 1;
  const nxt = () => { s = (s * 1664525 + 1013904223) >>> 0; return s; };
  const pk = <T,>(a: T[]): T => a[nxt() % a.length];
  return { skin: pk(LOOK_SKINS), hair: pk(LOOK_HAIRS), shirt: pk(LOOK_SHIRTS), pants: pk(LOOK_PANTS), shoes: pk(LOOK_SHOES) };
}

/** A fully random, configurable look (male or female). */
export function randomLook(): BlockyLook {
  const female = Math.random() < 0.45;
  return {
    skin: rpick(LOOK_SKINS), hair: rpick(LOOK_HAIRS), shirt: rpick(LOOK_SHIRTS),
    pants: rpick(LOOK_PANTS), shoes: rpick(LOOK_SHOES),
    female,
    longHair: female ? Math.random() < 0.8 : Math.random() < 0.22,
    skirt: female && Math.random() < 0.75 ? rpick(LOOK_SKIRTS) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Held WEAPON models — one box-built model per WeaponKind with a distinct
// silhouette. Origin = the grip (sits in the right fist); the business end
// points FORWARD (-Z), matching the character's facing. All parts are aoBox +
// vertexColors materials so they share the rig's toon look, and the rig-level
// addOutline() picks them up (parts that should outline keep min dims >= 0.09).
// Materials that should join the red hit-flash are exposed on
// `group.userData.mats`; EMISSIVE glow parts (blaster cell, sword gems) stay
// OUT of that list so a hit-flash never zeroes their glow.
// ---------------------------------------------------------------------------
export function buildWeaponModel(kind: WeaponKind): THREE.Group {
  const g = new THREE.Group();
  const mats: THREE.MeshStandardMaterial[] = [];
  const M = (color: number, rough = 0.6, metal = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, vertexColors: true, emissive: 0xff2614, emissiveIntensity: 0 });
    armDissolve(m); mats.push(m); return m;
  };
  const B = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(aoBox(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m;
  };
  const steel = () => M(0xdfe8f4, 0.22, 0.9);
  const gunmetal = () => M(0x3a3f48, 0.45, 0.7);
  const wood = () => M(0x6a4626, 0.8);
  const grip = () => M(0x2a1710, 0.85);
  const gold = () => M(0xe8c24c, 0.28, 0.85);

  switch (kind) {
    case 'sword': {
      // the classic hero sword (gems glow -> NOT in mats; edge never flashed)
      const gem = new THREE.MeshStandardMaterial({ color: 0x53d8ff, emissive: 0x2c9fd0, emissiveIntensity: 1.3, metalness: 0.2, roughness: 0.3 });
      const edge = new THREE.MeshStandardMaterial({ color: 0xeef6ff, roughness: 0.25, metalness: 0.6, vertexColors: true });
      const st = steel(), gd = gold(), gr = grip();
      B(gr, 0.17, 0.62, 0.17, 0, 0.24, 0.18);   // grip
      B(gd, 0.23, 0.2, 0.23, 0, 0.5, 0.2);      // pommel
      B(gem, 0.11, 0.11, 0.12, 0, 0.5, 0.32);   // pommel gem
      B(gd, 0.86, 0.2, 0.26, 0, 0, -0.04);      // crossguard
      B(gem, 0.17, 0.17, 0.16, 0, 0, -0.2);     // guard gem
      B(st, 0.24, 0.1, 1.5, 0, 0, -1.05);       // blade base
      B(st, 0.15, 0.09, 1.4, 0, 0, -2.4);       // blade taper
      B(edge, 0.06, 0.13, 3.05, 0, 0, -1.7);    // bright edge strip
      B(st, 0.11, 0.085, 0.4, 0, 0, -3.2);      // tip
      break;
    }
    case 'dagger': {
      const st = steel(), gd = gold(), gr = grip();
      B(gr, 0.15, 0.55, 0.15, 0, 0.26, 0.16);   // grip
      B(gd, 0.19, 0.14, 0.19, 0, 0.58, 0.18);   // pommel
      B(gd, 0.5, 0.14, 0.2, 0, 0, -0.04);       // small guard
      B(st, 0.16, 0.1, 1.1, 0, 0, -0.6);        // short blade
      B(st, 0.1, 0.09, 0.34, 0, 0, -1.26);      // tip
      break;
    }
    case 'hammer': {
      const st = steel(), gd = gold(), wd = wood();
      B(wd, 0.16, 0.16, 2.2, 0, 0, -0.85);      // long handle
      B(st, 0.9, 0.5, 0.6, 0, 0.04, -1.92);     // crushing head
      B(gd, 0.22, 0.22, 0.3, 0, 0, -1.5);       // band
      B(gd, 0.2, 0.2, 0.18, 0, 0, 0.28);        // butt cap
      break;
    }
    case 'pistol': {
      const gm = gunmetal(), st = steel(), gr = grip();
      B(gr, 0.3, 0.75, 0.42, 0, -0.12, 0.1);    // grip in the fist
      B(gm, 0.36, 0.42, 1.5, 0, 0.42, -0.4);    // slide
      B(st, 0.18, 0.18, 0.5, 0, 0.4, -1.35);    // stubby barrel
      B(gm, 0.1, 0.14, 0.12, 0, 0.68, -1.0);    // front sight
      break;
    }
    case 'smg': {
      const gm = gunmetal(), st = steel(), gr = grip();
      B(gm, 0.4, 0.52, 2.0, 0, 0.42, -0.6);     // boxy body
      B(gr, 0.28, 0.7, 0.4, 0, -0.1, 0.1);      // grip
      B(gm, 0.26, 0.8, 0.4, 0, -0.12, -0.85);   // mag box
      B(gm, 0.3, 0.34, 0.7, 0, 0.42, 0.72);     // stock stub
      B(st, 0.16, 0.16, 0.6, 0, 0.5, -1.85);    // barrel
      break;
    }
    case 'shotgun': {
      const gm = gunmetal(), st = steel(), wd = wood();
      B(wd, 0.36, 0.46, 1.0, 0, 0.3, 0.75);     // wood stock
      B(gm, 0.42, 0.5, 0.85, 0, 0.42, 0);       // receiver
      B(st, 0.18, 0.18, 2.3, -0.11, 0.5, -1.45);// left barrel
      B(st, 0.18, 0.18, 2.3, 0.11, 0.5, -1.45); // right barrel
      B(wd, 0.34, 0.28, 0.65, 0, 0.22, -1.1);   // pump
      break;
    }
    case 'crossbow': {
      const st = steel(), wd = wood(), gr = grip(), gm = gunmetal();
      B(wd, 0.26, 0.3, 2.1, 0, 0.32, -0.45);    // stock rail
      B(gr, 0.24, 0.6, 0.3, 0, -0.05, 0.15);    // grip
      B(st, 2.3, 0.14, 0.2, 0, 0.32, -1.42);    // perpendicular bow arms
      B(gm, 2.15, 0.06, 0.05, 0, 0.42, -1.05);  // string (thin -> no outline)
      B(wd, 0.09, 0.09, 1.5, 0, 0.46, -0.85);   // loaded bolt
      B(st, 0.14, 0.14, 0.2, 0, 0.46, -1.62);   // bolt head
      break;
    }
    case 'blaster': {
      const gm = gunmetal(), st = steel(), gr = grip();
      // glowing power cell — NOT in mats, so the hit-flash never kills its glow
      const cell = new THREE.MeshStandardMaterial({ color: 0x7af6ff, emissive: 0x2cd8f0, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.2 });
      B(gm, 0.46, 0.56, 1.5, 0, 0.4, -0.35);    // chunky body
      B(gr, 0.28, 0.72, 0.42, 0, -0.12, 0.18);  // grip
      const c = B(cell, 0.26, 0.26, 0.5, 0, 0.82, -0.3); c.userData.noOutline = true;
      B(st, 0.26, 0.26, 0.8, 0, 0.42, -1.5);    // vented barrel
      B(gm, 0.5, 0.08, 0.5, 0, 0.74, -1.0);     // top vent fin (flat -> no outline)
      B(gm, 0.34, 0.34, 0.18, 0, 0.42, -1.95);  // muzzle ring
      break;
    }
  }
  g.userData.mats = mats;   // hit-flash joinable materials (caller folds into the rig's list)
  return g;
}

/** Build a blocky character (~5.4 units tall, origin at the feet). */
export function buildBlocky(opts: BlockyOpts): Blocky {
  const skin = opts.skin ?? 0xe0a878, hairCol = opts.hair ?? 0x4a3018;   // default hero lands in the candy brand, not charcoal mud
  const shirt = opts.tintShirt ?? opts.shirt ?? 0xe8b02a, pants = opts.pants ?? 0x3b6fd4, shoes = opts.shoes ?? 0x222226;
  const female = !!opts.female, skirtCol = opts.skirt;
  const { mats, mk, B, rig } = rig0(!opts.noCut);

  // legGap is purely proportional; outline shells are merged now (no z-fighting)
  const legW = female ? 0.44 : 0.52, legGap = female ? 0.34 : 0.4;
  const legCol = (female && skirtCol != null) ? skin : pants;
  const mkLeg = (sign: number) => { const g = new THREE.Group(); g.position.set(sign * legGap, 2.0, 0); g.add(B(mk(legCol), legW, 2.0, 0.6, -1.0), B(mk(shoes), legW + 0.06, 0.42, 0.9, -1.86, -0.1)); return g; };
  const legL = mkLeg(-1), legR = mkLeg(1);
  legL.userData.limb = 'legL'; legR.userData.limb = 'legR';   // tags survive clone(true) so a dash ghost can pose its limb pivots

  const torsoW = female ? 1.18 : 1.4, torsoD = female ? 0.62 : 0.7;
  const parts: THREE.Object3D[] = [legL, legR, B(mk(shirt), torsoW, 2.0, torsoD, 3.0)];
  if (female) {
    parts.push(B(mk(shirt), 0.96, 0.5, 0.3, 3.6, -0.42));
    if (skirtCol != null) { const skM = new THREE.MeshStandardMaterial({ color: skirtCol, roughness: 0.8, emissive: 0xff2614, emissiveIntensity: 0 }); armDissolve(skM); if (!opts.noCut) withCutout(skM); mats.push(skM); const sk = new THREE.Mesh(SKIRT_GEO, skM); sk.position.y = 1.65; parts.push(sk); }
  }

  parts.push(B(mk(skin), 0.5, 0.5, 0.5, 4.08));   // neck
  let head: THREE.Mesh;
  if (opts.faceTex) {
    // selfie head: PLAIN box (no vertex-AO tint) and non-vertexColors materials
    // so nothing darkens or brightens the player's photo. Both still join the
    // red hit-flash via `mats`.
    const skinF = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.85, emissive: 0xff2614, emissiveIntensity: 0 }); mats.push(skinF);
    const faceM = new THREE.MeshStandardMaterial({ map: opts.faceTex, roughness: 0.8, emissive: 0xff2614, emissiveIntensity: 0 }); mats.push(faceM);
    head = new THREE.Mesh(SELFIE_HEAD_GEO, [skinF, skinF, skinF, skinF, skinF, faceM]); // selfie on -Z (front)
  } else head = new THREE.Mesh(aoBox(1.4, 1.4, 1.4), mk(skin));
  head.position.y = 4.7; parts.push(head);

  // hair: cap + back panel + FRONT fringe (front is -Z; without the fringe
  // everyone looked balding from the front). Selfie heads skip the fringe —
  // it would cover the top of the photo.
  parts.push(B(mk(hairCol), 1.54, 0.5, 1.54, 5.32), B(mk(hairCol), 1.5, 0.62, 0.32, 4.78, 0.72));
  if (!opts.faceTex) parts.push(B(mk(hairCol), 1.44, 0.3, 0.22, 5.02, -0.67));
  if (opts.longHair) parts.push(B(mk(hairCol), 1.42, 1.7, 0.32, 3.95, 0.66));

  if (!opts.faceTex) {
    const eyeMat = mk(0x16110c);   // tracked in `mats` so the eyes flash red with the body
    const FZ = -0.71;
    const eL = new THREE.Mesh(aoBox(0.2, 0.2, 0.05), eyeMat); eL.position.set(-0.28, 4.78, FZ);
    const eR = new THREE.Mesh(aoBox(0.2, 0.2, 0.05), eyeMat); eR.position.set(0.28, 4.78, FZ);
    const bL = new THREE.Mesh(aoBox(0.26, 0.07, 0.05), mk(hairCol)); bL.position.set(-0.28, 4.95, FZ);
    const bR = new THREE.Mesh(aoBox(0.26, 0.07, 0.05), mk(hairCol)); bR.position.set(0.28, 4.95, FZ);
    const mouth = new THREE.Mesh(aoBox(0.34, 0.07, 0.05), eyeMat); mouth.position.set(0, 4.34, FZ);
    parts.push(eL, eR, bL, bR, mouth);
  }

  const armX = torsoW / 2 + 0.23, sleeveW = female ? 0.44 : 0.5;
  const mkArm = (sign: number) => { const g = new THREE.Group(); g.position.set(sign * armX, 4.0, 0); g.add(B(mk(shirt), sleeveW, 1.6, 0.58, -0.8), B(mk(skin), sleeveW + 0.02, 0.5, 0.6, -1.82)); return g; };
  const armL = mkArm(-1), armR = mkArm(1);
  armL.userData.limb = 'armL'; armR.userData.limb = 'armR';   // (see leg tags) — let a dash ghost pose its arm pivots
  parts.push(armL, armR);

  if (opts.zombie) {
    // shamble pose: arms held out in front. The per-frame swing animation
    // drives the OUTER pivot's rotation, so the bias lives on an INNER group.
    for (const arm of [armL, armR]) {
      const inner = new THREE.Group();
      inner.rotation.x = -1.15;
      while (arm.children.length) inner.add(arm.children[0]);
      arm.add(inner);
    }
    // sunken sockets + hanging-open jaw replace the neutral face read
    // (skipped over a selfie — the photo must stay unobstructed)
    if (!opts.faceTex) {
      const sock = mk(0x101408);
      const sL = new THREE.Mesh(aoBox(0.3, 0.3, 0.05), sock); sL.position.set(-0.28, 4.78, -0.715);
      const sR = new THREE.Mesh(aoBox(0.3, 0.3, 0.05), sock); sR.position.set(0.28, 4.78, -0.715);
      const jaw = new THREE.Mesh(aoBox(0.6, 0.32, 0.3), mk(skin)); jaw.position.set(0, 4.18, -0.5);
      parts.push(sL, sR, jaw);
    }
    // ragged hem: two pants-colored notches eat into the shirt's bottom edge
    const hL = new THREE.Mesh(aoBox(0.34, 0.3, torsoD + 0.04), mk(pants)); hL.position.set(-0.36, 2.1, 0);
    const hR = new THREE.Mesh(aoBox(0.22, 0.36, torsoD + 0.04), mk(pants)); hR.position.set(0.42, 2.08, 0);
    parts.push(hL, hR);
  }

  // held weapon: any WeaponKind (withSword stays as a deprecated alias -> 'sword')
  const weaponKind: WeaponKind | null = opts.weapon !== undefined ? opts.weapon : (opts.withSword ? 'sword' : null);
  if (weaponKind) {
    const wpn = buildWeaponModel(weaponKind);
    wpn.position.set(0, -1.74, 0);   // grip into the right fist
    armR.add(wpn);
    mats.push(...(wpn.userData.mats as THREE.MeshStandardMaterial[]));   // join the red hit-flash
  }
  rig.add(...parts);
  rig.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 1.1);
  return { rig, limbs: { legL, legR, armL, armR }, mats };
}

const ZOMBIE_SKINS = [0x6f8f54, 0x7a9a5e, 0x86a06a, 0x5f7a4a, 0x709a66];
/** A ZOMBIE — a green, ragged human (animates + supports a selfie face for roasts). */
export function buildZombie(opts: BlockyOpts): Blocky {
  const b = buildBlocky({
    skin: rpick(ZOMBIE_SKINS), hair: rpick([0x2a2a1e, 0x1a1a14, 0x3a3326]),
    shirt: rpick([0x3a4030, 0x2e3326, 0x40382a, 0x33322a]), pants: rpick([0x2a2620, 0x222018, 0x30281e]),
    shoes: 0x1a1812, female: opts.female, longHair: opts.longHair, faceTex: opts.faceTex,
    zombie: true,
  });
  b.refHeight = 5.4;
  return b;
}

/** A SKELETON — bone-white, thin limbs, ribcage + skull with eye sockets. */
export function buildSkeleton(opts: BlockyOpts, mummy = false): Blocky {
  const { mats, mk, B, rig } = rig0();
  const bone = () => mk(0xe9e4d2, 0.7), foot = () => mk(0xdcd6c2, 0.7), dark = 0x14110c;
  const mkLeg = (s: number) => { const g = new THREE.Group(); g.position.set(s * 0.32, 2.0, 0); g.add(B(bone(), 0.32, 2.0, 0.32, -1.0), B(foot(), 0.42, 0.34, 0.66, -1.9, -0.12)); return g; };
  const legL = mkLeg(-1), legR = mkLeg(1);
  const parts: THREE.Object3D[] = [legL, legR, B(bone(), 0.95, 0.42, 0.5, 2.2), B(bone(), 0.22, 1.5, 0.22, 3.1)];
  for (let i = 0; i < 4; i++) parts.push(B(bone(), 1.0 - i * 0.06, 0.13, 0.5, 2.7 + i * 0.32, -0.06));   // ribs
  parts.push(B(bone(), 0.95, 1.3, 0.12, 3.1, 0.2));                                                        // closes the hollow back
  parts.push(B(bone(), 1.25, 0.26, 0.42, 4.0), B(bone(), 0.26, 0.4, 0.26, 4.25));                          // shoulders + neck
  parts.push(B(mk(0xece7d6, 0.6), 1.12, 1.05, 1.0, 4.95));                                                 // skull
  const eye = mk(dark);   // tracked so sockets/eyes join the red hit-flash
  const mkBox = (w: number, h: number, d: number, x: number, y: number, z: number) => { const m = new THREE.Mesh(aoBox(w, h, d), eye); m.position.set(x, y, z); return m; };
  parts.push(mkBox(0.26, 0.26, 0.08, -0.26, 5.0, -0.5), mkBox(0.26, 0.26, 0.08, 0.26, 5.0, -0.5), mkBox(0.14, 0.2, 0.08, 0, 4.72, -0.5));  // sockets + nose
  parts.push(B(foot(), 0.9, 0.2, 0.7, 4.42));                                                              // jaw
  // teeth
  for (let i = 0; i < 4; i++) parts.push(B(mk(0xf4efe0, 0.6), 0.12, 0.14, 0.08, 4.5, -0.49, -0.27 + i * 0.18));
  const mkArm = (s: number) => { const g = new THREE.Group(); g.position.set(s * 0.62, 4.0, 0); g.add(B(bone(), 0.3, 1.7, 0.3, -0.85), B(foot(), 0.34, 0.42, 0.34, -1.78)); return g; };
  const armL = mkArm(-1), armR = mkArm(1);
  parts.push(armL, armR);
  if (mummy) {
    const wrap = mk(0xd8d0b4, 0.95);
    for (const [y, rz] of [[2.5, 0.18], [2.95, -0.22], [3.4, 0.15], [3.8, -0.12]] as const) {
      const b = B(wrap, 1.15, 0.3, 0.62, y); b.rotation.z = rz; parts.push(b);
    }
    const headWrap = B(wrap, 1.22, 0.32, 1.1, 5.1); headWrap.rotation.z = 0.14; parts.push(headWrap);
    const loose = B(wrap, 0.2, 1.3, 0.07, -1.2, 0.1); armL.add(loose); // trailing strip off the left arm
  }
  rig.add(...parts);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 1.1);
  return { rig, limbs: { legL, legR, armL, armR }, mats, refHeight: 5.6 };
}

const DOG_FUR = [0x6a4a2a, 0x3a2c1e, 0x8a6a3a, 0x55514a, 0x2a2420, 0xa88a5a, 0xc8b48a];
/** A DOG — a blocky quadruped (front legs map to arm-slots so the trot animation works). */
export function buildDog(_opts: BlockyOpts): Blocky {
  const { mats, mk, B, rig } = rig0();
  const fur = rpick(DOG_FUR), dark = 0x14110c, M = () => mk(fur, 0.9);
  const lite = mk(0xd8c4a0, 0.9);             // muzzle / chest contrast
  const parts: THREE.Object3D[] = [
    B(M(), 0.95, 0.95, 2.0, 1.7),                          // body
    B(M(), 0.95, 0.9, 0.85, 2.0, -1.35),                   // head
    B(lite, 0.55, 0.5, 0.6, 1.78, -1.85),                  // snout (lite instead of M())
    B(mk(dark), 0.26, 0.22, 0.16, 1.9, -2.18),             // nose
    B(M(), 0.3, 0.46, 0.18, 2.55, -1.15, -0.32), B(M(), 0.3, 0.46, 0.18, 2.55, -1.15, 0.32),  // ears
    B(lite, 0.7, 0.5, 0.3, 1.5, -0.95),                    // chest patch
    B(mk(dark), 0.3, 0.14, 0.18, 2.8, -1.15, -0.32), B(mk(dark), 0.3, 0.14, 0.18, 2.8, -1.15, 0.32), // ear tips
  ];
  const eye = mk(dark);   // tracked so sockets/eyes join the red hit-flash
  const eL = new THREE.Mesh(aoBox(0.16, 0.16, 0.06), eye); eL.position.set(-0.26, 2.12, -1.78);
  const eR = new THREE.Mesh(aoBox(0.16, 0.16, 0.06), eye); eR.position.set(0.26, 2.12, -1.78);
  const tail = new THREE.Group(); tail.position.set(0, 2.15, 1.0); tail.rotation.x = -0.8; tail.add(B(M(), 0.26, 0.26, 0.85, 0, 0.42));
  parts.push(eL, eR, tail);
  const mkLeg = (x: number, z: number) => { const g = new THREE.Group(); g.position.set(x, 1.45, z); g.add(B(M(), 0.34, 1.5, 0.42, -0.75), B(mk(dark), 0.38, 0.22, 0.5, -1.46, -0.06)); return g; };
  const armL = mkLeg(-0.34, -0.75), armR = mkLeg(0.34, -0.75);   // FRONT legs (arm slots)
  const legL = mkLeg(-0.34, 0.75), legR = mkLeg(0.34, 0.75);     // BACK legs
  parts.push(armL, armR, legL, legR);
  rig.add(...parts);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 0.9);
  rig.userData.tail = tail;
  return { rig, limbs: { legL, legR, armL, armR }, mats, refHeight: 2.9 };
}

/** A DRONE — a hovering quad-rotor scout. Empty limb groups satisfy the rig
 *  contract (the swing animation no-ops); bobbing comes from the engine. */
export function buildDrone(_opts: BlockyOpts): Blocky {
  const { mats, mk, B, rig } = rig0();
  const shell = mk(0x4a505a, 0.55, 0.35), dark = mk(0x23262c, 0.7, 0.2);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xff4530, emissive: 0xff2614, emissiveIntensity: 1.5, roughness: 0.4, vertexColors: true });
  const parts: THREE.Object3D[] = [
    B(shell, 1.5, 0.55, 1.5, 3.4),          // hull
    B(dark, 0.9, 0.4, 0.9, 3.05),           // belly pod
    B(dark, 1.1, 0.18, 1.1, 3.74),          // top plate
  ];
  const eye = new THREE.Mesh(aoBox(0.56, 0.22, 0.1), eyeM); eye.position.set(0, 3.42, -0.78);
  parts.push(eye);
  const discMat = new THREE.MeshStandardMaterial({ color: 0x14161a, transparent: true, opacity: 0.5, roughness: 0.8 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const armG = new THREE.Group(); armG.position.y = 3.55; armG.rotation.y = Math.atan2(sz, sx);
    const ab = new THREE.Mesh(aoBox(1.0, 0.12, 0.16), dark); ab.position.x = 0.85; armG.add(ab);
    const disc = new THREE.Mesh(ROTOR_DISC_GEO, discMat); disc.position.set(1.35, 0.12, 0);
    disc.userData.noOutline = true; armG.add(disc);
    rig.add(armG);
  }
  rig.add(...parts);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 0.8);
  const empty = () => new THREE.Group();
  return { rig, limbs: { legL: empty(), legR: empty(), armL: empty(), armR: empty() }, mats, refHeight: 4.2 };
}

const SLIME_TINTS = [0x4bd06a, 0x4aa8ea, 0xd05aa8, 0xe0b83a, 0x8a5ae0, 0xea6a4a, 0x3ad0c0];
/** A SLIME — a bouncy translucent blob. The legless body IS the limb rig: legL/legR
 *  are a shared squash/bob pivot the swing anim reads as a wobble; armL/armR are two
 *  tiny side nubs so a hit-flash + wobble has something to grab. */
export function buildSlime(_opts: BlockyOpts): Blocky {
  const { mats, mk, B, rig } = rig0();
  const tint = _opts.tintShirt ?? rpick(SLIME_TINTS);
  const jelly = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.8, emissive: 0xff2614, emissiveIntensity: 0 });
  armDissolve(jelly); withCutout(jelly); mats.push(jelly);
  const dark = 0x141018;
  // ROUNDED BLOB: a wide squat base that tapers up through a few tiers to a small cap — the 3px
  // hull outline rounds the steps into a dome. Wobbles as ONE group (legL/legR both point at it).
  const body = new THREE.Group(); body.position.y = 0;
  // tiers get a little X/Z jitter -> an ORGANIC lean, not a perfect wedding cake
  body.add(
    B(jelly, 2.7, 0.8, 2.5, 0.5),                 // wide squat base
    B(jelly, 2.3, 0.65, 2.1, 1.15, 0.08, -0.07),  // mid (leans a touch)
    B(jelly, 1.6, 0.6, 1.5, 1.7, -0.1, 0.09),     // upper (counter-leans)
    B(jelly, 0.9, 0.5, 0.9, 2.15, 0.05, -0.05),   // small cap
  );
  // DRIPS — little satellite blobs oozing off the base rim (goo reads as goo)
  body.add(
    B(jelly, 0.4, 0.5, 0.4, 0.28, -1.1, 0.95),
    B(jelly, 0.34, 0.42, 0.34, 0.24, 0.55, -1.15),
    B(jelly, 0.3, 0.36, 0.3, 0.2, 1.05, 0.75),
  );
  // GLOSS — two wet highlight chips high on the dome (own material: never red-flashes)
  const sheenM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, transparent: true, opacity: 0.5 });
  const sh1 = B(sheenM, 0.42, 0.2, 0.1, 1.95, -0.72, -0.5); sh1.rotation.z = -0.2; sh1.userData.noOutline = true;
  const sh2 = B(sheenM, 0.2, 0.12, 0.1, 2.2, -0.6, -0.28); sh2.userData.noOutline = true;
  body.add(sh1, sh2);
  // a tiny escaping BUBBLE above the cap — pure cute
  const bub = B(jelly, 0.22, 0.22, 0.22, 2.62, -0.1, 0.25); bub.userData.noOutline = true; body.add(bub);
  const inner = B(mk(tint, 0.6), 1.2, 1.0, 1.2, 0.8); inner.userData.noOutline = true; body.add(inner);   // glossy inner core, reads through the jelly
  rig.add(body);
  // BIG cute eyes (white + pupil) + a wide grin on the mid-front (-Z), where the body is widest
  const eyeD = mk(dark), white = mk(0xffffff, 0.25);
  const mkEye = (x: number) => {
    const w = new THREE.Mesh(aoBox(0.46, 0.56, 0.06), white); w.position.set(x, 1.35, -1.08);   // sit JUST in front of the mid-tier face (~ -1.05)
    const p = new THREE.Mesh(aoBox(0.22, 0.3, 0.06), eyeD); p.position.set(x + 0.05, 1.3, -1.12);
    const gl = new THREE.Mesh(aoBox(0.09, 0.11, 0.06), white); gl.position.set(x - 0.1, 1.46, -1.14);
    gl.userData.noOutline = true; return [w, p, gl];
  };
  const grin = new THREE.Mesh(aoBox(0.9, 0.13, 0.06), eyeD); grin.position.set(0, 0.9, -1.1);
  // cheeky BROWS — thin slants over the eyes give the blob attitude
  const brL = new THREE.Mesh(aoBox(0.44, 0.1, 0.06), eyeD); brL.position.set(-0.52, 1.75, -1.05); brL.rotation.z = -0.28;
  const brR = new THREE.Mesh(aoBox(0.44, 0.1, 0.06), eyeD); brR.position.set(0.52, 1.75, -1.05); brR.rotation.z = 0.28;
  body.add(...mkEye(-0.5), ...mkEye(0.5), grin, brL, brR);   // the face rides the BODY group so it wobbles WITH the blob
  // side nubs = the arm slots (keep the rig contract: swing + hit-flash have something to grab)
  const mkNub = (s: number) => { const g = new THREE.Group(); g.position.set(s * 1.2, 0.6, 0); g.add(B(jelly, 0.6, 0.55, 0.7, 0)); return g; };
  const armL = mkNub(-1), armR = mkNub(1);
  rig.add(armL, armR);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 1.35);
  return { rig, limbs: { legL: body, legR: body, armL, armR }, mats, refHeight: 2.5 };
}

/** A BAT — a small winged flyer. Empty leg groups (it hovers, like the drone); the
 *  WINGS map to armL/armR so the swing anim flaps them. */
export function buildBat(_opts: BlockyOpts): Blocky {
  const { mats, mk, B, rig } = rig0();
  const fur = mk(0x3a3350, 0.85), skin = mk(0x6a5a86, 0.8), dark = 0x14110c;
  const parts: THREE.Object3D[] = [
    B(fur, 1.2, 1.1, 1.0, 3.6),                 // round body
    B(fur, 0.9, 0.8, 0.8, 4.35),                // head
    B(fur, 0.34, 0.6, 0.2, 4.9, 0, -0.34), B(fur, 0.34, 0.6, 0.2, 4.9, 0, 0.34),   // pointed ears
  ];
  const eye = mk(0xffcf3a, 0.4);                // glowing amber eyes
  eye.emissive.setHex(0xff2614);                // (still red-flash tracked)
  const eL = new THREE.Mesh(aoBox(0.18, 0.2, 0.06), eye); eL.position.set(-0.22, 4.4, -0.42);
  const eR = new THREE.Mesh(aoBox(0.18, 0.2, 0.06), eye); eR.position.set(0.22, 4.4, -0.42);
  const fang = mk(0xf4efe0, 0.5);
  parts.push(eL, eR,
    B(fang, 0.1, 0.16, 0.06, 4.02, -0.44, -0.15), B(fang, 0.1, 0.16, 0.06, 4.02, -0.44, 0.15));  // two fangs
  // pink inner ears + a nose nub + tiny hanging feet — the cute half of spooky-cute
  parts.push(
    B(skin, 0.18, 0.34, 0.1, 4.86, -0.06, -0.34), B(skin, 0.18, 0.34, 0.1, 4.86, -0.06, 0.34),   // inner ears
    B(skin, 0.16, 0.12, 0.1, 4.3, -0.46),                                                        // nose nub
    B(fur, 0.16, 0.34, 0.16, 3.0, 0.1, -0.24), B(fur, 0.16, 0.34, 0.16, 3.0, 0.1, 0.24),         // hanging feet
  );
  // WINGS = the arm slots (the swing anim flaps them). Each SPREADS OUT to the side from the
  // shoulder: a membrane that reaches outward + a bone along the top edge + two finger struts.
  const mkWing = (s: number) => {
    const g = new THREE.Group(); g.position.set(s * 0.55, 3.9, 0); g.rotation.z = s * 0.12;   // tilt tip up a touch
    g.add(
      B(skin, 1.9, 1.1, 0.1, -0.1, 0, s * 1.05),        // membrane, reaching OUT (x)
      B(fur, 2.0, 0.16, 0.16, 0.45, 0, s * 1.0),        // leading bone along the top edge
      B(fur, 0.12, 0.75, 0.12, -0.5, 0, s * 0.6),       // inner finger strut
      B(fur, 0.12, 0.95, 0.12, -0.45, 0, s * 1.55),     // outer finger strut
      // SCALLOPED trailing edge — the stepped hem between the finger struts is
      // what makes a wing read BAT instead of "grey flag"
      B(skin, 0.62, 0.42, 0.1, -0.78, 0, s * 0.3),
      B(skin, 0.72, 0.52, 0.1, -0.82, 0, s * 1.08),
      B(skin, 0.5, 0.38, 0.1, -0.72, 0, s * 1.82),
    );
    return g;
  };
  const armL = mkWing(-1), armR = mkWing(1);
  parts.push(armL, armR);
  rig.add(...parts);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 0.8);
  const empty = () => new THREE.Group();
  return { rig, limbs: { legL: empty(), legR: empty(), armL, armR }, mats, refHeight: 4.6 };
}

const SPIDER_TINTS = [0x2a2230, 0x3a2a1e, 0x402038, 0x1e2a20];
/** A SPIDER — a round abdomen + head with 8 legs. The FRONT pair maps to arm slots and
 *  the BACK pair to leg slots (so the trot/swing anim scuttles them); the middle 4 are static. */
export function buildSpider(_opts: BlockyOpts): Blocky {
  const { mats, mk, B, rig } = rig0();
  const tint = _opts.tintShirt ?? rpick(SPIDER_TINTS), body = () => mk(tint, 0.85);
  const legM = () => mk(0x141018, 0.9);   // near-black legs — the classic spider read
  const parts: THREE.Object3D[] = [
    // low, ROUNDED body: a 2-tier bulbous abdomen (rear, +Z) + a smaller head (front, -Z)
    B(body(), 1.9, 1.0, 2.1, 1.1, 0.75),        // abdomen base
    B(body(), 1.4, 0.7, 1.6, 1.7, 0.75),        // abdomen dome
    B(body(), 1.2, 0.8, 1.1, 1.0, -0.95),       // head
  ];
  parts.push(B(mk(0xd04a4a, 0.55), 0.5, 0.06, 0.85, 2.12, 0.75));   // red hourglass on the abdomen top
  // eyes — a tidy 4-dot cluster (2 big above 2 small) on the head front (-Z), glowing red
  const eye = mk(0xff5a4a, 0.4); eye.emissive.setHex(0xff2614);
  for (const [ex, ey, s] of [[-0.24, 1.22, 0.18], [0.24, 1.22, 0.18], [-0.14, 0.98, 0.1], [0.14, 0.98, 0.1]] as const) {
    const e = new THREE.Mesh(aoBox(s, s, 0.06), eye); e.position.set(ex, ey, -1.5); parts.push(e);
  }
  // CLEAN leg: a horizontal upper reaching OUT (tilted up) + a vertical lower dropping to the floor.
  const mkLeg = (z: number, side: number) => {
    const g = new THREE.Group(); g.position.set(side * 0.75, 1.15, z);
    const upper = B(legM(), 1.2, 0.16, 0.18, 0.18, 0, side * 0.62); upper.rotation.z = side * -0.42;  // out + up
    const lower = B(legM(), 0.16, 1.3, 0.16, -0.55, 0, side * 1.15);                                  // straight down
    g.add(upper, lower); return g;
  };
  // front pair = arm slots, back pair = leg slots (both animated by the trot); 4 static middle legs.
  const armL = mkLeg(-0.95, -1), armR = mkLeg(-0.95, 1);
  const legL = mkLeg(0.95, -1), legR = mkLeg(0.95, 1);
  parts.push(armL, armR, legL, legR, mkLeg(-0.32, -1), mkLeg(-0.32, 1), mkLeg(0.32, -1), mkLeg(0.32, 1));
  rig.add(...parts);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 1.3);
  return { rig, limbs: { legL, legR, armL, armR }, mats, refHeight: 2.2 };
}

/** A GHOST — a floating hooded spirit with a wispy tail. Empty leg groups (it hovers);
 *  two small wisp nubs map to armL/armR so the swing anim drifts them. */
export function buildGhost(_opts: BlockyOpts): Blocky {
  const { mats, mk, B, rig } = rig0();
  // pale translucent sheet — a dedicated material so opacity reads (still red-flash tracked).
  const sheet = new THREE.MeshStandardMaterial({ color: 0xe6ecf4, roughness: 0.4, metalness: 0, transparent: true, opacity: 0.72, emissive: 0xff2614, emissiveIntensity: 0 });
  armDissolve(sheet); withCutout(sheet); mats.push(sheet);
  const dark = 0x141826;
  const parts: THREE.Object3D[] = [
    B(sheet, 1.7, 1.6, 1.5, 4.0),               // rounded head/hood
    B(sheet, 1.9, 0.9, 1.6, 3.1),               // shoulders
  ];
  // a ragged, tapering tail (three shrinking blocks) instead of legs — the classic ghost hem
  const tL = B(sheet, 1.7, 0.7, 1.4, 2.45); tL.userData.noOutline = false; parts.push(tL);
  // WAVY zig-zag hem — five staggered teeth at alternating heights all around the skirt
  // (two lonely wisps read "table legs"; a full ragged hem reads GHOST)
  parts.push(
    B(sheet, 0.5, 0.75, 0.5, 1.85, -0.45, -0.55),
    B(sheet, 0.45, 0.55, 0.45, 1.95, -0.5, 0.35),
    B(sheet, 0.5, 0.7, 0.5, 1.88, 0.45, 0.6),
    B(sheet, 0.42, 0.5, 0.42, 1.98, 0.5, -0.3),
    B(sheet, 0.4, 0.62, 0.4, 1.9, 0.05, 0.02),
  );
  // a soft INNER GLOW deep in the sheet — spectral, and it survives the hit-flash
  const glowM = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, emissive: 0x7ab8e6, emissiveIntensity: 0.55, transparent: true, opacity: 0.5 });
  const core = B(glowM, 0.8, 1.1, 0.8, 3.6); core.userData.noOutline = true; parts.push(core);
  // a little swept PEAK on the hood — the sheet got yanked upward as it floats
  parts.push(B(sheet, 0.5, 0.5, 0.5, 4.95, 0.15, 0.2));
  // big dark hollow eye sockets + a small O mouth
  const eye = mk(dark);
  const eL = new THREE.Mesh(aoBox(0.42, 0.5, 0.06), eye); eL.position.set(-0.42, 4.15, -0.76);
  const eR = new THREE.Mesh(aoBox(0.42, 0.5, 0.06), eye); eR.position.set(0.42, 4.15, -0.76);
  const mouth = new THREE.Mesh(aoBox(0.36, 0.4, 0.06), eye); mouth.position.set(0, 3.5, -0.76);
  // angled BROWS over the hollow sockets — haunted, not just surprised
  const gbL = new THREE.Mesh(aoBox(0.5, 0.12, 0.06), eye); gbL.position.set(-0.44, 4.52, -0.76); gbL.rotation.z = -0.3;
  const gbR = new THREE.Mesh(aoBox(0.5, 0.12, 0.06), eye); gbR.position.set(0.44, 4.52, -0.76); gbR.rotation.z = 0.3;
  parts.push(eL, eR, mouth, gbL, gbR);
  // two drifting arm-wisps = the arm slots
  const mkWisp = (s: number) => { const g = new THREE.Group(); g.position.set(s * 1.0, 3.4, 0); g.add(B(sheet, 0.55, 1.0, 0.55, -0.5)); return g; };
  const armL = mkWisp(-1), armR = mkWisp(1);
  parts.push(armL, armR);
  rig.add(...parts);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 1.0);
  const empty = () => new THREE.Group();
  return { rig, limbs: { legL: empty(), legR: empty(), armL, armR }, mats, refHeight: 5.0 };
}

/** Pick the right blocky builder for an enemy kind — gives the crowd real variety. */
const WOLF_FUR = [0x8a8f98, 0x3a3d44, 0xe8eaf0, 0x6b6455, 0x4c525c];
/** A WOLF — longer, lower and meaner than the dog: angular two-box snout, tall
 *  pointed ears, GLOWING amber eyes (own material, out of mats so the glow never
 *  zeroes), bushy two-box tail. Front legs ride the arm slots (trot). */
export function buildWolf(_opts: BlockyOpts): Blocky {
  const { mats, mk, B, rig } = rig0();
  const fur = _opts.tintShirt ?? rpick(WOLF_FUR), dark = 0x14110c, M = () => mk(fur, 0.9);
  const lite = mk(0xd8dde6, 0.9);                                 // pale chest/jaw contrast
  const parts: THREE.Object3D[] = [
    B(M(), 1.0, 0.9, 2.6, 1.85),                                  // long low body
    B(M(), 0.95, 0.85, 0.9, 2.2, -1.6),                           // angular head
    B(M(), 0.6, 0.5, 0.7, 2.05, -2.15),                           // upper snout
    B(lite, 0.55, 0.28, 0.6, 1.82, -2.1),                         // lower jaw
    B(mk(dark), 0.24, 0.2, 0.16, 2.12, -2.52),                    // nose
    B(M(), 0.26, 0.62, 0.16, 2.85, -1.4, -0.3), B(M(), 0.26, 0.62, 0.16, 2.85, -1.4, 0.3),   // TALL ears
    B(lite, 0.75, 0.55, 0.4, 1.6, -1.05),                         // chest ruff
  ];
  // glowing amber eyes — OWN material (kept out of mats: the hit-flash must not kill the glow)
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xffb02a, emissive: 0xff8a10, emissiveIntensity: 1.1, roughness: 0.4, vertexColors: true });
  const eL = new THREE.Mesh(aoBox(0.18, 0.14, 0.06), eyeM); eL.position.set(-0.27, 2.38, -2.06);
  const eR = new THREE.Mesh(aoBox(0.18, 0.14, 0.06), eyeM); eR.position.set(0.27, 2.38, -2.06);
  const tail = new THREE.Group(); tail.position.set(0, 2.3, 1.35); tail.rotation.x = -0.55;
  tail.add(B(M(), 0.3, 0.3, 0.8, 0, 0.4), B(lite, 0.24, 0.24, 0.45, 0.06, 0.95));   // bushy, pale tip
  parts.push(eL, eR, tail);
  const mkLeg = (x: number, z: number) => { const g = new THREE.Group(); g.position.set(x, 1.55, z); g.add(B(M(), 0.34, 1.6, 0.42, -0.8), B(mk(dark), 0.38, 0.22, 0.5, -1.58, -0.06)); return g; };
  const armL = mkLeg(-0.36, -0.95), armR = mkLeg(0.36, -0.95);    // FRONT legs (arm slots)
  const legL = mkLeg(-0.36, 0.95), legR = mkLeg(0.36, 0.95);      // back legs
  parts.push(armL, armR, legL, legR);
  rig.add(...parts);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 1.0);
  rig.userData.tail = tail;
  return { rig, limbs: { legL, legR, armL, armR }, mats, refHeight: 3.2 };
}

/** A ROBOT — boxy gunmetal humanoid: chest vents, antenna, one wide CYAN eye-visor
 *  (own emissive material), clamp fists at the standard weapon grip, piston legs.
 *  tintShirt = the chest accent panel. */
export function buildRobot(_opts: BlockyOpts): Blocky {
  const { mats, mk, B, rig } = rig0();
  const metal = mk(0x596270, 0.5, 0.35), dark = mk(0x2a2e36, 0.7, 0.2);
  const accent = mk(_opts.tintShirt ?? 0x3aa8d8, 0.5, 0.2);
  const parts: THREE.Object3D[] = [
    B(metal, 1.7, 1.9, 1.0, 3.35),                                 // torso block
    B(accent, 1.0, 0.7, 0.14, 3.5, -0.54),                         // chest accent panel
    B(dark, 0.8, 0.09, 0.16, 3.0, -0.55), B(dark, 0.8, 0.09, 0.16, 2.82, -0.55),   // vent slats
    B(metal, 1.05, 0.95, 0.95, 5.0),                               // head
    B(dark, 0.2, 0.5, 0.2, 5.85, 0, 0.28),                         // antenna mast
    B(metal, 1.3, 0.35, 1.05, 2.25),                               // hip block
  ];
  // wide cyan visor — OWN glow material, out of mats + no outline (a lit eye, not a slab)
  const visM = new THREE.MeshStandardMaterial({ color: 0x63e8ff, emissive: 0x18b8e6, emissiveIntensity: 1.2, roughness: 0.3, vertexColors: true });
  const vis = new THREE.Mesh(aoBox(0.8, 0.24, 0.1), visM); vis.position.set(0, 5.08, -0.5); vis.userData.noOutline = true;
  const tipM = new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0xd93a2a, emissiveIntensity: 1.0, roughness: 0.4, vertexColors: true });
  const tip = new THREE.Mesh(aoBox(0.16, 0.16, 0.16), tipM); tip.position.set(0, 6.15, 0.28); tip.userData.noOutline = true;
  parts.push(vis, tip);
  const mkArm = (sgn: number) => {
    const g = new THREE.Group(); g.position.set(sgn * 1.08, 4.0, 0);
    g.add(B(metal, 0.44, 1.6, 0.5, -0.8), B(dark, 0.5, 0.28, 0.56, -1.62),
      B(dark, 0.16, 0.36, 0.3, -1.9, -0.12, -0.14), B(dark, 0.16, 0.36, 0.3, -1.9, -0.12, 0.14));   // clamp fingers
    return g;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const mkLeg = (sgn: number) => {
    const g = new THREE.Group(); g.position.set(sgn * 0.5, 2.1, 0);
    g.add(B(metal, 0.58, 1.0, 0.62, -0.5), B(dark, 0.34, 1.1, 0.4, -1.35), B(metal, 0.62, 0.26, 0.85, -2.0, -0.1));   // thigh, piston shin, foot slab
    return g;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  parts.push(armL, armR, legL, legR);
  rig.add(...parts);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 1.1);
  return { rig, limbs: { legL, legR, armL, armR }, mats, refHeight: 5.6 };
}

const WYRM_TINTS = [0x3f9e4a, 0xc23a3a, 0x7a4ae0, 0x2a8ea8, 0xd88a2a];
/** A WYRM — the "dragon" word finally lands: horned head on an arched neck, a
 *  shrinking body-segment chain (the chain group rides BOTH leg slots → the swing
 *  anim reads as a slither), stub wings on the arm slots (they flap). */
export function buildWyrm(_opts: BlockyOpts): Blocky {
  const { mats, mk, B, rig } = rig0();
  const scale = _opts.tintShirt ?? rpick(WYRM_TINTS);
  const M = () => mk(scale, 0.75), belly = mk(0xe8d8a0, 0.8), horn = mk(0xf2ead0, 0.55), dark = 0x141018;
  const parts: THREE.Object3D[] = [];
  // head + horns + snout, riding high at the front
  parts.push(
    B(M(), 1.15, 0.95, 1.2, 4.3, -1.5),                            // head
    B(M(), 0.65, 0.5, 0.85, 4.1, -2.35),                           // snout
    B(belly, 0.6, 0.24, 0.7, 3.86, -2.3),                          // jaw
    B(horn, 0.18, 0.7, 0.18, 5.0, -1.25, -0.34), B(horn, 0.18, 0.7, 0.18, 5.0, -1.25, 0.34),   // horns
    B(horn, 0.1, 0.2, 0.1, 3.98, -2.68, -0.18), B(horn, 0.1, 0.2, 0.1, 3.98, -2.68, 0.18),     // fangs
  );
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xffd24d, emissive: 0xff9a10, emissiveIntensity: 1.0, roughness: 0.4, vertexColors: true });
  const eL = new THREE.Mesh(aoBox(0.16, 0.18, 0.06), eyeM); eL.position.set(-0.34, 4.5, -2.02);
  const eR = new THREE.Mesh(aoBox(0.16, 0.18, 0.06), eyeM); eR.position.set(0.34, 4.5, -2.02);
  parts.push(eL, eR);
  // neck arch + BODY CHAIN (one group = both leg slots -> slither wobble)
  const chain = new THREE.Group();
  chain.add(
    B(M(), 0.9, 0.9, 1.0, 3.7, -0.8),                              // neck root
    B(M(), 1.15, 1.1, 1.5, 2.9, 0.2), B(belly, 0.95, 0.4, 1.3, 2.35, 0.2),   // chest + belly plate
    B(M(), 1.0, 0.95, 1.4, 2.4, 1.4),
    B(M(), 0.8, 0.75, 1.3, 1.9, 2.5),
    B(M(), 0.6, 0.55, 1.2, 1.5, 3.5),
  );
  rig.add(chain);
  // tail tip (wagged by the engine like the dog's)
  const tail = new THREE.Group(); tail.position.set(0, 1.3, 4.1);
  tail.add(B(M(), 0.4, 0.4, 0.9, 0, 0.4), B(horn, 0.5, 0.14, 0.55, 0, 0.95));   // spade tip
  rig.add(tail); rig.userData.tail = tail;
  // stub wings on the arm slots — the swing anim flaps them (bat-style)
  const mkWing = (sgn: number) => {
    const g = new THREE.Group(); g.position.set(sgn * 0.6, 3.3, 0.1); g.rotation.z = sgn * 0.2;
    g.add(B(mk(0x3a3040, 0.8), 1.5, 0.9, 0.1, 0.1, 0, sgn * 0.8), B(M(), 1.6, 0.14, 0.14, 0.55, 0, sgn * 0.8));
    return g;
  };
  const armL = mkWing(-1), armR = mkWing(1);
  rig.add(armL, armR, ...parts);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 1.25);
  void dark;
  return { rig, limbs: { legL: chain, legR: chain, armL, armR }, mats, refHeight: 5.2 };
}

const GOLEM_STONE = [0x7d8577, 0x6a7264, 0x8b8f86, 0x74716a];
/** A GOLEM — a towering stone brute: huge torso + shoulder slabs, a tiny sunken
 *  head with one glowing rune eye, cube fists, moss patches. Reads BIG (refHeight
 *  6.5) so even tier-1 golems tower naturally. */
export function buildGolem(_opts: BlockyOpts): Blocky {
  const { mats, mk, B, rig } = rig0();
  const stone = mk(_opts.tintShirt ?? rpick(GOLEM_STONE), 0.95), dark = mk(0x3a4038, 0.9);
  const moss = mk(0x4f7a3a, 0.95);
  const parts: THREE.Object3D[] = [
    B(stone, 2.3, 2.4, 1.5, 3.7),                                  // massive torso
    B(stone, 1.0, 0.9, 1.1, 5.0, 0, -1.55), B(stone, 1.0, 0.9, 1.1, 5.0, 0, 1.55),   // shoulder slabs
    B(stone, 0.85, 0.8, 0.85, 5.35),                               // tiny sunken head
    B(dark, 1.2, 0.16, 0.2, 4.1, -0.78),                           // crack line
    B(dark, 0.16, 0.9, 0.2, 3.3, -0.78, 0.55),                     // crack line 2
    B(moss, 0.8, 0.2, 0.16, 4.75, -0.7, -0.6),                     // moss patch (chest)
    B(moss, 0.55, 0.16, 0.9, 5.5, 0, 1.5),                         // moss on a shoulder
    B(stone, 1.6, 0.6, 1.2, 2.2),                                  // hip block
  ];
  const runeM = new THREE.MeshStandardMaterial({ color: 0xffd24d, emissive: 0xff9a10, emissiveIntensity: 1.3, roughness: 0.35, vertexColors: true });
  const rune = new THREE.Mesh(aoBox(0.5, 0.2, 0.1), runeM); rune.position.set(0, 5.42, -0.46); rune.userData.noOutline = true;
  parts.push(rune);
  const mkArm = (sgn: number) => {
    const g = new THREE.Group(); g.position.set(sgn * 1.75, 4.6, 0);
    g.add(B(stone, 0.75, 2.2, 0.8, -1.1), B(stone, 0.95, 0.85, 0.95, -2.5), B(moss, 0.5, 0.14, 0.6, -0.4, -0.42, sgn * 0.1));   // arm, CUBE fist, moss
    return g;
  };
  const armL = mkArm(-1), armR = mkArm(1);
  const mkLeg = (sgn: number) => { const g = new THREE.Group(); g.position.set(sgn * 0.62, 1.9, 0); g.add(B(stone, 0.85, 1.5, 0.95, -0.75), B(dark, 0.95, 0.35, 1.15, -1.75, -0.08)); return g; };
  const legL = mkLeg(-1), legR = mkLeg(1);
  parts.push(armL, armR, legL, legR);
  rig.add(...parts);
  rig.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  addOutline(rig);
  attachBlobShadow(rig, 1.3);
  return { rig, limbs: { legL, legR, armL, armR }, mats, refHeight: 6.5 };
}

export function buildCharacter(kind: CreatureKind, opts: BlockyOpts): Blocky {
  switch (kind) {
    case 'zombie': return buildZombie(opts);
    case 'skeleton': return buildSkeleton(opts);
    case 'mummy': return buildSkeleton(opts, true);
    case 'dog': return buildDog(opts);
    case 'drone': return buildDrone(opts);
    case 'slime': return buildSlime(opts);
    case 'bat': return buildBat(opts);
    case 'spider': return buildSpider(opts);
    case 'ghost': return buildGhost(opts);
    case 'wolf': return buildWolf(opts);
    case 'robot': return buildRobot(opts);
    case 'wyrm': return buildWyrm(opts);
    case 'golem': return buildGolem(opts);
    default: return buildBlocky(opts);   // raider -> human
  }
}
