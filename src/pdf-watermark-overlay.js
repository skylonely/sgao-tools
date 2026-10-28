import { measureWatermark, decodeWatermarkImage } from './watermark-engine.js';
import { watermarkLayout, tileWatermarks } from './lib/watermark.js';
import { pdfOverlaySize, validatePDFWatermark } from './lib/pdf-watermark.js';

export async function preparePDFLogo(file) {
  if (!file) return null;
  const { image } = await decodeWatermarkImage(file, true); return image;
}
function drawMark(ctx, view, options, mark, logo) {
  const layout = watermarkLayout(view, mark, options), tiled = options.mode === 'tile' ? tileWatermarks(view, layout, options.gap) : { centers: [layout.center], adjusted: false };
  ctx.save();
  try {
    ctx.globalAlpha = options.opacity / 100;
    for (const center of tiled.centers) {
      ctx.save(); ctx.translate(center.x, center.y); ctx.rotate(layout.angle); ctx.scale(layout.scale, layout.scale);
      if (options.type === 'logo') ctx.drawImage(logo, -mark.width / 2, -mark.height / 2, mark.width, mark.height);
      else {
        ctx.font = mark.font; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = options.color;
        mark.lines.forEach((line, i) => ctx.fillText(line, -mark.width / 2 + mark.padding + mark.left, -mark.height / 2 + mark.padding + mark.ascent + i * mark.lineHeight));
      }
      ctx.restore();
    }
  } finally { ctx.restore(); }
  return tiled.adjusted;
}
export function paintPDFOverlay(ctx, view, rawOptions, item, logo = null) {
  const options = validatePDFWatermark(rawOptions); let adjusted = false;
  ctx.save();
  try {
    ctx.clearRect(0, 0, view.width, view.height); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (item.watermark) {
      if (options.watermark.type === 'logo' && !logo) throw new Error('请选择一张 Logo 图片。');
      const mark = measureWatermark(ctx, view, options.watermark, logo);
      adjusted = drawMark(ctx, view, options.watermark, mark, logo);
    }
    if (item.label) {
      const number = options.numbering, short = Math.min(view.width, view.height), margin = Math.min(number.margin * 72 / 25.4, Math.max(0, (short - 1) / 2));
      const config = { type: 'text', text: item.label, font: 'sans', bold: false, textSize: number.size / short * 100, opacity: number.opacity, color: number.color, mode: 'single', angle: 0, anchor: number.anchor, margin: margin / short * 100 };
      drawMark(ctx, view, config, measureWatermark(ctx, view, config), null);
    }
  } finally { ctx.restore(); }
  return { adjusted };
}
export async function createPDFOverlay(view, options, item, logo, { preview = false, signal, makeCanvas = () => document.createElement('canvas') } = {}) {
  const check = () => { if (signal?.aborted) throw new DOMException('处理已停止', 'AbortError'); };
  check(); const canvas = makeCanvas(), size = pdfOverlaySize(view, preview); canvas.width = size.width; canvas.height = size.height;
  try {
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('当前浏览器无法创建水印图层，请换用新版浏览器。');
    ctx.scale(size.width / view.width, size.height / view.height); const info = paintPDFOverlay(ctx, view, options, item, logo);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); check();
    if (!blob || blob.type !== 'image/png') throw new Error('水印图层编码失败，请减少文字或降低平铺密度后重试。');
    return { blob, view, ...info };
  } finally { canvas.width = canvas.height = 1; }
}
