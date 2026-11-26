const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

function createFrontendRouter(distDir = process.env.FRONTEND_DIST_DIR || path.join(__dirname, '..', '..', 'frontend', 'dist')) {
  const router = express.Router();
  const index = path.join(distDir, 'index.html');
  if (!fs.existsSync(index)) return router;
  const staticFiles = express.static(distDir, { index: false, dotfiles: 'deny' });
  router.use((req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next('router');
    return staticFiles(req, res, next);
  });
  router.get('/', (_req, res) => res.sendFile(index));
  return router;
}
module.exports = { createFrontendRouter };
