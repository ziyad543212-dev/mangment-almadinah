const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const configuredDataDir = process.env.DATA_DIR?.trim();
const dataDir = configuredDataDir && configuredDataDir !== '.'
  ? path.resolve(configuredDataDir)
  : path.resolve(__dirname, '..');
const dbPath = path.join(dataDir, 'database.sqlite');

fs.mkdirSync(dataDir, { recursive: true });

let resolveReady;
let rejectReady;
const ready = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

const db = new sqlite3.Database(dbPath, (error) => {
  if (error) {
    rejectReady(error);
    return;
  }

  initializeDatabase().then(resolveReady, rejectReady);
});
db.ready = ready;
db.dataDir = dataDir;

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

async function ensureColumn(table, column, definition) {
  const columns = await all(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initializeDatabase() {
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await ensureColumn('users', 'role', "TEXT DEFAULT 'admin'");

    await run(`
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

    await run(`
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
    `);
    await ensureColumn('pilgrims', 'name_ar', 'TEXT');
    await ensureColumn('pilgrims', 'name_en', 'TEXT');
    await ensureColumn('pilgrims', 'passport_expiry_date', 'DATE');
    await ensureColumn('pilgrims', 'date_of_birth', 'DATE');
    await ensureColumn('pilgrims', 'gender', 'TEXT');
    await ensureColumn('pilgrims', 'visa_document_path', 'TEXT');

    await run(`
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

    await run(`
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

    for (const index of indexes) {
      await run(index);
    }

    await seedInitialAdmin();
    console.log(`Database initialized at ${dbPath}`);
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

async function seedInitialAdmin() {
  const userCount = await get('SELECT COUNT(*) AS count FROM users');
  if (userCount.count > 0) return;

  const username = process.env.INITIAL_ADMIN_USERNAME?.trim() || 'admin';
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'INITIAL_ADMIN_PASSWORD must be configured before starting with an empty production database'
      );
    }

    console.warn('No users exist. Set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD to seed an admin.');
    return;
  }

  if (password.length < 12) {
    throw new Error('INITIAL_ADMIN_PASSWORD must be at least 12 characters long');
  }

  await run(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    [username, bcrypt.hashSync(password, 10), 'admin']
  );
  console.log(`Initial admin user "${username}" created.`);
}

module.exports = db;
