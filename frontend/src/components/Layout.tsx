import { useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Plane, Wallet, ChartNoAxesCombined, Settings, Moon, Sun, LogOut } from 'lucide-react';
import { authService } from '../services/auth';
import { useTheme } from '../contexts/ThemeContext';
import LogoPng from '/Logo.png';
import ConnectionStatus from './ConnectionStatus';
import { useOffline } from '../services/offline';

const menuItems = [
  { path: '/dashboard', label: 'الرئيسية', desktopLabel: 'لوحة التحكم', Icon: LayoutDashboard },
  { path: '/trips', label: 'الرحلات', desktopLabel: 'الرحلات', Icon: Plane },
  { path: '/payments', label: 'الدفعات', desktopLabel: 'الدفعات', Icon: Wallet },
  { path: '/reports', label: 'التقارير', desktopLabel: 'التقارير', Icon: ChartNoAxesCombined },
  { path: '/settings', label: 'الإعدادات', desktopLabel: 'الإعدادات', Icon: Settings },
];

function Layout() {
  const offline = useOffline();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const visibleMenuItems = menuItems.filter(item => item.path !== '/payments' || authService.isAdmin());
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  function handleLogout() {
    if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
      authService.logout();
      navigate('/login');
    }
  }

  const links = (mobile: boolean) => visibleMenuItems.map(({ path, label, desktopLabel, Icon }) => {
    const active = pathname === path || pathname.startsWith(path + '/') || path === '/trips' && pathname.startsWith('/pilgrims/');
    return <Link key={path} to={path} className={`app-nav-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
      <Icon size={22} strokeWidth={active ? 2.4 : 1.8} aria-hidden="true" />
      <span>{mobile ? label : desktopLabel}</span>
    </Link>;
  });

  const accountActions = <>
    <button type="button" className="app-icon-button" onClick={toggleTheme} aria-label={theme === 'light' ? 'تفعيل الوضع الليلي' : 'تفعيل الوضع العادي'}>
      {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
    </button>
    <button type="button" className="app-icon-button" onClick={handleLogout} aria-label="تسجيل الخروج"><LogOut size={20} /></button>
  </>;

  return <div className="app-shell">
    <aside className="app-sidebar" aria-label="القائمة الرئيسية">
      <Link to="/dashboard" className="app-brand app-brand-desktop">
        <img src={LogoPng} alt="لوغو المدينة" />
        <strong>شركة المدينة</strong><small>للحج والعمرة</small>
      </Link>
      <nav className="app-desktop-nav" aria-label="التنقل">{links(false)}</nav>
      <div className="app-account-actions">{accountActions}</div>
    </aside>
    <header className="app-mobile-header">
      <Link to="/dashboard" className="app-brand"><img src={LogoPng} alt="" /><span><strong>المدينة</strong><small>للحج والعمرة</small></span></Link>
      <div className="app-account-actions">{accountActions}</div>
    </header>
    <main className="app-main" id="main-content"><ConnectionStatus /><Outlet key={offline ? 'offline' : 'online'} /></main>
    <nav className="app-bottom-nav" style={{ gridTemplateColumns: `repeat(${visibleMenuItems.length}, minmax(0, 1fr))` }} aria-label="التنقل الرئيسي للهاتف">{links(true)}</nav>
  </div>;
}

export default Layout;
