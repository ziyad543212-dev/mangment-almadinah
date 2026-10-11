require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require("./database");

const { hashPassword, comparePassword, generateToken, authenticateToken } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Helper function to convert callback-based queries to promises
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function queryGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function queryRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// ===== AUTH ENDPOINTS =====

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    const user = await queryGet('SELECT * FROM users WHERE username = $1', [username]);

    if (!user || !comparePassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Create initial admin user (should be called once)
app.post('/api/auth/setup-admin', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const passwordHash = hashPassword(password);

    const result = await queryRun(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, passwordHash, 'admin']
    );

    res.json({ message: 'تم إنشاء حساب المسؤول بنجاح', userId: result.lastID });
  } catch (err) {
    console.error('Setup admin error:', err);
    if (err.message && err.message.includes('unique')) {
      return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
    }
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Verify token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة غير متطابقة مع التأكيد' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
    }

    // Get current user
    const user = await queryGet('SELECT * FROM users WHERE id = ?', [req.user.id]);

    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    // Verify current password
    if (!comparePassword(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    // Hash new password
    const newPasswordHash = hashPassword(newPassword);

    // Update password
    await queryRun(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newPasswordHash, req.user.id]
    );

    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ===== DASHBOARD STATS =====

app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const queries = [
      'SELECT COUNT(*) as total FROM trips',
      'SELECT COUNT(*) as total FROM pilgrims',
      'SELECT COALESCE(SUM(p.amount_usd), 0) as total FROM payments p',
      'SELECT COUNT(*) as count FROM pilgrims WHERE id IN (SELECT DISTINCT pilgrim_id FROM payments)',
      'SELECT COUNT(*) as count FROM pilgrims WHERE id NOT IN (SELECT DISTINCT pilgrim_id FROM payments)',
      'SELECT COUNT(*) as count FROM trips WHERE trip_date >= CURRENT_DATE',
      'SELECT COUNT(*) as count FROM trips WHERE trip_date < CURRENT_DATE'
    ];

    const [totalTrips, totalPilgrims, totalReceived, hasPayments, noPayments, upcomingTrips, previousTrips] = await Promise.all(
      queries.map(q => queryGet(q))
    );

    // Calculate payment status counts
    const pilgrimPayments = await query(`
      SELECT
        p.id,
        COALESCE(SUM(pay.amount_usd), 0) as received
      FROM pilgrims p
      LEFT JOIN payments pay ON p.id = pay.pilgrim_id
      GROUP BY p.id
    `);

    let fullyPaid = 0;
    let partiallyPaid = 0;
    let unpaid = 0;

    pilgrimPayments.forEach((pp) => {
      if (pp.received > 0) {
        fullyPaid++;
      } else {
        unpaid++;
      }
    });

    res.json({
      totalTrips: totalTrips.total,
      totalPilgrims: totalPilgrims.total,
      totalReceived: totalReceived.total,
      totalOutstanding: 0,
      fullyPaid,
      partiallyPaid,
      unpaid,
      upcomingTrips: upcomingTrips.count,
      previousTrips: previousTrips.count
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ===== TRIPS ENDPOINTS =====

// Get all trips
app.get('/api/trips', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, startDate, endDate, sortBy = 'trip_date', sortOrder = 'DESC' } = req.query;

    const offset = (page - 1) * limit;
    let sql = `
      SELECT
        t.*,
        COUNT(p.id) as pilgrim_count,
        COALESCE(SUM(pay.amount_usd), 0) as total_received,
        COALESCE(t.trip_cost_usd, 0) - COALESCE(SUM(pay.amount_usd), 0) as total_outstanding,
        COALESCE(SUM(pay.amount_usd), 0) - COALESCE(t.trip_cost_usd, 0) as net_trip
      FROM trips t
      LEFT JOIN pilgrims p ON t.id = p.trip_id
      LEFT JOIN payments pay ON p.id = pay.pilgrim_id
    `;
    const params = [];
    const conditions = [];

    // Search
    if (search) {
      conditions.push('t.name LIKE ?');
      params.push(`%${search}%`);
    }

    // Date filter
    if (startDate) {
      conditions.push('t.trip_date >= $' + (params.length + 1));
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('t.trip_date <= $' + (params.length + 1));
      params.push(endDate);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' GROUP BY t.id';

    // Sorting
    const allowedSortFields = ['name', 'trip_date', 'created_at'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'trip_date';
    const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortField} ${sortDirection}`;

    // Pagination
    sql += ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), offset);

    const trips = await query(sql, params);

    // Get total count for pagination
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
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit)
      }
    });
  } catch (err) {
    console.error('Get trips error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Get single trip
app.get('/api/trips/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const trip = await queryGet('SELECT * FROM trips WHERE id = ?', [id]);

    if (!trip) {
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    // Get pilgrims for this trip
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

    const totalReceived = pilgrims.reduce((sum, p) => sum + (p.total_received || 0), 0);
    const tripCost = trip.trip_cost_usd || 0;
    const totalOutstanding = Math.max(0, tripCost - totalReceived);
    const netTrip = totalReceived - tripCost;

    res.json({
      ...trip,
      pilgrims: pilgrims.map(p => ({
        ...p,
        payment_status: p.total_received > 0 ? 'مدفوع جزئيًا' : 'غير مدفوع'
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

// Create trip
app.post('/api/trips', authenticateToken, async (req, res) => {
  try {
    const { name, trip_date, trip_cost_usd, notes } = req.body;

    if (!name || !trip_date) {
      return res.status(400).json({ error: 'اسم الرحلة وتاريخ الرحلة مطلوبان' });
    }

    if (trip_cost_usd !== undefined && trip_cost_usd !== null && trip_cost_usd !== '') {
      const cost = parseFloat(trip_cost_usd);
      if (isNaN(cost) || cost < 0) {
        return res.status(400).json({ error: 'تكلفة الرحلة يجب أن تكون رقماً غير سالب' });
      }
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

// Update trip
app.put('/api/trips/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, trip_date, trip_cost_usd, notes } = req.body;

    if (!name || !trip_date) {
      return res.status(400).json({ error: 'اسم الرحلة وتاريخ الرحلة مطلوبان' });
    }

    if (trip_cost_usd !== undefined && trip_cost_usd !== null && trip_cost_usd !== '') {
      const cost = parseFloat(trip_cost_usd);
      if (isNaN(cost) || cost < 0) {
        return res.status(400).json({ error: 'تكلفة الرحلة يجب أن تكون رقماً غير سالب' });
      }
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

// Delete trip
app.delete('/api/trips/:id', authenticateToken, async (req, res) => {
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

// ===== PILGRIMS ENDPOINTS =====

// Get pilgrims for a specific trip
app.get('/api/trips/:tripId/pilgrims', authenticateToken, async (req, res) => {
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

    // Search
    if (search) {
      conditions.push('(p.full_name LIKE ? OR p.passport_number LIKE ? OR p.visa_number LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Filter by nationality
    if (nationality) {
      conditions.push('p.nationality = $' + (params.length + 1));
      params.push(nationality);
    }

    // Filter by visa status
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
      payment_status: p.total_received > 0 ? 'مدفوع جزئيًا' : 'غير مدفوع'
    }));

    res.json({ pilgrims: pilgrimsWithStatus });
  } catch (err) {
    console.error('Get pilgrims error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Get single pilgrim
app.get('/api/pilgrims/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const pilgrim = await queryGet('SELECT * FROM pilgrims WHERE id = ?', [id]);

    if (!pilgrim) {
      return res.status(404).json({ error: 'السجل غير موجود' });
    }

    // Get payments for this pilgrim
    const payments = await query(
      'SELECT * FROM payments WHERE pilgrim_id = ? ORDER BY payment_date DESC',
      [id]
    );

    const totalReceived = payments.reduce((sum, p) => sum + p.amount_usd, 0);

    const pilgrimPaymentsWithData = payments.map(payment => ({
      ...payment,
      cash_denominations: []
    }));

    res.json({
      ...pilgrim,
      payments: pilgrimPaymentsWithData,
      total_received: totalReceived,
      payment_status: totalReceived > 0 ? 'مدفوع جزئيًا' : 'غير مدفوع'
    });
  } catch (err) {
    console.error('Get pilgrim error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Create pilgrim
app.post('/api/pilgrims', authenticateToken, async (req, res) => {
  try {
    const { trip_id, full_name, nationality, passport_number, visa_number, notes } = req.body;

    if (!trip_id || !full_name || !nationality || !passport_number) {
      return res.status(400).json({ error: 'الرحلة والاسم الكامل والجنسية ورقم جواز السفر مطلوبة' });
    }

    const result = await queryRun(
      'INSERT INTO pilgrims (trip_id, full_name, nationality, passport_number, visa_number, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [trip_id, full_name, nationality, passport_number, visa_number || null, notes || null]
    );

    res.status(201).json({ message: 'تمت إضافة السجل بنجاح', id: result.lastID });
  } catch (err) {
    console.error('Create pilgrim error:', err);
    if (err.message && err.message.includes('unique')) {
      return res.status(400).json({ error: 'رقم جواز السفر موجود بالفعل' });
    }
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Update pilgrim
app.put('/api/pilgrims/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, nationality, passport_number, visa_number, notes } = req.body;

    if (!full_name || !nationality || !passport_number) {
      return res.status(400).json({ error: 'الاسم الكامل والجنسية ورقم جواز السفر مطلوبة' });
    }

    const result = await queryRun(
      'UPDATE pilgrims SET full_name = ?, nationality = ?, passport_number = ?, visa_number = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [full_name, nationality, passport_number, visa_number || null, notes || null, id]
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

// Delete pilgrim
app.delete('/api/pilgrims/:id', authenticateToken, async (req, res) => {
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

// ===== PAYMENTS ENDPOINTS =====

// Get all payments
app.get('/api/payments', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;

    const offset = (page - 1) * limit;
    let sql = `
      SELECT
        pay.*,
        p.full_name,
        p.nationality,
        t.name as trip_name
      FROM payments pay
      JOIN pilgrims p ON pay.pilgrim_id = p.id
      JOIN trips t ON p.trip_id = t.id
    `;
    const params = [];

    if (search) {
      sql += ' WHERE p.full_name LIKE ? OR p.passport_number LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY pay.payment_date DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), offset);

    const payments = await query(sql, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM payments pay JOIN pilgrims p ON pay.pilgrim_id = p.id JOIN trips t ON p.trip_id = t.id';
    if (search) {
      countQuery += ' WHERE p.full_name LIKE ? OR p.passport_number LIKE ?';
    }

    const countResult = await queryGet(countQuery, params.slice(0, -2));

    res.json({
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / limit)
      }
    });
  } catch (err) {
    console.error('Get payments error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Create payment
app.post('/api/payments', authenticateToken, async (req, res) => {
  try {
    const { pilgrim_id, amount_usd, payment_method, transaction_reference, notes, cash_denominations } = req.body;

    if (!pilgrim_id || !amount_usd || !payment_method) {
      return res.status(400).json({ error: 'معرف الحاج والمبلغ وطريقة الدفع مطلوبة' });
    }

    if (amount_usd <= 0) {
      return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
    }

    if (!['نقدًا', 'شام كاش'].includes(payment_method)) {
      return res.status(400).json({ error: 'طريقة الدفع غير صالحة' });
    }

    // Create payment
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

// Delete payment
app.delete('/api/payments/:id', authenticateToken, async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
