import { WATERMARK_LIMITS, validateWatermark, checkWatermarkFile, clampWatermarkCenter, watermarkMime, watermarkFilename } from './lib/watermark.js';
import { decodeWatermarkImage, watermarkThumbnail, paintWatermark, encodeWatermark } from './watermark-engine.js';
import { createZIP } from './lib/zip.js';
import { sendToCompressor } from './image-transfer.js';

export function initWatermark({ notify }) {
  const $ = id => document.getElementById(id), items = [], downloadURLs = new Set();
  let nextID = 0, activeID = null, logo = null, loading = false, logoLoading = false, running = false, packing = false, transferring = false, disposed = false;
  let loadVersion = 0, logoVersion = 0, revision = 0, abort = null, view = 'preview', layout = null, drag = null, frame = 0;
  const active = () => items.find(item => item.id === activeID);
  const bytes = size => size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(2)} MB`;
  const error = (id, text = '') => { $(id).textContent = text; $(id).hidden = !text; };
  function options() {
    if ($('wm-mode').value === 'single' && $('wm-anchor').value === 'custom' && (!$('wm-x').value || !$('wm-y').value)) throw new Error('请填写水平、垂直位置，范围为 0–100%。');
    return validateWatermark({ type: $('wm-type').value, mode: $('wm-mode').value, text: $('wm-text').value, font: $('wm-font').value, bold: $('wm-bold').checked, color: $('wm-color').value, textSize: Number($('wm-text-size').value), logoSize: Number($('wm-logo-size').value), opacity: Number($('wm-opacity').value), angle: Number($('wm-angle').value), margin: Number($('wm-margin').value), gap: Number($('wm-gap').value), anchor: $('wm-anchor').value, x: Number($('wm-x').value), y: Number($('wm-y').value), format: $('wm-format').value, quality: Number($('wm-quality').value), background: $('wm-background').value });
  }
  function configuration() { const result = options(); if (result.type === 'logo' && !logo) throw new Error('请选择一张 Logo 图片，或试试示例 Logo。'); return result; }
  function clearResult(item) { if (item.url) URL.revokeObjectURL(item.url); item.url = ''; item.result = null; }
  function invalidate() {
    revision++; let hadResults = false;
    $('wm-result-image').removeAttribute('src'); $('wm-result-image').hidden = true;
    for (const item of items) { hadResults ||= !!item.result || item.status !== '等待生成'; clearResult(item); item.status = '等待生成'; item.failed = false; }
    if (view === 'output') view = 'preview';
    if (hadResults) renderQueue();
  }
  function update() {
    const item = active(), busy = running || packing;
    let valid = true;
    try { configuration(); error('wm-config-error'); } catch (cause) { valid = false; if (items.length) error('wm-config-error', cause.message); }
    $('wm-workspace').hidden = !items.length; $('wm-drop').classList.toggle('is-loaded', !!items.length);
    $('wm-files').disabled = busy || loading; $('wm-sample').disabled = busy || loading;
    $('wm-clear').disabled = busy || !items.length && !loading; $('wm-settings').disabled = busy;
    $('wm-logo-file').disabled = busy || logoLoading; $('wm-logo-sample').disabled = busy || logoLoading; $('wm-logo-remove').disabled = busy || !logo && !logoLoading;
    $('wm-text-fields').hidden = $('wm-type').value !== 'text'; $('wm-logo-fields').hidden = $('wm-type').value !== 'logo';
    const tile = $('wm-mode').value === 'tile'; $('wm-single-fields').hidden = tile; $('wm-gap-field').hidden = !tile;
    $('wm-text-size-value').textContent = `${$('wm-text-size').value}%`; $('wm-logo-size-value').textContent = `${$('wm-logo-size').value}%`;
    $('wm-opacity-value').textContent = `${$('wm-opacity').value}%`; $('wm-angle-value').textContent = `${$('wm-angle').value}°`;
    $('wm-margin-value').textContent = `${$('wm-margin').value}%`; $('wm-gap-value').textContent = `${$('wm-gap').value}%`;
    $('wm-quality-value').textContent = `${$('wm-quality').value}%`; $('wm-quality').disabled = busy || $('wm-format').value === 'image/png';
    $('wm-background').disabled = busy || !['auto', 'image/jpeg'].includes($('wm-format').value);
    document.querySelectorAll('[data-wm-anchor]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.wmAnchor === $('wm-anchor').value)));
    const done = items.filter(candidate => candidate.result).length;
    $('wm-count').textContent = `${items.length} 张图片 · ${bytes(items.reduce((sum, candidate) => sum + candidate.file.size, 0))}`;
    $('wm-run').disabled = busy || loading || logoLoading || !valid || !items.length;
    $('wm-run').textContent = running ? '正在添加水印…' : done ? '按当前设置重新生成全部' : '应用到全部图片';
    $('wm-stop').hidden = !running; $('wm-stop').disabled = !!abort?.signal.aborted;
    $('wm-zip').disabled = busy || !done; $('wm-download').disabled = busy || !item?.result;
    $('wm-compress').disabled = busy || transferring || !item?.result || item.result.size > WATERMARK_LIMITS.fileBytes;
    $('wm-view-output').disabled = !item?.result;
    for (const name of ['original', 'preview', 'output']) $(`wm-view-${name}`).setAttribute('aria-pressed', String(view === name));
    $('wm-progress').max = Math.max(1, items.length); $('wm-progress').value = items.filter(candidate => candidate.result || candidate.failed).length;
    $('wm-queue-summary').textContent = `已生成 ${done} / ${items.length} 张${done ? ` · 结果共 ${bytes(items.reduce((sum, candidate) => sum + (candidate.result?.size || 0), 0))}` : ''}`;
    if (item) {
      $('wm-source-name').textContent = item.file.name; $('wm-source-meta').textContent = `${item.width} × ${item.height} px · ${bytes(item.file.size)}`;
      $('wm-result-meta').textContent = item.result ? `${item.result.name} · ${bytes(item.result.size)} · ${item.width} × ${item.height} px` : '预览仅供调整，点击「应用到全部图片」生成可下载结果。';
      $('wm-transfer-status').textContent = item.result?.size > WATERMARK_LIMITS.fileBytes ? '当前结果超过压缩工具 20 MB 上限，可改用 JPG / WebP 重新生成，或单独下载。' : '当前单张结果可直接送至压缩工具，无需重复选择文件。';
    }
  }
  function renderQueue() {
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'wm-queue-row'; row.classList.toggle('is-active', item.id === activeID);
      const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'wm-queue-choose'; choose.setAttribute('aria-pressed', String(item.id === activeID)); choose.setAttribute('aria-label', `预览 ${item.file.name}`);
      const thumbnail = document.createElement('canvas'); thumbnail.width = 88; thumbnail.height = 64; thumbnail.className = 'wm-checker'; thumbnail.setAttribute('aria-hidden', 'true');
      const scale = Math.min(88 / item.width, 64 / item.height); thumbnail.getContext('2d').drawImage(item.preview, (88 - item.width * scale) / 2, (64 - item.height * scale) / 2, item.width * scale, item.height * scale);
      const info = document.createElement('span'), name = document.createElement('strong'), state = document.createElement('small');
      name.textContent = item.file.name; state.textContent = item.result ? `${item.width} × ${item.height} · ${bytes(item.result.size)} · ${item.result.type.split('/')[1].toUpperCase()}` : `${item.width} × ${item.height} · ${item.status}`;
      state.classList.toggle('wm-failed', item.failed); info.append(name, state); choose.append(thumbnail, info);
      choose.addEventListener('click', () => { activeID = item.id; if (view === 'output' && !item.result) view = 'preview'; renderQueue(); update(); paint(); });
      const actions = document.createElement('div'); actions.className = 'wm-queue-actions';
      if (item.result) { const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = '下载'; button.disabled = running || packing; button.addEventListener('click', () => download(item.result, item.result.name)); actions.append(button); }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button muted'; remove.textContent = '移除'; remove.setAttribute('aria-label', `移除 ${item.file.name}`); remove.disabled = running || packing || loading;
      remove.addEventListener('click', () => { clearResult(item); item.preview.close(); items.splice(items.indexOf(item), 1); if (activeID === item.id) { activeID = items[0]?.id ?? null; view = 'preview'; } renderQueue(); update(); paint(); $('wm-status').textContent = items.length ? '图片队列已更新，可继续调整或生成。' : '请选择图片，或试试批量示例。'; }); actions.append(remove);
      row.append(choose, actions); fragment.append(row);
    }
    $('wm-list').replaceChildren(fragment);
  }
  function paint() {
    frame = 0; const item = active(); if (!item || !$('wm-viewport').clientWidth) return;
    const viewport = $('wm-viewport'), style = getComputedStyle(viewport);
    const availableWidth = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), availableHeight = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const scale = Math.min(availableWidth / item.width, availableHeight / item.height), width = Math.max(1, item.width * scale), height = Math.max(1, item.height * scale);
    $('wm-stage').style.width = `${width}px`; $('wm-stage').style.height = `${height}px`;
    $('wm-result-image').hidden = view !== 'output' || !item.result;
    const canvas = $('wm-canvas'); canvas.hidden = view === 'output' && !!item.result; $('wm-handle').hidden = true;
    if (!canvas.hidden) {
      const density = Math.min(devicePixelRatio || 1, 2, 1600 / width, 1600 / height); canvas.width = Math.max(1, Math.round(width * density)); canvas.height = Math.max(1, Math.round(height * density));
      const ctx = canvas.getContext('2d'); ctx.scale(canvas.width / item.width, canvas.height / item.height); layout = null;
      try {
        const settings = configuration(); layout = paintWatermark(ctx, item.preview, item, settings, logo, view === 'original', watermarkMime(settings.format, item.mime));
        if (layout && settings.anchor !== 'custom') { $('wm-x').value = Number((layout.center.x / item.width * 100).toFixed(2)); $('wm-y').value = Number((layout.center.y / item.height * 100).toFixed(2)); }
        if (layout && settings.mode === 'single' && !running && !packing) {
          const handle = $('wm-handle'); handle.hidden = false;
          handle.style.left = `${layout.center.x / item.width * 100}%`; handle.style.top = `${layout.center.y / item.height * 100}%`;
          handle.style.width = `${layout.width / item.width * 100}%`; handle.style.height = `${layout.height / item.height * 100}%`;
        }
        $('wm-preview-note').textContent = view === 'original' ? '原图预览' : layout?.adjusted ? '平铺预览 · 已自动增加间距，避免水印过密。' : layout?.scale < .999 ? '水印已自动缩小，完整放入画面。' : settings.mode === 'tile' ? '平铺水印预览 · 边缘水印会随画布裁切。' : '拖动虚线框调整位置，也可用九宫格或百分比定位。';
      } catch {
        ctx.setTransform(canvas.width / item.width, 0, 0, canvas.height / item.height, 0, 0); ctx.clearRect(0, 0, item.width, item.height); ctx.drawImage(item.preview, 0, 0, item.width, item.height);
        $('wm-preview-note').textContent = '请完善右侧水印设置，预览会自动更新。';
      }
    } else {
      if ($('wm-result-image').getAttribute('src') !== item.url) $('wm-result-image').src = item.url;
      $('wm-preview-note').textContent = '这是实际编码后的导出结果，与下载文件一致。';
    }
  }
  function schedulePaint() { if (!frame) frame = requestAnimationFrame(paint); }
  function changed() { if (running || packing) return; invalidate(); update(); schedulePaint(); if (items.length && !loading) $('wm-status').textContent = '设置已更新，点击「应用到全部图片」生成新结果。'; }
  function clear() {
    loadVersion++; loading = false; revision++; drag = null;
    for (const item of items) { item.preview.close(); clearResult(item); } items.length = 0; activeID = null; view = 'preview';
    $('wm-canvas').width = $('wm-canvas').height = 1; $('wm-result-image').removeAttribute('src');
    error('wm-error'); error('wm-config-error'); $('wm-status').textContent = '图片与水印在当前浏览器处理，不上传服务器。'; renderQueue(); update();
  }
  async function addFiles(files) {
    if (running || packing || loading) { error('wm-error', '请等待当前处理结束，或先停止后再添加图片。'); return; }
    const incoming = Array.from(files); if (!incoming.length) return;
    const ticket = ++loadVersion, rejected = []; loading = true; error('wm-error'); update();
    for (const file of incoming) {
      if (ticket !== loadVersion) return;
      $('wm-status').textContent = `正在读取 ${file.name}…`;
      let source, preview;
      try {
        checkWatermarkFile(file, items.length, items.reduce((sum, item) => sum + item.file.size, 0));
        const decoded = await decodeWatermarkImage(file); source = decoded.image;
        if (ticket !== loadVersion) { source.close(); return; }
        preview = await watermarkThumbnail(source);
        if (ticket !== loadVersion) { source.close(); preview.close(); return; }
        const item = { id: ++nextID, file, mime: decoded.mime, width: source.width, height: source.height, preview, result: null, url: '', status: '等待生成', failed: false };
        source.close(); source = null; preview = null; items.push(item); if (activeID === null) activeID = item.id;
        renderQueue(); update(); paint();
      } catch (cause) { source?.close(); preview?.close(); rejected.push(`${file.name}：${cause.message}`); }
    }
    if (ticket !== loadVersion) return;
    loading = false; update(); renderQueue(); $('wm-status').textContent = items.length ? `已载入 ${items.length} 张图片。选择一张预览，调整好后应用到全部图片。` : '没有载入可用图片，请检查错误提示后重新选择。';
    if (rejected.length) error('wm-error', rejected.join('\n'));
  }
  async function setLogo(file) {
    if (running || packing) return;
    const ticket = ++logoVersion; logoLoading = true; error('wm-logo-error'); invalidate(); update();
    $('wm-logo-name').textContent = '正在读取 Logo…';
    try {
      const { image } = await decodeWatermarkImage(file, true);
      if (ticket !== logoVersion) { image.close(); return; }
      logo?.close(); logo = image; $('wm-logo-name').textContent = file.name;
      const canvas = $('wm-logo-preview'), ctx = canvas.getContext('2d'), scale = Math.min(80 / logo.width, 80 / logo.height);
      ctx.clearRect(0, 0, 80, 80); ctx.drawImage(logo, (80 - logo.width * scale) / 2, (80 - logo.height * scale) / 2, logo.width * scale, logo.height * scale); canvas.hidden = false;
    } catch (cause) { if (ticket === logoVersion) { error('wm-logo-error', cause.message); $('wm-logo-name').textContent = logo ? '保留上一张 Logo' : '尚未选择 Logo'; } }
    finally { if (ticket === logoVersion) { logoLoading = false; changed(); } }
  }
  function removeLogo() { logoVersion++; logoLoading = false; logo?.close(); logo = null; $('wm-logo-preview').hidden = true; $('wm-logo-name').textContent = '尚未选择 Logo'; error('wm-logo-error'); changed(); }

  async function run() {
    if (running || packing || loading || logoLoading || !items.length) return;
    let settings; try { settings = configuration(); } catch (cause) { error('wm-config-error', cause.message); return; }
    invalidate(); const ticket = revision, controller = new AbortController(); abort = controller; running = true; view = 'preview'; error('wm-error');
    renderQueue(); update(); paint(); let resultBytes = 0;
    for (const item of items) {
      if (controller.signal.aborted || ticket !== revision) break;
      item.status = '正在生成'; renderQueue(); update(); $('wm-status').textContent = `正在处理 ${item.file.name}…`;
      await new Promise(resolve => setTimeout(resolve, 0));
      try {
        const result = await encodeWatermark(item.file, settings, logo, controller.signal);
        if (ticket !== revision || controller.signal.aborted) break;
        if (resultBytes + result.blob.size > WATERMARK_LIMITS.resultBytes) throw new Error('本批次结果合计已达 200 MB 上限。请减少图片，或改用 JPG / WebP。');
        resultBytes += result.blob.size;
        item.result = new File([result.blob], watermarkFilename(item.file.name, result.mime), { type: result.mime }); item.url = URL.createObjectURL(item.result); item.status = '已生成';
      } catch (cause) {
        if (controller.signal.aborted || ticket !== revision || cause.name === 'AbortError') break;
        item.failed = true; item.status = cause.message;
      }
      renderQueue(); update();
    }
    const stopped = controller.signal.aborted || ticket !== revision;
    for (const item of items) if (!item.result && !item.failed) item.status = stopped ? '已停止，可重新生成' : '等待生成';
    running = false; abort = null; if (disposed) return;
    if (active()?.result) view = 'output'; renderQueue(); update(); paint();
    $('wm-status').textContent = `${stopped ? '处理已停止' : '本批次处理结束'}，成功 ${items.filter(item => item.result).length} / ${items.length} 张。${stopped ? '已完成的图片仍可下载。' : '可以切换图片检查实际导出结果。'}`;
  }
  function download(blob, name) {
    if (!blob) return;
    const url = URL.createObjectURL(blob), link = document.createElement('a'); downloadURLs.add(url);
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloadURLs.delete(url); }, 30_000);
  }
  $('wm-files').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
  let depth = 0;
  $('wm-drop').addEventListener('dragenter', event => { event.preventDefault(); depth++; $('wm-drop').classList.add('drag-over'); });
  $('wm-drop').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  $('wm-drop').addEventListener('dragleave', event => { event.preventDefault(); if (--depth <= 0) { depth = 0; $('wm-drop').classList.remove('drag-over'); } });
  $('wm-drop').addEventListener('drop', event => { event.preventDefault(); depth = 0; $('wm-drop').classList.remove('drag-over'); addFiles(event.dataTransfer.files); });
  $('wm-clear').addEventListener('click', clear); $('wm-run').addEventListener('click', run);
  $('wm-stop').addEventListener('click', () => { abort?.abort(); $('wm-status').textContent = '正在停止当前图片，已完成的结果会保留…'; update(); });
  $('wm-settings').querySelectorAll('input:not([type="file"]),select,textarea').forEach(input => input.addEventListener('input', () => { if (['wm-x', 'wm-y'].includes(input.id)) $('wm-anchor').value = 'custom'; changed(); }));
  $('wm-logo-file').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) setLogo(file); });
  $('wm-logo-remove').addEventListener('click', removeLogo);
  for (const name of ['original', 'preview', 'output']) $(`wm-view-${name}`).addEventListener('click', () => { view = name; update(); paint(); });
  document.querySelectorAll('[data-wm-anchor]').forEach(button => button.addEventListener('click', () => { $('wm-anchor').value = button.dataset.wmAnchor; changed(); }));
  document.querySelectorAll('[data-wm-angle]').forEach(button => button.addEventListener('click', () => { $('wm-angle').value = button.dataset.wmAngle; changed(); }));
  function setCenter(x, y) {
    const item = active(); if (!item || !layout) return;
    const center = clampWatermarkCenter(x, y, item, layout, layout.margin);
    $('wm-anchor').value = 'custom'; $('wm-x').value = Number((center.x / item.width * 100).toFixed(2)); $('wm-y').value = Number((center.y / item.height * 100).toFixed(2)); changed();
  }
  const handle = $('wm-handle');
  handle.addEventListener('pointerdown', event => {
    if (!layout || running || packing || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); const rect = $('wm-stage').getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, center: { ...layout.center }, rect }; handle.setPointerCapture(event.pointerId); handle.focus({ preventScroll: true });
  });
  handle.addEventListener('pointermove', event => { if (drag?.id === event.pointerId && active()) setCenter(drag.center.x + (event.clientX - drag.x) / drag.rect.width * active().width, drag.center.y + (event.clientY - drag.y) / drag.rect.height * active().height); });
  const endDrag = event => { if (drag?.id !== event.pointerId) return; drag = null; if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, endDrag);
  handle.addEventListener('keydown', event => {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta || !layout || running || packing) return;
    event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? 10 : 1; setCenter(layout.center.x + delta[0] * step, layout.center.y + delta[1] * step);
  });
  $('wm-download').addEventListener('click', () => { const result = active()?.result; if (result) download(result, result.name); });
  $('wm-zip').addEventListener('click', async () => {
    if (running || packing) return;
    const ready = items.filter(item => item.result).map(item => item.result); if (!ready.length) return;
    packing = true; update(); renderQueue(); paint(); error('wm-error');
    try {
      const files = []; for (const file of ready) { files.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) }); if (disposed) return; }
      download(new Blob([createZIP(files)], { type: 'application/zip' }), 'sgao-watermarked-images.zip'); notify(`已打包 ${ready.length} 张图片，下载已开始`);
    } catch (cause) { error('wm-error', cause.message); }
    finally { packing = false; if (!disposed) { update(); renderQueue(); paint(); } }
  });
  $('wm-compress').addEventListener('click', async () => {
    const file = active()?.result; if (!file || transferring || file.size > WATERMARK_LIMITS.fileBytes) return;
    transferring = true; update(); $('wm-transfer-status').textContent = '正在打开压缩工具…';
    try { await sendToCompressor(file); $('wm-transfer-status').textContent = `已发送 ${file.name}，请在新标签页选择压缩策略。`; notify('水印结果已送至压缩工具'); }
    catch (cause) { $('wm-transfer-status').textContent = cause.message; }
    finally { transferring = false; $('wm-compress').disabled = !active()?.result || active().result.size > WATERMARK_LIMITS.fileBytes; }
  });
  $('wm-sample').addEventListener('click', async () => {
    if (loading || running || packing) return;
    const ticket = ++loadVersion; loading = true; update(); $('wm-status').textContent = '正在准备三张不同比例的示例图片…'; const files = [];
    try {
      for (const [width, height, name, mime] of [[1200, 800, 'sgao-landscape.png', 'image/png'], [800, 1000, 'sgao-portrait.jpg', 'image/jpeg'], [1600, 600, 'sgao-banner.png', 'image/png']]) {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.scale(width / 1200, height / 800);
        ctx.fillStyle = '#edc9a5'; ctx.fillRect(0, 0, 1200, 800); ctx.fillStyle = '#fff0cd'; ctx.beginPath(); ctx.arc(920, 210, 90, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c77d5b'; ctx.beginPath(); ctx.moveTo(0, 580); ctx.bezierCurveTo(400, 220, 500, 350, 850, 660); ctx.lineTo(1200, 400); ctx.lineTo(1200, 800); ctx.lineTo(0, 800); ctx.fill();
        ctx.fillStyle = '#6a8571'; ctx.beginPath(); ctx.moveTo(0, 790); ctx.bezierCurveTo(290, 440, 560, 500, 830, 800); ctx.lineTo(1200, 610); ctx.lineTo(1200, 800); ctx.fill();
        ctx.fillStyle = '#294e49'; ctx.beginPath(); ctx.moveTo(0, 800); ctx.bezierCurveTo(430, 580, 690, 850, 1200, 720); ctx.lineTo(1200, 800); ctx.fill();
        ctx.fillStyle = '#2c3833'; ctx.font = '600 45px system-ui'; ctx.fillText('MADE TO BE YOURS.', 65, 112); ctx.font = '18px system-ui'; ctx.fillText('SGAO / A LITTLE MARK, YOUR OWN STORY.', 69, 151);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, .92)); canvas.width = canvas.height = 1;
        if (!blob) throw new Error('示例图片生成失败，请选择本地图片。'); files.push(new File([blob], name, { type: mime }));
      }
      if (ticket === loadVersion) { loading = false; await addFiles(files); }
    } catch (cause) { if (ticket === loadVersion) { loading = false; error('wm-error', cause.message); update(); } }
  });
  $('wm-logo-sample').addEventListener('click', async () => {
    const ticket = logoVersion, canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 200; const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ec6245'; ctx.beginPath(); ctx.roundRect(5, 5, 190, 190, 38); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '700 90px system-ui'; ctx.fillText('S', 70, 132);
    ctx.fillStyle = '#fff'; ctx.font = '700 125px system-ui'; ctx.fillText('SGAO', 230, 145);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); canvas.width = canvas.height = 1;
    if (ticket === logoVersion && blob) setLogo(new File([blob], 'sgao-logo.png', { type: 'image/png' }));
  });
  const observer = new ResizeObserver(schedulePaint); observer.observe($('wm-viewport'));
  window.addEventListener('pagehide', event => {
    abort?.abort(); loadVersion++; logoVersion++; loading = logoLoading = false; drag = null;
    if (event.persisted) return;
    disposed = true; revision++; if (frame) cancelAnimationFrame(frame); observer.disconnect(); logo?.close();
    for (const item of items) { item.preview.close(); clearResult(item); } downloadURLs.forEach(url => URL.revokeObjectURL(url));
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { update(); schedulePaint(); } });
  update();
}
