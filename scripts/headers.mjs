// Match the subset of Cloudflare _headers used by this static project during local QA.
export function staticHeaders(source, pathname) {
  const headers = {}; let pattern, set = {}, unset = [];
  const apply = () => {
    if (!pattern) return;
    const regex = new RegExp(`^${pattern.split('*').map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    if (!regex.test(pathname)) return;
    for (const name of unset) delete headers[name.toLowerCase()];
    for (const [name, value] of Object.entries(set)) { const lower = name.toLowerCase(); headers[lower] = headers[lower] ? `${headers[lower]}, ${value}` : value; }
  };
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) { apply(); pattern = line.trim(); set = {}; unset = []; }
    else if (line.trim().startsWith('! ')) unset.push(line.trim().slice(2));
    else { const index = line.indexOf(':'); if (index > 0) set[line.slice(0, index).trim()] = line.slice(index + 1).trim(); }
  }
  apply(); return headers;
}
