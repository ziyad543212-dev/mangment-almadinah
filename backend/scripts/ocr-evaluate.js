#!/usr/bin/env node
/** Real-image evaluation. Inputs and extracted personal data stay on this PC.
 * node scripts/ocr-evaluate.js --dir <folder> [--limit 5] [--labels expected.json]
 * Labels: { "filename.pdf": { "passport_number": "...", ... } }
 * Without labels we report coverage/checksums, never an accuracy percentage.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { characterErrorRate } = require('./ocr-benchmark');
const sharp = require('sharp');
const { rasterizePassportPdf } = require('../src/services/ocr/pdf-input');

const arg = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
process.env.OCR_RATE_LIMIT_PER_MINUTE = '10000';
process.env.OCR_LOG_SUMMARY = 'false';
const authPath = require.resolve('../src/auth');
const originalAuth = require.cache[authPath];
const neverRunAuth = () => { throw new Error('Benchmark must not execute HTTP authentication'); };
// Importing auth starts the database in this app. Evaluation must not connect
// to a production database or execute migrations just to read local images.
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true,
  exports: { authenticateToken: neverRunAuth, requireAdmin: neverRunAuth } };
const router = require('../src/routes/ocr');
if (originalAuth) require.cache[authPath] = originalAuth;
else delete require.cache[authPath];
// Call the real processing handler in-process. Production authentication and
// upload middleware are unchanged; no public benchmark endpoint is created.
const handler = router.stack.find((entry) => entry.route?.path === '/ocr/passport').route.stack.at(-1).handle;

async function main() {
  const inputDir = arg('--dir');
  if (!inputDir) throw new Error('Usage: node scripts/ocr-evaluate.js --dir <folder> [--limit 5] [--labels file]');
  const outputDir = path.resolve(arg('--output') || path.join(__dirname, '..', 'ocr-evaluation'));
  const labels = arg('--labels') ? JSON.parse(await fs.readFile(arg('--labels'), 'utf8')) : {};
  const limit = Number(arg('--limit')) || Infinity;
  const match = arg('--match') ? new RegExp(arg('--match'), 'i') : null;
  const files = (await fs.readdir(inputDir)).filter((name) => /\.(pdf|jpe?g|png|webp|tiff?)$/i.test(name) && (!match || match.test(name))).sort().slice(0, limit);
  if (!files.length) throw new Error('No supported images or PDFs found');
  await fs.mkdir(outputDir, { recursive: true });
  const results = [];
  const jobs = files.map((name) => ({ name, variant: 'original' }));
  if (process.argv.includes('--stress')) {
    for (const variant of ['rotated90', 'dark-compressed', 'blurred']) jobs.push({ name: files[0], variant });
  }
  for (const [index, { name, variant }] of jobs.entries()) {
    let buffer = await fs.readFile(path.join(inputDir, name));
    if (variant !== 'original') {
      if (/\.pdf$/i.test(name)) buffer = (await rasterizePassportPdf(buffer)).imageBuffer;
      if (variant === 'rotated90') buffer = await sharp(buffer).rotate(90).png().toBuffer();
      if (variant === 'dark-compressed') buffer = await sharp(buffer).resize({ width: 1400, withoutEnlargement: true })
        .modulate({ brightness: 0.55 }).jpeg({ quality: 40 }).toBuffer();
      if (variant === 'blurred') buffer = await sharp(buffer).resize({ width: 1600, withoutEnlargement: true })
        .blur(0.7).jpeg({ quality: 65 }).toBuffer();
    }
    let status = 200, body;
    const response = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
    const started = performance.now();
    await handler({ file: { buffer, size: buffer.length }, body: { page: '1', mode: 'local' }, user: { id: 'local-evaluation' } }, response);
    const expected = labels[name] || {};
    const fieldChecks = Object.entries(expected).map(([field, value]) => ({ field, expected: value,
      actual: body?.data?.[field] ?? null, exact: (body?.data?.[field] ?? null) === value,
      cer: characterErrorRate(value, body?.data?.[field] ?? '') }));
    const record = { file: name, variant, status, elapsedMs: Math.round(performance.now() - started),
      data: body?.data, contract: body?.ocr_contract, diagnostics: body?.diagnostics,
      mode: body?.mode || 'local',
      ...(process.argv.includes('--include-raw') && { rawOcr: body?.raw_ocr }),
      error: body?.error || null, fieldChecks };
    results.push(record);
    await fs.writeFile(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`Sample ${index + 1}/${jobs.length} (${variant}): HTTP ${status}, ${record.elapsedMs} ms, ` +
      `${Object.values(record.data || {}).filter(Boolean).length} fields, ` +
      `MRZ=${record.contract?.fields?.passport_number?.source === 'mrz'}`);
  }
  const checks = results.flatMap((entry) => entry.fieldChecks);
  const timings = results.map((entry) => entry.elapsedMs).sort((a, b) => a - b);
  const summary = { files: results.length, originalFiles: files.length, successful: results.filter((entry) => entry.status === 200).length,
    withValidatedMrz: results.filter((entry) => entry.contract?.fields?.passport_number?.source === 'mrz').length,
    withArabicNames: results.filter((entry) => entry.data?.first_name_ar && entry.data?.last_name_ar).length,
    medianMs: timings[Math.floor(timings.length / 2)], p95Ms: timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))],
    labeledFields: checks.length, exactFieldAccuracy: checks.length ? checks.filter((entry) => entry.exact).length / checks.length : null,
    note: checks.length ? 'Accuracy applies only to provided labeled fields.' : 'Coverage and MRZ checks are not recognition accuracy.' };
  summary.byFieldGroup = Object.fromEntries(['arabic', 'english', 'document'].map((group) => {
    const subset = checks.filter((check) => group === 'arabic' ? check.field.endsWith('_ar')
      : group === 'english' ? check.field.endsWith('_en') : !/_(ar|en)$/.test(check.field));
    return [group, { fields: subset.length, exact: subset.filter((check) => check.exact).length,
      accuracy: subset.length ? subset.filter((check) => check.exact).length / subset.length : null }];
  }));
  await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => router.closeOcrWorkers());
