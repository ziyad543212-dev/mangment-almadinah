import { useEffect, useState } from 'react';
import axios from 'axios';
import api from '../services/api';
import type { User } from '../types';

export default function EmployeeAccounts() {
  const [employees, setEmployees] = useState<User[]>([]);
  const [admins, setAdmins] = useState<User[]>([]);
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([api.get('/api/auth/employees'), api.get('/api/auth/admins')]).then(([employeeResponse, adminResponse]) => {
      if (active) { setEmployees(employeeResponse.data.employees); setAdmins(adminResponse.data.admins); }
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
        <input id="employee-password" className="form-input" type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} minLength={8} maxLength={128} required disabled={saving} />
        <small>8 أحرف على الأقل</small>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor="employee-confirm">تأكيد كلمة مرور الموظف *</label>
        <input id="employee-confirm" className="form-input" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={event => setForm({ ...form, confirmPassword: event.target.value })} minLength={8} maxLength={128} required disabled={saving} />
      </div>
      {!!error && <p role="alert" style={{ color: '#c0392b', marginBottom: '1rem' }}>{error}</p>}
      {!!success && <p role="status" style={{ color: '#218838', marginBottom: '1rem' }}>{success}</p>}
      <button className="btn btn-primary" type="submit" disabled={saving || loading}>{saving ? 'جارٍ إنشاء الحساب...' : 'إضافة حساب موظف'}</button>
    </form>
    <div style={{ marginTop: '1.5rem' }}>
      <h3>الموظفون المسجلون</h3>
      {loading ? <p>جارٍ التحميل...</p> : employees.length ? <ul style={{ paddingInlineStart: '1.5rem', overflowWrap: 'anywhere' }}>{employees.map(employee => <li key={employee.id} style={{ marginBlock: '0.5rem' }}>{employee.username}</li>)}</ul> : <p>لا توجد حسابات موظفين.</p>}
    </div>
    <div style={{ marginTop: '1.5rem' }}>
      <h3>المدراء المسجلون</h3>
      {admins.length ? <ul style={{ paddingInlineStart: '1.5rem', overflowWrap: 'anywhere' }}>{admins.map(admin => <li key={admin.id} style={{ marginBlock: '0.5rem' }}>{admin.username}</li>)}</ul> : <p>لا توجد حسابات مدراء إضافية.</p>}
      <p style={{ color: 'var(--text-secondary)' }}>لإضافة مدير جديد استخدم النموذج التالي.</p>
      <form onSubmit={async event => { event.preventDefault(); setError(''); setSuccess(''); if (form.password !== form.confirmPassword) { setError('تأكيد كلمة المرور غير مطابق'); return; } setSaving(true); try { const { data } = await api.post('/api/auth/admins', form); setAdmins(current => [data.user, ...current]); setForm({ username: '', password: '', confirmPassword: '' }); setSuccess(`تم إنشاء حساب المدير ${data.user.username}.`); } catch (failure) { setError(axios.isAxiosError(failure) ? failure.response?.data?.error || 'تعذر إنشاء حساب المدير' : 'تعذر إنشاء حساب المدير'); } finally { setSaving(false); } }}>
        <div className="form-group"><label className="form-label" htmlFor="admin-username">اسم مستخدم المدير *</label><input id="admin-username" className="form-input" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} maxLength={80} required disabled={saving} /></div>
        <div className="form-group"><label className="form-label" htmlFor="admin-password">كلمة مرور المدير *</label><input id="admin-password" className="form-input" type="password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} minLength={8} maxLength={128} required disabled={saving} /></div>
        <div className="form-group"><label className="form-label" htmlFor="admin-confirm">تأكيد كلمة المرور *</label><input id="admin-confirm" className="form-input" type="password" value={form.confirmPassword} onChange={event => setForm({ ...form, confirmPassword: event.target.value })} minLength={8} maxLength={128} required disabled={saving} /></div>
        <button className="btn btn-secondary" type="submit" disabled={saving || loading}>{saving ? 'جارٍ الإنشاء...' : 'إضافة مدير'}</button>
      </form>
    </div>
  </section>;
}
