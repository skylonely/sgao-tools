import qrcodegen from '../vendor/qrcodegen.js';

export const QR_MAX_BYTES = 1200;
export const QR_BORDER = 4;
const encoder = new TextEncoder();

export function byteLength(text) { return encoder.encode(text).length; }
export function wifiEscape(value) { return String(value).replace(/[\\;,:\"]/g, '\\$&'); }

export function buildQRContent({ type = 'url', text = '', ssid = '', password = '', security = 'WPA', hidden = false } = {}) {
  let content;
  if (type === 'wifi') {
    if (!ssid.trim()) throw new Error('请填写 Wi-Fi 名称。');
    if (byteLength(ssid) > 32) throw new Error('Wi-Fi 名称不能超过 32 个 UTF-8 字节。');
    if (!['WPA', 'WEP', 'nopass'].includes(security)) throw new Error('请选择有效的 Wi-Fi 加密方式。');
    if (security !== 'nopass' && !password) throw new Error('请填写 Wi-Fi 密码，或选择「无密码」。');
    content = `WIFI:T:${security};S:${wifiEscape(ssid)};${security === 'nopass' ? '' : `P:${wifiEscape(password)};`}H:${hidden ? 'true' : 'false'};;`;
  } else if (type === 'url') {
    content = text.trim();
    try {
      const url = new URL(content);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
    } catch { throw new Error('请输入以 https:// 或 http:// 开头的完整网址。'); }
  } else if (type === 'text') {
    content = text;
    if (!content.trim()) throw new Error('请先输入要生成二维码的文字。');
  } else throw new Error('不支持的二维码类型。');
  if (byteLength(content) > QR_MAX_BYTES) throw new Error(`内容过长，请控制在 ${QR_MAX_BYTES} 个 UTF-8 字节以内（中文通常每字 3 字节）。`);
  return content;
}

function luminance(hex) {
  return hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}

export function validateQRColors(foreground, background) {
  if (![foreground, background].every(value => /^#[0-9a-f]{6}$/i.test(value))) throw new Error('请选择有效的二维码颜色。');
  const dark = luminance(foreground), light = luminance(background);
  const contrast = (light + .05) / (dark + .05);
  if (dark >= light || contrast < 4.5) throw new Error('请使用深色二维码、浅色背景，并提高两者的对比度。');
  return contrast;
}

export function makeQRCode(content, { level = 'M', logo = false } = {}) {
  if (!content || byteLength(content) > QR_MAX_BYTES) throw new Error('二维码内容为空或超过长度上限。');
  const selected = logo ? 'H' : level;
  const levels = { L: qrcodegen.QrCode.Ecc.LOW, M: qrcodegen.QrCode.Ecc.MEDIUM, Q: qrcodegen.QrCode.Ecc.QUARTILE, H: qrcodegen.QrCode.Ecc.HIGH };
  if (!levels[selected]) throw new Error('无效的容错等级。');
  // ECI 26 explicitly identifies UTF-8, including Chinese and emoji, to scanners.
  const segments = qrcodegen.QrSegment.makeSegments(content);
  if (/[^\x00-\x7f]/.test(content)) segments.unshift(qrcodegen.QrSegment.makeEci(26));
  return qrcodegen.QrCode.encodeSegments(segments, levels[selected], 1, 40, -1, false);
}

export function qrGeometry(qr, requestedSize = 512) {
  if (!Number.isInteger(requestedSize) || requestedSize < 128 || requestedSize > 4096) throw new Error('导出尺寸需在 128–4096 像素之间。');
  const grid = qr.size + QR_BORDER * 2;
  return { grid, pixels: Math.max(requestedSize, grid * 4) };
}

export function qrLogoBox(qr) {
  const size = Math.max(3, Math.floor(qr.size * .18) | 1);
  return { x: (qr.size - size) / 2 + QR_BORDER, y: (qr.size - size) / 2 + QR_BORDER, size, padding: 1 };
}

export function qrSVG(qr, { foreground = '#20232b', background = '#ffffff', size = 512, logoData = '' } = {}) {
  validateQRColors(foreground, background);
  const { grid, pixels } = qrGeometry(qr, size);
  let path = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size;) {
      if (!qr.getModule(x, y)) { x++; continue; }
      const start = x;
      while (x < qr.size && qr.getModule(x, y)) x++;
      path += `M${start + QR_BORDER},${y + QR_BORDER}h${x - start}v1h-${x - start}z`;
    }
  }
  let logo = '';
  if (logoData) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logoData)) throw new Error('Logo 数据格式无效。');
    const box = qrLogoBox(qr), p = box.padding;
    logo = `<rect x="${box.x - p}" y="${box.y - p}" width="${box.size + 2 * p}" height="${box.size + 2 * p}" fill="${background}"/><image href="${logoData}" x="${box.x}" y="${box.y}" width="${box.size}" height="${box.size}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${grid} ${grid}"><rect width="${grid}" height="${grid}" fill="${background}"/><path d="${path}" fill="${foreground}" shape-rendering="crispEdges"/>${logo}</svg>`;
}

export function paintQRCode(canvas, qr, { foreground = '#20232b', background = '#ffffff', size = 512, logo = null } = {}) {
  validateQRColors(foreground, background);
  const { grid, pixels } = qrGeometry(qr, size);
  canvas.width = canvas.height = pixels;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器无法绘制二维码，请更新浏览器后重试。');
  context.fillStyle = background;
  context.fillRect(0, 0, pixels, pixels);
  context.fillStyle = foreground;
  const pos = value => Math.round(value * pixels / grid);
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
    if (qr.getModule(x, y)) context.fillRect(pos(x + QR_BORDER), pos(y + QR_BORDER), pos(x + QR_BORDER + 1) - pos(x + QR_BORDER), pos(y + QR_BORDER + 1) - pos(y + QR_BORDER));
  }
  if (logo) {
    const box = qrLogoBox(qr), p = box.padding;
    context.fillStyle = background;
    context.fillRect(pos(box.x - p), pos(box.y - p), pos(box.x + box.size + p) - pos(box.x - p), pos(box.y + box.size + p) - pos(box.y - p));
    const side = pos(box.x + box.size) - pos(box.x);
    const scale = Math.min(side / logo.width, side / logo.height);
    context.drawImage(logo, pos(box.x) + (side - logo.width * scale) / 2, pos(box.y) + (side - logo.height * scale) / 2, logo.width * scale, logo.height * scale);
  }
  return context;
}

export function safeQRLink(content) {
  try { const url = new URL(content); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
