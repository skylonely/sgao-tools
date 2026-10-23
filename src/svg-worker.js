import { optimizeSVG } from './svg-optimizer.js';

self.onmessage = ({ data }) => {
  try { self.postMessage({ result: optimizeSVG(data.source, data.options) }); }
  catch (error) { self.postMessage({ error: error.message || 'SVG 优化失败，请检查文件后重试。' }); }
};
