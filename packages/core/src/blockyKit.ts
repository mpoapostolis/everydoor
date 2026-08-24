// src/engine/blockyKit.ts
// ============================================================================
// Shared blocky-art toolkit — the ONE place the toon look is implemented:
//  - bakeBoxAO / aoBox: baked vertex-color gradient (dark feet, lit top) that
//    makes flat-shaded boxes read as "lit" with zero runtime cost. Materials
//    must set vertexColors: true (the white-ish bake multiplies their color).
//  - jitterColor: seeded HSL jitter so repeated props/rooms aren't clones.
//  - addOutline: proportional inverted-hull toon outline, merged into ONE mesh
//    per parent Group (limb groups keep animating; draw calls stay low).
//  - attachBlobShadow: a shared radial-gradient quad that visually glues
//    characters/props to the ground where no real shadow falls.
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { withCutout } from './cameraCutout';

/** Bake a bottom-dark -> top-light vertex gradient into any geometry (fake AO
 *  + sky light). `bottom`/`top` are brightness multipliers at the geometry's
 *  own Y extremes. */
export function bakeBoxAO(geo: THREE.BufferGeometry, bottom = 0.74, top = 1.08): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const h = Math.max(1e-6, bb.max.y - bb.min.y);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / h;
    const s = bottom + (top - bottom) * (t * t * (3 - 2 * t)); // smoothstep
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// Dimension-keyed cache: every same-size box in the game shares ONE geometry
// (crowds of characters, repeated furniture). Never disposed by callers; a
// stray dispose() on world swap only costs a re-upload, never breakage.
const boxCache = new Map<string, THREE.BoxGeometry>();
export function aoBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`;
  let g = boxCache.get(key);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); bakeBoxAO(g); boxCache.set(key, g); }
  return g;
}

const _jc = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };
/** Seeded HSL jitter around a hex color (±hueDeg degrees, ±lightPct % lightness). */
export function jitterColor(hex: number, rnd: () => number, hueDeg = 4, lightPct = 5): number {
  _jc.setHex(hex);
  _jc.getHSL(_hsl);
  const h = (_hsl.h + ((rnd() * 2 - 1) * hueDeg) / 360 + 1) % 1;
  const l = Math.min(1, Math.max(0, _hsl.l * (1 + ((rnd() * 2 - 1) * lightPct) / 100)));
  _jc.setHSL(h, _hsl.s, l);
  return _jc.getHex();
}

// ---------------------------------------------------------------------------
// Toon outline — proportional inverted hull, merged per parent Group.
// ---------------------------------------------------------------------------
export const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
OUTLINE_MAT.userData.__hullShared = true;   // ONE material for every rig's outline — dispose paths must skip it
// CAMERA SEE-THROUGH: the ink must dissolve with the body it wraps. A character standing
// between the lens and the subject loses its surfaces to the cutout; without this its black
// hull would stay and leave a solid silhouette in the hole.
withCutout(OUTLINE_MAT);
/** TEAMMATE hull — a fat green rim OUTSIDE the black ink so a friend's whole silhouette reads
 *  across the arena (a nameplate alone disappears in a crowd — owner report). */
export const FRIEND_OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x4ade80, side: THREE.BackSide });
FRIEND_OUTLINE_MAT.userData.__hullShared = true;
withCutout(FRIEND_OUTLINE_MAT);
const _m4 = new THREE.Matrix4();

/** Inflated shell geometry for one mesh, or null if it shouldn't be outlined
 *  (flat panels like eyes/screens, or non-box/cylinder geometry). */
function outlineGeoFor(mesh: THREE.Mesh, inflateMul = 1): THREE.BufferGeometry | null {
  if ((mesh as any).userData?.noOutline) return null;
  const p: any = (mesh.geometry as any)?.parameters;
  if (!p) return null;
  if (p.width != null) {
    const min = Math.min(p.width, p.height, p.depth);
    if (min < 0.09) return null; // flat decals (eyes, screens, strips) get no shell
    const o = Math.min(0.18, Math.max(0.05, min * 0.16)) * inflateMul; // proportional, total per axis
    return new THREE.BoxGeometry(p.width + o, p.height + o, p.depth + o);
  }
  if (p.radiusBottom != null) {
    const r = Math.max(p.radiusTop ?? 0, p.radiusBottom);
    const o = Math.min(0.18, Math.max(0.05, r * 0.16)) * inflateMul;
    return new THREE.CylinderGeometry((p.radiusTop ?? 0) + o / 2, p.radiusBottom + o / 2, p.height + o, p.radialSegments);
  }
  return null;
}

/** Add a black inverted-hull outline to every eligible mesh under `root`,
 *  merged into ONE shell mesh per parent Group (so animated limb groups keep
 *  their shells moving with them, and a whole character costs ~5 outline
 *  draws instead of ~20). Call ONCE per rig/group — not idempotent. */
export function addOutline(root: THREE.Object3D, mat: THREE.Material = OUTLINE_MAT, inflateMul = 1): void {
  const byParent = new Map<THREE.Object3D, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.parent || (m as any).userData?.isOutline) return;
    const g = outlineGeoFor(m, inflateMul);
    if (!g) return;
    g.applyMatrix4(_m4.compose(m.position, m.quaternion, m.scale));
    let arr = byParent.get(m.parent);
    if (!arr) byParent.set(m.parent, (arr = []));
    arr.push(g);
  });
  for (const [parent, geos] of byParent) {
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const om = new THREE.Mesh(merged, mat);
    om.castShadow = om.receiveShadow = false;
    om.userData.isOutline = true;
    parent.add(om);
  }
}

// ---------------------------------------------------------------------------
// Blob shadow — one shared texture/material/geometry, scaled per use.
// ---------------------------------------------------------------------------
let _blobMat: THREE.MeshBasicMaterial | null = null;
let _blobGeo: THREE.PlaneGeometry | null = null;
function blobMat(): THREE.MeshBasicMaterial {
  if (_blobMat) return _blobMat;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  // soft contact hint, not a black puddle — outdoors it stacks on real shadows
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0.28)');
  g.addColorStop(0.65, 'rgba(0,0,0,0.14)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  _blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  _blobMat.userData.__hullShared = true;   // ONE shared shadow quad material — never disposed per-rig
  _blobMat.userData.noCut = true;          // a contact shadow lies ON the floor — never cut it away
  return _blobMat;
}

/** Attach a soft contact-shadow quad under `parent` (parent-local origin =
 *  the feet/base). Returns the quad (caller may reposition). */
export function attachBlobShadow(parent: THREE.Object3D, radius: number, y = 0.04): THREE.Mesh {
  if (!_blobGeo) _blobGeo = new THREE.PlaneGeometry(1, 1);
  const m = new THREE.Mesh(_blobGeo, blobMat());
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(radius * 2);
  m.position.y = y;
  m.userData.noOutline = true;
  m.castShadow = m.receiveShadow = false;
  parent.add(m);
  return m;
}
