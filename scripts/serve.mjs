import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageForPath } from '../src/lib/pages.js';
import { renderPage, renderSitemap } from './render.mjs';
import { staticHeaders } from './headers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv.includes('--source');
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex === -1 ? process.env.PORT || 4173 : process.argv[portIndex + 1]);
const roots = source ? [resolve(root, 'src'), resolve(root, 'public')] : [resolve(root, 'dist')];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.txt': 'text/plain', '.json': 'application/json', '.xml': 'application/xml' };
const headerSource = await readFile(resolve(root, source ? 'public/_headers' : 'dist/_headers'), 'utf8');
function send(res, req, content, type, status = 200) {
  res.writeHead(status, { ...staticHeaders(headerSource, new URL(req.url, 'http://localhost').pathname), 'Content-Type': `${type}${/^(text\/|application\/(json|xml))/.test(type) ? '; charset=utf-8' : ''}`, 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : content);
}
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    const requestURL = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(requestURL.pathname);
    const page = pageForPath(pathname);
    if (page) {
      if (pathname !== page.path) { res.writeHead(308, { Location: `${page.path}${requestURL.search}` }); res.end(); return; }
      const html = source ? renderPage(await readFile(resolve(root, 'src/index.html'), 'utf8'), page) : await readFile(resolve(root, `dist/.${page.path}index.html`));
      send(res, req, html, 'text/html'); return;
    }
    if (source && pathname === '/sitemap.xml') { send(res, req, renderSitemap(), 'application/xml'); return; }
    if (pathname.endsWith('/')) pathname += 'index.html';
    for (const directory of roots) {
      const path = resolve(directory, `.${pathname}`);
      if (!path.startsWith(`${directory}${sep}`)) continue;
      try {
        const content = await readFile(path);
        send(res, req, content, types[extname(path)] || 'application/octet-stream');
        return;
      } catch (error) { if (!['ENOENT', 'EISDIR'].includes(error.code)) throw error; }
    }
    const notFound = await readFile(resolve(root, source ? 'public/404.html' : 'dist/404.html'));
    send(res, req, notFound, 'text/html', 404);
  } catch { res.writeHead(400); res.end('Bad request'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port} ${source ? '(开发模式，修改后刷新)' : '(构建预览)'}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
