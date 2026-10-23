import { encodeICO } from './lib/ico.js';
import { FAVICON_PNGS, faviconRect } from './lib/favicon.js';

export function drawFavicon(image, size, { fit = 'contain', background = null, appBackground = '#ffffff' } = {}, kind = 'browser') {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法绘制图标，请更新浏览器后重试。');
  const color = kind === 'apple' || kind === 'maskable' ? appBackground : background;
  if (color) { context.fillStyle = color; context.fillRect(0, 0, size, size); }
  const rect = faviconRect(image.naturalWidth, image.naturalHeight, size, fit, kind);
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  return canvas;
}

export async function generateFaviconImages(image, sizes, options, signal) {
  const aborted = () => { if (signal?.aborted) throw new DOMException('任务已取消', 'AbortError'); };
  aborted();
  const frames = sizes.map(size => {
    const canvas = drawFavicon(image, size, options);
    return { canvas, size, rgba: canvas.getContext('2d').getImageData(0, 0, size, size).data };
  });
  const ico = new Blob([encodeICO(frames)], { type: 'image/x-icon' });
  const pngs = [];
  for (const descriptor of FAVICON_PNGS) {
    aborted();
    const canvas = drawFavicon(image, descriptor.size, options, descriptor.kind);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    aborted();
    if (!blob || blob.type !== 'image/png') throw new Error('PNG 编码失败，请刷新浏览器后重试。');
    pngs.push({ ...descriptor, canvas, blob, type: 'image/png' });
  }
  return { ico, pngs, frames, sizes: [...sizes], files: [{ name: 'favicon.ico', blob: ico, type: 'image/x-icon', label: '浏览器 · 多尺寸图标', sizeLabel: sizes.join(' / ') }, ...pngs] };
}
