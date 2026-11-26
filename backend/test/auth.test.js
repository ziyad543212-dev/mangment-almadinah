const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const bcrypt = require('bcryptjs');
const test = require('node:test');

test('login token authenticates dashboard statistics without bypassing auth', async (t) => {
  const databasePath = require.resolve('../src/database');
  const helpersPath = require.resolve('../src/routes/helpers');
  const authPath = require.resolve('../src/auth');
  const authRoutePath = require.resolve('../src/routes/auth');
  const reportsPath = require.resolve('../src/routes/reports');
  const originalDatabase = require.cache[databasePath];
  const originalHelpers = require.cache[helpersPath];
  const originalAuth = require.cache[authPath];
  const originalAuthRoute = require.cache[authRoutePath];
  const originalReports = require.cache[reportsPath];
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;
  const loginPassword = 'temporary-test-password';
  const user = {
    id: 17,
    username: 'test-admin',
    role: 'admin',
    password_hash: bcrypt.hashSync(loginPassword, 4)
  };
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.NODE_ENV = 'test';

  const databaseModule = new Module(databasePath);
  databaseModule.filename = databasePath;
  databaseModule.loaded = true;
  databaseModule.exports = {
    get: (_sql, params, callback) => callback(null, { ...user, id: Number(params[0]) })
  };
  require.cache[databasePath] = databaseModule;

  const helpersModule = new Module(helpersPath);
  helpersModule.filename = helpersPath;
  helpersModule.loaded = true;
  helpersModule.exports = {
    query: async () => [],
    queryRun: async () => ({ lastID: 1, changes: 1 }),
    queryGet: async (sql) => {
      if (sql.includes('FROM users WHERE username')) return user;
      if (sql.includes('COUNT(*) AS total FROM trips')) return { total: '2' };
      if (sql.includes('COUNT(*) AS total FROM pilgrims')) return { total: '5' };
      if (sql.includes('SUM(amount_usd)')) return { total: '123.45' };
      if (sql.includes('pilgrims p WHERE EXISTS')) return { total: '3' };
      if (sql.includes('pilgrims p WHERE NOT EXISTS')) return { total: '2' };
      if (sql.includes('SUM(trip_cost_usd)')) return { total: '300.25' };
      if (sql.includes('trip_date >= CURRENT_DATE')) return { count: '1' };
      if (sql.includes('trip_date < CURRENT_DATE')) return { count: '1' };
      throw new Error('Unexpected mocked query');
    }
  };
  require.cache[helpersPath] = helpersModule;
  delete require.cache[authPath];
  delete require.cache[authRoutePath];
  delete require.cache[reportsPath];

  t.after(() => {
    delete require.cache[reportsPath];
    delete require.cache[authRoutePath];
    delete require.cache[authPath];
    if (originalReports) require.cache[reportsPath] = originalReports;
    if (originalAuthRoute) require.cache[authRoutePath] = originalAuthRoute;
    if (originalAuth) require.cache[authPath] = originalAuth;
    if (originalHelpers) require.cache[helpersPath] = originalHelpers;
    else delete require.cache[helpersPath];
    if (originalDatabase) require.cache[databasePath] = originalDatabase;
    else delete require.cache[databasePath];
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  const auth = require('../src/auth');
  const loginRouter = require('../src/routes/auth');
  const loginRoute = loginRouter.stack.find((layer) =>
    layer.route?.path === '/login' && layer.route.methods.post
  ).route;
  let loginBody;
  const loginResponse = { json: (body) => { loginBody = body; } };
  await loginRoute.stack[loginRoute.stack.length - 1].handle({
    body: { username: user.username, password: loginPassword },
    ip: '127.0.0.1'
  }, loginResponse);
  assert.ok(loginBody.token);

  const reportsRouter = require('../src/routes/reports');
  const statsRoute = reportsRouter.stack.find((layer) =>
    layer.route?.path === '/dashboard/stats' && layer.route.methods.get
  ).route;
  const request = { headers: { authorization: `Bearer ${loginBody.token}` } };
  let statsStatus = 200;
  let statsBody;
  const statsResponse = {
    status(code) {
      statsStatus = code;
      return this;
    },
    json(body) {
      statsBody = body;
      return this;
    }
  };
  let authenticated = false;
  auth.authenticateToken(request, statsResponse, () => {
    authenticated = true;
  });
  assert.equal(authenticated, true);
  await statsRoute.stack[statsRoute.stack.length - 1].handle(request, statsResponse);
  assert.equal(statsStatus, 200);
  assert.equal(statsBody.totalTrips, 2);
  assert.equal(statsBody.totalPilgrims, 5);

  let rejectedStatus = 200;
  auth.authenticateToken(
    { headers: { authorization: 'Bearer invalid-token' } },
    { status(code) { rejectedStatus = code; return this; }, json() {} },
    () => assert.fail('Invalid tokens must not authenticate')
  );
  assert.equal(rejectedStatus, 401);
});
