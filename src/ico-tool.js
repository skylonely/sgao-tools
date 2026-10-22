import { ICO_SIZES, encodeICO, getIconRect, iconFilename } from './lib/ico.js';

export function initICO({ notify }) {
  const $ = id => document.getElementById(id);
  let source = null, output = null, loadVersion = 0, loading = false;
  const inputs = Array.from(document.querySelectorAll('[name="ico-size"]'));
  const selectedSizes = () => inputs.filter(input => input.checked).map(input => Number(input.value));
  function error(message = '') { $('ico-error').textContent = message; $('ico-error').hidden = !message; }
  function releaseSource() {
    if (source) { source.image.src = ''; URL.revokeObjectURL(source.url); source = null; }
  }
  function resetOutput(message = '上传图片后，在这里查看各尺寸效果。') {
    output = null; $('ico-download').disabled = true;
    $('ico-output-meta').textContent = '等待生成';
    $('ico-previews').replaceChildren();
    const empty = document.createElement('p'); empty.className = 'ico-preview-empty'; empty.textContent = message;
    $('ico-previews').append(empty);
    $('ico-warning').hidden = true;
  }
  function render() {
    error();
    $('ico-color').disabled = $('ico-background').value !== 'color';
    if (!source || loading) { resetOutput(); return; }
    const sizes = selectedSizes();
    if (!sizes.length) { resetOutput('请至少选择一个输出尺寸。'); return; }
    try {
      const frames = [], previews = document.createDocumentFragment();
      for (const size of sizes) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
        canvas.setAttribute('aria-label', `${size} × ${size} 像素图标预览`); canvas.setAttribute('role', 'img');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('当前浏览器无法绘制图片，请更换浏览器重试。');
        if ($('ico-background').value === 'color') { context.fillStyle = $('ico-color').value; context.fillRect(0, 0, size, size); }
        const rect = getIconRect(source.image.naturalWidth, source.image.naturalHeight, size, $('ico-fit').value);
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(source.image, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
        frames.push({ size, rgba: context.getImageData(0, 0, size, size).data });
        const tile = document.createElement('div'); tile.className = 'ico-preview-tile';
        const checker = document.createElement('div'); checker.className = 'ico-checker ico-preview-image'; checker.append(canvas);
        const label = document.createElement('span'); label.textContent = `${size} × ${size}`;
        tile.append(checker, label); previews.append(tile);
      }
      output = new Blob([encodeICO(frames)], { type: 'image/x-icon' });
      $('ico-previews').replaceChildren(previews);
      $('ico-output-meta').textContent = `${sizes.length} 个尺寸 · ${(output.size / 1024).toFixed(1)} KB`;
      $('ico-download').disabled = false;
      const upscale = Math.max(...sizes) > Math.min(source.image.naturalWidth, source.image.naturalHeight);
      $('ico-warning').hidden = !upscale;
    } catch (cause) { resetOutput('暂时无法生成预览。'); error(cause.name === 'SecurityError' ? '图片无法读取像素。请将 SVG 转为 PNG 后重试。' : cause.message); }
  }
  async function loadFile(file) {
    if (!file) return;
    const version = ++loadVersion;
    error();
    if (file.size > 10 * 1024 * 1024 || !/\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
      loading = false; $('ico-upload').removeAttribute('aria-busy'); render();
      $('ico-source-meta').textContent = source ? `${source.image.naturalWidth} × ${source.image.naturalHeight} px` : '未选择图片';
      error(file.size > 10 * 1024 * 1024 ? '图片不能超过 10 MB，请缩小文件后重试。' : '请选择 PNG、JPG、WebP 或 SVG 图片。'); return;
    }
    loading = true; resetOutput('正在读取图片…'); $('ico-source-meta').textContent = '正在读取…';
    $('ico-upload').setAttribute('aria-busy', 'true');
    $('ico-clear').disabled = false;
    const url = URL.createObjectURL(file), image = new Image();
    let keepURL = false;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { image.src = ''; reject(new Error('图片读取超时，请使用完整的本地图片后重试。')); }, 10_000);
        image.onload = () => { clearTimeout(timeout); resolve(); };
        image.onerror = () => { clearTimeout(timeout); reject(new Error('无法读取这张图片，请检查文件是否完整；SVG 需要有效尺寸。')); };
        image.src = url;
      });
      if (version !== loadVersion) return;
      const width = image.naturalWidth, height = image.naturalHeight;
      if (!width || !height || width > 8192 || height > 8192 || width * height > 24_000_000) throw new Error('图片尺寸过大或无效，请使用边长不超过 8192、总像素不超过 2400 万的图片。');
      releaseSource(); source = { image, url, file }; keepURL = true;
      $('ico-source-image').src = url; $('ico-source-image').hidden = false;
      $('ico-upload-empty').hidden = true;
      $('ico-source-name').textContent = file.name;
      $('ico-source-meta').textContent = `${width} × ${height} px · ${(file.size / 1024).toFixed(1)} KB`;
      $('ico-clear').disabled = false;
    } catch (cause) {
      if (version === loadVersion) {
        $('ico-source-meta').textContent = source ? `${source.image.naturalWidth} × ${source.image.naturalHeight} px` : '未选择图片';
        loading = false; render(); error(cause.message);
      }
    } finally {
      if (!keepURL) { image.src = ''; URL.revokeObjectURL(url); }
      if (version === loadVersion) {
        loading = false; $('ico-upload').removeAttribute('aria-busy');
        if (keepURL) render();
      }
    }
  }
  $('ico-file').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; loadFile(file); });
  let dragDepth = 0;
  $('ico-upload').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('ico-upload').classList.add('drag-over'); });
  $('ico-upload').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  $('ico-upload').addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('ico-upload').classList.remove('drag-over'); } });
  $('ico-upload').addEventListener('drop', event => {
    event.preventDefault(); dragDepth = 0; $('ico-upload').classList.remove('drag-over');
    const files = event.dataTransfer.files;
    if (files.length !== 1) { error('请一次选择一张图片。'); return; }
    loadFile(files[0]);
  });
  for (const id of ['ico-fit', 'ico-background', 'ico-color']) $(id).addEventListener('input', render);
  inputs.forEach(input => input.addEventListener('change', render));
  for (const [id, sizes] of [['ico-preset-web', [16, 32, 48]], ['ico-preset-all', ICO_SIZES]]) $(id).addEventListener('click', () => { inputs.forEach(input => { input.checked = sizes.includes(Number(input.value)); }); render(); });
  $('ico-clear').addEventListener('click', () => {
    loadVersion++; loading = false; releaseSource();
    $('ico-upload').removeAttribute('aria-busy'); $('ico-source-image').removeAttribute('src'); $('ico-source-image').hidden = true;
    $('ico-upload-empty').hidden = false; $('ico-source-name').textContent = '支持透明图片，建议使用正方形原图';
    $('ico-source-meta').textContent = '未选择图片'; $('ico-clear').disabled = true; error(); resetOutput();
  });
  $('ico-download').addEventListener('click', () => {
    if (!output || loading) return;
    const link = document.createElement('a'), url = URL.createObjectURL(output);
    link.href = url; link.download = iconFilename($('ico-filename').value); document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000); notify('ICO 文件已生成，下载已开始');
  });
  $('ico-sample').addEventListener('click', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><path fill="#ec6245" d="M76 12h104a64 64 0 0 1 64 64v104a64 64 0 0 1-64 64H24a12 12 0 0 1-12-12V76a64 64 0 0 1 64-64Z"/><path d="m90 90-38 38 38 38m76-76 38 38-38 38M142 72l-28 112" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    loadFile(new File([svg], 'sgao-tools.svg', { type: 'image/svg+xml' }));
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) { loadVersion++; releaseSource(); } });
}
