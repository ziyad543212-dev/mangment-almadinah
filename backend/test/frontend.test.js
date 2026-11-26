const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createFrontendRouter } = require('../src/frontend');

test('mobile frontend serves built assets without masking API errors or exposing dotfiles', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'almadinah-frontend-test-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<html>synthetic mobile frontend</html>');
  await fs.writeFile(path.join(dir, 'app.js'), 'console.log("synthetic asset")');
  await fs.writeFile(path.join(dir, '.env'), 'PRIVATE_TEST_VALUE');
  const app = express();
  app.get('/api/protected', (_req, res) => res.status(401).json({ error: 'authentication required' }));
  app.use(createFrontendRouter(dir));
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(baseUrl)).text(), /synthetic mobile frontend/);
  assert.match(await (await fetch(baseUrl + '/app.js')).text(), /synthetic asset/);
  assert.equal((await fetch(baseUrl + '/api/protected')).status, 401);
  assert.equal((await fetch(baseUrl + '/api/missing')).status, 404);
  const hidden = await fetch(baseUrl + '/.env');
  assert.notEqual(hidden.status, 200);
  assert.doesNotMatch(await hidden.text(), /PRIVATE_TEST_VALUE/);
});
