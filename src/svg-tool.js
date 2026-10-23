import { SVG_MAX_BYTES, svgByteLength, initialPNGSize, validatePNGSize, containSVG, svgFilename, svgSavings } from './lib/svg.js';
import { SVG_SAMPLE } from './svg-sample.js';

export function initSVG({ notify }) {
  const $ = id => document.getElementById(id);
  let output = null, filename = 'image.svg', version = 0, fileVersion = 0, opened = false, workerJob = null;
  let previewController = null, pngController = null, previewURLs = [], pngBusy = false;
  const downloadURLs = new Set();
  const error = (id, message = '') => { $(id).textContent = message; $(id).hidden = !message; };
  function sizeLabel(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`; }
  function releasePreviews() {
    for (const id of ['svg-before', 'svg-after']) { $(id).removeAttribute('src'); $(id).hidden = true; }
    previewURLs.forEach(url => URL.revokeObjectURL(url)); previewURLs = [];
  }
  function setBusy(busy) {
    $('svg-run').disabled = busy; $('svg-run').textContent = busy ? '正在优化…' : '优化 SVG';
    $('svg-stop').hidden = !busy; $('svg-input-panel').setAttribute('aria-busy', String(busy));
  }
  function invalidate(message = '内容已更新，点击「优化 SVG」查看结果。') {
    version++; workerJob?.cancel(); workerJob = null; previewController?.abort(); pngController?.abort();
    output = null; pngBusy = false; releasePreviews(); setBusy(false);
    for (const id of ['svg-width', 'svg-height', 'svg-lock', 'svg-scale-1', 'svg-scale-2', 'svg-scale-4']) $(id).disabled = true;
    $('svg-png').textContent = '导出 PNG'; $('svg-export-meta').textContent = '优化后可设置导出尺寸';
    $('svg-before-empty').hidden = $('svg-after-empty').hidden = false;
    $('svg-source-size').textContent = $('svg-result-size').textContent = '—';
    $('svg-saved').textContent = '等待优化'; $('svg-saved').classList.remove('svg-size-growth');
    $('svg-geometry').textContent = 'SVG / PNG'; $('svg-output').value = '';
    $('svg-copy').disabled = $('svg-download').disabled = $('svg-png').disabled = true;
    $('svg-status').textContent = message; $('svg-note').hidden = true;
    error('svg-error'); error('svg-export-error');
    $('svg-input-count').textContent = sizeLabel(svgByteLength($('svg-input').value));
  }
  function process(source, options) {
    let worker, timer, done = false, settle;
    const job = { cancel: () => settle?.(new DOMException('任务已取消', 'AbortError')) };
    job.promise = new Promise((resolve, reject) => {
      settle = (error, result) => {
        if (done) return; done = true; clearTimeout(timer); worker?.terminate();
        if (error) reject(error); else resolve(result);
      };
      try {
        worker = new Worker(new URL('./svg-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => settle(data.error ? new Error(data.error) : null, data.result);
        worker.onerror = () => settle(new Error('优化线程加载失败，请刷新页面或更新浏览器后重试。'));
        timer = setTimeout(() => settle(new Error('SVG 处理耗时过长，请减少路径或节点后重试。')), 20_000);
        worker.postMessage({ source, options });
      } catch { settle(new Error('当前浏览器无法启动 SVG 优化，请更新浏览器后重试。')); }
    });
    return job;
  }
  // This XML document stays detached. User markup is never inserted into the page DOM.
  function svgAtSize(source, width, height) {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') throw new Error('SVG 无法生成图片，请检查源码。');
    const root = document.documentElement;
    root.setAttribute('width', String(width)); root.setAttribute('height', String(height));
    return new XMLSerializer().serializeToString(root);
  }
  function loadImage(url, signal) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const finish = (error) => {
        clearTimeout(timer); signal?.removeEventListener('abort', aborted); image.onload = image.onerror = null;
        if (error) { image.src = ''; reject(error); } else resolve(image);
      };
      const aborted = () => finish(new DOMException('任务已取消', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('SVG 图片读取超时，请精简滤镜或路径后重试。')), 12_000);
      image.onload = () => finish(); image.onerror = () => finish(new Error('SVG 无法显示，请检查文件是否完整，以及图片资源是否已内嵌。'));
      if (signal?.aborted) { aborted(); return; }
      signal?.addEventListener('abort', aborted, { once: true }); image.src = url;
    });
  }
  async function run() {
    invalidate('正在优化 SVG，并准备前后预览…');
    const ticket = version, source = $('svg-input').value;
    if (!source.trim()) { error('svg-error', '请上传 SVG 文件，或粘贴完整的 SVG 源码。'); $('svg-status').textContent = '等待 SVG 内容'; return; }
    if (svgByteLength(source) > SVG_MAX_BYTES) { error('svg-error', 'SVG 文件不能超过 5 MB。'); return; }
    setBusy(true);
    const localURLs = [];
    const controller = new AbortController(); previewController = controller;
    try {
      workerJob = process(source, { precision: Number($('svg-precision').value), keepIds: $('svg-keep-ids').checked });
      const result = await workerJob.promise;
      if (ticket !== version) return;
      const ratio = Math.min(1, 900 / Math.max(result.dimensions.width, result.dimensions.height));
      const width = Math.max(1, Math.round(result.dimensions.width * ratio)), height = Math.max(1, Math.round(result.dimensions.height * ratio));
      for (const data of [result.source, result.data]) localURLs.push(URL.createObjectURL(new Blob([svgAtSize(data, width, height)], { type: 'image/svg+xml' })));
      const images = await Promise.all(localURLs.map(url => loadImage(url, controller.signal)));
      if (ticket !== version) { images.forEach(image => { image.src = ''; }); return; }
      output = { ...result, filename }; previewURLs = localURLs.splice(0);
      for (const id of ['svg-width', 'svg-height', 'svg-lock', 'svg-scale-1', 'svg-scale-2', 'svg-scale-4']) $(id).disabled = false;
      ['svg-before', 'svg-after'].forEach((id, index) => { $(id).src = previewURLs[index]; $(id).hidden = false; images[index].src = ''; });
      $('svg-before-empty').hidden = $('svg-after-empty').hidden = true;
      $('svg-source-size').textContent = sizeLabel(result.originalBytes); $('svg-result-size').textContent = sizeLabel(result.outputBytes);
      const saved = svgSavings(result.originalBytes, result.outputBytes);
      $('svg-saved').textContent = saved.bytes >= 0 ? `节省 ${sizeLabel(saved.bytes)} · ${saved.percent.toFixed(1)}%` : `增加 ${sizeLabel(-saved.bytes)} · 已规范化画布`;
      $('svg-saved').classList.toggle('svg-size-growth', saved.bytes < 0);
      $('svg-geometry').textContent = `${Number(result.dimensions.width.toFixed(2))} × ${Number(result.dimensions.height.toFixed(2))}`;
      $('svg-output').value = result.data; $('svg-copy').disabled = $('svg-download').disabled = false;
      const initial = initialPNGSize(result.dimensions);
      $('svg-width').value = initial.width; $('svg-height').value = initial.height;
      $('svg-status').textContent = '优化完成，可对照预览后下载。';
      const notes = [];
      if (result.hasText) notes.push('图片含有文字，显示依赖本机字体；用于印刷或跨设备分享时建议先转曲。');
      if (result.hasImages) notes.push('图片含有内嵌位图；导出大尺寸 PNG 时，位图部分不会增加细节。');
      if (saved.bytes < 0) notes.push('为保证独立显示和缩放，补齐了画布信息；文件体积可能略有增加。');
      $('svg-note').textContent = notes.join(' '); $('svg-note').hidden = !notes.length;
      updateExport();
    } catch (cause) {
      if (ticket !== version || cause.name === 'AbortError') return;
      error('svg-error', cause.message); $('svg-status').textContent = '请调整 SVG 内容后重试。';
    } finally {
      localURLs.forEach(url => URL.revokeObjectURL(url));
      if (ticket === version) { workerJob = null; previewController = null; setBusy(false); }
    }
  }
  function updateExport(clearError = true) {
    const color = $('svg-background').value === 'color'; $('svg-color').disabled = !color;
    document.querySelectorAll('.svg-preview-stage').forEach(stage => { stage.classList.toggle('svg-solid-background', color); stage.style.backgroundColor = color ? $('svg-color').value : ''; });
    if (!output) { $('svg-png').disabled = true; return; }
    try {
      const { width, height } = validatePNGSize(Number($('svg-width').value), Number($('svg-height').value));
      $('svg-export-meta').textContent = `${width} × ${height} px · ${color ? '自选底色' : '透明背景'}`;
      $('svg-png').disabled = pngBusy; if (clearError) error('svg-export-error');
    } catch (cause) { $('svg-png').disabled = true; $('svg-export-meta').textContent = '请调整导出尺寸'; error('svg-export-error', cause.message); }
  }
  function resize(changed) {
    if (output && $('svg-lock').checked) {
      const value = Number($(changed).value);
      if (Number.isInteger(value) && value > 0) {
        const { width, height } = output.dimensions;
        $(changed === 'svg-width' ? 'svg-height' : 'svg-width').value = Math.max(1, Math.round(value * (changed === 'svg-width' ? height / width : width / height)));
      }
    }
    updateExport();
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    downloadURLs.add(url); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloadURLs.delete(url); }, 30_000);
  }
  async function exportPNG() {
    if (!output || pngBusy) return;
    const snapshot = output, controller = new AbortController(); pngController = controller;
    let url, image, canvas;
    try {
      const { width, height } = validatePNGSize(Number($('svg-width').value), Number($('svg-height').value));
      const background = $('svg-background').value === 'color' ? $('svg-color').value : null;
      pngBusy = true; updateExport(); $('svg-png').textContent = '正在导出…';
      const rect = containSVG(snapshot.dimensions.width, snapshot.dimensions.height, width, height);
      url = URL.createObjectURL(new Blob([svgAtSize(snapshot.data, Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)))], { type: 'image/svg+xml' }));
      image = await loadImage(url, controller.signal);
      if (output !== snapshot || controller.signal.aborted) return;
      canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器无法导出 PNG，请更新浏览器后重试。');
      if (background) { context.fillStyle = background; context.fillRect(0, 0, width, height); }
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (output !== snapshot || controller.signal.aborted) return;
      if (!blob) throw new Error('PNG 导出失败，请调小尺寸后重试。');
      download(blob, svgFilename(snapshot.filename, 'png')); notify('PNG 已导出');
    } catch (cause) { if (output === snapshot && cause.name !== 'AbortError') error('svg-export-error', cause.message); }
    finally {
      if (url) URL.revokeObjectURL(url); if (image) image.src = ''; if (canvas) canvas.width = canvas.height = 0;
      if (pngController === controller) { pngController = null; pngBusy = false; $('svg-png').textContent = '导出 PNG'; updateExport(false); }
    }
  }
  async function load(file) {
    if (!file) return;
    const ticket = ++fileVersion;
    invalidate('正在读取 SVG 文件…');
    try {
      if (file.size > SVG_MAX_BYTES) throw new Error('SVG 文件不能超过 5 MB。');
      if (!/\.svg$/i.test(file.name)) throw new Error('请选择 .svg 文件。');
      const source = await file.text();
      if (ticket !== fileVersion) return;
      filename = file.name; $('svg-filename').textContent = filename; $('svg-input').value = source; run();
    } catch (cause) { if (ticket === fileVersion) { error('svg-error', cause.message); $('svg-status').textContent = '文件读取未成功，请重新选择。'; } }
  }
  $('svg-file').addEventListener('change', () => { const file = $('svg-file').files[0]; $('svg-file').value = ''; load(file); });
  let dragDepth = 0;
  const drop = $('svg-drop');
  drop.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; drop.classList.add('drag-over'); });
  drop.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  drop.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('drag-over'); } });
  drop.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; drop.classList.remove('drag-over'); if (event.dataTransfer.files.length !== 1) { error('svg-error', '请一次选择一个 SVG 文件。'); return; } load(event.dataTransfer.files[0]); });
  $('svg-input').addEventListener('input', () => { fileVersion++; invalidate(); });
  ['svg-precision', 'svg-keep-ids'].forEach(id => $(id).addEventListener('change', () => invalidate('设置已更新，请重新优化 SVG。')));
  $('svg-run').addEventListener('click', run);
  $('svg-stop').addEventListener('click', () => invalidate('已停止处理，可以调整内容后重试。'));
  function sample() { fileVersion++; filename = 'sgao-landscape.svg'; $('svg-filename').textContent = filename; $('svg-input').value = SVG_SAMPLE; run(); }
  $('svg-sample').addEventListener('click', sample);
  $('svg-clear').addEventListener('click', () => { fileVersion++; $('svg-input').value = ''; filename = 'image.svg'; $('svg-filename').textContent = '粘贴或上传 SVG'; invalidate('等待 SVG 内容'); $('svg-input').focus(); });
  $('svg-download').addEventListener('click', () => { if (output) { download(new Blob([output.data], { type: 'image/svg+xml;charset=utf-8' }), svgFilename(output.filename)); notify('优化后的 SVG 已下载'); } });
  $('svg-copy').addEventListener('click', async () => { if (!output) return; try { await navigator.clipboard.writeText(output.data); notify('SVG 源码已复制'); } catch { $('svg-code-details').open = true; $('svg-output').focus(); $('svg-output').select(); notify('请手动复制已选中的 SVG 源码。'); } });
  ['svg-width', 'svg-height'].forEach(id => $(id).addEventListener('input', () => resize(id)));
  $('svg-lock').addEventListener('change', () => { if ($('svg-lock').checked) resize('svg-width'); });
  ['svg-background', 'svg-color'].forEach(id => $(id).addEventListener('input', updateExport));
  for (const scale of [1, 2, 4]) $(`svg-scale-${scale}`).addEventListener('click', () => { if (!output) return; $('svg-width').value = Math.max(1, Math.round(output.dimensions.width * scale)); $('svg-height').value = Math.max(1, Math.round(output.dimensions.height * scale)); updateExport(); });
  $('svg-png').addEventListener('click', exportPNG);
  function open() { if (document.body.dataset.page === 'svg' && !opened) { opened = true; sample(); } }
  window.addEventListener('pagehide', () => { fileVersion++; invalidate('等待 SVG 内容'); downloadURLs.forEach(url => URL.revokeObjectURL(url)); downloadURLs.clear(); });
  window.addEventListener('pageshow', event => { if (event.persisted && document.body.dataset.page === 'svg' && $('svg-input').value.trim()) run(); });
  open();
}
