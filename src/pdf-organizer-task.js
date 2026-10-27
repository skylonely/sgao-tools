export function organizerTask(type, payload, { signal, onProgress = () => {}, onResult = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let worker, timer, ended = false;
    const finish = (cause, result) => { if (ended) return; ended = true; clearTimeout(timer); worker?.terminate(); signal?.removeEventListener('abort', stop); cause ? reject(cause) : resolve(result); };
    const stop = () => finish(new DOMException('PDF 操作已停止', 'AbortError'));
    if (signal?.aborted) { stop(); return; }
    try {
      worker = new Worker(new URL('./pdf-organizer-worker.js', import.meta.url), { type: 'module' });
      signal?.addEventListener('abort', stop, { once: true });
      worker.onerror = event => { event.preventDefault(); finish(new Error('后台 PDF 处理失败，请刷新页面或换用新版浏览器。')); };
      worker.onmessage = ({ data }) => {
        if (ended) return;
        if (data.type === 'progress') onProgress(data.done, data.total, data.text);
        if (data.type === 'result') onResult(data.result);
        if (data.type === 'complete') finish(null, data.result);
        if (data.type === 'error') finish(new Error(data.message));
      };
      timer = setTimeout(() => finish(new Error('处理超过两分钟，请减少文件或页数后重试。')), 120_000);
      worker.postMessage({ ...payload, type });
    } catch (cause) { finish(cause); }
  });
}
