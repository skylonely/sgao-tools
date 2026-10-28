export const OCR_LIMITS = Object.freeze({ fileBytes: 20 * 1024 ** 2, sourceEdge: 10000, sourcePixels: 32_000_000, edge: 4096, pixels: 8_000_000, text: 1_000_000, lines: 1000 });
export function validateOCR(raw) {
  if (!['chi_sim+eng', 'chi_sim', 'eng'].includes(raw.language) || !['3', '6', '11'].includes(raw.segmentation) || !['original', 'gray', 'binary'].includes(raw.filter) || ![0, 1, 2, 3].includes(raw.turns)) throw new Error('请选择有效的识别语言、排版和预处理设置。');
  return { language: raw.language, segmentation: raw.segmentation, filter: raw.filter, turns: raw.turns };
}
export function checkOCRDimensions(width, height) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= OCR_LIMITS.sourceEdge) || width * height > OCR_LIMITS.sourcePixels) throw new Error('源图单边最高 10000 px、总像素最高 3200 万，请先裁剪或缩小。');
}
export function ocrDimensions(width, height, raw) {
  checkOCRDimensions(width, height); const options = validateOCR(raw), swapped = options.turns % 2 !== 0, w = swapped ? height : width, h = swapped ? width : height;
  const scale = Math.min(1, OCR_LIMITS.edge / w, OCR_LIMITS.edge / h, Math.sqrt(OCR_LIMITS.pixels / (w * h)));
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)), scale, reduced: scale < 1 };
}
export function otsuThreshold(histogram, total) {
  let sum = 0, background = 0, backgroundSum = 0, variance = -1, threshold = 127;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  for (let i = 0; i < 256; i++) {
    background += histogram[i]; if (!background) continue;
    const foreground = total - background; if (!foreground) break;
    backgroundSum += i * histogram[i];
    const difference = backgroundSum / background - (sum - backgroundSum) / foreground, score = background * foreground * difference * difference;
    if (score > variance) { variance = score; threshold = i; }
  }
  return threshold;
}
export function normalizeOCRText(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  if (text.length > OCR_LIMITS.text) throw new Error('识别文本超过 100 万字符，请裁剪后分批识别。');
  return text;
}
export function normalizeOCRResult(data, width, height) {
  const text = normalizeOCRText(data?.text), lines = []; let lineCount = 0;
  for (const block of data?.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
    const bounds = line.bbox, content = normalizeOCRText(line.text).trim();
    if (!content || !bounds || ![bounds.x0, bounds.y0, bounds.x1, bounds.y1].every(Number.isFinite)) continue;
    const x0 = Math.max(0, Math.min(width, bounds.x0)), y0 = Math.max(0, Math.min(height, bounds.y0)), x1 = Math.max(0, Math.min(width, bounds.x1)), y1 = Math.max(0, Math.min(height, bounds.y1));
    if (x1 <= x0 || y1 <= y0) continue; lineCount++;
    if (lines.length < OCR_LIMITS.lines) lines.push({ text: content, x0, y0, x1, y1, confidence: Number.isFinite(line.confidence) ? Math.min(100, Math.max(0, line.confidence)) : null });
  }
  return { text, lines, lineCount, confidence: Number.isFinite(data?.confidence) ? Math.min(100, Math.max(0, data.confidence)) : null };
}
export function ocrFilename(name) {
  const stem = String(name || '').replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 90) || 'sgao-image';
  return `${stem}-ocr.txt`;
}
export function ocrTextBlob(text) { return new Blob(['\ufeff', normalizeOCRText(text)], { type: 'text/plain;charset=utf-8' }); }
