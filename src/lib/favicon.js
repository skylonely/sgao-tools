import { getIconRect, ICO_SIZES } from './ico.js';

export const FAVICON_PNGS = Object.freeze([
  { name: 'favicon-16x16.png', size: 16, kind: 'browser', label: '浏览器 · 小图标' },
  { name: 'favicon-32x32.png', size: 32, kind: 'browser', label: '浏览器 · 高清标签' },
  { name: 'favicon-48x48.png', size: 48, kind: 'browser', label: '浏览器 · 通用图标' },
  { name: 'favicon-96x96.png', size: 96, kind: 'browser', label: '浏览器 · 大尺寸' },
  { name: 'apple-touch-icon.png', size: 180, kind: 'apple', label: 'Apple Touch 主屏幕' },
  { name: 'android-chrome-192x192.png', size: 192, kind: 'pwa', label: 'PWA · 通用图标' },
  { name: 'android-chrome-512x512.png', size: 512, kind: 'pwa', label: 'PWA · 高清图标' },
  { name: 'maskable-icon-192x192.png', size: 192, kind: 'maskable', label: 'PWA · 自适应图标' },
  { name: 'maskable-icon-512x512.png', size: 512, kind: 'maskable', label: 'PWA · 高清自适应' },
].map(Object.freeze));

export function faviconDirectory(value, label = '部署路径') {
  const input = String(value).trim();
  if (!input.startsWith('/') || input.startsWith('//') || /[?#\\\s\x00-\x1f\x7f]/.test(input)) throw new Error(`${label}需为本站绝对目录，例如 / 或 /assets/icons/。`);
  const segments = input.split('/').filter(Boolean).map(segment => {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { throw new Error(`${label}包含无效的百分号编码。`); }
    if (/%[0-9a-f]{2}/i.test(decoded)) throw new Error(`${label}不能重复进行百分号编码，请使用原始目录名。`);
    if (['.', '..'].includes(decoded) || /[\x00-\x20\x7f/\\?#<>:"|*]/.test(decoded)) throw new Error(`${label}不能包含上级目录、特殊路径或空白字符。`);
    return encodeURIComponent(decoded).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  });
  return segments.length ? `/${segments.join('/')}/` : '/';
}

export function faviconConfig({ name = '我的网站', shortName = '我的网站', themeColor = '#ec6245', appBackground = '#ffffff', assetPath = '/', appPath = '/', display = 'standalone' } = {}) {
  name = String(name).trim(); shortName = String(shortName).trim();
  if (!name || Array.from(name).length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('应用名称需为 1–80 个字符。');
  if (!shortName || Array.from(shortName).length > 24 || /[\x00-\x1f\x7f]/.test(shortName)) throw new Error('应用短名称需为 1–24 个字符。');
  if (![themeColor, appBackground].every(value => /^#[0-9a-f]{6}$/i.test(value))) throw new Error('请选择有效的主题色和应用底色。');
  if (!['standalone', 'minimal-ui', 'browser'].includes(display)) throw new Error('请选择有效的应用打开方式。');
  return { name, shortName, themeColor, appBackground, assetPath: faviconDirectory(assetPath, '图标部署路径'), appPath: faviconDirectory(appPath, '应用入口路径'), display };
}

export function faviconRect(width, height, size, fit = 'contain', kind = 'browser') {
  if (!['contain', 'cover'].includes(fit)) throw new Error('请选择有效的图片适配方式。');
  const rect = getIconRect(width, height, size, fit);
  if (kind === 'maskable') {
    // Fit every corner of the logo bounds inside the central circle of radius 40%.
    const scale = size * .8 / Math.hypot(rect.dw, rect.dh);
    return { ...rect, dx: (size - rect.dw * scale) / 2, dy: (size - rect.dh * scale) / 2, dw: rect.dw * scale, dh: rect.dh * scale };
  }
  if (kind === 'apple') return { ...rect, dx: size * .08 + rect.dx * .84, dy: size * .08 + rect.dy * .84, dw: rect.dw * .84, dh: rect.dh * .84 };
  return rect;
}

export function faviconManifest(config) {
  return {
    id: config.appPath, name: config.name, short_name: config.shortName,
    start_url: config.appPath, scope: config.appPath, display: config.display,
    theme_color: config.themeColor, background_color: config.appBackground,
    icons: FAVICON_PNGS.filter(icon => ['pwa', 'maskable'].includes(icon.kind)).map(icon => ({
      src: `./${icon.name}`, sizes: `${icon.size}x${icon.size}`, type: 'image/png', purpose: icon.kind === 'maskable' ? 'maskable' : 'any',
    })),
  };
}

const htmlEscape = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export function faviconDocuments(input, icoSizes = [16, 32, 48]) {
  const config = faviconConfig(input);
  if (!icoSizes.length || new Set(icoSizes).size !== icoSizes.length || icoSizes.some(size => !ICO_SIZES.includes(size))) throw new Error('请至少选择一个有效的 ICO 尺寸。');
  const path = htmlEscape(config.assetPath), sizes = icoSizes.map(size => `${size}x${size}`).join(' ');
  const html = [
    `<link rel="icon" type="image/x-icon" sizes="${sizes}" href="${path}favicon.ico">`,
    ...FAVICON_PNGS.filter(icon => icon.kind === 'browser').map(icon => `<link rel="icon" type="image/png" sizes="${icon.size}x${icon.size}" href="${path}${icon.name}">`),
    `<link rel="apple-touch-icon" sizes="180x180" href="${path}apple-touch-icon.png">`,
    `<link rel="manifest" href="${path}site.webmanifest">`,
    `<meta name="theme-color" content="${config.themeColor}">`,
    `<meta name="apple-mobile-web-app-title" content="${htmlEscape(config.shortName)}">`,
  ].join('\n') + '\n';
  const manifest = JSON.stringify(faviconManifest(config), null, 2) + '\n';
  const readme = `网站图标资源包 · ${config.name}\n\n安装步骤\n\n1. 将本包文件放到网站的 ${config.assetPath} 目录，使 ${config.assetPath}site.webmanifest 可以访问。\n   对于使用 public 目录的框架，将文件放入 public 下与该 URL 对应的目录，再构建和发布。\n2. 将 html-head.txt 的内容复制到页面的 <head> 中，替换原有重复的图标声明。\n3. 本包的应用入口和 scope 均为 ${config.appPath}，请确认入口可以正常访问。\n4. 发布后检查图标和 Manifest 的响应状态，在浏览器及手机上刷新并预览；旧图标可能受缓存影响。\n\n文件清单\n\nfavicon.ico — 包含 ${icoSizes.join(' / ')} px 图像的真实 ICO 文件。\n${FAVICON_PNGS.map(icon => `${icon.name} — ${icon.size} × ${icon.size} px，${icon.label}。`).join('\n')}\nsite.webmanifest — 应用名称、颜色、入口及图标配置。\nhtml-head.txt — 可直接放入 HTML <head> 的引用代码。\nREADME.txt — 本说明。\n\n显示与适配\n\nApple Touch 图标以应用底色铺底，并在四周预留 8% 留白。\nMaskable 图标以应用底色铺满画布，Logo 的完整矩形位于中心半径 40% 的安全圆内。普通 PWA 图标单独标记为 any，Maskable 图标单独标记为 maskable。\nManifest 中图标的 src 相对于 site.webmanifest；应用入口使用明确的本站绝对路径。移动图标目录时同步更新 HTML 引用。\n本包提供图标和 Manifest 配置。安装体验取决于浏览器与站点条件，离线功能需要站点另行实现。\n所有图片在浏览器本地生成。请预览较小图标的可读性，位图放大不会增加细节。\n`;
  return { config, html, manifest, files: [
    { name: 'site.webmanifest', text: manifest, type: 'application/manifest+json' },
    { name: 'html-head.txt', text: html, type: 'text/plain' },
    { name: 'README.txt', text: readme, type: 'text/plain' },
  ] };
}
