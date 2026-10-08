// Schema-driven control panel. Every control reads/writes one state key.

import { DEFAULTS } from './state.js';
import { FONTS } from './source.js';

const isText = (s) => s.sourceType === 'text';
const isChar = (s) => s.shape === 'char';
const isLattice = (s) => s.layout === 'square' || s.layout === 'hex';

export const SCHEMA = [
  { title: 'source', controls: [
    { key: 'sourceType', type: 'seg', label: 'from', options: [['image', 'image'], ['text', 'text']] },
    { type: 'file', label: 'file', when: (s) => !isText(s) },
    { key: 'text', type: 'text', label: 'text', when: isText },
    { key: 'font', type: 'select', label: 'font', options: FONTS.map((f) => [f.id, f.label]), when: isText },
    { key: 'fontWeight', type: 'seg', label: 'weight', options: [[300, 'light'], [400, 'regular'], [700, 'bold'], [900, 'black']], when: isText,
      tip: 'fonts without that weight use their closest one' },
    { key: 'italic', type: 'toggle', label: 'italic', when: isText },
    { key: 'width', type: 'range', label: 'width', min: 200, max: 4000, step: 10, unit: 'px', tip: 'design width in px — png / jpeg export at 4× this' },
  ]},
  { title: 'subject', when: (s) => !isText(s), controls: [
    { key: 'subject', type: 'seg', label: 'isolate', options: [['off', 'off'], ['people', 'people'], ['any', 'any object']],
      tip: 'remove the background with an in-browser AI model (downloads once: people ~26 MB, any object ~5 MB)' },
    { key: 'maskEdge', type: 'range', label: 'edge', min: 0, max: 80, step: 1, unit: 'px', when: (s) => s.subject !== 'off', tip: 'soften the cut-out edge' },
    { key: 'maskKeep', type: 'seg', label: 'keep', options: [['subject', 'subject'], ['background', 'background']], when: (s) => s.subject !== 'off' },
  ]},
  { title: 'field', controls: [
    { key: 'field', type: 'seg', label: 'field', options: [['off', 'off'], ['on', 'on']],
      tip: 'vary the halftone across the image with pins, like a field blur: 0 = untouched, 100 = fully screened and blurred' },
    { type: 'pin', label: 'pin', when: (s) => s.field === 'on', tip: 'strength of the selected pin' },
    { key: 'fieldBlur', type: 'range', label: 'max blur', min: 0, max: 120, step: 1, unit: 'px', when: (s) => s.field === 'on', tip: 'blur where strength is 100' },
    { key: 'fieldSolid', type: 'range', label: 'sharp <', min: 0, max: 100, step: 1, unit: '%', when: (s) => s.field === 'on',
      tip: 'below this strength the original image / text shows, unscreened. 0 = halftone everywhere' },
    { key: 'fieldSoft', type: 'range', label: 'fade', min: 0, max: 100, step: 1, unit: '%', when: (s) => s.field === 'on' && s.fieldSolid > 0,
      tip: 'how gradually the original dissolves into the halftone' },
    { type: 'actions', label: 'start', when: (s) => s.field === 'on', options: [['ramp', 'sharp → dots'], ['rampBack', 'dots ← sharp'], ['center', 'sharp centre'], ['clear', 'clear']] },
    { type: 'note', when: (s) => s.field === 'on', text: 'click the image to add a pin · drag to move · ⌥-click or ⌫ to remove' },
  ]},
  { title: 'tone', controls: [
    { key: 'colors', type: 'seg', label: 'ink', options: [['bw', 'black'], ['wb', 'white']], tip: 'black ink on white, or white ink on black — for the preview and every export' },
    { key: 'brightness', type: 'range', label: 'bright', min: -100, max: 100, step: 1 },
    { key: 'contrast', type: 'range', label: 'contrast', min: -100, max: 100, step: 1 },
    { key: 'gamma', type: 'range', label: 'gamma', min: 0.2, max: 3, step: 0.01, tip: 'above 1 lightens midtones' },
    { key: 'blackPoint', type: 'range', label: 'black pt', min: 0, max: 100, step: 1, tip: 'anything darker becomes full ink' },
    { key: 'whitePoint', type: 'range', label: 'white pt', min: 0, max: 100, step: 1, tip: 'anything lighter becomes paper — lower it to drop a light background' },
    { key: 'blur', type: 'range', label: 'blur', min: 0, max: 40, step: 0.5, tip: 'smooth the source before sampling' },
    { key: 'invert', type: 'toggle', label: 'invert', when: (s) => !isText(s), tip: 'swap light and dark in the image' },
  ]},
  { title: 'grid', controls: [
    { key: 'layout', type: 'select', label: 'layout', options: [['square', 'square'], ['hex', 'hex'], ['radial', 'radial'], ['spiral', 'spiral'], ['noise', 'noise']],
      tip: 'where shapes sit. radial / spiral turn shapes along the curve; noise is an even random scatter' },
    { key: 'cell', type: 'range', label: 'cell', min: 2, max: 120, step: 1, unit: 'px', tip: 'spacing between shapes' },
    { key: 'angle', type: 'range', label: 'angle', min: 0, max: 90, step: 1, unit: '°' },
    { key: 'clusters', type: 'range', label: 'clusters', min: 0, max: 100, step: 1, unit: '%', when: isLattice,
      tip: 'randomly merge 2×2 / 4×4 / 8×8 blocks into one big shape' },
    { key: 'seed', type: 'seed', label: 'seed', tip: 'rerolls every random choice (clusters, noise, merge var, random dither)' },
  ]},
  { title: 'shape', controls: [
    { key: 'shape', type: 'select', label: 'shape', options: [['dot', 'dot'], ['square', 'square'], ['diamond', 'diamond'], ['cross', 'cross'], ['line', 'line'], ['tri', 'tri'], ['char', 'ascii']] },
    { key: 'charset', type: 'line', label: 'chars', when: isChar, tip: 'light → dark. first character is used for paper' },
    { key: 'method', type: 'seg', label: 'method', options: [['size', 'size'], ['dither', 'on/off']], when: (s) => !isChar(s),
      tip: 'size: shapes grow with darkness. on/off: same-size shapes, switched by a dither pattern' },
    { key: 'dither', type: 'select', label: 'dither', when: (s) => s.method === 'dither' && !isChar(s), options: [
      ['threshold', 'threshold'], ['bayer2', 'bayer 2×2'], ['bayer4', 'bayer 4×4'], ['bayer8', 'bayer 8×8'],
      ['floyd', 'floyd–steinberg'], ['atkinson', 'atkinson'], ['random', 'random'],
    ]},
    { key: 'roundness', type: 'range', label: 'round', min: 0, max: 100, step: 1, unit: '%', when: (s) => s.shape === 'square' || s.shape === 'diamond', tip: 'round the corners' },
    { key: 'scale', type: 'range', label: 'scale', min: 5, max: 250, step: 1, unit: '%', tip: 'shape size relative to the cell — above 100 they overlap' },
    { key: 'floor', type: 'range', label: 'min dot', min: 0, max: 100, step: 1, unit: '%', when: (s) => !isChar(s), tip: 'smallest size drawn, so light areas keep tiny shapes' },
    { key: 'cutoff', type: 'range', label: 'cutoff', min: 0, max: 100, step: 1, unit: '%', when: (s) => s.method === 'size' || isChar(s), tip: 'drop shapes lighter than this' },
    { key: 'merge', type: 'range', label: 'merge', min: 0, max: 100, step: 1, unit: '%', when: (s) => !isChar(s), tip: 'fuse neighbouring shapes into liquid blobs' },
    { key: 'mergeVar', type: 'range', label: 'merge var', min: 0, max: 100, step: 1, unit: '%', when: (s) => s.merge > 0 && !isChar(s), tip: 'randomise stickiness so only some neighbours fuse' },
    { key: 'shades', type: 'seg', label: 'shades', options: [['off', 'off'], ['on', 'on']],
      tip: 'tint each shape grey by tone, for more contrast on detailed images' },
    { key: 'shadeLevels', type: 'range', label: 'levels', min: 2, max: 12, step: 1, when: (s) => s.shades === 'on', tip: 'how many grey steps' },
    { key: 'shadeMin', type: 'range', label: 'faintest', min: 0, max: 90, step: 1, unit: '%', when: (s) => s.shades === 'on', tip: 'opacity of the lightest grey' },
    { key: 'antialias', type: 'seg', label: 'edges', options: [[true, 'smooth'], [false, '1-bit']],
      tip: '1-bit snaps every pixel to pure ink or paper (also flattens shades and the field original)' },
  ]},
];

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const decimals = (step) => (String(step).split('.')[1] || '').length;

// api: { get(): state, set(patch), onFile(file) }
export function buildPanel(root, api) {
  const rows = [];
  const sections = [];

  for (const section of SCHEMA) {
    const box = el('fieldset', 'section');
    box.appendChild(el('legend', null, section.title));
    if (section.when) sections.push({ box, when: section.when });
    for (const c of section.controls) {
      const row = el('div', 'row');
      const label = el('label', null, c.label);
      if (c.key) {
        label.title = (c.tip ? c.tip + '\n' : '') + 'double-click to reset';
        label.addEventListener('dblclick', () => api.set({ [c.key]: DEFAULTS[c.key] }));
      }
      row.appendChild(label);
      const sync = makeControl(c, row, api);
      box.appendChild(row);
      rows.push({ c, row, sync });
    }
    root.appendChild(box);
  }

  return function refresh() {
    const s = api.get();
    for (const { box, when } of sections) box.hidden = !when(s);
    for (const { c, row, sync } of rows) {
      row.hidden = c.when ? !c.when(s) : false;
      sync(s);
    }
  };
}

function makeControl(c, row, api) {
  switch (c.type) {
    case 'range': {
      const range = el('input');
      range.type = 'range';
      range.min = c.min; range.max = c.max; range.step = c.step;
      const val = el('input', 'val');
      val.type = 'text';
      val.inputMode = 'decimal';
      val.spellcheck = false;
      const dp = decimals(c.step);
      const fmt = (v) => Number(v).toFixed(dp);
      range.addEventListener('input', () => api.set({ [c.key]: Number(range.value) }));
      const commit = () => {
        let v = parseFloat(val.value);
        if (!isFinite(v)) { val.value = fmt(api.get()[c.key]); return; }
        v = Math.min(c.max, Math.max(c.min, Math.round(v / c.step) * c.step));
        api.set({ [c.key]: Number(v.toFixed(dp)) });
      };
      val.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { commit(); val.blur(); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const k = (e.shiftKey ? 10 : 1) * c.step * (e.key === 'ArrowUp' ? 1 : -1);
          const v = Math.min(c.max, Math.max(c.min, api.get()[c.key] + k));
          api.set({ [c.key]: Number(v.toFixed(dp)) });
        }
      });
      val.addEventListener('blur', commit);
      row.append(range, val);
      return (s) => {
        range.value = s[c.key];
        if (document.activeElement !== val) val.value = fmt(s[c.key]);
      };
    }
    case 'seg':
    case 'toggle': {
      const opts = c.type === 'toggle' ? [[false, 'off'], [true, 'on']] : c.options;
      const wrap = el('div', 'seg');
      const btns = opts.map(([v, text]) => {
        const b = el('button', null, text);
        b.type = 'button';
        b.addEventListener('click', () => api.set({ [c.key]: v }));
        wrap.appendChild(b);
        return [v, b];
      });
      row.appendChild(wrap);
      return (s) => btns.forEach(([v, b]) => b.setAttribute('aria-pressed', String(s[c.key] === v)));
    }
    case 'select': {
      const sel = el('select', 'select');
      for (const [v, text] of c.options) {
        const o = el('option', null, text);
        o.value = v;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        const opt = c.options.find(([v]) => String(v) === sel.value);
        api.set({ [c.key]: opt ? opt[0] : sel.value });
      });
      row.appendChild(sel);
      return (s) => { sel.value = String(s[c.key]); };
    }
    case 'text': {
      const ta = el('textarea', 'txt');
      ta.rows = 2;
      ta.spellcheck = false;
      ta.addEventListener('input', () => api.set({ [c.key]: ta.value }));
      row.appendChild(ta);
      return (s) => { if (document.activeElement !== ta) ta.value = s[c.key]; };
    }
    case 'line': {
      const input = el('input', 'txt');
      input.type = 'text';
      input.spellcheck = false;
      input.addEventListener('input', () => api.set({ [c.key]: input.value }));
      row.appendChild(input);
      return (s) => { if (document.activeElement !== input) input.value = s[c.key]; };
    }
    case 'pin': {
      const range = el('input');
      range.type = 'range';
      range.min = 0; range.max = 100; range.step = 1;
      const val = el('input', 'val');
      val.type = 'text';
      val.inputMode = 'numeric';
      range.addEventListener('input', () => api.setPinValue(Number(range.value)));
      const commit = () => {
        const v = parseFloat(val.value);
        if (isFinite(v)) api.setPinValue(Math.min(100, Math.max(0, Math.round(v))));
      };
      val.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); val.blur(); } });
      val.addEventListener('blur', commit);
      row.append(range, val);
      return () => {
        const pin = api.getPin();
        range.disabled = val.disabled = !pin;
        range.value = pin ? pin.v : 0;
        if (document.activeElement !== val) val.value = pin ? pin.v : '–';
      };
    }
    case 'actions': {
      const wrap = el('div', 'seg');
      for (const [name, text] of c.options) {
        const b = el('button', null, text);
        b.type = 'button';
        b.addEventListener('click', () => api.fieldAction(name));
        wrap.appendChild(b);
      }
      row.appendChild(wrap);
      return () => {};
    }
    case 'note': {
      row.classList.add('note');
      row.firstChild.textContent = '';
      row.appendChild(el('span', 'dim', c.text));
      return () => {};
    }
    case 'seed': {
      const wrap = el('div', 'seg');
      const val = el('input', 'val');
      val.type = 'text';
      val.inputMode = 'numeric';
      const commit = () => {
        const v = parseInt(val.value, 10);
        if (isFinite(v)) api.set({ seed: Math.max(1, v) }); else val.value = api.get().seed;
      };
      val.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); val.blur(); } });
      val.addEventListener('blur', commit);
      const roll = el('button', null, 'reroll');
      roll.type = 'button';
      roll.addEventListener('click', () => api.set({ seed: Math.floor(Math.random() * 9999) + 1 }));
      wrap.append(roll);
      row.append(wrap, val);
      return (s) => { if (document.activeElement !== val) val.value = s.seed; };
    }
    case 'file': {
      const input = el('input');
      input.type = 'file';
      input.accept = 'image/*,.heic,.heif,.avif,.svg,application/json,.json';
      input.hidden = true;
      const btn = el('button', 'file', 'choose / drop / paste');
      btn.type = 'button';
      btn.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        if (input.files[0]) api.onFile(input.files[0]);
        input.value = '';
      });
      row.append(btn, input);
      return () => { btn.textContent = api.fileName() || 'choose / drop / paste'; };
    }
  }
  return () => {};
}
