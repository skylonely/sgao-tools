import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { PROFILES, resizeDimensions, imageFilename, savings, perceptualScore, encodeIndexedPNG, inspectImage } from '../src/lib/image-compression.js';
import { crc32, createZIP } from '../src/lib/zip.js';

test('resize preserves aspect ratio, never enlarges, and rounds tiny dimensions safely', () => {
  assert.deepEqual(resizeDimensions(4000, 3000, 1920), { width: 1920, height: 1440 });
  assert.deepEqual(resizeDimensions(300, 200, 1920), { width: 300, height: 200 });
  assert.deepEqual(resizeDimensions(10000, 1, 800), { width: 800, height: 1 });
  assert.throws(() => resizeDimensions(0, 10, 800));
});
test('savings and output filenames report growth and safe, real extensions', () => {
  assert.deepEqual(savings(1000, 250), { bytes: 750, percent: 75 });
  assert.equal(savings(1000, 2000).percent, -100);
  assert.equal(imageFilename('../我的图片.PNG', 'image/webp'), '-我的图片-optimized.webp');
  assert.equal(imageFilename('photo.jpg', 'image/png'), 'photo-optimized.png');
});
test('perceptual comparison detects detail, colour and alpha loss', () => {
  const original = Uint8ClampedArray.from({ length: 16 * 16 * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) % 2 ? 50 : 200));
  assert.ok(Math.abs(perceptualScore(original, original, 16, 16) - 1) < 1e-10);
  const blurred = original.map((v, i) => i % 4 === 3 ? v : 125);
  assert.ok(perceptualScore(original, blurred, 16, 16) < .5);
  const faded = original.map((v, i) => i % 4 === 3 ? 128 : v);
  assert.ok(perceptualScore(original, faded, 16, 16) < .5);
  assert.ok(PROFILES.quality.threshold > PROFILES.balanced.threshold && PROFILES.balanced.threshold > PROFILES.small.threshold);
  assert.throws(() => perceptualScore(original, new Uint8Array(4), 16, 16));
});
function decodePNG(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), chunks = {};
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = view.getUint32(offset), type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    assert.equal(view.getUint32(offset + 8 + size), crc32(bytes.subarray(offset + 4, offset + 8 + size)));
    chunks[type] = bytes.slice(offset + 8, offset + 8 + size); offset += size + 12;
  }
  const header = new DataView(chunks.IHDR.buffer), width = header.getUint32(0), height = header.getUint32(4);
  assert.equal(chunks.IHDR[8], 8); assert.equal(chunks.IHDR[9], 3);
  const raw = inflateSync(chunks.IDAT), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width + 1)], 0);
    for (let x = 0; x < width; x++) {
      const index = raw[y * (width + 1) + 1 + x], p = (y * width + x) * 4;
      rgba.set(chunks.PLTE.slice(index * 3, index * 3 + 3), p); rgba[p + 3] = chunks.tRNS[index] ?? 255;
    }
  }
  return { width, height, rgba, colors: chunks.PLTE.length / 3 };
}
test('indexed PNG is decodable with valid CRCs and preserves transparency and orientation', async () => {
  const source = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 0, 0, 0, 255, 255]);
  const blob = await encodeIndexedPNG(source, 2, 2, 4), bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, 'image/png'); assert.equal(inspectImage(bytes).width, 2);
  const decoded = decodePNG(bytes); assert.equal(decoded.colors, 4); assert.deepEqual(decoded.rgba, source);
});
test('PNG quantization respects palette budget and all-transparent input', async () => {
  const source = Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 53 + Math.floor(i / 9)) % 256);
  const blob = await encodeIndexedPNG(source, 32, 32, 16);
  assert.ok(decodePNG(new Uint8Array(await blob.arrayBuffer())).colors <= 16);
  const empty = await encodeIndexedPNG(new Uint8Array(16), 2, 2);
  assert.deepEqual(decodePNG(new Uint8Array(await empty.arrayBuffer())).rgba, new Uint8Array(16));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => encodeIndexedPNG(source, 32, 32, 16, controller.signal), { name: 'AbortError' });
});
test('image inspection rejects animation, non-images and detects real MIME', () => {
  assert.equal(inspectImage(new Uint8Array([255, 216, 255, 0])).mime, 'image/jpeg');
  const webp = new Uint8Array(30), text = new TextEncoder();
  webp.set(text.encode('RIFF'), 0); webp.set(text.encode('WEBPVP8X'), 8); new DataView(webp.buffer).setUint32(16, 10, true); webp[20] = 2;
  assert.throws(() => inspectImage(webp), /动态/);
  const png = new Uint8Array(45); png.set([137, 80, 78, 71]); new DataView(png.buffer).setUint32(8, 13); png.set(text.encode('IHDR'), 12); png.set(text.encode('acTL'), 37);
  assert.throws(() => inspectImage(png), /动画/);
  assert.throws(() => inspectImage(new Uint8Array([1, 2, 3])));
});
test('ZIP contains exact Unicode file bytes, CRCs and collision-safe names', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const payload = Uint8Array.from([137, 80, 78, 71, 0, 255]);
  const zip = createZIP([{ name: '图片.png', data: payload }, { name: '图片.png', data: payload }, { name: '../image.jpg', data: payload }]);
  const view = new DataView(zip.buffer), names = []; let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 6, true), 0x800);
    assert.equal(view.getUint32(offset + 14, true), crc32(payload));
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true);
    names.push(new TextDecoder().decode(zip.slice(offset + 30, offset + 30 + length)));
    assert.deepEqual(zip.slice(offset + 30 + length, offset + 30 + length + size), payload); offset += 30 + length + size;
  }
  assert.deepEqual(names, ['图片.png', '图片-2.png', '-image.jpg']);
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 12, true), 3);
});
