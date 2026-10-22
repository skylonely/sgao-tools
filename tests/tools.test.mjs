import test from 'node:test';
import assert from 'node:assert/strict';
import { formatJSON } from '../src/lib/json.js';
import { parseTimestamp, formatDateTime, dateToTimestamp } from '../src/lib/time.js';
import { transformURL } from '../src/lib/url.js';
import { diffLines } from '../src/lib/diff.js';

test('JSON formats nested data and preserves numeric and key tokens', () => {
  const source = '{"id":9007199254740993,"n":1e999,"duplicate":1,"duplicate":2,"s":"a\\\"b","empty":{},"a":[true,null,-0]}';
  const formatted = formatJSON(source);
  assert.ok(formatted.includes('9007199254740993'));
  assert.ok(formatted.includes('1e999'));
  assert.equal(formatJSON(formatted, { compact: true }), source);
  assert.ok(formatted.includes('\n  "id"'));
});

test('JSON sorting is recursive and does not mutate prototype keys', () => {
  assert.equal(formatJSON('{"z":{"b":1,"a":2},"__proto__":3,"a":[]}', { sortKeys: true, compact: true }), '{"__proto__":3,"a":[],"z":{"a":2,"b":1}}');
  assert.equal(formatJSON('[{"x":1}]', { indent: 'tab' }), '[\n\t{\n\t\t"x": 1\n\t}\n]');
  for (const value of ['null', 'true', '0', '"hello"', '{}', '[]']) assert.equal(formatJSON(value), value);
});

test('JSON rejects malformed, excessive, or empty input', () => {
  for (const value of ['', '{"x":}', '{"x":1,}', '[NaN]', '{a:1}']) assert.throws(() => formatJSON(value));
  assert.throws(() => formatJSON('['.repeat(202) + '0' + ']'.repeat(202)), /200/);
});

test('timestamp handles epoch, milliseconds, negative and fractional seconds', () => {
  assert.deepEqual(parseTimestamp('0'), { milliseconds: 0, unit: 'seconds' });
  assert.equal(parseTimestamp('1792627200000').milliseconds, 1792627200000);
  assert.equal(parseTimestamp('-1.001', 'seconds').milliseconds, -1001);
  assert.equal(parseTimestamp('1', 'milliseconds').milliseconds, 1);
  assert.equal(formatDateTime(0), '1970-01-01 08:00:00');
  assert.equal(formatDateTime(0, 'utc'), '1970-01-01 00:00:00');
  assert.equal(dateToTimestamp('1970-01-01T08:00:00'), 0);
  assert.equal(dateToTimestamp('1970-01-01T00:00', 'utc'), 0);
});

test('date conversion rejects invalid dates and timestamp overflow', () => {
  assert.throws(() => dateToTimestamp('2025-02-29T12:00:00'));
  assert.throws(() => dateToTimestamp('2026-02-30T12:00:00'));
  assert.throws(() => dateToTimestamp('2026-13-01T00:00:00'));
  assert.throws(() => dateToTimestamp('2026-01-01T24:00:00'));
  for (const value of ['abc', '', 'Infinity', '1e9', '8640000000000001']) assert.throws(() => parseTimestamp(value));
  assert.throws(() => parseTimestamp('1.0001', 'seconds'), /3/);
  assert.throws(() => parseTimestamp('1.1', 'milliseconds'));
  const leap = '2024-02-29T23:59:59';
  for (const zone of ['beijing', 'utc', 'local']) assert.equal(formatDateTime(dateToTimestamp(leap, zone), zone, 'T'), leap);
});

test('URL modes round trip Unicode, reserved characters, spaces and plus signs', () => {
  const source = '你好 👋 /?a=1&b=a+b !~*\'()';
  for (const mode of ['component', 'uri', 'form']) assert.equal(transformURL(transformURL(source, 'encode', mode), 'decode', mode), source);
  assert.equal(transformURL('a+b c', 'encode', 'form'), 'a%2Bb+c');
  assert.equal(transformURL('a+b', 'decode', 'component'), 'a+b');
  assert.equal(transformURL('%2F', 'decode', 'uri'), '%2F');
  assert.throws(() => transformURL('%E4%BD', 'decode'), /解码失败/);
  assert.throws(() => transformURL('\uD800', 'encode'), /Unicode/);
});

function reconstruct(result, side) {
  return result.rows.filter(row => side === 'old' ? row.type !== 'add' : row.type !== 'remove').map(row => row.text).join('\n');
}
test('line diff handles additions, deletions, final newlines, and empty text', () => {
  for (const [a, b] of [['', ''], ['', 'hello'], ['hello', ''], ['a\nb', 'a\nc'], ['a\n', 'a'], ['x\ny\nz', 'q\ny\nr'], ['a\na\nb', 'b\na\na']]) {
    const result = diffLines(a, b);
    assert.equal(reconstruct(result, 'old'), a);
    assert.equal(reconstruct(result, 'new'), b);
    assert.equal(result.approximate, false);
  }
  assert.deepEqual(diffLines('a\nb', 'a\nc').rows.map(row => row.type), ['equal', 'remove', 'add']);
  assert.equal(diffLines('a\nb', 'a\nc').added, 1);
  assert.equal(diffLines('a\nb', 'a\nc').removed, 1);
});

test('line diff handles ignore options and standardizes CRLF', () => {
  assert.equal(diffLines('Hello  world\r\n', 'helloworld\n', { ignoreWhitespace: true, ignoreCase: true }).added, 0);
  assert.equal(diffLines('a\r\nb', 'a\nb').removed, 0);
});

test('line diff randomized reconstruction and minimal edit distance', () => {
  let seed = 20261022;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let iteration = 0; iteration < 300; iteration++) {
    const a = Array.from({ length: 1 + Math.floor(random() * 15) }, () => 'abcd'[Math.floor(random() * 4)]);
    const b = Array.from({ length: 1 + Math.floor(random() * 15) }, () => 'abcd'[Math.floor(random() * 4)]);
    const result = diffLines(a.join('\n'), b.join('\n'));
    assert.equal(reconstruct(result, 'old'), a.join('\n'));
    assert.equal(reconstruct(result, 'new'), b.join('\n'));
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    assert.equal(result.added + result.removed, a.length + b.length - 2 * dp[a.length][b.length]);
  }
});

test('line diff bounds work and rejects oversized input', () => {
  const a = Array.from({ length: 2000 }, (_, i) => `old-${i}`).join('\n');
  const b = Array.from({ length: 2000 }, (_, i) => `new-${i}`).join('\n');
  const result = diffLines(a, b);
  assert.equal(result.approximate, true);
  assert.equal(reconstruct(result, 'old'), a);
  assert.equal(reconstruct(result, 'new'), b);
  assert.throws(() => diffLines('x'.repeat(2_000_001), ''));
});
