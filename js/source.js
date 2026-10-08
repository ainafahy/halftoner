// Turning whatever comes in (file, paste, drop, text) into a canvas.

const MAX_SOURCE = 2400; // longest side we keep from an uploaded image

// The image the tool opens with (assets/default.jpg, the design in
// DEFAULTS). Falls back to the generated sphere if it can't be fetched.
export const DEFAULT_IMAGE_NAME = 'default · hands';
export async function defaultSource() {
  try {
    const res = await fetch(new URL('../assets/default.jpg', import.meta.url));
    if (!res.ok) throw new Error(res.status);
    return await loadImageFile(await res.blob());
  } catch (e) {
    return demoSource();
  }
}

// A shaded sphere over a tonal ramp: shows the full dot range at a glance.
export function demoSource() {
  const c = document.createElement('canvas');
  c.width = 1000; c.height = 1000;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1000, 1000);

  const g = ctx.createRadialGradient(390, 320, 10, 500, 430, 340);
  g.addColorStop(0, '#f4f4f4');
  g.addColorStop(0.55, '#7a7a7a');
  g.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(500, 430, 330, 0, Math.PI * 2);
  ctx.fill();

  const ramp = ctx.createLinearGradient(80, 0, 920, 0);
  ramp.addColorStop(0, '#fff');
  ramp.addColorStop(1, '#000');
  ctx.fillStyle = ramp;
  ctx.fillRect(80, 840, 840, 90);
  return c;
}

// Accepts any File/Blob the browser can decode (png, jpg, webp, gif, avif,
// bmp, svg; heic on Safari). Large images are downscaled once on load.
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || 1000;
      let h = img.naturalHeight || 1000;
      const k = Math.min(1, MAX_SOURCE / Math.max(w, h));
      w = Math.max(1, Math.round(w * k));
      h = Math.max(1, Math.round(h * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      // transparency is kept: transparent areas never get ink (see alphaFrom)
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this file. Try PNG, JPG or WebP.'));
    };
    img.src = url;
  });
}

// Text fonts. `google` is the Google Fonts css2 family spec; those load on
// first use. The first three are system fonts (no download).
export const FONTS = [
  { id: 'serif', label: 'Georgia', stack: 'Georgia, "Times New Roman", Times, serif' },
  { id: 'sans', label: 'Helvetica', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: 'mono', label: 'System mono', stack: 'ui-monospace, Menlo, Consolas, monospace' },
  { id: 'inter', label: 'Inter', family: 'Inter', google: 'Inter:wght@100..900', kind: 'sans-serif' },
  { id: 'space-grotesk', label: 'Space Grotesk', family: 'Space Grotesk', google: 'Space+Grotesk:wght@300..700', kind: 'sans-serif' },
  { id: 'syne', label: 'Syne', family: 'Syne', google: 'Syne:wght@400..800', kind: 'sans-serif' },
  { id: 'unbounded', label: 'Unbounded', family: 'Unbounded', google: 'Unbounded:wght@200..900', kind: 'sans-serif' },
  { id: 'archivo-black', label: 'Archivo Black', family: 'Archivo Black', google: 'Archivo+Black', kind: 'sans-serif' },
  { id: 'anton', label: 'Anton', family: 'Anton', google: 'Anton', kind: 'sans-serif' },
  { id: 'bebas', label: 'Bebas Neue', family: 'Bebas Neue', google: 'Bebas+Neue', kind: 'sans-serif' },
  { id: 'instrument-serif', label: 'Instrument Serif', family: 'Instrument Serif', google: 'Instrument+Serif:ital@0;1', kind: 'serif' },
  { id: 'playfair', label: 'Playfair Display', family: 'Playfair Display', google: 'Playfair+Display:ital,wght@0,400..900;1,400..900', kind: 'serif' },
  { id: 'dm-serif', label: 'DM Serif Display', family: 'DM Serif Display', google: 'DM+Serif+Display:ital@0;1', kind: 'serif' },
  { id: 'fraunces', label: 'Fraunces', family: 'Fraunces', google: 'Fraunces:ital,wght@0,100..900;1,100..900', kind: 'serif' },
  { id: 'eb-garamond', label: 'EB Garamond', family: 'EB Garamond', google: 'EB+Garamond:ital,wght@0,400..800;1,400..800', kind: 'serif' },
  { id: 'bodoni', label: 'Bodoni Moda', family: 'Bodoni Moda', google: 'Bodoni+Moda:ital,wght@0,400..900;1,400..900', kind: 'serif' },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', family: 'IBM Plex Mono', google: 'IBM+Plex+Mono:ital,wght@0,400;0,700;1,400;1,700', kind: 'monospace' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: 'JetBrains Mono', google: 'JetBrains+Mono:ital,wght@0,100..800;1,100..800', kind: 'monospace' },
  { id: 'space-mono', label: 'Space Mono', family: 'Space Mono', google: 'Space+Mono:ital,wght@0,400;0,700;1,400;1,700', kind: 'monospace' },
  { id: 'rubik-mono', label: 'Rubik Mono One', family: 'Rubik Mono One', google: 'Rubik+Mono+One', kind: 'monospace' },
  { id: 'vt323', label: 'VT323 (pixel)', family: 'VT323', google: 'VT323', kind: 'monospace' },
  { id: 'silkscreen', label: 'Silkscreen (pixel)', family: 'Silkscreen', google: 'Silkscreen:wght@400;700', kind: 'monospace' },
  { id: 'press-start', label: 'Press Start 2P (pixel)', family: 'Press Start 2P', google: 'Press+Start+2P', kind: 'monospace' },
];

const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
const stackOf = (f) => f.stack || `"${f.family}", ${f.kind}`;
const fontCss = (f, weight, italic, size) => `${italic ? 'italic ' : ''}${weight} ${size}px ${stackOf(f)}`;

// Loads a Google font (once) and waits until the requested style is usable.
// Resolves either way: a font that fails to load falls back to its kind.
const linked = new Set();
export async function ensureFont(id, weight, italic, text) {
  const f = fontById(id);
  if (!f.google) return;
  if (!linked.has(f.id)) {
    linked.add(f.id);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=block`;
    document.head.appendChild(link);
    await new Promise((r) => { link.onload = link.onerror = r; });
  }
  try { await document.fonts.load(fontCss(f, weight, italic, 100), text || 'Aa'); } catch (e) {}
}

// Ink text on white, fitted to a 2000px-wide canvas. Supports line breaks.
export function textSource(text, font, weight = 400, italic = false) {
  const f = fontById(font);
  const lines = (text || ' ').split('\n');
  const W = 2000;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = fontCss(f, weight, italic, 100);
  const widest = Math.max(1, ...lines.map((l) => probe.measureText(l).width));
  const size = Math.min(900, (W * 0.88) / widest * 100);
  const lineH = size * 1.1;
  const H = Math.max(200, Math.round(lines.length * lineH + size * 0.6));

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.font = fontCss(f, weight, italic, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const top = H / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * lineH));
  return c;
}
