import { METADATA_LIMITS, ORIENTATIONS, metadataFilename } from './lib/image-metadata.js';
import { metadataTask } from './metadata-task.js';
import { createZIP } from './lib/zip.js';
import { sendToCompressor, sendToOCR } from './image-transfer.js';

export function initMetadata({notify}) {
  const $=id=>document.getElementById(id); let items=[],selected=0,busy='',controller,version=0,disposed=false,previewURLs=[],downloadURL,transferring=false;
  const bytes=n=>n>=1024**2?`${(n/1024**2).toFixed(2)} MB`:`${(n/1024).toFixed(1)} KB`;
  const message=(id,text='')=>{$(id).textContent=text;$(id).hidden=!text;};
  const current=()=>items[selected];
  const filename=item=>{const mime=item.info?.mime||'image/jpeg',ext=mime==='image/png'?'png':'jpg';return $('md-neutral').checked?`photo-${String(items.indexOf(item)+1).padStart(3,'0')}-clean.${ext}`:metadataFilename(item.file.name,mime);};
  function releasePreview(){previewURLs.forEach(url=>URL.revokeObjectURL(url));previewURLs=[];if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=null;}
  function pairTable(target,rows) { target.replaceChildren(); for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=value;tr.append(td);}target.append(tr);} }
  function renderDetails(){
    const item=current();releasePreview();for(const id of ['md-original','md-cleaned'])$(id).removeAttribute('src');
    $('md-workspace').hidden=!items.length; if(!item){$('md-name').textContent=$('md-size').textContent=$('md-result-note').textContent='';$('md-fields').replaceChildren();$('md-blocks').replaceChildren();message('md-item-error');message('md-warnings');return;}
    $('md-name').textContent=item.file.name;$('md-size').textContent=item.info?`${item.info.width} × ${item.info.height} px · ${bytes(item.file.size)}`:bytes(item.file.size);
    const originalPreview=item.info?.mime==='image/png'?item.info.preview:item.file;$('md-original-empty').hidden=!!item.info&&!!originalPreview;$('md-cleaned-empty').hidden=!!item.output;
    if(item.info&&originalPreview){const url=URL.createObjectURL(originalPreview);previewURLs.push(url);$('md-original').src=url;}
    if(item.output){const url=URL.createObjectURL(item.output);previewURLs.push(url);$('md-cleaned').src=url;downloadURL=url;}
    const info=item.info, after=item.after;$('md-original').closest('.md-images').classList.toggle('is-transparent',!!info?.alpha);
    pairTable($('md-fields'),info?[
      ['格式',info.format,after?after.format:'保持原格式'],
      ['透明度',info.alpha?'包含透明通道 / 透明色':'无透明通道',after?(after.alpha?'保留':'无透明通道'):'保留'],
      ['尺寸',`${info.width} × ${info.height} px`,after?`${after.width} × ${after.height} px`:'待清理'],
      ['EXIF 方向',ORIENTATIONS[info.orientation||0],after?ORIENTATIONS[after.orientation||0]:'保留'],
      ['ICC 配置',info.icc?'包含（配置内部描述也会保留）':'未发现',after?(after.icc?'原样保留':'未发现'):'保留'],
      ...info.rows.map(row=>[row.name,row.value,after?'已移除':'将移除'])
    ]:[]);
    pairTable($('md-blocks'),info?info.blocks.map(block=>[block.name,bytes(block.bytes),block.kept?'保留必要部分':after?'已移除':'将移除']):[]);
    $('md-info-empty').hidden=!!info;message('md-item-error',item.error||info?.blocked||'');
    message('md-warnings',info?[...info.warnings,'未列出字段不代表没有隐私信息；ICC 描述、画面内容与文件名需自行检查。'].join(' '):'');
    $('md-result-note').textContent=item.output?`清理后 ${bytes(item.output.size)} · ${item.file.size>=item.output.size?`减少 ${bytes(item.file.size-item.output.size)}`:`增加 ${bytes(item.output.size-item.file.size)}`} · 压缩画面数据保持不变，已重新检查附加数据段。`:'点击「批量清理」生成副本，再对照画面和信息。';
    update();
  }
  function update(){
    const working=!!busy, item=current(), done=items.filter(i=>i.output).length, eligible=items.filter(i=>i.info&&!i.info.blocked&&!i.output).length;
    $('md-file').disabled=$('md-sample').disabled=$('md-png-sample').disabled=working;$('md-clear').disabled=!items.length&&!working;$('md-run').disabled=working||!eligible;$('md-zip').disabled=working||!done;
    $('md-stop').hidden=!working;$('md-stop').disabled=!!controller?.signal.aborted;$('md-neutral').disabled=working;
    $('md-run').textContent=working?'处理中…':done&&eligible?'清理剩余图片':'批量清理';
    $('md-count').textContent=`${items.length} 张 · ${done} 张已清理 · 源文件合计 ${bytes(items.reduce((n,i)=>n+i.file.size,0))}`;
    const link=$('md-download');link.setAttribute('aria-disabled',String(!item?.output||working));link.tabIndex=item?.output&&!working?0:-1;if(item?.output&&!working){link.href=downloadURL;link.download=filename(item);}else link.removeAttribute('href');
    $('md-compress').disabled=$('md-ocr').disabled=working||transferring||!item?.output||item.output.size>METADATA_LIMITS.fileBytes;
    $('md-drop').classList.toggle('is-loaded',!!items.length);
    $('md-list').replaceChildren();items.forEach((entry,i)=>{const row=document.createElement('div');row.className=`md-row${selected===i?' is-active':''}`;const choose=document.createElement('button');choose.type='button';choose.className='md-choose';choose.setAttribute('aria-pressed',String(i===selected));const name=document.createElement('strong');name.textContent=entry.file.name;const status=document.createElement('small');status.textContent=entry.error?'读取 / 处理失败':entry.info?.blocked?'仅查看，无法清理':entry.output?`已清理 · ${bytes(entry.output.size)}`:entry.info?'信息已读取，待清理':'等待读取';choose.append(name,status);choose.addEventListener('click',()=>{selected=i;renderDetails();});const remove=document.createElement('button');remove.type='button';remove.textContent='移除';remove.disabled=working;remove.setAttribute('aria-label',`移除 ${entry.file.name}`);remove.addEventListener('click',()=>{invalidateZip();items.splice(i,1);selected=Math.max(0,Math.min(selected,items.length-1));renderDetails();update();});row.append(choose,remove);$('md-list').append(row);});
  }
  async function load(files){
    if(busy){notify('请先停止当前处理');return;}files=Array.from(files||[]);if(!files.length)return;
    if(items.length+files.length>METADATA_LIMITS.files||files.some(f=>!f.size||f.size>METADATA_LIMITS.fileBytes)||items.reduce((n,i)=>n+i.file.size,0)+files.reduce((n,f)=>n+f.size,0)>METADATA_LIMITS.batchBytes){message('md-error','每批最多 20 张，单张最高 20 MB、源文件合计最高 100 MB。现有内容保留。');return;}
    invalidateZip();const first=items.length;items.push(...files.map(file=>({file})));selected=first;message('md-error');const ticket=++version;controller=new AbortController();busy='inspect';renderDetails();
    try{for(let i=first;i<items.length;i++){if(controller.signal.aborted)break;$('md-status').textContent=`正在本地读取 ${i-first+1} / ${files.length}…`;try{items[i].info=await metadataTask(items[i].file,'inspect',{signal:controller.signal});}catch(error){if(error.name==='AbortError')break;items[i].error=error.message;}if(disposed||ticket!==version)return;$('md-progress').value=(i-first+1)/files.length;renderDetails();}}
    finally{if(!disposed&&ticket===version){const stopped=controller.signal.aborted;busy='';controller=null;$('md-status').textContent=stopped?'读取已停止，已读取的信息保留；可移除未读图片后重新添加。':'读取完成。选择图片查看信息，再批量清理生成副本。';renderDetails();}}
  }
  async function clean(){
    if(busy)return;const pending=items.filter(i=>i.info&&!i.info.blocked&&!i.output);if(!pending.length)return;
    const ticket=++version,abort=new AbortController();controller=abort;busy='clean';message('md-error');update();let completed=0;
    try{for(const item of pending){if(abort.signal.aborted||disposed||ticket!==version)break;$('md-status').textContent=`正在清理 ${completed+1} / ${pending.length}…`;try{const result=item.info.prepared?{output:item.info.prepared,after:item.info.preparedInfo}:await metadataTask(item.file,'clean',{signal:abort.signal});if(disposed||ticket!==version)return;item.output=new File([result.output],filename(item),{type:result.after.mime});item.after=result.after;item.info.prepared=null;item.error='';}catch(error){if(error.name==='AbortError')break;item.error=error.message;}completed++;$('md-progress').value=completed/pending.length;renderDetails();}}
    finally{if(!disposed&&ticket===version){const stopped=controller.signal.aborted;busy='';controller=null;$('md-status').textContent=stopped?'清理已停止，已完成的副本可下载，原文件不变。':`本批处理完成，${items.filter(i=>i.output).length} 张副本可下载；请对照预览后分享。`;renderDetails();}}
  }
  async function zip(){
    if(busy)return;const ready=items.filter(i=>i.output);if(!ready.length)return;
    const ticket=++version,abort=new AbortController();controller=abort;busy='zip';update();
    const active=()=>!disposed&&ticket===version&&!abort.signal.aborted;
    try{
      const files=[];
      for(const item of ready){const data=new Uint8Array(await item.output.arrayBuffer());if(!active())return;files.push({name:filename(item),data});await new Promise(r=>setTimeout(r,0));}
      if(!active())return;$('md-status').textContent='正在打包清理后的副本…';
      const blob=new Blob([createZIP(files)],{type:'application/zip'});if(!active())return;
      const url=URL.createObjectURL(blob),link=$('md-zip-download');if(link.dataset.url)URL.revokeObjectURL(link.dataset.url);link.href=url;link.download='sgao-clean-photos.zip';link.dataset.url=url;link.hidden=false;
      message('md-zip-note','打包完成，点击「下载 ZIP」保存；可继续检查单张副本。');$('md-status').textContent=`打包完成，包含 ${ready.length} 张清理后的副本。`;
    }catch(error){if(!disposed&&ticket===version){message('md-error',error.message);$('md-status').textContent='本次打包未完成，单张副本仍可下载。';}}
    finally{if(!disposed&&ticket===version){if(abort.signal.aborted)$('md-status').textContent='打包已停止，单张副本保留。';busy='';controller=null;update();}}
  }
  function invalidateZip(){const link=$('md-zip-download');if(link.dataset.url)URL.revokeObjectURL(link.dataset.url);delete link.dataset.url;link.removeAttribute('href');link.hidden=true;message('md-zip-note');}
  function clear(){controller?.abort();version++;items=[];selected=0;busy='';controller=null;releasePreview();invalidateZip();$('md-progress').value=0;message('md-error');$('md-status').textContent='图片与元数据已清空，原文件未修改。';renderDetails();update();}
  async function transfer(kind){const file=current()?.output;if(!file||busy||transferring)return;transferring=true;update();try{const outgoing=new File([file],filename(current()),{type:file.type});await(kind==='ocr'?sendToOCR(outgoing):sendToCompressor(outgoing));notify('清理后的图片已发送');}catch(error){message('md-error',error.message);}finally{transferring=false;if(!disposed)update();}}
  $('md-file').addEventListener('change',e=>{load(e.target.files);e.target.value='';});
  for(const type of ['dragenter','dragover'])$('md-drop').addEventListener(type,e=>{e.preventDefault();if(!busy)$('md-drop').classList.add('drag-over');});for(const type of ['dragleave','drop'])$('md-drop').addEventListener(type,e=>{e.preventDefault();$('md-drop').classList.remove('drag-over');if(type==='drop')load(e.dataTransfer.files);});
  $('md-run').addEventListener('click',()=>{invalidateZip();clean();});$('md-stop').addEventListener('click',()=>{controller?.abort();update();});$('md-clear').addEventListener('click',clear);$('md-zip').addEventListener('click',zip);$('md-neutral').addEventListener('change',()=>{invalidateZip();update();});
  $('md-sample').addEventListener('click',async()=>{if(busy)return;try{const {sampleMetadataFile}=await import('./metadata-sample.js');load([await sampleMetadataFile()]);}catch(error){message('md-error',error.message);}});
  $('md-png-sample').addEventListener('click',async()=>{if(busy)return;try{const {sampleMetadataPNGFile}=await import('./metadata-sample.js');load([await sampleMetadataPNGFile()]);}catch(error){message('md-error',error.message);}});
  $('md-download').addEventListener('click',e=>{if($('md-download').getAttribute('aria-disabled')==='true')e.preventDefault();});$('md-compress').addEventListener('click',()=>transfer('compress'));$('md-ocr').addEventListener('click',()=>transfer('ocr'));
  for(const id of ['md-original','md-cleaned'])$(id).addEventListener('error',()=>{if(current()?.info)message('md-item-error','浏览器无法预览该图片。请保留原件，并在本机图片软件检查副本。');});
  window.addEventListener('pagehide',event=>{controller?.abort();if(!event.persisted){disposed=true;clear();}});window.addEventListener('pageshow',event=>{if(event.persisted)update();});update();
}
