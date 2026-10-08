// The browser-side half of the pipeline, shared by the tool and the exported
// web kit: turning an image into the engine's source, and drawing a result
// onto a canvas at any size. Everything heavy lives in engine.js.

import { createEngine } from './engine.js';
import { grayFrom, inkMap, fieldMap, fieldRamp, smoothstep } from './tone.js';

export const WORK_MAX = 1600;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

// Browsers resample a decoded <img> and a <canvas> slightly differently, so
// every input is first copied to a canvas at its natural size: the tool
// (canvases) and the web kit (images) then take the exact same path.
function asCanvas(image) {
  const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent pixels read as paper
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0);
  return c;
}

// image (and optional subject mask, white = subject) -> engine source.
// The design is `config.width` units wide; height follows the image.
export function prepareSource(image, mask, config) {
  image = asCanvas(image);
  if (mask) mask = asCanvas(mask);
  const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
  const W = config.width;
  const H = Math.max(1, Math.round((W * ih) / iw));
  const ws = Math.min(1, WORK_MAX / Math.max(W, H));
  const wt = Math.max(1, Math.round(W * ws)), ht = Math.max(1, Math.round(H * ws));
  return {
    gray: grayFrom(image, wt, ht),
    mask: mask ? grayFrom(mask, wt, ht) : null,
    wt, ht, W, H, ws,
  };
}

// Synchronous, on the calling thread. Prefer a worker for large designs.
export function computeHalftone(source, config) {
  const engine = createEngine();
  engine.setSource({ key: 'runtime', ...source });
  return engine.render(config, false);
}

const GLYPH_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace';
const LAYER_MAX = 2000; // longest side of the field layers

// Field layers: where the field is below `sharp`, the original image shows
// (tone-adjusted, unblurred); across `fade` it dissolves into the halftone.
//   photo — alpha = how much original ink shows (white rgb; tinted at paint)
//   alpha — alpha = how much of the halftone shows
// Returns null when the field leaves nothing sharp.
export function fieldLayers(image, mask, config) {
  const ramp = fieldRamp(config);
  if (!ramp) return null;
  image = asCanvas(image);
  if (mask) mask = asCanvas(mask);
  const W = config.width;
  const H = Math.max(1, Math.round((W * image.height) / image.width));
  const k = Math.min(1, LAYER_MAX / Math.max(W, H));
  const pw = Math.max(1, Math.round(W * k)), ph = Math.max(1, Math.round(H * k));
  const ink = inkMap(grayFrom(image, pw, ph), mask ? grayFrom(mask, pw, ph) : null, pw, ph,
    { ...config, blur: 0, field: 'off' }, k, null);
  const field = fieldMap(config.pins, pw, ph);
  const photo = new ImageData(pw, ph), alpha = new ImageData(pw, ph);
  for (let i = 0, j = 0; i < ink.length; i++, j += 4) {
    const a = smoothstep(ramp[0], ramp[1], field[i]);
    photo.data[j] = photo.data[j + 1] = photo.data[j + 2] = 255;
    photo.data[j + 3] = Math.round(ink[i] * (1 - a) * 255);
    alpha.data[j] = alpha.data[j + 1] = alpha.data[j + 2] = 255;
    alpha.data[j + 3] = Math.round(a * 255);
  }
  const toCanvas = (img) => {
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  };
  return { photo: toCanvas(photo), alpha: toCanvas(alpha) };
}

const paths = new WeakMap();
// Cached Path2D for a result ({ pathD }) or a shade group ({ d }).
export function pathFor(item) {
  const d = item.pathD != null ? item.pathD : item.d;
  if (!d) return null;
  let p = paths.get(item);
  if (!p) { p = new Path2D(d); paths.set(item, p); }
  return p;
}

// Paints a result in `ink` onto ctx (paper already down), design units mapped
// by scale k and offset (ox, oy). With field layers, the original shows
// through and the halftone fades in on top of it.
export function paint(ctx, result, { ink = '#000', k = 1, ox = 0, oy = 0, layers = null } = {}) {
  if (ink === 'currentColor') ink = getComputedStyle(ctx.canvas).color;
  const drawInk = (c) => {
    c.setTransform(k, 0, 0, k, ox, oy);
    c.fillStyle = ink;
    const p = pathFor(result);
    if (p) c.fill(p);
    for (const group of result.shadePaths || []) {
      c.globalAlpha = group.a;
      c.fill(pathFor(group));
    }
    c.globalAlpha = 1;
    if (result.glyphs) {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      let font = '';
      for (const g of result.glyphs) {
        const f = `600 ${g.fs}px ${GLYPH_FONT}`;
        if (f !== font) { c.font = f; font = f; }
        c.globalAlpha = g.a == null ? 1 : g.a;
        c.fillText(g.c, g.x, g.y);
      }
      c.globalAlpha = 1;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  };
  if (!layers) { drawInk(ctx); return; }

  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const off = document.createElement('canvas');
  off.width = cw; off.height = ch;
  const o = off.getContext('2d');
  o.imageSmoothingQuality = 'high';
  // the original, tinted with the ink colour
  o.setTransform(k, 0, 0, k, ox, oy);
  o.drawImage(layers.photo, 0, 0, result.W, result.H);
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = ink;
  o.fillRect(0, 0, cw, ch);
  ctx.drawImage(off, 0, 0);
  // the halftone, faded in by the field
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, cw, ch);
  drawInk(o);
  o.globalCompositeOperation = 'destination-in';
  o.setTransform(k, 0, 0, k, ox, oy);
  o.drawImage(layers.alpha, 0, 0, result.W, result.H);
  ctx.drawImage(off, 0, 0);
}

// object-position style: 'center', 'left top', '30% 60%' ...
function parsePosition(pos) {
  const words = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  const parts = String(pos || 'center').trim().split(/\s+/);
  const read = (p) => (p in words ? words[p] : p && p.endsWith('%') ? parseFloat(p) / 100 : 0.5);
  return [read(parts[0]), read(parts[1] || (parts[0] === 'top' || parts[0] === 'bottom' ? 'center' : parts[0]))];
}

// Draws a result to fill `canvas`'s CSS box, sharp at the device pixel ratio.
// fit: 'contain' | 'cover' (like object-fit), position like object-position.
// Pass `layers` (from fieldLayers) when the design uses a field with a sharp area.
export function drawHalftone(canvas, result, { ink = '#000', paper = null, fit = 'contain', position = 'center', layers = null, maxPixels = 16e6 } = {}) {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, rect.width), cssH = Math.max(1, rect.height);
  let dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (cssW * cssH * dpr * dpr > maxPixels) dpr = Math.sqrt(maxPixels / (cssW * cssH));
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (paper) {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const { W, H } = result;
  const k = (fit === 'cover' ? Math.max(cssW / W, cssH / H) : Math.min(cssW / W, cssH / H)) * dpr;
  const [px, py] = parsePosition(position);
  paint(ctx, result, { ink, k, ox: (canvas.width - W * k) * px, oy: (canvas.height - H * k) * py, layers });
}
