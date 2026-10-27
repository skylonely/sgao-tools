import { PDFDocument, rgb } from './vendor/pdf-lib.esm.min.js';
import { PDF_LIMITS, validateImagePDF } from './lib/image-pdf.js';

export async function createPDFAssembler(rawOptions) {
  const options = validateImagePDF(rawOptions), doc = await PDFDocument.create();
  doc.setTitle(options.name); doc.setCreator('SGAO 工具箱'); doc.setProducer('SGAO / pdf-lib');
  let imageBytes = 0, count = 0;
  return {
    async add(bytes, mime, layout) {
      if (++count > PDF_LIMITS.files) throw new Error('PDF 最多包含 20 页。');
      imageBytes += bytes.byteLength;
      if (imageBytes > PDF_LIMITS.outputBytes) throw new Error('内嵌图片合计超过 100 MB，请选择 JPEG 压缩或降低最长边。');
      const image = mime === 'image/png' ? await doc.embedPng(bytes) : mime === 'image/jpeg' ? await doc.embedJpg(bytes) : null;
      if (!image) throw new Error('PDF 内嵌图片编码无效。');
      const page = doc.addPage([layout.width, layout.height]), color = options.background.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
      page.drawRectangle({ x: 0, y: 0, width: layout.width, height: layout.height, color: rgb(...color) });
      page.drawImage(image, layout.target); await image.embed();
    },
    async finish() {
      if (!count) throw new Error('请先添加图片。');
      const bytes = await doc.save({ objectsPerTick: 20 });
      if (bytes.byteLength > PDF_LIMITS.outputBytes) throw new Error('PDF 超过 100 MB，请选择 JPEG 压缩或降低最长边。');
      return new Blob([bytes], { type: 'application/pdf' });
    },
  };
}
