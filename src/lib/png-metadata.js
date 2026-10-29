import { crc32 } from './zip.js';
import { METADATA_LIMITS, readExifTIFF, minimalExifTIFF } from './jpeg-metadata.js';

export const PNG_SIGNATURE = Uint8Array.from([137,80,78,71,13,10,26,10]);
const critical = new Set(['IHDR','PLTE','IDAT','IEND']);
const retained = new Map([['tRNS','透明度'],['iCCP','ICC 色彩配置'],['sRGB','sRGB 色彩空间'],['gAMA','Gamma 色彩参数'],['cHRM','色度参数'],['sBIT','有效位深'],['cICP','色彩编码参数'],['mDCV','HDR 显示色彩参数'],['cLLI','HDR 亮度参数'],['bKGD','背景色'],['pHYs','像素比例 / 分辨率']]);
const beforePalette = new Set(['cHRM','gAMA','iCCP','sBIT','sRGB','cICP']);
const fixed = new Map([['cHRM',32],['gAMA',4],['sRGB',1],['cICP',4],['mDCV',24],['cLLI',8],['pHYs',9],['tIME',7]]);
const printable = value => value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').trim();
const latin = data => String.fromCharCode(...data.subarray(0,1024));
function keyword(data) { const end=data.indexOf(0); if(end<1||end>79)return null;return {end,name:printable(latin(data.subarray(0,end)))}; }
function textRow(type,data) {
  const key=keyword(data);if(!key)return {name:`${type} 文本`,value:'字段格式异常（清理时整块移除）'};
  let start=key.end+1,compressed=false;
  if(type==='zTXt'){if(data[start++]!==0)return {name:key.name,value:'压缩方式不支持（清理时整块移除）'};compressed=true;}
  if(type==='iTXt'){
    const flag=data[start++],method=data[start++];if(![0,1].includes(flag)||method!==0)return {name:key.name,value:'文本格式异常（清理时整块移除）'};compressed=flag===1;
    for(let i=0;i<2;i++){const end=data.indexOf(0,start);if(end<0)return {name:key.name,value:'文本格式异常（清理时整块移除）'};start=end+1;}
  }
  if(compressed)return {name:`${key.name}（${type}）`,value:'压缩文本未展开；清理时整块移除',compressed:true};
  const content=data.subarray(start,start+1024),value=printable(type==='iTXt'?new TextDecoder().decode(content):latin(content));
  return {name:`${key.name}（${type}）`,value:`${value||'（空文本）'}${data.length-start>1024?'…（预览已截断）':''}`};
}
export function pngChunk(type,data) {
  if(!/^[A-Za-z]{4}$/.test(type)||!(data instanceof Uint8Array))throw new Error('PNG 数据块无效。');
  const bytes=new Uint8Array(data.length+12),view=new DataView(bytes.buffer);view.setUint32(0,data.length);bytes.set(new TextEncoder().encode(type),4);bytes.set(data,8);view.setUint32(bytes.length-4,crc32(bytes.subarray(4,bytes.length-4)));return bytes;
}

export function inspectPNG(bytes) {
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>METADATA_LIMITS.fileBytes)throw new Error('请选择非空 PNG，单张最高 20 MB。');
  if(!PNG_SIGNATURE.every((b,i)=>bytes[i]===b))throw new Error('文件内容不是 PNG。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),parts=[],blocks=[],rows=[],warnings=[],seen=new Set();
  let at=8,end=0,width,height,bitDepth,colorType,interlace,palette=0,idatBytes=0,idat=false,idatEnded=false,exif,blocked='',alpha=false;
  while(at<bytes.length){
    if(parts.length>=4096)throw new Error('PNG 数据块过多，暂不支持。');
    if(at+12>bytes.length)throw new Error('PNG 数据块被截断。');
    const length=view.getUint32(at),next=at+12+length,type=String.fromCharCode(...bytes.subarray(at+4,at+8));
    if(length>0x7fffffff||next>bytes.length||!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type))throw new Error('PNG 数据块长度或类型无效。');
    if(view.getUint32(next-4)!==crc32(bytes.subarray(at+4,next-4)))throw new Error(`PNG ${type} 校验失败，请检查原文件。`);
    if(parts.length===0&&type!=='IHDR')throw new Error('PNG 缺少开头的 IHDR。');
    if(!critical.has(type)&&!(bytes[at+4]&32))throw new Error(`PNG 含不支持的关键块 ${type}，不能安全清理。`);
    const data=bytes.subarray(at+8,next-4),part={start:at,end:next,type,keep:critical.has(type)||retained.has(type)};parts.push(part);at=next;
    if((type!=='IDAT'&&critical.has(type)||retained.has(type)||type==='eXIf')&&seen.has(type))throw new Error(`PNG ${type} 数据块重复。`);
    if(type!=='IDAT')seen.add(type);
    if(fixed.has(type)&&length!==fixed.get(type))throw new Error(`PNG ${type} 数据块长度无效。`);
    if(type==='IHDR'){
      if(length!==13)throw new Error('PNG 图像头无效。');width=view.getUint32(part.start+8);height=view.getUint32(part.start+12);bitDepth=data[8];colorType=data[9];interlace=data[12];
      if(!width||!height||width>METADATA_LIMITS.edge||height>METADATA_LIMITS.edge||width*height>METADATA_LIMITS.pixels)throw new Error('PNG 尺寸不支持：单边最高 10000 px、总像素最高 3200 万。');
      if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]})[colorType]?.includes(bitDepth)||data[10]!==0||data[11]!==0||![0,1].includes(interlace))throw new Error('PNG 位深、颜色类型或编码不支持。');alpha=[4,6].includes(colorType);
    }
    if(beforePalette.has(type)&&(palette||idat))throw new Error(`PNG ${type} 必须位于调色板和图像数据之前。`);
    if(retained.has(type)&&idat)throw new Error(`PNG ${type} 位于图像数据之后，无法可靠保留外观。`);
    if(type==='PLTE'){
      if(idat||seen.has('tRNS')||seen.has('bKGD')||[0,4].includes(colorType)||!length||length%3||length>768||colorType===3&&length/3>2**bitDepth)throw new Error('PNG 调色板无效或顺序异常。');palette=length/3;
    }
    if(type==='IDAT'){if(idatEnded||colorType===3&&!palette)throw new Error('PNG 图像数据不连续或缺少调色板。');idat=true;idatBytes+=length;}
    else if(idat)idatEnded=true;
    if(type==='tRNS'){
      if(colorType===0&&length!==2||colorType===2&&length!==6||colorType===3&&(!palette||!length||length>palette)||[4,6].includes(colorType))throw new Error('PNG 透明度数据无效。');alpha=true;
    }
    if(type==='bKGD'&&(length!==({0:2,2:6,3:1,4:2,6:6})[colorType]||colorType===3&&(!palette||data[0]>=palette)))throw new Error('PNG 背景色数据无效。');
    if(type==='gAMA'&&!view.getUint32(part.start+8)||type==='sRGB'&&data[0]>3||type==='pHYs'&&data[8]>1)throw new Error('PNG 色彩或分辨率参数无效。');
    if(type==='sBIT'&&(length!==({0:1,2:3,3:3,4:2,6:4})[colorType]||data.some(n=>!n||n>(colorType===3?8:bitDepth))))throw new Error('PNG 有效位深参数无效。');
    if(type==='iCCP'){const key=keyword(data);if(!key||data[key.end+1]!==0||key.end+2>=data.length)throw new Error('PNG ICC 配置头无效。');}
    if(type==='eXIf'){
      if(idat)blocked='PNG EXIF 位于图像数据之后，无法可靠保留方向，请先另存副本。';
      try{exif=readExifTIFF(data);rows.push(...exif.rows);part.replacement=exif.orientation!==undefined||exif.colorSpace!==undefined?pngChunk('eXIf',minimalExifTIFF(exif.orientation,exif.colorSpace)):null;}
      catch{blocked='PNG EXIF 结构异常或含不支持的色彩参数，无法可靠清理。';}
    }
    if(['acTL','fcTL','fdAT'].includes(type))blocked='检测到 APNG 动图，暂不清理，避免丢失动画帧。';
    if(['tEXt','zTXt','iTXt'].includes(type)){const row=textRow(type,data);if(rows.length<200)rows.push(row);if(row.compressed)warnings.push('压缩文本只显示字段名，不解压内容；清理时整块移除。');}
    if(type==='tIME'&&rows.length<200)rows.push({name:'PNG 修改时间',value:`${data[0]*256+data[1]}-${String(data[2]).padStart(2,'0')}-${String(data[3]).padStart(2,'0')} ${String(data[4]).padStart(2,'0')}:${String(data[5]).padStart(2,'0')}:${String(data[6]).padStart(2,'0')} UTC`});
    if(!critical.has(type))blocks.push({name:type==='eXIf'?'eXIf 拍摄信息':`${type} · ${retained.get(type)||(['tEXt','zTXt','iTXt'].includes(type)?'文本 / 附加信息':type==='tIME'?'修改时间':'附加信息')}`,bytes:length+12,kept:part.keep});
    if(type==='IEND'){if(length||!idatBytes)throw new Error('PNG 没有完整的图像数据。');end=at;break;}
  }
  if(!end)throw new Error('PNG 缺少 IEND 结束块。');
  if((exif?.adobeRGB||exif?.colorSpace===65535)&&!seen.has('iCCP'))blocked='PNG EXIF 标记为非 sRGB 且没有 ICC 配置，无法可靠保留颜色。';
  if(end<bytes.length)blocks.push({name:'结束块后的附加数据',bytes:bytes.length-end,kept:false});
  return {mime:'image/png',format:'PNG',width,height,bitDepth,colorType,interlace,alpha,orientation:exif?.orientation,colorSpace:exif?.colorSpace,gps:exif?.gps||false,icc:seen.has('iCCP'),rows,blocks,warnings:[...new Set(warnings)],blocked,parts,end};
}
export function cleanPNG(bytes) {
  const before=inspectPNG(bytes);if(before.blocked)throw new Error(before.blocked);
  const chunks=[bytes.subarray(0,8)];for(const part of before.parts){if(part.type==='eXIf'){if(part.replacement)chunks.push(part.replacement);}else if(part.keep)chunks.push(bytes.subarray(part.start,part.end));}
  const output=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
  const after=inspectPNG(output);
  if(after.blocked||after.rows.length||after.gps||after.orientation!==before.orientation||after.colorSpace!==before.colorSpace||after.alpha!==before.alpha||after.width!==before.width||after.height!==before.height)throw new Error('PNG 清理结果校验失败，请保留原文件。');
  return {output,before,after};
}
// Strip textual payloads before native decoding, keeping the original eXIf and display chunks.
export function previewPNG(bytes,info=inspectPNG(bytes)) {
  const parts=[bytes.subarray(0,8),...info.parts.filter(p=>p.keep||p.type==='eXIf').map(p=>bytes.subarray(p.start,p.end))];
  const output=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){output.set(p,at);at+=p.length;}return output;
}
