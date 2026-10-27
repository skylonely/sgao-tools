import { encodeImagePDF } from './image-pdf-engine.js';
self.onmessage = async ({ data }) => {
  try {
    const blob = await encodeImagePDF(data.items, data.options, {
      onProgress: (done, total, text) => self.postMessage({ type: 'progress', done, total, text }),
      onPage: page => self.postMessage({ type: 'page', page }),
    });
    self.postMessage({ type: 'result', blob });
  } catch (error) { self.postMessage({ type: 'error', message: error.message || 'PDF 生成失败，请调整图片尺寸后重试。' }); }
};
