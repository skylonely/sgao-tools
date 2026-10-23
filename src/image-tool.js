import { createZIP } from './lib/zip.js';
import { savings } from './lib/image-compression.js';

export function initImageTool({ notify }) {
  const $ = id => document.getElementById(id);
  const items = []; let running = false, version = 0, worker = null, abort = null, cancelJob = null, nextID = 0;
  const controls = ['image-profile', 'image-format', 'image-max-edge', 'image-background'];
  function error(message = '') { $('image-error').textContent = message; $('image-error').hidden = !message; }
  function bytes(value) { return value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(2)} MB`; }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  function clearResult(item) { if (item.url) URL.revokeObjectURL(item.url); item.url = null; item.result = null; }
  function button(label, handler, className = 'text-button') { const node = document.createElement('button'); node.textContent = label; node.className = className; node.addEventListener('click', handler); return node; }
  function showComparison(item) {
    if (!item.result) return;
    $('image-compare-title').textContent = item.file.name;
    $('image-compare-original').src = item.originalURL; $('image-compare-output').src = item.url;
    $('image-compare-original-meta').textContent = `原图 · ${bytes(item.file.size)} · ${item.result.originalWidth} × ${item.result.originalHeight}`;
    $('image-compare-output-meta').textContent = `处理后 · ${bytes(item.result.blob.size)} · ${item.result.width} × ${item.result.height}`;
    $('image-compare-slider').value = '50'; $('image-compare-output').style.clipPath = 'inset(0 50% 0 0)';
    $('image-compare-dialog').showModal();
  }
  function render() {
    $('image-list').replaceChildren();
    let input = 0, output = 0, done = 0;
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'image-file-row';
      const image = document.createElement('img'); image.src = item.originalURL; image.alt = ''; image.className = 'image-file-thumbnail ico-checker';
      const info = document.createElement('div'); info.className = 'image-file-info';
      const name = document.createElement('strong'); name.textContent = item.file.name;
      const detail = document.createElement('span'); detail.textContent = item.result ? `${bytes(item.file.size)} → ${bytes(item.result.blob.size)} · ${item.result.mime.split('/')[1].toUpperCase()} · ${item.result.width} × ${item.result.height}` : bytes(item.file.size);
      info.append(name, detail);
      const state = document.createElement('span'); state.className = 'image-file-state';
      if (item.result) {
        const saved = savings(item.file.size, item.result.blob.size);
        state.textContent = item.result.original ? '原图已较优' : saved.bytes > 0 ? `−${saved.percent.toFixed(1)}%` : saved.bytes < 0 ? `+${Math.abs(saved.percent).toFixed(1)}% · 格式转换` : '体积相同';
        state.classList.toggle('image-no-saving', saved.bytes <= 0);
        input += item.file.size; output += item.result.blob.size; done++;
      } else { state.textContent = item.status; if (item.failed) state.classList.add('image-failed'); }
      const actions = document.createElement('div'); actions.className = 'image-file-actions';
      if (item.result) { actions.append(button('对比', () => showComparison(item)), button('下载', () => download(item.result.blob, item.result.name))); }
      const remove = button('移除', () => { clearResult(item); URL.revokeObjectURL(item.originalURL); items.splice(items.indexOf(item), 1); render(); }); remove.disabled = running; actions.append(remove);
      row.append(image, info, state, actions); $('image-list').append(row);
    }
    $('image-results').hidden = !items.length;
    $('image-count').textContent = `${items.length} 张图片`;
    $('image-input-total').textContent = bytes(input); $('image-output-total').textContent = bytes(output);
    const saved = savings(input, output);
    $('image-saved-total').textContent = saved.bytes > 0 ? `${bytes(saved.bytes)}（${saved.percent.toFixed(1)}%）` : saved.bytes < 0 ? `增加 ${bytes(-saved.bytes)}` : '0 B';
    $('image-summary-note').textContent = done ? `已处理 ${done} / ${items.length} 张 · 统计以处理成功的图片为准` : '选择图片，即可开始优化';
    $('image-run').disabled = running || !items.length;
    $('image-run').textContent = running ? '正在智能压缩…' : done ? '按当前设置重新压缩' : '开始智能压缩';
    $('image-stop').hidden = !running; $('image-clear').disabled = running || !items.length;
    $('image-zip').disabled = running || !done;
    controls.forEach(id => { $(id).disabled = running || id === 'image-background' && $('image-format').value !== 'image/jpeg'; });
    $('image-files').disabled = running; $('image-sample').disabled = running;
  }
  async function process(item, options, id) {
    if (typeof OffscreenCanvas !== 'function' || typeof Worker !== 'function') {
      const { compressImage } = await import('./image-engine.js');
      return compressImage(item.file, options, { signal: abort.signal, onProgress: message => { if (id === version) { item.status = message; render(); } } });
    }
    return new Promise((resolve, reject) => {
      const currentWorker = new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module' }); worker = currentWorker;
      let timer, settled = false;
      const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); currentWorker.terminate(); if (worker === currentWorker) worker = null; cancelJob = null; error ? reject(error) : resolve(result); };
      cancelJob = () => finish(new DOMException('处理已取消', 'AbortError'));
      const armTimer = () => { clearTimeout(timer); timer = setTimeout(() => finish(new Error('处理耗时过长，请缩小图片尺寸后重试。')), 120_000); };
      currentWorker.onmessage = ({ data }) => {
        if (data.id !== id) return;
        if (data.progress) { item.status = data.progress; render(); armTimer(); }
        else finish(data.error ? new Error(data.error) : null, data.result);
      };
      currentWorker.onerror = () => finish(new Error('图片处理线程启动失败，请刷新页面重试。'));
      armTimer(); currentWorker.postMessage({ id, file: item.file, options });
    });
  }
  async function run() {
    if (running || !items.length) return;
    error(); running = true; const id = ++version; abort = new AbortController();
    const options = { profile: $('image-profile').value, format: $('image-format').value, maxEdge: Number($('image-max-edge').value), background: $('image-background').value };
    for (const item of items) { clearResult(item); item.failed = false; item.status = '等待处理'; }
    render();
    for (const item of items) {
      if (id !== version) break;
      try {
        item.status = '正在读取'; render(); const result = await process(item, options, id);
        if (id !== version) break;
        item.result = result; item.url = URL.createObjectURL(result.blob); item.status = '处理完成';
      } catch (cause) { if (id !== version || cause.name === 'AbortError') break; item.failed = true; item.status = cause.message; }
      render();
    }
    if (id !== version) { for (const item of items) if (!item.result && !item.failed) item.status = '已停止，可重新开始'; }
    running = false; abort = null; render();
    $('image-summary-note').textContent += id === version ? ' · 本批次处理结束' : ' · 已停止';
  }
  function addFiles(files) {
    if (running) { error('请等待当前批次结束，或先停止后再添加图片。'); return; }
    error();
    const incoming = Array.from(files);
    if (items.length + incoming.length > 20) { error('每批最多 20 张图片，请先移除部分图片。'); return; }
    if (incoming.reduce((sum, file) => sum + file.size, 0) + items.reduce((sum, item) => sum + item.file.size, 0) > 100 * 1024 * 1024) { error('本批次原图总大小不能超过 100 MB。'); return; }
    const rejected = [];
    for (const file of incoming) {
      if (!/\.(jpe?g|png|webp|avif)$/i.test(file.name) || file.size > 20 * 1024 * 1024) { rejected.push(file.name); continue; }
      items.push({ id: ++nextID, file, originalURL: URL.createObjectURL(file), status: '等待处理' });
    }
    render(); if (rejected.length) error(`${rejected.length} 个文件未加入：仅支持静态 JPG / PNG / WebP / AVIF，单张最多 20 MB。`);
  }
  $('image-files').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
  let dragDepth = 0;
  $('image-drop').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('image-drop').classList.add('drag-over'); });
  $('image-drop').addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  $('image-drop').addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('image-drop').classList.remove('drag-over'); } });
  $('image-drop').addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('image-drop').classList.remove('drag-over'); addFiles(event.dataTransfer.files); });
  $('image-run').addEventListener('click', run);
  $('image-stop').addEventListener('click', () => { version++; abort?.abort(); cancelJob?.(); });
  $('image-clear').addEventListener('click', () => { for (const item of items) { clearResult(item); URL.revokeObjectURL(item.originalURL); } items.length = 0; error(); render(); });
  for (const id of controls) $(id).addEventListener('input', () => { render(); if (items.some(item => item.result)) $('image-summary-note').textContent = '设置已更新，点击「重新压缩」应用新设置。'; });
  $('image-zip').addEventListener('click', async () => {
    const ready = items.filter(item => item.result).map(item => ({ ...item.result }));
    if (!ready.length) return;
    const button = $('image-zip'); button.disabled = true;
    try {
      if (ready.reduce((sum, item) => sum + item.blob.size, 0) > 250 * 1024 * 1024) throw new Error('打包内容过大，请使用单张下载。');
      const files = [];
      for (const item of ready) files.push({ name: item.name, data: new Uint8Array(await item.blob.arrayBuffer()) });
      download(new Blob([createZIP(files)], { type: 'application/zip' }), 'sgao-optimized-images.zip'); notify('图片已打包，下载已开始');
    } catch (cause) { error(cause.message); } finally { render(); }
  });
  $('image-compare-slider').addEventListener('input', event => { $('image-compare-output').style.clipPath = `inset(0 ${100 - Number(event.target.value)}% 0 0)`; });
  const closeComparison = () => { $('image-compare-dialog').close(); $('image-compare-original').removeAttribute('src'); $('image-compare-output').removeAttribute('src'); };
  $('image-compare-close').addEventListener('click', closeComparison);
  $('image-compare-dialog').addEventListener('cancel', event => { event.preventDefault(); closeComparison(); });
  $('image-sample').addEventListener('click', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 1200, 800);
    gradient.addColorStop(0, '#f6cba1'); gradient.addColorStop(.5, '#e79268'); gradient.addColorStop(1, '#455c54'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 800);
    let seed = 23;
    for (let i = 0; i < 15000; i++) { seed = Math.imul(seed, 1664525) + 1013904223 | 0; const x = (seed >>> 0) % 1200; seed = Math.imul(seed, 1664525) + 1013904223 | 0; const y = (seed >>> 0) % 800; ctx.fillStyle = `rgba(255,255,255,${.02 + (i % 4) * .01})`; ctx.fillRect(x, y, 3, 3); }
    ctx.fillStyle = '#2c4643'; ctx.beginPath(); ctx.moveTo(0, 720); ctx.bezierCurveTo(250, 400, 400, 650, 620, 450); ctx.bezierCurveTo(860, 250, 1000, 700, 1200, 350); ctx.lineTo(1200, 800); ctx.lineTo(0, 800); ctx.fill();
    ctx.fillStyle = '#fff8e5'; ctx.beginPath(); ctx.arc(940, 195, 65, 0, Math.PI * 2); ctx.fill();
    ctx.font = '600 56px system-ui'; ctx.fillText('A LITTLE LIGHTER.', 70, 115); ctx.font = '24px system-ui'; ctx.fillText('SGAO IMAGE TOOLS / 1200 × 800', 74, 165);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (blob && !running) { addFiles([new File([blob], 'sgao-landscape.png', { type: 'image/png' })]); }
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) { version++; abort?.abort(); cancelJob?.(); for (const item of items) { clearResult(item); URL.revokeObjectURL(item.originalURL); } } });
  render();
}
