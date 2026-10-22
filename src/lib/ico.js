export const ICO_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256]);

export function getIconRect(width, height, size, fit = 'contain') {
  if (![width, height, size].every(value => Number.isFinite(value) && value > 0)) throw new Error('图片尺寸无效。');
  if (fit === 'cover') {
    const edge = Math.min(width, height);
    return { sx: (width - edge) / 2, sy: (height - edge) / 2, sw: edge, sh: edge, dx: 0, dy: 0, dw: size, dh: size };
  }
  const scale = Math.min(size / width, size / height);
  const dw = width * scale, dh = height * scale;
  return { sx: 0, sy: 0, sw: width, sh: height, dx: (size - dw) / 2, dy: (size - dh) / 2, dw, dh };
}

export function iconFilename(value) {
  const name = String(value).replace(/\.ico$/i, '').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100);
  return `${name || 'favicon'}.ico`;
}

// ICO directory + 32-bit DIB images + DWORD-aligned 1-bit transparency masks.
// https://devblogs.microsoft.com/oldnewthing/20101019-00/?p=12503
// https://devblogs.microsoft.com/oldnewthing/20101021-00/?p=12483
export function encodeICO(frames) {
  if (!Array.isArray(frames) || !frames.length || frames.length > ICO_SIZES.length) throw new Error('请至少选择一个图标尺寸。');
  const seen = new Set();
  const entries = frames.map(({ size, rgba }) => {
    if (!ICO_SIZES.includes(size) || seen.has(size)) throw new Error('图标尺寸无效或重复。');
    if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== size * size * 4) throw new Error('图标像素数据不完整。');
    seen.add(size);
    const maskStride = Math.ceil(size / 32) * 4;
    return { size, rgba, maskStride, bytes: 40 + size * size * 4 + maskStride * size };
  });
  const headerBytes = 6 + entries.length * 16;
  const buffer = new ArrayBuffer(headerBytes + entries.reduce((sum, entry) => sum + entry.bytes, 0));
  const data = new DataView(buffer), bytes = new Uint8Array(buffer);
  data.setUint16(2, 1, true); // 1 = icon, rather than cursor.
  data.setUint16(4, entries.length, true);
  let offset = headerBytes;
  entries.forEach(({ size, rgba, maskStride, bytes: length }, index) => {
    const directory = 6 + index * 16;
    data.setUint8(directory, size === 256 ? 0 : size);
    data.setUint8(directory + 1, size === 256 ? 0 : size);
    data.setUint16(directory + 4, 1, true);
    data.setUint16(directory + 6, 32, true);
    data.setUint32(directory + 8, length, true);
    data.setUint32(directory + 12, offset, true);
    data.setUint32(offset, 40, true); // BITMAPINFOHEADER
    data.setInt32(offset + 4, size, true);
    data.setInt32(offset + 8, size * 2, true); // XOR bitmap + AND mask.
    data.setUint16(offset + 12, 1, true);
    data.setUint16(offset + 14, 32, true);
    data.setUint32(offset + 20, length - 40, true);
    const pixelsOffset = offset + 40, maskOffset = pixelsOffset + size * size * 4;
    for (let y = 0; y < size; y++) {
      const row = size - y - 1; // DIB rows are bottom-up.
      for (let x = 0; x < size; x++) {
        const source = (y * size + x) * 4, target = pixelsOffset + (row * size + x) * 4;
        bytes[target] = rgba[source + 2];
        bytes[target + 1] = rgba[source + 1];
        bytes[target + 2] = rgba[source];
        bytes[target + 3] = rgba[source + 3];
        if (rgba[source + 3] === 0) bytes[maskOffset + row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    offset += length;
  });
  return bytes;
}
