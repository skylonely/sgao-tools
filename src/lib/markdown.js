export const MARKDOWN_LIMITS = Object.freeze({units:200_000,lines:10_000,fileBytes:1024**2,htmlUnits:2_000_000,elements:20_000,tokens:30_000});
export const escapeMarkdownHTML = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateMarkdown(text) {
  if(typeof text!=='string'||text.length>MARKDOWN_LIMITS.units)throw new Error('Markdown 最高 20 万 UTF-16 单元，请缩小文档后重试。');
  if(text.includes('\0'))throw new Error('文本含 NUL 字符，请使用普通 UTF-8 文本。');
  const lines=text?text.replace(/\r\n?/g,'\n').split('\n').length:0;
  if(lines>MARKDOWN_LIMITS.lines)throw new Error('Markdown 最高 10,000 行，请分段处理。');return text;
}
export function headingSlug(text) {return `sgao-md-heading-${Array.from(String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu,'').trim().replace(/\s+/g,'-')).slice(0,160).join('')||'section'}`;}
export function safeMarkdownHref(href) {
  if(typeof href!=='string'||/[\u0000-\u0020\u007f-\u009f]/.test(href)||href.includes('\\'))return null;
  if(href.startsWith('#')){try{return `#${headingSlug(decodeURIComponent(href.slice(1)))}`;}catch{return null;}}
  if(/^https?:\/\//i.test(href)){try{const url=new URL(href);return url.username||url.password?null:url.href;}catch{return null;}}
  if(/^mailto:[^<>"'\s]+$/i.test(href))return href;
  return null;
}
export async function readMarkdownFile(file,{signal}={}) {
  const check=()=>{if(signal?.aborted)throw new DOMException('读取已停止','AbortError');};check();if(!file||file.size>MARKDOWN_LIMITS.fileBytes)throw new Error('MD / TXT 文件最高 1 MB。');
  const buffer=await file.arrayBuffer();check();let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new Error('文件不是有效 UTF-8，请另存为 UTF-8 后导入。');}return validateMarkdown(text);
}
export function markdownFilename(title,extension='md') {
  if(!['md','html'].includes(extension))throw new Error('导出格式无效。');const stem=String(title||'未命名文档').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/g,'-').replace(/\.(md|markdown|txt|html?)$/i,'').replace(/^[.\s]+|[.\s]+$/g,'').slice(0,120)||'未命名文档';return `${stem}.${extension}`;
}
export const markdownBlob=text=>new Blob(['\uFEFF',validateMarkdown(text)],{type:'text/markdown;charset=utf-8'});

// Return a small text edit; the UI applies it through the browser's editing command to preserve undo.
export function markdownEdit(text,start,end,action) {
  validateMarkdown(text);if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>text.length)throw new Error('选区无效。');
  const selected=text.slice(start,end);let from=start,to=end,insert,selectStart=0,selectEnd;
  const wrap=(prefix,suffix=prefix,placeholder='文字')=>{const content=selected||placeholder;insert=prefix+content+suffix;selectStart=prefix.length;selectEnd=selectStart+content.length;};
  if(action==='bold')wrap('**');else if(action==='italic')wrap('*');else if(action==='strike')wrap('~~');
  else if(action==='code'){const content=selected||'代码',runs=content.match(/`+/g)||[],fence='`'.repeat(Math.max(0,...runs.map(s=>s.length))+1),pad=/^`|`$/.test(content)||/^ .+ $/s.test(content)&&!/^ +$/.test(content)?' ':'';wrap(fence+pad,pad+fence,'代码');}
  else if(action==='link'){const label=(selected||'链接文字').replace(/([\\\[\]])/g,'\\$1'),prefix=`[${label}](`;insert=`${prefix}https://example.com)`;selectStart=prefix.length;selectEnd=insert.length-1;}
  else if(['heading','quote','list','ordered','task'].includes(action)){
    from=start===0?0:text.lastIndexOf('\n',start-1)+1;to=text.indexOf('\n',end);if(to<0)to=text.length;if(end>start&&text[end-1]==='\n')to=end-1;
    insert=text.slice(from,to).split('\n').map((line,index)=>action==='heading'?`## ${line.replace(/^ {0,3}#{1,6}\s+/,'')}`:action==='quote'?`> ${line}`:action==='ordered'?`${index+1}. ${line}`:action==='task'?`- [ ] ${line}`:`- ${line}`).join('\n');selectEnd=insert.length;
  } else if(['fence','table','rule'].includes(action)) {
    const prefix=start>0?(text[start-1]==='\n'?'\n':'\n\n'):'',suffix=end<text.length?(text[end]==='\n'?'\n':'\n\n'):'';
    const fence='`'.repeat(Math.max(3,...(selected.match(/`+/g)||[]).map(s=>s.length+1)));
    const body=action==='table'?'| 项目 | 说明 |\n| --- | --- |\n| 内容 | 在这里填写 |':action==='rule'?'---':`${fence}text\n${selected||'在这里写代码'}\n${fence}`;
    insert=prefix+body+suffix;selectStart=prefix.length;selectEnd=prefix.length+body.length;
  } else throw new Error('排版操作无效。');
  validateMarkdown(text.slice(0,from)+insert+text.slice(to));return {from,to,insert,start:from+selectStart,end:from+selectEnd};
}

export const MARKDOWN_SAMPLE = '# 把文字，写成一份好文档\n\n一边编辑 **Markdown**，一边查看排版。内容只在当前浏览器里处理。\n\n## 从一个步骤，到下一个\n\n1. 用 OCR 提取图片中的文字\n2. 清理空白，校对识别结果\n3. 在这里排版，导出 Markdown 或 HTML\n\n> 少一些重复操作，多一点专注。\n\n## 这次的待办\n\n- [x] 写下一个想法\n- [x] 用表格整理信息\n- [ ] 下载文档，分享成果\n\n| 工具 | 用途 |\n| :--- | :--- |\n| 文本清理 | 去空白、批量替换 |\n| Markdown | 编辑与实时预览 |\n\n## 代码也要清楚\n\n```javascript\nconst message = "Hello, SGAO! 😀";\nconsole.log(message);\n```\n\n用 `行内代码` 标记关键词，也可以加上 ~~删除线~~。\n\n[访问 SGAO 工具箱](https://tools.sgao.cc/)\n\n![图片示例](https://example.com/demo.png)\n';
