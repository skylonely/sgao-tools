export const CROP_INPUT_BYTES = 20 * 1024 * 1024;
export const CROP_MAX_EDGE = 8192;
export const CROP_MAX_PIXELS = 32_000_000;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function orientedSize(width, height, turns = 0) {
  return Math.abs(turns % 2) ? { width: height, height: width } : { width, height };
}
export function boundCrop(rect, bounds) {
  const width = clamp(Math.round(rect.width), 1, bounds.width);
  const height = clamp(Math.round(rect.height), 1, bounds.height);
  return { x: clamp(Math.round(rect.x), 0, bounds.width - width), y: clamp(Math.round(rect.y), 0, bounds.height - height), width, height };
}
export function fitCrop(bounds, ratio = 0) {
  let { width, height } = bounds;
  if (ratio > 0) { width = Math.min(width, height * ratio); height = width / ratio; }
  return boundCrop({ x: (bounds.width - width) / 2, y: (bounds.height - height) / 2, width, height }, bounds);
}
export function moveCrop(rect, dx, dy, bounds) { return boundCrop({ ...rect, x: rect.x + dx, y: rect.y + dy }, bounds); }
export function resizeCrop(rect, handle, dx, dy, bounds, ratio = 0) {
  const west = handle.includes('w'), east = handle.includes('e'), north = handle.includes('n'), south = handle.includes('s');
  if (!west && !east && !north && !south) throw new Error('无效的裁剪控制点。');
  if (!ratio) {
    const left = west ? clamp(rect.x + dx, 0, rect.x + rect.width - 1) : rect.x;
    const right = east ? clamp(rect.x + rect.width + dx, rect.x + 1, bounds.width) : rect.x + rect.width;
    const top = north ? clamp(rect.y + dy, 0, rect.y + rect.height - 1) : rect.y;
    const bottom = south ? clamp(rect.y + rect.height + dy, rect.y + 1, bounds.height) : rect.y + rect.height;
    return boundCrop({ x: left, y: top, width: right - left, height: bottom - top }, bounds);
  }
  const ax = west ? rect.x + rect.width : east ? rect.x : rect.x + rect.width / 2;
  const ay = north ? rect.y + rect.height : south ? rect.y : rect.y + rect.height / 2;
  const maxWidth = west ? ax : east ? bounds.width - ax : 2 * Math.min(ax, bounds.width - ax);
  const maxHeight = north ? ay : south ? bounds.height - ay : 2 * Math.min(ay, bounds.height - ay);
  const proposedW = rect.width + (west ? -dx : east ? dx : 0), proposedH = rect.height + (north ? -dy : south ? dy : 0);
  const proposed = (west || east) && (north || south) ? (ratio * proposedW + proposedH) / (ratio * ratio + 1) : west || east ? proposedW / ratio : proposedH;
  const height = clamp(proposed, Math.min(1, maxHeight, maxWidth / ratio), Math.min(maxHeight, maxWidth / ratio)), width = height * ratio;
  return boundCrop({ x: west ? ax - width : east ? ax : ax - width / 2, y: north ? ay - height : south ? ay : ay - height / 2, width, height }, bounds);
}
export function drawCrop(start, point, bounds, ratio = 0) {
  const west = point.x < start.x, north = point.y < start.y;
  let width = Math.max(1, Math.abs(point.x - start.x)), height = Math.max(1, Math.abs(point.y - start.y));
  if (ratio) {
    width = Math.max(width, height * ratio); height = width / ratio;
    const scale = Math.min(1, (west ? start.x : bounds.width - start.x) / width, (north ? start.y : bounds.height - start.y) / height);
    width *= scale; height *= scale;
  }
  return boundCrop({ x: west ? start.x - width : start.x, y: north ? start.y - height : start.y, width, height }, bounds);
}
export function editCrop(rect, field, value, bounds, ratio = 0) {
  if (!Number.isInteger(value) || value < (field === 'x' || field === 'y' ? 0 : 1)) throw new Error('裁剪位置需为非负整数，宽高需为正整数。');
  if (field === 'x' || field === 'y') return boundCrop({ ...rect, [field]: value }, bounds);
  if (!['width', 'height'].includes(field)) throw new Error('无效的裁剪尺寸。');
  let width = field === 'width' ? value : rect.width, height = field === 'height' ? value : rect.height;
  if (!ratio) return boundCrop({ ...rect, width: Math.min(width, bounds.width - rect.x), height: Math.min(height, bounds.height - rect.y) }, bounds);
  if (ratio) { if (field === 'width') height = width / ratio; else width = height * ratio; }
  const scale = Math.min(1, (bounds.width - rect.x) / width, (bounds.height - rect.y) / height);
  return boundCrop({ ...rect, width: width * scale, height: height * scale }, bounds);
}
export function defaultOutput(rect) {
  const scale = Math.min(1, CROP_MAX_EDGE / rect.width, CROP_MAX_EDGE / rect.height, Math.sqrt(CROP_MAX_PIXELS / (rect.width * rect.height)));
  return { width: Math.max(1, Math.floor(rect.width * scale)), height: Math.max(1, Math.floor(rect.height * scale)) };
}
export function validateOutput(width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= CROP_MAX_EDGE)) throw new Error('导出宽高需为 1–8192 px 的整数。');
  if (width * height > CROP_MAX_PIXELS) throw new Error('导出总像素不能超过 3200 万，请调小宽度或高度。');
  return { width, height };
}
export function outputPlacement(crop, width, height, fit = 'contain') {
  validateOutput(width, height);
  const scale = Math.min(width / crop.width, height / crop.height);
  const drawWidth = fit === 'stretch' ? width : crop.width * scale, drawHeight = fit === 'stretch' ? height : crop.height * scale;
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}
export function cropFilename(name, mime) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
  if (!extension) throw new Error('不支持的导出格式。');
  const stem = String(name).replace(/\.[^.]*$/, '').replace(/[\u0000-\u001f/\\:*?"<>|]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100) || 'image';
  return `${stem}-cropped.${extension}`;
}
