const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../auth');
const { query, queryGet, queryRun } = require('./helpers');
const db = require('../database');
const { toCents, toDollars } = require('../services/finance');

const paymentMethods = new Set(['نقدًا', 'شام كاش']);
const cashDenominations = new Set([1, 5, 10, 20, 50, 100]);

router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const pageNumber = Number(page);
    const pageSize = Number(limit);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 ||
        !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'بيانات تقسيم الصفحات غير صالحة' });
    }
    const offset = (pageNumber - 1) * pageSize;

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
      sql += ' WHERE (p.first_name_ar LIKE ? OR p.last_name_ar LIKE ? OR p.passport_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY pay.payment_date DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const payments = (await query(sql, params)).map((payment) => ({
      ...payment,
      amount_usd: Number(payment.amount_usd)
    }));

    let countQuery = 'SELECT COUNT(*) as total FROM payments pay JOIN pilgrims p ON pay.pilgrim_id = p.id JOIN trips t ON p.trip_id = t.id';
    if (search) {
      countQuery += ' WHERE p.first_name_ar LIKE ? OR p.last_name_ar LIKE ? OR p.passport_number LIKE ?';
    }
    const countResult = await queryGet(countQuery, params.slice(0, -2));

    res.json({
      payments,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total: parseInt(countResult.total) || 0,
        totalPages: Math.ceil((parseInt(countResult.total) || 0) / pageSize)
      }
    });
  } catch (err) {
    console.error('Get payments error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { pilgrim_id, amount_usd, payment_method, transaction_reference, notes } = req.body;
    const pilgrimId = Number(pilgrim_id);
    if (!Number.isSafeInteger(pilgrimId) || pilgrimId < 1 ||
        amount_usd === undefined || !paymentMethods.has(payment_method)) {
      return res.status(400).json({ error: 'معرف الحاج والمبلغ وطريقة الدفع مطلوبة' });
    }

    let amountCents;
    try {
      amountCents = toCents(amount_usd);
    } catch {
      return res.status(400).json({ error: 'المبلغ غير صالح' });
    }
    if (amountCents <= 0n) {
      return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
    }

    const denominations = req.body.cash_denominations;
    if (payment_method === 'شام كاش' && denominations?.length) {
      return res.status(400).json({ error: 'تفاصيل الفئات النقدية متاحة للدفعات النقدية فقط' });
    }
    if (denominations !== undefined && !Array.isArray(denominations)) {
      return res.status(400).json({ error: 'تفاصيل الفئات النقدية غير صالحة' });
    }

    let denominationCents = 0n;
    if (Array.isArray(denominations)) {
      for (const item of denominations) {
        if (!item || !cashDenominations.has(Number(item.denomination)) ||
            !Number.isSafeInteger(Number(item.quantity)) ||
            Number(item.quantity) < 1 || Number(item.quantity) > 100_000) {
          return res.status(400).json({ error: 'إحدى فئات النقد أو كميتها غير صالحة' });
        }
        denominationCents += BigInt(Number(item.denomination) * Number(item.quantity) * 100);
      }
      if (denominations.length > 0 && denominationCents !== amountCents) {
        return res.status(400).json({ error: 'مجموع الفئات النقدية لا يساوي مبلغ الدفعة' });
      }
    }

    const result = await db.transaction(async ({ query: transactionQuery }) => {
      const payment = await transactionQuery(
        `INSERT INTO payments
          (pilgrim_id, amount_usd, payment_method, transaction_reference, notes)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        [
          pilgrimId,
          toDollars(amountCents),
          payment_method,
          typeof transaction_reference === 'string' ? transaction_reference.trim() || null : null,
          typeof notes === 'string' ? notes.trim() || null : null
        ]
      );
      for (const item of denominations || []) {
        const subtotal = Number(item.denomination) * Number(item.quantity);
        await transactionQuery(
          `INSERT INTO cash_payment_denominations (payment_id, denomination, quantity, subtotal)
           VALUES (?, ?, ?, ?)`,
          [payment.rows[0].id, Number(item.denomination), Number(item.quantity), subtotal]
        );
      }
      return payment.rows[0].id;
    });

    res.status(201).json({ message: 'تمت إضافة الدفعة بنجاح', id: result });
  } catch (err) {
    console.error('Create payment error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
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
