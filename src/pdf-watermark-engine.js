import { pushGraphicsState, popGraphicsState, concatTransformationMatrix } from './vendor/pdf-lib.esm.min.js';
import { loadOrganizerPDF } from './pdf-organizer-engine.js';
import { pdfWatermarkPlan, pdfOverlayMatrix, PDF_WATERMARK_LIMITS } from './lib/pdf-watermark.js';

export async function stampPDF(file, rawOptions, { onOverlay, onProgress = () => {} } = {}) {
  const doc = await loadOrganizerPDF(file), { options, plan, watermarkPages, numberPages } = pdfWatermarkPlan(doc.getPageCount(), rawOptions);
  if (typeof onOverlay !== 'function') throw new Error('缺少水印图层生成器。');
  let layerBytes = 0; const embedded = new Map();
  for (let index = 0; index < plan.length; index++) {
    const item = plan[index]; onProgress(index, plan.length, `正在处理第 ${item.page} 页`);
    const layer = await onOverlay(item), matrix = pdfOverlayMatrix(layer.view);
    if (!(layer.png instanceof Uint8Array) || !layer.png.byteLength) throw new Error('水印图层数据无效，请重新生成。');
    layerBytes += layer.png.byteLength;
    if (layerBytes > PDF_WATERMARK_LIMITS.overlayBytes) throw new Error('本次图层数据超过 100 MB，请减少平铺内容或分批处理。');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', layer.png)), value => value.toString(16).padStart(2, '0')).join('');
    let image = embedded.get(hash); if (!image) { image = await doc.embedPng(layer.png); embedded.set(hash, image); }
    const page = doc.getPage(item.page - 1);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
    page.drawImage(image, { x: 0, y: 0, width: 1, height: 1 });
    page.pushOperators(popGraphicsState());
    onProgress(index + 1, plan.length, `已添加 ${index + 1} / ${plan.length} 页`);
  }
  onProgress(plan.length, plan.length, '正在保存 PDF…');
  const bytes = await doc.save({ objectsPerTick: 20 });
  if (bytes.byteLength > PDF_WATERMARK_LIMITS.fileBytes) throw new Error('导出结果超过 50 MB，请减少平铺内容或先拆分文档。');
  return { blob: new Blob([bytes], { type: 'application/pdf' }), name: `${options.name}-watermarked.pdf`, count: doc.getPageCount(), watermarkPages, numberPages };
}
