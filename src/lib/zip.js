const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Images are already compressed: ZIP's STORE method avoids recompression.
export function createZIP(files) {
  if (!files.length || files.length > 1000) throw new Error('没有可打包的图片。');
  const encoder = new TextEncoder(), used = new Set();
  const entries = files.map(({ name, data }) => {
    if (!(data instanceof Uint8Array)) throw new Error('下载数据不完整。');
    name = name.replace(/[\u0000-\u001f/\\:*?"<>|]/g, '-').replace(/^[.\s]+/, '') || 'image';
    const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, extension = dot > 0 ? name.slice(dot) : '';
    let unique = name, number = 2;
    while (used.has(unique.toLowerCase())) unique = `${stem}-${number++}${extension}`;
    used.add(unique.toLowerCase());
    return { name: encoder.encode(unique), data, crc: crc32(data) };
  });
  const size = entries.reduce((total, item) => total + 76 + item.name.length * 2 + item.data.length, 22);
  if (size > 256 * 1024 * 1024) throw new Error('打包内容超过 256 MB，请分别下载。');
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  let offset = 0;
  for (const item of entries) {
    item.offset = offset;
    view.setUint32(offset, 0x04034b50, true); view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x800, true); view.setUint16(offset + 12, 33, true);
    view.setUint32(offset + 14, item.crc, true);
    view.setUint32(offset + 18, item.data.length, true); view.setUint32(offset + 22, item.data.length, true);
    view.setUint16(offset + 26, item.name.length, true);
    bytes.set(item.name, offset + 30); bytes.set(item.data, offset + 30 + item.name.length);
    offset += 30 + item.name.length + item.data.length;
  }
  const centralOffset = offset;
  for (const item of entries) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true); view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x800, true); view.setUint16(offset + 14, 33, true);
    view.setUint32(offset + 16, item.crc, true);
    view.setUint32(offset + 20, item.data.length, true); view.setUint32(offset + 24, item.data.length, true);
    view.setUint16(offset + 28, item.name.length, true); view.setUint32(offset + 42, item.offset, true);
    bytes.set(item.name, offset + 46); offset += 46 + item.name.length;
  }
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, entries.length, true); view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, offset - centralOffset, true); view.setUint32(offset + 16, centralOffset, true);
  return bytes;
}
