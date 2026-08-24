// apps/demo/src/main.ts — a city with a procedural interior behind every door.
//
// The loop is deliberately dumb: stream whatever world is current around the player, move the body,
// look for a doorway, draw. All of the interesting behaviour lives one layer down — in the generator
// (@everydoor/core) and in world-swap.ts, which is the only thing that knows a city and an interior
// are different kinds of thing at all.
import * as THREE from 'three';
import { CITY_THEMES, dressCutout, type CityKind, type CityWorld, type ComposedWorld } from '@everydoor/core';
import { Player } from './player';
import { Lighting } from './lighting';
import { WorldSwap } from './world-swap';
import { updatePeople } from './people';
import { Panel } from './panel';
import { Floorplan } from './floorplan';
import { demoScript } from './script';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 900);
const lighting = new Lighting(scene);
const player = new Player({ scene, camera, renderer, dom: renderer.domElement });

const promptEl = document.getElementById('prompt')!;
const zoneEl = document.getElementById('zone')!;
const veilEl = document.getElementById('veil')!;

// Every world the swap builds must be dressed for the see-through, or a wall between the lens and
// the hero stays solid and you steer a body you cannot see.
const swap = new WorldSwap(scene, {
  onCity: (theme: CityKind) => { lighting.city(CITY_THEMES[theme]); dressCutout(swap.root); },
  onInterior: (w: ComposedWorld) => { lighting.interior(w.map); dressCutout(swap.root); },
});

const floorplan = new Floorplan(document.getElementById('floorplan')!);

const panel = new Panel({
  onCity: (seed, theme) => veil(() => {
    const s = swap.city(seed, theme);
    player.place(swap.world, s.x, s.z, s.yaw);
    banner('the street');
  }),
  onArchetype: (id, seed, style) => veil(() => {
    const s = swap.standalone(id, seed, demoScript(id), style);
    player.place(swap.world, s.x, s.z, s.yaw);
    banner(id);
  }),
  onRandomize: (seed, theme) => veil(() => {
    const s = swap.randomize(seed, theme, (arch) => demoScript(arch));
    player.place(swap.world, s.x, s.z, s.yaw);
    banner(swap.place.kind === 'interior' ? (swap.place.lot?.name ?? 'somewhere new') : 'the street');
  }),
  onExit: () => leave(),
}, swap.seed, swap.theme);

// ---- doors ---------------------------------------------------------------------------------

/** The lot the player is standing in the doorway of, or null. */
function doorwayLot() {
  if (swap.place.kind !== 'city') return null;
  return (swap.place.world as CityWorld).lotAt(player.pos.x, player.pos.z, 3.4);
}

function enter(): void {
  const lot = doorwayLot();
  if (!lot) return;
  veil(() => {
    // the script is what makes the rooms specific: the same plan, arranged around a story
    const s = swap.enterLot(lot, demoScript(lot.archetype));
    player.place(swap.world, s.x, s.z, s.yaw);
    banner(lot.name);
  });
}

function leave(): void {
  if (swap.place.kind !== 'interior') return;
  veil(() => {
    const s = swap.exitLot();
    if (s) { player.place(swap.world, s.x, s.z, s.yaw); banner('the street'); return; }
    // a standalone interior has no street behind it — fall back to the city we booted with
    const c = swap.city(panel.seed, swap.theme);
    player.place(swap.world, c.x, c.z, c.yaw);
    banner('the street');
  });
}

// ---- chrome --------------------------------------------------------------------------------

let promptText = '';
function setPrompt(text: string): void {
  if (text === promptText) return;
  promptText = text;
  promptEl.innerHTML = text;
  promptEl.classList.toggle('on', !!text);
}

let bannerT = 0;
function banner(text: string): void {
  zoneEl.textContent = text;
  zoneEl.classList.add('on');
  bannerT = 2.2;
}

/** Blink to black across a swap: building a world takes long enough to show a torn frame. */
function veil(build: () => void): void {
  veilEl.classList.add('on');
  setTimeout(() => { build(); veilEl.classList.remove('on'); }, 180);
}

// ---- boot ----------------------------------------------------------------------------------

const first = swap.city();
player.place(swap.world, first.x, first.z, first.yaw);
banner('the street');

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now(), fps = 60, t = 0, frame = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; t += dt;
  fps += ((1 / Math.max(dt, 1e-4)) - fps) * 0.08;

  player.update(dt, swap.world);
  const { x, z } = player.pos;
  if (swap.world.streamAround(x, z)) dressCutout(swap.root);
  swap.world.onFrame?.(camera);
  lighting.follow(x, z);

  // ---- what is in front of me? -------------------------------------------------------------
  let zoneName = '';
  if (swap.place.kind === 'interior') {
    const w = swap.place.world;
    zoneName = w.map.zones.find((zn) => w.inside(zn.id, x, z))?.name ?? '';
    const line = updatePeople(swap.extras, t, player.pos);
    const nearExit = swap.exitDistance(x, z) < 4;
    setPrompt(nearExit ? '<b>E</b> — step back out onto the street' : (line ? `“${line}”` : ''));
    if (nearExit && player.consume('KeyE')) leave();
  } else {
    const lot = doorwayLot();
    setPrompt(lot ? `<b>E</b> — go into ${lot.name}` : '');
    if (lot && player.consume('KeyE')) enter();
  }

  if (bannerT > 0 && (bannerT -= dt) <= 0) zoneEl.classList.remove('on');

  // THE PLAN, drawn from the same map the walls came from. Every third frame: it is a canvas
  // redraw of a few hundred rects, not free, and nothing on it moves faster than the player.
  if (floorplan.visible && (frame++ % 3 === 0)) {
    if (swap.place.kind === 'interior') {
      const w = swap.place.world;
      floorplan.interior(w.map, x, z, player.yaw, w.floorAt(x, z));
    } else {
      floorplan.city(swap.place.world as CityWorld, x, z, player.yaw);
    }
  }

  panel.update({
    where: swap.place.kind === 'city' ? `city · ${swap.place.theme}` : `inside · ${swap.place.archetype}`,
    detail: swap.place.kind === 'city' ? `${(swap.place.world as CityWorld).lots().length} doors` : (swap.place.lot?.name ?? 'standalone'),
    zone: zoneName,
    seed: swap.seed,
    lotSeed: swap.currentLotSeed(),
    lots: swap.place.kind === 'city' ? (swap.place.world as CityWorld).lots().length : (swap.place.world as ComposedWorld).map.doors.length,
    chunks: swap.world.liveChunks,
    fps,
    canExit: swap.place.kind === 'interior',
  });

  renderer.render(scene, camera);
});
