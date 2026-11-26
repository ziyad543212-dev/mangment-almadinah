const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { authenticateToken, requireStaff } = require('../auth');
const { queryGet, queryRun } = require('./helpers');
const { getUploadDirectory } = require('../services/storage');

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 }
}).single('document');

const fileTypes = [
  { extension: '.pdf', mimeType: 'application/pdf', matches: (buffer) => buffer.subarray(0, 5).toString() === '%PDF-' },
  { extension: '.jpg', mimeType: 'image/jpeg', matches: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  { extension: '.png', mimeType: 'image/png', matches: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }
];

function getStoredFilePath(storedPath, uploadDirectory) {
  if (typeof storedPath !== 'string' || !storedPath.startsWith('uploads/')) return null;
  const filename = storedPath.slice('uploads/'.length);
  if (!/^[\da-f-]{36}\.(pdf|jpg|png)$/.test(filename)) return null;
  const resolvedPath = path.resolve(uploadDirectory, filename);
  return path.dirname(resolvedPath) === uploadDirectory ? resolvedPath : null;
}

router.post('/:id/visa-document', authenticateToken, requireStaff, (req, res, next) => {
  upload(req, res, (error) => {
    if (!error) return next();
    const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: 'الملف غير صالح أو يتجاوز الحد المسموح (15 ميغابايت)' });
  });
}, async (req, res) => {
  const pilgrimId = Number(req.params.id);
  if (!Number.isSafeInteger(pilgrimId) || pilgrimId < 1) {
    return res.status(400).json({ error: 'معرف المعتمر غير صالح' });
  }
  if (!req.file || !req.file.buffer.length) {
    return res.status(400).json({ error: 'ملف الوثيقة مطلوب' });
  }

  const fileType = fileTypes.find((type) =>
    req.file.mimetype === type.mimeType && type.matches(req.file.buffer)
  );
  if (!fileType) {
    return res.status(415).json({ error: 'الصيغ المدعومة هي PDF وJPEG وPNG فقط' });
  }

  try {
    const pilgrim = await queryGet('SELECT id, visa_document_path FROM pilgrims WHERE id = ?', [pilgrimId]);
    if (!pilgrim) return res.status(404).json({ error: 'المعتمر غير موجود' });

    const uploadDirectory = getUploadDirectory();
    await fs.mkdir(uploadDirectory, { recursive: true });
    const filename = `${crypto.randomUUID()}${fileType.extension}`;
    const absolutePath = path.join(uploadDirectory, filename);
    await fs.writeFile(absolutePath, req.file.buffer, { flag: 'wx', mode: 0o600 });

    try {
      await queryRun(
        'UPDATE pilgrims SET visa_document_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [`uploads/${filename}`, pilgrimId]
      );
    } catch (error) {
      await fs.unlink(absolutePath).catch((cleanupError) => {
        console.error('Unable to remove an unreferenced document:', cleanupError.message);
      });
      throw error;
    }

    const previousPath = getStoredFilePath(pilgrim.visa_document_path, uploadDirectory);
    if (previousPath && previousPath !== absolutePath) {
      await fs.unlink(previousPath).catch((error) => {
        if (error.code !== 'ENOENT') console.error('Unable to remove replaced document:', error.message);
      });
    }
    res.status(201).json({ message: 'تم رفع الوثيقة بنجاح' });
  } catch (error) {
    console.error('Visa document upload failed:', error.message);
    res.status(500).json({ error: 'تعذر حفظ الوثيقة' });
  }
});

router.get('/:id/visa-document', authenticateToken, requireStaff, async (req, res) => {
  const pilgrimId = Number(req.params.id);
  if (!Number.isSafeInteger(pilgrimId) || pilgrimId < 1) {
    return res.status(400).json({ error: 'معرف المعتمر غير صالح' });
  }

  try {
    const pilgrim = await queryGet('SELECT visa_document_path FROM pilgrims WHERE id = ?', [pilgrimId]);
    if (!pilgrim) return res.status(404).json({ error: 'المعتمر غير موجود' });

    const uploadDirectory = getUploadDirectory();
    const absolutePath = getStoredFilePath(pilgrim.visa_document_path, uploadDirectory);
    if (!absolutePath) return res.status(404).json({ error: 'لا توجد وثيقة محفوظة لهذا المعتمر' });

    const content = await fs.readFile(absolutePath);
    const extension = path.extname(absolutePath);
    const mimeType = fileTypes.find((type) => type.extension === extension)?.mimeType;
    if (!mimeType) return res.status(404).json({ error: 'نوع الوثيقة المخزنة غير صالح' });
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="visa-document${extension}"`,
      'Content-Type': mimeType,
      'X-Content-Type-Options': 'nosniff'
    });
    res.send(content);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'ملف الوثيقة غير موجود' });
    console.error('Visa document download failed:', error.message);
    res.status(500).json({ error: 'تعذر تحميل الوثيقة' });
  }
});

module.exports = router;
