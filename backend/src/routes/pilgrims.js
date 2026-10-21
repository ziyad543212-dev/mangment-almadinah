const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../auth');
const { query, queryGet, queryRun } = require('./helpers');

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
      payment_status: parseFloat(p.total_received) > 0 ? 'مدفوع جزئيًا' : 'غير مدفوع'
    }));

    res.json({ pilgrims: pilgrimsWithStatus });
  } catch (err) {
    console.error('Get pilgrims error:', err);
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

    const payments = await query('SELECT * FROM payments WHERE pilgrim_id = ? ORDER BY payment_date DESC', [id]);
    const totalReceived = payments.reduce((sum, p) => sum + parseFloat(p.amount_usd), 0);

    res.json({
      ...pilgrim,
      payments: payments.map(p => ({ ...p, cash_denominations: [] })),
      total_received: totalReceived,
      payment_status: totalReceived > 0 ? 'مدفوع جزئيًا' : 'غير مدفوع'
    });
  } catch (err) {
    console.error('Get pilgrim error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/pilgrims', authenticateToken, async (req, res) => {
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
      gender,
      visa_number,
      visa_document_path,
      notes
    } = req.body;

    const tripId = Number(trip_id);
    const normalizeText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

    const fNameAr = normalizeText(first_name_ar);
    const fatNameAr = normalizeText(father_name_ar);
    const lNameAr = normalizeText(last_name_ar);

    const fNameEn = normalizeText(first_name_en);
    const fatNameEn = normalizeText(father_name_en);
    const lNameEn = normalizeText(last_name_en);

    const normNationality = normalizeText(nationality);
    const normPassport = normalizeText(passport_number);

    if (!Number.isSafeInteger(tripId) || tripId <= 0 || !normNationality || !normPassport) {
      return res.status(400).json({ error: 'الرحلة والجنسية ورقم جواز السفر مطلوبة' });
    }

    const result = await queryRun(
      `INSERT INTO pilgrims (
        trip_id, first_name_ar, father_name_ar, last_name_ar, 
        first_name_en, father_name_en, last_name_en, 
        nationality, passport_number, passport_expiry_date, 
        date_of_birth, gender, visa_number, visa_document_path, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        tripId,
        fNameAr, fatNameAr, lNameAr,
        fNameEn, fatNameEn, lNameEn,
        normNationality,
        normPassport,
        normalizeText(passport_expiry_date),
        normalizeText(date_of_birth),
        normalizeText(gender),
        normalizeText(visa_number),
        normalizeText(visa_document_path),
        normalizeText(notes)
      ]
    );

    res.status(201).json({ message: 'تمت إضافة السجل بنجاح', id: result.lastID });
  } catch (error) {
    console.error('Pilgrim creation error:', error);
    if (error.message && error.message.includes('unique')) {
      return res.status(400).json({ error: 'رقم جواز السفر موجود بالفعل' });
    }
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.put('/pilgrims/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      first_name_ar, father_name_ar, last_name_ar, 
      first_name_en, father_name_en, last_name_en, 
      nationality, passport_number, passport_expiry_date, 
      date_of_birth, gender, visa_number, visa_document_path, notes 
    } = req.body;

    const normalizeText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    const normalizedNationality = normalizeText(nationality);
    const normalizedPassport = normalizeText(passport_number);
    if (!normalizedNationality || !normalizedPassport) {
      return res.status(400).json({ error: 'الجنسية ورقم جواز السفر مطلوبة' });
    }

    const result = await queryRun(
      `UPDATE pilgrims SET 
        first_name_ar = ?, father_name_ar = ?, last_name_ar = ?, 
        first_name_en = ?, father_name_en = ?, last_name_en = ?, 
        nationality = ?, passport_number = ?, passport_expiry_date = ?, 
        date_of_birth = ?, gender = ?, visa_number = ?, 
        visa_document_path = ?, notes = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?`,
      [
        normalizeText(first_name_ar), normalizeText(father_name_ar), normalizeText(last_name_ar),
        normalizeText(first_name_en), normalizeText(father_name_en), normalizeText(last_name_en),
        normalizedNationality, normalizedPassport,
        normalizeText(passport_expiry_date), normalizeText(date_of_birth),
        normalizeText(gender), normalizeText(visa_number),
        normalizeText(visa_document_path), normalizeText(notes), id
      ]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'السجل غير موجود' });
    }

    res.json({ message: 'تم تحديث البيانات بنجاح' });
  } catch (err) {
    console.error('Update pilgrim error:', err);
    if (err.message && err.message.includes('unique')) {
      return res.status(400).json({ error: 'رقم جواز السفر موجود بالفعل' });
    }
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.delete('/pilgrims/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await queryRun('DELETE FROM pilgrims WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'السجل غير موجود' });
    }

    res.json({ message: 'تم حذف السجل بنجاح' });
  } catch (err) {
    console.error('Delete pilgrim error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
