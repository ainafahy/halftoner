// Settings travel inside exported images: in PNGs as an iTXt chunk keyed
// "halftoner", in JPEGs as a comment segment "halftoner:{json}". Image
// viewers ignore both; opening the file from Halftoner's source reads them.

const KEYWORD = 'halftoner';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Returns a new PNG blob with the settings inserted right after IHDR.
export async function withSettings(pngBlob, settings) {
  const png = new Uint8Array(await pngBlob.arrayBuffer());
  const enc = new TextEncoder();
  // iTXt: keyword \0 compression-flag compression-method language \0 translated \0 text
  const data = new Uint8Array([...enc.encode(KEYWORD), 0, 0, 0, 0, 0, ...enc.encode(JSON.stringify(settings))]);
  const type = enc.encode('iTXt');
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  const typed = new Uint8Array(4 + data.length);
  typed.set(type, 0);
  typed.set(data, 4);
  view.setUint32(8 + data.length, crc32(typed));
  const ihdrEnd = 8 + 12 + new DataView(png.buffer).getUint32(8); // signature + IHDR chunk
  return new Blob([png.slice(0, ihdrEnd), chunk, png.slice(ihdrEnd)], { type: 'image/png' });
}

// JPEG: a COM (0xFFFE) segment right after SOI.
export async function jpegWithSettings(jpegBlob, settings) {
  const jpg = new Uint8Array(await jpegBlob.arrayBuffer());
  const body = new TextEncoder().encode(`${KEYWORD}:${JSON.stringify(settings)}`);
  if (body.length > 65533) return jpegBlob; // too big for one segment: skip
  const seg = new Uint8Array(4 + body.length);
  seg[0] = 0xff; seg[1] = 0xfe;
  seg[2] = (body.length + 2) >> 8; seg[3] = (body.length + 2) & 0xff;
  seg.set(body, 4);
  return new Blob([jpg.slice(0, 2), seg, jpg.slice(2)], { type: 'image/jpeg' });
}

function readJpeg(jpg) {
  const dec = new TextDecoder();
  let p = 2;
  while (p + 4 <= jpg.length && jpg[p] === 0xff) {
    const marker = jpg[p + 1];
    const len = (jpg[p + 2] << 8) | jpg[p + 3];
    if (marker === 0xfe) {
      const text = dec.decode(jpg.slice(p + 4, p + 2 + len));
      if (text.startsWith(KEYWORD + ':')) {
        try { return JSON.parse(text.slice(KEYWORD.length + 1)); } catch (e) { return null; }
      }
    }
    if (marker === 0xda) break; // start of scan: no more headers
    p += 2 + len;
  }
  return null;
}

// Settings stored by withSettings / jpegWithSettings, or null.
export async function readSettings(blob) {
  const png = new Uint8Array(await blob.arrayBuffer());
  if (png[0] === 0xff && png[1] === 0xd8) return readJpeg(png);
  const view = new DataView(png.buffer);
  const dec = new TextDecoder();
  let p = 8;
  while (p + 12 <= png.length) {
    const len = view.getUint32(p);
    const type = dec.decode(png.slice(p + 4, p + 8));
    if (type === 'iTXt') {
      const data = png.slice(p + 8, p + 8 + len);
      const z = data.indexOf(0);
      if (dec.decode(data.slice(0, z)) === KEYWORD) {
        // skip flag, method, then the two \0-terminated language fields
        let q = z + 3;
        q = data.indexOf(0, q) + 1;
        q = data.indexOf(0, q) + 1;
        try { return JSON.parse(dec.decode(data.slice(q))); } catch (e) { return null; }
      }
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return null;
}
