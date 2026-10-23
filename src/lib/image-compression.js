import { crc32 } from './zip.js';

export const PROFILES = Object.freeze({
  balanced: { threshold: 0.985, minQuality: 0.48, colors: [256, 128, 64] },
  quality: { threshold: 0.995, minQuality: 0.68, colors: [256, 192] },
  small: { threshold: 0.965, minQuality: 0.36, colors: [256, 128, 64, 32] },
});
export function resizeDimensions(width, height, maxEdge = 0) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0) || !Number.isInteger(maxEdge) || maxEdge < 0) throw new Error('图片尺寸无效。');
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(width, height)) : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function imageFilename(name, mime) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }[mime];
  if (!extension) throw new Error('不支持的输出格式。');
  const stem = name.replace(/\.[^.]*$/, '').replace(/[\u0000-\u001f/\\:*?"<>|]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120) || 'image';
  return `${stem}-optimized.${extension}`;
}
export function savings(before, after) {
  return { bytes: before - after, percent: before ? (1 - after / before) * 100 : 0 };
}

// Local 8x8 luminance SSIM plus independent colour and alpha error checks.
// This is a quality heuristic on a preview, not a guarantee of visual identity.
export function perceptualScore(reference, candidate, width, height) {
  const length = width * height * 4;
  if (!width || !height || reference.length !== length || candidate.length !== length) throw new Error('画质对比尺寸不匹配。');
  const lumaA = new Float32Array(width * height), lumaB = new Float32Array(width * height);
  let colourError = 0, alphaError = 0;
  for (let p = 0, i = 0; p < length; p += 4, i++) {
    const aa = reference[p + 3] / 255, ab = candidate[p + 3] / 255;
    const a = [], b = [];
    for (let c = 0; c < 3; c++) {
      a[c] = reference[p + c] * aa + 255 * (1 - aa); b[c] = candidate[p + c] * ab + 255 * (1 - ab);
      colourError += (a[c] - b[c]) ** 2;
    }
    alphaError += Math.abs(aa - ab);
    lumaA[i] = a[0] * .2126 + a[1] * .7152 + a[2] * .0722;
    lumaB[i] = b[0] * .2126 + b[1] * .7152 + b[2] * .0722;
  }
  let sum = 0, count = 0;
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
    let n = 0, a = 0, b = 0, a2 = 0, b2 = 0, ab = 0;
    for (let yy = y; yy < Math.min(height, y + 8); yy++) for (let xx = x; xx < Math.min(width, x + 8); xx++) {
      const i = yy * width + xx, va = lumaA[i], vb = lumaB[i];
      n++; a += va; b += vb; a2 += va * va; b2 += vb * vb; ab += va * vb;
    }
    const ma = a / n, mb = b / n, va = Math.max(0, a2 / n - ma * ma), vb = Math.max(0, b2 / n - mb * mb), cov = ab / n - ma * mb;
    sum += ((2 * ma * mb + 6.5025) * (2 * cov + 58.5225)) / ((ma * ma + mb * mb + 6.5025) * (va + vb + 58.5225)); count++;
  }
  const pixels = width * height;
  return Math.max(0, Math.min(1, sum / count, 1 - colourError / (pixels * 3 * 255 ** 2) * 8, 1 - alphaError / pixels * 4));
}

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
function check(signal) { if (signal?.aborted) throw new DOMException('处理已取消', 'AbortError'); }
function chunk(type, payload) {
  const label = new TextEncoder().encode(type), output = new Uint8Array(payload.length + 12), view = new DataView(output.buffer);
  view.setUint32(0, payload.length); output.set(label, 4); output.set(payload, 8);
  view.setUint32(output.length - 4, crc32(output.subarray(4, output.length - 4)));
  return output;
}

export async function encodeIndexedPNG(rgba, width, height, maxColors = 256, signal) {
  if (rgba.length !== width * height * 4 || !width || !height || maxColors < 2 || maxColors > 256) throw new Error('PNG 像素数据无效。');
  const counts = new Uint32Array(65536), sums = new Float64Array(65536 * 4);
  let transparent = false;
  const keyOf = p => (rgba[p] >> 4) << 12 | (rgba[p + 1] >> 4) << 8 | (rgba[p + 2] >> 4) << 4 | (rgba[p + 3] >> 4);
  for (let p = 0; p < rgba.length; p += 4) {
    if (p % 1_048_576 === 0) { check(signal); await pause(); }
    if (rgba[p + 3] === 0) { transparent = true; continue; }
    const key = keyOf(p); counts[key]++;
    for (let c = 0; c < 4; c++) sums[key * 4 + c] += rgba[p + c];
  }
  const colors = [];
  for (let key = 0; key < counts.length; key++) if (counts[key]) colors.push({ key, n: counts[key], color: [0, 1, 2, 3].map(c => sums[key * 4 + c] / counts[key]) });
  function box(items) {
    const ranges = [0, 1, 2, 3].map(c => {
      let min = 255, max = 0;
      for (const item of items) { min = Math.min(min, item.color[c]); max = Math.max(max, item.color[c]); }
      return (max - min) * (c === 3 ? 1.5 : c === 1 ? 1.2 : 1);
    });
    const population = items.reduce((n, item) => n + item.n, 0), range = Math.max(...ranges);
    return { items, population, channel: ranges.indexOf(range), priority: items.length > 1 ? range * Math.sqrt(population) : -1 };
  }
  const boxes = colors.length ? [box(colors)] : [];
  const limit = maxColors - Number(transparent);
  while (boxes.length < limit) {
    check(signal);
    let index = -1, priority = -1;
    boxes.forEach((item, i) => { if (item.priority > priority) { priority = item.priority; index = i; } });
    if (index < 0) break;
    const current = boxes[index], items = current.items.sort((a, b) => a.color[current.channel] - b.color[current.channel]);
    let population = 0, split = 1;
    for (let i = 0; i < items.length - 1; i++) { population += items[i].n; split = i + 1; if (population >= current.population / 2) break; }
    boxes.splice(index, 1, box(items.slice(0, split)), box(items.slice(split)));
  }
  const palette = transparent ? [[0, 0, 0, 0]] : [];
  for (const item of boxes) palette.push([0, 1, 2, 3].map(c => Math.round(item.items.reduce((total, color) => total + color.color[c] * color.n, 0) / item.population)));
  const lookup = new Uint16Array(65536).fill(65535);
  const metric = color => [color[0] * color[3] / 255, color[1] * color[3] / 255, color[2] * color[3] / 255, color[3]];
  const measures = palette.map(metric);
  for (let i = 0; i < colors.length; i++) {
    if (i % 1024 === 0) { check(signal); await pause(); }
    const color = colors[i], value = metric(color.color);
    let nearest = 0, distance = Infinity;
    measures.forEach((p, index) => {
      const d = (p[0] - value[0]) ** 2 + (p[1] - value[1]) ** 2 * 1.2 + (p[2] - value[2]) ** 2 + (p[3] - value[3]) ** 2 * 2;
      if (d < distance) { nearest = index; distance = d; }
    });
    lookup[color.key] = nearest;
  }
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    if (y % 128 === 0) { check(signal); await pause(); }
    for (let x = 0; x < width; x++) { const p = (y * width + x) * 4; raw[y * (width + 1) + 1 + x] = rgba[p + 3] === 0 ? 0 : lookup[keyOf(p)]; }
  }
  const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  check(signal);
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer); view.setUint32(0, width); view.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 3;
  const plte = new Uint8Array(palette.length * 3); palette.forEach((color, i) => plte.set(color.slice(0, 3), i * 3));
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', Uint8Array.from(palette, color => color[3])), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())], { type: 'image/png' });
}

// Reject animation rather than silently flattening an animated image.
export function inspectImage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), text = (offset, n) => String.fromCharCode(...bytes.subarray(offset, offset + n));
  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 3) === 'PNG') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset), type = text(offset + 4, 4);
      if (type === 'acTL') throw new Error('暂不处理动画 PNG，请使用静态图片。');
      if (type === 'IDAT') break;
      if (length > bytes.length - offset - 12) break;
      offset += length + 12;
    }
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: 'image/jpeg' };
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = text(offset, 4), length = view.getUint32(offset + 4, true);
      if (type === 'ANIM' || type === 'ANMF' || type === 'VP8X' && length >= 10 && (bytes[offset + 8] & 2)) throw new Error('暂不处理动态 WebP，请使用静态图片。');
      if (length > bytes.length - offset - 8) break;
      offset += 8 + length + (length & 1);
    }
    return { mime: 'image/webp' };
  }
  if (bytes.length >= 16 && text(4, 4) === 'ftyp') {
    const end = Math.min(view.getUint32(0), bytes.length), brands = [];
    for (let i = 8; i + 4 <= end; i += 4) if (i !== 12) brands.push(text(i, 4));
    if (brands.includes('avis')) throw new Error('暂不处理动态 AVIF，请使用静态图片。');
    if (brands.includes('avif')) return { mime: 'image/avif' };
  }
  throw new Error('请选择有效的静态 JPG、PNG、WebP 或 AVIF 图片。');
}
