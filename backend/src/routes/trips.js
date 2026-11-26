const express = require('express');
const router = express.Router();
const { authenticateToken, requireStaff } = require('../auth');
const { protectFinancialData } = require('../services/financial-visibility');
router.use(protectFinancialData);
const { query, queryGet, queryRun } = require('./helpers');
const { toCents, toDollars, paymentActivity } = require('../services/finance');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, startDate, endDate, sortBy = 'trip_date', sortOrder = 'DESC' } = req.query;
    const pageNumber = Number(page);
    const pageSize = Number(limit);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 ||
        !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'بيانات تقسيم الصفحات غير صالحة' });
    }
    const offset = (pageNumber - 1) * pageSize;

    let sql = `
      SELECT
        t.*,
        COUNT(DISTINCT p.id) as pilgrim_count,
        COALESCE(SUM(pay.total_received), 0) as total_received
      FROM trips t
      LEFT JOIN pilgrims p ON t.id = p.trip_id
      LEFT JOIN (
        SELECT pilgrim_id, SUM(amount_usd) AS total_received
        FROM payments
        GROUP BY pilgrim_id
      ) pay ON p.id = pay.pilgrim_id
    `;
    const params = [];
    const conditions = [];

    if (search) {
      conditions.push('t.name LIKE ?');
      params.push(`%${search}%`);
    }

    if (startDate) {
      conditions.push('t.trip_date >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('t.trip_date <= ?');
      params.push(endDate);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' GROUP BY t.id';

    const allowedSortFields = ['name', 'trip_date', 'created_at'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'trip_date';
    const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortField} ${sortDirection}`;

    sql += ' LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const trips = (await query(sql, params)).map((trip) => {
      const costCents = toCents(trip.trip_cost_usd || 0);
      const receivedCents = toCents(trip.total_received || 0);
      return {
        ...trip,
        trip_cost_usd: toDollars(costCents),
        total_received: toDollars(receivedCents),
        net_trip: toDollars(receivedCents - costCents)
      };
    });

    let countQuery = 'SELECT COUNT(*) as total FROM trips t';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const countResult = await queryGet(countQuery, params.slice(0, -2));

    res.json({
      trips,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total: parseInt(countResult.total) || 0,
        totalPages: Math.ceil((parseInt(countResult.total) || 0) / pageSize)
      }
    });
  } catch (err) {
    console.error('Get trips error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const trip = await queryGet('SELECT * FROM trips WHERE id = ?', [id]);

    if (!trip) {
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    const pilgrims = await query(`
      SELECT
        p.*,
        COALESCE(pay.total_received, 0) as total_received,
        COALESCE(pay.payment_count, 0) as payment_count
      FROM pilgrims p
      LEFT JOIN (
        SELECT pilgrim_id, SUM(amount_usd) AS total_received, COUNT(*) AS payment_count
        FROM payments
        GROUP BY pilgrim_id
      ) pay ON p.id = pay.pilgrim_id
      WHERE p.trip_id = ?
    `, [id]);

    const totalReceivedCents = pilgrims.reduce((sum, pilgrim) => sum + toCents(pilgrim.total_received || 0), 0n);
    const tripCostCents = toCents(trip.trip_cost_usd || 0);
    const netTripCents = totalReceivedCents - tripCostCents;

    res.json({
      ...trip,
      trip_cost_usd: toDollars(tripCostCents),
      pilgrims: pilgrims.map(p => ({
        ...p,
        total_received: toDollars(toCents(p.total_received || 0)),
        payment_count: Number(p.payment_count),
        payment_status: paymentActivity(p.total_received || 0)
      })),
      total_received: toDollars(totalReceivedCents),
      total_outstanding: null,
      operating_deficit: toDollars(tripCostCents > totalReceivedCents ? tripCostCents - totalReceivedCents : 0n),
      net_trip: toDollars(netTripCents),
      pilgrim_count: pilgrims.length
    });
  } catch (err) {
    console.error('Get trip error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', authenticateToken, requireStaff, async (req, res) => {
  try {
    const { name, trip_date, trip_cost_usd, notes } = req.body;

    if (typeof name !== 'string' || !name.trim() || name.length > 200 ||
        typeof trip_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(trip_date)) {
      return res.status(400).json({ error: 'اسم الرحلة وتاريخ الرحلة مطلوبان' });
    }
    let tripCostCents;
    try {
      tripCostCents = toCents(req.user.role === 'admin' ? trip_cost_usd ?? 0 : 0);
      if (tripCostCents < 0n) throw new RangeError();
    } catch {
      return res.status(400).json({ error: 'تكلفة الرحلة يجب أن تكون مبلغاً صالحاً غير سالب' });
    }

    const result = await queryRun(
      'INSERT INTO trips (name, trip_date, trip_cost_usd, notes) VALUES (?, ?, ?, ?) RETURNING id',
      [name.trim(), trip_date, toDollars(tripCostCents), typeof notes === 'string' ? notes.trim() || null : null]
    );

    res.status(201).json({ message: 'تمت إضافة الرحلة بنجاح', id: result.lastID });
  } catch (err) {
    console.error('Create trip error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.put('/:id', authenticateToken, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, trip_date, trip_cost_usd, notes } = req.body;

    if (typeof name !== 'string' || !name.trim() || name.length > 200 ||
        typeof trip_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(trip_date)) {
      return res.status(400).json({ error: 'اسم الرحلة وتاريخ الرحلة مطلوبان' });
    }
    let tripCostCents;
    try {
      tripCostCents = toCents(req.user.role === 'admin' ? trip_cost_usd ?? 0 : 0);
      if (tripCostCents < 0n) throw new RangeError();
    } catch {
      return res.status(400).json({ error: 'تكلفة الرحلة يجب أن تكون مبلغاً صالحاً غير سالب' });
    }

    const result = await queryRun(
      'UPDATE trips SET name = ?, trip_date = ?, trip_cost_usd = CASE WHEN ? THEN ? ELSE trip_cost_usd END, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name.trim(), trip_date, req.user.role === 'admin', toDollars(tripCostCents), typeof notes === 'string' ? notes.trim() || null : null, id]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    res.json({ message: 'تم تحديث الرحلة بنجاح' });
  } catch (err) {
    console.error('Update trip error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.delete('/:id', authenticateToken, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    const result = req.user.role === 'admin'
      ? await queryRun('DELETE FROM trips WHERE id = ?', [id])
      : await queryRun(`DELETE FROM trips WHERE id = ? AND NOT EXISTS (
          SELECT 1 FROM payments pay JOIN pilgrims p ON p.id = pay.pilgrim_id WHERE p.trip_id = trips.id
        )`, [id]);

    if (result.changes === 0) {
      if (req.user.role !== 'admin' && await queryGet('SELECT id FROM trips WHERE id = ?', [id])) {
        return res.status(403).json({ error: 'يرجى مراجعة المدير لحذف هذا السجل' });
      }
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    res.json({ message: 'تم حذف الرحلة بنجاح' });
  } catch (err) {
    console.error('Delete trip error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
