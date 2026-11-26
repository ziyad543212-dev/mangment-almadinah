import { useRef, useState } from 'react';
import api from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import { authService } from '../services/auth';
import EmployeeAccounts from '../components/EmployeeAccounts';

function Settings() {
  const { theme, toggleTheme } = useTheme();
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);

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

  const handleBackup = async () => {
    setBackupLoading(true);
    try {
      const response = await api.get('/api/backup/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `almadinah-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      alert('تم إنشاء نسخة احتياطية بنجاح');
    } catch (error: any) {
      alert(error.response?.data?.error || 'تعذر إنشاء النسخة الاحتياطية');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!confirm('ستُستبدل جميع بيانات التطبيق بالنسخة المختارة. لا تتابع قبل إنشاء نسخة احتياطية حديثة. هل تريد اختيار ملف الاستعادة؟')) {
      return;
    }
    restoreInput.current?.click();
  };

  const handleRestoreFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setRestoreLoading(true);
    try {
      if (!file.name.toLowerCase().endsWith('.json')) {
        throw new Error('اختر ملف نسخة PostgreSQL بصيغة JSON');
      }
      const formData = new FormData();
      formData.append('backup', file);
      formData.append('confirmRestore', 'RESTORE');
      const response = await api.post('/api/backup/restore', formData);
      alert(`${response.data.message} (${response.data.restoredRows} سجل)`);
    } catch (error: any) {
      alert(error.response?.data?.error || error.message || 'تعذر استعادة النسخة الاحتياطية');
    } finally {
      setRestoreLoading(false);
      event.target.value = '';
    }
  };

  return (
    <div>
      <div
        style={{
          marginBottom: '2rem',
        }}
       className="">
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#1a1a2e', marginBottom: '0.5rem' }}>
          الإعدادات
        </h1>
        <p style={{ color: '#666', margin: 0 }}>إدارة إعدادات الحساب</p>
      </div>

      <div className="card" style={{ maxWidth: '600px', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem' }}>
          المظهر
        </h2>
        <div style={{ display: 'flex', gap: '1rem' }} className="row-actions theme-options">
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

      {authService.isAdmin() && <EmployeeAccounts />}

      <div className="card" style={{ maxWidth: '600px', marginBottom: '2rem' }}>
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
              minLength={12}
              maxLength={128}
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
              minLength={12}
              maxLength={128}
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

      {authService.isAdmin() && <div className="card" style={{ maxWidth: '600px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem' }}>
          النسخ الاحتياطي والاستعادة
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} className="row-actions">
          <input
            ref={restoreInput}
            type="file"
            accept=".json,application/json"
            onChange={handleRestoreFile}
            hidden
          />
          <button
            onClick={handleBackup}
            className="btn btn-primary"
            disabled={backupLoading}
            style={{ width: '100%' }}
          >
            {backupLoading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                جاري إنشاء النسخة الاحتياطية...
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>💾</span>
                <span>تصدير نسخة احتياطية</span>
              </span>
            )}
          </button>
          <button
            onClick={handleRestore}
            className="btn btn-secondary"
            disabled={restoreLoading}
            style={{ width: '100%' }}
          >
            {restoreLoading ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="spinner" style={{ width: '16px', height: '16px' }}></span>
                جاري استعادة النسخة الاحتياطية...
              </span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>📥</span>
                <span>استعادة نسخة احتياطية</span>
              </span>
            )}
          </button>
          <p style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.5rem' }}>
            احتفظ بنسخة حديثة قبل استعادة البيانات. الاستعادة تستبدل جميع بيانات البرنامج بالنسخة المختارة.
          </p>
        </div>
      </div>}
    </div>
  );
}

export default Settings;
