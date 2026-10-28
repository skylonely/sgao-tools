import { decodeLocalImage } from './local-image.js';
import { paintOriented } from './crop-engine.js';
import { OCR_LIMITS, checkOCRDimensions, ocrDimensions, validateOCR, otsuThreshold } from './lib/ocr.js';

export async function decodeOCRImage(file) {
  if (!file?.size || file.size > OCR_LIMITS.fileBytes) throw new Error('请选择非空静态图片，单张最高 20 MB。');
  const decoded = await decodeLocalImage(file, checkOCRDimensions);
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(decoded.mime)) { decoded.image.close(); throw new Error('OCR 首版支持静态 PNG、JPG 和 WebP，请先转换图片格式。'); }
  return decoded;
}
export async function ocrThumbnail(image) {
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height)), canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(image.width * scale)); canvas.height = Math.max(1, Math.floor(image.height * scale));
  try {
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法创建图片预览。');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('图片预览失败，请换一张图片后重试。'); return blob;
  } finally { canvas.width = canvas.height = 1; }
}
export async function prepareOCR(file, raw, { signal, onProgress = () => {} } = {}) {
  const options = validateOCR(raw), check = () => { if (signal?.aborted) throw new DOMException('识别已停止', 'AbortError'); };
  check(); onProgress('正在读取图片…'); const { image } = await decodeOCRImage(file); const canvas = document.createElement('canvas');
  try {
    check(); const size = ocrDimensions(image.width, image.height, options); canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: options.filter !== 'original' }); if (!ctx) throw new Error('无法创建识别画布，请缩小图片后重试。');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size.width, size.height); ctx.imageSmoothingQuality = 'high';
    ctx.save(); const w = options.turns % 2 ? image.height : image.width, h = options.turns % 2 ? image.width : image.height; ctx.scale(size.width / w, size.height / h); paintOriented(ctx, image, options.turns, false, false); ctx.restore();
    if (options.filter !== 'original') {
      onProgress('正在预处理文字画面…'); const pixels = ctx.getImageData(0, 0, size.width, size.height), histogram = new Uint32Array(256);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const gray = Math.round(pixels.data[i] * .299 + pixels.data[i + 1] * .587 + pixels.data[i + 2] * .114); histogram[gray]++;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
        if (i % 1_048_576 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(); }
      }
      const threshold = options.filter === 'binary' ? otsuThreshold(histogram, size.width * size.height) : null;
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = threshold === null ? Math.min(255, Math.max(0, Math.round((pixels.data[i] - 128) * 1.2 + 128))) : pixels.data[i] <= threshold ? 0 : 255;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
        if (i % 1_048_576 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(); }
      }
      ctx.putImageData(pixels, 0, 0);
    }
    check(); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); check();
    if (!blob || blob.type !== 'image/png') throw new Error('无法准备识别图片，请缩小图片后重试。');
    return { blob, ...size, originalWidth: image.width, originalHeight: image.height };
  } finally { image.close(); canvas.width = canvas.height = 1; }
}
