const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const db = require('./database');

db.migrate()
  .then(() => {
    console.log('PostgreSQL migrations are up to date.');
  })
  .catch((error) => {
    console.error('PostgreSQL migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
