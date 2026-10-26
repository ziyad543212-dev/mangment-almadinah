import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import type { Pilgrim } from '../types';

const CASH_DENOMINATIONS = [1, 5, 10, 20, 50, 100];

function PilgrimDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pilgrim, setPilgrim] = useState<Pilgrim | null>(null);
  const [loading, setLoading] = useState(true);

  // حالات نافذة الدفعات
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentData, setPaymentData] = useState({
    amount_usd: '',
    payment_method: 'نقدًا' as 'نقدًا' | 'شام كاش',
    transaction_reference: '',
    notes: '',
    cash_denominations: [] as Array<{ denomination: number; quantity: number; subtotal: number }>,
  });
  const [savingPayment, setSavingPayment] = useState(false);

  // حالات نافذة تعديل بيانات المعتمر وقراءة الجواز (OCR)
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingPilgrim, setSavingPilgrim] = useState(false);
  const [scanningPassport, setScanningPassport] = useState(false);
  const [ocrMessage, setOcrMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [editFormData, setEditFormData] = useState({
    first_name_ar: '',
    father_name_ar: '',
    last_name_ar: '',
    first_name_en: '',
    father_name_en: '',
    last_name_en: '',
    nationality: '',
    passport_number: '',
    visa_number: '',
    notes: '',
  });

  useEffect(() => {
    if (id) {
      fetchPilgrim();
    }
  }, [id]);

  const fetchPilgrim = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/api/pilgrims/${id}`);
      const data = response.data;
      setPilgrim(data);
      setEditFormData({
        first_name_ar: data.first_name_ar || '',
        father_name_ar: data.father_name_ar || '',
        last_name_ar: data.last_name_ar || '',
        first_name_en: data.first_name_en || '',
        father_name_en: data.father_name_en || '',
        last_name_en: data.last_name_en || '',
        nationality: data.nationality || '',
        passport_number: data.passport_number || '',
        visa_number: data.visa_number || '',
        notes: data.notes || '',
      });
    } catch (error) {
      alert('حدث خطأ في تحميل البيانات');
      navigate('/trips');
    } finally {
      setLoading(false);
    }
  };

  const handlePassportScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanningPassport(true);
    setOcrMessage(null);

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await api.post('/api/ocr/passport', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const ocrData = response.data.data || {};
      setEditFormData((prev) => ({
        ...prev,
        first_name_ar: ocrData.first_name_ar || prev.first_name_ar,
        father_name_ar: ocrData.father_name_ar || prev.father_name_ar,
        last_name_ar: ocrData.last_name_ar || prev.last_name_ar,
        first_name_en: ocrData.first_name_en || prev.first_name_en,
        father_name_en: ocrData.father_name_en || prev.father_name_en,
        last_name_en: ocrData.last_name_en || prev.last_name_en,
        passport_number: ocrData.passport_number || prev.passport_number,
        nationality: ocrData.nationality || prev.nationality,
      }));

      if (response.data.warning) {
        setOcrMessage({ type: 'warning', text: response.data.warning });
      } else {
        setOcrMessage({ type: 'success', text: 'تمت قراءة جواز السفر وتوزيع الأسماء بنجاح!' });
      }
    } catch (error: any) {
      const warningMsg = error.response?.data?.warning || error.response?.data?.error || 'تعذرت قراءة الجواز، يرجى إدخال البيانات يدوياً.';
      setOcrMessage({ type: 'error', text: warningMsg });
    } finally {
      setScanningPassport(false);
      e.target.value = '';
    }
  };

  const handleUpdatePilgrim = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPilgrim(true);

    try {
      await api.put(`/api/pilgrims/${id}`, {
        ...editFormData,
        trip_id: pilgrim?.trip_id,
      });
      alert('تم تحديث بيانات المعتمر بنجاح');
      setShowEditModal(false);
      fetchPilgrim();
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ أثناء التحديث');
    } finally {
      setSavingPilgrim(false);
    }
  };

  const handleDeletePilgrim = async () => {
    if (!confirm('هل أنت متأكد من حذف هذا المعتمر نهائياً؟')) {
      return;
    }

    try {
      await api.delete(`/api/pilgrims/${id}`);
      alert('تم حذف المعتمر بنجاح');
      navigate(`/trips/${pilgrim?.trip_id}`);
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ أثناء الحذف');
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

  const fullNameAr = [pilgrim.first_name_ar, pilgrim.father_name_ar, pilgrim.last_name_ar].filter(Boolean).join(' ') || 'غير متوفر';
  const fullNameEn = [pilgrim.first_name_en, pilgrim.father_name_en, pilgrim.last_name_en].filter(Boolean).join(' ') || 'غير متوفر';

  return (
    <div>
      <div
        style={{
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
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
            {fullNameAr}
          </h1>
          <p style={{ color: '#666', margin: '0 0 0.5rem' }}>{fullNameEn}</p>
          <p style={{ color: '#666', margin: 0 }}>{pilgrim.nationality}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={() => {
              setOcrMessage(null);
              setShowEditModal(true);
            }}
            className="btn btn-primary"
          >
            ✏️ تعديل البيانات / قراءة الجواز
          </button>
          <button
            onClick={handleDeletePilgrim}
            className="btn btn-danger"
          >
            🗑️ حذف المعتمر
          </button>
        </div>
      </div>

      {/* Pilgrim Details - مقسمة لـ 3 خانات واضحة */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem' }}>معلومات المعتمر</h2>
        
        {/* الصف الأول: الأسماء بالعربية (3 خانات) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '1rem',
            marginBottom: '1.5rem',
            padding: '1rem',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px',
          }}
        >
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>الاسم الأول (عربي)</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '700', margin: 0 }}>{pilgrim.first_name_ar || '-'}</p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>اسم الأب (عربي)</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '700', margin: 0 }}>{pilgrim.father_name_ar || '-'}</p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>النسبة (عربي)</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '700', margin: 0 }}>{pilgrim.last_name_ar || '-'}</p>
          </div>
        </div>

        {/* الصف الثاني: الأسماء بالإنجليزية (3 خانات) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '1rem',
            marginBottom: '1.5rem',
            padding: '1rem',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px',
          }}
        >
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>First Name (EN)</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600', margin: 0 }}>{pilgrim.first_name_en || '-'}</p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>Father Name (EN)</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600', margin: 0 }}>{pilgrim.father_name_en || '-'}</p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>Last Name (EN)</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600', margin: 0 }}>{pilgrim.last_name_en || '-'}</p>
          </div>
        </div>

        {/* باقي المعلومات */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1.5rem',
          }}
        >
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
                              ${denom.denomination} × {denom.quantity} =${denom.subtotal.toFixed(2)}
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

      {/* Edit Pilgrim & OCR Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => !savingPilgrim && setShowEditModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '750px' }}>
            <div className="modal-header">
              <h2 className="modal-title">تعديل بيانات المعتمر</h2>
              <button
                onClick={() => !savingPilgrim && setShowEditModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#666' }}
                disabled={savingPilgrim}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleUpdatePilgrim}>
              <div className="modal-body">
                {/* قسم قراءة الجواز بالـ OCR */}
                <div
                  style={{
                    padding: '1rem',
                    backgroundColor: '#f0f4ff',
                    border: '1px dashed #4a6cf7',
                    borderRadius: '8px',
                    marginBottom: '1.5rem',
                  }}
                >
                  <label className="form-label" style={{ fontWeight: '700', marginBottom: '0.5rem', display: 'block' }}>
                    📷 مسح جواز السفر تلقائياً (OCR)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePassportScan}
                    disabled={scanningPassport || savingPilgrim}
                    className="form-input"
                  />
                  {scanningPassport && (
                    <p style={{ color: '#4a6cf7', marginTop: '0.5rem', fontWeight: '600' }}>
                      ⏳ جاري قراءة الجواز وترجمة الأسماء وتوزيعها على الخانات...
                    </p>
                  )}
                  {ocrMessage && (
                    <p
                      style={{
                        marginTop: '0.5rem',
                        fontWeight: '600',
                        color: ocrMessage.type === 'error' ? '#dc3545' : ocrMessage.type === 'warning' ? '#d39e00' : '#28a745',
                      }}
                    >
                      {ocrMessage.text}
                    </p>
                  )}
                </div>

                {/* حقول الاسم بالعربية - 3 خانات */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">الاسم الأول (عربي) *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.first_name_ar}
                      onChange={(e) => setEditFormData({ ...editFormData, first_name_ar: e.target.value })}
                      required
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">اسم الأب (عربي) *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.father_name_ar}
                      onChange={(e) => setEditFormData({ ...editFormData, father_name_ar: e.target.value })}
                      required
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">النسبة (عربي) *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.last_name_ar}
                      onChange={(e) => setEditFormData({ ...editFormData, last_name_ar: e.target.value })}
                      required
                      disabled={savingPilgrim}
                    />
                  </div>
                </div>

                {/* حقول الاسم بالإنجليزية - 3 خانات */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">First Name (EN)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.first_name_en}
                      onChange={(e) => setEditFormData({ ...editFormData, first_name_en: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Father Name (EN)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.father_name_en}
                      onChange={(e) => setEditFormData({ ...editFormData, father_name_en: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Last Name (EN)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.last_name_en}
                      onChange={(e) => setEditFormData({ ...editFormData, last_name_en: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">رقم جواز السفر *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.passport_number}
                      onChange={(e) => setEditFormData({ ...editFormData, passport_number: e.target.value })}
                      required
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">الجنسية *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.nationality}
                      onChange={(e) => setEditFormData({ ...editFormData, nationality: e.target.value })}
                      required
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">رقم الفيزا</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.visa_number}
                      onChange={(e) => setEditFormData({ ...editFormData, visa_number: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">ملاحظات</label>
                  <textarea
                    className="form-textarea"
                    value={editFormData.notes}
                    onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                    disabled={savingPilgrim}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => !savingPilgrim && setShowEditModal(false)}
                  className="btn btn-secondary"
                  disabled={savingPilgrim}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingPilgrim || scanningPassport}>
                  {savingPilgrim ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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