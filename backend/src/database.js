const bcrypt = require('bcryptjs');
const { createDatabasePool } = require('./services/database-connection');

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error('DATABASE_URL must be configured before starting the backend');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql:// and include a database name');
  }
  return value;
}

const databaseUrl = getDatabaseUrl();
const databaseHostname = new URL(databaseUrl).hostname;
const isLoopbackDatabase = ['127.0.0.1', 'localhost', '::1'].includes(databaseHostname);
const pool = createDatabasePool(databaseUrl, {
  ssl: !isLoopbackDatabase && process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : false,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  max: Number.parseInt(process.env.PG_POOL_MAX || '10', 10)
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.code || error.name || 'unknown error');
});

function convertPlaceholders(sql) {
  let parameterIndex = 0;
  return sql.replace(/\?/g, () => `$${++parameterIndex}`);
}

const migrations = [
  {
    version: 1,
    name: 'create-core-tables',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'admin',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS trips (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          trip_date DATE NOT NULL,
          trip_cost_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS pilgrims (
          id SERIAL PRIMARY KEY,
          trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
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
          origin_city TEXT NOT NULL DEFAULT 'دمشق',
          destination_city TEXT NOT NULL DEFAULT 'جدة',
          gender TEXT,
          visa_number TEXT,
          visa_document_path TEXT,
          notes TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          pilgrim_id INTEGER NOT NULL REFERENCES pilgrims(id) ON DELETE CASCADE,
          amount_usd NUMERIC(12, 2) NOT NULL CHECK (amount_usd > 0),
          payment_method TEXT NOT NULL,
          payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          transaction_reference TEXT,
          notes TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS cash_payment_denominations (
          id SERIAL PRIMARY KEY,
          payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
          denomination INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          subtotal NUMERIC(12, 2) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
  },
  {
    version: 2,
    name: 'align-existing-postgresql-schema',
    async up(client) {
      await client.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin',
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      `);
      await client.query(`
        ALTER TABLE trips
          ADD COLUMN IF NOT EXISTS trip_cost_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      `);
      await client.query(`
        ALTER TABLE pilgrims
          ADD COLUMN IF NOT EXISTS trip_id INTEGER,
          ADD COLUMN IF NOT EXISTS first_name_ar TEXT,
          ADD COLUMN IF NOT EXISTS father_name_ar TEXT,
          ADD COLUMN IF NOT EXISTS last_name_ar TEXT,
          ADD COLUMN IF NOT EXISTS first_name_en TEXT,
          ADD COLUMN IF NOT EXISTS father_name_en TEXT,
          ADD COLUMN IF NOT EXISTS last_name_en TEXT,
          ADD COLUMN IF NOT EXISTS nationality TEXT,
          ADD COLUMN IF NOT EXISTS passport_number TEXT,
          ADD COLUMN IF NOT EXISTS passport_expiry_date DATE,
          ADD COLUMN IF NOT EXISTS date_of_birth DATE,
          ADD COLUMN IF NOT EXISTS origin_city TEXT DEFAULT 'دمشق',
          ADD COLUMN IF NOT EXISTS destination_city TEXT DEFAULT 'جدة',
          ADD COLUMN IF NOT EXISTS gender TEXT,
          ADD COLUMN IF NOT EXISTS visa_number TEXT,
          ADD COLUMN IF NOT EXISTS visa_document_path TEXT,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      `);
      await client.query(`
        DO $$
        DECLARE
          fallback_trip_id INTEGER;
        BEGIN
          IF EXISTS (SELECT 1 FROM pilgrims WHERE trip_id IS NULL) THEN
            INSERT INTO trips (name, trip_date, notes)
            VALUES ('رحلة مرحّلة', CURRENT_DATE, 'تم إنشاؤها أثناء ترحيل قاعدة البيانات')
            RETURNING id INTO fallback_trip_id;
            UPDATE pilgrims SET trip_id = fallback_trip_id WHERE trip_id IS NULL;
          END IF;
        END;
        $$
      `);
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'pilgrims' AND column_name = 'full_name'
          ) THEN
            EXECUTE $sql$
              UPDATE pilgrims
              SET first_name_ar = COALESCE(first_name_ar,
                    NULLIF((regexp_split_to_array(BTRIM(full_name), '\\s+'))[1], '')),
                  father_name_ar = COALESCE(father_name_ar,
                    NULLIF((regexp_split_to_array(BTRIM(full_name), '\\s+'))[2], '')),
                  last_name_ar = COALESCE(last_name_ar,
                    NULLIF(array_to_string((regexp_split_to_array(BTRIM(full_name), '\\s+'))[3:], ' '), ''))
              WHERE full_name IS NOT NULL
            $sql$;
          END IF;
        END;
        $$
      `);
      await client.query(`
        UPDATE pilgrims
        SET origin_city = COALESCE(NULLIF(BTRIM(origin_city), ''), 'دمشق'),
            destination_city = COALESCE(NULLIF(BTRIM(destination_city), ''), 'جدة')
      `);
      await client.query(`
        ALTER TABLE pilgrims
          ALTER COLUMN trip_id SET NOT NULL,
          ALTER COLUMN origin_city SET DEFAULT 'دمشق',
          ALTER COLUMN destination_city SET DEFAULT 'جدة'
      `);
      await client.query(`
        ALTER TABLE payments
          ADD COLUMN IF NOT EXISTS pilgrim_id INTEGER,
          ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(12, 2),
          ADD COLUMN IF NOT EXISTS payment_method TEXT,
          ADD COLUMN IF NOT EXISTS payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ADD COLUMN IF NOT EXISTS transaction_reference TEXT,
          ADD COLUMN IF NOT EXISTS notes TEXT,
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      `);
      await client.query(`
        ALTER TABLE cash_payment_denominations
          ADD COLUMN IF NOT EXISTS payment_id INTEGER,
          ADD COLUMN IF NOT EXISTS denomination INTEGER,
          ADD COLUMN IF NOT EXISTS quantity INTEGER,
          ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12, 2),
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      `);
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pilgrims_trip_id_fkey') THEN
            ALTER TABLE pilgrims ADD CONSTRAINT pilgrims_trip_id_fkey
              FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_pilgrim_id_fkey') THEN
            ALTER TABLE payments ADD CONSTRAINT payments_pilgrim_id_fkey
              FOREIGN KEY (pilgrim_id) REFERENCES pilgrims(id) ON DELETE CASCADE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_payment_denominations_payment_id_fkey') THEN
            ALTER TABLE cash_payment_denominations ADD CONSTRAINT cash_payment_denominations_payment_id_fkey
              FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE;
          END IF;
        END;
        $$
      `);
      await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_pilgrims_passport_number_unique ON pilgrims(passport_number)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_visa_number ON pilgrims(visa_number)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_nationality ON pilgrims(nationality)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_trip_id ON pilgrims(trip_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_trip_date ON trips(trip_date)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_pilgrim_id ON payments(pilgrim_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_payment_id ON cash_payment_denominations(payment_id)');
    }
  },
  {
    version: 3,
    name: 'use-exact-currency-columns',
    async up(client) {
      await client.query(`
        ALTER TABLE trips ALTER COLUMN trip_cost_usd TYPE NUMERIC(12, 2)
        USING ROUND(trip_cost_usd::numeric, 2)
      `);
      await client.query(`
        ALTER TABLE payments ALTER COLUMN amount_usd TYPE NUMERIC(12, 2)
        USING ROUND(amount_usd::numeric, 2)
      `);
      await client.query(`
        ALTER TABLE cash_payment_denominations ALTER COLUMN subtotal TYPE NUMERIC(12, 2)
        USING ROUND(subtotal::numeric, 2)
      `);
    }
  },
  {
    version: 4,
    name: 'allow-passport-reuse-across-trips',
    async up(client) {
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pilgrims_passport_number_key') THEN
            ALTER TABLE pilgrims DROP CONSTRAINT pilgrims_passport_number_key;
          END IF;
        END;
        $$
      `);
      await client.query('DROP INDEX IF EXISTS idx_pilgrims_passport_number_unique');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_pilgrims_passport_number_lookup
        ON pilgrims(passport_number)
      `);
    }
  }
];

async function runMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = await client.query('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(applied.rows.map((row) => row.version));

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;

    await client.query('BEGIN');
    try {
      await migration.up(client);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [migration.version, migration.name]
      );
      await client.query('COMMIT');
      console.log(`Applied database migration ${migration.version}: ${migration.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Database migration ${migration.version} (${migration.name}) failed: ${error.message}`, { cause: error });
    }
  }
}

async function seedInitialAdmin(client) {
  const existingUsers = await client.query('SELECT 1 FROM users LIMIT 1');
  if (existingUsers.rowCount > 0) return;

  const username = process.env.INITIAL_ADMIN_USERNAME || 'admin';
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!password) return;
  if (password.length < 8) {
    throw new Error('INITIAL_ADMIN_PASSWORD must contain at least 8 characters');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
    [username, passwordHash, 'admin']
  );
  console.log(`Initial administrator "${username}" created.`);
}

function isTransientConnectionError(error) {
  return error?.code?.startsWith('08') ||
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', '57P03']
      .includes(error?.code) || /connection (?:terminated due to connection timeout|timeout)|timeout exceeded when trying to connect/i.test(error?.message || '');
}

async function connectWithRetry() {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await pool.connect();
    } catch (error) {
      if (!isTransientConnectionError(error) || attempt === maxAttempts) throw error;
      const delayMs = 1000 * (2 ** (attempt - 1));
      console.warn(`PostgreSQL connection attempt ${attempt} failed; retrying in ${delayMs}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Unable to connect to PostgreSQL.');
}

async function initializeDatabase() {
  const client = await connectWithRetry();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [834756213]);
    await runMigrations(client);
    await client.query('BEGIN');
    try {
      await seedInitialAdmin(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [834756213]);
    } finally {
      client.release();
    }
  }
}

const ready = initializeDatabase().catch((error) => {
  console.error('PostgreSQL initialization failed:', error.code || error.name || 'unknown error');
  throw error;
});

async function query(sql, params = []) {
  await ready;
  return pool.query(convertPlaceholders(sql), params);
}

async function get(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0];
}

async function all(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

async function run(sql, params = []) {
  const result = await query(sql, params);
  return {
    lastID: result.rows[0]?.id,
    changes: result.rowCount
  };
}

function callbackQuery(operation, sql, params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = [];
  }
  operation(sql, params || [])
    .then((result) => callback?.(null, result))
    .catch((error) => callback?.(error));
}

function dbRun(sql, params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = [];
  }
  run(sql, params || [])
    .then((result) => {
      if (callback) callback.call({ lastID: result.lastID, changes: result.changes }, null);
    })
    .catch((error) => callback?.(error));
}

function transaction(callback) {
  return ready.then(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback({
        query: (sql, params = []) => client.query(convertPlaceholders(sql), params)
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

module.exports = {
  pool,
  query,
  get: (sql, params, callback) => callbackQuery(get, sql, params, callback),
  all: (sql, params, callback) => callbackQuery(all, sql, params, callback),
  run: dbRun,
  transaction,
  ready,
  migrate: () => ready,
  close: () => pool.end()
};
