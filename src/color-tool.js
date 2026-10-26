import { colorValues, imagePoint, paletteCSS, paletteJSON, paletteFilename } from './lib/colors.js';
import { decodeColorImage, sampleImage, renderPaletteCard } from './color-engine.js';

export function initColor({ notify }) {
  const $ = id => document.getElementById(id);
  const pixel = document.createElement('canvas'); pixel.width = pixel.height = 1;
  const pixelContext = pixel.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  let image = null, filename = '', selected = null, point = null, colors = [], sampleSize = null;
  let loadVersion = 0, paletteVersion = 0, job = null, card = null, cardURL = '', pointerId = null;
  const downloads = new Set();
  const message = (id, text = '') => { $(id).textContent = text; $(id).hidden = !text; };
  const bytes = size => size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(2)} MB`;
  const setExportDisabled = disabled => { for (const id of ['color-css-copy', 'color-json', 'color-png']) $(id).disabled = disabled; };

  function stopWorker() {
    if (!job) return;
    const previous = job; job = null; previous.worker.terminate(); clearTimeout(previous.timer); previous.resolve(null);
  }
  function invalidatePalette() {
    paletteVersion++; stopWorker(); colors = []; sampleSize = null; card = null;
    if (cardURL) URL.revokeObjectURL(cardURL); cardURL = '';
    $('color-card-image').removeAttribute('src'); $('color-card-preview').hidden = true;
    $('color-palette').replaceChildren(); $('color-css').value = ''; setExportDisabled(true);
    message('color-palette-error');
  }
  function magnify(current) {
    if (!image) return;
    const ctx = $('color-loupe').getContext('2d', { colorSpace: 'srgb' });
    ctx.clearRect(0, 0, 110, 110); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, current.x - 5, current.y - 5, 11, 11, 0, 0, 110, 110);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(50, 50, 10, 10);
    ctx.strokeStyle = '#25262c'; ctx.lineWidth = 1; ctx.strokeRect(50.5, 50.5, 9, 9);
    $('color-loupe-position').textContent = `X ${current.x} / Y ${current.y}`;
  }
  function marker() {
    if (!image || !point) return;
    $('color-marker').style.left = `${(point.x + .5) / image.width * 100}%`;
    $('color-marker').style.top = `${(point.y + .5) / image.height * 100}%`;
  }
  function pick(current) {
    if (!image) return;
    try {
      pixelContext.clearRect(0, 0, 1, 1); pixelContext.drawImage(image, current.x, current.y, 1, 1, 0, 0, 1, 1);
      selected = colorValues(pixelContext.getImageData(0, 0, 1, 1).data); point = current;
      $('color-selected-swatch').style.backgroundColor = selected.rgb; $('color-selected-hex').textContent = selected.hex;
      for (const format of ['hex', 'rgb', 'hsl']) $(`color-${format}`).value = selected[format];
      $('color-alpha').textContent = `不透明度 ${Number((selected.a / 255 * 100).toFixed(1))}%`;
      $('color-x').value = point.x; $('color-y').value = point.y;
      $('color-position').textContent = `已选像素 · X ${point.x} / Y ${point.y}`;
      marker(); magnify(current); message('color-error');
    } catch { message('color-error', '当前浏览器无法读取图片像素，请重新选择图片或换用浏览器。'); }
  }
  function paintStage() {
    if (!image || !$('color-viewport').clientWidth) return;
    const viewport = $('color-viewport'), style = getComputedStyle(viewport);
    const width = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const scale = Math.min(width / image.width, height / image.height);
    const w = Math.max(1, image.width * scale), h = Math.max(1, image.height * scale);
    $('color-stage').style.width = `${w}px`; $('color-stage').style.height = `${h}px`;
    const canvas = $('color-canvas'), density = Math.min(devicePixelRatio || 1, 2, 1600 / w, 1600 / h);
    canvas.width = Math.max(1, Math.round(w * density)); canvas.height = Math.max(1, Math.round(h * density));
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' }); ctx.imageSmoothingEnabled = scale < 1; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height); marker();
  }
  function runExtraction(sample, count) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./color-worker.js', import.meta.url), { type: 'module' });
      const current = { worker, resolve, timer: null }; job = current;
      const finish = (error, result) => {
        if (job !== current) return;
        job = null; clearTimeout(current.timer); worker.terminate(); error ? reject(error) : resolve(result);
      };
      worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.colors);
      worker.onerror = () => finish(new Error('无法启动配色提取，请重试或换用新版浏览器。'));
      current.timer = setTimeout(() => finish(new Error('配色提取超时，请重试。')), 12_000);
      try { worker.postMessage({ pixels: sample.data, count }, [sample.data.buffer]); }
      catch { finish(new Error('无法传递配色抽样数据，请重新选择图片。')); }
    });
  }
  async function copy(text, fallback) {
    try { await navigator.clipboard.writeText(text); notify('已复制到剪贴板'); }
    catch {
      if (fallback) { const details = fallback.closest('details'); if (details) details.open = true; fallback.focus(); fallback.select(); }
      notify(fallback ? '已选中内容，请手动复制' : '无法访问剪贴板，请选中颜色值后手动复制');
    }
  }
  function paintPalette() {
    $('color-palette').style.setProperty('--color-count', colors.length);
    const fragment = document.createDocumentFragment();
    colors.forEach((color, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'color-swatch-card'; button.setAttribute('aria-label', `复制代表色 ${index + 1}：${color.hex}`);
      const swatch = document.createElement('span'); swatch.className = 'color-swatch-fill'; swatch.style.backgroundColor = color.hex;
      const code = document.createElement('strong'); code.textContent = color.hex;
      const share = document.createElement('small'); share.textContent = `≈ ${(color.fraction * 100).toFixed(1)}% · 复制`;
      button.append(swatch, code, share);
      button.addEventListener('click', () => copy(color.hex, null)); fragment.append(button);
    });
    $('color-palette').replaceChildren(fragment); $('color-css').value = paletteCSS(colors);
  }
  async function extract() {
    if (!image) return;
    invalidatePalette(); const ticket = paletteVersion, source = image, name = filename, requested = Number($('color-count').value);
    $('color-palette-status').textContent = '正在从画面中提取代表色…';
    try {
      const sample = sampleImage(source), dimensions = { width: sample.width, height: sample.height };
      const result = await runExtraction(sample, requested);
      if (ticket !== paletteVersion || source !== image || !result) return;
      colors = result; sampleSize = dimensions;
      if (!colors.length) { $('color-palette-status').textContent = '这张图片完全透明，没有可提取的代表色。仍可点击画面查看像素值。'; return; }
      paintPalette(); $('color-css-copy').disabled = $('color-json').disabled = false;
      $('color-palette-status').textContent = `已提取 ${colors.length} 个代表色${colors.length < requested ? '，相近颜色已合并' : ''}。点击色卡复制 HEX，比例为抽样估算。`;
      const blob = await renderPaletteCard(source, colors, name);
      if (ticket !== paletteVersion || source !== image) return;
      card = blob; cardURL = URL.createObjectURL(blob); $('color-card-image').src = cardURL;
      $('color-card-preview').hidden = false; $('color-png').disabled = false;
    } catch (cause) {
      if (ticket !== paletteVersion) return;
      message('color-palette-error', cause.message || '提取失败，请重试。');
      $('color-palette-status').textContent = colors.length ? '代表色已就绪，色卡图片生成失败，可重新提取。' : '配色提取失败，可点击「重新提取」重试。';
    }
  }
  function clear() {
    loadVersion++; invalidatePalette(); image?.close(); image = null; selected = point = null; pointerId = null;
    $('color-workspace').hidden = true; $('color-clear').disabled = true; $('color-drop').classList.remove('is-loaded');
    $('color-drop-title').textContent = '放进一张图片，发现它的颜色'; $('color-load-status').textContent = '无需登录，图片只在当前浏览器处理。';
    $('color-file').value = ''; $('color-canvas').width = $('color-canvas').height = 1; message('color-error');
  }
  async function load(file) {
    clear(); const ticket = loadVersion; $('color-clear').disabled = false; $('color-load-status').textContent = '正在读取图片…';
    try {
      const bitmap = await decodeColorImage(file);
      if (ticket !== loadVersion) { bitmap.close(); return; }
      image = bitmap; filename = file.name;
      $('color-source-name').textContent = filename; $('color-source-meta').textContent = `${image.width} × ${image.height} px · ${bytes(file.size)}`;
      $('color-x').max = image.width - 1; $('color-y').max = image.height - 1;
      $('color-workspace').hidden = false; $('color-drop').classList.add('is-loaded'); $('color-drop-title').textContent = '换一张图片，发现新的配色';
      $('color-load-status').textContent = '移动指针查看放大细节，点击或拖动锁定取色。';
      paintStage(); pick({ x: Math.floor(image.width / 2), y: Math.floor(image.height / 2) }); extract();
    } catch (cause) { if (ticket === loadVersion) { message('color-error', cause.message); $('color-load-status').textContent = '图片未载入，请重新选择。'; } }
  }
  const eventPoint = event => { const rect = $('color-stage').getBoundingClientRect(); return imagePoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, image.width, image.height); };
  const stage = $('color-stage');
  stage.addEventListener('pointerdown', event => {
    if (!image || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); pointerId = event.pointerId; stage.setPointerCapture(pointerId); stage.focus({ preventScroll: true }); pick(eventPoint(event));
  });
  stage.addEventListener('pointermove', event => { if (!image) return; if (event.pointerId === pointerId) pick(eventPoint(event)); else if (pointerId === null) magnify(eventPoint(event)); });
  const release = event => { if (event.pointerId !== pointerId) return; pointerId = null; if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId); };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(type, release);
  stage.addEventListener('pointerleave', () => { if (point && pointerId === null) magnify(point); });
  stage.addEventListener('keydown', event => {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction || !image || !point) return;
    event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 10 : 1;
    pick({ x: Math.max(0, Math.min(image.width - 1, point.x + direction[0] * step)), y: Math.max(0, Math.min(image.height - 1, point.y + direction[1] * step)) });
  });
  function updateCoordinates(showError) {
    if (!image || !point) return;
    const x = Number($('color-x').value), y = Number($('color-y').value);
    if (!$('color-x').value || !$('color-y').value || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= image.width || y >= image.height) {
      if (showError) { message('color-error', `坐标需为整数：X 0–${image.width - 1}，Y 0–${image.height - 1}。`); $('color-x').value = point.x; $('color-y').value = point.y; }
      return;
    }
    pick({ x, y });
  }
  for (const coordinate of ['x', 'y']) {
    $(`color-${coordinate}`).addEventListener('input', () => updateCoordinates(false));
    $(`color-${coordinate}`).addEventListener('change', () => updateCoordinates(true));
    $(`color-${coordinate}`).addEventListener('blur', () => updateCoordinates(true));
  }
  $('color-file').addEventListener('change', () => { const file = $('color-file').files[0]; $('color-file').value = ''; if (file) load(file); });
  let dragDepth = 0;
  $('color-drop').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('color-drop').classList.add('drag-over'); });
  $('color-drop').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  $('color-drop').addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('color-drop').classList.remove('drag-over'); } });
  $('color-drop').addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('color-drop').classList.remove('drag-over'); if (event.dataTransfer.files.length !== 1) { message('color-error', '请一次选择一张图片。'); return; } load(event.dataTransfer.files[0]); });
  $('color-clear').addEventListener('click', clear);
  $('color-count').addEventListener('change', extract); $('color-extract').addEventListener('click', extract);
  document.querySelectorAll('[data-color-copy]').forEach(button => button.addEventListener('click', () => { if (selected) copy(selected[button.dataset.colorCopy], $(`color-${button.dataset.colorCopy}`)); }));
  $('color-css-copy').addEventListener('click', () => { if (colors.length) copy(paletteCSS(colors), $('color-css')); });
  function download(blob, extension) {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); downloads.add(url);
    link.href = url; link.download = paletteFilename(filename, extension); document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 30_000);
  }
  $('color-json').addEventListener('click', () => { if (colors.length) download(new Blob([paletteJSON(colors, filename, sampleSize)], { type: 'application/json' }), 'json'); });
  $('color-png').addEventListener('click', () => { if (card) download(card, 'png'); });
  $('color-sample').addEventListener('click', async () => {
    clear(); const ticket = loadVersion; $('color-clear').disabled = false; $('color-load-status').textContent = '正在准备示例图片…';
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800; const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#F3D5B5'; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#FFF4DF'; ctx.beginPath(); ctx.arc(886, 230, 104, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#D9805A'; ctx.beginPath(); ctx.moveTo(0, 575); ctx.bezierCurveTo(310, 265, 410, 290, 720, 600); ctx.bezierCurveTo(960, 290, 1080, 360, 1200, 420); ctx.lineTo(1200, 800); ctx.lineTo(0, 800); ctx.fill();
    ctx.fillStyle = '#8C9C7A'; ctx.beginPath(); ctx.moveTo(0, 740); ctx.bezierCurveTo(300, 400, 490, 400, 780, 740); ctx.bezierCurveTo(1000, 510, 1110, 540, 1200, 650); ctx.lineTo(1200, 800); ctx.lineTo(0, 800); ctx.fill();
    ctx.fillStyle = '#315B54'; ctx.beginPath(); ctx.moveTo(0, 800); ctx.bezierCurveTo(420, 470, 700, 820, 1200, 680); ctx.lineTo(1200, 800); ctx.fill();
    ctx.fillStyle = '#2C3833'; ctx.font = '600 43px system-ui'; ctx.fillText('A LITTLE COLOR.', 70, 112); ctx.font = '18px system-ui'; ctx.fillText('SGAO / EVERYDAY INSPIRATION', 73, 151);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); canvas.width = canvas.height = 1;
    if (ticket !== loadVersion) return;
    if (blob) load(new File([blob], 'sgao-color-landscape.png', { type: 'image/png' })); else { message('color-error', '示例生成失败，请选择本地图片。'); $('color-load-status').textContent = '示例未载入。'; }
  });
  const observer = new ResizeObserver(paintStage); observer.observe($('color-viewport'));
  window.addEventListener('pagehide', event => {
    if (event.persisted) { paletteVersion++; stopWorker(); return; }
    loadVersion++; paletteVersion++; stopWorker(); image?.close(); image = null; observer.disconnect();
    if (cardURL) URL.revokeObjectURL(cardURL); downloads.forEach(url => URL.revokeObjectURL(url));
  });
  window.addEventListener('pageshow', event => { if (event.persisted && image) { pointerId = null; paintStage(); extract(); } });
}
