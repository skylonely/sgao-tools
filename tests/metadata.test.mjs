import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectJPEG, cleanJPEG, jpegSegment, metadataFilename, METADATA_LIMITS } from '../src/lib/jpeg-metadata.js';
import { metadataTask } from '../src/metadata-task.js';
import { demoExif } from '../src/metadata-sample.js';
import { createZIP } from '../src/lib/zip.js';
import { readFile } from 'node:fs/promises';

const concat=(...chunks)=>Uint8Array.from(chunks.flatMap(c=>Array.from(c)));
const segment=(marker,payload)=>Uint8Array.from([255,marker,(payload.length+2)>>8,(payload.length+2)&255,...payload]);
const text=value=>new TextEncoder().encode(value);
const frame=segment(0xc0,[8,0,40,0,64,1,1,0x11,0]), sos=segment(0xda,[1,1,0,0,63,0]), scan=Uint8Array.from([1,2,255,0,3,255,0xd0,4,255,255,0xd1,5]);
const jpeg=(...metadata)=>concat([255,0xd8],...metadata,frame,sos,scan,[255,0xd9]);
function orientation(value,little=true){const data=new Uint8Array(32),v=new DataView(data.buffer);data.set([69,120,105,102,0,0]);data.set(little?[73,73]:[77,77],6);v.setUint16(8,42,little);v.setUint32(10,8,little);v.setUint16(14,1,little);v.setUint16(16,0x112,little);v.setUint16(18,3,little);v.setUint32(20,1,little);v.setUint16(24,value,little);return segment(0xe1,data);}
const imageParts=bytes=>{const info=inspectJPEG(bytes);return info.parts.filter(p=>!(typeof p.marker==='number'&&(p.marker>=0xe0&&p.marker<=0xef||p.marker===0xfe))).map(p=>Array.from(bytes.subarray(p.start,p.end)));};

test('JPEG cleaning preserves all image bytes, strips EXIF/XMP/IPTC/COM/unknown segments and trailing data',()=>{
 const source=concat(jpeg(demoExif(),segment(0xe1,text('http://ns.adobe.com/xap/1.0/\0<rdf GPS="private"/>')),segment(0xed,text('IPTC author')),segment(0xfe,text('private comment')),segment(0xe5,text('private vendor'))),text('private trailing bytes'));
 const {output,before,after}=cleanJPEG(source);assert.equal(before.gps,true);assert.ok(before.rows.some(r=>r.name==='拍摄时间'));assert.ok(before.rows.some(r=>r.name==='机身序列号'));assert.equal(after.gps,false);assert.deepEqual(after.rows,[]);assert.equal(after.orientation,6);assert.deepEqual(imageParts(source),imageParts(output));assert.equal(after.end,output.length);for(const s of ['private','SGAO Demo','DEMO-NO-REAL-SERIAL'])assert.equal(new TextDecoder().decode(output).includes(s),false);assert.ok(output.length<source.length);assert.equal(source[source.length-1],115);
});
test('orientation values 1..8 and both TIFF byte orders are retained; absent orientation stays absent',()=>{
 for(const little of [true,false])for(let n=1;n<=8;n++){const {after}=cleanJPEG(jpeg(orientation(n,little)));assert.equal(after.orientation,n);}
 assert.equal(cleanJPEG(jpeg()).after.orientation,undefined);
});
test('JFIF thumbnails and Adobe tails are removed while required fixed color headers stay',()=>{
 const jfif=segment(0xe0,[74,70,73,70,0,1,2,0,0,1,0,1,1,1,99,98,97]),adobe=segment(0xee,[65,100,111,98,101,0,100,0,0,0,0,1,...text('private tail')]);const {output,after}=cleanJPEG(jpeg(jfif,adobe,segment(0xe0,text('JFXX\0thumbnail'))));
 const kept=after.parts.filter(p=>p.marker===0xe0||p.marker===0xee);assert.deepEqual(kept.map(p=>p.end-p.start),[18,16]);assert.equal(output[kept[0].start+16],0);assert.equal(output[kept[0].start+17],0);assert.equal(new TextDecoder().decode(output).includes('private'),false);
});
test('ICC chunks stay byte-exact; missing, repeated or inconsistent chunks block cleaning',()=>{
 const profile=(seq,count,data)=>segment(0xe2,concat(text('ICC_PROFILE\0'),[seq,count],data));const first=profile(1,2,[1,2,3]),second=profile(2,2,[4,5,6]);const {output,after}=cleanJPEG(jpeg(second,first));const chunks=after.parts.filter(p=>p.marker===0xe2).map(p=>output.slice(p.start,p.end));assert.deepEqual(chunks,[second,first]);
 for(const parts of [[first],[first,first],[first,profile(2,3,[2])]])assert.throws(()=>cleanJPEG(jpeg(...parts)),/ICC/);
});
test('progressive multi-scan files remove metadata between scans; entropy stuffing and restart bytes survive',()=>{
 const progressiveFrame=frame.slice();progressiveFrame[1]=0xc2;const input=concat([255,0xd8],progressiveFrame,sos,scan,segment(0xfe,text('between scans')),sos,scan,[255,0xd9]);const {output,after}=cleanJPEG(input);assert.equal(after.scans,2);assert.deepEqual(imageParts(input),imageParts(output));assert.equal(after.blocks.length,0);
});
test('multi-picture, HDR, SPIFF, ambiguous XMP direction and conflicting EXIF refuse export',()=>{
 for(const payload of ['MPF\0data','SPIFF\0data','urn:iso:std:iso:ts:21496:-1','http://ns.adobe.com/xap/1.0/\0<r hdrgm:Version="1"/>'])assert.throws(()=>cleanJPEG(jpeg(segment(0xe2,text(payload)))),/扩展/);
 assert.throws(()=>cleanJPEG(jpeg(orientation(3),orientation(6))),/冲突/);
 const xmp=n=>segment(0xe1,text(`http://ns.adobe.com/xap/1.0/\0<rdf tiff:Orientation="${n}"/>`));assert.throws(()=>cleanJPEG(jpeg(xmp(6))),/XMP/);assert.throws(()=>cleanJPEG(jpeg(orientation(3),xmp(6))),/XMP/);assert.equal(cleanJPEG(jpeg(orientation(6),xmp(6))).after.orientation,6);
});
test('malformed EXIF offsets, types, counts, cycles and orientation values never produce output',()=>{
 const invalid=[];for(const n of [0,9])invalid.push(orientation(n));let bad=orientation(1);bad[14]=255;invalid.push(bad);bad=orientation(1);bad[22]=255;invalid.push(bad);bad=orientation(1);bad[18]=99;invalid.push(bad);bad=orientation(1);bad[32]=8;invalid.push(bad);
 for(const data of invalid){assert.ok(inspectJPEG(jpeg(data)).blocked);assert.throws(()=>cleanJPEG(jpeg(data)),/EXIF/);}
});
test('dimension and file limits are checked from bytes; broken JPEGs fail closed',()=>{
 const wide=frame.slice();wide[7]=0xff;wide[8]=0xff;for(const source of [new Uint8Array(),text('not JPEG'),Uint8Array.from([255,0xd8,255,0xe1,0,1]),jpeg().slice(0,-1),concat([255,0xd8],wide,sos,scan,[255,0xd9])])assert.throws(()=>inspectJPEG(source));
 assert.throws(()=>inspectJPEG(new Uint8Array(METADATA_LIMITS.fileBytes+1)),/20 MB/);assert.throws(()=>jpegSegment(0xe1,new Uint8Array(65534)),/过长/);
});
test('bounded parser handles arbitrary malformed inputs without hangs or retaining bad metadata',()=>{
 let seed=12345;for(let i=0;i<500;i++){const input=jpeg(demoExif());for(let j=0;j<3;j++){seed=(seed*1664525+1013904223)>>>0;input[seed%input.length]^=seed&255;}try{const info=inspectJPEG(input);if(!info.blocked){const {after}=cleanJPEG(input);assert.equal(after.rows.length,0);assert.equal(after.gps,false);}}catch(error){assert.ok(error instanceof Error);}}
});
test('safe filenames and duplicate ZIP entries preserve Unicode without paths',()=>{
 assert.equal(metadataFilename('../秘密\u202e/照片.jpeg'),'-秘密--照片-clean.jpg');const data=cleanJPEG(jpeg(demoExif())).output;const zip=createZIP([{name:'photo-clean.jpg',data},{name:'photo-clean.jpg',data}]);const names=new TextDecoder().decode(zip);assert.ok(names.includes('photo-clean-2.jpg'));
});
test('worker ownership supports immediate abort, timeout and late response cleanup',async()=>{
 const fake=()=>({postMessage(){},terminate(){this.terminated=true;}});let worker=fake();const abort=new AbortController();const task=metadataTask({},'inspect',{signal:abort.signal,workerFactory:()=>worker});abort.abort();await assert.rejects(task,{name:'AbortError'});assert.equal(worker.terminated,true);worker.onmessage({data:{result:{}}});
 worker=fake();await assert.rejects(metadataTask({},'clean',{workerFactory:()=>worker,timeout:5}),/超时/);assert.equal(worker.terminated,true);
 const early=new AbortController();early.abort();await assert.rejects(metadataTask({},'inspect',{signal:early.signal,workerFactory:()=>{throw new Error('must not start');}}),{name:'AbortError'});
 worker=fake();worker.postMessage=()=>queueMicrotask(()=>worker.onmessage({data:{error:'JPEG invalid'}}));await assert.rejects(metadataTask({},'inspect',{workerFactory:()=>worker}),/JPEG invalid/);assert.equal(worker.terminated,true);
});

test('real asymmetric JPEG fixtures retain every scan and all ICC bytes',async()=>{
 for(const name of ['baseline','progressive']){const original=await readFile(new URL(`./fixtures/metadata-${name}.jpg`,import.meta.url)),{output,before,after}=cleanJPEG(original);assert.equal(before.width,240);assert.equal(before.height,160);assert.equal(before.orientation,6);assert.equal(after.orientation,6);assert.equal(after.icc,true);assert.deepEqual(imageParts(output),imageParts(original));assert.ok(name==='baseline'?before.scans===1:before.scans>1);const icc=(bytes,info)=>info.parts.filter(p=>p.marker===0xe2).map(p=>Array.from(bytes.subarray(p.start,p.end)));assert.deepEqual(icc(original,before),icc(output,after));}
});
test('non-sRGB without ICC and additional Gamma parameters refuse color-changing exports',()=>{
 const exif=(space,gamma=false)=>{const t=new Uint8Array(gamma?62:50),v=new DataView(t.buffer);t.set([69,120,105,102,0,0,73,73,42,0,8,0,0,0]);v.setUint16(14,1,true);v.setUint16(16,0x8769,true);v.setUint16(18,4,true);v.setUint32(20,1,true);v.setUint32(24,26,true);v.setUint16(32,gamma?2:1,true);v.setUint16(34,0xa001,true);v.setUint16(36,3,true);v.setUint32(38,1,true);v.setUint16(42,space,true);if(gamma){v.setUint16(46,0xa500,true);v.setUint16(48,3,true);v.setUint32(50,1,true);v.setUint16(54,2,true);}return segment(0xe1,t);};
 assert.throws(()=>cleanJPEG(jpeg(exif(65535))),/非 sRGB/);assert.equal(cleanJPEG(jpeg(exif(1))).after.colorSpace,1);assert.throws(()=>cleanJPEG(jpeg(exif(1,true))),/EXIF/);
});
test('ambiguous EXIF placement never promotes ignored direction or color information',async()=>{
 const bytes=await readFile(new URL('./fixtures/metadata-baseline.jpg',import.meta.url)),info=inspectJPEG(bytes),exif=info.parts.find(p=>p.marker===0xe1),exifBytes=bytes.subarray(exif.start,exif.end),without=concat(bytes.subarray(0,exif.start),bytes.subarray(exif.end)),eoi=without.length-2;
 assert.throws(()=>cleanJPEG(concat(without.subarray(0,eoi),exifBytes,without.subarray(eoi))),/扫描后/);
 const empty=segment(0xe1,[69,120,105,102,0,0,73,73,42,0,8,0,0,0,0,0,0,0,0,0]);assert.throws(()=>cleanJPEG(concat(bytes.subarray(0,2),empty,bytes.subarray(2))),/多个 EXIF/);
 const lateICC=segment(0xe2,concat(text('ICC_PROFILE\0'),[1,1,9]));assert.throws(()=>cleanJPEG(concat(jpeg().subarray(0,-2),lateICC,[255,0xd9])),/扫描之后/);
});
