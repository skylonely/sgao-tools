export const REGEX_LIMITS = Object.freeze({ units: 500_000, fileBytes: 2 * 1024 ** 2, pattern: 2_000, replacement: 10_000, matches: 5_000, groups: 40, cells: 100_000, captured: 2_000_000, output: 2_000_000 });

export function wellFormed(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = text.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function validate(text, limit, label) {
  if (typeof text !== 'string' || text.length > limit) throw new Error(`${label}最高 ${limit.toLocaleString('en-US')} 个 UTF-16 单元。`);
  if (text.includes('\0')) throw new Error(`${label}含 NUL 字符，请使用普通文本或在表达式中写 \\0。`);
  if (!wellFormed(text)) throw new Error(`${label}含孤立 Unicode 代理字符，请修正后重试。`);
  return text;
}
export const validateRegexText = text => validate(text, REGEX_LIMITS.units, '原始文本');
function collector() {
  const chunks = []; let length = 0;
  return { append(text) { length += text.length; if (length > REGEX_LIMITS.output) throw new Error('结果超过 200 万 UTF-16 单元，请减少匹配、分组或替换内容。'); chunks.push(text); }, value: () => chunks.join('') };
}
function advance(text, index, unicode) {
  if (!unicode || index + 1 >= text.length) return index + 1;
  const first = text.charCodeAt(index), next = text.charCodeAt(index + 1);
  return index + (first >= 0xd800 && first <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1);
}
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) { const char = text[i]; if (char === '\r' && text[i + 1] === '\n') i++; if (char === '\r' || char === '\n' || char === '\u2028' || char === '\u2029') starts.push(i + 1); }
  return starts;
}
function position(starts, index) {
  let left = 0, right = starts.length;
  while (left + 1 < right) { const middle = (left + right) >>> 1; if (starts[middle] <= index) left = middle; else right = middle; }
  return { line: left + 1, column: index - starts[left] + 1 };
}

// Implement GetSubstitution over bounded chunks, without allocating an unbounded String.replace result.
function substitute(out, template, match, source) {
  const named = new Map(match.named);
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== '$' || i + 1 === template.length) { out.append(template[i]); continue; }
    const next = template[i + 1];
    if (next === '$') { out.append('$'); i++; }
    else if (next === '&') { out.append(match.text); i++; }
    else if (next === '`') { out.append(source.slice(0, match.start)); i++; }
    else if (next === "'") { out.append(source.slice(match.end)); i++; }
    else if (next === '<' && match.named.length) {
      const end = template.indexOf('>', i + 2);
      if (end < 0) out.append('$'); else { out.append(named.get(template.slice(i + 2, end)) ?? ''); i = end; }
    } else if (/\d/.test(next)) {
      const two = template.slice(i + 1, i + 3), number = /^\d{2}$/.test(two) ? Number(two) : 0;
      if (number > 0 && number <= match.groups.length) { out.append(match.groups[number - 1] ?? ''); i += 2; }
      else if (Number(next) > 0 && Number(next) <= match.groups.length) { out.append(match.groups[Number(next) - 1] ?? ''); i++; }
      else out.append('$');
    } else out.append('$');
  }
}
export function replaceRegexMatches(source, matches, template) {
  validate(template, REGEX_LIMITS.replacement, '替换模板');
  const out = collector(); let cursor = 0;
  for (const match of matches) { out.append(source.slice(cursor, match.start)); substitute(out, template, match, source); cursor = match.end; }
  out.append(source.slice(cursor)); return out.value();
}

export function matchRegex({ text, pattern, flags = 'gu', replacement = '' }) {
  validateRegexText(text); validate(pattern, REGEX_LIMITS.pattern, '表达式'); validate(replacement, REGEX_LIMITS.replacement, '替换模板');
  if (typeof flags !== 'string' || /[^dgimsuvy]/.test(flags) || new Set(flags).size !== flags.length) throw new Error('标记仅支持 d g i m s u v y，且不能重复。');
  if (flags.includes('u') && flags.includes('v')) throw new Error('u 与 v 不能同时启用，请保留其中一个。');
  let regex;
  try { regex = new RegExp(pattern, flags); } catch (error) { throw new Error(`正则表达式或标记无效：${String(error.message).slice(0, 400)}。高级语法支持取决于当前浏览器。`); }
  const matches = [], starts = lineStarts(text); let captured = 0, cells = 0, groupCount = 0, names = [];
  for (;;) {
    const match = regex.exec(text); if (!match) break;
    if (matches.length >= REGEX_LIMITS.matches) throw new Error('匹配超过 5,000 条，请缩小文本或收紧表达式；未返回截断结果。');
    groupCount = match.length - 1; names = Object.keys(match.groups || {});
    if (groupCount > REGEX_LIMITS.groups) throw new Error('捕获分组最高 40 个；无需提取的括号可改用 (?:...)。');
    cells += match.length + names.length;
    if (cells > REGEX_LIMITS.cells) throw new Error('匹配与分组合计超过 10 万个值，请减少匹配或分组。');
    const groups = match.slice(1).map(value => value ?? null), named = names.map(name => [name, match.groups[name] ?? null]);
    captured += match[0].length + groups.reduce((sum, value) => sum + (value?.length || 0), 0) + named.reduce((sum, [, value]) => sum + (value?.length || 0), 0);
    if (captured > REGEX_LIMITS.captured) throw new Error('匹配与分组内容合计超过 200 万单元，请减少捕获分组。');
    matches.push({ text: match[0], start: match.index, end: match.index + match[0].length, ...position(starts, match.index), groups, named,
      ranges: match.indices ? match.indices.map(range => range ? [...range] : null) : null });
    if (!regex.global) break;
    if (match[0] === '') regex.lastIndex = advance(text, regex.lastIndex, regex.unicode || regex.unicodeSets);
  }
  const result = { matches, groupCount, names, flags: regex.flags, sourceLength: text.length, replacement: null, replacementError: '' };
  try { result.replacement = replaceRegexMatches(text, matches, replacement); } catch (error) { result.replacementError = error.message; }
  return result;
}

export function regexSelections(result) {
  return [{ value: 'match', label: '完整匹配' }, ...(result.groupCount ? [{ value: 'all', label: '完整匹配 + 全部分组' }] : []),
    ...Array.from({ length: result.groupCount }, (_, i) => ({ value: `group:${i + 1}`, label: `分组 $${i + 1}` })),
    ...result.names.map(name => ({ value: `name:${name}`, label: `命名分组 <${name}>` }))];
}
const riskyCSV = text => /^[\t\r\n]|^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text);
export function exportRegexMatches(result, { selection = 'match', protect = true } = {}) {
  if (!regexSelections(result).some(item => item.value === selection) || typeof protect !== 'boolean') throw new Error('提取字段或导出设置无效。');
  const fields = ['number', 'start', 'end', 'line', 'column'];
  if (selection === 'match' || selection === 'all') fields.push('match');
  if (selection === 'all') fields.push(...Array.from({ length: result.groupCount }, (_, i) => `group_${i + 1}`), ...result.names.map(name => `named_${name}`));
  else if (selection.startsWith('group:')) fields.push(`group_${Number(selection.slice(6))}`);
  else if (selection.startsWith('name:')) fields.push(`named_${selection.slice(5)}`);
  const output = { txt: null, csv: null, json: null, errors: {}, protectedCells: 0, selection, tableCompatible: true, tableError: '' };
  const txt = collector(), csv = collector(), json = collector(); let unicode = true;
  const append = (kind, out, value) => { if (output.errors[kind]) return; try { out.append(value); } catch (error) { output.errors[kind] = error.message; } };
  append('csv', csv, fields.join(',')); append('json', json, '[');
  for (const [index, match] of result.matches.entries()) {
    const named = new Map(match.named), values = [index + 1, match.start, match.end, match.line, match.column];
    if (selection === 'match' || selection === 'all') values.push(match.text);
    if (selection === 'all') values.push(...match.groups, ...result.names.map(name => named.get(name) ?? null));
    else if (selection.startsWith('group:')) values.push(match.groups[Number(selection.slice(6)) - 1]);
    else if (selection.startsWith('name:')) values.push(named.get(selection.slice(5)) ?? null);
    for (const value of values) if (typeof value === 'string') { if (!wellFormed(value)) unicode = false; if (value.length > 100_000) output.tableCompatible = false; }
    const record = Object.fromEntries(fields.map((field, i) => [field, values[i]]));
    append('json', json, `${index ? ',' : ''}\n  ${JSON.stringify(record)}`);
    const strings = values.map(value => {
      let text = value === null ? '' : String(value);
      if (typeof value === 'string' && protect && riskyCSV(text)) { text = "'" + text; output.protectedCells++; }
      return /[",\r\n]/.test(text) || text === '' ? `"${text.replace(/"/g, '""')}"` : text;
    });
    append('csv', csv, `\r\n${strings.join(',')}`);
    append('txt', txt, `${index ? '\n' : ''}${values.slice(5).map(value => value ?? '').join('\t')}`);
  }
  append('json', json, result.matches.length ? '\n]' : ']');
  if (!unicode) output.errors.txt = output.errors.csv = '匹配切开了 Unicode 字符，TXT / CSV 会丢失内容。请开启 u 或 v 后重试，或使用保留转义的 JSON。';
  for (const [kind, out] of [['txt', txt], ['csv', csv], ['json', json]]) if (!output.errors[kind]) output[kind] = out.value();
  if (!output.json || output.json.length > 1_000_000 || result.matches.length * fields.length > 200_000 || !unicode) output.tableCompatible = false;
  if (!output.tableCompatible) output.tableError = '当前 JSON 超出表格工具的容量或 Unicode 限制，可直接下载，或减少匹配与分组后再继续。';
  return output;
}
export function regexBlob(text, format) {
  if (!['txt', 'csv', 'json'].includes(format) || typeof text !== 'string' || text.length > REGEX_LIMITS.output) throw new Error('下载内容无效或过大。');
  if (!wellFormed(text)) throw new Error('文本含被切开的 Unicode 字符，请开启 u / v 后重试，避免导出损坏。');
  return new Blob([format === 'json' ? '' : '\uFEFF', text], { type: `${format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain'};charset=utf-8` });
}
export function regexFilename(name, format, replacement = false) {
  const stem = String(name || 'text').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/g, '-').replace(/\.[^.]+$/, '').replace(/^[.\s-]+|[.\s-]+$/g, '').slice(0, 100) || 'text';
  return `${stem}-${replacement ? 'replaced' : 'matches'}.${format}`;
}
export async function readRegexFile(file, { signal } = {}) {
  const check = () => { if (signal?.aborted) throw new DOMException('文件读取已停止', 'AbortError'); }; check();
  if (!file || file.size > REGEX_LIMITS.fileBytes) throw new Error('UTF-8 文本文件最高 2 MB。');
  const buffer = await file.arrayBuffer(); check(); let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new Error('文件不是有效 UTF-8，请另存为 UTF-8 后导入。'); }
  return validateRegexText(text);
}
export const REGEX_SAMPLES = [
  { name: '邮箱提取', pattern: '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}', flags: 'giu', text: '联系人：hello@sgao.cc\n技术支持：support@example.com\n重复出现：hello@sgao.cc', replacement: '[邮箱已隐藏]', note: '演示常见邮箱文本的提取，不作为完整邮箱有效性验证。' },
  { name: '网址提取', pattern: 'https?://[^\\s<>"\u0027]+', flags: 'gu', text: '工具箱 https://tools.sgao.cc/\n文档：https://example.com/docs?id=00123\n<img src="https://example.com/image.png">', replacement: '[链接]', note: '示例会包含紧邻网址的部分标点，请按实际文本调整边界。' },
  { name: '日志命名分组', pattern: '\\[(?<level>INFO|WARN|ERROR)\\]\\s+(?<message>[^\\r\\n]+)', flags: 'gu', text: '[INFO] 服务启动成功\n[WARN] 缓存即将到期\n[ERROR] 文件读取失败', replacement: '$<level>: $<message>', note: '选择「完整匹配 + 全部分组」可导出每条日志的级别与消息。' },
  { name: '日期替换', pattern: '(\\d{4})-(\\d{2})-(\\d{2})', flags: 'gu', text: '发布日期：2026-10-30\n更新日期：2026-11-01', replacement: '$1年$2月$3日', note: '演示分组重排，不校验日期是否真实存在。' },
  { name: '空匹配与 Emoji', pattern: '(?:)', flags: 'gu', text: 'A😀B', replacement: '|', note: '空匹配以竖线标记；u / v 模式按 Unicode 码点推进，位置仍按 UTF-16 计算。' },
];
