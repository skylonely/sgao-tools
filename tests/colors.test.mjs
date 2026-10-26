import test from 'node:test';
import assert from 'node:assert/strict';
import { colorValues, rgbToOKLab, extractPalette, imagePoint, paletteCSS, paletteJSON, paletteFilename } from '../src/lib/colors.js';
import { decodeColorImage } from '../src/color-engine.js';

test('RGB primaries, gray and hue wrap produce valid CSS HEX, RGB and HSL', () => {
  for (const [rgb, hex, hsl] of [
    [[255, 0, 0], '#FF0000', 'hsl(0 100% 50%)'], [[0, 255, 0], '#00FF00', 'hsl(120 100% 50%)'],
    [[0, 0, 255], '#0000FF', 'hsl(240 100% 50%)'], [[255, 0, 255], '#FF00FF', 'hsl(300 100% 50%)'],
    [[255, 255, 255], '#FFFFFF', 'hsl(0 0% 100%)'], [[0, 0, 0], '#000000', 'hsl(0 0% 0%)'],
    [[128, 128, 128], '#808080', 'hsl(0 0% 50.2%)'],
  ]) { const result = colorValues(rgb); assert.equal(result.hex, hex); assert.equal(result.hsl, hsl); assert.equal(result.rgb, `rgb(${rgb.join(' ')})`); }
  assert.throws(() => colorValues([-1, 0, 0])); assert.throws(() => colorValues([0, NaN, 0])); assert.throws(() => colorValues([0, 0, 256]));
});

test('picked transparency is preserved in eight-digit HEX and both functional CSS formats', () => {
  const color = colorValues([255, 0, 0, 128]);
  assert.equal(color.hex, '#FF000080'); assert.equal(color.rgb, 'rgb(255 0 0 / 0.502)'); assert.equal(color.hsl, 'hsl(0 100% 50% / 0.502)');
  assert.equal(colorValues([0, 0, 0, 0]).hex, '#00000000'); assert.equal(colorValues([0, 0, 0, 0]).rgb, 'rgb(0 0 0 / 0)');
});

test('perceptual conversion agrees with sRGB reference primaries and neutral endpoints', () => {
  const near = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6));
  near(rgbToOKLab([0, 0, 0]), [0, 0, 0]); near(rgbToOKLab([255, 255, 255]), [1, 0, 0]);
  near(rgbToOKLab([255, 0, 0]), [.62795536, .22486306, .12584630]);
  near(rgbToOKLab([0, 0, 255]), [.45201372, -.03245698, -.31152815]);
});

test('few-color images keep actual colors and their weighted proportions without padding', () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
  const result = extractPalette(pixels, 8);
  assert.deepEqual(result.map(color => [color.hex, color.fraction]), [['#FF0000', .75], ['#0000FF', .25]]);
  assert.equal(extractPalette(new Uint8Array([22, 44, 66, 255]), 5)[0].hex, '#162C42');
});

test('fully transparent pixels are excluded, partial alpha is composited on white', () => {
  const result = extractPalette(new Uint8Array([1, 2, 3, 0, 0, 0, 0, 128, 255, 0, 0, 255]));
  assert.deepEqual(new Set(result.map(color => color.hex)), new Set(['#7F7F7F', '#FF0000']));
  assert.ok(result.every(color => color.fraction === .5 && color.a === 255));
  assert.deepEqual(extractPalette(new Uint8Array([255, 0, 0, 0, 0, 255, 0, 0])), []);
  assert.deepEqual(extractPalette(new Uint8Array()), []);
});

test('six distinct colors remain distinct; input order and repeat runs do not change the palette', () => {
  const rgb = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
  const source = new Uint8Array(rgb.flatMap(color => [...color, 255]));
  const result = extractPalette(source, 6);
  assert.equal(result.length, 6); assert.equal(new Set(result.map(color => color.hex)).size, 6);
  assert.deepEqual(result, extractPalette(source, 6));
  assert.deepEqual(result, extractPalette(new Uint8Array([...rgb].reverse().flatMap(color => [...color, 255])), 6));
  assert.ok(Math.abs(result.reduce((sum, color) => sum + color.fraction, 0) - 1) < 1e-12);
});

test('bounded photographic-like samples cluster to requested count with valid shares and colors', () => {
  const source = new Uint8Array(256 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const p = (y * 256 + x) * 4; source.set([x, y, (x * 3 + y * 5) % 256, 255], p); }
  const result = extractPalette(source, 8);
  assert.equal(result.length, 8); assert.equal(new Set(result.map(color => color.hex)).size, 8);
  assert.ok(result.every(color => /^#[\dA-F]{6}$/.test(color.hex) && color.fraction > 0 && color.fraction <= 1));
  assert.ok(result.every((color, i) => !i || color.fraction <= result[i - 1].fraction));
  assert.ok(Math.abs(result.reduce((sum, color) => sum + color.fraction, 0) - 1) < 1e-12);
});

test('palette extraction rejects invalid counts, malformed bytes and oversized samples', () => {
  for (const count of [0, 4, 9, 6.5, NaN]) assert.throws(() => extractPalette(new Uint8Array(4), count));
  for (const data of [[], new Float32Array(4), new Uint8Array(3), new Uint8Array(256 * 256 * 4 + 4)]) assert.throws(() => extractPalette(data));
});

test('display coordinates map to original pixels at small previews, enlarged views and image edges', () => {
  assert.deepEqual(imagePoint(123.9, 40, 400, 200, 8000, 4000), { x: 2478, y: 800 });
  assert.deepEqual(imagePoint(399.99, 199.99, 400, 200, 8000, 4000), { x: 7999, y: 3999 });
  assert.deepEqual(imagePoint(400, 200, 400, 200, 8000, 4000), { x: 7999, y: 3999 });
  assert.deepEqual(imagePoint(-90, -8, 400, 200, 8000, 4000), { x: 0, y: 0 });
  assert.deepEqual(imagePoint(600, 100, 1000, 500, 2, 1), { x: 1, y: 0 });
  assert.throws(() => imagePoint(0, 0, 0, 0, 1, 1));
});

test('CSS and JSON exports carry actual color values, extraction policy and literal filenames', () => {
  const colors = extractPalette(new Uint8Array([255, 0, 0, 255, 0, 0, 0, 128]));
  assert.equal(paletteCSS(colors), ':root {\n  --color-1: #7F7F7F;\n  --color-2: #FF0000;\n}');
  const filename = '"</script>风景.png', sample = { width: 256, height: 128 }, data = JSON.parse(paletteJSON(colors, filename, sample));
  assert.equal(data.name, filename); assert.equal(data.colorSpace, 'sRGB'); assert.deepEqual(data.sample, sample);
  assert.equal(data.colors[0].hex, colors[0].hex); assert.equal(data.colors[0].fraction, .5);
  assert.equal(paletteFilename('风景.png', 'json'), '风景-palette.json');
  assert.equal(paletteFilename('../bad\u0000/image.webp', 'png'), '..-bad--image-palette.png');
});

test('image input limits reject before decoding; decoded size errors close the bitmap', async t => {
  let called = false;
  for (const size of [0, 20 * 1024 * 1024 + 1]) await assert.rejects(decodeColorImage({ size, arrayBuffer() { called = true; } }), /20 MB/);
  assert.equal(called, false);
  const header = new Uint8Array(24); header.set([137, 80, 78, 71]); new DataView(header.buffer).setUint32(16, 10001); new DataView(header.buffer).setUint32(20, 1);
  await assert.rejects(decodeColorImage(new File([header], 'large.png')), /10000/);
  let closed = false, options;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, writable: true, value: async (_, settings) => { options = settings; return { width: 8000, height: 5000, close() { closed = true; } }; } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'createImageBitmap', original); else delete globalThis.createImageBitmap; });
  await assert.rejects(decodeColorImage(new File([new Uint8Array([255, 216, 255])], 'large.jpg')), /3200/);
  assert.equal(closed, true); assert.equal(options.imageOrientation, 'from-image');
});
