import jsQR from './vendor/jsqr.js';

self.onmessage = ({ data: { pixels, width, height } }) => {
  try {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 9_000_000 || pixels.length !== width * height * 4) throw new Error('识别图片尺寸无效。');
    const result = jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' });
    self.postMessage({ content: result ? result.data : null });
  } catch { self.postMessage({ error: '图片识别失败，请使用更清晰的二维码图片重试。' }); }
};
