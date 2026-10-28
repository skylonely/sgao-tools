export function runPDFWatermark(file, options, { signal, onOverlay, onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let worker, timer, ended = false;
    const finish = (cause, result) => { if (ended) return; ended = true; clearTimeout(timer); worker?.terminate(); signal?.removeEventListener('abort', stop); cause ? reject(cause) : resolve(result); };
    const stop = () => finish(new DOMException('本次处理已停止', 'AbortError'));
    if (signal?.aborted) { stop(); return; }
    try {
      worker = new Worker(new URL('./pdf-watermark-worker.js', import.meta.url), { type: 'module' });
      signal?.addEventListener('abort', stop, { once: true });
      worker.onerror = event => { event.preventDefault(); finish(new Error('后台处理失败，请刷新页面或换用新版浏览器。')); };
      worker.onmessage = async ({ data }) => {
        if (ended) return;
        try {
          if (data.type === 'overlay') { const layer = await onOverlay(data.item); if (!ended) worker.postMessage({ type: 'overlay', id: data.id, layer }); }
          if (data.type === 'progress') onProgress(data.done, data.total, data.text);
          if (data.type === 'result') finish(null, data.result);
          if (data.type === 'error') finish(new Error(data.message));
        } catch (cause) { finish(cause); }
      };
      timer = setTimeout(() => finish(new Error('处理超过两分钟，请减少平铺内容或先拆分文档。')), 120_000);
      worker.postMessage({ type: 'start', file, options });
    } catch (cause) { finish(cause); }
  });
}
