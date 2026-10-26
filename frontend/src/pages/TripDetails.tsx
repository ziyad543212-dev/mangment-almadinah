import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import type { Pilgrim, Trip } from '../types';

const NATIONALITY_MAP: Record<string, string> = {
  SYR: 'سوريا', SAU: 'السعودية', EGY: 'مصر', JOR: 'الأردن',
  KWT: 'الكويت', ARE: 'الإمارات', UAE: 'الإمارات', YEM: 'اليمن',
  IRQ: 'العراق', LBN: 'لبنان', SDN: 'السودان', PAL: 'فلسطين',
  PSE: 'فلسطين', TUR: 'تركيا',
};

function mapMrzNationality(code?: string): string {
  if (!code) return '';
  return NATIONALITY_MAP[code.trim().toUpperCase()] || code;
}

function mapMrzGender(gender?: string): string {
  if (!gender) return '';
  const g = gender.trim().toUpperCase();
  if (g === 'M' || g === 'MALE' || gender === 'ذكر') return 'ذكر';
  if (g === 'F' || g === 'FEMALE' || gender === 'أنثى') return 'أنثى';
  return '';
}

function TripDetails() {
  const emptyPilgrimForm = {
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
    visa_document_path: '',
    notes: '',
  };

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPilgrimModal, setShowPilgrimModal] = useState(false);
  const [pilgrimFormData, setPilgrimFormData] = useState(emptyPilgrimForm);
  const [editingPilgrim, setEditingPilgrim] = useState<Pilgrim | null>(null);
  const [scanningPassport, setScanningPassport] = useState(false);
  const [uploadingVisa, setUploadingVisa] = useState(false);
  const [uploadedVisaFile, setUploadedVisaFile] = useState<File | null>(null);
  const [savingPilgrim, setSavingPilgrim] = useState(false);

  useEffect(() => {
    if (id) fetchTrip();
  }, [id]);

  const fetchTrip = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/api/trips/${id}`);
      setTrip(response.data);
    } catch (error) {
      alert('حدث خطأ في تحميل البيانات');
      navigate('/trips');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPilgrim = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPilgrim(true);

    try {
      const tripId = Number(id);
      const pilgrimData = {
        trip_id: tripId,
        first_name_ar: pilgrimFormData.first_name_ar.trim() || null,
        father_name_ar: pilgrimFormData.father_name_ar.trim() || null,
        last_name_ar: pilgrimFormData.last_name_ar.trim() || null,
        first_name_en: pilgrimFormData.first_name_en.trim() || null,
        father_name_en: pilgrimFormData.father_name_en.trim() || null,
        last_name_en: pilgrimFormData.last_name_en.trim() || null,
        nationality: pilgrimFormData.nationality.trim(),
        passport_number: pilgrimFormData.passport_number.trim(),
        passport_expiry_date: pilgrimFormData.passport_expiry_date || null,
        date_of_birth: pilgrimFormData.date_of_birth || null,
        gender: pilgrimFormData.gender || null,
        visa_number: pilgrimFormData.visa_number.trim() || null,
        visa_document_path: pilgrimFormData.visa_document_path || null,
        notes: pilgrimFormData.notes.trim() || null,
      };

      if (editingPilgrim) {
        await api.put(`/api/pilgrims/${editingPilgrim.id}`, pilgrimData);
      } else {
        await api.post('/api/pilgrims', pilgrimData);
      }
      alert(editingPilgrim ? 'تم تحديث بيانات المعتمر بنجاح' : 'تمت إضافة المعتمر بنجاح');
      setShowPilgrimModal(false);
      setEditingPilgrim(null);
      setPilgrimFormData(emptyPilgrimForm);
      setUploadedVisaFile(null);
      fetchTrip();
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ');
    } finally {
      setSavingPilgrim(false);
    }
  };

  const openAddPilgrimModal = () => {
    setEditingPilgrim(null);
    setPilgrimFormData(emptyPilgrimForm);
    setUploadedVisaFile(null);
    setShowPilgrimModal(true);
  };

  const openEditPilgrimModal = (pilgrim: Pilgrim) => {
    setEditingPilgrim(pilgrim);
    setPilgrimFormData({
      ...emptyPilgrimForm,
      first_name_ar: pilgrim.first_name_ar || '',
      father_name_ar: pilgrim.father_name_ar || '',
      last_name_ar: pilgrim.last_name_ar || '',
      first_name_en: pilgrim.first_name_en || '',
      father_name_en: pilgrim.father_name_en || '',
      last_name_en: pilgrim.last_name_en || '',
      nationality: mapMrzNationality(pilgrim.nationality) || '',
      passport_number: pilgrim.passport_number || '',
      passport_expiry_date: pilgrim.passport_expiry_date?.slice(0, 10) || '',
      date_of_birth: pilgrim.date_of_birth?.slice(0, 10) || '',
      gender: mapMrzGender(pilgrim.gender) || '',
      visa_number: pilgrim.visa_number || '',
      visa_document_path: pilgrim.visa_document_path || '',
      notes: pilgrim.notes || '',
    });
    setUploadedVisaFile(null);
    setShowPilgrimModal(true);
  };

  const handleDeletePilgrim = async (pilgrim: Pilgrim) => {
    if (!confirm(`هل أنت متأكد من حذف المعتمر؟`)) return;
    try {
      await api.delete(`/api/pilgrims/${pilgrim.id}`);
      alert('تم حذف المعتمر بنجاح');
      fetchTrip();
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ أثناء الحذف');
    }
  };

  const handlePassportScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanningPassport(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await api.post('/api/ocr/passport', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const ocrData = response.data.data || {};
      const mappedNationality = mapMrzNationality(ocrData.nationality);
      const mappedGender = mapMrzGender(ocrData.gender);

      setPilgrimFormData((prev) => ({
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
        nationality: mappedNationality || ocrData.nationality || prev.nationality,
        gender: mappedGender || prev.gender,
      }));

      if (response.data.warning) {
        alert(response.data.warning);
      } else {
        alert('تم استخراج البيانات (الأسماء، تاريخ الميلاد، الجنسية) بنجاح!');
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.warning || error.response?.data?.error || 'فشل في قراءة الملف.';
      alert(errorMsg);
    } finally {
      setScanningPassport(false);
      e.target.value = '';
    }
  };

  const handleVisaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingVisa(true);
    setUploadedVisaFile(file);
    const formData = new FormData();
    formData.append('visa', file);

    try {
      const response = await api.post('/api/upload/visa', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setPilgrimFormData((prev) => ({
        ...prev,
        visa_document_path: response.data.visa_document_path || prev.visa_document_path,
        visa_number: response.data.visa_number || prev.visa_number,
      }));
      alert('تم رفع الفيزا بنجاح');
    } catch (error: any) {
      alert('فشل في رفع الفيزا');
      setUploadedVisaFile(null);
    } finally {
      setUploadingVisa(false);
      e.target.value = '';
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

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" style={{ width: '40px', height: '40px' }}></div></div>;
  if (!trip) return <div style={{ textAlign: 'center', padding: '3rem' }}><p>الرحلة غير موجودة</p></div>;

  return (
    <div>
      <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <button onClick={() => navigate('/trips')} className="btn btn-secondary" style={{ marginBottom: '1rem' }}>← العودة للرحلات</button>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.5rem' }}>{trip.name}</h1>
          <p style={{ color: '#666', margin: 0 }}>تاريخ الرحلة: {new Date(trip.trip_date).toLocaleDateString('ar-SA')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => navigate(`/trips/${id}/manifest`)} className="btn btn-secondary"><span>📄</span><span>كشف الركاب</span></button>
          <button onClick={openAddPilgrimModal} className="btn btn-primary"><span>➕</span><span>إضافة معتمر</span></button>
        </div>
      </div>

      {/* Pilgrims Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الجنسية</th>
                <th>رقم جواز السفر</th>
                <th>رقم الفيزا</th>
                <th>المقبوض</th>
                <th>حالة الدفع</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {trip.pilgrims && trip.pilgrims.length > 0 ? (
                trip.pilgrims.map((pilgrim) => (
                  <tr key={pilgrim.id}>
                    <td>
                      <Link to={`/pilgrims/${pilgrim.id}`} style={{ color: '#D4AF37', textDecoration: 'none', fontWeight: '600' }}>
                        {[pilgrim.first_name_ar, pilgrim.father_name_ar, pilgrim.last_name_ar].filter(Boolean).join(' ') || '-'}
                      </Link>
                    </td>
                    <td>{pilgrim.nationality}</td>
                    <td>{pilgrim.passport_number}</td>
                    <td>{pilgrim.visa_number || '-'}</td>
                    <td>${pilgrim.total_received?.toFixed(2) || 0}</td>
                    <td><span className={`badge ${getPaymentStatusBadge(pilgrim.payment_status || '')}`}>{pilgrim.payment_status || 'غير مدفوع'}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Link to={`/pilgrims/${pilgrim.id}`} className="btn btn-sm btn-secondary" style={{ textDecoration: 'none' }}>عرض</Link>
                        <button type="button" onClick={() => openEditPilgrimModal(pilgrim)} className="btn btn-sm btn-secondary">تعديل</button>
                        <button type="button" onClick={() => handleDeletePilgrim(pilgrim)} className="btn btn-sm btn-danger">حذف</button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}>
                    <p style={{ color: '#666', marginBottom: '1rem' }}>لا يوجد معتمرين في هذه الرحلة</p>
                    <button onClick={openAddPilgrimModal} className="btn btn-primary">إضافة معتمر</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Pilgrim Modal */}
      {showPilgrimModal && (
        <div className="modal-overlay" onClick={() => !savingPilgrim && setShowPilgrimModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2 className="modal-title">{editingPilgrim ? 'تعديل بيانات المعتمر' : 'إضافة معتمر جديد'}</h2>
              <button onClick={() => !savingPilgrim && setShowPilgrimModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#666' }}>✕</button>
            </div>
            <form onSubmit={handleAddPilgrim}>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                {/* Passport OCR Section */}
                <div className="form-group" style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                  <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block', fontWeight: '700' }}>
                    📷 مسح جواز السفر (يدعم الصور وملفات الـ PDF)
                  </label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handlePassportScan}
                    disabled={scanningPassport || savingPilgrim}
                    style={{ marginBottom: '0.5rem' }}
                  />
                  {scanningPassport && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#4a6cf7', marginTop: '0.5rem', fontWeight: '600' }}>
                      <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                      <span>جاري قراءة الجواز واستخراج البيانات...</span>
                    </div>
                  )}
                </div>

                {/* الأسماء بالعربية */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                  <div className="form-group"><label className="form-label">الاسم الأول (عربي) *</label><input type="text" className="form-input" value={pilgrimFormData.first_name_ar} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, first_name_ar: e.target.value })} required disabled={savingPilgrim} /></div>
                  <div className="form-group"><label className="form-label">اسم الأب (عربي)</label><input type="text" className="form-input" value={pilgrimFormData.father_name_ar} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, father_name_ar: e.target.value })} disabled={savingPilgrim} /></div>
                  <div className="form-group"><label className="form-label">النسبة (عربي)</label><input type="text" className="form-input" value={pilgrimFormData.last_name_ar} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, last_name_ar: e.target.value })} disabled={savingPilgrim} /></div>
                </div>

                {/* الأسماء بالإنجليزية */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                  <div className="form-group"><label className="form-label">First Name (EN)</label><input type="text" className="form-input" value={pilgrimFormData.first_name_en} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, first_name_en: e.target.value })} disabled={savingPilgrim} /></div>
                  <div className="form-group"><label className="form-label">Father Name (EN)</label><input type="text" className="form-input" value={pilgrimFormData.father_name_en} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, father_name_en: e.target.value })} disabled={savingPilgrim} /></div>
                  <div className="form-group"><label className="form-label">Last Name (EN)</label><input type="text" className="form-input" value={pilgrimFormData.last_name_en} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, last_name_en: e.target.value })} disabled={savingPilgrim} /></div>
                </div>

                <div className="form-group">
                  <label className="form-label">الجنسية *</label>
                  <select className="form-select" value={pilgrimFormData.nationality} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, nationality: e.target.value })} required disabled={savingPilgrim}>
                    <option value="">اختر الجنسية</option>
                    <option value="سوريا">سوريا</option>
                    <option value="السعودية">السعودية</option>
                    <option value="مصر">مصر</option>
                    <option value="الأردن">الأردن</option>
                    <option value="الكويت">الكويت</option>
                    <option value="الإمارات">الإمارات</option>
                    <option value="اليمن">اليمن</option>
                    <option value="العراق">العراق</option>
                    <option value="لبنان">لبنان</option>
                    <option value="السودان">السودان</option>
                    <option value="فلسطين">فلسطين</option>
                    <option value="تركيا">تركيا</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group"><label className="form-label">رقم جواز السفر *</label><input type="text" className="form-input" value={pilgrimFormData.passport_number} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, passport_number: e.target.value })} required disabled={savingPilgrim} /></div>
                  <div className="form-group"><label className="form-label">تاريخ انتهاء جواز السفر</label><input type="date" className="form-input" value={pilgrimFormData.passport_expiry_date} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, passport_expiry_date: e.target.value })} disabled={savingPilgrim} /></div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group"><label className="form-label">تاريخ الميلاد</label><input type="date" className="form-input" value={pilgrimFormData.date_of_birth} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, date_of_birth: e.target.value })} disabled={savingPilgrim} /></div>
                  <div className="form-group">
                    <label className="form-label">الجنس</label>
                    <select className="form-select" value={pilgrimFormData.gender} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, gender: e.target.value })} disabled={savingPilgrim}>
                      <option value="">اختر الجنس</option>
                      <option value="ذكر">ذكر</option>
                      <option value="أنثى">أنثى</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">رقم الفيزا</label>
                  <input type="text" className="form-input" value={pilgrimFormData.visa_number} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, visa_number: e.target.value })} disabled={savingPilgrim} />
                </div>

                <div className="form-group">
                  <label className="form-label">ملاحظات</label>
                  <textarea className="form-textarea" value={pilgrimFormData.notes} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, notes: e.target.value })} disabled={savingPilgrim} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => !savingPilgrim && setShowPilgrimModal(false)} className="btn btn-secondary" disabled={savingPilgrim}>إلغاء</button>
                <button type="submit" className="btn btn-primary" disabled={savingPilgrim || scanningPassport}>
                  {savingPilgrim ? 'جاري الحفظ...' : (editingPilgrim ? 'حفظ التعديلات' : 'إضافة')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default TripDetails;