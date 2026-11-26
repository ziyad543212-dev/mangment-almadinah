const sharp = require('sharp');
const { mergePassportSources, parseMrzText } = require('./passport-extraction');
const { normalizeTesseractLines, recognizeSerialized } = require('./tesseract-utils');

// Score labeled passport fields and checked MRZ data, never raw OCR confidence.
function passportEvidence(result, width, height) {
  const lines = normalizeTesseractLines(result, width, height, 'tesseract-english');
  const mrz = parseMrzText(result?.data?.text);
  const { data } = mergePassportSources({ lines }, mrz.data, null, 'tesseract');
  const fields = ['first_name_en', 'father_name_en', 'last_name_en', 'passport_number',
    'date_of_birth', 'passport_expiry_date', 'nationality', 'gender'];
  const count = fields.filter((field) => data[field]).length;
  return { score: (mrz.data ? 100 : 0) + count,
    readable: Boolean(mrz.data) || (count >= 4 && Boolean(data.passport_number || data.first_name_en)) };
}

async function orientFallbackPassport(imageBuffer, worker) {
  let best = null;
  for (const angle of [0, 90, 180, 270]) {
    const image = await sharp(imageBuffer).rotate(angle).normalize()
      .sharpen({ sigma: 0.6 }).png().toBuffer();
    const { width, height } = await sharp(image).metadata();
    const englishResult = await recognizeSerialized(worker, image, { tessedit_pageseg_mode: '11' });
    const evidence = passportEvidence(englishResult, width, height);
    if (!best || evidence.score > best.score) {
      best = { imageBuffer: image, width, height, englishResult, angle, score: evidence.score };
    }
    if (evidence.readable) break;
  }
  return best;
}

module.exports = { orientFallbackPassport };
