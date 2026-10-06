const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../database.sqlite');

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
    `);

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
    `);

    // Create Pilgrims table (updated with trip_id)
    db.run(`
      CREATE TABLE IF NOT EXISTS pilgrims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trip_id INTEGER NOT NULL,
        full_name TEXT NOT NULL,
        nationality TEXT NOT NULL,
        passport_number TEXT UNIQUE NOT NULL,
        visa_number TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
      )
    `);

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
    `);

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
    `);

    // Create indexes for common search fields
    db.run(`CREATE INDEX IF NOT EXISTS idx_passport_number ON pilgrims(passport_number)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_visa_number ON pilgrims(visa_number)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_nationality ON pilgrims(nationality)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_full_name ON pilgrims(full_name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_pilgrim_id ON payments(pilgrim_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_trip_id ON pilgrims(trip_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_trip_date ON trips(trip_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_payment_id ON cash_payment_denominations(payment_id)`);
  });
}

module.exports = db;
