#!/usr/bin/env node
/**
 * OCR extraction benchmark.
 *
 * Measures field-level extraction quality of mergePassportSources +
 * buildOcrContract against synthetic OCR-line fixtures. Fixtures simulate
 * engine output (PaddleOCR/Tesseract line lists) — no real passport images
 * are required or stored in git.
 *
 * Usage:
 *   node scripts/ocr-benchmark.js                 # built-in fixtures
 *   node scripts/ocr-benchmark.js --dir <path>    # load *.json fixtures
 *
 * Fixture format (test/fixtures/ocr/*.json):
 * {
 *   "name": "clean-passport",
 *   "readLines":  [{ "text": "...", "confidence": 0.95, "bounds": {...} }],
 *   "fallbackLines": [...],
 *   "mrzLines": ["P<SYR...", "......"],   // raw MRZ lines (44 chars)
 *   "expected": { "passport_number": "...", "first_name_en": "...", ... }
 * }
 *
 * NOTE: synthetic fixtures validate the pipeline mechanics only. They do NOT
 * establish accuracy on real passports. Add real-world fixtures (obtained
 * with explicit consent, stored outside git) via --dir to measure true
 * field accuracy.
 */
const fs = require('fs');
const path = require('path');

const extraction = require('../src/services/ocr/passport-extraction');

const BUILTIN_FIXTURES = [
  {
    name: 'clean-mrz-and-fields',
    readLines: [
      { text: 'PASSPORT NO: N12345678', confidence: 0.96, pageNumber: 1, bounds: null },
      { text: 'DATE OF BIRTH: 02/01/1990', confidence: 0.95, pageNumber: 1, bounds: null },
      { text: 'EXPIRY DATE: 06/05/2030', confidence: 0.95, pageNumber: 1, bounds: null },
      { text: 'NATIONALITY: SYR', confidence: 0.94, pageNumber: 1, bounds: null },
      { text: 'SEX: M', confidence: 0.93, pageNumber: 1, bounds: null }
    ],
    fallbackLines: [],
    mrzLines: null, // filled below by builder
    expected: null
  },
  {
    name: 'conflicting-visual-vs-mrz',
    readLines: [
      { text: 'PASSPORT NO: X0000000', confidence: 0.9, pageNumber: 1, bounds: null },
      { text: 'DATE OF BIRTH: 02/01/1990', confidence: 0.9, pageNumber: 1, bounds: null }
    ],
    fallbackLines: [],
    mrzLines: null,
    expected: null
  }
];

function buildMrzFixture() {
  const weights = [7, 3, 1];
  const values = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const cd = (v) => String([...v].reduce((s, c, i) => s + (c === '<' ? 0 : values.indexOf(c)) * weights[i % 3], 0) % 10);
  const line1 = 'P<SYRDOE<AL<HASSAN<<JOHN<PAUL'.padEnd(44, '<');
  const doc = 'N12345678';
  const dob = '900102';
  const exp = '300506';
  const prefix = doc + cd(doc) + 'SYR' + dob + cd(dob) + 'M' + exp + cd(exp) + '<'.repeat(14) + '<';
  const composite = prefix.slice(0, 10) + prefix.slice(13, 20) + prefix.slice(21, 43);
  const line2 = prefix + cd(composite);
  return [line1, line2];
}

function loadFixtures(dirArg) {
  if (!dirArg) {
    const mrz = buildMrzFixture();
    const [clean, conflict] = BUILTIN_FIXTURES;
    clean.mrzLines = mrz;
    clean.expected = {
      passport_number: 'N12345678',
      date_of_birth: '1990-01-02',
      passport_expiry_date: '2030-05-06',
      nationality: 'SYR',
      gender: 'M',
      first_name_en: 'JOHN PAUL',
      last_name_en: 'DOE AL HASSAN'
    };
    conflict.mrzLines = mrz;
    conflict.expected = {
      passport_number: 'N12345678',
      date_of_birth: '1990-01-02'
    };
    return BUILTIN_FIXTURES;
  }
  const dir = path.resolve(dirArg);
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

function characterErrorRate(expected, actual) {
  if (expected == null || actual == null) return null;
  const a = String(expected).toUpperCase().replace(/\s+/g, '');
  const b = String(actual).toUpperCase().replace(/\s+/g, '');
  if (!a.length) return b.length ? 1 : 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length] / a.length;
}

function runFixture(fixture) {
  const mrzData = fixture.mrzLines
    ? extraction.parseMrz(extraction.sanitizeMrzLines(fixture.mrzLines.join('\n')))
    : null;
  const started = process.hrtime.bigint();
  const merged = extraction.mergePassportSources(
    { lines: fixture.readLines || [] },
    mrzData,
    { lines: fixture.fallbackLines || [] }
  );
  const contract = extraction.buildOcrContract({
    data: merged.data,
    sources: merged.sources,
    confidence: merged.confidence,
    reviewFields: merged.reviewFields,
    conflicts: merged.conflicts,
    agreements: merged.agreements,
    mrzAttempts: mrzData ? 2 : 0,
    extraWarnings: []
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const expected = fixture.expected || {};
  const fields = Object.keys(expected);
  let exact = 0;
  let cerSum = 0;
  let cerCount = 0;
  const misses = [];
  for (const field of fields) {
    const actual = merged.data[field];
    const expectedValue = expected[field];
    if (actual === expectedValue || (actual == null && expectedValue == null)) {
      exact += 1;
    } else {
      misses.push({ field, expected: expectedValue, actual });
    }
    if (typeof expectedValue === 'string' && expectedValue.length > 3) {
      const cer = characterErrorRate(expectedValue, actual);
      if (cer !== null) { cerSum += cer; cerCount += 1; }
    }
  }

  const expectedPresent = fields.filter((f) => expected[f] !== null && expected[f] !== undefined && expected[f] !== '');
  const extractedPresent = expectedPresent.filter((f) => merged.data[f] !== null && merged.data[f] !== undefined && merged.data[f] !== '');
  const precision = expectedPresent.length
    ? extractedPresent.filter((f) => merged.data[f] === expected[f]).length / expectedPresent.length
    : null;
  const recall = expectedPresent.length ? extractedPresent.length / expectedPresent.length : null;

  return {
    name: fixture.name || 'unnamed',
    fields: fields.length,
    exactMatchRate: fields.length ? exact / fields.length : null,
    precision,
    recall,
    meanCER: cerCount ? cerSum / cerCount : null,
    conflicts: merged.conflicts.length,
    requiresReview: contract.requiresHumanReview,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
    misses
  };
}

function main() {
  const dirIndex = process.argv.indexOf('--dir');
  const fixtures = loadFixtures(dirIndex !== -1 ? process.argv[dirIndex + 1] : null);
  if (!fixtures.length) {
    console.error('No fixtures found.');
    process.exit(1);
  }

  const results = fixtures.map(runFixture);
  console.log('\nOCR Extraction Benchmark');
  console.log('='.repeat(72));
  console.log('NOTE: fixtures are synthetic; real-passport accuracy is NOT established.');
  console.log('='.repeat(72));
  for (const r of results) {
    const pct = (v) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
    console.log(`\n[${r.name}]`);
    console.log(`  fields evaluated : ${r.fields}`);
    console.log(`  exact match rate : ${pct(r.exactMatchRate)}`);
    console.log(`  precision        : ${pct(r.precision)}`);
    console.log(`  recall           : ${pct(r.recall)}`);
    console.log(`  mean CER         : ${r.meanCER === null ? 'n/a' : r.meanCER.toFixed(4)}`);
    console.log(`  conflicts        : ${r.conflicts}`);
    console.log(`  needs review     : ${r.requiresReview}`);
    console.log(`  elapsed          : ${r.elapsedMs}ms`);
    if (r.misses.length) {
      console.log('  misses:');
      for (const m of r.misses) {
        console.log(`    - ${m.field}: expected=${JSON.stringify(m.expected)} actual=${JSON.stringify(m.actual)}`);
      }
    }
  }
  const avg = (key) => {
    const values = results.map((r) => r[key]).filter((v) => typeof v === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  console.log('\n' + '='.repeat(72));
  console.log(`Aggregate: exact=${(avg('exactMatchRate') * 100 || 0).toFixed(1)}% ` +
    `precision=${((avg('precision') || 0) * 100).toFixed(1)}% ` +
    `recall=${((avg('recall') || 0) * 100).toFixed(1)}% ` +
    `CER=${(avg('meanCER') || 0).toFixed(4)} avgTime=${avg('elapsedMs')?.toFixed(1)}ms`);
  console.log('='.repeat(72));
}

if (require.main === module) main();
module.exports = { runFixture, characterErrorRate, loadFixtures };
