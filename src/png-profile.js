// Bound ICC inflation before passing the retained profile to the native PNG decoder.
export async function validatePNGProfile(bytes,info) {
  const part=info.parts.find(p=>p.type==='iCCP');if(!part)return;
  const data=bytes.subarray(part.start+8,part.end-4),compressed=data.subarray(data.indexOf(0)+2),header=new Uint8Array(132);let offset=0,total=0,declared=0;
  const stream=new ReadableStream({pull(controller){if(offset>=compressed.length){controller.close();return;}const next=Math.min(offset+16384,compressed.length);controller.enqueue(compressed.subarray(offset,next));offset=next;}}).pipeThrough(new DecompressionStream('deflate'));
  const reader=stream.getReader();
  try{
    while(true){const {done,value}=await reader.read();if(done)break;const previous=total;total+=value.length;if(total>4*1024**2)throw new Error('PNG ICC 配置解压后超过 4 MB，无法安全处理。');if(previous<132)header.set(value.subarray(0,132-previous),previous);
      if(total>=132&&!declared){const view=new DataView(header.buffer);declared=view.getUint32(0);const signature=String.fromCharCode(...header.subarray(36,40)),space=String.fromCharCode(...header.subarray(16,20));if(declared<132||declared>4*1024**2||signature!=='acsp'||view.getUint32(128)>(declared-132)/12||space!==([0,4].includes(info.colorType)?'GRAY':'RGB '))throw new Error('PNG ICC 配置头无效或超出处理上限。');}
      if(declared&&total>declared)throw new Error('PNG ICC 配置长度不一致。');
    }
    if(total<132||total!==declared)throw new Error('PNG ICC 配置不完整。');
  }catch(error){if(error.message.startsWith('PNG ICC'))throw error;throw new Error('PNG ICC 配置无法解压，请检查原文件。');}
  finally{try{await reader.cancel();}catch{/* Already closed / errored. */}}
}
