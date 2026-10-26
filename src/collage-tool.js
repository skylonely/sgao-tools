import { checkCollageFile, collageLayout, collageFilename, reorderCollage, COLLAGE_LIMITS } from './lib/collage.js';
import { decodeCollageImage, paintCollagePart, fillCollage, encodeCollage } from './collage-engine.js';
import { createImagePreview } from './local-image.js';
import { sendToCompressor, sendToWatermark } from './image-transfer.js';

export function initCollage({ notify }) {
  const $ = id => document.getElementById(id), items = [], downloads = new Set();
  let nextID = 0, loading = false, running = false, disposed = false, transferring = false, loadVersion = 0, version = 0;
  let layout = null, result = null, resultURL = '', abort = null, frame = 0, view = 'layout', drag = null;
  const bytes = size => size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(2)} MB`;
  const message = (id, text = '') => { $(id).textContent = text; $(id).hidden = !text; };
  const number = id => $(id).value.trim() === '' ? NaN : Number($(id).value);
  function options() {
    return { mode: $('cg-mode').value, base: number('cg-base'), columns: number('cg-columns'), ratio: number('cg-ratio'), fit: $('cg-fit').value, gap: number('cg-gap'), padding: number('cg-padding'), background: $('cg-background').value, color: $('cg-color').value, format: $('cg-format').value, quality: number('cg-quality'), name: $('cg-name').value };
  }
  function invalidate() {
    version++; result = null; if (resultURL) URL.revokeObjectURL(resultURL); resultURL = '';
    $('cg-result-image').removeAttribute('src'); $('cg-result-image').hidden = true; view = 'layout';
    $('cg-progress').value = 0;
  }
  function update() {
    let valid = false; layout = null;
    if (items.length) {
      try { layout = collageLayout(items, options()); valid = true; message('cg-settings-error'); }
      catch (cause) { message('cg-settings-error', cause.message); }
    } else message('cg-settings-error');
    const mode = $('cg-mode').value, busy = running || loading;
    $('cg-workspace').hidden = !items.length; $('cg-drop').classList.toggle('is-loaded', !!items.length);
    $('cg-files').disabled = $('cg-sample').disabled = busy; $('cg-clear').disabled = running || !items.length && !loading;
    $('cg-settings').disabled = running; $('cg-grid-fields').hidden = mode !== 'grid';
    $('cg-base-label').textContent = mode === 'horizontal' ? '目标高度（含外边距，px）' : '目标宽度（含外边距，px）';
    $('cg-quality').disabled = running || $('cg-format').value === 'image/png'; $('cg-quality-value').textContent = `${$('cg-quality').value}%`;
    $('cg-color').disabled = running || $('cg-background').value === 'transparent' && $('cg-format').value !== 'image/jpeg';
    $('cg-background-note').textContent = $('cg-format').value === 'image/jpeg' ? 'JPG 不支持透明，留白与透明区域会使用所选底色。' : '透明背景可用于 PNG / WebP；完整显示时，空白区域沿用画布背景。';
    $('cg-run').disabled = busy || !valid; $('cg-run').textContent = running ? '正在生成拼图…' : result ? '重新生成拼图' : '生成拼图';
    $('cg-stop').hidden = !running; $('cg-stop').disabled = !!abort?.signal.aborted;
    $('cg-download').disabled = running || !result;
    const canTransfer = !!result && result.size <= COLLAGE_LIMITS.fileBytes && !running && !transferring;
    $('cg-watermark').disabled = $('cg-compress').disabled = !canTransfer;
    $('cg-view-output').disabled = !result;
    for (const name of ['layout', 'output']) $(`cg-view-${name}`).setAttribute('aria-pressed', String(view === name));
    $('cg-count').textContent = `${items.length} 张图片 · ${bytes(items.reduce((sum, item) => sum + item.file.size, 0))}`;
    $('cg-dimensions').textContent = layout ? `${layout.width} × ${layout.height} px` : '等待有效布局';
    message('cg-scale-note', layout?.scaled ? `原布局约 ${layout.rawWidth} × ${layout.rawHeight} px，已按输出上限等比缩小至 ${layout.width} × ${layout.height} px。` : '');
    message('cg-upscale-note', layout?.upscaled ? '部分图片会被放大，放大不会增加原图细节。' : '');
    $('cg-result-name').textContent = result ? result.name : '准备好画面，再生成拼图';
    $('cg-result-meta').textContent = result ? `${layout.width} × ${layout.height} px · ${result.type.split('/')[1].toUpperCase()} · ${bytes(result.size)}` : 'PNG / JPG / WebP · 输出单边 ≤ 10000 px · 总像素 ≤ 3200 万';
    $('cg-transfer-note').textContent = result?.size > COLLAGE_LIMITS.fileBytes ? '结果超过后续工具的 20 MB 上限。可改用 JPG / WebP 或缩小尺寸后重新生成，再继续处理。' : '生成后可直接继续加水印或压缩，图片不会上传服务器。';
  }
  function paint() {
    frame = 0; if (!items.length || !$('cg-viewport').clientWidth) return;
    const stage = $('cg-stage'); stage.hidden = !layout; $('cg-preview-empty').hidden = !!layout;
    if (!layout) return;
    const viewport = $('cg-viewport'), style = getComputedStyle(viewport);
    const availableWidth = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), availableHeight = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const zoom = $('cg-zoom').value, scale = zoom === 'fit' ? Math.min(1, availableWidth / layout.width, availableHeight / layout.height) : Number(zoom);
    stage.style.width = `${Math.max(1, layout.width * scale)}px`; stage.style.height = `${Math.max(1, layout.height * scale)}px`;
    const encoded = view === 'output' && !!result; $('cg-result-image').hidden = !encoded; $('cg-canvas').hidden = encoded;
    if (encoded) {
      if ($('cg-result-image').getAttribute('src') !== resultURL) $('cg-result-image').src = resultURL;
      $('cg-preview-note').textContent = '实际编码结果，与下载文件一致；可切换到 100% 查看细节。'; return;
    }
    const canvas = $('cg-canvas'), resolution = Math.min(1, 2048 / layout.width, 2048 / layout.height);
    canvas.width = Math.max(1, Math.round(layout.width * resolution)); canvas.height = Math.max(1, Math.round(layout.height * resolution));
    const ctx = canvas.getContext('2d'); ctx.scale(canvas.width / layout.width, canvas.height / layout.height); fillCollage(ctx, layout, options());
    items.forEach((item, index) => paintCollagePart(ctx, item.preview, item, layout.placements[index]));
    $('cg-preview-note').textContent = '布局预览使用缩略图，生成后可查看实际导出结果。';
  }
  function schedulePaint() { if (!frame) frame = requestAnimationFrame(paint); }
  function changed(text = '设置已更新，点击「生成拼图」生成新结果。') {
    if (running) return; invalidate(); update(); schedulePaint(); $('cg-status').textContent = text;
    $('cg-viewport').scrollLeft = $('cg-viewport').scrollTop = 0;
  }
  function move(from, to) {
    if (running || loading || from === to || to < 0 || to >= items.length) return;
    const item = items[from], reordered = reorderCollage(items, from, to); items.splice(0, items.length, ...reordered);
    renderList(); changed(`已将 ${item.file.name} 从第 ${from + 1} 张移到第 ${to + 1} 张。`);
    $(`cg-drag-${item.id}`)?.focus({ preventScroll: true });
  }
  function renderList() {
    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      const row = document.createElement('div'); row.className = 'cg-item'; row.dataset.cgId = item.id;
      const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'cg-drag'; handle.id = `cg-drag-${item.id}`; handle.textContent = '⠿'; handle.disabled = running || loading;
      handle.setAttribute('aria-label', `拖动排序 第 ${index + 1} 张：${item.file.name}`); handle.setAttribute('aria-describedby', 'cg-sort-help');
      const canvas = document.createElement('canvas'); canvas.width = 88; canvas.height = 64; canvas.className = 'cg-thumbnail cg-checker'; canvas.setAttribute('aria-hidden', 'true');
      const scale = Math.min(88 / item.width, 64 / item.height); canvas.getContext('2d').drawImage(item.preview, (88 - item.width * scale) / 2, (64 - item.height * scale) / 2, item.width * scale, item.height * scale);
      const info = document.createElement('div'); info.className = 'cg-item-info'; const name = document.createElement('strong'), meta = document.createElement('span');
      name.textContent = `${String(index + 1).padStart(2, '0')} / ${item.file.name}`; meta.textContent = `${item.width} × ${item.height} px · ${bytes(item.file.size)}`; info.append(name, meta);
      const actions = document.createElement('div'); actions.className = 'cg-item-actions';
      for (const [label, offset, glyph] of [['上移', -1, '↑'], ['下移', 1, '↓']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = glyph; button.className = 'cg-order-button'; button.setAttribute('aria-label', `${label}第 ${index + 1} 张`); button.disabled = running || loading || index + offset < 0 || index + offset >= items.length;
        button.addEventListener('click', () => move(index, index + offset)); actions.append(button);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button muted'; remove.textContent = '移除'; remove.disabled = running || loading; remove.setAttribute('aria-label', `移除第 ${index + 1} 张：${item.file.name}`);
      remove.addEventListener('click', () => { item.preview.close(); items.splice(index, 1); renderList(); changed(items.length ? '图片已移除，布局已更新。' : '请选择图片，或试试拼图示例。'); }); actions.append(remove);
      handle.addEventListener('pointerdown', event => {
        if (running || loading || !event.isPrimary || event.button !== 0) return;
        event.preventDefault(); drag = { pointer: event.pointerId, from: index, to: index, handle }; handle.setPointerCapture(event.pointerId); handle.focus({ preventScroll: true }); row.classList.add('is-dragging');
      });
      handle.addEventListener('pointermove', event => {
        if (drag?.pointer !== event.pointerId) return;
        const list = $('cg-list'), rect = list.getBoundingClientRect();
        if (event.clientY < rect.top + 26) list.scrollTop -= 16; if (event.clientY > rect.bottom - 26) list.scrollTop += 16;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-cg-id]');
        list.querySelectorAll('.is-drop-target').forEach(element => element.classList.remove('is-drop-target'));
        drag.to = target ? items.findIndex(candidate => candidate.id === Number(target.dataset.cgId)) : drag.from;
        if (target && drag.to !== drag.from) target.classList.add('is-drop-target');
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, event => finishDrag(event, type !== 'pointerup'));
      handle.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); move(index, event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1));
      });
      row.append(handle, canvas, info, actions); fragment.append(row);
    });
    $('cg-list').replaceChildren(fragment);
  }
  function finishDrag(event, cancel = false) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const previous = drag; drag = null;
    if (previous.handle.hasPointerCapture(event.pointerId)) previous.handle.releasePointerCapture(event.pointerId);
    $('cg-list').querySelectorAll('.is-dragging,.is-drop-target').forEach(element => element.classList.remove('is-dragging', 'is-drop-target'));
    if (!cancel) move(previous.from, previous.to);
  }
  function clear() {
    loadVersion++; loading = false; if (drag) finishDrag({ pointerId: drag.pointer }, true);
    for (const item of items) item.preview.close(); items.length = 0; invalidate(); layout = null;
    $('cg-canvas').width = $('cg-canvas').height = 1; message('cg-error'); renderList(); update(); $('cg-status').textContent = '图片只在当前浏览器处理，不上传、不保存输入历史。';
  }
  async function addFiles(files) {
    if (running || loading) { message('cg-error', '请等待当前任务结束，或先停止后再添加图片。'); return; }
    const incoming = Array.from(files); if (!incoming.length) return;
    if (drag) finishDrag({ pointerId: drag.pointer }, true);
    const ticket = ++loadVersion, rejected = []; loading = true; update(); renderList(); message('cg-error');
    for (const file of incoming) {
      if (ticket !== loadVersion) return;
      $('cg-status').textContent = `正在读取 ${file.name}…`; let source, preview;
      try {
        checkCollageFile(file, items.length, items.reduce((sum, item) => sum + item.file.size, 0));
        const decoded = await decodeCollageImage(file); source = decoded.image;
        if (ticket !== loadVersion) { source.close(); return; }
        preview = await createImagePreview(source);
        if (ticket !== loadVersion) { source.close(); preview.close(); return; }
        items.push({ id: ++nextID, file, width: source.width, height: source.height, preview }); source.close(); source = preview = null;
        invalidate(); renderList(); update(); paint();
      } catch (cause) { source?.close(); preview?.close(); rejected.push(`${file.name}：${cause.message}`); }
    }
    if (ticket !== loadVersion) return;
    loading = false; update(); renderList(); $('cg-status').textContent = items.length ? `已载入 ${items.length} 张图片。拖动调整顺序，选好布局后生成拼图。` : '没有载入可用图片，请检查提示后重新选择。';
    if (rejected.length) message('cg-error', rejected.join('\n'));
  }
  async function run() {
    if (running || loading || !items.length) return;
    let settings; try { settings = options(); collageLayout(items, settings); } catch (cause) { message('cg-settings-error', cause.message); return; }
    invalidate(); const ticket = version, controller = new AbortController(); abort = controller; running = true; message('cg-error'); update(); renderList(); paint();
    $('cg-progress').max = items.length; $('cg-progress').value = 0;
    try {
      const encoded = await encodeCollage(items, settings, { signal: controller.signal, onProgress: (done, total, text) => { if (!disposed && ticket === version) { $('cg-progress').value = done; $('cg-status').textContent = text; } } });
      if (disposed || ticket !== version) return;
      result = new File([encoded.blob], collageFilename(settings.name, settings.format), { type: encoded.blob.type }); resultURL = URL.createObjectURL(result); view = 'output';
      $('cg-status').textContent = '拼图已生成，可以下载，或继续加水印、压缩。';
    } catch (cause) { if (!disposed) { if (cause.name === 'AbortError') $('cg-status').textContent = '已停止生成，图片和布局已保留，可再次生成。'; else { message('cg-error', cause.message); $('cg-status').textContent = '生成失败，请调整尺寸或格式后重试。'; } } }
    finally { running = false; abort = null; if (!disposed) { update(); renderList(); paint(); } }
  }
  $('cg-files').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
  let depth = 0;
  $('cg-drop').addEventListener('dragenter', event => { event.preventDefault(); depth++; $('cg-drop').classList.add('drag-over'); });
  $('cg-drop').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  $('cg-drop').addEventListener('dragleave', event => { event.preventDefault(); if (--depth <= 0) { depth = 0; $('cg-drop').classList.remove('drag-over'); } });
  $('cg-drop').addEventListener('drop', event => { event.preventDefault(); depth = 0; $('cg-drop').classList.remove('drag-over'); addFiles(event.dataTransfer.files); });
  $('cg-clear').addEventListener('click', clear); $('cg-run').addEventListener('click', run);
  $('cg-stop').addEventListener('click', () => { abort?.abort(); $('cg-status').textContent = '正在停止，当前未完成的拼图会被丢弃…'; update(); });
  $('cg-settings').querySelectorAll('input,select').forEach(input => input.addEventListener('input', () => changed()));
  for (const name of ['layout', 'output']) $(`cg-view-${name}`).addEventListener('click', () => { view = name; update(); paint(); });
  $('cg-zoom').addEventListener('change', () => { $('cg-viewport').scrollLeft = $('cg-viewport').scrollTop = 0; paint(); });
  $('cg-download').addEventListener('click', () => {
    if (!result) return; const url = URL.createObjectURL(result), link = document.createElement('a'); downloads.add(url);
    link.href = url; link.download = result.name; document.body.append(link); link.click(); link.remove(); setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 30_000);
  });
  async function transfer(destination) {
    if (!result || result.size > COLLAGE_LIMITS.fileBytes || transferring || running) return;
    const file = result; transferring = true; update(); $('cg-transfer-note').textContent = '正在打开后续工具…';
    try { await (destination === 'watermark' ? sendToWatermark(file) : sendToCompressor(file)); $('cg-transfer-note').textContent = `已发送 ${file.name}，请在新标签页继续处理。`; notify(destination === 'watermark' ? '拼图已送至水印工具' : '拼图已送至压缩工具'); }
    catch (cause) { $('cg-transfer-note').textContent = cause.message; }
    finally { transferring = false; const disabled = running || !result || result.size > COLLAGE_LIMITS.fileBytes; $('cg-watermark').disabled = $('cg-compress').disabled = disabled; }
  }
  $('cg-watermark').addEventListener('click', () => transfer('watermark')); $('cg-compress').addEventListener('click', () => transfer('compress'));
  $('cg-sample').addEventListener('click', async () => {
    if (running || loading) return;
    const ticket = ++loadVersion; loading = true; update(); $('cg-status').textContent = '正在准备四张不同比例的示例图片…'; const files = [];
    try {
      for (const [index, [width, height, colors]] of [[1200, 800, ['#eacaab', '#c27e5c', '#638473', '#284e49']], [800, 1000, ['#d8e4de', '#85a5a0', '#4e777a', '#294e58']], [1000, 1000, ['#f0dfb8', '#c6a66c', '#9b8051', '#64533c']], [1600, 700, ['#e3d5d6', '#bb9292', '#8f717c', '#564b65']]].entries()) {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.scale(width / 1200, height / 800);
        ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, 1200, 800); ctx.fillStyle = '#fff4dc'; ctx.beginPath(); ctx.arc(930, 210, 85, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = colors[1]; ctx.beginPath(); ctx.moveTo(0, 610); ctx.bezierCurveTo(290, 240, 480, 300, 810, 650); ctx.lineTo(1200, 390); ctx.lineTo(1200, 800); ctx.lineTo(0, 800); ctx.fill();
        ctx.fillStyle = colors[2]; ctx.beginPath(); ctx.moveTo(0, 800); ctx.bezierCurveTo(280, 390, 470, 510, 770, 800); ctx.lineTo(1200, 580); ctx.lineTo(1200, 800); ctx.fill();
        ctx.fillStyle = colors[3]; ctx.beginPath(); ctx.moveTo(0, 800); ctx.bezierCurveTo(360, 570, 630, 850, 1200, 710); ctx.lineTo(1200, 800); ctx.fill();
        ctx.fillStyle = '#2c3833'; ctx.font = '600 54px system-ui'; ctx.fillText(['01 / EARTH', '02 / STILL', '03 / WARM', '04 / DUSK'][index], 65, 110); ctx.font = '20px system-ui'; ctx.fillText('SGAO / LITTLE MOMENTS, TOGETHER.', 68, 153);
        const mime = index === 1 ? 'image/jpeg' : 'image/png', blob = await new Promise(resolve => canvas.toBlob(resolve, mime, .92)); canvas.width = canvas.height = 1;
        if (!blob) throw new Error('示例图片生成失败，请选择本地图片。'); files.push(new File([blob], `sgao-collage-${index + 1}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`, { type: mime }));
      }
      if (ticket === loadVersion) { loading = false; await addFiles(files); }
    } catch (cause) { if (ticket === loadVersion) { loading = false; message('cg-error', cause.message); update(); } }
  });
  const observer = new ResizeObserver(schedulePaint); observer.observe($('cg-viewport'));
  window.addEventListener('pagehide', event => {
    abort?.abort(); loadVersion++; loading = false; if (drag) finishDrag({ pointerId: drag.pointer }, true);
    if (event.persisted) return;
    disposed = true; version++; if (frame) cancelAnimationFrame(frame); observer.disconnect(); items.forEach(item => item.preview.close());
    if (resultURL) URL.revokeObjectURL(resultURL); downloads.forEach(url => URL.revokeObjectURL(url));
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { update(); schedulePaint(); } });
  update();
}
