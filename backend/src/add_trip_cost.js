require('dotenv').config();
const db = require('./database');

console.log('Adding trip_cost_usd field to trips table...');

// Check if trip_cost_usd column already exists
db.all("PRAGMA table_info(trips)", (err, columns) => {
  if (err) {
    console.error('Error checking trips table structure:', err);
    process.exit(1);
  }

  const hasTripCost = columns.some(col => col.name === 'trip_cost_usd');

  if (hasTripCost) {
    console.log('trip_cost_usd column already exists. No migration needed.');
    process.exit(0);
  }

  console.log('Adding trip_cost_usd column to trips table...');

  // Add the column with default value 0
  db.run(
    `ALTER TABLE trips ADD COLUMN trip_cost_usd REAL DEFAULT 0`,
    (err) => {
      if (err) {
        console.error('Error adding trip_cost_usd column:', err);
        process.exit(1);
      }

      console.log('✅ Successfully added trip_cost_usd column to trips table');
      console.log('Default value: 0');
      console.log('Existing trips will have trip_cost_usd set to 0');
      process.exit(0);
    }
  );
});
