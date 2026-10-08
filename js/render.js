// Drawing to canvas, and PNG / SVG / TXT export.
// Output is strictly black & white. A result may carry `layers` (field
// layers from runtime.js) that blend the original image into the halftone.

import { paint } from './runtime.js';
import { withSettings, jpegWithSettings } from './pngmeta.js';

export const EXPORT_SCALE = 4; // PNG / JPEG are always 4× the design width

export const GLYPH_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace';

export function inkColors(s) {
  return s.colors === 'wb' ? { fg: '#ffffff', bg: '#000000' } : { fg: '#000000', bg: '#ffffff' };
}

// Draws a result (W x H units) into ctx at `scale` device pixels per unit.
export function drawDesign(ctx, result, s, scale, transparent) {
  const { fg, bg } = inkColors(s);
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!transparent) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);
  }
  paint(ctx, result, { ink: fg, k: scale, layers: result.layers });
  if (!s.antialias) toOneBit(ctx, s, transparent);
}

// Snap every pixel to pure ink or pure paper (or ink / fully transparent).
function toOneBit(ctx, s, transparent) {
  const { width: w, height: h } = ctx.canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const ink = s.colors === 'wb' ? 255 : 0;
  for (let i = 0; i < d.length; i += 4) {
    if (transparent) {
      const on = d[i + 3] >= 128;
      d[i] = d[i + 1] = d[i + 2] = ink;
      d[i + 3] = on ? 255 : 0;
    } else {
      const v = d[i + 1] >= 128 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Browsers cap canvas area (Safari/iOS around 16.7M px). Find the largest
// scale <= wanted that actually yields a working canvas.
function workingCanvas(W, H, wanted) {
  const ua = navigator.userAgent;
  const safari = /iPad|iPhone|iPod/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua));
  const limit = safari ? 16_777_216 : 120_000_000;
  let scale = Math.min(wanted, Math.sqrt(limit / (W * H)), 16384 / Math.max(W, H));
  while (scale > 0.1) {
    const c = document.createElement('canvas');
    c.width = Math.round(W * scale);
    c.height = Math.round(H * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.fillRect(0, 0, 1, 1);
      if (ctx.getImageData(0, 0, 1, 1).data[3] === 255) return { c, ctx, scale };
    }
    scale *= 0.75;
  }
  throw new Error('Canvas too large for this browser');
}

// format 'png' → transparent background; 'jpeg' → on the paper colour.
// Both carry the settings, so opening the file in Halftoner restores the look.
export async function exportImage(result, s, name, format) {
  const { W, H } = result;
  const { c, ctx, scale } = workingCanvas(W, H, EXPORT_SCALE);
  const png = format === 'png';
  drawDesign(ctx, result, s, scale, png);
  let blob = await new Promise((res) => c.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.95));
  blob = png ? await withSettings(blob, s) : await jpegWithSettings(blob, s);
  download(blob, `${name}-${c.width}x${c.height}.${png ? 'png' : 'jpg'}`);
  return { w: c.width, h: c.height, reduced: scale < EXPORT_SCALE - 1e-6 };
}

const esc = (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c);

function glyphTexts(result) {
  return result.glyphs.map((g) => `<text x="${g.x}" y="${g.y}" font-size="${g.fs}"${g.a == null ? '' : ` fill-opacity="${g.a}"`}>${esc(g.c)}</text>`).join('');
}

// Field layers as SVG-ready images: the original tinted in the ink colour,
// and the halftone's fade as a luminance mask (white = halftone shows).
function layerImages(layers, fg) {
  const { photo, alpha } = layers;
  const tint = document.createElement('canvas');
  tint.width = photo.width; tint.height = photo.height;
  const t = tint.getContext('2d');
  t.drawImage(photo, 0, 0);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = fg;
  t.fillRect(0, 0, tint.width, tint.height);
  const lum = document.createElement('canvas');
  lum.width = alpha.width; lum.height = alpha.height;
  const l = lum.getContext('2d');
  l.fillStyle = '#000';
  l.fillRect(0, 0, lum.width, lum.height);
  l.drawImage(alpha, 0, 0);
  return { photo: tint.toDataURL('image/png'), mask: lum.toDataURL('image/png') };
}

export function svgString(result, s) {
  const { W, H } = result;
  const { fg } = inkColors(s);
  const crisp = s.antialias ? '' : ' shape-rendering="crispEdges"';
  const path = (result.pathD ? `<path fill="${fg}"${crisp} d="${result.pathD}"/>` : '') +
    (result.shadePaths || []).map((g) => `<path fill="${fg}" fill-opacity="${g.a}"${crisp} d="${g.d}"/>`).join('');
  let body = result.kind === 'glyphs'
    ? `${path}<g fill="${fg}" font-family='${GLYPH_FONT}' font-weight="600" text-anchor="middle" dominant-baseline="central">${glyphTexts(result)}</g>`
    : path;
  let defs = `<clipPath id="frame"><rect width="${W}" height="${H}"/></clipPath>`;
  if (result.layers) {
    const img = layerImages(result.layers, fg);
    const image = (href) => `<image href="${href}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
    defs += `<mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">${image(img.mask)}</mask>`;
    body = `${image(img.photo)}<g mask="url(#fade)">${body}</g>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs>${defs}</defs>` +
    // transparent, like the PNG: place it on any background
    `<g clip-path="url(#frame)">${body}</g></svg>`
  );
}

export function exportSVG(result, s, name) {
  const svg = svgString(result, s);
  download(new Blob([svg], { type: 'image/svg+xml' }), `${name}-${result.W}x${result.H}.svg`);
  return svg.length;
}

// Plain-text art: one line per grid row (square/hex grids at any angle work,
// but angle 0 reads best).
export function exportTXT(result) {
  const g = result.glyphs;
  if (!g.length) return 0;
  let imin = Infinity, imax = -Infinity, jmin = Infinity, jmax = -Infinity;
  for (const p of g) {
    imin = Math.min(imin, p.i); imax = Math.max(imax, p.i);
    jmin = Math.min(jmin, p.j); jmax = Math.max(jmax, p.j);
  }
  const rows = Array.from({ length: jmax - jmin + 1 }, () => new Array(imax - imin + 1).fill(' '));
  for (const p of g) rows[p.j - jmin][p.i - imin] = p.c;
  const txt = rows.map((r) => r.join('').replace(/\s+$/, '')).join('\n') + '\n';
  download(new Blob([txt], { type: 'text/plain' }), 'halftone.txt');
  return txt.length;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
