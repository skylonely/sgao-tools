import { checkPDFInput, PDF_IMAGE_LIMITS, pdfImageSize, validatePDFImages } from './lib/pdf-images.js';
let library;
export function pdfLibrary() {
  if (!library) library = import('./vendor/pdfjs/pdf.min.mjs').then(pdfjs => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return pdfjs;
  }).catch(cause => { library = null; throw cause; });
  return library;
}
export async function openLocalPDF(file, { onTask = () => {}, onPassword = () => {}, pdfjs: providedLibrary, documentOptions = {} } = {}) {
  checkPDFInput(file);
  checkPDFInput(file, new Uint8Array(await file.slice(0, 1024).arrayBuffer()));
  const pdfjs = providedLibrary || await pdfLibrary(), base = new URL('./vendor/pdfjs/', import.meta.url).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()), cMapUrl: `${base}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/`,
    useWorkerFetch: true, disableFontFace: true, useSystemFonts: false, enableXfa: false,
    stopAtErrors: true, maxImageSize: -1, canvasMaxAreaInBytes: 128_000_000,
    isImageDecoderSupported: false, verbosity: pdfjs.VerbosityLevel.ERRORS,
    ...documentOptions,
  });
  task.onPassword = onPassword; onTask(task);
  try {
    const doc = await task.promise;
    if (!doc.numPages || doc.numPages > PDF_IMAGE_LIMITS.pages) throw new Error('PDF 最多支持 200 页，请先拆分文档。');
    const metadata = await doc.getMetadata();
    if (metadata.info.IsXFAPresent && !metadata.info.IsAcroFormPresent) throw new Error('此文档使用 XFA 动态表单，请先在 PDF 阅读器中另存为普通 PDF。');
    // PDF.js 6 owns teardown on the loading task rather than the document proxy.
    return { numPages: doc.numPages, getPage: number => doc.getPage(number), destroy: () => task.destroy() };
  } catch (cause) { await task.destroy(); throw cause; }
}
export function pdfLoadError(cause) {
  if (cause.name === 'InvalidPDFException') return 'PDF 已损坏或结构不完整，请重新导出文件后再试。';
  if (cause.name === 'PasswordException') return '无法打开加密 PDF，请检查文档打开密码。';
  return cause.message || 'PDF 无法读取，请检查文件或换用新版浏览器。';
}
// A separate bounded canvas for every render keeps canceled previews from touching a new page.
export async function renderPDFImage(doc, number, rawOptions, { signal, preview = false, pdfjs: providedLibrary } = {}) {
  const options = validatePDFImages(rawOptions), check = () => { if (signal?.aborted) throw new DOMException('转换已停止', 'AbortError'); };
  check(); const page = await doc.getPage(number); let canvas, render;
  const stop = () => render?.cancel();
  try {
    check(); const source = page.getViewport({ scale: 1 }), size = pdfImageSize(source.width, source.height, preview ? { ...options, mode: 'edge', edge: 1000 } : options);
    canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法创建渲染画布，请降低清晰度后重试。');
    const viewport = page.getViewport({ scale: size.scale }), transparent = options.background === 'transparent' && options.format !== 'image/jpeg';
    const pdfjs = providedLibrary || await pdfLibrary(); check();
    render = page.render({ canvasContext: ctx, viewport, background: transparent ? 'rgba(0,0,0,0)' : options.color, annotationMode: pdfjs.AnnotationMode.ENABLE, intent: 'display' });
    signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
    await render.promise; check();
    const mime = preview ? 'image/png' : options.format;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, options.quality / 100)); check();
    if (!blob || blob.type !== mime) throw new Error('浏览器无法导出所选格式，请改用 PNG / JPG 或降低尺寸。');
    return { blob, ...size, pageWidth: source.width, pageHeight: source.height };
  } catch (cause) { if (signal?.aborted || cause.name === 'RenderingCancelledException') throw new DOMException('转换已停止', 'AbortError'); throw cause; }
  finally { signal?.removeEventListener('abort', stop); if (canvas) canvas.width = canvas.height = 1; page.cleanup(); }
}
export async function convertPDFPages(doc, pages, options, { signal, onProgress = () => {}, onResult = () => {}, render = renderPDFImage } = {}) {
  validatePDFImages(options);
  if (!pages.length || pages.length > PDF_IMAGE_LIMITS.batch || pages.some(page => !Number.isInteger(page) || page < 1 || page > doc.numPages) || new Set(pages).size !== pages.length) throw new Error('请选择 1–50 个有效且不重复的页码。');
  let totalBytes = 0;
  for (let index = 0; index < pages.length; index++) {
    if (signal?.aborted) throw new DOMException('转换已停止', 'AbortError');
    const page = pages[index]; onProgress(index, pages.length, page);
    await new Promise(resolve => setTimeout(resolve, 0));
    const result = await render(doc, page, options, { signal });
    if (totalBytes + result.blob.size > PDF_IMAGE_LIMITS.resultBytes) throw new Error('本批图片超过 150 MB，已保留完成的图片。请缩小尺寸、改用 JPG / WebP，或分批转换。');
    await onResult({ ...result, page }); totalBytes += result.blob.size;
  }
  onProgress(pages.length, pages.length, null);
}
