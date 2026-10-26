import { inspectImage, resizeDimensions } from './lib/image-compression.js';

export async function decodeLocalImage(file, checkDimensions) {
  if (!file.size || file.size > 20 * 1024 ** 2) throw new Error('请选择非空静态图片，单张最高 20 MB。');
  const info = inspectImage(new Uint8Array(await file.arrayBuffer()));
  if (info.width) checkDimensions(info.width, info.height);
  let image;
  try { image = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('图片无法读取，请检查文件，或换用支持该格式的浏览器。'); }
  try { checkDimensions(image.width, image.height); return { image, mime: info.mime }; }
  catch (error) { image.close(); throw error; }
}
export async function createImagePreview(image, maxEdge = 960) {
  const canvas = document.createElement('canvas'), size = resizeDimensions(image.width, image.height, maxEdge);
  canvas.width = size.width; canvas.height = size.height;
  try {
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, 0, 0, size.width, size.height);
    return await createImageBitmap(canvas);
  } finally { canvas.width = canvas.height = 1; }
}
