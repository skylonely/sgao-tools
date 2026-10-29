import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanText,validateText,validateCleanup,textStats,readTextFile,textBlob,cleanupFilename,TEXT_LIMITS} from '../src/lib/text-cleanup.js';
import {runTextCleanup} from '../src/text-cleanup-task.js';
const unchanged={trimLines:false,collapseSpaces:false,trimOuter:false,blankLines:'keep',dedupe:false,joinLines:'none'};

test('default cleanup trims line edges and outer blanks, keeps paragraphs and normalizes CRLF/CR',()=>{
 const input='  第一行\t\r\n\r\n\r\n\u3000第二行\u00a0\r\n';const result=cleanText(input);assert.equal(result.text,'第一行\n\n第二行');assert.equal(result.stats.trimmedLines,2);assert.equal(result.stats.lineEndings,4);assert.equal(result.changed,true);
 assert.equal(cleanText('a\rb\r\nc\n',unchanged).text,'a\nb\nc\n');assert.equal(cleanText('',unchanged).text,'');assert.deepEqual(textStats('a\rb\r\nc\n'),{characters:7,lines:4,bytes:7});
});
test('whitespace options are independent and never remove Unicode joins or normalize combining marks',()=>{
 const text=' \tA\u3000B\u00a0\u00a0C  \n\ne\u0301 👨‍👩‍👧‍👦 می\u200cروم ️';assert.equal(cleanText(text,unchanged).text,text);
 assert.equal(cleanText('\tA\u3000B\u00a0\u00a0C',{...unchanged,collapseSpaces:true}).text,' A B C');assert.equal(cleanText(' A  B ',{...unchanged,trimLines:true}).text,'A  B');
});
test('dedupe is exact and keeps first occurrence, case differences and repeated paragraph gaps',()=>{
 const text='a\n\na\n\nA\n b\nb';const result=cleanText(text,{...unchanged,dedupe:true});assert.equal(result.text,'a\n\n\nA\n b\nb');assert.equal(result.stats.duplicates,1);
 assert.equal(cleanText(' a \na\nA',{dedupe:true}).text,'a\nA');
});
test('OCR joining respects paragraphs before blank removal and never guesses hyphens',()=>{
 const text='第一\n第二\n\n另一\n段落\n\nlast-\nword';assert.equal(cleanText(text,{joinLines:'compact',blankLines:'remove'}).text,'第一第二\n另一段落\nlast-word');
 assert.equal(cleanText('First\nline\n\nNext\nparagraph',{joinLines:'space'}).text,'First line\n\nNext paragraph');assert.equal(cleanText('x\ny').text,'x\ny');
});
test('literal replacement preserves dollar substitutions, regex syntax and backslash sequences',()=>{
 const replace='$& $$ $` $\' \\n \\t \\';assert.equal(cleanText('x',{rules:[{find:'x',replace}]}).text,replace);
 assert.equal(cleanText('a.*b .+ [x] \\n',{rules:[{find:'.*',replace:'!'}, {find:'\\n',replace:'<LF>'}]}).text,'a!b .+ [x] <LF>');
 assert.equal(cleanText('x\r\ny',{...unchanged,rules:[{find:'\r\n',replace:'\n\n'}]}).text,'x\n\ny');
});
test('rules cascade forwards, do not recursively scan new content, and use non-overlapping matches',()=>{
 assert.equal(cleanText('a',{rules:[{find:'a',replace:'ab'},{find:'b',replace:'B'}]}).text,'aB');assert.equal(cleanText('a',{rules:[{find:'a',replace:'aa'}]}).text,'aa');
 const result=cleanText('aaa',{rules:[{enabled:false,find:'a',replace:'Q'},{find:'aa',replace:'X'}]});assert.equal(result.text,'Xa');assert.deepEqual(result.stats.rules,[{index:2,matches:1}]);
});
test('space searches and empty replacements work; successful empty results remain exportable',async()=>{
 assert.equal(cleanText('a b',{...unchanged,rules:[{find:' ',replace:''}]}).text,'ab');const result=cleanText('全部删除',{rules:[{find:'全部删除',replace:''}]});assert.equal(result.text,'');assert.equal(result.changed,true);assert.deepEqual(result.after,{characters:0,lines:0,bytes:0});
 assert.deepEqual(Array.from(new Uint8Array(await textBlob('').arrayBuffer())),[239,187,191]);assert.equal(cleanText(' \n \n').text,'');
});
test('empty/inactive rules and settings are validated without trimming meaningful field content',()=>{
 assert.equal(validateCleanup({rules:[{find:'',replace:''},{enabled:false,find:undefined}]}).rules.length,0);assert.throws(()=>validateCleanup({rules:[{find:'',replace:'x'}]}),/查找内容不能为空/);
 for(const settings of [{blankLines:'bad'},{joinLines:'bad'},{dedupe:'yes'},{rules:Array.from({length:21},()=>({find:'a',replace:'b'}))},{rules:[{find:'x'.repeat(10001),replace:''}]}])assert.throws(()=>validateCleanup(settings));
 assert.equal(validateCleanup({rules:[{find:' ',replace:'  '}]}).rules[0].replace,'  ');
});
test('replacement growth is bounded at every rule before a huge result is constructed',()=>{
 assert.throws(()=>cleanText('a'.repeat(10000),{rules:[{find:'a',replace:'x'.repeat(1000)}]}),/超过 100 万/);
 assert.throws(()=>cleanText('a'.repeat(500001),{rules:[{find:'a',replace:'aa'},{find:'a',replace:''}]}),/超过 100 万/);
 assert.throws(()=>cleanText('a'.repeat(100000),{rules:[{find:'a',replace:'\n'}]}),/10 万行/);
});
test('UTF-16 and normalized line limits agree for pasted text, CR-only data and Emoji',()=>{
 assert.equal(validateText('😀'.repeat(500000)).length,TEXT_LIMITS.units);assert.throws(()=>validateText('😀'.repeat(500001)),/100 万/);assert.throws(()=>validateText('a\r'.repeat(100000)),/10 万行/);assert.throws(()=>validateText('a\r\n'.repeat(100000)),/10 万行/);
 assert.deepEqual(textStats('😀e\u0301\n'),{characters:4,lines:2,bytes:8});
});
test('UTF-8 TXT import is strict, accepts a BOM and empty files, and aborts late reads',async()=>{
 assert.equal(await readTextFile(new File(['\uFEFF中文 😀\r\n'],'sample.txt')),'中文 😀\r\n');assert.equal(await readTextFile(new File([],'empty.txt')),'');
 await assert.rejects(readTextFile(new File([Uint8Array.from([0xff,0xfe,0,1])],'bad.txt')),/UTF-8/);await assert.rejects(readTextFile(new File(['a\0b'],'binary.txt')),/NUL/);await assert.rejects(readTextFile({size:TEXT_LIMITS.fileBytes+1,arrayBuffer(){assert.fail();}}),/4 MB/);
 const abort=new AbortController();let resolve;const pending=readTextFile({size:1,arrayBuffer:()=>new Promise(r=>{resolve=r;})},{signal:abort.signal});abort.abort();resolve(new TextEncoder().encode('a').buffer);await assert.rejects(pending,{name:'AbortError'});
});
test('TXT export preserves Unicode, editing and newlines with a safe fixed suffix',async()=>{
 const text='校对 😀\n$& \\n\n';const bytes=new Uint8Array(await textBlob(text).arrayBuffer());assert.deepEqual(Array.from(bytes.subarray(0,3)),[239,187,191]);assert.equal(new TextDecoder().decode(bytes),text);assert.equal(cleanupFilename('../秘密\u202e/文件.exe'),'-秘密--文件-cleaned.txt');
});
test('worker cancellation, errors and timeout terminate once and ignore late results',async()=>{
 const fake=()=>({postMessage(message){this.sent=message;},terminate(){this.terminated=(this.terminated||0)+1;}});let worker=fake(),progress=[];const abort=new AbortController();const pending=runTextCleanup('source',{}, {signal:abort.signal,workerFactory:()=>worker,onProgress:(p,label)=>progress.push([p,label])});assert.equal(worker.sent.text,'source');worker.onmessage({data:{progress:.4,label:'stage'}});abort.abort();await assert.rejects(pending,{name:'AbortError'});worker.onmessage({data:{result:{text:'late'}}});assert.equal(worker.terminated,1);assert.deepEqual(progress,[[.4,'stage']]);
 worker=fake();await assert.rejects(runTextCleanup('x',{}, {workerFactory:()=>worker,timeout:5}),/10 秒/);assert.equal(worker.terminated,1);
 const early=new AbortController();early.abort();await assert.rejects(runTextCleanup('x',{}, {signal:early.signal,workerFactory:()=>assert.fail()}),{name:'AbortError'});
 worker=fake();worker.postMessage=()=>queueMicrotask(()=>worker.onmessage({data:{error:'bad rule'}}));await assert.rejects(runTextCleanup('x',{}, {workerFactory:()=>worker}),/bad rule/);assert.equal(worker.terminated,1);
});
