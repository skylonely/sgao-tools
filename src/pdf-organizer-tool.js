import { ORGANIZER_LIMITS, checkOrganizerFiles, organizerPlan, moveOrganizerPage } from './lib/pdf-organizer.js';
import { pdfImageStem } from './lib/pdf-images.js';
import { organizerTask } from './pdf-organizer-task.js';
import { openLocalPDF, renderPDFImage, pdfLoadError } from './pdf-images-engine.js';
import { createZIP } from './lib/zip.js';

export function initPDFOrganizer({ notify }) {
  const $ = id => document.getElementById(id), sources = [], results = [], thumbs = new Map(), documents = new Map();
  let pages = [], selected, nextID = 0, busy = false, disposed = false, version = 0, controller, mainController, mainURL, zipURL, drag, observer, thumbnailWorking = false;
  let previewMode = 'source', outputIndex = 0, outputPage = 1, previewTicket = 0, thumbQueue = [];
  const bytes = size => size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(2)} MB`;
  const message = (id, text = '') => { $(id).textContent = text; $(id).hidden = !text; };
  const options = () => ({ mode: $('pm-mode').value, ranges: $('pm-ranges').value, name: $('pm-name').value });
  const sourceFor = page => sources.find(source => source.id === page?.source);
  function releaseDocument(key) { const entry = documents.get(key); if (!entry) return; documents.delete(key); clearTimeout(entry.timer); entry.task?.destroy().catch(() => {}); }
  function clearResults() {
    for (const result of results) { URL.revokeObjectURL(result.url); releaseDocument(result.id); }
    results.length = 0; if (zipURL) URL.revokeObjectURL(zipURL); zipURL = null; previewMode = 'source';
    $('pm-zip-download').removeAttribute('href'); $('pm-zip-download').hidden = true; renderResults();
  }
  function invalidate(text) { version++; clearResults(); $('pm-progress').value = 0; message('pm-error'); if (text) $('pm-status').textContent = text; }
  async function getDocument(key, file) {
    if (documents.has(key)) return documents.get(key).promise;
    const entry = {};
    entry.promise = openLocalPDF(file, {
      onTask(task) { entry.task = task; if (documents.get(key) !== entry || disposed) { task.destroy().catch(() => {}); return; } entry.timer = setTimeout(() => { task.destroy().catch(() => {}); }, 60_000); },
      onPassword() { entry.task?.destroy().catch(() => {}); },
    }).then(doc => { clearTimeout(entry.timer); if (documents.get(key) !== entry || disposed) { doc.destroy().catch(() => {}); throw new DOMException('预览已停止', 'AbortError'); } return doc; }).catch(cause => { clearTimeout(entry.timer); if (documents.get(key) === entry) documents.delete(key); throw cause; });
    documents.set(key, entry); return entry.promise;
  }
  function activePreview() {
    if (previewMode === 'output' && results[outputIndex]) { const result = results[outputIndex]; return { key: result.id, file: result.file, page: outputPage, rotation: 0, count: result.count, title: result.name, output: true }; }
    const item = pages.find(page => page.id === selected), source = sourceFor(item);
    return source ? { key: source.id, file: source.file, page: item.page, rotation: item.rotation, count: pages.length, title: `${source.file.name} · 原第 ${item.page} 页`, item } : null;
  }
  function fitPreview() {
    const image = $('pm-preview-image'); if (!image.naturalWidth || image.hidden) return;
    const active = activePreview(); if (!active) return;
    const quarter = active.rotation % 180 !== 0, width = image.naturalWidth, height = image.naturalHeight;
    const viewport = $('pm-viewport'), scale = Math.min((viewport.clientWidth - 44) / (quarter ? height : width), (viewport.clientHeight - 44) / (quarter ? width : height));
    const stage = $('pm-stage'); stage.style.width = `${(quarter ? height : width) * scale}px`; stage.style.height = `${(quarter ? width : height) * scale}px`;
    image.style.width = `${width * scale}px`; image.style.height = `${height * scale}px`; image.style.transform = `translate(-50%,-50%) rotate(${active.rotation}deg)`;
  }
  async function preview() {
    const ticket = ++previewTicket, active = activePreview(); mainController?.abort();
    if (mainURL) URL.revokeObjectURL(mainURL); mainURL = null;
    $('pm-preview-image').hidden = $('pm-stage').hidden = true; $('pm-preview-empty').hidden = false;
    if (!active) { $('pm-preview-empty').textContent = '点击页面缩略图，检查当前页面。'; return; }
    $('pm-preview-empty').textContent = '正在渲染页面…'; const abort = new AbortController(); mainController = abort;
    try {
      const doc = await getDocument(active.key, active.file);
      if (ticket !== previewTicket || disposed) return;
      const image = await renderPDFImage(doc, active.page, { mode: 'edge', edge: 1000, dpi: 72, format: 'image/png', quality: 100, background: 'color', color: '#ffffff' }, { signal: abort.signal });
      if (ticket !== previewTicket || disposed) return;
      mainURL = URL.createObjectURL(image.blob); $('pm-preview-image').src = mainURL;
      $('pm-preview-image').hidden = $('pm-stage').hidden = false; $('pm-preview-empty').hidden = true;
    } catch (cause) { if (ticket === previewTicket && !disposed && cause.name !== 'AbortError') $('pm-preview-empty').textContent = `预览不可用：${pdfLoadError(cause)}`; }
  }
  async function drainThumbnails() {
    if (thumbnailWorking || disposed) return; thumbnailWorking = true;
    try {
      while (thumbQueue.length && !disposed) {
        const id = thumbQueue.shift(), item = pages.find(page => page.id === id), source = sourceFor(item);
        if (!source || thumbs.has(id)) continue;
        try {
          const doc = await getDocument(source.id, source.file);
          if (!sources.includes(source) || disposed) continue;
          const rendered = await renderPDFImage(doc, item.page, { mode: 'edge', edge: 240, dpi: 72, format: 'image/png', quality: 100, background: 'color', color: '#ffffff' });
          if (!sources.includes(source) || disposed) continue;
          thumbs.set(id, { url: URL.createObjectURL(rendered.blob), width: rendered.width, height: rendered.height }); paintThumbnail(id);
        } catch { const hint = document.querySelector(`[data-pm-id="${id}"] .pm-thumb-hint`); if (hint) hint.textContent = '缩略图不可用'; }
      }
    } finally { thumbnailWorking = false; }
  }
  function paintThumbnail(id) {
    const item = pages.find(page => page.id === id), cached = thumbs.get(id), frame = document.querySelector(`[data-pm-id="${id}"] .pm-thumb`);
    if (!item || !cached || !frame) return;
    const image = document.createElement('img'); image.src = cached.url; image.alt = ''; image.draggable = false;
    const quarter = item.rotation % 180 !== 0, available = Math.min(140, Math.max(60, frame.clientWidth - 18)), scale = Math.min(available / (quarter ? cached.height : cached.width), 156 / (quarter ? cached.width : cached.height));
    image.style.width = `${cached.width * scale}px`; image.style.height = `${cached.height * scale}px`; image.style.transform = `translate(-50%,-50%) rotate(${item.rotation}deg)`; frame.replaceChildren(image);
  }
  function update() {
    let plan;
    try { plan = organizerPlan(pages, options()); message('pm-settings-error'); }
    catch (cause) { if (sources.length) message('pm-settings-error', cause.message); else message('pm-settings-error'); }
    $('pm-workspace').hidden = $('pm-jumps').hidden = !sources.length;
    $('pm-files').disabled = $('pm-sample').disabled = busy; $('pm-clear').disabled = !sources.length && !busy;
    $('pm-settings').disabled = busy; $('pm-run').disabled = busy || !plan;
    $('pm-stop').hidden = !busy || !controller; $('pm-stop').disabled = !!controller?.signal.aborted;
    $('pm-restore').disabled = busy || !sources.length;
    $('pm-ranges-field').hidden = $('pm-mode').value !== 'ranges';
    $('pm-plan').textContent = plan ? `将生成 ${plan.length} 份 PDF · 合计 ${plan.reduce((sum, group) => sum + group.pages.length, 0)} 页` : '填写有效设置后显示导出数量。';
    $('pm-plan-note').textContent = $('pm-mode').value === 'merge' ? '按左侧当前页序合成一份 PDF。' : $('pm-mode').value === 'single' ? '每个保留的页面单独生成一份 PDF，可打包下载。' : '页码对应左侧整理后的顺序。每行一份 PDF；同一行重复页码会去重，并按当前页序输出。';
    $('pm-count').textContent = `${pages.length} 页保留 / ${sources.reduce((sum, source) => sum + source.count, 0)} 页原始`;
    $('pm-source-count').textContent = `${sources.length} 份文档 · ${bytes(sources.reduce((sum, source) => sum + source.file.size, 0))}`;
    $('pm-drop').classList.toggle('is-loaded', !!sources.length);
    $('pm-pages-empty').hidden = !!pages.length;
    $('pm-output-controls').hidden = previewMode !== 'output' || !results.length;
    $('pm-view-source').setAttribute('aria-pressed', String(previewMode === 'source'));
    $('pm-view-output').setAttribute('aria-pressed', String(previewMode === 'output')); $('pm-view-output').disabled = !results.length;
    const active = activePreview(), index = previewMode === 'output' ? outputPage - 1 : pages.findIndex(page => page.id === selected), count = active?.count || 0;
    $('pm-preview-page').replaceChildren(...Array.from({ length: count }, (_, i) => { const option = document.createElement('option'); option.value = i; option.textContent = `第 ${i + 1} 页 / 共 ${count} 页`; option.selected = i === index; return option; }));
    $('pm-prev').disabled = index <= 0; $('pm-next').disabled = index < 0 || index >= count - 1;
    $('pm-preview-info').textContent = active ? `${active.output ? '实际导出文件' : `整理后第 ${index + 1} 页`} · ${active.title}${active.rotation ? ` · 追加旋转 ${active.rotation}°` : ''}` : '当前没有保留的页面。';
    $('pm-preview-note').textContent = active?.output ? '此预览直接读取已生成的 PDF。请逐页检查后下载。' : '缩略预览使用原始页面与当前旋转设置；导出保留原有文字、矢量与图片内容。';
    $('pm-zip').disabled = busy || !results.length;
  }
  function focusSelected() { document.querySelector(`[data-pm-id="${selected}"] .pm-drag`)?.focus({ preventScroll: true }); }
  function edit(text) { invalidate(text); renderPages(); update(); preview(); }
  function move(from, to) {
    if (busy || from === to || to < 0 || to >= pages.length) return;
    pages = moveOrganizerPage(pages, from, to); edit(`已将第 ${from + 1} 页移至第 ${to + 1} 页，请重新导出。`); focusSelected();
  }
  function finishDrag(event, cancel = false) {
    if (!drag || drag.pointer !== event.pointerId) return;
    const previous = drag; drag = null; if (previous.handle.hasPointerCapture(event.pointerId)) previous.handle.releasePointerCapture(event.pointerId);
    $('pm-pages').querySelectorAll('.is-dragging,.is-drop-target').forEach(element => element.classList.remove('is-dragging', 'is-drop-target'));
    if (!cancel) move(previous.from, previous.to);
  }
  function renderPages() {
    observer?.disconnect(); const fragment = document.createDocumentFragment();
    pages.forEach((item, index) => {
      const source = sourceFor(item), card = document.createElement('div'); card.className = `pm-page-card${item.id === selected ? ' is-selected' : ''}`; card.dataset.pmId = item.id;
      const header = document.createElement('div'); header.className = 'pm-page-heading';
      const number = document.createElement('strong'); number.textContent = String(index + 1).padStart(3, '0');
      const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'pm-drag'; handle.textContent = '⠿'; handle.disabled = busy;
      handle.setAttribute('aria-label', `拖动排序第 ${index + 1} 页`); handle.setAttribute('aria-describedby', 'pm-sort-help');
      handle.addEventListener('pointerdown', event => { if (busy || !event.isPrimary || event.button !== 0) return; event.preventDefault(); drag = { pointer: event.pointerId, from: index, to: index, handle }; handle.setPointerCapture(event.pointerId); handle.focus({ preventScroll: true }); card.classList.add('is-dragging'); });
      handle.addEventListener('pointermove', event => {
        if (drag?.pointer !== event.pointerId) return;
        const grid = $('pm-pages'), rect = grid.getBoundingClientRect(); if (event.clientY < rect.top + 30) grid.scrollTop -= 16; if (event.clientY > rect.bottom - 30) grid.scrollTop += 16;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-pm-id]'); grid.querySelectorAll('.is-drop-target').forEach(element => element.classList.remove('is-drop-target'));
        drag.to = target ? pages.findIndex(page => page.id === target.dataset.pmId) : drag.from; if (target && drag.to !== drag.from) target.classList.add('is-drop-target');
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, event => finishDrag(event, type !== 'pointerup'));
      handle.addEventListener('keydown', event => { if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); move(index, event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1)); });
      header.append(number, handle);
      const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'pm-choose'; choose.setAttribute('aria-label', `预览第 ${index + 1} 页：${source.file.name} 原第 ${item.page} 页`); choose.setAttribute('aria-pressed', String(item.id === selected));
      const frame = document.createElement('span'); frame.className = 'pm-thumb'; const hint = document.createElement('span'); hint.className = 'pm-thumb-hint'; hint.textContent = '预览加载中'; frame.append(hint);
      const name = document.createElement('strong'); name.textContent = source.file.name; const info = document.createElement('small'); info.textContent = `原第 ${item.page} 页${item.rotation ? ` · +${item.rotation}°` : ''}`; choose.append(frame, name, info);
      choose.addEventListener('click', () => { selected = item.id; previewMode = 'source'; renderPages(); update(); preview(); });
      const actions = document.createElement('div'); actions.className = 'pm-page-actions';
      for (const [label, glyph, action, disabled] of [
        ['上移', '↑', () => move(index, index - 1), index === 0], ['下移', '↓', () => move(index, index + 1), index === pages.length - 1],
        ['顺时针旋转', '↻', () => { item.rotation = (item.rotation + 90) % 360; selected = item.id; edit('页面已旋转，请重新导出。'); }, false],
        ['删除', '×', () => { pages = pages.filter(page => page !== item); if (selected === item.id) selected = pages[Math.min(index, pages.length - 1)]?.id; edit('已移除页面；可点击「恢复原始页序」找回。'); }, false],
      ]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = glyph; button.setAttribute('aria-label', `${label}第 ${index + 1} 页`); button.disabled = busy || disabled; button.addEventListener('click', () => { if (!busy) action(); }); actions.append(button); }
      card.append(header, choose, actions); fragment.append(card);
    });
    $('pm-pages').replaceChildren(fragment); for (const item of pages) paintThumbnail(item.id);
    observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { const id = entry.target.dataset.pmId; observer.unobserve(entry.target); if (!thumbs.has(id) && !thumbQueue.includes(id)) thumbQueue.push(id); } drainThumbnails(); }, { root: $('pm-pages'), rootMargin: '300px' });
    $('pm-pages').querySelectorAll('[data-pm-id]').forEach(card => observer.observe(card));
  }
  function renderSources() {
    $('pm-sources').replaceChildren(...sources.map((source, index) => {
      const row = document.createElement('div'); row.className = 'pm-source'; const text = document.createElement('span'), name = document.createElement('strong'), info = document.createElement('small');
      name.textContent = source.file.name; info.textContent = `${source.count} 页 · ${bytes(source.file.size)}`; text.append(name, info); row.append(text);
      for (const [label, offset, glyph] of [['前移文档', -1, '↑'], ['后移文档', 1, '↓']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = glyph; button.setAttribute('aria-label', `${label}：${source.file.name}`); button.disabled = busy || index + offset < 0 || index + offset >= sources.length;
        button.addEventListener('click', () => { if (busy) return; const [moved] = sources.splice(index, 1); sources.splice(index + offset, 0, moved); pages = sources.flatMap(item => pages.filter(page => page.source === item.id)); renderSources(); edit('已按文档顺序重新归组，保留各文档当前页序与旋转。'); }); row.append(button);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除'; remove.setAttribute('aria-label', `移除文档：${source.file.name}`); remove.disabled = busy;
      remove.addEventListener('click', () => { if (busy) return; sources.splice(sources.indexOf(source), 1); pages = pages.filter(page => page.source !== source.id); if (!pages.some(page => page.id === selected)) selected = pages[0]?.id; releaseDocument(source.id); for (const [id, thumb] of thumbs) if (id.startsWith(`${source.id}-`)) { URL.revokeObjectURL(thumb.url); thumbs.delete(id); } renderSources(); edit('已移除文档及其页面。'); }); row.append(remove); return row;
    }));
  }
  function renderResults() {
    $('pm-results').hidden = !results.length;
    $('pm-results-count').textContent = `${results.length} 份 · ${bytes(results.reduce((sum, result) => sum + result.file.size, 0))}`;
    $('pm-result-list').replaceChildren(...results.map((result, index) => {
      const row = document.createElement('div'); row.className = 'pm-result-row'; const text = document.createElement('span'), name = document.createElement('strong'), meta = document.createElement('small'); name.textContent = result.name; meta.textContent = `${result.count} 页 · ${bytes(result.file.size)} · 整理后页码 ${result.indices.join(',')}`; text.append(name, meta);
      const show = document.createElement('button'); show.type = 'button'; show.textContent = '预览'; show.setAttribute('aria-label', `预览结果 ${index + 1}`); show.addEventListener('click', () => { previewMode = 'output'; outputIndex = index; outputPage = 1; update(); updateOutputSelect(); preview(); $('pm-preview').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      const link = document.createElement('a'); link.href = result.url; link.download = result.name; link.textContent = '下载'; link.setAttribute('aria-label', `下载 ${result.name}`); row.append(text, show, link); return row;
    })); updateOutputSelect();
  }
  function updateOutputSelect() {
    $('pm-output-file').replaceChildren(...results.map((result, index) => { const option = document.createElement('option'); option.value = index; option.textContent = result.name; option.selected = index === outputIndex; return option; }));
  }
  function restore() {
    if (busy) return; pages = sources.flatMap(source => Array.from({ length: source.count }, (_, i) => ({ id: `${source.id}-${i + 1}`, source: source.id, page: i + 1, rotation: 0 }))); selected = pages[0]?.id; edit('已恢复当前文档顺序下的原始页面与方向。');
  }
  async function addFiles(input) {
    if (busy || disposed) return; const files = [...input]; if (!files.length) return;
    try { checkOrganizerFiles([...sources.map(source => source.file), ...files]); } catch (cause) { message('pm-error', cause.message); return; }
    invalidate(); busy = true; const ticket = version, abort = new AbortController(); controller = abort; update(); renderSources(); renderPages(); const errors = [];
    try {
      for (const file of files) {
        if (abort.signal.aborted || ticket !== version) break;
        $('pm-status').textContent = `正在读取 ${file.name}…`;
        try {
          const info = await organizerTask('inspect', { file }, { signal: abort.signal });
          if (abort.signal.aborted || ticket !== version) break;
          if (sources.reduce((sum, source) => sum + source.count, 0) + info.count > ORGANIZER_LIMITS.pages) throw new Error('本批源页面合计最多 200 页。');
          const source = { id: `doc${++nextID}`, file, count: info.count }; sources.push(source);
          const added = Array.from({ length: source.count }, (_, i) => ({ id: `${source.id}-${i + 1}`, source: source.id, page: i + 1, rotation: 0 })); pages.push(...added); selected ||= added[0]?.id;
        } catch (cause) { if (cause.name === 'AbortError') break; errors.push(`${file.name}：${cause.message}`); }
      }
    } finally {
      if (ticket === version && !disposed) { busy = false; controller = null; renderSources(); renderPages(); update(); preview(); message('pm-error', errors.join('\n')); $('pm-status').textContent = abort.signal.aborted ? '读取已停止，已加入的文档保留。' : `已添加 ${sources.length} 份文档、${pages.length} 页。可继续添加文件或整理页序。`; }
    }
  }
  async function run() {
    if (busy) return; let plan; try { plan = organizerPlan(pages, options()); } catch { update(); return; }
    invalidate(); busy = true; const ticket = version, abort = new AbortController(); controller = abort; renderSources(); renderPages(); update();
    try {
      await organizerTask('build', { sources: sources.map(({ id, file }) => ({ id, file })), pages, options: options() }, {
        signal: abort.signal,
        onProgress(done, total, text) { if (ticket === version) { $('pm-progress').max = total; $('pm-progress').value = done; $('pm-status').textContent = text; } },
        onResult(result) { if (ticket !== version || disposed) return; const file = new File([result.blob], result.name, { type: 'application/pdf' }); results.push({ ...result, id: `result${++nextID}`, file, url: URL.createObjectURL(file) }); renderResults(); },
      });
      $('pm-status').textContent = `已完成 ${plan.length} 份 PDF，可预览实际文件并下载。`;
    } catch (cause) { if (ticket === version) { if (cause.name === 'AbortError') $('pm-status').textContent = `已停止，保留 ${results.length} 份完成的 PDF。`; else { message('pm-error', cause.message); $('pm-status').textContent = results.length ? `已保留 ${results.length} 份完成的 PDF。` : '未生成结果，请调整后重试。'; } } }
    finally { if (ticket === version && !disposed) { busy = false; controller = null; outputIndex = 0; outputPage = 1; if (results.length) previewMode = 'output'; renderSources(); renderPages(); update(); preview(); } }
  }
  async function zip() {
    if (busy || !results.length) return; busy = true; const ticket = version; update(); renderSources(); renderPages();
    try {
      const files = []; for (const result of results) files.push({ name: result.name, data: new Uint8Array(await result.file.arrayBuffer()) });
      const data = createZIP(files); if (ticket !== version || disposed) return;
      if (zipURL) URL.revokeObjectURL(zipURL); zipURL = URL.createObjectURL(new Blob([data], { type: 'application/zip' }));
      const link = $('pm-zip-download'); link.href = zipURL; link.download = `${pdfImageStem($('pm-name').value)}-pdfs.zip`; link.hidden = false; link.click(); notify('ZIP 已准备好，可再次下载。');
    } catch (cause) { message('pm-error', cause.message); }
    finally { if (ticket === version && !disposed) { busy = false; update(); renderSources(); renderPages(); } }
  }
  function clear() {
    controller?.abort(); mainController?.abort(); version++; previewTicket++; busy = false; observer?.disconnect(); thumbQueue = []; clearResults();
    for (const key of documents.keys()) releaseDocument(key); for (const thumb of thumbs.values()) URL.revokeObjectURL(thumb.url); thumbs.clear();
    if (mainURL) URL.revokeObjectURL(mainURL); mainURL = null; sources.length = 0; pages = []; selected = undefined; $('pm-files').value = ''; message('pm-error');
    renderSources(); renderPages(); update(); preview(); $('pm-status').textContent = '文档已清空，文件与结果未上传或保存。';
  }
  $('pm-files').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
  for (const type of ['dragenter', 'dragover']) $('pm-drop').addEventListener(type, event => { event.preventDefault(); if (!busy) $('pm-drop').classList.add('drag-over'); });
  for (const type of ['dragleave', 'drop']) $('pm-drop').addEventListener(type, event => { event.preventDefault(); $('pm-drop').classList.remove('drag-over'); if (type === 'drop') addFiles(event.dataTransfer.files); });
  $('pm-sample').addEventListener('click', async () => { if (busy) return; const { samplePDF } = await import('./pdf-images-sample.js'); if (!busy && !disposed) { const file = samplePDF(); addFiles([file, new File([file], 'sgao-pdf-copy.pdf', { type: 'application/pdf' })]); } });
  $('pm-clear').addEventListener('click', clear); $('pm-restore').addEventListener('click', restore); $('pm-run').addEventListener('click', run); $('pm-stop').addEventListener('click', () => { controller?.abort(); update(); }); $('pm-zip').addEventListener('click', zip);
  for (const id of ['pm-mode', 'pm-ranges', 'pm-name']) $(id).addEventListener(id === 'pm-mode' ? 'change' : 'input', () => { if (busy) return; invalidate('导出设置已更新，请重新生成。'); update(); preview(); });
  for (const mode of ['source', 'output']) $(`pm-view-${mode}`).addEventListener('click', () => { previewMode = mode; update(); preview(); });
  $('pm-output-file').addEventListener('change', () => { outputIndex = Number($('pm-output-file').value); outputPage = 1; update(); preview(); });
  function go(index) { if (previewMode === 'output') outputPage = index + 1; else selected = pages[index]?.id; renderPages(); update(); preview(); }
  $('pm-preview-page').addEventListener('change', () => go(Number($('pm-preview-page').value)));
  $('pm-prev').addEventListener('click', () => go(Number($('pm-preview-page').value) - 1)); $('pm-next').addEventListener('click', () => go(Number($('pm-preview-page').value) + 1));
  $('pm-preview-image').addEventListener('load', fitPreview); const resize = new ResizeObserver(() => { fitPreview(); for (const item of pages) paintThumbnail(item.id); }); resize.observe($('pm-viewport')); resize.observe($('pm-pages'));
  window.addEventListener('pagehide', event => { mainController?.abort(); controller?.abort(); if (!event.persisted) { disposed = true; clear(); resize.disconnect(); observer?.disconnect(); } });
  window.addEventListener('pageshow', event => { if (event.persisted) { renderSources(); renderPages(); update(); preview(); } });
  update(); renderPages();
}
