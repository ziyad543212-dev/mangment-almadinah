// Real local OCR against generated test pixels. No database or cloud requests.
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { loadFixtures } = require('./ocr-benchmark');
const pythonOcrService = require('../src/services/ocr/python-ocr-service');

process.env.OCR_LOG_SUMMARY = 'false';
process.env.GEMINI_OCR_ENABLED = 'false';
const authPath = require.resolve('../src/auth');
const originalAuth = require.cache[authPath];
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true,
  exports: { authenticateToken() { throw new Error('No HTTP auth in smoke test'); }, requireAdmin() {} } };
const router = require('../src/routes/ocr');
if (originalAuth) require.cache[authPath] = originalAuth;
else delete require.cache[authPath];
const handler = router.stack.find((entry) => entry.route?.path === '/ocr/passport').route.stack.at(-1).handle;
const originalRecognize = pythonOcrService.recognizePassport;
pythonOcrService.recognizePassport = async () => { throw new Error('ECONNREFUSED'); };

async function main() {
  const fixture = loadFixtures()[0];
  const rows = ['FIRST NAME: JOHN PAUL', 'SURNAME: DOE AL HASSAN', "FATHER'S NAME: MICHAEL",
    'PASSPORT NO: N12345678', 'DATE OF BIRTH: 02/01/1990', 'EXPIRY DATE: 06/05/2030', 'NATIONALITY: SYR', 'SEX: M'];
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg width="1800" height="1250"><rect width="1800" height="1250" fill="white"/>
    <g font-family="Arial" font-size="42" fill="black">${rows.map((text, i) => `<text x="100" y="${110 + i * 95}">${escape(text)}</text>`).join('')}</g>
    <g font-family="Arial" font-size="52" fill="black" text-anchor="end">${['الاسم: أحمد', 'اسم الأب: محمد', 'النسبة: الحسن'].map((text, i) => `<text x="1720" y="${110 + i * 95}">${text}</text>`).join('')}</g>
    <g font-family="Courier New" font-size="52" fill="black">${fixture.mrzLines.map((text, i) => `<text x="100" y="${1050 + i * 85}">${escape(text)}</text>`).join('')}</g></svg>`;
  const originalImage = await sharp(Buffer.from(svg)).png().toBuffer();
  for (const angle of [0, 90, 180]) {
    const buffer = await sharp(originalImage).rotate(angle).png().toBuffer();
    let status = 200, body;
    const response = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
    const started = Date.now();
    await handler({ file: { buffer, size: buffer.length }, body: { mode: 'local' }, user: { id: 'synthetic-smoke' } }, response);
    assert.equal(status, 200);
    assert.equal(body.success, true);
    for (const [field, expected] of Object.entries(fixture.expected)) assert.equal(body.data[field], expected, `${angle} degrees: ${field}`);
    // OCR can omit the hamza; preserve its spelling and require human review.
    assert.ok(['أحمد', 'احمد'].includes(body.data.first_name_ar), `${angle} degrees: Arabic first name: ${JSON.stringify(body.ocr_contract.fields.first_name_ar)}`);
    assert.equal(body.ocr_contract.fields.first_name_ar.validated, false);
    assert.equal(body.data.father_name_ar, 'محمد', `${angle} degrees: Arabic father name`);
    assert.equal(body.data.last_name_ar, 'الحسن', `${angle} degrees: Arabic surname`);
    const number = body.ocr_contract.fields.passport_number;
    assert.equal(number.validated, number.source === 'mrz');
    console.log(`Real fallback OCR: ${angle} degrees, number/dates and Arabic/English names passed (${Date.now() - started}ms)`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  pythonOcrService.recognizePassport = originalRecognize;
  await router.closeOcrWorkers();
});
