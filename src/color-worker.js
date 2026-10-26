import { extractPalette } from './lib/colors.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ colors: extractPalette(data.pixels, data.count) }); }
  catch (cause) { self.postMessage({ error: cause.message || '配色提取失败。' }); }
};
