const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const service = require('../src/services/ocr/gemini-passport-service');
const { loadFixtures } = require('../scripts/ocr-benchmark');

function fixture() {
  const fields = service.emptyFields();
  Object.assign(fields, {
    first_name_ar: { value: 'عبد الرحمن', readability: 'clear', label: 'الاسم' },
    father_name_ar: { value: 'محمد أمين', readability: 'clear', label: 'اسم الأب' },
    last_name_ar: { value: 'الحسن', readability: 'clear', label: 'النسبة' },
    first_name_en: { value: 'JOHN PAUL', readability: 'clear', label: 'FIRST NAME' },
    father_name_en: { value: 'MICHAEL', readability: 'clear', label: "FATHER'S NAME" },
    last_name_en: { value: 'DOE AL HASSAN', readability: 'clear', label: 'SURNAME' },
    passport_number: { value: 'N12345678', readability: 'clear', label: 'PASSPORT NO' },
    date_of_birth: { value: '1990-01-02', readability: 'clear', label: 'DATE OF BIRTH' },
    passport_expiry_date: { value: '2030-05-06', readability: 'clear', label: 'EXPIRY DATE' },
    nationality: { value: 'SYR', readability: 'clear', label: 'NATIONALITY' },
    gender: { value: 'M', readability: 'clear', label: 'SEX' }
  });
  return { fields, mrz_lines: [] };
}
function payload(value = fixture()) {
  return { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(value) }] }] };
}
function configure(t, overrides = {}) {
  const settings = { GEMINI_OCR_ENABLED: 'true', GEMINI_OCR_PAID_PROJECT_CONFIRMED: 'true',
    GEMINI_API_KEY: 'synthetic-test-key', GEMINI_OCR_MODEL: 'gemini-3.6-flash', GEMINI_OCR_TIMEOUT_MS: '1000', ...overrides };
  const originals = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => { for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}

test('cloud transcribes Arabic/English fields independently with no invented confidence', () => {
  const result = service.parsePassportResponse(payload());
  assert.equal(result.data.first_name_ar, 'عبد الرحمن');
  assert.equal(result.data.father_name_ar, 'محمد أمين');
  assert.equal(result.data.father_name_en, 'MICHAEL');
  assert.equal(result.data.passport_number, 'N12345678');
  assert.equal(result.data.date_of_birth, '1990-01-02');
  assert.equal(result.sources.first_name_ar, 'gemini');
  assert.equal(result.confidence.first_name_ar, null);
  assert.equal(result.contract.fields.first_name_ar.validated, false);
  assert.equal(result.contract.fields.passport_number.validated, false);
  assert.equal(result.contract.requiresHumanReview, true);
  assert.ok(result.reviewFields.includes('first_name_ar'));
  assert.ok(result.reviewFields.includes('passport_number'));
});

test('uncertainty, wrong labels, transliteration and corrupted places remain empty', () => {
  const value = fixture();
  value.fields.first_name_ar.value = 'ABD AL RAHMAN';
  value.fields.father_name_ar.label = 'اسم الأم';
  value.fields.last_name_ar.readability = 'uncertain';
  value.fields.date_of_birth.value = '1990-02-31';
  value.fields.place_of_issue = { value: 'مروة[ )مما', readability: 'clear', label: 'مكان الإصدار' };
  const result = service.parsePassportResponse(payload(value));
  assert.equal(result.data.first_name_ar, '');
  assert.equal(result.data.father_name_ar, '');
  assert.equal(result.data.last_name_ar, '');
  assert.equal(result.data.date_of_birth, null);
  assert.equal(result.data.place_of_issue, null);
});

test('checked MRZ can fill document fields without inferring a father name or validating names', () => {
  const value = { fields: service.emptyFields(), mrz_lines: loadFixtures()[0].mrzLines };
  const result = service.parsePassportResponse(payload(value));
  assert.equal(result.data.passport_number, 'N12345678');
  assert.equal(result.data.first_name_en, 'JOHN PAUL');
  assert.equal(result.data.father_name_en, '');
  assert.equal(result.contract.fields.passport_number.validated, true);
  assert.equal(result.contract.fields.first_name_en.validated, false);
  assert.equal(result.sources.passport_number, 'mrz');
  assert.equal(result.contract.fields.passport_number.confidence, 0.9);
});

test('failed cloud MRZ checks do not validate or replace visible fields', () => {
  const value = fixture();
  const [first, second] = loadFixtures()[0].mrzLines;
  value.mrz_lines = [first, second.slice(0, 9) + (second[9] === '9' ? '0' : '9') + second.slice(10)];
  const result = service.parsePassportResponse(payload(value));
  assert.equal(result.sources.passport_number, 'gemini');
  assert.equal(result.contract.fields.passport_number.validated, false);
  assert.ok(result.contract.warnings.some((warning) => warning.code === 'mrz_check_failed'));
});

test('cloud preserves conflicts between checked MRZ and printed passport values', () => {
  const value = fixture();
  value.mrz_lines = loadFixtures()[0].mrzLines;
  value.fields.passport_number.value = 'X99999999';
  const result = service.parsePassportResponse(payload(value));
  assert.equal(result.data.passport_number, 'N12345678');
  const conflict = result.conflicts.find((entry) => entry.field === 'passport_number');
  assert.equal(conflict.visual.value, 'X99999999');
  assert.equal(conflict.resolution, 'mrz');
});

test('expired cloud passport dates remain visible with an explicit review warning', () => {
  const value = fixture();
  value.fields.passport_expiry_date.value = '2020-01-01';
  const result = service.parsePassportResponse(payload(value));
  assert.equal(result.data.passport_expiry_date, '2020-01-01');
  assert.ok(result.contract.warnings.some((warning) => warning.code === 'passport_expired'));
  assert.ok(result.reviewFields.includes('passport_expiry_date'));
});

test('malformed, truncated, incomplete and extra response data are rejected', () => {
  const value = fixture();
  value.fields.first_name_ar.confidence = 0.99;
  assert.throws(() => service.parsePassportResponse(payload(value)), /INVALID_FIELDS/);
  assert.throws(() => service.parsePassportResponse(payload({ ...fixture(), mrz_lines: ['only one line'] })), /INVALID_FIELDS/);
  assert.throws(() => service.parsePassportResponse({ status: 'incomplete', steps: [] }), /INCOMPLETE_RESPONSE/);
  assert.throws(() => service.parsePassportResponse(payload({ fields: {}, mrz_lines: [] })), /INVALID_FIELDS/);
});

test('full cloud image uses server credentials, strict schema and stateless requests without local boxes', async (t) => {
  configure(t);
  const imageBuffer = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const fetchSpy = t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-goog-api-key'], 'synthetic-test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.tools, undefined);
    assert.equal(body.previous_interaction_id, undefined);
    assert.equal(body.input[1].data, imageBuffer.toString('base64'));
    assert.equal(body.response_format.schema.properties.fields.additionalProperties, false);
    assert.equal(body.response_format.schema.properties.fields.required.length, service.FIELD_KEYS.length);
    assert.equal(options.body.includes('synthetic-test-key'), false);
    return new Response(JSON.stringify(payload()), { status: 200 });
  });
  const result = await service.recognizePassport({ imageBuffer });
  assert.equal(fetchSpy.mock.callCount(), 1);
  assert.equal(result.extraction.data.first_name_ar, 'عبد الرحمن');
  assert.equal(JSON.stringify(result).includes('synthetic-test-key'), false);
});

test('disabled, unconfirmed billing and absent credentials prevent cloud transmission', async (t) => {
  configure(t);
  const fetchSpy = t.mock.method(global, 'fetch', async () => { throw new Error('Unexpected network call'); });
  for (const [key, value] of [['GEMINI_OCR_ENABLED', 'false'], ['GEMINI_OCR_PAID_PROJECT_CONFIRMED', 'false'], ['GEMINI_API_KEY', '']]) {
    const previous = process.env[key];
    process.env[key] = value;
    await assert.rejects(service.recognizePassport({ imageBuffer: Buffer.from('test') }), /NOT_CONFIGURED/);
    process.env[key] = previous;
  }
  assert.equal(fetchSpy.mock.callCount(), 0);
});

test('cloud errors hide provider bodies and requests honor cancellation and timeouts', async (t) => {
  configure(t);
  const imageBuffer = Buffer.from('synthetic test image');
  t.mock.method(global, 'fetch', async () => new Response('private-key and passport details', { status: 403 }));
  await assert.rejects(service.recognizePassport({ imageBuffer }), (error) => {
    assert.equal(error.code, 'GEMINI_OCR_HTTP_403');
    assert.doesNotMatch(error.message, /private-key|passport details/);
    return true;
  });
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.recognizePassport({ imageBuffer, signal: controller.signal }), /CANCELLED/);
  assert.equal(calls, 0);
  await assert.rejects(service.recognizePassport({ imageBuffer }), /TIMEOUT/);
  assert.equal(calls, 1);
});
