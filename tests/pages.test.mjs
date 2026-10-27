import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HOME, TOOLS, SITE_URL, pageForPath, legacyDestination, matchesTool, toolByKey } from '../src/lib/pages.js';
import { renderPage, renderSitemap, escapeHTML } from '../scripts/render.mjs';

const template = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');

test('independent routes resolve safely and old hash links retain query parameters', () => {
  assert.equal(pageForPath('/'), HOME);
  assert.equal(pageForPath('/index.html'), HOME);
  assert.equal(new Set(TOOLS.map(tool => tool.path)).size, 13);
  for (const tool of TOOLS) {
    assert.equal(pageForPath(tool.path), tool);
    assert.equal(pageForPath(tool.path.slice(0, -1)), tool);
    assert.equal(pageForPath(`${tool.path}index.html`), tool);
    assert.equal(legacyDestination(`#${tool.key}`, '?from=bookmark'), `${tool.path}?from=bookmark`);
  }
  for (const path of ['/unknown/', '/json-formatter/child/', '/__proto__/', '//json-formatter/', '/json-formatter/../']) assert.equal(pageForPath(path), undefined);
  for (const hash of ['#main', '#tool-directory', '#unknown', '#__proto__', '']) assert.equal(legacyDestination(hash), null);
});

test('initial HTML contains only its own tool, with unique SEO metadata and crawlable navigation', () => {
  const titles = new Set(), descriptions = new Set();
  for (const page of [HOME, ...TOOLS]) {
    const html = renderPage(template, page);
    titles.add(html.match(/<title>(.*?)<\/title>/)[1]);
    descriptions.add(html.match(/<meta name="description" content="([^"]*)"/)[1]);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.ok(html.includes(`data-page="${page.key}"`));
    assert.ok(html.includes(`<link rel="canonical" href="${SITE_URL}${page.path}">`));
    assert.ok(html.includes(`<meta property="og:url" content="${SITE_URL}${page.path}">`));
    assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
    assert.equal((html.match(/aria-current="page"/g) || []).length, 2);
    for (const tool of TOOLS) assert.ok(html.includes(`href="${tool.path}"`));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size, `duplicate ID in ${page.path}`);
    const views = [...html.matchAll(/<section id="view-([a-z]+)"/g)].map(match => match[1]);
    assert.deepEqual(views, page.key === 'home' ? [] : [page.key]);
    assert.equal(html.includes('<dialog id="image-compare-dialog"'), page.key === 'image');
    assert.ok(!/href="#(?:json|timestamp|url|diff|ico|image|qrcode|svg|crop|color|watermark|collage|imagepdf)"/.test(html));
    assert.equal(html.includes('href="/color-tool.css"'), page.key === 'color');
    assert.equal(html.includes('href="/watermark-tool.css"'), page.key === 'watermark');
    assert.equal(html.includes('href="/collage-tool.css"'), page.key === 'collage');
    assert.equal(html.includes('href="/image-pdf-tool.css"'), page.key === 'imagepdf');
    assert.ok(!html.includes('src="/vendor/pdf-lib'));
    if (page.key !== 'home') {
      assert.ok(html.includes('如何使用'));
      assert.ok(html.includes('常见问题'));
      assert.ok(html.includes(escapeHTML(page.faqs[0][1])));
    } else assert.equal((html.match(/data-card="/g) || []).length, 13);
  }
  assert.equal(titles.size, 14);
  assert.equal(descriptions.size, 14);
});

test('structured data and sitemap agree on canonical pages without invented ratings or dates', () => {
  for (const page of [HOME, ...TOOLS]) {
    const html = renderPage(template, page);
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.equal(data['@context'], 'https://schema.org');
    const webpage = data['@graph'].find(item => item['@type'] === (page.key === 'home' ? 'CollectionPage' : 'WebPage'));
    assert.equal(webpage.url, `${SITE_URL}${page.path}`);
    if (page.key !== 'home') {
      const crumbs = data['@graph'].find(item => item['@type'] === 'BreadcrumbList').itemListElement;
      assert.deepEqual(crumbs.map(crumb => crumb.item), [`${SITE_URL}/`, `${SITE_URL}${page.path}`]);
    } else assert.equal(data['@graph'].find(item => item['@type'] === 'ItemList').itemListElement.length, 13);
    assert.equal(JSON.stringify(data).includes('aggregateRating'), false);
  }
  const sitemap = renderSitemap();
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]), [HOME, ...TOOLS].map(page => `${SITE_URL}${page.path}`));
  assert.ok(!sitemap.includes('#'));
  assert.ok(!sitemap.includes('<lastmod>'));
});

test('directory combines category and normalized search, including format and Chinese aliases', () => {
  const find = (query, category = 'all') => TOOLS.filter(tool => matchesTool(tool, query, category)).map(tool => tool.key);
  assert.equal(find('').length, 13);
  assert.deepEqual(find('', 'image'), ['ico', 'image', 'svg', 'crop', 'color', 'watermark', 'collage']);
  assert.deepEqual(find('  ＪＳＯＮ  '), ['json']);
  assert.deepEqual(find('PNG', 'image'), ['ico', 'image', 'svg', 'crop', 'color', 'watermark', 'collage']);
  assert.deepEqual(find('拼图'), ['collage']);
  assert.deepEqual(find('PDF', 'document'), ['imagepdf']);
  assert.deepEqual(find('扫描件'), ['imagepdf']);
  assert.deepEqual(find('取色'), ['color']);
  assert.deepEqual(find('水印'), ['watermark']);
  assert.deepEqual(find('图片 压缩'), ['image']);
  assert.deepEqual(find('WiFi', 'dev'), []);
  assert.deepEqual(find('不存在的工具'), []);
  assert.ok(matchesTool(toolByKey('qrcode'), 'WiFi'));
  assert.ok(matchesTool(toolByKey('ico'), 'favicon'));
});

test('unknown paths get an authored noindex 404 and output escaping preserves literal text', async () => {
  const notFound = await readFile(new URL('../public/404.html', import.meta.url), 'utf8');
  assert.ok(notFound.includes('<meta name="robots" content="noindex">'));
  assert.ok(notFound.includes('href="/"'));
  assert.equal(escapeHTML('<img src="x" onerror=\'bad\'> &'), '&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt; &amp;');
});
