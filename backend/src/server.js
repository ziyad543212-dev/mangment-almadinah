require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const mrz = require('mrz');
const pdfParse = require('pdf-parse');
const sharp = require('sharp');
const db = require("./database");

const { hashPassword, comparePassword, generateToken, authenticateToken } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';
const DATA_DIR = db.dataDir || process.cwd();
const uploadDir = path.join(process.env.UPLOAD_DIR || __dirname, 'uploads');
const OCR_CACHE_DIR = path.join(DATA_DIR, 'tesseract-cache');
let hasLegacyFullName = false;

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(OCR_CACHE_DIR, { recursive: true });

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://localhost:3000',
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
]);

app.use(cors({
  origin(origin, callback) {
    let isVercelOrigin = false;
    if (origin) {
      try {
        const url = new URL(origin);
        isVercelOrigin = url.protocol === 'https:' && url.hostname.endsWith('.vercel.app');
      } catch {
        isVercelOrigin = false;
      }
    }

    callback(null, !origin || allowedOrigins.has(origin) || isVercelOrigin);
  }
}));

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

function handleUpload(uploadMiddleware, label) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      console.error(`${label} upload error details:`, error);
      const status = error instanceof multer.MulterError ? 400 : 500;
      res.status(status).json({
        error: status === 400 ? 'Invalid upload' : 'Upload failed'
      });
    });
  };
}

function cleanupTempFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath)) return;

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error(`${label} temporary file cleanup error:`, error);
  }
}

const passportUpload = handleUpload(upload.single('image'), 'Passport');
const visaUpload = handleUpload(upload.single('visa'), 'Visa');

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
    console.log('=== Login Attempt ===');
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    const user = await queryGet('SELECT * FROM users WHERE username = ?', [username]);

    if (!user) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const passwordMatch = comparePassword(password, user.password_hash);

    if (!passwordMatch) {
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
  } catch (error) {
    console.error('Login error details:', error);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Create initial admin user
app.post('/api/auth/setup-admin', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const users = await queryGet('SELECT COUNT(*) AS count FROM users');
    if (parseInt(users.count) > 0) {
      return res.status(409).json({ error: 'تم إعداد حساب المسؤول مسبقاً' });
    }

    const passwordHash = hashPassword(password);

    const result = await queryRun(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, passwordHash, 'admin']
    );

    res.json({ message: 'تم إنشاء حساب المسؤول بنجاح', userId: result.lastID });
  } catch (err) {
    console.error('Setup admin error:', err);
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

    const user = await queryGet('SELECT * FROM users WHERE id = ?', [req.user.id]);

    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    if (!comparePassword(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    const newPasswordHash = hashPassword(newPassword);

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

    const [totalTrips, totalPilgrims, totalReceived] = await Promise.all(
      queries.slice(0, 3).map(q => queryGet(q))
    );
    const upcomingTrips = await queryGet(queries[5]);
    const previousTrips = await queryGet(queries[6]);

    const pilgrimPayments = await query(`
      SELECT
        p.id,
        COALESCE(SUM(pay.amount_usd), 0) as received
      FROM pilgrims p
      LEFT JOIN payments pay ON p.id = pay.pilgrim_id
      GROUP BY p.id
    `);

    let fullyPaid = 0;
    let unpaid = 0;

    pilgrimPayments.forEach((pp) => {
      if (parseFloat(pp.received) > 0) {
        fullyPaid++;
      } else {
        unpaid++;
      }
    });

    res.json({
      totalTrips: parseInt(totalTrips.total) || 0,
      totalPilgrims: parseInt(totalPilgrims.total) || 0,
      totalReceived: parseFloat(totalReceived.total) || 0,
      totalOutstanding: 0,
      fullyPaid,
      partiallyPaid: 0,
      unpaid,
      upcomingTrips: parseInt(upcomingTrips?.count) || 0,
      previousTrips: parseInt(previousTrips?.count) || 0
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ===== TRIPS ENDPOINTS =====

app.get('/api/trips', authenticateToken, async (req, res) => {
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

app.get('/api/trips/:id', authenticateToken, async (req, res) => {
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

app.post('/api/trips', authenticateToken, async (req, res) => {
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

app.put('/api/trips/:id', authenticateToken, async (req, res) => {
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

    if (search) {
      conditions.push('(p.name_ar LIKE ? OR p.name_en LIKE ? OR p.passport_number LIKE ? OR p.visa_number LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
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

app.get('/api/pilgrims/:id', authenticateToken, async (req, res) => {
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

app.post('/api/pilgrims', authenticateToken, async (req, res) => {
  try {
    const {
      trip_id,
      name_ar,
      name_en,
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

    const normalizedNameAr = normalizeText(name_ar);
    const normalizedNameEn = normalizeText(name_en);
    const normalizedNationality = normalizeText(nationality);
    const normalizedPassportNumber = normalizeText(passport_number);

    if (!Number.isSafeInteger(tripId) || tripId <= 0 || !normalizedNationality || !normalizedPassportNumber) {
      return res.status(400).json({ error: 'الرحلة والجنسية ورقم جواز السفر مطلوبة' });
    }

    const result = await queryRun(
      `INSERT INTO pilgrims (trip_id, name_ar, name_en, nationality, passport_number, passport_expiry_date, date_of_birth, gender, visa_number, visa_document_path, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tripId,
        normalizedNameAr,
        normalizedNameEn,
        normalizedNationality,
        normalizedPassportNumber,
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

app.put('/api/pilgrims/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name_ar, name_en, nationality, passport_number, passport_expiry_date, date_of_birth, gender, visa_number, visa_document_path, notes } = req.body;

    if (!nationality || !passport_number) {
      return res.status(400).json({ error: 'الجنسية ورقم جواز السفر مطلوبة' });
    }

    const result = await queryRun(
      'UPDATE pilgrims SET name_ar = ?, name_en = ?, nationality = ?, passport_number = ?, passport_expiry_date = ?, date_of_birth = ?, gender = ?, visa_number = ?, visa_document_path = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name_ar || null, name_en || null, nationality, passport_number, passport_expiry_date || null, date_of_birth || null, gender || null, visa_number || null, visa_document_path || null, notes || null, id]
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

// ===== BACKUP ENDPOINTS (Cloud compatible) =====
app.get('/api/backup/export', authenticateToken, (req, res) => {
  res.status(501).json({ error: 'النسخ الاحتياطي يتم إدارته مركزياً عبر منصة Neon' });
});

app.post('/api/backup/restore', authenticateToken, (req, res) => {
  res.status(501).json({ error: 'استعادة النسخ الاحتياطي غير متاح مع قاعدة البيانات السحابية' });
});

// ===== PAYMENTS ENDPOINTS =====

app.get('/api/payments', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT
        pay.*,
        p.name_ar,
        p.name_en,
        p.nationality,
        t.name as trip_name
      FROM payments pay
      JOIN pilgrims p ON pay.pilgrim_id = p.id
      JOIN trips t ON p.trip_id = t.id
    `;
    const params = [];

    if (search) {
      sql += ' WHERE p.name_ar LIKE ? OR p.name_en LIKE ? OR p.passport_number LIKE ?';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY pay.payment_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const payments = await query(sql, params);

    let countQuery = 'SELECT COUNT(*) as total FROM payments pay JOIN pilgrims p ON pay.pilgrim_id = p.id JOIN trips t ON p.trip_id = t.id';
    if (search) {
      countQuery += ' WHERE p.name_ar LIKE ? OR p.name_en LIKE ? OR p.passport_number LIKE ?';
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

app.post('/api/payments', authenticateToken, async (req, res) => {
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

// ===== REPORTS & MANIFEST =====

app.get('/api/trips/:tripId/manifest', authenticateToken, async (req, res) => {
  try {
    const { tripId } = req.params;
    const trip = await queryGet('SELECT * FROM trips WHERE id = ?', [tripId]);

    if (!trip) {
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    const pilgrims = await query(`
      SELECT id, name_ar, name_en, passport_number, visa_number, nationality
      FROM pilgrims WHERE trip_id = ? ORDER BY name_ar ASC
    `, [tripId]);

    res.json({ trip, pilgrims });
  } catch (err) {
    console.error('Get manifest error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.get('/api/reports/summary', authenticateToken, async (req, res) => {
  try {
    const summary = await query(`
      SELECT 
        COUNT(DISTINCT t.id) as total_trips,
        COUNT(p.id) as total_pilgrims,
        COALESCE(SUM(t.trip_cost_usd), 0) as total_trip_cost,
        COALESCE(SUM(pay.amount_usd), 0) as total_received,
        COALESCE(SUM(t.trip_cost_usd) - COALESCE(SUM(pay.amount_usd), 0), 0) as total_outstanding
      FROM trips t
      LEFT JOIN pilgrims p ON t.id = p.trip_id
      LEFT JOIN payments pay ON p.id = pay.pilgrim_id
    `);

    res.json(summary[0] || {
      total_trips: 0,
      total_pilgrims: 0,
      total_trip_cost: 0,
      total_received: 0,
      total_outstanding: 0
    });
  } catch (err) {
    console.error('Reports summary error:', err);
    res.status(500).json({ error: 'خطأ في جلب ملخص التقارير' });
  }
});

app.get('/api/reports/nationalities', authenticateToken, async (req, res) => {
  try {
    const nationalities = await query('SELECT nationality, COUNT(*) as count FROM pilgrims GROUP BY nationality ORDER BY count DESC');
    res.json(nationalities);
  } catch (err) {
    console.error('Nationalities error:', err);
    res.status(500).json({ error: 'خطأ في جلب الجنسيات' });
  }
});

app.get('/api/reports/trips', authenticateToken, async (req, res) => {
  try {
    const trips = await query('SELECT id, name, trip_date FROM trips ORDER BY trip_date DESC');
    res.json(trips);
  } catch (err) {
    console.error('Trips error:', err);
    res.status(500).json({ error: 'خطأ في جلب الرحلات' });
  }
});

// ===== STARTUP & DB READY CHECK =====

db.ready
  .then(async () => {
    try {
      const columns = await query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'pilgrims'"
      );
      hasLegacyFullName = columns.some((column) => column.column_name === 'full_name');
      console.log('Pilgrim schema compatibility cached:', { hasLegacyFullName });
    } catch (e) {
      hasLegacyFullName = false;
    }

    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization failed; server will not start:', error);
    process.exitCode = 1;
  });