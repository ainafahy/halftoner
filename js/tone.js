// Grayscale, tone adjustments and area sampling.
// Everything here runs at a capped "work" resolution; callers sample in
// output coordinates and the sampler scales them down.

export function grayFrom(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255;
  }
  return g;
}

// Opacity per pixel (0..1), or null when the image is fully opaque.
// Transparent areas of an uploaded PNG / SVG / WebP never get ink.
export function alphaFrom(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const a = new Float32Array(w * h);
  let clear = false;
  for (let i = 0, j = 3; i < a.length; i++, j += 4) {
    a[i] = d[j] / 255;
    if (d[j] < 250) clear = true;
  }
  return clear ? a : null;
}

// Three box passes approximate a gaussian.
export function boxBlur(src, w, h, r) {
  r = Math.round(r);
  if (r < 1) return src;
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / n;
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / n;
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

// The focus field: pins { x, y in 0..1, v in 0..100 } blended by inverse
// squared distance (like Photoshop's Field Blur), as 0..1 per pixel.
export function fieldMap(pins, w, h) {
  const f = new Float32Array(w * h);
  if (!pins.length) return f;
  const asp = w / h;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      let num = 0, den = 0, exact = -1;
      for (const p of pins) {
        const dx = (u - p.x) * asp, dy = v - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-10) { exact = p.v; break; }
        num += p.v / d2;
        den += 1 / d2;
      }
      f[y * w + x] = (exact >= 0 ? exact : num / den) / 100;
    }
  }
  return f;
}

// Where the original shows through: field strength below `sharp` is the
// untouched source, above it the halftone; `fade` widens the cross-fade.
// Returns [lo, hi] in 0..1, or null when nothing stays sharp.
export function fieldRamp(s) {
  if (s.field !== 'on' || !s.pins.length || !(s.fieldSolid > 0)) return null;
  const cut = s.fieldSolid / 100, half = (s.fieldSoft / 100) / 2;
  return [Math.max(0, cut - half), Math.min(1, cut + half)];
}

// 0 below lo, 1 above hi, smooth in between.
export function smoothstep(lo, hi, v) {
  if (hi <= lo) return v < lo ? 0 : 1;
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

// Blur that varies per pixel: a few fixed blur levels, blended by the field.
function fieldBlur(gray, w, h, field, maxR) {
  const LEVELS = 4;
  const levels = [gray];
  for (let k = 1; k <= LEVELS; k++) levels.push(boxBlur(gray, w, h, (maxR * k) / LEVELS));
  const out = new Float32Array(gray.length);
  for (let i = 0; i < out.length; i++) {
    const t = Math.min(LEVELS, Math.max(0, field[i] * LEVELS));
    const k = Math.min(LEVELS - 1, Math.floor(t)), fr = t - k;
    out[i] = levels[k][i] * (1 - fr) + levels[k + 1][i] * fr;
  }
  return out;
}

// Bilinear lookup of a work-resolution map, in output coordinates.
export function mapSampler(arr, w, h, workScale) {
  return (x, y) => {
    x = Math.min(w - 1, Math.max(0, x * workScale - 0.5));
    y = Math.min(h - 1, Math.max(0, y * workScale - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const a = arr[y0 * w + x0] * (1 - fx) + arr[y0 * w + x1] * fx;
    const b = arr[y1 * w + x0] * (1 - fx) + arr[y1 * w + x1] * fx;
    return a * (1 - fy) + b * fy;
  };
}

// Returns "ink" per pixel: 0 = paper, 1 = full ink.
// `mask` (0..1 per pixel, or null) limits ink to the subject or background.
// `field` (0..1 per pixel, or null) adds a blur that grows with the field.
// `alpha` (0..1 per pixel, or null) is the source's own transparency.
export function inkMap(gray, mask, w, h, s, workScale, field, alpha) {
  // With transparency, blur colour and opacity together (premultiplied) so
  // the white read under transparent pixels can't bleed into the shape.
  // grayFrom composites over white: gray = c·a + (1 − a), so c·a = gray − (1 − a).
  let g = gray, a = alpha;
  if (a) {
    g = new Float32Array(gray.length);
    for (let i = 0; i < g.length; i++) g[i] = gray[i] - (1 - a[i]);
  }
  if (s.blur > 0) {
    g = boxBlur(g, w, h, s.blur * workScale);
    if (a) a = boxBlur(a, w, h, s.blur * workScale);
  }
  if (field && s.fieldBlur > 0) {
    g = fieldBlur(g, w, h, field, s.fieldBlur * workScale);
    if (a) a = fieldBlur(a, w, h, field, s.fieldBlur * workScale);
  }
  if (a) {
    for (let i = 0; i < g.length; i++) g[i] = a[i] > 1e-3 ? Math.min(1, Math.max(0, g[i] / a[i])) : 1;
  }
  const out = new Float32Array(g.length);
  const bp = s.blackPoint / 100;
  const wp = Math.max(bp + 0.001, s.whitePoint / 100);
  const br = s.brightness / 100;
  const c = s.contrast / 100;
  const cf = c >= 0 ? 1 / (1 - c * 0.98) : 1 + c;
  const ig = 1 / s.gamma;
  const curve = (v) => {
    let L = (v - bp) / (wp - bp);
    L = (L + br - 0.5) * cf + 0.5;
    L = L < 0 ? 0 : L > 1 ? 1 : L;
    return Math.pow(L, ig);
  };
  // Text is the subject: blank paper must stay empty whatever the tone
  // settings, so ink is measured from the paper's level and invert is ignored.
  const text = s.sourceType === 'text';
  const base = text ? 1 - curve(1) : 0;
  const span = base < 0.999 ? 1 - base : 1;
  for (let i = 0; i < g.length; i++) {
    const L = curve(g[i]);
    if (text) {
      const v = (1 - L - base) / span;
      out[i] = v < 0 ? 0 : v;
    } else {
      out[i] = s.invert ? L : 1 - L;
    }
  }
  if (a) {
    // transparent areas stay empty; blurred edges fade with the opacity
    for (let i = 0; i < out.length; i++) out[i] *= a[i];
  }
  if (mask && s.subject !== 'off') {
    const m = s.maskEdge > 0 ? boxBlur(mask, w, h, s.maskEdge * workScale * 0.5) : mask;
    const keepBg = s.maskKeep === 'background';
    for (let i = 0; i < out.length; i++) out[i] *= keepBg ? 1 - m[i] : m[i];
  }
  return out;
}

// Average ink over a square box, via a summed-area table.
export function makeSampler(ink, w, h, workScale) {
  const W1 = w + 1;
  const sat = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += ink[y * w + x];
      sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1] + row;
    }
  }
  const bilinear = (x, y) => {
    x = Math.min(w - 1, Math.max(0, x - 0.5));
    y = Math.min(h - 1, Math.max(0, y - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const a = ink[y0 * w + x0] * (1 - fx) + ink[y0 * w + x1] * fx;
    const b = ink[y1 * w + x0] * (1 - fx) + ink[y1 * w + x1] * fx;
    return a * (1 - fy) + b * fy;
  };
  // x, y and box are in output coordinates.
  return (x, y, box) => {
    x *= workScale; y *= workScale; box *= workScale;
    if (box < 1.5) return bilinear(x, y);
    const r = box / 2;
    const x0 = Math.max(0, Math.min(w, Math.round(x - r)));
    const x1 = Math.max(0, Math.min(w, Math.round(x + r)));
    const y0 = Math.max(0, Math.min(h, Math.round(y - r)));
    const y1 = Math.max(0, Math.min(h, Math.round(y + r)));
    const area = (x1 - x0) * (y1 - y0);
    if (area <= 0) return bilinear(x, y);
    return (sat[y1 * W1 + x1] - sat[y0 * W1 + x1] - sat[y1 * W1 + x0] + sat[y0 * W1 + x0]) / area;
  };
}
