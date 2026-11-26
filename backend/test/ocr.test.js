const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const sharp = require('sharp');

const extraction = require('../src/services/ocr/passport-extraction');
const pythonOcrService = require('../src/services/ocr/python-ocr-service');
const cloudOcrService = require('../src/services/ocr/gemini-passport-service');
const originalRecognizePassport = pythonOcrService.recognizePassport;
const tesseract = require('tesseract.js');
const originalCreateWorker = tesseract.createWorker;
const originalServiceUrl = process.env.LOCAL_PADDLE_OCR_URL;
const originalNodeEnv = process.env.NODE_ENV;
const checkWeights = [7, 3, 1];
const charValues = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let mockMrz;
let mockArabicLines = [];
let mockEnglishLines = [];
let paddleLines = [];
let paddleCropLines = [];
let paddleImageDimensions;
let paddleCropDimensions;
let paddleError;

function calculateCheckDigit(value) {
  const sum = [...value].reduce((total, character, index) => {
    const digit = character === '<' ? 0 : charValues.indexOf(character);
    return total + digit * checkWeights[index % checkWeights.length];
  }, 0);
  return String(sum % 10);
}

function buildMrz({
  surname = 'DOE<AL<HASSAN',
  givenNames = 'JOHN<PAUL',
  documentNumber = 'N12345678',
  birthDate = '900101',
  expiryDate = '300101'
} = {}) {
  const line1 = `P<SYR${surname}<<${givenNames}`.padEnd(44, '<');
  const optionalData = '<'.repeat(14);
  const prefix = documentNumber + calculateCheckDigit(documentNumber) + 'SYR' +
    birthDate + calculateCheckDigit(birthDate) + 'M' +
    expiryDate + calculateCheckDigit(expiryDate) + optionalData + '<';
  const composite = prefix.slice(0, 10) + prefix.slice(13, 20) + prefix.slice(21, 43);
  const line2 = `${prefix}${calculateCheckDigit(composite)}`;
  assert.equal(line1.length, 44);
  assert.equal(line2.length, 44);
  return [line1, line2];
}

function nameLine(text, confidence = 0.96, top = 0.5) {
  return {
    text,
    confidence,
    pageNumber: 1,
    bounds: { left: 0.25, top, width: 0.5, height: 0.025 },
    words: []
  };
}

function passportReadLines() {
  return [
    nameLine('الاسم الشخصي: عبد الرحمن نور الدين', 0.97, 0.32),
    nameLine('اسم الأب: محمد أمين', 0.96, 0.40),
    nameLine('الشهرة: آل الحسن', 0.95, 0.48),
    nameLine('FIRST NAME: JOHN PAUL', 0.97, 0.52),
    nameLine("FATHER'S NAME: MICHAEL JAMES", 0.96, 0.57),
    nameLine('SURNAME: DOE AL HASSAN', 0.96, 0.62)
  ];
}

function localLines() {
  return [
    nameLine('الاسم الشخصي: مخرجات محلية', 0.95),
    nameLine("FATHER'S NAME: LOCAL PARENT", 0.95)
  ];
}

function setupTesseractMock() {
  tesseract.createWorker = async (language) => {
    let mrzMode = false;
    return {
      async setParameters(parameters) {
        mrzMode = Boolean(parameters.tessedit_char_whitelist);
      },
      async recognize(input) {
        if (mrzMode) return { data: { text: mockMrz.join('\n') } };
        const lines = language === 'ara' ? mockArabicLines : mockEnglishLines;
        if (Buffer.isBuffer(input)) {
          return {
            data: {
              lines: lines.map((line, index) => ({
                text: line.text,
                confidence: (line.confidence ?? 0.95) * 100,
                bbox: { x0: 20, y0: 30 + index * 40, x1: 300, y1: 50 + index * 40 }
              }))
            }
          };
        }
        return { data: { text: mockMrz.join('\n') } };
      }
    };
  };
}

function setupRoute() {
  setupTesseractMock();
  pythonOcrService.recognizePassport = async ({ imageBuffer, cropBuffer }) => {
    if (paddleError) throw paddleError;
    if (imageBuffer) paddleImageDimensions = await sharp(imageBuffer).metadata();
    if (cropBuffer) {
      paddleCropDimensions = await sharp(cropBuffer).metadata();
      return { lines: [], crop_lines: paddleCropLines };
    }
    return { lines: paddleLines, crop_lines: [] };
  };
  const authModulePath = require.resolve('../src/auth');
  const originalAuthModule = require.cache[authModulePath];
  const mockAuthModule = new Module(authModulePath);
  mockAuthModule.filename = authModulePath;
  mockAuthModule.loaded = true;
  mockAuthModule.exports = {
    authenticateToken: (_req, _res, next) => next(),
    requireStaff: (_req, _res, next) => next()
  };
  require.cache[authModulePath] = mockAuthModule;
  delete require.cache[require.resolve('../src/routes/ocr')];
  const router = require('../src/routes/ocr');
  const route = router.stack.find((layer) => layer.route?.path === '/ocr/passport').route;
  return {
    handler: route.stack[route.stack.length - 1].handle,
    healthHandler: router.stack.find((layer) => layer.route?.path === '/ocr/health').route.stack.at(-1).handle,
    authModulePath,
    originalAuthModule
  };
}

async function postImage(handler, orientation, requestBody) {
  let imageSharp = sharp({
    create: { width: 400, height: 600, channels: 3, background: '#eeeeee' }
  });
  if (orientation) imageSharp = imageSharp.withMetadata({ orientation });
  const image = await imageSharp.png().toBuffer();
  let statusCode = 200;
  let body;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    }
  };
  await handler({ file: { buffer: image }, body: requestBody }, response);
  return { statusCode, body };
}

test('local OCR client posts multipart images only to loopback', async (t) => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.LOCAL_PADDLE_OCR_URL;
  let requestUrl;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = String(url);
    requestOptions = options;
    return {
      ok: true,
      async json() {
        return {
          lines: [{
            text: 'الاسم الشخصي: أحمد',
            confidence: 0.94,
            bounds: { left: 0.1, top: 0.2, width: 0.5, height: 0.03 }
          }],
          crop_lines: []
        };
      }
    };
  };
  process.env.LOCAL_PADDLE_OCR_URL = 'http://127.0.0.1:8765/ocr';
  t.after(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.LOCAL_PADDLE_OCR_URL;
    else process.env.LOCAL_PADDLE_OCR_URL = originalUrl;
  });

  const result = await pythonOcrService.recognizePassport({
    imageBuffer: Buffer.from('image bytes'),
    cropBuffer: Buffer.from('crop bytes')
  });
  assert.equal(requestUrl, 'http://127.0.0.1:8765/ocr');
  assert.equal(requestOptions.method, 'POST');
  assert.ok(requestOptions.body instanceof FormData);
  assert.equal(requestOptions.body.get('image').name, 'passport.jpg');
  assert.equal(requestOptions.body.get('crop').name, 'passport-name-region.jpg');
  assert.equal(result.lines[0].confidence, 0.94);
});

test('local OCR client rejects non-loopback endpoints and times out', async (t) => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.LOCAL_PADDLE_OCR_URL;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.LOCAL_PADDLE_OCR_URL;
    else process.env.LOCAL_PADDLE_OCR_URL = originalUrl;
  });

  process.env.LOCAL_PADDLE_OCR_URL = 'https://example.com/ocr';
  await assert.rejects(
    pythonOcrService.recognizePassport({ imageBuffer: Buffer.from('image') }),
    /loopback only/
  );

  process.env.LOCAL_PADDLE_OCR_URL = 'http://127.0.0.1:8765/ocr';
  global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(
    pythonOcrService.recognizePassport({
      imageBuffer: Buffer.from('image'),
      timeoutMs: 10
    }),
    /timed out after 10ms/
  );
});

test('MRZ filler stays a separator and never becomes the letter L', () => {
  const rawLines = buildMrz({ surname: 'DOE<AL<HASSAN', givenNames: 'JOHN<PAUL' });
  const lines = extraction.sanitizeMrzLines(rawLines.join('\n'));
  const parsed = extraction.parseMrz(lines);

  assert.equal(lines[0].includes('<<'), true);
  assert.equal(parsed.last_name_en, 'DOE AL HASSAN');
  assert.equal(parsed.first_name_en, 'JOHN PAUL');
  assert.equal(parsed.father_name_en, '');
  assert.equal(parsed.last_name_en.includes('LL'), false);
  assert.equal(lines[0].includes('LL'), false);
});

test('MRZ fields with invalid dates or document numbers are rejected for review', () => {
  const invalidDate = extraction.parseMrz(buildMrz({ expiryDate: '301332' }));
  const invalidNumber = extraction.parseMrz(buildMrz({ documentNumber: '<<<<<<<<<' }));

  assert.equal(invalidDate.passport_expiry_date, null);
  assert.equal(invalidNumber, null);
});

test('MRZ parser rejects check-digit failures and invalid characters without autocorrection', () => {
  const [line1, line2] = buildMrz();
  const invalidCheck = line2.slice(0, 9) + (line2[9] === '9' ? '0' : '9') + line2.slice(10);
  assert.equal(extraction.parseMrz([line1, invalidCheck]), null);
  assert.equal(extraction.parseMrz([line1.replace('<<', 'LL'), line2]), null);
  assert.equal(extraction.parseMrz([line1, line2.replace('<', 'L')]), null);
});

test('printed name fields preserve Arabic compounds and independently labeled English fields', () => {
  const merged = extraction.mergePassportSources({ lines: passportReadLines() }, null);

  assert.equal(merged.data.first_name_ar, 'عبد الرحمن نور الدين');
  assert.equal(merged.data.father_name_ar, 'محمد أمين');
  assert.equal(merged.data.last_name_ar, 'آل الحسن');
  assert.equal(merged.data.first_name_en, 'JOHN PAUL');
  assert.equal(merged.data.father_name_en, 'MICHAEL JAMES');
  assert.equal(merged.data.last_name_en, 'DOE AL HASSAN');
  assert.deepEqual(merged.reviewFields, []);
});

test('name values in another column are not assigned to a nearby label', () => {
  const merged = extraction.mergePassportSources({
    lines: [
      {
        ...nameLine('اسم الأب', 0.96, 0.4),
        bounds: { left: 0.78, top: 0.4, width: 0.12, height: 0.025 }
      },
      {
        ...nameLine('محمد أمين', 0.96, 0.4),
        bounds: { left: 0.08, top: 0.4, width: 0.2, height: 0.025 }
      }
    ]
  }, null);

  assert.equal(merged.data.father_name_ar, '');
  assert.equal(merged.reviewFields.includes('father_name_ar'), true);
});

test('missing printed father field is empty and is never inferred from MRZ', () => {
  const withoutFather = passportReadLines().filter((line) =>
    !line.text.includes('اسم الأب') &&
    !line.text.includes("FATHER'S NAME") &&
    !line.text.includes('FIRST NAME')
  );
  const merged = extraction.mergePassportSources(
    { lines: withoutFather },
    extraction.parseMrz(buildMrz({ givenNames: 'JOHN<PAUL<MICHAEL' }))
  );

  assert.equal(merged.data.father_name_en, '');
  assert.equal(merged.data.first_name_en, 'JOHN PAUL MICHAEL');
  assert.equal(merged.reviewFields.includes('father_name_en'), true);
});

test('low confidence, repeated-letter, and mixed-script values are rejected', () => {
  const lines = [
    nameLine('الاسم الشخصي: أحمد', 0.2),
    nameLine('اسم الأب: مخلطABC'),
    nameLine('الشهرة: حسسسن')
  ];
  const merged = extraction.mergePassportSources({ lines }, null);

  assert.equal(merged.data.first_name_ar, '');
  assert.equal(merged.data.father_name_ar, '');
  assert.equal(extraction.validateName('LLLLLLLLLLL', 'english'), '');
  assert.equal(extraction.validateName('<<<<<', 'english'), '');
});

test('MRZ-only fields keep printed and independently sourced names empty rather than fabricated', () => {
  const parsed = extraction.parseMrz(buildMrz());
  const merged = extraction.mergePassportSources(null, parsed);

  assert.equal(merged.data.first_name_en, 'JOHN PAUL');
  assert.equal(merged.data.last_name_en, 'DOE AL HASSAN');
  assert.equal(merged.data.father_name_en, '');
  assert.equal(merged.data.first_name_ar, '');
  assert.equal(merged.data.father_name_ar, '');
  assert.equal(merged.data.last_name_ar, '');
});

test('Tesseract fills missing fields but cannot override PaddleOCR fields', () => {
  const merged = extraction.mergePassportSources(
    {
      lines: [
        nameLine('الاسم الشخصي: ليلى', 0.96),
        nameLine('SURNAME: HASSAN', 0.96)
      ]
    },
    extraction.parseMrz(buildMrz()),
    { lines: localLines() }
  );

  assert.equal(merged.data.first_name_ar, 'ليلى');
  assert.equal(merged.sources.first_name_ar, 'paddleocr');
  assert.equal(merged.data.father_name_en, 'LOCAL PARENT');
  assert.equal(merged.sources.father_name_en, 'tesseract');
  assert.equal(merged.data.last_name_en, 'HASSAN');
  assert.equal(merged.confidence.first_name_ar, 0.96);
  assert.equal(merged.confidence.father_name_en, 0.95);
  assert.equal(merged.confidence.first_name_en, null);
});

test('route returns PaddleOCR fields and does not treat MRZ-only results as Arabic OCR', async (t) => {
  mockMrz = buildMrz();
  mockArabicLines = [];
  mockEnglishLines = [];
  paddleLines = [
    nameLine('FIRST NAME: JOHN PAUL', 0.65),
    nameLine('FATHER NAME: MICHAEL JAMES'),
    nameLine('SURNAME: DOE AL HASSAN')
  ];
  paddleCropLines = [];
  paddleError = null;
  paddleImageDimensions = null;
  paddleCropDimensions = null;
  const route = setupRoute();
  t.after(() => {
    pythonOcrService.recognizePassport = originalRecognizePassport;
    tesseract.createWorker = originalCreateWorker;
    delete require.cache[require.resolve('../src/routes/ocr')];
    if (route.originalAuthModule) require.cache[route.authModulePath] = route.originalAuthModule;
    else delete require.cache[route.authModulePath];
  });

  const result = await postImage(route.handler, 6);
  assert.equal(result.statusCode, 200);
  assert.equal(paddleImageDimensions.width, 600);
  assert.equal(paddleImageDimensions.height, 400);
  assert.equal(result.body.success, true);
  assert.equal(result.body.arabic_ocr_success, false);
  assert.equal(result.body.data.first_name_en, 'JOHN PAUL');
  assert.equal(result.body.data.father_name_en, 'MICHAEL JAMES');
  assert.equal(result.body.data.last_name_en, 'DOE AL HASSAN');
  assert.equal(result.body.data.first_name_ar, '');
  assert.equal(result.body.field_confidence.first_name_en, 0.65);
  assert.deepEqual(result.body.review_fields, [
    'first_name_ar', 'father_name_ar', 'last_name_ar', 'first_name_en'
  ]);
  assert.equal(result.body.extraction_sources.first_name_en, 'paddleocr');
  assert.equal(result.body.raw_ocr.paddleocr.length, 3);
});

test('route retries a detected personal-information region with an enhanced crop', async (t) => {
  mockMrz = buildMrz();
  mockArabicLines = [];
  mockEnglishLines = [];
  paddleLines = [
    nameLine('الاسم الشخصي', 0.93, 0.34),
    nameLine('اسم الأب', 0.93, 0.42),
    nameLine('الشهرة', 0.93, 0.5)
  ];
  paddleCropLines = [
    nameLine('الاسم الشخصي: عبد الرحمن نور الدين', 0.96),
    nameLine('اسم الأب: محمد أمين', 0.95),
    nameLine('الشهرة: آل الحسن', 0.94)
  ];
  paddleError = null;
  paddleCropDimensions = null;
  const route = setupRoute();
  t.after(() => {
    pythonOcrService.recognizePassport = originalRecognizePassport;
    tesseract.createWorker = originalCreateWorker;
    delete require.cache[require.resolve('../src/routes/ocr')];
    if (route.originalAuthModule) require.cache[route.authModulePath] = route.originalAuthModule;
    else delete require.cache[route.authModulePath];
  });

  const result = await postImage(route.handler);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.arabic_ocr_success, true);
  assert.equal(result.body.data.first_name_ar, 'عبد الرحمن نور الدين');
  assert.equal(result.body.data.father_name_ar, 'محمد أمين');
  assert.equal(result.body.data.last_name_ar, 'آل الحسن');
  assert.ok(paddleCropDimensions.height / paddleCropDimensions.width < 600 / 400);
  assert.equal(paddleCropDimensions.width, 1400);
  assert.equal(result.body.raw_ocr.paddleocr_crop.length, 3);
});

test('route falls back to Tesseract and MRZ when the Python service is unavailable', async (t) => {
  mockMrz = buildMrz();
  mockArabicLines = [nameLine('الاسم الشخصي: نور الدين', 0.94)];
  mockEnglishLines = [nameLine("FATHER'S NAME: SAMIR AMIN", 0.96)];
  paddleLines = [];
  paddleCropLines = [];
  paddleError = new Error('ECONNREFUSED');
  const route = setupRoute();
  t.after(() => {
    pythonOcrService.recognizePassport = originalRecognizePassport;
    tesseract.createWorker = originalCreateWorker;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    delete require.cache[require.resolve('../src/routes/ocr')];
    if (route.originalAuthModule) require.cache[route.authModulePath] = route.originalAuthModule;
    else delete require.cache[route.authModulePath];
  });

  process.env.NODE_ENV = 'development';
  const developmentResult = await postImage(route.handler);
  assert.equal(developmentResult.statusCode, 200);
  assert.equal(developmentResult.body.data.first_name_ar, 'نور الدين');
  assert.equal(developmentResult.body.data.father_name_en, 'SAMIR AMIN');
  assert.equal(developmentResult.body.data.father_name_en === developmentResult.body.data.first_name_en, false);
  assert.equal(developmentResult.body.extraction_sources.first_name_ar, 'tesseract');
  assert.match(developmentResult.body.warning, /PaddleOCR المحلية غير متاحة/);
  assert.match(developmentResult.body.warning, /PADDLE_OCR_ECONNREFUSED/);

  process.env.NODE_ENV = 'production';
  const productionResult = await postImage(route.handler);
  assert.equal(productionResult.statusCode, 200);
  assert.match(productionResult.body.warning, /PaddleOCR المحلية غير متاحة/);
  assert.doesNotMatch(productionResult.body.warning, /PADDLE_OCR_ECONNREFUSED/);
});

test('MRZ diagnostics report which ICAO checks fail', () => {
  const valid = extraction.sanitizeMrzLines(buildMrz().join('\n'));
  assert.equal(extraction.mrzDiagnostics(valid).valid, true);

  const [line1, line2] = buildMrz();
  const broken = [line1, line2.slice(0, 9) + (line2[9] === '9' ? '0' : '9') + line2.slice(10)];
  const diagnostics = extraction.mrzDiagnostics(broken);
  assert.equal(diagnostics.valid, false);
  assert.ok(diagnostics.failures.includes('document_number_check'));
  assert.equal(extraction.isValidMrz(broken), false);
});

test('document fields are extracted from bilingual passport labels', () => {
  const lines = [
    nameLine('PASSPORT NO: A1234567', 0.95),
    nameLine('DATE OF BIRTH: 01/02/1990', 0.95),
    nameLine('EXPIRY DATE: 2030-05-06', 0.95),
    nameLine('NATIONALITY: SYR', 0.95),
    nameLine('SEX: M', 0.95),
    nameLine('PLACE OF BIRTH: DAMASCUS', 0.95),
    nameLine('PLACE OF ISSUE: DAMASCUS', 0.95)
  ];
  const merged = extraction.mergePassportSources({ lines }, null, null);

  assert.equal(merged.data.passport_number, 'A1234567');
  assert.equal(merged.data.date_of_birth, '1990-02-01');
  assert.equal(merged.data.passport_expiry_date, '2030-05-06');
  assert.equal(merged.data.nationality, 'SYR');
  assert.equal(merged.data.gender, 'M');
  assert.equal(merged.data.place_of_birth, 'DAMASCUS');
  assert.equal(merged.data.place_of_issue, 'DAMASCUS');
  assert.equal(merged.data.issuing_authority, null);
  assert.equal(merged.sources.passport_number, 'paddleocr');
});

test('visual MRZ conflicts are reported and MRZ wins for validated fields', () => {
  const mrzData = extraction.parseMrz(buildMrz({ documentNumber: 'A12345678' }));
  const lines = [nameLine('PASSPORT NO: B9999999', 0.95)];
  const merged = extraction.mergePassportSources({ lines }, mrzData, null);

  assert.equal(merged.data.passport_number, 'A12345678');
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].field, 'passport_number');
  assert.equal(merged.conflicts[0].visual.value, 'B9999999');
  assert.equal(merged.contract.status, 'needs_review');
  assert.equal(merged.contract.requiresHumanReview, true);
  assert.ok(merged.contract.warnings.some((w) => w.code === 'source_conflict'));
  assert.equal(merged.contract.fields.passport_number.validated, true);
  assert.equal(merged.contract.fields.passport_number.source, 'mrz');
  assert.equal(merged.contract.fields.passport_number.alternatives.length, 2);
});

test('agreeing engines mark fields validated in the OCR contract', () => {
  const mrzData = extraction.parseMrz(buildMrz());
  const primary = [nameLine('PASSPORT NO: N12345678', 0.95)];
  const fallback = [nameLine('PASSPORT NO: N12345678', 0.9)];
  const merged = extraction.mergePassportSources({ lines: primary }, mrzData, { lines: fallback });

  assert.equal(merged.data.passport_number, mrzData.passport_number);
  assert.equal(merged.contract.fields.passport_number.validated, true);
  assert.equal(merged.contract.fields.date_of_birth.source, 'mrz');
  assert.equal(merged.contract.fields.date_of_birth.confidence !== null, true);
});

test('route rejects files without a valid image signature', async (t) => {
  const route = setupRoute();
  t.after(() => {
    pythonOcrService.recognizePassport = originalRecognizePassport;
    tesseract.createWorker = originalCreateWorker;
    delete require.cache[require.resolve('../src/routes/ocr')];
    if (route.originalAuthModule) require.cache[route.authModulePath] = route.originalAuthModule;
    else delete require.cache[route.authModulePath];
  });

  let statusCode = 200;
  let body;
  const response = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; }
  };
  await route.handler({ file: { buffer: Buffer.from('this is not an image at all') } }, response);
  assert.equal(statusCode, 400);
  assert.match(body.error, /غير مدعومة/);
});

test('route returns the OCR contract with per-field confidence', async (t) => {
  mockMrz = buildMrz();
  mockArabicLines = [];
  mockEnglishLines = [];
  paddleLines = [nameLine('PASSPORT NO: N12345678', 0.95)];
  paddleCropLines = [];
  paddleError = null;
  const route = setupRoute();
  t.after(() => {
    pythonOcrService.recognizePassport = originalRecognizePassport;
    tesseract.createWorker = originalCreateWorker;
    delete require.cache[require.resolve('../src/routes/ocr')];
    if (route.originalAuthModule) require.cache[route.authModulePath] = route.originalAuthModule;
    else delete require.cache[route.authModulePath];
  });

  const result = await postImage(route.handler);
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.ocr_contract);
  assert.ok(result.body.ocr_contract.fields.passport_number);
  assert.equal(result.body.ocr_contract.fields.passport_number.source, 'mrz');
  assert.equal(typeof result.body.ocr_contract.status, 'string');
  assert.ok(Array.isArray(result.body.ocr_contract.warnings));
});

test('MRZ repair recovers check-digit-validated reads with I/1 confusions', () => {
  const [line1, line2] = buildMrz({ birthDate: '900102' });
  // Simulate real Tesseract confusion: 1->I inside the birth-date digits
  const confused = line2.replace('900102', '900I02');
  const strict = extraction.sanitizeMrzLines(`${line1}\n${confused}`);
  assert.equal(strict.length, 0);

  const parsed = extraction.parseMrzText(`${line1}\n${confused}`);
  assert.ok(parsed.data, 'repaired MRZ should parse');
  assert.equal(parsed.repaired, true);
  assert.equal(parsed.data.passport_number, 'N12345678');
  assert.equal(parsed.data.date_of_birth, '1990-01-02');
  assert.equal(parsed.data.last_name_en, 'DOE AL HASSAN');
});

test('MRZ repair never accepts candidates that fail ICAO check digits', () => {
  const [line1, line2] = buildMrz({ birthDate: '900102' });
  // Corrupt a check digit itself: no repair can validate this
  const broken = line2.slice(0, 9) + (line2[9] === '9' ? '0' : '9') + line2.slice(10);
  const parsed = extraction.parseMrzText(`${line1}\n${broken}`);
  assert.equal(parsed.data, null);
  assert.ok(parsed.diagnostics);
  assert.equal(parsed.diagnostics.valid, false);
});

test('route still returns MRZ fields when Tesseract MRZ text has char confusions', async (t) => {
  const [line1, line2] = buildMrz({ birthDate: '900102' });
  mockMrz = [line1, line2.replace('900102', '900I02')];
  mockArabicLines = [];
  mockEnglishLines = [];
  paddleLines = [];
  paddleCropLines = [];
  paddleError = new Error('ECONNREFUSED');
  const route = setupRoute();
  t.after(() => {
    pythonOcrService.recognizePassport = originalRecognizePassport;
    tesseract.createWorker = originalCreateWorker;
    delete require.cache[require.resolve('../src/routes/ocr')];
    if (route.originalAuthModule) require.cache[route.authModulePath] = route.originalAuthModule;
    else delete require.cache[route.authModulePath];
  });

  const result = await postImage(route.handler);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.data.passport_number, 'N12345678');
  assert.equal(result.body.data.date_of_birth, '1990-01-02');
  assert.equal(result.body.data.last_name_en, 'DOE AL HASSAN');
  assert.equal(result.body.data.nationality, 'SYR');
  assert.equal(result.body.data.gender, 'M');
  assert.ok(result.body.ocr_contract.fields.passport_number.validated);
});

function prepareOcrRoute(t) {
  mockMrz = buildMrz();
  mockArabicLines = [];
  mockEnglishLines = [];
  paddleLines = passportReadLines();
  paddleCropLines = [];
  paddleError = null;
  const route = setupRoute();
  t.after(() => {
    pythonOcrService.recognizePassport = originalRecognizePassport;
    tesseract.createWorker = originalCreateWorker;
    delete require.cache[require.resolve('../src/routes/ocr')];
    if (route.originalAuthModule) require.cache[route.authModulePath] = route.originalAuthModule;
    else delete require.cache[route.authModulePath];
  });
  return route;
}

test('fallback returns a failed scan when only expiry and corrupted place text are found', async (t) => {
  const route = prepareOcrRoute(t);
  mockMrz = [];
  paddleLines = [];
  paddleError = new Error('ECONNREFUSED');
  mockEnglishLines = [nameLine('EXPIRY DATE: 2030-05-06', 0.72)];
  mockArabicLines = [nameLine('مكان الإصدار: مروة[ )مما', 0.96)];
  const result = await postImage(route.handler, undefined, { gemini_assist: 'false' });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.success, false);
  assert.equal(result.body.ocr_contract.status, 'failed');
  assert.equal(result.body.data.place_of_issue, null);
  assert.equal(result.body.data.passport_expiry_date, '2030-05-06');
  assert.match(result.body.warning, /لم يتمكن النظام من قراءة الاسم أو رقم الجواز/);
});

test('default and explicit local modes never send data to cloud, even with the legacy assistance flag', async (t) => {
  const route = prepareOcrRoute(t);
  const networkSpy = t.mock.method(global, 'fetch', async () => { throw new Error('Unexpected network call in local mode'); });
  const cloudSpy = t.mock.method(cloudOcrService, 'recognizePassport', async () => { throw new Error('Cloud must not be called'); });
  for (const body of [undefined, { mode: 'local', gemini_assist: 'true' }]) {
    const result = await postImage(route.handler, undefined, body);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.mode, 'local');
    assert.equal(result.body.data.first_name_ar, 'عبد الرحمن نور الدين');
  }
  assert.equal(cloudSpy.mock.callCount(), 0);
  assert.equal(networkSpy.mock.callCount(), 0);
});

test('OCR health exposes cloud readiness without credentials and checks the local health payload', async (t) => {
  const route = prepareOcrRoute(t);
  t.mock.method(cloudOcrService, 'getConfiguration', () => ({ status: 'api_key_missing', provider: 'gemini', model: 'gemini-3.6-flash' }));
  t.mock.method(global, 'fetch', async (url) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:8765\/health$/);
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  });
  let body;
  await route.healthHandler({}, { json(value) { body = value; } });
  assert.equal(body.modes.cloud.status, 'api_key_missing');
  assert.equal(body.modes.local.status, 'available');
  assert.equal(body.engines.paddleocr, 'unhealthy');
  assert.match(body.modes.cloud.message, /مفتاح Gemini/);
  assert.doesNotMatch(JSON.stringify(body), /GEMINI_API_KEY|apiKey/);
});

function cloudExtraction(overrides = {}) {
  const fields = cloudOcrService.emptyFields();
  Object.assign(fields, {
    first_name_ar: { value: 'أحمد', readability: 'clear', label: 'الاسم' },
    first_name_en: { value: 'AHMAD', readability: 'clear', label: 'FIRST NAME' },
    passport_number: { value: 'N12345678', readability: 'clear', label: 'PASSPORT NO' }
  }, overrides);
  return cloudOcrService.parsePassportResponse({ status: 'completed', steps: [
    { type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ fields, mrz_lines: [] }) }] }
  ] });
}

function prepareCloudRoute(t) {
  const route = prepareOcrRoute(t);
  t.mock.method(cloudOcrService, 'getConfiguration', () => ({ status: 'configured', provider: 'gemini', model: 'gemini-3.6-flash' }));
  pythonOcrService.recognizePassport = async () => { throw new Error('Cloud scans must bypass PaddleOCR'); };
  tesseract.createWorker = async () => { throw new Error('Cloud scans must bypass Tesseract'); };
  return route;
}

test('cloud mode reads the full prepared page once without depending on local OCR', async (t) => {
  const route = prepareCloudRoute(t);
  const cloudSpy = t.mock.method(cloudOcrService, 'recognizePassport', async ({ imageBuffer, signal }) => {
    assert.equal((await sharp(imageBuffer).metadata()).format, 'jpeg');
    assert.equal(signal.aborted, false);
    return { extraction: cloudExtraction(), model: 'gemini-3.6-flash', diagnostics: {} };
  });
  const result = await postImage(route.handler, undefined, { mode: 'cloud' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.mode, 'cloud');
  assert.equal(result.body.provider, 'GEMINI_CLOUD');
  assert.equal(result.body.data.first_name_ar, 'أحمد');
  assert.equal(result.body.data.passport_number, 'N12345678');
  assert.equal(result.body.extraction_sources.first_name_ar, 'gemini');
  assert.equal(result.body.field_confidence.first_name_ar, null);
  assert.equal(result.body.ocr_contract.fields.first_name_ar.validated, false);
  assert.ok(result.body.review_fields.includes('first_name_ar'));
  assert.equal(cloudSpy.mock.callCount(), 1);
});

test('invalid modes and unavailable cloud configuration never invoke a provider', async (t) => {
  const route = prepareCloudRoute(t);
  const cloudSpy = t.mock.method(cloudOcrService, 'recognizePassport', async () => { throw new Error('Provider must not be called'); });
  let result = await postImage(route.handler, undefined, { mode: 'automatic' });
  assert.equal(result.statusCode, 400);
  cloudOcrService.getConfiguration = () => ({ status: 'api_key_missing' });
  result = await postImage(route.handler, undefined, { mode: 'cloud' });
  assert.equal(result.statusCode, 503);
  assert.match(result.body.error, /مفتاح Gemini/);
  assert.equal(cloudSpy.mock.callCount(), 0);
});

test('cloud quota and timeout failures are explicit and do not switch engines or expose errors', async (t) => {
  const route = prepareCloudRoute(t);
  let code;
  const cloudSpy = t.mock.method(cloudOcrService, 'recognizePassport', async () => {
    throw Object.assign(new Error('private provider details and secret API key'), { code });
  });
  for (const [errorCode, status] of [['GEMINI_OCR_HTTP_429', 429], ['GEMINI_OCR_TIMEOUT', 504], ['GEMINI_OCR_HTTP_403', 502]]) {
    code = errorCode;
    const result = await postImage(route.handler, undefined, { mode: 'cloud' });
    assert.equal(result.statusCode, status);
    assert.equal(result.body.success, false);
    assert.equal(result.body.mode, 'cloud');
    assert.doesNotMatch(JSON.stringify(result.body), /private provider|secret API key/);
  }
  assert.equal(cloudSpy.mock.callCount(), 3);
});

test('a cloud scan with no identity fields fails without populating the form', async (t) => {
  const route = prepareCloudRoute(t);
  t.mock.method(cloudOcrService, 'recognizePassport', async () => ({ extraction: cloudExtraction({
    first_name_ar: { value: null, readability: 'unreadable', label: null },
    first_name_en: { value: null, readability: 'unreadable', label: null },
    passport_number: { value: null, readability: 'unreadable', label: null }
  }), diagnostics: {} }));
  const result = await postImage(route.handler, undefined, { mode: 'cloud' });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.ocr_contract.status, 'failed');
  assert.equal(result.body.success, false);
});
