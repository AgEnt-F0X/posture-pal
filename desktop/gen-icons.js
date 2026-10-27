// Generates assets/icon.png (256px) and wraps it into assets/icon.ico.
// Pure Node — draws a simple seedling-in-pot pixel art, encodes PNG manually.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function buildPixels() {
  const px = new Uint8Array(SIZE * SIZE * 4); // RGBA
  const set = (x, y, r, g, b, a = 255) => {
    const i = (y * SIZE + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const inRoundedSquare = (x, y) => {
    const rad = 44;
    const cx = clamp(x, rad, SIZE - 1 - rad), cy = clamp(y, rad, SIZE - 1 - rad);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= rad * rad || (x >= rad && x < SIZE - rad) || (y >= rad && y < SIZE - rad);
  };
  const inEllipse = (x, y, cx, cy, rx, ry) => {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inRoundedSquare(x, y)) { set(x, y, 0, 0, 0, 0); continue; }
      // dark navy background
      let r = 11, g = 18, b = 32;
      // pot (terracotta trapezoid) + rim
      const potTop = 172, potBottom = 224;
      if (y >= 160 && y < 176 && x >= 76 && x < 180) { r = 179; g = 95; b = 63; }
      else if (y >= potTop && y < potBottom) {
        const inset = Math.floor((y - potTop) * 0.35);
        if (x >= 84 + inset && x < 172 - inset) { r = 201; g = 111; b = 74; }
      }
      // stem
      if (x >= 122 && x < 134 && y >= 78 && y < 162) { r = 62; g = 158; b = 95; }
      // leaves + bud
      if (inEllipse(x, y, 92, 118, 30, 14)) { r = 52; g = 192; b = 107; }
      if (inEllipse(x, y, 164, 118, 30, 14)) { r = 63, g = 207, b = 119; }
      if (inEllipse(x, y, 128, 70, 17, 17)) { r = 69; g = 216; b = 120; }
      if (inEllipse(x, y, 128, 70, 7, 7)) { r = 251; g = 191; b = 36; } // bud center
      set(x, y, r, g, b, 255);
    }
  }
  return px;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(px) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  // filter 0 per scanline
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    px.copy ? px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
      : raw.set(px.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), y * (SIZE * 4 + 1) + 1);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, 'assets');
fs.mkdirSync(outDir, { recursive: true });
const png = encodePng(buildPixels());
fs.writeFileSync(path.join(outDir, 'icon.png'), png);

// ICO wrapping a single 256px PNG entry (supported by Windows Vista+)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0;          // 256px encoded as 0
entry[2] = 0; entry[3] = 0;          // 256px
entry[4] = 0; entry[5] = 0;          // no palette
entry[6] = 0; entry[7] = 0;          // reserved
entry.writeUInt16LE(1, 4);           // planes
entry.writeUInt16LE(32, 6);          // bpp
entry.writeUInt32LE(png.length, 8);  // data size
entry.writeUInt32LE(22, 12);         // offset (6-byte header + 16-byte entry)
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, entry, png]));
console.log('icons written:', path.join(outDir, 'icon.png'), '+ icon.ico');
