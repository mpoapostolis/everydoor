// src/engine/props/library.ts
// ============================================================================
// The registry + bounded geometry cache + shared materials. Families register their
// PropDefs (families/index.ts); worlds/pages ask for `buildProp(id, style)` and get the
// same PropGeo back for the same (id, style) — geometry is built once and instanced.
// The cache is bounded by STYLE: at most MAX_STYLES styles stay live; touching a 7th
// evicts the least-recently-used style's geometries (a 10-world tour stays ≈ 10 MB).
// ============================================================================
import * as THREE from 'three';
import type { PropDef, PropGeo, PropPart, Style, VoxelOp } from './types';
import { buildGeo, propBounds } from './voxel';
import { withCutout } from '../cameraCutout';
import { DEFAULT_STYLE as DEFAULT_STYLE_FOR_META } from './styles';

const ID_RE = /^[a-z]+_[a-z0-9]+(_[a-z0-9]+)?$/;
const DEFS = new Map<string, PropDef>();
const ORDER: string[] = [];
const tagIndex = new Map<string, PropDef[]>();   // tag → defs in registration order, see propsWithTag

export function registerProps(defs: PropDef[]): void {
  for (const d of defs) {
    if (!ID_RE.test(d.id)) throw new Error(`prop id "${d.id}" must match ${ID_RE}`);
    if (DEFS.has(d.id)) throw new Error(`prop id "${d.id}" registered twice`);
    if (!d.voxels && !d.build) throw new Error(`prop "${d.id}" has neither voxels nor build()`);
    DEFS.set(d.id, d);
    ORDER.push(d.id);
  }
  tagIndex.clear();                              // registration order changed: rebuild tag lists lazily
}
export const propDef = (id: string): PropDef | undefined => DEFS.get(id);
export const propIds = (): string[] => ORDER.slice();
export const allProps = (): PropDef[] => ORDER.map((id) => DEFS.get(id)!);
export const propsOfFamily = (family: PropDef['family']): PropDef[] => allProps().filter((d) => d.family === family);

const resolveOps = (id: string): VoxelOp[] | undefined => DEFS.get(id)?.voxels;

// ---------------------------------------------------------------------------
// Bounded cache
// ---------------------------------------------------------------------------
const MAX_STYLES = 6;
const cache = new Map<string, PropGeo>();
const styleLru: string[] = [];

function touchStyle(styleId: string): void {
  const i = styleLru.indexOf(styleId);
  if (i >= 0) styleLru.splice(i, 1);
  styleLru.push(styleId);
  while (styleLru.length > MAX_STYLES) {
    const old = styleLru.shift()!;
    for (const [k, g] of cache) if (k.endsWith('|' + old)) { for (const p of g.parts) p.geo.dispose(); cache.delete(k); }
  }
}

/** Geometry for a prop in a style (cached). Throws on an unknown id so a typo is loud in tests. */
export function buildProp(id: string, style: Style): PropGeo {
  const key = id + '|' + style.id;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = DEFS.get(id);
  if (!def) throw new Error(`unknown prop "${id}"`);
  const ops = style.formOverrides?.[id] ?? def.voxels;
  const geo = def.build && !ops ? def.build(style) : buildGeo(ops!, style, resolveOps);
  touchStyle(style.id);
  cache.set(key, geo);
  return geo;
}
/** Planner-side metadata (pure): footprint / height in world units + the def. Cached per id. */
export interface PropMeta { id: string; def: PropDef; w: number; h: number; d: number }
const metaCache = new Map<string, PropMeta>();
export function propMeta(id: string): PropMeta {
  const hit = metaCache.get(id); if (hit) return hit;
  const def = DEFS.get(id); if (!def) throw new Error(`unknown prop "${id}"`);
  let w: number, h: number, d: number;
  if (def.voxels) { const b = propBounds(def.voxels, resolveOps); w = b.w; h = b.h; d = b.d; }
  else { const g = buildProp(id, DEFAULT_STYLE_FOR_META); [w, h, d] = g.aabb; }
  const m = { id, def, w: def.fp?.[0] ?? w, d: def.fp?.[1] ?? d, h: def.h ?? h };
  metaCache.set(id, m); return m;
}
/** Props carrying a tag (planner queries: 'seat', 'hide', 'surface'…), in registration order.
 *  Indexed per tag: furnish() asks for the same handful of tags for every anchor of every candidate,
 *  and a 200-prop scan per ask was most of compose()'s time once the library doubled. The array is
 *  shared — callers filter into their own, never mutate it. */
export const propsWithTag = (tag: string): PropDef[] => {
  const hit = tagIndex.get(tag); if (hit) return hit;
  const out = allProps().filter((d) => d.tags.includes(tag));
  tagIndex.set(tag, out); return out;
};

export const librarySize = (): number => cache.size;
export function disposeLibrary(): void { for (const g of cache.values()) for (const p of g.parts) p.geo.dispose(); cache.clear(); styleLru.length = 0; }

// ---------------------------------------------------------------------------
// Shared materials — ONE per part kind for the whole game (vertex colours carry the look).
// ---------------------------------------------------------------------------
export const PROP_MATERIALS: Record<PropPart['kind'], THREE.Material> = {
  solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }),
  glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
};
for (const m of Object.values(PROP_MATERIALS)) { m.userData.__hullShared = true; withCutout(m); }   // dispose paths must skip shared materials; all three cut out in front of the hero

/** A renderable Group for one prop (one Mesh per part). Base at y=0, centred on x=z=0. */
export function propMesh(id: string, style: Style): THREE.Group {
  const g = buildProp(id, style);
  const group = new THREE.Group();
  group.name = id;
  for (const part of g.parts) {
    const m = new THREE.Mesh(part.geo, PROP_MATERIALS[part.kind]);
    m.castShadow = part.kind === 'solid';
    m.receiveShadow = part.kind === 'solid';
    m.userData.noOutline = part.kind !== 'solid';
    group.add(m);
  }
  group.userData.prop = id;
  group.userData.aabb = g.aabb;
  return group;
}
