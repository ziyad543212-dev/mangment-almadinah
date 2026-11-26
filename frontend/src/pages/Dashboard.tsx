import { authService } from '../services/auth';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import type { DashboardStats } from '../types';

function Dashboard() {
  const isAdmin = authService.isAdmin();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await api.get('/api/dashboard/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
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

  const StatCard = ({ title, value, icon, color }: { title: string; value: number | string; icon: string; color: string }) => (
    <div
      className="card"
      style={{
        flex: 1,
        minWidth: '200px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '2rem' }}>{icon}</span>
        <h3 style={{ fontSize: '0.875rem', color: '#666', margin: 0, fontWeight: '600' }}>
          {title}
        </h3>
      </div>
      <p
        style={{
          fontSize: '2rem',
          fontWeight: '700',
          color: color,
          margin: 0,
        }}
      >
        {value}
      </p>
    </div>
  );

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
            لوحة التحكم
          </h1>
          <p style={{ color: '#666', margin: 0 }}>نظرة عامة على إحصائيات النظام</p>
        </div>
      </div>

      {/* Statistics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
       className="responsive-grid stats-grid">
        <StatCard title="إجمالي الرحلات" value={stats?.totalTrips ?? '—'} icon="✈️" color="#D4AF37" />
        <StatCard title="إجمالي المعتمرين" value={stats?.totalPilgrims ?? '—'} icon="👥" color="#D4AF37" />
        {isAdmin && (<StatCard title="إجمالي المقبوض بالدولار" value={`$${stats?.totalReceived?.toFixed(2) || 0}`} icon="💰" color="#28a745" />)}
        <StatCard title="الرحلات القادمة" value={stats?.upcomingTrips ?? '—'} icon="📅" color="#17a2b8" />
        {isAdmin && (<StatCard title="معتمرون لديهم دفعات مسجلة" value={stats?.pilgrimsWithPayments || 0} icon="✅" color="#28a745" />)}
        {isAdmin && (<StatCard title="معتمرون بلا دفعات مسجلة" value={stats?.pilgrimsWithoutPayments || 0} icon="❌" color="#dc3545" />)}
        {isAdmin && (<StatCard title="تكاليف الرحلات" value={`$${stats?.totalTripCost?.toFixed(2) || 0}`} icon="💵" color="#D4AF37" />)}
      </div>

      {/* Quick Actions */}
      <div className="card">
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1rem' }}>إجراءات سريعة</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }} className="row-actions quick-actions">
          <Link
            to="/trips?action=add"
            className="btn btn-primary"
            style={{ textDecoration: 'none' }}
          >
            <span>➕</span>
            <span>إضافة رحلة جديدة</span>
          </Link>
          {isAdmin && (<Link
            to="/payments"
            className="btn btn-secondary"
            style={{ textDecoration: 'none' }}
          >
            <span>💰</span>
            <span>عرض جميع الدفعات</span>
          </Link>)}
          <Link
            to="/reports"
            className="btn btn-secondary"
            style={{ textDecoration: 'none' }}
          >
            <span>📈</span>
            <span>عرض التقارير</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
