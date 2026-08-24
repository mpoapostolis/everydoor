// apps/demo/src/floorplan.ts — the plan, drawn from the same truth the walls were built from.
//
// A composed building is a SEMANTIC MAP before it is any geometry: rooms with names and kinds,
// doors that know which two rooms they join and whether they are locked, the key that opens each
// lock, where the story starts, who is standing where. This panel draws exactly that — no raycasts,
// no scene traversal, no second source of truth. If the plan says the vault is locked and the map
// shows an open door, the bug is in the renderer, not here.
//
// Out on the street the same panel becomes a street map: the lot table is the city's plan, so the
// buildings you can walk into are the ones that get drawn.
import type { CityLot, CityWorld, ComposedWorld, SemanticMap } from '@everydoor/core';

const PAD = 22;

/** Stable hue per room kind, so a kitchen is the same colour in every building. */
function hue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export class Floorplan {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly title: HTMLElement;
  private readonly legend: HTMLElement;
  private open = true;

  constructor(host: HTMLElement) {
    host.innerHTML = `
      <div class="fp-head"><span id="fp-title">plan</span><button id="fp-toggle" title="hide">▾</button></div>
      <canvas id="fp-canvas" width="760" height="760"></canvas>
      <div class="fp-legend" id="fp-legend"></div>`;
    this.canvas = host.querySelector('#fp-canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.title = host.querySelector('#fp-title')!;
    this.legend = host.querySelector('#fp-legend')!;
    const btn = host.querySelector<HTMLButtonElement>('#fp-toggle')!;
    btn.addEventListener('click', () => {
      this.open = !this.open;
      host.classList.toggle('collapsed', !this.open);
      btn.textContent = this.open ? '▾' : '▸';
    });
  }

  get visible(): boolean { return this.open; }

  // -- the building --------------------------------------------------------------------------

  /** One floor of a composed plan. Multi-storey buildings draw only the storey you stand on. */
  interior(map: SemanticMap, px: number, pz: number, pyaw: number, floor: number): void {
    const zones = map.zones.filter((z) => z.floor === floor);
    if (!zones.length) return;
    const { ctx } = this;
    const box = bounds(zones.map((z) => z.rect));
    const { X, Z, sc } = this.frame(box);
    this.title.textContent = `${map.archetype} · floor ${floor}`;
    this.legend.innerHTML = legend([
      ['#ffd166', 'door'], ['#ff6b6b', 'locked'], ['#c77dff', 'secret'],
      ['#ffd060', 'start'], ['#ffe9a8', 'key'], ['#b7f0c8', 'person'], ['#7dd3fc', 'you'],
    ]);

    for (const z of zones) {
      const w = (z.rect.x1 - z.rect.x0) * sc, h = (z.rect.z1 - z.rect.z0) * sc;
      // an open-sky zone (a yard, a courtyard) is green; a roofed room takes its kind's hue
      ctx.fillStyle = z.ceilY == null ? '#2c4a30' : `hsl(${hue(z.kind)} 34% 26%)`;
      ctx.fillRect(X(z.rect.x0), Z(z.rect.z0), w, h);
      ctx.strokeStyle = '#d9dbe3aa'; ctx.lineWidth = 2;
      ctx.strokeRect(X(z.rect.x0), Z(z.rect.z0), w, h);
      // the name only when the room is big enough to hold it, or the plan turns to soup
      const fs = Math.max(8, Math.min(13, sc * 1.6));
      if (w > fs * 4 && h > fs * 1.8) {
        ctx.fillStyle = '#f2ece0';
        ctx.font = `${fs}px ui-monospace, Menlo, monospace`;
        ctx.fillText(fit(ctx, z.name, w - 8), X(z.rect.x0) + 4, Z(z.rect.z0) + fs + 2);
      }
    }

    for (const d of map.doors.filter((q) => q.floor === floor)) {
      const alongX = d.yaw === 0 || d.yaw === 8;
      ctx.strokeStyle = d.lock ? '#ff6b6b' : d.secret ? '#c77dff' : '#ffd166';
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (alongX) { ctx.moveTo(X(d.x - d.w / 2), Z(d.z)); ctx.lineTo(X(d.x + d.w / 2), Z(d.z)); }
      else { ctx.moveTo(X(d.x), Z(d.z - d.w / 2)); ctx.lineTo(X(d.x), Z(d.z + d.w / 2)); }
      ctx.stroke();
      if (d.lock) { ctx.fillStyle = '#ff6b6b'; ctx.font = 'bold 12px ui-monospace, monospace'; ctx.fillText('#', X(d.x) - 4, Z(d.z) + 4); }
    }

    ctx.fillStyle = '#b7f0c8';
    for (const p of map.people) {
      const z = map.zones.find((q) => q.id === p.zone);
      if (z?.floor !== floor) continue;
      ctx.beginPath(); ctx.arc(X(p.spot.x), Z(p.spot.z), 2.5, 0, 7); ctx.fill();
    }
    if (map.start.floor === floor) {
      ctx.fillStyle = '#ffd060'; ctx.font = 'bold 14px ui-monospace, monospace';
      ctx.fillText('S', X(map.start.x) - 5, Z(map.start.z) + 5);
    }
    ctx.fillStyle = '#ffe9a8'; ctx.font = 'bold 13px ui-sans-serif';
    for (const k of map.keys) if (k.spot.floor === floor) ctx.fillText('⚷', X(k.spot.x) - 5, Z(k.spot.z) + 5);

    this.you(X(px), Z(pz), pyaw);
  }

  // -- the street ----------------------------------------------------------------------------

  /** The city's own plan: every building you can walk into, and which door is which. */
  city(world: CityWorld, px: number, pz: number, pyaw: number, reach = 150): void {
    const lots = world.lots().filter((l) => Math.abs(l.rect.minX - px) < reach && Math.abs(l.rect.minZ - pz) < reach);
    if (!lots.length) return;
    const { ctx } = this;
    const { X, Z } = this.frame({ x0: px - reach, z0: pz - reach, x1: px + reach, z1: pz + reach });
    this.title.textContent = `the street · ${lots.length} doors near you`;
    this.legend.innerHTML = legend([['#ffd166', 'door'], ['#7dd3fc', 'you'], ['#f6b73c', 'civic']]);

    for (const l of lots) {
      const w = (l.rect.maxX - l.rect.minX), h = (l.rect.maxZ - l.rect.minZ);
      ctx.fillStyle = l.civic ? '#4a3f22' : '#2b303c';
      ctx.fillRect(X(l.rect.minX), Z(l.rect.minZ), w * this.sc, h * this.sc);
      ctx.strokeStyle = l.civic ? '#f6b73c88' : '#8b95a866'; ctx.lineWidth = 1.5;
      ctx.strokeRect(X(l.rect.minX), Z(l.rect.minZ), w * this.sc, h * this.sc);
      // the doorway, as a tick on the facade
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(X(l.door.x), Z(l.door.z), 2.5, 0, 7); ctx.fill();
      if (l.civic && w * this.sc > 26) {
        ctx.fillStyle = '#e8dcc0'; ctx.font = '8px ui-monospace, Menlo, monospace';
        ctx.fillText(fit(ctx, l.name, w * this.sc - 6), X(l.rect.minX) + 3, Z(l.rect.minZ) + 11);
      }
    }
    this.you(X(px), Z(pz), pyaw);
  }

  /** The name of the lot whose door is nearest the player, for the panel's caption. */
  static nearestDoor(lots: CityLot[], x: number, z: number): CityLot | null {
    let best: CityLot | null = null, bd = Infinity;
    for (const l of lots) {
      const d = (l.door.x - x) ** 2 + (l.door.z - z) ** 2;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  // -- shared ---------------------------------------------------------------------------------

  private sc = 1;

  /** Clear, then fit a world-space box into the canvas and return the projections.
   *
   *  The backing store follows the layout box × dpr and the context is scaled by dpr, so everything
   *  below draws in CSS PIXELS. That is what keeps the labels legible: a 14 px font is 14 px on the
   *  screen whether the panel is 170 or 330 wide, and stays sharp on a retina display. */
  private frame(box: { x0: number; z0: number; x1: number; z1: number }) {
    const { ctx, canvas } = this;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(120, Math.round(canvas.clientWidth || 300)), H = W;
    if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const sc = Math.min((W - 2 * PAD) / Math.max(1, box.x1 - box.x0), (H - 2 * PAD) / Math.max(1, box.z1 - box.z0));
    this.sc = sc;
    return { sc, X: (x: number) => PAD + (x - box.x0) * sc, Z: (z: number) => PAD + (z - box.z0) * sc };
  }

  /** You are here, and this is the way you are facing. */
  private you(x: number, y: number, yaw: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-yaw);                 // world yaw turns counter-clockwise; canvas z runs down
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function bounds(rects: { x0: number; z0: number; x1: number; z1: number }[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of rects) { x0 = Math.min(x0, r.x0); z0 = Math.min(z0, r.z0); x1 = Math.max(x1, r.x1); z1 = Math.max(z1, r.z1); }
  return { x0, z0, x1, z1 };
}

/** Trim a label to the width it has, with an ellipsis — a room name must never spill into its neighbour. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

const legend = (items: [string, string][]) =>
  items.map(([c, t]) => `<i style="color:${c}">■ ${t}</i>`).join('');
