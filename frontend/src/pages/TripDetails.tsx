import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import type { Trip } from '../types';

function TripDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPilgrimModal, setShowPilgrimModal] = useState(false);
  const [pilgrimFormData, setPilgrimFormData] = useState({
    name_ar: '',
    name_en: '',
    nationality: '',
    passport_number: '',
    passport_expiry_date: '',
    date_of_birth: '',
    gender: '',
    visa_number: '',
    visa_document_path: '',
    notes: '',
  });
  const [scanningPassport, setScanningPassport] = useState(false);
  const [uploadingVisa, setUploadingVisa] = useState(false);
  const [uploadedVisaFile, setUploadedVisaFile] = useState<File | null>(null);
  const [savingPilgrim, setSavingPilgrim] = useState(false);

  useEffect(() => {
    if (id) {
      fetchTrip();
    }
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
      await api.post('/api/pilgrims', {
        trip_id: parseInt(id!),
        ...pilgrimFormData,
      });
      alert('تمت إضافة المعتمر بنجاح');
      setShowPilgrimModal(false);
      setPilgrimFormData({
        name_ar: '',
        name_en: '',
        nationality: '',
        passport_number: '',
        passport_expiry_date: '',
        date_of_birth: '',
        gender: '',
        visa_number: '',
        visa_document_path: '',
        notes: '',
      });
      setUploadedVisaFile(null);
      fetchTrip();
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ');
    } finally {
      setSavingPilgrim(false);
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

      const data = response.data.data;
      setPilgrimFormData({
        ...pilgrimFormData,
        name_en: data.name_en || pilgrimFormData.name_en,
        passport_number: data.passport_number || pilgrimFormData.passport_number,
        passport_expiry_date: data.passport_expiry_date || pilgrimFormData.passport_expiry_date,
        date_of_birth: data.date_of_birth || pilgrimFormData.date_of_birth,
        nationality: data.nationality || pilgrimFormData.nationality,
        gender: data.gender || pilgrimFormData.gender,
      });

      alert('تم استخراج البيانات من جواز السفر بنجاح. يرجى مراجعة وتصحيح البيانات.');
    } catch (error: any) {
      alert('فشل في قراءة جواز السفر. يرجى إدخال البيانات يدويًا.');
    } finally {
      setScanningPassport(false);
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

      setPilgrimFormData({
        ...pilgrimFormData,
        visa_document_path: response.data.visa_document_path,
        visa_number: response.data.visa_number || pilgrimFormData.visa_number,
      });

      alert('تم رفع الفيزا بنجاح');
    } catch (error: any) {
      alert('فشل في رفع الفيزا');
      setUploadedVisaFile(null);
    } finally {
      setUploadingVisa(false);
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

  if (!trip) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <p>الرحلة غير موجودة</p>
        <button onClick={() => navigate('/trips')} className="btn btn-secondary">
          العودة للقائمة
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
            onClick={() => navigate('/trips')}
            className="btn btn-secondary"
            style={{ marginBottom: '1rem' }}
          >
            ← العودة للرحلات
          </button>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.5rem' }}>
            {trip.name}
          </h1>
          <p style={{ color: '#666', margin: 0 }}>تاريخ الرحلة: {new Date(trip.trip_date).toLocaleDateString('ar-SA')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => navigate(`/trips/${id}/manifest`)}
            className="btn btn-secondary"
          >
            <span>📄</span>
            <span>كشف الركاب</span>
          </button>
          <button
            onClick={() => setShowPilgrimModal(true)}
            className="btn btn-primary"
          >
            <span>➕</span>
            <span>إضافة معتمر</span>
          </button>
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
            <span style={{ fontSize: '2rem' }}>👥</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              عدد المعتمرين
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
            {trip.pilgrim_count || 0}
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
            <span style={{ fontSize: '2rem' }}>💰</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              إجمالي المقبوض
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
            ${trip.total_received?.toFixed(2) || 0}
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
            <span style={{ fontSize: '2rem' }}>💵</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              تكاليف الرحلة
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
            ${trip.trip_cost_usd?.toFixed(2) || 0}
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
            <span style={{ fontSize: '2rem' }}>📉</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              إجمالي غير المقبوض
            </h3>
          </div>
          <p
            style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#dc3545',
              margin: 0,
            }}
          >
            ${trip.total_outstanding?.toFixed(2) || 0}
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
              صافي الرحلة
            </h3>
          </div>
          <p
            style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: ((trip.net_trip ?? 0) || 0) >= 0 ? '#17a2b8' : '#dc3545',
              margin: 0,
            }}
          >
            ${trip.net_trip?.toFixed(2) || 0}
          </p>
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
                      <Link
                        to={`/pilgrims/${pilgrim.id}`}
                        style={{
                          color: '#D4AF37',
                          textDecoration: 'none',
                          fontWeight: '600',
                        }}
                      >
                        {pilgrim.name_ar || pilgrim.name_en || pilgrim.full_name || '-'}
                      </Link>
                    </td>
                    <td>{pilgrim.nationality}</td>
                    <td>{pilgrim.passport_number}</td>
                    <td>{pilgrim.visa_number || '-'}</td>
                    <td>${pilgrim.total_received?.toFixed(2) || 0}</td>
                    <td>
                      <span className={`badge ${getPaymentStatusBadge(pilgrim.payment_status || '')}`}>
                        {pilgrim.payment_status || 'غير مدفوع'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Link
                          to={`/pilgrims/${pilgrim.id}`}
                          className="btn btn-sm btn-secondary"
                          style={{ textDecoration: 'none' }}
                        >
                          عرض
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👥</div>
                    <p style={{ color: '#666', marginBottom: '1rem' }}>لا يوجد معتمرين في هذه الرحلة</p>
                    <button
                      onClick={() => setShowPilgrimModal(true)}
                      className="btn btn-primary"
                    >
                      إضافة معتمر
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Pilgrim Modal */}
      {showPilgrimModal && (
        <div className="modal-overlay" onClick={() => !savingPilgrim && setShowPilgrimModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2 className="modal-title">إضافة معتمر جديد</h2>
              <button
                onClick={() => !savingPilgrim && setShowPilgrimModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#666',
                }}
                disabled={savingPilgrim}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAddPilgrim}>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                {/* Passport OCR Section */}
                <div className="form-group" style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                  <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                    📷 مسح جواز السفر (اختياري)
                  </label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handlePassportScan}
                    disabled={scanningPassport || savingPilgrim}
                    style={{ marginBottom: '0.5rem' }}
                  />
                  <p style={{ fontSize: '0.75rem', color: '#666', margin: '0.25rem 0 0 0' }}>
                    يدعم صور JPG, PNG وملفات PDF
                  </p>
                  {scanningPassport && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#666' }}>
                      <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                      <span>جاري قراءة جواز السفر...</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">الاسم بالعربي *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={pilgrimFormData.name_ar}
                      onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, name_ar: e.target.value })}
                      required
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">الاسم بالإنكليزي</label>
                    <input
                      type="text"
                      className="form-input"
                      value={pilgrimFormData.name_en}
                      onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, name_en: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">الجنسية *</label>
                  <select
                    className="form-select"
                    value={pilgrimFormData.nationality}
                    onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, nationality: e.target.value })}
                    required
                    disabled={savingPilgrim}
                  >
                    <option value="">اختر الجنسية</option>
                    <option value="السعودية">السعودية</option>
                    <option value="مصر">مصر</option>
                    <option value="الأردن">الأردن</option>
                    <option value="الكويت">الكويت</option>
                    <option value="الإمارات">الإمارات</option>
                    <option value="اليمن">اليمن</option>
                    <option value="سوريا">سوريا</option>
                    <option value="العراق">العراق</option>
                    <option value="لبنان">لبنان</option>
                    <option value="السودان">السودان</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">رقم جواز السفر *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={pilgrimFormData.passport_number}
                      onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, passport_number: e.target.value })}
                      required
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">تاريخ انتهاء جواز السفر</label>
                    <input
                      type="date"
                      className="form-input"
                      value={pilgrimFormData.passport_expiry_date}
                      onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, passport_expiry_date: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">تاريخ الميلاد</label>
                    <input
                      type="date"
                      className="form-input"
                      value={pilgrimFormData.date_of_birth}
                      onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, date_of_birth: e.target.value })}
                      disabled={savingPilgrim}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">الجنس</label>
                    <select
                      className="form-select"
                      value={pilgrimFormData.gender}
                      onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, gender: e.target.value })}
                      disabled={savingPilgrim}
                    >
                      <option value="">اختر الجنس</option>
                      <option value="ذكر">ذكر</option>
                      <option value="أنثى">أنثى</option>
                    </select>
                  </div>
                </div>

                {/* Visa Upload Section */}
                <div className="form-group" style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                  <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
                    📄 رفع الفيزا (اختياري)
                  </label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleVisaUpload}
                    disabled={uploadingVisa || savingPilgrim}
                    style={{ marginBottom: '0.5rem' }}
                  />
                  <p style={{ fontSize: '0.75rem', color: '#666', margin: '0.25rem 0 0 0' }}>
                    يدعم صور JPG, PNG وملفات PDF
                  </p>
                  {uploadingVisa && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#666' }}>
                      <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                      <span>جاري رفع الفيزا...</span>
                    </div>
                  )}
                  {uploadedVisaFile && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: '#e9ecef', borderRadius: '4px' }}>
                      {uploadedVisaFile.type === 'application/pdf' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '1.5rem' }}>📄</span>
                          <div>
                            <div style={{ fontWeight: '600', fontSize: '0.875rem' }}>{uploadedVisaFile.name}</div>
                            <div style={{ fontSize: '0.75rem', color: '#666' }}>ملف PDF</div>
                          </div>
                        </div>
                      ) : (
                        <img
                          src={URL.createObjectURL(uploadedVisaFile)}
                          alt="Visa preview"
                          style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '4px' }}
                        />
                      )}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">رقم الفيزا</label>
                  <input
                    type="text"
                    className="form-input"
                    value={pilgrimFormData.visa_number}
                    onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, visa_number: e.target.value })}
                    disabled={savingPilgrim}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">ملاحظات</label>
                  <textarea
                    className="form-textarea"
                    value={pilgrimFormData.notes}
                    onChange={(e) => setPilgrimFormData({ ...pilgrimFormData, notes: e.target.value })}
                    disabled={savingPilgrim}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  onClick={() => !savingPilgrim && setShowPilgrimModal(false)}
                  className="btn btn-secondary"
                  disabled={savingPilgrim}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingPilgrim}>
                  {savingPilgrim ? (
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

export default TripDetails;
