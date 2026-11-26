const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const service = require('../src/services/ocr/gemini-arabic-service');

async function main() {
  if (!process.argv.includes('--live')) throw new Error('Use --live to explicitly test the configured API with synthetic names only.');
  if (service.getConfiguration().status !== 'configured') throw new Error('Gemini must be enabled with a key and confirmed paid project.');
  const lines = [
    { text: 'الاسم: أحمد', confidence: 0.95, bounds: { left: 0.65, top: 0.22, width: 0.3, height: 0.1 } },
    { text: 'النسبة: الحسن', confidence: 0.95, bounds: { left: 0.65, top: 0.36, width: 0.3, height: 0.1 } },
    { text: 'اسم الأب: محمود', confidence: 0.95, bounds: { left: 0.65, top: 0.55, width: 0.3, height: 0.1 } }
  ];
  const imageBuffer = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700">' +
    '<rect width="1000" height="700" fill="white"/>' +
    '<g font-family="Arial" font-size="36" direction="rtl" text-anchor="start">' +
    '<text x="945" y="200">الاسم: أحمد</text><text x="945" y="300">النسبة: الحسن</text>' +
    '<text x="945" y="430">اسم الأب: محمود</text></g></svg>')).png().toBuffer();
  const result = await service.recognizeArabicNames({ imageBuffer, lines });
  assert.equal(result.status, 'completed');
  for (const [field, expected] of Object.entries({ first_name_ar: 'أحمد', father_name_ar: 'محمود', last_name_ar: 'الحسن' })) {
    assert.equal(result.fields[field].value, expected, `${field} must match synthetic source`);
  }
  console.log(JSON.stringify({ status: 'passed', syntheticArabicFields: 3, model: result.model, diagnostics: result.diagnostics }));
}
main().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; });
