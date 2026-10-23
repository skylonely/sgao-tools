export const SVG_MAX_BYTES = 5 * 1024 * 1024;
export const PNG_MAX_EDGE = 8192;
export const PNG_MAX_PIXELS = 32_000_000;
const bytes = new TextEncoder();
export const svgByteLength = value => bytes.encode(value).length;

export function svgLength(value) {
  const match = String(value ?? '').trim().match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|pt|pc|q)?$/i);
  if (!match) return null;
  const length = Number(match[1]) * ({ px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16, q: 96 / 101.6 }[match[2]?.toLowerCase() || 'px']);
  return Number.isFinite(length) && length > 0 && length <= 1_000_000 ? length : null;
}

export function svgDimensions(attributes) {
  let viewBox = null;
  if (attributes.viewBox != null) {
    const parts = attributes.viewBox.trim().split(/[\s,]+/);
    if (parts.some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) throw new Error('viewBox 包含无效的数字。');
    const values = parts.map(Number);
    if (values.length !== 4 || !values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0 || values.some(value => Math.abs(value) > 1_000_000)) throw new Error('viewBox 需要 4 个有效数字，且宽高必须大于 0。');
    viewBox = values;
  }
  let width = svgLength(attributes.width), height = svgLength(attributes.height);
  for (const key of ['width', 'height']) {
    if (attributes[key] != null && !svgLength(attributes[key]) && !/^(?:auto|(?:\d+(?:\.\d*)?|\.\d+)%)$/i.test(attributes[key].trim())) throw new Error(`SVG 的 ${key} 尺寸无效，请使用正数或有效的 viewBox。`);
  }
  if (viewBox) {
    if (width && !height) height = width * viewBox[3] / viewBox[2];
    if (height && !width) width = height * viewBox[2] / viewBox[3];
    width ||= viewBox[2]; height ||= viewBox[3];
  }
  if (!width || !height || width > 1_000_000 || height > 1_000_000) throw new Error('SVG 需要有效的 viewBox，或明确的 width 和 height 尺寸。');
  return { width, height, viewBox: viewBox || [0, 0, width, height] };
}

export function validatePNGSize(width, height) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= PNG_MAX_EDGE)) throw new Error(`PNG 宽高需为 1–${PNG_MAX_EDGE} 的整数。`);
  if (width * height > PNG_MAX_PIXELS) throw new Error('PNG 总像素不能超过 3200 万，请调小宽度或高度。');
  return { width, height };
}

export function initialPNGSize({ width, height }) {
  const scale = Math.min(1, 2048 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function containSVG(sourceWidth, sourceHeight, width, height) {
  if (![sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error('SVG 原始尺寸无效。');
  validatePNGSize(width, height);
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale, drawHeight = sourceHeight * scale;
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}

export function svgFilename(name, extension = 'svg') {
  let stem = String(name || 'image').replace(/\.(?:svg|png)$/i, '').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100);
  stem = stem.replace(/-optimized$/i, '') || 'image';
  return `${stem}-optimized.${extension === 'png' ? 'png' : 'svg'}`;
}

export function svgSavings(original, optimized) {
  return { bytes: original - optimized, percent: original ? (original - optimized) / original * 100 : 0 };
}
