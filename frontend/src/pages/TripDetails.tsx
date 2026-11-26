import { authService } from '../services/auth';
import Modal from '../components/Modal';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import PassportOcrPanel, { type OcrScanPayload } from '../components/PassportOcrPanel';
import type { Pilgrim, Trip } from '../types';

// توسيع واجهة الرحلة محلياً لتشمل بيانات المركبة والسائقين ومنع أخطاء TypeScript
type TripWithTransport = Trip & {
  vehicle_number?: string;
  driver_one_name?: string;
  driver_two_name?: string;
};

const NATIONALITY_MAP: Record<string, string> = {
  SYR: 'سوريا', SAU: 'السعودية', EGY: 'مصر', JOR: 'الأردن',
  KWT: 'الكويت', ARE: 'الإمارات', UAE: 'الإمارات', YEM: 'اليمن',
  IRQ: 'العراق', LBN: 'لبنان', SDN: 'السودان', PAL: 'فلسطين',
  PSE: 'فلسطين', TUR: 'تركيا',
};
const OCR_REVIEW_STYLE = { borderColor: '#d39e00', backgroundColor: '#fff8e1' };

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
  const isAdmin = authService.isAdmin();
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
    origin_city: 'دمشق',
    destination_city: 'جدة',
    gender: '',
    visa_number: '',
    visa_document_path: '',
    notes: '',
  };

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<TripWithTransport | null>(null);
  const [loading, setLoading] = useState(true);

  // نوافذ المعتمرين
  const [showPilgrimModal, setShowPilgrimModal] = useState(false);
  const [pilgrimFormData, setPilgrimFormData] = useState(emptyPilgrimForm);
  const [editingPilgrim, setEditingPilgrim] = useState<Pilgrim | null>(null);
  const [ocrReviewFields, setOcrReviewFields] = useState<string[]>([]);
  const [savingPilgrim, setSavingPilgrim] = useState(false);
  const confirmDuplicateRef = useRef(false);

  // نافذة تعديل بيانات الرحلة (المركبة والسائقين)
  const [showEditTripModal, setShowEditTripModal] = useState(false);
  const [tripFormData, setTripFormData] = useState({
    name: '',
    trip_date: '',
    vehicle_number: '',
    driver_one_name: '',
    driver_two_name: '',
    trip_cost_usd: '',
  });
  const [savingTrip, setSavingTrip] = useState(false);

  useEffect(() => {
    if (id) fetchTrip();
  }, [id]);

  const fetchTrip = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/api/trips/${id}`);
      const data: TripWithTransport = response.data;
      setTrip(data);
      setTripFormData({
        name: data.name || '',
        trip_date: data.trip_date?.slice(0, 10) || '',
        vehicle_number: data.vehicle_number || '',
        driver_one_name: data.driver_one_name || '',
        driver_two_name: data.driver_two_name || '',
        trip_cost_usd: data.trip_cost_usd?.toString() || '',
      });
    } catch (error) {
      alert('حدث خطأ في تحميل البيانات');
      navigate('/trips');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTrip(true);
    try {
      await api.put(`/api/trips/${id}`, {
        ...tripFormData,
        trip_cost_usd: parseFloat(tripFormData.trip_cost_usd) || 0,
      });
      alert('تم تحديث تفاصيل الرحلة بنجاح');
      setShowEditTripModal(false);
      fetchTrip();
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ أثناء تحديث الرحلة');
    } finally {
      setSavingTrip(false);
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
        origin_city: pilgrimFormData.origin_city.trim() || 'دمشق',
        destination_city: pilgrimFormData.destination_city.trim() || 'جدة',
        gender: pilgrimFormData.gender || null,
        visa_number: pilgrimFormData.visa_number.trim() || null,
        visa_document_path: pilgrimFormData.visa_document_path || null,
        notes: pilgrimFormData.notes.trim() || null,
      };

      if (editingPilgrim) {
        await api.put(`/api/pilgrims/${editingPilgrim.id}`, pilgrimData);
      } else {
        await api.post('/api/pilgrims', {
          ...pilgrimData,
          confirm_duplicate: confirmDuplicateRef.current || undefined
        });
      }
      confirmDuplicateRef.current = false;
      alert(editingPilgrim ? 'تم تحديث بيانات المعتمر بنجاح' : 'تمت إضافة المعتمر بنجاح');
      setShowPilgrimModal(false);
      setEditingPilgrim(null);
      setPilgrimFormData(emptyPilgrimForm);
      fetchTrip();
    } catch (error: any) {
      if (error.response?.status === 409 && error.response?.data?.duplicates && !confirmDuplicateRef.current) {
        const duplicates = error.response.data.duplicates as Array<Record<string, string>>;
        const summary = duplicates.map((d) =>
          `${[d.first_name_ar, d.father_name_ar, d.last_name_ar].filter(Boolean).join(' ')} — رحلة: ${d.trip_name || '-'}`
        ).join('\n');
        if (window.confirm(`تنبيه: رقم جواز السفر هذا مسجل مسبقاً:\n${summary}\n\nهل تريد المتابعة بإنشاء سجل جديد على أي حال؟`)) {
          confirmDuplicateRef.current = true;
          const form = (document.activeElement as HTMLElement | null)?.closest('form') ||
            document.querySelector('.modal form');
          form?.requestSubmit();
          return;
        }
        alert('تم إلغاء العملية. راجع السجلات المطابقة أولاً.');
      } else {
        alert(error.response?.data?.error || 'حدث خطأ');
      }
    } finally {
      setSavingPilgrim(false);
    }
  };

  const openAddPilgrimModal = () => {
    setEditingPilgrim(null);
    setOcrReviewFields([]);
    confirmDuplicateRef.current = false;
    setPilgrimFormData(emptyPilgrimForm);
    setShowPilgrimModal(true);
  };

  const openEditPilgrimModal = (pilgrim: Pilgrim) => {
    setEditingPilgrim(pilgrim);
    setOcrReviewFields([]);
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
      origin_city: pilgrim.origin_city || 'دمشق',
      destination_city: pilgrim.destination_city || 'جدة',
      gender: mapMrzGender(pilgrim.gender) || '',
      visa_number: pilgrim.visa_number || '',
      visa_document_path: pilgrim.visa_document_path || '',
      notes: pilgrim.notes || '',
    });
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

  const handleOcrExtracted = useCallback((payload: OcrScanPayload) => {
    const ocrData = payload.data || {};
    const reviewFields: string[] = payload.reviewFields || [];
    setOcrReviewFields(reviewFields);
    const mappedNationality = mapMrzNationality(ocrData.nationality || undefined);
    const mappedGender = mapMrzGender(ocrData.gender || undefined);

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
  }, []);

  const getPaymentStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      'لديه دفعات': 'badge-success',
      'لا توجد دفعات': 'badge-danger',
    };
    return colors[status] || 'badge-info';
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" style={{ width: '40px', height: '40px' }}></div></div>;
  if (!trip) return <div style={{ textAlign: 'center', padding: '3rem' }}><p>الرحلة غير موجودة</p></div>;

  return (
    <div>
      <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }} className="page-header">
        <div className="">
          <button onClick={() => navigate('/trips')} className="btn btn-secondary" style={{ marginBottom: '1rem' }}>← العودة للرحلات</button>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.5rem' }}>{trip.name}</h1>
          <p style={{ color: '#666', margin: 0 }}>تاريخ الرحلة: {new Date(trip.trip_date).toLocaleDateString('ar-SA')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }} className="row-actions page-actions">
          <button onClick={() => setShowEditTripModal(true)} className="btn btn-secondary"><span>🚌</span><span>تعديل بيانات المركبة والسائقين</span></button>
          <button onClick={() => navigate(`/trips/${id}/manifest`)} className="btn btn-secondary"><span>📄</span><span>كشف الركاب</span></button>
          <button onClick={openAddPilgrimModal} className="btn btn-primary"><span>➕</span><span>إضافة معتمر</span></button>
        </div>
      </div>

      {/* عرض تفاصيل المركبة والسائقين الحالية */}
      <div className="card" style={{ marginBottom: '1.5rem', backgroundColor: '#f8f9fa' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.75rem', color: '#1a1a2e' }}>معلومات الحافلة والسائقين</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }} className="responsive-grid">
          <div>
            <span style={{ color: '#666', fontSize: '0.875rem' }}>رقم المركبة: </span>
            <strong>{trip.vehicle_number || 'غير محدد'}</strong>
          </div>
          <div>
            <span style={{ color: '#666', fontSize: '0.875rem' }}>السائق الأول: </span>
            <strong>{trip.driver_one_name || 'غير محدد'}</strong>
          </div>
          <div>
            <span style={{ color: '#666', fontSize: '0.875rem' }}>السائق الثاني: </span>
            <strong>{trip.driver_two_name || 'غير محدد'}</strong>
          </div>
        </div>
      </div>

      {/* Pilgrims Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-container">
          <table className="table responsive-table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الجنسية</th>
                <th>رقم جواز السفر</th>
                <th>تاريخ الميلاد</th>
                <th>الوجهة</th>
                {isAdmin && (<th>المقبوض</th>)}
                {isAdmin && (<th>الدفعات المسجلة</th>)}
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {trip.pilgrims && trip.pilgrims.length > 0 ? (
                trip.pilgrims.map((pilgrim) => (
                  <tr key={pilgrim.id}>
                    <td data-label="الاسم"><div className="cell-value">
                      <Link to={`/pilgrims/${pilgrim.id}`} style={{ color: '#D4AF37', textDecoration: 'none', fontWeight: '600' }}>
                        {[pilgrim.first_name_ar, pilgrim.father_name_ar, pilgrim.last_name_ar].filter(Boolean).join(' ') || '-'}
                      </Link>
                      {[pilgrim.first_name_en, pilgrim.father_name_en, pilgrim.last_name_en].some(Boolean) && (
                        <div style={{ color: '#666', fontSize: '0.875rem' }}>
                          {[pilgrim.first_name_en, pilgrim.father_name_en, pilgrim.last_name_en].filter(Boolean).join(' ')}
                        </div>
                      )}
                    </div></td>
                    <td data-label="الجنسية"><div className="cell-value">{pilgrim.nationality}</div></td>
                    <td data-label="رقم جواز السفر"><div className="cell-value">{pilgrim.passport_number}</div></td>
                    <td data-label="تاريخ الميلاد"><div className="cell-value">{pilgrim.date_of_birth ? new Date(`${pilgrim.date_of_birth.slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA') : '-'}</div></td>
                    <td data-label="الوجهة"><div className="cell-value">{pilgrim.origin_city || 'دمشق'} - {pilgrim.destination_city || 'جدة'}</div></td>
                    {isAdmin && (<td data-label="المقبوض"><div className="cell-value">${pilgrim.total_received?.toFixed(2) || 0}</div></td>)}
                    {isAdmin && (<td data-label="الدفعات المسجلة"><div className="cell-value"><span className={`badge ${getPaymentStatusBadge(pilgrim.payment_status || '')}`}>{pilgrim.payment_status || 'لا توجد دفعات'}</span></div></td>)}
                    <td data-label="الإجراءات"><div className="cell-value">
                      <div style={{ display: 'flex', gap: '0.5rem' }} className="row-actions">
                        <Link to={`/pilgrims/${pilgrim.id}`} className="btn btn-sm btn-secondary" style={{ textDecoration: 'none' }}>عرض</Link>
                        <button type="button" onClick={() => openEditPilgrimModal(pilgrim)} className="btn btn-sm btn-secondary">تعديل</button>
                        <button type="button" onClick={() => handleDeletePilgrim(pilgrim)} className="btn btn-sm btn-danger">حذف</button>
                      </div>
                    </div></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={isAdmin ? 8 : 6} style={{ textAlign: 'center', padding: '3rem' }}>
                    <p style={{ color: '#666', marginBottom: '1rem' }}>لا يوجد معتمرين في هذه الرحلة</p>
                    <button onClick={openAddPilgrimModal} className="btn btn-primary">إضافة معتمر</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Trip Modal (Vehicle & Drivers) */}
      {showEditTripModal && (
        <Modal title={<>تعديل معلومات المركبة والسائقين</>} onClose={() => !savingTrip && setShowEditTripModal(false)} busy={savingTrip} maxWidth="600px">

            <form onSubmit={handleUpdateTrip}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">رقم المركبة</label>
                  <input
                    type="text"
                    className="form-input"
                    value={tripFormData.vehicle_number}
                    onChange={(e) => setTripFormData({ ...tripFormData, vehicle_number: e.target.value })}
                    placeholder="مثال: لوحة رقم 12345"
                    disabled={savingTrip}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">اسم السائق الأول</label>
                  <input
                    type="text"
                    className="form-input"
                    value={tripFormData.driver_one_name}
                    onChange={(e) => setTripFormData({ ...tripFormData, driver_one_name: e.target.value })}
                    placeholder="اسم السائق الأول الكامل"
                    disabled={savingTrip}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">اسم السائق الثاني</label>
                  <input
                    type="text"
                    className="form-input"
                    value={tripFormData.driver_two_name}
                    onChange={(e) => setTripFormData({ ...tripFormData, driver_two_name: e.target.value })}
                    placeholder="اسم السائق الثاني الكامل (إن وُجد)"
                    disabled={savingTrip}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => !savingTrip && setShowEditTripModal(false)} className="btn btn-secondary" disabled={savingTrip}>إلغاء</button>
                <button type="submit" className="btn btn-primary" disabled={savingTrip}>
                  {savingTrip ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </Modal>
      )}

      {/* Add/Edit Pilgrim Modal */}
      {showPilgrimModal && (
        <Modal title={<>{editingPilgrim ? 'تعديل بيانات المعتمر' : 'إضافة معتمر جديد'}</>} onClose={() => !savingPilgrim && setShowPilgrimModal(false)} busy={savingPilgrim} maxWidth="800px">

            <form onSubmit={handleAddPilgrim}>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                {/* Passport OCR Section */}
                <PassportOcrPanel
                  onExtracted={handleOcrExtracted}
                  disabled={savingPilgrim}
                />
                {ocrReviewFields.length > 0 && (
                  <p role="status" style={{ color: '#8a6500', margin: '-0.75rem 0 1rem' }}>
                    راجع الحقول المظللة يدويًا قبل الحفظ.
                  </p>
                )}

                {/* الأسماء بالعربية */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }} className="responsive-grid">
                  <div className="form-group"><label className="form-label">الاسم الأول (عربي) *</label><input type="text" className="form-input" style={ocrReviewFields.includes('first_name_ar') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.first_name_ar} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, first_name_ar: e.target.value })} required disabled={savingPilgrim} /></div>
                  <div className="form-group"><label className="form-label">اسم الأب (عربي)</label><input type="text" className="form-input" style={ocrReviewFields.includes('father_name_ar') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.father_name_ar} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, father_name_ar: e.target.value })} disabled={savingPilgrim} /></div>
                  <div className="form-group"><label className="form-label">النسبة (عربي)</label><input type="text" className="form-input" style={ocrReviewFields.includes('last_name_ar') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.last_name_ar} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, last_name_ar: e.target.value })} disabled={savingPilgrim} /></div>
                </div>

                {/* الأسماء بالإنجليزية */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }} className="responsive-grid">
                  <div className="form-group"><label className="form-label">First Name (EN)</label><input type="text" className="form-input" style={ocrReviewFields.includes('first_name_en') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.first_name_en} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, first_name_en: e.target.value })} disabled={savingPilgrim} /></div>
                  <div className="form-group"><label className="form-label">Father Name (EN)</label><input type="text" className="form-input" style={ocrReviewFields.includes('father_name_en') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.father_name_en} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, father_name_en: e.target.value })} disabled={savingPilgrim} /></div>
                  <div className="form-group"><label className="form-label">Last Name (EN)</label><input type="text" className="form-input" style={ocrReviewFields.includes('last_name_en') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.last_name_en} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, last_name_en: e.target.value })} disabled={savingPilgrim} /></div>
                </div>

                <div className="form-group">
                  <label className="form-label">الجنسية *</label>
                  <select className="form-select" style={ocrReviewFields.includes('nationality') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.nationality} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, nationality: e.target.value })} required disabled={savingPilgrim}>
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }} className="responsive-grid">
                  <div className="form-group"><label className="form-label">رقم جواز السفر *</label><input type="text" className="form-input" style={ocrReviewFields.includes('passport_number') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.passport_number} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, passport_number: e.target.value })} required disabled={savingPilgrim} /></div>
                  <div className="form-group"><label className="form-label">تاريخ انتهاء جواز السفر</label><input type="date" className="form-input" style={ocrReviewFields.includes('passport_expiry_date') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.passport_expiry_date} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, passport_expiry_date: e.target.value })} disabled={savingPilgrim} /></div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }} className="responsive-grid">
                  <div className="form-group"><label className="form-label">تاريخ الميلاد</label><input type="date" className="form-input" style={ocrReviewFields.includes('date_of_birth') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.date_of_birth} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, date_of_birth: e.target.value })} disabled={savingPilgrim} /></div>
                  <div className="form-group">
                    <label className="form-label">الجنس</label>
                    <select className="form-select" style={ocrReviewFields.includes('gender') ? OCR_REVIEW_STYLE : undefined} value={pilgrimFormData.gender} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, gender: e.target.value })} disabled={savingPilgrim}>
                      <option value="">اختر الجنس</option>
                      <option value="ذكر">ذكر</option>
                      <option value="أنثى">أنثى</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }} className="responsive-grid">
                  <div className="form-group">
                    <label className="form-label">من (مدينة الانطلاق)</label>
                    <input type="text" className="form-input" value={pilgrimFormData.origin_city} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, origin_city: e.target.value })} disabled={savingPilgrim} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">إلى (الوجهة)</label>
                    <input type="text" className="form-input" value={pilgrimFormData.destination_city} onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, destination_city: e.target.value })} disabled={savingPilgrim} />
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
                <button type="submit" className="btn btn-primary" disabled={savingPilgrim}>
                  {savingPilgrim ? 'جاري الحفظ...' : (editingPilgrim ? 'حفظ التعديلات' : 'إضافة')}
                </button>
              </div>
            </form>
          </Modal>
      )}
    </div>
  );
}

export default TripDetails;