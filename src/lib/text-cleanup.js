export const TEXT_LIMITS = Object.freeze({ units:1_000_000, lines:100_000, rules:20, field:10_000, fileBytes:4*1024**2 });
export const DEFAULT_CLEANUP = Object.freeze({trimLines:true,collapseSpaces:false,trimOuter:true,blankLines:'collapse',dedupe:false,joinLines:'none'});
const blank = line => /^[\t \u00a0\u3000]*$/.test(line);
const trimLine = line => line.replace(/^[\t \u00a0\u3000]+|[\t \u00a0\u3000]+$/g,'');
const lf = text => text.replace(/\r\n?/g,'\n');
export function validateText(text) {
  if(typeof text!=='string'||text.length>TEXT_LIMITS.units)throw new Error('文本最高 100 万 UTF-16 单元，请缩小范围后重试。');
  let lines=text.length?1:0;for(let i=0;i<text.length;i++){if(text[i]==='\r'||text[i]==='\n'){if(++lines>TEXT_LIMITS.lines)throw new Error('文本最高 10 万行，请分段处理。');if(text[i]==='\r'&&text[i+1]==='\n')i++;}}return text;
}
export function textStats(text) {
  let characters=0,lines=text.length?1:0,previous;for(const c of text){characters++;if(c==='\r'||c==='\n'&&previous!=='\r')lines++;previous=c;}return {characters,lines,bytes:new TextEncoder().encode(text).length};
}
export function validateCleanup(raw={}) {
  if(!raw||typeof raw!=='object')throw new Error('整理设置无效。');const options={};
  for(const key of ['trimLines','collapseSpaces','trimOuter','dedupe']){const value=raw[key]??DEFAULT_CLEANUP[key];if(typeof value!=='boolean')throw new Error('整理选项无效。');options[key]=value;}
  options.blankLines=raw.blankLines??DEFAULT_CLEANUP.blankLines;options.joinLines=raw.joinLines??DEFAULT_CLEANUP.joinLines;
  if(!['keep','collapse','remove'].includes(options.blankLines)||!['none','space','compact'].includes(options.joinLines))throw new Error('空行或断行模式无效。');
  const rows=raw.rules??[];if(!Array.isArray(rows)||rows.length>TEXT_LIMITS.rules)throw new Error('最多添加 20 条替换规则。');
  options.rules=rows.flatMap((row,index)=>{
    if(!row||typeof row!=='object'||row.enabled!==undefined&&typeof row.enabled!=='boolean')throw new Error(`第 ${index+1} 条替换规则无效。`);
    if(row.enabled===false)return [];
    if(typeof row.find!=='string'||typeof row.replace!=='string'||row.find.length>TEXT_LIMITS.field||row.replace.length>TEXT_LIMITS.field)throw new Error(`第 ${index+1} 条规则的每个字段最高 1 万单元。`);
    if(!row.find&&!row.replace)return [];if(!row.find)throw new Error(`第 ${index+1} 条规则的查找内容不能为空。`);
    return [{index:index+1,find:lf(row.find),replace:lf(row.replace)}];
  });return options;
}
function literalReplace(text,find,replacement) {
  let from=0,at,count=0,length=0;const chunks=[];
  const append=part=>{length+=part.length;if(length>TEXT_LIMITS.units)throw new Error('替换后超过 100 万单元，已取消本次处理。请缩小文本或替换内容。');if(part)chunks.push(part);};
  while((at=text.indexOf(find,from))!==-1){append(text.slice(from,at));append(replacement);from=at+find.length;count++;}
  append(text.slice(from));return {text:chunks.join(''),count};
}
export function cleanText(input,raw={},onProgress=()=>{}) {
  validateText(input);const options=validateCleanup(raw),stats={lineEndings:0,trimmedLines:0,spaceRuns:0,duplicates:0,joinedBreaks:0,blankLines:0,outerLines:0,rules:[]};
  stats.lineEndings=(input.match(/\r/g)||[]).length;let value=lf(input);validateText(value);let lines=value?value.split('\n'):[];onProgress(.1,'正在整理空白…');
  lines=lines.map(line=>{if(options.trimLines){const trimmed=trimLine(line);if(trimmed!==line)stats.trimmedLines++;line=trimmed;}if(options.collapseSpaces)line=line.replace(/[\t \u00a0\u3000]+/g,match=>{if(match!==' ')stats.spaceRuns++;return ' ';});return line;});
  if(options.dedupe){const seen=new Set();lines=lines.filter(line=>{if(blank(line))return true;if(seen.has(line)){stats.duplicates++;return false;}seen.add(line);return true;});}onProgress(.25,'正在整理行与段落…');
  if(options.joinLines!=='none'){
    const joined=[];let paragraph=[];const flush=()=>{if(paragraph.length){stats.joinedBreaks+=paragraph.length-1;joined.push(paragraph.join(options.joinLines==='space'?' ':''));paragraph=[];}};
    for(const line of lines){if(blank(line)){flush();joined.push(line);}else paragraph.push(line);}flush();lines=joined;
  }
  if(options.blankLines!=='keep'){let previous=false;lines=lines.filter(line=>{const empty=blank(line),remove=empty&&(options.blankLines==='remove'||previous);previous=empty;if(remove)stats.blankLines++;return !remove;});}
  if(options.trimOuter){let start=0,end=lines.length;while(start<end&&blank(lines[start]))start++;while(end>start&&blank(lines[end-1]))end--;stats.outerLines=start+lines.length-end;lines=lines.slice(start,end);}
  value=lines.join('\n');validateText(value);onProgress(.4,'正在应用替换规则…');
  options.rules.forEach((rule,index)=>{const result=literalReplace(value,rule.find,rule.replace);value=result.text;validateText(value);stats.rules.push({index:rule.index,matches:result.count});onProgress(.4+.5*(index+1)/Math.max(options.rules.length,1),`正在应用第 ${rule.index} 条替换规则…`);});
  onProgress(1,'整理完成');return {text:value,stats,before:textStats(input),after:textStats(value),changed:value!==input};
}
export async function readTextFile(file,{signal}={}) {
  const check=()=>{if(signal?.aborted)throw new DOMException('读取已停止','AbortError');};check();if(!file||file.size>TEXT_LIMITS.fileBytes)throw new Error('TXT 文件最高 4 MB。');
  const buffer=await file.arrayBuffer();check();let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new Error('文件不是有效 UTF-8，请另存为 UTF-8 TXT 后导入。');}
  if(text.includes('\0'))throw new Error('文件含 NUL 字节，请导入普通 UTF-8 TXT。');validateText(lf(text));validateText(text);return text;
}
export function cleanupFilename(name='text.txt') { return `${name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/g,'-').replace(/\.[^.]*$/,'').replace(/^[.\s]+/,'').slice(0,120)||'text'}-cleaned.txt`; }
export const textBlob=text=>new Blob(['\uFEFF',validateText(text)],{type:'text/plain;charset=utf-8'});
