const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { WEB_BRIDGE } = require('../src/web-bridge');

function browser() {
  const messages = [], clicks = [], reads = [], listeners = [];
  class Anchor { click() { clicks.push(this.href); } }
  class Reader {
    readAsDataURL(blob) {
      reads.push(blob.arrayBuffer().then((bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      }));
    }
  }
  let blobId = 0;
  const URL = { createObjectURL: () => `blob:https://app.example/${++blobId}`, revokeObjectURL() {} };
  const document = { addEventListener(_name, listener) { listeners.push(listener); },
    documentElement: { outerHTML: '<html><head><link href="/assets/app.css"></head><body>report</body></html>' } };
  const window = { ReactNativeWebView: { postMessage(value) { messages.push(JSON.parse(value)); } }, open() {} };
  vm.runInNewContext(WEB_BRIDGE, { window, document, location: { origin: 'https://app.example' },
    URL, HTMLAnchorElement: Anchor, FileReader: Reader });
  return { window, URL, Anchor, messages, clicks, reads, listeners };
}

test('detached report download links send exact bytes to the native save/share flow once', async () => {
  const page = browser();
  const content = 'تقرير تجريبي,42';
  const link = new page.Anchor();
  link.href = page.URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
  link.download = 'تقرير.csv';
  link.click();
  await Promise.all(page.reads);
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].type, 'download');
  assert.equal(page.messages[0].name, 'تقرير.csv');
  assert.equal(page.messages[0].data, `data:text/csv;base64,${Buffer.from(content).toString('base64')}`);
  assert.equal(page.clicks.length, 0);
});

test('camera input opens only after native camera permission is granted', () => {
  const page = browser();
  let opened = 0;
  const input = { tagName: 'INPUT', type: 'file', hasAttribute: () => true, click() { opened++; } };
  const event = { target: input, preventDefault() {}, stopImmediatePropagation() {} };
  page.listeners.forEach((listener) => listener(event));
  assert.equal(opened, 0);
  page.window.__mangCameraResult(page.messages.at(-1).id, false);
  assert.equal(opened, 0);
  page.listeners.forEach((listener) => listener(event));
  page.window.__mangCameraResult(page.messages.at(-1).id, true);
  assert.equal(opened, 1);
});

test('Android printing receives the current page with its stylesheet base URL', () => {
  const page = browser();
  page.window.print();
  assert.equal(page.messages[0].type, 'print');
  assert.match(page.messages[0].html, /<base href="https:\/\/app\.example\/">/);
});
