// Main-thread side of subject detection. Returns a canvas the size of the
// source whose gray level is the subject probability (white = subject).

const SEND_MAX = 1024;
let worker = null;
let nextId = 1;
const jobs = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./mask-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const job = jobs.get(e.data.id);
      if (!job) return;
      if (e.data.error) { jobs.delete(e.data.id); job.reject(new Error(e.data.error)); }
      else if (e.data.done) { jobs.delete(e.data.id); job.resolve(e.data); }
      else job.onStatus(e.data);
    };
    worker.onerror = (e) => {
      for (const job of jobs.values()) job.reject(new Error(e.message || 'mask worker failed'));
      jobs.clear();
      worker = null;
    };
  }
  return worker;
}

export async function segment(source, kind, onStatus) {
  const k = Math.min(1, SEND_MAX / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * k)), h = Math.max(1, Math.round(source.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; // the model expects an opaque image
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const id = nextId++;
  const res = await new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, onStatus });
    getWorker().postMessage({ id, kind, width: w, height: h, data: data.buffer }, [data.buffer]);
  });

  // model-resolution mask -> canvas -> scaled to the source size
  const small = document.createElement('canvas');
  small.width = res.mw; small.height = res.mh;
  const img = new ImageData(res.mw, res.mh);
  for (let i = 0; i < res.mask.length; i++) {
    const v = res.mask[i];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  small.getContext('2d').putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = source.width; out.height = source.height;
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(small, 0, 0, out.width, out.height);
  return out;
}
