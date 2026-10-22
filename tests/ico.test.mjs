import test from 'node:test';
import assert from 'node:assert/strict';
import { ICO_SIZES, encodeICO, getIconRect, iconFilename } from '../src/lib/ico.js';

const frame = size => ({ size, rgba: new Uint8ClampedArray(size * size * 4).fill(255) });

test('ICO directory describes every size, exact offsets, and 256 px encoding', () => {
  const bytes = encodeICO(ICO_SIZES.map(frame)), view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(0, true), 0);
  assert.equal(view.getUint16(2, true), 1);
  assert.equal(view.getUint16(4, true), 7);
  let expectedOffset = 6 + 7 * 16;
  ICO_SIZES.forEach((size, index) => {
    const entry = 6 + index * 16, maskStride = Math.ceil(size / 32) * 4;
    const length = 40 + size * size * 4 + maskStride * size;
    assert.equal(view.getUint8(entry), size === 256 ? 0 : size);
    assert.equal(view.getUint8(entry + 1), size === 256 ? 0 : size);
    assert.equal(view.getUint16(entry + 4, true), 1);
    assert.equal(view.getUint16(entry + 6, true), 32);
    assert.equal(view.getUint32(entry + 8, true), length);
    assert.equal(view.getUint32(entry + 12, true), expectedOffset);
    assert.equal(view.getUint32(expectedOffset, true), 40);
    assert.equal(view.getInt32(expectedOffset + 4, true), size);
    assert.equal(view.getInt32(expectedOffset + 8, true), size * 2);
    assert.equal(view.getUint32(expectedOffset + 16, true), 0);
    expectedOffset += length;
  });
  assert.equal(bytes.length, expectedOffset);
});

test('ICO pixels use bottom-up BGRA, preserving partial and full transparency', () => {
  const image = frame(24);
  image.rgba.set([10, 20, 30, 128], 0);
  image.rgba.set([40, 50, 60, 0], 4);
  image.rgba.set([70, 80, 90, 255], 23 * 24 * 4);
  const bytes = encodeICO([image]), dibOffset = 22;
  assert.deepEqual([...bytes.slice(dibOffset + 40, dibOffset + 44)], [90, 80, 70, 255]);
  const lastRow = dibOffset + 40 + 23 * 24 * 4;
  assert.deepEqual([...bytes.slice(lastRow, lastRow + 8)], [30, 20, 10, 128, 60, 50, 40, 0]);
  const mask = dibOffset + 40 + 24 * 24 * 4;
  assert.equal(bytes[mask + 23 * 4], 0x40);
  assert.deepEqual([...bytes.slice(mask + 23 * 4 + 1, mask + 24 * 4)], [0, 0, 0]);
});

test('ICO rejects empty, duplicate, invalid-size and incomplete pixel inputs', () => {
  for (const images of [[], [frame(17)], [frame(16), frame(16)], [{ size: 32, rgba: new Uint8Array(5) }], [{ size: 16, rgba: new Array(1024) }]]) assert.throws(() => encodeICO(images));
});

test('image fitting contains or center-crops without distortion', () => {
  assert.deepEqual(getIconRect(200, 100, 32), { sx: 0, sy: 0, sw: 200, sh: 100, dx: 0, dy: 8, dw: 32, dh: 16 });
  assert.deepEqual(getIconRect(100, 200, 32), { sx: 0, sy: 0, sw: 100, sh: 200, dx: 8, dy: 0, dw: 16, dh: 32 });
  assert.deepEqual(getIconRect(200, 100, 32, 'cover'), { sx: 50, sy: 0, sw: 100, sh: 100, dx: 0, dy: 0, dw: 32, dh: 32 });
  assert.throws(() => getIconRect(0, 100, 32));
});

test('ICO filenames get one extension and remove path and control characters', () => {
  assert.equal(iconFilename('logo.ICO'), 'logo.ico');
  assert.equal(iconFilename(' . '), 'favicon.ico');
  assert.equal(iconFilename('我的图标'), '我的图标.ico');
  assert.equal(iconFilename('../a\\b\n'), '-a-b-.ico');
});
