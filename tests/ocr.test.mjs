import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { OCR_LIMITS, validateOCR, checkOCRDimensions, ocrDimensions, otsuThreshold, normalizeOCRResult, normalizeOCRText, ocrFilename, ocrTextBlob } from '../src/lib/ocr.js';
import { recognizeOCR } from '../src/ocr-task.js';
import { prepareOCR, decodeOCRImage } from '../src/ocr-engine.js';
import { staticHeaders } from '../scripts/headers.mjs';

const options = { language: 'chi_sim+eng', segmentation: '3', turns: 0, filter: 'original' };
test('OCR controls restrict model paths and processing modes to supported values', () => {
  assert.deepEqual(validateOCR(options), options);
  for (const change of [{ language: 'https://other.test/eng' }, { language: 'chi_tra' }, { segmentation: '13' }, { turns: -1 }, { turns: 1.5 }, { filter: 'external' }]) assert.throws(() => validateOCR({ ...options, ...change }));
  assert.throws(() => checkOCRDimensions(10001, 1)); assert.throws(() => checkOCRDimensions(8000, 5000)); assert.throws(() => checkOCRDimensions(0, 100));
});
test('rotation and bounded recognition sizes preserve proportions without upscaling', () => {
  assert.deepEqual(ocrDimensions(800, 400, { ...options, turns: 1 }), { width: 400, height: 800, scale: 1, reduced: false });
  for (let i = 1; i < 300; i++) {
    const w = 100 + (i * 377 % 8000), h = Math.min(Math.floor(32_000_000 / w), 20 + (i * 911 % 9000));
    for (const turns of [0, 1, 2, 3]) { const size = ocrDimensions(w, h, { ...options, turns }); assert.ok(size.width <= 4096 && size.height <= 4096 && size.width * size.height <= 8_000_000); assert.ok(size.scale > 0 && size.scale <= 1); assert.ok(size.width <= (turns % 2 ? h : w)); }
  }
});
test('automatic threshold separates foreground and background and handles uniform images', () => {
  const histogram = new Uint32Array(256); histogram[20] = 100; histogram[220] = 900;
  const threshold = otsuThreshold(histogram, 1000); assert.ok(threshold >= 20 && threshold < 220);
  histogram.fill(0); histogram[255] = 100; assert.equal(otsuThreshold(histogram, 100), 127);
});
test('result text preserves Unicode and plaintext while line boxes are clamped and bounded', () => {
  const line = { text: ' 中文 OCR ', confidence: 120, bbox: { x0: -3, y0: 1, x1: 300, y1: 50 } };
  const result = normalizeOCRResult({ text: '中文😀\r\n<script>plain</script>\0', confidence: 93.4, blocks: [{ paragraphs: [{ lines: [line, { ...line, bbox: { x0: NaN } }, { ...line, bbox: { x0: 5, y0: 5, x1: 1, y1: 1 } }] }] }] }, 200, 100);
  assert.equal(result.text, '中文😀\n<script>plain</script>'); assert.equal(result.confidence, 93.4); assert.equal(result.lines.length, 1); assert.equal(result.lines[0].text, '中文 OCR'); assert.equal(result.lines[0].x0, 0); assert.equal(result.lines[0].x1, 200); assert.equal(result.lines[0].confidence, 100);
  const many = normalizeOCRResult({ text: 'complete', blocks: [{ paragraphs: [{ lines: Array(1003).fill(line) }] }] }, 200, 100);
  assert.equal(many.lineCount, 1003); assert.equal(many.lines.length, 1000); assert.equal(many.text, 'complete');
  assert.equal(normalizeOCRResult({}, 200, 100).confidence, null); assert.throws(() => normalizeOCRText('x'.repeat(OCR_LIMITS.text + 1)), /100 万/);
});
test('TXT output retains current edited text, UTF-8 BOM and safe Unicode filenames', async () => {
  const text = '校对后的文字 😀\nSecond line'; const blob = ocrTextBlob(text), bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]); assert.equal(new TextDecoder().decode(bytes), text);
  assert.equal(ocrFilename('图片.PNG'), '图片-ocr.txt'); assert.ok(!/[\/\\\u202e]/.test(ocrFilename('../../账单\u202e.PNG'))); assert.equal(ocrFilename(''), 'sgao-image-ocr.txt');
});
function respond(worker, message, status, data) { worker.onmessage({ data: { jobId: message.jobId, action: message.action, status, data } }); }
test('pinned worker protocol uses same-site assets, no private input cache, and image bytes only at recognition', async () => {
  const sent = [], progress = []; let terminated = 0, workerURL;
  const factory = url => { workerURL = url; return { terminate() { terminated++; }, postMessage(message) { sent.push(message); queueMicrotask(() => { respond(this, message, 'progress', { progress: .8 }); respond(this, message, 'progress', { progress: .1 }); respond(this, message, 'resolve', message.action === 'recognize' ? { text: '本地 OCR', confidence: 91 } : {}); }); } }; };
  const image = new Uint8Array([1, 2, 3]), result = await recognizeOCR(image, { width: 100, height: 50 }, options, { workerFactory: factory, onProgress: value => progress.push(value) });
  assert.ok(workerURL.pathname.endsWith('/vendor/ocr/v7.0.0/worker.min.js')); assert.equal(result.text, '本地 OCR'); assert.equal(terminated, 1);
  assert.deepEqual(sent.map(message => message.action), ['load', 'loadLanguage', 'initialize', 'setParameters', 'recognize']);
  assert.ok(sent[0].payload.options.corePath.endsWith('/vendor/ocr/v7.0.0/core/')); assert.ok(sent[1].payload.options.langPath.endsWith('/vendor/ocr/v7.0.0/lang'));
  assert.equal(sent[1].payload.options.cacheMethod, 'none'); assert.deepEqual(sent[1].payload.langs, ['chi_sim', 'eng']); assert.equal(sent[2].payload.oem, 1);
  assert.equal(sent[4].payload.image, image); assert.equal(sent[4].payload.options.rotateAuto, false); assert.ok(sent[4].payload.output.blocks);
  assert.ok(sent.slice(0, 4).every(message => !('image' in message.payload))); assert.ok(progress.every((value, i) => i === 0 || value >= progress[i - 1])); assert.equal(progress.at(-1), 1);
});
test('stopping model initialization terminates immediately and ignores late responses', async () => {
  const abort = new AbortController(); let created = 0, terminated = 0, worker, request;
  const factory = () => { created++; worker = { postMessage(message) { request = message; }, terminate() { terminated++; } }; return worker; };
  const task = recognizeOCR(new Uint8Array([1]), { width: 1, height: 1 }, options, { workerFactory: factory, signal: abort.signal }); abort.abort();
  await assert.rejects(task, { name: 'AbortError' }); respond(worker, request, 'resolve', {}); assert.equal(terminated, 1); assert.equal(created, 1);
  await assert.rejects(recognizeOCR(new Uint8Array([1]), { width: 1, height: 1 }, options, { workerFactory: factory, signal: abort.signal }), { name: 'AbortError' }); assert.equal(created, 1);
});
test('model rejection and timeouts clean up the worker with actionable errors', async () => {
  let terminated = 0;
  const rejection = () => ({ postMessage(message) { queueMicrotask(() => respond(this, message, 'reject', 'missing model')); }, terminate() { terminated++; } });
  await assert.rejects(recognizeOCR(new Uint8Array([1]), { width: 1, height: 1 }, options, { workerFactory: rejection }), /模型/);
  await assert.rejects(recognizeOCR(new Uint8Array([1]), { width: 1, height: 1 }, options, { workerFactory: () => ({ postMessage() {}, terminate() { terminated++; } }), timeout: 5 }), /三分钟/);
  assert.equal(terminated, 2);
});
function mockCanvasEnvironment(width = 800, height = 600, pixelValues) {
  const old = { document: globalThis.document, createImageBitmap: globalThis.createImageBitmap }; let closed = 0, created = 0, written, finalSize;
  const ctx = { fillStyle: '', fillRect() {}, save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, drawImage() {}, getImageData() { return { data: new Uint8ClampedArray(pixelValues) }; }, putImageData(image) { written = image.data; } };
  const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob(callback) { finalSize = [this.width, this.height]; callback(new Blob(['png'], { type: 'image/png' })); } };
  globalThis.document = { createElement: () => canvas }; globalThis.createImageBitmap = async () => { created++; return { width, height, close() { closed++; } }; };
  return { canvas, get written() { return written; }, get finalSize() { return finalSize; }, get closed() { return closed; }, get created() { return created; }, restore() { for (const [key, value] of Object.entries(old)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } };
}
const imageFile = () => new File([new Uint8Array([255, 216, 255, 0])], 'source.jpg', { type: 'image/jpeg' });
test('preprocessing applies selected rotation and releases bitmap/canvas after encoding', async () => {
  const env = mockCanvasEnvironment();
  try { const result = await prepareOCR(imageFile(), { ...options, turns: 1 }); assert.deepEqual(env.finalSize, [600, 800]); assert.equal(result.width, 600); assert.equal(result.height, 800); assert.equal(result.originalWidth, 800); assert.equal(env.closed, 1); assert.equal(env.canvas.width, 1); }
  finally { env.restore(); }
});
test('binary preprocessing separates dark and light pixels without changing text geometry', async () => {
  const pixels = [0, 0, 0, 255, 50, 50, 50, 255, 200, 200, 200, 255, 255, 255, 255, 255], env = mockCanvasEnvironment(1, 4, pixels);
  try { const result = await prepareOCR(imageFile(), { ...options, filter: 'binary' }); assert.deepEqual([...env.written], [0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]); assert.equal(result.width, 1); assert.equal(result.height, 4); assert.equal(env.closed, 1); }
  finally { env.restore(); }
});
test('invalid size and late cancellation close resources and do not return an OCR image', async () => {
  let env = mockCanvasEnvironment(10001, 1);
  try { await assert.rejects(() => decodeOCRImage(imageFile()), /10000/); assert.equal(env.closed, 1); }
  finally { env.restore(); }
  env = mockCanvasEnvironment(); const abort = new AbortController(); env.canvas.toBlob = callback => { abort.abort(); callback(new Blob(['x'], { type: 'image/png' })); };
  try { await assert.rejects(() => prepareOCR(imageFile(), options, { signal: abort.signal }), { name: 'AbortError' }); assert.equal(env.closed, 1); assert.equal(env.canvas.width, 1); }
  finally { env.restore(); }
});
test('only OCR worker networking is enabled and pinned runtime/model files match their manifest', async () => {
  const source = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const page = staticHeaders(source, '/image-to-text/'), worker = staticHeaders(source, '/vendor/ocr/v7.0.0/worker.min.js');
  assert.ok(page['content-security-policy'].includes("connect-src 'none'")); assert.ok(!page['content-security-policy'].includes('wasm-unsafe-eval'));
  assert.ok(worker['content-security-policy'].includes("connect-src 'self'")); assert.ok(worker['content-security-policy'].includes("'wasm-unsafe-eval'")); assert.ok(!worker['content-security-policy'].includes("'unsafe-eval'")); assert.ok(!worker['content-security-policy'].includes(','));
  const base = new URL('../src/vendor/ocr/v7.0.0/', import.meta.url), manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  for (const file of manifest.files) { const bytes = await readFile(new URL(file.path, base)); assert.equal(bytes.length, file.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256); }
  for (const language of ['eng', 'chi_sim']) assert.ok(gunzipSync(await readFile(new URL(`lang/${language}.traineddata.gz`, base))).length > 1_000_000);
});
