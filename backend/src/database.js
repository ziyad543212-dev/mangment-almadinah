const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// الاتصال بـ Neon باستخدام متغير البيئة DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // مطلوبة للاتصال السحابي الآمن مع Neon
  }
});

let resolveReady;
let rejectReady;
const ready = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

// تشغيل تهيئة قاعدة البيانات عند بدء الاتصال
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

// دالة لتنفيذ الاستعلامات (الإدخال، التحديث، الحذف)
async function run(sql, params = []) {
  // تحويل علامات الاستفهام (?) في SQLite إلى رموز بارامترات PostgreSQL ($1, $2, ...)
  let paramIndex = 0;
  const convertedSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
  
  const client = await pool.connect();
  try {
    const result = await client.query(convertedSql, params);
    return result;
  } finally {
    client.release();
  }
}

// دالة لجلب صف واحد
async function get(sql, params = []) {
  let paramIndex = 0;
  const convertedSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
  
  const client = await pool.connect();
  try {
    const result = await client.query(convertedSql, params);
    return result.rows[0];
  } finally {
    client.release();
  }
}

// دالة لجلب كل الصفوف
async function all(sql, params = []) {
  let paramIndex = 0;
  const convertedSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
  
  const client = await pool.connect();
  try {
    const result = await client.query(convertedSql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function initializeDatabase() {
  try {
    // 1. جدول المستخدمين
    await run(`
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
    await run(`
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

    // 3. جدول المعتمرين
    await run(`
      CREATE TABLE IF NOT EXISTS pilgrims (
        id SERIAL PRIMARY KEY,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
      )
    `);

    // 4. جدول المدفوعات
    await run(`
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

    // 5. جدول تفاصيل الفئات النقدية
    await run(`
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

    // إنشاء الفهارس (Indexes) لتسريع البحث
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
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

async function seedInitialAdmin() {
  const userCount = await get('SELECT COUNT(*) AS count FROM users');
  // PostgreSQL يرجع الـ count كـ string أو number، نحوله لرقم للتاكد
  if (parseInt(userCount.count) > 0) return;

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

module.exports = {
  query: (sql, params) => pool.query(sql, params),
  run,
  get,
  all,
  ready: pool.ready
};