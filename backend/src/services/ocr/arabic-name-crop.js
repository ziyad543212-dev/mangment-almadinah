const sharp = require('sharp');

function textForLabels(text) {
  return String(text || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
}

function nameLabel(text) {
  const value = textForLabels(text);
  if (/(?:اسم|اسر|سم|مم|م)\s*الام|MOTHER/iu.test(value)) return null;
  if (/(?:اسم|سم)\s*(?:الاب|الوالد)|^(?:FATHER|PATHER)[’'S\s]*NAME\b/iu.test(value)) return 'father_name_ar';
  if (/^(?:النسبه|نسبه|السبه|الشهره|الكنيه|اللقب|اسم العائله|العائله)(?:\s|[:/]|$)|^(?:SURNAME|SURMAME|FAMILY\s+NAME|LAST\s+NAME)\b/iu.test(value)) return 'last_name_ar';
  if (/^(?:الاسم(?: الشخصي| الاول)?)(?:\s|[:/]|$)|^(?:NAME|FIRST\s+NAMES?|GIVEN\s+NAMES?)\b/iu.test(value)) return 'first_name_ar';
  return null;
}

function validBounds(bounds) {
  return bounds && ['left', 'top', 'width', 'height'].every((key) => Number.isFinite(bounds[key])) &&
    bounds.left >= 0 && bounds.top >= 0 && bounds.width > 0 && bounds.height > 0 &&
    bounds.left + bounds.width <= 1.001 && bounds.top + bounds.height <= 1.001;
}

function centerY(line) { return line.bounds.top + line.bounds.height / 2; }

// Only copy observed name text boxes onto a white canvas. Never fall back to
// uploading the passport, photo, number, date rows or MRZ when localization fails.
async function createPrivateArabicNameCrop(imageBuffer, lines) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) return null;
  const metadata = await sharp(imageBuffer, { limitInputPixels: 40_000_000 }).metadata();
  const { width, height } = metadata;
  if (!width || !height) return null;
  const eligible = (lines || []).filter((line) => validBounds(line.bounds) &&
    typeof line.text === 'string' && line.text.length <= 160 &&
    (line.confidence === null || line.confidence === undefined || line.confidence >= 0.45));
  const anchors = eligible.map((line) => ({ ...line, field: nameLabel(line.text) })).filter((line) => line.field);
  const arabicAnchors = anchors.filter((line) => /[\u0621-\u064A]/u.test(line.text));
  if (!arabicAnchors.length || new Set(anchors.map((line) => line.field)).size < 2) return null;

  const selected = new Map();
  const key = (line) => ['left', 'top', 'width', 'height'].map((part) => line.bounds[part].toFixed(3)).join(':');
  const arabicValues = eligible.filter((line) => /[\u0621-\u064A]/u.test(line.text) &&
    !/[A-Za-z0-9٠-٩۰-۹<]/u.test(line.text) &&
    !/(?:تاريخ|ميلاد|ولاده|جواز|رقم|الجنس|الام|الصلاحيه)/iu.test(textForLabels(line.text)));
  for (const field of ['first_name_ar', 'last_name_ar', 'father_name_ar']) {
    const fieldAnchors = anchors.filter((line) => line.field === field)
      .sort((a, b) => Number(/[\u0621-\u064A]/u.test(b.text)) - Number(/[\u0621-\u064A]/u.test(a.text)) ||
        (b.confidence ?? 0) - (a.confidence ?? 0));
    const anchor = fieldAnchors[0];
    if (!anchor) continue;
    // A detected title can be bilingual, but digit-bearing rows are never sent.
    if (/[0-9٠-٩۰-۹<]/u.test(anchor.text)) continue;
    selected.set(key(anchor), anchor);
    const candidates = arabicValues.filter((line) => {
      const ownField = nameLabel(line.text);
      if (ownField && ownField !== field) return false;
      const nearColumn = arabicAnchors.some((other) =>
        Math.abs((line.bounds.left + line.bounds.width / 2) - (other.bounds.left + other.bounds.width / 2)) <= 0.22);
      return nearColumn && Math.abs(centerY(line) - centerY(anchor)) <= Math.max(anchor.bounds.height, line.bounds.height) * 1.8;
    }).sort((a, b) => Math.abs(centerY(a) - centerY(anchor)) - Math.abs(centerY(b) - centerY(anchor)) ||
      (b.confidence ?? 0) - (a.confidence ?? 0));
    // At most one matching row, plus fragments overlapping that same row.
    const row = candidates[0];
    if (row) {
      selected.set(key(row), row);
      for (const fragment of candidates) {
        if (Math.abs(centerY(fragment) - centerY(row)) <= Math.max(row.bounds.height, fragment.bounds.height) * 0.5) {
          selected.set(key(fragment), fragment);
        }
      }
    }
  }
  const regions = [...selected.values()];
  if (!regions.length) return null;
  const boxes = regions.map((line) => {
    const b = line.bounds;
    const pad = Math.max(1, Math.min(3, Math.round(b.height * height * 0.06)));
    const left = Math.max(0, Math.floor(b.left * width) - pad);
    const top = Math.max(0, Math.floor(b.top * height) - pad);
    return { left, top, width: Math.min(width, Math.ceil((b.left + b.width) * width) + pad) - left,
      height: Math.min(height, Math.ceil((b.top + b.height) * height) + pad) - top };
  });
  if (boxes.some((box) => box.height > height * 0.14 || box.width > width * 0.8)) return null;
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  if (bottom - top > height * 0.62 || boxes.length > 18) return null;
  const overlays = [];
  for (const box of boxes) {
    overlays.push({ input: await sharp(imageBuffer).extract(box).png().toBuffer(),
      left: box.left - left + 12, top: box.top - top + 12 });
  }
  // Encoding a fresh canvas strips source metadata and all pixels outside boxes.
  const image = await sharp({ create: { width: right - left + 24, height: bottom - top + 24,
    channels: 3, background: '#ffffff' } }).composite(overlays).png().toBuffer();
  const buffer = await sharp(image).resize({ width: 1800, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 95 }).toBuffer();
  return { buffer, regionCount: boxes.length };
}

module.exports = { createPrivateArabicNameCrop, nameLabel };
