const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabasePool, getDatabaseTransport } = require('../src/services/database-connection');

test('Neon uses secure WebSockets while local PostgreSQL retains TCP', () => {
  assert.equal(getDatabaseTransport('postgresql://user:password@ep-test-pooler.region.neon.tech/db'), 'websocket');
  assert.equal(getDatabaseTransport('postgresql://postgres@127.0.0.1:5432/db'), 'tcp');
  assert.equal(getDatabaseTransport('postgresql://user:password@db.example.com/db'), 'tcp');
  assert.equal(getDatabaseTransport('postgresql://user:password@ep-test.region.neon.tech/db', 'tcp'), 'tcp');
});

test('WebSocket transport cannot route a non-Neon hostname through a Neon proxy', () => {
  assert.equal(getDatabaseTransport('postgresql://user:password@neon.tech.example.com/db'), 'tcp');
  assert.throws(() => getDatabaseTransport('postgresql://postgres@localhost/db', 'websocket'), /requires a Neon hostname/);
  assert.throws(() => getDatabaseTransport('postgresql://postgres@localhost/db', 'invalid'), /PG_TRANSPORT/);
});

test('pool selection preserves options and does not connect until used', async () => {
  const native = createDatabasePool('postgresql://postgres@127.0.0.1:5432/db', { max: 3 });
  assert.ok(native instanceof require('pg').Pool);
  assert.equal(native.options.max, 3);
  const neon = createDatabasePool('postgresql://user:password@ep-test.region.neon.tech/db', { max: 2, connectionTimeoutMillis: 12000 });
  assert.ok(neon instanceof require('@neondatabase/serverless').Pool);
  assert.equal(neon.options.connectionTimeoutMillis, 12000);
  assert.equal(neon.options.max, 2);
  await Promise.all([native.end(), neon.end()]);
});
