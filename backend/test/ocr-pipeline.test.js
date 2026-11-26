const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTesseractLines, recognizeSerialized } = require('../src/services/ocr/tesseract-utils');
const extraction = require('../src/services/ocr/passport-extraction');

function line(text, confidence, left, top, width, passId = 'original') {
  return { text, confidence, pageNumber: 1, passId, bounds: { left, top, width, height: 0.025 } };
}

test('Tesseract v7 nested blocks yield positioned text lines', () => {
  const result = { data: { blocks: [{ paragraphs: [{ lines: [{ text: 'الاسم: أحمد', confidence: 91,
    bbox: { x0: 100, y0: 200, x1: 500, y1: 230 } }] }] }] } };
  const [found] = normalizeTesseractLines(result, 1000, 500, 'arabic');
  assert.equal(found.text, 'الاسم: أحمد');
  assert.equal(found.confidence, 0.91);
  assert.deepEqual(found.bounds, { left: 0.1, top: 0.4, width: 0.4, height: 0.06 });
});

test('concurrent calls on one Tesseract worker cannot overlap, even after failure', async () => {
  let active = 0;
  const worker = { async recognize(image, _options, output) {
    assert.equal(active++, 0);
    assert.equal(output.blocks, true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (image === 'fail') throw new Error('engine error');
    return image;
  } };
  const result = await Promise.allSettled(['one', 'fail', 'two'].map((image) => recognizeSerialized(worker, image)));
  assert.deepEqual(result.map((entry) => entry.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(result[2].value, 'two');
});

test('Arabic and Persian digits and month names normalize without guessing calendar dates', () => {
  assert.equal(extraction.normalizeOcrDate('٠٦/٠٩/١٩٩٣'), '1993-09-06');
  assert.equal(extraction.normalizeOcrDate('۱۲/۰۹/۲۰۳۲'), '2032-09-12');
  assert.equal(extraction.normalizeOcrDate('06 SEP 1993'), '1993-09-06');
  assert.equal(extraction.normalizeOcrDate('31 FEB 2000'), null);
  assert.equal(extraction.validateDocumentValue('passportNumber', 'N٠٤٢٥٥١٥٩'), 'N04255159');
});

test('separate adjacent labels and values work in both reading directions', () => {
  const lines = [line('Name', 0.95, 0.30, 0.30, 0.05), line('ABEER', 0.97, 0.36, 0.30, 0.12),
    line('الاسم', 0.94, 0.9, 0.30, 0.04), line('عبير', 0.96, 0.80, 0.30, 0.08),
    line('Father Name: MOHAMMED', 0.97, 0.3, 0.5, 0.3),
    line('Mother Name: ELHAM', 0.98, 0.3, 0.6, 0.3)];
  const result = extraction.mergePassportSources({ lines }, null);
  assert.equal(result.data.first_name_en, 'ABEER');
  assert.equal(result.data.first_name_ar, 'عبير');
  assert.equal(result.data.father_name_en, 'MOHAMMED');
});

test('passes choose better candidates and expose Arabic disagreements', () => {
  const lines = [line('الاسم: أحمد', 0.65, 0.8, 0.3, 0.15),
    line('الاسم: محمد', 0.96, 0.8, 0.3, 0.15, 'contrast')];
  const result = extraction.mergePassportSources({ lines }, null);
  assert.equal(result.data.first_name_ar, 'محمد');
  assert.equal(result.contract.fields.first_name_ar.validated, false);
  assert.equal(result.contract.fields.first_name_ar.alternatives.length, 2);
  assert.ok(result.reviewFields.includes('first_name_ar'));
});

test('labels from one pass cannot claim names from another pass', () => {
  const result = extraction.mergePassportSources({ lines: [
    line('الاسم', 0.95, 0.8, 0.3, 0.1), line('محمد', 0.97, 0.8, 0.33, 0.1, 'contrast')
  ] }, null);
  assert.equal(result.data.first_name_ar, '');
});

test('MRZ names are not presented as checksum validated', () => {
  const result = extraction.mergePassportSources({ lines: [] }, {
    first_name_en: 'JOHN', last_name_en: 'DOE', passport_number: 'N12345678', nationality: 'SYR', gender: 'M'
  });
  assert.equal(result.contract.fields.passport_number.validated, true);
  assert.equal(result.contract.fields.first_name_en.validated, false);
  assert.equal(result.contract.fields.nationality.validated, false);
  assert.equal(result.contract.fields.gender.validated, false);
});

test('a checksum cannot authorize arbitrary substitution of unknown date characters', () => {
  const fixture = require('../scripts/ocr-benchmark').loadFixtures()[0];
  const [first, second] = fixture.mrzLines;
  assert.equal(extraction.parseMrzText(first + '\n' + second.replace('900102', '9I01I2')).data, null);
  assert.equal(extraction.parseMrzText(first + '\n' + second.replace('900102', '9?01?2')).data, null);
});

test('passport-number substrings disagree and require review', () => {
  const result = extraction.mergePassportSources({ lines: [line('PASSPORT NO: N1234567', 0.95, 0.2, 0.3, 0.4)] },
    { passport_number: 'N12345678' });
  assert.equal(result.conflicts[0].field, 'passport_number');
});

test('MRZ data checks survive a damaged name line without inventing names', () => {
  const fixture = require('../scripts/ocr-benchmark').loadFixtures()[0];
  const result = extraction.parseMrzText('P<SYRDOE<<J?HN<٢٢٢٢٢٢٢٢\n' + fixture.mrzLines[1]);
  assert.equal(result.partial, true);
  assert.equal(result.data.passport_number, 'N12345678');
  assert.equal(result.data.first_name_en, '');
  assert.equal(result.data.last_name_en, '');
  assert.equal(result.diagnostics.dataValid, true);
  const broken = fixture.mrzLines[1].slice(0, 43) + (fixture.mrzLines[1][43] === '9' ? '0' : '9');
  assert.equal(extraction.parseMrzText(broken).data, null);
});

test('an OCR-damaged father label cannot supply a generic first name', () => {
  const result = extraction.mergePassportSources({ lines: [line('Fatber Name', 0.95, 0.3, 0.5, 0.1),
    line('SAMER', 0.99, 0.42, 0.5, 0.1)] }, { first_name_en: 'AHMAD' });
  assert.equal(result.data.first_name_en, 'AHMAD');
});

function pdfFixture() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 250] /Resources << >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 450] /Resources << >> >>'];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}

test('PDF selection rasterizes only the requested page with bounded dimensions', async () => {
  const sharp = require('sharp');
  const { rasterizePassportPdf } = require('../src/services/ocr/pdf-input');
  const result = await rasterizePassportPdf(pdfFixture(), 2);
  const metadata = await sharp(result.imageBuffer).metadata();
  assert.equal(result.totalPages, 2);
  assert.ok(metadata.height > metadata.width);
  assert.ok(metadata.width * metadata.height <= 12_000_000);
  await assert.rejects(rasterizePassportPdf(pdfFixture(), 3), /Missing PDF page/);
  await assert.rejects(rasterizePassportPdf(pdfFixture(), NaN), /Invalid PDF page/);
});

test('corrupted place text is rejected even when the engine reports high confidence', () => {
  const result = extraction.mergePassportSources({ lines: [
    line('مكان الإصدار: مروة[ )مما', 0.96, 0.5, 0.5, 0.4)
  ] }, null);
  assert.equal(result.data.place_of_issue, null);
  assert.equal(result.contract.fields.place_of_issue.confidence, null);
  for (const value of ['دمشق )سوريا', 'دمشق (سوريا', 'دمشق @#']) {
    assert.equal(extraction.validateDocumentValue('place', value), '');
  }
  for (const value of ['دمشق', 'DAMASCUS', 'دمشق (سوريا)', 'AL-MADINAH']) {
    assert.equal(extraction.validateDocumentValue('place', value), value);
  }
});

test('spaced Arabic field labels are matched without changing name letters', () => {
  const result = extraction.mergePassportSources({ lines: [
    line('ا لاسم : أحمد', 0.96, 0.7, 0.3, 0.2),
    line('ا سم ا لأب : محمد', 0.96, 0.7, 0.4, 0.2),
    line('ا لنسبة : الحسن', 0.96, 0.7, 0.5, 0.2)
  ] }, null);
  assert.equal(result.data.first_name_ar, 'أحمد');
  assert.equal(result.data.father_name_ar, 'محمد');
  assert.equal(result.data.last_name_ar, 'الحسن');
  assert.equal(result.contract.fields.first_name_ar.validated, false);
});

test('an expiry date and place alone cannot make a passport scan successful', () => {
  const result = extraction.mergePassportSources({ lines: [
    line('EXPIRY DATE: 2030-05-06', 0.96, 0.2, 0.3, 0.5),
    line('PLACE OF ISSUE: DAMASCUS', 0.96, 0.2, 0.4, 0.5)
  ] }, null);
  assert.equal(result.contract.status, 'failed');
  assert.equal(extraction.hasPassportIdentity(result.data), false);
  assert.equal(extraction.hasPassportIdentity({ first_name_ar: 'أحمد' }), true);
  assert.equal(extraction.hasPassportIdentity({ passport_number: 'N12345678' }), true);
});

test('fallback orientation chooses passport evidence over confident noise', async () => {
  const sharp = require('sharp');
  const { orientFallbackPassport } = require('../src/services/ocr/fallback-orientation');
  const fixture = require('../scripts/ocr-benchmark').loadFixtures()[0];
  const image = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#ffffff' } }).png().toBuffer();
  let calls = 0;
  const worker = { async recognize(_image, options) {
    assert.equal(options.tessedit_pageseg_mode, '11');
    calls += 1;
    return calls === 4 ? { data: { text: fixture.mrzLines.join('\n') } }
      : { data: { text: 'random text', lines: [{ text: 'NOISE', confidence: 100 }] } };
  } };
  const result = await orientFallbackPassport(image, worker);
  assert.equal(calls, 4);
  assert.equal(result.angle, 270);
  assert.equal(result.width, 600);
  assert.equal(result.height, 400);
});

test('fallback orientation stops when checked MRZ is already upright', async () => {
  const sharp = require('sharp');
  const { orientFallbackPassport } = require('../src/services/ocr/fallback-orientation');
  const fixture = require('../scripts/ocr-benchmark').loadFixtures()[0];
  const image = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
  let calls = 0;
  const worker = { async recognize() { calls += 1; return { data: { text: fixture.mrzLines.join('\n') } }; } };
  const result = await orientFallbackPassport(image, worker);
  assert.equal(calls, 1);
  assert.equal(result.angle, 0);
});

test('startup diagnostics expose the Windows policy block without leaking raw errors', () => {
  const { startupDiagnostic } = require('../src/services/ocr/service-lifecycle');
  assert.equal(startupDiagnostic('ImportError: DLL load failed: An Application Control policy has blocked this file. C:/private/path'),
    'PADDLE_OCR_BLOCKED_BY_POLICY');
  assert.equal(startupDiagnostic('ModuleNotFoundError: private Python path'), 'PADDLE_OCR_STARTUP_FAILED');
});
