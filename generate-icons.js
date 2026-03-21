// Script to generate PWA icon PNG files
// Run: node generate-icons.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// CRC32 table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function setPixel(raw, size, x, y, r, g, b) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = y * (1 + size * 3) + 1 + x * 3;
  raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
}

function drawLine(raw, size, x0, y0, x1, y1, thick, r, g, b) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) * 2);
  for (let s = 0; s <= steps; s++) {
    const cx = Math.round(x0 + dx * s / steps);
    const cy = Math.round(y0 + dy * s / steps);
    for (let tx = -thick; tx <= thick; tx++)
      for (let ty = -thick; ty <= thick; ty++)
        if (tx * tx + ty * ty <= thick * thick)
          setPixel(raw, size, cx + tx, cy + ty, r, g, b);
  }
}

function createPNG(size) {
  // Indigo background #6366f1
  const [br, bg, bb] = [99, 102, 241];
  // White checkmark
  const [wr, wg, wb] = [255, 255, 255];

  const raw = Buffer.alloc(size * (1 + size * 3));
  // Fill background
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 3)] = 0; // filter byte
    for (let x = 0; x < size; x++) setPixel(raw, size, x, y, br, bg, bb);
  }

  // Draw white checkmark, scaled to icon size
  const s = size / 192;
  const thick = Math.max(1, Math.round(10 * s));
  // Left stroke: (48,96) -> (80,128), Right stroke: (80,128) -> (144,64)
  drawLine(raw, size, Math.round(48*s), Math.round(96*s), Math.round(80*s), Math.round(128*s), thick, wr, wg, wb);
  drawLine(raw, size, Math.round(80*s), Math.round(128*s), Math.round(144*s), Math.round(64*s), thick, wr, wg, wb);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

const publicDir = path.join(__dirname, 'public');
for (const size of [180, 192, 512]) {
  const buf = createPNG(size);
  fs.writeFileSync(path.join(publicDir, `icon-${size}.png`), buf);
  console.log(`Created public/icon-${size}.png (${buf.length} bytes)`);
}
