// apps/demo/src/lighting.ts — one rig, two moods.
//
// Outdoors the city theme already carries its own palette (sky stops, fog colour and density), so the
// rig just reads it. Indoors there is no sun: a composed map ships a `lights` list the planner placed
// per room, and the rig spends a small budget on the ones nearest the player — the rest is ambient.
// Keeping the count fixed is the point: a hospital with forty rooms must not cost forty point lights.
import * as THREE from 'three';
import type { CityTheme, SemanticMap } from '@voxel-city/core';

const INDOOR_BUDGET = 12;

export class Lighting {
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x404050, 1);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  private readonly pool: THREE.PointLight[] = [];
  private indoor: SemanticMap['lights'] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.sun.position.set(60, 120, 40);
    scene.add(this.hemi, this.sun);
    for (let i = 0; i < INDOOR_BUDGET; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 2);
      l.visible = false;
      this.pool.push(l);
      scene.add(l);
    }
  }

  /** The sky, the fog and the sun of a city flavour. */
  city(theme: CityTheme): void {
    this.indoor = [];
    for (const l of this.pool) l.visible = false;
    this.scene.background = skyTexture(theme.sky);
    this.scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
    const night = theme.night;
    this.hemi.color.set(night ? 0x2a3550 : 0xbfd8ff);
    this.hemi.groundColor.set(night ? 0x10131c : 0x6b6f7a);
    this.hemi.intensity = night ? 0.55 : 1.15;
    this.sun.color.set(night ? 0x6f86c8 : 0xfff3dd);
    this.sun.intensity = night ? 0.28 : 1.35;
  }

  /** An interior: flat ambient plus the map's own lamps, the nearest few of them. */
  interior(map: SemanticMap): void {
    this.indoor = map.lights;
    this.scene.background = new THREE.Color(0x07090d);
    this.scene.fog = new THREE.FogExp2(0x07090d, 0.012);
    this.hemi.color.set(0x9aa6c0); this.hemi.groundColor.set(0x2a2d38); this.hemi.intensity = 0.62;
    this.sun.intensity = 0.18;
  }

  /** Re-aim the point-light budget at whatever room the player is standing in. */
  follow(x: number, z: number): void {
    if (!this.indoor.length) return;
    const near = this.indoor
      .map((l) => ({ l, d: (l.x - x) ** 2 + (l.z - z) ** 2 - l.priority * 400 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, INDOOR_BUDGET);
    this.pool.forEach((p, i) => {
      const hit = near[i];
      if (!hit) { p.visible = false; return; }
      p.visible = true;
      p.position.set(hit.l.x, hit.l.y, hit.l.z);
      p.color.setHex(hit.l.color);
      p.distance = hit.l.r;
      p.intensity = 26;
    });
  }
}

/** The four-stop vertical gradient a city theme names, as a background texture. */
function skyTexture(stops: [string, string, string, string]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), s));
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
