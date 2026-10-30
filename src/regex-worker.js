import { matchRegex, exportRegexMatches, regexSelections } from './lib/regex.js';
self.onmessage = ({ data }) => {
  try {
    if (data.action === 'match') {
      const result = matchRegex(data.request);
      const selection = regexSelections(result).some(item => item.value === data.options.selection) ? data.options.selection : 'match';
      self.postMessage({ result: { match: result, output: exportRegexMatches(result, { ...data.options, selection }) } });
    } else if (data.action === 'export') self.postMessage({ result: { output: exportRegexMatches(data.match, data.options) } });
    else throw new Error('正则处理操作无效。');
  } catch (error) { self.postMessage({ error: error.message || '正则处理失败。' }); }
};
