const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../auth');
const { query, queryGet } = require('./helpers');

router.get('/backup/export', authenticateToken, (req, res) => {
  res.status(501).json({ error: 'النسخ الاحتياطي يتم إدارته مركزياً عبر منصة Neon' });
});

router.post('/backup/restore', authenticateToken, (req, res) => {
  res.status(501).json({ error: 'استعادة النسخ الاحتياطي غير متاح مع قاعدة البيانات السحابية' });
});

router.get('/dashboard/stats', authenticateToken, async (req, res) => {
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
        passport_number, visa_number, nationality
      FROM pilgrims WHERE trip_id = ? ORDER BY first_name_ar ASC
    `, [tripId]);

    res.json({ trip, pilgrims });
  } catch (err) {
    console.error('Get manifest error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/reports/summary', authenticateToken, async (req, res) => {
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

router.get('/reports/nationalities', authenticateToken, async (req, res) => {
  try {
    const nationalities = await query('SELECT nationality, COUNT(*) as count FROM pilgrims GROUP BY nationality ORDER BY count DESC');
    res.json(nationalities);
  } catch (err) {
    console.error('Nationalities error:', err);
    res.status(500).json({ error: 'خطأ في جلب الجنسيات' });
  }
});

router.get('/reports/trips', authenticateToken, async (req, res) => {
  try {
    const trips = await query('SELECT id, name, trip_date FROM trips ORDER BY trip_date DESC');
    res.json(trips);
  } catch (err) {
    console.error('Trips error:', err);
    res.status(500).json({ error: 'خطأ في جلب الرحلات' });
  }
});

module.exports = router;
