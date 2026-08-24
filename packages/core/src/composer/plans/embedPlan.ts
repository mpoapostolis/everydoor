// src/engine/composer/plans/embedPlan.ts — the 'plan' embedder: choose a FloorPlan for the archetype
// (authored plans from plans/index.ts, generated plans from plans/generate.ts), map the mission onto its
// rooms, and emit the shared-wall EmbeddedLayout. Returns null when no plan fits this mission graph so the
// driver re-seeds (and finally falls back to the 9-node linear mission, which every plan holds).
//
// choosePlan policy (seeded): authored plans that can hold every mission node are candidates; generated
// plans (needsOf → generatePlan → rankPlans, best 4) join them; when both exist the seed picks which family
// goes first (≈ 50/50), when the mission needs more rooms than any authored plan holds the generated ones
// lead. Every candidate is tried as ≤ 3 variants × mapMission (≤ 12 attempts inside) before the next one.
import type { Archetype, EmbeddedLayout, MissionGraph } from '../types';
import type { FloorPlan } from './types';
import { parsePlan, applyVariants } from './parse';
import { mapMission } from './mapMission';
import { planToLayout } from './planToLayout';
import { PLANS } from './index';
import { generatePlan, rankPlans, scorePlan } from './generate';
import { needsOf } from '../embedBuilding';
import { Rng, sub } from '../rng';
import { DIR16 } from '../lut';

export function plansFor(arch: Archetype): FloorPlan[] { return PLANS[arch.id] ?? []; }

/** Candidates per embed from the generator and how many of the best are kept. */
export const GENERATED = 12, KEEP_GENERATED = 4;

export interface PlanChoice { plan: FloorPlan; hints?: Record<string, string> }
/** The id of the FloorPlan behind the last successful embed ('' when none). */
export let lastPlanId = '';
/** How the last embed was served: 'authored' | 'generated' | '' (dev tooling / tests). */
export let lastSource: 'authored' | 'generated' | '' = '';

/** Ordered candidates for this mission: authored plans that hold it, generated plans for its needs. */
export function choosePlan(arch: Archetype, g: MissionGraph, seed: number, extra: FloorPlan[] = []): PlanChoice[] {
  const rng = sub(seed, 'plan');
  const rooms = (p: FloorPlan) => Object.keys(p.rooms).length;
  const need = g.nodes.length;
  const authoredAll = [...extra, ...plansFor(arch)];
  const authored = rng.shuffle(authoredAll.filter((p) => rooms(p) >= need));
  // generated: the mission as room needs (embedBuilding.needsOf), the best few of the generator's candidates
  let generated: PlanChoice[] = [];
  try {
    const mn = needsOf(g, seed, arch);
    const cands = generatePlan(arch, mn.needs, seed, GENERATED);
    const ranked = rankPlans(cands, (p) => scorePlan(p, arch, mn.needs), seed).slice(0, KEEP_GENERATED);
    generated = ranked.map((plan) => {
      const hints: Record<string, string> = {};
      for (const [ch, room] of Object.entries(plan.rooms)) { const t = room.tags?.find((x) => x.startsWith('need:')); if (!t) continue; const node = mn.nodeOfNeed[Number(t.slice(5))]; if (node) hints[node.id] = ch; }
      return { plan, hints };
    });
  } catch { generated = []; }
  const auth: PlanChoice[] = authored.map((plan) => ({ plan }));
  if (!auth.length) return generated.concat(authoredAll.filter((p) => rooms(p) < need).map((plan) => ({ plan })));   // too-small plans last: mapMission rejects them fast
  if (!generated.length) return auth;
  return rng.chance(0.5) ? auth.concat(generated) : generated.concat(auth);
}

export function embedPlan(g: MissionGraph, seed: number, arch: Archetype, extra: FloorPlan[] = []): EmbeddedLayout | null {
  const order = choosePlan(arch, g, seed, extra);
  if (!order.length) return null;
  for (const { plan, hints } of order) {
    const variants = plan.variants ? 3 : 1;
    for (let v = 0; v < variants; v++) {
      const varied = applyVariants(plan, sub(seed, plan.id, v));
      let parsed; try { parsed = parsePlan(varied); } catch { break; }
      const m = mapMission(parsed, g, arch, new Rng((seed ^ (v * 7919)) >>> 0), hints);
      if (!m.ok) continue;
      const layout = planToLayout(parsed, m.assign, m.locks, arch, seed, { graph: g, secrets: m.secrets });
      lastPlanId = plan.id; lastSource = plan.source === 'authored' ? 'authored' : 'generated';
      // the start sits 2.5 u off the exterior wall; a 2.2-u body plus a 0.5-u wall needs 3.5 — step 1.5 u inward
      const [fx, fz] = DIR16[layout.start.yaw]; layout.start = { ...layout.start, x: layout.start.x + fx * 1.5, z: layout.start.z + fz * 1.5 };
      return layout;
    }
  }
  return null;
}
