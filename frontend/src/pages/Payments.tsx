import { useState, useEffect } from 'react';
import api from '../services/api';
import type { Payment } from '../types';

function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalAmount, setTotalAmount] = useState(0);

  useEffect(() => {
    fetchPayments();
  }, [page, search]);

  const fetchPayments = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '10',
      });

      if (search) params.append('search', search);

      const response = await api.get(`/api/payments?${params.toString()}`);
      setPayments(response.data.payments);
      setTotalPages(response.data.pagination.totalPages);

      // Calculate total amount
      const total = response.data.payments.reduce((sum: number, p: Payment) => sum + p.amount_usd, 0);
      setTotalAmount(total);
    } catch (error) {
      alert('حدث خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.5rem' }}>
            الدفعات
          </h1>
          <p style={{ color: '#666', margin: 0 }}>إدارة جميع الدفعات المسجلة</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '2rem' }}>💰</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              إجمالي المقبوضات
            </h3>
          </div>
          <p
            style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#28a745',
              margin: 0,
            }}
          >
            ${totalAmount.toFixed(2)}
          </p>
        </div>
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '2rem' }}>📊</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              عدد الدفعات
            </h3>
          </div>
          <p
            style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#D4AF37',
              margin: 0,
            }}
          >
            {payments.length}
          </p>
        </div>
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '2rem' }}>📈</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              متوسط قيمة الدفعة
            </h3>
          </div>
          <p
            style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#17a2b8',
              margin: 0,
            }}
          >
            ${payments.length > 0 ? (totalAmount / payments.length).toFixed(2) : 0}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <input
          type="text"
          className="form-input"
          placeholder="بحث بالاسم أو رقم جواز السفر..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الرحلة</th>
                <th>المبلغ</th>
                <th>طريقة الدفع</th>
                <th>تاريخ الدفع</th>
                <th>الملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💰</div>
                    <p style={{ color: '#666' }}>لا توجد دفعات مسجلة</p>
                  </td>
                </tr>
              ) : (
                payments.map((payment) => (
                  <tr key={payment.id}>
                    <td style={{ fontWeight: '600' }}>{payment.full_name}</td>
                    <td>{payment.trip_name}</td>
                    <td style={{ fontWeight: '600', color: '#28a745' }}>
                      ${payment.amount_usd.toFixed(2)}
                    </td>
                    <td>{payment.payment_method}</td>
                    <td>{new Date(payment.payment_date).toLocaleDateString('ar-SA')}</td>
                    <td>{payment.notes || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '1rem',
              borderTop: '1px solid var(--border-color)',
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn btn-sm btn-secondary"
            >
              السابق
            </button>
            <span style={{ padding: '0 1rem' }}>
              صفحة {page} من {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn btn-sm btn-secondary"
            >
              التالي
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Payments;
