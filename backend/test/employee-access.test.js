const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const express = require('express');
const bcrypt = require('bcryptjs');

test('employee accounts and financial permissions are enforced over authenticated HTTP', async (t) => {
  // Isolated database doubles: no live users, records or credentials are touched.
  const paths = ['database', 'routes/helpers', 'auth', 'routes/auth', 'routes/trips',
    'routes/pilgrims', 'routes/payments', 'routes/reports', 'routes/documents'].map(name => require.resolve('../src/' + name));
  const originals = paths.map(file => require.cache[file]);
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'isolated-employee-test-secret-at-least-32-characters';
  const users = [{ id: 1, username: 'manager', role: 'admin' }, { id: 2, username: 'staff', role: 'employee' }];
  const writes = [];
  let paymentReads = 0;
  const trip = { id: 7, name: 'رحلة تجريبية', trip_date: '2027-01-01', trip_cost_usd: 1200, total_received: 450, pilgrim_count: 1 };
  const pilgrim = { id: 9, trip_id: 7, first_name_ar: 'اختبار', nationality: 'سوريا', passport_number: 'TEST12345', total_received: 450, payment_count: 1 };
  function mock(file, exports) {
    const mod = new Module(file); mod.filename = file; mod.loaded = true; mod.exports = exports;
    require.cache[file] = mod;
  }
  mock(paths[0], { get: (_sql, [id], callback) => callback(null, users.find(user => user.id === Number(id))) });
  mock(paths[1], {
    query: async (sql) => {
      if (sql.includes('FROM users')) return users.filter(user => user.role === 'employee').map(({ password_hash, ...user }) => user);
      if (sql.includes('FROM payments WHERE pilgrim_id')) { paymentReads++; return [{ id: 4, amount_usd: 450 }]; }
      if (sql.includes('FROM cash_payment_denominations')) return [];
      if (sql.includes('FROM payments pay') && !sql.includes('WITH report_trips')) return [{ id: 4, amount_usd: 450 }];
      if (sql.includes('FROM trips') || sql.includes('FROM report_trips')) return [{ ...trip }];
      if (sql.includes('FROM pilgrims')) return sql.includes('regexp_replace') ? [] : [{ ...pilgrim }];
      throw new Error('Unexpected query in access test');
    },
    queryGet: async (sql, params = []) => {
      if (sql.includes('FROM users WHERE username')) return users.find(user => user.username === params[0]);
      if (sql.includes('FROM trips WHERE id')) return { ...trip };
      if (sql.includes('FROM pilgrims WHERE id')) return { ...pilgrim };
      if (sql.includes('WITH report_trips')) return { total_trips: 1, total_pilgrims: 1, total_received: 450, total_trip_cost: 1200, with_payments: 1, without_payments: 0, cash_total: 450, sham_cash_total: 0 };
      return { total: 1, count: 1 };
    },
    queryRun: async (sql, params) => {
      writes.push({ sql, params });
      if (sql.includes('INSERT INTO users')) {
        if (users.some(user => user.username === params[0])) throw Object.assign(new Error('duplicate'), { code: '23505' });
        const user = { id: users.length + 1, username: params[0], password_hash: params[1], role: params[2] };
        users.push(user); return { lastID: user.id, changes: 1 };
      }
      return { lastID: 11, changes: sql.startsWith('DELETE') && sql.includes('NOT EXISTS') ? 0 : 1 };
    }
  });
  for (const file of paths.slice(2)) delete require.cache[file];
  t.after(() => {
    paths.forEach((file, index) => { if (originals[index]) require.cache[file] = originals[index]; else delete require.cache[file]; });
    if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
  });
  const { generateToken } = require('../src/auth');
  const app = express(); app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth'));
  app.use('/api/trips', require('../src/routes/trips'));
  app.use('/api', require('../src/routes/pilgrims'));
  app.use('/api/payments', require('../src/routes/payments'));
  app.use('/api/pilgrims', require('../src/routes/documents'));
  app.use('/api', require('../src/routes/reports'));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const tokens = { admin: generateToken(users[0]), employee: generateToken({ ...users[1], role: 'admin' }) };
  async function request(path, role = 'employee', method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' }, body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }

  await t.test('staff cannot read or write payments, backups or employee accounts even with an admin role in their token', async () => {
    const count = writes.length;
    for (const [path, method] of [['/payments','GET'], ['/payments','POST'], ['/payments/4','DELETE'], ['/backup/export','GET'], ['/backup/restore','POST'], ['/auth/employees','GET'], ['/auth/employees','POST']]) {
      assert.equal((await request(path, 'employee', method, {})).status, 403, path + ' ' + method);
    }
    assert.equal(writes.length, count);
  });

  await t.test('operational endpoints omit nested financial data while managers retain it', async () => {
    const forbidden = /"(?:payments|total_received|payment_count|payment_status|trip_cost_usd|net_trip|totalReceived|totalTripCost|pilgrimsWithPayments|pilgrimsWithoutPayments|with_payments|without_payments|cash_total|sham_cash_total|net_total|total_trip_cost)"/;
    for (const path of ['/trips', '/trips/7', '/trips/7/pilgrims', '/pilgrims/9', '/trips/7/manifest', '/dashboard/stats', '/reports/summary', '/reports/by-trip']) {
      const result = await request(path);
      assert.equal(result.status, 200, path);
      assert.doesNotMatch(JSON.stringify(result.body), forbidden, path);
    }
    assert.equal(paymentReads, 0, 'Staff detail must not load payment records');
    const detail = await request('/pilgrims/9', 'admin');
    assert.equal(detail.body.total_received, 450);
    assert.equal(detail.body.payments[0].amount_usd, 450);
    assert.equal((await request('/trips/7', 'admin')).body.trip_cost_usd, 1200);
  });

  await t.test('manager creates a hashed employee account, and the new employee can log in', async () => {
    const password = 'Synthetic-password-2027';
    const created = await request('/auth/employees', 'admin', 'POST', { username: '  new-staff  ', password, confirmPassword: password, role: 'admin' });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'employee');
    assert.equal(created.body.user.username, 'new-staff');
    assert.equal(created.body.user.password_hash, undefined);
    const stored = users.find(user => user.username === 'new-staff');
    assert.notEqual(stored.password_hash, password);
    assert.equal(bcrypt.compareSync(password, stored.password_hash), true);
    const login = await request('/auth/login', 'admin', 'POST', { username: 'new-staff', password });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'employee');
    assert.ok(login.body.token);
    const duplicate = await request('/auth/employees', 'admin', 'POST', { username: 'new-staff', password, confirmPassword: password });
    assert.equal(duplicate.status, 409);
    for (const invalid of [{ username: 'bad', password: 'short', confirmPassword: 'short' }, { username: 'bad', password, confirmPassword: 'different' }]) {
      assert.equal((await request('/auth/employees', 'admin', 'POST', invalid)).status, 400);
    }
    assert.ok((await request('/auth/employees', 'admin')).body.employees.some(user => user.username === 'new-staff'));
  });

  await t.test('staff can manage operational records but cannot overwrite costs or cascade-delete payments', async () => {
    const body = { name: 'رحلة الموظف', trip_date: '2027-01-01', trip_cost_usd: 99999 };
    assert.equal((await request('/trips', 'employee', 'POST', body)).status, 201);
    assert.equal(writes.at(-1).params[2], 0);
    assert.equal((await request('/trips/7', 'employee', 'PUT', body)).status, 200);
    assert.equal(writes.at(-1).params[2], false);
    assert.match(writes.at(-1).sql, /ELSE trip_cost_usd END/);
    assert.equal((await request('/pilgrims', 'employee', 'POST', { ...pilgrim, trip_id: 7 })).status, 201);
    assert.equal((await request('/pilgrims/9/visa-document', 'employee', 'POST', {})).status, 400, 'Staff reaches document validation rather than an admin-only gate');
    assert.equal((await request('/trips/7', 'employee', 'DELETE')).status, 403);
    assert.equal((await request('/pilgrims/9', 'employee', 'DELETE')).status, 403);
    assert.equal((await request('/trips/7', 'admin', 'DELETE')).status, 200);
  });

  await t.test('permissions follow the current database role after an administrator is demoted', async () => {
    users[0].role = 'employee';
    assert.equal((await request('/payments', 'admin')).status, 403);
    users[0].role = 'admin';
    assert.equal((await request('/payments', 'admin')).status, 200);
  });
});
