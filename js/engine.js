// The halftone pipeline, DOM-free so it can run in a Web Worker.
// source (gray + mask) -> ink map -> dots -> path / glyphs, each stage cached.

import { inkMap, makeSampler, fieldMap, fieldRamp, mapSampler } from './tone.js';
import { buildDots } from './lattice.js';
import { shapesPath, liquidPath, glyphs } from './geometry.js';

const MAX_DOTS = 250_000;

const TONE_KEYS = ['brightness', 'contrast', 'gamma', 'blackPoint', 'whitePoint', 'blur', 'invert', 'subject', 'maskEdge', 'maskKeep',
  'field', 'pins', 'fieldBlur'];
const GEOM_KEYS = ['layout', 'cell', 'angle', 'clusters', 'seed', 'shape', 'method', 'dither', 'roundness',
  'scale', 'floor', 'cutoff', 'merge', 'mergeVar', 'charset', 'fieldSolid', 'fieldSoft', 'shades', 'shadeLevels', 'shadeMin'];

const pick = (s, keys) => JSON.stringify(keys.map((k) => s[k]));

// Shades: ink opacity from tone, in `shadeLevels` even steps from exactly
// `shadeMin` (lightest tones) to 1 (darkest).
function shadeOf(t, s) {
  const L = Math.max(2, s.shadeLevels | 0);
  const i = Math.min(L - 1, Math.floor(Math.max(0, t) * L));
  const lo = s.shadeMin / 100;
  return Math.round((lo + ((1 - lo) * i) / (L - 1)) * 1000) / 1000;
}

export function createEngine() {
  let src = null;      // { key, gray, mask, wt, ht, W, H, ws }
  let toneKey = null, ink = null, sample = null, field = null;
  let geomKey = null, result = null;

  return {
    setSource(source) {
      src = source;
      toneKey = geomKey = null;
    },

    // haveTone: the tone key the caller already holds, so the ink map is only
    // sent back when it changed.
    render(s, wantTone, haveTone) {
      if (!src) return null;
      const t0 = performance.now();
      const tk = `${src.key}|${pick(s, TONE_KEYS)}`;
      if (tk !== toneKey) {
        field = s.field === 'on' && s.pins.length ? fieldMap(s.pins, src.wt, src.ht) : null;
        ink = inkMap(src.gray, src.mask, src.wt, src.ht, s, src.ws, field);
        sample = makeSampler(ink, src.wt, src.ht, src.ws);
        toneKey = tk;
        geomKey = null;
      }
      const gk = `${tk}|${pick(s, GEOM_KEYS)}`;
      if (gk !== geomKey) {
        const { W, H } = src;
        const area = s.layout === 'hex' ? Math.sqrt(3) / 2 : 1;
        const cellEff = Math.max(s.cell, Math.sqrt((W * H) / (MAX_DOTS * area)));
        let dots = buildDots(s, W, H, cellEff, sample);
        // Field: where the original shows fully (below the fade), dots would
        // be invisible, so skip them. The original itself is drawn by runtime.js.
        const ramp = field && fieldRamp(s);
        if (ramp) {
          const fieldAt = mapSampler(field, src.wt, src.ht, src.ws);
          dots = dots.filter((d) => fieldAt(d.x, d.y) > ramp[0]);
        }
        result = { W, H, cellEff, count: dots.length };
        if (s.shape === 'char') {
          result.kind = 'glyphs';
          result.glyphs = glyphs(dots, s);
          if (s.shades === 'on') for (const g of result.glyphs) g.a = shadeOf(g.t, s);
          result.count = result.glyphs.length;
        } else {
          result.kind = 'path';
          const trace = (list) => (s.merge > 0 ? liquidPath(list, s, W, H, cellEff) : shapesPath(list, s, cellEff));
          if (s.shades === 'on') {
            // one path per grey level, so same-level shapes union without stacking
            const groups = new Map();
            for (const d of dots) {
              const a = shadeOf(d.t, s);
              if (!groups.has(a)) groups.set(a, []);
              groups.get(a).push(d);
            }
            result.pathD = '';
            result.shadePaths = [...groups].sort((x, y) => x[0] - y[0]).map(([a, list]) => ({ a, d: trace(list) }));
          } else {
            result.pathD = trace(dots);
          }
        }
        geomKey = gk;
      }
      const out = { ...result, ms: Math.round(performance.now() - t0), toneKey };
      if (wantTone && haveTone !== toneKey) out.tone = { data: ink.slice(), w: src.wt, h: src.ht };
      return out;
    },
  };
}
