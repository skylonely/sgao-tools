import { inspectOrganizerPDF, assembleOrganizerPDF } from './pdf-organizer-engine.js';
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'inspect') self.postMessage({ type: 'complete', result: await inspectOrganizerPDF(data.file) });
    else if (data.type === 'build') {
      await assembleOrganizerPDF(data.sources, data.pages, data.options, {
        onProgress: (done, total, text) => self.postMessage({ type: 'progress', done, total, text }),
        onResult: result => self.postMessage({ type: 'result', result }),
      });
      self.postMessage({ type: 'complete' });
    } else throw new Error('未知的 PDF 操作。');
  } catch (cause) { self.postMessage({ type: 'error', message: cause.message || 'PDF 处理失败，请减少文件后重试。' }); }
};
