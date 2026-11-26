const express = require('express');
const router = express.Router();
const { authenticateToken, requireStaff } = require('../auth');
const { protectFinancialData } = require('../services/financial-visibility');
router.use(protectFinancialData);
const { query, queryGet, queryRun } = require('./helpers');
const { sumCents, toCents, toDollars, paymentActivity } = require('../services/finance');

const pilgrimNameFields = [
  'first_name_ar',
  'father_name_ar',
  'last_name_ar',
  'first_name_en',
  'father_name_en',
  'last_name_en'
];

function normalizeNameFields(body) {
  if (pilgrimNameFields.some((field) => body[field] != null && typeof body[field] !== 'string')) {
    return { error: 'بيانات الأسماء غير صالحة' };
  }

  const names = Object.fromEntries(
    pilgrimNameFields.map((field) => [field, typeof body[field] === 'string' ? body[field].trim() || null : null])
  );

  if (!names.first_name_ar) {
    return { error: 'الاسم الأول بالعربية مطلوب' };
  }

  return { names };
}

function normalizeDate(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'string') return undefined;

  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date
    ? date
    : undefined;
}

function normalizePassportNumber(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function findPassportDuplicates(passportNumber, excludeId = null) {
  const normalized = normalizePassportNumber(passportNumber);
  if (!normalized) return [];
  let sql = `
    SELECT p.id, p.first_name_ar, p.father_name_ar, p.last_name_ar,
      p.first_name_en, p.father_name_en, p.last_name_en,
      p.nationality, p.passport_number, p.trip_id, t.name AS trip_name,
      p.created_at
    FROM pilgrims p
    JOIN trips t ON p.trip_id = t.id
    WHERE UPPER(regexp_replace(p.passport_number, '[^A-Za-z0-9]', '', 'g')) = ?
  `;
  const params = [normalized];
  if (excludeId !== null) {
    sql += ' AND p.id != ?';
    params.push(excludeId);
  }
  return query(sql, params);
}

function duplicateResponse(duplicates) {
  return {
    error: 'رقم جواز السفر هذا مسجل مسبقاً لحاج آخر. راجع السجلات المطابقة قبل المتابعة.',
    requires_confirmation: true,
    duplicates
  };
}

router.get('/trips/:tripId/pilgrims', authenticateToken, async (req, res) => {
  try {
    const { tripId } = req.params;
    const { search, nationality, hasVisa } = req.query;

    let sql = `
      SELECT
        p.*,
        COALESCE(SUM(pay.amount_usd), 0) as total_received,
        COUNT(pay.id) as payment_count
      FROM pilgrims p
      LEFT JOIN payments pay ON p.id = pay.pilgrim_id
      WHERE p.trip_id = ?
    `;
    const params = [tripId];
    const conditions = [];

    if (search) {
      conditions.push('(p.first_name_ar LIKE ? OR p.father_name_ar LIKE ? OR p.last_name_ar LIKE ? OR p.first_name_en LIKE ? OR p.father_name_en LIKE ? OR p.last_name_en LIKE ? OR p.passport_number LIKE ? OR p.visa_number LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (nationality) {
      conditions.push('p.nationality = ?');
      params.push(nationality);
    }

    if (hasVisa === 'true') {
      conditions.push('p.visa_number IS NOT NULL AND p.visa_number != \'\'');
    } else if (hasVisa === 'false') {
      conditions.push('(p.visa_number IS NULL OR p.visa_number = \'\')');
    }

    if (conditions.length > 0) {
      sql += ' AND ' + conditions.join(' AND ');
    }

    sql += ' GROUP BY p.id ORDER BY p.created_at DESC';

    const pilgrims = await query(sql, params);
    const pilgrimsWithStatus = pilgrims.map((p) => ({
      ...p,
      total_received: toDollars(toCents(p.total_received || 0)),
      payment_status: paymentActivity(p.total_received || 0)
    }));

    res.json({ pilgrims: pilgrimsWithStatus });
  } catch (err) {
    console.error('Get pilgrims error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/pilgrims/lookup-passport', authenticateToken, async (req, res) => {
  try {
    const passportNumber = typeof req.query.number === 'string' ? req.query.number : '';
    if (normalizePassportNumber(passportNumber).length < 4) {
      return res.status(400).json({ error: 'رقم جواز غير صالح' });
    }
    const duplicates = await findPassportDuplicates(passportNumber);
    res.json({ matches: duplicates });
  } catch (err) {
    console.error('Passport lookup error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/pilgrims/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const pilgrim = await queryGet('SELECT * FROM pilgrims WHERE id = ?', [id]);

    if (!pilgrim) {
      return res.status(404).json({ error: 'السجل غير موجود' });
    }

    if (req.user.role !== 'admin') return res.json(pilgrim);

    const payments = await query('SELECT * FROM payments WHERE pilgrim_id = ? ORDER BY payment_date DESC', [id]);
    const paymentIds = payments.map((payment) => payment.id);
    const denominationRows = paymentIds.length
      ? await query(
        'SELECT * FROM cash_payment_denominations WHERE payment_id = ANY(?::integer[]) ORDER BY id',
        [paymentIds]
      )
      : [];
    const denominationsByPayment = new Map();
    for (const denomination of denominationRows) {
      const current = denominationsByPayment.get(denomination.payment_id) || [];
      current.push({ ...denomination, subtotal: Number(denomination.subtotal) });
      denominationsByPayment.set(denomination.payment_id, current);
    }
    const totalReceivedCents = sumCents(payments.map((payment) => payment.amount_usd));

    res.json({
      ...pilgrim,
      payments: payments.map((payment) => ({
        ...payment,
        amount_usd: Number(payment.amount_usd),
        cash_denominations: denominationsByPayment.get(payment.id) || []
      })),
      total_received: toDollars(totalReceivedCents),
      payment_status: paymentActivity(toDollars(totalReceivedCents))
    });
  } catch (err) {
    console.error('Get pilgrim error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/pilgrims', authenticateToken, requireStaff, async (req, res) => {
  try {
    const {
      trip_id,
      first_name_ar,
      father_name_ar,
      last_name_ar,
      first_name_en,
      father_name_en,
      last_name_en,
      nationality,
      passport_number,
      passport_expiry_date,
      date_of_birth,
      origin_city,
      destination_city,
      gender,
      visa_number,
      notes
    } = req.body;

    const nameFields = normalizeNameFields(req.body);
    if (nameFields.error) {
      return res.status(400).json({ error: nameFields.error });
    }

    const tripId = Number(trip_id);
    const normalizeText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    const {
      first_name_ar: fNameAr,
      father_name_ar: fatNameAr,
      last_name_ar: lNameAr,
      first_name_en: fNameEn,
      father_name_en: fatNameEn,
      last_name_en: lNameEn
    } = nameFields.names;

    const normNationality = normalizeText(nationality);
    const normPassport = normalizeText(passport_number);

    if (!Number.isSafeInteger(tripId) || tripId <= 0 || !normNationality || !normPassport) {
      return res.status(400).json({ error: 'الرحلة والجنسية ورقم جواز السفر مطلوبة' });
    }

    const passportExpiryDate = normalizeDate(passport_expiry_date);
    const dateOfBirth = normalizeDate(date_of_birth);
    if (passportExpiryDate === undefined || dateOfBirth === undefined) {
      return res.status(400).json({ error: 'تاريخ انتهاء الجواز أو تاريخ الميلاد غير صالح' });
    }

    const duplicates = await findPassportDuplicates(normPassport);
    if (duplicates.length > 0 && req.body.confirm_duplicate !== true) {
      return res.status(409).json(duplicateResponse(duplicates));
    }

    const result = await queryRun(
      `INSERT INTO pilgrims (
        trip_id, first_name_ar, father_name_ar, last_name_ar, 
        first_name_en, father_name_en, last_name_en, 
        nationality, passport_number, passport_expiry_date,
        date_of_birth, origin_city, destination_city, gender, visa_number,
        visa_document_path, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        tripId,
        fNameAr, fatNameAr, lNameAr,
        fNameEn, fatNameEn, lNameEn,
        normNationality,
        normPassport,
        passportExpiryDate,
        dateOfBirth,
        normalizeText(origin_city) || 'دمشق',
        normalizeText(destination_city) || 'جدة',
        normalizeText(gender),
        normalizeText(visa_number),
        null,
        normalizeText(notes)
      ]
    );

    res.status(201).json({ message: 'تمت إضافة السجل بنجاح', id: result.lastID });
  } catch (error) {
    console.error('Pilgrim creation failed:', error.code || error.name || 'unknown error');
    if (error.code === '23505') {
      return res.status(400).json({ error: 'رقم جواز السفر موجود بالفعل' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'الرحلة المحددة غير موجودة' });
    }
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.put('/pilgrims/:id', authenticateToken, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      first_name_ar, father_name_ar, last_name_ar, 
      first_name_en, father_name_en, last_name_en, 
      nationality, passport_number, passport_expiry_date, 
      date_of_birth, origin_city, destination_city, gender, visa_number, visa_document_path,
      notes
    } = req.body;

    const nameFields = normalizeNameFields(req.body);
    if (nameFields.error) {
      return res.status(400).json({ error: nameFields.error });
    }

    const normalizeText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    const normalizedNationality = normalizeText(nationality);
    const normalizedPassport = normalizeText(passport_number);
    if (!normalizedNationality || !normalizedPassport) {
      return res.status(400).json({ error: 'الجنسية ورقم جواز السفر مطلوبة' });
    }

    const duplicates = await findPassportDuplicates(normalizedPassport, Number(id));
    if (duplicates.length > 0 && req.body.confirm_duplicate !== true) {
      return res.status(409).json(duplicateResponse(duplicates));
    }

    const result = await queryRun(
      `UPDATE pilgrims SET
        first_name_ar = ?, father_name_ar = ?, last_name_ar = ?,
        first_name_en = ?, father_name_en = ?, last_name_en = ?,
        nationality = ?, passport_number = ?, passport_expiry_date = ?,
        date_of_birth = ?, origin_city = ?, destination_city = ?, gender = ?, visa_number = ?,
        notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        nameFields.names.first_name_ar, nameFields.names.father_name_ar, nameFields.names.last_name_ar,
        nameFields.names.first_name_en, nameFields.names.father_name_en, nameFields.names.last_name_en,
        normalizedNationality, normalizedPassport,
        normalizeText(passport_expiry_date), normalizeText(date_of_birth),
        normalizeText(origin_city) || 'دمشق', normalizeText(destination_city) || 'جدة',
        normalizeText(gender), normalizeText(visa_number),
        normalizeText(notes), id
      ]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'السجل غير موجود' });
    }

    res.json({ message: 'تم تحديث البيانات بنجاح' });
  } catch (err) {
    console.error('Update pilgrim error:', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'رقم جواز السفر موجود بالفعل' });
    }
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.delete('/pilgrims/:id', authenticateToken, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const result = req.user.role === 'admin'
      ? await queryRun('DELETE FROM pilgrims WHERE id = ?', [id])
      : await queryRun(`DELETE FROM pilgrims WHERE id = ? AND NOT EXISTS (
          SELECT 1 FROM payments WHERE pilgrim_id = pilgrims.id
        )`, [id]);

    if (result.changes === 0) {
      if (req.user.role !== 'admin' && await queryGet('SELECT id FROM pilgrims WHERE id = ?', [id])) {
        return res.status(403).json({ error: 'يرجى مراجعة المدير لحذف هذا السجل' });
      }
      return res.status(404).json({ error: 'السجل غير موجود' });
    }

    res.json({ message: 'تم حذف السجل بنجاح' });
  } catch (err) {
    console.error('Delete pilgrim error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
