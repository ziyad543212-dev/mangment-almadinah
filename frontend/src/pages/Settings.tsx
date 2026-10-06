import { useState } from 'react';
import api from '../services/api';
import { useTheme } from '../contexts/ThemeContext';

function Settings() {
  const { theme, toggleTheme } = useTheme();
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await api.post('/api/auth/change-password', passwordData);
      alert('تم تغيير كلمة المرور بنجاح');
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (error: any) {
      alert(error.response?.data?.error || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div
        style={{
          marginBottom: '2rem',
        }}
      >
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.5rem' }}>
          الإعدادات
        </h1>
        <p style={{ color: '#666', margin: 0 }}>إدارة إعدادات الحساب</p>
      </div>

      <div className="card" style={{ maxWidth: '600px', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem' }}>
          المظهر
        </h2>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={() => theme !== 'light' && toggleTheme()}
            className="btn"
            style={{
              flex: 1,
              padding: '1rem',
              backgroundColor: theme === 'light' ? 'var(--primary-gold)' : 'var(--bg-tertiary)',
              color: theme === 'light' ? 'white' : 'var(--text-primary)',
              border: theme === 'light' ? '2px solid var(--primary-gold)' : '2px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>☀️</div>
            <div style={{ fontWeight: '600' }}>الوضع العادي</div>
          </button>
          <button
            onClick={() => theme !== 'dark' && toggleTheme()}
            className="btn"
            style={{
              flex: 1,
              padding: '1rem',
              backgroundColor: theme === 'dark' ? 'var(--primary-gold)' : 'var(--bg-tertiary)',
              color: theme === 'dark' ? 'white' : 'var(--text-primary)',
              border: theme === 'dark' ? '2px solid var(--primary-gold)' : '2px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🌙</div>
            <div style={{ fontWeight: '600' }}>الوضع الليلي</div>
          </button>
        </div>
      </div>

      <div className="card" style={{ maxWidth: '600px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem' }}>
          تغيير كلمة المرور
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">كلمة المرور الحالية *</label>
            <input
              type="password"
              className="form-input"
              value={passwordData.currentPassword}
              onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
              required
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label className="form-label">كلمة المرور الجديدة *</label>
            <input
              type="password"
              className="form-input"
              value={passwordData.newPassword}
              onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
              required
              disabled={loading}
              minLength={6}
            />
          </div>
          <div className="form-group">
            <label className="form-label">تأكيد كلمة المرور الجديدة *</label>
            <input
              type="password"
              className="form-input"
              value={passwordData.confirmPassword}
              onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
              required
              disabled={loading}
              minLength={6}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                جاري التغيير...
              </span>
            ) : (
              'تغيير كلمة المرور'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Settings;
