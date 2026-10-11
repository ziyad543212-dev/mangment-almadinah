import { useState } from 'react';
import api from '../services/api';
import { useTheme } from '../contexts/ThemeContext';

declare global {
  interface Window {
    electronAPI?: {
      showSaveDialog: (options: any) => Promise<any>;
      showOpenDialog: (options: any) => Promise<any>;
    };
  }
}

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
      // Try to use Electron dialog if available
      let filePath: string | null = null;
      if (window.electronAPI) {
        const result = await window.electronAPI.showSaveDialog({
          title: 'Save Database Backup',
          defaultPath: `backup_${new Date().toISOString().split('T')[0]}.sqlite`,
          filters: [
            { name: 'SQLite Database', extensions: ['sqlite', 'db'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        if (!result.canceled && result.filePath) {
          filePath = result.filePath;
        }
      }

      if (filePath) {
        // For Electron: download to selected path
        const response = await api.get('/api/backup/export', {
          responseType: 'blob'
        });
        // Create download link
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filePath.split(/[/\\]/).pop() || 'backup.sqlite');
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      } else {
        // For web: direct download
        const response = await api.get('/api/backup/export', {
          responseType: 'blob'
        });
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `backup_${new Date().toISOString().split('T')[0]}.sqlite`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      }

      alert('تم إنشاء نسخة احتياطية بنجاح');
    } catch (error: any) {
      alert('حدث خطأ في إنشاء النسخة الاحتياطية');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!confirm('هل أنت متأكد من استعادة النسخة الاحتياطية؟ سيتم استبدال جميع البيانات الحالية.')) {
      return;
    }

    setRestoreLoading(true);
    try {
      let filePath: string | null = null;
      if (window.electronAPI) {
        const result = await window.electronAPI.showOpenDialog({
          title: 'Select Database Backup',
          filters: [
            { name: 'SQLite Database', extensions: ['sqlite', 'db'] },
            { name: 'All Files', extensions: ['*'] }
          ],
          properties: ['openFile']
        });
        if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
          filePath = result.filePaths[0];
        }
      }

      if (filePath) {
        // For Electron: upload selected file
        const formData = new FormData();
        const file = new File([await (await fetch(`file://${filePath}`)).blob()], filePath.split(/[/\\]/).pop() || 'backup.sqlite');
        formData.append('backup', file);

        await api.post('/api/backup/restore', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      } else {
        // For web: use file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.sqlite,.db';
        input.onchange = async (e: any) => {
          const file = e.target.files[0];
          if (file) {
            const formData = new FormData();
            formData.append('backup', file);
            await api.post('/api/backup/restore', formData, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
          }
        };
        input.click();
        return;
      }

      alert('تم استعادة النسخة الاحتياطية بنجاح. يرجى إعادة تشغيل التطبيق.');
    } catch (error: any) {
      alert('حدث خطأ في استعادة النسخة الاحتياطية');
    } finally {
      setRestoreLoading(false);
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

      <div className="card" style={{ maxWidth: '600px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem' }}>
          النسخ الاحتياطي والاستعادة
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
            تنبيه: استعادة النسخة الاحتياطية ستحذف جميع البيانات الحالية واستبدالها بالبيانات من النسخة الاحتياطية.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Settings;
