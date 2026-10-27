import { PDF_LIMITS, MM, checkPDFFile, checkPDFDimensions, validateImagePDF, imagePDFPage, pdfFilename } from './lib/image-pdf.js';
import { decodeLocalImage, createImagePreview } from './local-image.js';
import { runPDFTask } from './pdf-task.js';
import { receiveProcessedImage } from './image-transfer.js';

export function initImagePDF({ notify }) {
  const $ = id => document.getElementById(id), items = [], generated = new Map(), downloadURLs = new Set();
  let nextID = 0, selected = 0, loading = false, running = false, disposed = false, loadVersion = 0, version = 0, controller, result, frame = 0, view = 'layout', drag;
  const bytes = size => size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(2)} MB`;
  const message = (id, text = '') => { $(id).textContent = text; $(id).hidden = !text; };
  const number = id => $(id).value.trim() === '' ? NaN : Number($(id).value);
  const options = () => ({ paper: $('ip-paper').value, orientation: $('ip-orientation').value, fit: $('ip-fit').value, margin: number('ip-margin'), background: $('ip-background').value, encoding: $('ip-encoding').value, quality: number('ip-quality'), maxEdge: number('ip-max-edge'), name: $('ip-name').value });
  function clearGenerated() { for (const page of generated.values()) page.bitmap.close(); generated.clear(); }
  function invalidate() { version++; result = null; view = 'layout'; clearGenerated(); $('ip-progress').value = 0; }
  function layout() { return items[selected] ? imagePDFPage(items[selected], options()) : null; }
  function update() {
    let plan, valid = false;
    try { validateImagePDF(options()); plan = layout(); valid = !!plan; message('ip-settings-error'); } catch (cause) { message('ip-settings-error', cause.message); }
    const busy = running || loading;
    $('ip-workspace').hidden = $('ip-jumps').hidden = !items.length; $('ip-drop').classList.toggle('is-loaded', !!items.length);
    $('ip-files').disabled = $('ip-sample').disabled = busy; $('ip-clear').disabled = running || !items.length && !loading;
    $('ip-settings').disabled = running; $('ip-orientation').disabled = running || $('ip-paper').value === 'image'; $('ip-fit').disabled = running || $('ip-paper').value === 'image';
    $('ip-quality').disabled = running || $('ip-encoding').value === 'lossless'; $('ip-quality-value').textContent = `${$('ip-quality').value}%`;
    $('ip-encoding-note').textContent = $('ip-encoding').value === 'lossless' ? 'PNG 无损编码处理后的像素，文件可能明显增大；可限制最长边。' : 'JPEG 有损压缩适合照片；文字截图建议提高质量，或选择无损 PNG。';
    $('ip-run').disabled = busy || !valid; $('ip-run').textContent = running ? '正在生成 PDF…' : result ? '重新生成 PDF' : '生成 PDF';
    $('ip-stop').hidden = !running; $('ip-stop').disabled = !!controller?.signal.aborted;
    $('ip-download').disabled = !result || running;
    $('ip-view-output').disabled = !result;
    for (const mode of ['layout', 'output']) $(`ip-view-${mode}`).setAttribute('aria-pressed', String(view === mode));
    $('ip-prev').disabled = selected <= 0; $('ip-next').disabled = selected >= items.length - 1;
    $('ip-page').replaceChildren(...items.map((item, index) => { const option = document.createElement('option'); option.value = index; option.textContent = `第 ${index + 1} 页 / 共 ${items.length} 页`; option.selected = index === selected; return option; }));
    const total = items.reduce((sum, item) => sum + item.file.size, 0);
    $('ip-count').textContent = `${items.length} 页 · 原图 ${bytes(total)}`;
    $('ip-page-info').textContent = plan ? `${(plan.width / MM).toFixed(1)} × ${(plan.height / MM).toFixed(1)} mm · ${items[selected].file.name}` : '等待有效页面设置';
    $('ip-page-meta').textContent = plan ? `内嵌图片 ${plan.raster.width} × ${plan.raster.height} px${plan.cropped ? ' · 已居中裁切' : ' · 完整显示'}` : '';
    message('ip-crop-note', plan?.cropped ? '当前选择会裁去超出可用区域的部分；切换「完整显示」可保留整张图片。' : '');
    $('ip-preview-note').textContent = view === 'output' && result ? '生成页预览使用 PDF 内嵌图片的缩略图与相同排版；检查原始清晰度请打开下载的 PDF。' : '页面布局预览使用缩略图，生成后可切换查看处理后的图片排版。';
    $('ip-result-name').textContent = result ? result.name : '把图片，整理成一份文档';
    $('ip-result-meta').textContent = result ? `${items.length} 页 · ${bytes(result.size)} · ${result.size <= total ? '比原图合计小' : '比原图合计大'} ${bytes(Math.abs(result.size - total))}` : '一张图片一页 · PDF 最高 100 MB';
    schedulePaint();
  }
  function paint() {
    frame = 0; if (!items.length || !$('ip-viewport').clientWidth) return;
    let plan; try { plan = layout(); } catch { /* The settings error is shown beside the inputs. */ }
    $('ip-stage').hidden = !plan; $('ip-preview-empty').hidden = !!plan; if (!plan) return;
    const viewport = $('ip-viewport'), scale = Math.min((viewport.clientWidth - 44) / plan.width, (viewport.clientHeight - 44) / plan.height);
    $('ip-stage').style.width = `${Math.max(1, plan.width * scale)}px`; $('ip-stage').style.height = `${Math.max(1, plan.height * scale)}px`;
    const canvas = $('ip-canvas'), resolution = Math.min(2, 1600 / Math.max(plan.width, plan.height));
    canvas.width = Math.max(1, Math.round(plan.width * resolution)); canvas.height = Math.max(1, Math.round(plan.height * resolution));
    const ctx = canvas.getContext('2d'); ctx.scale(canvas.width / plan.width, canvas.height / plan.height); ctx.fillStyle = options().background; ctx.fillRect(0, 0, plan.width, plan.height); ctx.imageSmoothingQuality = 'high';
    const item = items[selected], output = view === 'output' && result ? generated.get(selected) : null, bitmap = output?.bitmap || item.preview;
    const crop = output ? { x: 0, y: 0, width: bitmap.width, height: bitmap.height } : { x: plan.crop.x * bitmap.width / item.width, y: plan.crop.y * bitmap.height / item.height, width: plan.crop.width * bitmap.width / item.width, height: plan.crop.height * bitmap.height / item.height };
    const target = plan.target; ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, target.x, target.y, target.width, target.height);
  }
  function schedulePaint() { if (!frame && !disposed) frame = requestAnimationFrame(paint); }
  function changed(text = '设置已更新，请重新生成 PDF。') { if (running) return; invalidate(); update(); $('ip-status').textContent = text; }
  function select(index) { selected = index; renderList(); update(); }
  function move(from, to) {
    if (running || loading || from === to || to < 0 || to >= items.length) return;
    const chosen = items[selected], [item] = items.splice(from, 1); items.splice(to, 0, item); selected = items.indexOf(chosen);
    renderList(); changed(`已将 ${item.file.name} 从第 ${from + 1} 页移到第 ${to + 1} 页。`); $(`ip-drag-${item.id}`).focus({ preventScroll: true });
  }
  function finishDrag(event, cancel = false) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const previous = drag; drag = null; if (previous.handle.hasPointerCapture(event.pointerId)) previous.handle.releasePointerCapture(event.pointerId);
    $('ip-list').querySelectorAll('.is-dragging,.is-drop-target').forEach(row => row.classList.remove('is-dragging', 'is-drop-target'));
    if (!cancel) move(previous.from, previous.to);
  }
  function renderList() {
    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      const row = document.createElement('div'); row.className = `ip-item${index === selected ? ' is-selected' : ''}`; row.dataset.ipId = item.id;
      const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'ip-drag'; handle.id = `ip-drag-${item.id}`; handle.textContent = '⠿'; handle.disabled = running || loading;
      handle.setAttribute('aria-label', `拖动排序 第 ${index + 1} 页：${item.file.name}`); handle.setAttribute('aria-describedby', 'ip-sort-help');
      handle.addEventListener('pointerdown', event => { if (running || loading || !event.isPrimary || event.button !== 0) return; event.preventDefault(); drag = { pointer: event.pointerId, from: index, to: index, handle }; handle.setPointerCapture(event.pointerId); handle.focus({ preventScroll: true }); row.classList.add('is-dragging'); });
      handle.addEventListener('pointermove', event => {
        if (drag?.pointer !== event.pointerId) return;
        const list = $('ip-list'), rect = list.getBoundingClientRect(); if (event.clientY < rect.top + 26) list.scrollTop -= 16; if (event.clientY > rect.bottom - 26) list.scrollTop += 16;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-ip-id]'); list.querySelectorAll('.is-drop-target').forEach(element => element.classList.remove('is-drop-target'));
        drag.to = target ? items.findIndex(candidate => candidate.id === Number(target.dataset.ipId)) : drag.from; if (target && drag.to !== drag.from) target.classList.add('is-drop-target');
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, event => finishDrag(event, type !== 'pointerup'));
      handle.addEventListener('keydown', event => { if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); move(index, event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1)); });
      const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'ip-select'; choose.setAttribute('aria-label', `预览第 ${index + 1} 页：${item.file.name}`); choose.setAttribute('aria-pressed', String(index === selected)); choose.addEventListener('click', () => select(index));
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 68; canvas.setAttribute('aria-hidden', 'true');
      const scale = Math.min(80 / item.width, 68 / item.height); canvas.getContext('2d').drawImage(item.preview, (80 - item.width * scale) / 2, (68 - item.height * scale) / 2, item.width * scale, item.height * scale);
      const info = document.createElement('span'), name = document.createElement('strong'), meta = document.createElement('small');
      name.textContent = `${String(index + 1).padStart(2, '0')} / ${item.file.name}`; meta.textContent = `${item.width} × ${item.height} px · ${bytes(item.file.size)}`; info.append(name, meta); choose.append(canvas, info);
      const actions = document.createElement('div'); actions.className = 'ip-item-actions';
      for (const [label, offset, glyph] of [['上移', -1, '↑'], ['下移', 1, '↓']]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = glyph; button.setAttribute('aria-label', `${label}第 ${index + 1} 页`); button.disabled = running || loading || index + offset < 0 || index + offset >= items.length; button.addEventListener('click', () => move(index, index + offset)); actions.append(button); }
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除'; remove.className = 'ip-remove'; remove.disabled = running || loading; remove.setAttribute('aria-label', `移除第 ${index + 1} 页：${item.file.name}`);
      remove.addEventListener('click', () => { const chosen = items[selected]; item.preview.close(); items.splice(index, 1); selected = Math.max(0, chosen === item ? Math.min(index, items.length - 1) : items.indexOf(chosen)); renderList(); changed(items.length ? '页面已移除，请重新生成 PDF。' : '请选择图片，或试试三页示例。'); }); actions.append(remove);
      row.append(handle, choose, actions); fragment.append(row);
    }); $('ip-list').replaceChildren(fragment);
  }
  function clear() {
    loadVersion++; loading = false; if (drag) finishDrag({ pointerId: drag.pointer }, true); items.forEach(item => item.preview.close()); items.length = 0; selected = 0; invalidate();
    $('ip-canvas').width = $('ip-canvas').height = 1; message('ip-error'); renderList(); update(); $('ip-status').textContent = '图片只在浏览器内处理，刷新或关闭页面后清除。';
  }
  async function addFiles(files) {
    if (loading || running) { message('ip-error', '请等待当前任务结束，或停止后再添加图片。'); return; }
    const incoming = Array.from(files); if (!incoming.length) return;
    if (drag) finishDrag({ pointerId: drag.pointer }, true);
    const ticket = ++loadVersion, rejected = []; loading = true; message('ip-error'); update(); renderList();
    for (const file of incoming) {
      if (ticket !== loadVersion) return;
      $('ip-status').textContent = `正在读取 ${file.name}…`; let image, preview;
      try {
        checkPDFFile(file, items.length, items.reduce((sum, item) => sum + item.file.size, 0)); ({ image } = await decodeLocalImage(file, checkPDFDimensions));
        if (ticket !== loadVersion) { image.close(); return; }
        preview = await createImagePreview(image); if (ticket !== loadVersion) { image.close(); preview.close(); return; }
        items.push({ id: ++nextID, file, width: image.width, height: image.height, preview }); image.close(); image = preview = null; invalidate(); renderList(); update();
      } catch (cause) { image?.close(); preview?.close(); rejected.push(`${file.name}：${cause.message}`); }
    }
    if (ticket !== loadVersion) return;
    loading = false; renderList(); update(); $('ip-status').textContent = items.length ? `已载入 ${items.length} 张图片，每张对应一页。调整顺序和排版后生成 PDF。` : '没有载入可用图片，请检查提示后重试。';
    if (rejected.length) message('ip-error', rejected.join('\n'));
  }
  async function run() {
    if (loading || running || !items.length) return;
    let settings; try { settings = validateImagePDF(options()); items.forEach(item => imagePDFPage(item, settings)); } catch (cause) { message('ip-settings-error', cause.message); return; }
    invalidate(); const ticket = version, task = new AbortController(), jobs = []; controller = task; running = true; message('ip-error'); update(); renderList(); $('ip-progress').max = items.length;
    try {
      const blob = await runPDFTask(items, settings, {
        signal: task.signal,
        onProgress: (done, total, text) => { if (!disposed && ticket === version) { $('ip-progress').value = done; $('ip-status').textContent = text; } },
        onPage: page => { const job = (async () => { const bitmap = await createImageBitmap(page.preview); if (disposed || ticket !== version || task.signal.aborted) bitmap.close(); else generated.set(page.index, { ...page, bitmap }); })(); job.catch(() => {}); jobs.push(job); },
      });
      const pages = await Promise.allSettled(jobs); if (pages.some(page => page.status === 'rejected')) throw new Error('无法创建页面预览，请降低最长边后重试。');
      if (disposed || ticket !== version || task.signal.aborted) return;
      if (generated.size !== items.length) throw new Error('页面预览不完整，请重新生成。');
      result = new File([blob], pdfFilename(settings.name), { type: 'application/pdf' }); view = 'output'; $('ip-status').textContent = 'PDF 已生成。逐页检查排版后，即可下载。'; notify('PDF 已生成');
    } catch (cause) {
      await Promise.allSettled(jobs); clearGenerated();
      if (!disposed) { if (cause.name === 'AbortError') $('ip-status').textContent = '已停止生成，图片和设置已保留。'; else { message('ip-error', cause.message); $('ip-status').textContent = '生成失败，请按提示调整后重试。'; } }
    } finally { running = false; controller = null; if (!disposed) { update(); renderList(); } }
  }
  $('ip-files').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
  let depth = 0;
  $('ip-drop').addEventListener('dragenter', event => { event.preventDefault(); depth++; $('ip-drop').classList.add('drag-over'); });
  $('ip-drop').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  $('ip-drop').addEventListener('dragleave', event => { event.preventDefault(); if (--depth <= 0) { depth = 0; $('ip-drop').classList.remove('drag-over'); } });
  $('ip-drop').addEventListener('drop', event => { event.preventDefault(); depth = 0; $('ip-drop').classList.remove('drag-over'); addFiles(event.dataTransfer.files); });
  $('ip-clear').addEventListener('click', clear); $('ip-run').addEventListener('click', run); $('ip-stop').addEventListener('click', () => { controller?.abort(); $('ip-status').textContent = '正在停止，未完成的 PDF 会被丢弃…'; update(); });
  $('ip-settings').querySelectorAll('input,select').forEach(input => input.addEventListener('input', () => changed()));
  $('ip-preset').addEventListener('change', () => { const preset = $('ip-preset').value; if (preset === 'custom') return; $('ip-encoding').value = preset === 'clear' ? 'lossless' : 'jpeg'; $('ip-quality').value = preset === 'small' ? '75' : '90'; $('ip-max-edge').value = preset === 'clear' ? '0' : preset === 'small' ? '1600' : '2560'; changed(); });
  for (const id of ['ip-encoding', 'ip-quality', 'ip-max-edge']) $(id).addEventListener('input', () => { $('ip-preset').value = 'custom'; });
  $('ip-prev').addEventListener('click', () => select(Math.max(0, selected - 1))); $('ip-next').addEventListener('click', () => select(Math.min(items.length - 1, selected + 1))); $('ip-page').addEventListener('change', event => select(Number(event.target.value)));
  for (const mode of ['layout', 'output']) $(`ip-view-${mode}`).addEventListener('click', () => { view = mode; update(); });
  $('ip-download').addEventListener('click', () => { if (!result) return; const url = URL.createObjectURL(result), link = document.createElement('a'); downloadURLs.add(url); link.href = url; link.download = result.name; document.body.append(link); link.click(); link.remove(); setTimeout(() => { URL.revokeObjectURL(url); downloadURLs.delete(url); }, 30_000); });
  $('ip-sample').addEventListener('click', async () => {
    if (loading || running) return; const ticket = ++loadVersion; loading = true; update(); $('ip-status').textContent = '正在准备三张不同比例的示例图片…'; const files = [];
    try {
      for (const [index, [width, height, color]] of [[1200, 1600, '#ec6245'], [1600, 1000, '#427c60'], [1000, 1000, '#b08a4b']].entries()) {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fffdf8'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = color; ctx.fillRect(0, 0, width, 30); ctx.fillRect(80, 90, 70, 70); ctx.fillStyle = '#292c30'; ctx.font = '600 50px system-ui'; ctx.fillText(['01 / PROJECT NOTES', '02 / THE BIG PICTURE', '03 / LITTLE DETAILS'][index], 80, 240);
        ctx.font = '24px system-ui'; ctx.fillStyle = '#757872'; ctx.fillText('SGAO / ONE IMAGE. ONE PAGE.', 82, 295);
        ctx.fillStyle = color; ctx.globalAlpha = .16; ctx.fillRect(80, 365, width - 160, height * .28); ctx.globalAlpha = 1; ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(width * .63, 365 + height * .14, Math.min(width, height) * .09, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d8d8d0'; for (let line = 0; line < 4; line++) ctx.fillRect(80, height * .66 + line * 45, (width - 160) * (line === 3 ? .65 : 1), 8);
        ctx.font = '18px system-ui'; ctx.fillStyle = '#757872'; ctx.fillText(`SGAO TOOLS / ${width} x ${height}`, 80, height - 65);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, index === 1 ? 'image/jpeg' : 'image/png', .94)); canvas.width = canvas.height = 1;
        if (!blob) throw new Error('示例生成失败，请选择本地图片。'); files.push(new File([blob], `sgao-page-${index + 1}.${index === 1 ? 'jpg' : 'png'}`, { type: blob.type }));
      }
      if (ticket === loadVersion) { loading = false; await addFiles(files); }
    } catch (cause) { if (ticket === loadVersion) { loading = false; message('ip-error', cause.message); update(); } }
  });
  const observer = new ResizeObserver(schedulePaint); observer.observe($('ip-viewport'));
  window.addEventListener('pagehide', event => { controller?.abort(); loadVersion++; loading = false; if (drag) finishDrag({ pointerId: drag.pointer }, true); if (event.persisted) return; disposed = true; version++; observer.disconnect(); if (frame) cancelAnimationFrame(frame); clearGenerated(); items.forEach(item => item.preview.close()); downloadURLs.forEach(url => URL.revokeObjectURL(url)); });
  window.addEventListener('pageshow', event => { if (event.persisted) update(); });
  update(); receiveProcessedImage(file => { addFiles([file]); notify('已接收图片，可以继续生成 PDF'); }, text => message('ip-error', text));
}
