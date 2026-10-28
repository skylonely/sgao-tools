import { checkPDFInput, pdfImageStem } from './lib/pdf-images.js';
import { pdfWatermarkPlan } from './lib/pdf-watermark.js';
import { openLocalPDF, renderPDFImage, pdfLoadError } from './pdf-images-engine.js';
import { organizerTask } from './pdf-organizer-task.js';
import { createPDFOverlay, preparePDFLogo } from './pdf-watermark-overlay.js';
import { runPDFWatermark } from './pdf-watermark-task.js';

export function initPDFWatermark({ notify }) {
  const $ = id => document.getElementById(id), views = new Map();
  let source, output, sourceSession, outputSession, count = 0, page = 1, mode = 'layout', panel = 'watermark';
  let version = 0, previewTicket = 0, logoTicket = 0, loading = false, running = false, logoLoading = false, disposed = false, controller, previewController, timer, overlayURL, logo, logoFile;
  const bytes = size => size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(2)} MB`;
  const message = (id, text = '') => { $(id).textContent = text; $(id).hidden = !text; };
  const number = id => $(id).value.trim() === '' ? NaN : Number($(id).value);
  function options() {
    return {
      pagesMode: $('pw-pages-mode').value, range: $('pw-range').value, name: $('pw-name').value,
      watermark: { enabled: $('pw-watermark-enabled').checked, type: $('pw-type').value, text: $('pw-text').value, font: $('pw-font').value, bold: $('pw-bold').checked, textSize: number('pw-text-size'), logoSize: number('pw-logo-size'), color: $('pw-color').value, opacity: number('pw-opacity'), angle: number('pw-angle'), mode: $('pw-layout').value, anchor: $('pw-anchor').value, margin: number('pw-margin'), gap: number('pw-gap'), background: '#ffffff', format: 'image/png', quality: 100, x: 50, y: 50 },
      numbering: { enabled: $('pw-number-enabled').checked, format: $('pw-number-format').value, anchor: $('pw-number-anchor').value, start: number('pw-number-start'), skipCover: $('pw-skip-cover').checked, size: number('pw-number-size'), margin: number('pw-number-margin'), color: $('pw-number-color').value, opacity: number('pw-number-opacity') },
    };
  }
  function closeSession(record) { if (!record) return; record.closed = true; clearTimeout(record.timer); record.task?.destroy().catch(() => {}); if (record.base) URL.revokeObjectURL(record.base.url); }
  function newSession(file) {
    const record = { closed: false };
    record.promise = openLocalPDF(file, {
      onTask(task) { record.task = task; if (record.closed || disposed) { task.destroy().catch(() => {}); return; } record.timer = setTimeout(() => { task.destroy().catch(() => {}); }, 60_000); },
      onPassword() { record.task?.destroy().catch(() => {}); },
    }).then(doc => { clearTimeout(record.timer); if (record.closed || disposed) { doc.destroy().catch(() => {}); throw new DOMException('预览已停止', 'AbortError'); } return doc; }).catch(cause => { clearTimeout(record.timer); throw cause; });
    return record;
  }
  function clearOverlay() { if (overlayURL) URL.revokeObjectURL(overlayURL); overlayURL = null; $('pw-overlay-image').hidden = true; $('pw-overlay-image').removeAttribute('src'); }
  function invalidate(text) {
    version++; previewTicket++; previewController?.abort(); clearOverlay();
    if (output) URL.revokeObjectURL(output.url); output = null; closeSession(outputSession); outputSession = null; mode = 'layout';
    $('pw-download').removeAttribute('href'); $('pw-download').setAttribute('aria-disabled', 'true'); $('pw-download').tabIndex = -1; $('pw-progress').value = 0; message('pw-error');
    if (text) $('pw-status').textContent = text;
  }
  async function pageView(number, signal) {
    if (signal?.aborted) throw new DOMException('处理已停止', 'AbortError');
    if (views.has(number)) return views.get(number);
    const doc = await sourceSession.promise, current = await doc.getPage(number), viewport = current.getViewport({ scale: 1 });
    const view = { width: viewport.width, height: viewport.height, transform: Array.from(viewport.transform) }; current.cleanup();
    if (signal?.aborted) throw new DOMException('处理已停止', 'AbortError');
    views.set(number, view); return view;
  }
  async function basePreview(record, currentPage, signal) {
    if (record.base?.page === currentPage) return record.base;
    const doc = await record.promise;
    const result = await renderPDFImage(doc, currentPage, { mode: 'edge', edge: 1000, dpi: 72, format: 'image/png', quality: 100, background: 'color', color: '#ffffff' }, { signal });
    if (record.closed || signal.aborted) throw new DOMException('预览已停止', 'AbortError');
    if (record.base) URL.revokeObjectURL(record.base.url);
    record.base = { page: currentPage, url: URL.createObjectURL(result.blob), width: result.width, height: result.height }; return record.base;
  }
  function fit() {
    const image = $('pw-page-image'); if (image.hidden || !image.naturalWidth) return;
    const viewport = $('pw-viewport'), scale = Math.min((viewport.clientWidth - 44) / image.naturalWidth, (viewport.clientHeight - 44) / image.naturalHeight);
    $('pw-stage').style.width = `${image.naturalWidth * scale}px`; $('pw-stage').style.height = `${image.naturalHeight * scale}px`;
  }
  async function preview() {
    if (disposed) return; const ticket = ++previewTicket; previewController?.abort(); clearOverlay();
    $('pw-stage').hidden = true; $('pw-preview-empty').hidden = false; $('pw-preview-empty').textContent = '正在渲染页面…';
    const record = mode === 'output' ? outputSession : sourceSession;
    if (!record) { $('pw-preview-empty').textContent = '选择 PDF 后可逐页检查。'; return; }
    const abort = new AbortController(); previewController = abort;
    try {
      const currentPage = page, currentMode = mode, base = await basePreview(record, currentPage, abort.signal);
      if (ticket !== previewTicket || disposed) return;
      $('pw-page-image').src = base.url; $('pw-page-image').hidden = false; $('pw-stage').hidden = false; $('pw-preview-empty').hidden = true;
      if (currentMode === 'layout') {
        try {
          const planned = pdfWatermarkPlan(count, options()), item = planned.plan.find(item => item.page === currentPage);
          if (item) {
            const view = await pageView(currentPage, abort.signal), layer = await createPDFOverlay(view, planned.options, item, logo, { preview: true, signal: abort.signal });
            if (ticket !== previewTicket || disposed) return;
            overlayURL = URL.createObjectURL(layer.blob); $('pw-overlay-image').src = overlayURL; $('pw-overlay-image').hidden = false;
            $('pw-preview-note').textContent = `效果预览使用相同水印布局；生成后请切换「导出结果」检查实际 PDF。${layer.adjusted ? ' 平铺过密，已自动调大间距。' : ''}`;
          } else $('pw-preview-note').textContent = '当前页面没有要添加的水印或页码，导出时会保留原页面。';
        } catch (cause) { if (cause.name === 'AbortError') throw cause; $('pw-preview-note').textContent = `当前显示原文档：${cause.message}`; }
      } else $('pw-preview-note').textContent = currentMode === 'output' ? '此预览直接读取已生成的 PDF，可逐页检查添加效果。' : '当前显示原文档，未叠加水印或页码。';
      if (ticket === previewTicket) fit();
    } catch (cause) { if (ticket === previewTicket && !disposed && cause.name !== 'AbortError') { $('pw-stage').hidden = true; $('pw-preview-empty').hidden = false; $('pw-preview-empty').textContent = `预览不可用：${pdfLoadError(cause)}`; } }
  }
  function schedulePreview() { clearTimeout(timer); timer = setTimeout(preview, 130); }
  function update() {
    let planned, error = '';
    if (count) { try { planned = pdfWatermarkPlan(count, options()); if (planned.options.watermark.enabled && planned.options.watermark.type === 'logo' && !logo) throw new Error('请选择一张 Logo 图片，或切换为文字水印。'); } catch (cause) { error = cause.message; } }
    message('pw-settings-error', error);
    const busy = loading || running || logoLoading;
    $('pw-workspace').hidden = $('pw-jumps').hidden = !count; $('pw-drop').classList.toggle('is-loaded', !!source);
    $('pw-file').disabled = $('pw-sample').disabled = busy; $('pw-clear').disabled = !source && !loading;
    $('pw-settings').disabled = busy; $('pw-run').disabled = busy || !count || !!error;
    $('pw-run').textContent = running ? '正在添加…' : output ? '重新生成 PDF' : '生成 PDF'; $('pw-stop').hidden = !loading && !running; $('pw-stop').disabled = !!controller?.signal.aborted;
    $('pw-range').disabled = busy || $('pw-pages-mode').value === 'all';
    $('pw-text-fields').hidden = $('pw-type').value !== 'text'; $('pw-logo-fields').hidden = $('pw-type').value !== 'logo';
    $('pw-single-fields').hidden = $('pw-layout').value !== 'single'; $('pw-tile-fields').hidden = $('pw-layout').value !== 'tile';
    $('pw-watermark-controls').hidden = panel !== 'watermark' || !$('pw-watermark-enabled').checked;
    $('pw-number-controls').hidden = panel !== 'number' || !$('pw-number-enabled').checked;
    $('pw-panel-off').hidden = panel === 'watermark' ? $('pw-watermark-enabled').checked : $('pw-number-enabled').checked;
    $('pw-panel-off').textContent = panel === 'watermark' ? '勾选「添加水印」后设置内容。' : '勾选「添加页码」后设置编号。';
    for (const value of ['watermark', 'number']) $(`pw-panel-${value}`).setAttribute('aria-pressed', String(panel === value));
    $('pw-logo-name').textContent = logoFile ? `${logoFile.name} · ${logo.width} × ${logo.height} px` : 'PNG / JPG / WebP，最高 5 MB、4096 px。';
    $('pw-source-name').textContent = source?.name || '';
    $('pw-source-meta').textContent = source ? `${count} 页 · ${bytes(source.size)} · 原始页面全部保留` : '';
    $('pw-plan').textContent = planned && !error ? `水印 ${planned.watermarkPages} 页 · 页码 ${planned.numberPages} 页 · 输出保留 ${count} 页` : '请修正设置后再生成。';
    $('pw-number-note').textContent = planned && planned.numberPages ? `所选页面连续编号，从 ${planned.options.numbering.start} 到 ${planned.last}；分母为最后一个编号。跳过封面仅影响页码。` : '从所选且未跳过封面的第一页开始连续编号，水印范围不受影响。';
    $('pw-page').replaceChildren(...Array.from({ length: count }, (_, index) => { const option = document.createElement('option'); option.value = index + 1; option.textContent = `第 ${index + 1} 页 / 共 ${count} 页`; option.selected = page === index + 1; return option; }));
    $('pw-prev').disabled = page <= 1; $('pw-next').disabled = page >= count;
    for (const value of ['layout', 'original', 'output']) $(`pw-view-${value}`).setAttribute('aria-pressed', String(mode === value));
    $('pw-view-output').disabled = !output; $('pw-page-info').textContent = `${mode === 'output' ? '实际导出 PDF' : mode === 'original' ? '原文档' : '效果预览'} · 第 ${page} 页 / 共 ${count} 页`;
    $('pw-result-name').textContent = output?.name || '检查效果后，生成一份新 PDF'; $('pw-result-meta').textContent = output ? `${output.count} 页 · ${bytes(output.blob.size)} · 水印 ${output.watermarkPages} 页 / 页码 ${output.numberPages} 页` : '输出最高 50 MB · 原文件保持不变';
    const disabled = !output || busy; $('pw-download').setAttribute('aria-disabled', String(disabled)); $('pw-download').tabIndex = disabled ? -1 : 0;
    $('pw-page-map').replaceChildren(...Array.from({ length: count }, (_, i) => {
      const item = planned?.plan.find(item => item.page === i + 1), button = document.createElement('button'), title = document.createElement('strong'), info = document.createElement('small');
      button.type = 'button'; button.setAttribute('aria-label', `预览第 ${i + 1} 页`); button.setAttribute('aria-pressed', String(page === i + 1)); title.textContent = String(i + 1).padStart(3, '0'); info.textContent = error ? '待修正' : item ? `${item.watermark ? '水印' : ''}${item.watermark && item.label ? ' · ' : ''}${item.label || ''}` : '保留原页'; button.append(title, info); button.addEventListener('click', () => select(i + 1)); return button;
    }));
  }
  function select(value) { if (!Number.isInteger(value) || value < 1 || value > count) return; page = value; update(); preview(); }
  function changed() { if (running || loading) return; invalidate('设置已更新，请重新生成 PDF。'); update(); schedulePreview(); }
  async function loadPDF(file) {
    if (!file || loading || running || logoLoading || disposed) return;
    try { checkPDFInput(file); } catch (cause) { message('pw-error', cause.message); return; }
    invalidate(); closeSession(sourceSession); sourceSession = null; views.clear(); source = file; count = 0; page = 1;
    const ticket = version, abort = new AbortController(); controller = abort; loading = true; update(); $('pw-status').textContent = `正在检查 ${file.name}…`;
    try {
      const info = await organizerTask('inspect', { file }, { signal: abort.signal });
      if (ticket !== version || abort.signal.aborted) return;
      sourceSession = newSession(file); const stop = () => closeSession(sourceSession); abort.signal.addEventListener('abort', stop, { once: true });
      try { await sourceSession.promise; } finally { abort.signal.removeEventListener('abort', stop); }
      if (ticket !== version || abort.signal.aborted) return;
      count = info.count; $('pw-name').value = pdfImageStem(file.name); $('pw-status').textContent = `已打开 ${count} 页，设置水印与页码后可逐页预览。`;
    } catch (cause) { if (ticket === version) { closeSession(sourceSession); sourceSession = null; source = null; count = 0; if (cause.name !== 'AbortError') message('pw-error', pdfLoadError(cause)); $('pw-status').textContent = cause.name === 'AbortError' ? '读取已停止。' : '文档未载入，请检查后重试。'; } }
    finally { if (ticket === version && !disposed) { loading = false; controller = null; update(); preview(); } }
  }
  async function loadLogo(file) {
    if (!file || loading || running || logoLoading) return;
    const ticket = ++logoTicket; logoLoading = true; invalidate(); update();
    try {
      const image = await preparePDFLogo(file); if (ticket !== logoTicket || disposed) { image.close(); return; }
      logo?.close(); logo = image; logoFile = file; $('pw-type').value = 'logo'; $('pw-status').textContent = 'Logo 已载入，请检查不同方向页面的效果。';
    } catch (cause) { if (ticket === logoTicket) message('pw-error', cause.message); }
    finally { if (ticket === logoTicket && !disposed) { logoLoading = false; update(); preview(); } }
  }
  async function run() {
    if (running || loading || logoLoading || !source) return;
    let planned; try { planned = pdfWatermarkPlan(count, options()); if (planned.options.watermark.enabled && planned.options.watermark.type === 'logo' && !logo) throw new Error('请选择 Logo 图片。'); } catch { update(); return; }
    invalidate(); running = true; const ticket = version, abort = new AbortController(), cache = new Map(); controller = abort; update();
    try {
      const result = await runPDFWatermark(source, planned.options, {
        signal: abort.signal,
        onProgress(done, total, text) { if (ticket === version) { $('pw-progress').max = total; $('pw-progress').value = done; $('pw-status').textContent = text; } },
        async onOverlay(item) {
          if (ticket !== version || abort.signal.aborted) throw new DOMException('处理已停止', 'AbortError');
          const view = await pageView(item.page, abort.signal), key = JSON.stringify([view.width, view.height, item.watermark, item.label]);
          let png = cache.get(key);
          if (!png) { const layer = await createPDFOverlay(view, planned.options, item, logo, { signal: abort.signal }); png = new Uint8Array(await layer.blob.arrayBuffer()); cache.set(key, png); if (cache.size > 8) cache.delete(cache.keys().next().value); }
          if (ticket !== version || abort.signal.aborted) throw new DOMException('处理已停止', 'AbortError');
          return { png, view };
        },
      });
      if (ticket !== version || disposed) return;
      const file = new File([result.blob], result.name, { type: 'application/pdf' }); output = { ...result, file, url: URL.createObjectURL(file) }; outputSession = newSession(file);
      await outputSession.promise;
      if (abort.signal.aborted) throw new DOMException('本次处理已停止', 'AbortError');
      if (ticket !== version || disposed) return;
      $('pw-download').href = output.url; $('pw-download').download = output.name; mode = 'output'; $('pw-status').textContent = 'PDF 已生成，当前显示实际导出文件。请逐页检查后下载。'; notify('PDF 已生成');
    } catch (cause) { if (ticket === version) { if (output) URL.revokeObjectURL(output.url); output = null; closeSession(outputSession); outputSession = null; mode = 'layout'; const stopped = cause.name === 'AbortError' || abort.signal.aborted; $('pw-status').textContent = stopped ? '本次处理已停止，原文档保留，可重新生成。' : '未生成结果，请调整设置后重试。'; if (!stopped) message('pw-error', cause.message); } }
    finally { cache.clear(); if (ticket === version && !disposed) { running = false; controller = null; update(); preview(); } }
  }
  function clear() {
    controller?.abort(); previewController?.abort(); clearTimeout(timer); invalidate(); closeSession(sourceSession); sourceSession = null; source = null; count = 0; views.clear(); page = 1;
    logoTicket++; logo?.close(); logo = logoFile = null; logoLoading = loading = running = false; controller = null; $('pw-file').value = $('pw-logo').value = '';
    $('pw-status').textContent = '文件与结果已清空，内容未上传或保存。'; update(); if (!disposed) preview();
  }
  $('pw-file').addEventListener('change', event => { loadPDF(event.target.files[0]); event.target.value = ''; });
  for (const type of ['dragenter', 'dragover']) $('pw-drop').addEventListener(type, event => { event.preventDefault(); if (!loading && !running) $('pw-drop').classList.add('drag-over'); });
  for (const type of ['dragleave', 'drop']) $('pw-drop').addEventListener(type, event => { event.preventDefault(); $('pw-drop').classList.remove('drag-over'); if (type === 'drop') { if (event.dataTransfer.files.length !== 1) message('pw-error', '请一次选择一份 PDF。'); else loadPDF(event.dataTransfer.files[0]); } });
  $('pw-sample').addEventListener('click', async () => { if (loading || running) return; const { samplePDF } = await import('./pdf-images-sample.js'); loadPDF(samplePDF()); });
  $('pw-logo').addEventListener('change', event => { loadLogo(event.target.files[0]); event.target.value = ''; });
  $('pw-logo-sample').addEventListener('click', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 240; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ec6245'; ctx.fillRect(0, 0, 600, 240); ctx.fillStyle = '#ffffff'; ctx.font = '700 110px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SGAO', 300, 126);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); canvas.width = canvas.height = 1; if (blob) loadLogo(new File([blob], 'sgao-logo.png', { type: 'image/png' }));
  });
  $('pw-logo-clear').addEventListener('click', () => { if (running || loading) return; logoTicket++; logo?.close(); logo = logoFile = null; changed(); });
  $('pw-clear').addEventListener('click', clear); $('pw-run').addEventListener('click', run); $('pw-stop').addEventListener('click', () => { controller?.abort(); if (running) closeSession(outputSession); update(); });
  $('pw-download').addEventListener('click', event => { if (!output || loading || running || logoLoading) event.preventDefault(); });
  $('pw-settings').addEventListener('input', event => { if (event.target.id !== 'pw-logo' && !event.target.matches('select')) changed(); });
  $('pw-settings').addEventListener('change', event => { if (event.target.matches('select')) changed(); });
  for (const value of ['watermark', 'number']) $(`pw-panel-${value}`).addEventListener('click', () => { panel = value; update(); });
  for (const value of ['layout', 'original', 'output']) $(`pw-view-${value}`).addEventListener('click', () => { if (value === 'output' && !output) return; mode = value; update(); preview(); });
  $('pw-page').addEventListener('change', () => select(Number($('pw-page').value))); $('pw-prev').addEventListener('click', () => select(page - 1)); $('pw-next').addEventListener('click', () => select(page + 1));
  $('pw-page-image').addEventListener('load', fit); const resize = new ResizeObserver(fit); resize.observe($('pw-viewport'));
  window.addEventListener('pagehide', event => { clearTimeout(timer); previewController?.abort(); controller?.abort(); if (!event.persisted) { disposed = true; clear(); resize.disconnect(); } });
  window.addEventListener('pageshow', event => { if (event.persisted) { update(); preview(); } });
  update();
}
