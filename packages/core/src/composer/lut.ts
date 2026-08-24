// src/engine/composer/lut.ts — 16 compass directions as constants so the planner never calls trig
// (bun and node disagree in the last bits of Math.sin; the plan must be byte-identical across runtimes).
import type { Dir16 } from './types';
/** (dx, dz) unit offsets, index = Dir16; 0 = +z (south on screen), counter-clockwise. Rounded to 4 decimals — a constant, not a computation. */
export const DIR16: readonly [dx: number, dz: number][] = [
  [0, 1], [0.3827, 0.9239], [0.7071, 0.7071], [0.9239, 0.3827],
  [1, 0], [0.9239, -0.3827], [0.7071, -0.7071], [0.3827, -0.9239],
  [0, -1], [-0.3827, -0.9239], [-0.7071, -0.7071], [-0.9239, -0.3827],
  [-1, 0], [-0.9239, 0.3827], [-0.7071, 0.7071], [-0.3827, 0.9239],
];
/** Yaw in radians for a Dir16 (for the ENGINE side; the planner itself only stores the index). */
export const DIR16_YAW: readonly number[] = DIR16.map((_, i) => (i * Math.PI) / 8);
export const opposite = (d: Dir16): Dir16 => (((d + 8) % 16) as Dir16);
/** Quarter turns (rot 0..3) as Dir16 — wall props use these; doors too. */
export const QUARTER: readonly Dir16[] = [0, 4, 8, 12];
/** Dir16 of the vector (dx, dz) — nearest of the 16 without atan2: compare against the LUT by dot product. */
export function dirOf(dx: number, dz: number): Dir16 {
  let best = 0, bestDot = -Infinity;
  for (let i = 0; i < 16; i++) { const d = DIR16[i][0] * dx + DIR16[i][1] * dz; if (d > bestDot) { bestDot = d; best = i; } }
  return best as Dir16;
}
/** Mirror a Dir16 across the x axis (dx → −dx). */
export const mirrorX = (d: Dir16): Dir16 => (((16 - d) % 16) as Dir16);
