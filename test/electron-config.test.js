const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseConfiguration,
  cloudConfiguration,
  validateConfiguration
} = require('../electron-config');

const validConfiguration = {
  DATABASE_URL: 'postgresql://db_user:p%40ss%26word@ep-example.neon.tech/appdb?sslmode=require&channel_binding=require',
  JWT_SECRET: 'A-long-random-secret-with-more-than-sixteen-unique-characters-2026!'
};

test('parses quoted Neon URLs without losing URL query parameters', () => {
  const parsed = parseConfiguration([
    `DATABASE_URL=${JSON.stringify(validConfiguration.DATABASE_URL)}`,
    `JWT_SECRET=${JSON.stringify(validConfiguration.JWT_SECRET)}`
  ].join('\n'));

  assert.equal(parsed.DATABASE_URL, validConfiguration.DATABASE_URL);
  assert.equal(parsed.JWT_SECRET, validConfiguration.JWT_SECRET);
  assert.deepEqual(validateConfiguration(parsed), { valid: true });
});

test('cloud desktop uses the supplied Neon database and filters unrelated server settings', () => {
  const result = cloudConfiguration({ ...validConfiguration, PORT: '3001', ALLOWED_ORIGINS: '*', PG_TRANSPORT: 'auto' });
  assert.equal(result.DATABASE_URL, validConfiguration.DATABASE_URL);
  assert.equal(result.JWT_SECRET, validConfiguration.JWT_SECRET);
  assert.equal(result.PG_TRANSPORT, 'auto');
  assert.equal(result.PORT, undefined);
  assert.equal(result.ALLOWED_ORIGINS, undefined);
  assert.throws(() => cloudConfiguration({ ...validConfiguration, DATABASE_URL: 'postgresql://postgres@127.0.0.1/local' }), /Neon/);
});

test('rejects invalid PostgreSQL URLs, Neon URLs without SSL, and weak JWT secrets', () => {
  assert.equal(validateConfiguration({
    ...validConfiguration,
    DATABASE_URL: 'https://example.com/db'
  }).valid, false);
  assert.equal(validateConfiguration({
    ...validConfiguration,
    DATABASE_URL: 'postgresql://db_user:password@ep-example.neon.tech/appdb'
  }).valid, false);
  assert.equal(validateConfiguration({
    ...validConfiguration,
    JWT_SECRET: 'repeated'.repeat(5)
  }).valid, false);
});
