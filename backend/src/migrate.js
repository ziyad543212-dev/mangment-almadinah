require('dotenv').config();
const db = require('./database');

console.log('Running database migration...');

// Check if trips table exists and has the new structure
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='trips'", (err, row) => {
  if (err) {
    console.error('Error checking trips table:', err);
    process.exit(1);
  }

  if (!row) {
    console.log('Trips table does not exist. Database needs to be recreated.');
    console.log('Please delete database.sqlite and restart the server.');
    process.exit(0);
  }

  // Check if pilgrims table has trip_id column
  db.all("PRAGMA table_info(pilgrims)", (err, columns) => {
    if (err) {
      console.error('Error checking pilgrims table structure:', err);
      process.exit(1);
    }

    const hasTripId = columns.some(col => col.name === 'trip_id');

    if (!hasTripId) {
      console.log('Pilgrims table does not have trip_id column. Migration needed.');
      console.log('⚠️  WARNING: This will modify the database structure.');
      console.log('⚠️  Existing pilgrims will be moved to a default trip.');
      console.log('⚠️  Backup your database before proceeding.');

      // Ask for confirmation
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question('Do you want to proceed with migration? (yes/no): ', (answer) => {
        if (answer.toLowerCase() === 'yes') {
          performMigration();
        } else {
          console.log('Migration cancelled.');
          process.exit(0);
        }
        rl.close();
      });
    } else {
      console.log('Database is already migrated.');
      process.exit(0);
    }
  });
});

function performMigration() {
  db.serialize(() => {
    // Start transaction
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) {
        console.error('Error starting transaction:', err);
        process.exit(1);
      }

      // Step 1: Create a default trip for existing pilgrims
      db.run(
        `INSERT INTO trips (name, trip_date, notes) VALUES (?, ?, ?)`,
        ['رحلة افتراضية', '2024-01-01', 'رحلة تم إنشاؤها تلقائياً أثناء الترحيل'],
        function(err) {
          if (err) {
            console.error('Error creating default trip:', err);
            db.run('ROLLBACK');
            process.exit(1);
          }

          const defaultTripId = this.lastID;
          console.log(`Created default trip with ID: ${defaultTripId}`);

          // Step 2: Add trip_id column to pilgrims table
          db.run(
            `ALTER TABLE pilgrims ADD COLUMN trip_id INTEGER`,
            (err) => {
              if (err) {
                console.error('Error adding trip_id column:', err);
                db.run('ROLLBACK');
                process.exit(1);
              }

              console.log('Added trip_id column to pilgrims table');

              // Step 3: Update existing pilgrims to belong to default trip
              db.run(
                `UPDATE pilgrims SET trip_id = ? WHERE trip_id IS NULL`,
                [defaultTripId],
                function(err) {
                  if (err) {
                    console.error('Error updating pilgrims:', err);
                    db.run('ROLLBACK');
                    process.exit(1);
                  }

                  console.log(`Updated ${this.changes} pilgrims to default trip`);

                  // Step 4: Make trip_id NOT NULL
                  // SQLite doesn't support ALTER COLUMN directly, so we need to recreate the table
                  db.run(
                    `CREATE TABLE pilgrims_new (
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
                    )`,
                    (err) => {
                      if (err) {
                        console.error('Error creating pilgrims_new table:', err);
                        db.run('ROLLBACK');
                        process.exit(1);
                      }

                      console.log('Created pilgrims_new table');

                      // Copy data
                      db.run(
                        `INSERT INTO pilgrims_new (id, trip_id, full_name, nationality, passport_number, visa_number, notes, created_at, updated_at)
                         SELECT id, trip_id, full_name, nationality, passport_number, visa_number, notes, created_at, updated_at FROM pilgrims`,
                        function(err) {
                          if (err) {
                            console.error('Error copying pilgrims data:', err);
                            db.run('ROLLBACK');
                            process.exit(1);
                          }

                          console.log('Copied pilgrims data');

                          // Drop old table
                          db.run('DROP TABLE pilgrims', (err) => {
                            if (err) {
                              console.error('Error dropping old pilgrims table:', err);
                              db.run('ROLLBACK');
                              process.exit(1);
                            }

                            console.log('Dropped old pilgrims table');

                            // Rename new table
                            db.run('ALTER TABLE pilgrims_new RENAME TO pilgrims', (err) => {
                              if (err) {
                                console.error('Error renaming pilgrims_new table:', err);
                                db.run('ROLLBACK');
                                process.exit(1);
                              }

                              console.log('Renamed pilgrims_new to pilgrims');

                              // Step 5: Update payments table for USD
                              db.get("PRAGMA table_info(payments)", (err, columns) => {
                                if (err) {
                                  console.error('Error checking payments table:', err);
                                  db.run('ROLLBACK');
                                  process.exit(1);
                                }

                                const hasAmountUsd = columns.some(col => col.name === 'amount_usd');

                                if (!hasAmountUsd) {
                                  db.run(
                                    `CREATE TABLE payments_new (
                                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                                      pilgrim_id INTEGER NOT NULL,
                                      amount_usd REAL NOT NULL,
                                      payment_method TEXT NOT NULL CHECK(payment_method IN ('نقدًا', 'شام كاش')),
                                      payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                                      transaction_reference TEXT,
                                      notes TEXT,
                                      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                      FOREIGN KEY (pilgrim_id) REFERENCES pilgrims(id) ON DELETE CASCADE
                                    )`,
                                    (err) => {
                                      if (err) {
                                        console.error('Error creating payments_new table:', err);
                                        db.run('ROLLBACK');
                                        process.exit(1);
                                      }

                                      console.log('Created payments_new table');

                                      // Copy data - set default payment method if missing
                                      db.run(
                                        `INSERT INTO payments_new (id, pilgrim_id, amount_usd, payment_method, payment_date, transaction_reference, notes, created_at)
                                         SELECT id, pilgrim_id, amount, COALESCE(payment_method, 'نقدًا'), payment_date, NULL, notes, created_at FROM payments`,
                                        function(err) {
                                          if (err) {
                                            console.error('Error copying payments data:', err);
                                            db.run('ROLLBACK');
                                            process.exit(1);
                                          }

                                          console.log('Copied payments data');

                                          // Drop old table
                                          db.run('DROP TABLE payments', (err) => {
                                            if (err) {
                                              console.error('Error dropping old payments table:', err);
                                              db.run('ROLLBACK');
                                              process.exit(1);
                                            }

                                            console.log('Dropped old payments table');

                                            // Rename new table
                                            db.run('ALTER TABLE payments_new RENAME TO payments', (err) => {
                                              if (err) {
                                                console.error('Error renaming payments_new table:', err);
                                                db.run('ROLLBACK');
                                                process.exit(1);
                                              }

                                              console.log('Renamed payments_new to payments');

                                              // Commit transaction
                                              db.run('COMMIT', (err) => {
                                                if (err) {
                                                  console.error('Error committing transaction:', err);
                                                  db.run('ROLLBACK');
                                                  process.exit(1);
                                                }

                                                console.log('✅ Migration completed successfully!');
                                                console.log('Please restart the server.');
                                                process.exit(0);
                                              });
                                            });
                                          });
                                        }
                                      );
                                    }
                                  );
                                } else {
                                  db.run('COMMIT', (err) => {
                                    if (err) {
                                      console.error('Error committing transaction:', err);
                                      db.run('ROLLBACK');
                                      process.exit(1);
                                    }
                                    console.log('✅ Migration completed successfully!');
                                    process.exit(0);
                                  });
                                }
                              });
                            });
                          });
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
}
