import { stampPDF } from './pdf-watermark-engine.js';
let pending, requestID = 0;
self.onmessage = async ({ data }) => {
  if (data.type === 'overlay') { if (pending?.id === data.id) { const reply = pending; pending = null; reply.resolve(data.layer); } return; }
  if (data.type !== 'start') return;
  try {
    const result = await stampPDF(data.file, data.options, {
      onProgress: (done, total, text) => self.postMessage({ type: 'progress', done, total, text }),
      onOverlay: item => new Promise(resolve => { pending = { id: ++requestID, resolve }; self.postMessage({ type: 'overlay', id: pending.id, item }); }),
    });
    self.postMessage({ type: 'result', result });
  } catch (cause) { self.postMessage({ type: 'error', message: cause.message || '添加水印失败，请调整设置后重试。' }); }
};
