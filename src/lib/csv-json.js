import {TABLE_LIMITS,validateTableText,validateUnicode} from './csv-json-limits.js';
export {TABLE_LIMITS,validateTableText};
const SEPARATORS=[',','\t',';','|'];
const sourceText=text=>validateTableText(text).replace(/^\uFEFF/,'');
const problem=(text,index,detail)=>new Error(`第 ${text.slice(0,index).split(/\r\n|\r|\n/).length} 行附近：${detail}`);
const checkWidth=rows=>{const width=rows[0]?.length||0;for(let i=0;i<rows.length;i++)if(rows[i].length!==width)throw new Error(`第 ${i+1} 条记录有 ${rows[i].length} 列，预期 ${width} 列。请检查分隔符、引号或空行设置。`);return width;};

export function parseDelimited(input,{delimiter=',',skipBlank=false}={}){
  const text=sourceText(input);if(!SEPARATORS.includes(delimiter)||typeof skipBlank!=='boolean')throw new Error('分隔符或空行设置无效。');
  const rows=[];let row=[],field='',state='start',content=false,cells=0;
  const append=value=>{field+=value;if(field.length>TABLE_LIMITS.field)throw new Error('单个字段最高 10 万单元，请缩小内容。');};
  const pushField=()=>{row.push(field);field='';state='start';if(row.length>TABLE_LIMITS.columns)throw new Error('表格最高 100 列。');};
  const pushRow=()=>{pushField();if(!skipBlank||content){cells+=row.length;if(cells>TABLE_LIMITS.cells)throw new Error('表格最高 20 万个单元格。');rows.push(row);if(rows.length>TABLE_LIMITS.rows+1)throw new Error('表格最高 10,000 条数据记录。');}row=[];content=false;};
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(state==='quoted'){if(char==='"'){if(text[i+1]==='"'){append('"');i++;}else state='closed';}else append(char);continue;}
    if(char===delimiter){content=true;pushField();continue;}
    if(char==='\r'||char==='\n'){pushRow();if(char==='\r'&&text[i+1]==='\n')i++;continue;}
    if(state==='closed')throw problem(text,i,'闭合引号后只能是分隔符或换行，不能有额外字符。');
    content=true;if(char==='"'){if(state!=='start')throw problem(text,i,'字段中的双引号需要包围整个字段，并使用两个双引号转义。');state='quoted';}else{append(char);state='plain';}
  }
  if(state==='quoted')throw problem(text,text.length,'双引号字段未闭合。');
  if(content||row.length||field.length||state==='closed')pushRow();return rows;
}
export function detectDelimiter(text,{skipBlank=false}={}){
  const multiple=[],single=[];let firstError,multiError;
  for(const delimiter of SEPARATORS){let rows;try{rows=parseDelimited(text,{delimiter,skipBlank});const width=checkWidth(rows);if(width>1)multiple.push(delimiter);else if(rows.length)single.push(delimiter);}catch(error){firstError??=error;if(rows?.some(row=>row.length>1)||/100 列|20 万个单元格/.test(error.message))multiError??=error;}}
  if(multiple.length>1)throw new Error('自动识别分隔符有歧义，请手动选择逗号、Tab、分号或竖线。');
  if(multiple.length)return {delimiter:multiple[0],singleColumn:false};if(multiError)throw multiError;if(single.length)return {delimiter:single.includes(',')?',':single[0],singleColumn:true};if(firstError)throw firstError;throw new Error('没有可读取的记录，请检查输入和空行设置。');
}
function csvTable(text,options){
  const detected=options.delimiter==='auto'?detectDelimiter(text,options):{delimiter:options.delimiter,singleColumn:false};
  const values=parseDelimited(text,{...options,delimiter:detected.delimiter}),width=checkWidth(values);if(!width)throw new Error('请输入 CSV / TSV 内容。');
  const fields=options.header?values.shift():Array.from({length:width},(_,i)=>`column_${i+1}`);
  if(fields.some(name=>!name.trim()))throw new Error('表头含空白名称。请修改表头，或取消「首行作为表头」。');
  if(new Set(fields).size!==fields.length)throw new Error('表头名称重复。请修改表头，或取消「首行作为表头」，避免覆盖字段。');
  if(values.length>TABLE_LIMITS.rows)throw new Error('表格最高 10,000 条数据记录。');
  return {kind:'csv',delimiter:detected.delimiter,fields,rows:values.map(row=>row.map(value=>JSON.stringify(value))),notices:[...(detected.singleColumn?['未识别到多列结构，按单列读取；可手动指定分隔符。']:[]),'CSV / TSV 转 JSON 时，所有单元格均保留为字符串。']};
}

// Parse a flat record array without converting JSON numbers to JavaScript Number.
export function parseJSONTable(input){
  const text=sourceText(input);let cursor=0;const fields=[],seenFields=new Set(),records=[];const space=()=>{while(/[\t\n\r ]/.test(text[cursor]||'!'))cursor++;};
  const fail=detail=>{throw problem(text,cursor,detail);};
  const take=char=>{space();if(text[cursor]!==char)fail(`JSON 格式有误，预期 ${char}。`);cursor++;};
  function quoted(){space();if(text[cursor]!=='"')fail('JSON 字段名称必须是双引号字符串。');const start=cursor++;let escaped=false;for(;cursor<text.length;cursor++){const char=text[cursor];if(!escaped&&char==='"'){cursor++;const raw=text.slice(start,cursor);let value;try{value=JSON.parse(raw);}catch{fail('JSON 字符串转义无效。');}validateUnicode(value);if(value.includes('\0'))fail('字段包含 NUL 字符，请修正后重试。');return {raw,value};}if(!escaped&&char==='\\')escaped=true;else escaped=false;}fail('JSON 字符串未闭合。');}
  function scalar(){space();if(text[cursor]==='"'){const {raw,value}=quoted();if(value.length>TABLE_LIMITS.field)fail('单个字段最高 10 万单元。');return raw;}
    if(text[cursor]==='{'||text[cursor]==='[')fail('首版只支持平面对象数组；字段不能是嵌套对象或数组。');
    const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(cursor));if(!match)fail('字段值必须是字符串、数值、布尔值或 null。');if(match[0].length>TABLE_LIMITS.field)fail('单个字段最高 10 万单元。');cursor+=match[0].length;return match[0];}
  take('[');space();if(text[cursor]!==']')for(;;){take('{');const record=new Map();space();if(text[cursor]!=='}')for(;;){const key=quoted().value;if(key.length>TABLE_LIMITS.field)fail('字段名称过长。');if(record.has(key))fail(`对象中出现重复字段 ${JSON.stringify(key)}，请修改后重试。`);take(':');record.set(key,scalar());if(!seenFields.has(key)){fields.push(key);seenFields.add(key);if(fields.length>TABLE_LIMITS.columns)fail('表格最高 100 列。');}space();if(text[cursor]!==',')break;cursor++;}take('}');records.push(record);if(records.length>TABLE_LIMITS.rows)fail('表格最高 10,000 条数据记录。');if(records.length*fields.length>TABLE_LIMITS.cells)fail('表格最高 20 万个单元格。');space();if(text[cursor]!==',')break;cursor++;}
  take(']');space();if(cursor!==text.length)fail('JSON 末尾存在多余内容。');if(records.length&&!fields.length)fail('对象没有字段，无法转换为表格。');
  return {kind:'json',fields,rows:records.map(record=>fields.map(key=>record.has(key)?record.get(key):null)),notices:['JSON 数值保留原始词元；null 和缺失字段在 CSV 中导出为空单元格。']};
}
export function parseTable(input,{format='auto',delimiter='auto',header=true,skipBlank=false}={}){
  const text=validateTableText(input);if(!text.trim())throw new Error('请粘贴或导入 CSV / TSV / JSON。');if(!['auto','csv','json'].includes(format)||!['auto',...SEPARATORS].includes(delimiter)||typeof header!=='boolean'||typeof skipBlank!=='boolean')throw new Error('解析设置无效。');
  const kind=format==='auto'?(/^[\s]*[\[{]/.test(text.replace(/^\uFEFF/,''))?'json':'csv'):format;return kind==='json'?parseJSONTable(text):csvTable(text,{delimiter,header,skipBlank});
}
export function cellText(token){return token===null||token==='null'?'':token.startsWith('"')?JSON.parse(token):token;}
const risky=value=>/^[\t\r\n]|^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(value);
function collector(limit,message){const chunks=[];let length=0;return {append(text){length+=text.length;if(length>limit)throw new Error(message);chunks.push(text);},value(){return chunks.join('');}};}
function selection(table,selected){if(!table||!Array.isArray(table.fields)||!Array.isArray(table.rows))throw new Error('表格数据无效。');const indices=selected??table.fields.map((_,i)=>i);if(!Array.isArray(indices)||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=table.fields.length))throw new Error('导出字段选择无效。');if(table.fields.length&&!indices.length)throw new Error('请至少选择一个导出字段。');return indices;}
export function tableMarkdown(table,selected){const indices=selection(table,selected);if(!indices.length)return '';const out=collector(TABLE_LIMITS.markdown,'Markdown 表格超过 20 万单元，请减少导出字段或记录后再复制。');
  const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\/g,'&#92;').replace(/\|/g,'&#124;').replace(/`/g,'&#96;').replace(/\*/g,'&#42;').replace(/_/g,'&#95;').replace(/~/g,'&#126;').replace(/\[/g,'&#91;').replace(/\]/g,'&#93;').replace(/:/g,'&#58;').replace(/@/g,'&#64;').replace(/\./g,'&#46;').replace(/\r\n|\r|\n/g,' ⏎ ').replace(/\t/g,' ⇥ ');
  const row=values=>out.append(`| ${values.map(escape).join(' | ')} |\n`);row(indices.map(i=>table.fields[i]));row(indices.map(()=>'---'));for(const cells of table.rows)row(indices.map(i=>cellText(cells[i])));return out.value();
}
export function exportTable(table,{selected,delimiter=',',header=true,protect=true}={}){
  const indices=selection(table,selected);if(!SEPARATORS.includes(delimiter)||typeof header!=='boolean'||typeof protect!=='boolean')throw new Error('导出设置无效。');const csv=collector(TABLE_LIMITS.output,'CSV 结果超过 200 万单元，请缩小数据。'),json=collector(TABLE_LIMITS.output,'JSON 结果超过 200 万单元，请缩小数据。');let protectedCells=0;
  const field=(text,typedNumber=false)=>{if(protect&&!typedNumber&&risky(text)){text="'"+text;protectedCells++;}return text===''||text.includes(delimiter)||/["\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;};
  let csvRows=0;const csvRow=values=>{if(csvRows++)csv.append('\r\n');csv.append(values.join(delimiter));};if(header&&indices.length)csvRow(indices.map(i=>field(table.fields[i])));
  json.append('[');table.rows.forEach((cells,rowIndex)=>{const values=indices.filter(i=>cells[i]!==null).map(i=>`    ${JSON.stringify(table.fields[i])}: ${cells[i]}`);json.append(`${rowIndex?',':''}\n  {${values.length?'\n'+values.join(',\n')+'\n  ':''}}`);if(indices.length)csvRow(indices.map(i=>field(cellText(cells[i]),cells[i]!==null&&/^-?\d/.test(cells[i]))));});json.append(table.rows.length?'\n]':']');
  let markdown=null,markdownError='';try{markdown=tableMarkdown(table,indices);}catch(error){markdownError=error.message;}
  return {csv:csv.value(),json:json.value(),markdown,markdownError,protectedCells,delimiter,rows:table.rows.length,columns:indices.length};
}
export async function readTableFile(file,{signal}={}){const check=()=>{if(signal?.aborted)throw new DOMException('读取已停止','AbortError');};check();if(!file||file.size>TABLE_LIMITS.fileBytes)throw new Error('CSV / TSV / JSON 文件最高 4 MB。');const buffer=await file.arrayBuffer();check();let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);}catch{throw new Error('文件不是有效 UTF-8，请另存为 UTF-8 后导入。');}return validateTableText(text);}
export function tableFilename(name,format,delimiter=','){if(!['csv','json','markdown'].includes(format))throw new Error('下载格式无效。');const stem=String(name||'data').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/g,'-').replace(/\.(csv|tsv|json|txt|md)$/i,'').replace(/^[.\s]+|[.\s]+$/g,'').slice(0,120)||'data';return `${stem}-converted.${format==='markdown'?'md':format==='csv'&&delimiter==='\t'?'tsv':format}`;}
export function tableBlob(text,format,delimiter=','){if(typeof text!=='string'||text.length>TABLE_LIMITS.output)throw new Error('导出内容无效或过大。');if(!['csv','json','markdown'].includes(format))throw new Error('导出格式无效。');return new Blob([format==='json'?'':'\uFEFF',text],{type:format==='json'?'application/json;charset=utf-8':format==='markdown'?'text/markdown;charset=utf-8':delimiter==='\t'?'text/tab-separated-values;charset=utf-8':'text/csv;charset=utf-8'});}
export const CSV_SAMPLE='id,name,active,note\r\n00123,山高,true,"包含逗号, 和双引号""示例"""\r\n9007199254740993,SGAO,false,"第一行\n第二行 😀"\r\n00007,示例用户,true,=1+1';
export const JSON_TABLE_SAMPLE='[\n  {"id":9007199254740993,"name":"SGAO 工具箱","score":0.123456789012345678901,"active":true,"note":"包含逗号, 和换行\\n第二行 😀"},\n  {"id":9007199254740994,"name":"示例文档","score":1e400,"active":false,"note":null},\n  {"id":9007199254740995,"name":"继续排版","score":-0,"active":true}\n]';
