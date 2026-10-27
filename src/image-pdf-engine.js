import { decodeLocalImage } from './local-image.js';
import { checkPDFFile, checkPDFDimensions, imagePDFPage, validateImagePDF } from './lib/image-pdf.js';
import { createPDFAssembler } from './pdf-assembler.js';

function canvasFor(width, height) {
  const canvas = typeof document === 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  canvas.width = width; canvas.height = height; return canvas;
}
const toBlob = (canvas, type, quality) => canvas.convertToBlob ? canvas.convertToBlob({ type, quality }) : new Promise(resolve => canvas.toBlob(resolve, type, quality));
export async function encodeImagePDF(items, rawOptions, { signal, onProgress = () => {}, onPage = () => {} } = {}) {
  const options = validateImagePDF(rawOptions), assembler = await createPDFAssembler(options);
  if (!items.length) throw new Error('请先选择图片。');
  let total = 0; items.forEach((item, index) => { checkPDFFile(item.file, index, total); total += item.file.size; });
  const check = () => { if (signal?.aborted) throw new DOMException('PDF 生成已停止', 'AbortError'); };
  for (let index = 0; index < items.length; index++) {
    check(); onProgress(index, items.length, `正在处理第 ${index + 1} / ${items.length} 页…`);
    await new Promise(resolve => setTimeout(resolve, 0)); check();
    const { image } = await decodeLocalImage(items[index].file, checkPDFDimensions);
    let canvas, blob, layout;
    try {
      check();
      if (image.width !== items[index].width || image.height !== items[index].height) throw new Error('图片尺寸发生变化，请重新选择文件。');
      layout = imagePDFPage(image, options); canvas = canvasFor(layout.raster.width, layout.raster.height);
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法创建图片画布，请降低最长边后重试。');
      ctx.fillStyle = options.background; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.imageSmoothingQuality = 'high';
      const crop = layout.crop; ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
      const mime = options.encoding === 'lossless' ? 'image/png' : 'image/jpeg';
      blob = await toBlob(canvas, mime, options.quality / 100); check();
      if (!blob || blob.type !== mime) throw new Error('浏览器无法编码图片，请改用另一种编码方式。');
    } finally { image.close(); if (canvas) canvas.width = canvas.height = 1; }
    await assembler.add(new Uint8Array(await blob.arrayBuffer()), blob.type, layout); check();
    const previewScale = Math.min(1, 960 / Math.max(layout.raster.width, layout.raster.height));
    let preview, small;
    try {
      preview = await createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(layout.raster.width * previewScale)), resizeHeight: Math.max(1, Math.round(layout.raster.height * previewScale)), resizeQuality: 'high' });
      small = canvasFor(preview.width, preview.height); small.getContext('2d').drawImage(preview, 0, 0);
      const thumbnail = await toBlob(small, 'image/png'); check();
      if (!thumbnail) throw new Error('页面预览生成失败，请降低最长边后重试。');
      await onPage({ index, preview: thumbnail, width: layout.raster.width, height: layout.raster.height });
    } finally { preview?.close(); if (small) small.width = small.height = 1; }
  }
  check(); onProgress(items.length, items.length, '正在整理 PDF 文件…');
  const blob = await assembler.finish(); check(); return blob;
}
