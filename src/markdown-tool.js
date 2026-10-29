import {MARKDOWN_SAMPLE,validateMarkdown,readMarkdownFile,markdownFilename,markdownBlob,markdownEdit} from './lib/markdown.js';
import {textStats} from './lib/text-cleanup.js';
import {prepareMarkdownHTML,markdownHTMLDocument} from './markdown-preview.js';
import {runMarkdown} from './markdown-task.js';
import {receiveTextTransfer} from './text-transfer.js';

export function initMarkdown({notify}) {
  const $=id=>document.getElementById(id),source=$('mk-source');let revision=0,operation=0,result=null,controller,timer,loading=false,rendering=false,disposed=false,composing=false,mdURL,htmlURL;
  const message=(id,text='')=>{$(id).textContent=text;$(id).hidden=!text;};
  const current=()=>!!result&&result.revision===revision;
  function releaseURLs(){for(const url of [mdURL,htmlURL])if(url)URL.revokeObjectURL(url);mdURL=htmlURL=null;for(const id of ['mk-download-md','mk-download-html']){$(id).removeAttribute('href');$(id).removeAttribute('download');}}
  function stats(){const s=textStats(source.value);$('mk-source-meta').textContent=`${s.characters.toLocaleString()} 字符 · ${s.lines.toLocaleString()} 行 · ${(s.bytes/1024).toFixed(1)} KB`;}
  function update(){
    $('mk-preview-state').textContent=loading?'正在读取':rendering?'正在排版':current()?'已更新':result?'待更新':'等待输入';
    message('mk-stale',result&&!current()?'输入或换行方式已变化，当前保留上次预览。更新成功后可复制或导出 HTML。':'');
    $('mk-render').disabled=loading||rendering;$('mk-stop').hidden=!loading&&!rendering;source.readOnly=loading;$('mk-file').disabled=$('mk-sample').disabled=$('mk-live').disabled=$('mk-breaks').disabled=loading;
    for(const el of document.querySelectorAll('[data-mk-edit]'))el.disabled=loading;
    $('mk-copy-md').disabled=loading||!source.value.length;$('mk-download-md').setAttribute('aria-disabled',String(loading||!source.value.length));$('mk-download-md').tabIndex=loading||!source.value.length?-1:0;
    $('mk-copy-html').disabled=loading||!current();$('mk-download-html').setAttribute('aria-disabled',String(loading||!current()));$('mk-download-html').tabIndex=loading||!current()?-1:0;
    $('mk-toc').inert=!current();$('mk-outline-count').textContent=`${result?.headings.length||0} 个标题${result&&!current()?' · 待更新':''}`;
  }
  function cancel(){clearTimeout(timer);controller?.abort();controller=null;operation++;rendering=false;}
  function showEmpty(){const el=document.createElement('div');el.className='mk-empty';const strong=document.createElement('strong');strong.textContent='让文字，慢慢成形';el.append(strong,document.createTextNode('在左侧写下 Markdown，或试试示例。'));$('mk-preview').replaceChildren(el);}
  function showOutline(headings){const nav=$('mk-toc');nav.replaceChildren();for(const heading of headings){const button=document.createElement('button');button.type='button';button.className=`mk-level-${heading.level}`;button.textContent=heading.text;button.addEventListener('click',()=>{if(!current())return;mode('split');const target=document.getElementById(heading.id);target?.scrollIntoView({block:'start',behavior:'auto'});target?.focus({preventScroll:true});});nav.append(button);}$('mk-outline-empty').hidden=headings.length>0;}
  async function render(){
    cancel();const text=source.value,version=revision,ticket=operation,abort=new AbortController();controller=abort;message('mk-error');try{validateMarkdown(text);}catch(error){message('mk-error',error.message);$('mk-status').textContent='预览未更新，原文与已有结果保留。';update();return;}
    rendering=true;$('mk-status').textContent='正在本地排版…';update();
    try{const parsed=await runMarkdown(text,{breaks:$('mk-breaks').checked},{signal:abort.signal});if(disposed||ticket!==operation||version!==revision||abort.signal.aborted)return;const clean=prepareMarkdownHTML(parsed.html);$('mk-preview').innerHTML=clean.html;if(!text.length)showEmpty();for(const heading of clean.headings)document.getElementById(heading.id)?.setAttribute('tabindex','-1');result={...clean,revision:version};showOutline(clean.headings);$('mk-preview-meta').textContent=`${clean.headings.length.toLocaleString()} 个标题 · ${(new TextEncoder().encode(clean.html).length/1024).toFixed(1)} KB HTML`;
      $('mk-notes').replaceChildren();for(const [count,label] of [[parsed.images,'处图片以占位显示'],[parsed.rawHTML,'处原始 HTML 按文字显示'],[parsed.blockedLinks,'处链接仅保留文字']])if(count){const span=document.createElement('span');span.textContent=`${count} ${label}`;$('mk-notes').append(span);}
      $('mk-status').textContent=text.length?'预览已更新。HTML 复制与下载以这份排版结果为准。':'文档已清空，可以继续写作。';
    }catch(error){if(!disposed&&ticket===operation&&error.name!=='AbortError'){message('mk-error',error.message);$('mk-status').textContent='预览未更新，原文与已有结果保留。';}}
    finally{if(!disposed&&ticket===operation){rendering=false;controller=null;update();}}
  }
  function schedule(){if($('mk-live').checked&&!composing&&!loading)timer=setTimeout(render,source.value.length>50_000?600:300);}
  function changed(){cancel();revision++;message('mk-error');releaseURLs();stats();$('mk-status').textContent=$('mk-live').checked?'等待更新预览…':'实时预览已暂停，点击「更新预览」查看当前文档。';update();schedule();}
  function mode(value){$('mk-workspace').dataset.mode=value;for(const el of document.querySelectorAll('[data-mk-mode]'))el.setAttribute('aria-pressed',String(el.dataset.mkMode===value));}
  function resetScroll(){source.scrollTop=0;$('mk-preview-scroll').scrollTop=0;}
  function clear(){cancel();loading=false;revision++;result=null;releaseURLs();source.value='';resetScroll();$('mk-title').value='未命名文档';$('mk-breaks').checked=false;$('mk-live').checked=true;showEmpty();showOutline([]);$('mk-notes').replaceChildren();$('mk-preview-meta').textContent='内容不上传';message('mk-error');$('mk-status').textContent='文档与预览已清空，内容未上传或保存。';stats();update();}
  async function load(file){if(!file||loading)return;cancel();const ticket=operation,abort=new AbortController();controller=abort;loading=true;message('mk-error');$('mk-status').textContent='正在本地读取 UTF-8 文档…';update();
    try{const text=await readMarkdownFile(file,{signal:abort.signal});if(disposed||ticket!==operation||abort.signal.aborted)return;source.value=text;resetScroll();$('mk-title').value=markdownFilename(file.name).slice(0,-3);revision++;releaseURLs();stats();$('mk-status').textContent=`已导入 ${file.name}，原文件不变。`;}
    catch(error){if(!disposed&&ticket===operation&&error.name!=='AbortError'){message('mk-error',error.message);$('mk-status').textContent='文件未导入，已有文档和预览保留。';}}
    finally{if(!disposed&&ticket===operation){loading=false;controller=null;update();schedule();}}
  }
  async function copy(format){if(loading||format==='html'&&!current())return;try{const value=format==='html'?result.html:validateMarkdown(source.value);await navigator.clipboard.writeText(value);notify(format==='html'?'HTML 片段已复制':'Markdown 已复制');}catch(error){message('mk-error',error.message||'无法访问剪贴板，请手动选择复制。');}}
  function download(event,format){try{if(loading||format==='html'&&!current()||format==='md'&&!source.value.length){event.preventDefault();return;}const key=format==='md'?'mk-download-md':'mk-download-html',old=format==='md'?mdURL:htmlURL;if(old)URL.revokeObjectURL(old);const blob=format==='md'?markdownBlob(source.value):new Blob([markdownHTMLDocument(result.html,$('mk-title').value)],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob);if(format==='md')mdURL=url;else htmlURL=url;$(key).href=url;$(key).download=markdownFilename($('mk-title').value,format);}catch(error){event.preventDefault();message('mk-error',error.message);}}
  function edit(action){if(loading)return;try{const change=markdownEdit(source.value,source.selectionStart,source.selectionEnd,action);source.focus({preventScroll:true});source.setSelectionRange(change.from,change.to);if(!document.execCommand('insertText',false,change.insert)){source.setRangeText(change.insert,change.from,change.to,'end');changed();}source.setSelectionRange(change.start,change.end);mode('split');}catch(error){message('mk-error',error.message);}}
  source.addEventListener('input',changed);source.addEventListener('compositionstart',()=>{composing=true;clearTimeout(timer);});source.addEventListener('compositionend',()=>{composing=false;clearTimeout(timer);schedule();});
  source.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&!event.altKey&&!event.isComposing){const action={b:'bold',i:'italic',k:'link'}[event.key.toLowerCase()];if(action){event.preventDefault();edit(action);}}});
  for(const el of document.querySelectorAll('[data-mk-edit]')){el.addEventListener('mousedown',event=>event.preventDefault());el.addEventListener('click',()=>edit(el.dataset.mkEdit));}
  for(const el of document.querySelectorAll('[data-mk-mode]'))el.addEventListener('click',()=>mode(el.dataset.mkMode));
  $('mk-live').addEventListener('change',()=>{cancel();$('mk-status').textContent=$('mk-live').checked?'正在恢复实时预览…':'实时预览已暂停，原文与预览保留。';update();schedule();});$('mk-breaks').addEventListener('change',changed);$('mk-render').addEventListener('click',render);
  $('mk-stop').addEventListener('click',()=>{cancel();loading=false;$('mk-live').checked=false;$('mk-status').textContent='处理已停止，原文与已有预览保留。可手动更新或重新开启实时预览。';update();});
  $('mk-clear').addEventListener('click',clear);$('mk-sample').addEventListener('click',()=>{if(loading)return;source.value=MARKDOWN_SAMPLE;resetScroll();$('mk-title').value='SGAO 文档示例';changed();render();});
  $('mk-file').addEventListener('change',event=>{load(event.target.files[0]);event.target.value='';});$('view-markdown').addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});$('view-markdown').addEventListener('drop',event=>{if(!event.dataTransfer?.files.length)return;event.preventDefault();if(event.dataTransfer.files.length!==1)message('mk-error','请一次导入一份 MD / TXT 文档。');else load(event.dataTransfer.files[0]);});
  $('mk-copy-md').addEventListener('click',()=>copy('md'));$('mk-copy-html').addEventListener('click',()=>copy('html'));$('mk-download-md').addEventListener('click',event=>download(event,'md'));$('mk-download-html').addEventListener('click',event=>download(event,'html'));
  $('mk-preview').addEventListener('click',event=>{const link=event.target.closest('a');if(!link)return;const href=link.getAttribute('href');if(href?.startsWith('#')){event.preventDefault();const target=document.getElementById(href.slice(1));if(target&&$('mk-preview').contains(target))target.scrollIntoView({block:'start',behavior:'auto'});else notify('未找到对应标题，请使用文档目录定位。');}});
  $('mk-top').addEventListener('click',()=>{$('mk-preview-scroll').scrollTop=0;});
  receiveTextTransfer('markdown',payload=>{if(loading||source.value.length)throw new Error('页面已有文档或正在导入，未覆盖；请手动粘贴或重新打开。');validateMarkdown(payload.text);source.value=payload.text;resetScroll();$('mk-title').value=markdownFilename(payload.name).slice(0,-3);changed();render();},error=>message('mk-error',error));
  window.addEventListener('pagehide',event=>{cancel();loading=false;releaseURLs();if(!event.persisted){disposed=true;source.value='';$('mk-preview').replaceChildren();result=null;}});window.addEventListener('pageshow',event=>{if(event.persisted){update();if(!current())schedule();}});showEmpty();showOutline([]);stats();update();
}
