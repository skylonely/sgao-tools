import test from 'node:test';
import assert from 'node:assert/strict';
import {TABLE_LIMITS,parseDelimited,detectDelimiter,parseTable,parseJSONTable,exportTable,cellText,tableMarkdown,readTableFile,tableBlob,tableFilename,CSV_SAMPLE,JSON_TABLE_SAMPLE} from '../src/lib/csv-json.js';
import {renderMarkdown} from '../src/lib/markdown-render.js';
import {runCSVJSON} from '../src/csv-json-task.js';

test('strict CSV preserves spaces, trailing empties, escaped quotes, Unicode and multiline fields',()=>{
 const text='a,b,c\r\n x ,"one, ""two""\r\n中文 😀",\r\n"",last,tail';assert.deepEqual(parseDelimited(text),[['a','b','c'],[' x ','one, "two"\r\n中文 😀',''],['','last','tail']]);
 assert.deepEqual(parseDelimited('a,b\r1,2\n3,4\r\n'),[['a','b'],['1','2'],['3','4']]);assert.deepEqual(parseDelimited('x,'),[['x','']]);assert.deepEqual(parseDelimited('""'),[['']]);
});
test('quotes are strict and final newlines differ from actual empty records',()=>{
 for(const text of ['a"b,c','"a" x,c','"a','"a""',' "a",b'])assert.throws(()=>parseDelimited(text),/引号/);
 assert.deepEqual(parseDelimited('a\n'),[['a']]);assert.deepEqual(parseDelimited('a\n\nb'),[['a'],[''],['b']]);assert.deepEqual(parseDelimited('a\n\n""\nb',{skipBlank:true}),[['a'],[''],['b']]);assert.deepEqual(parseDelimited('a\n \nb',{skipBlank:true}),[['a'],[' '],['b']]);
});
test('delimiter detection handles quoted candidates, TSV and explicit ambiguity',()=>{
 assert.equal(detectDelimiter('a,b\n1,"x;y|z"').delimiter,',');assert.equal(detectDelimiter('a\tb\n1\t2').delimiter,'\t');assert.equal(detectDelimiter('a;b\n1;2').delimiter,';');assert.equal(detectDelimiter('a\nb').singleColumn,true);
 assert.throws(()=>detectDelimiter('a,b;c\n1,2;3'),/歧义/);assert.throws(()=>parseTable('a,b\n1'),/记录/);assert.throws(()=>parseTable('a,b,c\n1,2\n3,4'),/记录/);assert.throws(()=>parseTable('x,'.repeat(101)),/100 列/);
});
test('headers, row widths and headerless names are explicit, without silent field overwrites',()=>{
 for(const text of ['a,a\n1,2',',b\n1,2','   ,b\n1,2'])assert.throws(()=>parseTable(text,{format:'csv',delimiter:','}),/表头/);
 assert.throws(()=>parseTable('a,b\n1,2,3',{delimiter:','}),/3 列/);const table=parseTable('00123,true\n00004,false',{header:false});assert.deepEqual(table.fields,['column_1','column_2']);assert.deepEqual(JSON.parse(exportTable(table).json),[{column_1:'00123',column_2:'true'},{column_1:'00004',column_2:'false'}]);
 assert.deepEqual(parseTable('name\n\n""',{skipBlank:true}).rows,[['""']]);assert.equal(parseTable('a,b').rows.length,0);
});
test('CSV cells remain strings, including IDs, dates, booleans and numeric-looking values',()=>{
 const result=exportTable(parseTable('id,big,active,date\n00123,9007199254740993,true,2026-10-29'));assert.deepEqual(JSON.parse(result.json),[{id:'00123',big:'9007199254740993',active:'true',date:'2026-10-29'}]);assert.equal(parseTable('\uFEFF'+CSV_SAMPLE).rows.length,3);
});
test('JSON numeric tokens retain precision, exponent spelling, negative zero and significant zeros',()=>{
 const source='[{"id":9007199254740993,"n":1e400,"zero":-0,"decimal":1.2300,"fine":0.123456789012345678901}]',table=parseJSONTable(source),out=exportTable(table);
 for(const value of ['9007199254740993','1e400','-0','1.2300','0.123456789012345678901'])assert.ok(out.json.includes(value));assert.deepEqual(parseJSONTable(out.json).rows,table.rows);assert.ok(out.csv.includes(',-0,1.2300,'));
});
test('union fields preserve first-seen order, null, false, zero and missing members',()=>{
 const table=parseJSONTable('[{"b":false,"a":0},{"c":null,"a":""}]');assert.deepEqual(table.fields,['b','a','c']);assert.deepEqual(table.rows,[['false','0',null],[null,'""','null']]);const out=exportTable(table,{selected:[2,1]});assert.equal(out.json,'[\n  {\n    "a": 0\n  },\n  {\n    "c": null,\n    "a": ""\n  }\n]');assert.ok(out.csv.includes('"",0'));assert.equal(out.columns,2);
 assert.equal(exportTable(parseJSONTable('[]')).json,'[]');assert.throws(()=>parseJSONTable('[{},{}]'),/没有字段/);
});
test('duplicate decoded JSON keys are rejected while prototype-like keys remain ordinary data',()=>{
 assert.throws(()=>parseJSONTable('[{"a":1,"\\u0061":2}]'),/重复字段/);const table=parseJSONTable('[{"__proto__":"x","constructor":"y","2":2,"1":1}]');assert.deepEqual(table.fields,['__proto__','constructor','2','1']);assert.ok(exportTable(table).json.includes('"__proto__": "x"'));assert.equal({}.polluted,undefined);
});
test('invalid JSON shapes, tokens, trailing data and nested values are rejected',()=>{
 for(const source of ['{}','[1]','[null]','[{"a":[]}]','[{"a":{}}]','[{"a":01}]','[{"a":1.}]','[{"a":truex}]','[{"a":NaN}]','[{"a":1},]','[{"a":1,}]','[{"a":1}] trailing','[{"a":"\\q"}]'])assert.throws(()=>parseJSONTable(source),undefined,source);
});
test('decoded lone surrogates and NUL are rejected before lossy CSV/Blob conversion',()=>{
 for(const source of ['[{"x":"\\ud800"}]','[{"\\udfff":1}]','[{"x":"\\u0000"}]','[{"x":"\ud800"}]'])assert.throws(()=>parseJSONTable(source),/代理|NUL/);const table=parseJSONTable('[{"x":"\\ud83d\\ude00"}]');assert.equal(cellText(table.rows[0][0]),'😀');
});
test('CSV export round-trips logical empty records and exact embedded CRLF when protection is off',()=>{
 const original='a,b\r\n"hello\r\nworld","one ""two"""\r\n"",tail',table=parseTable(original,{delimiter:','}),out=exportTable(table,{protect:false});assert.deepEqual(parseDelimited(out.csv),parseDelimited(original));
 const empty=parseTable('name\r\n""',{delimiter:','});assert.equal(exportTable(empty).csv,'name\r\n""');assert.equal(exportTable(empty,{header:false}).csv,'""');assert.equal(parseTable(exportTable(empty).csv).rows.length,1);
});
test('formula protection covers string cells and headers, can be disabled, and preserves typed JSON numbers',()=>{
 const table=parseJSONTable('[{"=header":"=1+1","safe":-42,"at":"＠SUM(A1)","control":"\\ttext","space":"  +1"}]'),out=exportTable(table);assert.equal(out.protectedCells,5);assert.match(out.csv,/'=header/);assert.ok(out.csv.includes(',-42,'));assert.ok(out.csv.includes("'＠SUM(A1)"));assert.ok(out.csv.includes("'\ttext"));assert.ok(out.csv.includes("'  +1"));const exact=exportTable(table,{protect:false});assert.equal(exact.protectedCells,0);assert.ok(exact.csv.includes('=header'));
 for(const value of ['=x','+x','-x','@x','＝x','＋x','－x','＠x','\rtext','\ntext','\ttext',' \t=x'])assert.equal(exportTable(parseJSONTable(JSON.stringify([{v:value}]))).protectedCells,1,value);
});
test('field selection and order apply consistently to JSON, CSV and Markdown',()=>{
 const table=parseTable('a,b,c\n1,2,3'),out=exportTable(table,{selected:[2,0],delimiter:'\t',header:false});assert.equal(out.csv,'3\t1');assert.deepEqual(JSON.parse(out.json),[{c:'3',a:'1'}]);assert.equal(out.markdown,'| c | a |\n| --- | --- |\n| 3 | 1 |\n');for(const selected of [[],[0,0],[-1],[3],[0.5]])assert.throws(()=>exportTable(table,{selected}),/字段/);
});
test('Markdown table content stays literal and cannot add columns, links, images or formatting',()=>{
 const value='*bold* _x_ ~~y~~ | [link](https://evil.example) `code` <img src=x> &amp; \\ end\nnext\tcell',table=parseJSONTable(JSON.stringify([{value}])) ,md=tableMarkdown(table),html=renderMarkdown(md).html;
 assert.equal((html.match(/<td>/g)||[]).length,1);for(const tag of ['<img','<a ','<strong>','<em>','<del>','<code>'])assert.ok(!html.includes(tag),tag);assert.ok(md.includes(' ⏎ '));assert.ok(md.includes(' ⇥ '));assert.ok(html.includes('&lt;img'));
});
test('input, row, column, field, cell and export budgets are bounded',()=>{
 assert.throws(()=>parseTable('x'.repeat(TABLE_LIMITS.units+1)),/100 万/);assert.throws(()=>parseTable('x\ny\n'.repeat(6000),{header:false}),/10,000/);assert.throws(()=>parseTable('x'.repeat(TABLE_LIMITS.field+1)),/字段/);
 assert.throws(()=>parseJSONTable('[{'+Array.from({length:101},(_,i)=>JSON.stringify('c'+i)+':0').join(',')+'}]'),/100 列/);
 const row={};for(let i=0;i<100;i++)row['c'+i]=0;assert.throws(()=>parseJSONTable(JSON.stringify([row,...Array(2000).fill({c0:0})])),/20 万/);
 const table=parseJSONTable(JSON.stringify([{v:'<'.repeat(50000)}]));const out=exportTable(table);assert.equal(out.markdown,null);assert.match(out.markdownError,/20 万/);assert.ok(out.json.length>0&&out.csv.length>0);
});
test('UTF-8 import is strict, supports BOM and exact CRLF, and stops late file reads',async()=>{
 const text='a,b\r\n1,"中文 😀\r\nline"';assert.equal(await readTableFile(new File(['\uFEFF'+text],'data.csv')),'\uFEFF'+text);await assert.rejects(readTableFile(new File([Uint8Array.from([255,254,0,1])],'bad.csv')),/UTF-8/);await assert.rejects(readTableFile({size:TABLE_LIMITS.fileBytes+1,arrayBuffer(){assert.fail();}}),/4 MB/);
 const abort=new AbortController();let resolve;const pending=readTableFile({size:1,arrayBuffer:()=>new Promise(r=>{resolve=r;})},{signal:abort.signal});abort.abort();resolve(new TextEncoder().encode('x').buffer);await assert.rejects(pending,{name:'AbortError'});
});
test('only one leading BOM marker is consumed across file decoding, detection and parsing',async()=>{
 const source='\uFEFF\uFEFFid\r\n123';assert.deepEqual(parseTable(source,{format:'csv',delimiter:','}).fields,['\uFEFFid']);assert.deepEqual(parseTable(source).fields,['\uFEFFid']);const decoded=await readTableFile(new File([source],'bom.csv'));assert.equal(decoded,source);assert.deepEqual(parseTable(decoded).fields,['\uFEFFid']);assert.throws(()=>parseTable('\uFEFF\uFEFF[{"a":1}]'),/JSON/);
});
test('CSV/TSV have a UTF-8 BOM while JSON has no BOM; filenames match the actual format',async()=>{
 const text='a,b\r\n中文,😀',csv=new Uint8Array(await tableBlob(text,'csv').arrayBuffer());assert.deepEqual([...csv.slice(0,3)],[239,187,191]);assert.equal(new TextDecoder().decode(csv),text);const json=await tableBlob('[{"id":9007199254740993}]','json').text();assert.equal(json[0],'[');assert.ok(json.includes('9007199254740993'));assert.match(tableBlob('a\tb','csv','\t').type,/tab-separated-values/);assert.equal(tableFilename('../隐私\u202e/data.JSON','csv','\t'),'-隐私--data-converted.tsv');assert.equal(tableFilename('data.csv','json'),'data-converted.json');
});
test('worker cancellation, timeout and errors terminate once and ignore late results',async()=>{
 const fake=()=>({postMessage(data){this.sent=data;},terminate(){this.stopped=(this.stopped||0)+1;}});let worker=fake();const abort=new AbortController(),pending=runCSVJSON({action:'parse',text:'a\nb'},{signal:abort.signal,workerFactory:()=>worker});assert.equal(worker.sent.action,'parse');abort.abort();await assert.rejects(pending,{name:'AbortError'});worker.onmessage({data:{result:{output:{json:'late'}}}});assert.equal(worker.stopped,1);
 worker=fake();await assert.rejects(runCSVJSON({}, {workerFactory:()=>worker,timeout:5}),/10 秒/);assert.equal(worker.stopped,1);const early=new AbortController();early.abort();await assert.rejects(runCSVJSON({}, {signal:early.signal,workerFactory:()=>assert.fail()}),{name:'AbortError'});
 worker=fake();worker.postMessage=()=>queueMicrotask(()=>worker.onmessage({data:{error:'bad csv'}}));await assert.rejects(runCSVJSON({}, {workerFactory:()=>worker}),/bad csv/);assert.equal(worker.stopped,1);
});
test('both authored examples parse and export without external dependencies',()=>{for(const source of [CSV_SAMPLE,JSON_TABLE_SAMPLE]){const table=parseTable(source),out=exportTable(table);assert.equal(table.rows.length,3);assert.ok(out.json&&out.csv&&out.markdown);}});
