export async function runPDFTask(items, options, { signal, onProgress, onPage }) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    const { encodeImagePDF } = await import('./image-pdf-engine.js');
    return encodeImagePDF(items, options, { signal, onProgress, onPage });
  }
  return new Promise((resolve, reject) => {
    let worker, timer, ended = false;
    const finish = (cause, blob) => { if (ended) return; ended = true; clearTimeout(timer); worker?.terminate(); signal?.removeEventListener('abort', stop); cause ? reject(cause) : resolve(blob); };
    const stop = () => finish(new DOMException('PDF 生成已停止', 'AbortError'));
    if (signal?.aborted) { stop(); return; }
    try {
      worker = new Worker(new URL('./image-pdf-worker.js', import.meta.url), { type: 'module' });
      signal?.addEventListener('abort', stop, { once: true });
      worker.onerror = event => { event.preventDefault(); finish(new Error('后台生成失败，请刷新页面或换用支持该格式的浏览器重试。')); };
      worker.onmessage = ({ data }) => {
        if (ended) return;
        if (data.type === 'progress') onProgress(data.done, data.total, data.text);
        if (data.type === 'page') onPage(data.page);
        if (data.type === 'result') finish(null, data.blob);
        if (data.type === 'error') finish(new Error(data.message));
      };
      timer = setTimeout(() => finish(new Error('生成超过两分钟，请减少页数或降低最长边后重试。')), 120_000);
      worker.postMessage({ items: items.map(({ file, width, height }) => ({ file, width, height })), options });
    } catch (cause) { finish(cause); }
  });
}
