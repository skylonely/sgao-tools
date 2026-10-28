import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, StandardFonts, degrees } from '../src/vendor/pdf-lib.esm.min.js';
import { pdfWatermarkPlan, validatePDFWatermark, pdfOverlayMatrix, pdfOverlaySize, PDF_WATERMARK_LIMITS } from '../src/lib/pdf-watermark.js';
import { paintPDFOverlay, createPDFOverlay } from '../src/pdf-watermark-overlay.js';
import { stampPDF } from '../src/pdf-watermark-engine.js';
import { runPDFWatermark } from '../src/pdf-watermark-task.js';
import { encodeIndexedPNG } from '../src/lib/image-compression.js';

const options = {
  pagesMode: 'all', range: '', name: '中文文档',
  watermark: { enabled: true, type: 'text', text: '仅供预览\nSGAO', font: 'sans', bold: true, textSize: 6, logoSize: 24, color: '#596575', opacity: 18, angle: -30, mode: 'single', anchor: 'mc', margin: 3, gap: 170, background: '#ffffff', format: 'image/png', quality: 100, x: 50, y: 50 },
  numbering: { enabled: true, format: 'fraction', anchor: 'bc', start: 1, skipCover: false, size: 12, margin: 10, color: '#343b46', opacity: 100 },
};
const copy = () => structuredClone(options);
const view = { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] };
const transform = (matrix, [x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
const near = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-6, `${actual} != ${expected}`));

test('numbering is continuous across selected pages and skipping the physical cover affects numbers only', () => {
  const raw = copy(); raw.pagesMode = 'range'; raw.range = '5,1,3,3'; raw.numbering.skipCover = true; raw.numbering.start = 5;
  const planned = pdfWatermarkPlan(6, raw);
  assert.deepEqual(planned.plan, [{ page: 1, watermark: true, label: null }, { page: 3, watermark: true, label: '5 / 6' }, { page: 5, watermark: true, label: '6 / 6' }]);
  assert.equal(planned.watermarkPages, 3); assert.equal(planned.numberPages, 2);
  raw.watermark.enabled = false; raw.numbering.format = 'chinese';
  assert.deepEqual(pdfWatermarkPlan(6, raw).plan.map(item => item.label), ['第 5 页', '第 6 页']);
  raw.range = '1'; assert.throws(() => pdfWatermarkPlan(6, raw), /封面/);
});
test('validation ignores inactive controls but rejects invalid active marks, numbering and ranges', () => {
  const raw = copy(); raw.watermark.enabled = raw.numbering.enabled = false; assert.throws(() => validatePDFWatermark(raw), /至少/);
  raw.watermark.enabled = true; raw.numbering.start = NaN; assert.doesNotThrow(() => validatePDFWatermark(raw));
  raw.watermark.type = 'logo'; raw.watermark.textSize = NaN; raw.watermark.mode = 'tile'; raw.watermark.margin = NaN; assert.doesNotThrow(() => validatePDFWatermark(raw));
  raw.watermark.logoSize = 0; assert.throws(() => validatePDFWatermark(raw));
  for (const override of [{ start: 0 }, { start: 1.5 }, { start: 1000000 }, { size: 7 }, { margin: 31 }, { anchor: 'mc' }, { color: 'red' }]) { const value = copy(); Object.assign(value.numbering, override); assert.throws(() => validatePDFWatermark(value)); }
  for (const range of ['0', '3-1', '201', '1,']) assert.throws(() => pdfWatermarkPlan(200, { ...options, pagesMode: 'range', range }));
  assert.equal(pdfWatermarkPlan(200, options).plan.length, 200);
  assert.throws(() => pdfWatermarkPlan(201, options));
});
test('normalized image corners map to the displayed page for each quarter rotation and crop origin', () => {
  const cases = [
    { width: 600, height: 800, transform: [1, 0, 0, -1, -20, 830] },
    { width: 1600, height: 1200, transform: [0, 2, 2, 0, -60, -40] },
    { width: 600, height: 800, transform: [-1, 0, 0, 1, 580, -30] },
    { width: 800, height: 600, transform: [0, -1, -1, 0, 830, 580] },
  ];
  for (const current of cases) {
    const matrix = pdfOverlayMatrix(current);
    for (const [image, expected] of [[[0, 1], [0, 0]], [[1, 1], [current.width, 0]], [[0, 0], [0, current.height]], [[1, 0], [current.width, current.height]]]) near(transform(current.transform, transform(matrix, image)), expected);
  }
});
test('random page sizes and scaled transforms retain bounded raster dimensions and correct alignment', () => {
  for (let i = 1; i <= 300; i++) {
    const width = 5 + i * 127.13, height = 10 + (i * 937 % 17000), unit = .5 + (i % 8), current = { width: width * unit, height: height * unit, transform: [unit, 0, 0, -unit, -130 * unit, 85 * unit] };
    const size = pdfOverlaySize(current), preview = pdfOverlaySize(current, true);
    assert.ok(size.width <= 4096 && size.height <= 4096 && size.width * size.height <= 8_000_000);
    assert.ok(preview.width <= 1000 && preview.height <= 1000 && preview.width * preview.height <= 1_000_000);
    near(transform(current.transform, transform(pdfOverlayMatrix(current), [.25, .75])), [current.width * .25, current.height * .25]);
  }
  assert.throws(() => pdfOverlayMatrix({ ...view, transform: [0, 0, 0, 0, 0, 0] }));
  assert.throws(() => pdfOverlaySize({ ...view, width: Infinity }));
});
function mockCanvas() {
  const text = [], rotations = [], alphas = [], images = [];
  const ctx = { font: '', save() {}, restore() {}, clearRect() {}, scale() {}, translate() {}, rotate(value) { rotations.push(value); }, measureText(line) { const size = Number(this.font.match(/([\d.]+)px/)?.[1] || 12); return { width: line.length * size * .6, actualBoundingBoxAscent: size * .8, actualBoundingBoxDescent: size * .2 }; }, fillText(value) { text.push(value); }, drawImage(...args) { images.push(args); }, set globalAlpha(value) { alphas.push(value); } };
  const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: callback => callback(new Blob(['png'], { type: 'image/png' })) };
  return { canvas, ctx, text, rotations, alphas, images };
}
test('overlay painting includes multiline Chinese, independent page numbers, rotation and opacity', () => {
  const mock = mockCanvas(); paintPDFOverlay(mock.ctx, view, options, { watermark: true, label: '第 5 页' });
  assert.deepEqual(mock.text, ['仅供预览', 'SGAO', '第 5 页']);
  assert.deepEqual(mock.alphas, [.18, 1]); assert.ok(mock.rotations.some(value => value < 0)); assert.equal(mock.rotations.at(-1), 0);
  const raw = copy(); raw.watermark.type = 'logo'; assert.throws(() => paintPDFOverlay(mock.ctx, view, raw, { watermark: true, label: null }), /Logo/);
  const logo = { width: 600, height: 240 }; paintPDFOverlay(mock.ctx, view, raw, { watermark: true, label: null }, logo); assert.equal(mock.images.at(-1)[0], logo);
});
test('transparent overlay encoding cleans the canvas after success, encoder failure and cancellation', async () => {
  let mock = mockCanvas(); const result = await createPDFOverlay(view, options, { watermark: true, label: null }, null, { makeCanvas: () => mock.canvas });
  assert.equal(result.blob.type, 'image/png'); assert.equal(mock.canvas.width, 1); assert.equal(mock.canvas.height, 1);
  mock = mockCanvas(); mock.canvas.toBlob = callback => callback(null); await assert.rejects(() => createPDFOverlay(view, options, { watermark: true }, null, { makeCanvas: () => mock.canvas }), /编码失败/); assert.equal(mock.canvas.width, 1);
  mock = mockCanvas(); const abort = new AbortController(); mock.canvas.toBlob = callback => { abort.abort(); callback(new Blob(['png'], { type: 'image/png' })); };
  await assert.rejects(() => createPDFOverlay(view, options, { watermark: true }, null, { signal: abort.signal, makeCanvas: () => mock.canvas }), { name: 'AbortError' }); assert.equal(mock.canvas.width, 1);
});
async function fixture() {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) { const page = doc.addPage([600, 800]); page.drawText(`ORIGINAL ${i + 1}`, { x: 50, y: 700, font }); }
  doc.getPage(2).setCropBox(20, 30, 500, 700); doc.getPage(2).setRotation(degrees(90)); doc.getPage(2).node.set(PDFName.of('UserUnit'), doc.context.obj(2));
  doc.setTitle('Original title');
  return new File([await doc.save()], 'original.pdf', { type: 'application/pdf' });
}
const layerBlob = await encodeIndexedPNG(new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]), 2, 2, 2);
const layerPNG = new Uint8Array(await layerBlob.arrayBuffer());
test('stamping preserves every page, rotation, boxes, units and title while only selected pages get an image', async () => {
  const file = await fixture(), originalBytes = await file.arrayBuffer(), raw = copy(); raw.pagesMode = 'range'; raw.range = '1,3'; const called = [];
  const result = await stampPDF(file, raw, { onOverlay: async item => { called.push(item); return { png: layerPNG, view: item.page === 3 ? { width: 1400, height: 1000, transform: [0, 2, 2, 0, -60, -40] } : view }; } });
  assert.equal(result.name, '中文文档-watermarked.pdf'); assert.equal(result.count, 3); assert.deepEqual(called.map(item => item.page), [1, 3]); assert.deepEqual(called.map(item => item.label), ['1 / 2', '2 / 2']);
  const output = await PDFDocument.load(await result.blob.arrayBuffer()), original = await PDFDocument.load(originalBytes);
  assert.equal(output.getTitle(), 'Original title');
  const refs = [];
  output.getPages().forEach((page, i) => {
    assert.deepEqual(page.getMediaBox(), original.getPage(i).getMediaBox()); assert.deepEqual(page.getCropBox(), original.getPage(i).getCropBox()); assert.equal(page.getRotation().angle, original.getPage(i).getRotation().angle);
    const images = page.node.Resources().lookupMaybe(PDFName.of('XObject'), PDFDict); if (i === 1) assert.equal(images?.keys().length || 0, 0); else refs.push(...images.values().map(ref => ref.toString()));
  });
  assert.equal(output.getPage(2).node.lookup(PDFName.of('UserUnit')).asNumber(), 2);
  assert.equal(new Set(refs).size, 1, 'identical overlays must share one embedded image');
  assert.deepEqual(await file.arrayBuffer(), originalBytes);
});
test('overlay failures, singular geometry and oversized layer data reject without emitting a partial PDF', async () => {
  const file = await fixture();
  await assert.rejects(() => stampPDF(file, options, { onOverlay: async () => { throw new DOMException('stop', 'AbortError'); } }), { name: 'AbortError' });
  await assert.rejects(() => stampPDF(file, options, { onOverlay: async () => ({ png: layerPNG, view: { ...view, transform: [0, 0, 0, 0, 0, 0] } }) }), /变换/);
  const oversized = new Uint8Array([1]); Object.defineProperty(oversized, 'byteLength', { value: PDF_WATERMARK_LIMITS.overlayBytes + 1 });
  await assert.rejects(() => stampPDF(file, options, { onOverlay: async () => ({ png: oversized, view }) }), /100 MB/);
});
test('watermark-only and number-only jobs leave unrelated pages intact and report the right counts', async () => {
  const file = await fixture(), raw = copy(); raw.watermark.enabled = false; raw.numbering.skipCover = true;
  let requests = []; const onOverlay = async item => { requests.push(item); return { png: layerPNG, view }; };
  let result = await stampPDF(file, raw, { onOverlay }); assert.equal(result.watermarkPages, 0); assert.equal(result.numberPages, 2); assert.deepEqual(requests.map(item => item.page), [2, 3]);
  raw.watermark.enabled = true; raw.numbering.enabled = false; requests = []; result = await stampPDF(file, raw, { onOverlay }); assert.equal(result.watermarkPages, 3); assert.equal(result.numberPages, 0); assert.ok(requests.every(item => item.label === null));
});
test('worker requests one layer at a time, forwards progress and terminates after its result', async () => {
  const originalWorker = globalThis.Worker; let terminated = 0, requests = 0, progress;
  globalThis.Worker = class {
    postMessage(data) { queueMicrotask(() => { if (data.type === 'start') { this.onmessage({ data: { type: 'progress', done: 1, total: 2, text: 'working' } }); this.onmessage({ data: { type: 'overlay', id: 7, item: { page: 1 } } }); } else { assert.equal(data.id, 7); this.onmessage({ data: { type: 'result', result: { count: 2 } } }); } }); }
    terminate() { terminated++; }
  };
  try { const result = await runPDFWatermark(null, {}, { onOverlay: async () => { requests++; return {}; }, onProgress: (...args) => { progress = args; } }); assert.equal(result.count, 2); assert.equal(requests, 1); assert.equal(terminated, 1); assert.deepEqual(progress, [1, 2, 'working']); }
  finally { globalThis.Worker = originalWorker; }
});
test('cancellation drops a late layer reply and rejects before creating another worker when already aborted', async () => {
  const originalWorker = globalThis.Worker, abort = new AbortController(); let complete, sent = 0, terminated = 0;
  globalThis.Worker = class { postMessage() { sent++; queueMicrotask(() => this.onmessage({ data: { type: 'overlay', id: 1, item: {} } })); } terminate() { terminated++; } };
  try {
    const task = runPDFWatermark(null, {}, { signal: abort.signal, onOverlay: () => new Promise(resolve => { complete = resolve; abort.abort(); }) });
    await assert.rejects(task, { name: 'AbortError' }); complete({}); await new Promise(resolve => setImmediate(resolve)); assert.equal(sent, 1); assert.equal(terminated, 1);
    await assert.rejects(() => runPDFWatermark(null, {}, { signal: abort.signal }), { name: 'AbortError' }); assert.equal(sent, 1);
  } finally { globalThis.Worker = originalWorker; }
});
