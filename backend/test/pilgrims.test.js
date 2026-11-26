const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function setupCreatePilgrimHandler(t, queryRun, queryImpl) {
  const helpersPath = require.resolve('../src/routes/helpers');
  const authPath = require.resolve('../src/auth');
  const routePath = require.resolve('../src/routes/pilgrims');
  const originalHelpers = require.cache[helpersPath];
  const originalAuth = require.cache[authPath];
  const originalRoute = require.cache[routePath];

  const helpersModule = new Module(helpersPath);
  helpersModule.filename = helpersPath;
  helpersModule.loaded = true;
  helpersModule.exports = {
    query: queryImpl || (async () => []),
    queryGet: async () => null,
    queryRun
  };
  require.cache[helpersPath] = helpersModule;

  const authModule = new Module(authPath);
  authModule.filename = authPath;
  authModule.loaded = true;
  authModule.exports = {
    authenticateToken: (_req, _res, next) => next(),
    requireStaff: (_req, _res, next) => next()
  };
  require.cache[authPath] = authModule;
  delete require.cache[routePath];

  t.after(() => {
    delete require.cache[routePath];
    if (originalRoute) require.cache[routePath] = originalRoute;
    if (originalHelpers) require.cache[helpersPath] = originalHelpers;
    else delete require.cache[helpersPath];
    if (originalAuth) require.cache[authPath] = originalAuth;
    else delete require.cache[authPath];
  });

  const router = require('../src/routes/pilgrims');
  const route = router.stack.find((layer) =>
    layer.route?.path === '/pilgrims' && layer.route.methods.post
  ).route;
  return route.stack[route.stack.length - 1].handle;
}

async function postPilgrim(handler, body) {
  let statusCode = 200;
  let responseBody;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    }
  };
  await handler({ body }, response);
  return { statusCode, body: responseBody };
}

const validPilgrim = {
  trip_id: 4,
  first_name_ar: 'اختبار',
  nationality: 'سوريا',
  passport_number: 'TEST123456'
};

test('pilgrim creation supplies one value for every inserted column', async (t) => {
  let capturedQuery;
  const handler = setupCreatePilgrimHandler(t, async (sql, params) => {
    capturedQuery = { sql, params };
    return { lastID: 17, changes: 1 };
  });

  const response = await postPilgrim(handler, validPilgrim);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.id, 17);
  const columns = capturedQuery.sql.match(/INSERT INTO pilgrims\s*\(([\s\S]*?)\)\s*VALUES/)[1]
    .split(',')
    .map((column) => column.trim());
  const values = capturedQuery.sql.match(/VALUES\s*\(([^)]*)\)/)[1].split(',');
  assert.equal(columns.length, values.length);
  assert.equal(columns.length, capturedQuery.params.length);
  assert.ok(columns.includes('visa_document_path'));
  assert.equal(capturedQuery.params[columns.indexOf('visa_document_path')], null);
});

test('invalid pilgrim dates are rejected before the database query', async (t) => {
  let queryCalled = false;
  const handler = setupCreatePilgrimHandler(t, async () => {
    queryCalled = true;
    return { lastID: 17, changes: 1 };
  });

  const response = await postPilgrim(handler, {
    ...validPilgrim,
    passport_expiry_date: '2025-02-30'
  });
  assert.equal(response.statusCode, 400);
  assert.equal(queryCalled, false);
});

test('duplicate passport numbers require explicit confirmation', async (t) => {
  const existing = [{
    id: 9,
    first_name_ar: 'موجود',
    passport_number: 'TEST-123 456',
    trip_id: 2,
    trip_name: 'رحلة سابقة'
  }];
  const handler = setupCreatePilgrimHandler(
    t,
    async () => ({ lastID: 18, changes: 1 }),
    async (sql) => (sql.includes('regexp_replace') ? existing : [])
  );

  const blocked = await postPilgrim(handler, validPilgrim);
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.requires_confirmation, true);
  assert.equal(blocked.body.duplicates.length, 1);

  const confirmed = await postPilgrim(handler, {
    ...validPilgrim,
    confirm_duplicate: true
  });
  assert.equal(confirmed.statusCode, 201);
});

test('missing trip foreign keys return a validation response', async (t) => {
  const handler = setupCreatePilgrimHandler(t, async () => {
    const error = new Error('foreign key violation');
    error.code = '23503';
    throw error;
  });

  const response = await postPilgrim(handler, validPilgrim);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'الرحلة المحددة غير موجودة');
});
