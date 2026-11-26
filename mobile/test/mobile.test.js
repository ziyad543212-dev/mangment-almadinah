const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeAppUrl, safeDownloadName } = require('../src/server-url');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('mobile accepts HTTPS hosts and private LAN servers and normalizes API suffixes', () => {
  assert.equal(normalizeAppUrl(' https://app.example/api/ '), 'https://app.example');
  assert.equal(normalizeAppUrl('http://192.168.1.10:3001/'), 'http://192.168.1.10:3001');
  assert.equal(normalizeAppUrl('http://10.0.2.2:3001'), 'http://10.0.2.2:3001');
  assert.equal(normalizeAppUrl('https://app.example/management/'), 'https://app.example/management');
});
test('phone cannot accidentally connect to itself or send credentials over public HTTP', () => {
  for (const value of ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://public.example',
    'https://user:password@app.example', 'https://app.example?token=secret', 'javascript:alert(1)']) {
    assert.throws(() => normalizeAppUrl(value));
  }
});
test('download names preserve Arabic but cannot escape the application cache', () => {
  assert.equal(safeDownloadName('../../تقرير.pdf'), 'تقرير.pdf');
  assert.equal(safeDownloadName('C:\\private\\report.csv'), 'report.csv');
  assert.equal(safeDownloadName('..'), 'document.pdf');
});

test('server normalization works with React Native read-only URL properties', () => {
  class ReadOnlyURL {
    constructor(value) { this.parsed = new URL(value); }
    get protocol() { return this.parsed.protocol; }
    get username() { return this.parsed.username; }
    get password() { return this.parsed.password; }
    get search() { return this.parsed.search; }
    get hash() { return this.parsed.hash; }
    get hostname() { return this.parsed.hostname; }
    get origin() { return this.parsed.origin; }
    get pathname() { return this.parsed.pathname; }
  }
  const module = { exports: {} };
  vm.runInNewContext('"use strict";\n' + fs.readFileSync(path.join(__dirname, '../src/server-url.js'), 'utf8'), { module, URL: ReadOnlyURL });
  assert.equal(module.exports.normalizeAppUrl('http://192.168.1.108:3001/api/'), 'http://192.168.1.108:3001');
  assert.equal(module.exports.normalizeAppUrl('HTTPS://app.example/'), 'https://app.example');
});
