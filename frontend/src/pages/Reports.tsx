import { useState, useEffect } from 'react';
import api from '../services/api';

function Reports() {
  const [summary, setSummary] = useState<any>(null);
  const [nationalities, setNationalities] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    nationality: '',
    tripId: '',
  });

  useEffect(() => {
    fetchReports();
  }, [filters]);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.nationality) params.append('nationality', filters.nationality);
      if (filters.tripId) params.append('tripId', filters.tripId);

      const [summaryRes, nationalitiesRes, tripsRes] = await Promise.all([
        api.get(`/api/reports/summary?${params.toString()}`),
        api.get('/api/reports/nationalities'),
        api.get('/api/reports/trips'),
      ]);

      setSummary(summaryRes.data);
      setNationalities(nationalitiesRes.data);
      setTrips(tripsRes.data);
    } catch (error) {
      alert('حدث خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    const csvContent = [
      ['التقرير', 'القيمة'],
      ['إجمالي الرحلات', summary?.total_trips || 0],
      ['إجمالي المعتمرين', summary?.total_pilgrims || 0],
      ['تكاليف الرحلات', `$${summary?.total_trip_cost?.toFixed(2) || 0}`],
      ['إجمالي المقبوض بالدولار', `$${summary?.total_received?.toFixed(2) || 0}`],
      ['إجمالي غير المقبوض', `$${summary?.total_outstanding?.toFixed(2) || 0}`],
      ['صافي الإجمالي', `$${summary?.net_total?.toFixed(2) || 0}`],
      ['مدفوع', summary?.with_payments || 0],
      ['غير مدفوع', summary?.without_payments || 0],
      ['إجمالي الدفعات النقدية', `$${summary?.cash_total?.toFixed(2) || 0}`],
      ['إجمالي شام كاش', `$${summary?.sham_cash_total?.toFixed(2) || 0}`],
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
            التقارير
          </h1>
          <p style={{ color: '#666', margin: 0 }}>إحصائيات وتقارير شاملة</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
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
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
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
            ${summary?.total_outstanding?.toFixed(2) || 0}
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
              صافي الإجمالي
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
            <span style={{ fontSize: '2rem' }}>✅</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              مدفوع
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
            <span style={{ fontSize: '2rem' }}>❌</span>
            <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
              غير مدفوع
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
        </div>
      </div>

      {/* Nationalities Chart */}
      <div className="card">
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem' }}>
          توزيع المعتمرين حسب الجنسية
        </h2>
        <div className="table-container">
          <table className="table">
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
                    <td style={{ fontWeight: '600' }}>{nat.nationality}</td>
                    <td>{nat.count}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Reports;
