import { useEffect, useState } from 'react';
import axios from 'axios';
import api from '../services/api';
import type { User } from '../types';

export default function EmployeeAccounts() {
  const [employees, setEmployees] = useState<User[]>([]);
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/api/auth/employees').then(({ data }) => {
      if (active) setEmployees(data.employees);
    }).catch(() => { if (active) setError('تعذر تحميل حسابات الموظفين. أعد فتح الإعدادات للمحاولة مجددًا.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function createEmployee(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setSuccess('');
    if (form.password !== form.confirmPassword) { setError('تأكيد كلمة المرور غير مطابق'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/api/auth/employees', form);
      setEmployees(current => [data.user, ...current]);
      setForm({ username: '', password: '', confirmPassword: '' });
      setSuccess(`تم إنشاء حساب الموظف ${data.user.username}. يمكنه تسجيل الدخول الآن.`);
    } catch (failure) {
      setError(axios.isAxiosError(failure) ? failure.response?.data?.error || 'تعذر إنشاء الحساب' : 'تعذر إنشاء الحساب');
    } finally { setSaving(false); }
  }

  return <section className="card" style={{ maxWidth: '600px', marginBottom: '2rem' }} aria-labelledby="employees-heading">
    <h2 id="employees-heading" style={{ marginBottom: '0.75rem' }}>حسابات الموظفين</h2>
    <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>يدير الموظف الرحلات والمعتمرين والوثائق. الدفعات والفواتير والمعلومات المالية متاحة للمدير فقط.</p>
    <form onSubmit={createEmployee}>
      <div className="form-group">
        <label className="form-label" htmlFor="employee-username">اسم مستخدم الموظف *</label>
        <input id="employee-username" className="form-input" autoComplete="off" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} maxLength={80} required disabled={saving} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="employee-password">كلمة مرور الموظف *</label>
        <input id="employee-password" className="form-input" type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} minLength={12} maxLength={128} required disabled={saving} />
        <small>12 حرفاً على الأقل</small>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="employee-confirm">تأكيد كلمة مرور الموظف *</label>
        <input id="employee-confirm" className="form-input" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={event => setForm({ ...form, confirmPassword: event.target.value })} minLength={12} maxLength={128} required disabled={saving} />
      </div>
      {!!error && <p role="alert" style={{ color: '#c0392b', marginBottom: '1rem' }}>{error}</p>}
      {!!success && <p role="status" style={{ color: '#218838', marginBottom: '1rem' }}>{success}</p>}
      <button className="btn btn-primary" type="submit" disabled={saving || loading}>{saving ? 'جارٍ إنشاء الحساب...' : 'إضافة حساب موظف'}</button>
    </form>
    <div style={{ marginTop: '1.5rem' }}>
      <h3>الموظفون المسجلون</h3>
      {loading ? <p>جارٍ التحميل...</p> : employees.length ? <ul style={{ paddingInlineStart: '1.5rem', overflowWrap: 'anywhere' }}>{employees.map(employee => <li key={employee.id} style={{ marginBlock: '0.5rem' }}>{employee.username}</li>)}</ul> : <p>لا توجد حسابات موظفين.</p>}
    </div>
  </section>;
}
