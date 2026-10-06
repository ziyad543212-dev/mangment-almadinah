import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';
import { useTheme } from '../contexts/ThemeContext';

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const handleLogout = () => {
    if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
      authService.logout();
      navigate('/login');
    }
  };

  const menuItems = [
    { path: '/dashboard', label: 'لوحة التحكم', icon: '📊' },
    { path: '/trips', label: 'الرحلات', icon: '✈️' },
    { path: '/payments', label: 'الدفعات', icon: '💰' },
    { path: '/reports', label: 'التقارير', icon: '📈' },
    { path: '/settings', label: 'الإعدادات', icon: '⚙️' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f8f9fa' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: '260px',
          backgroundColor: '#1a1a2e',
          color: 'white',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          right: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: '1.5rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            textAlign: 'center',
          }}
        >
          <img
            src="/Logo.png"
            alt="شركة المدينة للحج والعمرة"
            style={{
              width: '80px',
              height: 'auto',
              marginBottom: '0.5rem',
            }}
          />
          <h2
            style={{
              fontSize: '1rem',
              fontWeight: '600',
              margin: 0,
              color: '#D4AF37',
            }}
          >
            شركة المدينة
          </h2>
          <p style={{ fontSize: '0.75rem', margin: 0, opacity: 0.7 }}>
            للحج والعمرة
          </p>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '1rem 0' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {menuItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.75rem 1.5rem',
                      color: isActive ? '#D4AF37' : 'rgba(255, 255, 255, 0.7)',
                      textDecoration: 'none',
                      fontWeight: isActive ? '600' : '400',
                      backgroundColor: isActive ? 'rgba(212, 175, 55, 0.1)' : 'transparent',
                      borderRight: isActive ? '3px solid #D4AF37' : '3px solid transparent',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span style={{ fontSize: '1.25rem' }}>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Theme Toggle & Logout */}
        <div style={{ padding: '1rem', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <button
            onClick={toggleTheme}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1.5rem',
              backgroundColor: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.7)',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '400',
              transition: 'all 0.2s',
              marginBottom: '0.5rem',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#D4AF37';
              e.currentTarget.style.backgroundColor = 'rgba(212, 175, 55, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <span style={{ fontSize: '1.25rem' }}>{theme === 'light' ? '🌙' : '☀️'}</span>
            <span>{theme === 'light' ? 'الوضع الليلي' : 'الوضع العادي'}</span>
          </button>
          <button
            onClick={handleLogout}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1.5rem',
              backgroundColor: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.7)',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '400',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#dc3545';
              e.currentTarget.style.backgroundColor = 'rgba(220, 53, 69, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <span style={{ fontSize: '1.25rem' }}>🚪</span>
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          marginRight: '260px',
          padding: '2rem',
          overflowY: 'auto',
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
