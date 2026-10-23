import { optimize } from './vendor/svgo.browser.js';
import { SVG_MAX_BYTES, svgByteLength, svgDimensions } from './lib/svg.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const staticElements = new Set(('svg g defs symbol use path rect circle ellipse line polyline polygon title desc text tspan textPath style linearGradient radialGradient stop clipPath mask pattern marker image filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence view').split(' '));

function unescapeCSS(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\([0-9a-f]{1,6}\s?|[^\r\n0-9a-f])/gi, (_, escaped) => {
    if (/^[0-9a-f]/i.test(escaped)) { const code = parseInt(escaped, 16); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd'; }
    return escaped;
  }).replace(/[\u0000-\u001f\u007f]/g, '');
}

function checkCSS(value) {
  const decoded = unescapeCSS(value);
  if (/@|(?:expression|javascript|vbscript)\s*[:(]|(?:animation|transition|behavior|-moz-binding)\s*:/i.test(decoded)) throw new Error('此 SVG 包含外部样式、动态样式或不支持的 CSS，请先导出为独立的静态 SVG。');
  const remaining = decoded.replace(/url\s*\(\s*(['"]?)#[^\s'"()<>]+\1\s*\)/gi, '');
  if (/url\s*\(/i.test(remaining)) throw new Error('SVG 的样式只能引用文件内的渐变、蒙版或滤镜，不支持外部资源。');
}

function checkReference(value, image = false) {
  const clean = value.trim();
  if (/^#[^\s<>]+$/.test(clean)) return;
  if (image && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(clean)) return;
  throw new Error('此 SVG 引用了外部文件。请将图片内嵌，并将字体转曲后再处理。');
}

function inspectionPlugin(state, normalize) {
  return {
    name: 'sgao-static-svg',
    fn: () => {
      let depth = 0, count = 0;
      return {
      root: { enter: node => {
        const roots = node.children.filter(child => child.type === 'element');
        if (roots.length !== 1 || roots[0].name !== 'svg') throw new Error('请输入完整的 SVG，根节点应为 <svg>。');
      } },
      element: {
        enter: (node, parent) => {
          if (++count > 50_000 || ++depth > 128) throw new Error('SVG 结构过于复杂，请减少节点或嵌套后重试。');
          if (!staticElements.has(node.name)) throw new Error(`暂不支持 <${node.name.slice(0, 40)}> 元素。请导出不含脚本、动画或 HTML 内容的静态 SVG。`);
          if (node.attributes.xmlns && node.attributes.xmlns !== SVG_NS) throw new Error('SVG 命名空间无效，请使用标准 SVG 文件。');
          if (node.name === 'style') checkCSS(node.children.map(child => child.value || '').join(''));
          for (const [name, value] of Object.entries(node.attributes)) {
            const lower = name.toLowerCase();
            if (lower.split(':').pop().startsWith('on') || lower === 'xml:base') throw new Error('此 SVG 包含事件脚本或外部路径设置，请先导出为静态 SVG。');
            if (['href', 'xlink:href', 'src'].includes(lower)) checkReference(value, ['image', 'feImage'].includes(node.name));
            if (lower === 'style' || /url\s*\(|\\/i.test(value)) checkCSS(value);
          }
          if (node.name === 'text' || node.name === 'textPath') state.hasText = true;
          if (node.name === 'image' || node.name === 'feImage') state.hasImages = true;
          if (parent.type === 'root') {
            const dimensions = svgDimensions(node.attributes);
            state.dimensions = dimensions;
            if (normalize) {
              node.attributes.xmlns = SVG_NS;
              node.attributes.width = String(dimensions.width);
              node.attributes.height = String(dimensions.height);
              node.attributes.viewBox ||= dimensions.viewBox.join(' ');
            }
          }
        },
        exit: () => { depth--; },
      },
      };
    },
  };
}

export function optimizeSVG(input, { precision = 3, keepIds = true } = {}) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('请上传 SVG 文件，或粘贴完整的 SVG 源码。');
  const originalBytes = svgByteLength(input);
  if (originalBytes > SVG_MAX_BYTES) throw new Error('SVG 文件不能超过 5 MB，请精简文件后重试。');
  if (![2, 3, 5].includes(precision)) throw new Error('请选择有效的优化精度。');
  if (/<!ENTITY\b|<!DOCTYPE[^>]*\[|<\?xml-stylesheet\b/i.test(input)) throw new Error('暂不支持自定义 XML 实体或外部样式，请使用独立的静态 SVG。');
  const state = { hasText: false, hasImages: false };
  try {
    const source = optimize(input, {
      plugins: ['removeDoctype', 'removeXMLProcInst', 'removeComments', 'removeMetadata', 'removeEditorsNSData', inspectionPlugin(state, true)],
    }).data;
    // Keep accessibility text, IDs and hidden definitions by default. No viewBox removal.
    const candidate = optimize(source, {
      multipass: true, floatPrecision: precision,
      plugins: [{ name: 'preset-default', params: { overrides: {
        cleanupIds: keepIds ? false : {}, removeDesc: false, removeHiddenElems: false,
        removeUnknownsAndDefaults: false,
      } } }, inspectionPlugin({}, false)],
    }).data;
    const data = svgByteLength(candidate) <= svgByteLength(source) ? candidate : source;
    return { source, data, originalBytes, outputBytes: svgByteLength(data), ...state };
  } catch (error) {
    if (error.name === 'SvgoParserError') throw new Error(`SVG 语法有误（第 ${error.line} 行，第 ${error.column} 列），请检查标签、引号和特殊字符。`);
    throw error;
  }
}
