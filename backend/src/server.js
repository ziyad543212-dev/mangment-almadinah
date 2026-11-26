const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const fs = require('fs');
const db = require('./database');
const authRoutes = require('./routes/auth');
const tripRoutes = require('./routes/trips');
const pilgrimRoutes = require('./routes/pilgrims');
const paymentRoutes = require('./routes/payments');
const reportRoutes = require('./routes/reports');
const ocrRoutes = require('./routes/ocr');
const { startLocalOcrService, stopLocalOcrService, getLocalOcrStatus } = require('./services/ocr/service-lifecycle');
const documentRoutes = require('./routes/documents');
const { getUploadDirectory } = require('./services/storage');
const { corsErrorHandler, createAppCorsMiddleware } = require('./cors-options');
const { createFrontendRouter } = require('./frontend');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const uploadDir = getUploadDirectory();

fs.mkdirSync(uploadDir, { recursive: true });
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

app.use(createAppCorsMiddleware());

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api', pilgrimRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/pilgrims', documentRoutes);
app.use('/api', reportRoutes);
app.use('/api', ocrRoutes);
app.use(createFrontendRouter());

app.use(corsErrorHandler);

// Start installed models in the background while the application initializes.
// A manually started service remains owned by its original process.
startLocalOcrService().then((ready) => {
  console.info(ready ? '[OCR] Local AI service ready' : `[OCR] Using fallback: ${getLocalOcrStatus().diagnostic || getLocalOcrStatus().status}`);
}).catch(() => console.warn('[OCR] Local AI service could not start'));
process.once('exit', stopLocalOcrService);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { stopLocalOcrService(); process.exit(0); });
}

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Unhandled request error:', error.code || error.name || 'unknown error');
  return res.status(500).json({ error: 'خطأ في الخادم' });
});

db.ready
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error(
      'Database initialization failed; server will not start:',
      error.code || error.name || 'unknown error'
    );
    process.exitCode = 1;
  });
