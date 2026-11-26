const assert = require('node:assert/strict');
const test = require('node:test');
const { paymentActivity, sumCents, toCents, toDollars } = require('../src/services/finance');

test('money values are rounded and aggregated to whole cents', () => {
  const total = sumCents(['10.10', '0.20', 0.1, '1.005']);
  assert.equal(total, 1141n);
  assert.equal(toDollars(total), 11.41);
});

test('invalid and negative payment values do not become valid positive amounts', () => {
  assert.throws(() => toCents('not-an-amount'), TypeError);
  assert.equal(toCents('-2.50'), -250n);
  assert.throws(() => toCents(Number.NaN), TypeError);
});

test('without an agreed pilgrim price, expose payment activity rather than claiming paid status', () => {
  assert.equal(paymentActivity('0.00'), 'لا توجد دفعات');
  assert.equal(paymentActivity('0.01'), 'لديه دفعات');
  assert.equal(paymentActivity('1000.00'), 'لديه دفعات');
});
