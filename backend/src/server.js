require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database');
const { hashPassword, comparePassword, generateToken, authenticateToken } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ===== AUTH ENDPOINTS =====

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

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
  });
});

// Create initial admin user (should be called once)
app.post('/api/auth/setup-admin', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }

  const passwordHash = hashPassword(password);

  db.run(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    [username, passwordHash, 'admin'],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
        }
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }

      res.json({ message: 'تم إنشاء حساب المسؤول بنجاح', userId: this.lastID });
    }
  );
});

// Verify token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Change password
app.post('/api/auth/change-password', authenticateToken, (req, res) => {
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
  db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

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
    db.run(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newPasswordHash, req.user.id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'خطأ في الخادم' });
        }

        res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
      }
    );
  });
});

// ===== DASHBOARD STATS =====

app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
  const queries = [
    'SELECT COUNT(*) as total FROM trips',
    'SELECT COUNT(*) as total FROM pilgrims',
    'SELECT COALESCE(SUM(p.amount_usd), 0) as total FROM payments p',
    'SELECT COUNT(*) as count FROM pilgrims WHERE id IN (SELECT DISTINCT pilgrim_id FROM payments)',
    'SELECT COUNT(*) as count FROM pilgrims WHERE id NOT IN (SELECT DISTINCT pilgrim_id FROM payments)',
    'SELECT COUNT(*) as count FROM trips WHERE trip_date >= DATE("now")',
    'SELECT COUNT(*) as count FROM trips WHERE trip_date < DATE("now")'
  ];

  Promise.all(
    queries.map(
      (query) =>
        new Promise((resolve, reject) => {
          db.get(query, (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        })
    )
  )
    .then(([totalTrips, totalPilgrims, totalReceived, hasPayments, noPayments, upcomingTrips, previousTrips]) => {
      // Calculate payment status counts
      db.all(
        `
        SELECT
          p.id,
          COALESCE(SUM(pay.amount_usd), 0) as received
        FROM pilgrims p
        LEFT JOIN payments pay ON p.id = pay.pilgrim_id
        GROUP BY p.id
      `,
        (err, pilgrimPayments) => {
          if (err) {
            return res.status(500).json({ error: 'خطأ في الخادم' });
          }

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
        }
      );
    })
    .catch((err) => res.status(500).json({ error: 'خطأ في الخادم' }));
});

// ===== TRIPS ENDPOINTS =====

// Get all trips
app.get('/api/trips', authenticateToken, (req, res) => {
  const { page = 1, limit = 10, search, startDate, endDate, sortBy = 'trip_date', sortOrder = 'DESC' } = req.query;

  const offset = (page - 1) * limit;
  let query = `
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
    conditions.push('t.trip_date >= ?');
    params.push(startDate);
  }

  if (endDate) {
    conditions.push('t.trip_date <= ?');
    params.push(endDate);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' GROUP BY t.id';

  // Sorting
  const allowedSortFields = ['name', 'trip_date', 'created_at'];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'trip_date';
  const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${sortField} ${sortDirection}`;

  // Pagination
  query += ' LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  db.all(query, params, (err, trips) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM trips';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }

    db.get(countQuery, params.slice(0, -2), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }

      res.json({
        trips,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit)
        }
      });
    });
  });
});

// Get single trip
app.get('/api/trips/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM trips WHERE id = ?', [id], (err, trip) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

    if (!trip) {
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    // Get pilgrims for this trip
    db.all(
      `SELECT
        p.*,
        COALESCE(SUM(pay.amount_usd), 0) as total_received,
        COUNT(pay.id) as payment_count
      FROM pilgrims p
      LEFT JOIN payments pay ON p.id = pay.pilgrim_id
      WHERE p.trip_id = ?
      GROUP BY p.id`,
      [id],
      (err, pilgrims) => {
        if (err) {
          return res.status(500).json({ error: 'خطأ في الخادم' });
        }

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
      }
    );
  });
});

// Create trip
app.post('/api/trips', authenticateToken, (req, res) => {
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

  db.run(
    'INSERT INTO trips (name, trip_date, trip_cost_usd, notes) VALUES (?, ?, ?, ?)',
    [name, trip_date, trip_cost_usd || 0, notes || null],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }

      res.status(201).json({ message: 'تمت إضافة الرحلة بنجاح', id: this.lastID });
    }
  );
});

// Update trip
app.put('/api/trips/:id', authenticateToken, (req, res) => {
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

  db.run(
    'UPDATE trips SET name = ?, trip_date = ?, trip_cost_usd = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [name, trip_date, trip_cost_usd || 0, notes || null, id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'الرحلة غير موجودة' });
      }

      res.json({ message: 'تم تحديث الرحلة بنجاح' });
    }
  );
});

// Delete trip
app.delete('/api/trips/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM trips WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    res.json({ message: 'تم حذف الرحلة بنجاح' });
  });
});

// ===== PILGRIMS ENDPOINTS =====

// Get pilgrims for a specific trip
app.get('/api/trips/:tripId/pilgrims', authenticateToken, (req, res) => {
  const { tripId } = req.params;
  const { search, nationality, hasVisa } = req.query;

  let query = `
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
    conditions.push('p.nationality = ?');
    params.push(nationality);
  }

  // Filter by visa status
  if (hasVisa === 'true') {
    conditions.push('p.visa_number IS NOT NULL AND p.visa_number != ""');
  } else if (hasVisa === 'false') {
    conditions.push('(p.visa_number IS NULL OR p.visa_number = "")');
  }

  if (conditions.length > 0) {
    query += ' AND ' + conditions.join(' AND ');
  }

  query += ' GROUP BY p.id ORDER BY p.created_at DESC';

  db.all(query, params, (err, pilgrims) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

    const pilgrimsWithStatus = pilgrims.map((p) => ({
      ...p,
      payment_status: p.total_received > 0 ? 'مدفوع جزئيًا' : 'غير مدفوع'
    }));

    res.json({ pilgrims: pilgrimsWithStatus });
  });
});

// Get single pilgrim
app.get('/api/pilgrims/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM pilgrims WHERE id = ?', [id], (err, pilgrim) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

    if (!pilgrim) {
      return res.status(404).json({ error: 'السجل غير موجود' });
    }

    // Get payments for this pilgrim
    db.all(
      'SELECT * FROM payments WHERE pilgrim_id = ? ORDER BY payment_date DESC',
      [id],
      (err, payments) => {
        if (err) {
          return res.status(500).json({ error: 'خطأ في الخادم' });
        }

        const totalReceived = payments.reduce((sum, p) => sum + p.amount_usd, 0);

        // Get cash denominations for each payment
        const paymentsWithDenominations = payments.map(payment => ({
          ...payment,
          cash_denominations: []
        }));

        const fetchDenominations = paymentsWithDenominations.map(payment => {
          return new Promise((resolve, reject) => {
            if (payment.payment_method === 'نقدًا') {
              db.all(
                'SELECT * FROM cash_payment_denominations WHERE payment_id = ?',
                [payment.id],
                (err, denominations) => {
                  if (err) reject(err);
                  else {
                    payment.cash_denominations = denominations;
                    resolve(payment);
                  }
                }
              );
            } else {
              resolve(payment);
            }
          });
        });

        Promise.all(fetchDenominations)
          .then(paymentsWithData => {
            res.json({
              ...pilgrim,
              payments: paymentsWithData,
              total_received: totalReceived,
              payment_status: totalReceived > 0 ? 'مدفوع جزئيًا' : 'غير مدفوع'
            });
          })
          .catch(err => res.status(500).json({ error: 'خطأ في الخادم' }));
      }
    );
  });
});

// Create pilgrim
app.post('/api/pilgrims', authenticateToken, (req, res) => {
  const { trip_id, full_name, nationality, passport_number, visa_number, notes } = req.body;

  if (!trip_id || !full_name || !nationality || !passport_number) {
    return res.status(400).json({ error: 'الرحلة والاسم الكامل والجنسية ورقم جواز السفر مطلوبة' });
  }

  db.run(
    'INSERT INTO pilgrims (trip_id, full_name, nationality, passport_number, visa_number, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [trip_id, full_name, nationality, passport_number, visa_number || null, notes || null],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'رقم جواز السفر موجود بالفعل' });
        }
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }

      res.status(201).json({ message: 'تمت إضافة السجل بنجاح', id: this.lastID });
    }
  );
});

// Update pilgrim
app.put('/api/pilgrims/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { full_name, nationality, passport_number, visa_number, notes } = req.body;

  if (!full_name || !nationality || !passport_number) {
    return res.status(400).json({ error: 'الاسم الكامل والجنسية ورقم جواز السفر مطلوبة' });
  }

  db.run(
    'UPDATE pilgrims SET full_name = ?, nationality = ?, passport_number = ?, visa_number = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [full_name, nationality, passport_number, visa_number || null, notes || null, id],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'رقم جواز السفر موجود بالفعل' });
        }
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'السجل غير موجود' });
      }

      res.json({ message: 'تم تحديث البيانات بنجاح' });
    }
  );
});

// Delete pilgrim
app.delete('/api/pilgrims/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM pilgrims WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'السجل غير موجود' });
    }

    res.json({ message: 'تم حذف السجل بنجاح' });
  });
});

// ===== PAYMENTS ENDPOINTS =====

// Get all payments
app.get('/api/payments', authenticateToken, (req, res) => {
  const { page = 1, limit = 10, search } = req.query;

  const offset = (page - 1) * limit;
  let query = `
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
    query += ' WHERE p.full_name LIKE ? OR p.passport_number LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY pay.payment_date DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  db.all(query, params, (err, payments) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM payments pay JOIN pilgrims p ON pay.pilgrim_id = p.id JOIN trips t ON p.trip_id = t.id';
    if (search) {
      countQuery += ' WHERE p.full_name LIKE ? OR p.passport_number LIKE ?';
    }

    db.get(countQuery, params.slice(0, -2), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }

      res.json({
        payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          totalPages: Math.ceil(countResult.total / limit)
        }
      });
    });
  });
});

// Create payment
app.post('/api/payments', authenticateToken, (req, res) => {
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

  // Validate cash denominations if payment method is cash
  if (payment_method === 'نقدًا') {
    if (!cash_denominations || !Array.isArray(cash_denominations) || cash_denominations.length === 0) {
      return res.status(400).json({ error: 'يجب إدخال تفاصيل الدفع النقدي' });
    }

    const denominationsTotal = cash_denominations.reduce((sum, d) => sum + (d.denomination * d.quantity), 0);

    if (Math.abs(denominationsTotal - amount_usd) > 0.01) {
      return res.status(400).json({ error: 'مجموع فئات العملة النقدية لا يساوي مبلغ الدفعة' });
    }
  }

  db.run(
    'INSERT INTO payments (pilgrim_id, amount_usd, payment_method, transaction_reference, notes) VALUES (?, ?, ?, ?, ?)',
    [pilgrim_id, amount_usd, payment_method, transaction_reference || null, notes || null],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }

      const paymentId = this.lastID;

      // Add cash denominations if payment method is cash
      if (payment_method === 'نقدًا' && cash_denominations) {
        const insertDenominations = cash_denominations.map(denom => {
          return new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO cash_payment_denominations (payment_id, denomination, quantity, subtotal) VALUES (?, ?, ?, ?)',
              [paymentId, denom.denomination, denom.quantity, denom.denomination * denom.quantity],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        });

        Promise.all(insertDenominations)
          .then(() => {
            res.status(201).json({ message: 'تمت إضافة الدفعة بنجاح', id: paymentId });
          })
          .catch(err => {
            res.status(500).json({ error: 'خطأ في إضافة تفاصيل الدفع النقدي' });
          });
      } else {
        res.status(201).json({ message: 'تمت إضافة الدفعة بنجاح', id: paymentId });
      }
    }
  );
});

// Update payment
app.put('/api/payments/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { amount_usd, payment_method, transaction_reference, notes, cash_denominations } = req.body;

  if (!amount_usd || !payment_method) {
    return res.status(400).json({ error: 'المبلغ وطريقة الدفع مطلوبة' });
  }

  if (amount_usd <= 0) {
    return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
  }

  if (!['نقدًا', 'شام كاش'].includes(payment_method)) {
    return res.status(400).json({ error: 'طريقة الدفع غير صالحة' });
  }

  // Validate cash denominations if payment method is cash
  if (payment_method === 'نقدًا') {
    if (!cash_denominations || !Array.isArray(cash_denominations) || cash_denominations.length === 0) {
      return res.status(400).json({ error: 'يجب إدخال تفاصيل الدفع النقدي' });
    }

    const denominationsTotal = cash_denominations.reduce((sum, d) => sum + (d.denomination * d.quantity), 0);

    if (Math.abs(denominationsTotal - amount_usd) > 0.01) {
      return res.status(400).json({ error: 'مجموع فئات العملة النقدية لا يساوي مبلغ الدفعة' });
    }
  }

  db.run(
    'UPDATE payments SET amount_usd = ?, payment_method = ?, transaction_reference = ?, notes = ? WHERE id = ?',
    [amount_usd, payment_method, transaction_reference || null, notes || null, id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'الدفعة غير موجودة' });
      }

      // Delete existing cash denominations
      db.run('DELETE FROM cash_payment_denominations WHERE payment_id = ?', [id], (err) => {
        if (err) {
          return res.status(500).json({ error: 'خطأ في تحديث تفاصيل الدفع النقدي' });
        }

        // Add new cash denominations if payment method is cash
        if (payment_method === 'نقدًا' && cash_denominations) {
          const insertDenominations = cash_denominations.map(denom => {
            return new Promise((resolve, reject) => {
              db.run(
                'INSERT INTO cash_payment_denominations (payment_id, denomination, quantity, subtotal) VALUES (?, ?, ?, ?)',
                [id, denom.denomination, denom.quantity, denom.denomination * denom.quantity],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          });

          Promise.all(insertDenominations)
            .then(() => {
              res.json({ message: 'تم تحديث الدفعة بنجاح' });
            })
            .catch(err => {
              res.status(500).json({ error: 'خطأ في تحديث تفاصيل الدفع النقدي' });
            });
        } else {
          res.json({ message: 'تم تحديث الدفعة بنجاح' });
        }
      });
    }
  );
});

// Delete payment
app.delete('/api/payments/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM payments WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'الدفعة غير موجودة' });
    }

    res.json({ message: 'تم حذف الدفعة بنجاح' });
  });
});

// ===== REPORTS ENDPOINTS =====

app.get('/api/reports/summary', authenticateToken, (req, res) => {
  const { startDate, endDate, nationality, paymentStatus, tripId } = req.query;

  let query = `
    SELECT
      COUNT(DISTINCT t.id) as total_trips,
      COUNT(DISTINCT p.id) as total_pilgrims,
      COALESCE(SUM(t.trip_cost_usd), 0) as total_trip_cost,
      COALESCE(SUM(pay.amount_usd), 0) as total_received,
      COALESCE(SUM(t.trip_cost_usd), 0) - COALESCE(SUM(pay.amount_usd), 0) as total_outstanding,
      COALESCE(SUM(pay.amount_usd), 0) - COALESCE(SUM(t.trip_cost_usd), 0) as net_total,
      COUNT(DISTINCT CASE WHEN pay.id IS NOT NULL THEN p.id END) as with_payments,
      COUNT(DISTINCT CASE WHEN pay.id IS NULL THEN p.id END) as without_payments,
      SUM(CASE WHEN pay.payment_method = 'نقدًا' THEN pay.amount_usd ELSE 0 END) as cash_total,
      SUM(CASE WHEN pay.payment_method = 'شام كاش' THEN pay.amount_usd ELSE 0 END) as sham_cash_total
    FROM trips t
    LEFT JOIN pilgrims p ON t.id = p.trip_id
    LEFT JOIN payments pay ON p.id = pay.pilgrim_id
  `;
  const params = [];
  const conditions = [];

  if (startDate) {
    conditions.push('t.trip_date >= ?');
    params.push(startDate);
  }

  if (endDate) {
    conditions.push('t.trip_date <= ?');
    params.push(endDate);
  }

  if (nationality) {
    conditions.push('p.nationality = ?');
    params.push(nationality);
  }

  if (tripId) {
    conditions.push('t.id = ?');
    params.push(tripId);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  db.get(query, params, (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

    res.json(result);
  });
});

app.get('/api/reports/nationalities', authenticateToken, (req, res) => {
  db.all(
    'SELECT nationality, COUNT(*) as count FROM pilgrims GROUP BY nationality ORDER BY count DESC',
    (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }
      res.json(results);
    }
  );
});

app.get('/api/reports/trips', authenticateToken, (req, res) => {
  db.all(
    'SELECT id, name, trip_date FROM trips ORDER BY trip_date DESC',
    (err, results) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }
      res.json(results);
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
