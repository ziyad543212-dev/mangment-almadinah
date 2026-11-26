// Shared by operational endpoints so nested records and exports use the same policy.
const financialFields = new Set([
  'payments', 'cash_denominations', 'amount_usd', 'payment_method', 'payment_date',
  'transaction_reference', 'total_received', 'payment_count', 'payment_status',
  'trip_cost_usd', 'net_trip', 'net_total', 'total_trip_cost', 'total_outstanding',
  'operating_deficit', 'with_payments', 'without_payments', 'cash_total', 'sham_cash_total',
  'totalReceived', 'totalTripCost', 'pilgrimsWithPayments', 'pilgrimsWithoutPayments'
]);

function withoutFinancialData(value) {
  if (Array.isArray(value)) return value.map(withoutFinancialData);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !financialFields.has(key))
    .map(([key, item]) => [key, withoutFinancialData(item)]));
}

function protectFinancialData(req, res, next) {
  const json = res.json;
  res.json = function (body) {
    return json.call(this, req.user?.role === 'admin' ? body : withoutFinancialData(body));
  };
  next();
}

module.exports = { withoutFinancialData, protectFinancialData };
