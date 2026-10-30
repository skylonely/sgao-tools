import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { matchRegex, exportRegexMatches, regexBlob, regexFilename, readRegexFile, wellFormed, REGEX_SAMPLES, REGEX_LIMITS } from '../src/lib/regex.js';
import { runRegex } from '../src/regex-task.js';
import { parseDelimited, parseJSONTable } from '../src/lib/csv-json.js';

const run = (text, pattern, flags = 'gu', replacement = '') => matchRegex({ text, pattern, flags, replacement });

test('global, non-global and sticky flags preserve native search semantics', () => {
  assert.deepEqual(run('ba aa', 'a').matches.map(m => m.start), [1, 3, 4]);
  assert.deepEqual(run('ba aa', 'a', 'u').matches.map(m => m.start), [1]);
  assert.equal(run('ba', 'a', 'gyu').matches.length, 0);
  assert.deepEqual(run('aab', 'a', 'gyu').matches.map(m => m.start), [0, 1]);
  assert.deepEqual(run('aab', 'a', 'yu').matches.map(m => m.start), [0]);
  assert.equal(run('Aa', 'a', 'giu').matches.length, 2);
  assert.equal(run('a\nb', 'a.b', 'gu').matches.length, 0);
  assert.equal(run('a\nb', 'a.b', 'gsu').matches.length, 1);
});

test('empty patterns and zero length matches advance by UTF-16 or Unicode code point', () => {
  assert.deepEqual(run('😀', '(?:)', 'g').matches.map(m => m.start), [0, 1, 2]);
  assert.deepEqual(run('😀', '(?:)', 'gu').matches.map(m => m.start), [0, 2]);
  assert.deepEqual(run('😀', '(?:)', 'gv').matches.map(m => m.start), [0, 2]);
  assert.deepEqual(run('', '', 'gu').matches.map(m => [m.start, m.end]), [[0, 0]]);
  assert.equal(run('A😀B', '(?:)', 'gu', '|').replacement, '|A|😀|B|');
  assert.equal(run('aba', '(?=a)', 'gu', '!').replacement, '!ab!a');
});

test('UTF-16 offsets, exclusive end and line / column metadata include mixed line breaks', () => {
  const result = run('😀A\r\nB\rC\nD\u2028E\u2029F', '[A-F]', 'g');
  assert.deepEqual(result.matches.map(m => [m.start, m.end, m.line, m.column]), [[2, 3, 1, 3], [5, 6, 2, 1], [7, 8, 3, 1], [9, 10, 4, 1], [11, 12, 5, 1], [13, 14, 6, 1]]);
  assert.deepEqual(run('a\nb', '^', 'gm').matches.map(m => m.start), [0, 2]);
});

test('captures preserve null vs empty and named prototype-like groups remain data', () => {
  const result = run('b', '(a)|(b)(?<__proto__>)', 'dgu');
  assert.deepEqual(result.matches[0].groups, [null, 'b', '']);
  assert.deepEqual(result.matches[0].named, [['__proto__', '']]);
  assert.deepEqual(result.matches[0].ranges, [[0, 1], null, [0, 1], [1, 1]]);
  const record = JSON.parse(exportRegexMatches(result, { selection: 'all' }).json)[0];
  assert.equal(record.group_1, null); assert.equal(record.group_3, ''); assert.equal(record.named___proto__, '');
  assert.equal(Object.getPrototypeOf(record), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test('replacement tokens agree with native JavaScript including ambiguous group references', () => {
  const cases = [
    ['axb x', '(x)', 'g', ['$$', '$&', '$`', "$'", '$1', '$10', '$01', '$00', '$0', '$2', '$99', '$<missing>', '\\n', '😀']],
    ['abxb', '(?<name>x)|(a)', 'g', ['$<name>', '$<missing>', '$<', '$<name', '$2-$1', '$01/$02']],
    ['abcdefghij', '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)', '', ['$10:$11:$99:$01:$09:$00']],
    ['😀', '(?:)', 'gu', ['|', '$&', '$`', "$'", '$$']],
    ['b', '(a)?b()', '', ['$1-$2-$10-$20']],
    ['abc', 'z', 'g', ['anything']],
  ];
  for (const [text, pattern, flags, replacements] of cases) for (const replacement of replacements) assert.equal(run(text, pattern, flags, replacement).replacement, text.replace(new RegExp(pattern, flags), replacement), JSON.stringify({ pattern, flags, replacement }));
});

test('extraction preserves exact strings, metadata, null and selected named groups', () => {
  const result = run('00123 a\n00007', '(?<id>\\d+)|(a)', 'gu');
  const all = exportRegexMatches(result, { selection: 'all' });
  assert.equal(JSON.parse(all.json)[0].group_1, '00123');
  assert.equal(JSON.parse(all.json)[1].named_id, null);
  assert.equal(parseJSONTable(all.json).rows.length, 3);
  const ids = exportRegexMatches(result, { selection: 'name:id' });
  assert.equal(ids.txt, '00123\n\n00007');
  assert.deepEqual(JSON.parse(ids.json).map(row => row.named_id), ['00123', null, '00007']);
  assert.equal(exportRegexMatches(result, { selection: 'group:2' }).txt, '\na\n');
  assert.throws(() => exportRegexMatches(result, { selection: 'group:99' }), /字段/);
});

test('CSV quotes delimiters, quotes, multiline values and protects only text values', () => {
  const values = ['00123', '=1+1', '  @test', '-5', '含,逗号', '双"引号', '第一行\n第二行'];
  const result = run(values.join('|'), '[^|]+', 'gu');
  const protectedOutput = exportRegexMatches(result);
  const rows = parseDelimited(protectedOutput.csv);
  assert.equal(protectedOutput.protectedCells, 3);
  assert.deepEqual(rows.slice(1).map(row => row.at(-1)), values.map((value, i) => i >= 1 && i <= 3 ? "'" + value : value));
  assert.deepEqual(parseDelimited(exportRegexMatches(result, { protect: false }).csv).slice(1).map(row => row.at(-1)), values);
  assert.deepEqual(JSON.parse(protectedOutput.json).map(row => row.match), values);
});

test('non-Unicode matching can split emoji: JSON remains lossless and TXT / CSV reject loss', () => {
  const result = run('😀', '.', 'g', '$&');
  const output = exportRegexMatches(result);
  assert.equal(output.txt, null); assert.equal(output.csv, null);
  assert.match(output.errors.txt, /Unicode/);
  assert.deepEqual(JSON.parse(output.json).map(row => row.match.charCodeAt(0)), [0xd83d, 0xde00]);
  assert.equal(output.tableCompatible, false);
  assert.equal(wellFormed(run('😀', '\\uD83D', 'g', '').replacement), false);
  assert.throws(() => regexBlob('\ud83d', 'txt'), /Unicode/);
  assert.equal(exportRegexMatches(run('😀', '.', 'gu')).txt, '😀');
});

test('empty results are valid exportable values with CSV headers and JSON empty array', () => {
  const output = exportRegexMatches(run('abc', 'z'));
  assert.equal(output.txt, ''); assert.equal(output.json, '[]');
  assert.equal(parseDelimited(output.csv).length, 1);
});

test('malformed patterns, flags and invalid inputs produce bounded errors', () => {
  for (const flags of ['gg', 'z', 'uiv', 'G']) assert.throws(() => run('a', 'a', flags), /标记|同时/);
  assert.throws(() => run('a', '('), /无效/);
  assert.throws(() => run('a'.repeat(REGEX_LIMITS.units + 1), 'a'), /原始文本/);
  assert.throws(() => run('a', 'x'.repeat(REGEX_LIMITS.pattern + 1)), /表达式/);
  assert.throws(() => run('a', 'a', 'g', 'x'.repeat(REGEX_LIMITS.replacement + 1)), /替换模板/);
  assert.throws(() => run('x\0y', '.'), /NUL/);
  assert.throws(() => run('\ud83d', '.'), /Unicode/);
});

test('match, group, cell and captured-content bounds reject incomplete datasets', () => {
  assert.throws(() => run('x'.repeat(5001), 'x'), /5,000/);
  assert.equal(run('x'.repeat(5000), 'x').matches.length, 5000);
  assert.throws(() => run('a', '()'.repeat(41)), /40/);
  assert.throws(() => run('a'.repeat(3000), '()'.repeat(40) + 'a'), /10 万/);
  assert.throws(() => run('x'.repeat(100_000), '('.repeat(25) + 'x+' + ')'.repeat(25)), /200 万/);
});

test('replacement overflow does not erase successful matches and exports never silently truncate', () => {
  const result = run('a'.repeat(5000), 'a', 'gu', 'x'.repeat(1000));
  assert.equal(result.matches.length, 5000); assert.equal(result.replacement, null); assert.match(result.replacementError, /200 万/);
  const big = run('\u0001'.repeat(500_000), '.+', 'gu');
  const output = exportRegexMatches(big);
  assert.equal(output.txt.length, 500_000); assert.equal(output.json, null); assert.match(output.errors.json, /200 万/);
  assert.equal(output.tableCompatible, false);
});

test('file imports enforce UTF-8, BOM, size and cancellation without swallowing a real second BOM', async () => {
  const file = bytes => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const bytes = new TextEncoder().encode('\uFEFF\uFEFFhello\r\n😀');
  assert.equal(await readRegexFile(file(bytes)), '\uFEFFhello\r\n😀');
  await assert.rejects(readRegexFile(file(Uint8Array.of(0xc3, 0x28))), /UTF-8/);
  await assert.rejects(readRegexFile({ size: REGEX_LIMITS.fileBytes + 1 }), /2 MB/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(readRegexFile(file(bytes), { signal: controller.signal }), { name: 'AbortError' });
});

test('downloads have safe names, correct MIME, BOM policy and JSON escapes intact', async () => {
  assert.equal(regexFilename('../foo\u202E.csv', 'json'), 'foo-matches.json');
  assert.equal(regexFilename('photo.txt', 'txt', true), 'photo-replaced.txt');
  const json = exportRegexMatches(run('😀', '.', 'g')).json;
  assert.equal((await regexBlob(json, 'json').text()), json);
  assert.equal(new Uint8Array(await regexBlob('x', 'csv').arrayBuffer())[0], 0xef);
  assert.equal(new Uint8Array(await regexBlob(json, 'json').arrayBuffer())[0], 0x5b);
  assert.match(regexBlob('x', 'txt').type, /text\/plain/);
});

test('all built-in samples execute with meaningful matches and native replacement parity', () => {
  for (const sample of REGEX_SAMPLES) { const result = matchRegex(sample); assert.ok(result.matches.length > 0, sample.name); assert.equal(result.replacement, sample.text.replace(new RegExp(sample.pattern, sample.flags), sample.replacement)); }
});

const workerFactory = () => {
  const worker = new Worker(new URL('./fixtures/regex-node-worker.mjs', import.meta.url));
  return { terminate: () => worker.terminate(), set onmessage(handler) { worker.on('message', data => handler({ data })); }, set onerror(handler) { worker.on('error', error => handler({ error })); }, set onmessageerror(handler) { worker.on('messageerror', handler); }, postMessage: data => worker.postMessage(data) };
};
test('real worker timeout terminates catastrophic backtracking and a later task still succeeds', async () => {
  await assert.rejects(runRegex({ action: 'match', request: { text: 'a'.repeat(100) + '!', pattern: '(a+)+$', flags: 'gu', replacement: '' }, options: { selection: 'match', protect: true } }, { workerFactory, timeout: 250 }), { name: 'TimeoutError' });
  const result = await runRegex({ action: 'match', request: { text: 'id=00123', pattern: '\\d+', flags: 'gu', replacement: '#' }, options: { selection: 'match', protect: true } }, { workerFactory });
  assert.equal(result.match.matches[0].text, '00123'); assert.equal(result.match.replacement, 'id=#');
});

test('abort terminates worker, including already aborted and later stale replies', async () => {
  let terminated = 0, posted = 0, worker;
  const fake = () => worker = { terminate() { terminated++; }, postMessage() { posted++; } };
  const abort = new AbortController(), task = runRegex({}, { signal: abort.signal, workerFactory: fake }); abort.abort();
  await assert.rejects(task, { name: 'AbortError' }); worker.onmessage({ data: { result: { stale: true } } }); assert.equal(terminated, 1); assert.equal(posted, 1);
  await assert.rejects(runRegex({}, { signal: abort.signal, workerFactory: fake }), { name: 'AbortError' }); assert.equal(posted, 1);
});
