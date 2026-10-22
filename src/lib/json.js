// A token-preserving formatter: large integers, exponent notation and duplicate keys
// survive formatting without a JavaScript Number or object round trip.
export function formatJSON(source, { indent = 2, compact = false, sortKeys = false } = {}) {
  if (!source.trim()) throw new Error('请输入需要处理的 JSON。');
  if (source.length > 2_000_000) throw new Error('JSON 超过 2 MB，请缩小内容后重试。');
  try { JSON.parse(source); } catch (error) {
    const match = error.message.match(/position\s+(\d+)/i);
    const before = match ? source.slice(0, Number(match[1])).split('\n') : null;
    const location = before ? `（第 ${before.length} 行，第 ${before.at(-1).length + 1} 列）` : '';
    const detail = error.message.replace(/\s*at position[\s\S]*$/, '').replace(/\s*\(line[\s\S]*$/, '');
    throw new Error(`JSON 格式有误${location}：${detail}`);
  }
  const tokens = source.match(/"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g);
  let cursor = 0;
  function parse(depth = 0) {
    if (depth > 200) throw new Error('JSON 嵌套超过 200 层，请减少嵌套后重试。');
    const token = tokens[cursor++];
    if (token === '{') {
      const pairs = [];
      while (tokens[cursor] !== '}') {
        const key = tokens[cursor++]; cursor++;
        pairs.push([key, parse(depth + 1)]);
        if (tokens[cursor] !== ',') break;
        cursor++;
      }
      cursor++;
      if (sortKeys) pairs.sort((a, b) => {
        const x = JSON.parse(a[0]), y = JSON.parse(b[0]);
        return x < y ? -1 : x > y ? 1 : 0;
      });
      return { kind: 'object', entries: pairs };
    }
    if (token === '[') {
      const entries = [];
      while (tokens[cursor] !== ']') {
        entries.push(parse(depth + 1));
        if (tokens[cursor] !== ',') break;
        cursor++;
      }
      cursor++;
      return { kind: 'array', entries };
    }
    return token;
  }
  const step = indent === 'tab' ? '\t' : ' '.repeat([2, 4].includes(Number(indent)) ? Number(indent) : 2);
  function render(node, depth = 0) {
    if (typeof node === 'string') return node;
    const object = node.kind === 'object';
    const [open, close] = object ? ['{', '}'] : ['[', ']'];
    if (!node.entries.length) return open + close;
    const entries = node.entries.map(entry => object ? `${entry[0]}:${compact ? '' : ' '}${render(entry[1], depth + 1)}` : render(entry, depth + 1));
    return compact ? `${open}${entries.join(',')}${close}` : `${open}\n${step.repeat(depth + 1)}${entries.join(`,\n${step.repeat(depth + 1)}`)}\n${step.repeat(depth)}${close}`;
  }
  return render(parse());
}
