require('dotenv').config();
const db = require('./database');

db.ready.then(() => {
  console.log('Seeding sample data...');

  const trips = [
  {
    name: 'رحلة رمضان الأولى',
    trip_date: '2024-03-15',
    notes: 'رحلة رمضان للعمرة'
  },
  {
    name: 'رحلة رمضان الثانية',
    trip_date: '2024-04-01',
    notes: 'رحلة رمضان الثانية للعمرة'
  }
  ];

let tripCounter = 0;
trips.forEach((trip, index) => {
  db.run(
    'INSERT INTO trips (name, trip_date, notes) VALUES (?, ?, ?)',
    [trip.name, trip.trip_date, trip.notes],
    function(err) {
      if (err) {
        console.error(`Error inserting trip ${index + 1}:`, err);
      } else {
        tripCounter++;

        // If all trips are created, add pilgrims
        if (tripCounter === trips.length) {
          addPilgrimsToTrips();
        }
      }
    }
  );
});

function addPilgrimsToTrips() {
  // Sample pilgrims data with trip assignments
  const pilgrims = [
    {
      trip_id: 1,
      first_name_ar: 'أحمد',
      father_name_ar: 'محمد',
      last_name_ar: 'علي',
      nationality: 'السعودية',
      passport_number: 'A12345678',
      visa_number: 'V98765432',
      notes: 'حاج مستقل'
    },
    {
      trip_id: 1,
      first_name_ar: 'فاطمة',
      father_name_ar: 'سالم',
      last_name_ar: 'أحمد',
      nationality: 'مصر',
      passport_number: 'E87654321',
      visa_number: 'V12345678',
      notes: 'معمر مع الأسرة'
    },
    {
      trip_id: 1,
      first_name_ar: 'محمد',
      father_name_ar: 'عبدالله',
      last_name_ar: 'الحربي',
      nationality: 'السعودية',
      passport_number: 'A55555555',
      visa_number: 'V55555555',
      notes: null
    },
    {
      trip_id: 2,
      first_name_ar: 'عمر',
      father_name_ar: 'يوسف',
      last_name_ar: 'إبراهيم',
      nationality: 'الأردن',
      passport_number: 'J44444444',
      visa_number: null,
      notes: 'حاج في المجموعة أ'
    },
    {
      trip_id: 2,
      first_name_ar: 'خالد',
      father_name_ar: 'سعيد',
      last_name_ar: 'محمود',
      nationality: 'الكويت',
      passport_number: 'K33333333',
      visa_number: 'V33333333',
      notes: null
    }
  ];

  let pilgrimCounter = 0;
  pilgrims.forEach((pilgrim, index) => {
    db.run(
      'INSERT INTO pilgrims (trip_id, first_name_ar, father_name_ar, last_name_ar, nationality, passport_number, visa_number, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [pilgrim.trip_id, pilgrim.first_name_ar, pilgrim.father_name_ar, pilgrim.last_name_ar, pilgrim.nationality, pilgrim.passport_number, pilgrim.visa_number, pilgrim.notes],
      function(err) {
        if (err) {
          console.error(`Error inserting pilgrim ${index + 1}:`, err);
        } else {
          // Add some payments for this pilgrim
          const pilgrimId = this.lastID;
          const payments = [
            { amount_usd: 500, payment_method: 'نقدًا', notes: 'دفعة أولى' },
            { amount_usd: 300, payment_method: 'شام كاش', notes: 'دفعة ثانية' }
          ];

          payments.forEach((payment, pIndex) => {
            db.run(
              'INSERT INTO payments (pilgrim_id, amount_usd, payment_method, notes) VALUES (?, ?, ?, ?)',
              [pilgrimId, payment.amount_usd, payment.payment_method, payment.notes],
              function(err) {
                if (err) {
                  console.error(`Error inserting payment ${pIndex + 1} for pilgrim ${pilgrimId}:`, err);
                } else {
                  // Add cash denominations for cash payments
                  if (payment.payment_method === 'نقدًا') {
                    const paymentId = this.lastID;
                    const denominations = [
                      { denomination: 100, quantity: 5, subtotal: 500 }
                    ];

                    denominations.forEach((denom) => {
                      db.run(
                        'INSERT INTO cash_payment_denominations (payment_id, denomination, quantity, subtotal) VALUES (?, ?, ?, ?)',
                        [paymentId, denom.denomination, denom.quantity, denom.subtotal],
                        (err) => {
                          if (err) {
                            console.error(`Error inserting cash denomination for payment ${paymentId}:`, err);
                          }
                        }
                      );
                    });
                  }
                }
              }
            );
          });
        }
        pilgrimCounter++;
      }
    );
  });
}

  console.log('Sample data seeding completed.');

  setTimeout(() => {
    db.close((error) => {
      if (error) {
        console.error('Error closing database:', error);
        process.exitCode = 1;
      }
    });
  }, 3000);
}).catch((error) => {
  console.error('Seeding failed:', error);
  process.exitCode = 1;
});
