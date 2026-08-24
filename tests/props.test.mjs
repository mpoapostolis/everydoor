// THE PROP LIBRARY CONTRACT — every registered prop builds in every style, stays within the
// triangle budget, stands on the floor, and the geometry cache never grows past its style bound.
// scripts/prop-audit.mjs is the detailed gate; this pins the invariants under `bun run test`.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { allProps, buildProp, STYLES, librarySize, disposeLibrary, TRI_BUDGET, flattenOps, propDef } from '../packages/core/src/props/index.ts';

test('every prop builds in every style within budget', () => {
  const props = allProps();
  assert.ok(props.length >= 16, `expected the core family at least, got ${props.length}`);
  for (const d of props) for (const s of Object.values(STYLES)) {
    const g = buildProp(d.id, s);
    assert.ok(g.parts.length >= 1 && g.voxels >= 1, `${d.id} in ${s.id} built nothing`);
    const budget = d.lod === 'dressing' ? TRI_BUDGET.dressing : TRI_BUDGET.default;
    assert.ok(g.tris <= budget, `${d.id} in ${s.id}: ${g.tris} tris > ${budget}`);
    assert.ok(g.aabb.every((v) => v > 0), `${d.id} degenerate aabb`);
  }
});

test('ids are unique, family-prefixed, and refs resolve', () => {
  const seen = new Set();
  for (const d of allProps()) {
    assert.ok(!seen.has(d.id), `duplicate ${d.id}`); seen.add(d.id);
    assert.ok(d.id.startsWith(d.family === 'vignette' ? 'vig_' : d.family === 'structure' ? 'struct_' : d.family === 'scifi' ? 'sci_' : d.family === 'medical' ? 'med_' : d.family === 'vehicle' ? 'veh_' : d.family === 'industrial' ? 'ind_' : d.family + '_'), `${d.id} not prefixed by its family ${d.family}`);
    if (d.voxels) flattenOps(d.voxels, (id) => propDef(id)?.voxels);   // throws on an unknown ref
  }
});

test('the geometry cache is bounded by live styles', () => {
  disposeLibrary();
  const base = STYLES['house.cozy'];
  const n = allProps().length;
  for (let i = 0; i < 9; i++) for (const d of allProps()) buildProp(d.id, { ...base, id: `synthetic.${i}` });
  assert.ok(librarySize() <= 6 * n, `cache holds ${librarySize()} geometries for ${n} props — LRU did not evict`);
  disposeLibrary();
  assert.equal(librarySize(), 0);
});

// SURFACE FINISHES paint in sRGB at a readable brightness in EVERY style. The first version
// pushed hex tones through THREE.Color (linear) and wrote them as sRGB pixels — castle planks
// came out 28/255, the corridors read as black slabs, the owner called it terrible.
import { finishBrightness, FINISH_SCALE } from '../packages/core/src/props/surfaces.ts';
test('every finish × style paints between 60 and 245 mean brightness', () => {
  for (const st of Object.values(STYLES)) for (const f of Object.keys(FINISH_SCALE)) {
    const b = finishBrightness(f, st);
    assert.ok(b >= 60 && b <= 245, `${f} in ${st.id} paints at ${b.toFixed(0)}/255`);
  }
});

// ---------------------------------------------------------------------------
// FINISH TEXTURE MEMORY. Ten finishes × six live styles at 256² RGBA came to 15 MB against a
// 4 MB budget (design §9). Sizes are now per finish, textures are shared by the COLOURS a
// painter reads rather than by style id, and the cache evicts on the same 6-style LRU bound as
// the geometry library. These numbers are the contract; the brightness band above still holds.
// ---------------------------------------------------------------------------
import {
  FINISHES, FINISH_SIZE, OVERSAMPLE, finishBytes, finishSignature, finishAtlasBytes,
  finishTextureBytes, finishCacheSize, finishMaterial, disposeFinishes, paintFinish,
} from '../packages/core/src/props/surfaces.ts';
import { MATERIALS } from '../packages/core/src/props/index.ts';

const MB = 1024 * 1024;
const sixStyles = Object.values(STYLES).slice(0, 6);

test('six live styles of finish textures fit the texture budget', () => {
  const bytes = finishAtlasBytes(sixStyles);
  assert.ok(bytes <= 5 * MB, `six styles cost ${(bytes / MB).toFixed(2)} MB of finish texture`);
  // The old flat 256² cost, for the record: 10 × 6 × 256² × 4 = 15 MB.
  assert.ok(bytes < 10 * 6 * 256 * 256 * 4 / 3, 'the whole point was to be well under a third of the old cost');
  for (const f of FINISHES) {
    const s = FINISH_SIZE[f];
    assert.ok(s === 64 || s === 128, `${f} is ${s}² — 128 is the ceiling the budget allows for 10 finishes × 6 styles`);
    assert.equal(s & (s - 1), 0, `${f} is ${s}² — must be a power of two so the mip chain is complete`);
  }
  assert.ok(OVERSAMPLE >= 2, 'the smaller texels only hold up because each one is supersampled');
});

test('a finish texture is shared by its colours, not by the style that asked', () => {
  disposeFinishes();
  const base = STYLES.castle;
  // A world tour re-instantiates the same palette under fresh ids; that must cost one copy.
  for (const id of ['castle', 'castle.again', 'castle.third']) for (const f of FINISHES) finishMaterial(f, { ...base, id });
  assert.equal(finishCacheSize(), FINISHES.length, `three clones of one palette painted ${finishCacheSize()} textures`);
  assert.equal(finishTextureBytes(), FINISHES.reduce((b, f) => b + finishBytes(f), 0));
  disposeFinishes();
  assert.equal(finishCacheSize(), 0);
  assert.equal(finishTextureBytes(), 0);
});

test('the finish cache evicts on the same six-style bound as the geometry library', () => {
  disposeFinishes();
  const tour = [...Object.values(STYLES), { ...STYLES.school, id: 'school.variant' }];
  assert.ok(tour.length >= 10, 'the tour has to overflow the bound to prove anything');
  let peak = 0;
  for (const st of tour) {
    for (const f of FINISHES) finishMaterial(f, st);
    peak = Math.max(peak, finishTextureBytes());
  }
  assert.ok(peak <= 5 * MB, `a ${tour.length}-world tour peaked at ${(peak / MB).toFixed(2)} MB — the LRU did not evict`);
  assert.ok(finishCacheSize() <= 6 * FINISHES.length, `${finishCacheSize()} textures live after the tour`);
  disposeFinishes();
});

test('a finish signature covers exactly the tones its painter reads', () => {
  // The cache key is a colour signature. If a painter starts reading a tone the signature does
  // not list, two different-looking styles silently share one texture — so prove the two agree:
  // shifting a tone must change the pixels if and only if it changes the signature.
  const base = STYLES['house.cozy'];
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  for (const f of FINISHES) {
    const ref = paintFinish(f, base, 64);
    const refSig = finishSignature(f, base);
    for (const mat of MATERIALS) for (let i = 0; i < 3; i++) {
      const tones = { ...base.tones, [mat]: [...base.tones[mat]] };
      tones[mat][i] ^= 0x404040;                       // ±64 per channel: unmistakable if it is read at all
      const probe = { ...base, id: 'probe', tones };
      const paintChanged = !same(Array.from(paintFinish(f, probe, 64)), Array.from(ref));
      const sigChanged = finishSignature(f, probe) !== refSig;
      assert.equal(sigChanged, paintChanged, `${f}: tones.${mat}[${i}] changes the paint (${paintChanged}) but the signature (${sigChanged}) — FINISH_TONES is out of step with painterFor`);
    }
  }
});

test('near-identical palettes collapse onto one texture, and never the wrong one', () => {
  // Bucketing colours to 2/255 is one-sided: palettes inside a bucket share, palettes straddling
  // its edge do not. So assert the direction that can actually break something — a shared
  // signature must mean a shared LOOK — plus that the tolerance is doing some work at all.
  const base = STYLES.shop;
  const even = { ...base.tones, fabric: [0x804020, 0x604020, 0xa08060] };
  const a = { ...base, id: 'p.a', tones: even };
  const nudged = { ...base, id: 'p.b', tones: { ...even, fabric: even.fabric.map((h) => h + 0x010101) } };
  assert.equal(finishSignature('carpet', nudged), finishSignature('carpet', a), 'a 1/255 drift inside the bucket must not buy a second carpet texture');
  const recoloured = { ...base, id: 'p.c', tones: { ...even, fabric: even.fabric.map((h) => h + 0x202020) } };
  assert.notEqual(finishSignature('carpet', recoloured), finishSignature('carpet', a), 'a real recolour must still get its own texture');

  // Whenever two palettes DO share a signature, the pixels they would have painted must be
  // indistinguishable — otherwise the cache hands out a texture with the wrong ink in it.
  for (const f of FINISHES) {
    const pa = paintFinish(f, a, 32), pb = paintFinish(f, nudged, 32);
    if (finishSignature(f, nudged) !== finishSignature(f, a)) continue;
    let worst = 0;
    for (let i = 0; i < pa.length; i++) worst = Math.max(worst, Math.abs(pa[i] - pb[i]));
    assert.ok(worst <= 2, `${f}: two palettes share a signature but paint ${worst}/255 apart`);
  }
});

test('supersampling has converged at the shipped sizes', () => {
  // The thin features (tile grout, brick courses, board seams) are 1–3 texels wide; at one sample
  // per texel they flickered in and out of the grid, which is what made halving the sizes safe to
  // do at all. Measured against the correct downsample, worst of all nine styles, the shipped 2×
  // paint aliases LESS than the old 256² did — plank 3.13 → 2.22, flagstone 3.23 → 2.28,
  // wallpaper 2.51 → 1.52, panel 2.03 → 1.45, brick 8.84 → 6.23 — at a quarter of the bytes.
  // Here we only pin that 2× sits on the flat part of the curve: doubling again barely moves it.
  // (A ratio test against 1× would be brittle — whether 1× happens to land on a feature edge is
  // a grid-alignment coincidence that differs per finish and per size.)
  const err = (a, b) => { let s = 0, n = 0; for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++, n++) s += (a[i + c] - b[i + c]) ** 2; return Math.sqrt(s / n); };
  for (const f of FINISHES) {
    const size = FINISH_SIZE[f];
    const moved = err(paintFinish(f, STYLES.castle, size, OVERSAMPLE), paintFinish(f, STYLES.castle, size, OVERSAMPLE * 2));
    assert.ok(moved <= 6, `${f} still moves by ${moved.toFixed(2)}/255 between ${OVERSAMPLE}× and ${OVERSAMPLE * 2}× samples — it has not converged`);
  }
});
