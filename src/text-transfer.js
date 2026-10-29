import {validateText} from './lib/text-cleanup.js';
const PREFIX='sgao-text-transfer',validToken=token=>typeof token==='string'&&/^[a-f0-9-]{36}$/.test(token);
function validatePayload(payload,target){
  if(!payload||typeof payload!=='object'||payload.target!==target)throw new Error('收到的文本类型无效。');
  if(target==='cleanup'){validateText(payload.text);if(typeof payload.name!=='string'||payload.name.length>256)throw new Error('文本名称无效。');}
  else if(target==='diff'){validateText(payload.before);validateText(payload.after);if(!payload.before.length&&!payload.after.length)throw new Error('没有可对比的文本。');const lines=text=>text?text.replace(/\r\n?/g,'\n').split('\n').length:0;if(lines(payload.before)+lines(payload.after)>20_000)throw new Error('文本对比两侧合计最高 20,000 行，请缩小范围后继续。');}
  else throw new Error('文本目标无效。');return payload;
}
function send(payload,path,{signal}={}){
  return new Promise((resolve,reject)=>{try{validatePayload(payload,payload.target);}catch(error){reject(error);return;}
    const token=crypto.randomUUID();let popup,timer,done=false;const cleanup=()=>{done=true;payload=null;clearTimeout(timer);window.removeEventListener('message',receive);window.removeEventListener('pagehide',abandon);signal?.removeEventListener('abort',stop);};const abandon=()=>{cleanup();reject(new Error('文本传递已结束。'));};const stop=()=>{cleanup();reject(new DOMException('文本传递已停止','AbortError'));};
    if(signal?.aborted){stop();return;}signal?.addEventListener('abort',stop,{once:true});
    function receive(event){if(done||event.origin!==location.origin||event.source!==popup||event.data?.token!==token)return;if(event.data.type===`${PREFIX}:ready`)popup.postMessage({type:`${PREFIX}:payload`,token,payload},location.origin);if(event.data.type===`${PREFIX}:received`){cleanup();resolve();}if(event.data.type===`${PREFIX}:error`){cleanup();reject(new Error('目标工具未接收文本，请手动复制或重新打开。'));}}
    window.addEventListener('message',receive);window.addEventListener('pagehide',abandon,{once:true});try{popup=window.open(`${path}#text-transfer=${token}`,'_blank');}catch{cleanup();reject(new Error('无法打开新标签页，请手动复制文本。'));return;}if(!popup){cleanup();reject(new Error('浏览器阻止了新标签页，请允许打开后重试，或手动复制文本。'));return;}timer=setTimeout(()=>{cleanup();reject(new Error('文本传递超时，请重试或手动复制。'));},20_000);
  });
}
export const sendTextToCleanup=(text,name='ocr-result.txt',options)=>send({target:'cleanup',text,name},'/text-cleaner/',options);
export const sendTextToDiff=(before,after,options)=>send({target:'diff',before,after},'/text-diff/',options);
export function receiveTextTransfer(target,onPayload,onError){
  if(!location.hash.startsWith('#text-transfer='))return;
  const token=location.hash.slice('#text-transfer='.length),sender=window.opener;history.replaceState(null,'',`${location.pathname}${location.search}`);
  if(!validToken(token)||!sender){onError('未收到文本，请从来源工具重新发送，或手动粘贴。');window.opener=null;return;}
  let interval,timer;const cleanup=()=>{clearInterval(interval);clearTimeout(timer);window.removeEventListener('message',receive);window.removeEventListener('pagehide',cleanup);};
  function receive(event){if(event.origin!==location.origin||event.source!==sender||event.data?.type!==`${PREFIX}:payload`||event.data.token!==token)return;cleanup();try{onPayload(validatePayload(event.data.payload,target));sender.postMessage({type:`${PREFIX}:received`,token},location.origin);}catch(error){onError(error.message);sender.postMessage({type:`${PREFIX}:error`,token},location.origin);}window.opener=null;}
  window.addEventListener('message',receive);window.addEventListener('pagehide',cleanup,{once:true});const ready=()=>sender.postMessage({type:`${PREFIX}:ready`,token},location.origin);interval=setInterval(ready,500);timer=setTimeout(()=>{cleanup();onError('未收到文本，请重试或手动粘贴。');window.opener=null;},20_000);ready();
}
