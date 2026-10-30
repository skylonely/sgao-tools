export function runRegex(request, { signal, workerFactory = url => new Worker(url, { type: 'module' }), timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    let worker, timer, done = false;
    const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); worker?.terminate(); error ? reject(error) : resolve(result); };
    const stop = () => finish(new DOMException('正则处理已停止', 'AbortError'));
    if (signal?.aborted) { stop(); return; }
    try {
      worker = workerFactory(new URL('./regex-worker.js', import.meta.url)); signal?.addEventListener('abort', stop, { once: true });
      worker.onmessage = ({ data }) => { if (data?.error) finish(new Error(data.error)); else if (data?.result) finish(null, data.result); };
      worker.onerror = event => { event.preventDefault?.(); finish(new Error('正则处理线程加载失败，请刷新后重试。')); };
      worker.onmessageerror = () => finish(new Error('正则结果读取失败，请重试。'));
      timer = setTimeout(() => { const error = new Error('处理超过 3 秒，已终止本次任务。请缩小文本或调整表达式后重试。'); error.name = 'TimeoutError'; finish(error); }, timeout);
      worker.postMessage(request);
    } catch (error) { finish(error); }
  });
}
