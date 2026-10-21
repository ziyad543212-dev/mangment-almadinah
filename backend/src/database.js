const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

let resolveReady;
let rejectReady;
const ready = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

initializeDatabase()
  .then(() => {
    resolveReady();
    console.log('Database connected and initialized successfully on Neon.');
  })
  .catch((error) => {
    rejectReady(error);
    console.error('Database initialization failed:', error);
  });

pool.ready = ready;
pool.dataDir = process.cwd();

async function run(sql, params = []) {
  let paramIndex = 0;
  const convertedSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
  const result = await pool.query(convertedSql, params);
  return {
    lastID: result.rows[0]?.id,
    changes: result.rowCount
  };
}

async function get(sql, params = []) {
  let paramIndex = 0;
  const convertedSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
  const result = await pool.query(convertedSql, params);
  return result.rows[0];
}

async function all(sql, params = []) {
  let paramIndex = 0;
  const convertedSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
  const result = await pool.query(convertedSql, params);
  return result.rows;
}

// التوافقية مع الكولباك ليعمل السيرفر بسلاسة
function dbAll(sql, params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = [];
  }
  all(sql, params)
    .then(rows => callback(null, rows))
    .catch(err => callback(err));
}

function dbGet(sql, params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = [];
  }
  get(sql, params)
    .then(row => callback(null, row))
    .catch(err => callback(err));
}

function dbRun(sql, params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = [];
  }
  run(sql, params)
    .then(res => {
      const context = { lastID: res.lastID, changes: res.changes };
      if (callback) callback.call(context, null);
    })
    .catch(err => {
      if (callback) callback(err);
    });
}

async function initializeDatabase() {
  try {
    // 1. جدول المستخدمين
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. جدول الرحلات
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trips (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        trip_date DATE NOT NULL,
        trip_cost_usd REAL DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. جدول المعتمرين (مع الحقول المفصلة للأسماء بالعربي والانجليزي)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pilgrims (
        id SERIAL PRIMARY KEY,
        trip_id INTEGER NOT NULL,
        first_name_ar TEXT,
        father_name_ar TEXT,
        last_name_ar TEXT,
        first_name_en TEXT,
        father_name_en TEXT,
        last_name_en TEXT,
        nationality TEXT NOT NULL,
        passport_number TEXT UNIQUE NOT NULL,
        passport_expiry_date DATE,
        date_of_birth DATE,
        gender TEXT,
        visa_number TEXT,
        visa_document_path TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
      )
    `);

    for (const [column, type] of [
      ['first_name_ar', 'TEXT'],
      ['father_name_ar', 'TEXT'],
      ['last_name_ar', 'TEXT'],
      ['first_name_en', 'TEXT'],
      ['father_name_en', 'TEXT'],
      ['last_name_en', 'TEXT'],
      ['passport_expiry_date', 'DATE'],
      ['date_of_birth', 'DATE'],
      ['gender', 'TEXT'],
      ['visa_document_path', 'TEXT']
    ]) {
      await pool.query(`ALTER TABLE pilgrims ADD COLUMN IF NOT EXISTS ${column} ${type}`);
    }

    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'pilgrims'
            AND column_name = 'full_name'
        ) THEN
          UPDATE pilgrims
          SET
            first_name_ar = COALESCE(first_name_ar, NULLIF((regexp_split_to_array(BTRIM(full_name), '\\s+'))[1], '')),
            father_name_ar = COALESCE(father_name_ar, NULLIF((regexp_split_to_array(BTRIM(full_name), '\\s+'))[2], '')),
            last_name_ar = COALESCE(
              last_name_ar,
              NULLIF(array_to_string((regexp_split_to_array(BTRIM(full_name), '\\s+'))[3:], ' '), '')
            )
          WHERE first_name_ar IS NULL AND full_name IS NOT NULL;
          ALTER TABLE pilgrims ALTER COLUMN full_name DROP NOT NULL;
        END IF;
      END;
      $$
    `);

    // 4. جدول المدفوعات
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        pilgrim_id INTEGER NOT NULL,
        amount_usd REAL NOT NULL,
        payment_method TEXT NOT NULL,
        payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        transaction_reference TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pilgrim_id) REFERENCES pilgrims(id) ON DELETE CASCADE
      )
    `);

    // 5. جدول الفئات النقدية
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cash_payment_denominations (
        id SERIAL PRIMARY KEY,
        payment_id INTEGER NOT NULL,
        denomination INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        subtotal REAL NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
      )
    `);

    // إنشاء الفهارس لتسريع البحث
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_passport_number ON pilgrims(passport_number)',
      'CREATE INDEX IF NOT EXISTS idx_visa_number ON pilgrims(visa_number)',
      'CREATE INDEX IF NOT EXISTS idx_nationality ON pilgrims(nationality)',
      'CREATE INDEX IF NOT EXISTS idx_trip_id ON pilgrims(trip_id)'
    ];

    for (const index of indexes) {
      await pool.query(index);
    }

    await seedInitialAdmin();
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

async function seedInitialAdmin() {
  const res = await pool.query('SELECT COUNT(*) AS count FROM users');
  if (parseInt(res.rows[0].count) > 0) return;

  const username = process.env.INITIAL_ADMIN_USERNAME?.trim() || 'admin';
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('INITIAL_ADMIN_PASSWORD must be configured before starting with an empty production database');
    }
    return;
  }

  if (password.length < 12) {
    throw new Error('INITIAL_ADMIN_PASSWORD must be at least 12 characters long');
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  await pool.query(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
    [username, passwordHash, 'admin']
  );
  console.log(`Initial admin user "${username}" created.`);
}

module.exports = {
  query: (sql, params) => pool.query(sql, params),
  run: dbRun,
  get: dbGet,
  all: dbAll,
  ready,
  dataDir: process.cwd()
};