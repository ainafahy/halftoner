# Halftoner

A browser tool for black & white halftone designs: dots, pixels, lines, dithers,
ASCII and liquid "goo" blobs. Export as PNG, SVG, a live web kit (React component +
engine) or plain text. No colour, ever — output is ink on paper (black on white, or white on black).

## Run locally

No build step. A tiny no-cache static server is included (any static server works):

```bash
python3 serve.py
```

then open http://localhost:8010. The page live-reloads when files change.

The tool opens on a default design: the hands photo in `assets/default.jpg` with the settings in `DEFAULTS` (`js/state.js`). `reset` returns to those settings. To change the landing design, replace that image and update `DEFAULTS` (paste the values from an exported image's settings, e.g. via `readSettings` in `js/pngmeta.js`).

## How it works

1. **Source** — an image (choose, drag & drop, or paste) or typed text, converted to grayscale. Text picks from ~20 fonts (system + Google Fonts, loaded on first use) with weight and italic. For text, blank paper always stays empty: tone settings only shape the letters, never put dots on the background (and `invert` doesn't apply — use `ink: white/black` for light text).
2. **Subject** — optional in-browser background removal, so only the subject (or only the background) gets ink. `edge` softens the cut.
   - `people` — [MODNet](https://huggingface.co/Xenova/modnet) (Apache-2.0, ~26 MB), via Transformers.js, WebGPU when available.
   - `any object` — [U²-Net-p](https://huggingface.co/BritishWerewolf/U-2-Netp) (Apache-2.0, ~5 MB), via ONNX Runtime Web.
   - Models download on first use and are cached by the browser. BiRefNet was evaluated for `any object` but needs more WebGPU storage buffers than many GPUs allow and exhausts wasm memory on the CPU.
3. **Field** — vary the halftone across the image, like Photoshop's Field Blur. Click the image to drop pins, each with a strength 0–100; strengths blend smoothly between pins (inverse-distance). Drag to move, ⌥-click or ⌫ to remove, and set the selected pin's strength in the panel.
   - `max blur` — how soft the source gets at strength 100.
   - `sharp <` — below this strength the original image / text shows, unscreened (with your tone settings). Set it to 0 for halftone everywhere with only the blur varying.
   - `fade` — how gradually the original dissolves into the halftone: the original fades out as the dots fade in. In SVG the original is an embedded image and the fade a mask; the dots stay vectors.
   - `start` — ready-made pin layouts: sharp → dots, dots ← sharp, sharp centre.
4. **Tone** — `ink` (black on white, or white on black), brightness, contrast, gamma, black / white points, blur, invert (images only).
5. **Grid** — where shapes sit: `square`, `hex`, `radial` (rings), `spiral`, `noise` (blue-noise scatter). Radial and spiral turn each shape along the curve. `cell` spacing, `angle`, `clusters` (randomly merge 2×2 / 4×4 / 8×8 blocks — square/hex only), `seed`.
6. **Shape** — `dot`, `square`, `diamond`, `cross`, `line`, `tri`, `ascii`.
   - `method: size` — shape area follows tone (line thickness follows it linearly). `cutoff` drops light shapes, `min dot` sets a floor.
   - `method: on/off` — same-size shapes switched by a dither: threshold, Bayer 2/4/8, Floyd–Steinberg, Atkinson, random.
   - `round` (square / diamond) rounds corners. `scale` is size relative to the cell.
   - `merge` smooth-unions neighbouring shapes into liquid blobs (signed distance fields + marching squares — still true vectors). `merge var` randomises stickiness so only some neighbours fuse.
   - `ascii` picks a character per cell from `chars` (light → dark).
   - `shades` (on/off) tints each shape grey by tone, for more contrast on detailed images: `levels` grey steps from `faintest` opacity up to full ink. Shades are ink opacity, so they work on any background and recolour with the ink (PNG, SVG `fill-opacity`, web kit). `edges: 1-bit` flattens them back to black & white.
   - `edges` — `smooth`, or `1-bit` to snap every pixel to pure ink or paper.

Controls only appear when they apply. Hover a label for what it does; double-click it to reset.

### Exploring

- **Presets** — starting points: dots, grid, liquid, goo, bitdots, pixels, mosaic, lines, rings, ascii. The same row ends with **random** (rolls new grid/shape settings) and **reset** (back to the default look, keeping your source).
- **undo / redo** — ⌘Z / ⇧⌘Z (slider drags collapse into one step).
- **Snapshots** — `+ pin current` saves the settings *and the image* with a thumbnail; click a thumbnail to bring both back (preview and exports follow). Settings live in localStorage, images in IndexedDB, both in this browser only.
- **split view** — drag across the canvas to compare the tone map with the output.
- **Restoring a look** — PNG and JPEG exports carry their settings. Open one (or an older settings `.json`) from the source file picker, or drop / paste it, to bring the settings back. Settings and the current image also persist across reloads.

### Exports

- **png / jpeg** — the finished picture at 4× the design width (capped by the browser's canvas limit on huge designs; the status line says so). PNG has a transparent background, JPEG sits on the paper colour. Both carry the settings.
- **svg** — vectors at design width, transparent background: a single path (or `<text>` for ascii), clipped to the frame; a field's sharp original is an embedded image.
- **web kit** — *use this for websites.* A zip that redraws the effect live in the browser with the same engine as the tool:
  ```
  components/halftone/Halftone.jsx        React component (poster first, then live canvas)
  components/halftone/halftone-engine.js  the engine as one standalone ES module
  components/halftone/halftone-worker.js  computes off the main thread
  components/halftone/halftone.config.json  every setting
  public/halftone/<name>/source.webp      the source image (png for text)
  public/halftone/<name>/mask.png         subject mask, when isolate is on
  public/halftone/<name>/poster.webp      instant placeholder
  README.md                               usage for whoever integrates it
  ```
  A few hundred KB instead of megabytes, sharp at any size and pixel density, and still live: props override any setting (`settings={{ cell: 12 }}`), swap the image (`src`), recolour (`ink`, `paper`), and fit like an image (`fit`, `position`).
- **txt** — ascii only: one line per grid row.

The tool and the kit share `js/runtime.js` (image → engine source, drawing at any size), so a kit renders what the tool shows.

## Files

| File | |
|---|---|
| `js/main.js` | UI wiring, history, snapshots, split view, exports |
| `js/runtime.js` | image → engine source, drawing a result at any size (shared with the web kit) |
| `js/kit.js` | web kit export: engine bundling, component, README, zip |
| `js/store.js` | IndexedDB storage for snapshot images |
| `js/engine.js` | the pipeline (tone → dots → path), cached per stage, DOM-free |
| `js/worker.js` | runs the engine in a Web Worker (falls back to inline) |
| `js/lattice.js` | grids / radial / spiral / noise, clusters, dithering → dots |
| `js/geometry.js` | dots → SVG path; liquid contours; ascii glyphs |
| `js/tone.js` | grayscale, tone curve, subject mask, area sampler |
| `js/mask.js`, `js/mask-worker.js` | subject detection |
| `js/render.js` | canvas drawing, PNG / SVG / React / TXT export |
| `js/ui.js` | control panel (schema-driven) |
| `js/source.js` | demo image, file decoding, text rendering |
| `js/state.js` | defaults, presets, persistence |
