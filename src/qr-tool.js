import { buildQRContent, byteLength, makeQRCode, paintQRCode, qrSVG, safeQRLink } from './lib/qrcode.js';

export function initQRCode({ notify }) {
  const $ = id => document.getElementById(id);
  let type = 'url', output = null, logo = null, logoData = '', generation = 0, scanVersion = 0, logoVersion = 0;
  let debounce, generationJob, scanJob, hasOpened = false, scanContent = '';
  const jobs = new Set();
  const setError = (id, message = '') => { $(id).textContent = message; $(id).hidden = !message; };

  function decode(pixels, width, height) {
    let worker, timer, settled = false, finish;
    const job = { cancel: () => finish?.(new DOMException('任务已取消', 'AbortError')) };
    job.promise = new Promise((resolve, reject) => {
      finish = (error, content) => {
        if (settled) return;
        settled = true; clearTimeout(timer); worker?.terminate(); jobs.delete(job);
        if (error) reject(error); else resolve(content);
      };
      jobs.add(job);
      try {
        worker = new Worker(new URL('./qr-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.content);
        worker.onerror = () => finish(new Error('识别线程加载失败，请刷新页面或更新浏览器后重试。'));
        timer = setTimeout(() => finish(new Error('识别耗时过长，请裁剪到二维码区域后重试。')), 20_000);
        worker.postMessage({ pixels, width, height }, [pixels.buffer]);
      } catch { finish(new Error('当前浏览器无法启动二维码识别，请更新浏览器后重试。')); }
    });
    return job;
  }

  function clearOutput(message = '填写内容，生成你的二维码') {
    output = null;
    $('qr-preview').hidden = true; $('qr-empty').hidden = false;
    $('qr-preview-status').textContent = message;
    $('qr-download-png').disabled = $('qr-download-svg').disabled = true;
    $('qr-output-meta').textContent = 'PNG / SVG';
  }
  function invalidate() {
    generation++; clearTimeout(debounce); generationJob?.cancel(); generationJob = null;
    clearOutput('内容已更新，正在准备新二维码…'); setError('qr-error');
    $('qr-generate').disabled = false; $('qr-generate').textContent = '生成二维码';
  }
  function requestGeneration() {
    invalidate(); updateCount(); debounce = setTimeout(generate, 320);
  }
  function updateCount() {
    const value = type === 'wifi' ? $('qr-ssid').value + ($('qr-security').value === 'nopass' ? '' : $('qr-password').value) : $('qr-content').value;
    $('qr-byte-count').textContent = `${byteLength(value)} / 1200 B`;
  }
  function settings() {
    return { foreground: $('qr-foreground').value, background: $('qr-background').value, size: Number($('qr-size').value), level: $('qr-level').value, logo };
  }
  async function generate() {
    clearTimeout(debounce); generationJob?.cancel();
    const ticket = ++generation;
    clearOutput('正在生成并校验可识别性…'); setError('qr-error');
    $('qr-generate').disabled = true; $('qr-generate').textContent = '正在生成…';
    try {
      const content = buildQRContent({ type, text: $('qr-content').value, ssid: $('qr-ssid').value, password: $('qr-password').value, security: $('qr-security').value, hidden: $('qr-hidden').checked });
      const options = settings(), snapshotLogoData = logoData;
      const qr = makeQRCode(content, options);
      const canvas = document.createElement('canvas');
      const context = paintQRCode(canvas, qr, options);
      generationJob = decode(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      const readback = await generationJob.promise;
      if (ticket !== generation) return;
      if (readback !== content) throw new Error('当前二维码未通过识别校验。请移除 Logo、使用黑白配色或减少内容后重试。');
      const preview = $('qr-preview'); preview.width = canvas.width; preview.height = canvas.height;
      preview.getContext('2d').drawImage(canvas, 0, 0);
      output = { canvas, svg: qrSVG(qr, { ...options, logoData: snapshotLogoData }) };
      preview.hidden = false; $('qr-empty').hidden = true;
      $('qr-preview-status').textContent = `✓ 已通过本地识别校验 · ${options.logo ? 'Logo 已启用高容错' : '保留完整扫码留白'}`;
      $('qr-output-meta').textContent = `${canvas.width} × ${canvas.height} px`;
      $('qr-download-png').disabled = $('qr-download-svg').disabled = false;
    } catch (error) {
      if (ticket !== generation || error.name === 'AbortError') return;
      clearOutput('调整内容或设置后，再试一次'); setError('qr-error', error.message);
    } finally {
      if (ticket === generation) { generationJob = null; $('qr-generate').disabled = false; $('qr-generate').textContent = '生成二维码'; }
    }
  }

  function changeType(next) {
    type = next;
    document.querySelectorAll('[data-qr-type]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.qrType === type)));
    $('qr-text-fields').hidden = type === 'wifi'; $('qr-wifi-fields').hidden = type !== 'wifi';
    $('qr-content-label').textContent = type === 'url' ? '网址链接' : '文字内容';
    $('qr-content').placeholder = type === 'url' ? 'https://example.com' : '输入文字，支持中文、表情和换行…';
    $('qr-content-help').textContent = type === 'url' ? '输入完整网址，扫码即可打开。' : '文字会原样写入二维码，内容越简短越容易扫描。';
    if (type === 'text' && $('qr-content').value === 'https://sgao.cc') $('qr-content').value = '你好，SGAO！\n让分享，顺手一点。';
    if (type === 'url' && !safeQRLink($('qr-content').value)) $('qr-content').value = 'https://sgao.cc';
    requestGeneration();
  }
  document.querySelectorAll('[data-qr-type]').forEach(button => button.addEventListener('click', () => changeType(button.dataset.qrType)));
  ['qr-content', 'qr-ssid', 'qr-password'].forEach(id => $(id).addEventListener('input', requestGeneration));
  ['qr-foreground', 'qr-background', 'qr-size', 'qr-level', 'qr-hidden'].forEach(id => $(id).addEventListener(id.includes('ground') ? 'input' : 'change', requestGeneration));
  $('qr-security').addEventListener('change', () => { $('qr-password').disabled = $('qr-password-toggle').disabled = $('qr-security').value === 'nopass'; requestGeneration(); });
  $('qr-password-toggle').addEventListener('click', () => {
    const shown = $('qr-password').type === 'password'; $('qr-password').type = shown ? 'text' : 'password';
    $('qr-password-toggle').textContent = shown ? '隐藏' : '显示'; $('qr-password-toggle').setAttribute('aria-label', shown ? '隐藏 Wi-Fi 密码' : '显示 Wi-Fi 密码');
  });
  $('qr-generate').addEventListener('click', generate);
  $('qr-example').addEventListener('click', () => {
    if (type === 'wifi') { $('qr-ssid').value = 'SGAO Guest'; $('qr-password').value = 'hello-sgao-2026'; $('qr-security').value = 'WPA'; $('qr-password').disabled = $('qr-password-toggle').disabled = false; }
    else $('qr-content').value = type === 'url' ? 'https://sgao.cc' : '你好，SGAO！\n让分享，顺手一点。';
    invalidate(); updateCount(); generate();
  });
  $('qr-clear').addEventListener('click', () => {
    invalidate(); $('qr-content').value = $('qr-ssid').value = $('qr-password').value = ''; updateCount();
    clearOutput(); (type === 'wifi' ? $('qr-ssid') : $('qr-content')).focus();
  });
  function updateLogoUI() {
    $('qr-logo-remove').hidden = !logo;
    $('qr-level').disabled = Boolean(logo);
    $('qr-level-note').textContent = logo ? '添加 Logo 后自动使用高容错。' : '默认均衡；高容错适合打印或遮挡。';
    if (logo) $('qr-level').value = 'H';
  }
  $('qr-logo').addEventListener('change', async () => {
    const file = $('qr-logo').files[0]; $('qr-logo').value = '';
    if (!file) return;
    const ticket = ++logoVersion;
    invalidate(); $('qr-generate').disabled = true; $('qr-preview-status').textContent = '正在读取 Logo…';
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Logo 不能超过 2 MB。');
      if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error('Logo 支持 PNG、JPG、WebP 图片。');
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      try {
        if (bitmap.width * bitmap.height > 16_000_000) throw new Error('Logo 分辨率过大，请选择不超过 1600 万像素的图片。');
        if (ticket !== logoVersion) return;
        const canvas = document.createElement('canvas'), scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        logo = canvas; logoData = canvas.toDataURL('image/png'); $('qr-logo-name').textContent = file.name;
      } finally { bitmap.close(); }
      if (ticket === logoVersion) { updateLogoUI(); generate(); }
    } catch (error) {
      if (ticket === logoVersion) { setError('qr-error', error.message === 'The source image could not be decoded.' ? 'Logo 无法读取，请换一张有效图片。' : error.message); $('qr-generate').disabled = false; clearOutput('Logo 读取失败，请重试'); }
    }
  });
  $('qr-logo-remove').addEventListener('click', () => {
    logoVersion++; logo = null; logoData = ''; $('qr-logo-name').textContent = '可选 · PNG / JPG / WebP ≤ 2 MB'; updateLogoUI(); requestGeneration();
  });

  function download(blob, name) {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  $('qr-download-png').addEventListener('click', () => {
    const snapshot = output;
    if (snapshot) snapshot.canvas.toBlob(blob => { if (blob) { download(blob, 'sgao-qrcode.png'); notify('PNG 二维码已下载'); } else notify('图片导出失败，请重试。'); }, 'image/png');
  });
  $('qr-download-svg').addEventListener('click', () => { if (output) { download(new Blob([output.svg], { type: 'image/svg+xml;charset=utf-8' }), 'sgao-qrcode.svg'); notify('SVG 二维码已下载'); } });

  function resetScan() {
    scanVersion++; scanJob?.cancel(); scanJob = null; scanContent = '';
    $('qr-scan-result').value = ''; $('qr-scan-copy').disabled = true; $('qr-scan-clear').disabled = true;
    $('qr-scan-open').hidden = true; $('qr-scan-open').removeAttribute('href'); $('qr-scan-meta').textContent = '等待图片';
    $('qr-scan-status').textContent = '上传包含二维码的截图或照片，自动识别其中一枚二维码。';
    setError('qr-scan-error');
  }
  async function scan(file) {
    resetScan();
    if (!file) return;
    const ticket = scanVersion;
    $('qr-scan-clear').disabled = false; $('qr-scan-meta').textContent = '正在识别…';
    $('qr-scan-status').textContent = `正在读取 ${file.name}…`;
    let bitmap;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('识别图片不能超过 20 MB。');
      if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error('请选择 PNG、JPG 或 WebP 图片。');
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (ticket !== scanVersion) return;
      if (bitmap.width * bitmap.height > 32_000_000 || Math.max(bitmap.width, bitmap.height) > 10000) throw new Error('识别图片不能超过 3200 万像素，单边不能超过 10000 像素。');
      let content = null;
      for (const edge of [1600, 2800]) {
        const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        scanJob = decode(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        content = await scanJob.promise;
        if (ticket !== scanVersion) return;
        if (content !== null || scale === 1) break;
      }
      if (content === null) throw new Error('没有找到可识别的二维码。请上传更清晰的图片，或先裁剪掉二维码周围的大块空白。');
      scanContent = content; $('qr-scan-result').value = content; $('qr-scan-copy').disabled = false;
      const link = safeQRLink(content);
      $('qr-scan-open').hidden = !link; if (link) $('qr-scan-open').href = link;
      $('qr-scan-meta').textContent = content.startsWith('WIFI:') ? 'Wi-Fi 配置' : link ? '网址链接' : '文字内容';
      $('qr-scan-status').textContent = `已识别 · ${file.name} · ${byteLength(content)} 字节`;
    } catch (error) {
      if (ticket !== scanVersion || error.name === 'AbortError') return;
      $('qr-scan-meta').textContent = '识别未成功'; $('qr-scan-status').textContent = '可以换一张图片继续识别。';
      setError('qr-scan-error', error.message === 'The source image could not be decoded.' ? '图片无法读取，请选择有效的二维码图片。' : error.message);
    } finally { bitmap?.close(); if (ticket === scanVersion) scanJob = null; }
  }
  $('qr-scan-file').addEventListener('change', () => { const file = $('qr-scan-file').files[0]; $('qr-scan-file').value = ''; if (file) scan(file); });
  const drop = $('qr-scan-drop');
  ['dragenter', 'dragover'].forEach(event => drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(event => drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('drag-over'); }));
  drop.addEventListener('drop', event => { const file = event.dataTransfer.files[0]; if (file) scan(file); });
  $('qr-scan-clear').addEventListener('click', resetScan);
  $('qr-scan-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(scanContent); notify('识别内容已复制'); }
    catch { $('qr-scan-result').focus(); $('qr-scan-result').select(); notify('请手动复制已选中的识别内容。'); }
  });
  function open() { if (location.hash === '#qrcode' && !hasOpened) { hasOpened = true; updateCount(); generate(); } }
  window.addEventListener('hashchange', open);
  window.addEventListener('pagehide', () => { clearTimeout(debounce); generation++; scanVersion++; logoVersion++; jobs.forEach(job => job.cancel()); });
  window.addEventListener('pageshow', event => { if (event.persisted && location.hash === '#qrcode' && !output) generate(); });
  open();
}
