import { useState } from 'react';
import api from '../services/api';

function Setup() {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (formData.password !== formData.confirmPassword) {
      setError('كلمة المرور غير متطابقة');
      setLoading(false);
      return;
    }

    if (formData.password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      setLoading(false);
      return;
    }

    try {
      const response = await api.post('/api/auth/setup-admin', formData);
      setMessage(response.data.message);
      setFormData({ username: '', password: '', confirmPassword: '' });
    } catch (err: any) {
      setError(err.response?.data?.error || 'حدث خطأ في إنشاء المستخدم');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '3rem auto', padding: '2rem' }}>
      <div className="card">
        <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>إنشاء مستخدم مسؤول</h2>
        
        {message && (
          <div style={{ padding: '1rem', marginBottom: '1rem', backgroundColor: '#d4edda', borderRadius: '4px', color: '#155724' }}>
            {message}
          </div>
        )}

        {error && (
          <div style={{ padding: '1rem', marginBottom: '1rem', backgroundColor: '#f8d7da', borderRadius: '4px', color: '#721c24' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">اسم المستخدم</label>
            <input
              type="text"
              className="form-input"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">كلمة المرور</label>
            <input
              type="password"
              className="form-input"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">تأكيد كلمة المرور</label>
            <input
              type="password"
              className="form-input"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              required
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'جاري الإنشاء...' : 'إنشاء مستخدم مسؤول'}
          </button>
        </form>

        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <a href="/login" style={{ color: '#D4AF37', textDecoration: 'none' }}>
            الذهاب لتسجيل الدخول ←
          </a>
        </div>
      </div>
    </div>
  );
}

export default Setup;
