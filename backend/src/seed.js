require('dotenv').config();
const db = require('./database');
const { hashPassword } = require('./auth');

console.log('Seeding database...');

// Create admin user
const adminPassword = hashPassword('admin123');
db.run(
  'INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)',
  ['admin', adminPassword, 'admin'],
  (err) => {
    if (err) {
      console.error('Error creating admin user:', err);
    } else {
      console.log('Admin user created (username: admin, password: admin123)');
    }
  }
);

// Create sample trips
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
      full_name: 'أحمد محمد علي',
      nationality: 'السعودية',
      passport_number: 'A12345678',
      visa_number: 'V98765432',
      notes: 'حاج مستقل'
    },
    {
      trip_id: 1,
      full_name: 'فاطمة سالم أحمد',
      nationality: 'مصر',
      passport_number: 'E87654321',
      visa_number: 'V12345678',
      notes: 'معمر مع الأسرة'
    },
    {
      trip_id: 1,
      full_name: 'محمد عبدالله الحربي',
      nationality: 'السعودية',
      passport_number: 'A55555555',
      visa_number: 'V55555555',
      notes: null
    },
    {
      trip_id: 2,
      full_name: 'عمر يوسف إبراهيم',
      nationality: 'الأردن',
      passport_number: 'J44444444',
      visa_number: null,
      notes: 'حاج في المجموعة أ'
    },
    {
      trip_id: 2,
      full_name: 'خالد سعيد محمود',
      nationality: 'الكويت',
      passport_number: 'K33333333',
      visa_number: 'V33333333',
      notes: null
    }
  ];

  let pilgrimCounter = 0;
  pilgrims.forEach((pilgrim, index) => {
    db.run(
      'INSERT INTO pilgrims (trip_id, full_name, nationality, passport_number, visa_number, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [pilgrim.trip_id, pilgrim.full_name, pilgrim.nationality, pilgrim.passport_number, pilgrim.visa_number, pilgrim.notes],
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

console.log('Seeding completed!');
console.log('Default admin credentials:');
console.log('Username: admin');
console.log('Password: admin123');
console.log('Please change these credentials in production!');

setTimeout(() => {
  db.close();
  process.exit(0);
}, 3000);
