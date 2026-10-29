import {cleanText} from './lib/text-cleanup.js';
self.onmessage=({data})=>{try{const result=cleanText(data.text,data.options,(progress,label)=>self.postMessage({progress,label}));self.postMessage({result});}catch(error){self.postMessage({error:error.message||'文本处理失败。'});}};
