// Only generated test pixels are sent. Never use a real passport in this smoke test.
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const service = require('../src/services/ocr/gemini-passport-service');
const { loadFixtures } = require('./ocr-benchmark');

async function main() {
  const config = service.getConfiguration();
  console.log(`Cloud OCR configuration: ${config.status}`);
  if (!process.argv.includes('--live')) {
    console.log('Use --live to make one billable cloud request with generated test data.');
    return;
  }
  if (config.status !== 'configured') throw new Error(service.configurationMessage(config.status));
  const rows = ['FIRST NAME: JOHN PAUL', 'SURNAME: DOE AL HASSAN', "FATHER'S NAME: MICHAEL",
    'PASSPORT NO: N12345678', 'DATE OF BIRTH: 02/01/1990', 'EXPIRY DATE: 06/05/2030', 'NATIONALITY: SYR', 'SEX: M'];
  const fixture = loadFixtures()[0];
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg width="1800" height="1250"><rect width="1800" height="1250" fill="white"/>
    <g font-family="Arial" font-size="42" fill="black">${rows.map((text, i) => `<text x="100" y="${110 + i * 95}">${escape(text)}</text>`).join('')}</g>
    <g font-family="Arial" font-size="52" fill="black" text-anchor="end">${['الاسم: أحمد', 'اسم الأب: محمد', 'النسبة: الحسن'].map((text, i) => `<text x="1720" y="${110 + i * 95}">${text}</text>`).join('')}</g>
    <g font-family="Courier New" font-size="52" fill="black">${fixture.mrzLines.map((text, i) => `<text x="100" y="${1050 + i * 85}">${escape(text)}</text>`).join('')}</g></svg>`;
  const imageBuffer = await sharp(Buffer.from(svg)).jpeg({ quality: 96 }).toBuffer();
  const result = await service.recognizePassport({ imageBuffer });
  for (const [field, expected] of Object.entries({ ...fixture.expected,
    first_name_ar: 'أحمد', father_name_ar: 'محمد', last_name_ar: 'الحسن', father_name_en: 'MICHAEL' })) {
    assert.equal(result.extraction.data[field], expected, `Synthetic cloud OCR: ${field}`);
  }
  console.log('Live cloud OCR passed: Arabic/English names, passport number, dates, nationality and gender.');
  console.log(`Extracted ${Object.values(result.extraction.data).filter(Boolean).length} fields; human review: ${result.extraction.contract.requiresHumanReview}.`);
}
main().catch((error) => {
  const code = /^GEMINI_OCR_[A-Z0-9_]+$/.test(error.code || '') ? error.code : error.name;
  console.error(`Cloud OCR smoke failed: ${code}`);
  if (error.name === 'AssertionError') console.error('A synthetic field did not match its expected value.');
  process.exitCode = 1;
});
