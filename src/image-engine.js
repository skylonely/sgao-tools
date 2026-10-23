import { PROFILES, resizeDimensions, perceptualScore, encodeIndexedPNG, inspectImage, imageFilename } from './lib/image-compression.js';

const makeCanvas = (width, height) => {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  canvas.width = width; canvas.height = height; return canvas;
};
function context(canvas) {
  const result = canvas.getContext('2d', { willReadFrequently: true });
  if (!result) throw new Error('浏览器无法创建图片画布。');
  return result;
}
async function encode(canvas, mime, quality) {
  const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: mime, quality }) : await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
  if (!blob || blob.type !== mime) throw new Error(`当前浏览器不支持输出 ${mime.split('/')[1].toUpperCase()} 格式。`);
  return blob;
}
function check(signal) { if (signal?.aborted) throw new DOMException('处理已取消', 'AbortError'); }

export async function compressImage(file, options, { signal, onProgress = () => {} } = {}) {
  if (file.size > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20 MB。');
  check(signal); onProgress('读取图片');
  const inspection = inspectImage(new Uint8Array(await file.arrayBuffer()));
  if (inspection.width && (inspection.width > 10000 || inspection.height > 10000 || inspection.width * inspection.height > 32_000_000)) throw new Error('图片过大：最多 3200 万像素，单边不超过 10000 像素。');
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('图片无法解码。请确认文件完整，或换用支持该格式的浏览器。'); }
  try {
    check(signal);
    const originalWidth = bitmap.width, originalHeight = bitmap.height;
    if (originalWidth > 10000 || originalHeight > 10000 || originalWidth * originalHeight > 32_000_000) throw new Error('图片过大：最多 3200 万像素，单边不超过 10000 像素。');
    const { width, height } = resizeDimensions(originalWidth, originalHeight, Number(options.maxEdge) || 0);
    const base = makeCanvas(width, height), ctx = context(base);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close(); bitmap = null;
    const profile = PROFILES[options.profile] || PROFILES.balanced;
    const formats = options.format === 'auto' ? [...new Set([inspection.mime === 'image/avif' ? 'image/webp' : inspection.mime, 'image/webp'])] : [options.format];
    if (!formats.every(mime => ['image/png', 'image/jpeg', 'image/webp'].includes(mime))) throw new Error('不支持的输出格式。');
    const resized = width !== originalWidth || height !== originalHeight;
    let best = null, original = false;
    if (!resized && (options.format === 'auto' || options.format === inspection.mime)) { best = file; original = true; }
    const choose = blob => { if (!best || blob.size < best.size) { best = blob; original = false; } };
    for (const mime of formats) {
      check(signal); onProgress(`优化 ${mime.split('/')[1].toUpperCase()}`);
      let canvas = base;
      if (mime === 'image/jpeg') {
        canvas = makeCanvas(width, height); const target = context(canvas);
        target.fillStyle = /^#[\da-f]{6}$/i.test(options.background) ? options.background : '#ffffff'; target.fillRect(0, 0, width, height); target.drawImage(base, 0, 0);
      }
      const previewSize = resizeDimensions(width, height, 384), preview = makeCanvas(previewSize.width, previewSize.height), previewContext = context(preview);
      previewContext.drawImage(canvas, 0, 0, preview.width, preview.height);
      const reference = previewContext.getImageData(0, 0, preview.width, preview.height).data;
      const score = async blob => {
        check(signal);
        const decoded = await createImageBitmap(blob);
        try {
          previewContext.clearRect(0, 0, preview.width, preview.height); previewContext.drawImage(decoded, 0, 0, preview.width, preview.height);
          return perceptualScore(reference, previewContext.getImageData(0, 0, preview.width, preview.height).data, preview.width, preview.height);
        } finally { decoded.close(); }
      };
      if (mime === 'image/png') {
        choose(await encode(canvas, mime));
        if (typeof CompressionStream === 'function') {
          const pixels = ctx.getImageData(0, 0, width, height).data;
          for (const colors of profile.colors) {
            check(signal); onProgress(`优化 PNG · ${colors} 色`);
            const candidate = await encodeIndexedPNG(pixels, width, height, colors, signal);
            if (await score(candidate) < profile.threshold) break;
            choose(candidate);
          }
        }
      } else {
        let high = .98, low = profile.minQuality;
        let candidate;
        try { candidate = await encode(canvas, mime, high); }
        catch (error) { if (options.format === 'auto') continue; throw error; }
        if (await score(candidate) < profile.threshold) {
          // Keep quality if no lossy candidate passes; conversion remains explicit.
          candidate = await encode(canvas, mime, 1);
          if (options.format !== 'auto') choose(candidate);
          else if (!best) choose(await encode(canvas, 'image/png'));
          continue;
        }
        choose(candidate);
        for (let attempt = 0; attempt < 4; attempt++) {
          check(signal);
          const quality = (low + high) / 2;
          const trial = await encode(canvas, mime, quality);
          if (await score(trial) >= profile.threshold) { high = quality; choose(trial); } else low = quality;
        }
      }
      if (canvas !== base) { canvas.width = canvas.height = 1; }
    }
    check(signal);
    if (!best) throw new Error('当前浏览器没有可用的输出编码器，请尝试 JPG 或 PNG。');
    const mime = original ? inspection.mime : best.type;
    base.width = base.height = 1;
    return { blob: best, mime, name: imageFilename(file.name, mime), width, height, originalWidth, originalHeight, original, resized };
  } finally { bitmap?.close(); }
}
