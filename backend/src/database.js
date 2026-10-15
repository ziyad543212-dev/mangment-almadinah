const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
const dbPath = path.join(dataDir, 'database.sqlite');

fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Create Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Error creating users table:', err);
      else console.log('Users table created or verified');
    });

    // Create Trips table
    db.run(`
      CREATE TABLE IF NOT EXISTS trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        trip_date DATE NOT NULL,
        trip_cost_usd REAL DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('Error creating trips table:', err);
      else console.log('Trips table created or verified');
    });

    // Create Pilgrims table (updated with trip_id and new fields)
    db.run(`
      CREATE TABLE IF NOT EXISTS pilgrims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER NOT NULL,
        name_ar TEXT,
        name_en TEXT,
        nationality TEXT NOT NULL,
        passport_number TEXT UNIQUE NOT NULL,
        passport_expiry_date DATE,
        date_of_birth DATE,
        gender TEXT,
        visa_number TEXT,
        visa_document_path TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Error creating pilgrims table:', err);
      else {
        console.log('Pilgrims table created or verified');
        // Run migrations synchronously before creating indexes
        runPilgrimMigrationsSync();
        // Then create indexes
        createIndexes();
      }
    });

    // Create Payments table (updated for USD and payment methods)
    db.run(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pilgrim_id INTEGER NOT NULL,
        amount_usd REAL NOT NULL,
        payment_method TEXT NOT NULL CHECK(payment_method IN ('نقدًا', 'شام كاش')),
        payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        transaction_reference TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pilgrim_id) REFERENCES pilgrims(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Error creating payments table:', err);
      else console.log('Payments table created or verified');
    });

    // Create CashPaymentDenominations table
    db.run(`
      CREATE TABLE IF NOT EXISTS cash_payment_denominations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL,
        denomination INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        subtotal REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('Error creating cash_payment_denominations table:', err);
      else console.log('CashPaymentDenominations table created or verified');
    });
  });
}

function runPilgrimMigrationsSync() {
  const migrations = [
    { sql: 'ALTER TABLE pilgrims ADD COLUMN name_ar TEXT', name: 'name_ar' },
    { sql: 'ALTER TABLE pilgrims ADD COLUMN name_en TEXT', name: 'name_en' },
    { sql: 'ALTER TABLE pilgrims ADD COLUMN passport_expiry_date DATE', name: 'passport_expiry_date' },
    { sql: 'ALTER TABLE pilgrims ADD COLUMN date_of_birth DATE', name: 'date_of_birth' },
    { sql: 'ALTER TABLE pilgrims ADD COLUMN gender TEXT', name: 'gender' },
    { sql: 'ALTER TABLE pilgrims ADD COLUMN visa_document_path TEXT', name: 'visa_document_path' }
  ];

  migrations.forEach((migration) => {
    db.run(migration.sql, (err) => {
      if (err) {
        if (err.message.includes('duplicate column')) {
          console.log(`Column ${migration.name} already exists`);
        } else {
          console.error(`Error adding column ${migration.name}:`, err.message);
        }
      } else {
        console.log(`Column ${migration.name} added successfully`);
      }
    });
  });
}

function createIndexes() {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_passport_number ON pilgrims(passport_number)',
    'CREATE INDEX IF NOT EXISTS idx_visa_number ON pilgrims(visa_number)',
    'CREATE INDEX IF NOT EXISTS idx_nationality ON pilgrims(nationality)',
    'CREATE INDEX IF NOT EXISTS idx_name_en ON pilgrims(name_en)',
    'CREATE INDEX IF NOT EXISTS idx_name_ar ON pilgrims(name_ar)',
    'CREATE INDEX IF NOT EXISTS idx_pilgrim_id ON payments(pilgrim_id)',
    'CREATE INDEX IF NOT EXISTS idx_trip_id ON pilgrims(trip_id)',
    'CREATE INDEX IF NOT EXISTS idx_trip_date ON trips(trip_date)',
    'CREATE INDEX IF NOT EXISTS idx_payment_id ON cash_payment_denominations(payment_id)'
  ];

  indexes.forEach((indexSql, index) => {
    db.run(indexSql, (err) => {
      if (err) console.error(`Error creating index ${index}:`, err);
      else console.log(`Index ${index} created or verified`);
    });
  });
}

module.exports = db;
