// src/engine/composer/plans/preview.ts — a FloorPlan straight to a renderable SemanticMap, skipping
// furnish/validate. For the dev page: judge the PLAN (rooms, shared walls, doors, locks) in 3D before
// the rest of the pipeline dresses it. Never used by the game.
import type { Archetype, SemanticMap } from '../types';
import type { FloorPlan } from './types';
import { parsePlan, applyVariants } from './parse';
import { mapMission } from './mapMission';
import { planToLayout } from './planToLayout';
import { buildMission, linearMission } from '../mission';
import { Rng, sub } from '../rng';

export function previewPlanMap(plan: FloorPlan, arch: Archetype, seed: number): SemanticMap & { missionOk: boolean; missionReason?: string } {
  const varied = applyVariants(plan, sub(seed, 'variant'));
  const parsed = parsePlan(varied);
  const g = buildMission(seed, arch, [], 'easy') ?? linearMission(seed, arch, []);
  const m = mapMission(parsed, g, arch, new Rng(seed));
  const layout = planToLayout(parsed, m.ok ? m.assign : {}, m.ok ? m.locks : {}, arch, seed, { graph: g } as any);
  const counts = new Map<string, number>();
  for (const z of layout.zones) {
    const n = (counts.get(z.kind) ?? 0) + 1; counts.set(z.kind, n);
    const names = arch.naming[z.kind]; z.name = names ? names[(n - 1) % names.length] : z.kind;
    z.spots.center = z.spots.center ?? { x: (z.rect.x0 + z.rect.x1) / 2, z: (z.rect.z0 + z.rect.z1) / 2, yaw: 0, floor: 0 };
  }
  const map: SemanticMap & { missionOk: boolean; missionReason?: string } = {
    archetype: arch.id, seed, style: arch.style, worldType: arch.worldType,
    zones: layout.zones, doors: layout.doors, placements: [], colliders: layout.colliders, walls: layout.walls,
    colliderCells: new Map(), lights: [], keys: [], people: [],
    start: layout.start, exit: layout.exit, ceilingY: arch.wallH,
    criticalPath: [], weenieZone: layout.zones[0]?.id ?? '', landmarks: [], aliases: {}, byRole: {}, fallback: false,
    missionOk: m.ok, missionReason: m.reason,
  };
  return map;
}
