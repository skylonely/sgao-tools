import { inspectMetadata, cleanMetadata, METADATA_LIMITS } from './lib/image-metadata.js';
import { previewPNG } from './lib/png-metadata.js';
import { validatePNGProfile } from './png-profile.js';
const summary = ({parts,end,...value}) => value;
self.onmessage = async ({data}) => {
  try {
    if (!['inspect','clean'].includes(data?.action) || !data.file?.size || data.file.size > METADATA_LIMITS.fileBytes) throw new Error('请选择非空 PNG / JPG / JPEG，单张最高 20 MB。');
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    if (data.action === 'inspect') {
      const info=inspectMetadata(bytes); let bitmap,preview,prepared,preparedInfo;
      if(info.mime==='image/png'){
        if(info.blocked){self.postMessage({result:summary(info)});return;}
        await validatePNGProfile(bytes,info);
        preview=new Blob([previewPNG(bytes,info)],{type:info.mime});const cleaned=cleanMetadata(bytes);prepared=new Blob([cleaned.output],{type:info.mime});preparedInfo=summary(cleaned.after);
      }
      try { bitmap=await createImageBitmap(preview||data.file); if(!bitmap.width||!bitmap.height)throw new Error(); }
      catch { throw new Error('浏览器无法解码这张图片，请检查文件或使用新版浏览器。'); }
      finally { bitmap?.close(); }
      self.postMessage({result:{...summary(info),preview,prepared,preparedInfo}});
    }
    else { const {output,before,after} = cleanMetadata(bytes); if(before.mime==='image/png')await validatePNGProfile(bytes,before);self.postMessage({result:{before:summary(before),after:summary(after),output}},[output.buffer]); }
  } catch (error) { self.postMessage({error:error.message || '图片读取失败。'}); }
};
