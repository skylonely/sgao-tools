import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, StandardFonts, degrees } from '../src/vendor/pdf-lib.esm.min.js';
import { checkOrganizerFiles, organizerPlan, moveOrganizerPage, ORGANIZER_LIMITS } from '../src/lib/pdf-organizer.js';
import { inspectOrganizerPDF, loadOrganizerPDF, assembleOrganizerPDF } from '../src/pdf-organizer-engine.js';
import { organizerTask } from '../src/pdf-organizer-task.js';

const pages = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, source: i < 3 ? 'a' : 'b', page: i % 3 + 1, rotation: 0 }));
const options = { mode: 'merge', ranges: '', name: '测试文件' };
async function fixture(name, count, customize = () => {}) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) { const page = doc.addPage([400 + i * 10, 600 + i * 10]); page.drawText(`${name}-${i + 1}`, { x: 20, y: 300, font }); }
  customize(doc);
  return new File([await doc.save()], `${name}.pdf`, { type: 'application/pdf' });
}
async function build(sources, items, rawOptions = options) {
  const results = [], progress = [];
  await assembleOrganizerPDF(sources, items, rawOptions, { onProgress: (...value) => progress.push(value), onResult: result => results.push(result) });
  return { results, progress };
}

test('range groups use edited positions, dedupe within a group and retain copies between groups', () => {
  const edited = moveOrganizerPage(pages, 5, 0);
  const plan = organizerPlan(edited, { ...options, mode: 'ranges', ranges: '3,1-2,2\n2，4-5;6' });
  assert.deepEqual(plan.map(group => group.indices), [[1, 2, 3], [2, 4, 5], [6]]);
  assert.deepEqual(plan[0].pages.map(page => page.id), ['p5', 'p0', 'p1']);
  assert.equal(plan[1].pages[0].id, plan[0].pages[1].id);
  plan[0].pages[0].rotation = 180; assert.equal(edited[0].rotation, 0);
  assert.equal(plan[0].name, '测试文件-part-001.pdf');
  assert.deepEqual(organizerPlan(edited, { ...options, mode: 'single' }).map(group => group.indices), [[1], [2], [3], [4], [5], [6]]);
});
test('invalid ranges and amplified output are rejected before generating documents', () => {
  for (const ranges of ['', '0', '1,', '7', '3-1', '1\n\n2', '1-2;', '1.5', '1-2000000']) assert.throws(() => organizerPlan(pages, { ...options, mode: 'ranges', ranges }));
  const many = Array.from({ length: 200 }, (_, i) => ({ id: String(i), source: 'a', page: i + 1, rotation: 0 }));
  assert.equal(organizerPlan(many, { ...options, mode: 'single' }).length, 200);
  assert.throws(() => organizerPlan(many, { ...options, mode: 'ranges', ranges: '1-200\n1' }), /200/);
  assert.throws(() => organizerPlan([], options));
  assert.throws(() => organizerPlan([{ ...pages[0], rotation: 45 }], options));
  assert.throws(() => organizerPlan([pages[0], pages[0]], options));
  assert.equal(organizerPlan(pages, { ...options, name: '../../bad\u202e.pdf' })[0].name, '-..-bad--merged.pdf');
});
test('input limits cover files, bytes and empty/non-PDF input', async () => {
  const small = { size: 1 };
  assert.throws(() => checkOrganizerFiles([]));
  assert.throws(() => checkOrganizerFiles(Array(11).fill(small)), /10/);
  assert.throws(() => checkOrganizerFiles([{ size: ORGANIZER_LIMITS.fileBytes + 1 }]), /50 MB/);
  assert.throws(() => checkOrganizerFiles(Array(3).fill({ size: ORGANIZER_LIMITS.fileBytes })), /100 MB/);
  assert.throws(() => checkOrganizerFiles([{ size: 0 }]));
  await assert.rejects(() => inspectOrganizerPDF(new File(['not a pdf'], 'fake.pdf')), /不是/);
});
test('merging copies the edited order and adds rotation without changing source bytes or page boxes', async () => {
  const a = await fixture('A', 3, doc => { const page = doc.getPage(1); page.setCropBox(20, 30, 330, 500); page.setRotation(degrees(90)); page.node.set(PDFName.of('UserUnit'), doc.context.obj(2)); }), b = await fixture('B', 3);
  const original = new Uint8Array(await a.arrayBuffer());
  const edited = [pages[4], { ...pages[1], rotation: 90 }, pages[0]];
  const { results, progress } = await build([{ id: 'a', file: a }, { id: 'b', file: b }], edited);
  assert.equal(results.length, 1); assert.equal(results[0].count, 3);
  const output = await PDFDocument.load(await results[0].blob.arrayBuffer());
  assert.deepEqual(output.getPages().map(page => page.getWidth()), [410, 410, 400]);
  assert.deepEqual(output.getPages().map(page => page.getRotation().angle), [0, 180, 0]);
  assert.deepEqual(output.getPage(1).getCropBox(), { x: 20, y: 30, width: 330, height: 500 });
  assert.equal(output.getPage(1).node.lookup(PDFName.of('UserUnit')).asNumber(), 2);
  assert.equal(output.getPage(1).getHeight(), 610);
  assert.ok(output.getPage(1).node.Contents());
  assert.deepEqual(new Uint8Array(await a.arrayBuffer()), original);
  assert.equal(progress.at(-1)[0], 3); assert.equal(progress.at(-1)[1], 3);
});
test('split and single-page exports are complete PDFs with the expected page grouping', async () => {
  const file = await fixture('A', 3), source = [{ id: 'a', file }], items = pages.slice(0, 3);
  const { results } = await build(source, items, { ...options, mode: 'ranges', ranges: '1,3\n2-3' });
  assert.deepEqual(results.map(result => result.count), [2, 2]);
  for (const result of results) assert.equal((await PDFDocument.load(await result.blob.arrayBuffer())).getPageCount(), 2);
  const singles = (await build(source, items, { ...options, mode: 'single' })).results;
  assert.equal(singles.length, 3);
  for (const [i, result] of singles.entries()) { const doc = await PDFDocument.load(await result.blob.arrayBuffer()); assert.equal(doc.getPageCount(), 1); assert.equal(doc.getPage(0).getWidth(), 400 + i * 10); }
});
test('embedded Chinese sample remains parseable after reordering and extraction', async () => {
  const file = new File([await readFile(new URL('../public/samples/pdf-to-images-demo.pdf', import.meta.url))], '中文示例.pdf', { type: 'application/pdf' });
  assert.deepEqual(await inspectOrganizerPDF(file), { count: 3 });
  const items = pages.slice(0, 3).reverse(), { results } = await build([{ id: 'a', file }], items);
  const doc = await loadOrganizerPDF(new File([results[0].blob], results[0].name)); assert.equal(doc.getPageCount(), 3);
  assert.ok(doc.getPage(0).getWidth() === doc.getPage(0).getHeight());
  assert.ok(doc.getPage(1).getWidth() > doc.getPage(1).getHeight());
});
test('forms, signatures, encryption and orphan widgets fail explicitly', async () => {
  const form = await fixture('form', 1, doc => { doc.getForm().createTextField('field').addToPage(doc.getPage(0)); });
  await assert.rejects(() => inspectOrganizerPDF(form), /表单/);
  const signed = await fixture('signed', 1, doc => doc.catalog.set(PDFName.of('Perms'), doc.context.obj({})));
  await assert.rejects(() => inspectOrganizerPDF(signed), /签名/);
  const orphan = await fixture('orphan', 1, doc => { const widget = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 100, 20] })); doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([widget])); });
  await assert.rejects(() => inspectOrganizerPDF(orphan), /表单/);
  const encrypted = await fixture('encrypted', 1, doc => { doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard' })); });
  await assert.rejects(() => inspectOrganizerPDF(encrypted), /加密/);
});
test('ordinary annotations load, while invalid source references and excess source pages fail', async () => {
  const file = await fixture('link', 1, doc => { const annotation = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 100, 20], A: { Type: 'Action', S: 'URI', URI: 'https://example.com' } })); doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([annotation])); });
  assert.equal((await inspectOrganizerPDF(file)).count, 1);
  await assert.rejects(() => build([{ id: 'a', file }], [{ ...pages[0], source: 'missing' }]), /不一致/);
  await assert.rejects(() => build([{ id: 'a', file }], [{ ...pages[0], page: 2 }]), /不一致/);
  await assert.rejects(() => build([{ id: 'a', file }, { id: 'a', file }], [pages[0]]), /重复/);
  const huge = await fixture('many', 201); await assert.rejects(() => inspectOrganizerPDF(huge), /200/);
});
test('worker cancellation terminates processing and leaves already delivered results with caller', async () => {
  const savedWorker = globalThis.Worker, kept = []; let terminated = 0;
  globalThis.Worker = class {
    postMessage() { queueMicrotask(() => this.onmessage({ data: { type: 'result', result: { name: 'done.pdf' } } })); }
    terminate() { terminated++; }
  };
  try {
    const abort = new AbortController();
    const task = organizerTask('build', {}, { signal: abort.signal, onResult: result => { kept.push(result); abort.abort(); } });
    await assert.rejects(task, { name: 'AbortError' }); assert.equal(kept.length, 1); assert.equal(terminated, 1);
    await assert.rejects(() => organizerTask('inspect', {}, { signal: abort.signal }), { name: 'AbortError' }); assert.equal(terminated, 1);
  } finally { globalThis.Worker = savedWorker; }
});
