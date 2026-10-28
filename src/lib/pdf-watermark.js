import { selectedPDFPages, pdfImageStem } from './pdf-images.js';
import { validateWatermark } from './watermark.js';

export const PDF_WATERMARK_LIMITS = Object.freeze({ fileBytes: 50 * 1024 ** 2, pages: 200, overlayBytes: 100 * 1024 ** 2, overlayEdge: 4096, overlayPixels: 8_000_000 });
const bounded = (value, min, max, label) => { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}需在 ${min}–${max} 之间。`); };
export function validatePDFWatermark(raw) {
  const options = { ...raw, watermark: { ...raw.watermark }, numbering: { ...raw.numbering } };
  if (!['all', 'range'].includes(options.pagesMode)) throw new Error('请选择全部页面或指定页码。');
  if (typeof options.watermark.enabled !== 'boolean' || typeof options.numbering.enabled !== 'boolean' || !options.watermark.enabled && !options.numbering.enabled) throw new Error('请至少启用水印或页码中的一项。');
  if (options.watermark.enabled) {
    const mark = options.watermark;
    options.watermark = { ...validateWatermark({ ...mark, textSize: mark.type === 'logo' ? 6 : mark.textSize, logoSize: mark.type === 'text' ? 24 : mark.logoSize, margin: mark.mode === 'tile' ? 3 : mark.margin, gap: mark.mode === 'single' ? 170 : mark.gap }), enabled: true };
  }
  if (options.numbering.enabled) {
    const number = options.numbering;
    if (!['plain', 'fraction', 'chinese'].includes(number.format) || !['tl', 'tc', 'tr', 'bl', 'bc', 'br'].includes(number.anchor) || typeof number.skipCover !== 'boolean' || !/^#[\da-f]{6}$/i.test(number.color)) throw new Error('页码格式、位置或颜色无效。');
    if (!Number.isInteger(number.start) || number.start < 1 || number.start > 999999) throw new Error('起始编号需为 1–999999 的整数。');
    bounded(number.size, 8, 36, '页码字号'); bounded(number.margin, 3, 30, '页码边距'); bounded(number.opacity, 10, 100, '页码不透明度');
  }
  options.name = pdfImageStem(options.name);
  return options;
}
export function pdfWatermarkPlan(count, rawOptions) {
  const options = validatePDFWatermark(rawOptions), selected = selectedPDFPages(options.range, count, options.pagesMode === 'all');
  const numbered = options.numbering.enabled ? selected.filter(page => !options.numbering.skipCover || page !== 1) : [], last = options.numbering.start + numbered.length - 1;
  const labels = new Map(numbered.map((page, index) => { const value = options.numbering.start + index; return [page, options.numbering.format === 'fraction' ? `${value} / ${last}` : options.numbering.format === 'chinese' ? `第 ${value} 页` : String(value)]; }));
  const plan = selected.map(page => ({ page, watermark: options.watermark.enabled, label: labels.get(page) || null })).filter(page => page.watermark || page.label);
  if (!plan.length) throw new Error('当前范围没有需要添加的内容；请更改范围或关闭「跳过封面」。');
  return { options, plan, watermarkPages: options.watermark.enabled ? selected.length : 0, numberPages: numbered.length, last };
}
export function checkPDFView(view) {
  if (!view || ![view.width, view.height].every(value => Number.isFinite(value) && value > 0 && value <= 10_000_000) || !Array.isArray(view.transform) || view.transform.length !== 6 || !view.transform.every(Number.isFinite)) throw new Error('PDF 页面几何信息无效，请重新导出普通 PDF。');
  const [a, b, c, d] = view.transform, determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new Error('PDF 页面变换无效。');
  return determinant;
}
// Map a normalized PDF image (origin at bottom left) through the inverse PDF.js viewport.
// This handles CropBox origins, /Rotate, negative coordinates and /UserUnit together.
export function pdfOverlayMatrix(view) {
  const determinant = checkPDFView(view), [a, b, c, d, e, f] = view.transform;
  const inverse = [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * f - d * e) / determinant, (b * e - a * f) / determinant];
  const matrix = [inverse[0] * view.width, inverse[1] * view.width, -inverse[2] * view.height, -inverse[3] * view.height, inverse[2] * view.height + inverse[4], inverse[3] * view.height + inverse[5]];
  if (!matrix.every(Number.isFinite)) throw new Error('PDF 页面变换超出可处理范围。');
  return matrix;
}
export function pdfOverlaySize(view, preview = false) {
  checkPDFView(view);
  const scale = Math.min(preview ? 1.5 : 4, (preview ? 1000 : PDF_WATERMARK_LIMITS.overlayEdge) / Math.max(view.width, view.height), Math.sqrt((preview ? 1_000_000 : PDF_WATERMARK_LIMITS.overlayPixels) / (view.width * view.height)));
  return { width: Math.max(1, Math.floor(view.width * scale)), height: Math.max(1, Math.floor(view.height * scale)) };
}
