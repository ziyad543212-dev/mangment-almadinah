const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const mrz = require('mrz');
const { createWorker, OEM, PSM } = require('tesseract.js');
const { authenticateToken } = require('../auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});
const OCR_CACHE_DIR = process.env.TESSERACT_CACHE_DIR
  || path.join(os.tmpdir(), 'tesseract-cache');
const MRZ_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';
const MAX_IMAGE_PIXELS = 40_000_000;

let workerPromise;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await fs.promises.mkdir(OCR_CACHE_DIR, { recursive: true });
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        cachePath: OCR_CACHE_DIR
      });
      try {
        await worker.setParameters({
          tessedit_char_whitelist: MRZ_WHITELIST,
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK
        });
        return worker;
      } catch (error) {
        await worker.terminate();
        throw error;
      }
    })().catch((error) => {
      workerPromise = undefined;
      throw error;
    });
  }

  return workerPromise;
}

function sanitizeMRZLines(text) {
  const lines = text
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/[^A-Z0-9<]/g, ''))
    .filter((line) => line.includes('<') || line.length === 44)
    .filter((line) => line.length === 44);

  const firstLine = lines.find((line) => /^P[A-Z<][A-Z0-9<]{42}$/.test(line));
  const secondLine = lines.find((line) => /^\w{9}[0-9][A-Z]{3}[0-9]{7}[MF<][0-9]{7}[A-Z0-9<]{14}[0-9]{2}$/.test(line));

  if (!firstLine || !secondLine) return [];
  return [firstLine, secondLine];
}

function formatMrzDate(value, dateType) {
  if (!/^\d{6}$/.test(value || '')) return null;

  const currentYear = new Date().getFullYear();
  const currentTwoDigitYear = currentYear % 100;
  const twoDigitYear = Number(value.slice(0, 2));
  let year;

  if (dateType === 'birth') {
    year = twoDigitYear > currentTwoDigitYear ? 1900 + twoDigitYear : 2000 + twoDigitYear;
  } else {
    const currentCentury = Math.floor(currentYear / 100) * 100;
    year = currentCentury + twoDigitYear;
    if (year > currentYear + 20) year -= 100;
    if (year < currentYear - 50) year += 100;
  }

  const month = value.slice(2, 4);
  const day = value.slice(4, 6);
  return `${year}-${month}-${day}`;
}

function extractPassportData(lines) {
  const parsed = mrz.parse(lines, { autocorrect: true });
  if (parsed.format !== 'TD3') {
    return { data: null, valid: false };
  }

  const fields = parsed.fields;
  const data = {
    name_en: [fields.firstName, fields.lastName].filter(Boolean).join(' '),
    passport_number: parsed.documentNumber || fields.documentNumber || null,
    passport_expiry_date: formatMrzDate(fields.expirationDate, 'expiration'),
    date_of_birth: formatMrzDate(fields.birthDate, 'birth'),
    nationality: fields.nationality || lines[1].slice(10, 13),
    gender: fields.sex || null
  };

  return { data, valid: parsed.valid };
}

async function preprocessPassportImage(buffer, outputPath) {
  const orientedImage = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .toBuffer();
  const { width, height, format } = await sharp(orientedImage, {
    limitInputPixels: MAX_IMAGE_PIXELS
  }).metadata();

  if (!width || !height || !format) {
    throw new Error('Unsupported or invalid passport image');
  }

  const top = Math.floor(height * 0.6);
  const cropHeight = height - top;

  if (cropHeight < 1) {
    throw new Error('Passport image is too small to process');
  }

  await sharp(orientedImage)
    .extract({ left: 0, top, width, height: cropHeight })
    .resize({ width: 2200 })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 2.5 })
    .png()
    .toFile(outputPath);
}

router.post(
  '/ocr/passport',
  authenticateToken,
  (req, res, next) => {
    upload.single('image')(req, res, (error) => {
      if (!error) return next();

      console.error('Passport upload error:', error);
      const status = error instanceof multer.MulterError ? 400 : 500;
      return res.status(status).json({
        error: status === 400 ? 'Invalid or oversized passport image' : 'Passport upload failed'
      });
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Passport image is required' });
    }

    let tempDirectory;
    try {
      let metadata;
      try {
        metadata = await sharp(req.file.buffer, {
          limitInputPixels: MAX_IMAGE_PIXELS
        }).metadata();
      } catch {
        return res.status(400).json({ error: 'Unsupported or invalid passport image' });
      }

      if (
        !metadata.width
        || !metadata.height
        || !['jpeg', 'png', 'webp', 'tiff', 'gif', 'heif', 'avif'].includes(metadata.format)
      ) {
        return res.status(400).json({ error: 'Unsupported or invalid passport image' });
      }

      tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'passport-ocr-'));
      const processedImagePath = path.join(tempDirectory, 'mrz.png');
      await preprocessPassportImage(req.file.buffer, processedImagePath);

      const worker = await getWorker();
      const { data: { text } } = await worker.recognize(processedImagePath);
      const lines = sanitizeMRZLines(text);

      if (lines.length !== 2) {
        return res.status(422).json({
          warning: 'لم يتمكن النظام من قراءة منطقة جواز السفر. يرجى تجربة صورة أوضح أو إدخال البيانات يدويًا.'
        });
      }

      const { data, valid } = extractPassportData(lines);
      if (!data) {
        return res.status(422).json({
          warning: 'لم يتم التعرف على بيانات جواز سفر بصيغة MRZ صالحة. يرجى إدخال البيانات يدويًا.'
        });
      }

      const hasExtractedData = Object.values(data).some(Boolean);
      if (!hasExtractedData) {
        return res.status(422).json({
          warning: 'لم يتم استخراج بيانات من الصورة. يرجى إدخال البيانات يدويًا.'
        });
      }

      res.json({
        data,
        ...(!valid && {
          warning: 'تم استخراج بعض البيانات، لكن تعذر التحقق من جميع رموز جواز السفر. يرجى مراجعة البيانات.'
        })
      });
    } catch (error) {
      console.error('Passport OCR processing error:', error);
      res.status(500).json({
        error: 'فشلت معالجة صورة جواز السفر. يرجى المحاولة مرة أخرى.'
      });
    } finally {
      if (tempDirectory) {
        try {
          await fs.promises.rm(tempDirectory, { recursive: true, force: true });
        } catch (error) {
          console.error('Passport OCR temporary file cleanup error:', error);
        }
      }
    }
  }
);

module.exports = router;
module.exports.sanitizeMRZLines = sanitizeMRZLines;
module.exports.formatMrzDate = formatMrzDate;
module.exports.extractPassportData = extractPassportData;
module.exports.preprocessPassportImage = preprocessPassportImage;
