import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWatermark, WATERMARK_LIMITS, WATERMARK_ANCHORS, checkWatermarkFile, checkWatermarkDimensions, rotatedBounds, watermarkLayout, clampWatermarkCenter, tileWatermarks, watermarkMime, watermarkFilename } from '../src/lib/watermark.js';
import { decodeWatermarkImage, encodeWatermark, paintWatermark } from '../src/watermark-engine.js';

const defaults = { type: 'text', mode: 'single', text: '© 山高\n原创作品', font: 'sans', bold: true, color: '#ffffff', textSize: 6, logoSize: 25, opacity: 70, angle: 0, margin: 2, gap: 130, anchor: 'br', x: 85, y: 90, format: 'auto', quality: 92, background: '#ffffff' };

test('watermark settings accept multiline Chinese and reject missing content or invalid controls', () => {
  assert.equal(validateWatermark({ ...defaults, text: '中文\r\n© SGAO' }).text, '中文\n© SGAO');
  for (const text of ['', '  \n ', 'a\nb\nc\nd', '长'.repeat(121)]) assert.throws(() => validateWatermark({ ...defaults, text }));
  for (const changes of [{ type: 'svg' }, { mode: 'unknown' }, { anchor: 'unknown' }, { font: '__proto__' }, { color: 'red' }, { background: 'transparent' }, { opacity: 0 }, { angle: Infinity }, { textSize: 21 }, { logoSize: 4 }, { gap: 49 }, { margin: -1 }, { x: NaN }, { y: 101 }, { quality: 101 }, { format: 'image/avif' }]) assert.throws(() => validateWatermark({ ...defaults, ...changes }));
  assert.doesNotThrow(() => validateWatermark({ ...defaults, type: 'logo', text: '' }));
});

test('batch admission and source/logo pixel limits enforce exact documented boundaries', () => {
  assert.doesNotThrow(() => checkWatermarkFile({ size: WATERMARK_LIMITS.fileBytes }, 19, 80 * 1024 ** 2));
  for (const args of [[{ size: 0 }], [{ size: WATERMARK_LIMITS.fileBytes + 1 }], [{ size: 1 }, 20, 0], [{ size: 1 }, 0, WATERMARK_LIMITS.totalBytes], [{ size: WATERMARK_LIMITS.logoBytes + 1 }, 0, 0, true]]) assert.throws(() => checkWatermarkFile(...args));
  assert.doesNotThrow(() => checkWatermarkDimensions(10000, 3200)); assert.doesNotThrow(() => checkWatermarkDimensions(4000, 4000, true));
  for (const args of [[10001, 1], [8000, 5000], [0, 1], [1.5, 20], [4097, 1, true], [4096, 4096, true]]) assert.throws(() => checkWatermarkDimensions(...args));
});

test('rotation bounds and all nine positions keep margin outside the entire rotated watermark', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7);
  const rotated = rotatedBounds(200, 100, 90); near(rotated.width, 100); near(rotated.height, 200);
  for (const anchor of WATERMARK_ANCHORS) {
    const result = watermarkLayout({ width: 1200, height: 800 }, { width: 200, height: 100 }, { ...defaults, anchor, angle: 35 });
    assert.ok(result.center.x - result.width / 2 >= 16 - 1e-7); assert.ok(result.center.x + result.width / 2 <= 1184 + 1e-7);
    assert.ok(result.center.y - result.height / 2 >= 16 - 1e-7); assert.ok(result.center.y + result.height / 2 <= 784 + 1e-7);
    if (anchor[1] === 'c') near(result.center.x, 600); if (anchor[0] === 'm') near(result.center.y, 400);
  }
});

test('long text and tall logos shrink to fit with their aspect ratio and rotation intact', () => {
  const size = { width: 800, height: 1000 }, mark = { width: 12000, height: 40 }, options = { ...defaults, angle: -45, anchor: 'custom', x: 0, y: 100, margin: 15 };
  const result = watermarkLayout(size, mark, options), unscaled = rotatedBounds(mark.width, mark.height, -45);
  assert.ok(result.scale < 1); assert.ok(result.width <= 560 + 1e-7 && result.height <= 760 + 1e-7);
  assert.ok(Math.abs(result.width / result.height - unscaled.width / unscaled.height) < 1e-9);
  assert.ok(result.center.x - result.width / 2 >= 120 - 1e-7); assert.ok(result.center.y + result.height / 2 <= 880 + 1e-7);
  assert.ok(watermarkLayout(size, { width: 300, height: 9000 }, defaults).scale < 1);
});

test('random image ratios, rotations, margins and custom drags remain bounded', () => {
  let seed = 912;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 1000; i++) {
    const size = { width: 1 + Math.floor(random() * 9999), height: 1 + Math.floor(random() * 3199) };
    const options = { ...defaults, anchor: 'custom', margin: random() * 15, angle: random() * 360 - 180, x: random() * 100, y: random() * 100 };
    const result = watermarkLayout(size, { width: 1 + random() * 20000, height: 1 + random() * 20000 }, options);
    for (const center of [result.center, clampWatermarkCenter(-1e5, 1e5, size, result, result.margin)]) {
      assert.ok(center.x - result.width / 2 >= result.margin - 1e-6); assert.ok(center.x + result.width / 2 <= size.width - result.margin + 1e-6);
      assert.ok(center.y - result.height / 2 >= result.margin - 1e-6); assert.ok(center.y + result.height / 2 <= size.height - result.margin + 1e-6);
    }
  }
});

test('relative size and custom center settings scale identically across batch resolutions', () => {
  const options = { ...defaults, anchor: 'custom', x: 30, y: 40, angle: 28 };
  const first = watermarkLayout({ width: 1200, height: 800 }, { width: 240, height: 80 }, options), second = watermarkLayout({ width: 2400, height: 1600 }, { width: 480, height: 160 }, options);
  assert.equal(second.center.x, first.center.x * 2); assert.equal(second.center.y, first.center.y * 2);
  assert.equal(second.width, first.width * 2); assert.equal(second.height, first.height * 2); assert.equal(second.margin, first.margin * 2);
});

test('tile density is bounded, staggered and extends beyond edges for clipped repetitions', () => {
  const size = { width: 10000, height: 3200 }, bounds = { width: 20, height: 10 }, result = tileWatermarks(size, bounds, 50);
  assert.ok(result.adjusted); assert.ok(result.centers.length <= 600);
  assert.ok(result.centers.some(center => center.x < 0)); assert.ok(result.centers.some(center => center.y < 0));
  assert.ok(result.centers.some(center => center.x > size.width)); assert.ok(result.centers.some(center => center.y > size.height));
  const normal = tileWatermarks({ width: 1200, height: 800 }, { width: 240, height: 80 }, 130);
  assert.equal(normal.adjusted, false); const rows = [...new Set(normal.centers.map(center => center.y))];
  assert.notEqual(normal.centers.find(center => center.y === rows[0]).x, normal.centers.find(center => center.y === rows[1]).x);
});

test('automatic output follows encodable inputs, AVIF becomes PNG and filename matches actual format', () => {
  for (const mime of ['image/png', 'image/jpeg', 'image/webp']) assert.equal(watermarkMime('auto', mime), mime);
  assert.equal(watermarkMime('auto', 'image/avif'), 'image/png'); assert.equal(watermarkMime('image/webp', 'image/jpeg'), 'image/webp');
  assert.equal(watermarkFilename('中文.avif', 'image/png'), '中文-watermarked.png');
  assert.equal(watermarkFilename('../folder/a\u0000.jpg', 'image/webp'), '-folder-a--watermarked.webp');
  assert.throws(() => watermarkMime('image/avif', 'image/png')); assert.throws(() => watermarkFilename('x', 'image/avif'));
});

function mockCanvas(t, encodedMime = null) {
  const originals = Object.fromEntries(['document', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let closed = 0, saves = 0, background = 0, alpha, orientation;
  const context = { save() { saves++; }, restore() { saves--; }, clearRect() {}, fillRect() { background++; }, drawImage() {}, translate() {}, rotate() {}, scale() {}, measureText(text) { return { width: text.length * 10, actualBoundingBoxAscent: 14, actualBoundingBoxDescent: 4 }; }, fillText() { alpha = this.globalAlpha; } };
  const canvas = { width: 0, height: 0, getContext() { return context; }, toBlob(callback, mime) { callback(new Blob(['encoded'], { type: encodedMime || mime })); } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() { return canvas; } } });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true, value: async (_, options) => { orientation = options; return { width: 1200, height: 800, close() { closed++; } }; } });
  t.after(() => { for (const key of Object.keys(originals)) { if (originals[key]) Object.defineProperty(globalThis, key, originals[key]); else delete globalThis[key]; } });
  return { canvas, context, state: () => ({ closed, saves, background, alpha, orientation }) };
}
const jpeg = () => new File([new Uint8Array([255, 216, 255])], 'image.jpg', { type: 'image/jpeg' });

test('encoding preserves source dimensions, checks orientation, fills JPG and releases temporary canvas', async t => {
  const env = mockCanvas(t), result = await encodeWatermark(jpeg(), defaults, null);
  assert.deepEqual([result.width, result.height, result.mime], [1200, 800, 'image/jpeg']);
  assert.equal(env.state().background, 1); assert.equal(env.state().alpha, .7); assert.equal(env.state().closed, 1);
  assert.equal(env.state().orientation.imageOrientation, 'from-image'); assert.equal(env.state().saves, 0);
  assert.equal(env.canvas.width, 1); assert.equal(env.canvas.height, 1);
});

test('browser format fallback is rejected instead of mislabeling PNG as WebP', async t => {
  const env = mockCanvas(t, 'image/png');
  await assert.rejects(encodeWatermark(jpeg(), { ...defaults, format: 'image/webp' }, null), /无法导出/);
  assert.equal(env.state().closed, 1); assert.equal(env.canvas.width, 1);
});

test('stopped encoding discards its output and closes decoded bitmap', async t => {
  const env = mockCanvas(t), controller = new AbortController(); controller.abort();
  await assert.rejects(encodeWatermark(jpeg(), defaults, null, controller.signal), { name: 'AbortError' });
  assert.equal(env.state().closed, 1); assert.equal(env.canvas.width, 1);
});

test('rendering a missing logo fails clearly while restoring canvas state', t => {
  const env = mockCanvas(t);
  assert.throws(() => paintWatermark(env.context, {}, { width: 1200, height: 800 }, { ...defaults, type: 'logo' }, null), /Logo/);
  assert.equal(env.state().saves, 0);
});

test('unsupported files and oversized PNG/Logo dimensions reject before image decoding', async t => {
  const env = mockCanvas(t);
  await assert.rejects(decodeWatermarkImage(new File(['not an image'], 'fake.png')), /有效的静态/);
  const header = new Uint8Array(24); header.set([137, 80, 78, 71]); const view = new DataView(header.buffer); view.setUint32(16, 4097); view.setUint32(20, 1);
  await assert.rejects(decodeWatermarkImage(new File([header], 'big-logo.png'), true), /4096/);
  assert.equal(env.state().closed, 0); assert.equal(env.state().orientation, undefined);
});
