import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeSVG } from '../src/svg-optimizer.js';
import { SVG_SAMPLE } from '../src/svg-sample.js';
import { svgByteLength, svgDimensions, svgLength, initialPNGSize, validatePNGSize, containSVG, svgFilename, svgSavings } from '../src/lib/svg.js';

const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80">${body}</svg>`;

test('SVG optimizer removes editor data, measures UTF-8 bytes, and preserves scaling and accessibility', () => {
  const result = optimizeSVG(SVG_SAMPLE);
  assert.equal(result.originalBytes, Buffer.byteLength(SVG_SAMPLE));
  assert.equal(result.outputBytes, Buffer.byteLength(result.data));
  assert.ok(result.outputBytes < result.originalBytes * .8);
  assert.doesNotMatch(result.data, /<metadata|<!--|<\?xml/);
  assert.match(result.data, /viewBox="0 0 720 480"/);
  assert.match(result.data, /<title>山间日落 · SGAO<\/title>/);
  assert.match(result.data, /<desc>/);
  for (const id of ['sky', 'frame', 'front']) { assert.ok(result.data.includes(`id="${id}"`)); assert.ok(result.data.includes(`url(#${id})`)); }
  assert.deepEqual(result.dimensions, { width: 720, height: 480, viewBox: [0, 0, 720, 480] });
});

test('SVG keeps local gradients, masks, filters, text, CSS and embedded raster images', () => {
  const body = '<defs><mask id="mask"><rect width="100" height="80" fill="white"/></mask><filter id="blur"><feGaussianBlur stdDeviation="1"/></filter></defs><style>.label { fill: #123456; }</style><text class="label" x="4" y="20" mask="url(#mask)" filter="url(#blur)">你好 🌍</text><image href="data:image/png;base64,iVBORw0KGgo=" x="0" y="0" width="1" height="1"/>';
  const result = optimizeSVG(wrap(body));
  assert.ok(result.hasImages); assert.ok(result.hasText);
  assert.match(result.data, /你好 🌍/); assert.match(result.data, /url\(#mask\)/); assert.match(result.data, /url\(#blur\)/);
  assert.match(result.data, /data:image\/png;base64,iVBORw0KGgo=/);
  assert.match(result.data, /#123456/);
});

test('optional ID cleanup rewrites referenced IDs, without breaking gradient references', () => {
  const result = optimizeSVG(wrap('<defs><linearGradient id="my-long-gradient"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="100" height="80" fill="url(#my-long-gradient)"/>'), { keepIds: false });
  const ids = Array.from(result.data.matchAll(/\bid="([^"]+)"/g), match => match[1]);
  const references = Array.from(result.data.matchAll(/url\(#([^)]*)\)/g), match => match[1]);
  assert.ok(references.length); references.forEach(id => assert.ok(ids.includes(id)));
});

test('SVG rejects active content, external resources and encoded CSS references before preview', () => {
  const disallowed = [
    '<script>alert(1)</script>', '<rect onclick="alert(1)"/>', '<svg onload="alert(1)"/>',
    '<foreignObject><div>HTML</div></foreignObject>', '<animate attributeName="x"/>',
    '<image href="https://example.test/image.png"/>', '<use href="sprite.svg#icon"/>',
    '<use href="&#x6a;avascript:alert(1)"/>', '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
    '<rect fill="url(https://example.test/a.svg#id)"/>',
    '<style>@import "https://example.test/theme.css";</style>',
    '<style>.a { fill: u\\72l(https://example.test/a); }</style>',
    '<rect style="fill: url(/* comment */https://example.test/a)"/>',
    '<g xml:base="https://example.test/"><use href="#id"/></g>',
    '<rect style="animation: a 1s infinite"/>',
  ];
  for (const body of disallowed) assert.throws(() => optimizeSVG(wrap(body)), body);
  assert.throws(() => optimizeSVG('<!DOCTYPE svg [<!ENTITY x "value">]>' + wrap('<text>&x;</text>')), /实体/);
  assert.throws(() => optimizeSVG('<?xml-stylesheet href="theme.css"?>' + wrap('')), /样式/);
  assert.doesNotMatch(optimizeSVG('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' + wrap('')).data, /DOCTYPE/);
});

test('SVG errors cover malformed XML, missing dimensions and bounded source/structure size', () => {
  assert.throws(() => optimizeSVG(''), /上传/);
  assert.throws(() => optimizeSVG('<svg width="100" height="100"><path></svg>'), /第 1 行/);
  assert.throws(() => optimizeSVG('<html/>'), /根节点/);
  assert.throws(() => optimizeSVG('<svg/>'), /尺寸/);
  assert.throws(() => optimizeSVG(wrap(''), { precision: 1 }), /精度/);
  assert.throws(() => optimizeSVG(wrap('<g>'.repeat(130) + '</g>'.repeat(130))), /复杂/);
  assert.throws(() => optimizeSVG(wrap('<g/>'.repeat(50_001))), /复杂/);
  assert.throws(() => optimizeSVG(wrap('中'.repeat(1_800_000))), /5 MB/);
});

test('SVG dimensions support physical units, viewBox-only and percentage artboards', () => {
  assert.equal(svgLength('1in'), 96); assert.equal(svgLength('2.54cm'), 96); assert.equal(svgLength('72pt'), 96);
  assert.equal(svgLength('100%'), null); assert.equal(svgLength('-1'), null);
  assert.deepEqual(svgDimensions({ viewBox: '-10 -20 200 100' }), { width: 200, height: 100, viewBox: [-10, -20, 200, 100] });
  assert.equal(svgDimensions({ width: '50%', height: 'auto', viewBox: '0 0 300 200' }).width, 300);
  assert.equal(svgDimensions({ width: '600', viewBox: '0 0 300 200' }).height, 400);
  for (const attributes of [{ width: '0', height: '2', viewBox: '0 0 2 2' }, { viewBox: '0 0 0 100' }, { viewBox: '0 0 0x100 100' }, { width: '10', height: 'NaN' }]) assert.throws(() => svgDimensions(attributes));
  const normalized = optimizeSVG('<svg width="2in" height="1in"><rect width="192" height="96" fill="red"/></svg>');
  assert.match(normalized.data, /xmlns="http:\/\/www.w3.org\/2000\/svg"/); assert.match(normalized.data, /viewBox="0 0 192 96"/);
});

test('PNG sizing preserves ratio, fits inside the canvas and enforces memory limits', () => {
  assert.deepEqual(initialPNGSize({ width: 10000, height: 5000 }), { width: 2048, height: 1024 });
  assert.deepEqual(initialPNGSize({ width: .5, height: 2 }), { width: 1, height: 2 });
  assert.deepEqual(containSVG(200, 100, 100, 100), { x: 0, y: 25, width: 100, height: 50 });
  assert.deepEqual(containSVG(100, 200, 100, 100), { x: 25, y: 0, width: 50, height: 100 });
  assert.deepEqual(validatePNGSize(8000, 4000), { width: 8000, height: 4000 });
  for (const [width, height] of [[0, 10], [10.5, 20], [8193, 1], [8192, 8192], [NaN, 10]]) assert.throws(() => validatePNGSize(width, height));
});

test('SVG filenames and statistics preserve Unicode and report file growth truthfully', () => {
  assert.equal(svgFilename('../我的图.svg', 'png'), '-我的图-optimized.png');
  assert.equal(svgFilename('logo-optimized.svg'), 'logo-optimized.svg');
  assert.equal(svgFilename('.SVG'), 'image-optimized.svg');
  assert.deepEqual(svgSavings(100, 125), { bytes: -25, percent: -25 });
  assert.equal(svgByteLength('图🎉'), 7);
});
