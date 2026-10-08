// Runs the halftone engine off the main thread so the UI never stalls.
import { createEngine } from './engine.js';

const engine = createEngine();

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'source') {
    engine.setSource(m.source);
    return;
  }
  if (m.type === 'render') {
    try {
      const result = engine.render(m.state, m.wantTone, m.haveTone);
      self.postMessage({ id: m.id, result }, result && result.tone ? [result.tone.data.buffer] : []);
    } catch (err) {
      self.postMessage({ id: m.id, error: String((err && err.message) || err) });
    }
  }
};
