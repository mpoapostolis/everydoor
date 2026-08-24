// src/engine/composer/rng.ts — seeded, integer-only randomness for the planner.
// Everything the composer draws comes from hash32(seed, ...tags) → mulberry32, so two
// clients (or a save and a resume) derive the SAME plan from the same inputs. No Math.random.
export function hash32(seed: number, ...tags: (string | number)[]): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (const t of tags) {
    const s = String(t);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  }
  return h >>> 0;
}
export function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export class Rng {
  readonly next: () => number;
  constructor(readonly seed: number) { this.next = mulberry32(seed); }
  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** Fisher–Yates copy. */
  shuffle<T>(arr: readonly T[]): T[] { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  /** Weighted pick; weights ≥ 0. */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0; for (const it of items) total += Math.max(0, weight(it));
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, weight(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
}
/** A child generator for one named stage: sub(seed, 'mission'), sub(seed, zone.id, 'furnish'). */
export const sub = (seed: number, ...tags: (string | number)[]): Rng => new Rng(hash32(seed, ...tags));
