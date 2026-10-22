import { diffLines } from './lib/diff.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, result: diffLines(data.before, data.after, data.options) }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
