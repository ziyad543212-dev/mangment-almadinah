const express = require('express');
const multer = require('multer');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../auth');
const { query, queryGet } = require('./helpers');
const { createBackup, restoreBackup, validateBackup } = require('../services/database-backup');
const { toCents, toDollars } = require('../services/finance');
const { protectFinancialData } = require('../services/financial-visibility');
router.use(protectFinancialData);

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 }
}).single('backup');

function receiveBackup(req, res, next) {
  backupUpload(req, res, (error) => {
    if (!error) return next();
    const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: 'تعذر استقبال ملف النسخة الاحتياطية' });
  });
}

function dateFilter(req, res) {
  const { startDate, endDate, tripId } = req.query;
  const isDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
      return false;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if ((startDate !== undefined && !isDate(startDate)) ||
      (endDate !== undefined && !isDate(endDate)) ||
      (startDate && endDate && startDate > endDate) ||
      (tripId !== undefined && (typeof tripId !== 'string' || !/^\d+$/.test(tripId) ||
        !Number.isSafeInteger(Number(tripId)) || Number(tripId) < 1)) ||
      (req.query.nationality !== undefined &&
        (typeof req.query.nationality !== 'string' || !req.query.nationality.trim() || req.query.nationality.length > 100))) {
    res.status(400).json({ error: 'مرشحات التقرير غير صالحة' });
    return null;
  }
  return { startDate, endDate, tripId };
}

router.get('/backup/export', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const backup = await createBackup();
    const filename = `almadinah-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.set({
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'application/json; charset=utf-8'
    });
    res.send(JSON.stringify(backup));
  } catch (error) {
    console.error('Database backup failed:', error.message);
    res.status(500).json({ error: 'تعذر إنشاء النسخة الاحتياطية' });
  }
});

router.post('/backup/restore', authenticateToken, requireAdmin, receiveBackup, async (req, res) => {
  if (process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_DATABASE_RESTORE !== 'true') {
    return res.status(403).json({ error: 'استعادة قاعدة البيانات معطّلة في بيئة الإنتاج' });
  }
  if (req.body?.confirmRestore !== 'RESTORE') {
    return res.status(400).json({ error: 'يلزم إرسال تأكيد الاستعادة الصريح RESTORE' });
  }
  if (!req.file || !req.file.buffer.length) {
    return res.status(400).json({ error: 'ملف النسخة الاحتياطية مطلوب' });
  }

  try {
    const backup = JSON.parse(req.file.buffer.toString('utf8'));
    validateBackup(backup);
    const restoredRows = await restoreBackup(backup);
    res.json({ message: 'تمت استعادة النسخة الاحتياطية بنجاح', restoredRows });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) {
      return res.status(400).json({ error: error.message || 'ملف النسخة الاحتياطية غير صالح' });
    }
    console.error('Database restore failed:', error.message);
    res.status(500).json({ error: 'فشلت استعادة النسخة الاحتياطية؛ تم التراجع عن التغييرات' });
  }
});

router.get('/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const [trips, pilgrims, payments, paidPilgrims, unpaidPilgrims, tripCost, upcomingTrips, previousTrips] = await Promise.all([
      queryGet('SELECT COUNT(*) AS total FROM trips'),
      queryGet('SELECT COUNT(*) AS total FROM pilgrims'),
      queryGet('SELECT COALESCE(SUM(amount_usd), 0) AS total FROM payments'),
      queryGet('SELECT COUNT(*) AS total FROM pilgrims p WHERE EXISTS (SELECT 1 FROM payments pay WHERE pay.pilgrim_id = p.id)'),
      queryGet('SELECT COUNT(*) AS total FROM pilgrims p WHERE NOT EXISTS (SELECT 1 FROM payments pay WHERE pay.pilgrim_id = p.id)'),
      queryGet('SELECT COALESCE(SUM(trip_cost_usd), 0) AS total FROM trips'),
      queryGet('SELECT COUNT(*) AS count FROM trips WHERE trip_date >= CURRENT_DATE'),
      queryGet('SELECT COUNT(*) AS count FROM trips WHERE trip_date < CURRENT_DATE')
    ]);

    res.json({
      totalTrips: Number(trips.total),
      totalPilgrims: Number(pilgrims.total),
      totalReceived: toDollars(toCents(payments.total)),
      totalTripCost: toDollars(toCents(tripCost.total)),
      pilgrimsWithPayments: Number(paidPilgrims.total),
      pilgrimsWithoutPayments: Number(unpaidPilgrims.total),
      upcomingTrips: Number(upcomingTrips.count),
      previousTrips: Number(previousTrips.count)
    });
  } catch (error) {
    console.error('Dashboard stats error:', error.message);
    res.status(500).json({ error: 'تعذر تحميل إحصاءات لوحة التحكم' });
  }
});

router.get('/trips/:tripId/manifest', authenticateToken, async (req, res) => {
  try {
    const { tripId } = req.params;
    const trip = await queryGet('SELECT * FROM trips WHERE id = ?', [tripId]);

    if (!trip) {
      return res.status(404).json({ error: 'الرحلة غير موجودة' });
    }

    const pilgrims = await query(`
      SELECT
        id,
        first_name_ar, father_name_ar, last_name_ar,
        first_name_en, father_name_en, last_name_en,
        NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(first_name_ar), ''), NULLIF(BTRIM(father_name_ar), ''), NULLIF(BTRIM(last_name_ar), '')), '') AS name_ar,
        NULLIF(CONCAT_WS(' ', NULLIF(BTRIM(first_name_en), ''), NULLIF(BTRIM(father_name_en), ''), NULLIF(BTRIM(last_name_en), '')), '') AS name_en,
        passport_number, date_of_birth,
        COALESCE(NULLIF(BTRIM(origin_city), ''), 'دمشق') AS origin_city,
        COALESCE(NULLIF(BTRIM(destination_city), ''), 'جدة') AS destination_city,
        CONCAT(
          COALESCE(NULLIF(BTRIM(origin_city), ''), 'دمشق'),
          ' - ',
          COALESCE(NULLIF(BTRIM(destination_city), ''), 'جدة')
        ) AS route,
        nationality
      FROM pilgrims
      WHERE trip_id = ?
      ORDER BY first_name_ar ASC
    `, [tripId]);

    res.json({ trip, pilgrims });
  } catch (error) {
    console.error('Get manifest error:', error.message);
    res.status(500).json({ error: 'تعذر تحميل كشف الركاب' });
  }
});

router.get('/reports/summary', authenticateToken, async (req, res) => {
  const filters = dateFilter(req, res);
  if (!filters) return;

  try {
    if (req.query.nationality !== undefined && typeof req.query.nationality !== 'string') {
      return res.status(400).json({ error: 'مرشح الجنسية غير صالح' });
    }
    const tripConditions = [];
    const tripParams = [];
    if (filters.startDate) {
      tripConditions.push('t.trip_date >= ?');
      tripParams.push(filters.startDate);
    }
    if (filters.endDate) {
      tripConditions.push('t.trip_date <= ?');
      tripParams.push(filters.endDate);
    }
    if (filters.tripId) {
      tripConditions.push('t.id = ?');
      tripParams.push(filters.tripId);
    }
    if (req.query.nationality) {
      tripConditions.push('EXISTS (SELECT 1 FROM pilgrims selected WHERE selected.trip_id = t.id AND selected.nationality = ?)');
      tripParams.push(req.query.nationality);
    }
    const tripWhere = tripConditions.length ? `WHERE ${tripConditions.join(' AND ')}` : '';
    const nationalityFilter = req.query.nationality ? 'AND p.nationality = ?' : '';
    const params = [...tripParams];
    if (req.query.nationality) params.push(req.query.nationality);

    const summary = await queryGet(`
      WITH report_trips AS (
        SELECT t.id, t.trip_cost_usd FROM trips t ${tripWhere}
      ),
      report_pilgrims AS (
        SELECT p.id, p.trip_id
        FROM pilgrims p
        JOIN report_trips rt ON rt.id = p.trip_id
        WHERE TRUE ${nationalityFilter}
      ),
      report_payments AS (
        SELECT pay.pilgrim_id, pay.amount_usd, pay.payment_method
        FROM payments pay
        JOIN report_pilgrims rp ON rp.id = pay.pilgrim_id
      )
      SELECT
        (SELECT COUNT(*) FROM report_trips) AS total_trips,
        (SELECT COUNT(*) FROM report_pilgrims) AS total_pilgrims,
        (SELECT COALESCE(SUM(trip_cost_usd), 0) FROM report_trips) AS total_trip_cost,
        (SELECT COALESCE(SUM(amount_usd), 0) FROM report_payments) AS total_received,
        (SELECT COUNT(*) FROM report_pilgrims rp
          WHERE EXISTS (SELECT 1 FROM report_payments pay WHERE pay.pilgrim_id = rp.id)) AS with_payments,
        (SELECT COUNT(*) FROM report_pilgrims rp
          WHERE NOT EXISTS (SELECT 1 FROM report_payments pay WHERE pay.pilgrim_id = rp.id)) AS without_payments,
        (SELECT COALESCE(SUM(amount_usd), 0) FROM report_payments WHERE payment_method = 'نقدًا') AS cash_total,
        (SELECT COALESCE(SUM(amount_usd), 0) FROM report_payments WHERE payment_method = 'شام كاش') AS sham_cash_total
    `, params);

    const totalReceivedCents = toCents(summary.total_received);
    const totalTripCostCents = toCents(summary.total_trip_cost);
    res.json({
      total_trips: Number(summary.total_trips),
      total_pilgrims: Number(summary.total_pilgrims),
      total_trip_cost: toDollars(totalTripCostCents),
      total_received: toDollars(totalReceivedCents),
      total_outstanding: null,
      net_total: toDollars(totalReceivedCents - totalTripCostCents),
      with_payments: Number(summary.with_payments),
      without_payments: Number(summary.without_payments),
      cash_total: toDollars(toCents(summary.cash_total)),
      sham_cash_total: toDollars(toCents(summary.sham_cash_total))
    });
  } catch (error) {
    console.error('Reports summary error:', error.message);
    res.status(500).json({ error: 'تعذر تحميل ملخص التقارير' });
  }
});

router.get('/reports/nationalities', authenticateToken, async (req, res) => {
  const filters = dateFilter(req, res);
  if (!filters) return;
  try {
    const conditions = [];
    const params = [];
    if (filters.startDate) {
      conditions.push('t.trip_date >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push('t.trip_date <= ?');
      params.push(filters.endDate);
    }
    if (filters.tripId) {
      conditions.push('t.id = ?');
      params.push(filters.tripId);
    }
    if (req.query.nationality) {
      if (typeof req.query.nationality !== 'string') {
        return res.status(400).json({ error: 'مرشح الجنسية غير صالح' });
      }
      conditions.push('p.nationality = ?');
      params.push(req.query.nationality);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const nationalities = await query(
      `SELECT p.nationality, COUNT(*) AS count
       FROM pilgrims p
       JOIN trips t ON t.id = p.trip_id
       ${where}
       GROUP BY p.nationality
       ORDER BY count DESC`,
      params
    );
    res.json(nationalities.map((row) => ({ ...row, count: Number(row.count) })));
  } catch (error) {
    console.error('Nationalities report error:', error.message);
    res.status(500).json({ error: 'تعذر تحميل تقرير الجنسيات' });
  }
});

router.get('/reports/trips', authenticateToken, async (req, res) => {
  try {
    const trips = await query('SELECT id, name, trip_date FROM trips ORDER BY trip_date DESC');
    res.json(trips);
  } catch (error) {
    console.error('Trips report error:', error.message);
    res.status(500).json({ error: 'تعذر تحميل قائمة الرحلات' });
  }
});

router.get('/reports/by-trip', authenticateToken, async (req, res) => {
  const filters = dateFilter(req, res);
  if (!filters) return;
  try {
    const conditions = [];
    const params = [];
    if (filters.startDate) {
      conditions.push('t.trip_date >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push('t.trip_date <= ?');
      params.push(filters.endDate);
    }
    if (filters.tripId) {
      conditions.push('t.id = ?');
      params.push(filters.tripId);
    }
    if (req.query.nationality) {
      if (typeof req.query.nationality !== 'string') {
        return res.status(400).json({ error: 'مرشح الجنسية غير صالح' });
      }
      conditions.push('EXISTS (SELECT 1 FROM pilgrims selected WHERE selected.trip_id = t.id AND selected.nationality = ?)');
      params.push(req.query.nationality);
    }
    const tripWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pilgrimFilter = req.query.nationality ? 'AND p.nationality = ?' : '';
    if (req.query.nationality) params.push(req.query.nationality);
    const trips = await query(`
      WITH report_trips AS (
        SELECT t.id, t.name, t.trip_date, t.trip_cost_usd FROM trips t ${tripWhere}
      ),
      report_pilgrims AS (
        SELECT p.id, p.trip_id
        FROM pilgrims p JOIN report_trips t ON t.id = p.trip_id
        WHERE TRUE ${pilgrimFilter}
      ),
      report_payments AS (
        SELECT pay.pilgrim_id, SUM(pay.amount_usd) AS total_received
        FROM payments pay JOIN report_pilgrims p ON p.id = pay.pilgrim_id
        GROUP BY pay.pilgrim_id
      )
      SELECT
        t.id, t.name, t.trip_date, t.trip_cost_usd,
        (SELECT COUNT(*) FROM report_pilgrims p WHERE p.trip_id = t.id) AS pilgrim_count,
        COALESCE((SELECT SUM(pay.total_received)
          FROM report_pilgrims p
          JOIN report_payments pay ON pay.pilgrim_id = p.id
          WHERE p.trip_id = t.id), 0) AS total_received
      FROM report_trips t
      ORDER BY t.trip_date DESC
    `, params);
    res.json(trips.map((trip) => {
      const receivedCents = toCents(trip.total_received);
      const costCents = toCents(trip.trip_cost_usd);
      return {
      ...trip,
      trip_cost_usd: toDollars(costCents),
      pilgrim_count: Number(trip.pilgrim_count),
      total_received: toDollars(receivedCents),
      net_trip: toDollars(receivedCents - costCents)
      };
    }));
  } catch (error) {
    console.error('Trip financial report error:', error.message);
    res.status(500).json({ error: 'تعذر تحميل التقرير المالي للرحلات' });
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'ملف الطلب غير صالح أو أكبر من الحد المسموح' });
  }
  next(error);
});

module.exports = router;
