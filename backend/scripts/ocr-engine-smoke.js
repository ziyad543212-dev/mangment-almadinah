const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { createWorker, OEM } = require('tesseract.js');
const { normalizeTesseractLines } = require('../src/services/ocr/tesseract-utils');

async function main() {
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    langPath: path.join(__dirname, '../src/ocr-service/models/tessdata_best'), gzip: false,
    cachePath: path.join(os.tmpdir(), 'tesseract-cache', 'best'), errorHandler: () => {},
    workerPath: require.resolve('../src/services/ocr/tesseract-best-worker.cjs')
  });
  try {
    const image = await sharp(Buffer.from('<svg width="800" height="150"><rect width="800" height="150" fill="white"/><text x="30" y="90" font-family="Arial" font-size="50">PASSPORT ABC123456</text></svg>')).png().toBuffer();
    const result = await worker.recognize(image, {}, { text: true, blocks: true });
    assert.match(result.data.text, /PASSPORT ABC123456/);
    assert.ok(normalizeTesseractLines(result, 800, 150, 'smoke').length);
    console.log('Real tessdata_best recognition and positioned blocks: passed');
  } finally { await worker.terminate(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
