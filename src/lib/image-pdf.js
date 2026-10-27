export const PDF_LIMITS = Object.freeze({ files: 20, fileBytes: 20 * 1024 ** 2, totalBytes: 100 * 1024 ** 2, outputBytes: 100 * 1024 ** 2, edge: 10000, pixels: 32_000_000 });
export const MM = 72 / 25.4;
export function checkPDFFile(file, count, total) {
  if (!file.size || file.size > PDF_LIMITS.fileBytes) throw new Error('请选择非空静态图片，单张最高 20 MB。');
  if (count >= PDF_LIMITS.files || total + file.size > PDF_LIMITS.totalBytes) throw new Error('最多选择 20 张，原图合计最高 100 MB。');
}
export function checkPDFDimensions(width, height) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= PDF_LIMITS.edge) || width * height > PDF_LIMITS.pixels) throw new Error('源图单边最高 10000 px，总像素最高 3200 万。');
}
export function validateImagePDF(options) {
  if (!['a4', 'letter', 'image'].includes(options.paper) || !['portrait', 'landscape', 'auto'].includes(options.orientation) || !['contain', 'cover'].includes(options.fit) || !['lossless', 'jpeg'].includes(options.encoding)) throw new Error('请选择有效的页面、方向、适配和图片编码方式。');
  if (!Number.isInteger(options.margin) || options.margin < 0 || options.margin > 40) throw new Error('边距需为 0–40 mm 的整数。');
  if (!Number.isInteger(options.quality) || options.quality < 40 || options.quality > 100) throw new Error('JPEG 质量需为 40–100 的整数。');
  if (![0, 3200, 2560, 1600, 1200].includes(options.maxEdge) || !/^#[a-f\d]{6}$/i.test(options.background)) throw new Error('请选择有效的图片尺寸和页面底色。');
  if (typeof options.name !== 'string' || !options.name.trim() || options.name.length > 80) throw new Error('请填写下载名称，最多 80 个字符。');
  return { ...options };
}
// All layout values use PDF points (72 points = 1 inch); source crops use pixels.
export function imagePDFPage(image, rawOptions) {
  const options = validateImagePDF(rawOptions); checkPDFDimensions(image.width, image.height);
  const margin = options.margin * MM;
  let width, height;
  if (options.paper === 'image') { width = image.width * .75 + margin * 2; height = image.height * .75 + margin * 2; }
  else {
    [width, height] = options.paper === 'a4' ? [210 * MM, 297 * MM] : [612, 792];
    if (options.orientation === 'landscape' || options.orientation === 'auto' && image.width > image.height) [width, height] = [height, width];
  }
  const innerWidth = width - margin * 2, innerHeight = height - margin * 2;
  const fill = options.fit === 'cover' && options.paper !== 'image';
  const scale = (fill ? Math.max : Math.min)(innerWidth / image.width, innerHeight / image.height);
  const cropWidth = fill ? Math.min(image.width, innerWidth / scale) : image.width, cropHeight = fill ? Math.min(image.height, innerHeight / scale) : image.height;
  const drawWidth = fill ? innerWidth : cropWidth * scale, drawHeight = fill ? innerHeight : cropHeight * scale;
  const crop = { x: Math.max(0, image.width - cropWidth) / 2, y: Math.max(0, image.height - cropHeight) / 2, width: cropWidth, height: cropHeight };
  const downscale = options.maxEdge ? Math.min(1, options.maxEdge / Math.max(cropWidth, cropHeight)) : 1;
  return { width, height, margin, crop, target: { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight }, raster: { width: Math.max(1, Math.round(cropWidth * downscale)), height: Math.max(1, Math.round(cropHeight * downscale)) }, cropped: fill && (cropWidth < image.width - .01 || cropHeight < image.height - .01) };
}
export function pdfFilename(value) {
  const stem = value.trim().replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80) || 'sgao-images';
  return `${stem}.pdf`;
}
