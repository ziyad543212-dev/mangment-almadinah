const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../auth');
const { query, queryGet, queryRun } = require('./helpers');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT
        pay.*,
        p.first_name_ar, p.father_name_ar, p.last_name_ar,
        p.first_name_en, p.father_name_en, p.last_name_en,
        p.nationality,
        t.name as trip_name
      FROM payments pay
      JOIN pilgrims p ON pay.pilgrim_id = p.id
      JOIN trips t ON p.trip_id = t.id
    `;
    const params = [];

    if (search) {
      sql += ' WHERE p.first_name_ar LIKE ? OR p.last_name_ar LIKE ? OR p.passport_number LIKE ?';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY pay.payment_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const payments = await query(sql, params);

    let countQuery = 'SELECT COUNT(*) as total FROM payments pay JOIN pilgrims p ON pay.pilgrim_id = p.id JOIN trips t ON p.trip_id = t.id';
    if (search) {
      countQuery += ' WHERE p.first_name_ar LIKE ? OR p.last_name_ar LIKE ? OR p.passport_number LIKE ?';
    }
    const countResult = await queryGet(countQuery, params.slice(0, -2));

    res.json({
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.total) || 0,
        totalPages: Math.ceil((parseInt(countResult.total) || 0) / limit)
      }
    });
  } catch (err) {
    console.error('Get payments error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { pilgrim_id, amount_usd, payment_method, transaction_reference, notes } = req.body;

    if (!pilgrim_id || !amount_usd || !payment_method) {
      return res.status(400).json({ error: 'معرف الحاج والمبلغ وطريقة الدفع مطلوبة' });
    }

    if (parseFloat(amount_usd) <= 0) {
      return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
    }

    const result = await queryRun(
      'INSERT INTO payments (pilgrim_id, amount_usd, payment_method, transaction_reference, notes) VALUES (?, ?, ?, ?, ?)',
      [pilgrim_id, amount_usd, payment_method, transaction_reference || null, notes || null]
    );

    res.status(201).json({ message: 'تمت إضافة الدفعة بنجاح', id: result.lastID });
  } catch (err) {
    console.error('Create payment error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await queryRun('DELETE FROM payments WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'الدفعة غير موجودة' });
    }

    res.json({ message: 'تم حذف الدفعة بنجاح' });
  } catch (err) {
    console.error('Delete payment error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
