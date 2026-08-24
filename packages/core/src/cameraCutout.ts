// src/engine/cameraCutout.ts
// ============================================================================
// CAMERA CUTOUT — whatever sits between the third-person camera and the SUBJECT (the hero, or
// the cutscene's subject) is dithered away, and comes back the moment it no longer blocks the
// view. Done in the shader (no transparency sorting, depth stays right): a fragment is discarded
// when it is CLOSER to the camera than the subject, with an interleaved-gradient dither so the
// edge is soft and the hole never looks like a stencil.
//
// THREE THINGS KEEP THE HOLE HONEST — every one of them a uniform, so the same shader serves a
// castle corridor and an open forest:
//   • uCutRadius — a screen-space circle around the subject. Huge (radiusFrac 3) = the whole
//     frame, which is what a composed interior wants: an establishing shot must never be half a
//     wall. Outdoors it is a real circle, so a park dissolves the trees IN THE SHOT, not the wood.
//   • uCutBand   — how far IN FRONT of the subject a fragment may be and still count as "in the
//     way". Without it a `look at <npc>` 120 u away deletes every tree within 120 u; with a ~16 u
//     band only the ones actually crowding the subject go. Composed keeps it effectively infinite.
//   • uCutFloorY / uCutUpMax — the ground never goes. A world-Y plane at the subject's feet
//     handles flat floors; UP-FACING fragments (world normal .y above uCutUpMax) handle a
//     heightfield, where a hill in front of a lower hero would otherwise open a hole to the sky.
//     Interiors set uCutUpMax above 1 so table tops and crates still dissolve.
//
// Shared uniforms; materials opt in with withCutout() (or wholesale via dressCutout); the game
// feeds updateCutout() per frame, right before every draw, so it is correct for EVERY camera.
// ============================================================================
import * as THREE from 'three';

export const CUT = {
  uCutCenter: { value: new THREE.Vector2(-9999, -9999) },   // subject in drawing-buffer px
  uCutDepth: { value: 1e9 },                                // subject's view-space distance (positive)
  uCutRadius: { value: 0 },                                 // px; 0 = off (huge = whole frame)
  uCutFloorY: { value: -1e9 },                              // world y of the floor the subject stands on — floors never cut
  uCutBand: { value: 1e6 },                                 // u in front of the subject that still counts as "in the way"
  uCutUpMax: { value: 2 },                                  // world normal .y above this never cuts (>1 = never; ~0.55 = spare the ground)
};

export const CUT_PARS_VERT = /* glsl */ `varying float vCutViewZ; varying float vCutWorldY; varying float vCutUp;`;
/** Injected after <project_vertex>, where `transformed` is final and `mvPosition` exists.
 *  `normal` is declared by three's default vertex prefix for every non-raw material, so this
 *  works on MeshBasic (which has no vNormal of its own) too; a geometry with no normal
 *  attribute reads (0,0,0) and is handled by the length guard. */
export const CUT_VERT = /* glsl */ `vCutViewZ = -mvPosition.z;
  { vec4 cw = vec4(transformed, 1.0);
    vec3 cn = normal;
    #ifdef USE_INSTANCING
      cw = instanceMatrix * cw;
      cn = mat3(instanceMatrix) * cn;
    #endif
    vCutWorldY = (modelMatrix * cw).y;
    vec3 wn = mat3(modelMatrix) * cn;
    vCutUp = dot(wn, wn) > 1e-8 ? normalize(wn).y : 0.0; }`;
export const CUT_PARS_FRAG = /* glsl */ `
  uniform vec2 uCutCenter; uniform float uCutDepth; uniform float uCutRadius; uniform float uCutFloorY; uniform float uCutBand; uniform float uCutUpMax;
  varying float vCutViewZ; varying float vCutWorldY; varying float vCutUp;
  float cutDither(vec2 p) { return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)); }`;
/** Discard rule — anything CLOSER to the lens than its subject (walls, props, trees in the way)
 *  goes, dithered in by how far in front it is and back OUT past the band; the ground the subject
 *  stands on never goes; a soft screen-space rim keeps it from hard-clipping at the radius. */
export const CUT_FRAG = /* glsl */ `
  if (uCutRadius > 0.5 && vCutWorldY > uCutFloorY + 0.45 && vCutUp <= uCutUpMax) {
    float inFront = uCutDepth - vCutViewZ;                                        // >0 = nearer the lens than the subject
    if (inFront > 0.8) {
      float ct = clamp((inFront - 0.8) / 2.5, 0.0, 1.0)                           // fade in just ahead of the subject
               * (1.0 - smoothstep(uCutBand, uCutBand * 1.35 + 2.0, inFront));    // …and back out past the band
      float cd = distance(gl_FragCoord.xy, uCutCenter);
      float rim = 1.0 - smoothstep(uCutRadius * 0.75, uCutRadius, cd);
      if (ct * rim * 1.3 > cutDither(gl_FragCoord.xy)) discard;
    }
  }`;

/** Materials the injection cannot serve: their shaders have no <project_vertex> /
 *  <clipping_planes_fragment> to replace (sprites, points, lines) or they own their whole GLSL
 *  (ShaderMaterial — outline.ts / glbChars.ts hand-write the same block instead). */
export function cutoutInjectable(mat: any): boolean {
  if (!mat) return false;
  if (mat.isShaderMaterial || mat.isRawShaderMaterial) return false;
  if (mat.isSpriteMaterial || mat.isPointsMaterial || mat.isLineBasicMaterial || mat.isLineDashedMaterial) return false;
  return true;
}

/** Should this world mesh's material dissolve when it stands in the shot?
 *  NO for anything that would break the frame instead of unblocking it: additive / depth-less
 *  decals and light pools (they ARE the floor's paint), and anything explicitly tagged noCut
 *  (clouds, the far skyline, the sky). Ground/roads/water need no tag — they are up-facing and
 *  the shader spares them (uCutUpMax) or they sit at the subject's floor plane (uCutFloorY). */
export function cuttable(mesh: any, mat: any): boolean {
  if (!cutoutInjectable(mat)) return false;
  if (mat.userData && mat.userData.noCut) return false;
  if (mesh && mesh.userData && mesh.userData.noCut) return false;
  if (mat.transparent && mat.depthWrite === false) return false;   // decals, light pools, additive FX
  return true;
}

/** Opt a built-in material (MeshStandard / MeshBasic / MeshLambert…) into the cutout. Idempotent. */
export function withCutout<T extends THREE.Material>(mat: T): T {
  if (!cutoutInjectable(mat)) return mat;                       // a silent no-op used to LOOK applied: stamped, keyed, and never injected
  if ((mat as any).userData.__cutout) return mat;
  (mat as any).userData.__cutout = true;
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : null;
  // PROGRAM CACHE KEY: three's default key for a built-in material is onBeforeCompile.toString(),
  // so overriding it REMOVES the earlier injection's source from the key. armDissolve (blocky /
  // glbChars) injects without setting a key of its own — without this fallback a cut+dissolve
  // material and a plain cut one of the same type would key identically and share ONE program.
  const prevSrc = prevKey ? '' : prev && prev !== (THREE.Material.prototype as any).onBeforeCompile ? String(prev) : '';
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, CUT);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CUT_PARS_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${CUT_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CUT_PARS_FRAG}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CUT_FRAG}`);
  };
  mat.customProgramCacheKey = () => 'cutout:' + mat.type + ':' + (prevKey ? prevKey() : prevSrc);
  mat.needsUpdate = true;
  return mat;
}

/** Opt an ENTIRE world subtree in, one pass, by the `cuttable` rule. `skip` holds subtrees to
 *  leave alone — character rigs, whose ink hull is a ShaderMaterial the injection cannot reach,
 *  so cutting their skin would leave a floating black silhouette. Returns how many materials
 *  were newly injected (0 on a second pass — withCutout is idempotent). */
export function dressCutout(root: THREE.Object3D | null | undefined, skip?: Set<THREE.Object3D> | null): number {
  if (!root) return 0;
  let n = 0;
  const walk = (o: any) => {
    if (!o || (skip && skip.has(o))) return;
    if (o.isMesh || o.isInstancedMesh) {
      const m = o.material;
      const one = (x: any) => { if (cuttable(o, x) && !x.userData.__cutout) { withCutout(x); n++; } };
      if (Array.isArray(m)) m.forEach(one); else one(m);
    }
    const kids = o.children;
    for (let i = 0; i < kids.length; i++) walk(kids[i]);
  };
  walk(root);
  return n;
}

const _v = new THREE.Vector3(); const _size = new THREE.Vector2();
/** Feed the subject's screen position / depth each frame.
 *  @param radiusFrac of the LONGER viewport side; 0 disables (3 = whole frame).
 *  @param floorY     world y of the ground under the subject — nothing at or below it ever cuts.
 *  @param band       u in front of the subject that still counts as "in the way".
 *  @param upMax      world normal .y above which a fragment never cuts (>1 = spare nothing). */
export function updateCutout(
  camera: THREE.Camera, subject: THREE.Vector3, renderer: THREE.WebGLRenderer,
  radiusFrac = 3.0, floorY = subject.y - 2.6, band = 1e6, upMax = 2,
): void {
  renderer.getDrawingBufferSize(_size);
  _v.copy(subject).applyMatrix4(camera.matrixWorldInverse);
  const depth = -_v.z;
  _v.copy(subject).project(camera);
  CUT.uCutCenter.value.set((_v.x * 0.5 + 0.5) * _size.x, (_v.y * 0.5 + 0.5) * _size.y);
  CUT.uCutDepth.value = depth;
  CUT.uCutRadius.value = radiusFrac > 0 ? Math.max(_size.x, _size.y) * radiusFrac : 0;
  CUT.uCutFloorY.value = floorY;
  CUT.uCutBand.value = Math.max(2, band);
  CUT.uCutUpMax.value = upMax;
}
export function disableCutout(): void { CUT.uCutRadius.value = 0; }
