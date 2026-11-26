import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { isPreview, mobileShell, setOffline, useOffline } from '../services/offline';

export default function ConnectionStatus() {
  const offline = useOffline();
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try { await api.get('/api/health'); } catch { setOffline(true); }
    finally { setChecking(false); }
  }
  useEffect(() => {
    if (!mobileShell) return;
    const timer = window.setInterval(check, 20_000);
    const onOnline = () => { void check(); };
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { clearInterval(timer); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);
  if (!mobileShell || !offline) return null;
  return <div className="offline-notice" role="status">
    <p>{isPreview() ? 'عرض الواجهات دون اتصال. سجّل الدخول عند توفر الاتصال للوصول إلى بياناتك.' : 'دون اتصال — تظهر البيانات المحفوظة خلال آخر 24 ساعة للقراءة فقط. قد تكون الشاشات الجديدة فارغة. الحفظ وقراءة الجواز والدفعات تحتاج اتصالًا.'}</p>
    {isPreview() ? <Link to="/login" className="btn btn-secondary">تسجيل الدخول</Link> : <button className="btn btn-secondary" disabled={checking} onClick={check}>{checking ? 'جارٍ الفحص...' : 'فحص الاتصال'}</button>}
  </div>;
}
