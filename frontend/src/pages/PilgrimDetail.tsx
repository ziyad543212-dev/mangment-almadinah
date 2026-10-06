import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import type { Pilgrim, Payment, CashDenomination } from '../types';

const CASH_DENOMINATIONS = [1, 5, 10, 20, 50, 100];

function PilgrimDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pilgrim, setPilgrim] = useState<Pilgrim | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentData, setPaymentData] = useState({
    amount_usd: '',
    payment_method: 'نقدًا' as 'نقدًا' | 'شام كاش',
    transaction_reference: '',
    notes: '',
    cash_denominations: [] as Array<{ denomination: number; quantity: number; subtotal: number }>,
  });
  const [savingPayment, setSavingPayment] = useState(false);

  useEffect(() => {
    if (id) {
      fetchPilgrim();
    }
  }, [id]);

  const fetchPilgrim = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/api/pilgrims/${id}`);
      setPilgrim(response.data);
    } catch (error) {
      alert('حدث خطأ في تحميل البيانات');
      navigate('/trips');
    } finally {
      setLoading(false);
    }
  };

  const addCashDenomination = () => {
    setPaymentData({
      ...paymentData,
      cash_denominations: [
        ...paymentData.cash_denominations,
        { denomination: 100, quantity: 1, subtotal: 100 },
      ],
    });
  };

  const updateCashDenomination = (index: number, field: 'denomination' | 'quantity', value: number) => {
    const newDenominations = [...paymentData.cash_denominations];
    if (field === 'denomination') {
      newDenominations[index] = {
        ...newDenominations[index],
        denomination: value,
        subtotal: value * newDenominations[index].quantity,
      };
    } else {
      newDenominations[index] = {
        ...newDenominations[index],
        quantity: value,
        subtotal: newDenominations[index].denomination * value,
      };
    }
    setPaymentData({ ...paymentData, cash_denominations: newDenominations });
  };

  const removeCashDenomination = (index: number) => {
    const newDenominations = paymentData.cash_denominations.filter((_, i) => i !== index);
    setPaymentData({ ...paymentData, cash_denominations: newDenominations });
  };

  const calculateCashTotal = () => {
    return paymentData.cash_denominations.reduce((sum, d) => sum + d.subtotal, 0);
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPayment(true);

    try {
      await api.post('/api/payments', {
        pilgrim_id: parseInt(id!),
        amount_usd: parseFloat(paymentData.amount_usd),
        payment_method: paymentData.payment_method,
        transaction_reference: paymentData.transaction_reference || null,
        notes: paymentData.notes || null,
        cash_denominations: paymentData.payment_method === 'نقدًا' ? paymentData.cash_denominations : undefined,
      });
      alert('تمت إضافة الدفعة بنجاح');
      setShowPaymentModal(false);
      setPaymentData({
        amount_usd: '',
        payment_method: 'نقدًا',
        transaction_reference: '',
        notes: '',
        cash_denominations: [],
      });
      fetchPilgrim();
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ');
    } finally {
      setSavingPayment(false);
    }
  };

  const handleDeletePayment = async (paymentId: number) => {
    if (!confirm('هل أنت متأكد من حذف هذه الدفعة؟')) {
      return;
    }

    try {
      await api.delete(`/api/payments/${paymentId}`);
      alert('تم حذف الدفعة بنجاح');
      fetchPilgrim();
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ');
    }
  };

  const getPaymentStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      'مدفوع بالكامل': 'badge-success',
      'مدفوع جزئيًا': 'badge-warning',
      'غير مدفوع': 'badge-danger',
    };
    return colors[status] || 'badge-info';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
      </div>
    );
  }

  if (!pilgrim) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <p>السجل غير موجود</p>
        <button onClick={() => navigate('/trips')} className="btn btn-secondary">
          العودة للرحلات
        </button>
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
          <button
            onClick={() => navigate(`/trips/${pilgrim.trip_id}`)}
            className="btn btn-secondary"
            style={{ marginBottom: '1rem' }}
          >
            ← العودة للرحلة
          </button>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.5rem' }}>
            {pilgrim.full_name}
          </h1>
          <p style={{ color: '#666', margin: 0 }}>{pilgrim.nationality}</p>
        </div>
      </div>

      {/* Pilgrim Details */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem' }}>معلومات المعتمر</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1.5rem',
          }}
        >
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>الاسم الكامل</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600' }}>{pilgrim.full_name}</p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>الجنسية</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600' }}>{pilgrim.nationality}</p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>رقم جواز السفر</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600' }}>{pilgrim.passport_number}</p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>رقم الفيزا</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600' }}>
              {pilgrim.visa_number || 'غير متوفر'}
            </p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>إجمالي المقبوض</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600', color: '#28a745' }}>
              ${pilgrim.total_received?.toFixed(2) || 0}
            </p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>حالة الدفع</p>
            <span className={`badge ${getPaymentStatusBadge(pilgrim.payment_status || '')}`}>
              {pilgrim.payment_status || 'غير مدفوع'}
            </span>
          </div>
          {pilgrim.notes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>ملاحظات</p>
              <p style={{ fontSize: '1rem' }}>{pilgrim.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Payment History */}
      <div className="card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1.5rem',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0 }}>سجل الدفعات</h2>
          <button
            onClick={() => setShowPaymentModal(true)}
            className="btn btn-primary"
          >
            <span>➕</span>
            <span>إضافة دفعة</span>
          </button>
        </div>

        {pilgrim.payments && pilgrim.payments.length > 0 ? (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>المبلغ</th>
                  <th>طريقة الدفع</th>
                  <th>تاريخ الدفع</th>
                  <th>التفاصيل</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {pilgrim.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td style={{ fontWeight: '600', color: '#28a745' }}>
                      ${payment.amount_usd.toFixed(2)}
                    </td>
                    <td>{payment.payment_method}</td>
                    <td>{new Date(payment.payment_date).toLocaleDateString('ar-SA')}</td>
                    <td>
                      {payment.payment_method === 'نقدًا' && payment.cash_denominations && payment.cash_denominations.length > 0 ? (
                        <div style={{ fontSize: '0.875rem' }}>
                          {payment.cash_denominations.map((denom, idx) => (
                            <div key={idx}>
                              ${denom.denomination} × {denom.quantity} = ${denom.subtotal.toFixed(2)}
                            </div>
                          ))}
                        </div>
                      ) : payment.payment_method === 'شام كاش' ? (
                        <span>{payment.transaction_reference || '-'}</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => handleDeletePayment(payment.id)}
                        className="btn btn-sm btn-danger"
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💰</div>
            <p style={{ color: '#666', marginBottom: '1rem' }}>لا توجد دفعات مسجلة</p>
            <button
              onClick={() => setShowPaymentModal(true)}
              className="btn btn-primary"
            >
              إضافة دفعة
            </button>
          </div>
        )}
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="modal-overlay" onClick={() => !savingPayment && setShowPaymentModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <div className="modal-header">
              <h2 className="modal-title">إضافة دفعة جديدة</h2>
              <button
                onClick={() => !savingPayment && setShowPaymentModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#666',
                }}
                disabled={savingPayment}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAddPayment}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">المبلغ ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-input"
                    value={paymentData.amount_usd}
                    onChange={(e) => setPaymentData({ ...paymentData, amount_usd: e.target.value })}
                    required
                    disabled={savingPayment}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">طريقة الدفع *</label>
                  <select
                    className="form-select"
                    value={paymentData.payment_method}
                    onChange={(e) => setPaymentData({ ...paymentData, payment_method: e.target.value as 'نقدًا' | 'شام كاش' })}
                    disabled={savingPayment}
                  >
                    <option value="نقدًا">نقدًا</option>
                    <option value="شام كاش">شام كاش</option>
                  </select>
                </div>

                {paymentData.payment_method === 'نقدًا' && (
                  <div className="card" style={{ backgroundColor: '#f8f9fa', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '1rem' }}>تفاصيل الدفع النقدي</h3>
                    <div className="table-container" style={{ marginBottom: '1rem' }}>
                      <table className="table" style={{ fontSize: '0.875rem' }}>
                        <thead>
                          <tr>
                            <th>الفئة</th>
                            <th>عدد الأوراق</th>
                            <th>المجموع</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {paymentData.cash_denominations.map((denom, index) => (
                            <tr key={index}>
                              <td>
                                <select
                                  className="form-select"
                                  value={denom.denomination}
                                  onChange={(e) => updateCashDenomination(index, 'denomination', parseInt(e.target.value))}
                                  disabled={savingPayment}
                                >
                                  {CASH_DENOMINATIONS.map((d) => (
                                    <option key={d} value={d}>
                                      ${d}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min="1"
                                  className="form-input"
                                  value={denom.quantity}
                                  onChange={(e) => updateCashDenomination(index, 'quantity', parseInt(e.target.value) || 0)}
                                  disabled={savingPayment}
                                />
                              </td>
                              <td>${denom.subtotal.toFixed(2)}</td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => removeCashDenomination(index)}
                                  className="btn btn-sm btn-danger"
                                  disabled={savingPayment}
                                >
                                  حذف
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      type="button"
                      onClick={addCashDenomination}
                      className="btn btn-sm btn-secondary"
                      disabled={savingPayment}
                    >
                      + إضافة فئة
                    </button>
                    <div style={{ marginTop: '1rem', fontWeight: '600' }}>
                      إجمالي الدفع النقدي: ${calculateCashTotal().toFixed(2)}
                    </div>
                  </div>
                )}

                {paymentData.payment_method === 'شام كاش' && (
                  <div className="form-group">
                    <label className="form-label">رقم العملية / المرجع</label>
                    <input
                      type="text"
                      className="form-input"
                      value={paymentData.transaction_reference}
                      onChange={(e) => setPaymentData({ ...paymentData, transaction_reference: e.target.value })}
                      disabled={savingPayment}
                    />
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">ملاحظات</label>
                  <textarea
                    className="form-textarea"
                    value={paymentData.notes}
                    onChange={(e) => setPaymentData({ ...paymentData, notes: e.target.value })}
                    disabled={savingPayment}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => !savingPayment && setShowPaymentModal(false)}
                  className="btn btn-secondary"
                  disabled={savingPayment}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingPayment}>
                  {savingPayment ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                      جاري الحفظ...
                    </span>
                  ) : (
                    'إضافة'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default PilgrimDetail;
