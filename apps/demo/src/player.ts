// apps/demo/src/player.ts — the body and the lens.
//
// A deliberately small third-person controller: it is here so the generator has something to be
// walked through, not to be a character system. Everything it knows about the world it asks the
// World interface for — `heightAt` for the ground, `blocked` for the walls, `ceilingY` for the lid.
// Swap a city for a composed interior underneath it mid-frame and nothing here needs to change.
import * as THREE from 'three';
import { buildBlocky, updateCutout, type Blocky, type World } from '@everydoor/core';

const EYE = 5.0;          // the anchor the camera orbits — roughly the hero's head
const RADIUS = 1.3;       // the body's collision radius, in world units
const SPEED = 13;         // u/s on the ground
const SPRINT = 1.7;
const GRAVITY = 42;
const JUMP = 15;
const CAM_DIST = 11;      // how far behind the hero the lens sits
const CAM_HEIGHT = 2.4;
const TOP_HEIGHT = 62;    // how high the top-down lens hangs — enough to hold a whole room, or a block

export interface PlayerOpts { scene: THREE.Object3D; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; dom: HTMLElement }

/** Where the lens sits. `follow` is over the hero's shoulder; `top` looks straight down and dissolves
 *  everything above their head, so a roofed building reads like its own floorplan. */
export type CamMode = 'follow' | 'top';

export class Player {
  readonly hero: Blocky;
  readonly pos = new THREE.Vector3();
  yaw = 0; pitch = -0.12;
  private vy = 0;
  private grounded = true;
  private readonly keys = new Set<string>();
  private walkPhase = 0;
  private dragging = false;
  private mode: CamMode = 'follow';
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly subject = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();

  constructor(opts: PlayerOpts) {
    this.camera = opts.camera;
    this.renderer = opts.renderer;
    this.hero = buildBlocky({ noCut: true, shirt: 0x2f6fd0, pants: 0x2a2f3d, shoes: 0x1a1d25 });
    opts.scene.add(this.hero.rig);

    // LOOKING IS A DRAG, NOT A CAPTURE. Pointer lock hijacks the cursor and the escape key, which
    // is a bad trade for a demo you are meant to poke at — the panel is right there. Hold any mouse
    // button and drag to turn; let go and the cursor is yours again.
    const dom = opts.dom;
    dom.style.cursor = 'grab';
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      dom.style.cursor = 'grabbing';
      dom.setPointerCapture(e.pointerId);
    });
    const release = (e: PointerEvent) => {
      this.dragging = false;
      dom.style.cursor = 'grab';
      if (dom.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
    };
    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * 0.005;
      this.pitch = Math.max(-1.15, Math.min(0.55, this.pitch - e.movementY * 0.004));
    });
    // a right-drag is a perfectly good way to turn — don't let the menu eat it
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('keydown', (e) => {
      // never swallow a keystroke meant for the panel's inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** True while the mouse is held down and turning the camera. */
  get looking(): boolean { return this.dragging; }

  get cameraMode(): CamMode { return this.mode; }
  /** Flip between over-the-shoulder and straight down. Returns the mode we landed in. */
  toggleCamera(): CamMode { return (this.mode = this.mode === 'follow' ? 'top' : 'follow'); }

  /** True while the key is held — the door prompt reads E through this too. */
  held(code: string): boolean { return this.keys.has(code); }
  consume(code: string): boolean { const had = this.keys.has(code); this.keys.delete(code); return had; }

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
    // the mouse is never required: the arrows turn the lens
    const turn = (this.keys.has('ArrowLeft') ? 1 : 0) - (this.keys.has('ArrowRight') ? 1 : 0);
    if (turn) this.yaw += turn * 2.1 * dt;
    const tilt = (this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0);
    if (tilt) this.pitch = Math.max(-1.15, Math.min(0.55, this.pitch + tilt * 1.4 * dt));

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
    const cam = this.camera.position;

    if (this.mode === 'top') {
      // STRAIGHT DOWN, AND THE ROOF COMES OFF. The camera see-through already knows how to dissolve
      // whatever stands between the lens and the hero; opened to the whole frame, with nothing
      // spared by its normal, that is every ceiling and every wall-top above their head — so a
      // roofed building reads as its own floorplan without the generator building a second one.
      cam.set(this.pos.x, this.pos.y + TOP_HEIGHT, this.pos.z);
      // keep the way they are facing pointing UP the screen, or turning spins the whole world
      this.camera.up.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.camera.lookAt(this.subject);
      // spare everything below head height: the walls stay as a cutaway, only the ceiling and the
      // upper courses come off. Cutting from the floor up would leave you looking at bare slabs.
      updateCutout(this.camera, this.subject, this.renderer, 3, this.pos.y + EYE * 0.8, 1e6, 2);
      return;
    }

    this.camera.up.set(0, 1, 0);
    const cd = Math.cos(this.pitch) * CAM_DIST;
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
