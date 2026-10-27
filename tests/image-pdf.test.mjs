import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from '../src/vendor/pdf-lib.esm.min.js';
import { MM, PDF_LIMITS, checkPDFFile, checkPDFDimensions, imagePDFPage, validateImagePDF, pdfFilename } from '../src/lib/image-pdf.js';
import { createPDFAssembler } from '../src/pdf-assembler.js';
import { encodeImagePDF } from '../src/image-pdf-engine.js';
import { runPDFTask } from '../src/pdf-task.js';

const defaults = { paper: 'a4', orientation: 'portrait', fit: 'contain', margin: 10, background: '#ffffff', encoding: 'lossless', quality: 90, maxEdge: 0, name: '中文资料' };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function png(color = [255, 0, 0]) {
  const chunk = (name, data) => {
    const type = Buffer.from(name), bytes = Buffer.concat([type, data]); let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    const length = Buffer.alloc(4), sum = Buffer.alloc(4); length.writeUInt32BE(data.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([length, bytes, sum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, ...color, ...color, 0, ...color, ...color]))), chunk('IEND', Buffer.alloc(0))]);
}

test('A4 / Letter paper use exact point dimensions, orientation and millimeter margins', () => {
  const page = imagePDFPage({ width: 400, height: 200 }, defaults);
  near(page.width, 210 * MM); near(page.height, 297 * MM); near(page.target.x, 10 * MM); near(page.target.width / page.target.height, 2);
  near(page.target.y * 2 + page.target.height, page.height);
  const letter = imagePDFPage({ width: 400, height: 200 }, { ...defaults, paper: 'letter', orientation: 'auto' });
  assert.deepEqual([letter.width, letter.height], [792, 612]);
  assert.deepEqual([imagePDFPage({ width: 200, height: 400 }, { ...defaults, paper: 'letter', orientation: 'auto' }).width, imagePDFPage({ width: 200, height: 400 }, { ...defaults, paper: 'letter', orientation: 'landscape' }).width], [612, 792]);
});

test('image-proportional pages use 96 pixels per inch and add physical margins without cropping', () => {
  const page = imagePDFPage({ width: 960, height: 1920 }, { ...defaults, paper: 'image', orientation: 'landscape', fit: 'cover', margin: 0 });
  assert.deepEqual([page.width, page.height], [720, 1440]); assert.equal(page.cropped, false);
  assert.deepEqual(page.target, { x: 0, y: 0, width: 720, height: 1440 });
  const margin = imagePDFPage({ width: 960, height: 1920 }, { ...defaults, paper: 'image' });
  near(margin.width, 720 + 20 * MM); near(margin.target.x, 10 * MM);
});

test('cover crops at center inside margins and export downsampling never upscales images', () => {
  const image = { width: 4000, height: 2000 }, page = imagePDFPage(image, { ...defaults, fit: 'cover', maxEdge: 1600 });
  assert.ok(page.cropped); near(page.crop.x, (image.width - page.crop.width) / 2); near(page.crop.y, 0); near(page.target.x, 10 * MM); near(page.target.y, 10 * MM);
  assert.ok(Math.max(page.raster.width, page.raster.height) <= 1600);
  assert.deepEqual(imagePDFPage({ width: 100, height: 200 }, { ...defaults, maxEdge: 1200 }).raster, { width: 100, height: 200 });
});

test('500 randomized aspect ratios remain bounded, centered and undistorted', () => {
  let seed = 88; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 500; i++) {
    const width = 1 + Math.floor(random() * 9999), height = 1 + Math.floor(random() * Math.min(9999, 32_000_000 / width - 1)), image = { width, height };
    const page = imagePDFPage(image, { ...defaults, paper: ['a4', 'letter', 'image'][i % 3], orientation: ['auto', 'portrait', 'landscape'][i % 3], fit: i % 2 ? 'contain' : 'cover', margin: i % 41 });
    const { crop, target } = page;
    assert.ok(crop.x >= -1e-7 && crop.y >= -1e-7 && crop.x + crop.width <= width + 1e-7 && crop.y + crop.height <= height + 1e-7);
    assert.ok(target.x >= page.margin - 1e-7 && target.y >= page.margin - 1e-7 && target.x + target.width <= page.width - page.margin + 1e-7 && target.y + target.height <= page.height - page.margin + 1e-7);
    near(crop.width / crop.height, target.width / target.height); assert.ok(page.width < 14400 && page.height < 14400);
  }
});

test('invalid settings and source/file limits fail before export', () => {
  for (const change of [{ paper: 'custom' }, { orientation: 'x' }, { fit: 'stretch' }, { encoding: 'svg' }, { margin: NaN }, { margin: -1 }, { margin: 41 }, { margin: .5 }, { quality: 39 }, { quality: 101 }, { maxEdge: 1 }, { background: 'red' }, { name: '' }, { name: 'x'.repeat(81) }]) assert.throws(() => validateImagePDF({ ...defaults, ...change }));
  for (const pair of [[0, 1], [10001, 1], [8000, 5000], [1.5, 2]]) assert.throws(() => checkPDFDimensions(...pair));
  assert.doesNotThrow(() => checkPDFDimensions(8000, 4000));
  assert.doesNotThrow(() => checkPDFFile({ size: PDF_LIMITS.fileBytes }, 19, 80 * 1024 ** 2));
  for (const args of [[{ size: 0 }, 0, 0], [{ size: 1 }, 20, 0], [{ size: 1 }, 0, PDF_LIMITS.totalBytes], [{ size: PDF_LIMITS.fileBytes + 1 }, 0, 0]]) assert.throws(() => checkPDFFile(...args));
  assert.equal(pdfFilename('../中文资料.PDF'), '-中文资料.pdf'); assert.equal(pdfFilename('...'), 'sgao-images.pdf'); assert.equal(pdfFilename('a\u202e/b'), 'a--b.pdf');
});

test('real PDFs reopen with exact page count, Unicode title and mixed page sizes in supplied order', async () => {
  const writer = await createPDFAssembler(defaults);
  await writer.add(png(), 'image/png', imagePDFPage({ width: 400, height: 200 }, { ...defaults, paper: 'letter', orientation: 'landscape' }));
  await writer.add(png([0, 0, 255]), 'image/png', imagePDFPage({ width: 200, height: 400 }, defaults));
  const blob = await writer.finish(); assert.equal(blob.type, 'application/pdf');
  const doc = await PDFDocument.load(await blob.arrayBuffer()); assert.equal(doc.getPageCount(), 2); assert.equal(doc.getTitle(), defaults.name);
  assert.deepEqual(doc.getPage(0).getSize(), { width: 792, height: 612 }); near(doc.getPage(1).getWidth(), 210 * MM); near(doc.getPage(1).getHeight(), 297 * MM);
  assert.equal(doc.catalog.has(doc.context.obj('OpenAction')), false); assert.equal(doc.getForm().getFields().length, 0);
});

test('empty, oversized and unknown raster encodings cannot produce downloadable PDFs', async () => {
  await assert.rejects((await createPDFAssembler(defaults)).finish(), /添加图片/);
  const writer = await createPDFAssembler(defaults), page = imagePDFPage({ width: 2, height: 2 }, defaults);
  await assert.rejects(writer.add(png(), 'image/webp', page), /编码无效/);
  const bounded = await createPDFAssembler(defaults);
  await assert.rejects(bounded.add({ byteLength: PDF_LIMITS.outputBytes + 1 }, 'image/png', page), /超过 100 MB/);
});

function environment(t, { wrongMime = false } = {}) {
  const original = Object.fromEntries(['document', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let live = 0, peak = 0, filled = 0; const canvases = [], orientations = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() { const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() { filled++; }, drawImage() {} }), toBlob(callback, type) { callback(new Blob([png()], { type: wrongMime ? 'image/webp' : type })); } }; canvases.push(canvas); return canvas; } } });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (file, options) => { live++; peak = Math.max(peak, live); if (file instanceof File) orientations.push(options.imageOrientation); return { width: 2, height: 2, close() { live--; } }; } });
  t.after(() => { for (const key of Object.keys(original)) { if (original[key]) Object.defineProperty(globalThis, key, original[key]); else delete globalThis[key]; } });
  return { canvases, state: () => ({ live, peak, filled, orientations }) };
}
const inputs = () => [0, 1].map(index => ({ width: 2, height: 2, file: new File([png(index ? [0, 0, 255] : [255, 0, 0])], `${index}.png`, { type: 'image/png' }) }));

test('export processes sources sequentially, flattens transparency, returns encoded page thumbnails and releases resources', async t => {
  const env = environment(t), pages = [], progress = [];
  const blob = await encodeImagePDF(inputs(), defaults, { onPage: page => pages.push(page), onProgress: done => progress.push(done) });
  assert.equal((await PDFDocument.load(await blob.arrayBuffer())).getPageCount(), 2); assert.deepEqual(pages.map(page => page.index), [0, 1]); assert.deepEqual(progress, [0, 1, 2]);
  assert.ok(pages.every(page => page.preview.type === 'image/png')); assert.deepEqual(env.state(), { live: 0, peak: 1, filled: 2, orientations: ['from-image', 'from-image'] }); assert.ok(env.canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test('stop between pages discards partial PDF and closes all bitmaps', async t => {
  const env = environment(t), controller = new AbortController();
  await assert.rejects(encodeImagePDF(inputs(), defaults, { signal: controller.signal, onProgress(done) { if (done === 1) controller.abort(); } }), { name: 'AbortError' });
  assert.equal(env.state().live, 0); assert.ok(env.canvases.every(canvas => canvas.width === 1));
});

test('encoding fallback and changed decoded dimensions are rejected with resources released', async t => {
  const env = environment(t, { wrongMime: true }); await assert.rejects(encodeImagePDF(inputs(), defaults), /无法编码/); assert.equal(env.state().live, 0);
  await assert.rejects(encodeImagePDF([{ ...inputs()[0], width: 3 }], defaults), /尺寸发生变化/); assert.equal(env.state().live, 0);
});

test('worker cancellation terminates it immediately; errors and successful output also clean up', async t => {
  const original = Object.fromEntries(['Worker', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])); const workers = [];
  class FakeWorker { constructor() { workers.push(this); } terminate() { this.terminated = true; } postMessage(data) { this.input = data; } }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker }); Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {} });
  t.after(() => { for (const key of Object.keys(original)) { if (original[key]) Object.defineProperty(globalThis, key, original[key]); else delete globalThis[key]; } });
  const controller = new AbortController(), task = runPDFTask(inputs(), defaults, { signal: controller.signal, onProgress() {}, onPage() {} }); controller.abort(); await assert.rejects(task, { name: 'AbortError' }); assert.ok(workers[0].terminated);
  const success = runPDFTask(inputs(), defaults, { onProgress() {}, onPage() {} }), blob = new Blob(['%PDF']); workers[1].onmessage({ data: { type: 'result', blob } }); assert.equal(await success, blob); assert.ok(workers[1].terminated); assert.ok(!('preview' in workers[1].input.items[0]));
  const failure = runPDFTask(inputs(), defaults, { onProgress() {}, onPage() {} }); workers[2].onmessage({ data: { type: 'error', message: '测试错误' } }); await assert.rejects(failure, /测试错误/); assert.ok(workers[2].terminated);
});
