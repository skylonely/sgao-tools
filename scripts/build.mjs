import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HOME, TOOLS } from '../src/lib/pages.js';
import { renderPage, renderSitemap } from './render.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}dist`;
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(`${root}src`, output, { recursive: true });
await cp(`${root}public`, output, { recursive: true });
const template = await readFile(`${root}src/index.html`, 'utf8');
for (const page of [HOME, ...TOOLS]) {
  const directory = `${output}${page.path}`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}index.html`, renderPage(template, page));
}
await writeFile(`${output}/sitemap.xml`, renderSitemap());
console.log('构建完成 → dist/（首页 + 8 个独立工具页面 + sitemap.xml）');
