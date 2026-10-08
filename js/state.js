// Settings, presets and persistence.

// Defaults are the hands design (assets/default.jpg) the tool opens with.
export const DEFAULTS = {
  // source
  sourceType: 'image',   // 'image' | 'text'
  text: 'halftone',
  font: 'serif',         // a FONTS id (js/source.js)
  fontWeight: 400,
  italic: true,
  width: 3620,

  // subject (image sources only)
  subject: 'off',        // 'off' | 'people' | 'any'
  maskEdge: 6,
  maskKeep: 'subject',   // 'subject' | 'background'

  // field: per-area halftone strength, set with pins on the image
  field: 'off',          // 'off' | 'on'
  pins: [],              // [{ x, y in 0..1, v in 0..100 }]
  fieldBlur: 30,         // blur at strength 100, px
  fieldSolid: 25,        // below this strength the original shows, unscreened, %
  fieldSoft: 30,         // width of the cross-fade from original to halftone, %

  // tone
  brightness: 100,
  contrast: -20,
  gamma: 1.02,
  blackPoint: 41,
  whitePoint: 74,
  blur: 26,
  invert: true,

  // grid
  layout: 'square',      // 'square' | 'hex' | 'radial' | 'spiral' | 'noise'
  cell: 9,
  angle: 35,
  clusters: 0,
  seed: 1,

  // shape
  shape: 'dot',          // 'dot' | 'square' | 'diamond' | 'cross' | 'line' | 'tri' | 'char'
  charset: ' .:-=+*#%@',
  method: 'size',        // 'size' | 'dither'
  dither: 'floyd',
  roundness: 0,
  scale: 100,
  floor: 0,
  cutoff: 0,
  merge: 1,
  mergeVar: 90,
  shades: 'off',         // 'off' | 'on': grey levels from tone, as ink opacity
  shadeLevels: 4,
  shadeMin: 25,          // opacity of the faintest shade, %

  // output
  colors: 'wb',          // 'bw' black on white | 'wb' white on black
  antialias: true,
};

// Presets only touch the grid / shape look — never source, subject, tone or output.
// Each starts from the same base so nothing leaks over from the previous look.
const BASE = {
  layout: 'square', cell: 16, angle: 0, clusters: 0, shape: 'dot', method: 'size',
  dither: 'floyd', roundness: 0, scale: 100, floor: 0, cutoff: 0, merge: 0, mergeVar: 0,
};
const preset = (p) => ({ ...BASE, ...p });

export const PRESETS = {
  dots: preset({ angle: 45 }),
  grid: preset({ cell: 28, scale: 110, floor: 14 }),
  liquid: preset({ cell: 24, angle: 45, scale: 105, cutoff: 8, merge: 50 }),
  goo: preset({ cell: 22, method: 'dither', scale: 82, merge: 60, mergeVar: 60 }),
  bitdots: preset({ cell: 8, method: 'dither', dither: 'bayer4', scale: 75 }),
  pixels: preset({ cell: 10, shape: 'square', method: 'dither', dither: 'threshold' }),
  mosaic: preset({ cell: 5, shape: 'square', clusters: 25, method: 'dither', dither: 'atkinson' }),
  lines: preset({ cell: 10, angle: 30, shape: 'line' }),
  rings: preset({ layout: 'radial', cell: 12, shape: 'line' }),
  ascii: preset({ cell: 12, shape: 'char', scale: 100 }),
};

// Starting layouts for the field's pins.
export const FIELD_STARTS = {
  ramp: [{ x: 0.3, y: 0.5, v: 0 }, { x: 0.85, y: 0.5, v: 100 }],
  rampBack: [{ x: 0.15, y: 0.5, v: 100 }, { x: 0.7, y: 0.5, v: 0 }],
  center: [{ x: 0.5, y: 0.5, v: 0 }, { x: 0.02, y: 0.02, v: 100 }, { x: 0.98, y: 0.02, v: 100 }, { x: 0.02, y: 0.98, v: 100 }, { x: 0.98, y: 0.98, v: 100 }],
};

const KEY = 'halftoner:settings';

export function loadSaved() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULTS };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}

// Keep only keys this build knows whose type still matches.
export function sanitize(obj) {
  const out = { ...DEFAULTS };
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (k in obj && typeof obj[k] === typeof DEFAULTS[k]) out[k] = obj[k];
    }
    out.pins = Array.isArray(out.pins)
      ? out.pins.filter((p) => p && [p.x, p.y, p.v].every(Number.isFinite)).map(({ x, y, v }) => ({ x, y, v }))
      : [];
    // older builds drew circles as "roundness 100" with no shape key
    if (!('shape' in obj) && obj.roundness === 100) { out.shape = 'dot'; out.roundness = 0; }
    else if (!('shape' in obj) && typeof obj.roundness === 'number') out.shape = 'square';
  }
  return out;
}

export function randomize(state) {
  const r = Math.random;
  const pick = (a) => a[Math.floor(r() * a.length)];
  const shape = pick(['dot', 'dot', 'dot', 'square', 'square', 'diamond', 'cross', 'line', 'tri', 'char']);
  return {
    ...state,
    layout: pick(['square', 'square', 'square', 'hex', 'radial', 'spiral', 'noise']),
    cell: Math.round(5 + r() * 30),
    angle: pick([0, 0, 15, 30, 45, 45]),
    clusters: r() < 0.8 ? 0 : Math.round(r() * 40),
    seed: Math.floor(r() * 9999) + 1,
    shape,
    method: r() < 0.5 ? 'size' : 'dither',
    dither: pick(['threshold', 'bayer2', 'bayer4', 'bayer8', 'floyd', 'atkinson', 'random']),
    roundness: r() < 0.6 ? 0 : Math.round(r() * 100),
    scale: Math.round(60 + r() * 90),
    floor: r() < 0.7 ? 0 : Math.round(r() * 30),
    cutoff: r() < 0.6 ? 0 : Math.round(r() * 20),
    merge: shape === 'char' || r() < 0.55 ? 0 : Math.round(20 + r() * 70),
    mergeVar: r() < 0.5 ? 0 : Math.round(r() * 100),
  };
}
