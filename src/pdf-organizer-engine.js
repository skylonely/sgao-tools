import { PDFDocument, PDFName, PDFArray, degrees } from './vendor/pdf-lib.esm.min.js';
import { checkPDFInput } from './lib/pdf-images.js';
import { ORGANIZER_LIMITS, checkOrganizerFiles, organizerPlan } from './lib/pdf-organizer.js';

export async function loadOrganizerPDF(file) {
  checkPDFInput(file); checkPDFInput(file, new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
  let doc;
  try { doc = await PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { updateMetadata: false, throwOnInvalidObject: true }); }
  catch (cause) { throw new Error(/encrypt/i.test(cause.message) ? '暂不支持加密 PDF，请先在可信的 PDF 阅读器中解除加密并另存。' : 'PDF 已损坏或结构不受支持，请重新导出普通 PDF 后再试。'); }
  if (doc.isEncrypted) throw new Error('暂不支持加密 PDF，请先解除加密并另存。');
  if (doc.catalog.has(PDFName.of('AcroForm')) || doc.catalog.has(PDFName.of('Perms'))) throw new Error('暂不支持交互表单或数字签名 PDF，请使用不含表单和签名的普通副本。');
  const count = doc.getPageCount();
  if (!count || count > ORGANIZER_LIMITS.pages) throw new Error('单份文档及本批源页面合计最多 200 页。');
  for (const page of doc.getPages()) {
    const { width, height } = page.getCropBox(), rotation = page.getRotation().angle;
    if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 10_000_000) || !Number.isInteger(rotation / 90)) throw new Error('PDF 页面尺寸或旋转信息无效，请重新导出普通 PDF。');
    const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annotations?.asArray?.().some(ref => { const annotation = doc.context.lookup(ref); return annotation?.get?.(PDFName.of('Subtype')) === PDFName.of('Widget') || annotation?.get?.(PDFName.of('FT')) === PDFName.of('Sig'); })) throw new Error('暂不支持含表单控件或数字签名的 PDF，请使用普通副本。');
  }
  return doc;
}
export async function inspectOrganizerPDF(file) {
  const doc = await loadOrganizerPDF(file);
  return { count: doc.getPageCount() };
}
export async function assembleOrganizerPDF(sources, pages, options, { onProgress = () => {}, onResult = () => {} } = {}) {
  checkOrganizerFiles(sources.map(source => source.file));
  if (new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('文档来源重复，请重新添加。');
  const plan = organizerPlan(pages, options), docs = new Map(); let sourcePages = 0, resultBytes = 0, done = 0;
  const total = plan.reduce((sum, group) => sum + group.pages.length, 0);
  for (const source of sources) {
    onProgress(0, total, `正在读取 ${source.file.name}`);
    const doc = await loadOrganizerPDF(source.file); sourcePages += doc.getPageCount();
    if (sourcePages > ORGANIZER_LIMITS.pages) throw new Error('源文档合计最多 200 页，请移除部分文档。');
    docs.set(source.id, doc);
  }
  for (const group of plan) {
    const output = await PDFDocument.create(); output.setCreator('SGAO 工具箱'); output.setProducer('SGAO / pdf-lib');
    // Copy each source's requested pages together: fonts and images are shared within an output.
    const copied = new Map();
    for (const source of new Set(group.pages.map(page => page.source))) {
      const doc = docs.get(source), requested = group.pages.filter(page => page.source === source);
      if (!doc || requested.some(page => page.page > doc.getPageCount())) throw new Error('页码与源文档不一致，请重新添加文件。');
      const copies = await output.copyPages(doc, requested.map(page => page.page - 1));
      requested.forEach((page, i) => copied.set(page.id, copies[i]));
    }
    for (const item of group.pages) {
      const page = copied.get(item.id), rotation = ((page.getRotation().angle + item.rotation) % 360 + 360) % 360;
      page.setRotation(degrees(rotation)); output.addPage(page);
      onProgress(++done, total, `正在整理第 ${done} / ${total} 页`);
    }
    const bytes = await output.save({ objectsPerTick: 20 });
    if (bytes.byteLength > ORGANIZER_LIMITS.fileBytes) throw new Error('当前结果超过单份 50 MB，请减少页数或拆成多份 PDF。');
    if (resultBytes + bytes.byteLength > ORGANIZER_LIMITS.resultBytes) throw new Error('本批结果超过 150 MB，已保留完成的文件，请分批导出。');
    resultBytes += bytes.byteLength;
    await onResult({ name: group.name, count: group.pages.length, indices: group.indices, blob: new Blob([bytes], { type: 'application/pdf' }) });
  }
}
