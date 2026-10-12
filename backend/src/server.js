require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const Tesseract = require('tesseract.js');
const { MRZ } = require('mrz');
const pdfParse = require('pdf-parse');
const db = require("./database");

const { hashPassword, comparePassword, generateToken, authenticateToken } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

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
      conditions.push('(p.name_ar LIKE ? OR p.name_en LIKE ? OR p.passport_number LIKE ? OR p.visa_number LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
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
    const { trip_id, name_ar, name_en, nationality, passport_number, passport_expiry_date, date_of_birth, gender, visa_number, visa_document_path, notes } = req.body;

    if (!trip_id || !nationality || !passport_number) {
      return res.status(400).json({ error: 'الرحلة والجنسية ورقم جواز السفر مطلوبة' });
    }

    const result = await queryRun(
      'INSERT INTO pilgrims (trip_id, name_ar, name_en, nationality, passport_number, passport_expiry_date, date_of_birth, gender, visa_number, visa_document_path, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [trip_id, name_ar || null, name_en || null, nationality, passport_number, passport_expiry_date || null, date_of_birth || null, gender || null, visa_number || null, visa_document_path || null, notes || null]
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

// ===== OCR ENDPOINTS =====

// Helper function to extract text from PDF
async function extractTextFromPDF(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('PDF text extraction error:', error);
    return null;
  }
}

// Helper function to convert PDF first page to image (for scanned PDFs)
async function convertPDFToImage(pdfPath) {
  try {
    // Note: This requires canvas which may not be available on all systems
    // If canvas is not installed, this will return null and we'll rely on text extraction only
    const { createCanvas } = await import('canvas');
    const pdfjsLib = require('pdfjs-dist');
    const dataBuffer = fs.readFileSync(pdfPath);
    const loadingTask = pdfjsLib.getDocument(dataBuffer);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const scale = 2.0;
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;

    const imageBuffer = canvas.toBuffer('image/png');
    return imageBuffer;
  } catch (error) {
    console.error('PDF to image conversion error (canvas not available):', error.message);
    return null;
  }
}

// Passport OCR endpoint
app.post('/api/ocr/passport', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let text = '';
    let imageToOCR = null;

    // Handle PDF files
    if (fileExt === '.pdf') {
      console.log('Processing PDF file for passport OCR');

      // First try to extract text directly from PDF
      const pdfText = await extractTextFromPDF(filePath);
      if (pdfText && pdfText.trim().length > 50) {
        text = pdfText;
        console.log('Extracted text from PDF successfully');
      } else {
        // If text extraction fails or is minimal, convert to image and use OCR
        console.log('PDF text extraction failed or minimal, converting to image for OCR');
        imageToOCR = await convertPDFToImage(filePath);
        if (imageToOCR) {
          // Save converted image temporarily
          const tempImagePath = filePath + '.png';
          fs.writeFileSync(tempImagePath, imageToOCR);

          // Perform OCR on the converted image
          const ocrResult = await Tesseract.recognize(tempImagePath, 'eng', { logger: m => console.log(m) });
          text = ocrResult.data.text;

          // Clean up temp image
          fs.unlinkSync(tempImagePath);
        } else {
          text = '';
        }
      }
    } else {
      // Handle image files
      const { data: { text: ocrText } } = await Tesseract.recognize(
        filePath,
        'eng',
        { logger: m => console.log(m) }
      );
      text = ocrText;
    }

    // Parse MRZ (Machine Readable Zone) from the text
    const mrzLines = text.split('\n').filter(line => line.trim().length > 30);
    let parsedData = {
      name_en: '',
      passport_number: '',
      date_of_birth: '',
      passport_expiry_date: '',
      nationality: '',
      gender: ''
    };

    if (mrzLines.length >= 2) {
      try {
        const mrz = new MRZ(mrzLines.join('\n'));
        parsedData = {
          name_en: mrz.secondaryIdentifier + ' ' + mrz.primaryIdentifier,
          passport_number: mrz.documentNumber,
          date_of_birth: mrz.birthDate,
          passport_expiry_date: mrz.expirationDate,
          nationality: mrz.nationality,
          gender: mrz.sex
        };
      } catch (mrzError) {
        console.log('MRZ parsing failed, using basic OCR text extraction');
        // Fallback: try to extract basic info from text
        const lines = text.split('\n');
        lines.forEach(line => {
          if (line.includes('PN') || line.match(/\b[A-Z]{1,2}\d{6,9}\b/)) {
            const match = line.match(/\b[A-Z]{1,2}\d{6,9}\b/);
            if (match) parsedData.passport_number = match[0];
          }
        });
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      data: parsedData,
      raw_text: text
    });
  } catch (err) {
    console.error('Passport OCR error:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to process passport file' });
  }
});

// eVisa upload endpoint
app.post('/api/upload/visa', authenticateToken, upload.single('visa'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No visa file provided' });
    }

    // Create visas directory if it doesn't exist
    const visasDir = path.join(__dirname, '../uploads/visas');
    if (!fs.existsSync(visasDir)) {
      fs.mkdirSync(visasDir, { recursive: true });
    }

    // Move file to visas directory
    const visaPath = path.join(visasDir, req.file.filename);
    fs.renameSync(req.file.path, visaPath);

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let visaNumber = null;

    try {
      let text = '';

      // Handle PDF files
      if (fileExt === '.pdf') {
        console.log('Processing PDF file for visa extraction');

        // First try to extract text directly from PDF
        const pdfText = await extractTextFromPDF(visaPath);
        if (pdfText && pdfText.trim().length > 10) {
          text = pdfText;
          console.log('Extracted text from PDF successfully');
        } else {
          // If text extraction fails, convert to image and use OCR
          console.log('PDF text extraction failed, converting to image for OCR');
          const imageBuffer = await convertPDFToImage(visaPath);
          if (imageBuffer) {
            const tempImagePath = visaPath + '.png';
            fs.writeFileSync(tempImagePath, imageBuffer);

            const ocrResult = await Tesseract.recognize(tempImagePath, 'eng', { logger: m => console.log(m) });
            text = ocrResult.data.text;

            fs.unlinkSync(tempImagePath);
          }
        }
      } else {
        // Handle image files
        const { data: { text: ocrText } } = await Tesseract.recognize(
          visaPath,
          'eng',
          { logger: m => console.log(m) }
        );
        text = ocrText;
      }

      // Try to find visa number pattern (various formats including Arabic)
      const visaPatterns = [
        /رقم\s*التأشيرة[:\s]*([A-Z0-9]+)/i,
        /Visa\s*No[:\s]*([A-Z0-9]+)/i,
        /Visa\s*Number[:\s]*([A-Z0-9]+)/i,
        /Number[:\s]*([A-Z0-9]+)/i,
        /رقم\s*الفيزا[:\s]*([A-Z0-9]+)/i,
        /(\d{10,})/,
        /([A-Z]{2}\d{6,})/,
        /Border\s*No[:\s]*([A-Z0-9]+)/i
      ];

      for (const pattern of visaPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          visaNumber = match[1].trim();
          console.log('Found visa number:', visaNumber);
          break;
        }
      }

      // Try to extract pilgrim name from PDF text
      const namePatterns = [
        /Name[:\s]*([A-Za-z\s]+)/i,
        /الاسم[:\s]*([أ-ي\s]+)/i,
        /Pilgrim\s*Name[:\s]*([A-Za-z\s]+)/i
      ];

      for (const pattern of namePatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          console.log('Found name:', match[1].trim());
          break;
        }
      }
    } catch (ocrError) {
      console.log('Visa extraction failed, user will need to enter visa number manually');
    }

    res.json({
      success: true,
      visa_document_path: req.file.filename,
      visa_number: visaNumber
    });
  } catch (err) {
    console.error('Visa upload error:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to upload visa' });
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

    sql += ' ORDER BY pay.payment_date DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), offset);

    const payments = await query(sql, params);

    // Get total count
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

// ===== BACKUP & RESTORE ENDPOINTS =====

// Export database backup
app.get('/api/backup/export', authenticateToken, async (req, res) => {
  try {
    const dbPath = path.join(__dirname, '../database.sqlite');
    const backupPath = path.join(__dirname, `../backup_${new Date().toISOString().split('T')[0]}.sqlite`);

    // Copy database file
    fs.copyFileSync(dbPath, backupPath);

    res.download(backupPath, `backup_${new Date().toISOString().split('T')[0]}.sqlite`, (err) => {
      if (err) {
        console.error('Backup download error:', err);
      }
      // Clean up backup file after download
      fs.unlinkSync(backupPath);
    });
  } catch (err) {
    console.error('Backup export error:', err);
    res.status(500).json({ error: 'Failed to export backup' });
  }
});

// Restore database from backup
app.post('/api/backup/restore', authenticateToken, upload.single('backup'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No backup file provided' });
    }

    const dbPath = path.join(__dirname, '../database.sqlite');
    const backupPath = req.file.path;

    // Close current database connection
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
        fs.unlinkSync(backupPath);
        return res.status(500).json({ error: 'Failed to close database' });
      }

      // Replace database file with backup
      fs.copyFileSync(backupPath, dbPath);
      fs.unlinkSync(backupPath);

      // Reopen database connection
      const newDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('Error reopening database:', err);
          return res.status(500).json({ error: 'Failed to reopen database' });
        }

        res.json({ message: 'Database restored successfully. Please restart the application.' });
      });
    });
  } catch (err) {
    console.error('Backup restore error:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

// ===== PASSENGER MANIFEST & PDF EXPORT =====

// Get passenger manifest for a trip
app.get('/api/trips/:tripId/manifest', authenticateToken, async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await queryGet('SELECT * FROM trips WHERE id = ?', [tripId]);

    if (!trip) {
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    const pilgrims = await query(`
      SELECT
        id,
        name_ar,
        name_en,
        passport_number,
        visa_number,
        nationality
      FROM pilgrims
      WHERE trip_id = ?
      ORDER BY name_ar ASC
    `, [tripId]);

    res.json({
      trip,
      pilgrims
    });
  } catch (err) {
    console.error('Get manifest error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Generate PDF manifest
app.post('/api/trips/:tripId/manifest/pdf', authenticateToken, async (req, res) => {
  try {
    const { tripId } = req.params;

    const trip = await queryGet('SELECT * FROM trips WHERE id = ?', [tripId]);

    if (!trip) {
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    const pilgrims = await query(`
      SELECT
        id,
        name_ar,
        name_en,
        passport_number,
        visa_number,
        nationality
      FROM pilgrims
      WHERE trip_id = ?
      ORDER BY name_ar ASC
    `, [tripId]);

    const PdfPrinter = require('pdfmake');
    const vfsFonts = require('pdfmake/build/vfs_fonts.js');

    // Use built-in fonts (will work for English, Arabic may not render perfectly)
    const fonts = {
      Roboto: {
        normal: 'Buffer',
        bold: 'Buffer',
        italics: 'Buffer',
        bolditalics: 'Buffer'
      }
    };

    const printer = new PdfPrinter(fonts);
    const docDefinition = {
      content: [
        {
          text: 'Al Madinah Hajj & Umrah Company',
          style: 'header',
          alignment: 'center'
        },
        {
          text: `Passenger Manifest - ${trip.name}`,
          style: 'subheader',
          alignment: 'center',
          margin: [0, 10, 0, 10]
        },
        {
          text: `Date: ${trip.trip_date}`,
          alignment: 'center',
          margin: [0, 0, 0, 20]
        },
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', '*', 'auto', 'auto', '*'],
            body: [
              [
                { text: 'م', style: 'tableHeader' },
                { text: 'اسم المعتمر بالعربي', style: 'tableHeader' },
                { text: 'اسم المعتمر بالإنكليزي', style: 'tableHeader' },
                { text: 'رقم الجواز', style: 'tableHeader' },
                { text: 'رقم الفيزا', style: 'tableHeader' },
                { text: 'الجنسية', style: 'tableHeader' }
              ],
              ...pilgrims.map((p, index) => [
                index + 1,
                p.name_ar || '-',
                p.name_en || '-',
                p.passport_number,
                p.visa_number || '-',
                p.nationality
              ])
            ]
          },
          layout: 'lightHorizontalLines'
        },
        {
          text: `Total Passengers: ${pilgrims.length}`,
          alignment: 'right',
          margin: [0, 20, 0, 0],
          style: 'footer'
        }
      ],
      styles: {
        header: {
          fontSize: 18,
          bold: true,
          margin: [0, 0, 0, 10]
        },
        subheader: {
          fontSize: 14,
          bold: true
        },
        tableHeader: {
          bold: true,
          fontSize: 10,
          color: 'black',
          fillColor: '#eeeeee'
        },
        footer: {
          fontSize: 10,
          italics: true
        }
      },
      defaultStyle: {
        font: 'Roboto'
      }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const chunks = [];

    pdfDoc.on('data', chunk => chunks.push(chunk));
    pdfDoc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=manifest_${trip.name.replace(/\s+/g, '_')}.pdf`);
      res.send(pdfBuffer);
    });

    pdfDoc.end();
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
