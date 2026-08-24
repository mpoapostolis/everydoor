// src/engine/props/types.ts
// ============================================================================
// The voxel-art PROP LIBRARY contract (design: docs/design/2026-08-22-world-composer.md §3).
// A prop is DATA: a list of VoxelOps in integer voxels, coloured by a Style's material
// tones at build time. One prop id renders in every style (castle / haunted / candy …)
// because ops name MATERIALS, never colours.
//
// SCALE (measured on main, not the doc's guess): 1 voxel = 0.35 world units.
//   hero       15 voxels tall (5.2 u, eyeHeight 4.6)      door opening 26 wide × 23 tall (9 × 8.2 u)
//   chair seat y = 6        table / desk top y = 10       counter top y = 12       room wall 40 (14 u)
//   bed 26 × 31 footprint   wardrobe 20 × 8 × 23          a hand-held item fits in 6 × 6 × 6
// Props stand on y = 0 and are centred on x = z = 0 (the composer rotates about that origin).
// ============================================================================
import type * as THREE from 'three';

export type Material = 'wood' | 'stone' | 'metal' | 'fabric' | 'foliage' | 'glass' | 'accent' | 'glow' | 'dark';
export const MATERIALS: readonly Material[] = ['wood', 'stone', 'metal', 'fabric', 'foliage', 'glass', 'accent', 'glow', 'dark'];

export type PropFamily =
  | 'core' | 'home' | 'kitchen' | 'school' | 'medical' | 'shop' | 'castle' | 'prison' | 'pirate' | 'farm'
  | 'scifi' | 'spooky' | 'nature' | 'street' | 'vehicle' | 'sign' | 'obby' | 'candy' | 'industrial' | 'structure' | 'office' | 'vignette';

/** [base, dark, light] — side faces get base, undersides dark, tops light. */
export type Tones = [base: number, dark: number, light: number];

export interface Style {
  id: string;                                   // 'house.cozy', 'castle', 'haunted', 'school', 'shop', 'candy' …
  tones: Record<Material, Tones>;               // audited: EVERY material toned in EVERY style
  glow: number;                                 // emissive intensity multiplier for 'glow' parts
  wallH: number; cell: number;                  // composer hints (u): room wall height, layout cell
  trim: 'plank' | 'flagstone' | 'tile' | 'panel' | 'dirt' | 'sand';
  lighting: { ambient: number; pointLights: 0 | 3 | 6; exposure: number; ibl: boolean; fog?: [color: number, density: number] };
  formOverrides?: Record<string, VoxelOp[]>;    // prop id → replacement ops in this style (≤ 10% of props)
  cute?: boolean;
}

/** Integer voxel ops. box/stairs: x,y,z = MIN corner, w/h/d = extent. cyl: x,z = CENTRE, y = base. */
export type VoxelOp =
  | { box: [x: number, y: number, z: number, w: number, h: number, d: number]; mat: Material; ao?: boolean; emissive?: boolean }
  | { cyl: [x: number, y: number, z: number, r: number, h: number]; mat: Material; sides?: 6 | 8 | 12; emissive?: boolean }
  | { stairs: [x: number, y: number, z: number, w: number, h: number, d: number]; mat: Material; dir: 0 | 1 | 2 | 3 }   // decorative; rises toward +z at dir 0
  | { mirror: 'x' | 'z'; ops: VoxelOp[] }       // emits ops AND their reflection through the x=0 / z=0 plane
  | { repeat: { n: number; dx?: number; dy?: number; dz?: number }; ops: VoxelOp[] }
  | { ref: string; at: [x: number, y: number, z: number]; rot?: 0 | 1 | 2 | 3 };   // another prop's ops (vignettes = props of props)

export type Place = 'wall' | 'corner' | 'floor' | 'ceiling' | 'surface' | 'outdoor';
export type Interact =
  | 'door' | 'lockedDoor' | 'chest' | 'lever' | 'button' | 'plate' | 'checkpoint' | 'keyPedestal' | 'bed' | 'campfire'
  | 'workstation' | 'finish' | 'kill' | 'claim' | 'sell' | 'flag';

export interface PropDef {
  id: string;                                   // family_noun[_variant]  (regex ^[a-z]+_[a-z0-9]+(_[a-z0-9]+)?$)
  family: PropFamily;
  tags: string[];                               // 'sleep','seat','surface','hide','light','loot','weenie','workstation','cover','barricade','claim'
  voxels?: VoxelOp[];
  build?: (s: Style) => PropGeo;                // legacy path ONLY for reused builders (trees, industrial kit)
  /** Footprint in WORLD UNITS (x, z). Optional — derived from the built geometry when absent. */
  fp?: [w: number, d: number];
  h?: number;                                   // world units; derived when absent
  place: Place;
  facing: 'wall' | 'room' | 'any';
  clearance?: { front: number; sides: number; back?: number };   // u; doors need front ≥ 3
  satellites?: { tag: string; dx: number; dz: number; rot: 0 | 1 | 2 | 3; p: number }[];
  surfaces?: { x: number; z: number; w: number; d: number; y: number; max: number }[];   // u, prop-local; x/z = MIN corner, y = top height
  blocking: boolean; hide?: boolean; loot?: boolean;
  interact?: Interact;
  outline?: boolean;                            // default: blocking && h >= 2
  minInstances?: number;                        // default 8, counted PER CHUNK
  lod?: 'always' | 'near' | 'dressing';
}

export interface PropPart { geo: THREE.BufferGeometry; kind: 'solid' | 'glass' | 'glow' }
export interface PropGeo { parts: PropPart[]; aabb: [w: number, h: number, d: number]; tris: number; voxels: number }

/** Triangle budgets enforced by scripts/prop-audit.mjs. */
export const TRI_BUDGET = { default: 300, dressing: 60 } as const;
