import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv.includes('--source');
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex === -1 ? process.env.PORT || 4173 : process.argv[portIndex + 1]);
const roots = source ? [resolve(root, 'src'), resolve(root, 'public')] : [resolve(root, 'dist')];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    for (const directory of roots) {
      const path = resolve(directory, `.${pathname}`);
      if (!path.startsWith(`${directory}${sep}`)) continue;
      try {
        const content = await readFile(path);
        res.writeHead(200, { 'Content-Type': `${types[extname(path)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : content);
        return;
      } catch (error) { if (!['ENOENT', 'EISDIR'].includes(error.code)) throw error; }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 · 页面不存在');
  } catch { res.writeHead(400); res.end('Bad request'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port} ${source ? '(开发模式，修改后刷新)' : '(构建预览)'}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
