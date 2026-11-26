import { authService } from '../services/auth';
import Modal from '../components/Modal';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import PassportOcrPanel, { type OcrScanPayload } from '../components/PassportOcrPanel';
import type { Pilgrim } from '../types';

const CASH_DENOMINATIONS = [1, 5, 10, 20, 50, 100];
const NATIONALITY_MAP: Record<string, string> = {
  SYR: 'سوريا', SAU: 'السعودية', EGY: 'مصر', JOR: 'الأردن',
  KWT: 'الكويت', ARE: 'الإمارات', UAE: 'الإمارات', YEM: 'اليمن',
  IRQ: 'العراق', LBN: 'لبنان', SDN: 'السودان', PAL: 'فلسطين',
  PSE: 'فلسطين', TUR: 'تركيا',
};
const OCR_REVIEW_STYLE = { borderColor: '#d39e00', backgroundColor: '#fff8e1' };

function PilgrimDetail() {
  const isAdmin = authService.isAdmin();
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
  const [ocrReviewFields, setOcrReviewFields] = useState<string[]>([]);
  const confirmDuplicateRef = useRef(false);
  const [editFormData, setEditFormData] = useState({
    first_name_ar: '',
    father_name_ar: '',
    last_name_ar: '',
    first_name_en: '',
    father_name_en: '',
    last_name_en: '',
    nationality: '',
    passport_number: '',
    passport_expiry_date: '',
    date_of_birth: '',
    gender: '',
    visa_number: '',
    origin_city: 'دمشق',
    destination_city: 'جدة',
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
        passport_expiry_date: data.passport_expiry_date?.slice(0, 10) || '',
        date_of_birth: data.date_of_birth?.slice(0, 10) || '',
        gender: data.gender || '',
        visa_number: data.visa_number || '',
        origin_city: data.origin_city || 'دمشق',
        destination_city: data.destination_city || 'جدة',
        notes: data.notes || '',
      });
    } catch (error) {
      alert('حدث خطأ في تحميل البيانات');
      navigate('/trips');
    } finally {
      setLoading(false);
    }
  };

  const handleOcrExtracted = useCallback((payload: OcrScanPayload) => {
    const ocrData = payload.data || {};
    setOcrReviewFields(payload.reviewFields || []);
    setEditFormData((prev) => ({
      ...prev,
      first_name_ar: ocrData.first_name_ar || prev.first_name_ar,
      father_name_ar: ocrData.father_name_ar || prev.father_name_ar,
      last_name_ar: ocrData.last_name_ar || prev.last_name_ar,
      first_name_en: ocrData.first_name_en || prev.first_name_en,
      father_name_en: ocrData.father_name_en || prev.father_name_en,
      last_name_en: ocrData.last_name_en || prev.last_name_en,
      passport_number: ocrData.passport_number || prev.passport_number,
      passport_expiry_date: ocrData.passport_expiry_date || prev.passport_expiry_date,
      date_of_birth: ocrData.date_of_birth || prev.date_of_birth,
      nationality: NATIONALITY_MAP[String(ocrData.nationality || '').toUpperCase()] ||
        ocrData.nationality || prev.nationality,
      gender: ocrData.gender === 'M' ? 'ذكر' : ocrData.gender === 'F' ? 'أنثى' : prev.gender,
    }));
  }, []);

  const handleUpdatePilgrim = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPilgrim(true);

    try {
      await api.put(`/api/pilgrims/${id}`, {
        ...editFormData,
        trip_id: pilgrim?.trip_id,
        confirm_duplicate: confirmDuplicateRef.current || undefined,
      });
      confirmDuplicateRef.current = false;
      alert('تم تحديث بيانات المعتمر بنجاح');
      setShowEditModal(false);
      fetchPilgrim();
    } catch (error: any) {
      if (error.response?.status === 409 && error.response?.data?.duplicates && !confirmDuplicateRef.current) {
        const duplicates = error.response.data.duplicates as Array<Record<string, string>>;
        const summary = duplicates.map((d) =>
          `${[d.first_name_ar, d.father_name_ar, d.last_name_ar].filter(Boolean).join(' ')} — رحلة: ${d.trip_name || '-'}`
        ).join('\n');
        if (window.confirm(`تنبيه: رقم جواز السفر هذا مسجل مسبقاً:\n${summary}\n\nهل تريد الحفظ على أي حال؟`)) {
          confirmDuplicateRef.current = true;
          const form = (document.activeElement as HTMLElement | null)?.closest('form') ||
            document.querySelector('.modal form');
          form?.requestSubmit();
          return;
        }
        alert('تم إلغاء العملية. راجع السجلات المطابقة أولاً.');
      } else {
        alert(error.response?.data?.error || 'حدث خطأ أثناء التحديث');
      }
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
      'لديه دفعات': 'badge-success',
      'لا توجد دفعات': 'badge-danger',
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
       className="page-header">
        <div className="">
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
        <div style={{ display: 'flex', gap: '0.75rem' }} className="row-actions page-actions">
          <button
            onClick={() => {
              confirmDuplicateRef.current = false;
              setOcrReviewFields([]);
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
         className="responsive-grid">
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
         className="responsive-grid">
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
         className="responsive-grid">
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>الجنسية</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600' }}>{pilgrim.nationality}</p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>رقم جواز السفر</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600' }}>{pilgrim.passport_number}</p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>تاريخ الميلاد</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600' }}>
              {pilgrim.date_of_birth ? new Date(`${pilgrim.date_of_birth.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA') : '-'}
            </p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>الوجهة</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600' }}>
              {pilgrim.origin_city || 'دمشق'} - {pilgrim.destination_city || 'جدة'}
            </p>
          </div>
          <div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>رقم الفيزا</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600' }}>
              {pilgrim.visa_number || 'غير متوفر'}
            </p>
          </div>
          {isAdmin && (<div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>إجمالي المقبوض</p>
            <p style={{ fontSize: '1.125rem', fontWeight: '600', color: '#28a745' }}>
              ${pilgrim.total_received?.toFixed(2) || 0}
            </p>
          </div>)}
          {isAdmin && (<div>
            <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>حالة الدفع</p>
            <span className={`badge ${getPaymentStatusBadge(pilgrim.payment_status || '')}`}>
              {pilgrim.payment_status || 'لا توجد دفعات'}
            </span>
          </div>)}
          {pilgrim.notes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.25rem' }}>ملاحظات</p>
              <p style={{ fontSize: '1rem' }}>{pilgrim.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Payment History */}
      {isAdmin && (<div className="card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1.5rem',
          }}
         className="row-actions">
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
            <table className="table responsive-table">
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
                    <td style={{ fontWeight: '600', color: '#28a745' }} data-label="المبلغ"><div className="cell-value">
                      ${payment.amount_usd.toFixed(2)}
                    </div></td>
                    <td data-label="طريقة الدفع"><div className="cell-value">{payment.payment_method}</div></td>
                    <td data-label="تاريخ الدفع"><div className="cell-value">{new Date(payment.payment_date).toLocaleDateString('ar-SA')}</div></td>
                    <td data-label="التفاصيل"><div className="cell-value">
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
                    </div></td>
                    <td data-label="الإجراءات"><div className="cell-value">
                      <button
                        onClick={() => handleDeletePayment(payment.id)}
                        className="btn btn-sm btn-danger"
                      >
                        حذف
                      </button>
                    </div></td>
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
      </div>)}

      {/* Edit Pilgrim & OCR Modal */}
      {showEditModal && (
        <Modal title={<>تعديل بيانات المعتمر</>} onClose={() => !savingPilgrim && setShowEditModal(false)} busy={savingPilgrim} maxWidth="750px">

            <form onSubmit={handleUpdatePilgrim}>
              <div className="modal-body">
                {/* قسم قراءة الجواز بالـ OCR */}
                <PassportOcrPanel
                  onExtracted={handleOcrExtracted}
                  disabled={savingPilgrim}
                />
                {ocrReviewFields.length > 0 && (
                  <p role="status" style={{ color: '#8a6500', margin: '-0.75rem 0 1rem' }}>
                    راجع الحقول المظللة يدويًا قبل الحفظ.
                  </p>
                )}

                {/* حقول الاسم بالعربية - 3 خانات */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }} className="responsive-grid">
                  <div className="form-group">
                    <label className="form-label">الاسم الأول (عربي) *</label>
                    <input
                      type="text"
                      className="form-input"
                      style={ocrReviewFields.includes('first_name_ar') ? OCR_REVIEW_STYLE : undefined}
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
                      style={ocrReviewFields.includes('father_name_ar') ? OCR_REVIEW_STYLE : undefined}
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
                      style={ocrReviewFields.includes('last_name_ar') ? OCR_REVIEW_STYLE : undefined}
                      value={editFormData.last_name_ar}
                      onChange={(e) => setEditFormData({ ...editFormData, last_name_ar: e.target.value })}
                      required
                      disabled={savingPilgrim}
                    />
                  </div>
                </div>

                {/* حقول الاسم بالإنجليزية - 3 خانات */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }} className="responsive-grid">
                  <div className="form-group">
                    <label className="form-label">First Name (EN)</label>
                    <input
                      type="text"
                      className="form-input"
                      style={ocrReviewFields.includes('first_name_en') ? OCR_REVIEW_STYLE : undefined}
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
                      style={ocrReviewFields.includes('father_name_en') ? OCR_REVIEW_STYLE : undefined}
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
                      style={ocrReviewFields.includes('last_name_en') ? OCR_REVIEW_STYLE : undefined}
                      value={editFormData.last_name_en}
                      onChange={(e) => setEditFormData({ ...editFormData, last_name_en: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }} className="responsive-grid">
                  <div className="form-group">
                    <label className="form-label">رقم جواز السفر *</label>
                    <input
                      type="text"
                      className="form-input"
                      style={ocrReviewFields.includes('passport_number') ? OCR_REVIEW_STYLE : undefined}
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
                      style={ocrReviewFields.includes('nationality') ? OCR_REVIEW_STYLE : undefined}
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

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }} className="responsive-grid">
                  <div className="form-group">
                    <label className="form-label">تاريخ الميلاد</label>
                    <input
                      type="date"
                      className="form-input"
                      style={ocrReviewFields.includes('date_of_birth') ? OCR_REVIEW_STYLE : undefined}
                      value={editFormData.date_of_birth}
                      onChange={(e) => setEditFormData({ ...editFormData, date_of_birth: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">تاريخ انتهاء جواز السفر</label>
                    <input
                      type="date"
                      className="form-input"
                      style={ocrReviewFields.includes('passport_expiry_date') ? OCR_REVIEW_STYLE : undefined}
                      value={editFormData.passport_expiry_date}
                      onChange={(e) => setEditFormData({ ...editFormData, passport_expiry_date: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">الجنس</label>
                    <select
                      className="form-select"
                      style={ocrReviewFields.includes('gender') ? OCR_REVIEW_STYLE : undefined}
                      value={editFormData.gender}
                      onChange={(e) => setEditFormData({ ...editFormData, gender: e.target.value })}
                      disabled={savingPilgrim}
                    >
                      <option value="">غير محدد</option>
                      <option value="ذكر">ذكر</option>
                      <option value="أنثى">أنثى</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }} className="responsive-grid">
                  <div className="form-group">
                    <label className="form-label">من (مدينة الانطلاق)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.origin_city}
                      onChange={(e) => setEditFormData({ ...editFormData, origin_city: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">إلى (الوجهة)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editFormData.destination_city}
                      onChange={(e) => setEditFormData({ ...editFormData, destination_city: e.target.value })}
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
                <button type="submit" className="btn btn-primary" disabled={savingPilgrim}>
                  {savingPilgrim ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </Modal>
      )}

      {/* Payment Modal */}
      {isAdmin && showPaymentModal && (
        <Modal title={<>إضافة دفعة جديدة</>} onClose={() => !savingPayment && setShowPaymentModal(false)} busy={savingPayment} maxWidth="700px">

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
                      <table className="table responsive-table" style={{ fontSize: '0.875rem' }}>
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
                              <td data-label="الفئة"><div className="cell-value">
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
                              </div></td>
                              <td data-label="عدد الأوراق"><div className="cell-value">
                                <input
                                  type="number"
                                  min="1"
                                  className="form-input"
                                  value={denom.quantity}
                                  onChange={(e) => updateCashDenomination(index, 'quantity', parseInt(e.target.value) || 0)}
                                  disabled={savingPayment}
                                />
                              </div></td>
                              <td data-label="المجموع"><div className="cell-value">${denom.subtotal.toFixed(2)}</div></td>
                              <td data-label="الإجراءات"><div className="cell-value">
                                <button
                                  type="button"
                                  onClick={() => removeCashDenomination(index)}
                                  className="btn btn-sm btn-danger"
                                  disabled={savingPayment}
                                >
                                  حذف
                                </button>
                              </div></td>
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
          </Modal>
      )}
    </div>
  );
}

export default PilgrimDetail;