const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

if (process.env.NODE_ENV === 'production') {
  console.error('Sample data seeding is disabled in production.');
  process.exitCode = 1;
} else {
  const db = require('./database');

  const sampleTrips = [
    { name: 'رحلة رمضان الأولى', trip_date: '2027-03-01', cost: 1200, notes: 'بيانات تجريبية' },
    { name: 'رحلة رمضان الثانية', trip_date: '2027-03-15', cost: 1400, notes: 'بيانات تجريبية' }
  ];
  const samplePilgrims = [
    { trip: 0, name: ['أحمد', 'محمد', 'علي'], nationality: 'السعودية', passport: 'DEMO-A12345678' },
    { trip: 0, name: ['فاطمة', 'سالم', 'أحمد'], nationality: 'مصر', passport: 'DEMO-E87654321' },
    { trip: 1, name: ['عمر', 'يوسف', 'إبراهيم'], nationality: 'الأردن', passport: 'DEMO-J44444444' }
  ];

  db.transaction(async ({ query }) => {
    const tripIds = [];
    for (const trip of sampleTrips) {
      const result = await query(
        'INSERT INTO trips (name, trip_date, trip_cost_usd, notes) VALUES (?, ?, ?, ?) RETURNING id',
        [trip.name, trip.trip_date, trip.cost, trip.notes]
      );
      tripIds.push(result.rows[0].id);
    }

    for (const pilgrim of samplePilgrims) {
      const pilgrimResult = await query(
        `INSERT INTO pilgrims
          (trip_id, first_name_ar, father_name_ar, last_name_ar, nationality, passport_number)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        [tripIds[pilgrim.trip], ...pilgrim.name, pilgrim.nationality, pilgrim.passport]
      );
      const payment = await query(
        `INSERT INTO payments (pilgrim_id, amount_usd, payment_method, notes)
         VALUES (?, ?, ?, ?) RETURNING id`,
        [pilgrimResult.rows[0].id, 100, 'نقدًا', 'دفعة تجريبية']
      );
      await query(
        `INSERT INTO cash_payment_denominations (payment_id, denomination, quantity, subtotal)
         VALUES (?, ?, ?, ?)`,
        [payment.rows[0].id, 100, 1, 100]
      );
    }
  })
    .then(() => console.log('Sample PostgreSQL data created.'))
    .catch((error) => {
      console.error('Sample data seeding failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
