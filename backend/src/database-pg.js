const { Pool, types } = require('pg');

// Return COUNT(*) / BIGINT values as numbers instead of strings
types.setTypeParser(20, (val) => parseInt(val, 10));

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Trips table
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

    // Create Pilgrims table
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

    // Create Payments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        pilgrim_id INTEGER NOT NULL,
        amount_usd REAL NOT NULL,
        payment_method TEXT NOT NULL CHECK(payment_method IN ('نقدًا', 'شام كاش')),
        payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        transaction_reference TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pilgrim_id) REFERENCES pilgrims(id) ON DELETE CASCADE
      )
    `);

    // Create CashPaymentDenominations table
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

    // Create indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_passport_number ON pilgrims(passport_number)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_visa_number ON pilgrims(visa_number)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_nationality ON pilgrims(nationality)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pilgrim_id ON payments(pilgrim_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_trip_id ON pilgrims(trip_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_trip_date ON trips(trip_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payment_id ON cash_payment_denominations(payment_id)`);

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
    throw err;
  }
}

// Initialize on first run
initializeDatabase().catch(console.error);

// Export pool and a query helper that works like SQLite
module.exports = {
  pool,
  
  // SQLite-compatible query method
  query: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    
    pool.query(sql, params)
      .then(result => {
        if (callback) callback(null, result.rows);
      })
      .catch(err => {
        if (callback) callback(err);
      });
  },
  
  get: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    
    pool.query(sql, params)
      .then(result => {
        if (callback) callback(null, result.rows[0]);
      })
      .catch(err => {
        if (callback) callback(err);
      });
  },
  
  all: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    
    pool.query(sql, params)
      .then(result => {
        if (callback) callback(null, result.rows);
      })
      .catch(err => {
        if (callback) callback(err);
      });
  },
  
  run: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    
    pool.query(sql, params)
      .then(result => {
        if (callback) {
          const resultObj = {
            lastID: result.rows[0]?.id,
            changes: result.rowCount
          };
          callback(null, resultObj);
        }
      })
      .catch(err => {
        if (callback) callback(err);
      });
  }
};
