export function metadataTask(file, action, {signal, workerFactory = url => new Worker(url,{type:'module'}), timeout = 30_000} = {}) {
  return new Promise((resolve,reject) => {
    let worker,timer,done=false;
    const finish = (error,result) => { if (done) return; done=true; clearTimeout(timer); signal?.removeEventListener('abort',stop); worker?.terminate(); error ? reject(error) : resolve(result); };
    const stop = () => finish(new DOMException('处理已停止','AbortError'));
    if (signal?.aborted) { stop(); return; }
    try { worker=workerFactory(new URL('./metadata-worker.js',import.meta.url)); signal?.addEventListener('abort',stop,{once:true}); worker.onmessage=({data})=>data.error ? finish(new Error(data.error)) : finish(null,data.result); worker.onerror=e=>{e.preventDefault?.();finish(new Error('处理线程无法启动，请刷新或使用新版浏览器。'));}; worker.onmessageerror=()=>finish(new Error('结果读取失败。')); timer=setTimeout(()=>finish(new Error('处理超时，请换一张图片后重试。')),timeout); worker.postMessage({file,action}); }
    catch (error) { finish(error); }
  });
}
