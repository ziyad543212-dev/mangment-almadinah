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
  limits: { fileSize: 15 * 1024 * 1024, files: 1 }
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

const ARABIC_NAMES_DICT = {
  'AHMAD': 'أحمد', 'AHMED': 'أحمد', 'MOHAMMAD': 'محمد', 'MOHAMMED': 'محمد',
  'MUHAMMAD': 'محمد', 'MOHAMAD': 'محمد', 'MHD': 'محمد', 'ALI': 'علي',
  'OMAR': 'عمر', 'KHALED': 'خالد', 'KHALID': 'خالد', 'IBRAHIM': 'إبراهيم',
  'YOUSEF': 'يوسف', 'YOUSIF': 'يوسف', 'YUSUF': 'يوسف', 'HASSAN': 'حسن',
  'HUSSEIN': 'حسين', 'MAHMOUD': 'محمود', 'MUSTAFA': 'مصطفى', 'SALEH': 'صالح',
  'ABDULLAH': 'عبد الله', 'ABDALLAH': 'عبد الله', 'ABDULRAHMAN': 'عبد الرحمن',
  'MAJED': 'ماجد', 'SAMI': 'سامي', 'RAMI': 'رامي', 'TAREK': 'طارق', 'ZIAD': 'زياد'
};

function phoneticWordToAr(word) {
  if (!word) return '';
  let w = word.toUpperCase().trim();
  if (ARABIC_NAMES_DICT[w]) return ARABIC_NAMES_DICT[w];
  let prefix = '';
  if (w.startsWith('AL') && w.length > 3) { prefix = 'ال'; w = w.slice(2); }
  else if (w.startsWith('EL') && w.length > 3) { prefix = 'ال'; w = w.slice(2); }
  if (ARABIC_NAMES_DICT[w]) return prefix + ARABIC_NAMES_DICT[w];

  let res = w.replace(/KH/g, 'خ').replace(/GH/g, 'غ').replace(/SH/g, 'ش').replace(/TH/g, 'ث').replace(/DH/g, 'ذ').replace(/PH/g, 'ف').replace(/AA/g, 'ا').replace(/EE/g, 'ي').replace(/OO/g, 'و');
  res = res.replace(/^A/, 'أ').replace(/^I/, 'إ').replace(/^E/, 'إ').replace(/^U/, 'أ');
  res = res.replace(/AH$/, 'ة').replace(/EH$/, 'ة');

  const charMap = {
    'A': 'ا', 'B': 'ب', 'C': 'ك', 'D': 'د', 'E': 'ي', 'F': 'ف', 'G': 'ج',
    'H': 'ه', 'I': 'ي', 'J': 'ج', 'K': 'ك', 'L': 'ل', 'M': 'م', 'N': 'ن',
    'O': 'و', 'P': 'ب', 'Q': 'ق', 'R': 'ر', 'S': 'س', 'T': 'ت', 'U': 'و',
    'V': 'ف', 'W': 'و', 'X': 'كس', 'Y': 'ي', 'Z': 'ز'
  };
  let finalAr = '';
  for (const ch of res) { finalAr += charMap[ch] !== undefined ? charMap[ch] : ch; }
  return prefix + finalAr.replace(/اا+/g, 'ا');
}

function transliterateToAr(enText) {
  if (!enText) return '';
  const clean = enText.toUpperCase().trim().replace(/\s+/g, ' ');
  const words = clean.split(' ');
  const result = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if ((w === 'ABD' || w === 'ABDEL' || w === 'ABDUL') && words[i + 1]) {
      result.push('عبد');
    } else if ((w === 'AL' || w === 'EL') && words[i + 1]) {
      const nextTranslated = phoneticWordToAr(words[i + 1]);
      result.push(nextTranslated.startsWith('ال') ? nextTranslated : 'ال' + nextTranslated);
      i++;
    } else {
      result.push(phoneticWordToAr(w));
    }
  }
  return result.join(' ');
}

function splitGivenNamesSmart(givenNamesStr) {
  if (!givenNamesStr) return { firstName: '', fatherName: '' };
  const rawWords = givenNamesStr.trim().split(/\s+/).filter(Boolean);
  if (rawWords.length <= 1) return { firstName: rawWords[0] || '', fatherName: '' };
  const grouped = [];
  let i = 0;
  while (i < rawWords.length) {
    const w = rawWords[i].toUpperCase();
    if (['ABD', 'ABDEL', 'ABDUL', 'ABU', 'AL', 'EL', 'IBN', 'BIN'].includes(w) && rawWords[i + 1]) {
      grouped.push(`${rawWords[i]} ${rawWords[i + 1]}`);
      i += 2;
    } else {
      grouped.push(rawWords[i]);
      i += 1;
    }
  }
  return { firstName: grouped[0] || '', fatherName: grouped.slice(1).join(' ') || '' };
}

function formatMrzDate(value, dateType) {
  if (!/^\d{6}$/.test(value || '')) return null;
  const currentYear = new Date().getFullYear();
  const currentTwoDigitYear = currentYear % 100;
  const twoDigitYear = Number(value.slice(0, 2));
  let year = dateType === 'birth' ? (twoDigitYear > currentTwoDigitYear ? 1900 + twoDigitYear : 2000 + twoDigitYear) : Math.floor(currentYear / 100) * 100 + twoDigitYear;
  return `${year}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
}

function extractPassportData(lines) {
  const line1 = lines[0].padEnd(44, '<');
  const line2 = lines[1].padEnd(44, '<');

  let lastNameEn = '';
  let givenEn = '';

  const nameSection = line1.slice(5);
  const parts = nameSection.split('<<');
  
  if (parts.length >= 2) {
    lastNameEn = parts[0].replace(/</g, ' ').trim();
    givenEn = parts[1].replace(/</g, ' ').trim();
  } else {
    const cleanName = nameSection.replace(/</g, ' ').trim().replace(/\s+/g, ' ');
    const spaceParts = cleanName.split(' ');
    lastNameEn = spaceParts[0] || '';
    givenEn = spaceParts.slice(1).join(' ');
  }

  const { firstName: firstNameEn, fatherName: fatherNameEn } = splitGivenNamesSmart(givenEn);

  const passportNumber = line2.slice(0, 9).replace(/</g, '').trim();
  const nationality = line2.slice(10, 13).replace(/</g, '').trim();
  const birthDateRaw = line2.slice(13, 19);
  const genderRaw = line2.slice(20, 21);
  const expiryDateRaw = line2.slice(21, 27);

  let valid = false;
  try {
    const parsed = mrz.parse(lines, { autocorrect: true });
    valid = parsed.valid;
  } catch (e) {}

  return {
    data: {
      first_name_en: firstNameEn,
      father_name_en: fatherNameEn,
      last_name_en: lastNameEn,
      first_name_ar: transliterateToAr(firstNameEn),
      father_name_ar: transliterateToAr(fatherNameEn),
      last_name_ar: transliterateToAr(lastNameEn),
      passport_number: passportNumber || null,
      passport_expiry_date: formatMrzDate(expiryDateRaw, 'expiration'),
      date_of_birth: formatMrzDate(birthDateRaw, 'birth'),
      nationality: nationality || 'SYR',
      gender: genderRaw === 'M' ? 'M' : genderRaw === 'F' ? 'F' : null
    },
    valid
  };
}

function fixMrzLine1(line) {
  let fixed = line.padEnd(44, '<').slice(0, 44);
  return fixed.slice(0, 2) + fixed.slice(2).replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S');
}

function fixMrzLine2(line) {
  const chars = line.padEnd(44, '<').slice(0, 44).split('');
  const digitPositions = [9, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 42, 43];
  const toDigit = { 'O': '0', 'Q': '0', 'D': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'B': '8' };
  for (const pos of digitPositions) { if (toDigit[chars[pos]]) chars[pos] = toDigit[chars[pos]]; }
  if (chars[20] === '0') chars[20] = 'M';
  return chars.join('');
}

function sanitizeMRZLines(text) {
  const rawLines = text
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/[^A-Z0-9<]/g, '').trim())
    .filter((l) => l.length >= 35 && l.length <= 50);

  let firstLine = rawLines.find((l) => l.startsWith('P') && l.includes('<<')) ||
                  rawLines.find((l) => l.startsWith('P') && l.length >= 38);

  let secondLine = rawLines.find((l) => l !== firstLine && /\d{6}/.test(l) && l.length >= 38) ||
                   rawLines.find((l) => l !== firstLine && !l.startsWith('P') && l.length >= 38);

  if (!firstLine || !secondLine) {
    const sorted = rawLines.filter(l => l.length >= 38).sort((a, b) => Math.abs(a.length - 44) - Math.abs(b.length - 44));
    if (sorted.length >= 2) {
      firstLine = sorted[0].padEnd(44, '<').slice(0, 44);
      secondLine = sorted[1].padEnd(44, '<').slice(0, 44);
    }
  }

  if (!firstLine || !secondLine) return [];
  return [
    firstLine.padEnd(44, '<').slice(0, 44),
    secondLine.padEnd(44, '<').slice(0, 44)
  ];
}

router.post('/ocr/passport', authenticateToken, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'الملف مطلوب' });

  let tempDirectory;
  try {
    tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'passport-ocr-'));
    const worker = await getWorker();

    const orientedImage = await sharp(req.file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate().toBuffer();
    const { width, height } = await sharp(orientedImage).metadata();
    
    const croppedImagePath = path.join(tempDirectory, 'mrz-cropped.png');
    const top = height > 300 ? Math.floor(height * 0.45) : 0;
    
    await sharp(orientedImage)
      .extract({ left: 0, top, width, height: height - top })
      .resize({ width: 3000, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.5 })
      .png()
      .toFile(croppedImagePath);

    let { data: { text } } = await worker.recognize(croppedImagePath);
    let lines = sanitizeMRZLines(text);

    if (lines.length !== 2) {
      const fullImagePath = path.join(tempDirectory, 'mrz-full.png');
      await sharp(orientedImage).resize({ width: 3000 }).grayscale().normalize().png().toFile(fullImagePath);
      const fullResult = await worker.recognize(fullImagePath);
      lines = sanitizeMRZLines(fullResult.data.text);
    }

    if (lines.length !== 2) {
      return res.status(422).json({ warning: 'لم يتمكن النظام من قراءة شريط الجواز (MRZ). تأكد من وضوح الصورة.' });
    }

    const { data, valid } = extractPassportData(lines);
    if (!data) return res.status(422).json({ warning: 'تعذر تحليل بيانات الجواز.' });

    res.json({ data, ...(!valid && { warning: 'تم استخراج البيانات، يرجى مراجعتها.' }) });
  } catch (error) {
    console.error('OCR Error:', error);
    res.status(500).json({ error: 'فشلت معالجة الملف.' });
  } finally {
    if (tempDirectory) {
      await fs.promises.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
});

module.exports = router;