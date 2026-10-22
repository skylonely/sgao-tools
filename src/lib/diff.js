// Bounded Myers line diff. Work and trace memory are capped for unrelated inputs.
export function diffLines(before, after, { ignoreWhitespace = false, ignoreCase = false } = {}) {
  if (before.length + after.length > 2_000_000) throw new Error('两侧文本合计不能超过 2 MB。');
  const split = text => text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n');
  const a = split(before), b = split(after);
  if (a.length + b.length > 20_000) throw new Error('两侧文本合计不能超过 20,000 行。');
  const normalize = text => {
    if (ignoreWhitespace) text = text.replace(/\s+/g, '');
    return ignoreCase ? text.toLowerCase() : text;
  };
  const an = a.map(normalize), bn = b.map(normalize);
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && an[prefix] === bn[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && an[a.length - 1 - suffix] === bn[b.length - 1 - suffix]) suffix++;
  const n = a.length - prefix - suffix, m = b.length - prefix - suffix;
  const rows = [];
  let oldLine = 0, newLine = 0;
  function push(type, oldText, newText) {
    rows.push({ type, text: type === 'remove' ? oldText : newText, oldLine: type === 'add' ? null : ++oldLine, newLine: type === 'remove' ? null : ++newLine });
  }
  for (let i = 0; i < prefix; i++) push('equal', a[i], b[i]);
  let approximate = false;
  if (!n) for (let j = 0; j < m; j++) push('add', null, b[prefix + j]);
  else if (!m) for (let i = 0; i < n; i++) push('remove', a[prefix + i], null);
  else {
    const trace = [], frontier = new Map([[1, 0]]);
    let distance = -1, work = 0;
    outer: for (let d = 0; d <= n + m; d++) {
      if (work + d * 2 + 1 > 1_000_000) break;
      trace.push(new Map(frontier));
      for (let k = -d; k <= d; k += 2) {
        work++;
        let x = k === -d || (k !== d && (frontier.get(k - 1) ?? -Infinity) < (frontier.get(k + 1) ?? -Infinity)) ? frontier.get(k + 1) ?? 0 : (frontier.get(k - 1) ?? 0) + 1;
        let y = x - k;
        while (x < n && y < m && an[prefix + x] === bn[prefix + y]) { x++; y++; }
        frontier.set(k, x);
        if (x >= n && y >= m) { distance = d; break outer; }
      }
    }
    if (distance === -1) {
      approximate = true;
      for (let i = 0; i < n; i++) push('remove', a[prefix + i], null);
      for (let j = 0; j < m; j++) push('add', null, b[prefix + j]);
    } else {
      let x = n, y = m;
      const edits = [];
      for (let d = distance; d >= 0; d--) {
        const v = trace[d], k = x - y;
        const prevK = k === -d || (k !== d && (v.get(k - 1) ?? -Infinity) < (v.get(k + 1) ?? -Infinity)) ? k + 1 : k - 1;
        const prevX = v.get(prevK) ?? 0, prevY = prevX - prevK;
        while (x > prevX && y > prevY) { x--; y--; edits.push(['equal', a[prefix + x], b[prefix + y]]); }
        if (d > 0) {
          if (x === prevX) { y--; edits.push(['add', null, b[prefix + y]]); }
          else { x--; edits.push(['remove', a[prefix + x], null]); }
        }
      }
      edits.reverse().forEach(edit => push(...edit));
    }
  }
  for (let i = suffix; i > 0; i--) push('equal', a[a.length - i], b[b.length - i]);
  return { rows, added: rows.filter(row => row.type === 'add').length, removed: rows.filter(row => row.type === 'remove').length, approximate };
}
