const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const multer = require('multer');
const sharp = require('sharp');
const { createWorker, OEM, PSM } = require('tesseract.js');
const pythonOcrService = require('../services/ocr/python-ocr-service');
const { getLocalOcrStatus, waitForLocalOcrService } = require('../services/ocr/service-lifecycle');
const { orientFallbackPassport } = require('../services/ocr/fallback-orientation');
const cloudOcrService = require('../services/ocr/gemini-passport-service');
const { normalizeTesseractLines, recognizeSerialized } = require('../services/ocr/tesseract-utils');
const { rasterizePassportPdf } = require('../services/ocr/pdf-input');
const {
  buildOcrContract,
  emptyPassportData,
  hasPassportIdentity,
  mergePassportSources,
  parseMrzText
} = require('../services/ocr/passport-extraction');
const { authenticateToken, requireStaff } = require('../auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 }
});

const OCR_CACHE_DIR = process.env.TESSERACT_CACHE_DIR || path.join(os.tmpdir(), 'tesseract-cache');
const BEST_MODEL_DIR = process.env.TESSERACT_LANG_PATH || path.join(__dirname, '..', 'ocr-service', 'models', 'tessdata_best');
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_ANALYSIS_WIDTH = 2600;
const MIN_IMAGE_DIMENSION = 120;
const MRZ_ROI_TOP_RATIOS = [0.70, 0.55];
const MRZ_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';
const PADDLE_OCR_TIMEOUT_MS = Number(process.env.LOCAL_PADDLE_OCR_TIMEOUT_MS) || 90_000;
const OCR_MAX_CONCURRENT = Math.max(1, Number(process.env.OCR_MAX_CONCURRENT) || 1);
const OCR_RATE_LIMIT = Math.max(1, Number(process.env.OCR_RATE_LIMIT_PER_MINUTE) || 12);
const BLUR_EDGE_THRESHOLD = Number(process.env.OCR_BLUR_EDGE_THRESHOLD) || 6;

let mrzWorkerPromise;
let arabicWorkerPromise;
let englishWorkerPromise;
let ocrInFlight = 0;
const ocrRateBuckets = new Map();
let paddleHealthCache = { checkedAt: 0, status: 'unknown' };

function getWorker(language, configure) {
  return (async () => {
    await fs.promises.mkdir(OCR_CACHE_DIR, { recursive: true });
    const bestModel = fs.existsSync(path.join(BEST_MODEL_DIR, `${language}.traineddata`));
    const worker = await createWorker(language, OEM.LSTM_ONLY, {
      cachePath: bestModel ? path.join(OCR_CACHE_DIR, 'best') : OCR_CACHE_DIR,
      errorHandler: () => {}, // Recognition promises reject; do not crash the API.
      ...(bestModel && { langPath: BEST_MODEL_DIR, gzip: false,
        workerPath: require.resolve('../services/ocr/tesseract-best-worker.cjs') })
    });
    if (configure) await configure(worker);
    return worker;
  })();
}

function getMrzWorker() {
  if (!mrzWorkerPromise) {
    mrzWorkerPromise = getWorker('eng', (worker) => worker.setParameters({
      tessedit_char_whitelist: MRZ_WHITELIST,
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK
    })).catch((error) => {
      mrzWorkerPromise = undefined;
      throw error;
    });
  }
  return mrzWorkerPromise;
}

function getArabicWorker() {
  if (!arabicWorkerPromise) {
    arabicWorkerPromise = getWorker('ara', (worker) =>
      worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    ).catch((error) => {
      arabicWorkerPromise = undefined;
      throw error;
    });
  }
  return arabicWorkerPromise;
}

function getEnglishWorker() {
  if (!englishWorkerPromise) {
    englishWorkerPromise = getWorker('eng', (worker) =>
      worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    ).catch((error) => {
      englishWorkerPromise = undefined;
      throw error;
    });
  }
  return englishWorkerPromise;
}

async function runLocalRead(imageBuffer, width, height, arabicCropBounds, initialEnglishResult) {
  const [arabicResult, englishResult] = await Promise.allSettled([
    getArabicWorker().then((worker) => recognizeSerialized(worker, imageBuffer, { tessedit_pageseg_mode: PSM.AUTO })),
    initialEnglishResult ? Promise.resolve(initialEnglishResult) :
      getEnglishWorker().then((worker) => recognizeSerialized(worker, imageBuffer, { tessedit_pageseg_mode: PSM.AUTO }))
  ]);
  const lines = [
    ...normalizeTesseractLines(arabicResult.value, width, height, 'tesseract-arabic'),
    ...normalizeTesseractLines(englishResult.value, width, height, 'tesseract-english')
  ];
  const preliminary = mergePassportSources({ lines }, null, null, 'tesseract');
  const missingArabicNames = ['first_name_ar', 'father_name_ar', 'last_name_ar'].some((field) => !preliminary.data[field]);
  if (missingArabicNames) {
    try {
      const worker = await getArabicWorker();
      const sparseResult = await recognizeSerialized(worker, imageBuffer, { tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      lines.push(...normalizeTesseractLines(sparseResult, width, height, 'tesseract-arabic-sparse'));
    } catch { /* Keep the initial read if the optional retry fails. */ }
    arabicCropBounds ||= findArabicNameRegion(lines, width, height);
  }
  let cropLines = [];
  const localizedCrop = arabicCropBounds && (!missingArabicNames || arabicCropBounds.width <= width * 0.65);
  const cropRegions = localizedCrop ? [arabicCropBounds] : missingArabicNames && width >= 600 ? [
    { left: 0, top: 0, width: Math.floor(width / 2), height: Math.ceil(height * 0.8) },
    { left: Math.floor(width / 2), top: 0, width: width - Math.floor(width / 2), height: Math.ceil(height * 0.8) }
  ] : [];
  for (const [index, cropBounds] of cropRegions.entries()) {
    try {
      // Separate columns prevent Latin text and the portrait from merging into
      // Arabic field rows. Values still require their own visible field label.
      const crop = await sharp(imageBuffer).extract(cropBounds)
        .resize({ width: 1200, withoutEnlargement: false }).normalize().png().toBuffer();
      const metadata = await sharp(crop).metadata();
      const worker = await getArabicWorker();
      const result = await recognizeSerialized(worker, crop, { tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      cropLines.push(...mapCropLines(normalizeTesseractLines(result, metadata.width, metadata.height,
        `tesseract-arabic-names-${index}`), cropBounds, width, height));
    } catch { /* Other independent reads remain usable. */ }
  }
  return {
    lines: [
      ...lines,
      ...cropLines
    ]
  };
}

async function runMrzRead(imageBuffer, width, height) {
  const worker = await getMrzWorker();
  const parsedAttempts = [];
  let candidateLines = [];
  let diagnostics = null;
  let lineLengths = [];
  let nameStructureValid = false;

  for (const topRatio of MRZ_ROI_TOP_RATIOS) {
    const top = Math.floor(height * topRatio);
    const crop = await sharp(imageBuffer)
      .extract({ left: 0, top, width, height: height - top })
      .resize({ width: 2800, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.4 })
      .png()
      .toBuffer();
    const raw = await recognizeSerialized(worker, crop, {}, { text: true });
    const parsed = parseMrzText(raw?.data?.text);
    if (!parsed.lines.length) continue;
    candidateLines = parsed.lines;
    lineLengths = parsed.lines.map((line) => line.length);
    diagnostics = parsed.diagnostics;
    nameStructureValid ||= Boolean(parsed.diagnostics?.valid);
    if (parsed.data) {
      parsedAttempts.push({ ...parsed.data, __repaired: parsed.repaired, __namesValid: !parsed.partial });
    }
  }

  const complete = parsedAttempts.filter((entry) => entry.__namesValid);
  const selected = complete.length ? complete : parsedAttempts;
  const distinct = new Map(selected.map((entry) => {
    const { __repaired, __namesValid, ...rest } = entry;
    return [JSON.stringify(rest), entry];
  }));
  const firstAttempt = selected[0] || null;
  const data = firstAttempt ? (({ __repaired, __namesValid, ...rest }) => rest)(firstAttempt) : null;
  return {
    data,
    valid: parsedAttempts.length > 0,
    attempts: selected.length,
    consistent: distinct.size <= 1,
    repaired: parsedAttempts.some((entry) => entry.__repaired),
    candidateLines,
    diagnostics,
    lineLengths,
    nameStructureValid
  };
}

function extractMrzFromReadResult(readResult) {
  const groups = new Map();
  for (const line of readResult?.lines || []) {
    const key = line.passId || 'default';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line.text);
  }
  const attempts = [...groups.values()].map((lines) => parseMrzText(lines.join('\n'))).filter((entry) => entry.data);
  const complete = attempts.filter((entry) => !entry.partial);
  const selected = complete.length ? complete : attempts;
  const distinct = new Set(selected.map((entry) => JSON.stringify(entry.data)));
  return { data: selected[0]?.data || null, partial: Boolean(selected[0]?.partial), consistent: distinct.size <= 1, attempts: selected.length,
    repaired: attempts.some((entry) => entry.repaired) };
}

function findNameRegion(lines, imageWidth, imageHeight) {
  const labelPattern = /(?:الاسم|اسم\s*(?:الأب|الاب)|الشهرة|النسبة|الكنية|FIRST\s*NAME|GIVEN\s*NAME|FATHER(?:'S)?\s*NAME|SURNAME|FAMILY\s*NAME|LAST\s*NAME|^NAME\b)/iu;
  const anchors = lines.filter((line) => line.bounds &&
    labelPattern.test(line.text || ''));
  if (!anchors.length) return null;

  const minTop = Math.min(...anchors.map((line) => line.bounds.top));
  const maxBottom = Math.max(...anchors.map((line) =>
    line.bounds.top + line.bounds.height
  ));
  const maxLineHeight = Math.max(...anchors.map((line) => line.bounds.height));
  const padding = Math.max(0.025, Math.min(0.06, maxLineHeight * 1.25));
  let top = Math.max(0, Math.floor((minTop - padding) * imageHeight));
  let bottom = Math.min(imageHeight, Math.ceil((maxBottom + padding) * imageHeight));
  const minimumHeight = Math.min(imageHeight, Math.round(imageHeight * 0.14));
  if (bottom - top < minimumHeight) {
    const center = (top + bottom) / 2;
    top = Math.max(0, Math.floor(center - minimumHeight / 2));
    bottom = Math.min(imageHeight, top + minimumHeight);
    top = Math.max(0, bottom - minimumHeight);
  }
  if (bottom <= top) return null;
  return { left: 0, top, width: imageWidth, height: bottom - top };
}

function findArabicNameRegion(lines, width, height) {
  const nameBounds = findNameRegion(lines, width, height);
  if (!nameBounds) return null;
  const arabic = lines.filter((line) => line.bounds && /[\u0621-\u064A]/u.test(line.text) && !/[A-Za-z]/u.test(line.text) &&
    line.bounds.top * height >= nameBounds.top &&
    (line.bounds.top + line.bounds.height) * height <= nameBounds.top + nameBounds.height);
  if (!arabic.length) return null;
  const left = Math.max(0, Math.floor((Math.min(...arabic.map((line) => line.bounds.left)) - 0.04) * width));
  const right = Math.min(width, Math.ceil((Math.max(...arabic.map((line) => line.bounds.left + line.bounds.width)) + 0.04) * width));
  return right > left ? { ...nameBounds, left, width: right - left } : null;
}

function mapCropLines(lines, cropBounds, imageWidth, imageHeight) {
  return lines.map((line) => ({
    ...line,
    bounds: line.bounds
      ? {
        left: (cropBounds.left + line.bounds.left * cropBounds.width) / imageWidth,
        top: (cropBounds.top + line.bounds.top * cropBounds.height) / imageHeight,
        width: line.bounds.width * cropBounds.width / imageWidth,
        height: line.bounds.height * cropBounds.height / imageHeight
      }
      : null
  }));
}

async function createEnhancedNameCrop(imageBuffer, cropBounds) {
  const targetWidth = Math.min(2600, Math.max(cropBounds.width, 1400));
  return sharp(imageBuffer)
    .extract(cropBounds)
    .resize({ width: targetWidth, withoutEnlargement: false })
    .normalize()
    .sharpen({ sigma: 0.6 })
    .jpeg({ quality: 95 })
    .toBuffer();
}

function logExtractionSummary(provider, sources, reviewFields, mrzValid) {
  if (process.env.OCR_LOG_SUMMARY === 'false') return;
  console.info(`[${provider}] Passport OCR completed`, {
    fieldsWithSources: sources,
    manualReviewFields: reviewFields,
    mrzValidated: mrzValid
  });
}

function getPaddleOcrDiagnostic(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/timed out|abort/i.test(message) || error?.name === 'AbortError') {
    return 'PADDLE_OCR_TIMEOUT';
  }

  const status = message.match(/returned HTTP (\d{3})/);
  if (status) return `PADDLE_OCR_HTTP_${status[1]}`;

  const code = error?.cause?.code || error?.code || message;
  const safeCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    'ENOTFOUND',
    'UND_ERR_CONNECT_TIMEOUT'
  ]);
  return safeCodes.has(code) ? `PADDLE_OCR_${code}` : 'PADDLE_OCR_UNAVAILABLE';
}

function getProviderWarning(warning, diagnostic) {
  if (diagnostic && process.env.NODE_ENV !== 'production') {
    return `${warning} (${diagnostic})`;
  }
  return warning;
}

function getPaddleOcrWarning(diagnostic) {
  if (diagnostic === 'PADDLE_OCR_BLOCKED_BY_POLICY') {
    return 'خدمة PaddleOCR محظورة بسياسة حماية ويندوز. يلزم اعتماد المكتبة من مسؤول الجهاز لتشغيلها؛ تُستخدم القراءة الاحتياطية حالياً.';
  }
  if (diagnostic === 'PADDLE_OCR_STARTUP_FAILED') {
    return 'تعذر تشغيل خدمة PaddleOCR المحلية؛ تُستخدم القراءة الاحتياطية. راجع إعدادات خدمة OCR.';
  }
  return 'خدمة PaddleOCR المحلية غير متاحة؛ تم استخدام القراءة الاحتياطية.';
}

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  const littleTiff = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
  const bigTiff = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
  return littleTiff || bigTiff ? 'tiff' : null;
}

async function assessImageQuality(imageBuffer) {
  try {
    const { data, info } = await sharp(imageBuffer)
      .resize({ width: 320, withoutEnlargement: true })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    let count = 0;
    for (let y = 0; y < info.height; y += 1) {
      const row = y * info.width;
      for (let x = 1; x < info.width; x += 1) {
        sum += Math.abs(data[row + x] - data[row + x - 1]);
        count += 1;
      }
    }
    const edgeEnergy = count ? sum / count : 0;
    return {
      edgeEnergy: Math.round(edgeEnergy * 100) / 100,
      lowQuality: edgeEnergy < BLUR_EDGE_THRESHOLD
    };
  } catch {
    return { edgeEnergy: null, lowQuality: false };
  }
}

function checkOcrRateLimit(req) {
  const key = String(req.user?.id || req.ip || 'anonymous');
  const now = Date.now();
  const windowMs = 60_000;
  let bucket = ocrRateBuckets.get(key);
  if (!bucket || now - bucket.resetAt > windowMs) {
    bucket = { count: 0, resetAt: now };
    ocrRateBuckets.set(key, bucket);
    if (ocrRateBuckets.size > 5000) {
      for (const [bucketKey, entry] of ocrRateBuckets) {
        if (now - entry.resetAt > windowMs) ocrRateBuckets.delete(bucketKey);
      }
    }
  }
  bucket.count += 1;
  return bucket.count <= OCR_RATE_LIMIT;
}

async function checkPaddleHealth() {
  if (Date.now() - paddleHealthCache.checkedAt < 30_000) {
    return paddleHealthCache.status;
  }
  try {
    const serviceUrl = new URL(process.env.LOCAL_PADDLE_OCR_URL || pythonOcrServiceUrl());
    const response = await fetch(new URL('/health', serviceUrl), {
      signal: AbortSignal.timeout(2500)
    });
    paddleHealthCache = {
      checkedAt: Date.now(),
      status: response.ok && (await response.json()).ok === true ? 'available' : 'unhealthy'
    };
  } catch {
    paddleHealthCache = { checkedAt: Date.now(), status: 'unavailable' };
  }
  return paddleHealthCache.status;
}

function pythonOcrServiceUrl() {
  return process.env.LOCAL_PADDLE_OCR_URL || 'http://127.0.0.1:8765/ocr';
}

router.get('/ocr/health', authenticateToken, async (_req, res) => {
  const [paddleStatus] = await Promise.all([checkPaddleHealth()]);
  res.json({
    status: 'ok',
    engines: {
      paddleocr: paddleStatus,
      tesseract_mrz: mrzWorkerPromise ? 'ready' : 'not_loaded',
      tesseract_visual: arabicWorkerPromise && englishWorkerPromise ? 'ready' : 'not_loaded'
    },
    ...(paddleStatus !== 'available' && {
      engine_warning: getPaddleOcrWarning(getLocalOcrStatus().diagnostic)
    }),
    modes: {
      local: { status: 'available' },
      cloud: { ...cloudOcrService.getConfiguration(),
        message: cloudOcrService.configurationMessage(cloudOcrService.getConfiguration().status) }
    }
  });
});

router.post('/ocr/passport', authenticateToken, requireStaff, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'الملف مطلوب' });
  const mode = req.body?.mode ?? 'local';
  if (!['local', 'cloud'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'اختر طريقة قراءة صالحة: محلي أو سحابي.' });
  }
  if (!checkOcrRateLimit(req)) {
    return res.status(429).json({ error: 'تم تجاوز عدد طلبات قراءة الجوازات المسموح بها. حاول بعد قليل.' });
  }
  if (ocrInFlight >= OCR_MAX_CONCURRENT) {
    return res.status(429).json({ error: 'خدمة قراءة الجوازات مشغولة حالياً. حاول بعد لحظات.' });
  }
  if (mode === 'cloud') {
    const config = cloudOcrService.getConfiguration();
    if (config.status !== 'configured') {
      return res.status(503).json({ success: false, mode, error: cloudOcrService.configurationMessage(config.status) });
    }
  }

  ocrInFlight += 1;
  const startedAt = Date.now();
  const requestController = new AbortController();
  const abortRequest = () => requestController.abort();
  const closeResponse = () => { if (!res.writableEnded) abortRequest(); };
  req.once?.('aborted', abortRequest);
  res.once?.('close', closeResponse);
  const stageLog = (stage, detail = {}) => {
    if (process.env.OCR_LOG_SUMMARY === 'false') return;
    console.info(`[OCR] ${stage}`, { durationMs: Date.now() - startedAt, ...detail });
  };
  try {
    stageLog('request received', { bytes: req.file.size });
    let inputBuffer = req.file.buffer;
    const pdfInput = inputBuffer.subarray(0, 5).toString('ascii') === '%PDF-';
    let pdfPageCount = null;
    if (pdfInput) {
      try {
        const rendered = await rasterizePassportPdf(inputBuffer, Number(req.body?.page || 1));
        inputBuffer = rendered.imageBuffer;
        pdfPageCount = rendered.totalPages;
      } catch (error) {
        return res.status(400).json({ success: false, data: emptyPassportData(),
          error: error.publicMessage || 'تعذرت قراءة PDF. تأكد أن الملف صالح وغير محمي بكلمة مرور.' });
      }
    }
    const detectedType = detectImageType(inputBuffer);
    if (!detectedType) {
      return res.status(400).json({
        data: emptyPassportData(),
        success: false,
        error: 'صيغة الملف غير مدعومة. استخدم PDF أو صورة JPEG أو PNG أو WebP صالحة.'
      });
    }

    const metadata = await sharp(inputBuffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    if (!metadata.width || !metadata.height || metadata.width < MIN_IMAGE_DIMENSION ||
        metadata.height < MIN_IMAGE_DIMENSION ||
        metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
        !['jpeg', 'png', 'webp', 'tiff'].includes(metadata.format) ||
        metadata.format !== detectedType) {
      return res.status(400).json({
        data: emptyPassportData(),
        success: false,
        error: 'صيغة صورة الجواز غير مدعومة أو الصورة غير صالحة.'
      });
    }

    const preparedImage = sharp(inputBuffer, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({ width: MAX_ANALYSIS_WIDTH, height: 3200, fit: 'inside', withoutEnlargement: true });
    let orientedImage = await preparedImage.clone()
      .jpeg({ quality: 94 })
      .toBuffer();
    let { width, height } = await sharp(orientedImage).metadata();
    if (!width || !height) throw new Error('Unable to read oriented image dimensions');

    const quality = await assessImageQuality(orientedImage);
    const extraWarnings = [];
    if (quality.lowQuality) {
      extraWarnings.push({
        code: 'low_quality_image',
        field: null,
        message: 'الصورة غير واضحة بما يكفي؛ قد تكون النتائج غير دقيقة. يفضّل التقاط صورة أفضل للإضاءة والتركيز.'
      });
    }
    if (width < 600 || height < 400) {
      extraWarnings.push({
        code: 'low_resolution_image',
        field: null,
        message: 'دقة الصورة منخفضة؛ يُنصح بصورة بدقة أعلى لقراءة أدق.'
      });
    }

    if (mode === 'cloud') {
      try {
        const result = await cloudOcrService.recognizePassport({ imageBuffer: orientedImage,
          signal: requestController.signal, extraWarnings });
        const { extraction } = result;
        const success = hasPassportIdentity(extraction.data);
        return res.status(success ? 200 : 422).json({
          mode, provider: 'GEMINI_CLOUD', success,
          data: extraction.data,
          arabic_ocr_success: ['first_name_ar', 'father_name_ar', 'last_name_ar'].every((key) => Boolean(extraction.data[key])),
          warning: success ? 'تمت القراءة السحابية. راجع الأسماء والأرقام والتواريخ قبل الحفظ.'
            : 'لم تتمكن الخدمة السحابية من قراءة الاسم أو رقم الجواز. جرّب صورة أوضح لصفحة البيانات كاملة.',
          review_fields: extraction.reviewFields,
          extraction_sources: extraction.sources,
          field_confidence: extraction.confidence,
          ocr_contract: extraction.contract,
          diagnostics: { processingMs: Date.now() - startedAt, model: result.model, cloud: result.diagnostics }
        });
      } catch (error) {
        const diagnostic = /^GEMINI_OCR_[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'GEMINI_OCR_UNAVAILABLE';
        console.warn('[OCR] Cloud passport read failed:', diagnostic);
        const errorMessage = diagnostic === 'GEMINI_OCR_HTTP_429'
          ? 'بلغت الخدمة السحابية حد الاستخدام أو الرصيد. راجع حصة Gemini أو اختر القراءة المحلية.'
          : diagnostic === 'GEMINI_OCR_TIMEOUT'
            ? 'انتهت مهلة القراءة السحابية. أعد المحاولة أو اختر القراءة المحلية.'
            : ['GEMINI_OCR_HTTP_401', 'GEMINI_OCR_HTTP_403'].includes(diagnostic)
              ? 'تعذر اعتماد مفتاح الخدمة السحابية أو صلاحياته. راجع إعدادات Gemini في الخادم.'
              : diagnostic === 'GEMINI_OCR_HTTP_404'
                ? 'نموذج Gemini المحدد غير متاح. راجع اسم النموذج في إعدادات الخادم.'
                : 'تعذرت القراءة السحابية. أعد المحاولة أو اختر القراءة المحلية.';
        return res.status(diagnostic === 'GEMINI_OCR_HTTP_429' ? 429 : diagnostic === 'GEMINI_OCR_TIMEOUT' ? 504 : 502)
          .json({ success: false, mode, error: errorMessage });
      }
    }

    let paddleResult = { lines: [], crop_lines: [] };
    let providerWarning = '';
    let providerDiagnostic = '';
    try {
      await waitForLocalOcrService();
      paddleResult = await pythonOcrService.recognizePassport({
        imageBuffer: orientedImage,
        timeoutMs: PADDLE_OCR_TIMEOUT_MS
      });
      if (paddleResult.processedImage?.length) {
        const processedMetadata = await sharp(paddleResult.processedImage, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
        if (processedMetadata.width && processedMetadata.height) {
          orientedImage = paddleResult.processedImage;
          width = processedMetadata.width;
          height = processedMetadata.height;
        }
      }
      if (!paddleResult.lines.length) {
        providerWarning = 'لم يتم استخراج نص من خدمة PaddleOCR؛ تم استخدام القراءة المحلية.';
        providerDiagnostic = 'PADDLE_OCR_NO_TEXT';
      }
    } catch (error) {
      providerDiagnostic = getPaddleOcrDiagnostic(error);
      if (providerDiagnostic === 'PADDLE_OCR_ECONNREFUSED') {
        providerDiagnostic = getLocalOcrStatus().diagnostic || providerDiagnostic;
      }
      console.warn('[OCR] Local PaddleOCR service unavailable; using local fallback:', providerDiagnostic);
      providerWarning = getPaddleOcrWarning(providerDiagnostic);
    }

    let fallbackEnglishResult;
    if (!paddleResult.lines.length) {
      try {
        // Keep fine Arabic strokes intact; avoid a second lossy JPEG encoding.
        const fallbackInput = await preparedImage.clone().png().toBuffer();
        const fallback = await orientFallbackPassport(fallbackInput, await getEnglishWorker());
        orientedImage = fallback.imageBuffer;
        width = fallback.width;
        height = fallback.height;
        fallbackEnglishResult = fallback.englishResult;
        stageLog('fallback orientation selected', { angle: fallback.angle });
      } catch { /* The independent Arabic and MRZ reads can still proceed. */ }
    }

    // Every engine and name crop now reads the same upright, deskewed image.
    const mrzResultPromise = runMrzRead(orientedImage, width, height).catch(() => ({
      data: null, valid: false, attempts: 0, consistent: true, repaired: false,
      candidateLines: [], diagnostics: null, lineLengths: [], nameStructureValid: false
    }));
    const preliminary = mergePassportSources({ lines: paddleResult.lines }, null);
    const arabicNeedsRetry = ['first_name_ar', 'father_name_ar', 'last_name_ar']
      .some((field) => !preliminary.data[field] || (preliminary.confidence[field] ?? 0) < 0.9);
    const localReadPromise = runLocalRead(orientedImage, width, height,
      arabicNeedsRetry ? findArabicNameRegion(paddleResult.lines, width, height) : null,
      fallbackEnglishResult).catch(() => ({ lines: [] }));
    if (pdfPageCount > 1) extraWarnings.push({ code: 'pdf_page_selected', field: null,
      message: `تمت قراءة الصفحة ${Number(req.body?.page || 1)} من ${pdfPageCount}. اختر صفحة بيانات جواز واحد في كل قراءة.` });

    let paddleLines = [...paddleResult.lines];
    if (paddleLines.length) {
      const needsNameRetry = mergePassportSources({ lines: paddleLines }, null)
        .reviewFields.length > 0;
      const cropBounds = needsNameRetry
        ? findNameRegion(paddleLines, width, height)
        : null;
      if (cropBounds) {
        try {
          const cropBuffer = await createEnhancedNameCrop(orientedImage, cropBounds);
          const cropResult = await pythonOcrService.recognizePassport({
            cropBuffer,
            timeoutMs: PADDLE_OCR_TIMEOUT_MS
          });
          paddleResult.crop_lines = cropResult.crop_lines.length
            ? cropResult.crop_lines
            : cropResult.lines;
          paddleLines = [
            ...paddleLines,
            ...mapCropLines(paddleResult.crop_lines, cropBounds, width, height)
              .map((line) => ({ ...line, passId: `crop-${line.passId || 'default'}` }))
          ];
        } catch (error) {
          console.warn('[OCR] Enhanced name-region OCR unavailable:', error.message);
        }
      }
    }

    const [mrzResult, localResult] = await Promise.all([
      mrzResultPromise,
      localReadPromise
    ]);
    stageLog('engines finished', {
      paddleLines: paddleLines.length,
      tesseractLines: localResult.lines.length,
      mrzDetected: mrzResult.candidateLines.length === 2,
      mrzValid: mrzResult.valid,
      mrzAttempts: mrzResult.attempts
    });
    const paddleMrzResult = extractMrzFromReadResult({ lines: paddleLines });
    const paddleMrz = paddleMrzResult.data;
    let mrzData = paddleMrzResult.partial && mrzResult.nameStructureValid ? mrzResult.data : paddleMrz || mrzResult.data;
    const mrzAttempts = paddleMrzResult.attempts + mrzResult.attempts;
    const mrzDocumentKey = (data) => JSON.stringify(['passport_number', 'date_of_birth', 'passport_expiry_date', 'nationality', 'gender'].map((field) => data[field]));
    if (paddleMrz && mrzResult.data &&
        mrzDocumentKey(paddleMrz) !== mrzDocumentKey(mrzResult.data)) {
      extraWarnings.push({
        code: 'mrz_sources_disagree',
        field: null,
        message: 'قراءتا MRZ من محركين مختلفين لم تتفقا؛ يرجى مراجعة الحقول يدويًا.'
      });
      mrzData = paddleMrz;
    }
    if (mrzData && !mrzData.first_name_en && !mrzData.last_name_en) {
      extraWarnings.push({ code: 'mrz_name_line_unreadable', field: null,
        message: 'تم التحقق من رقم الجواز والتواريخ في MRZ؛ سطر الأسماء غير واضح وتحتاج الأسماء إلى مراجعة القراءة المرئية.' });
    }
    if (mrzResult.repaired || paddleMrzResult.repaired) {
      extraWarnings.push({
        code: 'mrz_repaired',
        field: null,
        message: 'تم التعرف على MRZ بعد تصحيح التباسات أحرف شائعة؛ تم التحقق عبر أرقام التحقق. راجع الحقول المظللة.'
      });
    }
    if (!mrzResult.consistent || !paddleMrzResult.consistent) {
      extraWarnings.push({
        code: 'mrz_inconsistent',
        field: null,
        message: 'محاولات قراءة MRZ المتعددة أعطت نتائج مختلفة؛ قد تكون الصورة مائلة أو غير واضحة.'
      });
    }
    if (mrzResult.candidateLines.length && !mrzResult.valid && mrzResult.diagnostics) {
      extraWarnings.push({
        code: 'mrz_check_failed',
        field: null,
        message: `تم العثور على سطور MRZ محتملة لكنها لم تجتز التحقق الكامل (${mrzResult.diagnostics.failures.join(', ')}). يرجى مراجعة الحقول يدويًا.`
      });
    }
    if (mrzData?.passport_expiry_date &&
        mrzData.passport_expiry_date <= new Date().toISOString().slice(0, 10)) {
      extraWarnings.push({
        code: 'passport_expired',
        field: 'passport_expiry_date',
        message: 'تاريخ انتهاء جواز السفر المقروء قد يكون منتهي الصلاحية؛ تحقق من التاريخ.'
      });
    }

    const extraction = mergePassportSources(
      { lines: paddleLines },
      mrzData,
      localResult,
      'paddleocr',
      { mrzAttempts, extraWarnings }
    );
    const rawOcr = {
      paddleocr: paddleLines,
      paddleocr_crop: paddleResult.crop_lines,
      tesseract: localResult.lines
    };
    const extractedFields = Object.keys(extraction.data);
    const OPTIONAL_REVIEW_EXEMPT_FIELDS = new Set([
      'full_name_en', 'place_of_birth', 'place_of_issue',
      'issuing_authority', 'document_type'
    ]);
    const reviewFields = [...new Set([
      ...extraction.reviewFields,
      ...extractedFields.filter((field) => {
        if (field === 'full_name_en') return false;
        const value = extraction.data[field];
        const confidence = extraction.confidence[field];
        const isEmpty = value === '' || value === null;
        if (OPTIONAL_REVIEW_EXEMPT_FIELDS.has(field)) {
          return !isEmpty && confidence !== null && confidence !== undefined && confidence < 0.8;
        }
        return isEmpty ||
          (confidence !== null && confidence !== undefined && confidence < 0.8);
      }),
      ...(extraction.data.passport_expiry_date &&
        extraction.data.passport_expiry_date <= new Date().toISOString().slice(0, 10)
        ? ['passport_expiry_date']
        : [])
    ])];
    const contract = buildOcrContract({
      data: extraction.data,
      sources: extraction.sources,
      confidence: extraction.confidence,
      reviewFields,
      conflicts: extraction.conflicts,
      agreements: extraction.agreements,
      mrzAttempts,
      extraWarnings
    });
    const provider = paddleLines.length ? 'PADDLEOCR_LOCAL' : 'LOCAL_FALLBACK';
    const arabicOcrSuccess = [
      extraction.data.first_name_ar,
      extraction.data.father_name_ar,
      extraction.data.last_name_ar
    ].every(Boolean);
    logExtractionSummary(provider, extraction.sources, reviewFields, Boolean(mrzData));
    stageLog('response mapped', {
      fieldsExtracted: Object.values(extraction.data).filter((v) => v !== '' && v !== null).length,
      conflicts: extraction.conflicts.length,
      requiresReview: reviewFields.length > 0
    });

    if (!hasPassportIdentity(extraction.data)) {
      return res.status(422).json({
        mode,
        data: extraction.data,
        success: false,
        arabic_ocr_success: false,
        warning: getProviderWarning(
          ['لم يتمكن النظام من قراءة الاسم أو رقم الجواز. جرّب صورة مستقيمة تشمل صفحة البيانات كاملة وبإضاءة واضحة.', providerWarning].filter(Boolean).join(' '),
          providerDiagnostic
        ),
        review_fields: reviewFields,
        extraction_sources: extraction.sources,
        field_confidence: extraction.confidence,
        ocr_contract: contract,
        raw_ocr: rawOcr
      });
    }

    res.json({
      mode,
      provider,
      data: extraction.data,
      success: true,
      arabic_ocr_success: arabicOcrSuccess,
      ...(providerWarning && {
        warning: getProviderWarning(providerWarning, providerDiagnostic)
      }),
      ...(reviewFields.length > 0 && { review_fields: reviewFields }),
      extraction_sources: extraction.sources,
      field_confidence: extraction.confidence,
      ocr_contract: contract,
      raw_ocr: rawOcr,
      diagnostics: { processingMs: Date.now() - startedAt, image: quality, paddleocr: paddleResult.diagnostics || null }
    });
  } catch (error) {
    console.error('[OCR] Passport processing failed:', error.message);
    res.status(500).json({
      data: emptyPassportData(),
      success: false,
      error: 'فشلت معالجة الملف.'
    });
  } finally {
    requestController.abort();
    req.removeListener?.('aborted', abortRequest);
    res.removeListener?.('close', closeResponse);
    ocrInFlight = Math.max(0, ocrInFlight - 1);
  }
});

router.closeOcrWorkers = async () => {
  const pending = [mrzWorkerPromise, arabicWorkerPromise, englishWorkerPromise].filter(Boolean);
  mrzWorkerPromise = arabicWorkerPromise = englishWorkerPromise = undefined;
  await Promise.allSettled(pending.map(async (promise) => (await promise).terminate()));
};

module.exports = router;
