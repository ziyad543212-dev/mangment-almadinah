const ARABIC_NOISE = new Set([
  'الجمهورية', 'العربية', 'السورية', 'جواز', 'سفر', 'نوع', 'رمز',
  'البلد', 'رقم', 'الجواز', 'تاريخ', 'الميلاد', 'الولادة', 'محل',
  'الإصدار', 'الاصدار', 'الانتهاء', 'الصلاحية', 'الجنس', 'الجنسية',
  'ذكر', 'أنثى', 'انثى', 'توقيع', 'صاحب', 'حامل', 'الاسم', 'اسم',
  'الأب', 'الاب', 'الوالد', 'الشهرة', 'الكنية', 'النسبة', 'العائلة',
  'اللقب', 'الشخصي', 'الأول', 'الاول'
]);
const ENGLISH_NOISE = new Set([
  'PASSPORT', 'TYPE', 'CODE', 'COUNTRY', 'NUMBER', 'NATIONALITY', 'NAME',
  'NAMES', 'GIVEN', 'SURNAME', 'FAMILY', 'FATHER', 'MOTHER', 'DATE',
  'BIRTH', 'PLACE', 'SEX', 'ISSUE', 'EXPIRY', 'AUTHORITY', 'HOLDER',
  'SIGNATURE', 'SYRIAN', 'ARAB', 'REPUBLIC'
]);
const ARABIC_FIELDS = [
  {
    key: 'first_name_ar',
    labels: ['الاسم الشخصي', 'الاسم الأول', 'الاسم الاول', 'الاسم']
  },
  { key: 'father_name_ar', labels: ['اسم الأب', 'اسم الاب', 'سم الأب', 'سم الاب', 'اسم الوالد'] },
  {
    key: 'last_name_ar',
    labels: ['اسم العائلة', 'العائلة', 'النسبة', 'نسبة', 'الشهرة', 'الكنية', 'اللقب', 'السبة', 'السبه']
  }
];
const ENGLISH_FIELDS = [
  { key: 'first_name_en', labels: ['FIRST NAMES', 'FIRST NAME', 'GIVEN NAMES', 'GIVEN NAME', 'NAME'] },
  { key: 'father_name_en', labels: ["FATHER'S NAME", 'FATHER’S NAME', 'FATHERS NAME', 'FATHER NAME', 'PATHER NAME'] },
  { key: 'last_name_en', labels: ['FAMILY NAME', 'LAST NAME', 'SURNAME'] }
];
const DOCUMENT_FIELD_DEFINITIONS = [
  {
    key: 'passport_number',
    kind: 'passportNumber',
    required: true,
    labels: ['PASSPORT NO', 'PASSPORT NUMBER', 'TRAVEL DOCUMENT NO',
      'رقم الجواز', 'رقم جواز السفر', 'رقم الوثيقة']
  },
  {
    key: 'date_of_birth',
    kind: 'date',
    required: true,
    labels: ['DATE OF BIRTH', 'BIRTH DATE', 'DOB',
      'تاريخ الميلاد', 'تاريخ الولادة', 'تاريخ المواليد']
  },
  {
    key: 'passport_expiry_date',
    kind: 'date',
    required: true,
    labels: ['DATE OF EXPIRY', 'EXPIRY DATE', 'DATE OF EXPIRATION',
      'تاريخ الانتهاء', 'تاريخ انتهاء الجواز', 'تاريخ الصلاحية', 'تاريخ انتهاء الصلاحية']
  },
  {
    key: 'nationality',
    kind: 'nationality',
    required: true,
    labels: ['NATIONALITY', 'الجنسية']
  },
  {
    key: 'gender',
    kind: 'sex',
    required: true,
    labels: ['SEX', 'الجنس']
  },
  {
    key: 'document_type',
    kind: 'text',
    required: false,
    labels: ['PASSPORT TYPE', 'TYPE', 'DOCUMENT TYPE', 'نوع الجواز', 'نوع الوثيقة']
  },
  {
    key: 'place_of_birth',
    kind: 'place',
    required: false,
    labels: ['PLACE OF BIRTH', 'محل الميلاد', 'محل الولادة', 'مكان الميلاد']
  },
  {
    key: 'place_of_issue',
    kind: 'place',
    required: false,
    labels: ['PLACE OF ISSUE', 'مكان الإصدار', 'مكان الاصدار']
  },
  {
    key: 'issuing_authority',
    kind: 'text',
    required: false,
    labels: ['ISSUING AUTHORITY', 'ISSUED BY', 'AUTHORITY', 'جهة الإصدار', 'جهة الاصدار']
  }
];
const ALL_DOCUMENT_LABELS = DOCUMENT_FIELD_DEFINITIONS.flatMap((field) => field.labels);
const MRZ_WEIGHTS = [7, 3, 1];
const MRZ_CHAR_VALUES = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function emptyPassportData() {
  return {
    first_name_ar: '',
    father_name_ar: '',
    last_name_ar: '',
    first_name_en: '',
    father_name_en: '',
    last_name_en: '',
    full_name_en: '',
    passport_number: null,
    date_of_birth: null,
    passport_expiry_date: null,
    nationality: null,
    gender: null,
    place_of_birth: null,
    place_of_issue: null,
    issuing_authority: null,
    document_type: null
  };
}

function hasPassportIdentity(data) {
  return ['first_name_ar', 'last_name_ar', 'first_name_en', 'last_name_en', 'passport_number']
    .some((field) => Boolean(data[field]));
}

function normalizeTextForLabel(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function normalizeConfidence(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function validateName(value, script) {
  if (typeof value !== 'string') return '';
  const cleaned = value.normalize('NFKC')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/^[\s:：,،؛.\-]+|[\s:：,،؛.\-]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length > 100) return '';

  if (script === 'arabic') {
    if (!/[\u0621-\u064A]/u.test(cleaned) ||
        !/^[\u0621-\u064A\u064B-\u065F\u0670\u0640\s]+$/u.test(cleaned)) return '';
    const words = cleaned.split(/\s+/);
    if (words.some((word) => ARABIC_NOISE.has(word))) return '';
    return cleaned;
  }

  const name = cleaned.toUpperCase();
  if (!/^[A-Z][A-Z\s'-]*[A-Z]$/.test(name) ||
      /^(.)\1{2,}$/.test(name.replace(/[\s'-]/g, ''))) return '';
  const words = name.split(/[\s'-]+/);
  if (words.some((word) => ENGLISH_NOISE.has(word))) return '';
  return name;
}

function labelRegex(label, script) {
  const parts = label.trim().split(/\s+/).map((part) => [...part].map((character) => {
    if (/[اأإآ]/u.test(character)) return '[اأإآ]';
    if (/[ةه]/u.test(character)) return '[ةه]';
    return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join(script === 'arabic' && /[\u0621-\u064A]/u.test(part) ? '\\s*' : ''));
  const phrase = parts.join(script === 'arabic' ? '\\s*' : '\\s+');
  return new RegExp(`(?:^|[\\s:：/.-])(${phrase})(?=$|[\\s:：/.-])\\s*[:：/.-]?\\s*`, 'iu');
}

function isPassportFieldLabel(key, text) {
  if (typeof text !== 'string' || text.length > 100) return false;
  const field = [...ARABIC_FIELDS, ...ENGLISH_FIELDS, ...DOCUMENT_FIELD_DEFINITIONS].find((entry) => entry.key === key);
  if (!field) return false;
  const normalized = normalizeTextForLabel(text);
  return field.labels.some((label) => {
    const match = labelRegex(label, /[\u0621-\u064A]/u.test(label) ? 'arabic' : 'english').exec(normalized);
    return match && !normalized.slice(0, match.index).trim() && !normalized.slice(match.index + match[0].length).trim();
  });
}

function valueAfterLabel(text, labels, script) {
  for (const label of labels.slice().sort((left, right) => right.length - left.length)) {
    const match = labelRegex(label, script).exec(text);
    if (!match) continue;
    const value = text.slice(match.index + match[0].length);
    const valid = validateName(value, script);
    if (valid) return valid;
  }
  return '';
}

function lineIsLabel(line, fieldDefinitions, script) {
  return fieldDefinitions.some((field) => field.labels.some((label) =>
    labelRegex(label, script).test(line.text || '')
  ));
}

function verticalDistance(left, right) {
  const leftCenter = left.bounds.top + left.bounds.height / 2;
  const rightCenter = right.bounds.top + right.bounds.height / 2;
  return Math.abs(leftCenter - rightCenter);
}

function sameColumn(left, right) {
  const overlap = Math.min(left.left + left.width, right.left + right.width) -
    Math.max(left.left, right.left);
  const narrowerWidth = Math.min(left.width, right.width);
  return narrowerWidth > 0 && overlap / narrowerWidth >= 0.25;
}

function nearbyValue(labelLine, valueLine, script) {
  const a = labelLine.bounds;
  const b = valueLine.bounds;
  if (!a || !b) return false;
  if (sameColumn(a, b)) return true;
  const sameRow = verticalDistance(labelLine, valueLine) <= Math.max(a.height, b.height) * 0.85;
  const gap = script === 'arabic' ? a.left - (b.left + b.width) : b.left - (a.left + a.width);
  return sameRow && gap >= -0.01 && gap <= 0.09;
}

function extractNamedFieldsFromPass(lines, definitions, script, source) {
  const extracted = {};
  const reviewFields = [];
  const eligibleLines = lines.filter((line) => {
    const confidence = normalizeConfidence(line.confidence);
    return confidence === null || confidence >= 0.45;
  });

  for (const field of definitions) {
    const labelLines = eligibleLines.filter((line) =>
      (field.key !== 'first_name_en' || /^(?:NAME\b|FIRST\s+NAMES?\b|GIVEN\s+NAMES?\b)/iu.test(String(line.text || '').trim())) &&
      field.labels.some((label) =>
        labelRegex(label, script).test(line.text || '')
      )
    ).sort((a, b) => (normalizeConfidence(b.confidence) ?? 0) - (normalizeConfidence(a.confidence) ?? 0));
    for (const labelLine of labelLines) {
      const inlineValue = valueAfterLabel(labelLine.text || '', field.labels, script);
      if (inlineValue) {
        extracted[field.key] = {
          value: inlineValue,
          confidence: normalizeConfidence(labelLine.confidence),
          raw: labelLine.text,
          source
        };
        break;
      }

      const candidates = eligibleLines
        .filter((line) => line !== labelLine &&
          !lineIsLabel(line, [...ARABIC_FIELDS, ...ENGLISH_FIELDS], script) &&
          !lineMatchesAnyLabel(line.text, ALL_DOCUMENT_LABELS) &&
          line.bounds && labelLine.bounds &&
          nearbyValue(labelLine, line, script) &&
          (script === 'arabic'
            ? /[\u0621-\u064A]/u.test(line.text || '')
            : /[A-Z]/i.test(line.text || '')))
        .map((line) => ({
          line,
          distance: verticalDistance(labelLine, line)
        }))
        .filter(({ line, distance }) => {
          const labelHeight = Math.max(labelLine.bounds.height || 0, 0.008);
          const maxDistance = Math.max(labelHeight * 2.5, 0.025);
          return line.pageNumber === labelLine.pageNumber &&
            distance <= maxDistance;
        })
        .sort((left, right) => left.distance - right.distance);

      for (const { line } of candidates) {
        const value = validateName(line.text, script);
        if (!value) continue;
        extracted[field.key] = {
          value,
          confidence: normalizeConfidence(line.confidence),
          raw: line.text,
          source
        };
        break;
      }
      if (extracted[field.key]) break;
    }

    if (!extracted[field.key]) reviewFields.push(field.key);
  }
  return { extracted, reviewFields };
}

function extractAcrossPasses(lines, extractor, ...args) {
  const groups = new Map();
  for (const line of lines || []) {
    const key = line.passId || 'default';
    if (!groups.has(key)) groups.set(key, []);
    // Fold presentation forms in the OCR text, preserving actual name letters.
    groups.get(key).push({ ...line, text: String(line.text || '').normalize('NFKC')
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '') });
  }
  const extracted = {};
  const review = new Set();
  const alternatives = {};
  for (const [passId, group] of groups) {
    const result = extractor(group, ...args);
    result.reviewFields.forEach((field) => review.add(field));
    for (const [field, hit] of Object.entries(result.extracted)) {
      const candidate = { ...hit, passId };
      (alternatives[field] ||= []).push(candidate);
      if (!extracted[field] || (hit.confidence ?? 0) > (extracted[field].confidence ?? 0)) {
        extracted[field] = candidate;
      }
    }
  }
  return { extracted, alternatives, reviewFields: [...review].filter((field) => !extracted[field]) };
}

function extractNamedFields(lines, definitions, script, source) {
  return extractAcrossPasses(lines, extractNamedFieldsFromPass, definitions, script, source);
}

function lineMatchesAnyLabel(lineText, labels) {
  return labels.some((label) =>
    labelRegex(label, 'arabic').test(lineText || '') ||
    labelRegex(label, 'english').test(lineText || '')
  );
}

function cutAtNextLabel(text) {
  let cut = text.length;
  for (const label of ALL_DOCUMENT_LABELS) {
    for (const script of ['arabic', 'english']) {
      const match = labelRegex(label, script).exec(text);
      if (match && match.index > 0 && match.index < cut) cut = match.index;
    }
  }
  return text.slice(0, cut);
}

function documentValueAfterLabel(text, labels) {
  const sorted = labels.slice().sort((left, right) => right.length - left.length);
  for (const label of sorted) {
    for (const script of ['arabic', 'english']) {
      const match = labelRegex(label, script).exec(text || '');
      if (!match) continue;
      return cutAtNextLabel(text.slice(match.index + match[0].length));
    }
  }
  return '';
}

function isLabelOnlyText(text) {
  const normalized = normalizeTextForLabel(text);
  if (!normalized) return true;
  return ALL_DOCUMENT_LABELS.some((label) => {
    const normalizedLabel = normalizeTextForLabel(label);
    return normalizedLabel.length >= 4 &&
      (normalized === normalizedLabel || normalized.startsWith(`${normalizedLabel} `));
  });
}

function validCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeOcrDate(raw) {
  const text = normalizeDigits(String(raw || '').normalize('NFKC')).trim();
  let match = text.match(/(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/);
  if (match) return validCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/);
  if (match) {
    let day = Number(match[1]);
    let month = Number(match[2]);
    const year = Number(match[3]);
    if (day <= 12 && month > 12) [day, month] = [month, day];
    return validCalendarDate(year, month, day);
  }

  const months = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
    JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  match = text.toUpperCase().match(/\b(\d{1,2})[\s./-]+([A-Z]{3,9})[\s./-]+(\d{4})\b/);
  if (match && months[match[2].slice(0, 3)]) return validCalendarDate(Number(match[3]), months[match[2].slice(0, 3)], Number(match[1]));
  match = text.match(/\b(\d{2})(\d{2})(\d{2})\b/);
  if (match) {
    const twoDigitYear = Number(match[1]);
    const currentYear = new Date().getFullYear();
    const year = twoDigitYear > currentYear % 100 ? 1900 + twoDigitYear : 2000 + twoDigitYear;
    return validCalendarDate(year, Number(match[2]), Number(match[3]));
  }
  return null;
}

function normalizeDigits(text) {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)));
}

function validateDocumentValue(kind, raw) {
  const text = cutAtNextLabel(normalizeDigits(String(raw || '').normalize('NFKC')).replace(/\s+/g, ' ').trim());
  if (!text || isLabelOnlyText(text)) return '';

  if (kind === 'passportNumber') {
    const token = text.split(/[\s:：,،;；]+/).find((part) => /[A-Za-z0-9]/.test(part)) || '';
    const cleaned = token.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^[A-Z0-9]{5,12}$/.test(cleaned) ? cleaned : '';
  }
  if (kind === 'date') return normalizeOcrDate(text) || '';
  if (kind === 'place') {
    const value = validateGenericDocumentText(text, 100);
    if (!/^[\p{L}\p{M}\p{N}\s.'’(),/\-]+$/u.test(value) ||
        !balancedParentheses(value)) return '';
    const letters = value.replace(/[^A-Za-z\u0621-\u064A]/g, '').length;
    const digits = value.replace(/\D/g, '').length;
    if (letters < 3 || digits > letters || /\d{1,4}\s*[/]\s*\d{1,2}/.test(value)) return '';
    return value;
  }
  if (kind === 'sex') {
    if (/ذكر/.test(text) || /^\s*M\b/i.test(text)) return 'M';
    if (/أنثى|انثى/.test(text) || /^\s*F\b/i.test(text)) return 'F';
    return '';
  }
  if (kind === 'nationality') {
    const token = text.split(/\s+/)[0] || '';
    const code = token.toUpperCase().replace(/[^A-Z]/g, '');
    if (/^[A-Z]{3}$/.test(code)) return code;
    return validateGenericDocumentText(text, 40);
  }
  return validateGenericDocumentText(text, 100);
}

function balancedParentheses(value) {
  let depth = 0;
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

function validateGenericDocumentText(text, maxLength) {
  const cleaned = text
    .replace(/^[\s:：,،؛.\-]+|[\s:：,،؛.\-]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length > maxLength || isLabelOnlyText(cleaned)) return '';
  if (!/[A-Za-z\u0621-\u064A]/.test(cleaned)) return '';
  if (/[A-Za-z]/.test(cleaned) && /[\u0621-\u064A]/.test(cleaned)) return '';
  const words = cleaned.split(/\s+/);
  if (cleaned.replace(/[^A-Za-z\u0621-\u064A]/g, '').length < 2 ||
      /تاريخ|ناريخ|صلاحية|ولادة|ميلاد|\b(?:EXPIRY|BIRTH|DATE)\b/iu.test(cleaned)) return '';
  if (words.length > 8 || (words.length >= 2 && words.filter((word) => word.length === 1).length >= words.length / 2)) return '';
  return cleaned;
}

function extractDocumentFieldsFromPass(lines, source) {
  const extracted = {};
  const reviewFields = [];
  const eligibleLines = (lines || []).filter((line) => {
    const confidence = normalizeConfidence(line.confidence);
    return confidence === null || confidence >= 0.4;
  });

  for (const field of DOCUMENT_FIELD_DEFINITIONS) {
    const labelLines = eligibleLines.filter((line) =>
      lineMatchesAnyLabel(line.text, field.labels)
    );
    let found = false;

    for (const labelLine of labelLines) {
      const inlineRaw = documentValueAfterLabel(labelLine.text || '', field.labels);
      const mixedTitle = /[A-Za-z]/.test(labelLine.text) && /[\u0621-\u064A]/.test(labelLine.text);
      const inlineValue = field.kind === 'place' && mixedTitle && /[\u0621-\u064A]/.test(inlineRaw)
        ? '' : validateDocumentValue(field.kind, inlineRaw);
      if (inlineValue) {
        extracted[field.key] = {
          value: inlineValue,
          confidence: normalizeConfidence(labelLine.confidence),
          raw: labelLine.text,
          source
        };
        found = true;
        break;
      }

      const candidates = eligibleLines
        .filter((line) => line !== labelLine &&
          !lineMatchesAnyLabel(line.text, ALL_DOCUMENT_LABELS) &&
          line.bounds && labelLine.bounds &&
          (nearbyValue(labelLine, line, /[\u0621-\u064A]/u.test(labelLine.text) ? 'arabic' : 'english')))
        .map((line) => ({
          line,
          distance: verticalDistance(labelLine, line)
        }))
        .filter(({ line, distance }) => {
          const labelHeight = Math.max(labelLine.bounds.height || 0, 0.008);
          const maxDistance = Math.max(labelHeight * 3.5, 0.035);
          return line.pageNumber === labelLine.pageNumber && distance <= maxDistance;
        })
        .sort((left, right) => left.distance - right.distance);

      for (const { line } of candidates) {
        const value = validateDocumentValue(field.kind, line.text);
        if (!value) continue;
        extracted[field.key] = {
          value,
          confidence: normalizeConfidence(line.confidence),
          raw: line.text,
          source
        };
        found = true;
        break;
      }
      if (found) break;
    }

    if (!found && field.required) reviewFields.push(field.key);
  }
  return { extracted, reviewFields };
}

function extractDocumentFields(lines, source) {
  return extractAcrossPasses(lines, extractDocumentFieldsFromPass, source);
}

function normalizePassportNumber(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeComparisonValue(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function valuesConflict(field, visualValue, mrzValue) {
  const visual = normalizeComparisonValue(visualValue);
  const mrz = normalizeComparisonValue(mrzValue);
  if (!visual || !mrz) return false;
  if (field === 'date_of_birth' || field === 'passport_expiry_date') {
    return visual !== mrz;
  }
  if (visual === mrz) return false;
  if (field === 'passport_number' || field === 'nationality' || field === 'gender') return true;
  // A printed first name may be a complete token within all MRZ given names.
  const visualWords = String(visualValue).toUpperCase().trim().split(/\s+/);
  const mrzWords = String(mrzValue).toUpperCase().trim().split(/\s+/);
  return !visualWords.every((word) => mrzWords.includes(word));
}

function checkDigit(value) {
  let sum = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const numericValue = character === '<' ? 0 : MRZ_CHAR_VALUES.indexOf(character);
    if (numericValue < 0) return null;
    sum += numericValue * MRZ_WEIGHTS[index % MRZ_WEIGHTS.length];
  }
  return String(sum % 10);
}

function mrzDataLineFailures(line2) {
  if (typeof line2 !== 'string' || !/^[A-Z0-9<]{44}$/.test(line2)) return ['mrz_data_structure'];
  const failures = [];
  if (!/^[A-Z0-9<]{9}\d[A-Z<]{3}\d{6}\d[MF<]\d{6}\d[A-Z0-9<]{15}\d$/.test(line2)) failures.push('mrz_data_format');
  if (checkDigit(line2.slice(0, 9)) !== line2[9]) failures.push('document_number_check');
  if (checkDigit(line2.slice(13, 19)) !== line2[19]) failures.push('birth_date_check');
  if (checkDigit(line2.slice(21, 27)) !== line2[27]) failures.push('expiry_date_check');
  if (line2[42] !== '<' && checkDigit(line2.slice(28, 42)) !== line2[42]) failures.push('optional_data_check');
  if (checkDigit(line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43)) !== line2[43]) failures.push('composite_check');
  return failures;
}

function parseMrzDataLine(line2) {
  if (mrzDataLineFailures(line2).length) return null;
  const documentNumber = line2.slice(0, 9).replace(/<+$/, '');
  if (!/^[A-Z0-9]{1,9}$/.test(documentNumber)) return null;
  return { first_name_en: '', father_name_en: '', last_name_en: '',
    passport_number: documentNumber, date_of_birth: formatMrzDate(line2.slice(13, 19), 'birth'),
    passport_expiry_date: formatMrzDate(line2.slice(21, 27), 'expiration'),
    nationality: /^[A-Z]{3}$/.test(line2.slice(10, 13)) ? line2.slice(10, 13) : null,
    gender: /^[MF]$/.test(line2[20]) ? line2[20] : null };
}

function mrzDiagnostics(lines) {
  const failures = [];
  if (!Array.isArray(lines) || lines.length !== 2 ||
      lines.some((line) => typeof line !== 'string' || line.length !== 44 ||
        !/^[A-Z0-9<]{44}$/.test(line))) {
    return { valid: false, failures: ['mrz_structure'] };
  }
  const [line1, line2] = lines;
  if (line1[0] !== 'P') failures.push('document_class');
  if (!/^[A-Z<]$/.test(line1[1])) failures.push('issuer');
  if (!/^[A-Z<]{3}$/.test(line1.slice(2, 5))) failures.push('country');
  if (!/^[A-Z0-9<]{9}$/.test(line2.slice(0, 9))) failures.push('document_number_format');
  if (!/^\d$/.test(line2[9])) failures.push('document_number_check_digit');
  if (!/^[A-Z<]{3}$/.test(line2.slice(10, 13))) failures.push('nationality_format');
  if (!/^\d{6}$/.test(line2.slice(13, 19))) failures.push('birth_date_format');
  if (!/^\d$/.test(line2[19])) failures.push('birth_date_check_digit');
  if (!/^[MF<]$/.test(line2[20])) failures.push('sex');
  if (!/^\d{6}$/.test(line2.slice(21, 27))) failures.push('expiry_date_format');
  if (!/^\d$/.test(line2[27])) failures.push('expiry_date_check_digit');

  if (checkDigit(line2.slice(0, 9)) !== line2[9]) failures.push('document_number_check');
  if (checkDigit(line2.slice(13, 19)) !== line2[19]) failures.push('birth_date_check');
  if (checkDigit(line2.slice(21, 27)) !== line2[27]) failures.push('expiry_date_check');
  if (line2[42] !== '<' && checkDigit(line2.slice(28, 42)) !== line2[42]) {
    failures.push('optional_data_check');
  }
  const nameSeparator = line1.indexOf('<<', 5);
  const rawSurname = line1.slice(5, nameSeparator);
  const rawGivenNames = line1.slice(nameSeparator + 2).replace(/<+$/, '');
  if (checkDigit(line2.slice(0, 10) + line2.slice(13, 20) +
    line2.slice(21, 43)) !== line2[43]) failures.push('composite_check');
  if (!(nameSeparator > 5 && nameSeparator < 44)) failures.push('name_separator');
  if (!/^[A-Z]+(?:<[A-Z]+)*$/.test(rawSurname) ||
      !/^[A-Z]+(?:<[A-Z]+)*$/.test(rawGivenNames)) failures.push('name_structure');

  return { valid: failures.length === 0, failures };
}

function isValidMrz(lines) {
  return mrzDiagnostics(lines).valid;
}

function cleanMrzName(value) {
  if (!/^[A-Z]+(?:<[A-Z]+)*$/.test(value)) return '';
  return validateName(value.replace(/<+/g, ' '), 'english');
}

function parseMrz(lines) {
  if (!isValidMrz(lines)) return null;
  const [line1, line2] = lines;
  const nameSeparator = line1.indexOf('<<', 5);
  const surname = cleanMrzName(line1.slice(5, nameSeparator));
  const givenNames = cleanMrzName(line1.slice(nameSeparator + 2).replace(/<+$/, ''));
  if (!surname) return null;

  const dateOfBirth = formatMrzDate(line2.slice(13, 19), 'birth');
  const expiryDate = formatMrzDate(line2.slice(21, 27), 'expiration');
  const documentNumber = line2.slice(0, 9).replace(/<+$/, '');
  if (!/^[A-Z0-9]{1,9}$/.test(documentNumber)) return null;
  const nationality = line2.slice(10, 13);
  return {
    first_name_en: givenNames,
    father_name_en: '',
    last_name_en: surname,
    passport_number: documentNumber || null,
    date_of_birth: dateOfBirth,
    passport_expiry_date: expiryDate,
    nationality: /^[A-Z]{3}$/.test(nationality) ? nationality : null,
    gender: line2[20] === 'M' || line2[20] === 'F' ? line2[20] : null
  };
}

const MRZ_DIGIT_CONFUSABLES = {
  I: '1', L: '1', O: '0', D: '0', B: '8', S: '5', Z: '2', G: '6'
};

function normalizeRawMrzLine(line) {
  return String(line || '').toUpperCase().replace(/[^A-Z0-9<]/g, '');
}

const MRZ_DATA_POSITIONS = [];
for (let index = 13; index <= 18; index += 1) MRZ_DATA_POSITIONS.push(index);
for (let index = 21; index <= 26; index += 1) MRZ_DATA_POSITIONS.push(index);

function mrzAmbiguousPositions(line) {
  return MRZ_DATA_POSITIONS.filter((position) => {
    const character = line[position];
    return character !== undefined && !/\d/.test(character) && character !== '<';
  });
}

function repairMrzDigitPositions(line) {
  const chars = line.split('');
  for (const position of MRZ_DATA_POSITIONS) {
    const character = chars[position];
    if (!character || /\d/.test(character)) continue;
    const fixed = MRZ_DIGIT_CONFUSABLES[character];
    if (fixed) chars[position] = fixed;
  }
  return chars.join('');
}

function repairMrzLine2Variants(line) {
  // Check digits detect errors; they are not an oracle for guessing unknown
  // date digits (many different dates share the same checksum).
  const ambiguous = mrzAmbiguousPositions(line);
  if (ambiguous.length > 3 || ambiguous.some((position) => !MRZ_DIGIT_CONFUSABLES[line[position]])) return [];
  return [repairMrzDigitPositions(line)];
}

function repairMrzLine1(line) {
  return line.replace(/<{3}[<IL1T]*$/, (suffix) => '<'.repeat(suffix.length));
}

function mrzLineCandidates(text) {
  const rawLines = String(text || '').toUpperCase()
    .split(/\r?\n/)
    .map(normalizeRawMrzLine)
    .filter((line) => line.length >= 36 && line.length <= 46);
  const candidates = [];
  const seen = new Set();

  const push = (lines, repaired) => {
    const key = lines.join('|');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ lines, repaired });
  };

  const looksLikeMrzLine1 = (line) => line.startsWith('P') || line.includes('<<');
  const looksLikeMrzLine2 = (line) => !line.startsWith('P') &&
    /^[A-Z0-9<]{30,}$/.test(line) && /\d{6}/.test(line);

  for (const first of rawLines) {
    if (!looksLikeMrzLine1(first)) continue;
    for (const second of rawLines) {
      if (first === second || !looksLikeMrzLine2(second)) continue;
      const strictPair = [
        first.slice(0, 44).padEnd(44, '<'),
        second.slice(0, 44).padEnd(44, '<')
      ];
      push(strictPair, false);
      const repairedLine1 = repairMrzLine1(strictPair[0]);
      for (const repairedLine2 of repairMrzLine2Variants(strictPair[1])) {
        const repairedPair = [repairedLine1, repairedLine2];
        if (repairedPair[0] !== strictPair[0] || repairedPair[1] !== strictPair[1]) {
          push(repairedPair, true);
        }
      }
    }
  }
  return candidates;
}

function parseMrzText(text) {
  const strict = sanitizeMrzLines(text);
  if (strict.length === 2) {
    const diagnostics = mrzDiagnostics(strict);
    if (diagnostics.valid) {
      const parsed = parseMrz(strict);
      if (parsed) return { data: parsed, lines: strict, diagnostics, repaired: false };
    }
    // A syntactically valid pair can still contain recoverable OCR confusions.
  }

  const candidates = mrzLineCandidates(text);
  for (const candidate of candidates) {
    const diagnostics = mrzDiagnostics(candidate.lines);
    if (diagnostics.valid) {
      const parsed = parseMrz(candidate.lines);
      if (parsed) {
        return { data: parsed, lines: candidate.lines, diagnostics, repaired: candidate.repaired };
      }
    }
  }
  const first = candidates[0];
  // The data line has its own field and composite checksums. A damaged name
  // line must not discard a validated number/date, nor supply any guessed name.
  const partials = [];
  for (const line of String(text || '').toUpperCase().split(/\r?\n/).map((value) => value.replace(/\s/g, ''))) {
    if (line.length !== 44 || !/^[A-Z0-9<]+$/.test(line)) continue;
    for (const variant of [line, ...repairMrzLine2Variants(line)]) {
      const data = parseMrzDataLine(variant);
      if (data) partials.push({ data, line: variant, repaired: line !== variant });
    }
  }
  if (new Set(partials.map((entry) => JSON.stringify(entry.data))).size === 1) {
    const partial = partials[0];
    return { data: partial.data, lines: [partial.line], partial: true,
      diagnostics: { valid: false, dataValid: true, failures: ['mrz_name_line_unreadable'] }, repaired: partial.repaired };
  }
  return {
    data: null,
    lines: first ? first.lines : [],
    diagnostics: first ? mrzDiagnostics(first.lines) : null,
    repaired: false
  };
}

function formatMrzDate(value, dateType) {
  if (!/^\d{6}$/.test(value)) return null;
  const currentYear = new Date().getFullYear();
  const twoDigitYear = Number(value.slice(0, 2));
  const year = dateType === 'birth'
    ? (twoDigitYear > currentYear % 100 ? 1900 + twoDigitYear : 2000 + twoDigitYear)
    : Math.floor(currentYear / 100) * 100 + twoDigitYear;
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) return null;
  return `${year}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
}

function sanitizeMrzLines(text) {
  const candidates = String(text || '').toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/[^A-Z0-9<]/g, ''))
    .filter((line) => line.length >= 40 && line.length <= 44);
  const firstLine = candidates.find((line) => line.startsWith('P') && line.includes('<<'));
  const secondLine = candidates.find((line) => line !== firstLine &&
    /^[A-Z0-9<]{9}\d[A-Z<]{3}\d{6}\d[MF<]\d{6}\d/.test(line));
  if (!firstLine || !secondLine) return [];
  return [firstLine.padEnd(44, '<'), secondLine.padEnd(44, '<')];
}

const MRZ_CHECKED_FIELDS = new Set(['passport_number', 'date_of_birth', 'passport_expiry_date']);
const NAME_FIELDS = [
  'first_name_ar', 'father_name_ar', 'last_name_ar',
  'first_name_en', 'father_name_en', 'last_name_en'
];

function mergePassportSources(
  readResult,
  mrzData,
  fallbackResult,
  primarySource = 'paddleocr',
  options = {}
) {
  const data = emptyPassportData();
  const sources = {};
  const confidence = {};
  const reviewFields = [];
  const conflicts = [];
  const readLines = readResult?.lines || [];
  const fallbackLines = fallbackResult?.lines || [];
  const arabic = extractNamedFields(readLines, ARABIC_FIELDS, 'arabic', primarySource);
  const english = extractNamedFields(readLines, ENGLISH_FIELDS, 'english', primarySource);
  const fallbackArabic = extractNamedFields(
    fallbackLines,
    ARABIC_FIELDS,
    'arabic',
    'tesseract'
  );
  const fallbackEnglish = extractNamedFields(
    fallbackLines,
    ENGLISH_FIELDS,
    'english',
    'tesseract'
  );
  const docPrimary = extractDocumentFields(readLines, primarySource);
  const docFallback = extractDocumentFields(fallbackLines, 'tesseract');
  const docExtracted = { ...docFallback.extracted, ...docPrimary.extracted };
  const docSources = {};
  const docConfidence = {};
  const docReviewFields = [];
  const docAgreements = new Set();

  for (const field of DOCUMENT_FIELD_DEFINITIONS) {
    const primaryHit = docPrimary.extracted[field.key];
    const fallbackHit = docFallback.extracted[field.key];
    const hit = primaryHit || fallbackHit;
    if (!hit) {
      if (field.required) docReviewFields.push(field.key);
      continue;
    }
    if (primaryHit && fallbackHit && primaryHit.value === fallbackHit.value) {
      docAgreements.add(field.key);
    }
    docSources[field.key] = hit.source;
    docConfidence[field.key] = hit.confidence;
  }

  const extracted = {
    ...fallbackArabic.extracted,
    ...fallbackEnglish.extracted,
    ...arabic.extracted,
    ...english.extracted
  };

  for (const field of NAME_FIELDS) {
    const visualValue = extracted[field]?.value || '';
    if (visualValue) {
      data[field] = visualValue;
      sources[field] = extracted[field].source;
      confidence[field] = extracted[field].confidence;
    } else if (field === 'first_name_en' || field === 'last_name_en') {
      data[field] = mrzData?.[field] || '';
      sources[field] = data[field] ? 'mrz' : 'unavailable';
      confidence[field] = null;
    } else {
      sources[field] = 'unavailable';
      confidence[field] = null;
    }
    if (!data[field]) reviewFields.push(field);
  }

  if (data.first_name_en || data.last_name_en) {
    data.full_name_en = [data.first_name_en, data.last_name_en]
      .filter(Boolean).join(' ');
    sources.full_name_en = 'derived';
    confidence.full_name_en = Math.min(
      confidence.first_name_en ?? 1,
      confidence.last_name_en ?? 1
    );
  } else {
    sources.full_name_en = 'unavailable';
    confidence.full_name_en = null;
  }

  for (const field of [
    'passport_number', 'date_of_birth', 'passport_expiry_date',
    'nationality', 'gender'
  ]) {
    const mrzValue = mrzData ? mrzData[field] : null;
    const visualHit = docExtracted[field];
    const visualValue = visualHit?.value || null;
    const hasMrzValue = mrzValue !== null && mrzValue !== undefined && mrzValue !== '';

    if (hasMrzValue) {
      data[field] = mrzValue;
      sources[field] = 'mrz';
      confidence[field] = null;
      if (visualValue && valuesConflict(field, visualValue, mrzValue)) {
        conflicts.push({
          field,
          resolution: 'mrz',
          mrz: { source: 'mrz', value: mrzValue },
          visual: { source: visualHit.source, value: visualValue }
        });
      } else if (visualValue) {
        docAgreements.add(field);
      }
    } else if (visualValue) {
      data[field] = visualValue;
      sources[field] = docSources[field];
      confidence[field] = docConfidence[field];
    } else {
      data[field] = null;
      sources[field] = 'unavailable';
      confidence[field] = null;
    }
  }

  for (const field of ['place_of_birth', 'place_of_issue', 'issuing_authority', 'document_type']) {
    const hit = docExtracted[field];
    if (hit) {
      data[field] = hit.value;
      sources[field] = hit.source;
      confidence[field] = hit.confidence;
      if (docAgreements.has(field)) confidence[field] = Math.min(0.99, (hit.confidence ?? 0.8) + 0.08);
    } else {
      sources[field] = 'unavailable';
      confidence[field] = null;
    }
  }

  if (mrzData?.first_name_en && data.first_name_en &&
      data.first_name_en !== mrzData.first_name_en) {
    // MRZ fills only empty name fields above; nothing to conflict here.
  }
  if (mrzData?.last_name_en && data.last_name_en &&
      valuesConflict('last_name_en', data.last_name_en, mrzData.last_name_en)) {
    conflicts.push({
      field: 'last_name_en',
      resolution: 'visual',
      mrz: { source: 'mrz', value: mrzData.last_name_en },
      visual: { source: sources.last_name_en, value: data.last_name_en }
    });
  }
  if (mrzData?.first_name_en && data.first_name_en &&
      valuesConflict('first_name_en', data.first_name_en, mrzData.first_name_en)) {
    conflicts.push({
      field: 'first_name_en',
      resolution: 'visual',
      mrz: { source: 'mrz', value: mrzData.first_name_en },
      visual: { source: sources.first_name_en, value: data.first_name_en }
    });
  }

  const primaryNameHits = { ...arabic.extracted, ...english.extracted };
  const fallbackNameHits = { ...fallbackArabic.extracted, ...fallbackEnglish.extracted };
  for (const field of NAME_FIELDS) {
    const primaryHit = primaryNameHits[field];
    const fallbackHit = fallbackNameHits[field];
    if (primaryHit && fallbackHit && primaryHit.value === fallbackHit.value &&
        primaryHit.value === data[field]) {
      docAgreements.add(field);
      if (confidence[field] !== null) {
        confidence[field] = Math.min(0.99, confidence[field] + 0.08);
      }
    }
  }

  // Expose disagreements between visual engines/passes, including Arabic.
  // Re-reading the same image never counts as independent validation.
  const candidateSets = [arabic.alternatives, english.alternatives, docPrimary.alternatives,
    fallbackArabic.alternatives, fallbackEnglish.alternatives, docFallback.alternatives];
  for (const field of Object.keys(data)) {
    const candidates = candidateSets.flatMap((set) => set[field] || []);
    const selected = data[field];
    if (!selected || sources[field] === 'mrz') continue;
    const unique = new Map(candidates.map((hit) => [hit.value, hit]));
    if (unique.size > 1) {
      docAgreements.delete(field);
      reviewFields.push(field);
      conflicts.push({ field, resolution: 'visual', visual: { source: sources[field], value: selected },
        alternatives: [...unique.values()].map((hit) => ({ source: hit.source, value: hit.value, passId: hit.passId })) });
    }
  }

  const sawDocumentEvidence = Boolean(mrzData) || Object.keys(docExtracted).length > 0;
  if (sawDocumentEvidence) {
    reviewFields.push(...docReviewFields.filter((field) => !data[field]));
  }
  const contract = buildOcrContract({
    data,
    sources,
    confidence,
    reviewFields,
    conflicts,
    agreements: docAgreements,
    mrzAttempts: options.mrzAttempts,
    extraWarnings: options.extraWarnings
  });

  return {
    data,
    sources,
    confidence,
    reviewFields,
    conflicts,
    contract,
    agreements: docAgreements,
    rawLines: readLines,
    fallbackRawLines: fallbackLines
  };
}

const FIELD_AR_LABELS = {
  first_name_ar: 'الاسم الأول بالعربية',
  father_name_ar: 'اسم الأب بالعربية',
  last_name_ar: 'النسبة بالعربية',
  first_name_en: 'الاسم الأول بالإنجليزية',
  father_name_en: 'اسم الأب بالإنجليزية',
  last_name_en: 'النسبة بالإنجليزية',
  full_name_en: 'الاسم الكامل بالإنجليزية',
  passport_number: 'رقم الجواز',
  date_of_birth: 'تاريخ الميلاد',
  passport_expiry_date: 'تاريخ انتهاء الجواز',
  nationality: 'الجنسية',
  gender: 'الجنس',
  place_of_birth: 'محل الميلاد',
  place_of_issue: 'مكان الإصدار',
  issuing_authority: 'جهة الإصدار',
  document_type: 'نوع الوثيقة'
};

function buildOcrContract({
  data,
  sources,
  confidence,
  reviewFields,
  conflicts = [],
  agreements = new Set(),
  mrzAttempts = 1,
  extraWarnings = []
}) {
  const fields = {};
  const warnings = [...extraWarnings];
  const mrzConfidence = mrzAttempts >= 2 ? 0.97 : 0.9;

  for (const key of Object.keys(data)) {
    const value = data[key];
    const hasFieldValue = value !== null && value !== undefined && value !== '';
    const source = hasFieldValue ? (sources[key] || null) : null;
    const conflict = conflicts.find((entry) => entry.field === key);
    const alternatives = conflict
      ? (conflict.alternatives || [conflict.mrz, conflict.visual].filter(Boolean))
      : [];
    const baseConfidence = hasFieldValue
      ? (confidence[key] !== null && confidence[key] !== undefined
        ? confidence[key]
        : source === 'mrz' ? mrzConfidence : null)
      : null;
    fields[key] = {
      value: hasFieldValue ? value : null,
      confidence: baseConfidence,
      source,
      validated: hasFieldValue && ((source === 'mrz' && MRZ_CHECKED_FIELDS.has(key)) || agreements.has(key) && !conflict),
      alternatives
    };
    if (hasFieldValue && baseConfidence !== null && baseConfidence < 0.6) {
      warnings.push({
        code: 'low_confidence',
        field: key,
        message: `ثقة منخفضة في حقل ${FIELD_AR_LABELS[key] || key}`
      });
    }
  }

  for (const conflict of conflicts) {
    warnings.push({
      code: 'source_conflict',
      field: conflict.field,
      message: `تعارض بين مصادر القراءة في ${FIELD_AR_LABELS[conflict.field] || conflict.field}؛ تم اعتماد قيمة ${conflict.resolution === 'mrz' ? 'MRZ' : 'القراءة المرئية'}`
    });
  }
  for (const field of reviewFields) {
    if (!warnings.some((warning) => warning.field === field && warning.code === 'missing_field')) {
      warnings.push({
        code: fields[field]?.value ? 'field_review' : 'missing_field',
        field,
        message: fields[field]?.value ? `يرجى مراجعة الحقل ${FIELD_AR_LABELS[field] || field}` : `الحقل ${FIELD_AR_LABELS[field] || field} يحتاج إلى إدخال يدوي`
      });
    }
  }

  const requiresHumanReview = reviewFields.length > 0 || conflicts.length > 0 ||
    warnings.some((warning) => ['mrz_sources_disagree', 'mrz_inconsistent', 'mrz_check_failed', 'low_quality_image'].includes(warning.code));
  return {
    status: !hasPassportIdentity(data) ? 'failed' : requiresHumanReview ? 'needs_review' : 'ok',
    fields,
    warnings,
    conflicts,
    requiresHumanReview
  };
}

module.exports = {
  buildOcrContract,
  emptyPassportData,
  hasPassportIdentity,
  isPassportFieldLabel,
  extractDocumentFields,
  extractNamedFields,
  isValidMrz,
  mergePassportSources,
  mrzDiagnostics,
  mrzLineCandidates,
  normalizeOcrDate,
  normalizePassportNumber,
  parseMrz,
  parseMrzDataLine,
  parseMrzText,
  sanitizeMrzLines,
  validateDocumentValue,
  validateName
};
