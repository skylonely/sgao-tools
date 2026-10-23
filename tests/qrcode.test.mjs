import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQRContent, byteLength, makeQRCode, qrGeometry, qrLogoBox, qrSVG, safeQRLink, validateQRColors } from '../src/lib/qrcode.js';
import jsQR from '../src/vendor/jsqr.js';

// Cross-check encoding against an independent decoder, with a 4-module quiet zone.
function readback(qr, logo = false) {
  const scale = 5, border = 4, width = (qr.size + border * 2) * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255), box = qrLogoBox(qr);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const mx = Math.floor(x / scale) - border, my = Math.floor(y / scale) - border;
    const covered = logo && mx + border >= box.x - box.padding && mx + border < box.x + box.size + box.padding && my + border >= box.y - box.padding && my + border < box.y + box.size + box.padding;
    if (qr.getModule(mx, my) && !covered) pixels.set([32, 35, 43], (y * width + x) * 4);
  }
  return jsQR(pixels, width, width, { inversionAttempts: 'attemptBoth' });
}

test('QR preserves Unicode, emoji, whitespace, and validates HTTP URLs', () => {
  const text = '  你好，SGAO！🎉\n第二行\r\n  ';
  assert.equal(buildQRContent({ type: 'text', text }), text);
  assert.equal(byteLength('中文🎉'), 10);
  assert.equal(buildQRContent({ type: 'url', text: '  https://例子.测试/?a=中文&b=2  ' }), 'https://例子.测试/?a=中文&b=2');
  for (const text of ['', 'example.com', 'javascript:alert(1)', 'file:///tmp/a', 'data:text/plain,hi']) assert.throws(() => buildQRContent({ type: 'url', text }));
  assert.throws(() => buildQRContent({ type: 'text', text: '中'.repeat(401) }), /过长/);
  assert.throws(() => buildQRContent({ type: 'text', text: '  \n ' }), /输入/);
});

test('Wi-Fi escapes delimiters and supports hidden and open networks', () => {
  assert.equal(buildQRContent({ type: 'wifi', ssid: '家;庭:网,络"\\', password: 'a;b:c,d"e\\f', hidden: true }), 'WIFI:T:WPA;S:家\\;庭\\:网\\,络\\"\\\\;P:a\\;b\\:c\\,d\\"e\\\\f;H:true;;');
  assert.equal(buildQRContent({ type: 'wifi', ssid: 'Guest', security: 'nopass', password: 'ignored' }), 'WIFI:T:nopass;S:Guest;H:false;;');
  assert.throws(() => buildQRContent({ type: 'wifi', ssid: '中'.repeat(11), password: 'secret' }), /32/);
  assert.throws(() => buildQRContent({ type: 'wifi', ssid: 'Guest' }), /密码/);
});

test('independent decoder reads every correction level, UTF-8 ECI and Wi-Fi', () => {
  const cases = ['https://sgao.cc/?name=测试&emoji=🎉', '001234567890', 'HELLO WORLD', '你好！🌍\n第二行\r\n  ', buildQRContent({ type: 'wifi', ssid: 'SGAO;测试', password: 'a:b;c,d\\', hidden: true })];
  for (const text of cases) for (const level of ['L', 'M', 'Q', 'H']) {
    const result = readback(makeQRCode(text, { level }));
    assert.ok(result, `${level}: ${text}`); assert.equal(result.data, text);
  }
});

test('Logo selects high correction and survives the reserved centre area', () => {
  for (const content of ['https://sgao.cc', '你好，扫码看这里 🎉', 'https://sgao.cc/path?message=' + 'abc'.repeat(45)]) {
    const qr = makeQRCode(content, { logo: true, level: 'L' });
    assert.equal(qr.errorCorrectionLevel.ordinal, 3); assert.equal(readback(qr, true).data, content);
  }
});

test('dense payload scans and export sizing preserves readable module scale', () => {
  const content = 'a'.repeat(1200), qr = makeQRCode(content, { level: 'H' });
  assert.equal(readback(qr).data, content);
  const geometry = qrGeometry(qr, 256);
  assert.ok(geometry.pixels >= geometry.grid * 4); assert.throws(() => qrGeometry(qr, 5000));
});

test('SVG is self-contained and rejects injection, light modules and low contrast', () => {
  assert.ok(validateQRColors('#20232b', '#ffffff') > 10);
  assert.throws(() => validateQRColors('#ffffff', '#000000')); assert.throws(() => validateQRColors('#dddddd', '#ffffff'));
  const qr = makeQRCode('https://sgao.cc'), svg = qrSVG(qr, { logoData: 'data:image/png;base64,YWJj' });
  assert.match(svg, /viewBox="0 0 33 33"/); assert.match(svg, /<image href="data:image\/png;base64,YWJj"/);
  assert.doesNotMatch(svg, /https:\/\/sgao\.cc/);
  assert.throws(() => qrSVG(qr, { foreground: '#000000" onload="alert(1)' }));
  assert.throws(() => qrSVG(qr, { logoData: 'https://external.test/logo.svg' }));
  assert.throws(() => qrSVG(qr, { logoData: 'data:image/svg+xml,<svg onload="alert(1)"/>' }));
});

test('scanned links only allow explicit HTTP(S) navigation', () => {
  assert.equal(safeQRLink('https://sgao.cc'), 'https://sgao.cc/');
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/x', 'WIFI:T:nopass;S:Guest;;', 'plain text']) assert.equal(safeQRLink(value), null);
});
