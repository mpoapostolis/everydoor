// tests/dom-stub.mjs — the DOM the generator reaches for, and nothing more.
//
// Both worlds paint their textures on a 2D canvas and the demo puts name plates on sprites, so a
// headless run needs a canvas that answers every call without drawing. three's geometry, colliders
// and scene graph are pure maths and run for real — only the pixels are stubbed. No GL anywhere.
if (typeof globalThis.document === 'undefined') {
  const ctx2d = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 64, height: 64 };
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return (_x, _y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === 'createImageData') return (w = 1, h = 1) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createPattern') return () => null;
      return () => {};
    },
    set: () => true,
  });
  const makeCanvas = () => ({
    width: 64, height: 64, style: {}, getContext: () => ctx2d,
    toDataURL: () => 'data:image/png;base64,', addEventListener() {}, removeEventListener() {},
  });
  const makeEl = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, append() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelectorAll: () => [], querySelector: () => null, setAttribute() {}, textContent: '', innerHTML: '',
  });
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? makeCanvas() : makeEl()),
    createElementNS: () => makeCanvas(),
    body: { appendChild() {}, removeChild() {} },
    getElementById: () => makeEl(), querySelectorAll: () => [], querySelector: () => null,
    addEventListener() {}, removeEventListener() {}, hidden: false, visibilityState: 'visible',
    documentElement: makeEl(), fullscreenElement: null, pointerLockElement: null,
  };
  globalThis.ImageData = class {
    constructor(a, b, c) {
      if (a instanceof Uint8ClampedArray) { this.data = a; this.width = b; this.height = c ?? a.length / 4 / b; }
      else { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    }
  };
}
globalThis.window ??= { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.navigator ??= { userAgent: 'node', hardwareConcurrency: 8 };
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.devicePixelRatio ??= 1;
