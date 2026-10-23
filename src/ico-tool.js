import { ICO_SIZES, iconFilename } from './lib/ico.js';
import { faviconDocuments } from './lib/favicon.js';
import { generateFaviconImages } from './favicon-engine.js';
import { createZIP } from './lib/zip.js';

export function initICO({ notify }) {
  const $ = id => document.getElementById(id);
  const inputs = Array.from(document.querySelectorAll('[name="ico-size"]'));
  let source = null, images = null, bundle = null, loading = false, archiveBusy = false;
  let loadVersion = 0, renderVersion = 0, loadController, renderController, renderTimer;
  const downloadURLs = new Set();
  const selectedSizes = () => inputs.filter(input => input.checked).map(input => Number(input.value));
  const error = (id, message = '') => { $(id).textContent = message; $(id).hidden = !message; };
  const byteSize = bytes => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  function releaseSource() { if (source) { source.image.src = ''; URL.revokeObjectURL(source.url); source = null; } }
  function setStatus(message) { $('favicon-status').textContent = message; }
  function updateButtons() {
    $('ico-download').disabled = !images || loading;
    $('favicon-download').disabled = !bundle || loading || archiveBusy;
    $('favicon-copy-html').disabled = $('favicon-copy-manifest').disabled = !bundle;
  }
  function invalidateImages(message = '正在生成网站图标…') {
    renderVersion++; clearTimeout(renderTimer); renderController?.abort(); renderController = null;
    images = bundle = null; updateButtons();
    $('ico-previews').replaceChildren(); $('ico-output-meta').textContent = '等待生成';
    $('favicon-results').hidden = true; $('favicon-html').value = $('favicon-manifest').value = '';
    $('favicon-file-list').replaceChildren(); $('favicon-file-count').textContent = '13 个文件';
    $('ico-warning').hidden = true;
    for (const id of ['favicon-browser-icon', 'favicon-apple-icon', 'favicon-maskable-icon']) $(id).replaceChildren();
    setStatus(message); error('favicon-error');
  }
  function readConfig() {
    return {
      name: $('favicon-app-name').value, shortName: $('favicon-short-name').value,
      themeColor: $('favicon-theme').value, appBackground: $('favicon-app-background').value,
      assetPath: $('favicon-asset-path').value, appPath: $('favicon-app-path').value, display: $('favicon-display').value,
    };
  }
  function copyCanvas(canvas, size) {
    const copy = document.createElement('canvas'); copy.width = copy.height = size;
    copy.getContext('2d').drawImage(canvas, 0, 0, size, size); return copy;
  }
  function refreshPlatforms() {
    const title = $('favicon-short-name').value.trim() || '我的网站';
    $('favicon-browser-title').textContent = $('favicon-apple-title').textContent = $('favicon-maskable-title').textContent = title;
    $('favicon-maskable-stage').classList.toggle('show-safe-zone', $('favicon-safe-zone').checked);
    if (!images) return;
    const lookup = name => images.pngs.find(item => item.name === name).canvas;
    const browser = copyCanvas(lookup('favicon-16x16.png'), 16); browser.setAttribute('aria-label', '浏览器标签图标预览');
    const apple = copyCanvas(lookup('apple-touch-icon.png'), 180); apple.setAttribute('aria-label', 'Apple Touch 图标预览');
    const maskable = copyCanvas(lookup('maskable-icon-512x512.png'), 512); maskable.setAttribute('aria-label', 'Maskable 自适应图标预览');
    $('favicon-browser-icon').replaceChildren(browser); $('favicon-apple-icon').replaceChildren(apple); $('favicon-maskable-icon').replaceChildren(maskable);
  }
  function renderFiles(files) {
    const fragment = document.createDocumentFragment();
    for (const file of files) {
      const row = document.createElement('div'); row.className = 'favicon-file';
      const info = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('span');
      name.textContent = file.name;
      const dimensions = file.size ? `${file.size} × ${file.size} px` : file.sizeLabel ? `${file.sizeLabel} px` : file.label;
      detail.textContent = `${dimensions} · ${byteSize(file.blob.size)}`;
      info.append(name, detail);
      const button = document.createElement('button'); button.className = 'text-button'; button.textContent = '下载';
      button.setAttribute('aria-label', `下载 ${file.name}`); button.addEventListener('click', () => download(file.blob, file.name));
      row.append(info, button); fragment.append(row);
    }
    $('favicon-file-list').replaceChildren(fragment);
  }
  function refreshDocuments() {
    bundle = null; updateButtons(); refreshPlatforms(); error('favicon-error');
    if (!images || loading) return;
    try {
      const documents = faviconDocuments(readConfig(), images.sizes);
      const texts = documents.files.map(file => ({ ...file, label: file.name === 'site.webmanifest' ? '应用配置' : file.name === 'html-head.txt' ? 'HTML 引用代码' : '文件放置说明', blob: new Blob([file.text], { type: `${file.type};charset=utf-8` }) }));
      bundle = { ...documents, files: [...images.files, ...texts] };
      $('favicon-html').value = documents.html; $('favicon-manifest').value = documents.manifest;
      $('favicon-file-count').textContent = `${bundle.files.length} 个文件 · ${byteSize(bundle.files.reduce((sum, file) => sum + file.blob.size, 0))}`;
      renderFiles(bundle.files); updateButtons();
      setStatus('图标和引用代码已就绪，预览后即可下载整包。');
    } catch (cause) {
      $('favicon-html').value = $('favicon-manifest').value = '';
      $('favicon-file-count').textContent = `${images.files.length} 个图像文件`;
      renderFiles(images.files); error('favicon-error', cause.message); setStatus('请完善应用配置，生成 Manifest 和整包引用代码。');
    }
  }
  async function render() {
    invalidateImages(); error('ico-error');
    $('ico-color').disabled = $('ico-background').value !== 'color';
    if (!source || loading) { setStatus(loading ? '正在读取图片…' : '选择一张 Logo，自动生成完整资源包。'); return; }
    const sizes = selectedSizes();
    if (!sizes.length) { error('ico-error', '请至少选择一个 ICO 尺寸。'); setStatus('选择 ICO 尺寸后继续生成。'); return; }
    const ticket = renderVersion, snapshot = source, controller = new AbortController(); renderController = controller;
    try {
      const options = { fit: $('ico-fit').value, background: $('ico-background').value === 'color' ? $('ico-color').value : null, appBackground: $('favicon-app-background').value };
      const result = await generateFaviconImages(snapshot.image, sizes, options, controller.signal);
      if (ticket !== renderVersion || source !== snapshot) return;
      images = result;
      const previews = document.createDocumentFragment();
      for (const { size, canvas } of result.frames) {
        const tile = document.createElement('div'); tile.className = 'ico-preview-tile';
        const checker = document.createElement('div'); checker.className = 'ico-checker ico-preview-image';
        canvas.setAttribute('aria-label', `${size} × ${size} 像素 ICO 图标预览`); canvas.setAttribute('role', 'img'); checker.append(canvas);
        const label = document.createElement('span'); label.textContent = `${size} × ${size}`;
        tile.append(checker, label); previews.append(tile);
      }
      $('ico-previews').replaceChildren(previews); $('ico-output-meta').textContent = `${sizes.length} 个尺寸 · ${byteSize(result.ico.size)}`;
      $('favicon-results').hidden = false;
      const vector = /\.svg$/i.test(snapshot.file.name);
      $('ico-warning').hidden = vector || Math.min(snapshot.image.naturalWidth, snapshot.image.naturalHeight) >= 512;
      refreshDocuments();
    } catch (cause) {
      if (ticket !== renderVersion || cause.name === 'AbortError') return;
      error('ico-error', cause.name === 'SecurityError' ? '图片无法读取像素，请先使用 SVG 工具转为 PNG 后重试。' : cause.message);
      setStatus('图标未能生成，请调整图片后重试。');
    } finally { if (ticket === renderVersion) renderController = null; }
  }
  function scheduleRender() {
    invalidateImages('设置已更新，正在重新生成…'); $('ico-color').disabled = $('ico-background').value !== 'color';
    renderTimer = setTimeout(render, 160);
  }
  function readImage(url, signal) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const finish = cause => { clearTimeout(timer); signal.removeEventListener('abort', abort); image.onload = image.onerror = null; if (cause) { image.src = ''; reject(cause); } else resolve(image); };
      const abort = () => finish(new DOMException('任务已取消', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('图片读取超时，请使用完整的本地图片后重试。')), 12_000);
      image.onload = () => finish(); image.onerror = () => finish(new Error('无法读取这张图片，请检查文件是否完整；SVG 需要有效尺寸和内嵌资源。'));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true }); image.src = url;
    });
  }
  async function loadFile(file) {
    if (!file) return;
    const ticket = ++loadVersion;
    loadController?.abort(); loading = false; $('ico-upload').removeAttribute('aria-busy');
    if (file.size > 10 * 1024 * 1024 || !/\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
      if (source && !images) await render();
      if (ticket === loadVersion) error('ico-error', file.size > 10 * 1024 * 1024 ? '图片不能超过 10 MB。' : '请选择 PNG、JPG、WebP 或 SVG 图片。');
      return;
    }
    const controller = new AbortController(); loadController = controller;
    loading = true; invalidateImages('正在读取图片…'); error('ico-error');
    $('ico-upload').setAttribute('aria-busy', 'true'); $('ico-clear').disabled = false;
    const url = URL.createObjectURL(file); let keepURL = false;
    try {
      const image = await readImage(url, controller.signal);
      if (ticket !== loadVersion) { image.src = ''; return; }
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width > 8192 || height > 8192 || width * height > 24_000_000) { image.src = ''; throw new Error('源图片单边不能超过 8192 像素，总像素不能超过 2400 万。'); }
      releaseSource(); source = { image, url, file }; keepURL = true; loading = false;
      $('ico-source-image').src = url; $('ico-source-image').hidden = false; $('ico-upload-empty').hidden = true;
      $('ico-source-name').textContent = file.name; $('ico-source-meta').textContent = `${width} × ${height} px · ${byteSize(file.size)}`;
      $('ico-upload').removeAttribute('aria-busy'); await render();
    } catch (cause) {
      if (ticket !== loadVersion || cause.name === 'AbortError') return;
      loading = false; if (source) await render();
      if (ticket === loadVersion) { error('ico-error', cause.message); setStatus(source ? '当前保留上一张有效图片。' : '图片读取未成功，请重新选择。'); }
    } finally {
      if (!keepURL) URL.revokeObjectURL(url);
      if (ticket === loadVersion) { loading = false; loadController = null; $('ico-upload').removeAttribute('aria-busy'); updateButtons(); }
    }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); downloadURLs.add(url);
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloadURLs.delete(url); }, 30_000);
  }
  $('ico-file').addEventListener('change', () => { const file = $('ico-file').files[0]; $('ico-file').value = ''; loadFile(file); });
  let dragDepth = 0;
  const drop = $('ico-upload');
  drop.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; drop.classList.add('drag-over'); });
  drop.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  drop.addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('drag-over'); } });
  drop.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; drop.classList.remove('drag-over'); if (event.dataTransfer.files.length !== 1) { error('ico-error', '请一次选择一张图片。'); return; } loadFile(event.dataTransfer.files[0]); });
  for (const id of ['ico-fit', 'ico-background', 'ico-color', 'favicon-app-background']) $(id).addEventListener('input', scheduleRender);
  inputs.forEach(input => input.addEventListener('change', scheduleRender));
  for (const [id, sizes] of [['ico-preset-web', [16, 32, 48]], ['ico-preset-all', ICO_SIZES]]) $(id).addEventListener('click', () => { inputs.forEach(input => { input.checked = sizes.includes(Number(input.value)); }); scheduleRender(); });
  for (const id of ['favicon-app-name', 'favicon-short-name', 'favicon-theme', 'favicon-asset-path', 'favicon-app-path', 'favicon-display']) $(id).addEventListener('input', refreshDocuments);
  $('favicon-safe-zone').addEventListener('change', refreshPlatforms);
  $('ico-clear').addEventListener('click', () => {
    loadVersion++; loadController?.abort(); loadController = null; loading = false; releaseSource(); invalidateImages('选择一张 Logo，自动生成完整资源包。');
    $('ico-upload').removeAttribute('aria-busy'); $('ico-source-image').removeAttribute('src'); $('ico-source-image').hidden = true;
    $('ico-upload-empty').hidden = false; $('ico-source-name').textContent = '推荐 SVG 或至少 512 × 512 的清晰图片';
    $('ico-source-meta').textContent = '未选择图片'; $('ico-clear').disabled = true; error('ico-error');
  });
  $('ico-download').addEventListener('click', () => { if (images && !loading) download(images.ico, iconFilename($('ico-filename').value)); });
  $('favicon-download').addEventListener('click', async () => {
    if (!bundle || archiveBusy) return;
    const snapshot = bundle; archiveBusy = true; updateButtons(); $('favicon-download').textContent = '正在打包…';
    try {
      const files = await Promise.all(snapshot.files.map(async file => ({ name: file.name, data: new Uint8Array(await file.blob.arrayBuffer()) })));
      if (bundle !== snapshot) return;
      download(new Blob([createZIP(files)], { type: 'application/zip' }), 'website-icons.zip'); notify('网站图标整包已下载');
    } catch (cause) { if (bundle === snapshot) error('favicon-error', cause.message); }
    finally { archiveBusy = false; $('favicon-download').textContent = '下载 ZIP 整包'; updateButtons(); }
  });
  for (const [button, field] of [['favicon-copy-html', 'favicon-html'], ['favicon-copy-manifest', 'favicon-manifest']]) $(button).addEventListener('click', async () => {
    if (!bundle) return;
    try { await navigator.clipboard.writeText($(field).value); notify('引用内容已复制'); }
    catch { $(field).focus(); $(field).select(); notify('请手动复制已选中的内容。'); }
  });
  $('ico-sample').addEventListener('click', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 256 256"><path fill="#ec6245" d="M76 12h104a64 64 0 0 1 64 64v104a64 64 0 0 1-64 64H24a12 12 0 0 1-12-12V76a64 64 0 0 1 64-64Z"/><path d="m90 90-38 38 38 38m76-76 38 38-38 38M142 72l-28 112" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    loadFile(new File([svg], 'sgao-logo.svg', { type: 'image/svg+xml' }));
  });
  window.addEventListener('pagehide', event => {
    loadVersion++; loadController?.abort(); loading = false; invalidateImages();
    if (!event.persisted) releaseSource();
    downloadURLs.forEach(url => URL.revokeObjectURL(url)); downloadURLs.clear();
  });
  window.addEventListener('pageshow', event => { if (event.persisted && source) render(); });
  refreshPlatforms(); updateButtons();
}
