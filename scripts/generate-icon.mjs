import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '../build/icon.ico');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRgba(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function signedDistRoundedBox(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - hw + r;
  const dy = Math.abs(py - cy) - hh + r;
  const out = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return out + inside - r;
}

function blendPixel(buf, idx, r, g, b, a) {
  if (a <= 0) return;
  const alpha = Math.min(1, a);
  const inv = 1 - alpha;
  const prevA = buf[idx + 3] / 255;
  const outA = alpha + prevA * inv;
  if (outA <= 0) return;
  buf[idx] = Math.round((r * alpha + buf[idx] * prevA * inv) / outA);
  buf[idx + 1] = Math.round((g * alpha + buf[idx + 1] * prevA * inv) / outA);
  buf[idx + 2] = Math.round((b * alpha + buf[idx + 2] * prevA * inv) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

/**
 * Renders the KomaRoll icon (dark obsidian rounded tile + horizontal manga strip panels + RTL flow accent).
 */
function renderIconRgba(size) {
  const buf = Buffer.alloc(size * size * 4);
  const aa = 1.25 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const idx = (y * size + x) * 4;

      // 1. Rounded obsidian tile background
      const tileDist = signedDistRoundedBox(nx, ny, 0.5, 0.5, 0.46, 0.46, 0.14);
      if (tileDist < aa) {
        const cov = Math.max(0, Math.min(1, (aa - tileDist) / (2 * aa)));
        // Subtle dark slate-to-obsidian diagonal gradient
        const grad = (nx + ny) * 0.5;
        const bgR = 16 + grad * 14;
        const bgG = 17 + grad * 14;
        const bgB = 26 + grad * 18;
        blendPixel(buf, idx, bgR, bgG, bgB, cov);

        // Subtle rim highlight
        if (tileDist > -0.025) {
          blendPixel(buf, idx, 244, 63, 94, cov * 0.35);
        }
      }

      // 2. Left faded panel (previous manga page)
      const leftPanel = signedDistRoundedBox(nx, ny, 0.21, 0.5, 0.085, 0.27, 0.025);
      if (leftPanel < aa) {
        const cov = Math.max(0, Math.min(1, (aa - leftPanel) / (2 * aa)));
        blendPixel(buf, idx, 71, 78, 102, cov * 0.85);
      }

      // 3. Center hero manga page (rose-coral gradient panel)
      const centerPanel = signedDistRoundedBox(nx, ny, 0.5, 0.5, 0.145, 0.31, 0.035);
      if (centerPanel < aa) {
        const cov = Math.max(0, Math.min(1, (aa - centerPanel) / (2 * aa)));
        const t = (ny - 0.19) / 0.62;
        const r = 244 + t * 8;
        const g = 63 + t * 50;
        const b = 94 + t * 44;
        blendPixel(buf, idx, r, g, b, cov);

        // Crisp manga inner koma divider lines inside center panel
        const topKoma = signedDistRoundedBox(nx, ny, 0.5, 0.365, 0.095, 0.095, 0.015);
        const botLeftKoma = signedDistRoundedBox(nx, ny, 0.45, 0.615, 0.045, 0.115, 0.015);
        const botRightKoma = signedDistRoundedBox(nx, ny, 0.555, 0.615, 0.042, 0.115, 0.015);
        const minKoma = Math.min(topKoma, botLeftKoma, botRightKoma);
        if (minKoma < aa) {
          const kCov = Math.max(0, Math.min(1, (aa - minKoma) / (2 * aa)));
          blendPixel(buf, idx, 255, 248, 250, kCov * 0.94);
        }
      }

      // 4. Right panel (next manga page in strip)
      const rightPanel = signedDistRoundedBox(nx, ny, 0.79, 0.5, 0.085, 0.27, 0.025);
      if (rightPanel < aa) {
        const cov = Math.max(0, Math.min(1, (aa - rightPanel) / (2 * aa)));
        blendPixel(buf, idx, 244, 63, 94, cov * 0.42);
      }
    }
  }

  return buf;
}

function buildIcoBuffer(pngEntries) {
  const count = pngEntries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (const { size, png } of pngEntries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngEntries.map((e) => e.png)]);
}

async function main() {
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngEntries = sizes.map((size) => ({
    size,
    png: encodePngRgba(size, size, renderIconRgba(size)),
  }));

  const icoBuffer = buildIcoBuffer(pngEntries);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, icoBuffer);
  console.log(`[icon] Generated ${outPath} (${(icoBuffer.length / 1024).toFixed(1)} KB, ${sizes.join('/')}px)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
