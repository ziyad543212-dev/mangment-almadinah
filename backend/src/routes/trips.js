const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../auth');
const { query, queryGet, queryRun } = require('./helpers');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, startDate, endDate, sortBy = 'trip_date', sortOrder = 'DESC' } = req.query;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT
        t.*,
        COUNT(p.id) as pilgrim_count,
        COALESCE(SUM(pay.amount_usd), 0) as total_received
      FROM trips t
      LEFT JOIN pilgrims p ON t.id = p.trip_id
      LEFT JOIN payments pay ON p.id = pay.pilgrim_id
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
    params.push(parseInt(limit), parseInt(offset));

    const trips = await query(sql, params);

    let countQuery = 'SELECT COUNT(*) as total FROM trips t';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const countResult = await queryGet(countQuery, params.slice(0, -2));

    res.json({
      trips,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.total) || 0,
        totalPages: Math.ceil((parseInt(countResult.total) || 0) / limit)
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
        COALESCE(SUM(pay.amount_usd), 0) as total_received,
        COUNT(pay.id) as payment_count
      FROM pilgrims p
      LEFT JOIN payments pay ON p.id = pay.pilgrim_id
      WHERE p.trip_id = ?
      GROUP BY p.id
    `, [id]);

    const totalReceived = pilgrims.reduce((sum, p) => sum + parseFloat(p.total_received || 0), 0);
    const tripCost = parseFloat(trip.trip_cost_usd || 0);
    const totalOutstanding = Math.max(0, tripCost - totalReceived);
    const netTrip = totalReceived - tripCost;

    res.json({
      ...trip,
      pilgrims: pilgrims.map(p => ({
        ...p,
        payment_status: parseFloat(p.total_received) > 0 ? 'مدفوع جزئيًا' : 'غير مدفوع'
      })),
      total_received: totalReceived,
      total_outstanding: totalOutstanding,
      net_trip: netTrip,
      pilgrim_count: pilgrims.length
    });
  } catch (err) {
    console.error('Get trip error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, trip_date, trip_cost_usd, notes } = req.body;

    if (!name || !trip_date) {
      return res.status(400).json({ error: 'اسم الرحلة وتاريخ الرحلة مطلوبان' });
    }

    const result = await queryRun(
      'INSERT INTO trips (name, trip_date, trip_cost_usd, notes) VALUES (?, ?, ?, ?)',
      [name, trip_date, trip_cost_usd || 0, notes || null]
    );

    res.status(201).json({ message: 'تمت إضافة الرحلة بنجاح', id: result.lastID });
  } catch (err) {
    console.error('Create trip error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, trip_date, trip_cost_usd, notes } = req.body;

    if (!name || !trip_date) {
      return res.status(400).json({ error: 'اسم الرحلة وتاريخ الرحلة مطلوبان' });
    }

    const result = await queryRun(
      'UPDATE trips SET name = ?, trip_date = ?, trip_cost_usd = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, trip_date, trip_cost_usd || 0, notes || null, id]
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

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await queryRun('DELETE FROM trips WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    res.json({ message: 'تم حذف الرحلة بنجاح' });
  } catch (err) {
    console.error('Delete trip error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
