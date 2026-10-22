import { formatJSON } from './lib/json.js';
import { parseTimestamp, formatDateTime, dateToTimestamp } from './lib/time.js';
import { transformURL } from './lib/url.js';

const $ = id => document.getElementById(id);
const on = (id, event, handler) => $(id).addEventListener(event, handler);
const tools = {
  json: ['JSON 格式化', '把复杂的数据，整理成清晰的结构。', '01'],
  timestamp: ['时间戳转换', '在一串数字和某个瞬间之间，轻松往返。', '02'],
  url: ['URL 编解码', '处理地址和参数，让每个字符准确传达。', '03'],
  diff: ['文本对比', '并排放下两个版本，让每一处变化浮现。', '04'],
};
let currentTool = 'json';
let clockTimer;
function navigate() {
  const key = location.hash.slice(1);
  const tool = Object.hasOwn(tools, key) ? key : 'json';
  currentTool = tool;
  for (const name of Object.keys(tools)) $(`view-${name}`).hidden = name !== tool;
  document.querySelectorAll('[data-tool]').forEach(link => {
    const active = link.dataset.tool === tool;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const [title, description, number] = tools[tool];
  $('breadcrumb-current').textContent = title;
  $('page-title').replaceChildren(document.createTextNode(title));
  const dot = document.createElement('span'); dot.className = 'title-dot'; dot.textContent = '.';
  $('page-title').append(dot);
  $('page-description').textContent = description;
  $('tool-number').textContent = `/ ${number}`;
  document.title = `${title} · SGAO 工具箱`;
  clearInterval(clockTimer);
  if (tool === 'timestamp') { updateClock(); clockTimer = setInterval(updateClock, 1000); }
}
window.addEventListener('hashchange', navigate);
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault(); $('main').focus(); $('main').scrollIntoView({ block: 'start' });
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  $('theme-toggle').setAttribute('aria-label', `切换到${dark ? '浅' : '深'}色模式`);
  $('theme-toggle').querySelector('use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#15171c' : '#f5f3ee';
}
let savedTheme;
try { savedTheme = localStorage.getItem('sgao.tools.theme'); } catch { /* Optional preference storage. */ }
const darkMode = matchMedia('(prefers-color-scheme: dark)');
applyTheme(['light', 'dark'].includes(savedTheme) ? savedTheme : darkMode.matches ? 'dark' : 'light');
darkMode.addEventListener('change', event => { if (!savedTheme) applyTheme(event.matches ? 'dark' : 'light'); });
on('theme-toggle', 'click', () => {
  savedTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(savedTheme);
  try { localStorage.setItem('sgao.tools.theme', savedTheme); } catch { /* Theme still works for this page. */ }
});

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
}
function showError(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch {
    toast('无法访问剪贴板，请选中结果后手动复制。');
  }
}
function charCount(value) { return `${value.length.toLocaleString('zh-CN')} 字符`; }
function lineCount(value) { return value === '' ? 0 : value.split('\n').length; }
function setLineNumbers(id, value) { $(id).textContent = Array.from({ length: Math.max(1, lineCount(value)) }, (_, i) => i + 1).join('\n'); }

// JSON: inputs stay in memory. Results never pass through innerHTML.
let jsonResult = '';
let jsonOperation = 'format';
const jsonSample = '{"name":"SGAO 工具箱","version":"1.0.0","description":"让日常开发，顺手一点","tools":["JSON 格式化","时间戳转换","URL 编解码","文本对比"],"settings":{"localOnly":true,"needLogin":false},"id":9007199254740993}';
function highlightJSON(value) {
  const output = $('json-output'); output.replaceChildren(); output.classList.remove('placeholder');
  if (value.length > 200_000) { output.textContent = value; return; }
  const pattern = /("(?:\\[\s\S]|[^"\\])*"\s*:)|("(?:\\[\s\S]|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  let end = 0;
  const fragment = document.createDocumentFragment();
  for (const match of value.matchAll(pattern)) {
    fragment.append(document.createTextNode(value.slice(end, match.index)));
    const span = document.createElement('span');
    span.className = match[1] ? 'syntax-key' : match[2] ? 'syntax-string' : match[3] ? 'syntax-number' : 'syntax-literal';
    span.textContent = match[0]; fragment.append(span); end = match.index + match[0].length;
  }
  fragment.append(document.createTextNode(value.slice(end))); output.append(fragment);
}
function clearJSONOutput() {
  jsonResult = '';
  $('json-output').classList.add('placeholder');
  $('json-output').textContent = '整理后的 JSON 会出现在这里';
  $('json-output-status').textContent = $('json-input').value ? '输入已变更，请重新处理' : '等待输入';
  $('json-output-count').textContent = '0 字符';
  $('json-copy').disabled = $('json-download').disabled = true;
  setLineNumbers('json-output-lines', ''); showError('json-error');
}
function updateJSONInput() {
  $('json-input-count').textContent = charCount($('json-input').value);
  setLineNumbers('json-input-lines', $('json-input').value);
  clearJSONOutput();
}
function runJSON(compact = false) {
  showError('json-error');
  try {
    jsonResult = formatJSON($('json-input').value, { compact, indent: $('json-indent').value, sortKeys: $('json-sort').checked });
    jsonOperation = compact ? 'minify' : 'format';
    highlightJSON(jsonResult); setLineNumbers('json-output-lines', jsonResult);
    $('json-output-scroll').scrollTop = $('json-output-scroll').scrollLeft = 0;
    $('json-output-count').textContent = charCount(jsonResult);
    $('json-output-status').textContent = compact ? '✓ 已压缩 · JSON 有效' : '✓ 已格式化 · JSON 有效';
    $('json-copy').disabled = $('json-download').disabled = false;
  } catch (error) { clearJSONOutput(); $('json-output-status').textContent = '格式校验失败'; showError('json-error', error.message); }
}
on('json-input', 'input', updateJSONInput);
on('json-input', 'scroll', () => { $('json-input-lines').scrollTop = $('json-input').scrollTop; });
on('json-format', 'click', () => runJSON());
on('json-minify', 'click', () => runJSON(true));
for (const id of ['json-indent', 'json-sort']) on(id, 'change', () => { if (jsonResult) runJSON(jsonOperation === 'minify'); });
on('json-clear', 'click', () => { $('json-input').value = ''; updateJSONInput(); $('json-input').focus(); });
on('json-sample', 'click', () => { $('json-input').value = jsonSample; updateJSONInput(); runJSON(); });
on('json-copy', 'click', () => { if (jsonResult) copy(jsonResult); });
on('json-download', 'click', () => {
  if (!jsonResult) return;
  const url = URL.createObjectURL(new Blob([jsonResult], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'sgao-formatted.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
$('shortcut-key').textContent = isMac ? '⌘' : 'Ctrl';
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && currentTool === 'json') { event.preventDefault(); runJSON(); }
});

// Timestamp conversion: fixed UTC+08:00, UTC, or the user's machine time zone.
function updateClock() {
  const now = Date.now();
  $('live-time').textContent = formatDateTime(now);
  $('live-seconds').textContent = Math.floor(now / 1000);
  $('live-ms').textContent = now;
}
on('copy-live-seconds', 'click', () => copy(String(Math.floor(Date.now() / 1000))));
on('copy-live-ms', 'click', () => copy(String(Date.now())));
function createResults(id, entries) {
  $(id).replaceChildren();
  for (const [label, value] of entries) {
    const row = document.createElement('div'); row.className = 'result-row';
    const content = document.createElement('div');
    const name = document.createElement('span'); name.textContent = label;
    const text = document.createElement('strong'); text.textContent = value;
    const button = document.createElement('button'); button.className = 'icon-button'; button.title = `复制${label}`; button.setAttribute('aria-label', button.title);
    button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg>';
    button.addEventListener('click', () => copy(String(value)));
    content.append(name, text); row.append(content, button); $(id).append(row);
  }
}
const zoneLabels = { beijing: '北京时间 · UTC+08:00', utc: '协调世界时 · UTC', local: `本机时间 · ${Intl.DateTimeFormat().resolvedOptions().timeZone}` };
function runTimestamp() {
  showError('timestamp-error');
  try {
    const { milliseconds, unit } = parseTimestamp($('timestamp-input').value, $('timestamp-unit').value);
    const zone = $('time-zone').value;
    createResults('timestamp-results', [[zoneLabels[zone], formatDateTime(milliseconds, zone)], ['ISO 8601 · UTC', new Date(milliseconds).toISOString()], [`Unix 毫秒 · 输入按${unit === 'seconds' ? '秒' : '毫秒'}解析`, milliseconds]]);
  } catch (error) { $('timestamp-results').replaceChildren(); showError('timestamp-error', error.message); }
}
function runDate() {
  showError('date-error');
  try {
    const milliseconds = dateToTimestamp($('date-input').value, $('time-zone').value);
    createResults('date-results', [['Unix 时间戳 · 秒', milliseconds / 1000], ['Unix 时间戳 · 毫秒', milliseconds], ['ISO 8601 · UTC', new Date(milliseconds).toISOString()]]);
  } catch (error) { $('date-results').replaceChildren(); showError('date-error', error.message); }
}
on('timestamp-convert', 'click', runTimestamp);
on('date-convert', 'click', runDate);
on('timestamp-input', 'keydown', event => { if (event.key === 'Enter') runTimestamp(); });
on('date-input', 'keydown', event => { if (event.key === 'Enter') runDate(); });
on('timestamp-input', 'input', () => { $('timestamp-results').replaceChildren(); showError('timestamp-error'); });
on('date-input', 'input', () => { $('date-results').replaceChildren(); showError('date-error'); });
on('timestamp-unit', 'change', () => { if ($('timestamp-input').value.trim()) runTimestamp(); });
on('time-zone', 'change', () => {
  if ($('timestamp-input').value.trim()) runTimestamp();
  if ($('date-input').value) runDate();
});
on('time-now', 'click', () => {
  const now = Date.now(); $('timestamp-input').value = Math.floor(now / 1000); $('timestamp-unit').value = 'seconds';
  $('date-input').value = formatDateTime(now, $('time-zone').value, 'T'); runTimestamp(); runDate();
});

// URL encoding and decoding.
const urlNotes = {
  component: 'URL 参数模式会编码 : / ? & = 等保留字符，适合单独处理查询参数的值。',
  uri: '完整 URL 模式保留 : / ? & = # 等地址结构字符。解码时也会保留这些字符的百分号编码。',
  form: '表单模式遵循 application/x-www-form-urlencoded：空格编码为 +，原始 + 编码为 %2B。请单独处理一个参数值。',
};
function resetURL() {
  $('url-output').value = ''; $('url-output-count').textContent = '0 字符';
  $('url-input-count').textContent = charCount($('url-input').value);
  $('url-status').textContent = '等待处理'; $('url-copy').disabled = $('url-swap').disabled = true;
  showError('url-error');
}
function runURL(operation) {
  resetURL();
  try {
    const result = transformURL($('url-input').value, operation, $('url-mode').value);
    $('url-output').value = result; $('url-output-count').textContent = charCount(result);
    $('url-status').textContent = operation === 'encode' ? '✓ 已编码' : '✓ 已解码';
    $('url-copy').disabled = $('url-swap').disabled = false;
  } catch (error) { showError('url-error', error.message); }
}
on('url-input', 'input', resetURL);
on('url-mode', 'change', () => { $('url-mode-note').textContent = urlNotes[$('url-mode').value]; resetURL(); });
on('url-encode', 'click', () => runURL('encode'));
on('url-decode', 'click', () => runURL('decode'));
on('url-copy', 'click', () => copy($('url-output').value));
on('url-sample', 'click', () => { $('url-input').value = $('url-mode').value === 'uri' ? 'https://sgao.cc/search?q=你好 世界&from=工具箱' : '你好 世界 / Hello, SGAO!'; resetURL(); runURL('encode'); });
on('url-clear', 'click', () => { $('url-input').value = ''; resetURL(); $('url-input').focus(); });
on('url-swap', 'click', () => { $('url-input').value = $('url-output').value; resetURL(); $('url-input').focus(); });

// Diff work runs off the main thread. Replacing the worker cancels stale work.
let diffWorker;
let diffVersion = 0;
let diffResult = null;
let diffTimeout;
function stopDiff() {
  clearTimeout(diffTimeout); diffWorker?.terminate(); diffWorker = null;
  $('diff-compare').disabled = false;
}
function emptyDiff(message = '在上方放入两个版本，点击「开始对比」。') {
  diffResult = null; $('diff-summary').replaceChildren();
  $('diff-results').innerHTML = '<div class="diff-empty"><svg class="icon"><use href="#i-diff"/></svg><strong>每一处变化，都有迹可循</strong><span></span></div>';
  $('diff-results').querySelector('span').textContent = message;
}
function updateDiffInput() {
  stopDiff(); diffVersion++;
  $('diff-before-count').textContent = `${lineCount($('diff-before').value).toLocaleString('zh-CN')} 行`;
  $('diff-after-count').textContent = `${lineCount($('diff-after').value).toLocaleString('zh-CN')} 行`;
  emptyDiff('文本或选项已变更，点击「开始对比」查看结果。'); showError('diff-error');
}
function renderDiff() {
  if (!diffResult) return;
  const { rows, added, removed, approximate } = diffResult;
  $('diff-summary').replaceChildren();
  for (const [className, text] of [['diff-added', `+${added} 新增`], ['diff-removed', `−${removed} 删除`]]) {
    const span = document.createElement('span'); span.className = className; span.textContent = text; $('diff-summary').append(span);
  }
  $('diff-results').replaceChildren();
  function note(text) { const p = document.createElement('p'); p.className = 'diff-result-note'; p.textContent = text; $('diff-results').append(p); }
  if (approximate) note('差异较多，超出精细对比范围；中间变化区域按整段展示。');
  if (!added && !removed) note($('diff-case').checked || $('diff-whitespace').checked ? '✓ 在当前忽略选项下，两侧文本相同。' : '✓ 两侧文本完全相同。');
  const table = document.createElement('table'); table.className = 'diff-table'; table.setAttribute('aria-label', '逐行文本差异：原行号、新行号、变更类型、文本');
  const body = document.createElement('tbody');
  const visible = $('diff-only-changes').checked ? rows.filter(row => row.type !== 'equal') : rows;
  // Keep DOM work bounded, even when there are thousands of short lines.
  const displayed = visible.slice(0, 3000);
  for (const row of displayed) {
    const tr = document.createElement('tr'); tr.className = row.type;
    const values = [['line-no', row.oldLine ?? ''], ['line-no', row.newLine ?? ''], ['diff-sign', row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '], ['diff-text', row.text]];
    for (const [className, value] of values) { const td = document.createElement('td'); td.className = className; td.textContent = value; tr.append(td); }
    body.append(tr);
  }
  table.append(body); $('diff-results').append(table);
  if (visible.length > displayed.length) note(`共 ${visible.length.toLocaleString('zh-CN')} 行，显示前 3,000 行。可开启「仅看差异」或缩小输入范围。`);
}
function runDiff() {
  stopDiff(); showError('diff-error');
  if (!$('diff-before').value && !$('diff-after').value) { showError('diff-error', '请至少在一侧输入文本。'); return; }
  const id = ++diffVersion;
  try {
    diffWorker = new Worker(new URL('./diff-worker.js', import.meta.url), { type: 'module' });
    $('diff-compare').disabled = true; $('diff-summary').textContent = '正在对比…';
    diffWorker.onmessage = ({ data }) => {
      if (data.id !== diffVersion) return;
      stopDiff();
      if (data.error) { emptyDiff('请调整输入后重试。'); showError('diff-error', data.error); return; }
      diffResult = data.result; renderDiff();
    };
    diffWorker.onerror = () => { stopDiff(); emptyDiff(); showError('diff-error', '对比线程加载失败，请刷新页面后重试。'); };
    diffTimeout = setTimeout(() => { stopDiff(); emptyDiff(); showError('diff-error', '对比耗时过长，请缩小输入范围后重试。'); }, 15_000);
    diffWorker.postMessage({ id, before: $('diff-before').value, after: $('diff-after').value, options: { ignoreWhitespace: $('diff-whitespace').checked, ignoreCase: $('diff-case').checked } });
  } catch { stopDiff(); showError('diff-error', '当前浏览器无法启动对比线程，请使用较新版本的浏览器。'); }
}
for (const id of ['diff-before', 'diff-after']) on(id, 'input', updateDiffInput);
for (const id of ['diff-whitespace', 'diff-case']) on(id, 'change', updateDiffInput);
on('diff-only-changes', 'change', renderDiff);
on('diff-compare', 'click', runDiff);
on('diff-clear', 'click', () => { $('diff-before').value = $('diff-after').value = ''; updateDiffInput(); $('diff-before').focus(); });
on('diff-swap', 'click', () => { const before = $('diff-before').value; $('diff-before').value = $('diff-after').value; $('diff-after').value = before; updateDiffInput(); });
on('diff-sample', 'click', () => {
  $('diff-before').value = '{\n  "name": "SGAO Tools",\n  "version": "0.9.0",\n  "tools": ["JSON", "URL"],\n  "localOnly": true\n}';
  $('diff-after').value = '{\n  "name": "SGAO Tools",\n  "version": "1.0.0",\n  "tools": ["JSON", "URL", "Timestamp", "Diff"],\n  "localOnly": true,\n  "needLogin": false\n}';
  updateDiffInput(); runDiff();
});
window.addEventListener('pagehide', () => { clearInterval(clockTimer); stopDiff(); });
window.addEventListener('pageshow', () => { if (currentTool === 'timestamp') { clearInterval(clockTimer); updateClock(); clockTimer = setInterval(updateClock, 1000); } });

$('json-input').value = jsonSample;
updateJSONInput(); runJSON();
$('date-input').value = formatDateTime(Date.now(), 'beijing', 'T');
navigate();
