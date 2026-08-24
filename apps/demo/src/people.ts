// apps/demo/src/people.ts — the extras, made visible.
//
// `compose()` already decided who stands in each room, where exactly, and what they would say
// (composer/people.ts casts them from the story, not from the layout). This file does nothing but
// render that decision: a blocky body on each spot, a name plate over it, and the first line the
// composer wrote for them when you walk up. No dialogue system, no quests — just proof that the
// building was populated on purpose.
import * as THREE from 'three';
import { buildBlocky, lookSeed, seededLook, type Person, type SemanticMap } from '@voxel-city/core';

const PLATE_H = 7.6;

/** A crisp name plate that always faces the lens. */
function plate(text: string): THREE.Sprite {
  const pad = 12, fs = 34;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
  c.width = Math.ceil(g.measureText(text).width) + pad * 2;
  c.height = fs + pad * 2;
  const g2 = c.getContext('2d')!;
  g2.font = `600 ${fs}px ui-monospace, Menlo, monospace`;
  g2.fillStyle = '#0b0d12d9';
  g2.beginPath(); g2.roundRect(0, 0, c.width, c.height, 14); g2.fill();
  g2.fillStyle = '#e8ecf4';
  g2.textBaseline = 'middle';
  g2.fillText(text, pad, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(c.width / c.height * 1.7, 1.7, 1);
  sp.renderOrder = 999;
  return sp;
}

export interface Extra { person: Person; rig: THREE.Group; phase: number }

/** Populate `root` from a composed map. The rig for a person is seeded off their id, so the same
 *  building always casts the same faces. */
export function spawnPeople(root: THREE.Object3D, map: SemanticMap): Extra[] {
  const out: Extra[] = [];
  for (const p of map.people) {
    const zone = map.zones.find((z) => z.id === p.zone);
    const look = seededLook(lookSeed(p.id));
    const b = buildBlocky(look);
    b.rig.position.set(p.spot.x, zone?.floorY ?? 0, p.spot.z);
    b.rig.rotation.y = (p.spot.yaw / 16) * Math.PI * 2;
    const label = plate(p.role.replace(/_/g, ' '));
    label.position.y = PLATE_H;
    b.rig.add(label);
    root.add(b.rig);
    out.push({ person: p, rig: b.rig, phase: (lookSeed(p.id) % 1000) / 1000 * Math.PI * 2 });
  }
  return out;
}

/** A breath of idle motion, and the nearest person's opening line. */
export function updatePeople(extras: Extra[], t: number, near: THREE.Vector3): string | null {
  let best: Extra | null = null, bestD = 9 * 9;
  for (const e of extras) {
    e.rig.position.y += Math.sin(t * 1.6 + e.phase) * 0.004;
    const dx = e.rig.position.x - near.x, dz = e.rig.position.z - near.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best?.person.lines[0] ?? null;
}
