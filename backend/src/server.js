require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const authRoutes = require('./routes/auth');
const tripRoutes = require('./routes/trips');
const pilgrimRoutes = require('./routes/pilgrims');
const paymentRoutes = require('./routes/payments');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';
const DATA_DIR = db.dataDir || process.cwd();
const uploadDir = path.join(process.env.UPLOAD_DIR || __dirname, 'uploads');
const OCR_CACHE_DIR = path.join(DATA_DIR, 'tesseract-cache');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(OCR_CACHE_DIR, { recursive: true });

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://localhost:3000',
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
]);

app.use(cors({
  origin(origin, callback) {
    let isVercelOrigin = false;
    if (origin) {
      try {
        const url = new URL(origin);
        isVercelOrigin = url.protocol === 'https:' && url.hostname.endsWith('.vercel.app');
      } catch {
        isVercelOrigin = false;
      }
    }

    callback(null, !origin || allowedOrigins.has(origin) || isVercelOrigin);
  }
}));

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api', pilgrimRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api', reportRoutes);

db.ready
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization failed; server will not start:', error);
    process.exitCode = 1;
  });
