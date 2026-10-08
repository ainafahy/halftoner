// Background removal in a worker, via Transformers.js (ONNX Runtime Web).
// Models download once from the Hugging Face hub and are cached by the browser.
//   people: MODNet  (Apache-2.0, ~26 MB) — portrait matting, via Transformers.js
//   any:    U²-Net-p (Apache-2.0, ~5 MB) — salient object, via ONNX Runtime Web
// (BiRefNet was tried for "any": it needs more WebGPU buffers than many GPUs
// allow and runs out of wasm memory on the CPU, so it isn't reliable in-browser.)
import { AutoModel, AutoProcessor, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

env.allowLocalModels = false;

// minBuffers: storage buffers per shader stage the model needs on WebGPU.
const MODELS = {
  people: { id: 'Xenova/modnet', dtype: 'fp32', minBuffers: 8 },
};

const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';
const U2NETP = 'https://huggingface.co/BritishWerewolf/U-2-Netp/resolve/main/onnx/model.onnx';
const U2_SIZE = 320;
let u2session = null;

async function fetchCached(url, report) {
  let cache = null;
  try { cache = await caches.open('halftoner-models'); } catch (e) {}
  const hit = cache && (await cache.match(url));
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 4.6e6;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    report({ stage: 'download', progress: Math.min(1, got / total), mb: total / 1e6 });
  }
  const bytes = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  if (cache) try { await cache.put(url, new Response(bytes)); } catch (e) {}
  return bytes;
}

// Salient-object mask with U²-Net-p: 320×320 in, probability map out.
async function u2net(width, height, data, report) {
  const ort = await import(ORT + 'ort.wasm.bundle.min.mjs');
  ort.env.wasm.wasmPaths = ORT;
  if (!u2session) {
    const bytes = await fetchCached(U2NETP, report);
    u2session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  }
  report({ stage: 'segment', device: 'wasm' });

  // stretch to 320×320 (as the model was trained), scale by max, ImageNet-normalise
  const c = new OffscreenCanvas(U2_SIZE, U2_SIZE);
  const ctx = c.getContext('2d');
  const src = new OffscreenCanvas(width, height);
  src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  ctx.drawImage(src, 0, 0, U2_SIZE, U2_SIZE);
  const px = ctx.getImageData(0, 0, U2_SIZE, U2_SIZE).data;
  const n = U2_SIZE * U2_SIZE;
  let max = 1;
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i], px[i + 1], px[i + 2]);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 3; ch++) input[ch * n + i] = (px[i * 4 + ch] / max - mean[ch]) / std[ch];
  }
  const feeds = { [u2session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, U2_SIZE, U2_SIZE]) };
  const out = await u2session.run(feeds);
  const pred = out[u2session.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, pred[i]); hi = Math.max(hi, pred[i]); }
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = Math.round(((pred[i] - lo) / (hi - lo || 1)) * 255);
  return { mask, mw: U2_SIZE, mh: U2_SIZE };
}

const loaded = {};

async function pickDevice(minBuffers) {
  try {
    const adapter = self.navigator && navigator.gpu && (await navigator.gpu.requestAdapter());
    if (adapter && adapter.limits.maxStorageBuffersPerShaderStage >= minBuffers) return 'webgpu';
  } catch (e) {}
  return 'wasm';
}

function load(kind, report, forceWasm) {
  const slot = forceWasm ? kind + ':wasm' : kind;
  if (!loaded[slot]) {
    loaded[slot] = (async () => {
      const { id, dtype, minBuffers } = MODELS[kind];
      const device = forceWasm ? 'wasm' : await pickDevice(minBuffers);
      const files = {};
      const progress_callback = (p) => {
        if (p.status !== 'progress' || !p.total) return;
        files[p.file] = [p.loaded, p.total];
        let a = 0, b = 0;
        for (const [l, t] of Object.values(files)) { a += l; b += t; }
        report({ stage: 'download', progress: a / b, mb: b / 1e6 });
      };
      const model = await AutoModel.from_pretrained(id, { device, dtype, progress_callback });
      const processor = await AutoProcessor.from_pretrained(id);
      return { model, processor, device };
    })().catch((e) => {
      delete loaded[slot];
      throw e;
    });
  }
  return loaded[slot];
}

function halfToFloat(h) {
  const s = (h & 0x8000) >> 15, e = (h & 0x7c00) >> 10, f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

async function infer(kind, image, report, forceWasm) {
  const { model, processor, device } = await load(kind, report, forceWasm);
  report({ stage: 'segment', device });
  const { pixel_values } = await processor(image);
  const inputName = (model.sessions && model.sessions.model && model.sessions.model.inputNames[0]) || 'input';
  const outputs = await model({ [inputName]: pixel_values });
  return Object.values(outputs)[0];
}

self.onmessage = async (e) => {
  const { id, kind, width, height, data } = e.data;
  const report = (m) => self.postMessage({ id, ...m });
  try {
    if (kind === 'any') {
      const r = await u2net(width, height, data, report);
      self.postMessage({ id, done: true, ...r }, [r.mask.buffer]);
      return;
    }
    const image = new RawImage(new Uint8ClampedArray(data), width, height, 4).rgb();
    let t;
    try {
      t = await infer(kind, image, report, false);
    } catch (gpuErr) {
      // Some GPUs / drivers reject a model on WebGPU; the CPU path is slower but works.
      console.warn('segmentation failed on the default device, retrying on wasm', gpuErr);
      t = await infer(kind, image, report, true);
    }
    const dims = t.dims;
    const mh = dims[dims.length - 2], mw = dims[dims.length - 1];
    const raw = t.data;
    const n = mw * mh;
    const vals = new Float32Array(n);
    const isHalf = raw instanceof Uint16Array;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = isHalf ? halfToFloat(raw[i]) : raw[i];
      vals[i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // Some models return logits, others probabilities.
    const logits = lo < -0.05 || hi > 1.05;
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = logits ? 1 / (1 + Math.exp(-vals[i])) : vals[i];
      mask[i] = Math.max(0, Math.min(255, Math.round(p * 255)));
    }
    self.postMessage({ id, done: true, mask, mw, mh }, [mask.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
