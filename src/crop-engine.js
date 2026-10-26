import { CROP_INPUT_BYTES, orientedSize, outputPlacement } from './lib/crop.js';
import { inspectImage } from './lib/image-compression.js';

export async function decodeCropImage(file) {
  if (!file.size || file.size > CROP_INPUT_BYTES) throw new Error('请选择不超过 20 MB 的静态图片。');
  const inspection = inspectImage(new Uint8Array(await file.arrayBuffer()));
  const check = (width, height) => { if (!width || !height || width > 10000 || height > 10000 || width * height > 32_000_000) throw new Error('源图最多 3200 万像素，单边不超过 10000 px。'); };
  if (inspection.width) check(inspection.width, inspection.height);
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('图片无法读取，请确认文件完整或换用支持该格式的浏览器。'); }
  try { check(bitmap.width, bitmap.height); return bitmap; } catch (error) { bitmap.close(); throw error; }
}

export function paintOriented(ctx, image, turns, flipX, flipY) {
  const size = orientedSize(image.width, image.height, turns), turn = (turns % 4 + 4) % 4;
  ctx.save();
  ctx.translate(flipX ? size.width : 0, flipY ? size.height : 0); ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  if (turn === 1) { ctx.translate(image.height, 0); ctx.rotate(Math.PI / 2); }
  if (turn === 2) { ctx.translate(image.width, image.height); ctx.rotate(Math.PI); }
  if (turn === 3) { ctx.translate(0, image.width); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(image, 0, 0); ctx.restore();
}

export async function encodeCrop(image, crop, options) {
  const { width, height, mime, background, fit, turns, flipX, flipY, quality } = options;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('不支持的导出格式。');
  const area = outputPlacement(crop, width, height, fit);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法创建导出画布。');
    if (background || mime === 'image/jpeg') { ctx.fillStyle = /^#[\da-f]{6}$/i.test(background) ? background : '#ffffff'; ctx.fillRect(0, 0, width, height); }
    ctx.save(); ctx.beginPath(); ctx.rect(area.x, area.y, area.width, area.height); ctx.clip();
    ctx.translate(area.x, area.y); ctx.scale(area.width / crop.width, area.height / crop.height); ctx.translate(-crop.x, -crop.y);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; paintOriented(ctx, image, turns, flipX, flipY); ctx.restore();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
    if (!blob || blob.type !== mime) throw new Error('当前浏览器不支持所选导出格式，请换用 PNG 或 JPG。');
    return blob;
  } finally { canvas.width = canvas.height = 1; }
}
