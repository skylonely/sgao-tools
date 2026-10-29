import { jpegSegment } from './lib/jpeg-metadata.js';

// Deliberately fictional metadata, including 0°, 0° GPS; no device or location APIs.
export function demoExif() {
  const main = [[0x010f,2,'SGAO Demo'],[0x0110,2,'Local Test Camera'],[0x0112,3,6],[0x013b,2,'Fictional sample'],[0x8769,4,0],[0x8825,4,0]], exif = [[0x9003,2,'2026:10:29 10:30:00'],[0xa431,2,'DEMO-NO-REAL-SERIAL']], gps = [[1,2,'N'],[2,5,[0,0,0]],[3,2,'E'],[4,5,[0,0,0]]];
  const groups = [main,exif,gps], offsets = [8,8+2+main.length*12+4,8+2+main.length*12+4+2+exif.length*12+4];
  let next = offsets[2]+2+gps.length*12+4; main[4][2]=offsets[1]; main[5][2]=offsets[2];
  const bytes = new Uint8Array(2048), view = new DataView(bytes.buffer); bytes.set([73,73,42,0,8,0,0,0]);
  groups.forEach((entries,g) => { const start = offsets[g]; view.setUint16(start,entries.length,true); entries.forEach(([tag,type,value],i)=>{ const p=start+2+i*12, data=typeof value==='string'?new TextEncoder().encode(`${value}\0`):null, count=data?data.length:Array.isArray(value)?value.length:1; view.setUint16(p,tag,true);view.setUint16(p+2,type,true);view.setUint32(p+4,count,true); if(data){const o=count<=4?p+8:next;if(count>4){view.setUint32(p+8,next,true);next+=count;}bytes.set(data,o);} else if(Array.isArray(value)){view.setUint32(p+8,next,true);for(const n of value){view.setUint32(next,n,true);view.setUint32(next+4,1,true);next+=8;}} else if(type===3)view.setUint16(p+8,value,true);else view.setUint32(p+8,value,true); }); });
  const payload = new Uint8Array(6+next); payload.set([69,120,105,102,0,0]);payload.set(bytes.subarray(0,next),6); return jpegSegment(0xe1,payload);
}
export async function sampleMetadataFile() {
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
  try {
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('无法创建示例。');
    // The encoded pixels are rotated; EXIF 6 restores the upright portrait.
    ctx.translate(0,800);ctx.rotate(-Math.PI/2);ctx.fillStyle='#f5f3ee';ctx.fillRect(0,0,800,1200);
    ['#ec6245','#294f4a','#e6b65c','#293650'].forEach((c,i)=>{ctx.fillStyle=c;ctx.fillRect(60+(i%2)*350,70+Math.floor(i/2)*270,330,250);});
    ctx.fillStyle='#25262c';ctx.font='bold 46px "PingFang SC","Microsoft YaHei",sans-serif';ctx.fillText('查看信息，再放心分享。',60,750);
    ctx.font='28px "PingFang SC","Microsoft YaHei",sans-serif';ctx.fillText('虚构 EXIF · 测试方向、设备',60,835);ctx.fillText('以及 GPS 信息清理',60,885);
    ctx.font='20px sans-serif';ctx.fillText('SGAO TOOLS / LOCAL METADATA DEMO',60,1080);
    const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.88));if(!blob)throw new Error('示例生成失败。');const bytes=new Uint8Array(await blob.arrayBuffer());return new File([bytes.subarray(0,2),demoExif(),bytes.subarray(2)],'sgao-fictional-exif-demo.jpg',{type:'image/jpeg'});
  }finally{canvas.width=canvas.height=1;}
}
