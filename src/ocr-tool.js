import { validateOCR, OCR_LIMITS, ocrDimensions, ocrFilename, ocrTextBlob } from './lib/ocr.js';
import { decodeOCRImage, ocrThumbnail, prepareOCR } from './ocr-engine.js';
import { recognizeOCR } from './ocr-task.js';
import { receiveProcessedImage } from './image-transfer.js';

export function initOCR({ notify }) {
  const $ = id => document.getElementById(id);
  let source, prepared, result, revision = 0, sourceVersion = 0, operation = 0, working = null, controller, disposed = false, view = 'original', selectedLine = -1, manual = false, downloadURL, downloadTimer;
  const bytes = value => value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(2)} MB`;
  const message = (id, text = '') => { $(id).textContent = text; $(id).hidden = !text; };
  const options = () => ({ language: $('ocr-language').value, segmentation: $('ocr-layout').value, turns: Number($('ocr-turns').value), filter: $('ocr-filter').value });
  const preparedKey = () => `${sourceVersion}:${$('ocr-turns').value}:${$('ocr-filter').value}`;
  const text = () => $('ocr-text').value;
  const stale = () => !!result && result.revision !== revision;
  function releasePrepared() { if (prepared) URL.revokeObjectURL(prepared.url); prepared = null; }
  function refreshDownload() {
    clearTimeout(downloadTimer); if (downloadURL) URL.revokeObjectURL(downloadURL); downloadURL = null;
    const link = $('ocr-download'); link.removeAttribute('href');
    if (text().trim()) { downloadURL = URL.createObjectURL(ocrTextBlob(text())); link.href = downloadURL; link.download = ocrFilename(result?.name || source?.file.name); }
  }
  function renderBoxes() {
    const show = !!result && !stale() && view === 'prepared' && prepared?.key === result.preparedKey && $('ocr-boxes').checked;
    $('ocr-box-layer').replaceChildren(); if (!show) return;
    result.lines.forEach((line, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = `ocr-box${selectedLine === index ? ' is-selected' : ''}`;
      button.style.left = `${line.x0 / result.width * 100}%`; button.style.top = `${line.y0 / result.height * 100}%`; button.style.width = `${(line.x1 - line.x0) / result.width * 100}%`; button.style.height = `${(line.y1 - line.y0) / result.height * 100}%`;
      button.title = line.text; button.setAttribute('aria-label', `查看识别行 ${index + 1}：${line.text}`);
      button.addEventListener('click', () => { selectedLine = index; $('ocr-line-info').textContent = line.text; const at = text().indexOf(line.text); if (at >= 0) { $('ocr-text').focus({ preventScroll: true }); $('ocr-text').setSelectionRange(at, at + line.text.length); } renderBoxes(); });
      $('ocr-box-layer').append(button);
    });
  }
  function fit() {
    const image = $('ocr-image'); if (!source || !image.naturalWidth) return;
    const viewport = $('ocr-viewport'), multiplier = Number($('ocr-zoom').value), scale = Math.max(.001, Math.min((viewport.clientWidth - 40) / image.naturalWidth, (viewport.clientHeight - 40) / image.naturalHeight)) * multiplier;
    $('ocr-stage').style.width = `${image.naturalWidth * scale}px`; $('ocr-stage').style.height = `${image.naturalHeight * scale}px`;
    viewport.classList.toggle('is-zoomed', multiplier > 1);
  }
  function updateText() {
    const hasText = !!text().trim(); $('ocr-copy').disabled = !hasText; $('ocr-download').setAttribute('aria-disabled', String(!hasText)); $('ocr-download').tabIndex = hasText ? 0 : -1;
    $('ocr-text-meta').textContent = `${Array.from(text()).length.toLocaleString()} 字符 · ${bytes(new TextEncoder().encode(text()).length)}`;
    $('ocr-text-note').textContent = !result ? '识别结果可直接编辑；复制与下载以当前文本为准。' : `${manual ? '已手动编辑；' : ''}${stale() ? '图片或设置已变化，当前保留上次文本；' : ''}原始识别评分${result.confidence === null ? '未提供' : ` ${result.confidence.toFixed(0)} / 100`}，不代表正确率，请对照图片校对。`;
    message('ocr-stale', stale() && hasText ? '当前文字来自上次识别。重新识别成功后会替换文本，停止或失败会保留现有内容。' : '');
  }
  function update() {
    const busy = !!working, hasContent = !!source || !!text();
    $('ocr-workspace').hidden = $('ocr-jumps').hidden = !hasContent;
    $('ocr-file').disabled = $('ocr-sample').disabled = busy; $('ocr-clear').disabled = !hasContent && !busy;
    $('ocr-settings').disabled = busy; $('ocr-run').disabled = busy || !source;
    $('ocr-run').textContent = working === 'ocr' ? '正在识别…' : text().trim() ? '重新识别并替换文本' : '开始识别文字';
    $('ocr-stop').hidden = !busy; $('ocr-stop').disabled = !!controller?.signal.aborted; $('ocr-text').readOnly = working === 'ocr';
    $('ocr-drop').classList.toggle('is-loaded', !!source);
    $('ocr-source-name').textContent = source?.file.name || '尚未选择图片';
    $('ocr-source-meta').textContent = source ? `${source.width} × ${source.height} px · ${bytes(source.file.size)}` : '';
    const dimensions = source ? ocrDimensions(source.width, source.height, options()) : null;
    $('ocr-size-note').textContent = dimensions ? `识别尺寸 ${dimensions.width} × ${dimensions.height} px${dimensions.reduced ? ' · 已等比缩小；小字建议先裁剪区域再识别。' : ' · 保留像素尺寸。'}透明区域按白底处理。` : '';
    $('ocr-model-note').textContent = $('ocr-language').value === 'chi_sim+eng' ? '中英混合首次按需加载约 8–9 MB 引擎与模型；后续是否复用由浏览器缓存决定。图片和文字不写入浏览器存储。' : '首次按需加载本站识别引擎与所选语言模型；切换单一语言可减少资源加载与处理量。';
    for (const value of ['original', 'prepared']) $(`ocr-view-${value}`).setAttribute('aria-pressed', String(view === value));
    $('ocr-view-prepared').disabled = !source || busy;
    const imageURL = view === 'prepared' && prepared ? prepared.url : source?.url;
    if (imageURL && $('ocr-image').getAttribute('src') !== imageURL) $('ocr-image').src = imageURL;
    $('ocr-stage').hidden = !imageURL; $('ocr-image-empty').hidden = !!imageURL;
    $('ocr-preview-note').textContent = view === 'prepared' && prepared ? '当前显示实际送入识别引擎的图片。启用文字框后可点击定位识别行。' : '原图缩略预览，最长边 1600 px；点击「识别用图」检查旋转和预处理效果。';
    $('ocr-boxes').disabled = !result || stale() || view !== 'prepared';
    if (selectedLine < 0) $('ocr-line-info').textContent = result?.lineCount > OCR_LIMITS.lines ? '文字框仅显示前 1000 行，完整文字仍可编辑与下载。' : '';
    updateText(); renderBoxes(); fit();
  }
  function changed() {
    if (working) return; revision++; selectedLine = -1; message('ocr-error');
    if (prepared?.key !== preparedKey()) { releasePrepared(); view = 'original'; }
    $('ocr-progress').value = 0; $('ocr-status').textContent = '设置已更新，可预览识别用图或重新识别；现有文本保留。'; update();
  }
  async function load(file) {
    if (!file || disposed) return; if (working) { notify('请先停止当前操作再更换图片'); return; }
    const token = ++operation, abort = new AbortController(); controller = abort; working = 'load'; message('ocr-error'); update(); $('ocr-status').textContent = '正在本地读取图片…';
    let image;
    try {
      const decoded = await decodeOCRImage(file); image = decoded.image;
      if (abort.signal.aborted) throw new DOMException('读取已停止', 'AbortError');
      const thumbnail = await ocrThumbnail(image); if (abort.signal.aborted) throw new DOMException('读取已停止', 'AbortError');
      if (token !== operation || disposed) return;
      if (source) URL.revokeObjectURL(source.url); releasePrepared(); sourceVersion++; revision++; selectedLine = -1; view = 'original';
      source = { file, mime: decoded.mime, width: image.width, height: image.height, url: URL.createObjectURL(thumbnail) };
      $('ocr-status').textContent = '图片已载入。选择语言、方向与排版后开始识别，图片不会上传。';
    } catch (cause) { if (token === operation && !disposed) { if (cause.name !== 'AbortError') message('ocr-error', cause.message); $('ocr-status').textContent = cause.name === 'AbortError' ? '读取已停止，原有内容保留。' : '图片未载入，原有内容保留，请检查后重试。'; } }
    finally { image?.close(); if (token === operation && !disposed) { working = null; controller = null; update(); } }
  }
  async function getPrepared(signal, snapshot) {
    const key = preparedKey(); if (prepared?.key === key) return prepared;
    const data = await prepareOCR(source.file, snapshot, { signal, onProgress: label => { $('ocr-status').textContent = label; } });
    if (signal.aborted) throw new DOMException('处理已停止', 'AbortError');
    releasePrepared(); prepared = { ...data, key, url: URL.createObjectURL(data.blob) }; return prepared;
  }
  async function previewPrepared() {
    if (!source || working) return;
    const token = ++operation, abort = new AbortController(), snapshot = options(); controller = abort; working = 'prepare'; message('ocr-error'); update();
    try { await getPrepared(abort.signal, snapshot); if (token === operation && !disposed) { view = 'prepared'; $('ocr-status').textContent = '识别用图已准备好，可检查方向与小字后开始识别。'; } }
    catch (cause) { if (token === operation && !disposed && cause.name !== 'AbortError') message('ocr-error', cause.message); }
    finally { if (token === operation && !disposed) { working = null; controller = null; update(); } }
  }
  async function run() {
    if (!source || working) return; const snapshot = validateOCR(options()), token = ++operation, currentRevision = revision, abort = new AbortController(), name = source.file.name;
    working = 'ocr'; controller = abort; message('ocr-error'); $('ocr-progress').value = 0; update(); const start = performance.now();
    try {
      const ready = await getPrepared(abort.signal, snapshot); view = 'prepared'; update();
      const data = await recognizeOCR(new Uint8Array(await ready.blob.arrayBuffer()), ready, snapshot, { signal: abort.signal, onProgress: (progress, label) => { if (token === operation && !disposed) { $('ocr-progress').value = progress; $('ocr-status').textContent = label; } } });
      if (token !== operation || disposed || abort.signal.aborted) return;
      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      if (data.text.trim()) {
        $('ocr-text').value = data.text; manual = false; selectedLine = -1; result = { ...data, revision: currentRevision, preparedKey: ready.key, width: ready.width, height: ready.height, name }; refreshDownload();
        $('ocr-status').textContent = `识别完成，用时 ${elapsed} 秒。请对照图片校对，再复制或下载文字。`; notify('文字识别完成');
      } else {
        if (!text().trim()) { result = { ...data, revision: currentRevision, preparedKey: ready.key, width: ready.width, height: ready.height, name }; manual = false; }
        $('ocr-status').textContent = '本次未识别到文字，已有文本保留。请检查方向、语言，或裁剪文字区域后再试。';
      }
    } catch (cause) { if (token === operation && !disposed) { if (cause.name !== 'AbortError') message('ocr-error', cause.message); $('ocr-status').textContent = cause.name === 'AbortError' ? '识别已停止，已有文本保留，可调整后重试。' : '本次识别未完成，已有文本保留。'; } }
    finally { if (token === operation && !disposed) { working = null; controller = null; update(); } }
  }
  function clear() {
    controller?.abort(); operation++; revision++; sourceVersion++; clearTimeout(downloadTimer);
    if (source) URL.revokeObjectURL(source.url); releasePrepared(); if (downloadURL) URL.revokeObjectURL(downloadURL);
    source = result = null; downloadURL = null; working = null; controller = null; manual = false; selectedLine = -1; view = 'original';
    $('ocr-text').value = ''; $('ocr-file').value = ''; $('ocr-image').removeAttribute('src'); $('ocr-download').removeAttribute('href'); $('ocr-progress').value = 0; message('ocr-error');
    $('ocr-status').textContent = '图片与文字已清空，内容未上传或持久保存。'; update();
  }
  $('ocr-file').addEventListener('change', event => { load(event.target.files[0]); event.target.value = ''; });
  for (const type of ['dragenter', 'dragover']) $('ocr-drop').addEventListener(type, event => { event.preventDefault(); if (!working) $('ocr-drop').classList.add('drag-over'); });
  for (const type of ['dragleave', 'drop']) $('ocr-drop').addEventListener(type, event => { event.preventDefault(); $('ocr-drop').classList.remove('drag-over'); if (type === 'drop') { if (event.dataTransfer.files.length !== 1) message('ocr-error', '请一次放入一张静态图片。'); else load(event.dataTransfer.files[0]); } });
  const paste = event => {
    const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    if (!files.length) return; event.preventDefault(); if (files.length !== 1) message('ocr-error', '请一次粘贴一张截图。'); else load(files[0]);
  };
  document.addEventListener('paste', paste);
  $('ocr-sample').addEventListener('click', async () => { if (working) return; try { const { sampleOCRFile } = await import('./ocr-sample.js'); load(await sampleOCRFile()); } catch (cause) { message('ocr-error', cause.message); } });
  $('ocr-clear').addEventListener('click', clear); $('ocr-run').addEventListener('click', run); $('ocr-stop').addEventListener('click', () => { controller?.abort(); update(); });
  for (const id of ['ocr-language', 'ocr-layout', 'ocr-turns', 'ocr-filter']) $(id).addEventListener('change', changed);
  $('ocr-view-original').addEventListener('click', () => { view = 'original'; update(); }); $('ocr-view-prepared').addEventListener('click', previewPrepared);
  $('ocr-zoom').addEventListener('change', fit); $('ocr-boxes').addEventListener('change', renderBoxes); $('ocr-image').addEventListener('load', fit);
  $('ocr-text').addEventListener('input', () => { manual = true; selectedLine = -1; updateText(); clearTimeout(downloadTimer); downloadTimer = setTimeout(refreshDownload, 180); });
  $('ocr-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(text()); notify('文字已复制'); } catch { notify('无法访问剪贴板，请选中文字后手动复制'); } });
  $('ocr-download').addEventListener('click', event => { if (!text().trim()) event.preventDefault(); else refreshDownload(); });
  const resize = new ResizeObserver(fit); resize.observe($('ocr-viewport'));
  receiveProcessedImage(file => { load(file); }, error => message('ocr-error', error));
  window.addEventListener('pagehide', event => { controller?.abort(); if (!event.persisted) { disposed = true; clear(); document.removeEventListener('paste', paste); resize.disconnect(); } });
  window.addEventListener('pageshow', event => { if (event.persisted) update(); });
  update();
}
