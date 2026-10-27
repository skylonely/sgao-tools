export const PDF_IMAGE_LIMITS = Object.freeze({ fileBytes: 50 * 1024 ** 2, pages: 200, batch: 50, edge: 8192, pixels: 32_000_000, resultBytes: 150 * 1024 ** 2, transferBytes: 20 * 1024 ** 2 });
export function checkPDFInput(file, header) {
  if (!file?.size || file.size > PDF_IMAGE_LIMITS.fileBytes) throw new Error('请选择非空 PDF，单份最高 50 MB。');
  if (header) {
    // PDF headers may follow a short binary preamble; the parser verifies the document.
    const text = new TextDecoder('latin1').decode(header);
    if (!/%PDF-\d\.\d/.test(text)) throw new Error('文件内容不是可识别的 PDF，请检查后重新选择。');
  }
}
export function selectedPDFPages(text, count, all = false) {
  if (!Number.isInteger(count) || count < 1 || count > PDF_IMAGE_LIMITS.pages) throw new Error('PDF 最多支持 200 页。');
  if (all) return Array.from({ length: count }, (_, index) => index + 1);
  if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new Error('请填写页码，例如 1,3,5-8，最多 500 个字符。');
  const pages = new Set();
  for (const part of text.replace(/[，、]/g, ',').split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('页码格式无效，请使用 1,3,5-8 这样的格式。');
    const from = Number(match[1]), to = Number(match[2] || match[1]);
    if (from < 1 || to > count || from > to) throw new Error(`页码需在 1–${count} 之间，范围起始页不能大于结束页。`);
    for (let page = from; page <= to; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}
export function validatePDFImages(options) {
  if (!['dpi', 'edge'].includes(options.mode) || options.mode === 'dpi' && ![72, 150, 300].includes(options.dpi) || options.mode === 'edge' && (!Number.isInteger(options.edge) || options.edge < 64 || options.edge > 8192)) throw new Error('请选择有效的分辨率，或填写 64–8192 px 的整数最长边。');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(options.format) || !['color', 'transparent'].includes(options.background) || !/^#[\da-f]{6}$/i.test(options.color)) throw new Error('请选择有效的图片格式和背景。');
  if (!Number.isInteger(options.quality) || options.quality < 40 || options.quality > 100) throw new Error('图片质量需为 40–100 的整数。');
  return { ...options };
}
export function pdfImageSize(width, height, rawOptions) {
  const options = validatePDFImages(rawOptions);
  if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 10_000_000)) throw new Error('PDF 页面尺寸无效或过大。');
  const requestedScale = options.mode === 'dpi' ? options.dpi / 72 : options.edge / Math.max(width, height);
  const maxScale = Math.min(requestedScale, PDF_IMAGE_LIMITS.edge / width, PDF_IMAGE_LIMITS.edge / height, Math.sqrt(PDF_IMAGE_LIMITS.pixels / (width * height)));
  const outputWidth = Math.max(1, Math.floor(width * maxScale + 1e-7)), outputHeight = Math.max(1, Math.floor(height * maxScale + 1e-7));
  const scale = Math.min(outputWidth / width, outputHeight / height);
  return { width: outputWidth, height: outputHeight, scale, dpi: scale * 72, limited: maxScale < requestedScale - 1e-7 };
}
export function pdfImageStem(name) {
  return String(name || '').trim().replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80) || 'sgao-pdf';
}
export function pdfImageFilename(name, page, mime) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
  if (!extension || !Number.isInteger(page) || page < 1 || page > PDF_IMAGE_LIMITS.pages) throw new Error('导出页码或格式无效。');
  return `${pdfImageStem(name)}-page-${String(page).padStart(3, '0')}.${extension}`;
}
