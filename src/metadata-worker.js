import { inspectJPEG, cleanJPEG, METADATA_LIMITS } from './lib/jpeg-metadata.js';
const summary = ({parts,end,...value}) => value;
self.onmessage = async ({data}) => {
  try {
    if (!['inspect','clean'].includes(data?.action) || !data.file?.size || data.file.size > METADATA_LIMITS.fileBytes) throw new Error('请选择非空 JPG/JPEG，单张最高 20 MB。');
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    if (data.action === 'inspect') {
      const info=inspectJPEG(bytes); let bitmap;
      try { bitmap=await createImageBitmap(data.file); if(!bitmap.width||!bitmap.height)throw new Error(); }
      catch { throw new Error('浏览器无法解码这张 JPEG，请检查文件或使用新版浏览器。'); }
      finally { bitmap?.close(); }
      self.postMessage({result:summary(info)});
    }
    else { const {output,before,after} = cleanJPEG(bytes); self.postMessage({result:{before:summary(before),after:summary(after),output}},[output.buffer]); }
  } catch (error) { self.postMessage({error:error.message || '图片读取失败。'}); }
};
