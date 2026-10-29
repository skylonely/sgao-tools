import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {renderMarkdown} from '../src/lib/markdown-render.js';
import {MARKDOWN_LIMITS,validateMarkdown,headingSlug,safeMarkdownHref,readMarkdownFile,markdownFilename,markdownBlob,markdownEdit,MARKDOWN_SAMPLE} from '../src/lib/markdown.js';
import {markdownHTMLDocument} from '../src/markdown-preview.js';
import {runMarkdown} from '../src/markdown-task.js';

test('Markdown/GFM renders headings, tables, tasks, deletion and escaped code locally',()=>{
 const result=renderMarkdown(MARKDOWN_SAMPLE);for(const value of ['<h1>','<h2>','<table>','<th align="left">','<input checked="" disabled="" type="checkbox">','<del>','<code class="language-javascript">'])assert.ok(result.html.includes(value),value);
 assert.equal(result.images,1);assert.equal(result.rawHTML,0);assert.equal(result.blockedLinks,0);assert.ok(!result.html.includes('<img'));assert.equal(renderMarkdown('').html,'');
 assert.match(renderMarkdown('```html\n<script>alert(1)</script>\n```').html,/&lt;script&gt;/);
});
test('single-line break option is explicit and paragraphs remain separate',()=>{
 assert.equal(renderMarkdown('一行\n二行\n\n一段').html,'<p>一行\n二行</p>\n<p>一段</p>\n');assert.equal(renderMarkdown('一行\n二行',{breaks:true}).html,'<p>一行<br>二行</p>\n');assert.throws(()=>renderMarkdown('x',{breaks:'yes'}));
});
test('raw HTML, scripts and embedded resources become text and image destinations never become DOM URLs',()=>{
 for(const input of ['<script>alert(1)</script>','<svg onload="alert(1)"></svg>','<img src=x onerror=alert(1)>','<iframe src="https://example.com"></iframe>','<style>body{display:none}</style>']){const out=renderMarkdown(input);assert.ok(!/<(script|svg|img|iframe|style)\b/i.test(out.html));assert.ok(out.rawHTML>0);assert.ok(out.html.includes('&lt;'));}
 const result=renderMarkdown('![<img onerror=x>](https://private.example/secret)\n\n![x](data:image/svg+xml,evil)');assert.equal(result.images,2);assert.ok(!result.html.includes('private.example'));assert.ok(!result.html.includes('data:'));assert.ok(!/<img\b/.test(result.html));
});
test('link policy rejects executable, encoded, relative and credential URLs while retaining text',()=>{
 for(const href of ['javascript:alert(1)','jav&#x61;script:alert(1)','data:text/html,x','vbscript:x','//example.com','../secret','/image','https://a\\b','https://user:pass@example.com','https://example.com/\nfoo'])assert.equal(safeMarkdownHref(href),null,href);
 const result=renderMarkdown('[bad](javascript:alert%281%29) [relative](../readme) [good](https://example.com/ "标题")');assert.equal(result.blockedLinks,2);assert.ok(!result.html.includes('javascript:'));assert.match(result.html,/<a href="https:\/\/example.com\/" title="标题" target="_blank" rel="noopener noreferrer">good<\/a>/);
 assert.equal(safeMarkdownHref('mailto:a@example.com'),'mailto:a@example.com');assert.equal(safeMarkdownHref('#你好-world'),'#sgao-md-heading-你好-world');assert.equal(safeMarkdownHref('#%E0%A'),null);
});
test('heading namespace cannot collide with controls and Unicode slugs remain usable',()=>{
 assert.equal(headingSlug('Preview'),'sgao-md-heading-preview');assert.equal(headingSlug('你好， 世界！'),'sgao-md-heading-你好-世界');assert.equal(headingSlug('***'),'sgao-md-heading-section');assert.ok(!/[\ud800-\udbff]$/.test(headingSlug('𐐀'.repeat(200))));
});
test('input, structural and rendered element bounds reject large or pathological documents',()=>{
 assert.equal(validateMarkdown('😀'.repeat(100000)).length,200000);assert.throws(()=>validateMarkdown('a'.repeat(200001)),/20 万/);assert.throws(()=>validateMarkdown('a\r\n'.repeat(10000)),/10,000/);assert.throws(()=>validateMarkdown('a\0b'),/NUL/);
 const row='|'.repeat(61)+'\n',table=row+'|---'.repeat(60)+'|\n'+row.repeat(400);assert.ok(table.length<MARKDOWN_LIMITS.units);assert.throws(()=>renderMarkdown(table),/元素过多|结构过多/);
});
test('strict UTF-8 import supports BOM/CRLF and empty input, rejects binary, oversize and late cancellation',async()=>{
 assert.equal(await readMarkdownFile(new File(['\uFEFF# 中文 😀\r\n'],'test.md')),'# 中文 😀\r\n');assert.equal(await readMarkdownFile(new File([],'empty.md')),'');
 await assert.rejects(readMarkdownFile(new File([Uint8Array.from([255,254,0,1])],'bad.md')),/UTF-8/);await assert.rejects(readMarkdownFile(new File(['a\0b'],'bad.md')),/NUL/);await assert.rejects(readMarkdownFile({size:MARKDOWN_LIMITS.fileBytes+1,arrayBuffer(){assert.fail();}}),/1 MB/);
 const abort=new AbortController();let resolve;const pending=readMarkdownFile({size:1,arrayBuffer:()=>new Promise(r=>{resolve=r;})},{signal:abort.signal});abort.abort();resolve(new TextEncoder().encode('x').buffer);await assert.rejects(pending,{name:'AbortError'});
});
test('MD export preserves Unicode and exact current source, with BOM and safe filenames',async()=>{
 const text='# 校对 😀\n\n$& \\n\n';const bytes=new Uint8Array(await markdownBlob(text).arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);assert.equal(new TextDecoder().decode(bytes),text);
 assert.equal(markdownFilename('../secret\u202e/name.md','html'),'-secret--name.html');assert.equal(markdownFilename('文章.txt'),'文章.md');assert.throws(()=>markdownFilename('x','exe'));
});
test('standalone HTML contains fixed styles, escaped title and restrictive script/resource policy',()=>{
 const html=markdownHTMLDocument('<h1>测试 😀</h1>','</title><script>alert(1)</script>');assert.ok(html.startsWith('<!doctype html>'));assert.match(html,/<meta charset="utf-8">/);assert.match(html,/script-src 'none'/);assert.match(html,/connect-src 'none'/);assert.match(html,/img-src 'none'/);assert.ok(html.includes('&lt;/title&gt;&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('<style>'));assert.ok(html.includes('<h1>测试 😀</h1>'));
});
const edited=(text,start,end,action)=>{const edit=markdownEdit(text,start,end,action);return {...edit,text:text.slice(0,edit.from)+edit.insert+text.slice(edit.to)};};
test('inline formatting preserves selected text and selects the intended editable URL',()=>{
 assert.equal(edited('你好世界',0,2,'bold').text,'**你好**世界');const url=edited('https://sgao.cc',0,15,'link');assert.equal(url.text.slice(url.start,url.end),'https://example.com');assert.equal(edited('a]b',0,3,'link').text,'[a\\]b](https://example.com)');assert.equal(renderMarkdown(edited('a]b',0,3,'link').text).blockedLinks,0);
 for(const text of [' foo ','`hello`','a``b','   ',' \t ',' \u00a0 ']){const out=renderMarkdown(edited(text,0,text.length,'code').text).html;assert.ok(out.includes(`<code>${text}</code>`),out);}
});
test('line edits handle cursor zero, empty first lines, whole selections and trailing line breaks',()=>{
 assert.equal(edited('\nabc',0,0,'heading').text,'## \nabc');assert.equal(edited('a\nb\nc',0,4,'quote').text,'> a\n> b\nc');assert.equal(edited('a\nb',0,3,'ordered').text,'1. a\n2. b');assert.equal(edited('### 标题',0,6,'heading').text,'## 标题');assert.equal(edited('abc',1,1,'task').text,'- [ ] abc');
});
test('fenced code and inserted blocks preserve surrounding text without breaking backtick content',()=>{
 const text='before```inside```after',value=edited(text,6,18,'fence').text;assert.ok(value.includes('````text'));assert.ok(value.startsWith('before\n\n'));assert.ok(value.endsWith('\n\nafter'));
 assert.match(renderMarkdown(edited('',0,0,'table').text).html,/<table>/);assert.match(renderMarkdown(edited('',0,0,'rule').text).html,/<hr>/);assert.throws(()=>markdownEdit('a',-1,1,'bold'));assert.throws(()=>markdownEdit('a',0,1,'bad'));assert.throws(()=>markdownEdit('a'.repeat(200000),0,1,'bold'),/20 万/);
});
test('Markdown workers stop once on abort/timeout and ignore late results',async()=>{
 const fake=()=>({postMessage(data){this.sent=data;},terminate(){this.stopped=(this.stopped||0)+1;}});let worker=fake();const abort=new AbortController(),pending=runMarkdown('text',{}, {signal:abort.signal,workerFactory:()=>worker});abort.abort();await assert.rejects(pending,{name:'AbortError'});worker.onmessage({data:{result:{html:'late'}}});assert.equal(worker.stopped,1);
 worker=fake();await assert.rejects(runMarkdown('x',{}, {workerFactory:()=>worker,timeout:5}),/5 秒/);assert.equal(worker.stopped,1);const early=new AbortController();early.abort();await assert.rejects(runMarkdown('x',{}, {signal:early.signal,workerFactory:()=>assert.fail()}),{name:'AbortError'});
 worker=fake();worker.postMessage=()=>queueMicrotask(()=>worker.onmessage({data:{error:'bad document'}}));await assert.rejects(runMarkdown('x',{}, {workerFactory:()=>worker}),/bad document/);assert.equal(worker.stopped,1);
});
test('vendored parser and sanitizer assets match pinned official package hashes',async()=>{
 const directory=new URL('../src/vendor/markdown/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'));assert.deepEqual(manifest.map(row=>row.name),['marked','dompurify']);for(const row of manifest)for(const file of row.files){const data=await readFile(new URL(file.path,directory));assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256);}
});
