import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';

interface Pilgrim {
  id: number;
  name_ar?: string;
  name_en?: string;
  first_name_ar?: string;
  father_name_ar?: string;
  last_name_ar?: string;
  first_name_en?: string;
  father_name_en?: string;
  last_name_en?: string;
  passport_number: string;
  visa_number: string;
  nationality: string;
}

interface Trip {
  id: number;
  name: string;
  trip_date: string;
}

function PassengerManifest() {
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [pilgrims, setPilgrims] = useState<Pilgrim[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  useEffect(() => {
    document.body.classList.add('print-manifest');
    return () => document.body.classList.remove('print-manifest');
  }, []);

  useEffect(() => {
    if (tripId) {
      fetchManifest();
    }
  }, [tripId]);

  const fetchManifest = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/api/trips/${tripId}/manifest`);
      setTrip(response.data.trip);
      setPilgrims(response.data.pilgrims);
    } catch (error) {
      alert('حدث خطأ في تحميل البيانات');
      navigate('/trips');
    } finally {
      setLoading(false);
    }
  };

  const handleExportPdf = async () => {
    setGeneratingPdf(true);
    try {
      const response = await api.post(`/api/trips/${tripId}/manifest/pdf`, {}, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `manifest_${trip?.name.replace(/\s+/g, '_')}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      alert('تم تصدير كشف الركاب بنجاح');
    } catch (error) {
      alert('حدث خطأ في تصدير PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const getFullNameAr = (pilgrim: Pilgrim) => {
    const splitName = [pilgrim.first_name_ar, pilgrim.father_name_ar, pilgrim.last_name_ar]
      .filter(Boolean)
      .join(' ')
      .trim();
    return splitName || pilgrim.name_ar || '-';
  };

  const getFullNameEn = (pilgrim: Pilgrim) => {
    const splitName = [pilgrim.first_name_en, pilgrim.father_name_en, pilgrim.last_name_en]
      .filter(Boolean)
      .join(' ')
      .trim();
    return splitName || pilgrim.name_en || '-';
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
        className="manifest-toolbar"
      >
        <div>
          <button
            onClick={() => navigate(`/trips/${tripId}`)}
            className="btn btn-secondary"
            style={{ marginBottom: '1rem' }}
          >
            ← العودة للرحلة
          </button>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.5rem' }}>
            كشف ركاب الرحلة - {trip?.name}
          </h1>
          <p style={{ color: '#666', margin: 0 }}>
            تاريخ الرحلة: {trip && new Date(trip.trip_date).toLocaleDateString('ar-SA')}
          </p>
        </div>
        <div className="manifest-actions">
          <button onClick={() => window.print()} className="btn btn-primary">
            <span>🖨️</span>
            <span>طباعة كشف الركاب</span>
          </button>
          <button
            onClick={handleExportPdf}
            className="btn btn-secondary"
            disabled={generatingPdf}
          >
            {generatingPdf ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                جاري التصدير...
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>📄</span>
                <span>تنزيل PDF</span>
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="card manifest-card" style={{ padding: 0 }}>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>م</th>
                <th>اسم المعتمر بالعربي</th>
                <th>اسم المعتمر بالإنكليزي</th>
                <th>رقم الجواز</th>
                <th>رقم الفيزا</th>
                <th>الجنسية</th>
              </tr>
            </thead>
            <tbody>
              {pilgrims.length > 0 ? (
                pilgrims.map((pilgrim, index) => (
                  <tr key={pilgrim.id}>
                    <td>{index + 1}</td>
                    <td>{getFullNameAr(pilgrim)}</td>
                    <td>{getFullNameEn(pilgrim)}</td>
                    <td>{pilgrim.passport_number}</td>
                    <td>{pilgrim.visa_number || '-'}</td>
                    <td>{pilgrim.nationality}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👥</div>
                    <p style={{ color: '#666' }}>لا يوجد معتمرين في هذه الرحلة</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pilgrims.length > 0 && (
          <div
            style={{
              padding: '1rem',
              textAlign: 'right',
              borderTop: '1px solid var(--border-color)',
              color: '#666',
            }}
          >
            إجمالي المعتمرين: {pilgrims.length}
          </div>
        )}
      </div>
    </div>
  );
}

export default PassengerManifest;