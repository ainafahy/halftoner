// Sample points (grid / radial / spiral / noise) -> list of dots.
// A dot is { x, y, size, r, i, j, L, a?, t }: r is a stable random in [0,1),
// L the cluster block size, a an optional per-dot rotation (radians).

function hash(a, b, c) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function bayer(n) {
  let m = [[0]];
  while (m.length < n) {
    const s = m.length, next = [];
    for (let y = 0; y < s * 2; y++) {
      next.push([]);
      for (let x = 0; x < s * 2; x++) {
        const q = [[0, 2], [3, 1]][Math.floor(y / s)][Math.floor(x / s)];
        next[y].push(m[y % s][x % s] * 4 + q);
      }
    }
    m = next;
  }
  return m;
}
const BAYER = { bayer2: bayer(2), bayer4: bayer(4), bayer8: bayer(8) };

// Error-diffusion kernels: [di, dj, weight]
const KERNELS = {
  floyd: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
};

const CLUSTER_LEVELS = [[8, 0.08], [4, 0.25], [2, 0.6]];

export const LATTICE_LAYOUTS = ['square', 'hex'];

// ---------------------------------------------------------------- point sets

// Square / hex lattice, rotated by the grid angle. Rows are contiguous in i.
function latticePoints(s, W, H, cell, sample) {
  const a = (s.angle * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const hex = s.layout === 'hex';
  const rowSp = hex ? (cell * Math.sqrt(3)) / 2 : cell;
  const cx = W / 2, cy = H / 2;
  const margin = cell * 1.5;
  const D = Math.hypot(W, H) / 2 + margin;
  const nj = Math.ceil(D / rowSp) + 1;

  const rows = new Array(2 * nj + 1);
  for (let j = -nj; j <= nj; j++) {
    const off = hex && (j & 1) ? 0.5 : 0;
    const bx = cx + off * cell * ca - j * rowSp * sa;
    const by = cy + off * cell * sa + j * rowSp * ca;
    let lo = -Infinity, hi = Infinity, ok = true;
    const clip = (base, d, min, max) => {
      if (Math.abs(d) < 1e-9) { if (base < min || base > max) ok = false; return; }
      let t0 = (min - base) / d, t1 = (max - base) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      lo = Math.max(lo, t0); hi = Math.min(hi, t1);
    };
    clip(bx, cell * ca, -margin, W + margin);
    clip(by, cell * sa, -margin, H + margin);
    const i0 = Math.ceil(lo), i1 = Math.floor(hi);
    if (!ok || i1 < i0) { rows[j + nj] = null; continue; }
    const pts = [];
    for (let i = i0; i <= i1; i++) {
      const x = bx + i * cell * ca, y = by + i * cell * sa;
      pts.push({ i, j, x, y, t: sample(x, y, cell), r: hash(i, j, s.seed * 3 + 3), bi: i, bj: j });
    }
    rows[j + nj] = { i0, pts };
  }
  const get = (i, j) => {
    const row = rows[j + nj];
    return row ? row.pts[i - row.i0] || null : null;
  };
  return { rows, neighbor: (p, di, dj) => get(p.i + di, p.j + dj), get };
}

// Free-form layouts: generate raw points, then bucket them into horizontal
// bands so dithering can still walk them row by row.
function freePoints(s, W, H, cell, sample) {
  const margin = cell * 1.5;
  const cx = W / 2, cy = H / 2;
  const D = Math.hypot(W, H) / 2 + margin;
  const rot = (s.angle * Math.PI) / 180;
  const inside = (x, y) => x >= -margin && y >= -margin && x <= W + margin && y <= H + margin;
  const raw = [];

  if (s.layout === 'radial') {
    raw.push({ x: cx, y: cy, a: rot });
    for (let k = 1; k * cell <= D; k++) {
      const r = k * cell;
      const n = Math.max(1, Math.round((2 * Math.PI * r) / cell));
      const shift = k & 1 ? Math.PI / n : 0;
      for (let m = 0; m < n; m++) {
        const phi = rot + (2 * Math.PI * m) / n + shift;
        const x = cx + r * Math.cos(phi), y = cy + r * Math.sin(phi);
        if (inside(x, y)) raw.push({ x, y, a: phi + Math.PI / 2 });
      }
    }
  } else if (s.layout === 'spiral') {
    const b = cell / (2 * Math.PI);
    for (let th = 0.0001; b * th <= D; ) {
      const r = b * th, phi = th + rot;
      const x = cx + r * Math.cos(phi), y = cy + r * Math.sin(phi);
      if (inside(x, y)) {
        const tx = b * Math.cos(phi) - r * Math.sin(phi), ty = b * Math.sin(phi) + r * Math.cos(phi);
        raw.push({ x, y, a: Math.atan2(ty, tx) });
      }
      th += cell / Math.sqrt(r * r + b * b);
    }
  } else {
    // blue noise (Bridson's Poisson-disc sampling), seeded
    const rand = rng(s.seed * 7919 + 17);
    const r = cell, cs = r / Math.SQRT2;
    const x0 = -margin, y0 = -margin, w = W + 2 * margin, h = H + 2 * margin;
    const gw = Math.ceil(w / cs), gh = Math.ceil(h / cs);
    const grid = new Int32Array(gw * gh).fill(-1);
    const active = [];
    const add = (x, y) => {
      grid[Math.floor((y - y0) / cs) * gw + Math.floor((x - x0) / cs)] = raw.length;
      active.push(raw.length);
      raw.push({ x, y });
    };
    add(x0 + w * rand(), y0 + h * rand());
    while (active.length) {
      const ai = Math.floor(rand() * active.length);
      const p = raw[active[ai]];
      let found = false;
      for (let k = 0; k < 24; k++) {
        const ang = rand() * Math.PI * 2, rad = r * (1 + rand());
        const x = p.x + Math.cos(ang) * rad, y = p.y + Math.sin(ang) * rad;
        if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) continue;
        const gx = Math.floor((x - x0) / cs), gy = Math.floor((y - y0) / cs);
        let ok = true;
        for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2) && ok; yy++) {
          for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
            const q = grid[yy * gw + xx];
            if (q >= 0) {
              const dx = raw[q].x - x, dy = raw[q].y - y;
              if (dx * dx + dy * dy < r * r) { ok = false; break; }
            }
          }
        }
        if (ok) { add(x, y); found = true; break; }
      }
      if (!found) { active[ai] = active[active.length - 1]; active.pop(); }
    }
  }

  const bands = new Map();
  raw.forEach((p, n) => {
    const { x, y } = p;
    const j = Math.floor(y / cell);
    if (!bands.has(j)) bands.set(j, []);
    bands.get(j).push({
      x, y, a: p.a, t: sample(x, y, cell), r: hash(n, 3, s.seed),
      bi: Math.round(x / cell), bj: j,
    });
  });
  const keys = [...bands.keys()].sort((a, b) => a - b);
  const jmin = keys.length ? keys[0] : 0;
  const rows = [];
  for (const j of keys) {
    const pts = bands.get(j).sort((a, b) => a.x - b.x);
    pts.forEach((p, i) => { p.i = i; p.j = j; });
    rows[j - jmin] = { i0: 0, pts };
  }
  // Nearest point in a row to a given x (rows are sorted by x).
  const nearest = (row, x) => {
    let lo = 0, hi = row.pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (row.pts[mid].x < x) lo = mid + 1; else hi = mid;
    }
    const a = row.pts[lo], b = row.pts[lo - 1];
    return b && Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a;
  };
  const neighbor = (p, di, dj) => {
    const row = rows[p.j + dj - jmin];
    if (!row || !row.pts.length) return null;
    if (dj === 0) return row.pts[p.i + di] || null;
    return nearest(row, p.x + di * cell);
  };
  return { rows, neighbor, get: null };
}

// ---------------------------------------------------------------- dots

export function buildDots(s, W, H, cell, sample) {
  const lattice = LATTICE_LAYOUTS.includes(s.layout);
  const { rows, neighbor, get } = lattice ? latticePoints(s, W, H, cell, sample) : freePoints(s, W, H, cell, sample);
  const each = (fn) => { for (const row of rows) if (row) for (const p of row.pts) fn(p); };

  // Clusters: merge aligned LxL blocks into a single bigger shape (grids only).
  const big = [];
  if (lattice && s.clusters > 0) {
    const p = s.clusters / 100;
    for (const [L, w] of CLUSTER_LEVELS) {
      each((pt) => {
        const { i, j } = pt;
        if (((i % L) + L) % L || ((j % L) + L) % L) return;
        if (pt.claimed || hash(i, j, s.seed * 7 + L) >= p * w) return;
        const block = [];
        for (let dj = 0; dj < L; dj++) {
          for (let di = 0; di < L; di++) {
            const q = get(i + di, j + dj);
            if (!q || q.claimed) return;
            block.push(q);
          }
        }
        let x = 0, y = 0, t = 0;
        for (const q of block) { x += q.x; y += q.y; t += q.t; q.claimed = true; }
        const n = block.length;
        big.push({ x: x / n, y: y / n, t: t / n, L, r: hash(i, j, s.seed * 7 + 50 + L), i, j });
      });
    }
  }

  const dots = [];
  const sizeFull = cell * (s.scale / 100);
  const floor = cell * (s.floor / 100);
  const cutoff = s.cutoff / 100;
  const linear = s.shape === 'line'; // line thickness follows ink linearly, dots by area
  const push = (p, size, L) => {
    if (size < 0.25 && s.shape !== 'char') return;
    if (p.x < -size - cell || p.y < -size - cell || p.x > W + size + cell || p.y > H + size + cell) return;
    dots.push({ x: p.x, y: p.y, size, r: p.r, i: p.i, j: p.j, L, a: p.a, t: p.t });
  };

  if (s.shape === 'char') {
    each((p) => { if (!p.claimed) push(p, sizeFull, 1); });
    for (const b of big) push(b, sizeFull * b.L, b.L);
    return dots;
  }

  if (s.method === 'size') {
    const sz = (t, L) => {
      if (t < cutoff || t <= 0) return 0;
      return Math.max(floor * L, sizeFull * L * (linear ? t : Math.sqrt(t)));
    };
    each((p) => { if (!p.claimed) push(p, sz(p.t, 1), 1); });
    for (const b of big) push(b, sz(b.t, b.L), b.L);
    return dots;
  }

  // Dither: every point is on (full size) or off (floor size).
  const kernel = KERNELS[s.dither];
  if (kernel) {
    each((p) => {
      if (p.claimed) return;
      const v = p.t + (p.e || 0);
      p.on = v >= 0.5;
      const e = v - (p.on ? 1 : 0);
      for (const [di, dj, wgt] of kernel) {
        const q = neighbor(p, di, dj);
        if (q && q !== p && !q.claimed) q.e = (q.e || 0) + e * wgt;
      }
    });
  } else {
    const M = BAYER[s.dither];
    each((p) => {
      if (p.claimed) return;
      let th = 0.5;
      if (M) {
        const n = M.length;
        th = (M[((p.bj % n) + n) % n][((p.bi % n) + n) % n] + 0.5) / (n * n);
      } else if (s.dither === 'random') {
        th = p.r;
      }
      p.on = p.t > th;
    });
  }
  each((p) => { if (!p.claimed) push(p, p.on ? sizeFull : floor, 1); });
  for (const b of big) push(b, (b.t > b.r ? sizeFull : floor) * b.L, b.L);
  return dots;
}
