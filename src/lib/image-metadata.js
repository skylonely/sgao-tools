import { inspectJPEG, cleanJPEG, METADATA_LIMITS } from './jpeg-metadata.js';
import { inspectPNG, cleanPNG, PNG_SIGNATURE } from './png-metadata.js';
export { METADATA_LIMITS, ORIENTATIONS, metadataFilename } from './jpeg-metadata.js';
function kind(bytes){if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>METADATA_LIMITS.fileBytes)throw new Error('请选择非空 PNG / JPG / JPEG，单张最高 20 MB。');if(PNG_SIGNATURE.every((b,i)=>bytes[i]===b))return 'png';if(bytes[0]===255&&bytes[1]===0xd8)return 'jpeg';throw new Error('文件内容不是支持的 PNG 或 JPG/JPEG。');}
const jpegInfo=info=>({...info,mime:'image/jpeg',format:'JPEG',alpha:false});
export function inspectMetadata(bytes){return kind(bytes)==='png'?inspectPNG(bytes):jpegInfo(inspectJPEG(bytes));}
export function cleanMetadata(bytes){if(kind(bytes)==='png')return cleanPNG(bytes);const {output,before,after}=cleanJPEG(bytes);return {output,before:jpegInfo(before),after:jpegInfo(after)};}
