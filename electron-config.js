const dotenv = require('dotenv');

const MINIMUM_JWT_SECRET_LENGTH = 32;
const ENCRYPTED_CONFIG_PREFIX = Buffer.from('MANGCFG1:', 'ascii');

function parseConfiguration(source) {
  return dotenv.parse(source);
}

function cloudConfiguration(source) {
  // Keep the desktop bootstrap independent of ports, CORS and other server flags.
  const keys = ['DATABASE_URL', 'JWT_SECRET', 'INITIAL_ADMIN_USERNAME', 'INITIAL_ADMIN_PASSWORD', 'PG_TRANSPORT',
    'GEMINI_API_KEY', 'GEMINI_OCR_ENABLED', 'GEMINI_OCR_PAID_PROJECT_CONFIRMED', 'GEMINI_OCR_MODEL', 'GEMINI_OCR_TIMEOUT_MS'];
  const configuration = Object.fromEntries(keys.filter(key => typeof source?.[key] === 'string' && source[key]).map(key => [key, source[key]]));
  const validation = validateConfiguration(configuration);
  if (!validation.valid) throw new Error(validation.error);
  if (!new URL(configuration.DATABASE_URL).hostname.endsWith('.neon.tech')) {
    throw new Error('اختر ملف إعدادات قاعدة Neon السحابية.');
  }
  return configuration;
}

function validateConfiguration(configuration) {
  const databaseUrl = configuration?.DATABASE_URL;
  const jwtSecret = configuration?.JWT_SECRET;

  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    return { valid: false, error: 'أدخل رابط قاعدة بيانات PostgreSQL.' };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    return { valid: false, error: 'رابط قاعدة البيانات غير صالح.' };
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
      !parsedUrl.hostname || !parsedUrl.pathname.slice(1)) {
    return { valid: false, error: 'استخدم رابط PostgreSQL يتضمن المضيف واسم قاعدة البيانات.' };
  }

  if (parsedUrl.hostname.endsWith('.neon.tech') &&
      parsedUrl.searchParams.get('sslmode') !== 'require') {
    return { valid: false, error: 'رابط Neon يجب أن يتضمن sslmode=require.' };
  }

  if (typeof jwtSecret !== 'string' ||
      jwtSecret.length < MINIMUM_JWT_SECRET_LENGTH ||
      new Set(jwtSecret).size < 16) {
    return {
      valid: false,
      error: `استخدم سر JWT عشوائيًا بطول ${MINIMUM_JWT_SECRET_LENGTH} حرفًا على الأقل ومن دون تكرار نمطي.`
    };
  }

  return { valid: true };
}

module.exports = {
  ENCRYPTED_CONFIG_PREFIX,
  MINIMUM_JWT_SECRET_LENGTH,
  cloudConfiguration,
  parseConfiguration,
  validateConfiguration
};
