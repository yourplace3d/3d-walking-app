/**
 * Made-up terrain tiles (Terrarium PNGs) for the end-to-end test: gentle hills, the same wherever
 * tiles meet, so the test needs no network.
 */

import { deflateSync } from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Height (m) at a point given in Web Mercator pixels at zoom 20. */
function heightAt(X, Y) {
  const m = 0.15; // ~metres per zoom-20 pixel at mid latitudes
  return 260 + 25 * Math.sin((X * m) / 400) + 18 * Math.cos((Y * m) / 300);
}

export function terrainTile(z, x, y) {
  const size = 256;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const f = 2 ** (20 - z);
  for (let j = 0; j < size; j++) {
    raw[j * (size * 3 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      const h = heightAt((x * size + i) * f, (y * size + j) * f) + 32768;
      const r = Math.floor(h / 256);
      const g = Math.floor(h % 256);
      const b = Math.floor((h - Math.floor(h)) * 256);
      const o = j * (size * 3 + 1) + 1 + i * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.from(deflateSync(raw))), chunk('IEND', Buffer.alloc(0))]);
}
