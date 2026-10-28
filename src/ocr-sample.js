export async function sampleOCRFile() {
  const canvas = document.createElement('canvas'); canvas.width = 1500; canvas.height = 820;
  try {
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#20242b';
    ctx.font = '600 60px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.fillText('图片文字识别 OCR', 90, 140);
    ctx.font = '44px "PingFang SC","Microsoft YaHei",sans-serif';
    ['这是一张用于测试的图片。', '文字在浏览器本地识别，图片不上传。', '识别后可以编辑、复制和下载文本。'].forEach((line, index) => ctx.fillText(line, 90, 260 + index * 94));
    ctx.font = '42px Arial,sans-serif'; ctx.fillText('SGAO Tools - Image to Text', 90, 600); ctx.fillText('Hello world! 2026-10-28', 90, 700);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('示例图片无法创建。');
    return new File([blob], 'sgao-ocr-demo.png', { type: 'image/png' });
  } finally { canvas.width = canvas.height = 1; }
}
