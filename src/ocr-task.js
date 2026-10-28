import { validateOCR, normalizeOCRResult } from './lib/ocr.js';

// The pinned Tesseract.js 7 Worker protocol lets us terminate even during model initialization.
export function recognizeOCR(image, dimensions, raw, { signal, onProgress = () => {}, workerFactory = url => new Worker(url), timeout = 180_000 } = {}) {
  const options = validateOCR(raw);
  return new Promise((resolve, reject) => {
    let worker, timer, ended = false, index = 0, lastProgress = 0; const id = `sgao-ocr-${Date.now()}`;
    const report = (progress, label) => { lastProgress = Math.max(lastProgress, Math.min(1, Math.max(0, progress))); onProgress(lastProgress, label); };
    const finish = (cause, result) => { if (ended) return; ended = true; clearTimeout(timer); worker?.terminate(); signal?.removeEventListener('abort', stop); cause ? reject(cause) : resolve(result); };
    const stop = () => finish(new DOMException('识别已停止', 'AbortError'));
    if (signal?.aborted) { stop(); return; }
    const base = new URL('./vendor/ocr/v7.0.0/', import.meta.url), languages = options.language.split('+');
    const stages = [
      { action: 'load', payload: { options: { lstmOnly: true, corePath: new URL('core/', base).href, logging: false } }, label: '正在加载识别引擎…', start: 0, end: .15 },
      { action: 'loadLanguage', payload: { langs: languages, options: { langPath: new URL('lang/', base).href.replace(/\/$/, ''), cacheMethod: 'none', gzip: true, lstmOnly: true } }, label: '正在加载识别模型…', start: .15, end: .4 },
      { action: 'initialize', payload: { langs: languages, oem: 1, config: {} }, label: '正在初始化文字识别…', start: .4, end: .45 },
      { action: 'setParameters', payload: { params: { tessedit_pageseg_mode: options.segmentation, preserve_interword_spaces: '1', user_defined_dpi: '150' } }, label: '正在分析文字排版…', start: .45, end: .46 },
      { action: 'recognize', payload: { image, options: { rotateAuto: false }, output: { text: true, blocks: true } }, label: '正在识别文字…', start: .46, end: 1 },
    ];
    const send = () => {
      if (ended) return; const stage = stages[index]; report(stage.start, stage.label);
      if (!ended) worker.postMessage({ workerId: id, jobId: `${id}-${index}`, action: stage.action, payload: stage.payload });
    };
    try {
      worker = workerFactory(new URL('worker.min.js', base));
      signal?.addEventListener('abort', stop, { once: true });
      worker.onerror = event => { event.preventDefault?.(); finish(new Error('识别引擎加载失败，请检查网络后重试，或使用新版浏览器。图片未上传。')); };
      worker.onmessageerror = () => finish(new Error('识别结果读取失败，请缩小图片后重试。'));
      worker.onmessage = ({ data }) => {
        if (ended) return; const stage = stages[index];
        if (data.jobId !== `${id}-${index}` || data.action !== stage.action) return;
        try {
          if (data.status === 'progress') { const progress = Number.isFinite(data.data?.progress) ? Math.max(0, Math.min(1, data.data.progress)) : 0; report(stage.start + (stage.end - stage.start) * progress, stage.label); }
          if (data.status === 'reject') finish(new Error(index < 3 ? '识别模型加载或初始化失败，请检查网络并重试。图片未上传。' : '未能完成识别，请调整图片方向、语言或预处理后重试。'));
          if (data.status === 'resolve') {
            if (index === stages.length - 1) { const result = normalizeOCRResult(data.data, dimensions.width, dimensions.height); report(1, '识别完成'); finish(null, result); }
            else { index++; send(); }
          }
        } catch (cause) { finish(cause); }
      };
      timer = setTimeout(() => finish(new Error('识别超过三分钟，请先裁剪文字区域、缩小图片或改用单一语言后重试。')), timeout);
      send();
    } catch (cause) { finish(cause); }
  });
}
