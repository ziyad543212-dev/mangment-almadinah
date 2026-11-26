const CORS_ORIGIN_DENIED = 'CORS_ORIGIN_DENIED';
const DEVELOPMENT_ORIGINS = [
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
  'https://ziyad543212-dev.github.io'
];

function createCorsOptions(
  configuredOrigins = process.env.ALLOWED_ORIGINS,
  host = process.env.HOST
) {
  const allowedOrigins = new Set(DEVELOPMENT_ORIGINS);
  const additionalOrigins = (configuredOrigins || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of additionalOrigins) {
    if (origin === 'null') {
      if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
        throw new Error('The opaque Electron origin is allowed only on a loopback backend');
      }
      allowedOrigins.add(origin);
      continue;
    }

    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error('ALLOWED_ORIGINS must contain valid HTTP or HTTPS origins');
    }

    if (!['http:', 'https:'].includes(parsedOrigin.protocol) ||
        parsedOrigin.origin !== origin || parsedOrigin.username || parsedOrigin.password) {
      throw new Error('ALLOWED_ORIGINS entries must be exact HTTP or HTTPS origins without paths');
    }
    allowedOrigins.add(origin);
  }

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, false);
      if (!allowedOrigins.has(origin)) {
        const error = new Error('Origin not allowed by CORS');
        error.code = CORS_ORIGIN_DENIED;
        return callback(error);
      }
      return callback(null, origin);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204
  };
}

function corsErrorHandler(error, _req, res, next) {
  if (error.code === CORS_ORIGIN_DENIED) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  return next(error);
}

function createAppCorsMiddleware(configuredOrigins, host) {
  const crossOriginMiddleware = require('cors')(createCorsOptions(configuredOrigins, host));
  return (req, res, next) => {
    // A phone can load both UI and API from the same configured server origin.
    // Cross-origin requests still require an explicitly approved origin.
    if (req.get('origin') === `${req.protocol}://${req.get('host')}`) return next();
    return crossOriginMiddleware(req, res, next);
  };
}

module.exports = { CORS_ORIGIN_DENIED, corsErrorHandler, createCorsOptions, createAppCorsMiddleware };
