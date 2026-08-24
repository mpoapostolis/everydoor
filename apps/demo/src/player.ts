// apps/demo/src/player.ts — the body and the lens.
//
// A deliberately small third-person controller: it is here so the generator has something to be
// walked through, not to be a character system. Everything it knows about the world it asks the
// World interface for — `heightAt` for the ground, `blocked` for the walls, `ceilingY` for the lid.
// Swap a city for a composed interior underneath it mid-frame and nothing here needs to change.
import * as THREE from 'three';
import { buildBlocky, updateCutout, type Blocky, type World } from '@voxel-city/core';

const EYE = 5.0;          // the anchor the camera orbits — roughly the hero's head
const RADIUS = 1.3;       // the body's collision radius, in world units
const SPEED = 13;         // u/s on the ground
const SPRINT = 1.7;
const GRAVITY = 42;
const JUMP = 15;
const CAM_DIST = 11;      // how far behind the hero the lens sits
const CAM_HEIGHT = 2.4;

export interface PlayerOpts { scene: THREE.Object3D; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; dom: HTMLElement }

export class Player {
  readonly hero: Blocky;
  readonly pos = new THREE.Vector3();
  yaw = 0; pitch = -0.12;
  private vy = 0;
  private grounded = true;
  private readonly keys = new Set<string>();
  private walkPhase = 0;
  private locked = false;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly subject = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();

  constructor(opts: PlayerOpts) {
    this.camera = opts.camera;
    this.renderer = opts.renderer;
    this.hero = buildBlocky({ noCut: true, shirt: 0x2f6fd0, pants: 0x2a2f3d, shoes: 0x1a1d25 });
    opts.scene.add(this.hero.rig);

    const dom = opts.dom;
    dom.addEventListener('click', () => { if (!this.locked) dom.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0024;
      this.pitch = Math.max(-1.15, Math.min(0.55, this.pitch - e.movementY * 0.0021));
    });
    addEventListener('keydown', (e) => {
      // never swallow a keystroke meant for the panel's inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** True while the key is held — the door prompt reads Enter/E through this too. */
  held(code: string): boolean { return this.keys.has(code); }
  consume(code: string): boolean { const had = this.keys.has(code); this.keys.delete(code); return had; }
  get pointerLocked(): boolean { return this.locked; }

  /** Drop the body at (x,z) facing `yaw`, standing on whatever ground is there. */
  place(world: World, x: number, z: number, yaw = this.yaw): void {
    this.pos.set(x, world.heightAt(x, z), z);
    this.yaw = yaw; this.vy = 0; this.grounded = true;
  }

  update(dt: number, world: World): void {
    // ---- intent, in world space --------------------------------------------------------------
    const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const s = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.wish.set(0, 0, 0);
    if (f || s) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      this.wish.set(-sin * f + cos * s, 0, -cos * f - sin * s).normalize();
    }
    const speed = SPEED * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? SPRINT : 1);

    // ---- move, one axis at a time so a wall slides instead of stopping -----------------------
    // Movement is a pure DESTINATION test (no depenetration), which is why every spawn goes
    // through nearestStandable: a body that starts inside a collider could never leave one.
    const dx = this.wish.x * speed * dt, dz = this.wish.z * speed * dt;
    if (dx && !world.blocked(this.pos.x + dx, this.pos.z, RADIUS)) this.pos.x += dx;
    if (dz && !world.blocked(this.pos.x, this.pos.z + dz, RADIUS)) this.pos.z += dz;

    // ---- gravity ------------------------------------------------------------------------------
    const ground = world.heightAt(this.pos.x, this.pos.z);
    if (this.grounded && this.keys.has('Space')) { this.vy = JUMP; this.grounded = false; }
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) { this.pos.y = ground; this.vy = 0; this.grounded = true; }
    // an indoor world has a lid: a jump must not punch through the ceiling
    const lid = world.ceilingY;
    if (lid !== undefined && this.pos.y > lid - EYE) { this.pos.y = lid - EYE; this.vy = Math.min(this.vy, 0); }

    // ---- the rig ------------------------------------------------------------------------------
    this.hero.rig.position.copy(this.pos);
    this.hero.rig.rotation.y = this.yaw;
    const moving = !!(f || s);
    this.walkPhase = moving ? this.walkPhase + dt * (speed * 0.62) : 0;
    const sw = moving ? Math.sin(this.walkPhase) * 0.62 : 0;
    const { legL, legR, armL, armR } = this.hero.limbs;
    legL.rotation.x = sw; legR.rotation.x = -sw;
    armL.rotation.x = -sw * 0.7; armR.rotation.x = sw * 0.7;

    // ---- the lens -----------------------------------------------------------------------------
    this.subject.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    const cd = Math.cos(this.pitch) * CAM_DIST;
    const cam = this.camera.position;
    cam.set(
      this.subject.x + Math.sin(this.yaw) * cd,
      this.subject.y + CAM_HEIGHT - Math.sin(this.pitch) * CAM_DIST,
      this.subject.z + Math.cos(this.yaw) * cd,
    );
    // indoors the lens must stay under the ceiling, or it looks in from above through
    // backface-culled geometry and the room reads as a void
    if (lid !== undefined) cam.y = Math.min(cam.y, lid - 0.6);
    this.camera.lookAt(this.subject);
    // the see-through: anything between the lens and the hero dithers away instead of blocking
    updateCutout(this.camera, this.subject, this.renderer, 0.055, this.pos.y + 0.2, 3.2, 0.55);
  }
}
