const { _electron: electron } = require('../frontend/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const dataDir = path.join(root, 'mobile', '.toolchain', 'desktop-neon-smoke-1.3.0');
  const { parseConfiguration, cloudConfiguration } = require('../electron-config');
  const configFile = path.join(root, 'dist', '.env');
  const configuration = cloudConfiguration(parseConfiguration(fs.readFileSync(configFile)));
  const { createDatabasePool } = require('../backend/src/services/database-connection');
  const pool = createDatabasePool(configuration.DATABASE_URL, { connectionTimeoutMillis: 15000, max: 1 });
  let baseline, user;
  try {
    baseline = (await pool.query('SELECT (SELECT count(*)::integer FROM trips) AS trips, (SELECT count(*)::integer FROM pilgrims) AS pilgrims')).rows[0];
    user = (await pool.query("SELECT id, username, role FROM users WHERE role='admin' ORDER BY id LIMIT 1")).rows[0];
  } finally { await pool.end(); }
  assert.ok(user, 'Existing cloud administrator must be present; smoke test never creates users.');
  const executablePath = path.join(root, 'dist', 'win-unpacked', 'AlMadinahSystem.exe');
  const app = await electron.launch({ executablePath, env: { ...process.env, NODE_ENV: 'test', ALMADINAH_TEST_DATA_DIR: dataDir, PORTABLE_EXECUTABLE_DIR: path.dirname(configFile), ALMADINAH_CONFIG_FILE: '' }, timeout: 120_000 });
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
    await app.context().route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'file:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
      return route.abort();
    });
    const page = await app.firstWindow({ timeout: 120_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => { localStorage.clear(); window.location.hash = '/login'; });
    await page.reload();
    await page.waitForSelector('input[type="password"]', { timeout: 120_000 });
    // Exercise read-only authenticated routes without resetting the real admin password.
    const token = require('../backend/node_modules/jsonwebtoken').sign(user, configuration.JWT_SECRET, { expiresIn: '2m' });
    await page.evaluate(({ user, token }) => { localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('token', token); window.location.hash = '/dashboard'; }, { user, token });
    await page.waitForURL(url => url.hash === '#/dashboard', { timeout: 30_000, waitUntil: 'commit' });
    await page.waitForSelector('main h1');
    const result = await page.evaluate(async () => {
      const base = window.mangDesktop.apiBaseUrl;
      const headers = { Authorization: 'Bearer ' + localStorage.getItem('token') };
      const stats = await fetch(base + '/dashboard/stats', { headers }).then(response => response.json());
      const staff = await fetch(base + '/auth/employees', { headers }).then(response => response.json());
      return { stats, employees: staff.employees.length };
    });
    assert.equal(result.stats.totalTrips, baseline.trips);
    assert.equal(result.stats.totalPilgrims, baseline.pilgrims);
    assert.equal(typeof result.employees, 'number');
    assert.equal(fs.existsSync(path.join(dataDir, 'pgsql-data')), false);
    const stored = fs.readFileSync(path.join(dataDir, 'backend.env'));
    assert.ok(stored.subarray(0, 9).equals(Buffer.from('MANGCFG1:')));
    assert.equal(stored.includes(Buffer.from(configuration.DATABASE_URL)), false);
    await page.screenshot({ path: path.join(root, 'mobile', 'artifacts', 'qa', 'windows-1.3.0.png') });
    console.log('Packaged Windows EXE passed: existing Neon data matches read-only baseline; authenticated dashboard and employees endpoint work; no local PostgreSQL created.');
  } finally { await app.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
