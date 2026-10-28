const PREFIX = 'sgao-crop-transfer';
const validToken = token => typeof token === 'string' && /^[a-f0-9-]{36}$/.test(token);

// One-use, same-origin window messages: images are never written to browser storage.
function sendProcessedImage(file, path) {
  return new Promise((resolve, reject) => {
    const token = crypto.randomUUID(); let popup, timer;
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); window.removeEventListener('pagehide', abandon); };
    const abandon = () => { cleanup(); reject(new Error('图片传递已结束。')); };
    function receive(event) {
      if (event.origin !== location.origin || event.source !== popup || event.data?.token !== token) return;
      if (event.data.type === `${PREFIX}:ready`) popup.postMessage({ type: `${PREFIX}:file`, token, file }, location.origin);
      if (event.data.type === `${PREFIX}:received`) { cleanup(); resolve(); }
    }
    window.addEventListener('message', receive); window.addEventListener('pagehide', abandon, { once: true });
    popup = window.open(`${path}#crop-transfer=${token}`, '_blank');
    if (!popup) { cleanup(); reject(new Error('浏览器阻止了新标签页。请允许打开后重试，或下载图片后在目标工具中选择文件。')); return; }
    timer = setTimeout(() => { cleanup(); reject(new Error('图片传递超时，请重试，或下载后在目标工具中选择文件。')); }, 20_000);
  });
}
export const sendToCompressor = file => sendProcessedImage(file, '/image-compressor/');
export const sendToWatermark = file => sendProcessedImage(file, '/image-watermark/');
export const sendToOCR = file => sendProcessedImage(file, '/image-to-text/');

export function receiveProcessedImage(onFile, onError) {
  if (!location.hash.startsWith('#crop-transfer=')) return;
  const token = location.hash.slice('#crop-transfer='.length), sender = window.opener;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  if (!validToken(token) || !sender) { onError('未收到图片，请从来源工具重新发送，或手动选择文件。'); return; }
  let interval, timer;
  const cleanup = () => { clearInterval(interval); clearTimeout(timer); window.removeEventListener('message', receive); window.removeEventListener('pagehide', cleanup); };
  function receive(event) {
    if (event.origin !== location.origin || event.source !== sender || event.data?.type !== `${PREFIX}:file` || event.data.token !== token) return;
    cleanup();
    const file = event.data.file;
    if (!(file instanceof File) || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) { onError('收到的图片无效或超过 20 MB，请重新导出。'); return; }
    onFile(file); sender.postMessage({ type: `${PREFIX}:received`, token }, location.origin);
    window.opener = null;
  }
  window.addEventListener('message', receive); window.addEventListener('pagehide', cleanup, { once: true });
  const ready = () => sender.postMessage({ type: `${PREFIX}:ready`, token }, location.origin);
  interval = setInterval(ready, 500);
  timer = setTimeout(() => { cleanup(); onError('未收到图片，请重试，或手动选择文件。'); window.opener = null; }, 20_000);
  ready();
}
// Keep existing crop/compressor imports and bookmarked transfer URLs compatible.
export const receiveCropFile = receiveProcessedImage;
