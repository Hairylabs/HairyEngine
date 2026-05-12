#!/usr/bin/env node
// Generate a 256x256 PNG app icon at build/icon.png — no external deps.
// Brand mark: gradient circle with a stylized "H" + sprouting blade silhouette.
// electron-builder will down-/up-sample to other sizes and convert to .ico.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 256;
const pixels = Buffer.alloc(SIZE * SIZE * 4);

const ACCENT_A = [0xff, 0x3a, 0x8c]; // pink
const ACCENT_B = [0x4c, 0xf8, 0xc5]; // mint
const BG_A = [0x14, 0x14, 0x1d];
const BG_B = [0x1c, 0x1c, 0x28];

function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // alpha-over compositing on existing pixel
  const da = pixels[i + 3] / 255;
  const sa = a / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  pixels[i] = Math.round((r * sa + pixels[i] * da * (1 - sa)) / outA);
  pixels[i + 1] = Math.round((g * sa + pixels[i + 1] * da * (1 - sa)) / outA);
  pixels[i + 2] = Math.round((b * sa + pixels[i + 2] * da * (1 - sa)) / outA);
  pixels[i + 3] = Math.round(outA * 255);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mix3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Filled rounded square background (dark) with subtle vertical gradient.
const RADIUS = 56;
function inRoundedSquare(x, y) {
  const margin = 12;
  const left = margin,
    top = margin,
    right = SIZE - margin,
    bot = SIZE - margin;
  if (x < left || y < top || x > right || y > bot) return false;
  const cx = x < left + RADIUS ? left + RADIUS : x > right - RADIUS ? right - RADIUS : x;
  const cy = y < top + RADIUS ? top + RADIUS : y > bot - RADIUS ? bot - RADIUS : y;
  const dx = x - cx,
    dy = y - cy;
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE;
  const [r, g, b] = mix3(BG_A, BG_B, t);
  for (let x = 0; x < SIZE; x++) {
    if (inRoundedSquare(x, y)) set(x, y, r, g, b, 255);
  }
}

// Inner gradient halo behind the mark
const CX = SIZE / 2,
  CY = SIZE / 2;
for (let y = 24; y < SIZE - 24; y++) {
  for (let x = 24; x < SIZE - 24; x++) {
    if (!inRoundedSquare(x, y)) continue;
    const dx = x - CX,
      dy = y - CY;
    const d = Math.sqrt(dx * dx + dy * dy);
    const k = Math.max(0, 1 - d / 120);
    if (k <= 0) continue;
    const t = (x + y) / (SIZE * 2);
    const [r, g, b] = mix3(ACCENT_A, ACCENT_B, t);
    set(x, y, r, g, b, Math.round(k * 60));
  }
}

// Bold "H" letterform in pink, with a mint sprout coming out the top-right.
function thickLine(x0, y0, x1, y1, w, col) {
  // simple anti-aliased segment via dist-to-line
  const minX = Math.min(x0, x1) - w,
    maxX = Math.max(x0, x1) + w;
  const minY = Math.min(y0, y1) - w,
    maxY = Math.max(y0, y1) + w;
  const dx = x1 - x0,
    dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
      const px = x0 + dx * t,
        py = y0 + dy * t;
      const d = Math.hypot(x - px, y - py);
      const a = Math.max(0, Math.min(1, w - d));
      if (a > 0) set(x, y, col[0], col[1], col[2], Math.round(a * 255));
    }
  }
}

// H legs + crossbar
thickLine(82, 70, 82, 200, 12, ACCENT_A); // left leg
thickLine(174, 70, 174, 200, 12, ACCENT_A); // right leg
thickLine(82, 138, 174, 138, 12, ACCENT_A); // crossbar

// Mint sprout — a small curved arc near the right top of the H
function arc(cx, cy, r, a0, a1, w, col) {
  const steps = 40;
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + (a1 - a0) * (i / steps);
    const t1 = a0 + (a1 - a0) * ((i + 1) / steps);
    const x0 = cx + Math.cos(t0) * r,
      y0 = cy + Math.sin(t0) * r;
    const x1 = cx + Math.cos(t1) * r,
      y1 = cy + Math.sin(t1) * r;
    thickLine(x0, y0, x1, y1, w, col);
  }
}
arc(174, 70, 28, -Math.PI / 2, Math.PI / 4, 6, ACCENT_B);
// Leaf at tip
thickLine(200, 70, 215, 50, 6, ACCENT_B);
thickLine(200, 70, 217, 70, 5, ACCENT_B);

// ---- PNG encode ----
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Add filter byte 0 at the start of each row
const filtered = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  filtered[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(filtered, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(filtered);

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.png');
fs.writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes)`);
