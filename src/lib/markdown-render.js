import {Marked} from '../vendor/markdown/marked-18.1.2.esm.js';
import {MARKDOWN_LIMITS,validateMarkdown,safeMarkdownHref,escapeMarkdownHTML} from './markdown.js';

export function renderMarkdown(text,{breaks=false}={}) {
  validateMarkdown(text);if(typeof breaks!=='boolean')throw new Error('换行设置无效。');let tokens=0,images=0,rawHTML=0,blockedLinks=0;
  const parser=new Marked({gfm:true,breaks,async:false,walkTokens(){if(++tokens>MARKDOWN_LIMITS.tokens)throw new Error('文档结构过多，请分段预览。');},renderer:{
    html({text}){rawHTML++;return escapeMarkdownHTML(text);},
    link({href,title,tokens}){const content=this.parser.parseInline(tokens),url=safeMarkdownHref(href);if(!url){blockedLinks++;return content;}return `<a href="${escapeMarkdownHTML(url)}"${title?` title="${escapeMarkdownHTML(title)}"`:''}${url.startsWith('#')?'':' target="_blank" rel="noopener noreferrer"'}>${content}</a>`;},
    image({text}){images++;return `<span class="mk-image-placeholder">[图片：${escapeMarkdownHTML(text||'未命名图片')}]</span>`;},
    tablecell({tokens,header,align}){const tag=header?'th':'td';return `<${tag}${['left','center','right'].includes(align)?` align="${align}"`:''}>${this.parser.parseInline(tokens)}</${tag}>`;},
  }});
  const html=parser.parse(text);if(html.length>MARKDOWN_LIMITS.htmlUnits)throw new Error('预览结果过大，请缩小文档后重试。');let elements=0;for(const tag of html.matchAll(/<[a-z][a-z0-9]*(?:\s|>)/gi)){if(++elements>MARKDOWN_LIMITS.elements)throw new Error('预览元素过多，请分段处理。');}return {html,images,rawHTML,blockedLinks};
}
