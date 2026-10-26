import { decodeLocalImage } from './local-image.js';
import { collageLayout, COLLAGE_LIMITS } from './lib/collage.js';

export const decodeCollageImage = file => decodeLocalImage(file, (width, height) => {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= COLLAGE_LIMITS.edge) || width * height > COLLAGE_LIMITS.pixels) throw new Error('源图单边最高 10000 px，总像素最高 3200 万。');
});
export function paintCollagePart(ctx, image, original, placement) {
  const { source, target } = placement, xRatio = image.width / original.width, yRatio = image.height / original.height;
  ctx.drawImage(image, source.x * xRatio, source.y * yRatio, source.width * xRatio, source.height * yRatio, target.x, target.y, target.width, target.height);
}
export function fillCollage(ctx, layout, options) {
  ctx.clearRect(0, 0, layout.width, layout.height);
  if (options.background === 'color' || options.format === 'image/jpeg') { ctx.fillStyle = options.color; ctx.fillRect(0, 0, layout.width, layout.height); }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
}
export async function encodeCollage(items, options, { signal, onProgress = () => {} } = {}) {
  const layout = collageLayout(items, options), canvas = document.createElement('canvas');
  const check = () => { if (signal?.aborted) throw new DOMException('拼图生成已停止', 'AbortError'); };
  try {
    check(); canvas.width = layout.width; canvas.height = layout.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('当前浏览器无法创建导出画布，请减小目标尺寸后重试。');
    fillCollage(ctx, layout, options);
    for (let index = 0; index < items.length; index++) {
      check(); onProgress(index, items.length, `正在拼入第 ${index + 1} / ${items.length} 张…`);
      await new Promise(resolve => setTimeout(resolve, 0)); check();
      const { image } = await decodeCollageImage(items[index].file);
      try { check(); paintCollagePart(ctx, image, items[index], layout.placements[index]); } finally { image.close(); }
    }
    check(); onProgress(items.length, items.length, '正在编码拼图…');
    const blob = await new Promise(resolve => canvas.toBlob(resolve, options.format, options.quality / 100)); check();
    if (!blob || blob.type !== options.format) throw new Error('当前浏览器无法导出所选格式，请改用 PNG 或 JPG，或减小尺寸后重试。');
    return { blob, width: layout.width, height: layout.height };
  } finally { canvas.width = canvas.height = 1; }
}
