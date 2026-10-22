export function transformURL(value, operation = 'encode', mode = 'component') {
  if (!value) throw new Error('请输入需要处理的内容。');
  try {
    if (operation === 'encode') {
      if (mode === 'uri') return encodeURI(value);
      const result = encodeURIComponent(value);
      return mode === 'form' ? result.replace(/[!'()~]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+') : result;
    }
    if (mode === 'uri') return decodeURI(value);
    return decodeURIComponent(mode === 'form' ? value.replace(/\+/g, ' ') : value);
  } catch {
    throw new Error(operation === 'decode' ? '解码失败：请检查 % 后的十六进制字符及 UTF-8 编码是否完整。' : '编码失败：输入包含无效的 Unicode 字符。');
  }
}
