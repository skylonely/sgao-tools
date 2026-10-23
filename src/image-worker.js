import { compressImage } from './image-engine.js';
self.onmessage = async ({ data }) => {
  try {
    const result = await compressImage(data.file, data.options, { onProgress: message => self.postMessage({ id: data.id, progress: message }) });
    self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
