import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkPDFInput, PDF_IMAGE_LIMITS, selectedPDFPages, validatePDFImages, pdfImageSize, pdfImageFilename } from '../src/lib/pdf-images.js';
import { openLocalPDF, renderPDFImage, convertPDFPages, pdfLoadError } from '../src/pdf-images-engine.js';
import { staticHeaders } from '../scripts/headers.mjs';

const defaults = { mode: 'dpi', dpi: 150, edge: 2560, format: 'image/png', quality: 92, background: 'color', color: '#ffffff' };
const pdfFile = () => new File(['%PDF-1.7\nfixture'], '测试.pdf', { type: 'application/pdf' });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('page selection handles ranges, Unicode separators, duplicates and document order', () => {
  assert.deepEqual(selectedPDFPages('8, 3，1-4、7,3', 10), [1, 2, 3, 4, 7, 8]);
  assert.deepEqual(selectedPDFPages(' 2 - 4 ', 4), [2, 3, 4]);
  assert.deepEqual(selectedPDFPages('', 3, true), [1, 2, 3]);
  assert.equal(selectedPDFPages('', 200, true).length, 200);
  for (const text of ['', '1,,2', '0', '4-1', '1-11', '11', '-1', '1.5', '1e2', '1-', '1;2', '1'.repeat(501)]) assert.throws(() => selectedPDFPages(text, 10));
  for (const count of [0, 201, 2.5, NaN]) assert.throws(() => selectedPDFPages('1', count));
});

test('DPI, longest-edge sizing and inherent page orientation produce bounded full-page images', () => {
  const standard = pdfImageSize(612, 792, { ...defaults, dpi: 72 }); assert.deepEqual([standard.width, standard.height], [612, 792]); near(standard.dpi, 72); assert.equal(standard.limited, false);
  const print = pdfImageSize(612, 792, { ...defaults, dpi: 300 }); assert.deepEqual([print.width, print.height], [2550, 3300]); near(print.dpi, 300);
  const landscape = pdfImageSize(792, 612, { ...defaults, mode: 'edge', edge: 1600 }); assert.deepEqual([landscape.width, landscape.height], [1600, 1236]);
  assert.ok(landscape.scale * 792 <= landscape.width + 1e-7 && landscape.scale * 612 <= landscape.height + 1e-7);
  const poster = pdfImageSize(20000, 15000, { ...defaults, dpi: 300 }); assert.equal(poster.limited, true); assert.ok(poster.width <= 8192 && poster.height <= 8192 && poster.width * poster.height <= 32_000_000);
});

test('500 mixed page sizes obey canvas limits without clipping the PDF viewport', () => {
  let seed = 1459; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 500; i++) {
    const width = 1 + random() * 99999, height = 1 + random() * 99999, result = pdfImageSize(width, height, { ...defaults, dpi: [72, 150, 300][i % 3], mode: i % 2 ? 'dpi' : 'edge', edge: 64 + Math.floor(random() * (8192 - 64)) });
    assert.ok(result.width >= 1 && result.height >= 1 && result.width <= 8192 && result.height <= 8192 && result.width * result.height <= PDF_IMAGE_LIMITS.pixels);
    assert.ok(width * result.scale <= result.width + 1e-7 && height * result.scale <= result.height + 1e-7);
  }
});

test('input, settings and filenames enforce documented bounds and actual output format', () => {
  checkPDFInput(pdfFile(), new TextEncoder().encode('preamble\n%PDF-1.7'));
  for (const file of [{ size: 0 }, { size: PDF_IMAGE_LIMITS.fileBytes + 1 }, undefined]) assert.throws(() => checkPDFInput(file));
  assert.throws(() => checkPDFInput(pdfFile(), new TextEncoder().encode('<html>not PDF</html>')));
  for (const change of [{ mode: 'custom' }, { dpi: 0 }, { dpi: 96 }, ...[63, 8193, 200.5, NaN].map(edge => ({ mode: 'edge', edge })), { format: 'image/svg+xml' }, { background: 'url(x)' }, { color: 'red' }, { quality: 39 }, { quality: 101 }]) assert.throws(() => validatePDFImages({ ...defaults, ...change }));
  assert.doesNotThrow(() => validatePDFImages({ ...defaults, edge: NaN }));
  assert.doesNotThrow(() => validatePDFImages({ ...defaults, mode: 'edge', dpi: NaN }));
  assert.equal(pdfImageFilename('../中文文档.PDF', 7, 'image/jpeg'), '-中文文档-page-007.jpg');
  assert.equal(pdfImageFilename('..\u202e/file.pdf', 200, 'image/webp'), '--file-page-200.webp');
  assert.throws(() => pdfImageFilename('x', 201, 'image/png')); assert.throws(() => pdfImageFilename('x', 1, 'image/avif'));
});

function fakePDF({ pages = 3, xfa = false, loadError } = {}) {
  let params, destroyed = 0;
  const doc = { numPages: pages, getPage: async number => ({ pageNumber: number }), getMetadata: async () => ({ info: { IsXFAPresent: xfa, IsAcroFormPresent: false } }) };
  const task = { promise: loadError ? Promise.reject(loadError) : Promise.resolve(doc), destroy: async () => { destroyed++; } };
  const pdfjs = { VerbosityLevel: { ERRORS: 0 }, getDocument(value) { params = value; return task; } };
  return { pdfjs, doc, task, state: () => ({ params, destroyed }) };
}

test('PDF opening passes bytes only and uses same-site resource URLs with local password callback', async () => {
  const env = fakePDF(), password = () => {}, tasks = [];
  const session = await openLocalPDF(pdfFile(), { pdfjs: env.pdfjs, onPassword: password, onTask: task => tasks.push(task) });
  assert.equal(session.numPages, 3); assert.deepEqual(await session.getPage(2), { pageNumber: 2 }); await session.destroy(); assert.equal(env.state().destroyed, 1);
  const { params } = env.state(); assert.ok(params.data instanceof Uint8Array); assert.equal('url' in params, false); assert.equal(params.enableXfa, false); assert.equal(params.disableFontFace, true); assert.equal(params.stopAtErrors, true); assert.equal(env.task.onPassword, password); assert.deepEqual(tasks, [env.task]);
  assert.ok(params.cMapUrl.endsWith('/vendor/pdfjs/cmaps/')); assert.ok(params.wasmUrl.endsWith('/vendor/pdfjs/wasm/')); assert.equal('password' in params, false);
});

test('oversized page counts, pure XFA and parse failures destroy loading tasks', async () => {
  for (const options of [{ pages: 201 }, { xfa: true }, { loadError: new Error('parse failure') }]) {
    const env = fakePDF(options); await assert.rejects(openLocalPDF(pdfFile(), { pdfjs: env.pdfjs })); assert.equal(env.state().destroyed, 1);
  }
  await assert.rejects(openLocalPDF({ size: PDF_IMAGE_LIMITS.fileBytes + 1, slice() { throw new Error('should not read'); } }), /50 MB/);
  assert.match(pdfLoadError({ name: 'InvalidPDFException' }), /损坏/); assert.match(pdfLoadError({ name: 'PasswordException' }), /密码/);
});

function fakeCanvas(t, { mime, onRender } = {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document'), canvases = [], renderCalls = []; let cleanup = 0, canceled = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() { const canvas = { width: 0, height: 0, getContext: () => ({}), toBlob(callback, type) { canvas.encoded = [canvas.width, canvas.height]; callback(new Blob(['image'], { type: mime || type })); } }; canvases.push(canvas); return canvas; } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document; });
  const page = { getViewport({ scale }) { return { width: 612 * scale, height: 792 * scale }; }, render(options) { renderCalls.push(options); let reject; const promise = onRender ? new Promise((resolve, no) => { reject = no; onRender(resolve); }) : Promise.resolve(); return { promise, cancel() { canceled++; reject?.(Object.assign(new Error('canceled'), { name: 'RenderingCancelledException' })); } }; }, cleanup() { cleanup++; } };
  return { doc: { getPage: async () => page }, page, canvases, renderCalls, pdfjs: { AnnotationMode: { ENABLE: 1 } }, state: () => ({ cleanup, canceled }) };
}

test('full-page rendering encodes real MIME, uses annotation appearances, and releases the page/canvas', async t => {
  const env = fakeCanvas(t), result = await renderPDFImage(env.doc, 1, { ...defaults, dpi: 300 }, { pdfjs: env.pdfjs });
  assert.deepEqual([result.width, result.height, result.blob.type], [2550, 3300, 'image/png']); assert.deepEqual(env.canvases[0].encoded, [2550, 3300]); assert.equal(env.renderCalls[0].background, '#ffffff'); assert.equal(env.renderCalls[0].annotationMode, 1); assert.equal(env.canvases[0].width, 1); assert.equal(env.state().cleanup, 1);
});

test('preview is bounded separately, transparent PNG stays clear, JPG receives chosen color', async t => {
  const env = fakeCanvas(t);
  const preview = await renderPDFImage(env.doc, 1, { ...defaults, dpi: 300, background: 'transparent' }, { preview: true, pdfjs: env.pdfjs }); assert.equal(Math.max(preview.width, preview.height), 1000); assert.equal(preview.blob.type, 'image/png'); assert.equal(env.renderCalls[0].background, 'rgba(0,0,0,0)');
  await renderPDFImage(env.doc, 1, { ...defaults, background: 'transparent', format: 'image/jpeg', color: '#aabbcc' }, { pdfjs: env.pdfjs }); assert.equal(env.renderCalls[1].background, '#aabbcc');
});

test('render cancellation and format fallback reject without retaining canvases', async t => {
  const controller = new AbortController(), env = fakeCanvas(t, { onRender() { setTimeout(() => controller.abort(), 0); } });
  await assert.rejects(renderPDFImage(env.doc, 1, defaults, { pdfjs: env.pdfjs, signal: controller.signal }), { name: 'AbortError' }); assert.equal(env.state().canceled, 1); assert.equal(env.state().cleanup, 1); assert.equal(env.canvases[0].width, 1);
});

test('encoder fallbacks cannot be downloaded with the wrong filename extension', async t => {
  const env = fakeCanvas(t, { mime: 'image/png' }); await assert.rejects(renderPDFImage(env.doc, 1, { ...defaults, format: 'image/webp' }, { pdfjs: env.pdfjs }), /无法导出/); assert.equal(env.canvases[0].width, 1); assert.equal(env.state().cleanup, 1);
});

test('batch conversion is sequential and preserves completed results on stop or later failure', async () => {
  const done = [], controller = new AbortController(); let live = 0, peak = 0;
  const render = async (doc, page) => { live++; peak = Math.max(peak, live); await new Promise(resolve => setTimeout(resolve, 0)); live--; return { blob: new Blob(['page']), width: 10, height: 20 }; };
  await assert.rejects(convertPDFPages({ numPages: 3 }, [1, 2, 3], defaults, { render, signal: controller.signal, onResult(item) { done.push(item.page); if (done.length === 2) controller.abort(); } }), { name: 'AbortError' }); assert.deepEqual(done, [1, 2]); assert.equal(peak, 1);
  const retained = []; await assert.rejects(convertPDFPages({ numPages: 3 }, [1, 2, 3], defaults, { render: async (doc, page) => { if (page === 2) throw new Error('bad page'); return render(doc, page); }, onResult: item => retained.push(item.page) }), /bad page/); assert.deepEqual(retained, [1]);
});

test('batch limits and accumulated output bounds reject before accepting an oversized result', async () => {
  for (const pages of [[], [0], [201], [1, 1], Array.from({ length: 51 }, (_, index) => index + 1)]) await assert.rejects(convertPDFPages({ numPages: 200 }, pages, defaults));
  const results = [];
  await assert.rejects(convertPDFPages({ numPages: 2 }, [1, 2], defaults, { render: async () => ({ blob: { size: 80 * 1024 ** 2 } }), onResult: item => results.push(item.page) }), /150 MB/); assert.deepEqual(results, [1]);
});

test('local headers keep page networking disabled while the dedicated parser can load its bundled resources', async () => {
  const source = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const page = staticHeaders(source, '/pdf-to-images/'), worker = staticHeaders(source, '/vendor/pdfjs/pdf.worker.min.mjs');
  assert.match(page['content-security-policy'], /connect-src 'none'/); assert.ok(!page['content-security-policy'].includes('wasm-unsafe-eval'));
  assert.match(worker['content-security-policy'], /connect-src 'self'/); assert.match(worker['content-security-policy'], /'wasm-unsafe-eval'/); assert.ok(!worker['content-security-policy'].includes('connect-src \'none\'')); assert.ok(!worker['content-security-policy'].includes(','));
  assert.equal(page['x-content-type-options'], 'nosniff'); assert.equal(worker['x-frame-options'], 'DENY');
});
