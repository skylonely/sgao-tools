import { orientedSize, fitCrop, moveCrop, resizeCrop, drawCrop, editCrop, defaultOutput, validateOutput, outputPlacement, cropFilename, CROP_INPUT_BYTES } from './lib/crop.js';
import { decodeCropImage, paintOriented, encodeCrop } from './crop-engine.js';
import { sendToCompressor, sendToOCR } from './image-transfer.js';

export function initCrop({ notify }) {
  const $ = id => document.getElementById(id);
  let image = null, filename = '', fileSize = 0, turns = 0, flipX = false, flipY = false, crop = null;
  let loadVersion = 0, version = 0, timer, encoding = false, output = null, outputURL = '', drag = null, autoSize = true, lastDimension = 'width', transferring = false;
  const downloads = new Set();
  const bytes = n => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(2)} MB`;
  const error = (id, message = '') => { $(id).textContent = message; $(id).hidden = !message; };
  const bounds = () => orientedSize(image.width, image.height, turns);
  const ratio = () => $('crop-aspect').value === 'original' ? bounds().width / bounds().height : Number($('crop-aspect').value) || 0;
  const setStatus = text => { $('crop-export-status').textContent = text; };

  function invalidate() {
    version++; clearTimeout(timer); output = null;
    if (outputURL) URL.revokeObjectURL(outputURL); outputURL = '';
    $('crop-output-image').hidden = true; $('crop-output-image').removeAttribute('src'); $('crop-output-empty').hidden = false;
    $('crop-download').disabled = $('crop-compress').disabled = $('crop-ocr').disabled = true;
    $('crop-output-name').textContent = image ? '等待生成当前结果' : '等待图片';
    $('crop-result-meta').textContent = '导出宽高 ≤ 8192 px · 总像素 ≤ 3200 万';
    error('crop-output-error');
  }
  function readOptions() {
    const { width, height } = validateOutput(Number($('crop-output-width').value), Number($('crop-output-height').value));
    const mime = $('crop-format').value;
    return { width, height, mime, turns, flipX, flipY, fit: $('crop-lock').checked ? 'contain' : $('crop-fit').value, quality: Number($('crop-quality').value) / 100, background: $('crop-background').value === 'color' || mime === 'image/jpeg' ? $('crop-color').value : null };
  }
  function outputDimensions() {
    if (autoSize) {
      const size = defaultOutput(crop); $('crop-output-width').value = size.width; $('crop-output-height').value = size.height;
    } else if ($('crop-lock').checked) {
      const value = Number($(`crop-output-${lastDimension}`).value);
      if (value > 0 && Number.isInteger(value)) {
        const other = lastDimension === 'width' ? 'height' : 'width';
        $(`crop-output-${other}`).value = Math.max(1, Math.round(lastDimension === 'width' ? value * crop.height / crop.width : value * crop.width / crop.height));
      }
    }
  }
  function paintSelection() {
    if (!image) return;
    const size = bounds(), selection = $('crop-selection');
    selection.style.left = `${crop.x / size.width * 100}%`; selection.style.top = `${crop.y / size.height * 100}%`;
    selection.style.width = `${crop.width / size.width * 100}%`; selection.style.height = `${crop.height / size.height * 100}%`;
    selection.setAttribute('aria-label', `裁剪选区，左侧 ${crop.x}、顶部 ${crop.y}、宽 ${crop.width}、高 ${crop.height} 像素`);
    $('crop-selection-label').textContent = `${crop.width} × ${crop.height} px`;
    for (const field of ['x', 'y', 'width', 'height']) {
      $(`crop-${field}`).value = crop[field];
      $(`crop-${field}`).max = field === 'x' ? size.width - crop.width : field === 'y' ? size.height - crop.height : size[field];
    }
  }
  function paintStage() {
    if (!image || !$('crop-viewport').clientWidth) return;
    const viewport = $('crop-viewport'), style = getComputedStyle(viewport), size = bounds();
    const availableWidth = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const availableHeight = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const scale = Math.min(availableWidth / size.width, availableHeight / size.height);
    const width = Math.max(1, size.width * scale), height = Math.max(1, size.height * scale);
    $('crop-stage').style.width = `${width}px`; $('crop-stage').style.height = `${height}px`;
    const canvas = $('crop-canvas'), resolution = Math.min(2, 1600 / width, 1600 / height);
    canvas.width = Math.max(1, Math.round(width * resolution)); canvas.height = Math.max(1, Math.round(height * resolution));
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.scale(canvas.width / size.width, canvas.height / size.height); paintOriented(ctx, image, turns, flipX, flipY);
    $('crop-source-meta').textContent = `${size.width} × ${size.height} px · ${bytes(fileSize)}`;
    $('crop-flip-x').setAttribute('aria-pressed', String(flipX)); $('crop-flip-y').setAttribute('aria-pressed', String(flipY));
    paintSelection();
  }
  async function generate() {
    if (!image || drag || encoding) return;
    let options;
    try { options = readOptions(); } catch (cause) { error('crop-output-error', cause.message); setStatus('请修正导出尺寸后继续。'); return; }
    const ticket = version, snapshot = image, rect = { ...crop }, name = filename; encoding = true; setStatus('正在生成当前图片…');
    try {
      const blob = await encodeCrop(snapshot, rect, options);
      if (ticket !== version || image !== snapshot) return;
      output = new File([blob], cropFilename(name, options.mime), { type: options.mime });
      outputURL = URL.createObjectURL(output); $('crop-output-image').src = outputURL; $('crop-output-image').hidden = false; $('crop-output-empty').hidden = true;
      $('crop-output-name').textContent = output.name;
      $('crop-result-meta').textContent = `${options.width} × ${options.height} px · ${options.mime.split('/')[1].toUpperCase()} · ${bytes(output.size)}`;
      $('crop-download').disabled = false; $('crop-compress').disabled = $('crop-ocr').disabled = transferring || output.size > CROP_INPUT_BYTES;
      $('crop-transfer-status').textContent = output.size > CROP_INPUT_BYTES ? '当前结果超过压缩工具的 20 MB 上限；可缩小尺寸或选择 JPG / WebP 后继续压缩。' : '裁剪结果可直接交给压缩工具，无需重复选择文件。';
      setStatus('预览已更新，可以下载或继续压缩。');
    } catch (cause) { if (ticket === version) { error('crop-output-error', cause.message); setStatus('生成失败，请调整设置或重新选择图片。'); } }
    finally { encoding = false; if (image && ticket !== version && !drag) { clearTimeout(timer); timer = setTimeout(generate, 0); } }
  }
  function changed(updateSize = false) {
    invalidate(); if (!image) return;
    if (updateSize) outputDimensions();
    paintSelection();
    const jpeg = $('crop-format').value === 'image/jpeg';
    $('crop-quality').disabled = $('crop-format').value === 'image/png'; $('crop-fit').disabled = $('crop-lock').checked;
    $('crop-color').disabled = !jpeg && $('crop-background').value !== 'color';
    $('crop-quality-value').textContent = `${$('crop-quality').value}%`;
    $('crop-format-note').textContent = jpeg ? 'JPG 不支持透明，透明区域和留白将使用所选底色。' : $('crop-format').value === 'image/png' ? 'PNG 保留透明与完整像素，质量滑块用于 JPG / WebP。' : 'WebP 支持透明，质量越高通常体积越大。';
    try {
      const options = readOptions(), area = outputPlacement(crop, options.width, options.height, options.fit);
      $('crop-upscale-note').hidden = area.width <= crop.width && area.height <= crop.height;
      setStatus(drag ? '正在调整选区，松开后更新预览。' : '设置已更新，正在准备新预览…');
      if (!drag) timer = setTimeout(generate, 220);
    } catch (cause) { error('crop-output-error', cause.message); setStatus('请修正导出尺寸后继续。'); }
  }
  function resetSelection() { crop = fitCrop(bounds(), ratio()); changed(true); }
  function clear() {
    loadVersion++; image?.close(); image = null; crop = null; drag = null; invalidate();
    $('crop-workspace').hidden = true; $('crop-drop').classList.remove('is-loaded'); $('crop-clear').disabled = true;
    $('crop-file').value = ''; $('crop-drop-title').textContent = '拖入一张图片，留下你想要的部分';
    $('crop-load-status').textContent = '图片只在当前浏览器处理，无需登录。'; error('crop-error');
  }
  async function load(file) {
    clear(); const ticket = loadVersion; $('crop-clear').disabled = false; $('crop-load-status').textContent = '正在读取图片…';
    try {
      const bitmap = await decodeCropImage(file);
      if (ticket !== loadVersion) { bitmap.close(); return; }
      image = bitmap; filename = file.name; fileSize = file.size; turns = 0; flipX = flipY = false; autoSize = true;
      $('crop-aspect').value = 'free'; crop = fitCrop(bounds()); $('crop-lock').checked = true;
      $('crop-source-name').textContent = filename; $('crop-workspace').hidden = false; $('crop-drop').classList.add('is-loaded');
      $('crop-drop-title').textContent = '换一张图片，继续调整'; $('crop-load-status').textContent = '图片已就绪。选好区域，再设置导出尺寸和格式。';
      paintStage(); changed(true);
    } catch (cause) { if (ticket === loadVersion) { error('crop-error', cause.message); $('crop-load-status').textContent = '图片未载入，请重新选择。'; } }
  }

  $('crop-file').addEventListener('change', () => { const file = $('crop-file').files[0]; $('crop-file').value = ''; if (file) load(file); });
  let dragDepth = 0;
  $('crop-drop').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('crop-drop').classList.add('drag-over'); });
  $('crop-drop').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  $('crop-drop').addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('crop-drop').classList.remove('drag-over'); } });
  $('crop-drop').addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('crop-drop').classList.remove('drag-over'); if (event.dataTransfer.files.length !== 1) { error('crop-error', '请一次选择一张图片。'); return; } load(event.dataTransfer.files[0]); });
  $('crop-clear').addEventListener('click', clear);
  $('crop-aspect').addEventListener('change', resetSelection);
  $('crop-full').addEventListener('click', () => { $('crop-aspect').value = 'free'; resetSelection(); });
  $('crop-reset').addEventListener('click', () => { turns = 0; flipX = flipY = false; autoSize = true; $('crop-aspect').value = 'free'; $('crop-lock').checked = true; $('crop-fit').value = 'contain'; resetSelection(); paintStage(); });
  for (const [id, turn] of [['crop-rotate-left', -1], ['crop-rotate-right', 1]]) $(id).addEventListener('click', () => { turns = (turns + turn + 4) % 4; resetSelection(); paintStage(); });
  $('crop-flip-x').addEventListener('click', () => { flipX = !flipX; paintStage(); changed(); });
  $('crop-flip-y').addEventListener('click', () => { flipY = !flipY; paintStage(); changed(); });
  for (const field of ['x', 'y', 'width', 'height']) $(`crop-${field}`).addEventListener('change', () => {
    if (!image) return;
    try { crop = editCrop(crop, field, Number($(`crop-${field}`).value), bounds(), ratio()); error('crop-error'); changed(true); }
    catch (cause) { error('crop-error', cause.message); paintSelection(); }
  });

  const point = event => { const rect = $('crop-stage').getBoundingClientRect(), size = bounds(); return { x: Math.min(size.width, Math.max(0, (event.clientX - rect.left) / rect.width * size.width)), y: Math.min(size.height, Math.max(0, (event.clientY - rect.top) / rect.height * size.height)) }; };
  $('crop-stage').addEventListener('pointerdown', event => {
    if (!image || drag || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); const handle = event.target.closest('[data-crop-handle]');
    drag = { id: event.pointerId, start: point(event), rect: { ...crop }, mode: handle ? handle.dataset.cropHandle : event.target.closest('#crop-selection') ? 'move' : 'draw' };
    $('crop-stage').setPointerCapture(event.pointerId);
    $('crop-selection').focus({ preventScroll: true }); changed();
  });
  $('crop-stage').addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id || !image) return;
    const current = point(event), dx = current.x - drag.start.x, dy = current.y - drag.start.y;
    crop = drag.mode === 'move' ? moveCrop(drag.rect, dx, dy, bounds()) : drag.mode === 'draw' ? drawCrop(drag.start, current, bounds(), ratio()) : resizeCrop(drag.rect, drag.mode, dx, dy, bounds(), ratio());
    changed(true);
  });
  function finishDrag(event, cancel = false) {
    if (!drag || event.pointerId !== drag.id) return;
    if (cancel) crop = drag.rect;
    const id = drag.id; drag = null;
    if ($('crop-stage').hasPointerCapture(id)) $('crop-stage').releasePointerCapture(id);
    if (image) changed(true);
  }
  $('crop-stage').addEventListener('pointerup', event => finishDrag(event));
  $('crop-stage').addEventListener('pointercancel', event => finishDrag(event, true));
  $('crop-stage').addEventListener('lostpointercapture', event => finishDrag(event));
  $('crop-selection').addEventListener('keydown', event => {
    if (!image) return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!directions[event.key]) return;
    event.preventDefault(); event.stopPropagation(); const [x, y] = directions[event.key], step = event.shiftKey ? 10 : 1, handle = event.target.closest('[data-crop-handle]');
    crop = handle ? resizeCrop(crop, handle.dataset.cropHandle, x * step, y * step, bounds(), ratio()) : moveCrop(crop, x * step, y * step, bounds()); changed(true);
  });
  const observer = new ResizeObserver(paintStage); observer.observe($('crop-viewport'));
  for (const dimension of ['width', 'height']) $(`crop-output-${dimension}`).addEventListener('input', () => { autoSize = false; lastDimension = dimension; if ($('crop-lock').checked) outputDimensions(); changed(); });
  $('crop-lock').addEventListener('change', () => { autoSize = false; if ($('crop-lock').checked) outputDimensions(); changed(); });
  document.querySelectorAll('[data-crop-scale]').forEach(button => button.addEventListener('click', () => {
    autoSize = false; lastDimension = 'width'; const scale = Number(button.dataset.cropScale);
    $('crop-output-width').value = Math.max(1, Math.round(crop.width * scale)); $('crop-output-height').value = Math.max(1, Math.round(crop.height * scale)); changed();
  }));
  for (const id of ['crop-fit', 'crop-format', 'crop-background', 'crop-color', 'crop-quality']) $(id).addEventListener('input', () => {
    if (id === 'crop-format' && $('crop-format').value === 'image/jpeg') $('crop-background').value = 'color'; changed();
  });
  $('crop-download').addEventListener('click', () => {
    if (!output) return;
    const url = URL.createObjectURL(output), link = document.createElement('a'); downloads.add(url);
    link.href = url; link.download = output.name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 30_000);
  });
  async function transferCrop(kind) {
    if (!output || transferring || output.size > CROP_INPUT_BYTES) return;
    const file = output; transferring = true; $('crop-compress').disabled = $('crop-ocr').disabled = true; $('crop-transfer-status').textContent = '正在打开后续工具…';
    try { await (kind === 'ocr' ? sendToOCR(file) : sendToCompressor(file)); $('crop-transfer-status').textContent = `已发送 ${file.name}，请在新标签页继续处理。`; notify('裁剪结果已送至后续工具'); }
    catch (cause) { $('crop-transfer-status').textContent = cause.message; }
    finally { transferring = false; $('crop-compress').disabled = $('crop-ocr').disabled = !output || output.size > CROP_INPUT_BYTES; }
  }
  $('crop-compress').addEventListener('click', () => transferCrop('compress'));
  $('crop-ocr').addEventListener('click', () => transferCrop('ocr'));
  $('crop-sample').addEventListener('click', async () => {
    const ticket = ++loadVersion; $('crop-clear').disabled = false; $('crop-load-status').textContent = '正在准备示例图片…';
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800; const ctx = canvas.getContext('2d');
    ctx.save(); ctx.beginPath(); ctx.roundRect(24, 24, 1152, 752, 24); ctx.clip();
    const gradient = ctx.createLinearGradient(0, 0, 1200, 800); gradient.addColorStop(0, '#f6d5a5'); gradient.addColorStop(.6, '#e9855d'); gradient.addColorStop(1, '#879287'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = '#fff0cb'; ctx.beginPath(); ctx.arc(900, 210, 80, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#667e71'; ctx.beginPath(); ctx.moveTo(0, 620); ctx.lineTo(310, 310); ctx.lineTo(700, 740); ctx.lineTo(990, 400); ctx.lineTo(1200, 670); ctx.lineTo(1200, 800); ctx.lineTo(0, 800); ctx.fill();
    ctx.fillStyle = '#294a46'; ctx.beginPath(); ctx.moveTo(0, 740); ctx.bezierCurveTo(400, 410, 580, 850, 850, 580); ctx.lineTo(1200, 770); ctx.lineTo(1200, 800); ctx.lineTo(0, 800); ctx.fill();
    ctx.fillStyle = '#fff8eb'; ctx.font = '600 48px system-ui'; ctx.fillText('KEEP THE GOOD PART.', 80, 130); ctx.font = '20px system-ui'; ctx.fillText('SGAO / CROP STUDIO', 84, 173); ctx.restore();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); canvas.width = canvas.height = 1;
    if (ticket === loadVersion && blob) load(new File([blob], 'sgao-landscape.png', { type: 'image/png' }));
  });
  window.addEventListener('pagehide', event => { clearTimeout(timer); drag = null; if (!event.persisted) { loadVersion++; version++; image?.close(); image = null; observer.disconnect(); if (outputURL) URL.revokeObjectURL(outputURL); downloads.forEach(url => URL.revokeObjectURL(url)); } });
  window.addEventListener('pageshow', event => { if (event.persisted && image) { paintStage(); changed(); } });
}
