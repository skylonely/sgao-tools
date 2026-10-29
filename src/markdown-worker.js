import {renderMarkdown} from './lib/markdown-render.js';
self.onmessage=({data})=>{try{self.postMessage({result:renderMarkdown(data.text,data.options)});}catch(error){self.postMessage({error:error.message||'Markdown 解析失败。'});}};
