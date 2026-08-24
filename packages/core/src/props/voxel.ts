// src/engine/props/voxel.ts
// ============================================================================
// VoxelOp[] → PropGeo. Pure geometry: boxes and cylinders sized in voxels, vertex-
// coloured from the Style's material tones with the craft rules of the design doc:
//   tops take the LIGHT tone, undersides the DARK tone, ±x sides the base, ±z sides
//   base −8%; a bottom→top brightness gradient fakes contact AO; 'emissive' ops are
//   split into an unlit 'glow' part; 'glass' into a translucent part.
// No unit-cube meshing: a prop is ~10-40 boxes, so a whole family stays under the
// 300-triangle budget and instances by the hundred on a phone.
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Material, PropGeo, PropPart, Style, VoxelOp } from './types';

/** World units per voxel — see types.ts SCALE. */
export const VOX = 0.35;

interface Prim {
  kind: 'box' | 'cyl';
  x: number; y: number; z: number;     // box: min corner. cyl: centre x/z, base y
  w: number; h: number; d: number;     // cyl: w = d = 2r
  r: number; sides: number;
  mat: Material; emissive: boolean; ao: boolean;
}

export type OpsResolver = (id: string) => VoxelOp[] | undefined;

/** Quarter-turn CCW about +y at the origin: (x, z) → (−z, x). */
function rotPrim(p: Prim, rot: number): Prim {
  let q = { ...p };
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
    q = q.kind === 'box'
      ? { ...q, x: -(q.z + q.d), z: q.x, w: q.d, d: q.w }
      : { ...q, x: -q.z, z: q.x };
  }
  return q;
}
function mirrorPrim(p: Prim, axis: 'x' | 'z'): Prim {
  if (p.kind === 'box') return axis === 'x' ? { ...p, x: -(p.x + p.w) } : { ...p, z: -(p.z + p.d) };
  return axis === 'x' ? { ...p, x: -p.x } : { ...p, z: -p.z };
}
const offset = (p: Prim, dx: number, dy: number, dz: number): Prim => ({ ...p, x: p.x + dx, y: p.y + dy, z: p.z + dz });

function stairsPrims(op: Extract<VoxelOp, { stairs: unknown }>): Prim[] {
  const [x, y, z, w, h, d] = op.stairs;
  const n = Math.max(2, Math.min(h, d, 8));
  const out: Prim[] = [];
  const cx = x + w / 2, cz = z + d / 2;
  for (let i = 0; i < n; i++) {
    // local frame centred on the run, rising toward +z
    const local: Prim = { kind: 'box', x: -w / 2, y: 0, z: -d / 2 + (i * d) / n, w, h: ((i + 1) * h) / n, d: d / n, r: 0, sides: 0, mat: op.mat, emissive: false, ao: true };
    out.push(offset(rotPrim(local, op.dir), cx, y, cz));
  }
  return out;
}

/** Expand mirror / repeat / ref / stairs into a flat primitive list. */
export function flattenOps(ops: VoxelOp[], resolve: OpsResolver, depth = 0): Prim[] {
  if (depth > 6) throw new Error('prop ref nesting deeper than 6');
  const out: Prim[] = [];
  for (const op of ops) {
    if ('box' in op) {
      const [x, y, z, w, h, d] = op.box;
      out.push({ kind: 'box', x, y, z, w, h, d, r: 0, sides: 0, mat: op.mat, emissive: !!op.emissive, ao: op.ao !== false });
    } else if ('cyl' in op) {
      const [x, y, z, r, h] = op.cyl;
      out.push({ kind: 'cyl', x, y, z, w: 2 * r, h, d: 2 * r, r, sides: op.sides ?? 8, mat: op.mat, emissive: !!op.emissive, ao: true });
    } else if ('stairs' in op) {
      out.push(...stairsPrims(op));
    } else if ('mirror' in op) {
      const sub = flattenOps(op.ops, resolve, depth + 1);
      out.push(...sub, ...sub.map((p) => mirrorPrim(p, op.mirror)));
    } else if ('repeat' in op) {
      const sub = flattenOps(op.ops, resolve, depth + 1);
      const { n, dx = 0, dy = 0, dz = 0 } = op.repeat;
      for (let i = 0; i < n; i++) out.push(...sub.map((p) => offset(p, i * dx, i * dy, i * dz)));
    } else if ('ref' in op) {
      const refOps = resolve(op.ref);
      if (!refOps) throw new Error(`unknown prop ref "${op.ref}"`);
      const sub = flattenOps(refOps, resolve, depth + 1);
      const [ax, ay, az] = op.at;
      out.push(...sub.map((p) => offset(rotPrim(p, op.rot ?? 0), ax, ay, az)));
    }
  }
  return out;
}

const _c = new THREE.Color();
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Per-vertex craft shading: tone by face normal, −8% on ±z, bottom→top AO gradient. */
function paint(geo: THREE.BufferGeometry, tones: [number, number, number], minY: number, maxY: number, ao: boolean, unlit: boolean): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const span = Math.max(1e-6, maxY - minY);
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i), nz = nrm.getZ(i);
    let hex: number, mul: number;
    if (unlit) { hex = tones[2]; mul = 1; }
    else if (ny > 0.5) { hex = tones[2]; mul = 1; }
    else if (ny < -0.5) { hex = tones[1]; mul = 1; }
    else { hex = tones[0]; mul = 1 - 0.08 * Math.abs(nz); }
    if (ao && !unlit) mul *= 0.8 + 0.2 * smooth((pos.getY(i) - minY) / span);
    _c.setHex(hex);
    col[i * 3] = _c.r * mul; col[i * 3 + 1] = _c.g * mul; col[i * 3 + 2] = _c.b * mul;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Build one prop's geometry from ops in a style. Throws on empty / unresolvable input. */
export function buildGeo(ops: VoxelOp[], style: Style, resolve: OpsResolver): PropGeo {
  const prims = flattenOps(ops, resolve);
  if (!prims.length) throw new Error('prop has no voxels');
  let minY = Infinity, maxY = -Infinity;
  for (const p of prims) { minY = Math.min(minY, p.y * VOX); maxY = Math.max(maxY, (p.y + p.h) * VOX); }
  const groups: Record<PropPart['kind'], THREE.BufferGeometry[]> = { solid: [], glass: [], glow: [] };
  for (const p of prims) {
    let g: THREE.BufferGeometry;
    if (p.kind === 'box') {
      g = new THREE.BoxGeometry(p.w * VOX, p.h * VOX, p.d * VOX);
      g.translate((p.x + p.w / 2) * VOX, (p.y + p.h / 2) * VOX, (p.z + p.d / 2) * VOX);
    } else {
      g = new THREE.CylinderGeometry(p.r * VOX, p.r * VOX, p.h * VOX, p.sides);
      g.translate(p.x * VOX, (p.y + p.h / 2) * VOX, p.z * VOX);
    }
    const kind: PropPart['kind'] = p.emissive ? 'glow' : p.mat === 'glass' ? 'glass' : 'solid';
    paint(g, style.tones[p.mat], minY, maxY, p.ao, p.emissive);
    groups[kind].push(g);
  }
  const parts: PropPart[] = [];
  const box = new THREE.Box3();
  let tris = 0;
  for (const kind of ['solid', 'glass', 'glow'] as const) {
    const list = groups[kind];
    if (!list.length) continue;
    const merged = mergeGeometries(list);
    for (const g of list) g.dispose();
    if (!merged) throw new Error('mergeGeometries failed');
    merged.computeBoundingBox();
    box.union(merged.boundingBox!);
    tris += (merged.index ? merged.index.count : merged.getAttribute('position').count) / 3;
    parts.push({ geo: merged, kind });
  }
  const size = box.getSize(new THREE.Vector3());
  return { parts, aabb: [size.x, size.y, size.z], tris, voxels: prims.length };
}

/** Pure bounds of a prop's ops in WORLD UNITS (no three.js) — the planner's view of a prop. */
export function propBounds(ops: VoxelOp[], resolve: OpsResolver): { w: number; h: number; d: number; minX: number; minZ: number; maxX: number; maxZ: number; minY: number } {
  const prims = flattenOps(ops, resolve);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of prims) {
    const x0 = p.kind === 'box' ? p.x : p.x - p.r, x1 = p.kind === 'box' ? p.x + p.w : p.x + p.r;
    const z0 = p.kind === 'box' ? p.z : p.z - p.r, z1 = p.kind === 'box' ? p.z + p.d : p.z + p.r;
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1); minZ = Math.min(minZ, z0); maxZ = Math.max(maxZ, z1);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + p.h);
  }
  return { w: (maxX - minX) * VOX, h: (maxY - minY) * VOX, d: (maxZ - minZ) * VOX, minX: minX * VOX, minZ: minZ * VOX, maxX: maxX * VOX, maxZ: maxZ * VOX, minY: minY * VOX };
}
