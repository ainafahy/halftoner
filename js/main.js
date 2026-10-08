import { DEFAULTS, PRESETS, FIELD_STARTS, loadSaved, save, sanitize, randomize } from './state.js';
import { demoSource, defaultSource, DEFAULT_IMAGE_NAME, loadImageFile, textSource, ensureFont } from './source.js';
import { prepareSource, fieldLayers } from './runtime.js';
import { drawDesign, exportImage, exportSVG, exportTXT, download } from './render.js';
import { segment } from './mask.js';
import { buildPanel } from './ui.js';
import { putSource, getSource, hasSource, deleteSource } from './store.js';
import { readSettings } from './pngmeta.js';

let state = loadSaved();
let imageSource = demoSource();
let imageName = DEFAULT_IMAGE_NAME;
let sourceId = 'demo'; // identifies the loaded image, so snapshots can bring it back
let sourceRev = 0;
let view = 'output';  // 'output' | 'split' | 'tone'
let zoom = 'fit';     // 'fit' | '1:1'
let splitX = 0.5;
let selectedPin = -1;  // index into state.pins, UI-only

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const stage = $('stage');
const status = $('status');

// ---------------------------------------------------------------- engine (Web Worker, inline fallback)

let worker = null, local = null;
let inflight = false, dirty = false, reqId = 0;
let sentSrcKey = null, lastSource = null;
let out = null;
let tone = null, toneCanvas = null; // { key, data, w, h }
let errorText = '', maskText = '';

function startEngine() {
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => onEngine(e.data);
    worker.onerror = (e) => {
      console.warn('worker unavailable, running inline', e.message);
      worker = null;
      goInline();
    };
  } catch (e) {
    goInline();
  }
}

async function goInline() {
  if (local) return;
  const { createEngine } = await import('./engine.js');
  local = createEngine();
  sentSrcKey = null;
  inflight = false;
  request();
}

function post(msg) {
  if (worker) { worker.postMessage(msg); return; }
  if (!local) return;
  if (msg.type === 'source') { local.setSource(msg.source); return; }
  setTimeout(() => {
    try { onEngine({ id: msg.id, result: local.render(msg.state, msg.wantTone, msg.haveTone) }); }
    catch (err) { onEngine({ id: msg.id, error: err.message }); }
  }, 0);
}

// The source (grayscale + subject mask at work resolution) is prepared here,
// where canvases are available, and shipped to the engine when it changes.
function syncSource() {
  const maskCanvas = currentMask();
  const font = fontKey();
  if (state.sourceType === 'text') loadFont(font);
  // blur / field blur / cell set the halo margin around text and transparent images
  const margin = `${state.blur}|${state.field === 'on' ? state.fieldBlur : 0}|${state.cell}`;
  const key = `${sourceRev}|${state.sourceType}|${state.text}|${font}|${fontsReady.has(font)}|${state.width}|${maskCanvas ? state.subject : '-'}|${margin}`;
  if (key === sentSrcKey) return;
  lastSource = { key, ...prepareSource(currentSourceCanvas(), maskCanvas, state) };
  post({ type: 'source', source: lastSource });
  sentSrcKey = key;
}

const currentSourceCanvas = () =>
  (state.sourceType === 'text' ? textSource(state.text, state.font, state.fontWeight, state.italic) : imageSource);

// Web fonts load on first use; the text re-renders once the font is ready.
const fontKey = () => `${state.font}|${state.fontWeight}|${state.italic}`;
const fontsReady = new Set(), fontsLoading = new Set();
function loadFont(key) {
  if (fontsReady.has(key) || fontsLoading.has(key)) return;
  fontsLoading.add(key);
  ensureFont(state.font, state.fontWeight, state.italic, state.text).then(() => {
    fontsLoading.delete(key);
    fontsReady.add(key);
    layersKey = null;
    request();
  });
}

function request() {
  dirty = true;
  pump();
}

function pump() {
  if (inflight || !dirty || (!worker && !local)) return;
  dirty = false;
  inflight = true;
  syncSource();
  post({ type: 'render', id: ++reqId, state, wantTone: view !== 'output', haveTone: tone && tone.key });
}

function onEngine(msg) {
  inflight = false;
  if (msg.error) {
    errorText = `error: ${msg.error}`;
  } else if (msg.result) {
    errorText = '';
    out = msg.result;
    if (out.tone) {
      tone = { key: out.toneKey, ...out.tone };
      toneCanvas = null;
    }
    out.layers = currentLayers();
    draw();
  }
  pump();
  if (!inflight && !dirty) settleWaiters.splice(0).forEach((r) => r());
}

const settleWaiters = [];
const settled = () => new Promise((r) => (!inflight && !dirty ? r() : settleWaiters.push(r)));

// ---------------------------------------------------------------- field layers

// The original image + fade mask for a field with a sharp area. Built here
// (needs canvases), cached until the source, tone or field changes.
let layersKey = null, layersCache = null;
function currentLayers() {
  const maskCanvas = currentMask();
  const keys = ['sourceType', 'text', 'font', 'fontWeight', 'italic', 'width', 'blur', 'fieldBlur', 'cell', 'brightness', 'contrast', 'gamma', 'blackPoint', 'whitePoint',
    'invert', 'subject', 'maskEdge', 'maskKeep', 'field', 'pins', 'fieldSolid', 'fieldSoft'];
  const key = `${sourceRev}|${maskCanvas ? 'm' : '-'}|${fontsReady.has(fontKey())}|${JSON.stringify(keys.map((k) => state[k]))}`;
  if (key !== layersKey) {
    layersKey = key;
    layersCache = fieldLayers(currentSourceCanvas(), maskCanvas, state);
  }
  return layersCache;
}

// ---------------------------------------------------------------- subject mask

const masks = new Map();   // `${sourceRev}|${kind}` -> canvas
const maskJobs = new Set();

function currentMask() {
  if (state.sourceType !== 'image' || state.subject === 'off') return null;
  const key = `${sourceRev}|${state.subject}`;
  if (masks.has(key)) return masks.get(key);
  if (!maskJobs.has(key)) {
    maskJobs.add(key);
    const kind = state.subject;
    const rev = sourceRev;
    maskText = kind === 'any' ? 'loading object model…' : 'loading people model…';
    updateStatus();
    segment(imageSource, kind, (m) => {
      if (m.stage === 'download') maskText = `downloading model ${Math.round(m.progress * 100)}% of ${m.mb.toFixed(0)} MB…`;
      else if (m.stage === 'segment') maskText = `finding subject (${m.device})…`;
      updateStatus();
    }).then((c) => {
      if (rev === sourceRev) masks.set(key, c);
      maskText = '';
      request();
    }).catch((e) => {
      console.error(e);
      maskText = `subject detection failed: ${e.message}`;
      updateStatus();
    }).finally(() => maskJobs.delete(key));
  }
  return null;
}

// ---------------------------------------------------------------- drawing

function toneImage() {
  if (toneCanvas || !tone) return toneCanvas;
  const img = new ImageData(tone.w, tone.h);
  const white = state.colors === 'wb';
  for (let i = 0, j = 0; i < tone.data.length; i++, j += 4) {
    const v = Math.round((white ? tone.data[i] : 1 - tone.data[i]) * 255);
    img.data[j] = img.data[j + 1] = img.data[j + 2] = v;
    img.data[j + 3] = 255;
  }
  toneCanvas = document.createElement('canvas');
  toneCanvas.width = tone.w; toneCanvas.height = tone.h;
  toneCanvas.getContext('2d').putImageData(img, 0, 0);
  toneCanvas.dataset.colors = state.colors;
  return toneCanvas;
}

function draw() {
  if (!out) return;
  const { W, H } = out;
  const pad = 48;
  const css = zoom === 'fit'
    ? Math.max(0.05, Math.min((stage.clientWidth - pad) / W, (stage.clientHeight - pad) / H))
    : 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const px = Math.min(css * dpr, 8192 / Math.max(W, H));
  canvas.style.width = Math.round(W * css) + 'px';
  canvas.style.height = Math.round(H * css) + 'px';
  canvas.width = Math.round(W * px);
  canvas.height = Math.round(H * px);
  stage.classList.toggle('scroll', zoom !== 'fit');
  canvas.classList.toggle('splitting', view === 'split');
  canvas.classList.toggle('pinning', state.field === 'on' && view !== 'tone');

  if (toneCanvas && toneCanvas.dataset.colors !== state.colors) toneCanvas = null;
  const t = view !== 'output' ? toneImage() : null;

  if (view === 'tone' && t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(t, 0, 0, canvas.width, canvas.height);
  } else {
    drawDesign(ctx, out, state, canvas.width / W, false);
    if (view === 'split' && t) {
      const x = Math.round(canvas.width * splitX);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x, canvas.height);
      ctx.clip();
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(t, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      // divider: a black and a white hairline so it reads on any tone
      const lw = Math.max(1, dpr);
      ctx.fillStyle = '#000';
      ctx.fillRect(x - lw, 0, lw, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x, 0, lw, canvas.height);
      const hh = 28 * dpr, hw = 10 * dpr, cy = canvas.height / 2;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - hw / 2, cy - hh / 2, hw, hh);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = lw;
      ctx.strokeRect(x - hw / 2, cy - hh / 2, hw, hh);
    }
  }
  drawPins(dpr);
  updateStatus();
}

// Field pins: preview-only markers, never part of an export.
function drawPins(dpr) {
  if (state.field !== 'on') return;
  const r = 8 * dpr;
  ctx.save();
  ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
  ctx.textBaseline = 'middle';
  state.pins.forEach((p, n) => {
    const x = p.x * canvas.width, y = p.y * canvas.height;
    const sel = n === selectedPin;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = sel ? '#000' : '#fff';
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = sel ? '#fff' : '#000';
    ctx.stroke();
    // inner disc sized by strength
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, (r - 3 * dpr) * (p.v / 100)), 0, Math.PI * 2);
    ctx.fillStyle = sel ? '#fff' : '#000';
    ctx.fill();
    const label = String(Math.round(p.v));
    const tx = x + r + 4 * dpr;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#000';
    ctx.fillRect(tx - 2 * dpr, y - 7 * dpr, tw + 4 * dpr, 14 * dpr);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, tx, y);
  });
  ctx.restore();
}

function updateStatus() {
  if (!out) { status.textContent = maskText || errorText || 'working…'; return; }
  const parts = [`${out.W}×${out.H}`, `${out.count.toLocaleString()} ${out.kind === 'glyphs' ? 'chars' : 'shapes'}`, `${out.ms}ms`];
  if (out.cellEff > state.cell + 0.01) parts.push(`cell held at ${out.cellEff.toFixed(1)}px (shape limit)`);
  if (maskText) parts.push(maskText);
  if (errorText) parts.push(errorText);
  status.textContent = parts.join('  ·  ');
}

let drawQueued = false;
function redraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

// ---------------------------------------------------------------- state + history

const past = [], future = [];
let lastPush = 0;
let saveTimer = 0;

function commit(next) {
  state = next;
  refresh();
  syncChrome();
  request();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(state), 250);
}

// Changes within 600ms of each other (a slider drag) collapse into one undo step.
function set(patch) {
  if (patch.field === 'on' && !state.pins.length && !patch.pins) {
    patch = { ...patch, pins: FIELD_STARTS.ramp.map((p) => ({ ...p })) };
    selectedPin = 0;
  }
  const next = { ...state, ...patch };
  if (Object.keys(patch).every((k) => state[k] === next[k])) return;
  const now = performance.now();
  if (now - lastPush > 600) {
    past.push(state);
    if (past.length > 200) past.shift();
  }
  lastPush = now;
  future.length = 0;
  commit(next);
}

function undo() {
  if (!past.length) return;
  selectedPin = -1;
  future.push(state);
  lastPush = 0;
  commit(past.pop());
}

function redo() {
  if (!future.length) return;
  selectedPin = -1;
  past.push(state);
  lastPush = 0;
  commit(future.pop());
}

window.addEventListener('keydown', (e) => {
  const typing = e.target.closest && e.target.closest('input[type="text"], textarea');
  if (!typing && (e.key === 'Backspace' || e.key === 'Delete') && state.field === 'on' && selectedPin >= 0) {
    e.preventDefault();
    removePin(selectedPin);
    return;
  }
  if (typing || !(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
});

// A file from the source picker, drop or paste. JSON settings and PNGs
// saved by Halftoner restore their settings; any other image becomes the source.
async function useFile(file) {
  if (file.type === 'application/json' || /\.json$/i.test(file.name)) return loadConfig(file);
  if (/^image\/(png|jpeg)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name)) {
    const saved = await readSettings(file).catch(() => null);
    if (saved) return loadConfig(file);
  }
  try {
    status.textContent = 'reading…';
    imageSource = await loadImageFile(file);
    imageName = file.name || 'pasted image';
    sourceId = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sourceRev++;
    masks.clear();
    if (state.sourceType !== 'image') set({ sourceType: 'image' });
    else { refresh(); request(); }
    rememberCurrent();
  } catch (e) {
    status.textContent = e.message;
  }
}

// Settings from a JSON file or a PNG saved by Halftoner.
async function loadConfig(file) {
  try {
    const isJson = file.type === 'application/json' || /\.json$/i.test(file.name);
    const obj = isJson ? JSON.parse(await file.text()) : await readSettings(file);
    if (!obj) { status.textContent = 'no Halftoner settings in that file'; return; }
    set(sanitize({ ...state, ...obj }));
    status.textContent = `loaded settings from ${file.name}`;
  } catch (e) {
    status.textContent = 'could not read that config';
  }
}

const refresh = buildPanel($('controls'), {
  get: () => state,
  set,
  onFile: useFile,
  fileName: () => imageName,
  getPin: () => state.pins[selectedPin] || null,
  setPinValue: (v) => {
    if (!state.pins[selectedPin]) return;
    set({ pins: state.pins.map((p, n) => (n === selectedPin ? { ...p, v } : p)) });
  },
  fieldAction: (name) => {
    if (name === 'clear') { selectedPin = -1; set({ pins: [] }); return; }
    selectedPin = -1;
    set({ pins: FIELD_STARTS[name].map((p) => ({ ...p })) });
  },
});

function removePin(n) {
  selectedPin = -1;
  set({ pins: state.pins.filter((_, i) => i !== n) });
}

// ---------------------------------------------------------------- snapshots

const SNAP_KEY = 'halftoner:snapshots';
let snaps = [];
try { snaps = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); } catch (e) { snaps = []; }
const saveSnaps = () => { try { localStorage.setItem(SNAP_KEY, JSON.stringify(snaps)); } catch (e) {} };

function thumb() {
  const t = document.createElement('canvas');
  const k = 112 / Math.max(canvas.width, canvas.height);
  t.width = Math.max(1, Math.round(canvas.width * k));
  t.height = Math.max(1, Math.round(canvas.height * k));
  const c = t.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL('image/png');
}

function renderSnaps() {
  const box = $('snaps');
  box.textContent = '';
  snaps.forEach((snap, n) => {
    const item = document.createElement('div');
    item.className = 'snap';
    const img = document.createElement('img');
    img.src = snap.thumb;
    img.alt = `snapshot ${n + 1}`;
    img.title = `restore snapshot ${n + 1}`;
    img.onclick = () => restoreSnap(snap);
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.title = 'delete';
    x.onclick = () => {
      const [gone] = snaps.splice(n, 1);
      saveSnaps();
      renderSnaps();
      // drop the stored image once no snapshot uses it
      if (gone.sourceId && gone.sourceId !== 'demo' && gone.sourceId !== currentPointer() && !snaps.some((o) => o.sourceId === gone.sourceId)) {
        deleteSource(gone.sourceId).catch(() => {});
      }
    };
    const label = document.createElement('span');
    label.textContent = String(n + 1).padStart(2, '0');
    item.append(img, label, x);
    box.appendChild(item);
  });
  $('snap-empty').hidden = snaps.length > 0;
}

// A snapshot is the settings plus the image they were applied to. Text
// sources live in the settings; images are stored once in IndexedDB.
async function storeCurrentSource() {
  if (sourceId === 'demo' || await hasSource(sourceId)) return true;
  const blob = await new Promise((r) => imageSource.toBlob(r, 'image/webp', 0.92));
  await putSource(sourceId, { blob, name: imageName });
  return true;
}

// The loaded image survives reloads: it's stored like a snapshot image and
// pointed to from localStorage. The previous one is dropped unless a
// snapshot still uses it.
const CURRENT_KEY = 'halftoner:current-image';
function currentPointer() {
  try { return localStorage.getItem(CURRENT_KEY); } catch (e) { return null; }
}
async function rememberCurrent() {
  const prev = currentPointer();
  try {
    if (sourceId !== 'demo') await storeCurrentSource();
    localStorage.setItem(CURRENT_KEY, sourceId);
  } catch (e) {
    return; // storage unavailable: the image just won't survive a reload
  }
  if (prev && prev !== 'demo' && prev !== sourceId && !snaps.some((o) => o.sourceId === prev)) {
    deleteSource(prev).catch(() => {});
  }
}
async function openStartImage() {
  const id = currentPointer();
  if (id && id !== 'demo') {
    try {
      const rec = await getSource(id);
      if (rec) return { img: await loadImageFile(rec.blob), name: rec.name || 'image', id };
    } catch (e) {}
  }
  return { img: await defaultSource(), name: DEFAULT_IMAGE_NAME, id: 'demo' };
}

async function restoreSnap(snap) {
  const next = sanitize(snap.state);
  if (next.sourceType === 'image' && snap.sourceId && snap.sourceId !== sourceId) {
    try {
      if (snap.sourceId === 'demo') {
        imageSource = await defaultSource();
        imageName = DEFAULT_IMAGE_NAME;
      } else {
        const rec = await getSource(snap.sourceId);
        if (!rec) throw new Error('missing');
        imageSource = await loadImageFile(rec.blob);
        imageName = rec.name || '';
      }
      sourceId = snap.sourceId;
      sourceRev++;
      masks.clear();
      rememberCurrent();
    } catch (e) {
      status.textContent = "this snapshot's image isn't stored here — applied its settings to the current image";
    }
  } else if (next.sourceType === 'image' && !snap.sourceId) {
    status.textContent = 'older snapshot without its image — applied its settings to the current image';
  }
  selectedPin = -1;
  set(next);
  refresh();
  request();
}

$('act-pin').onclick = async () => {
  await settled();
  draw();
  let stored = true;
  if (state.sourceType === 'image') {
    try { stored = await storeCurrentSource(); } catch (e) { stored = false; }
  }
  snaps.push({ state: { ...state }, thumb: thumb(), sourceId: state.sourceType === 'image' && stored ? sourceId : null });
  if (snaps.length > 16) snaps.shift();
  saveSnaps();
  renderSnaps();
};
renderSnaps();

// ---------------------------------------------------------------- header actions

const exportName = () => `halftoner-${state.shape}-${state.layout}`;
const summary = () => [
  state.shape, `${state.layout} grid`, `cell ${state.cell}`, `angle ${state.angle}°`,
  state.shape === 'char' ? `chars "${state.charset}"` : state.method === 'dither' ? `on/off (${state.dither})` : 'size',
  state.merge > 0 ? `merge ${state.merge}` : '',
].filter(Boolean).join(' · ');

async function withResult(fn) {
  await settled();
  if (!out) return;
  try { await fn(); } catch (e) { status.textContent = `export failed: ${e.message}`; }
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

const exportRaster = (format) => () => withResult(async () => {
  status.textContent = `rendering ${format}…`;
  const r = await exportImage(out, state, exportName(), format);
  status.textContent = `saved ${format} ${r.w}×${r.h}` + (r.reduced ? ' (reduced to fit this browser)' : '');
});
$('act-png').onclick = exportRaster('png');
$('act-jpeg').onclick = exportRaster('jpeg');
$('act-svg').onclick = () => withResult(() => { status.textContent = `saved svg (${mb(exportSVG(out, state, exportName()))})`; });
$('act-kit').onclick = () => withResult(async () => {
  status.textContent = 'packing web kit…';
  const { exportKit } = await import('./kit.js');
  const slug = (state.sourceType === 'text' ? state.text : imageName.replace(/\.[^.]+$/, '') || 'artwork')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'artwork';
  const blob = await exportKit({
    state, source: currentSourceCanvas(), mask: currentMask(), result: out, slug, summary: summary(),
  });
  download(blob, `halftone-kit-${slug}.zip`);
  status.textContent = `saved web kit (${mb(blob.size)})`;
});
$('act-txt').onclick = () => withResult(() => { status.textContent = `saved halftone.txt (${mb(exportTXT(out))})`; });
$('act-undo').onclick = undo;
$('act-redo').onclick = redo;
// reset returns the look to the defaults but keeps the source section
const SOURCE_KEYS = ['sourceType', 'text', 'font', 'fontWeight', 'italic', 'width', 'subject', 'maskEdge', 'maskKeep'];

const presetBar = $('presets');
for (const name of Object.keys(PRESETS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = name;
  b.onclick = () => set(PRESETS[name]);
  presetBar.appendChild(b);
}
// random sits with the presets: it rolls new grid / shape settings
const rnd = document.createElement('button');
rnd.type = 'button';
rnd.textContent = 'random';
rnd.title = 'roll new grid and shape settings';
rnd.onclick = () => set(randomize(state));
presetBar.appendChild(rnd);
// reset sits with them too: back to the default look, keeping the source
const reset = document.createElement('button');
reset.type = 'button';
reset.textContent = 'reset';
reset.title = 'back to the default look (keeps your source)';
reset.onclick = () => set({ ...DEFAULTS, ...Object.fromEntries(SOURCE_KEYS.map((k) => [k, state[k]])) });
presetBar.appendChild(reset);

function syncChrome() {
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  document.querySelectorAll('[data-zoom]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.zoom === zoom)));
  $('act-txt').hidden = state.shape !== 'char';
  $('act-undo').disabled = !past.length;
  $('act-redo').disabled = !future.length;
}
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { view = b.dataset.view; syncChrome(); request(); }));
document.querySelectorAll('[data-zoom]').forEach((b) => (b.onclick = () => { zoom = b.dataset.zoom; syncChrome(); redraw(); }));

// Canvas pointer: field pins first (add / select / drag / ⌥-remove),
// otherwise the split divider.
let dragging = null; // 'split' | 'pin'
const norm = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), r };
};
const hitPin = (e) => {
  const { r } = norm(e);
  let best = -1, bestD = 14;
  state.pins.forEach((p, n) => {
    const d = Math.hypot(p.x * r.width + r.left - e.clientX, p.y * r.height + r.top - e.clientY);
    if (d < bestD) { best = n; bestD = d; }
  });
  return best;
};
canvas.addEventListener('pointerdown', (e) => {
  if (state.field === 'on' && view !== 'tone') {
    const hit = hitPin(e);
    if (hit >= 0 && e.altKey) { removePin(hit); return; }
    if (hit >= 0 || view !== 'split') {
      if (hit < 0) {
        const { x, y } = norm(e);
        const v = state.pins[selectedPin] ? state.pins[selectedPin].v : 100;
        set({ pins: [...state.pins, { x, y, v }] });
        selectedPin = state.pins.length - 1;
      } else {
        selectedPin = hit;
      }
      dragging = 'pin';
      canvas.setPointerCapture(e.pointerId);
      refresh();
      redraw();
      return;
    }
  }
  if (view !== 'split') return;
  dragging = 'split';
  canvas.setPointerCapture(e.pointerId);
  splitX = norm(e).x;
  redraw();
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging === 'split') { splitX = norm(e).x; redraw(); }
  else if (dragging === 'pin' && state.pins[selectedPin]) {
    const { x, y } = norm(e);
    set({ pins: state.pins.map((p, n) => (n === selectedPin ? { ...p, x, y } : p)) });
  }
});
canvas.addEventListener('pointerup', () => { dragging = null; });

// ---------------------------------------------------------------- drop & paste

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) useFile(f);
});
window.addEventListener('paste', (e) => {
  const items = e.clipboardData ? [...e.clipboardData.items] : [];
  const item = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  if (item) { e.preventDefault(); useFile(item.getAsFile()); }
});

new ResizeObserver(redraw).observe(stage);

// Image sources aren't persisted; the default image stands in after a reload.
refresh();
syncChrome();
startEngine();
// Reopen the last image (kept in IndexedDB), else the default design's image.
openStartImage().then(({ img, name, id }) => {
  if (sourceId !== 'demo') return; // a file was dropped in the meantime
  imageSource = img;
  imageName = name;
  sourceId = id;
  sourceRev++;
  refresh();
  request();
});
