import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVICON_PNGS, faviconDirectory, faviconConfig, faviconRect, faviconManifest, faviconDocuments } from '../src/lib/favicon.js';
import { getIconRect } from '../src/lib/ico.js';
import { createZIP, crc32 } from '../src/lib/zip.js';

test('favicon paths support root, nested folders and Unicode with a stable trailing slash', () => {
  assert.equal(faviconDirectory('/'), '/');
  assert.equal(faviconDirectory('/assets/icons'), '/assets/icons/');
  assert.equal(faviconDirectory('/assets//icons/'), '/assets/icons/');
  assert.equal(faviconDirectory('/图标/'), '/%E5%9B%BE%E6%A0%87/');
  assert.equal(faviconDirectory('/%E5%9B%BE%E6%A0%87/'), '/%E5%9B%BE%E6%A0%87/');
  for (const value of ['', 'icons/', 'https://example.test/', '//example.test/', '/a/../', '/a/%2e%2e/', '/a/%252e%252e/', '/a/%2fetc/', '/a\\b/', '/a?x=1', '/a#x', '/a b/', '/a%20b/', '/a/%00/', '/a/%']) assert.throws(() => faviconDirectory(value), value);
});

test('manifest references all packaged PWA PNGs correctly from nested asset directories', () => {
  const config = faviconConfig({ name: '我的应用 🎉', shortName: '应用', assetPath: '/assets/icons', appPath: '/app' });
  const manifest = faviconManifest(config);
  assert.equal(manifest.id, '/app/'); assert.equal(manifest.start_url, '/app/'); assert.equal(manifest.scope, '/app/');
  assert.equal(manifest.name, '我的应用 🎉');
  assert.deepEqual(manifest.icons.map(icon => icon.purpose), ['any', 'any', 'maskable', 'maskable']);
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512', '192x192', '512x512']);
  const names = new Set(FAVICON_PNGS.map(file => file.name));
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, 'https://site.test/assets/icons/site.webmanifest');
    assert.equal(url.origin, 'https://site.test');
    assert.ok(url.pathname.startsWith('/assets/icons/'));
    assert.ok(names.has(url.pathname.split('/').pop()));
  }
});

test('HTML paths, selected ICO sizes and manifest JSON remain consistent and escape user text', () => {
  const docs = faviconDocuments({ assetPath: '/图标/', appPath: '/blog/', name: 'a" <b>& 应用', shortName: '"/><script>x</script>' }, [24, 64, 256]);
  assert.match(docs.html, /sizes="24x24 64x64 256x256"/);
  assert.doesNotMatch(docs.html, /<script>/);
  assert.match(docs.html, /&quot;\/&gt;&lt;script&gt;x&lt;\/script&gt;/);
  const manifest = JSON.parse(docs.manifest);
  assert.equal(manifest.name, 'a" <b>& 应用');
  assert.equal(manifest.short_name, '"/><script>x</script>');
  const files = new Set(['favicon.ico', ...FAVICON_PNGS.map(file => file.name), ...docs.files.map(file => file.name)]);
  assert.equal(files.size, 13);
  for (const [, href] of docs.html.matchAll(/href="([^"]+)"/g)) {
    const url = new URL(href, 'https://site.test/blog/');
    assert.equal(url.origin, 'https://site.test');
    assert.ok(url.pathname.startsWith('/%E5%9B%BE%E6%A0%87/'));
    assert.ok(files.has(url.pathname.split('/').pop()));
  }
  assert.match(docs.files.find(file => file.name === 'README.txt').text, /\/blog\//);
});

test('Maskable bounds fit the safe circle for every aspect ratio and contain/cover mode', () => {
  for (const size of [192, 512]) for (const [width, height] of [[512, 512], [2000, 100], [100, 2000], [1, 10000], [10000, 1]]) for (const fit of ['contain', 'cover']) {
    const rect = faviconRect(width, height, size, fit, 'maskable');
    assert.ok(rect.dw > 0 && rect.dh > 0);
    assert.ok(Math.abs(rect.dx + rect.dw / 2 - size / 2) < 1e-8);
    assert.ok(Math.abs(rect.dy + rect.dh / 2 - size / 2) < 1e-8);
    for (const x of [rect.dx, rect.dx + rect.dw]) for (const y of [rect.dy, rect.dy + rect.dh]) assert.ok(Math.hypot(x - size / 2, y - size / 2) <= size * .4 + 1e-8);
    if (fit === 'contain') assert.ok(Math.abs(rect.dw / rect.dh - width / height) < 1e-8);
    else assert.equal(rect.sw, rect.sh);
  }
});

test('Apple icons get deliberate padding while ordinary icons preserve existing fit behavior', () => {
  assert.deepEqual(faviconRect(200, 100, 32), getIconRect(200, 100, 32));
  const apple = faviconRect(180, 180, 180, 'contain', 'apple');
  assert.ok(Math.abs(apple.dx - 14.4) < 1e-9); assert.ok(Math.abs(apple.dw - 151.2) < 1e-9);
  assert.throws(() => faviconRect(100, 100, 32, 'stretch'));
});

test('favicon configuration rejects incomplete names, malformed colors and invalid ICO selections', () => {
  for (const options of [{ name: '' }, { shortName: '' }, { name: 'x'.repeat(81) }, { shortName: 'x'.repeat(25) }, { name: 'a\nb' }, { themeColor: 'red' }, { appBackground: '#fff' }, { display: 'popup' }]) assert.throws(() => faviconConfig(options));
  for (const sizes of [[], [16, 16], [17], [512]]) assert.throws(() => faviconDocuments({}, sizes));
  const names = FAVICON_PNGS.map(file => file.name);
  assert.equal(new Set(names).size, 9);
  assert.equal(FAVICON_PNGS.find(file => file.kind === 'apple').size, 180);
});

test('favicon text assets survive UTF-8 ZIP packing with exact bytes and checksums', () => {
  const docs = faviconDocuments({ name: '图标应用 🎉', assetPath: '/icons/', appPath: '/app/' });
  const files = docs.files.map(file => ({ name: file.name, data: new TextEncoder().encode(file.text) }));
  const bytes = createZIP(files), view = new DataView(bytes.buffer);
  let offset = 0;
  for (const file of files) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    const length = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const data = bytes.slice(offset + 30 + nameLength, offset + 30 + nameLength + length);
    assert.equal(name, file.name); assert.deepEqual(data, file.data); assert.equal(view.getUint32(offset + 14, true), crc32(file.data));
    offset += 30 + nameLength + length;
  }
});
