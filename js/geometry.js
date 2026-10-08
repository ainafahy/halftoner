// Dots -> one SVG path string (or a glyph list for the `char` shape).
// The same path feeds the canvas (Path2D), the SVG and the React export,
// so preview and files always match. Every subpath winds clockwise, so the
// path fills with the default nonzero rule.

const n2 = (v) => Math.round(v * 100) / 100;
const SQ3 = Math.sqrt(3);

// Per-dot geometry in its own rotated frame.
function frame(d, s, cell) {
  const base = d.a != null ? d.a : (s.angle * Math.PI) / 180;
  const a = s.shape === 'diamond' ? base + Math.PI / 4 : base;
  const h = d.size / 2;
  return { ca: Math.cos(a), sa: Math.sin(a), h, len: (cell * (d.L || 1)) / 2 + 0.3 };
}

// Local outline points (clockwise on screen) for the polygon shapes.
function polygon(shape, h, len) {
  switch (shape) {
    case 'cross': {
      const a = h / 3;
      return [[-a, -h], [a, -h], [a, -a], [h, -a], [h, a], [a, a], [a, h], [-a, h], [-a, a], [-h, a], [-h, -a], [-a, -a]];
    }
    case 'line':
      return [[-len, -h], [len, -h], [len, h], [-len, h]];
    case 'tri':
      return [[0, (-2 * h) / SQ3], [h, h / SQ3], [-h, h / SQ3]];
    default:
      return [[-h, -h], [h, -h], [h, h], [-h, h]];
  }
}

export function shapesPath(dots, s, cell) {
  const round = s.roundness / 100;
  const rounded = s.shape === 'square' || s.shape === 'diamond';
  const out = [];
  for (const d of dots) {
    if (s.shape === 'dot' || (rounded && round >= 0.999)) {
      const h = d.size / 2;
      out.push(`M${n2(d.x + h)} ${n2(d.y)}A${n2(h)} ${n2(h)} 0 1 1 ${n2(d.x - h)} ${n2(d.y)}A${n2(h)} ${n2(h)} 0 1 1 ${n2(d.x + h)} ${n2(d.y)}Z`);
      continue;
    }
    const { ca, sa, h, len } = frame(d, s, cell);
    const P = (lx, ly) => `${n2(d.x + lx * ca - ly * sa)} ${n2(d.y + lx * sa + ly * ca)}`;
    const rr = rounded ? h * round : 0;
    if (rr < 0.05) {
      const pts = polygon(s.shape, h, len);
      out.push('M' + pts.map(([x, y]) => P(x, y)).join('L') + 'Z');
      continue;
    }
    const R = n2(rr);
    const A = (lx, ly) => `A${R} ${R} 0 0 1 ${P(lx, ly)}`;
    const e = h - rr;
    out.push(`M${P(-e, -h)}L${P(e, -h)}${A(h, -e)}L${P(h, e)}${A(e, h)}L${P(-e, h)}${A(-h, e)}L${P(-h, -e)}${A(-e, -h)}Z`);
  }
  return out.join('');
}

// ---------------------------------------------------------------- liquid

function sdBox(px, py, hx, hy, rr) {
  const qx = Math.abs(px) - hx + rr, qy = Math.abs(py) - hy + rr;
  const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0;
  return Math.sqrt(mx * mx + my * my) + Math.min(Math.max(qx, qy), 0) - rr;
}

// Inigo Quilez's equilateral triangle, half-side r, apex up (y up).
function sdTri(px, py, r) {
  px = Math.abs(px) - r;
  py = py + r / SQ3;
  if (px + SQ3 * py > 0) {
    const nx = (px - SQ3 * py) / 2, ny = (-SQ3 * px - py) / 2;
    px = nx; py = ny;
  }
  px -= Math.min(Math.max(px, -2 * r), 0);
  return -Math.sqrt(px * px + py * py) * Math.sign(py);
}

// Smooth union of every shape's signed distance field, traced with marching
// squares. `merge` sets how far apart shapes still bridge.
export function liquidPath(dots, s, W, H, cell) {
  const k = (s.merge / 100) * cell * 0.8;
  const step = Math.max(cell / 7, 0.35, Math.sqrt((W * H) / 4e6));
  const M = 1.5 * k + 3 * step; // field is clamped to this outside every shape's reach
  // node ix sits at x = (ix - 1) * step; the outer ring stays "outside"
  const nx = Math.ceil(W / step) + 3, ny = Math.ceil(H / step) + 3;
  const F = new Float32Array(nx * ny).fill(M);
  const round = s.roundness / 100;
  const variance = s.mergeVar / 100;
  const shape = (s.shape === 'square' || s.shape === 'diamond') && round >= 0.999 ? 'dot' : s.shape;

  for (const d of dots) {
    const { ca, sa, h, len } = frame(d, s, cell);
    // per-dot stickiness: with variance, some neighbours fuse and others don't
    const kd = variance > 0 ? k * (1 - variance * d.r) : k;
    const reach = shape === 'dot' ? h : shape === 'line' ? Math.hypot(len, h) : shape === 'tri' ? (2 * h) / SQ3 : h * Math.SQRT2;
    const ext = reach + M;
    const x0 = Math.max(1, Math.floor((d.x - ext) / step) + 1);
    const x1 = Math.min(nx - 2, Math.ceil((d.x + ext) / step) + 1);
    const y0 = Math.max(1, Math.floor((d.y - ext) / step) + 1);
    const y1 = Math.min(ny - 2, Math.ceil((d.y + ext) / step) + 1);
    for (let iy = y0; iy <= y1; iy++) {
      const dy = (iy - 1) * step - d.y;
      for (let ix = x0; ix <= x1; ix++) {
        const dx = (ix - 1) * step - d.x;
        let dist;
        if (shape === 'dot') {
          dist = Math.sqrt(dx * dx + dy * dy) - h;
        } else {
          const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
          switch (shape) {
            case 'cross': dist = Math.min(sdBox(lx, ly, h, h / 3, 0), sdBox(lx, ly, h / 3, h, 0)); break;
            case 'line': dist = sdBox(lx, ly, len, h, 0); break;
            case 'tri': dist = sdTri(lx, -ly, h); break;
            default: dist = sdBox(lx, ly, h, h, h * round);
          }
        }
        const idx = iy * nx + ix;
        const f = F[idx];
        const hh = kd - Math.abs(f - dist);
        F[idx] = hh > 0 ? Math.min(f, dist) - (hh * hh * 0.25) / kd : Math.min(f, dist);
      }
    }
  }
  return traceContours(F, nx, ny, step);
}

export function traceContours(F, nx, ny, step) {
  const HE = (nx - 1) * ny;
  const total = HE + nx * (ny - 1);
  const next = new Int32Array(total).fill(-1);
  const hid = (ix, iy) => iy * (nx - 1) + ix;
  const vid = (ix, iy) => HE + iy * nx + ix;

  const ins = [0, 0, 0, 0], E = [0, 0, 0, 0];
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const v0 = F[iy * nx + ix], v1 = F[iy * nx + ix + 1];
      const v2 = F[(iy + 1) * nx + ix + 1], v3 = F[(iy + 1) * nx + ix];
      ins[0] = v0 < 0; ins[1] = v1 < 0; ins[2] = v2 < 0; ins[3] = v3 < 0;
      const code = ins[0] | (ins[1] << 1) | (ins[2] << 2) | (ins[3] << 3);
      if (code === 0 || code === 15) continue;
      // edges walked clockwise: top, right, bottom, left
      E[0] = hid(ix, iy); E[1] = vid(ix + 1, iy); E[2] = hid(ix, iy + 1); E[3] = vid(ix, iy);
      const saddle = code === 5 || code === 10;
      const joined = saddle && (v0 + v1 + v2 + v3) / 4 < 0;
      for (let e = 0; e < 4; e++) {
        // exiting edge: inside -> outside along the walk
        if (!(ins[e] && !ins[(e + 1) % 4])) continue;
        // pair with the entering edge of the same inside run (backwards),
        // or of the next run when a saddle's centre is inside (forwards)
        for (let s = 1; s < 4; s++) {
          const f = joined ? (e + s) % 4 : (e - s + 4) % 4;
          if (!ins[f] && ins[(f + 1) % 4]) { next[E[e]] = E[f]; break; }
        }
      }
    }
  }

  const pos = (id) => {
    if (id < HE) {
      const iy = Math.floor(id / (nx - 1)), ix = id - iy * (nx - 1);
      const ia = iy * nx + ix, ib = ia + 1;
      const t = F[ia] / (F[ia] - F[ib]);
      return [(ix - 1 + t) * step, (iy - 1) * step];
    }
    const r = id - HE;
    const iy = Math.floor(r / nx), ix = r - iy * nx;
    const ia = iy * nx + ix, ib = ia + nx;
    const t = F[ia] / (F[ia] - F[ib]);
    return [(ix - 1) * step, (iy - 1 + t) * step];
  };

  const seen = new Uint8Array(total);
  const tol = step * 0.06;
  const out = [];
  for (let id = 0; id < total; id++) {
    if (next[id] < 0 || seen[id]) continue;
    const raw = [];
    let c = id;
    while (c >= 0 && !seen[c]) { seen[c] = 1; raw.push(pos(c)); c = next[c]; }
    if (raw.length < 3) continue;
    out.push(smoothLoop(simplify(raw, tol)));
  }
  return out.join('');
}

// Drop points that sit (nearly) on the line between their neighbours.
function simplify(p, tol) {
  if (p.length < 8) return p;
  const keep = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const a = keep[keep.length - 1], b = p[i], c = p[(i + 1) % p.length];
    const dx = c[0] - a[0], dy = c[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    if (Math.abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / len > tol) keep.push(b);
  }
  return keep.length >= 3 ? keep : p;
}

// Quadratic curves through edge midpoints: smooth, still closed.
function smoothLoop(p) {
  const n = p.length;
  const mid = (a, b) => `${n2((a[0] + b[0]) / 2)} ${n2((a[1] + b[1]) / 2)}`;
  let d = `M${mid(p[n - 1], p[0])}`;
  for (let i = 0; i < n; i++) d += `Q${n2(p[i][0])} ${n2(p[i][1])} ${mid(p[i], p[(i + 1) % n])}`;
  return d + 'Z';
}

// ---------------------------------------------------------------- characters

export const DEFAULT_CHARSET = ' .:-=+*#%@';

// Pick a character per dot by ink: first char = paper, last = full ink.
export function glyphs(dots, s) {
  const set = [...(s.charset || DEFAULT_CHARSET)];
  const n = set.length;
  const cutoff = s.cutoff / 100;
  const out = [];
  if (!n) return out;
  for (const d of dots) {
    if (d.t < cutoff) continue;
    const c = set[Math.min(n - 1, Math.floor(d.t * n))];
    if (c === ' ') continue;
    out.push({ x: n2(d.x), y: n2(d.y), c, fs: n2(d.size * 1.5), i: d.i, j: d.j, t: d.t });
  }
  return out;
}
