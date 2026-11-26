const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { corsErrorHandler, createCorsOptions, createAppCorsMiddleware } = require('../src/cors-options');

async function startTestServer(t, configuredOrigins, host) {
  const app = express();
  app.use(createAppCorsMiddleware(configuredOrigins, host));
  app.post('/api/auth/login', (_req, res) => res.status(401).json({ error: 'Invalid credentials' }));
  app.get('/api/protected', (req, res) => {
    if (req.headers.authorization !== 'Bearer valid-test-token') {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.json({ ok: true });
  });
  app.use(corsErrorHandler);

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('approved development origin receives complete login preflight headers', async (t) => {
  const baseUrl = await startTestServer(t);
  const developmentOrigins = [
    'http://localhost:4173',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
    'http://127.0.0.1:5173'
  ];

  for (const origin of developmentOrigins) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization'
      }
    });

    assert.equal(response.status, 204, `${origin} preflight must succeed`);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    const methods = response.headers.get('access-control-allow-methods')
      .split(',')
      .map((method) => method.trim());
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.ok(methods.includes(method), `${method} must be allowed`);
    }
    const headers = response.headers.get('access-control-allow-headers')
      .split(',')
      .map((header) => header.trim().toLowerCase());
    assert.ok(headers.includes('content-type'));
    assert.ok(headers.includes('authorization'));
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
  }
});

test('127.0.0.1 development origins remain subject to protected-route authentication', async (t) => {
  const baseUrl = await startTestServer(t);
  for (const origin of ['http://127.0.0.1:4173', 'http://127.0.0.1:5173']) {
    const response = await fetch(`${baseUrl}/api/protected`, {
      headers: { Origin: origin }
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
});

test('explicit production origin is accepted while unapproved origins are rejected', async (t) => {
  const productionOrigin = 'https://verified-frontend.example';
  const baseUrl = await startTestServer(t, productionOrigin);
  const approved = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: productionOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  assert.equal(approved.status, 204);
  assert.equal(approved.headers.get('access-control-allow-origin'), productionOrigin);

  const disallowed = await fetch(`${baseUrl}/api/protected`, {
    headers: { Origin: 'https://unapproved.example' }
  });
  assert.equal(disallowed.status, 403);
  assert.equal(disallowed.headers.get('access-control-allow-origin'), null);
});

test('CORS permits approved origins but does not bypass protected-route authentication', async (t) => {
  const baseUrl = await startTestServer(t);
  const unauthenticated = await fetch(`${baseUrl}/api/protected`, {
    headers: { Origin: 'http://localhost:5173' }
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get('access-control-allow-origin'), 'http://localhost:5173');

  const authenticated = await fetch(`${baseUrl}/api/protected`, {
    headers: {
      Origin: 'http://localhost:5173',
      Authorization: 'Bearer valid-test-token'
    }
  });
  assert.equal(authenticated.status, 200);
  assert.deepEqual(await authenticated.json(), { ok: true });
});

test('CORS rejects wildcards and non-origin ALLOWED_ORIGINS entries', () => {
  assert.throws(() => createCorsOptions('*'), /valid HTTP or HTTPS origins/);
  assert.throws(() => createCorsOptions('https://frontend.example/path'), /without paths/);
});

test('same-origin phone requests reach authentication without opening cross-origin access', async (t) => {
  const baseUrl = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/protected`, { headers: { Origin: baseUrl } });
  assert.equal(response.status, 401);
  const authorized = await fetch(`${baseUrl}/api/protected`, { headers: { Origin: baseUrl, Authorization: 'Bearer valid-test-token' } });
  assert.equal(authorized.status, 200);
});

test('opaque Electron origin is available only to a loopback-bound backend', async (t) => {
  const baseUrl = await startTestServer(t, 'null', '127.0.0.1');
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'null',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'null');
  assert.throws(() => createCorsOptions('null', '0.0.0.0'), /only on a loopback backend/);
});
