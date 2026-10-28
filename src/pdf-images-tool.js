import { PDF_IMAGE_LIMITS, selectedPDFPages, validatePDFImages, pdfImageSize, pdfImageFilename, pdfImageStem } from './lib/pdf-images.js';
import { openLocalPDF, renderPDFImage, convertPDFPages, pdfLoadError } from './pdf-images-engine.js';
import { createZIP } from './lib/zip.js';
import { sendToCompressor, sendToWatermark, sendToOCR } from './image-transfer.js';

export function initPDFImages({ notify }) {
  const $ = id => document.getElementById(id), results = new Map(), downloads = new Set();
  let doc, source, loadingTask, passwordReply, loadTimer, renderController, runController, zipURL = '';
  let loading = false, running = false, zipping = false, transferring = false, disposed = false, loadVersion = 0, version = 0, previewVersion = 0, current = 1, view = 'document', preview, previewURL = '', pagePoints, navigationPages = [];
  const bytes = size => size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(2)} MB`;
  const message = (id, text = '') => { $(id).textContent = text; $(id).hidden = !text; };
  const number = id => $(id).value.trim() === '' ? NaN : Number($(id).value);
  const options = () => ({ mode: $('pi-mode').value, dpi: number('pi-dpi'), edge: number('pi-edge'), format: $('pi-format').value, quality: number('pi-quality'), background: $('pi-background').value, color: $('pi-color').value });
  const chosenPages = () => doc ? selectedPDFPages($('pi-range').value, doc.numPages, $('pi-pages-mode').value === 'all') : [];
  function stopPreview() { previewVersion++; renderController?.abort(); renderController = null; }
  function clearPreview() { if (previewURL) URL.revokeObjectURL(previewURL); previewURL = ''; preview = null; pagePoints = null; $('pi-document-image').removeAttribute('src'); }
  function clearResults() { for (const item of results.values()) URL.revokeObjectURL(item.url); results.clear(); $('pi-output-image').removeAttribute('src'); if (zipURL) URL.revokeObjectURL(zipURL); zipURL = ''; $('pi-zip-file').removeAttribute('href'); $('pi-zip-file').hidden = true; }
  function releaseDocument() { const previous = loadingTask || doc; loadingTask = doc = null; if (previous) Promise.resolve(previous.destroy()).catch(() => {}); }
  function invalidate() { version++; clearResults(); view = 'document'; $('pi-progress').value = 0; renderResults(); }
  function reset() {
    loadVersion++; stopPreview(); runController?.abort(); clearTimeout(loadTimer); passwordReply = null; $('pi-password').value = ''; $('pi-password-box').hidden = true;
    releaseDocument(); source = null; loading = false; current = 1; invalidate(); clearPreview(); message('pi-error'); update(); $('pi-status').textContent = 'PDF 和转换结果只在当前页面内存中处理，刷新或关闭页面后清除。';
  }
  function update() {
    let pages = [], valid = false;
    try {
      validatePDFImages(options()); pages = chosenPages();
      if (doc && pages.length > PDF_IMAGE_LIMITS.batch) throw new Error('单次最多转换 50 页，请使用指定页码分批转换。');
      valid = !!doc && !!pages.length; message('pi-settings-error');
    } catch (cause) { message('pi-settings-error', cause.message); try { pages = chosenPages(); } catch { /* Keep the previous preview until page selection is valid. */ } }
    const busy = running || zipping;
    $('pi-workspace').hidden = $('pi-jumps').hidden = !doc;
    $('pi-file').disabled = $('pi-sample').disabled = loading || busy;
    $('pi-clear').disabled = busy || !source && !loading;
    $('pi-settings').disabled = busy; $('pi-range').disabled = busy || $('pi-pages-mode').value === 'all';
    $('pi-dpi-field').hidden = $('pi-mode').value !== 'dpi'; $('pi-edge-field').hidden = $('pi-mode').value !== 'edge';
    $('pi-quality').disabled = busy || $('pi-format').value === 'image/png'; $('pi-quality-value').textContent = `${$('pi-quality').value}%`;
    $('pi-color').disabled = busy || $('pi-background').value === 'transparent' && $('pi-format').value !== 'image/jpeg';
    $('pi-background-note').textContent = $('pi-format').value === 'image/jpeg' ? 'JPG 不支持透明，页面透明区域会使用所选底色。' : '透明背景只影响 PDF 中未绘制的区域，原文档中的白色底图仍会保留。';
    $('pi-run').disabled = !valid || loading || busy;
    $('pi-run').textContent = running ? '正在转换页面…' : results.size ? '按当前设置重新转换' : '开始转换图片';
    $('pi-stop').hidden = !running; $('pi-stop').disabled = !!runController?.signal.aborted;
    $('pi-source-name').textContent = source?.name || '';
    $('pi-source-meta').textContent = doc ? `${doc.numPages} 页 · ${bytes(source.size)} · 已选 ${pages.length} 页` : '';
    const available = pages.length ? pages : doc ? Array.from({ length: doc.numPages }, (_, index) => index + 1) : [];
    navigationPages = available;
    if (available.length && !available.includes(current)) current = available[0];
    $('pi-page').replaceChildren(...available.map(page => { const option = document.createElement('option'); option.value = page; option.textContent = `第 ${page} 页 / 共 ${doc.numPages} 页`; option.selected = page === current; return option; }));
    $('pi-page').disabled = busy; $('pi-prev').disabled = busy || available.indexOf(current) <= 0; $('pi-next').disabled = busy || available.indexOf(current) >= available.length - 1;
    const result = results.get(current);
    if (view === 'output' && !result) view = 'document';
    $('pi-view-output').disabled = busy || !result; $('pi-view-document').disabled = busy;
    for (const mode of ['document', 'output']) $(`pi-view-${mode}`).setAttribute('aria-pressed', String(view === mode));
    $('pi-document-image').hidden = view !== 'document' || !previewURL; $('pi-output-image').hidden = view !== 'output' || !result;
    if (view === 'output' && result && $('pi-output-image').getAttribute('src') !== result.url) $('pi-output-image').src = result.url;
    const hasPreview = view === 'output' && !!result || view === 'document' && !!previewURL;
    $('pi-empty').hidden = hasPreview; $('pi-stage').hidden = !hasPreview;
    $('pi-preview-note').textContent = view === 'output' ? '实际编码结果，与下载文件一致。可切换到 100% 检查文字和细线。' : '文档预览为最长边 1000 px 的缩略图，导出清晰度由右侧设置决定。';
    let size;
    if (pagePoints) { try { size = pdfImageSize(pagePoints.width, pagePoints.height, options()); } catch { /* The input error is already shown. */ } }
    const shown = view === 'output' ? result : size;
    $('pi-dimensions').textContent = shown ? `${shown.width} × ${shown.height} px${view === 'output' ? ` · ${bytes(result.file.size)}` : ` · 约 ${shown.dpi.toFixed(1)} DPI`}` : '等待页面预览';
    message('pi-scale-note', (view === 'output' ? result : size)?.limited ? '已按单边 8192 px、总像素 3200 万的输出上限等比缩小。' : '');
    const link = $('pi-download'); link.setAttribute('aria-disabled', String(!result || running)); link.tabIndex = !result || running ? -1 : 0;
    if (result && !running) { link.href = result.url; link.download = result.file.name; } else { link.removeAttribute('href'); link.removeAttribute('download'); }
    const transfer = !!result && result.file.size <= PDF_IMAGE_LIMITS.transferBytes && !busy && !transferring;
    $('pi-compress').disabled = $('pi-watermark').disabled = $('pi-ocr').disabled = !transfer;
    $('pi-transfer-note').textContent = result?.file.size > PDF_IMAGE_LIMITS.transferBytes ? '当前图片超过后续工具的 20 MB 上限，可降低尺寸或改用 JPG / WebP 后再转换。' : '当前导出页可直接送至压缩、水印或 OCR 工具，无需重复选择图片。';
    const total = [...results.values()].reduce((sum, item) => sum + item.file.size, 0);
    $('pi-results-count').textContent = `${results.size} 张 · ${bytes(total)}`;
    $('pi-results-empty').hidden = !!results.size;
    $('pi-zip').disabled = busy || !results.size;
    $('pi-zip').textContent = zipping ? '正在打包…' : '打包下载 ZIP';
    paintSize();
  }
  function paintSize() {
    const item = view === 'output' ? results.get(current) : preview, viewport = $('pi-viewport');
    if (!item || !viewport.clientWidth) return;
    const zoom = $('pi-zoom').value, scale = zoom === 'fit' ? Math.min(1, (viewport.clientWidth - 44) / item.width, (viewport.clientHeight - 44) / item.height) : Number(zoom);
    $('pi-stage').style.width = `${Math.max(1, item.width * scale)}px`; $('pi-stage').style.height = `${Math.max(1, item.height * scale)}px`;
  }
  async function showPage() {
    stopPreview(); clearPreview(); $('pi-empty').textContent = '正在渲染页面预览…'; update();
    if (!doc || running || view === 'output') return;
    const ticket = previewVersion, controller = new AbortController(), currentDoc = doc, page = current; renderController = controller;
    try {
      const image = await renderPDFImage(currentDoc, page, options(), { signal: controller.signal, preview: true });
      if (disposed || controller.signal.aborted || ticket !== previewVersion || currentDoc !== doc || page !== current) return;
      preview = image; pagePoints = { width: image.pageWidth, height: image.pageHeight }; previewURL = URL.createObjectURL(image.blob); $('pi-document-image').src = previewURL; update();
    } catch (cause) { if (cause.name !== 'AbortError' && ticket === previewVersion && !disposed) { $('pi-empty').textContent = '此页预览失败，请检查提示。'; message('pi-error', pdfLoadError(cause)); } }
    finally { if (renderController === controller) renderController = null; }
  }
  function changed() {
    if (running || zipping) return; message('pi-error'); invalidate(); update(); showPage(); $('pi-status').textContent = '设置已更新，请重新转换图片。';
  }
  function navigate(page, output = false) {
    message('pi-error'); current = page; view = output && results.has(page) || view === 'output' && results.has(page) ? 'output' : 'document'; update(); renderResults(); showPage();
  }
  function renderResults() {
    const fragment = document.createDocumentFragment();
    for (const item of [...results.values()].sort((a, b) => a.page - b.page)) {
      const row = document.createElement('div'); row.className = `pi-result-item${item.page === current ? ' is-selected' : ''}`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'pi-result-select'; button.disabled = running; button.setAttribute('aria-label', `查看第 ${item.page} 页导出结果`); button.setAttribute('aria-pressed', String(item.page === current));
      const label = document.createElement('span'); label.className = 'pi-page-badge'; label.textContent = String(item.page).padStart(3, '0');
      const info = document.createElement('span'), name = document.createElement('strong'), meta = document.createElement('small'); name.textContent = item.file.name; meta.textContent = `${item.width} × ${item.height} px · ${bytes(item.file.size)}`; info.append(name, meta); button.append(label, info); button.addEventListener('click', () => navigate(item.page, true));
      const link = document.createElement('a'); link.href = item.url; link.download = item.file.name; link.className = 'pi-result-download'; link.textContent = '下载'; link.setAttribute('aria-label', `下载第 ${item.page} 页`);
      row.append(button, link); fragment.append(row);
    }
    $('pi-results-list').replaceChildren(fragment);
  }
  async function load(file) {
    if (!file || running || zipping || loading) return;
    reset(); source = file; loading = true; const ticket = loadVersion; update(); $('pi-status').textContent = '正在本地读取 PDF…';
    const timeout = () => { clearTimeout(loadTimer); loadTimer = setTimeout(() => { if (ticket !== loadVersion || !loading) return; reset(); message('pi-error', '读取 PDF 超过一分钟，请尝试较小或重新导出的文档。'); }, 60_000); };
    timeout();
    try {
      const opened = await openLocalPDF(file, {
        onTask: task => { if (ticket !== loadVersion || disposed) { Promise.resolve(task.destroy()).catch(() => {}); return; } loadingTask = task; },
        onPassword: (reply, reason) => {
          if (ticket !== loadVersion || disposed) return; clearTimeout(loadTimer); passwordReply = password => { timeout(); reply(password); };
          $('pi-password-box').hidden = false; $('pi-password').value = ''; $('pi-password-message').textContent = reason === 2 ? '密码不正确，请重新输入文档打开密码。' : '这个 PDF 需要文档打开密码，密码仅用于当前页面解密。'; $('pi-password').focus();
        },
      });
      if (ticket !== loadVersion || disposed) { await opened.destroy(); return; }
      clearTimeout(loadTimer); passwordReply = null; $('pi-password').value = ''; $('pi-password-box').hidden = true; doc = opened; loading = false; current = 1;
      $('pi-status').textContent = `已打开 ${doc.numPages} 页 PDF。选择页码、格式和清晰度后开始转换。`; update(); await showPage();
    } catch (cause) { if (ticket === loadVersion && !disposed) { clearTimeout(loadTimer); releaseDocument(); loading = false; passwordReply = null; $('pi-password').value = ''; $('pi-password-box').hidden = true; message('pi-error', pdfLoadError(cause)); $('pi-status').textContent = 'PDF 未载入，请检查文件或重新选择。'; update(); } }
  }
  async function run() {
    if (!doc || running || zipping) return;
    let settings, pages;
    try { settings = validatePDFImages(options()); pages = chosenPages(); if (pages.length > PDF_IMAGE_LIMITS.batch) throw new Error('单次最多转换 50 页，请分批转换。'); }
    catch (cause) { message('pi-settings-error', cause.message); return; }
    stopPreview(); invalidate(); const ticket = version, currentDoc = doc, controller = new AbortController(); runController = controller; running = true; message('pi-error'); $('pi-progress').max = pages.length; update();
    try {
      await convertPDFPages(currentDoc, pages, settings, {
        signal: controller.signal,
        onProgress: (done, total, page) => { if (disposed || ticket !== version) return; $('pi-progress').value = done; $('pi-status').textContent = page ? `正在转换第 ${page} 页，已完成 ${done} / ${total} 张…` : `已完成 ${total} 张图片，可以逐页检查、下载或打包。`; },
        onResult: item => {
          if (disposed || ticket !== version || controller.signal.aborted) return;
          const file = new File([item.blob], pdfImageFilename(source.name, item.page, item.blob.type), { type: item.blob.type });
          results.set(item.page, { ...item, file, url: URL.createObjectURL(file) }); current = item.page; view = 'output'; update(); renderResults();
        },
      });
      if (!disposed && ticket === version) { current = pages[0]; view = 'output'; notify('PDF 已转换为图片'); }
    } catch (cause) { if (!disposed && ticket === version) { if (cause.name === 'AbortError') $('pi-status').textContent = `已停止，保留 ${results.size} 张完成的图片。`; else { message('pi-error', pdfLoadError(cause)); $('pi-status').textContent = `转换未全部完成，已保留 ${results.size} 张图片，可调整设置后重新转换。`; } } }
    finally { running = false; runController = null; if (!disposed) { if (!results.has(current) && results.size) current = results.keys().next().value; view = results.size ? 'output' : 'document'; update(); renderResults(); if (!results.size) showPage(); } }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); downloads.add(url); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 30_000);
  }
  async function zip() {
    if (!results.size || running || zipping) return; zipping = true; const ticket = version; update();
    try {
      const files = []; for (const item of [...results.values()].sort((a, b) => a.page - b.page)) files.push({ name: item.file.name, data: new Uint8Array(await item.file.arrayBuffer()) });
      if (disposed || ticket !== version) return; const bytes = createZIP(files), file = new File([bytes], `${pdfImageStem(source.name)}-images.zip`, { type: 'application/zip' });
      if (zipURL) URL.revokeObjectURL(zipURL); zipURL = URL.createObjectURL(file); const link = $('pi-zip-file'); link.href = zipURL; link.download = file.name; link.hidden = false;
      download(file, file.name); notify('图片 ZIP 已生成');
    }
    catch (cause) { if (!disposed) message('pi-error', cause.message); }
    finally { zipping = false; if (!disposed) update(); }
  }
  async function transfer(type) {
    const result = results.get(current); if (!result || running || zipping || transferring || result.file.size > PDF_IMAGE_LIMITS.transferBytes) return;
    const ticket = version; transferring = true; update(); $('pi-transfer-note').textContent = '正在打开后续工具…';
    try { await (type === 'compress' ? sendToCompressor(result.file) : type === 'ocr' ? sendToOCR(result.file) : sendToWatermark(result.file)); if (!disposed && ticket === version) { $('pi-transfer-note').textContent = `已发送 ${result.file.name}，请在新标签页继续处理。`; notify('图片已送至后续工具'); } }
    catch (cause) { if (!disposed && ticket === version) $('pi-transfer-note').textContent = cause.message; }
    finally { transferring = false; if (!disposed) { const item = results.get(current), disabled = running || zipping || !item || item.file.size > PDF_IMAGE_LIMITS.transferBytes; $('pi-compress').disabled = $('pi-watermark').disabled = $('pi-ocr').disabled = disabled; } }
  }
  $('pi-file').addEventListener('change', event => { load(event.target.files[0]); event.target.value = ''; });
  let depth = 0;
  $('pi-drop').addEventListener('dragenter', event => { event.preventDefault(); depth++; $('pi-drop').classList.add('drag-over'); });
  $('pi-drop').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  $('pi-drop').addEventListener('dragleave', event => { event.preventDefault(); if (--depth <= 0) { depth = 0; $('pi-drop').classList.remove('drag-over'); } });
  $('pi-drop').addEventListener('drop', event => { event.preventDefault(); depth = 0; $('pi-drop').classList.remove('drag-over'); if (event.dataTransfer.files.length !== 1) { message('pi-error', '一次请选择一份 PDF。'); return; } load(event.dataTransfer.files[0]); });
  $('pi-clear').addEventListener('click', reset); $('pi-run').addEventListener('click', run); $('pi-stop').addEventListener('click', () => { runController?.abort(); $('pi-status').textContent = '正在停止，已完成的图片会保留…'; update(); });
  $('pi-password-submit').addEventListener('click', () => { if (!passwordReply) return; const password = $('pi-password').value; if (!password) { $('pi-password-message').textContent = '请先输入文档打开密码。'; return; } const reply = passwordReply; passwordReply = null; $('pi-password').value = ''; $('pi-password-box').hidden = true; reply(password); });
  $('pi-password').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('pi-password-submit').click(); } });
  $('pi-password-cancel').addEventListener('click', reset);
  $('pi-settings').querySelectorAll('input,select').forEach(input => input.addEventListener('input', changed));
  $('pi-page').addEventListener('change', event => navigate(Number(event.target.value)));
  for (const [id, direction] of [['pi-prev', -1], ['pi-next', 1]]) $(id).addEventListener('click', () => { const next = navigationPages[navigationPages.indexOf(current) + direction]; if (next) navigate(next); });
  for (const mode of ['document', 'output']) $(`pi-view-${mode}`).addEventListener('click', () => { view = mode; update(); showPage(); });
  $('pi-zoom').addEventListener('change', () => { $('pi-viewport').scrollLeft = $('pi-viewport').scrollTop = 0; paintSize(); });
  $('pi-download').addEventListener('click', event => { if ($('pi-download').getAttribute('aria-disabled') === 'true') event.preventDefault(); });
  $('pi-zip').addEventListener('click', zip); $('pi-compress').addEventListener('click', () => transfer('compress')); $('pi-watermark').addEventListener('click', () => transfer('watermark')); $('pi-ocr').addEventListener('click', () => transfer('ocr'));
  $('pi-sample').addEventListener('click', async () => { if (loading || running || zipping) return; const ticket = loadVersion; try { const { samplePDF } = await import('./pdf-images-sample.js'); if (ticket === loadVersion && !disposed) load(samplePDF()); } catch { message('pi-error', '示例暂时无法读取，请选择本地 PDF。'); } });
  const observer = new ResizeObserver(paintSize); observer.observe($('pi-viewport'));
  window.addEventListener('pagehide', event => { stopPreview(); runController?.abort(); if (event.persisted) return; disposed = true; loadVersion++; version++; clearTimeout(loadTimer); passwordReply = null; $('pi-password').value = ''; releaseDocument(); clearPreview(); clearResults(); downloads.forEach(url => URL.revokeObjectURL(url)); observer.disconnect(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { update(); if (view === 'document') showPage(); } });
  update();
}
