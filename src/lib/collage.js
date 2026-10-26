export const COLLAGE_LIMITS = Object.freeze({ files: 20, fileBytes: 20 * 1024 ** 2, totalBytes: 100 * 1024 ** 2, edge: 10000, pixels: 32_000_000 });
export function checkCollageFile(file, count, total) {
  if (!file.size || file.size > COLLAGE_LIMITS.fileBytes) throw new Error('图片需为非空文件，单张最高 20 MB。');
  if (count >= COLLAGE_LIMITS.files || total + file.size > COLLAGE_LIMITS.totalBytes) throw new Error('最多选择 20 张，原图合计最高 100 MB。');
}
export function validateCollage(options) {
  if (!['vertical', 'horizontal', 'grid'].includes(options.mode) || !['contain', 'cover'].includes(options.fit) || !['color', 'transparent'].includes(options.background)) throw new Error('请选择有效的布局、图片适配与背景。');
  const integer = (value, min, max, name) => { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name}需为 ${min}–${max} 之间的整数。`); };
  integer(options.base, 64, 10000, '目标宽度 / 高度'); integer(options.columns, 2, 5, '网格列数');
  integer(options.gap, 0, 300, '图片间距'); integer(options.padding, 0, 300, '外边距'); integer(options.quality, 10, 100, '导出质量');
  if (![1, 4 / 3, 3 / 4, 16 / 9, 9 / 16].includes(options.ratio)) throw new Error('请选择有效的网格比例。');
  if (!/^#[\da-f]{6}$/i.test(options.color) || !['image/png', 'image/jpeg', 'image/webp'].includes(options.format)) throw new Error('请选择有效的背景颜色和导出格式。');
  if (options.base <= options.padding * 2) throw new Error('外边距占满了画布，请减小外边距或增大目标尺寸。');
  if (options.mode === 'grid' && options.base - options.padding * 2 - options.gap * (options.columns - 1) < options.columns) throw new Error('网格宽度不足，请减小间距或列数，或增大目标宽度。');
  if (typeof options.name !== 'string' || !options.name.trim() || options.name.length > 80) throw new Error('请填写下载名称，最多 80 个字符。');
  return { ...options };
}

export function fitCollageImage(image, cell, fit = 'contain') {
  if (fit === 'cover') {
    const scale = Math.max(cell.width / image.width, cell.height / image.height), width = Math.min(image.width, cell.width / scale), height = Math.min(image.height, cell.height / scale);
    return { source: { x: (image.width - width) / 2, y: (image.height - height) / 2, width, height }, target: { ...cell } };
  }
  const scale = Math.min(cell.width / image.width, cell.height / image.height), width = image.width * scale, height = image.height * scale;
  return { source: { x: 0, y: 0, width: image.width, height: image.height }, target: { x: cell.x + Math.max(0, cell.width - width) / 2, y: cell.y + Math.max(0, cell.height - height) / 2, width, height } };
}

export function collageLayout(images, rawOptions) {
  const options = validateCollage(rawOptions);
  if (!images.length || images.length > COLLAGE_LIMITS.files) throw new Error('请先选择 1–20 张图片。');
  for (const image of images) if (![image.width, image.height].every(value => Number.isInteger(value) && value > 0 && value <= COLLAGE_LIMITS.edge) || image.width * image.height > COLLAGE_LIMITS.pixels) throw new Error('源图单边最高 10000 px，总像素最高 3200 万。');
  const { mode, base, gap, padding, columns, ratio, fit } = options, content = base - padding * 2;
  const placements = []; let rawWidth, rawHeight;
  if (mode === 'grid') {
    const cellWidth = (content - gap * (columns - 1)) / columns, cellHeight = cellWidth / ratio;
    const rows = Math.ceil(images.length / columns); rawWidth = base; rawHeight = Math.ceil(padding * 2 + rows * cellHeight + (rows - 1) * gap);
    images.forEach((image, index) => placements.push(fitCollageImage(image, { x: padding + index % columns * (cellWidth + gap), y: padding + Math.floor(index / columns) * (cellHeight + gap), width: cellWidth, height: cellHeight }, fit)));
  } else {
    let offset = padding;
    for (const image of images) {
      const width = mode === 'vertical' ? content : content * image.width / image.height, height = mode === 'vertical' ? content * image.height / image.width : content;
      placements.push({ source: { x: 0, y: 0, width: image.width, height: image.height }, target: { x: mode === 'vertical' ? padding : offset, y: mode === 'vertical' ? offset : padding, width, height } });
      offset += (mode === 'vertical' ? height : width) + gap;
    }
    rawWidth = mode === 'vertical' ? base : Math.ceil(offset - gap + padding); rawHeight = mode === 'vertical' ? Math.ceil(offset - gap + padding) : base;
  }
  const maxScale = Math.min(1, COLLAGE_LIMITS.edge / rawWidth, COLLAGE_LIMITS.edge / rawHeight, Math.sqrt(COLLAGE_LIMITS.pixels / (rawWidth * rawHeight)));
  const width = Math.max(1, Math.floor(rawWidth * maxScale)), height = Math.max(1, Math.floor(rawHeight * maxScale));
  const scale = Math.min(width / rawWidth, height / rawHeight);
  return {
    width, height, rawWidth, rawHeight, scale, scaled: scale < 1,
    placements: placements.map(({ source, target }) => ({ source, target: Object.fromEntries(Object.entries(target).map(([key, value]) => [key, value * scale])) })),
    upscaled: placements.some(({ source, target }) => target.width * scale > source.width + .01 || target.height * scale > source.height + .01),
  };
}

export function reorderCollage(items, from, to) {
  if (![from, to].every(value => Number.isInteger(value) && value >= 0 && value < items.length)) throw new Error('图片排序位置无效。');
  const result = [...items], [item] = result.splice(from, 1); result.splice(to, 0, item); return result;
}
export function collageFilename(name, mime) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
  if (!extension) throw new Error('不支持的导出格式。');
  const stem = name.trim().replace(/\.(png|jpe?g|webp)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80) || 'sgao-collage';
  return `${stem}.${extension}`;
}
