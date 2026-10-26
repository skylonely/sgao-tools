export const WATERMARK_LIMITS = Object.freeze({ files: 20, fileBytes: 20 * 1024 ** 2, totalBytes: 100 * 1024 ** 2, resultBytes: 200 * 1024 ** 2, edge: 10000, pixels: 32_000_000, logoBytes: 5 * 1024 ** 2, logoEdge: 4096, logoPixels: 16_000_000 });
export const WATERMARK_FONTS = Object.freeze({ sans: '"PingFang SC","Microsoft YaHei",system-ui,sans-serif', serif: '"Songti SC","SimSun",serif', mono: 'ui-monospace,"SFMono-Regular",Consolas,monospace' });
export const WATERMARK_ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
const bounded = (value, min, max, label) => { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}需在 ${min}–${max} 之间。`); return value; };

export function validateWatermark(options) {
  if (!['text', 'logo'].includes(options.type) || !['single', 'tile'].includes(options.mode) || ![...WATERMARK_ANCHORS, 'custom'].includes(options.anchor)) throw new Error('水印类型、布局或位置无效。');
  if (!Object.hasOwn(WATERMARK_FONTS, options.font) || !/^#[\da-f]{6}$/i.test(options.color) || !/^#[\da-f]{6}$/i.test(options.background)) throw new Error('请选择有效的字体与颜色。');
  if (!['auto', 'image/png', 'image/jpeg', 'image/webp'].includes(options.format)) throw new Error('请选择 PNG、JPG、WebP 或跟随原格式。');
  const text = String(options.text ?? '').replace(/\r\n?/g, '\n');
  if (options.type === 'text' && (!text.trim() || text.length > 120 || text.split('\n').length > 3)) throw new Error('请输入水印文字，最多 120 个字符、3 行。');
  bounded(options.textSize, 1, 20, '文字大小'); bounded(options.logoSize, 5, 80, 'Logo 大小');
  bounded(options.opacity, 1, 100, '不透明度'); bounded(options.angle, -180, 180, '旋转角度');
  bounded(options.margin, 0, 15, '边距'); bounded(options.gap, 50, 300, '平铺间距');
  bounded(options.x, 0, 100, '水平位置'); bounded(options.y, 0, 100, '垂直位置'); bounded(options.quality, 10, 100, '导出质量');
  return { ...options, text };
}

export function checkWatermarkFile(file, count = 0, total = 0, logo = false) {
  const max = logo ? WATERMARK_LIMITS.logoBytes : WATERMARK_LIMITS.fileBytes;
  if (!file.size || file.size > max) throw new Error(logo ? 'Logo 需为非空图片，最高 5 MB。' : '图片需为非空文件，单张最高 20 MB。');
  if (!logo && (count >= WATERMARK_LIMITS.files || total + file.size > WATERMARK_LIMITS.totalBytes)) throw new Error('每批最多 20 张，原图合计最高 100 MB。');
}
export function checkWatermarkDimensions(width, height, logo = false) {
  const edge = logo ? WATERMARK_LIMITS.logoEdge : WATERMARK_LIMITS.edge, pixels = logo ? WATERMARK_LIMITS.logoPixels : WATERMARK_LIMITS.pixels;
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= edge) || width * height > pixels) throw new Error(logo ? 'Logo 单边最高 4096 px，总像素最高 1600 万。' : '源图单边最高 10000 px，总像素最高 3200 万。');
}

export function rotatedBounds(width, height, angle) {
  const radians = angle * Math.PI / 180, c = Math.abs(Math.cos(radians)), s = Math.abs(Math.sin(radians));
  return { width: width * c + height * s, height: width * s + height * c };
}
export function clampWatermarkCenter(x, y, size, bounds, margin = 0) {
  const clamp = (value, edge, extent) => Math.min(edge - extent / 2 - margin, Math.max(extent / 2 + margin, value));
  return { x: clamp(x, size.width, bounds.width), y: clamp(y, size.height, bounds.height) };
}

export function watermarkLayout(size, mark, options) {
  const margin = options.mode === 'tile' ? 0 : Math.min(size.width, size.height) * options.margin / 100;
  const rotated = rotatedBounds(mark.width, mark.height, options.angle);
  const scale = Math.min(1, (size.width - margin * 2) / rotated.width, (size.height - margin * 2) / rotated.height);
  const bounds = { width: rotated.width * scale, height: rotated.height * scale };
  let center;
  if (options.anchor === 'custom') center = clampWatermarkCenter(size.width * options.x / 100, size.height * options.y / 100, size, bounds, margin);
  else {
    const column = options.anchor[1], row = options.anchor[0];
    center = { x: column === 'l' ? margin + bounds.width / 2 : column === 'r' ? size.width - margin - bounds.width / 2 : size.width / 2, y: row === 't' ? margin + bounds.height / 2 : row === 'b' ? size.height - margin - bounds.height / 2 : size.height / 2 };
  }
  return { ...bounds, scale, center, margin, angle: options.angle * Math.PI / 180 };
}

export function tileWatermarks(size, bounds, gap) {
  const spacing = Math.max(1, Math.min(bounds.width, bounds.height) * gap / 100);
  let stepX = bounds.width + spacing, stepY = bounds.height + spacing;
  let columns, rows, adjusted = false;
  do {
    columns = Math.ceil((size.width + bounds.width) / stepX) + 2; rows = Math.ceil((size.height + bounds.height) / stepY) + 2;
    if (columns * rows <= 600) break;
    stepX *= 1.12; stepY *= 1.12; adjusted = true;
  } while (true);
  const centers = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) centers.push({ x: (col - 1) * stepX + (row % 2 ? stepX / 2 : 0), y: (row - 1) * stepY });
  return { centers, adjusted };
}

export function watermarkMime(format, sourceMime) {
  if (format === 'auto') return ['image/png', 'image/jpeg', 'image/webp'].includes(sourceMime) ? sourceMime : 'image/png';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(format)) throw new Error('不支持的导出格式。');
  return format;
}
export function watermarkFilename(name, mime) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
  if (!extension) throw new Error('不支持的导出格式。');
  const stem = name.replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 90) || 'image';
  return `${stem}-watermarked.${extension}`;
}
