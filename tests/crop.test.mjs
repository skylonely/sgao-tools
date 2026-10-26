import test from 'node:test';
import assert from 'node:assert/strict';
import { orientedSize, boundCrop, fitCrop, moveCrop, resizeCrop, drawCrop, editCrop, defaultOutput, validateOutput, outputPlacement, cropFilename } from '../src/lib/crop.js';
import { paintOriented } from '../src/crop-engine.js';

test('crop presets, rotation bounds and whole-image selection use source pixel coordinates', () => {
  assert.deepEqual(orientedSize(1200, 800, 1), { width: 800, height: 1200 });
  assert.deepEqual(orientedSize(1200, 800, -2), { width: 1200, height: 800 });
  assert.deepEqual(fitCrop({ width: 1200, height: 800 }, 1), { x: 200, y: 0, width: 800, height: 800 });
  assert.deepEqual(fitCrop({ width: 1200, height: 800 }, 16 / 9), { x: 0, y: 63, width: 1200, height: 675 });
  assert.deepEqual(fitCrop({ width: 1, height: 10000 }), { x: 0, y: 0, width: 1, height: 10000 });
});

test('move, free resize and numeric editing keep the crop inside the image without crossing edges', () => {
  const bounds = { width: 1200, height: 800 }, rect = { x: 100, y: 100, width: 400, height: 300 };
  assert.deepEqual(moveCrop(rect, -1000, 2000, bounds), { x: 0, y: 500, width: 400, height: 300 });
  assert.deepEqual(resizeCrop(rect, 'nw', 1000, 1000, bounds), { x: 499, y: 399, width: 1, height: 1 });
  assert.deepEqual(editCrop(rect, 'width', 2000, bounds), { x: 100, y: 100, width: 1100, height: 300 });
  assert.deepEqual(editCrop(rect, 'width', 600, bounds, 4 / 3), { x: 100, y: 100, width: 600, height: 450 });
  assert.throws(() => editCrop(rect, 'width', 0, bounds));
  assert.throws(() => editCrop(rect, 'x', -1, bounds));
  assert.throws(() => editCrop(rect, 'height', NaN, bounds));
});

test('locked corner and edge handles preserve ratios and anchors even for extreme pointer movement', () => {
  const bounds = { width: 1200, height: 800 }, rect = { x: 200, y: 100, width: 400, height: 300 };
  const grown = resizeCrop(rect, 'se', 200, 150, bounds, 4 / 3);
  assert.deepEqual(grown, { x: 200, y: 100, width: 600, height: 450 });
  const upperLeft = resizeCrop(rect, 'nw', -200, -150, bounds, 4 / 3);
  assert.equal(upperLeft.x + upperLeft.width, rect.x + rect.width);
  assert.equal(upperLeft.y + upperLeft.height, rect.y + rect.height);
  const side = resizeCrop(rect, 'e', 200, 0, bounds, 4 / 3);
  assert.equal(side.y + side.height / 2, rect.y + rect.height / 2);
});

test('randomized dragging remains bounded with all presets, every handle and reversed drawing', () => {
  let seed = 1031;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  function inside(rect, bounds) {
    assert.ok(Object.values(rect).every(Number.isInteger));
    assert.ok(rect.width >= 1 && rect.height >= 1 && rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= bounds.width && rect.y + rect.height <= bounds.height);
  }
  for (let i = 0; i < 400; i++) {
    const bounds = { width: 1 + Math.floor(random() * 10000), height: 1 + Math.floor(random() * 10000) }, ratio = [0, 1, 4 / 3, 3 / 4, 16 / 9, 9 / 16][i % 6];
    const rect = boundCrop({ x: random() * bounds.width, y: random() * bounds.height, width: random() * bounds.width, height: random() * bounds.height }, bounds);
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const result = resizeCrop(rect, handle, (random() - .5) * 20000, (random() - .5) * 20000, bounds, ratio);
      inside(result, bounds);
      if (ratio) assert.ok(Math.abs(result.width - result.height * ratio) <= 1 + ratio);
    }
    inside(drawCrop({ x: random() * bounds.width, y: random() * bounds.height }, { x: random() * bounds.width, y: random() * bounds.height }, bounds, ratio), bounds);
    inside(moveCrop(rect, 20000 * random(), -20000 * random(), bounds), bounds);
  }
});

test('output dimensions enforce both edge and area limits; contain and stretch have distinct placements', () => {
  assert.throws(() => validateOutput(8193, 1));
  assert.throws(() => validateOutput(8192, 8192));
  assert.throws(() => validateOutput(1.5, 500));
  assert.throws(() => validateOutput(0, 100));
  assert.deepEqual(defaultOutput({ width: 10000, height: 1 }), { width: 8192, height: 1 });
  for (const rect of [{ width: 10000, height: 3200 }, { width: 10000, height: 10000 }, { width: 1, height: 10000 }]) {
    const size = defaultOutput(rect); assert.doesNotThrow(() => validateOutput(size.width, size.height));
  }
  assert.deepEqual(outputPlacement({ width: 800, height: 400 }, 512, 512), { x: 0, y: 128, width: 512, height: 256 });
  assert.deepEqual(outputPlacement({ width: 800, height: 400 }, 512, 512, 'stretch'), { x: 0, y: 0, width: 512, height: 512 });
});

test('orientation matrices rotate and mirror source corners into the visible coordinate system', () => {
  for (const turns of [0, 1, 2, 3]) for (const flipX of [false, true]) for (const flipY of [false, true]) {
    let matrix = [1, 0, 0, 1, 0, 0], stack = [], corners;
    const ctx = {
      save() { stack.push([...matrix]); }, restore() { matrix = stack.pop(); },
      translate(x, y) { matrix[4] += matrix[0] * x + matrix[2] * y; matrix[5] += matrix[1] * x + matrix[3] * y; },
      scale(x, y) { matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y; },
      rotate(angle) { const [a, b, c, d] = matrix, cos = Math.cos(angle), sin = Math.sin(angle); [matrix[0], matrix[1], matrix[2], matrix[3]] = [a * cos + c * sin, b * cos + d * sin, -a * sin + c * cos, -b * sin + d * cos]; },
      drawImage() { corners = [[0, 0], [120, 0], [0, 80], [120, 80]].map(([x, y]) => [Math.round(matrix[0] * x + matrix[2] * y + matrix[4]), Math.round(matrix[1] * x + matrix[3] * y + matrix[5])]); },
    };
    paintOriented(ctx, { width: 120, height: 80 }, turns, flipX, flipY);
    const size = orientedSize(120, 80, turns);
    assert.deepEqual(new Set(corners.map(point => point.join(','))), new Set([[0, 0], [size.width, 0], [0, size.height], [size.width, size.height]].map(point => point.join(','))));
    let [x, y] = [[0, 0], [80, 0], [120, 80], [0, 120]][turns];
    if (flipX) x = size.width - x; if (flipY) y = size.height - y;
    assert.deepEqual(corners[0], [x, y]);
    assert.deepEqual(matrix, [1, 0, 0, 1, 0, 0]);
  }
});

test('crop filenames use the actual format and remove paths and control characters', () => {
  assert.equal(cropFilename('logo.old.png', 'image/webp'), 'logo.old-cropped.webp');
  assert.equal(cropFilename('../bad/name\u0000.jpg', 'image/png'), '-bad-name--cropped.png');
  assert.equal(cropFilename('', 'image/jpeg'), 'image-cropped.jpg');
  assert.throws(() => cropFilename('test', 'image/avif'));
});
