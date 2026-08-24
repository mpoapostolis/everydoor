// apps/demo/src/panel.ts — the dials.
//
// Every knob here is one of the generator's actual inputs: the city seed, the flavour, and which
// archetype to compose. Nothing is a display setting. Turning one and watching the world change is
// the entire point of the demo — so the panel writes straight to the swap and never keeps its own copy.
import { archetypeIds, CITY_THEMES, styleIds, type CityKind } from '@everydoor/core';

export interface PanelHooks {
  onCity(seed: number, theme: CityKind): void;
  onArchetype(id: string, seed: number, style: string): void;
  onExit(): void;
  /** A fresh everything: new seed, new flavour, new building, and a door picked at random. */
  onRandomize(seed: number, theme: CityKind): void;
}

export interface PanelState {
  where: string;
  detail: string;
  zone: string;
  seed: number;
  lotSeed: number | null;
  lots: number;
  chunks: number;
  fps: number;
  canExit: boolean;
}

export class Panel {
  private readonly el: HTMLElement;
  private readonly seedInput: HTMLInputElement;
  private readonly themeSel: HTMLSelectElement;
  private readonly archSel: HTMLSelectElement;
  private readonly styleSel: HTMLSelectElement;
  private readonly exitBtn: HTMLButtonElement;
  private readonly vals: Record<string, HTMLElement> = {};

  constructor(hooks: PanelHooks, seed: number, theme: CityKind) {
    this.el = document.getElementById('panel')!;
    this.el.innerHTML = `
      <h1>everydoor</h1>
      ${row('where', 'where')}
      ${row('place', 'detail')}
      ${row('room', 'zone')}
      <hr />
      <div class="row"><span class="k">seed</span><input id="p-seed" type="number" value="${seed}" /></div>
      <div class="row"><span class="k">city</span>
        <select id="p-theme">${Object.keys(CITY_THEMES).map((k) => `<option value="${k}"${k === theme ? ' selected' : ''}>${k}</option>`).join('')}</select>
      </div>
      <div class="row"><span class="k">style</span>
        <select id="p-style"><option value="">— per archetype —</option>${styleIds().map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
      </div>
      <div class="row"><span class="k">compose</span>
        <select id="p-arch"><option value="">— archetype —</option>${archetypeIds().map((a) => `<option value="${a}">${a}</option>`).join('')}</select>
      </div>
      <div class="row"><button id="p-random" class="hero" style="flex:1">🎲 everything, from scratch</button></div>
      <div class="row"><button id="p-roll" style="flex:1">↻ new city</button><button id="p-exit" style="flex:1">↩ street</button></div>
      <hr />
      ${row('lot seed', 'lotSeed')}
      ${row('doors', 'lots')}
      ${row('chunks', 'chunks')}
      ${row('fps', 'fps')}
      <hr />
      <div class="keys">WASD move · shift run · space jump<br />drag to look · arrows turn · <b>E</b> at a door</div>`;

    for (const k of ['where', 'detail', 'zone', 'lotSeed', 'lots', 'chunks', 'fps']) {
      this.vals[k] = this.el.querySelector(`#v-${k}`)!;
    }
    this.seedInput = this.el.querySelector('#p-seed')!;
    this.themeSel = this.el.querySelector('#p-theme')!;
    this.archSel = this.el.querySelector('#p-arch')!;
    this.styleSel = this.el.querySelector('#p-style')!;
    this.exitBtn = this.el.querySelector('#p-exit')!;

    const rebuild = () => hooks.onCity(this.seed, this.themeSel.value as CityKind);
    this.seedInput.addEventListener('change', rebuild);
    this.themeSel.addEventListener('change', rebuild);
    this.el.querySelector('#p-roll')!.addEventListener('click', () => {
      // an ODD STRIDE, not a die: it walks the whole 32-bit space and never repeats a layout,
      // and the sequence stays reproducible — a city a visitor liked can be typed back in.
      this.seedInput.value = String((this.seed + 0x9e3779b1) >>> 0);
      rebuild();
    });
    const compose = () => { if (this.archSel.value) hooks.onArchetype(this.archSel.value, this.seed, this.styleSel.value); };
    this.archSel.addEventListener('change', compose);
    this.styleSel.addEventListener('change', compose);
    this.exitBtn.addEventListener('click', () => hooks.onExit());

    // EVERYTHING, FROM SCRATCH. Not a "randomize" toy: a new seed rebuilds the city, which redeals
    // the lot table, which re-derives every interior behind every door — and then drops you through
    // one of them. Nothing about the world you were just in survives except the rules that made it.
    this.el.querySelector('#p-random')!.addEventListener('click', () => {
      const themes = Object.keys(CITY_THEMES) as CityKind[];
      const theme = themes[Math.floor(Math.random() * themes.length)];
      const seed = (Math.random() * 0xffffffff) >>> 0;
      this.seedInput.value = String(seed);
      this.themeSel.value = theme;
      this.archSel.value = '';
      this.styleSel.value = '';
      hooks.onRandomize(seed, theme);
    });
  }

  get seed(): number { return (Number(this.seedInput.value) || 0) >>> 0; }

  update(s: PanelState): void {
    this.vals.where.textContent = s.where;
    this.vals.detail.textContent = s.detail || '—';
    this.vals.zone.textContent = s.zone || '—';
    this.vals.lotSeed.textContent = s.lotSeed === null ? '—' : '0x' + s.lotSeed.toString(16);
    this.vals.lots.textContent = String(s.lots);
    this.vals.chunks.textContent = String(s.chunks);
    this.vals.fps.textContent = String(Math.round(s.fps));
    this.exitBtn.disabled = !s.canExit;
    this.exitBtn.style.opacity = s.canExit ? '1' : '.4';
    if (this.seed !== s.seed) this.seedInput.value = String(s.seed);
  }
}

const row = (label: string, id: string) => `<div class="row"><span class="k">${label}</span><span class="v" id="v-${id}">—</span></div>`;
