import { SITE_URL, HOME, TOOLS, HOME_ORDER, CATEGORIES, toolByKey } from '../src/lib/pages.js';

export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const link = tool => `<a href="${tool.path}">${icon(tool.icon)}<span>${escapeHTML(tool.name)}</span>${icon('arrow')}</a>`;

function structuredData(page) {
  const website = { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: 'SGAO 工具箱', url: `${SITE_URL}/`, inLanguage: 'zh-CN' };
  const webpage = { '@type': page.key === 'home' ? 'CollectionPage' : 'WebPage', '@id': `${SITE_URL}${page.path}#webpage`, url: `${SITE_URL}${page.path}`, name: page.title, description: page.description, inLanguage: 'zh-CN', isPartOf: { '@id': website['@id'] } };
  const graph = [website, webpage];
  if (page.key === 'home') {
    graph.push({ '@type': 'ItemList', name: '在线工具导航', itemListElement: HOME_ORDER.map((key, i) => { const tool = toolByKey(key); return { '@type': 'ListItem', position: i + 1, name: tool.name, url: `${SITE_URL}${tool.path}` }; }) });
  } else {
    webpage.breadcrumb = { '@id': `${SITE_URL}${page.path}#breadcrumb` };
    graph.push({ '@type': 'BreadcrumbList', '@id': webpage.breadcrumb['@id'], itemListElement: [{ '@type': 'ListItem', position: 1, name: '工具导航', item: `${SITE_URL}/` }, { '@type': 'ListItem', position: 2, name: page.name, item: `${SITE_URL}${page.path}` }] });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c');
}

function metadata(page) {
  const title = escapeHTML(page.title), description = escapeHTML(page.description), url = `${SITE_URL}${page.path}`;
  return `<title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="zh_CN">
  <meta property="og:site_name" content="SGAO 工具箱">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE_URL}/social-cover.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="SGAO 工具箱 · 日常开发，顺手一点">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${SITE_URL}/social-cover.png">
  <meta name="twitter:image:alt" content="SGAO 工具箱 · 日常开发，顺手一点">
  <script type="application/ld+json">${structuredData(page)}</script>`;
}

function navigation(page) {
  return `<a href="/" data-tool="home" class="nav-item nav-home${page.key === 'home' ? ' active' : ''}"${page.key === 'home' ? ' aria-current="page"' : ''}>${icon('grid')}<span>工具导航<small>找到眼下需要的工具</small></span></a>
      <div class="nav-heading">日常开发，顺手一点 <span>${String(TOOLS.length).padStart(2, '0')}</span></div>
      <nav class="tool-nav" aria-label="全部工具">${TOOLS.map((tool, i) => `<a href="${tool.path}" data-tool="${tool.key}" class="nav-item${page.key === tool.key ? ' active' : ''}"${page.key === tool.key ? ' aria-current="page"' : ''}>${icon(tool.icon)}<span>${escapeHTML(tool.name.replace('网站图标整包生成', '网站图标整包').replace('图片压缩 & 格式转换', '图片压缩 & 转换').replace('SVG 优化 & 转 PNG', 'SVG 优化 & PNG').replace('图片裁剪 & 尺寸调整', '图片裁剪 & 缩放').replace('图片水印 & 批量加水印', '图片水印 & 批量'))}<small>${escapeHTML(tool.tags.join(' · '))}</small></span><span class="nav-index">${String(i + 1).padStart(2, '0')}</span></a>`).join('\n')}</nav>`;
}

function homeContent() {
  const cards = HOME_ORDER.map(key => {
    const tool = toolByKey(key);
    return `<a class="directory-card" href="${tool.path}" data-card="${key}"><div class="directory-card-top"><span class="directory-icon tone-${tool.category}">${icon(tool.icon)}</span><span class="directory-type">${CATEGORIES.find(category => category.key === tool.category).name}</span><span class="directory-arrow">↗</span></div><h3>${escapeHTML(tool.name)}</h3><p>${escapeHTML(tool.card)}</p><div class="directory-tags">${tool.tags.map(tag => `<span>${escapeHTML(tag)}</span>`).join('')}</div></a>`;
  }).join('\n');
  return `<section class="home-hero" aria-labelledby="page-title"><div class="home-hero-copy"><div class="eyebrow"><span></span> SMALL TOOLS. EVERYDAY FLOW.</div><h1 id="page-title">日常开发，<br>顺手一点<span class="title-dot">.</span></h1><p>把琐碎的工作，交给顺手的工具。<br>压缩图片、整理数据、准备网站素材，打开就能开始。</p><div class="home-hero-actions"><a class="button primary" href="/image-compressor/">从图片压缩开始 ${icon('arrow')}</a><a class="home-browse" href="#tool-directory">浏览全部工具 <span>↓</span></a></div><div class="home-trust"><span>${icon('shield')}内容本地处理</span><span>无需登录</span><span>免费使用</span></div></div><div class="home-hero-art" aria-hidden="true"><div class="hero-art-grid"></div><span class="art-caption">A LITTLE LESS FRICTION.</span><div class="art-tile art-image">${icon('compress')}<span>LESS KB</span></div><div class="art-tile art-code">{<span>JSON</span>}</div><div class="art-tile art-qr">${icon('qr')}<span>SCAN & GO</span></div><div class="art-note"><span class="status-dot"></span> ${String(TOOLS.length).padStart(2, '0')} TOOLS / ALL LOCAL</div></div></section>
    <section id="tool-directory" class="tool-directory" aria-labelledby="directory-title"><div class="directory-heading"><div><div class="eyebrow">THE TOOL COLLECTION</div><h2 id="directory-title">总有一个，刚好用得上<span class="title-dot">.</span></h2></div><span class="directory-total">${String(TOOLS.length).padStart(2, '0')} 个工具，随时待命</span></div><div class="directory-controls" id="directory-controls" hidden><div class="directory-filters" role="group" aria-label="工具分类">${CATEGORIES.map(({ key, name }) => `<button type="button" data-category="${key}" class="directory-filter${key === 'all' ? ' selected' : ''}" aria-pressed="${key === 'all'}">${name}<span>${key === 'all' ? TOOLS.length : TOOLS.filter(tool => tool.category === key).length}</span></button>`).join('')}</div><div class="directory-search">${icon('search')}<label class="sr-only" for="tool-search">搜索工具</label><input type="search" id="tool-search" placeholder="搜索工具，如 PNG、JSON…" autocomplete="off" maxlength="100"><button type="button" id="search-clear" aria-label="清空搜索" hidden>×</button></div></div><div class="directory-results" id="directory-status" role="status" aria-live="polite" hidden></div><div class="directory-grid">${cards}</div><div class="directory-empty" id="directory-empty" hidden>${icon('search')}<h3>暂时没有找到匹配的工具</h3><p>试试「图片」「二维码」或「JSON」，也可以重置筛选。</p><button class="button secondary" id="directory-reset" type="button">显示全部工具</button></div></section>
    <section class="home-promise" aria-label="使用说明"><div><span>01 / PRIVATE</span><h2>你的内容，留在本地</h2><p>图片、文本和二维码内容在当前浏览器内处理，不上传到服务器。</p></div><div><span>02 / SIMPLE</span><h2>打开，就能开始</h2><p>不用注册账号，也不用安装软件。选好工具，专注完成手头的小事。</p></div><div><span>03 / CONNECTED</span><h2>从一个步骤，到下一个</h2><p>先优化 SVG，再生成网站图标；整理 JSON 后，继续对比版本差异。</p></div></section>`;
}

function guideContent(tool) {
  return `<section class="tool-guide" aria-labelledby="guide-title"><div class="guide-intro"><div class="eyebrow">A FEW HELPFUL NOTES</div><h2 id="guide-title">用得顺手，也用得明白<span class="title-dot">.</span></h2><p>${escapeHTML(tool.intro)}</p></div><div class="guide-columns"><div class="guide-steps"><h3>如何使用</h3><ol>${tool.steps.map(step => `<li>${escapeHTML(step)}</li>`).join('')}</ol></div><div class="guide-faq"><h3>常见问题</h3>${tool.faqs.map(([question, answer]) => `<details><summary>${escapeHTML(question)}</summary><p>${escapeHTML(answer)}</p></details>`).join('')}</div></div><div class="related-heading"><h3>接下来可能用得上</h3><a href="/">查看全部工具 ${icon('arrow')}</a></div><div class="related-tools">${tool.related.map(key => link(toolByKey(key))).join('')}</div></section>`;
}

export function renderPage(template, page = HOME) {
  const sections = [...template.matchAll(/        <section id="view-([a-z]+)"[\s\S]*?<\/section>/g)];
  if (sections.length !== TOOLS.length) throw new Error('工具模板数量不匹配');
  let content = homeContent();
  if (page.key !== 'home') {
    const section = sections.find(match => match[1] === page.key);
    if (!section) throw new Error(`工具模板缺失: ${page.key}`);
    content = `<div class="page-heading"><div><div class="eyebrow"><span></span> YOUR EVERYDAY TOOLKIT <span id="tool-number">/ ${String(TOOLS.indexOf(page) + 1).padStart(2, '0')}</span></div><h1 id="page-title">${escapeHTML(page.name)}<span class="title-dot">.</span></h1><p id="page-description">${escapeHTML(page.tagline)}</p></div><span class="local-badge">${icon('shield')}浏览器本地处理</span></div>\n${section[0].replace(' hidden>', '>')}\n${guideContent(page)}`;
  }
  let html = template
    .replace(/<title>[\s\S]*?<meta name="description"[^>]*>/, metadata(page))
    .replace('<body>', `<body data-page="${page.key}">`)
    .replace('href="#json" aria-label="SGAO 工具箱首页"', 'href="/" aria-label="SGAO 工具箱首页"')
    .replace(/      <div class="nav-heading">[\s\S]*?<\/nav>/, `      ${navigation(page)}`)
    .replace('<div class="breadcrumb"><span>工具箱</span>', `<nav class="breadcrumb" aria-label="面包屑"><a href="/">${page.key === 'home' ? 'SGAO' : '工具导航'}</a>`)
    .replace('<span id="breadcrumb-current">JSON 格式化</span></div>', `<span id="breadcrumb-current" aria-current="page">${escapeHTML(page.name)}</span></nav>`)
    .replace(/        <div class="page-heading">[\s\S]*?(?=        <footer class="page-footer">)/, `${content}\n`)
    .replace('<link rel="stylesheet" href="/styles.css">', '<link rel="stylesheet" href="/styles.css">\n  <link rel="stylesheet" href="/portal.css">');
  const stylesheet = { image: 'image-tool', qrcode: 'qr-tool', svg: 'svg-tool', ico: 'favicon-tool', crop: 'crop-tool', color: 'color-tool', watermark: 'watermark-tool', collage: 'collage-tool', imagepdf: 'image-pdf-tool', pdfimages: 'pdf-images-tool', pdforganizer: 'pdf-organizer-tool' }[page.key];
  html = html.replace(/  <link rel="stylesheet" href="\/(image-tool|qr-tool|svg-tool|favicon-tool|crop-tool|color-tool|watermark-tool|collage-tool|image-pdf-tool|pdf-images-tool|pdf-organizer-tool)\.css">\n/g, (match, name) => name === stylesheet ? match : '');
  if (page.key !== 'image') html = html.replace(/  <dialog id="image-compare-dialog"[\s\S]*?<\/dialog>\n/, '');
  return html;
}

export function renderSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[HOME, ...TOOLS].map(page => `  <url><loc>${SITE_URL}${page.path}</loc></url>`).join('\n')}\n</urlset>\n`;
}
