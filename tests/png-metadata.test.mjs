import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { inspectPNG, cleanPNG, previewPNG, pngChunk, PNG_SIGNATURE } from '../src/lib/png-metadata.js';
import { inspectMetadata, cleanMetadata, metadataFilename } from '../src/lib/image-metadata.js';
import { minimalExifTIFF } from '../src/lib/jpeg-metadata.js';
import { validatePNGProfile } from '../src/png-profile.js';

const fixtures=await Promise.all(['transparent','indexed','interlaced','gray16'].map(async name=>Uint8Array.from(await readFile(new URL(`./fixtures/metadata-${name}.png`,import.meta.url)))));
const join=parts=>Uint8Array.from(parts.flatMap(p=>Array.from(p)));
const chunks=bytes=>inspectPNG(bytes).parts.map(p=>({type:p.type,data:bytes.subarray(p.start+8,p.end-4),bytes:bytes.subarray(p.start,p.end)}));
const compose=parts=>join([PNG_SIGNATURE,...parts.map(p=>p.bytes||pngChunk(p.type,p.data))]);
const text=value=>new TextEncoder().encode(value);
const insert=(bytes,added)=>{const c=chunks(bytes),i=c.findIndex(p=>p.type==='IDAT');c.splice(i,0,...added);return compose(c);};

test('real transparent, indexed, 16-bit and Adam7 PNGs keep every encoded/display byte',async()=>{
 for(const original of fixtures){const before=inspectPNG(original);await validatePNGProfile(original,before);const {output,after}=cleanPNG(original);assert.equal(after.format,'PNG');assert.equal(after.alpha,before.alpha);assert.equal(after.bitDepth,before.bitDepth);assert.equal(after.interlace,before.interlace);assert.equal(after.orientation,before.orientation);assert.equal(after.rows.length,0);assert.equal(after.gps,false);assert.equal(new TextDecoder().decode(output).includes('PRIVATE PNG TEST AUTHOR'),false);assert.deepEqual(chunks(original).filter(p=>p.type!=='eXIf'&&p.type!=='tEXt').map(p=>Array.from(p.bytes)),chunks(output).filter(p=>p.type!=='eXIf').map(p=>Array.from(p.bytes)));}
 assert.equal(inspectPNG(fixtures[1]).colorType,3);assert.equal(inspectPNG(fixtures[1]).alpha,true);assert.equal(inspectPNG(fixtures[2]).interlace,1);assert.equal(inspectPNG(fixtures[3]).bitDepth,16);
});
test('plain/Unicode/compressed text, time, unknown ancillary chunks and trailing bytes are removed',()=>{
 const original=join([insert(fixtures[1],[{type:'iTXt',data:text('Description\0\0\0\0\0私有中文说明 😀')},{type:'zTXt',data:join([text('GPS notes\0'),[0],deflateSync(text('private coordinates'))])},{type:'iTXt',data:join([text('Compressed\0'),[1,0,0,0],deflateSync(text('private text'))])},{type:'tIME',data:Uint8Array.from([7,234,10,29,10,30,0])},{type:'vpAg',data:text('private extra')}]),text('private trailer')]);
 const {output,before,after}=cleanPNG(original);assert.ok(before.rows.some(r=>r.value.includes('私有中文')));assert.ok(before.rows.some(r=>r.compressed));assert.equal(after.rows.length,0);assert.equal(after.end,output.length);assert.ok(!chunks(output).some(p=>['tEXt','iTXt','zTXt','tIME','vpAg'].includes(p.type)));
});
test('eXIf uses bare TIFF, keeps directions 1..8, and rejects duplicate/late/invalid EXIF',()=>{
 const base=compose(chunks(fixtures[1]).filter(p=>p.type!=='tEXt'));
 for(let value=1;value<=8;value++){const original=insert(base,[{type:'eXIf',data:minimalExifTIFF(value)}]);assert.equal(cleanPNG(original).after.orientation,value);}
 const exif={type:'eXIf',data:minimalExifTIFF(6)},duplicate=insert(base,[exif,exif]);assert.throws(()=>cleanPNG(duplicate),/重复/);const c=chunks(base);c.splice(c.length-1,0,exif);assert.throws(()=>cleanPNG(compose(c)),/之后/);
 assert.throws(()=>cleanPNG(insert(base,[{type:'eXIf',data:join([text('Exif\0\0'),minimalExifTIFF(6)])}])),/EXIF/);
});
test('PNG color/alpha chunks stay in original order and retain their full bytes',()=>{
 const base=compose(chunks(fixtures[1]).filter(p=>['IHDR','PLTE','tRNS','IDAT','IEND'].includes(p.type))),c=chunks(base);
 c.splice(1,0,{type:'gAMA',data:Uint8Array.from([0,0,177,143])},{type:'sRGB',data:Uint8Array.from([0])},{type:'cICP',data:Uint8Array.from([1,13,0,1])},{type:'mDCV',data:new Uint8Array(24)},{type:'cLLI',data:new Uint8Array(8)});
 const original=compose(c),clean=cleanPNG(original);assert.deepEqual(Array.from(clean.output),Array.from(original));
});
test('CRC errors, malformed headers, unknown critical chunks and invalid ordering fail closed',()=>{
 const crc=fixtures[1].slice();crc[crc.length-1]^=1;assert.throws(()=>inspectPNG(crc),/校验/);
 for(const bytes of [fixtures[1].subarray(0,-5),Uint8Array.from([137,80,78]),insert(fixtures[1],[{type:'ABCD',data:new Uint8Array()}])])assert.throws(()=>inspectPNG(bytes));
 let c=chunks(fixtures[1]);c.unshift(c[0]);assert.throws(()=>inspectPNG(compose(c)),/重复/);
 c=chunks(fixtures[1]).filter(p=>p.type!=='PLTE');assert.throws(()=>inspectPNG(compose(c)),/调色板|透明度/);
 c=chunks(fixtures[1]);const i=c.findIndex(p=>p.type==='IDAT'),payload=c[i].data;c.splice(i,1,{type:'IDAT',data:payload.subarray(0,3)},{type:'tEXt',data:text('Author\0private')},{type:'IDAT',data:payload.subarray(3)});assert.throws(()=>inspectPNG(compose(c)),/不连续/);
 c=chunks(fixtures[0]);c[0]={type:'IHDR',data:c[0].data.slice()};c[0].data[0]=1;assert.throws(()=>inspectPNG(compose(c)),/尺寸/);
 assert.throws(()=>inspectPNG(insert(fixtures[0],[{type:'tRNS',data:new Uint8Array(6)}])),/透明度/);
});
test('APNG chunks block export rather than silently dropping animation frames',()=>{
 for(const type of ['acTL','fcTL','fdAT']){const original=insert(fixtures[1],[{type,data:new Uint8Array(8)}]);assert.ok(inspectPNG(original).blocked.includes('APNG'));assert.throws(()=>cleanPNG(original),/APNG/);}
});
test('preview removes compressed metadata before native decoding but keeps original eXIf and pixels',()=>{
 const original=insert(fixtures[0],[{type:'zTXt',data:join([text('Large\0'),[0],deflateSync(new Uint8Array(2*1024**2))])}]),preview=previewPNG(original),info=inspectPNG(preview);
 assert.equal(info.rows.length,0);assert.ok(!chunks(preview).some(p=>p.type==='zTXt'));assert.deepEqual(chunks(original).filter(p=>p.type==='eXIf'||p.type==='IDAT').map(p=>Array.from(p.bytes)),chunks(preview).filter(p=>p.type==='eXIf'||p.type==='IDAT').map(p=>Array.from(p.bytes)));
});
test('ICC inflation enforces declared length, RGB/gray type, signature and bounded size',async()=>{
 const make=profile=>{const c=chunks(fixtures[1]);c.splice(1,0,{type:'iCCP',data:join([text('Color profile\0'),[0],deflateSync(profile)])});return compose(c);};
 const profile=new Uint8Array(132),v=new DataView(profile.buffer);v.setUint32(0,132);profile.set(text('RGB '),16);profile.set(text('acsp'),36);let bytes=make(profile);await validatePNGProfile(bytes,inspectPNG(bytes));
 for(const tweak of [p=>p[0]=1,p=>p[36]=0,p=>p.set(text('GRAY'),16),p=>p[131]=255]){const bad=profile.slice();tweak(bad);bytes=make(bad);await assert.rejects(validatePNGProfile(bytes,inspectPNG(bytes)),/PNG ICC/);}
 bytes=make(new Uint8Array(5*1024**2));await assert.rejects(validatePNGProfile(bytes,inspectPNG(bytes)),/PNG ICC/);
 bytes=make(profile);const c=chunks(bytes);c[1]={type:'iCCP',data:join([text('Color profile\0'),[0,1,2,3]])};bytes=compose(c);await assert.rejects(validatePNGProfile(bytes,inspectPNG(bytes)),/PNG ICC/);
});
test('format is derived from actual bytes and PNG filenames never turn into JPEG',async()=>{
 assert.equal(inspectMetadata(fixtures[0]).mime,'image/png');assert.equal(cleanMetadata(fixtures[1]).after.mime,'image/png');assert.equal(metadataFilename('私密照片.jpeg','image/png'),'私密照片-clean.png');
 const jpg=await readFile(new URL('./fixtures/metadata-baseline.jpg',import.meta.url));assert.equal(cleanMetadata(jpg).after.mime,'image/jpeg');assert.equal(metadataFilename('image.png','image/jpeg'),'image-clean.jpg');assert.throws(()=>inspectMetadata(text('not an image')),/文件内容/);
});
