import { REGEX_SAMPLES, regexSelections, regexBlob, regexFilename, readRegexFile, wellFormed } from './lib/regex.js';
import { runRegex } from './regex-task.js';
import { sendTextToTable } from './text-transfer.js';

export function initRegex({ notify }) {
  const $ = id => document.getElementById(id);
  let match = null, output = null, snapshot = '', revision = 0, matchRevision = -1, outputSignature = '', page = 0, selected = -1;
  let busy = false, operation = 0, controller, timer, disposed = false, filename = 'text', downloadURL, transfer, transferVersion = 0, transferring = false;
  const options = () => ({ selection: $('rx-selection').value, protect: $('rx-protect').checked });
  const signature = () => JSON.stringify(options());
  const validMatch = () => !!match && matchRevision === revision;
  const validOutput = () => validMatch() && !!output && outputSignature === signature();
  const mode = () => $('rx-mode-replace').getAttribute('aria-pressed') === 'true' ? 'replace' : 'extract';
  const format = () => mode() === 'replace' ? 'txt' : $('rx-format').value;
  const value = () => mode() === 'replace' ? match?.replacement : output?.[format()];
  const outputError = () => mode() === 'replace' ? match?.replacementError || (typeof match?.replacement === 'string' && !wellFormed(match.replacement) ? '替换结果切开了 Unicode 字符，请开启 u / v 或调整表达式后导出。' : '') : output?.errors[format()] || '';
  const message = (id, text = '') => { $(id).textContent = text; $(id).hidden = !text; };
  function stopTransfer() { transfer?.abort(); transfer = null; transferVersion++; transferring = false; }
  function releaseDownload() { if (downloadURL) URL.revokeObjectURL(downloadURL); downloadURL = null; $('rx-download').removeAttribute('href'); $('rx-download').removeAttribute('download'); }
  function cancel() { clearTimeout(timer); controller?.abort(); controller = null; operation++; busy = false; }
  function update() {
    const ready = validOutput(), available = ready && typeof value() === 'string' && !outputError();
    $('rx-stop').hidden = !busy; $('rx-run').disabled = busy;
    $('rx-copy').disabled = busy || !available;
    $('rx-download').setAttribute('aria-disabled', String(busy || !available)); $('rx-download').tabIndex = busy || !available ? -1 : 0;
    if (busy || !available) $('rx-download').removeAttribute('href'); else if (!downloadURL) $('rx-download').href = '#';
    $('rx-table').disabled = busy || transferring || !ready || !output.tableCompatible || mode() !== 'extract';
    $('rx-table').title = output?.tableError || '在新标签页把当前提取字段转为表格';
    $('rx-selection').disabled = !validMatch() || busy;
    $('rx-input-meta').textContent = `${$('rx-input').value.length.toLocaleString()} / 500,000 单元`;
    message('rx-stale', match && !ready ? '输入或设置已变化，下方保留旧结果。更新成功后才能复制、下载或传递。' : '');
    $('rx-result-state').textContent = busy ? '正在处理…' : ready ? `${match.matches.length.toLocaleString()} 条匹配` : match ? '旧结果，待更新' : '等待测试';
    $('rx-prev').disabled = busy || !match || page === 0;
    $('rx-next').disabled = busy || !match || (page + 1) * 20 >= match.matches.length;
    for (const button of document.querySelectorAll('[data-rx-flag]')) button.setAttribute('aria-pressed', String($('rx-flags').value.includes(button.dataset.rxFlag)));
  }
  function renderOutput() {
    const replacing = mode() === 'replace', content = value();
    $('rx-extract-settings').hidden = replacing; $('rx-replacement-settings').hidden = !replacing; $('rx-table').hidden = replacing;
    $('rx-output-label').textContent = replacing ? '替换后的完整文本' : `${format().toUpperCase()} 提取结果`;
    $('rx-output').value = typeof content === 'string' ? content : '';
    $('rx-output-meta').textContent = typeof content === 'string' ? `${content.length.toLocaleString()} 单元 · 完整结果` : '尚无可导出的结果';
    $('rx-download').textContent = `下载 ${format().toUpperCase()}`;
    message('rx-output-error', outputError());
    $('rx-export-note').textContent = replacing ? '只替换实际命中的内容；未开启 g 时只替换第一处。原始文本保留在上方。' :
      `TXT 按匹配顺序输出；全部分组用 Tab 分隔，内容中的换行保留。JSON 区分空字符串和未参与匹配的 null；CSV 用空值表示 null。${output?.protectedCells ? `CSV 已为 ${output.protectedCells} 个值添加前置单引号。` : ''}`;
  }
  function renderHighlight() {
    const pre = $('rx-highlight'); pre.replaceChildren(); pre.scrollTop = 0;
    if (!match) { pre.textContent = '运行表达式后，在这里查看高亮。空匹配显示为竖线，原文不会被修改。'; $('rx-highlight-meta').textContent = '原文只读预览'; return; }
    const focus = match.matches[selected], start = focus ? Math.max(0, focus.start - 2000) : 0, end = Math.min(snapshot.length, start + 20_000);
    let cursor = start;
    for (const [index, item] of match.matches.entries()) {
      if (item.end < start || item.start > end) continue;
      const left = Math.max(start, item.start), right = Math.min(end, item.end);
      if (left > cursor) pre.append(document.createTextNode(snapshot.slice(cursor, left)));
      const mark = document.createElement('mark'); mark.className = `${item.start === item.end ? 'rx-zero' : ''}${index === selected ? ' rx-selected' : ''}`;
      mark.textContent = item.start === item.end ? '│' : snapshot.slice(left, right); mark.title = `#${index + 1} · [${item.start}, ${item.end})`;
      pre.append(mark); cursor = right;
    }
    if (cursor < end) pre.append(document.createTextNode(snapshot.slice(cursor, end)));
    if (!snapshot.length && !match.matches.length) pre.textContent = '（原文为空，没有匹配）';
    $('rx-highlight-meta').textContent = `显示 [${start}, ${end}) / ${snapshot.length.toLocaleString()} 单元${end < snapshot.length || start > 0 ? ' · 点击下方匹配可定位' : ''}`;
  }
  function renderMatches() {
    const list = $('rx-matches'); list.replaceChildren();
    const total = match?.matches.length || 0;
    $('rx-page').textContent = total ? `${page * 20 + 1}–${Math.min(total, (page + 1) * 20)} / ${total.toLocaleString()} 条` : '0 条匹配';
    if (!total) { const p = document.createElement('p'); p.className = 'rx-empty'; p.textContent = match ? '没有匹配到内容。检查表达式、大小写、换行标记，以及 y 是否限制了起始位置。' : '匹配详情会出现在这里。'; list.append(p); return; }
    match.matches.slice(page * 20, page * 20 + 20).forEach((item, local) => {
      const index = page * 20 + local, card = document.createElement('div'); card.className = 'rx-match';
      const header = document.createElement('div'); header.className = 'rx-match-heading';
      const title = document.createElement('strong'); title.textContent = `#${index + 1} · [${item.start}, ${item.end}) · 第 ${item.line} 行，第 ${item.column} 列`;
      const locate = document.createElement('button'); locate.type = 'button'; locate.className = 'text-button'; locate.textContent = '定位高亮'; locate.setAttribute('aria-label', `定位第 ${index + 1} 条匹配`);
      locate.addEventListener('click', () => { selected = index; renderHighlight(); $('rx-highlight').focus({ preventScroll: true }); $('rx-highlight').querySelector('.rx-selected')?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); });
      header.append(title, locate); card.append(header);
      const code = document.createElement('pre'); code.className = 'rx-match-text'; code.textContent = item.text === '' ? '（空匹配）' : item.text.slice(0, 500) + (item.text.length > 500 ? '…（预览省略，导出完整）' : ''); card.append(code);
      if (item.groups.length) {
        const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = `${item.groups.length} 个捕获分组${item.named.length ? ` · ${item.named.length} 个命名分组` : ''}`; details.append(summary);
        for (const [name, value, range] of [...item.groups.map((value, i) => [`$${i + 1}`, value, item.ranges?.[i + 1]]), ...item.named.map(([name, value]) => [`<${name}>`, value, undefined])]) {
          const row = document.createElement('div'); row.className = 'rx-group'; const label = document.createElement('strong'), text = document.createElement('code'); label.textContent = `${name}${range ? ` [${range[0]}, ${range[1]})` : ''}`;
          text.textContent = value === null ? '（未参与匹配 · null）' : value === '' ? '（空字符串）' : value.slice(0, 500) + (value.length > 500 ? '…' : ''); row.append(label, text); details.append(row);
        }
        card.append(details);
      }
      list.append(card);
    });
  }
  function fillSelections(selection) {
    $('rx-selection').replaceChildren(...regexSelections(match).map(item => { const option = document.createElement('option'); option.value = item.value; option.textContent = item.label; return option; }));
    $('rx-selection').value = selection;
  }
  async function process(action = 'match') {
    if (disposed || action === 'export' && !validMatch()) return;
    stopTransfer(); cancel(); const ticket = operation, version = revision, abort = new AbortController(), request = { text: $('rx-input').value, pattern: $('rx-pattern').value, flags: $('rx-flags').value, replacement: $('rx-replacement').value };
    controller = abort; busy = true; releaseDownload(); message('rx-error'); $('rx-status').textContent = action === 'match' ? '正在本地匹配与生成预览…' : '正在更新提取字段与导出…'; update();
    try {
      const processed = await runRegex(action === 'match' ? { action, request, options: options() } : { action, match, options: options() }, { signal: abort.signal });
      if (disposed || ticket !== operation || version !== revision || abort.signal.aborted) return;
      if (action === 'match') { match = processed.match; snapshot = request.text; matchRevision = revision; page = 0; selected = -1; fillSelections(processed.output.selection); renderMatches(); renderHighlight(); }
      output = processed.output; outputSignature = signature(); renderOutput();
      $('rx-status').textContent = `已完成 ${match.matches.length.toLocaleString()} 条匹配${match.flags.includes('g') ? '' : '（未开启 g，只检查第一处）'}。位置为从 0 开始的 UTF-16 索引，结束位置不包含在范围内。`;
    } catch (error) {
      if (!disposed && ticket === operation && error.name !== 'AbortError') { message('rx-error', error.message); $('rx-status').textContent = '本次未完成，原文与旧结果保留。'; if (error.name === 'TimeoutError') { $('rx-live').checked = false; $('rx-status').textContent += ' 已关闭实时测试，修改后可手动重试。'; } }
    } finally { if (!disposed && ticket === operation) { busy = false; controller = null; update(); } }
  }
  function changed() {
    stopTransfer(); cancel(); revision++; releaseDownload(); message('rx-error'); $('rx-sample-note').textContent = '';
    $('rx-status').textContent = $('rx-live').checked ? '等待输入完成后更新…' : '输入已变化，点击「测试表达式」。'; update();
    if ($('rx-live').checked && $('rx-pattern').value.length) timer = setTimeout(() => process(), 400);
    else if ($('rx-live').checked) $('rx-status').textContent = '填写表达式后自动测试；测试空表达式时，请手动点击「测试表达式」。';
  }
  function exportChanged() {
    stopTransfer(); cancel(); releaseDownload(); message('rx-error'); update(); if (validMatch()) timer = setTimeout(() => process('export'), 160);
  }
  async function load(file) {
    if (!file) return; stopTransfer(); cancel(); const ticket = operation, abort = new AbortController(); controller = abort; busy = true; message('rx-error'); $('rx-status').textContent = '正在读取本地 UTF-8 文件…'; update();
    try {
      const text = await readRegexFile(file, { signal: abort.signal }); if (disposed || ticket !== operation || abort.signal.aborted) return;
      $('rx-input').value = text; filename = file.name; changed(); $('rx-status').textContent = `已导入 ${file.name}，换行按编辑框统一为 LF。${$('rx-live').checked ? '准备更新匹配。' : '点击「测试表达式」。'}`;
    } catch (error) { if (!disposed && ticket === operation && error.name !== 'AbortError') { message('rx-error', error.message); $('rx-status').textContent = '文件未导入，已有原文与结果保留。'; } }
    finally { if (!disposed && ticket === operation) { busy = false; controller = null; update(); } }
  }
  function clear() {
    stopTransfer(); cancel(); releaseDownload(); revision++; matchRevision = -1; match = output = null; snapshot = ''; page = 0; selected = -1; filename = 'text';
    for (const id of ['rx-pattern', 'rx-input', 'rx-replacement', 'rx-file']) $(id).value = '';
    $('rx-flags').value = 'gu'; $('rx-live').checked = $('rx-protect').checked = true; $('rx-format').value = 'txt';
    $('rx-mode-extract').setAttribute('aria-pressed', 'true'); $('rx-mode-replace').setAttribute('aria-pressed', 'false');
    $('rx-selection').replaceChildren(); const option = document.createElement('option'); option.value = 'match'; option.textContent = '完整匹配'; $('rx-selection').append(option);
    message('rx-error'); $('rx-sample-note').textContent = ''; $('rx-status').textContent = '表达式、原文与结果已清空；内容未上传或保存。'; renderMatches(); renderHighlight(); renderOutput(); update();
  }
  $('rx-run').addEventListener('click', () => process()); $('rx-stop').addEventListener('click', () => { cancel(); $('rx-status').textContent = '处理已停止，原文与旧结果保留。'; update(); });
  $('rx-clear').addEventListener('click', clear);
  for (const id of ['rx-pattern', 'rx-flags', 'rx-input', 'rx-replacement']) $(id).addEventListener('input', changed);
  $('rx-live').addEventListener('change', () => { if ($('rx-live').checked) { if ($('rx-pattern').value.length) process(); } else { cancel(); $('rx-status').textContent = '已关闭实时测试，点击「测试表达式」手动更新。'; update(); } });
  for (const button of document.querySelectorAll('[data-rx-flag]')) button.addEventListener('click', () => { const flag = button.dataset.rxFlag; $('rx-flags').value = $('rx-flags').value.includes(flag) ? $('rx-flags').value.replaceAll(flag, '') : $('rx-flags').value + flag; changed(); });
  $('view-regex').addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); process(); } });
  REGEX_SAMPLES.forEach((sample, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = sample.name; $('rx-sample-select').append(option); });
  $('rx-sample').addEventListener('click', () => { const sample = REGEX_SAMPLES[Number($('rx-sample-select').value)]; $('rx-pattern').value = sample.pattern; $('rx-flags').value = sample.flags; $('rx-input').value = sample.text; $('rx-replacement').value = sample.replacement; filename = 'sample'; changed(); $('rx-sample-note').textContent = sample.note; process(); });
  $('rx-file').addEventListener('change', event => { load(event.target.files[0]); event.target.value = ''; });
  $('view-regex').addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  $('view-regex').addEventListener('drop', event => { if (!event.dataTransfer?.files.length) return; event.preventDefault(); if (event.dataTransfer.files.length !== 1) message('rx-error', '请一次导入一份 UTF-8 文本文件。'); else load(event.dataTransfer.files[0]); });
  $('rx-selection').addEventListener('change', exportChanged); $('rx-protect').addEventListener('change', exportChanged);
  $('rx-format').addEventListener('change', () => { releaseDownload(); renderOutput(); update(); });
  for (const id of ['rx-mode-extract', 'rx-mode-replace']) $(id).addEventListener('click', () => { for (const tab of ['rx-mode-extract', 'rx-mode-replace']) $(tab).setAttribute('aria-pressed', String(tab === id)); releaseDownload(); renderOutput(); update(); });
  $('rx-prev').addEventListener('click', () => { page--; renderMatches(); update(); }); $('rx-next').addEventListener('click', () => { page++; renderMatches(); update(); });
  $('rx-copy').addEventListener('click', async () => { if (!validOutput() || busy || typeof value() !== 'string' || outputError()) return; try { await navigator.clipboard.writeText(value()); notify('完整结果已复制'); } catch { message('rx-error', '无法访问剪贴板，请手动选择结果复制。'); } });
  $('rx-download').addEventListener('click', event => {
    try { if (!validOutput() || busy || typeof value() !== 'string' || outputError()) { event.preventDefault(); return; } releaseDownload(); downloadURL = URL.createObjectURL(regexBlob(value(), format())); $('rx-download').href = downloadURL; $('rx-download').download = regexFilename(filename, format(), mode() === 'replace'); }
    catch (error) { event.preventDefault(); message('rx-error', error.message); }
  });
  $('rx-table').addEventListener('click', async () => {
    if (busy || transferring || !validOutput() || !output.tableCompatible || mode() !== 'extract') return;
    const ticket = ++transferVersion, abort = new AbortController(); transfer = abort; transferring = true; update();
    try { await sendTextToTable(output.json, regexFilename(filename, 'json'), { signal: abort.signal }); if (!disposed && ticket === transferVersion) notify('提取结果已送至表格工具'); }
    catch (error) { if (!disposed && ticket === transferVersion && error.name !== 'AbortError') message('rx-error', error.message); }
    finally { if (!disposed && ticket === transferVersion) { transferring = false; transfer = null; update(); } }
  });
  window.addEventListener('pagehide', event => { stopTransfer(); cancel(); releaseDownload(); if (!event.persisted) { disposed = true; match = output = null; snapshot = ''; $('rx-input').value = $('rx-output').value = $('rx-pattern').value = $('rx-replacement').value = ''; $('rx-highlight').replaceChildren(); $('rx-matches').replaceChildren(); } });
  window.addEventListener('pageshow', event => { if (event.persisted) update(); });
  renderMatches(); renderHighlight(); renderOutput(); update();
}
