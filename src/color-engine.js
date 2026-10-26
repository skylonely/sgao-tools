import { inspectImage, resizeDimensions } from './lib/image-compression.js';

export async function decodeColorImage(file) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('请选择非空图片，单张最高 20 MB。');
  const inspection = inspectImage(new Uint8Array(await file.arrayBuffer()));
  const check = (width, height) => {
    if (!width || !height || width > 10000 || height > 10000 || width * height > 32_000_000) throw new Error('源图片单边不能超过 10000 px，总像素不能超过 3200 万。');
  };
  if (inspection.width) check(inspection.width, inspection.height);
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('图片无法读取，请确认文件完整，或换用支持该格式的浏览器。'); }
  try { check(bitmap.width, bitmap.height); return bitmap; } catch (error) { bitmap.close(); throw error; }
}

export function sampleImage(image) {
  const size = resizeDimensions(image.width, image.height, 256), canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  ctx.drawImage(image, 0, 0, size.width, size.height);
  const data = ctx.getImageData(0, 0, size.width, size.height).data;
  canvas.width = canvas.height = 1;
  return { ...size, data };
}

export async function renderPaletteCard(image, colors, name) {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 820;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  ctx.fillStyle = '#f5f3ee'; ctx.fillRect(0, 0, 1200, 820);
  ctx.fillStyle = '#25262c'; ctx.font = '600 30px system-ui'; ctx.fillText('COLOR NOTES', 48, 65);
  ctx.fillStyle = '#777970'; ctx.font = '16px system-ui';
  let label = name; while (ctx.measureText(label).width > 750) label = label.slice(0, -2);
  ctx.fillText(label === name ? label : `${label}…`, 48, 98);
  ctx.textAlign = 'right'; ctx.fillText(`${colors.length} COLORS / sRGB`, 1152, 65); ctx.textAlign = 'left';
  ctx.fillStyle = '#fff'; ctx.fillRect(48, 128, 1104, 390);
  const scale = Math.min(1104 / image.width, 390 / image.height), width = image.width * scale, height = image.height * scale;
  ctx.drawImage(image, 48 + (1104 - width) / 2, 128 + (390 - height) / 2, width, height);
  const gap = 12, cardWidth = (1104 - gap * (colors.length - 1)) / colors.length;
  colors.forEach((color, index) => {
    const x = 48 + index * (cardWidth + gap); ctx.fillStyle = color.hex; ctx.fillRect(x, 546, cardWidth, 116);
    ctx.fillStyle = '#25262c'; ctx.font = '600 17px ui-monospace, monospace'; ctx.fillText(color.hex, x, 692);
    ctx.fillStyle = '#777970'; ctx.font = '14px system-ui'; ctx.fillText(`≈ ${(color.fraction * 100).toFixed(1)}%`, x, 720);
  });
  ctx.fillStyle = '#e2e0d9'; ctx.fillRect(48, 751, 1104, 1);
  ctx.fillStyle = '#777970'; ctx.font = '13px system-ui'; ctx.fillText('SGAO / tools.sgao.cc', 48, 785);
  ctx.textAlign = 'right'; ctx.fillText('Sampled palette · partial transparency on white', 1152, 785);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); canvas.width = canvas.height = 1;
  if (!blob) throw new Error('色卡图片未能生成，请重试。');
  return blob;
}
