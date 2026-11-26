const db = require('../database');

const BACKUP_FORMAT = 'mang-postgresql-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_ROWS = 250_000;
const TABLES = [
  {
    name: 'users',
    columns: ['id', 'username', 'password_hash', 'role', 'created_at', 'updated_at']
  },
  {
    name: 'trips',
    columns: ['id', 'name', 'trip_date', 'trip_cost_usd', 'notes', 'created_at', 'updated_at']
  },
  {
    name: 'pilgrims',
    columns: [
      'id', 'trip_id', 'first_name_ar', 'father_name_ar', 'last_name_ar',
      'first_name_en', 'father_name_en', 'last_name_en', 'nationality', 'passport_number',
      'passport_expiry_date', 'date_of_birth', 'origin_city', 'destination_city', 'gender',
      'visa_number', 'visa_document_path', 'notes', 'created_at', 'updated_at'
    ]
  },
  {
    name: 'payments',
    columns: [
      'id', 'pilgrim_id', 'amount_usd', 'payment_method', 'payment_date',
      'transaction_reference', 'notes', 'created_at'
    ]
  },
  {
    name: 'cash_payment_denominations',
    columns: ['id', 'payment_id', 'denomination', 'quantity', 'subtotal', 'created_at']
  }
];

async function createBackup() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = {};
    for (const table of TABLES) {
      const columns = table.columns.map((column) => `"${column}"`).join(', ');
      const result = await client.query(`SELECT ${columns} FROM "${table.name}" ORDER BY id`);
      tables[table.name] = result.rows;
    }
    await client.query('COMMIT');
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      tables
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' ||
      backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION ||
      !backup.tables || typeof backup.tables !== 'object' || Array.isArray(backup.tables)) {
    throw new TypeError('ملف النسخة الاحتياطية غير صالح أو غير مدعوم');
  }
  if (Object.keys(backup.tables).length !== TABLES.length) {
    throw new TypeError('النسخة الاحتياطية لا تحتوي الجداول المطلوبة');
  }

  let rowCount = 0;
  for (const table of TABLES) {
    const rows = backup.tables[table.name];
    if (!Array.isArray(rows)) throw new TypeError(`بيانات جدول ${table.name} غير صالحة`);
    rowCount += rows.length;
    if (rowCount > MAX_BACKUP_ROWS) throw new RangeError('النسخة الاحتياطية تحتوي سجلات أكثر من الحد المسموح');

    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          !Number.isSafeInteger(Number(row.id)) || Number(row.id) < 1) {
        throw new TypeError(`يوجد سجل غير صالح في جدول ${table.name}`);
      }
      const allowedColumns = new Set(table.columns);
      for (const [column, value] of Object.entries(row)) {
        if (!allowedColumns.has(column) ||
            (value !== null && !['string', 'number', 'boolean'].includes(typeof value))) {
          throw new TypeError(`بيانات الحقل ${column} في جدول ${table.name} غير صالحة`);
        }
      }
    }
  }
  return rowCount;
}

async function restoreBackup(backup) {
  const rowCount = validateBackup(backup);
  await db.transaction(async ({ query }) => {
    await query(`
      TRUNCATE TABLE users, trips, pilgrims, payments, cash_payment_denominations
      RESTART IDENTITY
    `);

    for (const table of TABLES) {
      for (const row of backup.tables[table.name]) {
        const columns = Object.keys(row);
        const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((column) => row[column]);
        await query(
          `INSERT INTO "${table.name}" (${quotedColumns}) VALUES (${placeholders})`,
          values
        );
      }
    }

    for (const table of TABLES) {
      await query(`
        SELECT setval(
          pg_get_serial_sequence('"${table.name}"', 'id'),
          COALESCE((SELECT MAX(id) FROM "${table.name}"), 1),
          EXISTS (SELECT 1 FROM "${table.name}")
        )
      `);
    }
  });
  return rowCount;
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackup,
  validateBackup,
  restoreBackup
};
