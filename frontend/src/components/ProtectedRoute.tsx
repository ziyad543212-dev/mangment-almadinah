import { Navigate } from 'react-router-dom';
import { authService } from '../services/auth';

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  if (!authService.isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && !authService.isAdmin()) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}

export default ProtectedRoute;
