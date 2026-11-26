const { PDFParse } = require('pdf-parse');

async function rasterizePassportPdf(buffer, pageNumber = 1) {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    throw Object.assign(new Error('Invalid PDF page'), { publicMessage: 'رقم صفحة PDF غير صالح.' });
  }
  const parser = new PDFParse({ data: new Uint8Array(buffer), maxImageSize: 40_000_000 });
  try {
    const info = await parser.getInfo({ parsePageInfo: true });
    if (pageNumber > info.total) {
      throw Object.assign(new Error('Missing PDF page'), { publicMessage: 'الصفحة المطلوبة غير موجودة في PDF.' });
    }
    const page = info.pages.find((entry) => entry.pageNumber === pageNumber) || info.pages[pageNumber - 1];
    // Limit the canvas before allocation, including unusually tall PDF pages.
    const ratio = page?.height && page?.width ? page.height / page.width : 1.5;
    if (!Number.isFinite(ratio) || ratio < 0.05 || ratio > 20) {
      throw Object.assign(new Error('Invalid page geometry'), { publicMessage: 'أبعاد صفحة PDF غير مناسبة لقراءة جواز سفر.' });
    }
    const desiredWidth = Math.max(1, Math.floor(Math.min(2600, 3200 / ratio, Math.sqrt(12_000_000 / ratio))));
    const result = await parser.getScreenshot({ partial: [pageNumber], desiredWidth,
      imageDataUrl: false, imageBuffer: true });
    const imageBuffer = result.pages[0]?.data;
    if (!imageBuffer?.length) throw new Error('PDF page could not be rendered');
    return { imageBuffer: Buffer.from(imageBuffer), totalPages: info.total, pageNumber };
  } finally {
    await parser.destroy();
  }
}

module.exports = { rasterizePassportPdf };
