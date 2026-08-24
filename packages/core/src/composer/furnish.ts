// src/engine/composer/furnish.ts — FURNISHING + SPOTS + DEFAULT PEOPLE (design §4.5).
// Per zone: an occupancy grid at 0.5 u, door keep-outs + an L-lane, quest anchors, recipe anchors
// by tag, satellites, wall packing, surfaces, clutter, guarantees, spots, dilated-connectivity
// validation with repair, best of K = 3 candidates. Plan-only: no three.js, no DOM, no
// `Math` randomness, no trig — the only import outside composer/ is the prop library's pure metadata.
//
// This is the expensive stage (≈ 90% of compose), so it is written around one idea: almost nothing here
// actually depends on what has been placed. The lane, its distance transform, its row runs, the door
// records, the shell boxes over the rect and the 1-u lattice of yaws are all functions of the ZONE, so
// they are computed once and shared by all K candidates, every repair rebuild and every walker (see
// ZoneShare and LaneShare). What does depend on the placements — "may this footprint go here?" — is
// answered off summed-area tables over the occupancy classes, each rebuilt lazily and only from the
// lowest cell a stamp touched. Every one of those caches is an exact restatement of the direct scan it
// replaced: furnish() must stay byte-identical (tests/composer-snapshot.test.mjs, composer-perf).
import type { Archetype, Dir16, Door, EmbeddedLayout, FurnishOpts, FurnishResult, PlaceReq, Person, Placement, RoomRecipe, SemanticMap, Spot, Zone } from './types';
import { sub, type Rng } from './rng';
import { DIR16, dirOf } from './lut';
import { propMeta, propsWithTag } from '../props/library';
import type { PropDef } from '../props/types';
import { dressRooms, type DressContext, type DressZone, type PlaceOpts } from './dressing';
import { castPeople, type CastContext } from './people';
import type { StoryBrief } from './story';

// ---------------------------------------------------------------------------
// Constants + small integer geometry
// ---------------------------------------------------------------------------
const RES = 0.5;                       // u per occupancy cell
/** KEEPOUT = door fans/gaps (nothing goes there); CLEAR = prop front clearance + wall gaps (satellites may); ARENA = boss disc (cover pillars may). */
const FREE = 0, BLOCKED = 1, KEEPOUT = 2, DECOR = 3, CLEAR = 4, ARENA = 5;
type Allow = 'none' | 'clear' | 'arena';
const DOOR_FAN_R = 2;                  // u
const DOOR_GAP_DEPTH = 3;              // u, both sides of every door
const LANE_HALF = 1.5;                 // u → lane ≥ 3 u wide
const LANE_MARGIN_CELLS = 2;           // blocking footprints keep 1 u off the lane
const DILATE_CELLS2 = 9;               // (1.5 u / RES)² — passable iff no BLOCKED cell within 1.5 u
/** Half-width of the dilation disc on each row dj = −3…3 — the disc as 7 contiguous runs, so it stamps with fill(). */
const DILATE_ROW: readonly number[] = Array.from({ length: 7 }, (_, k) => { const dj = k - 3; let w = -1; for (let di = 0; di * di + dj * dj <= DILATE_CELLS2; di++) w = di; return w; });
const NPC_R = 2.2, HIDE_R = 1.4;
const K_CANDIDATES = 3;
const LIGHT_COLOR: Record<RoomRecipe['light'], number> = { torch: 0xffa040, lamp: 0xffe0b0, panel: 0xc0e0ff, candle: 0xffc060, none: 0 };
const ROLE_PRIO: Record<Placement['role'], number> = { shell: 9, quest: 5, anchor: 4, satellite: 3, wall: 2, surface: 1, clutter: 1 };

/** Walls of a zone rect: 0 north (z = z0), 1 east (x = x1), 2 south (z = z1), 3 west (x = x0); inward normal + the yaw facing inward. */
const WALLS: readonly { ix: number; iz: number; yaw: Dir16 }[] = [
  { ix: 0, iz: 1, yaw: 0 }, { ix: -1, iz: 0, yaw: 12 }, { ix: 0, iz: -1, yaw: 8 }, { ix: 1, iz: 0, yaw: 4 },
];
/** Prop-local quarter turn q (voxel.ts rotPrim: CCW about +y, (x, z) → (−z, x)) → the Dir16 its +z front faces. */
const QUARTER_YAW: readonly Dir16[] = [0, 12, 8, 4];
const yawToQuarter = (yaw: Dir16): number => QUARTER_YAW.indexOf(yaw);
/** Snap any Dir16 to the nearest quarter turn (ties toward the lower index) — precomputed, 16 answers. */
function snapQuarterOf(d: Dir16): Dir16 {
  let best: Dir16 = 0, bestDot = -Infinity;
  for (const q of QUARTER_YAW) { const dot = DIR16[q][0] * DIR16[d][0] + DIR16[q][1] * DIR16[d][1]; if (dot > bestDot) { bestDot = dot; best = q; } }
  return best;
}
const SNAP_QUARTER: readonly Dir16[] = Array.from({ length: 16 }, (_, d) => snapQuarterOf(d as Dir16));
const snapQuarter = (d: Dir16): Dir16 => SNAP_QUARTER[d];
/** Rotate a prop-local offset by q quarter turns (integer-exact). */
function rotLocal(dx: number, dz: number, q: number): [number, number] {
  let x = dx, z = dz;
  for (let i = 0; i < ((q % 4) + 4) % 4; i++) { const nx = -z; z = x; x = nx; }
  return [x, z];
}
/** dirOf with a stable answer for the zero vector. */
const dirTo = (dx: number, dz: number): Dir16 => (dx === 0 && dz === 0 ? 0 : dirOf(dx, dz));
const facingOf = (yaw: Dir16): [number, number] => [DIR16[yaw][0], DIR16[yaw][1]];

interface Rect { x0: number; z0: number; x1: number; z1: number }
const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
function dist2ToRect(x: number, z: number, r: Rect): number {
  const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
  const dz = z < r.z0 ? r.z0 - z : z > r.z1 ? z - r.z1 : 0;
  return dx * dx + dz * dz;
}

// ---------------------------------------------------------------------------
// Internal placement + occupancy
// ---------------------------------------------------------------------------
interface Pl {
  id: number; prop: string; def: PropDef; x: number; y: number; z: number; yaw: Dir16;
  fw: number; fd: number;                 // rotated footprint: x extent, z extent
  along: number; across: number;          // extent along the facing axis / across it
  blocking: boolean; role: Placement['role']; parent?: number; clearFront: number;
  aabb: Rect;
}
interface DoorInfo { door: Door; wall: number; px: number; pz: number; ix: number; iz: number; yaw: Dir16; w: number; inner: [number, number] }

/** Shared per-lane derivatives (see Occ.laneShare) — a tiny MRU keyed by the lane bitmap itself. */
interface LaneShare { x0: number; z0: number; W: number; H: number; lane: Uint8Array; edt?: Int32Array; runs?: [number, number][][]; sat?: Int32Array }
const LANE_SHARE_MAX = 4;
const LANE_SHARE: LaneShare[] = [];

class Occ {
  readonly W: number; readonly H: number;
  readonly state: Uint8Array; readonly lane: Uint8Array;
  constructor(readonly x0: number, readonly z0: number, readonly x1: number, readonly z1: number) {
    this.W = Math.max(1, Math.round((x1 - x0) / RES)); this.H = Math.max(1, Math.round((z1 - z0) / RES));
    this.state = new Uint8Array(this.W * this.H); this.lane = new Uint8Array(this.W * this.H);
  }
  idx(i: number, j: number): number { return j * this.W + i; }
  inside(i: number, j: number): boolean { return i >= 0 && j >= 0 && i < this.W && j < this.H; }
  cx(i: number): number { return this.x0 + (i + 0.5) * RES; }
  cz(j: number): number { return this.z0 + (j + 0.5) * RES; }
  /** Cell index range covering a world rect (inclusive), written into ci0/cj0/ci1/cj1 (no array allocated). */
  private ci0 = 0; private cj0 = 0; private ci1 = 0; private cj1 = 0;
  private cellsInto(r: Rect): void {
    this.ci0 = Math.floor((r.x0 - this.x0) / RES + 1e-9); this.cj0 = Math.floor((r.z0 - this.z0) / RES + 1e-9);
    this.ci1 = Math.ceil((r.x1 - this.x0) / RES - 1e-9) - 1; this.cj1 = Math.ceil((r.z1 - this.z0) / RES - 1e-9) - 1;
  }
  /** Cell index range covering a world rect (inclusive). */
  cells(r: Rect): [number, number, number, number] {
    this.cellsInto(r); return [this.ci0, this.cj0, this.ci1, this.cj1];
  }
  rectInside(r: Rect): boolean { return r.x0 >= this.x0 - 1e-9 && r.z0 >= this.z0 - 1e-9 && r.x1 <= this.x1 + 1e-9 && r.z1 <= this.z1 + 1e-9; }
  /** Mark every cell whose centre is within r of (x, z). */
  disc(x: number, z: number, r: number, s: number, onlyFree = true): void {
    this.cellsInto({ x0: x - r, z0: z - r, x1: x + r, z1: z + r });
    const ja = Math.max(0, this.cj0), jb = Math.min(this.H - 1, this.cj1), ia = Math.max(0, this.ci0), ib = Math.min(this.W - 1, this.ci1);
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      const dx = this.cx(i) - x, dz = this.cz(j) - z;
      if (dx * dx + dz * dz <= r * r && (!onlyFree || this.state[this.idx(i, j)] === FREE)) this.state[this.idx(i, j)] = s;
    }
    this.touch(ia, ja, ib, jb);
  }
  fillRect(r: Rect, s: number, onlyFree = true): void {
    this.cellsInto(r);
    const ja = Math.max(0, this.cj0), jb = Math.min(this.H - 1, this.cj1), ia = Math.max(0, this.ci0), ib = Math.min(this.W - 1, this.ci1);
    for (let j = ja; j <= jb; j++) { const row = j * this.W; for (let i = ia; i <= ib; i++) { const k = row + i; if (!onlyFree || this.state[k] === FREE) this.state[k] = s; } }
    this.touch(ia, ja, ib, jb);
  }
  laneRect(r: Rect): void {
    this.cellsInto(r);
    const ja = Math.max(0, this.cj0), jb = Math.min(this.H - 1, this.cj1), ia = Math.max(0, this.ci0), ib = Math.min(this.W - 1, this.ci1);
    for (let j = ja; j <= jb; j++) { const row = j * this.W; for (let i = ia; i <= ib; i++) this.lane[row + i] = 1; }
    this.runs = undefined; this.edt = undefined;
    if (ia <= ib && ja <= jb) { this.laneVer++; if (ia < this.laneDirtyI) this.laneDirtyI = ia; if (ja < this.laneDirtyJ) this.laneDirtyJ = ja; }
    this.touch(ia, ja, ib, jb);                            // the lane feeds canPlace's margin test
  }
  private runs?: [number, number][][];
  private edt?: Int32Array;
  /** The lane derives from the zone rect + its doors, so every candidate and every repair rebuild re-stamps
   *  exactly the same bitmap; the distance transform and the row runs are shared across those Occ instances
   *  (looked up by an exact byte compare, so a different lane can never pick up a stale answer). */
  private laneShare(): LaneShare {
    for (let n = 0; n < LANE_SHARE.length; n++) {
      const e = LANE_SHARE[n];
      if (e.W !== this.W || e.H !== this.H || e.x0 !== this.x0 || e.z0 !== this.z0) continue;
      const a = e.lane, b = this.lane; let same = true;
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) { same = false; break; }
      if (!same) continue;
      if (n) { LANE_SHARE.splice(n, 1); LANE_SHARE.unshift(e); }
      return e;
    }
    const e: LaneShare = { x0: this.x0, z0: this.z0, W: this.W, H: this.H, lane: this.lane.slice() };
    LANE_SHARE.unshift(e); if (LANE_SHARE.length > LANE_SHARE_MAX) LANE_SHARE.length = LANE_SHARE_MAX;
    return e;
  }
  /** Squared distance (in cells) from every cell to the nearest lane cell — exact Euclidean distance transform
   *  (Felzenszwalb–Huttenlocher, two separable passes), cached until the lane changes. */
  laneEdt(): Int32Array {
    if (this.edt) return this.edt;
    const share = this.laneShare(); if (share.edt) return (this.edt = share.edt);
    const W = this.W, H = this.H, INF = 1 << 28, N = Math.max(W, H);
    const f = new Int32Array(W * H); for (let k = 0; k < W * H; k++) f[k] = this.lane[k] ? 0 : INF;
    const g = new Int32Array(W * H);
    const v = new Int32Array(N), zb = new Float64Array(N + 1), fin = new Int32Array(N), out = new Int32Array(N);
    const dt1d = (n: number): void => {
      let k = 0; v[0] = 0; zb[0] = -Infinity; zb[1] = Infinity;
      for (let q = 1; q < n; q++) {
        let sI = ((fin[q] + q * q) - (fin[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (sI <= zb[k]) { k--; sI = ((fin[q] + q * q) - (fin[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; zb[k] = sI; zb[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < n; q++) { while (zb[k + 1] < q) k++; out[q] = (q - v[k]) * (q - v[k]) + fin[v[k]]; }
    };
    for (let i = 0; i < W; i++) { for (let j = 0; j < H; j++) fin[j] = f[j * W + i]; dt1d(H); for (let j = 0; j < H; j++) g[j * W + i] = out[j]; }
    for (let j = 0; j < H; j++) { for (let i = 0; i < W; i++) fin[i] = g[j * W + i]; dt1d(W); for (let i = 0; i < W; i++) g[j * W + i] = Math.min(out[i], INF); }
    share.edt = g;
    return (this.edt = g);
  }
  /** Lane cells per row as inclusive [i0, i1] runs (cached until the lane changes). */
  laneRuns(): [number, number][][] {
    if (this.runs) return this.runs;
    const share = this.laneShare(); if (share.runs) return (this.runs = share.runs);
    const rows: [number, number][][] = [];
    for (let j = 0; j < this.H; j++) {
      const r: [number, number][] = []; let a = -1;
      for (let i = 0; i <= this.W; i++) { const on = i < this.W && this.lane[this.idx(i, j)] === 1; if (on && a < 0) a = i; else if (!on && a >= 0) { r.push([a, i - 1]); a = -1; } }
      rows.push(r);
    }
    share.runs = rows;
    return (this.runs = rows);
  }
  /** Can a footprint go here? Blocking: all cells FREE, off the lane (+ margin) and inside; decor: no BLOCKED cell. */
  canPlace(r: Rect, blocking: boolean, allow: Allow = 'none'): boolean {
    if (!this.rectInside(r)) return false;
    this.cellsInto(r); const i0 = this.ci0, j0 = this.cj0, i1 = this.ci1, j1 = this.cj1;
    const st = this.state, W = this.W;
    for (let j = j0; j <= j1; j++) { const row = j * W; for (let i = i0; i <= i1; i++) {
      const s = st[row + i];
      if (s === BLOCKED || s === KEEPOUT) return false;
      if (s === CLEAR && allow !== 'clear') return false;
      if (s === ARENA && allow !== 'arena') return false;
      if (blocking && s === DECOR) return false;
    } }
    if (blocking) {                                   // the margin ring includes the footprint itself
      const m = LANE_MARGIN_CELLS, ln = this.lane;
      const ja = Math.max(0, j0 - m), jb = Math.min(this.H - 1, j1 + m), ia = Math.max(0, i0 - m), ib = Math.min(W - 1, i1 + m);
      for (let j = ja; j <= jb; j++) { const row = j * W; for (let i = ia; i <= ib; i++) if (ln[row + i]) return false; }
    }
    return true;
  }
  // ---- summed-area tables ---------------------------------------------------------------------
  // One SAT per cell CLASS (the classes are disjoint, so any `bad` mask is a sum of them). They depend
  // only on `state` / `lane`, so they are rebuilt at most once per mutation instead of once per slot
  // scan, and the buffers are reused. The answers are identical to canPlace()/clearOk() by construction.
  private ver = 0; private laneVer = 0;
  /** Per-table: the version it was built at, and the lowest cell touched since — prefix sums left of / above
   *  that corner cannot have changed, so each rebuild only redoes the bottom-right block. Each class table is
   *  built on demand: a scan for a blocking prop with no clearance only ever touches `nf` and the lane. */
  private nfVer = -1; private nfI = 0; private nfJ = 0; private satNF?: Int32Array;   // any non-FREE cell
  private deVer = -1; private deI = 0; private deJ = 0; private satDe?: Int32Array;   // DECOR
  private blRow?: Int32Array; private blStale?: Uint8Array;                           // BLOCKED, one prefix sum PER ROW
  private rareVer = -1; private satCl?: Int32Array; private satAr?: Int32Array;       // CLEAR / ARENA: only a non-default `allow` reads these
  private satLaneVer = -1; private laneDirtyI = 0; private laneDirtyJ = 0; private satLn?: Int32Array;
  private touch(ia: number, ja: number, ib: number, jb: number): void {
    if (ia > ib || ja > jb) return;
    this.ver++;
    if (ia < this.nfI) this.nfI = ia; if (ja < this.nfJ) this.nfJ = ja;
    if (ia < this.deI) this.deI = ia; if (ja < this.deJ) this.deJ = ja;
    const bs = this.blStale; if (bs) for (let j = ja; j <= jb; j++) bs[j] = 1;
  }
  private ensureNF(): Int32Array {
    const W = this.W, H = this.H, S = W + 1;
    const t = (this.satNF ??= new Int32Array(S * (H + 1)));
    if (this.nfVer === this.ver) return t;
    const st = this.state, i0 = this.nfI;
    for (let j = this.nfJ; j < H; j++) { const row = j * W, k0 = (j + 1) * S; for (let i = i0; i < W; i++) { const k = k0 + i + 1; t[k] = (st[row + i] === FREE ? 0 : 1) + t[k - 1] + t[k - S] - t[k - S - 1]; } }
    this.nfVer = this.ver; this.nfI = W; this.nfJ = H; return t;
  }
  private ensureDe(): Int32Array {
    const W = this.W, H = this.H, S = W + 1;
    const t = (this.satDe ??= new Int32Array(S * (H + 1)));
    if (this.deVer === this.ver) return t;
    const st = this.state, i0 = this.deI;
    for (let j = this.deJ; j < H; j++) { const row = j * W, k0 = (j + 1) * S; for (let i = i0; i < W; i++) { const k = k0 + i + 1; t[k] = (st[row + i] === DECOR ? 1 : 0) + t[k - 1] + t[k - S] - t[k - S - 1]; } }
    this.deVer = this.ver; this.deI = W; this.deJ = H; return t;
  }
  private ensureRareSats(): void {
    const W = this.W, H = this.H, S = W + 1, N = S * (H + 1);
    if (!this.satCl) { this.satCl = new Int32Array(N); this.satAr = new Int32Array(N); }
    if (this.rareVer === this.ver) return;
    const cl = this.satCl, ar = this.satAr!, st = this.state;
    for (let j = 0; j < H; j++) {
      const row = j * W, k0 = (j + 1) * S;
      for (let i = 0; i < W; i++) {
        const s = st[row + i], k = k0 + i + 1;
        cl[k] = (s === CLEAR ? 1 : 0) + cl[k - 1] + cl[k - S] - cl[k - S - 1];
        ar[k] = (s === ARENA ? 1 : 0) + ar[k - 1] + ar[k - S] - ar[k - S - 1];
      }
    }
    this.rareVer = this.ver;
  }
  private ensureLaneSat(): void {
    if (this.satLaneVer === this.laneVer && this.satLn) return;
    const share = this.laneShare();
    if (share.sat) { this.satLn = share.sat; this.satLaneVer = this.laneVer; this.laneDirtyI = this.W; this.laneDirtyJ = this.H; return; }
    const W = this.W, H = this.H, S = W + 1;
    const ln = (this.satLn ??= new Int32Array(S * (H + 1)));
    for (let j = this.laneDirtyJ; j < H; j++) { const row = j * W, k0 = (j + 1) * S; for (let i = this.laneDirtyI; i < W; i++) { const k = k0 + i + 1; ln[k] = this.lane[row + i] + ln[k - 1] + ln[k - S] - ln[k - S - 1]; } }
    this.satLaneVer = this.laneVer; this.laneDirtyI = W; this.laneDirtyJ = H; share.sat = ln;
  }
  private sum(t: Int32Array, i0: number, j0: number, i1: number, j1: number): number {
    const S = this.W + 1;
    if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0;
    if (i1 > this.W - 1) i1 = this.W - 1; if (j1 > this.H - 1) j1 = this.H - 1;
    if (i0 > i1 || j0 > j1) return 0;
    return t[(j1 + 1) * S + (i1 + 1)] - t[j0 * S + (i1 + 1)] - t[(j1 + 1) * S + i0] + t[j0 * S + i0];
  }
  /** canPlace() answered off the tables — same predicate, O(1) per rect (the slot scans). */
  canPlaceSat(r: Rect, blocking: boolean, allow: Allow): boolean {
    if (!this.rectInside(r)) return false;
    this.cellsInto(r);
    return this.canPlaceCells(this.ci0, this.cj0, this.ci1, this.cj1, blocking, allow);
  }
  /** canPlaceSat() for a footprint already converted to inclusive cells INSIDE the grid — the slot scans walk a
   *  lattice and convert once per point instead of building a Rect per point (castle: ~5 % of compose()). */
  canPlaceCells(ci0: number, cj0: number, ci1: number, cj1: number, blocking: boolean, allow: Allow): boolean {
    const nf = this.ensureNF();
    const S = this.W + 1, i0 = ci0, j0 = cj0, i1 = ci1 + 1, j1 = cj1 + 1;
    const kA = j1 * S + i1, kB = j0 * S + i1, kC = j1 * S + i0, kD = j0 * S + i0;
    // the cell classes are disjoint, so `bad` = every non-FREE cell minus the ones this call tolerates
    let bad = nf[kA] - nf[kB] - nf[kC] + nf[kD];
    if (bad > 0 && !blocking) { const de = this.ensureDe(); bad -= de[kA] - de[kB] - de[kC] + de[kD]; }
    if (bad > 0 && allow !== 'none') { this.ensureRareSats(); const t = allow === 'clear' ? this.satCl! : this.satAr!; bad -= t[kA] - t[kB] - t[kC] + t[kD]; }
    if (bad > 0) return false;
    if (blocking) { this.ensureLaneSat(); const m = LANE_MARGIN_CELLS; if (this.sum(this.satLn!, i0 - m, j0 - m, i1 - 1 + m, j1 - 1 + m) > 0) return false; }
    return true;
  }
  /** clearOk() answered off per-row prefix sums of BLOCKED. Front-clearance strips are only tested for the
   *  footprints that already passed canPlace, so this table is read rarely and dirtied often — a row that a
   *  stamp did not touch stays valid, which makes a rebuild cost the handful of rows a prop actually covers. */
  clearOkSat(r: Rect): boolean {
    const W = this.W, H = this.H, S = W + 1;
    if (!this.blRow) { this.blRow = new Int32Array(H * S); this.blStale = new Uint8Array(H).fill(1); }
    this.cellsInto(r);
    let i0 = this.ci0, j0 = this.cj0, i1 = this.ci1, j1 = this.cj1;
    if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0; if (i1 > W - 1) i1 = W - 1; if (j1 > H - 1) j1 = H - 1;
    if (i0 > i1 || j0 > j1) return true;
    const t = this.blRow, st = this.state, stale = this.blStale!;
    for (let j = j0; j <= j1; j++) {
      const k0 = j * S;
      if (stale[j]) { const row = j * W; let acc = 0; t[k0] = 0; for (let i = 0; i < W; i++) { if (st[row + i] === BLOCKED) acc++; t[k0 + i + 1] = acc; } stale[j] = 0; }
      if (t[k0 + i1 + 1] - t[k0 + i0] > 0) return false;
    }
    return true;
  }
  /** Front clearance strip must be walkable (no BLOCKED cell) — KEEPOUT and lane are fine. */
  clearOk(r: Rect): boolean {
    this.cellsInto(r); const i0 = this.ci0, j0 = this.cj0, i1 = this.ci1, j1 = this.cj1;
    for (let j = Math.max(0, j0); j <= Math.min(this.H - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.W - 1, i1); i++) if (this.state[this.idx(i, j)] === BLOCKED) return false;
    return true;
  }
  isLaneAt(x: number, z: number): boolean {
    const i = Math.floor((x - this.x0) / RES), j = Math.floor((z - this.z0) / RES);
    return this.inside(i, j) && this.lane[this.idx(i, j)] === 1;
  }
  stateAt(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / RES), j = Math.floor((z - this.z0) / RES);
    return this.inside(i, j) ? this.state[this.idx(i, j)] : BLOCKED;
  }
}

// ---------------------------------------------------------------------------
// Per-zone context
// ---------------------------------------------------------------------------
interface Ctx {
  zone: Zone; recipe: RoomRecipe; arch: Archetype; rng: Rng; layout: EmbeddedLayout;
  doors: DoorInfo[]; cx: number; cz: number; side: number; longestWall: number;
  occ: Occ; pls: Pl[]; nextId: number; anchorsOnly: boolean;
  lights: SemanticMap['lights']; keys: SemanticMap['keys'];
  spotsOut: Zone['spots'];
  /** Clutter density multiplier the dressing hook may lower (1 = the recipe's own). */
  clutterMul: number;
  /** layout colliders on this floor that overlap the zone rect (lazy; the only ones standable() can hit). */
  zoneCols?: Rect[];
  /** floorSlots' 1-u lattice yaws — they depend only on the rect and the centre, so every scan reuses them. */
  yawGrid?: { x0: number; z0: number; nx: number; nz: number; g: Int8Array };
  /** standable()'s blocking boxes (props + shell), rebuilt only when c.pls changes. */
  sbFor?: Pl[]; sbN?: number; sbBoxes?: Rect[];
  /** laneStands' candidate cells in centre-first order — lane, doors and rect are fixed for the zone. */
  laneCand?: { x: Float64Array; z: Float64Array };
}

/** Everything a zone implies before a single prop is placed: its doors, the shell boxes over its rect, the
 *  floorSlots lattice and the laneStands candidate order. None of it depends on what gets furnished, so the
 *  K candidates, every repair rebuild and every walker share one copy (keyed by the Zone object itself, so a
 *  re-seeded layout — which builds new Zones — never sees a stale entry). */
interface ZoneShare { doors?: DoorInfo[]; cols?: Rect[]; yawGrid?: { x0: number; z0: number; nx: number; nz: number; g: Int8Array }; laneCand?: { x: Float64Array; z: Float64Array } }
const ZONE_SHARE = new WeakMap<Zone, ZoneShare>();
function shareOf(zone: Zone): ZoneShare { let e = ZONE_SHARE.get(zone); if (!e) { e = {}; ZONE_SHARE.set(zone, e); } return e; }

function doorInfos(zone: Zone, layout: EmbeddedLayout): DoorInfo[] {
  const share = shareOf(zone); if (share.doors) return share.doors;
  const r = zone.rect; const out: DoorInfo[] = [];
  const byId = new Map<string, Door>(); for (const d of layout.doors) if (!byId.has(d.id)) byId.set(d.id, d);   // first wins, as .find() did
  for (const id of zone.doors) {
    const door = byId.get(id); if (!door) continue;
    const dist = [Math.abs(door.z - r.z0), Math.abs(door.x - r.x1), Math.abs(door.z - r.z1), Math.abs(door.x - r.x0)];
    let wall = 0; for (let k = 1; k < 4; k++) if (dist[k] < dist[wall]) wall = k;
    const w = WALLS[wall];
    const px = wall === 1 ? r.x1 : wall === 3 ? r.x0 : Math.min(r.x1, Math.max(r.x0, door.x));
    const pz = wall === 0 ? r.z0 : wall === 2 ? r.z1 : Math.min(r.z1, Math.max(r.z0, door.z));
    out.push({ door, wall, px, pz, ix: w.ix, iz: w.iz, yaw: w.yaw, w: door.w, inner: [px + w.ix * 0.75, pz + w.iz * 0.75] });
  }
  return (share.doors = out);
}

function defaultRecipe(zone: Zone): RoomRecipe {
  const bare = zone.role === 'corridor' || zone.kind === 'corridor';
  return bare
    ? { kind: zone.kind, size: [2, 2], anchors: [], wallItems: { tags: [], density: 0 }, clutter: { tags: [], perCell: 0, minDoorDist: 2 }, light: 'lamp', hideMin: 0, lootMin: 0, npcStand: false, people: { n: [0, 0], roles: [] } }
    : { kind: zone.kind, size: [3, 5], anchors: [{ tag: 'surface', n: [0, 1], place: 'wall' }], wallItems: { tags: ['storage', 'surface'], density: 0.3 }, clutter: { tags: ['clutter'], perCell: 0.05, minDoorDist: 2 }, light: 'lamp', hideMin: 1, lootMin: 1, npcStand: true, people: { n: [0, 1], roles: ['resident'] } };
}

const makePl = (c: Ctx, def: PropDef, x: number, z: number, yaw: Dir16, role: Placement['role'], parent?: number): Pl => {
  const m = propMeta(def.id); const along = m.d, across = m.w;
  const fw = yaw % 8 === 0 ? across : along, fd = yaw % 8 === 0 ? along : across;
  return { id: c.nextId++, prop: def.id, def, x, y: c.zone.floorY, z, yaw, fw, fd, along, across, blocking: def.blocking, role, parent,
    clearFront: def.clearance?.front ?? 0, aabb: { x0: x - fw / 2, z0: z - fd / 2, x1: x + fw / 2, z1: z + fd / 2 } };
};
function frontRect(p: Pl, depth: number, minWidth = 0): Rect {
  const [fx, fz] = facingOf(p.yaw); const half = Math.max(p.across, minWidth) / 2;
  const ax = p.x + fx * (p.along / 2 + depth / 2), az = p.z + fz * (p.along / 2 + depth / 2);
  const ex = fx === 0 ? half : depth / 2, ez = fz === 0 ? half : depth / 2;
  return { x0: ax - ex, z0: az - ez, x1: ax + ex, z1: az + ez };
}
/** Where a hero stands to use a prop: ≥ 2.3 u off the face. The dilation is measured from BLOCKED cell
 *  centres, which sit up to RES beyond the footprint, so 1.5 u + RES + a half-cell of slack is the minimum
 *  that passes regardless of how the footprint lands on the 0.5 u lattice (1.8 failed one placement in two
 *  and repair() then emptied the room). */
const targetDepth = (p: Pl): number => Math.max(2.3, p.clearFront);
/** The strip a prop's use point needs free of BLOCKED cells: out to the use point plus the dilation radius (and as wide), so a
 *  placement that passes here is never dropped by validateZone/repair for its own front. */
const DILATE_R = 1.5;
const useRect = (p: Pl): Rect => frontRect(p, targetDepth(p) + DILATE_R + RES, p.across + 2 * (DILATE_R + RES));
/** useRect() for a footprint that has no Pl yet — one scratch object, so the slot scans allocate nothing. */
const SCRATCH_PL = { x: 0, z: 0, yaw: 0, along: 0, across: 0, clearFront: 0 } as unknown as Pl;
function useRectOf(x: number, z: number, yaw: Dir16, along: number, across: number, clearFront: number): Rect {
  const p = SCRATCH_PL; p.x = x; p.z = z; p.yaw = yaw; p.along = along; p.across = across; p.clearFront = clearFront;
  return useRect(p);
}
/** The strip kept free of other furniture in front of a prop: the use point plus a standing radius (+0.25 cell slack), ≥ 4.6 u wide. */
const clearDepth = (p: Pl): number => Math.max(targetDepth(p), NPC_R + 0.1) + NPC_R + 0.3;
const CLEAR_MIN_W = 2 * NPC_R + 0.3;
const frontPoint = (p: Pl, extra: number): [number, number] => { const [fx, fz] = facingOf(p.yaw); return [p.x + fx * (p.along / 2 + extra), p.z + fz * (p.along / 2 + extra)]; };
const backPoint = (p: Pl, extra: number): [number, number] => { const [fx, fz] = facingOf(p.yaw); return [p.x - fx * (p.along / 2 + extra), p.z - fz * (p.along / 2 + extra)]; };

/** Stamp a placement into the grid; blocking ones also keep their front clearance walkable-only. */
function stamp(c: Ctx, p: Pl): void {
  c.occ.fillRect(p.aabb, p.blocking ? BLOCKED : DECOR, !p.blocking);
  if (p.blocking && p.clearFront > 0 && p.role !== 'satellite') c.occ.fillRect(frontRect(p, clearDepth(p), CLEAR_MIN_W), CLEAR);
}
function tryAdd(c: Ctx, p: Pl, allow: Allow = 'none'): boolean {
  if (!c.occ.canPlace(p.aabb, p.blocking, allow)) return false;
  if (p.blocking && p.clearFront > 0 && !c.occ.clearOk(useRect(p))) return false;
  stamp(c, p); c.pls.push(p); return true;
}

// ---------------------------------------------------------------------------
// Library queries (pure metadata only)
// ---------------------------------------------------------------------------
const byTags = (tags: readonly string[], filter?: (d: PropDef) => boolean): PropDef[] => {
  const seen = new Set<string>(); const out: PropDef[] = [];
  for (const t of tags) for (const d of propsWithTag(t)) { if (seen.has(d.id)) continue; seen.add(d.id); if (!filter || filter(d)) out.push(d); }
  return out;
};
const isWallProp = (d: PropDef): boolean => d.place === 'wall';
const isFloorProp = (d: PropDef): boolean => d.place === 'floor' || d.place === 'outdoor' || d.place === 'corner';
const isSurfaceProp = (d: PropDef): boolean => d.place === 'surface';
const isQuestProp = (d: PropDef): boolean => d.tags.includes('key') || d.tags.includes('door') || d.tags.includes('lock') || d.interact === 'keyPedestal' || d.interact === 'lockedDoor' || d.interact === 'door';
const isLoot = (d: PropDef): boolean => !!d.loot;
/** What may stand under the open sky: nature props and outdoor-placed pieces (never the structure shell, never a sofa). */
const isOutdoorProp = (d: PropDef): boolean => d.family === 'nature' || (d.place === 'outdoor' && d.family !== 'structure');
const OUTDOOR_TAGS = new Set(['nature', 'outdoor', 'tree', 'rock', 'bush', 'log', 'mushroom']);
/** Props for a zone's tag list: indoors exactly byTags; under the open sky only outdoor props, with 'nature' / 'outdoor'
 *  tags opening the whole nature family (the recipes name those tags; the library tags trees as 'tree', rocks as 'rock'). */
function defsFor(c: Ctx, tags: readonly string[], filter: (d: PropDef) => boolean): PropDef[] {
  if (c.zone.ceilY !== undefined) return byTags(tags, filter);
  const out = byTags(tags, (d) => isOutdoorProp(d) && filter(d));
  if (tags.some((t) => OUTDOOR_TAGS.has(t))) { const seen = new Set(out.map((d) => d.id)); for (const d of propsWithTag('tree').concat(propsWithTag('rock'), propsWithTag('bush'), propsWithTag('log'), propsWithTag('mushroom'))) if (!seen.has(d.id) && isOutdoorProp(d) && filter(d)) { seen.add(d.id); out.push(d); } }
  return out;
}
const isHide = (d: PropDef): boolean => !!d.hide || (d.tags.includes('hide') && !d.blocking);

// ---------------------------------------------------------------------------
// Slot finding
// ---------------------------------------------------------------------------
interface Slot { x: number; z: number; yaw: Dir16; score: number }
function minDoorD2(c: Ctx, x: number, z: number): number { let m = Infinity; for (const d of c.doors) { const dx = x - d.px, dz = z - d.pz; m = Math.min(m, dx * dx + dz * dz); } return m; }
/** Squared distance (u) from the cell under (x, z) to the nearest lane cell, capped at maxR² — from the cached distance transform. */
function laneD2(c: Ctx, x: number, z: number, maxR = 6): number {
  const o = c.occ;
  const i = Math.min(o.W - 1, Math.max(0, Math.floor((x - o.x0) / RES))), j = Math.min(o.H - 1, Math.max(0, Math.floor((z - o.z0) / RES)));
  return Math.min(maxR * maxR, o.laneEdt()[j * o.W + i] * RES * RES);
}

/** The footprint / use strip a def would have at (x, z, yaw) — what makePl builds, without allocating a Pl. */
function footprintAt(def: PropDef, x: number, z: number, yaw: Dir16): { aabb: Rect; use: Rect | null } {
  const m = propMeta(def.id); const along = m.d, across = m.w;
  const fw = yaw % 8 === 0 ? across : along, fd = yaw % 8 === 0 ? along : across;
  const aabb: Rect = { x0: x - fw / 2, z0: z - fd / 2, x1: x + fw / 2, z1: z + fd / 2 };
  const clearFront = def.clearance?.front ?? 0;
  if (!def.blocking || clearFront <= 0) return { aabb, use: null };
  const p = { x, z, yaw, along, across, clearFront } as Pl;
  return { aabb, use: useRect(p) };
}
function wallSlots(c: Ctx, def: PropDef, focal: boolean, allow: Allow = 'none'): Slot[] {
  const m = propMeta(def.id); const r = c.zone.rect; const out: Slot[] = [];
  const occ = c.occ, blocking = def.blocking, along = m.d, across = m.w;
  const clearFront = def.clearance?.front ?? 0, needUse = blocking && clearFront > 0;
  const ox = occ.x0, oz = occ.z0, ox1 = occ.x1, oz1 = occ.z1;
  for (let k = 0; k < 4; k++) {
    const w = WALLS[k]; const horizontal = k === 0 || k === 2; const yaw = w.yaw;
    const fw = yaw % 8 === 0 ? across : along, fd = yaw % 8 === 0 ? along : across;
    const hw = fw / 2, hd = fd / 2;
    const t0 = (horizontal ? r.x0 : r.z0) + m.w / 2, t1 = (horizontal ? r.x1 : r.z1) - m.w / 2;
    const wallLen = horizontal ? r.x1 - r.x0 : r.z1 - r.z0;
    const fixed = horizontal ? (k === 0 ? r.z0 + m.d / 2 : r.z1 - m.d / 2) : (k === 1 ? r.x1 - m.d / 2 : r.x0 + m.d / 2);
    for (let t = t0; t <= t1 + 1e-9; t += RES) {
      const x = horizontal ? t : fixed, z = horizontal ? fixed : t;
      const bx0 = x - hw, bz0 = z - hd, bx1 = x + hw, bz1 = z + hd;   // == footprintAt(def, x, z, yaw).aabb, as cells (see floorSlots)
      if (!(bx0 >= ox - 1e-9 && bz0 >= oz - 1e-9 && bx1 <= ox1 + 1e-9 && bz1 <= oz1 + 1e-9)) continue;
      if (!occ.canPlaceCells(Math.floor((bx0 - ox) / RES + 1e-9), Math.floor((bz0 - oz) / RES + 1e-9), Math.ceil((bx1 - ox) / RES - 1e-9) - 1, Math.ceil((bz1 - oz) / RES - 1e-9) - 1, blocking, allow)) continue;
      if (needUse && !occ.clearOkSat(useRectOf(x, z, yaw, along, across, clearFront))) continue;
      let score = Math.min(minDoorD2(c, x, z), 400) / 10;
      if (focal && wallLen >= c.longestWall) score += 10;
      if (focal) score += Math.max(0, 6 - laneD2(c, x, z) / 4);
      out.push({ x, z, yaw, score });
    }
  }
  return out;
}
/** The 1-u lattice floorSlots walks, with the yaw each point faces — the same for every scan in a zone. */
function yawGridOf(c: Ctx): { x0: number; z0: number; nx: number; nz: number; g: Int8Array } {
  if (c.yawGrid) return c.yawGrid;
  const share = shareOf(c.zone); if (share.yawGrid) return (c.yawGrid = share.yawGrid);
  const r = c.zone.rect; const x0 = Math.ceil(r.x0) + 1, z0 = Math.ceil(r.z0) + 1;
  let nx = 0; for (let x = x0; x <= r.x1 - 1; x += 1) nx++;
  let nz = 0; for (let z = z0; z <= r.z1 - 1; z += 1) nz++;
  const g = new Int8Array(Math.max(0, nx * nz));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = snapQuarter(dirTo(c.cx - (x0 + i), c.cz - (z0 + j)));
  return (c.yawGrid = share.yawGrid = { x0, z0, nx, nz, g });
}
function floorSlots(c: Ctx, def: PropDef, focal: boolean, allow: Allow = 'none', nearLane = false): Slot[] {
  const out: Slot[] = [];
  const m = propMeta(def.id); const along = m.d, across = m.w;
  const occ = c.occ, blocking = def.blocking;
  const clearFront = def.clearance?.front ?? 0, needUse = blocking && clearFront > 0;
  const lat = yawGridOf(c);
  const ox = occ.x0, oz = occ.z0, ox1 = occ.x1, oz1 = occ.z1;
  for (let j = 0; j < lat.nz; j++) for (let i = 0; i < lat.nx; i++) {
    const x = lat.x0 + i, z = lat.z0 + j;
    const yaw = lat.g[j * lat.nx + i] as Dir16;
    const fw = yaw % 8 === 0 ? across : along, fd = yaw % 8 === 0 ? along : across;
    // the footprint makePl would build, as the cells canPlaceSat would test — the same expressions as
    // rectInside() / cellsInto(), written out so the scan neither allocates nor re-derives them per point
    const bx0 = x - fw / 2, bz0 = z - fd / 2, bx1 = x + fw / 2, bz1 = z + fd / 2;
    if (!(bx0 >= ox - 1e-9 && bz0 >= oz - 1e-9 && bx1 <= ox1 + 1e-9 && bz1 <= oz1 + 1e-9)) continue;
    if (!occ.canPlaceCells(Math.floor((bx0 - ox) / RES + 1e-9), Math.floor((bz0 - oz) / RES + 1e-9), Math.ceil((bx1 - ox) / RES - 1e-9) - 1, Math.ceil((bz1 - oz) / RES - 1e-9) - 1, blocking, allow)) continue;
    if (needUse && !occ.clearOkSat(useRectOf(x, z, yaw, along, across, clearFront))) continue;
    const ld2 = laneD2(c, x, z);
    let score = Math.min(minDoorD2(c, x, z), 400) / 20;
    if (focal || nearLane) score += Math.max(0, 8 - ld2 / 2);          // visible from the lane
    else score += Math.min(ld2, 36) / 6;                                  // tucked away
    out.push({ x, z, yaw, score });
  }
  return out;
}
function cornerSlots(c: Ctx, def: PropDef): Slot[] {
  const m = propMeta(def.id); const r = c.zone.rect; const out: Slot[] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) for (const yaw of QUARTER_YAW) {
    const fw = yaw % 8 === 0 ? m.w : m.d, fd = yaw % 8 === 0 ? m.d : m.w;
    const x = sx > 0 ? r.x0 + fw / 2 : r.x1 - fw / 2, z = sz > 0 ? r.z0 + fd / 2 : r.z1 - fd / 2;
    const [fx, fz] = facingOf(yaw); if (fx * sx < 0 || fz * sz < 0) continue;   // must face into the room
    const fp = footprintAt(def, x, z, yaw);
    if (!c.occ.canPlace(fp.aabb, def.blocking)) continue;
    if (fp.use && !c.occ.clearOk(fp.use)) continue;
    out.push({ x, z, yaw, score: Math.min(minDoorD2(c, x, z), 400) / 10 });
  }
  return out;
}
interface SlotOpts { allow?: Allow; nearLane?: boolean }
function slotsFor(c: Ctx, def: PropDef, focal: boolean, opts: SlotOpts = {}): Slot[] {
  if (def.place === 'wall') return wallSlots(c, def, focal, opts.allow);
  if (def.place === 'corner') { const s = cornerSlots(c, def); return s.length ? s : floorSlots(c, def, focal, opts.allow, opts.nearLane); }
  return floorSlots(c, def, focal, opts.allow, opts.nearLane);
}
/** Top-3 by score, then rng.pick (ties broken by scan order). */
function pickSlot(c: Ctx, slots: Slot[]): Slot | null {
  if (!slots.length) return null;
  const top: Slot[] = [];                                  // == stable sort by score desc, scan order on ties, sliced to 3
  for (let n = 0; n < slots.length; n++) {
    const s = slots[n]; let pos = top.length;
    while (pos > 0 && top[pos - 1].score < s.score) pos--;
    if (pos >= 3) continue;
    top.splice(pos, 0, s); if (top.length > 3) top.pop();
  }
  return c.rng.pick(top);
}
/** Place one prop by its definition through slot scoring; returns the placement or null. */
function placeDef(c: Ctx, def: PropDef, role: Placement['role'], focal: boolean, opts: SlotOpts = {}): Pl | null {
  const s = pickSlot(c, slotsFor(c, def, focal, opts)); if (!s) return null;
  const p = makePl(c, def, s.x, s.z, s.yaw, role);
  return tryAdd(c, p, opts.allow) ? p : null;
}
/** Try props from a tag list in rng order until one fits. */
function placeFromTags(c: Ctx, tags: readonly string[], filter: (d: PropDef) => boolean, role: Placement['role'], focal: boolean, opts: SlotOpts = {}): Pl | null {
  const cands = c.rng.shuffle(defsFor(c, tags, filter));
  for (const d of cands) { const p = placeDef(c, d, role, focal, opts); if (p) return p; }
  return null;
}

// ---------------------------------------------------------------------------
// Steps 1–8
// ---------------------------------------------------------------------------
function step1Doors(c: Ctx): void {
  const o = c.occ;
  for (const d of c.doors) {
    o.disc(d.px, d.pz, DOOR_FAN_R + RES, KEEPOUT);
    const gap: Rect = d.ix !== 0
      ? { x0: Math.min(d.px, d.px + d.ix * DOOR_GAP_DEPTH), x1: Math.max(d.px, d.px + d.ix * DOOR_GAP_DEPTH), z0: d.pz - d.w / 2, z1: d.pz + d.w / 2 }
      : { z0: Math.min(d.pz, d.pz + d.iz * DOOR_GAP_DEPTH), z1: Math.max(d.pz, d.pz + d.iz * DOOR_GAP_DEPTH), x0: d.px - d.w / 2, x1: d.px + d.w / 2 };
    o.fillRect(gap, KEEPOUT);
    // L-lane door → centre (every pair is joined via the centre)
    const [ax, az] = [d.px, d.pz];
    const seg = (x0: number, z0: number, x1: number, z1: number) => o.laneRect({ x0: Math.min(x0, x1) - LANE_HALF, z0: Math.min(z0, z1) - LANE_HALF, x1: Math.max(x0, x1) + LANE_HALF, z1: Math.max(z0, z1) + LANE_HALF });
    if (d.ix !== 0) { seg(ax, az, c.cx, az); seg(c.cx, az, c.cx, c.cz); } else { seg(ax, az, ax, c.cz); seg(ax, c.cz, c.cx, c.cz); }
  }
  if (!c.doors.length) o.laneRect({ x0: c.cx - LANE_HALF, z0: c.cz - LANE_HALF, x1: c.cx + LANE_HALF, z1: c.cz + LANE_HALF });
  // the player's start must stay standable (validate: spawnSafe) — keep its NPC_R disc clear
  const st = c.layout.start; const r = c.zone.rect;
  if (st.floor === c.zone.floor && st.x >= r.x0 && st.x <= r.x1 && st.z >= r.z0 && st.z <= r.z1) {
    // ARRIVAL ROOM: a player who steps in through a lot door lands here with the way out at their
    // back (lotExitSpot hunts 3.6–7 u BEHIND the start). A 2.7-u disc let furniture crowd both the
    // landing and that exit — "I come out of the portal and cannot go anywhere". Keep a wide disc
    // AND the corridor behind the start clear, as lane, so there is always room to turn and walk.
    o.disc(st.x, st.z, 4.2 + RES, KEEPOUT);
    const [fx, fz] = DIR16[st.yaw] ?? [0, 1];
    const bx = st.x - fx * 7.5, bz = st.z - fz * 7.5;
    o.laneRect({ x0: Math.max(r.x0, Math.min(st.x, bx) - 3.2), z0: Math.max(r.z0, Math.min(st.z, bz) - 3.2), x1: Math.min(r.x1, Math.max(st.x, bx) + 3.2), z1: Math.min(r.z1, Math.max(st.z, bz) + 3.2) });
  }
}

function step2Quest(c: Ctx): void {
  const z = c.zone, role = z.role;
  if (role === 'key') {
    const def = propsWithTag('focal').find((d) => d.id === 'core_key_pedestal') ?? byTags(['loot'], (d) => d.interact === 'keyPedestal')[0];
    if (def) {
      const p = placeDef(c, def, 'quest', true, { nearLane: true });
      if (p) {
        const [fx, fz] = frontPoint(p, NPC_R + 0.1);
        const spot = spotNear(c, p, NPC_R, false) ?? { x: fx, z: fz, yaw: opp(p.yaw), floor: z.floor };
        const locked = c.layout.doors.find((d) => d.lock === c.arch.lockKit.key) ?? c.layout.doors.find((d) => !!d.lock);
        c.keys.push({ id: z.id + ':key', item: c.arch.lockKit.key, spot, opens: locked?.lock ?? '', zone: z.id });
      }
    }
  }
  if (role === 'boss') {
    const r = Math.max(3, c.side / 2 - 2);
    c.occ.disc(c.cx, c.cz, r, ARENA);
    c.spotsOut.arena = { cx: c.cx, cz: c.cz, r };
    if (z.ceilY !== undefined) z.ceilY = z.floorY + (z.ceilY - z.floorY) * c.arch.bossArena.ceilMul;
    const covers = byTags(['cover'], (d) => d.blocking && isFloorProp(d));
    const n = Math.min(4, Math.max(0, c.arch.bossArena.pillars));
    const off = c.side / 3;
    const spots: [number, number][] = [[c.cx + off, c.cz + off], [c.cx - off, c.cz - off], [c.cx + off, c.cz - off], [c.cx - off, c.cz + off]];
    for (let i = 0; i < n && covers.length; i++) {
      const d = covers[i % covers.length]; const [px, pz] = spots[i];
      const p = makePl(c, d, Math.round(px * 2) / 2, Math.round(pz * 2) / 2, snapQuarter(dirTo(c.cx - px, c.cz - pz)), 'quest');
      p.clearFront = 0; tryAdd(c, p, 'arena');
    }
  }
  if (role === 'npc') {
    const s = bestLaneStand(c, []); if (s) c.spotsOut.npc.push(s);
  }
  if (role === 'work') {
    const n = c.rng.int(1, 2);
    for (let i = 0; i < n; i++) placeFromTags(c, ['workstation'], (d) => !isQuestProp(d) && (isWallProp(d) || isFloorProp(d)), 'quest', i === 0);
  }
  if (role === 'checkpoint' || role === 'finish') {
    const def = byTags([role], (d) => !d.blocking)[0];
    const p = def ? placeDef(c, def, 'quest', true, { nearLane: true }) : null;
    const at: Spot = p ? { x: p.x, z: p.z, yaw: p.yaw, floor: z.floor } : { x: c.cx, z: c.cz, yaw: 0, floor: z.floor };
    (c.spotsOut.checkpoint ??= []).push(at);
  }
  if (role === 'plot' || z.kind === 'plot') {
    const pad = byTags(['claim'], (d) => !d.blocking)[0];
    const n = Number((z.tags.find((t) => t.startsWith('plots:')) ?? 'plots:4').slice(6)) || 4;
    c.spotsOut.claim = [];
    for (let i = 0; i < n && pad; i++) { const p = placeDef(c, pad, 'quest', false); if (p) c.spotsOut.claim.push({ x: p.x, z: p.z, yaw: p.yaw, floor: z.floor }); }
    placeFromTags(c, ['sell'], (d) => isFloorProp(d) || isWallProp(d), 'quest', true, { nearLane: true });
  }
  if (role === 'base' || z.kind === 'teams_base') {
    const def = byTags(['focal'], (d) => d.interact === 'keyPedestal')[0];
    const p = def ? placeDef(c, def, 'quest', true, { nearLane: true }) : null;
    if (p) { const [sx, sz] = frontPoint(p, NPC_R + 0.1); c.spotsOut.flag = { x: sx, z: sz, yaw: opp(p.yaw), floor: z.floor }; }
  }
}
const opp = (d: Dir16): Dir16 => (((d + 8) % 16) as Dir16);

function step3Anchors(c: Ctx): void {
  for (const a of c.recipe.anchors) {
    const n = c.rng.int(a.n[0], a.n[1]);
    for (let i = 0; i < n; i++) {
      const filter = (d: PropDef) => !isQuestProp(d) && (a.place === 'wall' ? isWallProp(d) : a.place === 'surface' ? isSurfaceProp(d) || isWallProp(d) : isFloorProp(d) || isWallProp(d));
      const p = placeFromTags(c, [a.tag], filter, 'anchor', !!a.focal, { nearLane: !!a.focal });
      if (p) step4Satellites(c, p);
    }
  }
}
function step4Satellites(c: Ctx, parent: Pl): void {
  const sats = parent.def.satellites; if (!sats) return;
  const q = yawToQuarter(parent.yaw);
  for (const s of sats) {
    if (!c.rng.chance(s.p)) continue;
    const cands = byTags([s.tag], (d) => isFloorProp(d) && !isQuestProp(d)); if (!cands.length) continue;
    const def = c.rng.pick(cands); const m = propMeta(def.id);
    const satYaw = QUARTER_YAW[(q + s.rot) % 4];
    // push outward until the satellite clears its parent's footprint (chairs tuck under tables in the def)
    let dx = s.dx, dz = s.dz;
    const sw = s.rot % 2 === 0 ? m.w : m.d, sd = s.rot % 2 === 0 ? m.d : m.w;   // satellite extents in parent-local axes
    if (Math.abs(dx) > Math.abs(dz)) dx = Math.sign(dx) * Math.max(Math.abs(dx), parent.across / 2 + sw / 2 + 0.25);
    else dz = Math.sign(dz || 1) * Math.max(Math.abs(dz), parent.along / 2 + sd / 2 + 0.25);
    const [wx, wz] = rotLocal(dx, dz, q);
    const p = makePl(c, def, Math.round((parent.x + wx) * 2) / 2, Math.round((parent.z + wz) * 2) / 2, satYaw, 'satellite', parent.id);
    if (overlaps(p.aabb, parent.aabb)) continue;
    tryAdd(c, p, 'clear');
  }
}

function step5Walls(c: Ctx): void {
  const r = c.zone.rect;
  let wallDefs = byTags(c.recipe.wallItems.tags, (d) => isWallProp(d) && !isQuestProp(d));
  if (!wallDefs.length && c.recipe.wallItems.density > 0) wallDefs = byTags(['storage', 'surface', 'hide'], (d) => isWallProp(d) && !isQuestProp(d));
  const perim = 2 * ((r.x1 - r.x0) + (r.z1 - r.z0));
  const n = Math.round((perim / 10) * c.recipe.wallItems.density);
  if (n > 0 && wallDefs.length) {
    // first-fit-decreasing: widest first, gaps 1–3 cells
    const picks = Array.from({ length: n }, () => c.rng.pick(wallDefs)).sort((a, b) => propMeta(b.id).w - propMeta(a.id).w);
    for (const def of picks) {
      const slots = wallSlots(c, def, false); if (!slots.length) continue;
      const s = slots[0];                                                  // first fit along the scan
      const p = makePl(c, def, s.x, s.z, s.yaw, 'wall');
      if (tryAdd(c, p)) { const gap = c.rng.int(1, 3) * RES; c.occ.fillRect({ x0: p.aabb.x0 - gap, z0: p.aabb.z0 - gap, x1: p.aabb.x1 + gap, z1: p.aabb.z1 + gap }, CLEAR); }
    }
  }
}
function stepLights(c: Ctx): void {
  if (c.recipe.light === 'none') return;
  const r = c.zone.rect; const z = c.zone;
  const prio = z.role === 'boss' || z.role === 'entrance' || z.role === 'hub' ? 3 : z.role === 'key' || z.role === 'lock' || z.role === 'treasure' ? 2 : 1;
  const h = z.ceilY !== undefined ? (z.ceilY - z.floorY) / 2 : c.arch.wallH / 2;
  const max = Math.max(1, Math.min(4, Math.round(c.side / 8)));
  const perim: [number, number][] = [];
  for (let x = r.x0 + 1; x < r.x1 - 1; x += RES) perim.push([x, r.z0 + RES]);
  for (let zz = r.z0 + 1; zz < r.z1 - 1; zz += RES) perim.push([r.x1 - RES, zz]);
  for (let x = r.x1 - 1; x > r.x0 + 1; x -= RES) perim.push([x, r.z1 - RES]);
  for (let zz = r.z1 - 1; zz > r.z0 + 1; zz -= RES) perim.push([r.x0 + RES, zz]);
  let next = c.rng.int(2, 4) * 2, walked = 0;
  for (let i = 0; i < perim.length && c.lights.length < 64; i++) {
    walked += RES; if (walked < next) continue;
    const [x, zz] = perim[i]; if (c.occ.stateAt(x, zz) === BLOCKED) continue;
    c.lights.push({ x, y: z.floorY + h, z: zz, color: LIGHT_COLOR[c.recipe.light], r: 14, priority: prio, floor: z.floor });
    walked = 0; next = c.rng.int(5, 7) * 2;
    if (c.lights.length >= max) break;
  }
}
function step6Surfaces(c: Ctx): void {
  const tags = c.recipe.surfaceFill?.tags ?? ['item']; const p = c.recipe.surfaceFill?.p ?? 0.4;
  const items = byTags(tags, isSurfaceProp).filter((d) => !isQuestProp(d)); if (!items.length) return;
  for (const host of c.pls.slice()) {
    const surfs = host.def.surfaces; if (!surfs || host.role === 'surface') continue;
    const q = yawToQuarter(host.yaw);
    for (const s of surfs) for (let k = 0; k < s.max; k++) {
      if (!c.rng.chance(p)) continue;
      const def = c.rng.pick(items);
      const u = (k + 0.5) / s.max + (c.rng.next() - 0.5) * 0.2, v = 0.5 + (c.rng.next() - 0.5) * 0.4;   // 20% jitter
      const [wx, wz] = rotLocal(s.x + u * s.w, s.z + v * s.d, q);
      const it = makePl(c, def, host.x + wx, host.z + wz, host.yaw, 'surface', host.id);
      it.y = c.zone.floorY + s.y; it.blocking = false; c.pls.push(it);
    }
  }
}
function step7Clutter(c: Ctx): void {
  const cl = c.recipe.clutter; if (cl.perCell <= 0 || !cl.tags.length) return;
  const defs = defsFor(c, cl.tags, (d) => (isFloorProp(d)) && !isQuestProp(d)); if (!defs.length) return;
  const cellsN = (c.zone.cells.x1 - c.zone.cells.x0 + 1) * (c.zone.cells.z1 - c.zone.cells.z0 + 1);
  const n = Math.floor(cl.perCell * c.clutterMul * cellsN + c.rng.next()); if (n <= 0) return;
  const r = c.zone.rect; const rad = 1 + c.rng.next() * 0.5; const placed: [number, number][] = [];
  // jittered Poisson: stratified blocks of `rad`, one jittered sample each, in rng-shuffled order
  const blocks: [number, number][] = [];
  for (let z = r.z0 + 1; z < r.z1 - 1; z += rad) for (let x = r.x0 + 1; x < r.x1 - 1; x += rad) blocks.push([x, z]);
  for (const [bx, bz] of c.rng.shuffle(blocks)) {
    if (placed.length >= n) break;
    const x = Math.round((bx + c.rng.next() * rad) * 2) / 2, z = Math.round((bz + c.rng.next() * rad) * 2) / 2;
    if (c.occ.isLaneAt(x, z) || minDoorD2(c, x, z) < cl.minDoorDist * cl.minDoorDist) continue;
    if (placed.some(([px, pz]) => (px - x) * (px - x) + (pz - z) * (pz - z) < rad * rad)) continue;
    const def = c.rng.pick(defs);
    const p = makePl(c, def, x, z, QUARTER_YAW[c.rng.int(0, 3)], 'clutter'); p.clearFront = 0;
    if (tryAdd(c, p)) placed.push([x, z]);
  }
}
/** A room of 12+ cells reads as empty under 4 props: top it up from its own clutter / wall tags (a closet may stay sparse). */
const MIN_PROPS = 4, MIN_PROPS_CELLS = 9;
function stepMinProps(c: Ctx): void {
  const cellsN = (c.zone.cells.x1 - c.zone.cells.x0 + 1) * (c.zone.cells.z1 - c.zone.cells.z0 + 1);
  if (cellsN < MIN_PROPS_CELLS) return;
  // the 'wall' tag names wall-mounted items AND struct_* wall blocks — take the former by place, never the latter
  const tags = [...c.recipe.clutter.tags, 'storage', 'seat', 'surface', 'decor', 'clutter'].filter((t) => t !== 'floor' && t !== 'item' && t !== 'wall');
  const openSky = c.zone.ceilY === undefined;
  const fits = (d: PropDef) => !isQuestProp(d) && (openSky ? isOutdoorProp(d) || isWallProp(d) : (isWallProp(d) || d.place === 'floor' || d.place === 'corner'));
  const short = () => c.pls.filter((p) => p.role !== 'surface').length < MIN_PROPS;
  // decor (non-blocking) first: repair() never needs to drop it; then blocking pieces
  for (let tries = 0; tries < 4 && short(); tries++) if (!placeFromTags(c, tags, (d) => fits(d) && !d.blocking, 'clutter', false)) break;
  for (let tries = 0; tries < 4 && short(); tries++) if (!placeFromTags(c, tags, (d) => fits(d) && d.blocking, 'clutter', false)) break;
}
function step8Guarantees(c: Ctx): void {
  for (let tries = 0; tries < 4 && hideSpots(c).length < c.recipe.hideMin; tries++) {
    const hides = byTags(['hide'], (d) => !isQuestProp(d)).sort((a, b) => Number(b.blocking) - Number(a.blocking));
    let ok = false;
    for (const d of c.rng.shuffle(hides.filter((d) => d.blocking)).concat(hides.filter((d) => !d.blocking))) { if (placeDef(c, d, 'anchor', false)) { ok = true; break; } }
    if (!ok) break;
  }
  for (let tries = 0; tries < 4 && lootSpots(c).length < c.recipe.lootMin; tries++) {
    const loots = byTags(['loot', 'treasure'], (d) => isLoot(d) && !isQuestProp(d));
    const chest = loots.find((d) => d.interact === 'chest');
    const order = chest ? [chest, ...loots.filter((d) => d !== chest)] : loots;
    let ok = false;
    for (const d of order) { if (placeDef(c, d, 'anchor', false, { nearLane: true })) { ok = true; break; } }
    if (!ok) break;
  }
}

// ---------------------------------------------------------------------------
// Standability + spots (step 9)
// ---------------------------------------------------------------------------
/** Every box standable() can hit: this zone's blocking props plus the shell colliders over its rect. Cached
 *  against the placement list (which only ever grows in place, or is replaced wholesale by rebuild()). */
function standBoxes(c: Ctx): Rect[] {
  if (c.sbFor === c.pls && c.sbN === c.pls.length && c.sbBoxes) return c.sbBoxes;
  const zr = c.zone.rect; const share = shareOf(c.zone);
  const cols = (c.zoneCols ??= share.cols ??= c.layout.colliders.filter((a) => a.floor === c.zone.floor && !(a.x1 <= zr.x0 || a.x0 >= zr.x1 || a.z1 <= zr.z0 || a.z0 >= zr.z1)));
  const out: Rect[] = [];
  for (const p of c.pls) if (p.blocking) out.push(p.aabb);
  for (const a of cols) out.push(a);
  c.sbFor = c.pls; c.sbN = c.pls.length; return (c.sbBoxes = out);
}
function standable(c: Ctx, x: number, z: number, r: number): boolean {
  const zr = c.zone.rect;
  if (x < zr.x0 + r || x > zr.x1 - r || z < zr.z0 + r || z > zr.z1 - r) return false;
  const boxes = standBoxes(c), r2 = r * r;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
    const dz = z < b.z0 ? b.z0 - z : z > b.z1 ? z - b.z1 : 0;
    if (dx * dx + dz * dz < r2) return false;
  }
  return true;
}
function yawToDoor(c: Ctx, x: number, z: number): Dir16 {
  let best: DoorInfo | null = null, bd = Infinity;
  for (const d of c.doors) { const dx = d.px - x, dz = d.pz - z; const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = d; } }
  return best ? dirTo(best.px - x, best.pz - z) : 0;
}
/** The lane cells laneStands may return, centre-most first. Everything here (lane bitmap, door fans, zone
 *  rect, centre) is fixed for the zone, so the scan and the sort run once per Ctx and every candidate,
 *  repair rebuild and person reuses the order. Only the placement test is left to laneStands itself. */
function laneCandidates(c: Ctx): { x: Float64Array; z: Float64Array } {
  if (c.laneCand) return c.laneCand;
  const share = shareOf(c.zone); if (share.laneCand) return (c.laneCand = share.laneCand);
  const o = c.occ; const runs = o.laneRuns(); const fan2 = (DOOR_FAN_R + 1) * (DOOR_FAN_R + 1);
  const zr = c.zone.rect;
  const xLo = zr.x0 + NPC_R, xHi = zr.x1 - NPC_R, zLo = zr.z0 + NPC_R, zHi = zr.z1 - NPC_R;
  const cd: number[] = [], cX: number[] = [], cZ: number[] = [];
  for (let j = 0; j < o.H; j++) {
    const z = o.cz(j); if (z < zLo || z > zHi) continue;
    const row = runs[j];
    for (let n = 0; n < row.length; n++) {
      const a = row[n][0], b = row[n][1];
      for (let i = a; i <= b; i++) {
        const x = o.cx(i); if (x < xLo || x > xHi) continue;
        if (minDoorD2(c, x, z) < fan2) continue;
        cd.push((x - c.cx) * (x - c.cx) + (z - c.cz) * (z - c.cz)); cX.push(x); cZ.push(z);
      }
    }
  }
  const ord: number[] = []; for (let i = 0; i < cd.length; i++) ord.push(i);
  ord.sort((a, b) => cd[a] - cd[b] || cX[a] - cX[b] || cZ[a] - cZ[b]);   // centre-most first (cells are distinct: a total order)
  const x = new Float64Array(ord.length), z = new Float64Array(ord.length);
  for (let n = 0; n < ord.length; n++) { x[n] = cX[ord[n]]; z[n] = cZ[ord[n]]; }
  return (c.laneCand = share.laneCand = { x, z });
}
/** Lane cells (outside the door fans) standable at NPC_R, centre-most first; spaced ≥ 3 u from `taken`.
 *  `limit` stops once that many are found — every caller slices to a handful. */
function laneStands(c: Ctx, taken: Spot[], spacing = 3, limit = Infinity): Spot[] {
  const out: Spot[] = []; if (limit <= 0) return out;
  const cand = laneCandidates(c);                        // standable()'s rect / door filters, precomputed
  const r2 = NPC_R * NPC_R, boxes = standBoxes(c);       // standable()'s box test, inlined over a frozen list
  const all = new SpotBuckets(taken, spacing);
  for (let n = 0; n < cand.x.length; n++) {
    const x = cand.x[n], z = cand.z[n];
    let free = true;
    for (let k = 0; k < boxes.length; k++) {
      const bx = boxes[k];
      const dx = x < bx.x0 ? bx.x0 - x : x > bx.x1 ? x - bx.x1 : 0;
      const dz = z < bx.z0 ? bx.z0 - z : z > bx.z1 ? z - bx.z1 : 0;
      if (dx * dx + dz * dz < r2) { free = false; break; }
    }
    if (!free) continue;
    if (all.near(x, z)) continue;
    const s: Spot = { x, z, yaw: yawToDoor(c, x, z), floor: c.zone.floor }; out.push(s); all.add(s);
    if (out.length >= limit) break;
  }
  return out;
}
/** "Is any spot closer than `spacing`?" over a growing set, bucketed by spacing so the scan stays local (same predicate as a linear scan). */
class SpotBuckets {
  private readonly b = new Map<number, Spot[]>();
  constructor(init: readonly Spot[], private readonly spacing: number) { for (const s of init) this.add(s); }
  private key(x: number, z: number): number { return Math.floor(x / this.spacing) * 100_003 + Math.floor(z / this.spacing); }
  add(s: Spot): void { const k = this.key(s.x, s.z); const l = this.b.get(k); if (l) l.push(s); else this.b.set(k, [s]); }
  near(x: number, z: number): boolean {
    const bx = Math.floor(x / this.spacing), bz = Math.floor(z / this.spacing), r2 = this.spacing * this.spacing;
    for (let i = bx - 1; i <= bx + 1; i++) for (let j = bz - 1; j <= bz + 1; j++) {
      const l = this.b.get(i * 100_003 + j); if (!l) continue;
      for (const s of l) if ((s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) < r2) return true;
    }
    return false;
  }
}
const bestLaneStand = (c: Ctx, taken: Spot[]): Spot | null => laneStands(c, taken, 3, 1)[0] ?? null;
/** Any standable cell (lane or not) on a 1 u lattice, spaced; used when the lane is too short for a route. */
function anyStands(c: Ctx, taken: Spot[], spacing = 3): Spot[] {
  const r = c.zone.rect; const out: Spot[] = []; const all = new SpotBuckets(taken, spacing);
  for (let z = Math.ceil(r.z0) + 1; z <= r.z1 - 1; z += 1) for (let x = Math.ceil(r.x0) + 1; x <= r.x1 - 1; x += 1) {
    if (!standable(c, x, z, NPC_R)) continue;
    if (all.near(x, z)) continue;
    const s: Spot = { x, z, yaw: yawToDoor(c, x, z), floor: c.zone.floor }; out.push(s); all.add(s);
  }
  return out;
}
function spotNear(c: Ctx, p: Pl, r: number, behind: boolean): Spot | null {
  for (let extra = r + (r < 2 ? 0.7 : 0.1); extra <= r + 2.6; extra += 0.5) {
    const [x, z] = behind ? backPoint(p, extra) : frontPoint(p, extra);
    if (standable(c, x, z, r)) return { x, z, yaw: behind ? p.yaw : opp(p.yaw), floor: c.zone.floor };
  }
  return null;
}
function hideSpots(c: Ctx): Spot[] {
  const out: Spot[] = [];
  for (const p of c.pls) { if (!isHide(p.def)) continue; const s = (p.def.place !== 'wall' && spotNear(c, p, HIDE_R, true)) || spotNear(c, p, HIDE_R, false); if (s) out.push(s); }
  return out;
}
function lootSpots(c: Ctx): Spot[] {
  const out: Spot[] = [];
  for (const p of c.pls) {
    if (isLoot(p.def) && p.role !== 'surface') { const s = spotNear(c, p, NPC_R, false); if (s) out.push(s); continue; }
    if (p.role === 'surface' && p.def.tags.includes('loot') && p.parent !== undefined) {
      const host = c.pls.find((h) => h.id === p.parent); const s = host ? spotNear(c, host, NPC_R, false) : null; if (s) out.push(s);
    }
  }
  return out;
}
function workSpots(c: Ctx): Spot[] {
  const out: Spot[] = [];
  for (const p of c.pls) { if (!p.def.tags.includes('workstation') || p.role === 'surface' || p.role === 'satellite') continue; const s = spotNear(c, p, NPC_R, false); if (s) out.push(s); }
  return out;
}
function step9Spots(c: Ctx): void {
  const z = c.zone; const S = c.spotsOut;
  const ctr = standable(c, c.cx, c.cz, NPC_R) ? { x: c.cx, z: c.cz } : null;
  S.center = { x: ctr ? c.cx : c.cx, z: ctr ? c.cz : c.cz, yaw: yawToDoor(c, c.cx, c.cz), floor: z.floor };
  const questNpc = S.npc.slice();
  S.npc = questNpc.concat(laneStands(c, questNpc, 3, 6)).slice(0, 6);
  if (!S.npc.length) S.npc = anyStands(c, []).slice(0, 4);
  S.loot = lootSpots(c); S.hide = hideSpots(c);
  const work = workSpots(c); if (work.length) S.work = work;
  if (z.role === 'vantage' || z.tags.includes('raised')) {
    const v = S.npc[0] ?? (ctr ? { x: c.cx, z: c.cz, yaw: S.center.yaw, floor: z.floor } : null); if (v) S.vantage = v;
  }
  if (z.kind === 'safehouse' || z.kind === 'camp' || z.role === 'safehouse') {
    const b: Spot[] = [];
    for (const d of c.doors) for (const lat of [-3, 0, 3]) {
      const x = d.px + d.ix * 4.5 + (d.ix === 0 ? lat : 0), zz = d.pz + d.iz * 4.5 + (d.iz === 0 ? lat : 0);
      if (standable(c, x, zz, NPC_R)) b.push({ x, z: zz, yaw: opp(d.yaw), floor: z.floor });
    }
    if (b.length) S.barricade = b;
  }
  if (z.role === 'boss' && !S.arena) S.arena = { cx: c.cx, cz: c.cz, r: Math.max(3, c.side / 2 - 2) };
}

// ---------------------------------------------------------------------------
// Step 10: dilated connectivity + repair
// ---------------------------------------------------------------------------
/** validateZone's rasters, reused across the repair loop (it runs up to 24 times per candidate). */
let VZ_PASS = new Uint8Array(0), VZ_SEEN = new Uint8Array(0), VZ_Q = new Int32Array(0);
function validateZone(c: Ctx): boolean {
  const o = c.occ; const W = o.W, H = o.H, st = o.state; const N = W * H;
  if (VZ_PASS.length < N) { VZ_PASS = new Uint8Array(N); VZ_SEEN = new Uint8Array(N); VZ_Q = new Int32Array(N); }
  const pass = VZ_PASS; pass.fill(1, 0, N);
  // lane cells are never BLOCKED; door gaps are KEEPOUT so no BLOCKED cell sits in them
  for (let k = 0; k < N; k++) if (o.lane[k] && st[k] === BLOCKED) return false;
  const blockedAt = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && st[j * W + i] === BLOCKED;
  for (let j = 0; j < H; j++) { const row = j * W; for (let i = 0; i < W; i++) {
    if (st[row + i] !== BLOCKED) continue;
    // an interior BLOCKED cell (4 BLOCKED neighbours) adds nothing: its disc lies inside its neighbours' discs
    if (blockedAt(i + 1, j) && blockedAt(i - 1, j) && blockedAt(i, j + 1) && blockedAt(i, j - 1)) continue;
    for (let dj = -3; dj <= 3; dj++) {
      const nj = j + dj; if (nj < 0 || nj >= H) continue;
      const w = DILATE_ROW[dj + 3];
      let a = i - w; if (a < 0) a = 0;
      let b = i + w; if (b > W - 1) b = W - 1;
      const base = nj * W; for (let n = a; n <= b; n++) pass[base + n] = 0;
    }
  } }
  const targets: [number, number][] = [];
  for (const d of c.doors) targets.push(d.inner);
  for (const p of c.pls) if (p.blocking && (p.role === 'anchor' || p.role === 'quest') && p.clearFront > 0) targets.push(frontPoint(p, targetDepth(p)));
  const S = c.spotsOut;
  for (const s of [...S.npc, ...S.loot, ...S.hide, ...(S.work ?? []), ...(S.checkpoint ?? []), ...(S.claim ?? []), ...(S.barricade ?? []), ...(S.vantage ? [S.vantage] : []), ...(S.flag ? [S.flag] : [])]) targets.push([s.x, s.z]);
  if (targets.length < 2) return true;
  const cellOf = (x: number, z: number): [number, number] => [Math.min(o.W - 1, Math.max(0, Math.floor((x - o.x0) / RES))), Math.min(o.H - 1, Math.max(0, Math.floor((z - o.z0) / RES)))];
  const [si, sj] = cellOf(targets[0][0], targets[0][1]);
  const seen = VZ_SEEN; seen.fill(0, 0, N); const q = VZ_Q; let qh = 0, qt = 0; const s0 = o.idx(si, sj);
  if (!pass[s0]) return false;
  seen[s0] = 1; q[qt++] = s0;
  while (qh < qt) {
    const k = q[qh++]; const i = k % W;
    let nk = k + 1; if (i + 1 < W && !seen[nk] && pass[nk]) { seen[nk] = 1; q[qt++] = nk; }
    nk = k - 1; if (i > 0 && !seen[nk] && pass[nk]) { seen[nk] = 1; q[qt++] = nk; }
    nk = k + W; if (nk < N && !seen[nk] && pass[nk]) { seen[nk] = 1; q[qt++] = nk; }
    nk = k - W; if (nk >= 0 && !seen[nk] && pass[nk]) { seen[nk] = 1; q[qt++] = nk; }
  }
  for (const [x, z] of targets) { const [i, j] = cellOf(x, z); if (!seen[o.idx(i, j)]) return false; }
  return true;
}

/** Rebuild the occupancy from a placement list (re-stamps doors/lane/quest keep-outs), recompute spots. */
function rebuild(c: Ctx, keep: Pl[]): void {
  c.occ = new Occ(c.zone.rect.x0, c.zone.rect.z0, c.zone.rect.x1, c.zone.rect.z1);
  const arena = c.spotsOut.arena;
  step1Doors(c);
  if (arena) c.occ.disc(arena.cx, arena.cz, arena.r, ARENA);
  c.pls = []; for (const p of keep) { stamp(c, p); c.pls.push(p); }
  const questNpc = c.spotsOut.npc.filter((_, i) => i < 1 && c.zone.role === 'npc');
  c.spotsOut = { ...c.spotsOut, npc: questNpc, loot: [], hide: [], work: undefined, vantage: undefined, barricade: undefined };
  step9Spots(c);
}
function repair(c: Ctx): number {
  let drops = 0;
  for (let n = 0; n < 24; n++) {
    if (validateZone(c)) return drops;
    const droppable = c.pls.filter((p) => p.blocking && p.role !== 'quest');
    if (!droppable.length) return drops;
    let victim = droppable[0];
    for (const p of droppable) if (ROLE_PRIO[p.role] < ROLE_PRIO[victim.role] || (ROLE_PRIO[p.role] === ROLE_PRIO[victim.role] && p.id > victim.id)) victim = p;
    const keep = c.pls.filter((p) => p.id !== victim.id && p.parent !== victim.id);
    rebuild(c, keep); drops++;
  }
  return validateZone(c) ? drops : -1;
}

// ---------------------------------------------------------------------------
// One candidate + scoring
// ---------------------------------------------------------------------------
interface Candidate { pls: Pl[]; spots: Zone['spots']; lights: SemanticMap['lights']; keys: SemanticMap['keys']; score: number; ceilY?: number }
function emptySpots(zone: Zone): Zone['spots'] { return { center: { x: 0, z: 0, yaw: 0, floor: zone.floor }, npc: [], loot: [], hide: [] }; }

/** The story hook for one zone: furnish builds the per-candidate Ctx, the hook dresses through it. */
type DressHook = (c: Ctx) => void;
function buildCandidate(layout: EmbeddedLayout, zone: Zone, recipe: RoomRecipe, arch: Archetype, rng: Rng, anchorsOnly: boolean, dress?: DressHook): Candidate {
  const r = zone.rect; const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const c: Ctx = {
    zone, recipe, arch, rng, layout, doors: doorInfos(zone, layout),
    cx: Math.round((r.x0 + r.x1)) / 2, cz: Math.round((r.z0 + r.z1)) / 2, side: Math.min(w, d), longestWall: Math.max(w, d),
    occ: new Occ(r.x0, r.z0, r.x1, r.z1), pls: [], nextId: 1, anchorsOnly, lights: [], keys: [], spotsOut: emptySpots(zone), clutterMul: 1,
  };
  const ceil0 = zone.ceilY;
  step1Doors(c);
  step2Quest(c);
  step3Anchors(c);
  if (dress) dress(c);                      // STORY SETS: after the anchors (the room reads as its kind), before minima / packing / clutter
  step8Guarantees(c);                       // minima claim their slots before packing fills the walls
  if (!anchorsOnly) { step5Walls(c); step6Surfaces(c); step7Clutter(c); step8Guarantees(c); stepMinProps(c); }
  stepLights(c);
  step9Spots(c);
  const drops = repair(c);
  // score = −wallAlign − pairwiseOverlap − imbalance (+ a penalty per dropped prop / failed repair)
  let wallAlign = 0, pair = 0, mx = 0, mz = 0, mass = 0;
  const bl = c.pls.filter((p) => p.blocking);
  for (const p of bl) {
    const dw = Math.min(p.aabb.x0 - r.x0, r.x1 - p.aabb.x1, p.aabb.z0 - r.z0, r.z1 - p.aabb.z1);
    if (p.def.place !== 'floor' && p.def.place !== 'outdoor') wallAlign += Math.min(3, Math.max(0, dw));
    const area = p.fw * p.fd; mass += area; mx += p.x * area; mz += p.z * area;
  }
  for (let i = 0; i < bl.length; i++) for (let j = i + 1; j < bl.length; j++) {
    const a = bl[i].aabb, b = bl[j].aabb;
    if (overlaps({ x0: a.x0 - 1, z0: a.z0 - 1, x1: a.x1 + 1, z1: a.z1 + 1 }, b)) pair++;
  }
  const imbalance = mass > 0 ? Math.abs(mx / mass - c.cx) + Math.abs(mz / mass - c.cz) : 0;
  const score = -wallAlign - pair - imbalance - (drops < 0 ? 1000 : drops * 2);
  const ceilY = zone.ceilY; zone.ceilY = ceil0;
  return { pls: c.pls, spots: c.spotsOut, lights: c.lights, keys: c.keys, score, ceilY };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
/** Every blocking box a walker on this floor must keep `r` from: the zone's blocking props plus the shell (walls, locked doors). */
function walkBoxes(layout: EmbeddedLayout, pls: Pl[], floor: number): Rect[] {
  const out: Rect[] = [];
  for (const p of pls) if (p.blocking) out.push(p.aabb);
  for (const a of layout.colliders) if (a.floor === floor) out.push(a);
  return out;
}
/** The straight segment a→b (sampled every ≤ 0.5 u, rational steps) never comes within r of a box. */
function segClear(boxes: Rect[], a: Spot, b: Spot, r: number): boolean {
  const dx = b.x - a.x, dz = b.z - a.z; const r2 = r * r;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.5));
  for (let i = 0; i <= n; i++) { const x = a.x + (dx * i) / n, z = a.z + (dz * i) / n; for (const bx of boxes) if (dist2ToRect(x, z, bx) < r2) return false; }
  return true;
}
/** A closed tour over `pts` from `start` whose every leg is clear: greedy nearest-next among the points the current
 *  leg can reach (ties by index), then the closing leg must be clear too (drop the tail until it is). */
function clearLoop(boxes: Rect[], start: Spot, pts: Spot[], r: number): Spot[] {
  const kept: Spot[] = [start]; const left = pts.slice();
  for (;;) {
    const cur = kept[kept.length - 1]; let best = -1, bd = Infinity;
    for (let i = 0; i < left.length; i++) { const p = left[i]; const d = (p.x - cur.x) * (p.x - cur.x) + (p.z - cur.z) * (p.z - cur.z); if (d < bd && segClear(boxes, cur, p, r)) { bd = d; best = i; } }
    if (best < 0) break;
    kept.push(left[best]); left.splice(best, 1);
  }
  while (kept.length >= 3 && !segClear(boxes, kept[kept.length - 1], kept[0], r)) kept.pop();
  return kept;
}
function routeFor(layout: EmbeddedLayout, zone: Zone, arch: Archetype, rng: Rng, start: Spot, pls: Pl[]): Spot[] {
  // in-zone standable lane points ≥ 3 u apart, walked as a loop whose straight legs stay clear of every blocking box;
  // a zone too small for a loop walks out through a door into the adjacent corridor and back the same way
  const c = ctxLite(layout, zone, arch, rng, pls);
  const boxes = walkBoxes(layout, pls, zone.floor);
  let pts = laneStands(c, [start], 3, 5).slice(0, 5);
  if (pts.length + 1 < 3) pts = pts.concat(anyStands(c, [start, ...pts]).slice(0, 4));
  const want = rng.int(3, 6);
  const route: Spot[] = [start, ...pts.slice(0, want - 1)];
  if (route.length >= 3) {
    const loop = clearLoop(boxes, start, route.slice(1), NPC_R);
    if (loop.length >= 3) return loop;
  }
  for (const id of zone.doors) {
    const door = layout.doors.find((d) => d.id === id); if (!door || door.lock) continue;
    const otherId = door.between[0] === zone.id ? door.between[1] : door.between[0];
    const other = layout.zones.find((z) => z.id === otherId); if (!other || other.floor !== zone.floor || (other.kind !== 'corridor' && other.role !== 'corridor')) continue;
    const di = c.doors.find((d) => d.door.id === id); if (!di) continue;
    // the wall gap between the two rects along the door's axis, then 2.5 u into the corridor (its centre line when it is one cell deep)
    const gap = di.ix ? (di.ix > 0 ? zone.rect.x0 - other.rect.x1 : other.rect.x0 - zone.rect.x1) : (di.iz > 0 ? zone.rect.z0 - other.rect.z1 : other.rect.z0 - zone.rect.z1);
    const depth = di.ix ? other.rect.x1 - other.rect.x0 : other.rect.z1 - other.rect.z0;
    const reach = gap + Math.min(2.5, depth / 2);
    const inside: Spot = { x: di.px + di.ix * 3, z: di.pz + di.iz * 3, yaw: opp(di.yaw), floor: zone.floor };
    let outside: Spot = { x: di.px - di.ix * reach, z: di.pz - di.iz * reach, yaw: opp(di.yaw), floor: other.floor };
    // a graph-grid corridor may attach to the door cell from the side: then the door cell itself is the turnaround
    const o = other.rect; if (outside.x < o.x0 + NPC_R || outside.x > o.x1 - NPC_R || outside.z < o.z0 + NPC_R || outside.z > o.z1 - NPC_R) outside = { x: door.x, z: door.z, yaw: opp(di.yaw), floor: other.floor };
    const r2 = NPC_R * NPC_R;
    if (boxes.some((b) => dist2ToRect(inside.x, inside.z, b) < r2 || dist2ToRect(outside.x, outside.z, b) < r2)) continue;
    if (!segClear(boxes, start, inside, NPC_R) || !segClear(boxes, inside, outside, NPC_R)) continue;
    // out and back along the same line: the closing leg retraces the corridor, never the wall
    return [start, inside, outside, { ...inside, yaw: di.yaw }];
  }
  return [];                                            // no clear loop and no corridor to step into: nobody walks here
}
function ctxLite(layout: EmbeddedLayout, zone: Zone, arch: Archetype, rng: Rng, pls: Pl[]): Ctx {
  const r = zone.rect; const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const c: Ctx = { zone, recipe: defaultRecipe(zone), arch, rng, layout, doors: doorInfos(zone, layout), cx: Math.round(r.x0 + r.x1) / 2, cz: Math.round(r.z0 + r.z1) / 2, side: Math.min(w, d), longestWall: Math.max(w, d), occ: new Occ(r.x0, r.z0, r.x1, r.z1), pls, nextId: 0, anchorsOnly: true, lights: [], keys: [], spotsOut: emptySpots(zone), clutterMul: 1 };
  step1Doors(c); for (const p of pls) stamp(c, p);
  return c;
}
function peopleFor(layout: EmbeddedLayout, zone: Zone, recipe: RoomRecipe, arch: Archetype, seed: number, pls: Pl[], force: boolean): Person[] {
  const out: Person[] = [];
  if (!recipe.npcStand && !force) return out;
  const rng = sub(seed, zone.id, 'people');
  const cfg = recipe.people ?? { n: [0, 1] as [number, number], roles: ['resident'] };
  let n = force ? Math.max(1, rng.int(cfg.n[0], cfg.n[1])) : rng.int(cfg.n[0], cfg.n[1]);
  n = Math.min(n, zone.spots.npc.length);
  for (let i = 0; i < n; i++) {
    const spot = zone.spots.npc[i];
    const route = routeFor(layout, zone, arch, rng, spot, pls);
    if (route.length < 3) continue;
    const k = rng.int(2, 3); const lines: string[] = [];
    if (arch.chatter.length) { const start = rng.int(0, arch.chatter.length - 1); for (let j = 0; j < k && j < arch.chatter.length; j++) lines.push(arch.chatter[(start + j) % arch.chatter.length]); }
    out.push({ id: zone.id + ':p' + i, zone: zone.id, role: cfg.roles.length ? rng.pick(cfg.roles) : 'resident', spot, route, lines });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Story hooks (dressing.ts / people.ts) — the placement API furnish lends them
// ---------------------------------------------------------------------------
const toPlacement = (c: Ctx, p: Pl): Placement => ({ prop: p.prop, x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale: 1, zone: c.zone.id, floor: c.zone.floor, collide: p.blocking, role: p.role });
/** ctx.place(): one prop by tag through the zone's occupancy grid — the same slot scoring furnish uses, re-ranked
 *  for `against` / `near` / `minDoorDist`; top-3 then rng.pick, like every other placement here. */
function dressPlace(c: Ctx, tag: string | string[], opts: PlaceOpts): Placement | undefined {
  if (opts.zone !== c.zone.id) return undefined;
  const tags = Array.isArray(tag) ? tag : [tag];
  const against = opts.against ?? 'free';
  const filter = (d: PropDef) => !isQuestProp(d) && (against === 'wall' ? isWallProp(d) : against === 'corner' ? (d.place === 'corner' || isFloorProp(d)) : isFloorProp(d));
  const role: Placement['role'] = opts.role ?? 'anchor';
  const md2 = (opts.minDoorDist ?? 0) * (opts.minDoorDist ?? 0);
  const rank = (sl: Slot): number => {
    let sc = sl.score;
    if (against === 'nearDoor') sc = -minDoorD2(c, sl.x, sl.z);
    if (opts.near) { const dx = sl.x - opts.near.x, dz = sl.z - opts.near.z; sc = -(dx * dx + dz * dz); }
    return sc;
  };
  const one = (): Pl | null => {
    for (const def of c.rng.shuffle(defsFor(c, tags, filter))) {
      let slots = against === 'corner' && def.place !== 'wall' ? cornerSlots(c, def) : [];
      if (!slots.length) slots = slotsFor(c, def, against === 'center', { nearLane: against === 'center' || against === 'nearDoor', allow: opts.allow });
      if (md2 > 0) slots = slots.filter((sl) => minDoorD2(c, sl.x, sl.z) >= md2);
      const s = pickSlot(c, slots.map((sl) => ({ ...sl, score: rank(sl) }))); if (!s) continue;
      const p = makePl(c, def, s.x, s.z, s.yaw, role);
      if (tryAdd(c, p, opts.allow)) return p;
    }
    return null;
  };
  let first: Placement | undefined;
  for (let i = 0, n = Math.max(1, opts.count ?? 1); i < n; i++) { const p = one(); if (!p) break; first ??= toPlacement(c, p); }
  return first;
}
/** The rooms as the hooks see them: reqs bound here, the story entities standing here, start / leaf flags. */
function dressZones(layout: EmbeddedLayout, brief: StoryBrief, reqZones: Record<string, PlaceReq[]>): DressZone[] {
  const dz = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
  const st = layout.start;
  return layout.zones.map((z) => {
    const reqs = reqZones[z.id] ?? [];
    const here = new Set(reqs.map((r) => dz(r.alias)));
    const at = (place?: string) => !!place && here.has(dz(place));
    const r = z.rect;
    return {
      id: z.id, kind: z.kind, name: z.name, label: reqs.find((q) => q.label)?.label, rect: { ...r }, floor: z.floor,
      isStart: st.floor === z.floor && st.x >= r.x0 && st.x <= r.x1 && st.z >= r.z0 && st.z <= r.z1,
      isLeaf: z.doors.length === 1, reqs, role: z.role,
      cast: brief.cast.filter((e) => at(e.place)), items: brief.items.filter((e) => at(e.place)), threats: brief.threats.filter((e) => at(e.place)),
    };
  });
}
/** Today's extras: recipe n / roles per zone, layout-seeded, archetype chatter; the entrance never empty. */
function defaultPeople(layout: EmbeddedLayout, arch: Archetype, seed: number, plsByZone: Map<string, Pl[]>): Person[] {
  const out: Person[] = [];
  for (const zone of layout.zones) {
    const recipe = arch.kinds[zone.kind] ?? defaultRecipe(zone);
    out.push(...peopleFor(layout, zone, recipe, arch, seed, plsByZone.get(zone.id) ?? [], false));
  }
  const entrance = layout.zones.find((z) => z.role === 'entrance') ?? layout.zones[0];
  if (entrance && !out.some((p) => p.zone === entrance.id)) {
    const recipe = arch.kinds[entrance.kind] ?? defaultRecipe(entrance);
    out.push(...peopleFor(layout, entrance, recipe, arch, seed, plsByZone.get(entrance.id) ?? [], true).slice(0, 1));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
export function furnish(layout: EmbeddedLayout, arch: Archetype, seed: number, opts: FurnishOpts = {}): FurnishResult {
  const res: FurnishResult = { placements: [], lights: [], people: [], keys: [], colliders: [] };
  const plsByZone = new Map<string, Pl[]>();
  const brief = opts.brief;
  const zonesView = brief ? dressZones(layout, brief, opts.reqZones ?? {}) : [];
  for (const zone of layout.zones) {
    const recipe = arch.kinds[zone.kind] ?? defaultRecipe(zone);
    const rng = sub(seed, zone.id, 'furnish');
    // the story hook for this zone: its own die (brief.seed + zone.id), the zone list, the placement API over THIS candidate's grid
    const view = zonesView.find((v) => v.id === zone.id);
    const dress: DressHook | undefined = brief && view ? (c) => {
      const ctx: DressContext = {
        brief, arch, style: arch.style, rng: sub(brief.seed, zone.id, 'dress'), zone: view, zones: zonesView,
        place: (tag, o) => dressPlace(c, tag, o),
        reserve: (zid, rect) => { if (zid === c.zone.id) c.occ.fillRect(rect, CLEAR); },
        dampClutter: (zid, f) => { if (zid === c.zone.id) c.clutterMul = Math.max(0, f); },
      };
      dressRooms(ctx);
    } : undefined;
    let best: Candidate | null = null;
    for (let k = 0; k < K_CANDIDATES; k++) {
      const cand = buildCandidate(layout, zone, recipe, arch, rng, !!opts.anchorsOnly, dress);
      if (!best || cand.score > best.score) best = cand;
    }
    if (best && best.score <= -1000) {                                       // re-seed ×3, then anchorsOnly
      for (let a = 0; a < 3 && best.score <= -1000; a++) { rng.next(); const cand = buildCandidate(layout, zone, recipe, arch, rng, !!opts.anchorsOnly, dress); if (cand.score > best.score) best = cand; }
      if (best.score <= -1000) { const cand = buildCandidate(layout, zone, recipe, arch, rng, true, dress); if (cand.score > best.score) best = cand; }
    }
    if (!best) continue;
    zone.spots = best.spots; if (best.ceilY !== undefined) zone.ceilY = best.ceilY;
    plsByZone.set(zone.id, best.pls);
    for (const p of best.pls) {
      res.placements.push({ prop: p.prop, x: p.x, y: p.y, z: p.z, yaw: p.yaw, scale: 1, zone: zone.id, floor: zone.floor, collide: p.blocking, role: p.role });
      if (p.blocking) res.colliders.push({ x0: p.aabb.x0, z0: p.aabb.z0, x1: p.aabb.x1, z1: p.aabb.z1, floor: zone.floor, id: zone.id + ':' + p.prop + '#' + p.id });
    }
    res.lights.push(...best.lights); res.keys.push(...best.keys);
  }
  // PEOPLE: behind the people.ts hook when a brief is present (the stub returns the defaults verbatim)
  const defaults = () => defaultPeople(layout, arch, seed, plsByZone);
  if (brief) {
    const castRng = sub(brief.seed, 'people');
    const recipes: CastContext['recipes'] = {};
    for (const [kind, rec] of Object.entries(arch.kinds)) if (rec.people) recipes[kind] = rec.people;
    const zoneOf = (id: string) => layout.zones.find((z) => z.id === id);
    const ctx: CastContext = {
      brief, arch, zones: zonesView, recipes, rng: castRng,
      spotIn: (zid, o = {}) => { const z = zoneOf(zid); if (!z) return []; const taken = o.taken ?? []; const out = z.spots.npc.filter((s) => !taken.some((t) => t.x === s.x && t.z === s.z)); return o.n !== undefined ? out.slice(0, o.n) : out; },
      routeIn: (zid, start) => { const z = zoneOf(zid); return z ? routeFor(layout, z, arch, castRng, start, plsByZone.get(zid) ?? []) : []; },
      defaults,
    };
    res.people = castPeople(ctx);
  } else res.people = defaults();
  for (const zone of layout.zones) zone.spots.routes = res.people.filter((p) => p.zone === zone.id).map((p) => p.route);
  return res;
}
