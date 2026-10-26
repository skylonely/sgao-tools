import test from 'node:test';
import assert from 'node:assert/strict';
import { collageLayout, fitCollageImage, validateCollage, checkCollageFile, reorderCollage, collageFilename, COLLAGE_LIMITS } from '../src/lib/collage.js';
import { encodeCollage, paintCollagePart, decodeCollageImage } from '../src/collage-engine.js';

const defaults = { mode: 'grid', base: 1200, columns: 2, ratio: 1, fit: 'contain', gap: 12, padding: 16, background: 'color', color: '#ffffff', format: 'image/png', quality: 92, name: 'sgao-collage' };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const images = [{ width: 400, height: 200 }, { width: 200, height: 400 }];

test('vertical and horizontal stitching preserve ratios, unify dimensions and include exact gaps/padding', () => {
  const vertical = collageLayout(images, { ...defaults, mode: 'vertical', base: 1000, padding: 10, gap: 20 });
  assert.deepEqual([vertical.width, vertical.height], [1000, 2490]);
  assert.deepEqual(vertical.placements.map(item => item.target), [{ x: 10, y: 10, width: 980, height: 490 }, { x: 10, y: 520, width: 980, height: 1960 }]);
  const horizontal = collageLayout(images, { ...defaults, mode: 'horizontal', base: 1000, padding: 10, gap: 20 });
  assert.deepEqual([horizontal.width, horizontal.height], [2490, 1000]);
  assert.deepEqual(horizontal.placements.map(item => item.target), [{ x: 10, y: 10, width: 1960, height: 980 }, { x: 1990, y: 10, width: 490, height: 980 }]);
});

test('grids retain selected columns and an incomplete final row with accurate cell ratio', () => {
  const result = collageLayout(Array.from({ length: 5 }, () => images[0]), { ...defaults, columns: 3, ratio: 4 / 3, fit: 'cover', base: 1000, padding: 20, gap: 10 });
  assert.deepEqual([result.width, result.height], [1000, 520]);
  const cells = result.placements.map(item => item.target);
  near(cells[0].x, 20); near(cells[1].x - cells[0].x - cells[0].width, 10); near(cells[3].y, 265);
  assert.equal(cells[3].x, cells[0].x); near(cells[0].width / cells[0].height, 4 / 3);
  assert.equal(collageLayout([images[0]], defaults).placements.length, 1);
});

test('contain keeps complete source pixels while cover crops the source at its center', () => {
  const cell = { x: 10, y: 20, width: 200, height: 200 }, image = { width: 400, height: 200 };
  assert.deepEqual(fitCollageImage(image, cell), { source: { x: 0, y: 0, width: 400, height: 200 }, target: { x: 10, y: 70, width: 200, height: 100 } });
  assert.deepEqual(fitCollageImage(image, cell, 'cover'), { source: { x: 100, y: 0, width: 200, height: 200 }, target: cell });
});

test('large grids and very long images scale inside both output bounds without clipping', () => {
  const squares = Array.from({ length: 20 }, () => ({ width: 4000, height: 4000 }));
  const grid = collageLayout(squares, { ...defaults, base: 10000, columns: 5, padding: 0, gap: 0 });
  assert.ok(grid.scaled); assert.ok(grid.width * grid.height <= COLLAGE_LIMITS.pixels); assert.ok(grid.width <= 10000 && grid.height <= 10000);
  for (const item of grid.placements) { assert.ok(item.target.x + item.target.width <= grid.width + 1e-7); assert.ok(item.target.y + item.target.height <= grid.height + 1e-7); }
  const long = collageLayout(Array.from({ length: 20 }, () => ({ width: 1, height: 10000 })), { ...defaults, mode: 'vertical', base: 10000, padding: 0, gap: 0 });
  assert.deepEqual([long.width, long.height], [1, 10000]); assert.ok(long.scaled);
});

test('upscale indicators reflect the final rendered size after automatic shrinking', () => {
  assert.equal(collageLayout([{ width: 100, height: 100 }], { ...defaults, mode: 'vertical' }).upscaled, true);
  assert.equal(collageLayout([{ width: 4000, height: 4000 }], defaults).upscaled, false);
});

test('randomized mixed-ratio layouts keep source crops and target rectangles bounded and undistorted', () => {
  let seed = 734;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let iteration = 0; iteration < 500; iteration++) {
    const source = Array.from({ length: 1 + Math.floor(random() * 20) }, () => { const width = 1 + Math.floor(random() * 9999); return { width, height: 1 + Math.floor(random() * Math.min(9999, Math.floor(32_000_000 / width) - 1)) }; });
    const padding = Math.floor(random() * 100), gap = Math.floor(random() * 100);
    const result = collageLayout(source, { ...defaults, mode: ['vertical', 'horizontal', 'grid'][iteration % 3], fit: iteration % 2 ? 'cover' : 'contain', ratio: [1, 4 / 3, 3 / 4, 16 / 9, 9 / 16][iteration % 5], columns: 2 + iteration % 4, base: 600 + padding * 2 + gap * 4 + Math.floor(random() * 6000), padding, gap });
    assert.ok(result.width >= 1 && result.height >= 1 && result.width <= 10000 && result.height <= 10000 && result.width * result.height <= 32_000_000);
    result.placements.forEach(({ source: crop, target }, index) => {
      assert.ok(crop.x >= -1e-7 && crop.y >= -1e-7 && crop.x + crop.width <= source[index].width + 1e-7 && crop.y + crop.height <= source[index].height + 1e-7);
      assert.ok(target.x >= 0 && target.y >= 0 && target.x + target.width <= result.width + 1e-7 && target.y + target.height <= result.height + 1e-7);
      near(crop.width / crop.height, target.width / target.height);
    });
  }
});

test('invalid controls, empty/oversized queues and exhausted grid space produce actionable errors', () => {
  for (const change of [{ mode: 'unknown' }, { fit: 'stretch' }, { base: NaN }, { base: 63 }, { columns: 6 }, { ratio: 2 }, { gap: -1 }, { padding: 301 }, { background: 'url(x)' }, { format: 'image/avif' }, { color: 'red' }, { quality: 0 }, { name: '' }, { name: 'x'.repeat(81) }]) assert.throws(() => validateCollage({ ...defaults, ...change }));
  assert.throws(() => validateCollage({ ...defaults, base: 64, padding: 40 }), /外边距/);
  assert.throws(() => validateCollage({ ...defaults, base: 200, padding: 0, gap: 100, columns: 5 }), /网格宽度不足/);
  for (const source of [[], Array(21).fill(images[0]), [{ width: 10001, height: 1 }], [{ width: 8000, height: 5000 }]]) assert.throws(() => collageLayout(source, defaults));
  assert.doesNotThrow(() => checkCollageFile({ size: 20 * 1024 ** 2 }, 19, 80 * 1024 ** 2));
  for (const args of [[{ size: 0 }, 0, 0], [{ size: 1 }, 20, 0], [{ size: 1 }, 0, 100 * 1024 ** 2], [{ size: 20 * 1024 ** 2 + 1 }, 0, 0]]) assert.throws(() => checkCollageFile(...args));
});

test('reordering preserves every original item, supports first/last moves and never mutates the source', () => {
  const original = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const moved = reorderCollage(original, 0, 3); assert.deepEqual(moved.map(item => item.id), [2, 3, 4, 1]); assert.equal(moved[3], original[0]);
  assert.deepEqual(reorderCollage(moved, 3, 0), original); assert.deepEqual(original.map(item => item.id), [1, 2, 3, 4]);
  for (const position of [-1, 4, NaN, .5]) assert.throws(() => reorderCollage(original, 0, position));
});

test('thumbnail preview source rectangles map to the same original crop as full-resolution export', () => {
  const calls = [], thumbnail = { width: 960, height: 480 };
  paintCollagePart({ drawImage: (...args) => calls.push(args) }, thumbnail, { width: 4000, height: 2000 }, { source: { x: 1000, y: 500, width: 2000, height: 1000 }, target: { x: 10, y: 20, width: 400, height: 200 } });
  assert.deepEqual(calls[0], [thumbnail, 240, 120, 480, 240, 10, 20, 400, 200]);
});

test('download names retain Unicode, remove path/control characters and use the actual encoding suffix', () => {
  assert.equal(collageFilename('中文拼图.PNG', 'image/webp'), '中文拼图.webp');
  assert.equal(collageFilename('../a\u0000/b', 'image/jpeg'), '-a--b.jpg');
  assert.equal(collageFilename('  ...  ', 'image/png'), 'sgao-collage.png');
  assert.throws(() => collageFilename('x', 'image/avif'));
});

function mockEnvironment(t, returnedMime = null) {
  const originals = Object.fromEntries(['document', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let live = 0, peak = 0, decoded = 0, encodedSize, orientation, filled = 0;
  const context = { clearRect() {}, fillRect() { filled++; }, drawImage() {} };
  const canvas = { width: 0, height: 0, getContext() { return context; }, toBlob(callback, mime) { encodedSize = [this.width, this.height]; callback(new Blob(['encoded'], { type: returnedMime || mime })); } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (file, options) => { decoded++; live++; peak = Math.max(peak, live); orientation = options; const size = file.name === 'a.jpg' ? images[0] : images[1]; return { ...size, close() { live--; } }; } });
  t.after(() => { for (const key of Object.keys(originals)) { if (originals[key]) Object.defineProperty(globalThis, key, originals[key]); else delete globalThis[key]; } });
  return { canvas, state: () => ({ live, peak, decoded, encodedSize, orientation, filled }) };
}
const inputs = () => images.map((size, index) => ({ ...size, file: new File([new Uint8Array([255, 216, 255])], index ? 'b.jpg' : 'a.jpg', { type: 'image/jpeg' }) }));

test('export decodes one source at a time, preserves layout dimensions and releases all bitmaps/canvas', async t => {
  const env = mockEnvironment(t), result = await encodeCollage(inputs(), { ...defaults, mode: 'vertical', base: 1000, padding: 10, gap: 20 });
  assert.deepEqual([result.width, result.height, result.blob.type], [1000, 2490, 'image/png']);
  assert.deepEqual(env.state().encodedSize, [1000, 2490]); assert.equal(env.state().decoded, 2); assert.equal(env.state().peak, 1); assert.equal(env.state().live, 0);
  assert.equal(env.state().orientation.imageOrientation, 'from-image'); assert.equal(env.canvas.width, 1); assert.equal(env.canvas.height, 1);
});

test('transparent PNG stays unfilled, while JPG always receives a solid background', async t => {
  const env = mockEnvironment(t);
  await encodeCollage(inputs(), { ...defaults, background: 'transparent' }); assert.equal(env.state().filled, 0);
  await encodeCollage(inputs(), { ...defaults, background: 'transparent', format: 'image/jpeg' }); assert.equal(env.state().filled, 1);
});

test('stopping between sources discards the incomplete image and releases decoded resources', async t => {
  const env = mockEnvironment(t), controller = new AbortController();
  await assert.rejects(encodeCollage(inputs(), defaults, { signal: controller.signal, onProgress(done) { if (done === 1) controller.abort(); } }), { name: 'AbortError' });
  assert.equal(env.state().decoded, 1); assert.equal(env.state().live, 0); assert.equal(env.state().encodedSize, undefined); assert.equal(env.canvas.width, 1);
});

test('unsupported WebP encoder fallback cannot masquerade as a WebP result', async t => {
  const env = mockEnvironment(t, 'image/png');
  await assert.rejects(encodeCollage(inputs(), { ...defaults, format: 'image/webp' }), /无法导出/);
  assert.equal(env.state().live, 0); assert.equal(env.canvas.width, 1);
});

test('invalid files and oversized source headers reject before allocating an image bitmap', async t => {
  const env = mockEnvironment(t);
  await assert.rejects(decodeCollageImage(new File(['fake'], 'fake.png')), /有效的静态/);
  const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71]); const view = new DataView(bytes.buffer); view.setUint32(16, 10001); view.setUint32(20, 1);
  await assert.rejects(decodeCollageImage(new File([bytes], 'too-wide.png')), /10000/); assert.equal(env.state().decoded, 0);
});
