const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const db = require('./database');

db.migrate()
  .then(() => console.log('Trip cost schema is managed by the PostgreSQL migration system.'))
  .catch((error) => {
    console.error('Unable to verify trip cost migration:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
