import { authService } from '../services/auth';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

function Reports() {
  const isAdmin = authService.isAdmin();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<any>(null);
  const [nationalities, setNationalities] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [tripFinancials, setTripFinancials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    nationality: '',
    tripId: '',
  });

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.nationality) params.append('nationality', filters.nationality);
      if (filters.tripId) params.append('tripId', filters.tripId);
      const queryString = params.toString();

      const [summaryRes, nationalitiesRes, tripsRes, tripFinancialsRes] = await Promise.all([
        api.get(`/api/reports/summary?${queryString}`),
        api.get(`/api/reports/nationalities?${queryString}`),
        api.get('/api/reports/trips'),
        api.get(`/api/reports/by-trip?${queryString}`),
      ]);

      setSummary(summaryRes.data);
      setNationalities(nationalitiesRes.data);
      setTrips(tripsRes.data);
      setTripFinancials(tripFinancialsRes.data);
    } catch (requestError: any) {
      console.error('Error fetching reports:', requestError);
      if (requestError.response?.status === 401 || requestError.response?.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
      } else {
        setError('حدث خطأ في تحميل البيانات. يرجى المحاولة مرة أخرى.');
      }
    } finally {
      setLoading(false);
    }
  }, [filters.startDate, filters.endDate, filters.nationality, filters.tripId, navigate]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }
    fetchReports();
  }, [fetchReports, navigate]);

  const handleExportCSV = () => {
    const csvContent = [
      ['التقرير', 'القيمة'],
      ['إجمالي الرحلات', summary?.total_trips || 0],
      ['إجمالي المعتمرين', summary?.total_pilgrims || 0],
      ...(isAdmin ? [
      ['تكاليف الرحلات', `$${summary?.total_trip_cost?.toFixed(2) || 0}`],
      ['إجمالي المقبوض بالدولار', `$${summary?.total_received?.toFixed(2) || 0}`],
      ['رصيد الأفراد', 'غير متاح لعدم تحديد سعر مستقل للمعتمر'],
      ['صافي الرحلات (المقبوض ناقص التكلفة)', `$${summary?.net_total?.toFixed(2) || 0}`],
      ['معتمرون لديهم دفعات مسجلة', summary?.with_payments || 0],
      ['معتمرون بلا دفعات مسجلة', summary?.without_payments || 0],
      ['إجمالي الدفعات النقدية', `$${summary?.cash_total?.toFixed(2) || 0}`],
      ['إجمالي شام كاش', `$${summary?.sham_cash_total?.toFixed(2) || 0}`],
      ] : []),
    ]
      .map((row) => row.join(','))
      .join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `تقرير_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem' }} className="row-actions">
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
        <h2 style={{ color: '#dc3545', marginBottom: '1rem' }}>خطأ في تحميل البيانات</h2>
        <p style={{ color: '#666', marginBottom: '1rem' }}>{error}</p>
        <button onClick={fetchReports} className="btn btn-primary">
          إعادة المحاولة
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
       className="page-header">
        <div className="">
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.5rem' }}>
            التقارير
          </h1>
          <p style={{ color: '#666', margin: 0 }}>إحصائيات وتقارير شاملة</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }} className="row-actions page-actions">
          <button onClick={handleExportCSV} className="btn btn-secondary">
            <span>📥</span>
            <span>تصدير CSV</span>
          </button>
          <button onClick={handlePrint} className="btn btn-secondary">
            <span>🖨️</span>
            <span>طباعة</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '1rem' }}>تصفية التقارير</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }} className="filters-grid">
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="form-label">من تاريخ</label>
            <input
              type="date"
              className="form-input"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            />
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="form-label">إلى تاريخ</label>
            <input
              type="date"
              className="form-input"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            />
          </div>
          <div style={{ minWidth: '150px' }}>
            <label className="form-label">الجنسية</label>
            <select
              className="form-select"
              value={filters.nationality}
              onChange={(e) => setFilters({ ...filters, nationality: e.target.value })}
            >
              <option value="">كل الجنسيات</option>
              {nationalities.map((nat) => (
                <option key={nat.nationality} value={nat.nationality}>
                  {nat.nationality}
                </option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: '150px' }}>
            <label className="form-label">الرحلة</label>
            <select
              className="form-select"
              value={filters.tripId}
              onChange={(e) => setFilters({ ...filters, tripId: e.target.value })}
            >
              <option value="">كل الرحلات</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Statistics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
       className="responsive-grid stats-grid">
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '2rem' }}>✈️</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              إجمالي الرحلات
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
            {summary?.total_trips || 0}
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
            <span style={{ fontSize: '2rem' }}>👥</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              إجمالي المعتمرين
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
            {summary?.total_pilgrims || 0}
          </p>
        </div>
        {isAdmin && (<div
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
              إجمالي المقبوض بالدولار
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
            ${summary?.total_received?.toFixed(2) || 0}
          </p>
        </div>)}
        {isAdmin && (<div
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
              تكاليف الرحلات
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
            ${summary?.total_trip_cost?.toFixed(2) || 0}
          </p>
        </div>)}
        {isAdmin && (<div
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
              الرصيد المستحق على المعتمرين
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
            غير متاح دون سعر مستقل لكل معتمر
          </p>
        </div>)}
        {isAdmin && (<div
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
              صافي الرحلات (المقبوض ناقص التكلفة)
            </h3>
          </div>
          <p
            style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: (summary?.net_total || 0) >= 0 ? '#17a2b8' : '#dc3545',
              margin: 0,
            }}
          >
            ${summary?.net_total?.toFixed(2) || 0}
          </p>
        </div>)}
        {isAdmin && (<div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '2rem' }}>✅</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              لديهم دفعات مسجلة
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
            {summary?.with_payments || 0}
          </p>
        </div>)}
        {isAdmin && (<div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '2rem' }}>❌</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              بلا دفعات مسجلة
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
            {summary?.without_payments || 0}
          </p>
        </div>)}
        {isAdmin && (<div
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
              إجمالي الدفعات النقدية
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
            ${summary?.cash_total?.toFixed(2) || 0}
          </p>
        </div>)}
        {isAdmin && (<div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '2rem' }}>💳</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              إجمالي شام كاش
            </h3>
          </div>
          <p
            style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#ffc107',
              margin: 0,
            }}
          >
            ${summary?.sham_cash_total?.toFixed(2) || 0}
          </p>
        </div>)}
      </div>

      {/* Nationalities Chart */}
      <div className="card">
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem' }}>
          توزيع المعتمرين حسب الجنسية
        </h2>
        <div className="table-container">
          <table className="table responsive-table">
            <thead>
              <tr>
                <th>الجنسية</th>
                <th>العدد</th>
                <th>النسبة المئوية</th>
              </tr>
            </thead>
            <tbody>
              {nationalities.map((nat) => {
                const percentage = summary?.total_pilgrims
                  ? ((nat.count / summary.total_pilgrims) * 100).toFixed(1)
                  : 0;
                return (
                  <tr key={nat.nationality}>
                    <td style={{ fontWeight: '600' }} data-label="الجنسية"><div className="cell-value">{nat.nationality}</div></td>
                    <td data-label="العدد"><div className="cell-value">{nat.count}</div></td>
                    <td data-label="النسبة المئوية"><div className="cell-value">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} className="filters-grid">
                        <div
                          style={{
                            flex: 1,
                            height: '8px',
                            backgroundColor: '#e9ecef',
                            borderRadius: '4px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${percentage}%`,
                              height: '100%',
                              backgroundColor: '#D4AF37',
                              borderRadius: '4px',
                            }}
                          />
                        </div>
                        <span style={{ minWidth: '50px', textAlign: 'left' }}>{percentage}%</span>
                      </div>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem' }}>
          {isAdmin ? 'الملخص المالي حسب الرحلة' : 'ملخص الرحلات'}
        </h2>
        <div className="table-container">
          <table className="table responsive-table">
            <thead>
              <tr>
                <th>الرحلة</th>
                <th>التاريخ</th>
                <th>المعتمرون</th>
                {isAdmin && (<th>تكلفة الرحلة</th>)}
                {isAdmin && (<th>المقبوض</th>)}
                {isAdmin && (<th>الصافي</th>)}
              </tr>
            </thead>
            <tbody>
              {tripFinancials.length ? tripFinancials.map((trip) => (
                <tr key={trip.id}>
                  <td data-label="الرحلة"><div className="cell-value">{trip.name}</div></td>
                  <td data-label="التاريخ"><div className="cell-value">{new Date(`${String(trip.trip_date).slice(0, 10)}T00:00:00`).toLocaleDateString('ar-SA')}</div></td>
                  <td data-label="المعتمرون"><div className="cell-value">{trip.pilgrim_count}</div></td>
                  {isAdmin && (<td data-label="تكلفة الرحلة"><div className="cell-value">${trip.trip_cost_usd.toFixed(2)}</div></td>)}
                  {isAdmin && (<td data-label="المقبوض"><div className="cell-value">${trip.total_received.toFixed(2)}</div></td>)}
                  {isAdmin && (<td data-label="الصافي"><div className="cell-value">${trip.net_trip.toFixed(2)}</div></td>)}
                </tr>
              )) : (
                <tr>
                  <td colSpan={isAdmin ? 6 : 3} style={{ textAlign: 'center', padding: '2rem' }}>
                    لا توجد رحلات مطابقة للمرشحات
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Reports;
