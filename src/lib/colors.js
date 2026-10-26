const byte = value => {
  if (!Number.isFinite(value) || value < 0 || value > 255) throw new Error('颜色通道必须在 0–255 之间。');
  return Math.round(value);
};
const rounded = (value, digits = 1) => Number(value.toFixed(digits));
const linear = value => (value /= 255) <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;

export function colorValues(rgba) {
  const [r, g, b, a] = [byte(rgba[0]), byte(rgba[1]), byte(rgba[2]), byte(rgba[3] ?? 255)];
  const channels = [r, g, b].map(value => value / 255), max = Math.max(...channels), min = Math.min(...channels), delta = max - min;
  const l = (max + min) / 2, s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
  let h = !delta ? 0 : max === channels[0] ? ((channels[1] - channels[2]) / delta) % 6 : max === channels[1] ? (channels[2] - channels[0]) / delta + 2 : (channels[0] - channels[1]) / delta + 4;
  h = rounded((h * 60 + 360) % 360) % 360;
  const alpha = rounded(a / 255, 3), suffix = a === 255 ? '' : ` / ${alpha}`;
  return {
    r, g, b, a, alpha, h, s: rounded(s * 100), l: rounded(l * 100),
    hex: `#${[r, g, b, ...(a === 255 ? [] : [a])].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`,
    rgb: `rgb(${r} ${g} ${b}${suffix})`, hsl: `hsl(${h} ${rounded(s * 100)}% ${rounded(l * 100)}%${suffix})`,
  };
}

// Public-domain sRGB → Oklab matrices by Björn Ottosson:
// https://bottosson.github.io/posts/oklab/ (2021-01-25 matrices).
export function rgbToOKLab(rgb) {
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .7936177850 * m - .0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .8086757660 * s];
}
const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export function extractPalette(data, count = 6) {
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length % 4 || data.length > 256 * 256 * 4) throw new Error('配色抽样数据无效。');
  if (!Number.isInteger(count) || count < 5 || count > 8) throw new Error('请选择 5–8 个代表色。');
  const histogram = new Map(); let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const alpha = data[i + 3] / 255;
    const rgb = [0, 1, 2].map(c => Math.round(data[i + c] * alpha + 255 * (1 - alpha)));
    const key = ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3);
    let bin = histogram.get(key);
    if (!bin) { bin = { key, weight: 0, sum: [0, 0, 0] }; histogram.set(key, bin); }
    bin.weight++; total++; for (let c = 0; c < 3; c++) bin.sum[c] += rgb[c];
  }
  if (!total) return [];
  const points = [...histogram.values()].sort((a, b) => b.weight - a.weight || a.key - b.key).map(bin => {
    const rgb = bin.sum.map(value => Math.round(value / bin.weight));
    return { rgb, lab: rgbToOKLab(rgb), weight: bin.weight };
  });
  // Deterministic weighted farthest-point seeding, then weighted Lloyd iterations.
  const centers = [[...points[0].lab]], nearest = points.map(point => distance(point.lab, centers[0]));
  while (centers.length < Math.min(count, points.length)) {
    let best = -1, score = 0;
    for (let i = 0; i < points.length; i++) {
      const candidate = nearest[i] * Math.sqrt(points[i].weight);
      if (candidate > score) { score = candidate; best = i; }
    }
    if (best < 0 || nearest[best] < 1e-10) break;
    const next = [...points[best].lab]; centers.push(next);
    for (let i = 0; i < points.length; i++) nearest[i] = Math.min(nearest[i], distance(points[i].lab, next));
  }
  const closest = point => {
    let result = 0, best = Infinity;
    for (let k = 0; k < centers.length; k++) { const d = distance(point.lab, centers[k]); if (d < best) { best = d; result = k; } }
    return result;
  };
  for (let iteration = 0; iteration < 18; iteration++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const point of points) { const sum = sums[closest(point)]; for (let c = 0; c < 3; c++) sum[c] += point.lab[c] * point.weight; sum[3] += point.weight; }
    let movement = 0;
    for (let k = 0; k < centers.length; k++) {
      if (!sums[k][3]) continue;
      const next = sums[k].slice(0, 3).map(value => value / sums[k][3]); movement += distance(next, centers[k]); centers[k] = next;
    }
    if (movement < 1e-10) break;
  }
  const groups = centers.map(() => ({ weight: 0, representative: null, distance: Infinity }));
  for (const point of points) {
    const index = closest(point), group = groups[index], d = distance(point.lab, centers[index]);
    group.weight += point.weight;
    if (d < group.distance) { group.distance = d; group.representative = point.rgb; }
  }
  return groups.filter(group => group.weight).sort((a, b) => b.weight - a.weight).map(group => ({ ...colorValues(group.representative), fraction: group.weight / total }));
}

export function imagePoint(x, y, displayWidth, displayHeight, width, height) {
  if (![x, y, displayWidth, displayHeight, width, height].every(Number.isFinite) || displayWidth <= 0 || displayHeight <= 0 || width < 1 || height < 1) throw new Error('图片坐标无效。');
  return { x: Math.max(0, Math.min(width - 1, Math.floor(x / displayWidth * width))), y: Math.max(0, Math.min(height - 1, Math.floor(y / displayHeight * height))) };
}
export function paletteCSS(colors) {
  return `:root {\n${colors.map((color, index) => `  --color-${index + 1}: ${color.hex};`).join('\n')}\n}`;
}
export function paletteJSON(colors, name, sample) {
  return JSON.stringify({ name, colorSpace: 'sRGB', method: 'sampled-oklab', transparency: 'fully-transparent-ignored; partial-alpha-on-white', sample, colors: colors.map(color => ({ hex: color.hex, rgb: color.rgb, hsl: color.hsl, fraction: rounded(color.fraction, 6) })) }, null, 2);
}
export function paletteFilename(name, extension) {
  const base = name.replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '-').replace(/[. ]+$/g, '').slice(0, 70) || 'image';
  return `${base}-palette.${extension}`;
}
