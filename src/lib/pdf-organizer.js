import { checkPDFInput, selectedPDFPages, pdfImageStem } from './pdf-images.js';

export const ORGANIZER_LIMITS = Object.freeze({ files: 10, fileBytes: 50 * 1024 ** 2, totalBytes: 100 * 1024 ** 2, pages: 200, resultBytes: 150 * 1024 ** 2 });
export function checkOrganizerFiles(files) {
  if (!files.length || files.length > ORGANIZER_LIMITS.files) throw new Error('最多添加 10 份 PDF。');
  for (const file of files) checkPDFInput(file);
  if (files.reduce((sum, file) => sum + file.size, 0) > ORGANIZER_LIMITS.totalBytes) throw new Error('源文件合计最高 100 MB，请减少文件后重试。');
}
export function organizerPlan(pages, options) {
  if (!Array.isArray(pages) || !pages.length || pages.length > ORGANIZER_LIMITS.pages) throw new Error('请保留 1–200 页后再导出。');
  if (new Set(pages.map(page => page.id)).size !== pages.length || pages.some(page => typeof page.source !== 'string' || !Number.isInteger(page.page) || page.page < 1 || ![0, 90, 180, 270].includes(page.rotation))) throw new Error('页面数据不完整，请重新添加文档。');
  const stem = pdfImageStem(options.name), count = pages.length;
  let groups;
  if (options.mode === 'merge') groups = [Array.from({ length: count }, (_, i) => i + 1)];
  else if (options.mode === 'single') groups = pages.map((_, i) => [i + 1]);
  else if (options.mode === 'ranges') {
    if (typeof options.ranges !== 'string' || !options.ranges.trim() || options.ranges.length > 2000) throw new Error('请填写拆分范围，每行一份 PDF，例如第一行 1-3，第二行 4,6。');
    const lines = options.ranges.trim().replace(/\r\n?/g, '\n').replace(/[;；]/g, '\n').split('\n');
    if (lines.length > 200 || lines.some(line => !line.trim())) throw new Error('每行需填写一组有效页码，最多 200 组，请移除空行。');
    groups = lines.map(line => selectedPDFPages(line, count));
  } else throw new Error('请选择有效的导出方式。');
  if (groups.reduce((sum, group) => sum + group.length, 0) > ORGANIZER_LIMITS.pages) throw new Error('本批导出页数合计最高 200 页；多组范围中的重复页面也会计入。');
  return groups.map((indices, i) => ({
    name: `${stem}-${options.mode === 'merge' ? 'merged' : options.mode === 'single' ? `page-${String(i + 1).padStart(3, '0')}` : `part-${String(i + 1).padStart(3, '0')}`}.pdf`,
    indices, pages: indices.map(index => ({ ...pages[index - 1] })),
  }));
}
export function moveOrganizerPage(pages, from, to) {
  if (![from, to].every(value => Number.isInteger(value) && value >= 0 && value < pages.length)) return pages;
  const result = [...pages], [page] = result.splice(from, 1); result.splice(to, 0, page); return result;
}
