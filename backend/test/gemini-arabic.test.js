const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const service = require('../src/services/ocr/gemini-arabic-service');
const { createPrivateArabicNameCrop } = require('../src/services/ocr/arabic-name-crop');
const { applyArabicAssistance } = require('../src/services/ocr/arabic-assistance');
const { mergePassportSources, buildOcrContract } = require('../src/services/ocr/passport-extraction');

const lines = [
  { text: 'الاسم: أحمد', confidence: 0.95, bounds: { left: 0.65, top: 0.22, width: 0.3, height: 0.08 } },
  { text: 'النسبة: الحسن', confidence: 0.95, bounds: { left: 0.65, top: 0.36, width: 0.3, height: 0.08 } },
  { text: 'اسم الأب: محمود', confidence: 0.95, bounds: { left: 0.65, top: 0.55, width: 0.3, height: 0.08 } }
];

async function imageFixture() {
  return sharp(Buffer.from('<svg width="1000" height="700"><rect width="1000" height="700" fill="white"/>' +
    '<rect x="20" y="150" width="200" height="500" fill="red"/>' +
    '<rect x="650" y="50" width="300" height="50" fill="blue"/>' +
    '<rect x="650" y="325" width="300" height="30" fill="blue"/>' +
    '<rect x="650" y="154" width="300" height="56" fill="green"/>' +
    '<rect x="650" y="252" width="300" height="56" fill="green"/>' +
    '<rect x="650" y="385" width="300" height="56" fill="green"/></svg>')).png().toBuffer();
}

function fields() {
  return {
    first_name_ar: { value: 'أحمد', readability: 'clear', label: 'الاسم' },
    father_name_ar: { value: 'محمود', readability: 'clear', label: 'اسم الأب' },
    last_name_ar: { value: 'الحسن', readability: 'clear', label: 'النسبة' }
  };
}
function payload(value = fields()) { return { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(value) }] }] }; }
function configure(t, overrides = {}) {
  const settings = { GEMINI_OCR_ENABLED: 'true', GEMINI_OCR_PAID_PROJECT_CONFIRMED: 'true',
    GEMINI_API_KEY: 'unit-test-private-key', GEMINI_OCR_MODEL: 'gemini-3.8-flash', GEMINI_OCR_TIMEOUT_MS: '1000', ...overrides };
  const original = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test('private crop excludes portrait, number and intervening date pixels', async () => {
  const cropped = await createPrivateArabicNameCrop(await imageFixture(), lines);
  assert.ok(cropped);
  const { data, info } = await sharp(cropped.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let green = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const [r, g, b] = data.subarray(index, index + 3);
    assert.ok(!(r > 180 && g < 70 && b < 70), 'portrait colour must not be present');
    assert.ok(!(b > 180 && r < 70 && g < 70), 'identifier/date colour must not be present');
    if (g > r + 50 && g > b + 50) green++;
  }
  assert.ok(green > 500);
  assert.equal((await sharp(cropped.buffer).metadata()).exif, undefined);
});

test('uncertain localization never uploads the entire passport', async (t) => {
  configure(t);
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; throw new Error('must not call'); });
  const result = await service.recognizeArabicNames({ imageBuffer: await imageFixture(), lines: lines.slice(0, 1) });
  assert.equal(result.status, 'skipped_private_crop');
  assert.equal(calls, 0);
});

test('disabled, unconfirmed paid project and missing key all prevent network calls', async (t) => {
  configure(t);
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; throw new Error('must not call'); });
  const imageBuffer = await imageFixture();
  process.env.GEMINI_OCR_ENABLED = 'false';
  assert.equal((await service.recognizeArabicNames({ imageBuffer, lines })).status, 'disabled');
  process.env.GEMINI_OCR_ENABLED = 'true';
  process.env.GEMINI_OCR_PAID_PROJECT_CONFIRMED = 'false';
  assert.equal((await service.recognizeArabicNames({ imageBuffer, lines })).status, 'paid_project_confirmation_required');
  process.env.GEMINI_OCR_PAID_PROJECT_CONFIRMED = 'true';
  process.env.GEMINI_API_KEY = '';
  assert.equal((await service.recognizeArabicNames({ imageBuffer, lines })).status, 'api_key_missing');
  assert.equal(calls, 0);
  assert.equal('apiKey' in service.getConfiguration(), false);
});

test('Gemini receives only re-encoded name boxes with a server-only header key', async (t) => {
  configure(t);
  const imageBuffer = await imageFixture();
  let calls = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-goog-api-key'], 'unit-test-private-key');
    const body = JSON.parse(options.body);
    assert.equal(body.input[1].mime_type, 'image/jpeg');
    assert.notDeepEqual(Buffer.from(body.input[1].data, 'base64'), imageBuffer);
    assert.equal(body.store, false);
    assert.equal(body.previous_interaction_id, undefined);
    assert.equal(body.tools, undefined);
    assert.equal(body.cachedContent, undefined);
    assert.equal(options.body.includes('unit-test-private-key'), false);
    return new Response(JSON.stringify(payload()), { status: 200 });
  });
  const result = await service.recognizeArabicNames({ imageBuffer, lines });
  assert.equal(calls, 1);
  assert.equal(result.sent, true);
  assert.equal(result.fields.first_name_ar.value, 'أحمد');
  assert.equal('apiKey' in result, false);
});

test('responses with uncertain letters, Latin guesses or wrong labels cannot populate a name', () => {
  const value = fields();
  value.first_name_ar = { value: 'AHMAD', readability: 'clear', label: 'الاسم' };
  value.father_name_ar = { value: 'محمود', readability: 'clear', label: 'اسم الأم' };
  value.last_name_ar.readability = 'uncertain';
  const result = service.parseFields(payload(value));
  assert.ok(Object.values(result).every((hit) => hit.value === null));
  const extra = { ...fields(), passport_number: 'unexpected' };
  assert.throws(() => service.parseFields(payload(extra)), /INVALID_FIELDS/);
  assert.throws(() => service.parseFields({ status: 'incomplete', steps: [] }), /INCOMPLETE_RESPONSE/);
});

test('provider error bodies cannot leak keys or recognized personal information', async (t) => {
  configure(t);
  t.mock.method(global, 'fetch', async () => new Response('secret-key and personal data', { status: 403 }));
  await assert.rejects(service.recognizeArabicNames({ imageBuffer: await imageFixture(), lines }), (error) => {
    assert.equal(error.message, 'GEMINI_OCR_HTTP_403');
    assert.doesNotMatch(error.message, /secret-key|personal data/);
    return true;
  });
});

test('aborted requests do not transmit and slow requests have a bounded timeout', async (t) => {
  configure(t);
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  t.mock.method(global, 'fetch', async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  const imageBuffer = await imageFixture();
  await assert.rejects(service.recognizeArabicNames({ imageBuffer, lines, signal: controller.signal }), /CANCELLED/);
  assert.equal(calls, 0);
  await assert.rejects(service.recognizeArabicNames({ imageBuffer, lines }), /TIMEOUT/);
  assert.equal(calls, 1);
});

test('Gemini fills only Arabic names, preserves disagreements and never alters MRZ or English', () => {
  const local = mergePassportSources({ lines: [{ text: 'الاسم: حمد', confidence: 0.8 }] },
    { passport_number: 'N12345678', first_name_en: 'AHMAD', date_of_birth: '1990-01-01' });
  const before = JSON.stringify(local);
  const assisted = applyArabicAssistance(local, { status: 'completed', fields: {
    first_name_ar: { value: 'أحمد', readability: 'clear' }, father_name_ar: { value: 'محمود', readability: 'clear' },
    passport_number: { value: 'BADNUMBER', readability: 'clear' }, first_name_en: { value: 'WRONG', readability: 'clear' }
  } });
  assert.equal(JSON.stringify(local), before);
  assert.equal(assisted.data.first_name_ar, 'أحمد');
  assert.equal(assisted.sources.father_name_ar, 'gemini');
  assert.equal(assisted.confidence.father_name_ar, null);
  assert.equal(assisted.data.passport_number, 'N12345678');
  assert.equal(assisted.data.first_name_en, 'AHMAD');
  assert.ok(assisted.reviewFields.includes('father_name_ar'));
  const contract = buildOcrContract(assisted);
  assert.equal(contract.fields.first_name_ar.alternatives.length, 2);
  assert.equal(contract.fields.first_name_ar.validated, false);
  assert.equal(contract.fields.father_name_ar.validated, false);
  assert.equal(contract.requiresHumanReview, true);
});

test('independent agreement can validate a local reading without inventing a confidence score', () => {
  const local = mergePassportSources({ lines: [{ text: 'الاسم: أحمد', confidence: 0.85 }] }, null);
  const assisted = applyArabicAssistance(local, { status: 'completed', fields: { first_name_ar: { value: 'أحمد', readability: 'clear' } } });
  assert.equal(assisted.sources.first_name_ar, 'paddleocr');
  assert.equal(assisted.confidence.first_name_ar, 0.85);
  assert.equal(buildOcrContract(assisted).fields.first_name_ar.validated, true);
});

test('an uncertain Gemini reading preserves the local value but explicitly requests review', () => {
  const local = mergePassportSources({ lines: [{ text: 'اسم الأب: على', confidence: 0.99 }] }, null);
  local.agreements.add('father_name_ar');
  const assisted = applyArabicAssistance(local, { status: 'completed', fields: {
    father_name_ar: { value: null, readability: 'uncertain' }
  } });
  assert.equal(assisted.data.father_name_ar, 'على');
  assert.ok(assisted.reviewFields.includes('father_name_ar'));
  assert.equal(buildOcrContract(assisted).fields.father_name_ar.validated, false);
});
