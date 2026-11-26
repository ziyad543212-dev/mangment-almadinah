function toCents(value) {
  const text = typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(3)
    : typeof value === 'string' ? value.trim() : '';
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new TypeError('Amount must be a finite decimal value');

  const [, sign, whole, fraction = ''] = match;
  const roundedFraction = `${fraction}00`.slice(0, 3);
  let cents = BigInt(whole) * 100n + BigInt(roundedFraction.slice(0, 2));
  if (Number(roundedFraction[2]) >= 5) cents += 1n;
  return sign ? -cents : cents;
}

function sumCents(values) {
  return values.reduce((total, value) => total + toCents(value), 0n);
}

function toDollars(cents) {
  return Number(cents) / 100;
}

function paymentActivity(amount) {
  return toCents(amount) > 0n ? 'لديه دفعات' : 'لا توجد دفعات';
}

module.exports = { toCents, sumCents, toDollars, paymentActivity };
