import { decodeLocalImage, createImagePreview } from './local-image.js';
import { checkWatermarkFile, checkWatermarkDimensions, validateWatermark, WATERMARK_FONTS, watermarkLayout, tileWatermarks, watermarkMime } from './lib/watermark.js';

export async function decodeWatermarkImage(file, logo = false) {
  checkWatermarkFile(file, 0, 0, logo);
  return decodeLocalImage(file, (width, height) => checkWatermarkDimensions(width, height, logo));
}
export const watermarkThumbnail = createImagePreview;

export function measureWatermark(ctx, size, options, logo) {
  const short = Math.min(size.width, size.height);
  if (options.type === 'logo') {
    if (!logo) throw new Error('请选择一张 Logo 图片。');
    const width = short * options.logoSize / 100;
    return { width, height: width * logo.height / logo.width };
  }
  const fontSize = short * options.textSize / 100, font = `${options.bold ? 700 : 400} ${fontSize}px ${WATERMARK_FONTS[options.font]}`;
  ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const lines = options.text.split('\n'), metrics = lines.map(line => ctx.measureText(line));
  const left = Math.max(0, ...metrics.map(metric => metric.actualBoundingBoxLeft || 0));
  const right = Math.max(1, ...metrics.map(metric => Math.max(metric.width, metric.actualBoundingBoxRight || 0)));
  const ascent = Math.max(fontSize * .8, ...metrics.map(metric => metric.actualBoundingBoxAscent || 0)), descent = Math.max(fontSize * .2, ...metrics.map(metric => metric.actualBoundingBoxDescent || 0));
  const lineHeight = Math.max(fontSize * 1.3, ascent + descent), padding = fontSize * .08;
  return { width: left + right + padding * 2, height: ascent + descent + lineHeight * (lines.length - 1) + padding * 2, left, ascent, padding, lineHeight, lines, font };
}

export function paintWatermark(ctx, source, size, rawOptions, logo, original = false, mime = 'image/png') {
  const options = validateWatermark(rawOptions);
  ctx.save();
  try {
    ctx.clearRect(0, 0, size.width, size.height);
    if (mime === 'image/jpeg') { ctx.fillStyle = options.background; ctx.fillRect(0, 0, size.width, size.height); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(source, 0, 0, size.width, size.height);
    if (original) return null;
    const mark = measureWatermark(ctx, size, options, logo), layout = watermarkLayout(size, mark, options);
    const tiles = options.mode === 'tile' ? tileWatermarks(size, layout, options.gap) : { centers: [layout.center], adjusted: false };
    ctx.globalAlpha = options.opacity / 100;
    for (const center of tiles.centers) {
      ctx.save();
      try {
        ctx.translate(center.x, center.y); ctx.rotate(layout.angle); ctx.scale(layout.scale, layout.scale);
        if (options.type === 'logo') ctx.drawImage(logo, -mark.width / 2, -mark.height / 2, mark.width, mark.height);
        else {
          ctx.font = mark.font; ctx.fillStyle = options.color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          mark.lines.forEach((line, index) => ctx.fillText(line, -mark.width / 2 + mark.padding + mark.left, -mark.height / 2 + mark.padding + mark.ascent + index * mark.lineHeight));
        }
      } finally { ctx.restore(); }
    }
    return { ...layout, adjusted: tiles.adjusted };
  } finally { ctx.restore(); }
}

export async function encodeWatermark(file, rawOptions, logo, signal) {
  const options = validateWatermark(rawOptions), { image, mime: sourceMime } = await decodeWatermarkImage(file);
  const canvas = document.createElement('canvas');
  try {
    if (signal?.aborted) throw new DOMException('处理已停止', 'AbortError');
    const mime = watermarkMime(options.format, sourceMime); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('当前浏览器无法创建导出画布。');
    paintWatermark(ctx, image, image, options, logo, false, mime);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, options.quality / 100));
    if (signal?.aborted) throw new DOMException('处理已停止', 'AbortError');
    if (!blob || blob.type !== mime) throw new Error('当前浏览器无法导出所选格式，请改用 PNG 或 JPG。');
    return { blob, mime, width: image.width, height: image.height };
  } finally { image.close(); canvas.width = canvas.height = 1; }
}
